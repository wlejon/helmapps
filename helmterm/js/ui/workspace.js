// The workspace: the window's tabs and the panes in them. Opening, splitting,
// closing, focusing and ordering all happen here; the commands in actions.js
// are thin wrappers over these methods.

import { Emitter } from '../core/emitter.js';
import { host } from '../core/host.js';
import { Pane } from '../term/pane.js';
import { Tab } from './tab.js';

export class Workspace extends Emitter {
    constructor(app, container) {
        super();
        this.app = app;
        this.container = container;
        this.tabs = [];
        this.active = null;
    }

    activePane() { return this.active ? this.active.focused : null; }

    allPanes() { return this.tabs.flatMap((t) => t.panes()); }

    tabOf(pane) { return this.tabs.find((t) => t.panes().includes(pane)) || null; }

    emitChange(reason) { this.emit('change', reason); }

    // ── panes ──

    /// A pane for a profile (a name, a profile object, or null for the
    /// default), started. `o`: { cwd, commandline, title, env }.
    createPane(profileRef, o) {
        const profiles = this.app.profiles;
        let profile = typeof profileRef === 'string' ? profiles.get(profileRef) : profileRef;
        if (!profile) profile = profiles.defaultProfile();
        const opts = o || {};
        const launch = profiles.resolve(profile, opts);
        if (opts.commandline && opts.commandline.length) launch.commandline = opts.commandline.slice();
        const pane = new Pane(launch, this.app.schemeFor(launch.appearance.colorScheme), this.app);
        const att = this.app.attention;
        pane.on('focus', (p) => this._paneFocused(p));
        pane.on('title', (p) => this._paneTitle(p));
        pane.on('activity', (p) => this._paneActivity(p));
        pane.on('bell', (p, mode) => att.bell(p, mode));
        pane.on('notification', (p, n) => att.notification(p, n));
        pane.on('progress', (p) => att.progress(p));
        pane.on('commandfinish', (p, info) => att.commandFinished(p, info));
        pane.on('exit', (p) => this._paneExited(p));
        pane.on('cwd', () => this.emitChange('cwd'));
        pane.on('restart', () => this.emitChange('restart'));
        pane.on('searchchange', (p, d) => this.app.findbar.searchChanged(p, d));
        pane.on('link', (p, link) => { this.app.lastLink = link; });
        pane.on('clipboardprompt', (p) => this._paneActivity(p));
        return pane;
    }

    /// The directory a new tab or split starts in when none was asked for:
    /// with inheritCwd, the one the focused pane's shell last reported
    /// (shell integration's OSC 7), unless the new profile names its own.
    inheritedCwd(profileRef, from) {
        if (!this.app.settings.values.inheritCwd) return null;
        const src = from || this.activePane();
        if (!src || !src.reportedCwd) return null;
        const profiles = this.app.profiles;
        const p = typeof profileRef === 'string' ? profiles.get(profileRef)
            : profileRef || profiles.defaultProfile();
        if (p && profiles.fixedCwd(p)) return null;
        return host.isDir(src.reportedCwd) ? src.reportedCwd : null;
    }

    _paneFocused(pane) {
        const tab = this.tabOf(pane);
        if (!tab) return;
        tab.setFocused(pane);
        if (tab !== this.active) this.activate(tab, { focus: false });
        pane.markSeen();
        this._refreshTitle();
    }

    _paneTitle(pane) {
        const tab = this.tabOf(pane);
        if (tab) this.app.tabbar.updateTab(tab);
        if (pane === this.activePane()) this._refreshTitle();
    }

    _paneActivity(pane) {
        const tab = this.tabOf(pane);
        if (!tab) return;
        if (tab === this.active || !this.app.settings.values.tabActivity) { pane.activity = false; return; }
        if (tab.activity) return;
        tab.activity = true;
        this.app.tabbar.updateTab(tab);
    }

    _paneExited(pane) {
        const tab = this.tabOf(pane);
        if (tab) this.app.tabbar.updateTab(tab);
        const mode = this.app.settings.values.closeOnExit;
        const clean = pane.exitCode === 0;
        if (mode === 'always' || (mode === 'graceful' && clean)) this.closePane(pane);
    }

    _refreshTitle() {
        const t = this.active ? this.active.title : 'helmterm';
        document.title = t;
        host.setWindowTitle(t);
    }

    // ── tabs ──

    /// Open a tab. `o`: { profile (name), profileIndex, cwd, commandline,
    /// title, index, activate (default true) }. Returns the tab.
    openTab(o) {
        const opts = { ...(o || {}) };
        let profile = opts.profile || null;
        if (typeof opts.profileIndex === 'number') {
            const p = this.app.profiles.visible()[opts.profileIndex];
            if (!p) return null;
            profile = p;
        }
        if (!opts.cwd && opts.inherit !== false && !(opts.commandline && opts.commandline.length)) {
            opts.cwd = this.inheritedCwd(profile);
        }
        const pane = this.createPane(profile, opts);
        const tab = new Tab(pane);
        if (opts.title) tab.userTitle = opts.title;
        tab.on('structure', () => this.emitChange('structure'));
        const index = typeof opts.index === 'number' ? Math.max(0, Math.min(this.tabs.length, opts.index)) : this.tabs.length;
        this.tabs.splice(index, 0, tab);
        this.container.appendChild(tab.el);
        pane.start();
        if (opts.activate !== false || !this.active) this.activate(tab);
        this.app.tabbar.render();
        this.emitChange('open');
        return tab;
    }

    activate(tab, o) {
        if (!tab) return;
        const prev = this.active;
        this.active = tab;
        for (const t of this.tabs) t.el.classList.toggle('active', t === tab);
        tab.markSeen();
        if (prev && prev !== tab) this.app.tabbar.updateTab(prev);
        this.app.tabbar.render();
        this._refreshTitle();
        this.app.attention.refreshTaskbar();
        if (!o || o.focus !== false) {
            const p = tab.focused;
            if (p && !this.app.overlayOpen()) p.focus();
        }
        if (prev !== tab) this.emitChange('activate');
    }

    activateIndex(i) {
        if (!this.tabs.length) return;
        const idx = i < 0 ? this.tabs.length - 1 : Math.min(i, this.tabs.length - 1);
        this.activate(this.tabs[idx]);
    }

    cycle(delta) {
        if (this.tabs.length < 2) return;
        const i = this.tabs.indexOf(this.active);
        this.activate(this.tabs[(i + delta + this.tabs.length) % this.tabs.length]);
    }

    moveTabTo(tab, index, o) {
        const from = this.tabs.indexOf(tab);
        if (from < 0) return;
        const to = Math.max(0, Math.min(this.tabs.length - 1, index));
        if (to === from) return;
        this.tabs.splice(from, 1);
        this.tabs.splice(to, 0, tab);
        this.app.tabbar.render();
        if (!o || !o.quiet) this.emitChange('reorder');
    }

    moveTab(tab, delta) {
        this.moveTabTo(tab, this.tabs.indexOf(tab) + delta);
    }

    renameTab(tab, title) {
        const t = String(title || '').trim();
        tab.userTitle = t || null;
        this.app.tabbar.updateTab(tab);
        if (tab === this.active) this._refreshTitle();
        this.emitChange('rename');
    }

    // ── splitting ──

    /// Split the focused pane. `o`: { direction, profile, cwd, commandline,
    /// duplicate (same profile and directory as the focused pane) }.
    splitPane(o) {
        const opts = o || {};
        const tab = this.active;
        if (!tab) return null;
        const from = tab.focused;
        let profile = opts.profile || null;
        let cwd = opts.cwd || null;
        if (opts.duplicate !== false && !profile && from) {
            profile = from.profile;
            if (!cwd) cwd = this.inheritedCwd(profile, from) || from.launch.spawn.cwd || null;
        }
        if (!cwd && from) cwd = this.inheritedCwd(profile, from);
        const pane = this.createPane(profile, { ...opts, cwd });
        tab.split(from, pane, opts.direction || 'auto', opts.ratio);
        pane.start();
        pane.focus();
        this.app.tabbar.updateTab(tab);
        return pane;
    }

    focusPane(pane) {
        const tab = this.tabOf(pane);
        if (!tab) return;
        if (tab !== this.active) this.activate(tab, { focus: false });
        tab.setFocused(pane);
        pane.focus();
        this._refreshTitle();
    }

    moveFocus(direction) {
        const tab = this.active;
        if (!tab) return false;
        if (tab.zoomed) return false;
        const n = tab.neighbor(direction);
        if (!n) return false;
        this.focusPane(n);
        return true;
    }

    // ── closing ──

    /// Whether closing these panes should ask first.
    needsConfirm(panes) {
        const mode = this.app.settings.values.confirmClose;
        if (mode === 'never') return false;
        const live = panes.filter((p) => !p.exited && p.running);
        if (!live.length) return false;
        if (mode === 'always') return true;
        // 'running': a shell sitting at its prompt is not "running" anything;
        // a shell busy with a command (prompt marks say so) or a profile that
        // runs a program directly is.
        return live.some((p) => p.busy === true || !p.profile.isShell || !!p.launch.commandline);
    }

    async requestClosePane(pane) {
        const p = pane || this.activePane();
        if (!p) return false;
        if (this.needsConfirm([p])) {
            const ok = await this.app.dialog.confirm({
                title: 'Close pane?',
                message: '"' + p.title + '" is still running. Closing the pane ends it.',
                confirm: 'Close',
            });
            if (!ok) return false;
        }
        this.closePane(p);
        return true;
    }

    async requestCloseTab(tab) {
        const t = tab || this.active;
        if (!t) return false;
        const panes = t.panes();
        if (this.needsConfirm(panes)) {
            const n = panes.filter((p) => p.running && !p.exited).length;
            const ok = await this.app.dialog.confirm({
                title: 'Close tab?',
                message: (n > 1 ? n + ' processes are' : '"' + t.title + '" is') + ' still running. Closing the tab ends ' + (n > 1 ? 'them.' : 'it.'),
                confirm: 'Close tab',
            });
            if (!ok) return false;
        }
        this.closeTab(t);
        return true;
    }

    closePane(pane) {
        const tab = this.tabOf(pane);
        if (!tab) return;
        const wasFocused = tab.focused === pane;
        pane.dispose();
        const empty = tab.remove(pane);
        if (empty) { this._dropTab(tab); return; }
        this.app.tabbar.updateTab(tab);
        if (wasFocused && tab === this.active && tab.focused) tab.focused.focus();
        this._refreshTitle();
    }

    closeTab(tab) {
        for (const p of tab.panes()) p.dispose();
        tab.root = null;
        tab.el.remove();
        this._dropTab(tab);
    }

    _dropTab(tab) {
        const i = this.tabs.indexOf(tab);
        if (i < 0) return;
        this.tabs.splice(i, 1);
        tab.el.remove();
        if (this.active === tab) {
            this.active = null;
            const next = this.tabs[Math.min(i, this.tabs.length - 1)];
            if (next) this.activate(next);
        }
        this.app.tabbar.render();
        this.emitChange('close');
        if (!this.tabs.length) this.app.lastTabClosed();
    }

    // ── settings and the periodic poll ──

    /// Settings changed: every pane takes its profile's new appearance.
    applySettings() {
        for (const pane of this.allPanes()) {
            const fresh = this.app.profiles.get(pane.profile.name) || pane.profile;
            const r = this.app.profiles.resolve(fresh, {});
            pane.launch.profile = fresh;
            pane.applyAppearance(r.appearance, this.app.schemeFor(r.appearance.colorScheme), r.behaviour);
        }
        this.app.applyChrome();
        this.app.tabbar.render();
    }



    snapshot() {
        return {
            version: 1,
            active: this.tabs.indexOf(this.active),
            tabs: this.tabs.map((t) => t.snapshot()),
        };
    }
}
