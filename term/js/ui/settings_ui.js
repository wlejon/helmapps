// The settings UI: an editor over settings.json and keybindings.json. Every
// change is written to the file at once; the file stays the source of truth
// (the watcher reloads it, and so does an edit made in a text editor while
// this is open).

import { el, row, select, text, number, checkbox, button, section } from './form.js';
import { renderProfiles } from './settings_profiles.js';
import { renderKeybindings } from './settings_keys.js';
import { renderTerminal } from './settings_terminal.js';
import { PALETTE_KEYS } from '../core/schemes.js';
import * as term from '../term/adapter.js';

const PAGES = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'profiles', label: 'Profiles' },
    { id: 'keys', label: 'Keybindings' },
    { id: 'files', label: 'Files' },
];

export class SettingsUI {
    constructor(app) {
        this.app = app;
        this.entry = null;
        this.page = 'general';
        this.profileName = null;
        app.settings.on('change', () => { if (this.open) this.refresh(); });
    }

    get open() { return !!this.entry && !this.entry.closed; }

    show(page) {
        if (page) this.page = page;
        if (this.open) { this.refresh(); return this.entry; }
        const box = el('div', 'settings');
        const nav = el('nav', 'settings-nav');
        const body = el('div', 'settings-body');
        const head = el('div', 'settings-head');
        head.appendChild(el('div', 'settings-title', 'Settings'));
        const close = button('×', () => this.close(), 'icon');
        close.id = 'settings-close';
        head.appendChild(close);
        box.appendChild(head);
        const main = el('div', 'settings-main');
        main.appendChild(nav);
        main.appendChild(body);
        box.appendChild(main);
        this.nav = nav;
        this.body = body;
        this.entry = this.app.overlays.open('settings', box, () => { this.entry = null; });
        this.refresh();
        return this.entry;
    }

    close() { if (this.open) this.entry.close(); }

    go(page) {
        this.page = page;
        this.refresh();
    }

    /// Rebuild the current page, unless the user is typing in it.
    refresh() {
        if (!this.open) return;
        const a = document.activeElement;
        if (a && this.body.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && a.type !== 'checkbox') {
            this._stale = true;
            return;
        }
        this._stale = false;
        while (this.nav.firstChild) this.nav.removeChild(this.nav.firstChild);
        for (const p of PAGES) {
            const b = el('div', 'settings-nav-item' + (p.id === this.page ? ' active' : ''), p.label);
            b.dataset.page = p.id;
            b.addEventListener('click', () => this.go(p.id));
            this.nav.appendChild(b);
        }
        while (this.body.firstChild) this.body.removeChild(this.body.firstChild);
        const errs = this.app.settings.errors;
        if (errs.length) {
            const warn = el('div', 'settings-error');
            warn.textContent = errs.join('\n');
            this.body.appendChild(warn);
        }
        const page = {
            general: () => this.general(),
            appearance: () => this.appearance(),
            terminal: () => renderTerminal(this),
            profiles: () => renderProfiles(this),
            keys: () => renderKeybindings(this),
            files: () => this.files(),
        }[this.page];
        this.body.appendChild(page ? page() : el('div'));
    }

    set(key, value) { this.app.settings.set(key, value); }

    general() {
        const v = this.app.settings.values;
        const s = section('General');
        const names = this.app.profiles.visible().map((p) => p.name);
        s.appendChild(row('Default profile',
            select([{ value: '', label: '(automatic: ' + this.app.profiles.defaultProfile().name + ')' }, ...names],
                v.defaultProfile || '', (x) => this.set('defaultProfile', x || undefined), 'set-defaultProfile'),
            'What a new tab runs.'));
        s.appendChild(row('When a process exits',
            select([{ value: 'graceful', label: 'Close the pane if it exited cleanly' },
                { value: 'always', label: 'Always close the pane' },
                { value: 'never', label: 'Keep the pane open' }], v.closeOnExit,
            (x) => this.set('closeOnExit', x), 'set-closeOnExit')));
        s.appendChild(row('Confirm closing',
            select([{ value: 'running', label: 'When something is running' },
                { value: 'always', label: 'Always, for a live process' },
                { value: 'never', label: 'Never' }], v.confirmClose,
            (x) => this.set('confirmClose', x), 'set-confirmClose'),
            'A shell waiting at its prompt does not count as running.'));
        s.appendChild(row('Restore tabs at start', checkbox(v.restoreSession, (x) => this.set('restoreSession', x), 'set-restoreSession'),
            'Reopen the previous session\'s tabs, panes and directories.'));
        if (term.caps.persistent) {
            s.appendChild(row('Keep shells running after quitting', checkbox(v.persistentSessions, (x) => this.set('persistentSessions', x), 'set-persistentSessions'),
                'New shells run in a bromux session that outlives Terminal; with tabs restored, they come back as you left them. Closing a tab still ends its shell.'));
        }
        s.appendChild(row('Mark tabs with new output', checkbox(v.tabActivity, (x) => this.set('tabActivity', x), 'set-tabActivity')));
        return s;
    }

    appearance() {
        const v = this.app.settings.values;
        const s = section('Appearance', 'Defaults for every profile; a profile can override each of them.');
        const schemes = this.app.schemes.list.map((x) => x.name);
        const activePane = this.app.workspace && this.app.workspace.activePane();
        const activePal = activePane ? activePane.palette : null;
        this.activePalette = activePal;
        const preview = el('div', 'scheme-preview');
        const paint = (name) => {
            while (preview.firstChild) preview.removeChild(preview.firstChild);
            const sc = this.app.schemes.byName.get(name);
            const isCurrent = !name || name === v.colorScheme;
            const pal = (isCurrent && activePal) ? activePal : null;
            preview.dataset.effective = pal ? 'true' : 'false';
            const bg = (pal && pal.background) || (sc && sc.background);
            const fg = (pal && pal.foreground) || (sc && sc.foreground);
            if (bg) preview.style.backgroundColor = bg;
            if (fg) preview.style.color = fg;
            for (let i = 0; i < PALETTE_KEYS.length; i++) {
                const k = PALETTE_KEYS[i];
                const sw = el('span', 'swatch');
                const col = (pal && pal.ansi && pal.ansi[i]) || (sc && sc[k]);
                if (col) {
                    sw.style.backgroundColor = col;
                    sw.dataset.color = col;
                }
                sw.title = k + (col ? ': ' + col : '');
                preview.appendChild(sw);
            }
        };
        paint(v.colorScheme);
        const sel = select(schemes, v.colorScheme, (x) => { paint(x); this.set('colorScheme', x); }, 'set-colorScheme');
        const wrap = el('div');
        wrap.appendChild(sel);
        wrap.appendChild(preview);
        s.appendChild(row('Color scheme', wrap, 'Add your own under "schemes" in settings.json (Windows Terminal\'s format).'));
        s.appendChild(row('Font family', text(v.font.family, (x) => this.set('font.family', x || undefined), { id: 'set-fontFamily' })));
        s.appendChild(row('Font size', number(v.font.size, (x) => this.set('font.size', x), { min: 6, max: 72, id: 'set-fontSize' })));
        s.appendChild(row('Cursor', select(['block', 'underline', 'bar'], v.cursorStyle, (x) => this.set('cursorStyle', x), 'set-cursorStyle')));
        s.appendChild(row('Blinking cursor', checkbox(v.cursorBlink, (x) => this.set('cursorBlink', x), 'set-cursorBlink')));
        s.appendChild(row('Padding', number(v.padding, (x) => this.set('padding', x), { min: 0, max: 64, id: 'set-padding' }), 'Pixels around the text.'));
        s.appendChild(row('Scrollback', number(v.scrollback, (x) => this.set('scrollback', x), { min: 0, step: 1000, id: 'set-scrollback' }),
            'Lines of history per pane.'));
        s.appendChild(row('Opacity', number(v.opacity, (x) => this.set('opacity', x), { min: 0.3, max: 1, step: 0.05, id: 'set-opacity' }),
            'Window opacity, once the engine can make a window translucent.'));
        return s;
    }

    files() {
        const st = this.app.settings;
        const s = section('Files', 'Terminal reads these files and watches them: saving one applies it.');
        const path = (p) => { const c = el('code', 'path', p); return c; };
        s.appendChild(row('Settings', path(st.settingsPath)));
        s.appendChild(row('Keybindings', path(st.keybindingsPath)));
        s.appendChild(row('Session', path(this.app.session.path)));
        const buttons = el('div', 'button-row');
        buttons.appendChild(button('Open settings.json', () => { this.close(); this.app.commands.run('openSettingsFile'); }));
        buttons.appendChild(button('Open keybindings.json', () => { this.close(); this.app.commands.run('openSettingsFile', { file: 'keybindings' }); }));
        buttons.appendChild(button('Reload', () => this.app.commands.run('reloadSettings')));
        s.appendChild(buttons);
        return s;
    }
}
