// How a pane gets the user's attention: the bell, a program's notification
// (OSC 9 / 777 / 99), its progress (OSC 9;4), and a long command finishing
// unseen. Each shows in the app (a toast, a mark or progress bar on the tab)
// and, where settings and the desktop allow, outside it (a desktop
// notification, the taskbar button flashing or showing progress).
//
// "Seen" means the pane's tab is the active one and the window has the
// keyboard. desktopNotifications: 'unfocused' sends desktop notifications
// only for what was not seen, 'always' for everything, 'never' for nothing.

import { host } from '../core/host.js';
import { formatDuration } from '../term/command_log.js';

const PROGRESS_CODES = { none: 0, normal: 1, error: 2, indeterminate: 3, paused: 4 };

export class Attention {
    constructor(app) {
        this.app = app;
        this.log = [];          // what was announced, newest last (tests read it)
        this._taskbar = '';
    }

    get ws() { return this.app.workspace; }
    get settings() { return this.app.settings.values; }

    seen(pane) {
        const tab = this.ws.tabOf(pane);
        return !!tab && tab === this.ws.active && host.windowFocused();
    }

    _desktop(pane, title, body) {
        const mode = this.settings.desktopNotifications || 'unfocused';
        if (mode === 'never') return false;
        if (mode === 'unfocused' && this.seen(pane)) return false;
        host.desktop('notify', title, body);
        if (!host.windowFocused()) host.desktop('attention', true);
        return true;
    }

    _mark(pane, kind) {
        const tab = this.ws.tabOf(pane);
        if (!tab || tab === this.ws.active) return;
        tab[kind] = true;
        this.app.tabbar.updateTab(tab);
    }

    bell(pane, mode) {
        if (mode === 'audible' || mode === 'both') host.desktop('beep');
        if (!host.windowFocused()) host.desktop('attention', true);
        this._mark(pane, 'bell');
        this.log.push({ kind: 'bell', pane: pane.id, mode });
    }

    notification(pane, n) {
        const tab = this.ws.tabOf(pane);
        const where = tab ? tab.title : pane.title;
        const title = n.title || where;
        const body = n.body || '';
        this.app.toast((n.title ? n.title + (body ? ': ' : '') : '') + body + (n.title ? '' : '  (' + where + ')'), 'notify');
        this._mark(pane, 'notified');
        const desktop = this._desktop(pane, title, body);
        this.log.push({ kind: 'notification', pane: pane.id, title, body, desktop });
    }

    /// A shell command finished (CommandLog 'finish'): tell the user if it
    /// ran longer than notifyOnLongCommand seconds and they were not looking.
    commandFinished(pane, info) {
        const limit = Number(this.settings.notifyOnLongCommand) || 0;
        if (!(limit > 0) || info.duration === null || info.duration < limit * 1000) return false;
        if (this.seen(pane)) return false;
        const cmd = (info.command && info.command.commandLine) || 'A command';
        const ok = info.exitCode === 0 || info.exitCode === null || info.exitCode === undefined;
        const how = ok ? 'finished' : 'failed (exit code ' + info.exitCode + ')';
        const body = cmd + ' ' + how + ' after ' + formatDuration(info.duration) + '.';
        const tab = this.ws.tabOf(pane);
        this.app.toast(body + (tab ? '  (' + tab.title + ')' : ''), ok ? 'notify' : 'error');
        this._mark(pane, 'notified');
        const desktop = this._desktop(pane, ok ? 'Command finished' : 'Command failed', body);
        this.log.push({ kind: 'command', pane: pane.id, commandLine: cmd, exitCode: info.exitCode,
            duration: info.duration, desktop });
        return true;
    }

    /// A pane's progress changed: its tab's bar, and the taskbar button
    /// (the active tab's progress, else any tab's).
    progress(pane) {
        const tab = this.ws.tabOf(pane);
        if (tab) this.app.tabbar.updateTab(tab);
        this.refreshTaskbar();
    }

    refreshTaskbar() {
        let p = null;
        if (this.ws.active) p = this.ws.active.progress;
        if (!p) for (const t of this.ws.tabs) { if (t.progress) { p = t.progress; break; } }
        const key = p ? p.state + ':' + p.value : 'none';
        if (key === this._taskbar) return;
        this._taskbar = key;
        host.desktop('progress', p ? PROGRESS_CODES[p.state] || 0 : 0, p ? p.value : 0);
    }
}
