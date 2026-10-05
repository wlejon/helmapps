// A pane: one <terminal> running one profile's process, with the frame
// around it (padding, the exit banner, the bell flash).
//
// A <terminal> runs one process in its life, so restarting a pane replaces
// its element with a fresh one in the same place.

import { Emitter } from '../core/emitter.js';
import * as term from './adapter.js';

let nextId = 1;

export class Pane extends Emitter {
    /// `launch` is ProfileSet.resolve()'s answer; `scheme` the colour scheme.
    constructor(launch, scheme) {
        super();
        this.id = nextId++;
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
        this._stamp = '';

        this.root = document.createElement('div');
        this.root.className = 'pane';
        this.root.dataset.paneId = String(this.id);
        this.banner = document.createElement('div');
        this.banner.className = 'pane-banner';
        this.root.appendChild(this.banner);
        this._newElement();
    }

    get profile() { return this.launch.profile; }

    _newElement() {
        if (this.el) this.el.remove();
        const el = term.create();
        this.el = el;
        this.root.insertBefore(el, this.banner);
        term.watch(el, {
            title: () => this._titleMaybeChanged(),
            cwd: () => this._cwdMaybeChanged(),
            bell: () => this.ring(),
            output: () => this._output(),
            notification: (e) => this.emit('notification', e.detail || {}),
            prompt: (e) => this._prompt(e),
            exit: (e) => this._exit(e),
            focus: () => this.emit('focus', this),
            keydown: (e) => this._keydown(e),
        });
        this.applyAppearance(this.launch.appearance, this.scheme);
    }

    /// Start the process. False (and a banner saying why) when it could not.
    start() {
        this.exited = false;
        this.exitCode = null;
        this.startError = null;
        this.root.classList.remove('exited');
        this.banner.textContent = '';
        try {
            this.pid = this.el.spawn(this.launch.spawn);
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

    applyAppearance(appearance, scheme) {
        this.launch.appearance = appearance;
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
            term.applyPalette(el, this.scheme);
        }
        term.applyCursor(el, a.cursorStyle || 'block', a.cursorBlink !== false);
        term.applyScrollback(el, Number(a.scrollback) || 0);
    }

    adjustFont(delta) {
        this.fontDelta = delta === 0 ? 0 : this.fontDelta + delta;
        this.applyAppearance(this.launch.appearance, this.scheme);
    }

    // ── what the pane shows ──

    get running() {
        try { return !!this.el.running; } catch (e) { return false; }
    }

    /// The pane's title: the user's, else the program's, else the profile's.
    get title() {
        return this.userTitle || term.title(this.el) || this.profile.name;
    }

    get cwd() {
        return term.cwd(this.el) || this.lastCwd;
    }

    focus() { this.el.focus(); }

    hasFocus() { return document.activeElement === this.el; }

    /// Called by the application's poll (where the element has no event for
    /// it): titles, and output in panes nobody is looking at.
    poll(watchActivity) {
        if (!term.caps.titleEvent) this._titleMaybeChanged();
        if (!term.caps.cwdEvent) this._cwdMaybeChanged();
        if (watchActivity && !term.caps.outputEvent && !this.exited) {
            const stamp = term.screenStamp(this.el);
            if (this._stamp && stamp !== this._stamp) this._output();
            this._stamp = stamp;
        } else {
            this._stamp = '';
        }
    }

    markSeen() {
        this.activity = false;
        this.bell = false;
        this._stamp = '';
    }

    ring() {
        this.bell = true;
        this.root.classList.add('bell');
        setTimeout(() => this.root.classList.remove('bell'), 180);
        this.emit('bell', this);
    }

    // OSC 133 prompt marks: A prompt start, B command start (input), C command
    // executing, D command finished. Between C and D the shell is busy.
    _prompt(e) {
        const d = (e && e.detail) || {};
        const kind = String(d.kind || d.type || d.mark || '').toUpperCase();
        if (kind === 'C' || kind === 'EXECUTING' || kind === 'COMMAND-START') this.busy = true;
        else if (kind === 'A' || kind === 'D' || kind === 'PROMPT' || kind === 'COMMAND-END') this.busy = false;
    }

    _output() {
        this.activity = true;
        this.emit('activity', this);
    }

    _titleMaybeChanged() {
        const t = term.title(this.el);
        if (t !== this.lastTitle) {
            this.lastTitle = t;
            this.emit('title', this);
        }
    }

    _cwdMaybeChanged() {
        const c = term.cwd(this.el);
        if (c && c !== this.lastCwd) {
            this.lastCwd = c;
            this.emit('cwd', this);
        }
    }

    _exit(e) {
        this.exited = true;
        this.exitCode = e && e.detail ? e.detail.exitCode : this.el.exitCode;
        this.root.classList.add('exited');
        const code = this.exitCode === null || this.exitCode === undefined ? '' : ' with code ' + this.exitCode;
        this._showBanner('Process exited' + code + '. Enter restarts, Ctrl+Shift+W closes.');
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

    /// Stop the process (if any) and take the pane out of the document.
    dispose() {
        try { if (this.running) this.el.kill(); } catch (e) { /* already gone */ }
        this.root.remove();
        this.emit('dispose', this);
    }

    /// What session restore needs to bring this pane back.
    snapshot() {
        const s = { profile: this.profile.name };
        const cwd = this.cwd;
        if (cwd) s.cwd = cwd;
        else if (this.launch.spawn.cwd) s.cwd = this.launch.spawn.cwd;
        if (this.userTitle) s.title = this.userTitle;
        if (this.launch.commandline) s.commandline = this.launch.commandline;
        return s;
    }
}
