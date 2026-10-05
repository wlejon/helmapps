// broterm: the application. Wires the models (settings, profiles, schemes,
// keybindings, the command registry) to the views (tab strip, workspace,
// overlays) and owns the keyboard.

import { host } from './core/host.js';
import { CommandRegistry } from './core/commands.js';
import { SettingsStore } from './core/settings.js';
import { ProfileSet, detectProfiles } from './core/profiles.js';
import { buildSchemeSet, chromeVariables, BUILTIN_SCHEMES } from './core/schemes.js';
import { Keymap, pressFromEvent } from './core/keys.js';
import { parseArgs, asksForTab } from './core/cli.js';
import { Session } from './core/session.js';
import { Workspace } from './ui/workspace.js';
import { TabBar } from './ui/tabbar.js';
import { Overlays } from './ui/overlays.js';
import { Palette } from './ui/palette.js';
import { SettingsUI } from './ui/settings_ui.js';
import { FindBar } from './ui/findbar.js';
import { registerActions } from './actions.js';

export class App {
    constructor() {
        this.host = host;
        this.commands = new CommandRegistry();
        this.settings = new SettingsStore(host.configDir).load();
        this.profiles = new ProfileSet(detectProfiles()).apply(this.settings.values);
        this.schemes = buildSchemeSet(this.settings.values.schemes);
        this.keymap = new Keymap(this.settings.keybindings());
        this.recordingKey = null;
        this.quitRequested = false;
        this.chordPending = null;

        this.overlays = new Overlays(this, document.getElementById('overlay-root'));
        this.dialog = this.overlays;
        this.workspace = new Workspace(this, document.getElementById('workspace'));
        this.tabbar = new TabBar(this, document.getElementById('tabbar'));
        this.palette = new Palette(this);
        this.settingsUI = new SettingsUI(this);
        this.findbar = new FindBar(this);
        this.session = new Session(this);
        registerActions(this);

        this.settings.on('change', () => this.onSettingsChanged());
        this.settings.on('error', (errs) => this.toast(errs.join('\n'), 'error'));
        this.workspace.on('change', () => this.session.save());
        window.addEventListener('keydown', (e) => this.onKeyDown(e), true);
        this._poll = setInterval(() => this.workspace.poll(), 300);
        this.applyChrome();
        this.settings.watch();
    }

    /// Open the first window's tabs: the previous session (when enabled),
    /// and the tab the command line asks for.
    start(argv) {
        const opts = parseArgs(argv || []);
        for (const e of opts.errors) this.toast('broterm: ' + e, 'error');
        if (!host.terminalAvailable()) {
            this.toast('This build of bro has no <terminal> element (BRO_WITH_TERMINAL is off).', 'error');
        }
        let restored = 0;
        if (this.settings.values.restoreSession && !opts.noRestore) {
            restored = this.session.restore(this.session.read());
        }
        if (asksForTab(opts) || !restored) {
            let profile = opts.profile;
            if (profile && !this.profiles.get(profile)) {
                this.toast('No profile named "' + profile + '"; using ' + this.profiles.defaultProfile().name, 'error');
                profile = null;
            }
            const cwd = opts.cwd ? host.resolve(host.cwd(), opts.cwd) : null;
            this.workspace.openTab({ profile, cwd, commandline: opts.commandline, title: opts.title });
        }
        this.launch = opts;
        this.ready = true;
        return opts;
    }

    // ── settings ──

    onSettingsChanged() {
        const v = this.settings.values;
        this.schemes = buildSchemeSet(v.schemes);
        this.profiles.apply(v);
        this.keymap = new Keymap(this.settings.keybindings());
        const problems = [...this.schemes.problems, ...this.keymap.problems];
        if (problems.length) this.toast(problems.slice(0, 4).join('\n'), 'error');
        this.workspace.applySettings();
    }

    schemeFor(name) {
        return this.schemes.byName.get(name) || this.schemes.byName.get(this.settings.values.colorScheme) || BUILTIN_SCHEMES[0];
    }

    /// The chrome takes the default scheme's colours.
    applyChrome() {
        const vars = chromeVariables(this.schemeFor(this.settings.values.colorScheme));
        const root = document.documentElement;
        for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
        document.body.classList.toggle('light', vars['--accent-fg'] === '#FFFFFF');
    }

    // ── the keyboard ──

    /// The when-clause context.
    context() {
        const a = document.activeElement;
        const ov = this.overlays.current;
        const tab = this.workspace.active;
        return {
            terminalFocus: !!a && a.tagName === 'TERMINAL',
            textInputFocus: !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'),
            overlayOpen: !!ov,
            paletteOpen: !!ov && ov.kind === 'palette',
            settingsOpen: !!ov && ov.kind === 'settings',
            dialogOpen: !!ov && ov.kind === 'dialog',
            menuOpen: !!ov && ov.kind === 'menu',
            multiplePanes: !!tab && tab.panes().length > 1,
            paneZoomed: !!tab && !!tab.zoomed,
            platform: host.platform,
        };
    }

    onKeyDown(e) {
        if (this.recordingKey) {
            if (this.recordingKey(e)) { e.preventDefault(); e.stopPropagation(); }
            return;
        }
        const press = pressFromEvent(e);
        if (!press) return;
        const ctx = this.context();
        // In a text field, plain typing (and shift+typing) belongs to the field.
        const commandish = /(^|\+)(ctrl|alt|meta)\+/.test(press) || /^f\d+$/.test(press);
        if (ctx.textInputFocus && !this.keymap.pending && !commandish) return;
        // A modal dialog keeps the keyboard to itself.
        if (ctx.dialogOpen) return;
        const r = this.keymap.press(press, ctx);
        if (!r) { this._chord(null); return; }
        e.preventDefault();
        e.stopPropagation();
        if (r.action === 'pending') { this._chord(r.sequence); return; }
        this._chord(null);
        if (r.action === 'run') this.commands.run(r.binding.command, r.binding.args || {});
    }

    _chord(seq) {
        this.chordPending = seq;
        document.body.classList.toggle('chord', !!seq);
        if (seq) this.toast(seq + ' was pressed. Waiting for the second key of the chord...');
    }

    // ── overlays and menus ──

    overlayOpen() { return this.overlays.isOpen(); }

    toast(text, kind) {
        if (kind === 'error') console.error('broterm: ' + text);
        return this.overlays.toast(text, kind);
    }

    showNewTabMenu(anchor) {
        const items = this.profiles.visible().map((p, i) => ({
            label: p.name, hint: this.keymap.keyFor('newTab', { profileIndex: i }),
            run: () => this.commands.run('newTab', { profile: p.name }),
        }));
        items.push({ separator: true });
        items.push({ label: 'Split right', hint: this.keymap.keyFor('splitPane', { direction: 'right' }),
            run: () => this.commands.run('splitPane', { direction: 'right' }) });
        items.push({ label: 'Split down', hint: this.keymap.keyFor('splitPane', { direction: 'down' }),
            run: () => this.commands.run('splitPane', { direction: 'down' }) });
        items.push({ separator: true });
        items.push({ label: 'Settings', hint: this.keymap.keyFor('openSettings'), run: () => this.commands.run('openSettings') });
        items.push({ label: 'Command palette', hint: this.keymap.keyFor('commandPalette'), run: () => this.commands.run('commandPalette') });
        items.push({ label: 'About broterm', run: () => this.commands.run('about') });
        return this.overlays.menu(items, anchor || document.getElementById('new-tab-menu'));
    }

    find(query) { return this.findbar.show(query); }

    // ── files, window, quitting ──

    /// Open a file for editing: $VISUAL / $EDITOR in a new tab, else the
    /// platform's editor (Notepad on Windows, a terminal editor elsewhere).
    openInEditor(path) {
        const editor = host.env('VISUAL') || host.env('EDITOR');
        if (editor) return this.workspace.openTab({ commandline: [...editor.split(' ').filter(Boolean), path], title: host.basename(path) });
        if (host.platform === 'win32') {
            if (host.headless) return { editor: 'notepad.exe', path };
            try {
                require('child_process').spawn('notepad.exe', [path], { detached: true, stdio: 'ignore' });
            } catch (e) { this.toast('Cannot open Notepad: ' + e.message, 'error'); }
            return true;
        }
        const nano = host.which('nano');
        const cmd = nano || host.which('vi') || 'vi';
        return this.workspace.openTab({ commandline: [cmd, path], title: host.basename(path) });
    }

    toggleMaximize() {
        if (typeof bro === 'undefined' || !bro.window) return false;
        if (bro.window.state === 'maximized') bro.window.restore(); else bro.window.maximize();
        return true;
    }

    async requestQuit() {
        if (this.workspace.needsConfirm(this.workspace.allPanes())) {
            const ok = await this.overlays.confirm({ title: 'Quit broterm?', message: 'Processes are still running in some panes.', confirm: 'Quit' });
            if (!ok) return false;
        }
        this.session.save.flush();
        this.quit();
        return true;
    }

    lastTabClosed() {
        // Closing the last tab ends the session: what is restored next time
        // is a fresh tab, not the one just closed.
        this.session.save.flush();
        this.quit();
    }

    quit() {
        this.quitRequested = true;
        this.settings.close();
        if (!host.quit()) this.toast('Every tab is closed.');
    }
}
