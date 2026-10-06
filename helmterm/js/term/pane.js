// A pane: one <terminal> running one profile's process, with the frame
// around it: the exit banner, the bell flash, the scrollbar and command
// marks (PaneChrome), the clipboard prompt and paste guard (PaneGuard).
//
// The element tells the pane what happens by events (titles, directories,
// the bell, notifications, progress, OSC 52, OSC 133 marks, links, scrolling,
// search). A <terminal> runs one process in its life, so restarting a pane
// replaces its element with a fresh one in the same place.

import { Emitter } from '../core/emitter.js';
import * as term from './adapter.js';
import { resolveTitle } from './titles.js';
import { CommandLog } from './command_log.js';
import { PaneChrome } from './pane_chrome.js';
import { PaneGuard } from './pane_guard.js';

let nextId = 1;

export class Pane extends Emitter {
    /// `launch` is ProfileSet.resolve()'s answer; `scheme` the colour scheme;
    /// `app` the application (settings, overlays, the clipboard).
    constructor(launch, scheme, app) {
        super();
        this.id = nextId++;
        this.app = app || null;
        this.launch = launch;
        this.scheme = scheme;
        this.fontDelta = 0;
        this.userTitle = launch.title || null;
        this.lastTitle = '';
        this.lastCwd = null;
        this.exited = false;
        this.exitCode = null;
        this.startError = null;
        this.activity = false;
        this.bell = false;
        this.notified = false;       // a notification arrived while unseen
        this.progress = null;        // { state, value } from OSC 9;4
        this.titleState = { programTitle: '', programTitleAt: 0, foreground: null, foregroundAt: 0 };

        this.root = document.createElement('div');
        this.root.className = 'pane';
        this.root.dataset.paneId = String(this.id);
        this.banner = document.createElement('div');
        this.banner.className = 'pane-banner';
        this.root.appendChild(this.banner);
        this.chrome = new PaneChrome(this);
        this.guard = new PaneGuard(this);
        this._newElement();
    }

    get profile() { return this.launch.profile; }
    get behaviour() { return this.launch.behaviour || {}; }
    get palette() { return term.palette(this.el); }
    get bracketedPaste() { return term.bracketedPaste(this.el); }

    _newElement() {
        if (this.el) this.el.remove();
        const el = term.create();
        this.el = el;
        this.commandLog = new CommandLog();
        this.commandLog.on('finish', (info) => this.emit('commandfinish', this, info));
        this.commandLog.on('change', () => this.chrome.update());
        this.root.insertBefore(el, this.root.firstChild);
        term.watch(el, {
            titlechange: (e) => this._programTitle(e.detail && e.detail.title),
            cwdchange: (e) => this._cwdChanged(e.detail),
            bell: () => this.ring(),
            notification: (e) => this._notification(e.detail || {}),
            progress: (e) => this._progress(e.detail || {}),
            promptmark: (e) => this.commandLog.mark(el, e.detail),
            scroll: (e) => this.chrome.update(e.detail),
            searchchange: (e) => this.emit('searchchange', this, e.detail || {}),
            linkactivate: (e) => this._link(e),
            clipboardread: (e) => this.guard.clipboardRead(e),
            clipboardwrite: (e) => this.guard.clipboardWrite(e),
            paste: (e) => this.guard.paste(e),
            foreground: () => this._foreground(),
            activity: (e) => this._activity(e),
            resize: () => this.chrome.update(),
            exit: (e) => this._exit(e),
            detach: () => this._detached(),
            focus: () => this.emit('focus', this),
            keydown: (e) => this._keydown(e),
        });
        this.chrome.attach(el);
        this.applyAppearance(this.launch.appearance, this.scheme);
    }

    /// The spawn() options: the launch spec, persistent where the element
    /// can keep a session alive (bro T2b) and settings ask for it.
    _spawnOptions() {
        const s = { ...this.launch.spawn };
        this.server = null;
        if (this.persistent) {
            s.persistent = true;
            s.name = 'broterm: ' + this.profile.name;
            const server = this.app.settings.values.persistentServer;
            if (server) { s.server = String(server); this.server = s.server; }
        }
        return s;
    }

    /// Whether new processes in this pane run in a bromux session that
    /// outlives broterm (settings.persistentSessions, where bro has them).
    get persistent() {
        return term.caps.persistent && !!this.app && !!this.app.settings.values.persistentSessions;
    }

    /// The bromux session this pane shows, null for a local process.
    get sessionId() { return term.sessionId(this.el); }

    /// Attach to the session a saved pane had, when it still runs.
    _attach(id, server) {
        if (!term.caps.persistent || !term.sessionRunning(id, server)) return false;
        try {
            if (server) this.el.attach(id, server); else this.el.attach(id);
            this.pid = null;
            this.server = server || null;
            return true;
        } catch (e) {
            console.error('broterm: cannot attach to session ' + id + ': ' + e.message);
            return false;
        }
    }

    /// Start the process. False (and a banner saying why) when it could not.
    start() {
        this.exited = false;
        this.exitCode = null;
        this.startError = null;
        this.root.classList.remove('exited');
        this.banner.textContent = '';
        const saved = this.launch.session;   // { id, server } from a saved session
        this.launch.session = null;
        if (saved && this._attach(saved.id, saved.server)) {
            this.attached = true;
            return true;
        }
        this.attached = false;
        try {
            this.pid = this.el.spawn(this._spawnOptions());
            return true;
        } catch (e) {
            this.startError = (e && e.message) || String(e);
            const cmd = this.launch.spawn.command || 'the default shell';
            this.el.feed('\x1b[31mbroterm: could not start ' + cmd + '\x1b[0m\r\n' + this.startError + '\r\n');
            this._showBanner('Could not start ' + cmd + '. Enter restarts, ' + 'Ctrl+Shift+W closes.');
            this.exited = true;
            return false;
        }
    }

    restart() {
        this._newElement();
        const ok = this.start();
        this.emit('restart', this);
        return ok;
    }

    /// Fonts, colours, cursor and padding, and the element's behaviour
    /// switches (`behaviour`, when given).
    applyAppearance(appearance, scheme, behaviour) {
        this.launch.appearance = appearance;
        if (behaviour) this.launch.behaviour = behaviour;
        if (scheme) this.scheme = scheme;
        const a = appearance;
        const el = this.el;
        const size = Math.max(6, Math.min(72, (Number(a.font && a.font.size) || 14) + this.fontDelta));
        el.style.fontFamily = (a.font && a.font.family) || 'monospace';
        el.style.fontSize = size + 'px';
        if (a.font && a.font.weight) el.style.fontWeight = String(a.font.weight);
        if (a.font && a.font.lineHeight) el.style.lineHeight = String(a.font.lineHeight);
        const pad = Math.max(0, Number(a.padding) || 0);
        el.style.padding = pad + 'px';
        if (this.scheme) {
            el.style.backgroundColor = this.scheme.background;
            el.style.color = this.scheme.foreground;
            this.root.style.backgroundColor = this.scheme.background;
            term.applyTheme(el, this.scheme);
        }
        term.applyCursor(el, a.cursorStyle || 'block', a.cursorBlink !== false);
        term.applyScrollback(el, Number(a.scrollback) || 0);
        term.applyOptions(el, this.behaviour);
        this.chrome.configure(this.app ? this.app.settings.values : {});
        this._refreshTitle();
    }

    adjustFont(delta) {
        this.fontDelta = delta === 0 ? 0 : this.fontDelta + delta;
        this.applyAppearance(this.launch.appearance, this.scheme);
    }

    // ── what the pane shows ──

    get running() {
        try { return !!this.el.running; } catch (e) { return false; }
    }

    /// The pane's title (term/titles.js has the rules).
    get title() {
        return resolveTitle({
            userTitle: this.userTitle,
            profile: this.profile,
            command: this.launch.spawn.command,
            ...this.titleState,
        });
    }

    /// The directory the shell last reported (OSC 7), else null.
    get reportedCwd() { return this.lastCwd; }

    get cwd() { return this.lastCwd || term.cwd(this.el); }

    /// The shell is waiting at its prompt (OSC 133), or nothing says
    /// otherwise: 'prompt' | 'running' | 'unknown'.
    get shellState() { return this.commandLog.state; }

    get busy() { return this.commandLog.state === 'running' ? true : this.commandLog.integrated ? false : undefined; }

    focus() { this.el.focus(); }

    hasFocus() { return document.activeElement === this.el; }

    markSeen() {
        this.activity = false;
        this.bell = false;
        this.notified = false;
    }

    ring() {
        const mode = this.behaviour.bell || 'visual';
        if (mode === 'none') return;
        this.bell = true;
        if (mode === 'visual' || mode === 'both') {
            this.root.classList.add('bell');
            setTimeout(() => this.root.classList.remove('bell'), 180);
        }
        this.emit('bell', this, mode);
    }

    _activity(e) {
        if (this.exited) return;
        this.activity = true;
        this.emit('activity', this, e && e.detail);
    }

    _output(e) {
        this._activity(e);
    }

    _programTitle(t) {
        const title = typeof t === 'string' ? t : term.title(this.el);
        this.titleState.programTitle = title;
        this.titleState.programTitleAt = Date.now();
        this._refreshTitle();
    }

    _foreground() {
        this.titleState.foreground = term.foreground(this.el);
        this.titleState.foregroundAt = Date.now();
        this._refreshTitle();
        this.emit('foreground', this);
    }

    _refreshTitle() {
        const t = this.title;
        if (t !== this.lastTitle) {
            this.lastTitle = t;
            this.emit('title', this);
        }
    }

    _cwdChanged(detail) {
        let c = null;
        if (typeof detail === 'string') {
            c = /^[a-z][a-z0-9+.-]*:\/\//i.test(detail) ? term.uriToPath(detail, process.platform) : detail;
        } else if (detail && typeof detail === 'object') {
            c = detail.cwd || (detail.uri ? term.uriToPath(detail.uri, process.platform) : null);
        }
        if (!c) c = term.cwd(this.el);
        if (c && c !== this.lastCwd) {
            this.lastCwd = c;
            this.emit('cwd', this);
        }
    }

    _notification(d) {
        this.notified = true;
        this.emit('notification', this, {
            title: String(d.title || ''), body: String(d.body || d.message || ''),
            id: d.id || '', source: d.source || '', urgency: d.urgency,
        });
    }

    _progress(d) {
        const state = d.state || 'none';
        const value = Math.max(0, Math.min(100, Number(d.value) || 0));
        this.progress = state === 'none' ? null : { state, value };
        this.emit('progress', this);
    }

    _link(e) {
        const d = e.detail || {};
        this.lastLink = { uri: d.uri, kind: d.kind, text: d.text };
        this.emit('link', this, this.lastLink, e);
    }

    _exit(e) {
        this.exited = true;
        this.exitCode = e && e.detail ? e.detail.exitCode : this.el.exitCode;
        // A finished session stays on the server until closed.
        const sid = this.sessionId;
        if (sid) term.closeSession(sid, this.server);
        this.root.classList.add('exited');
        this.guard.dismissAll();
        const code = this.exitCode === null || this.exitCode === undefined ? '' : ' with code ' + this.exitCode;
        this._showBanner('Process exited' + code + '. Enter restarts, Ctrl+Shift+W closes.');
        this.emit('exit', this);
    }

    /// The element let go of its session without broterm asking (the
    /// server went away): the program may still run, but not here.
    _detached() {
        if (this._releasing || this.exited) return;
        this.exited = true;
        this.root.classList.add('exited');
        this.guard.dismissAll();
        this._showBanner('Detached from the session. Enter starts a new shell, Ctrl+Shift+W closes.');
        this.emit('exit', this);
    }

    _showBanner(text) {
        this.banner.textContent = text;
        this.root.classList.add('has-banner');
    }

    _keydown(e) {
        if (!this.exited) return;
        if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            this.root.classList.remove('has-banner');
            this.restart();
            this.focus();
        }
    }

    // ── commands (OSC 133) ──

    commands() { return term.commands(this.el); }

    /// The last finished command, or the one at `row`.
    command(row) {
        const list = this.commands();
        if (typeof row === 'number') {
            let best = null;
            for (const c of list) { if (c.prompt.row <= row) best = c; else break; }
            return best;
        }
        for (let i = list.length - 1; i >= 0; i--) if (list[i].finished) return list[i];
        return null;
    }

    /// Run a command line again (at the prompt, as if typed).
    run(commandLine) {
        if (!commandLine || this.exited) return false;
        try { this.el.scrollToBottom(); } catch (e) { /* older element */ }
        return this.el.write(commandLine + '\r');
    }

    /// Stop the process (if any) and take the pane out of the document.
    /// A persistent session is closed too: closing the pane is the user
    /// ending it (quitting broterm uses release() instead).
    dispose() {
        const sid = this.sessionId;
        if (sid) { if (!this.released) term.closeSession(sid, this.server); }
        else { try { if (this.running) this.el.kill(); } catch (e) { /* already gone */ } }
        this.guard.dismissAll();
        this.root.remove();
        this.emit('dispose', this);
    }

    /// Let go of a persistent session and leave its program running (what
    /// quitting does to it; bro also detaches when the page goes). False
    /// for a local process.
    release() {
        const sid = this.sessionId;
        if (!sid || this.exited || this.released) return false;
        this._releasing = true;
        try { this.el.detach(); } catch (e) { /* already detached */ }
        this._releasing = false;
        this.released = true;   // sessionId still names it; it is not ours to close
        return true;
    }

    /// What session restore needs to bring this pane back.
    snapshot() {
        const s = { profile: this.profile.name };
        const sid = this.sessionId;
        if (sid && !this.exited) {
            s.session = sid;
            if (this.server) s.server = this.server;
        }
        const cwd = this.cwd;
        if (cwd) s.cwd = cwd;
        else if (this.launch.spawn.cwd) s.cwd = this.launch.spawn.cwd;
        if (this.userTitle) s.title = this.userTitle;
        if (this.launch.commandline) s.commandline = this.launch.commandline;
        return s;
    }
}
