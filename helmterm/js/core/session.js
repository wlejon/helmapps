// Session restore: the tabs, their split layouts, each pane's profile and
// working directory, written to session.json whenever they change and read
// back at the next start (settings.restoreSession).
//
// A pane's directory is the one its shell last reported (once the element
// reports OSC 7 working directories) or else the one it started in.

import { host } from './host.js';
import { debounce } from './emitter.js';
import { Tab } from '../ui/tab.js';

export class Session {
    constructor(app) {
        this.app = app;
        this.path = host.join(app.settings.dir, 'session.json');
        this.enabled = true;  // off while restoring, so a half-built session is not written
        this.save = debounce(() => this.write(), 400);
    }

    write() {
        if (!this.enabled) return false;
        const ws = this.app.workspace;
        const data = ws.snapshot();
        data.savedAt = new Date().toISOString();
        try {
            host.writeText(this.path, JSON.stringify(data, null, 2) + '\n');
            return true;
        } catch (e) {
            console.error('broterm: cannot write the session: ' + e.message);
            return false;
        }
    }

    read() {
        const text = host.readText(this.path);
        if (!text) return null;
        try {
            const data = JSON.parse(text);
            return data && Array.isArray(data.tabs) ? data : null;
        } catch (e) {
            console.error('broterm: session.json does not parse; starting fresh');
            return null;
        }
    }

    /// Rebuild the saved tabs. Returns how many were restored.
    restore(data) {
        const ws = this.app.workspace;
        if (!data || !Array.isArray(data.tabs)) return 0;
        this.enabled = false;
        let count = 0;
        try {
            for (const saved of data.tabs) {
                if (this.restoreTab(saved)) count++;
            }
            if (count) ws.activateIndex(Math.max(0, Math.min(count - 1, data.active | 0)));
        } finally {
            this.enabled = true;
        }
        return count;
    }

    restoreTab(saved) {
        const ws = this.app.workspace;
        const panes = [];
        const build = (node, depth) => {
            if (!node || depth > 32) return null;
            if (node.pane) {
                const s = node.pane;
                const cwd = typeof s.cwd === 'string' && host.isDir(s.cwd) ? s.cwd : null;
                const pane = ws.createPane(s.profile || null, {
                    cwd, title: s.title || null,
                    commandline: Array.isArray(s.commandline) ? s.commandline : null,
                });
                panes.push(pane);
                return { type: 'pane', pane };
            }
            if (node.split === 'row' || node.split === 'column') {
                const a = build(node.a, depth + 1);
                const b = build(node.b, depth + 1);
                if (!a || !b) return a || b;
                const ratio = typeof node.ratio === 'number' && node.ratio > 0.05 && node.ratio < 0.95 ? node.ratio : 0.5;
                return { type: 'split', dir: node.split, ratio, a, b };
            }
            return null;
        };
        const root = build(saved && saved.layout, 0);
        if (!root) return false;
        const tab = new Tab(panes[0]);
        tab.on('structure', () => ws.emitChange('structure'));
        tab.setTree(root, panes[saved.focused | 0] || panes[0]);
        if (saved.title) tab.userTitle = String(saved.title);
        ws.tabs.push(tab);
        ws.container.appendChild(tab.el);
        for (const p of panes) p.start();
        if (!ws.active) ws.activate(tab);
        this.app.tabbar.render();
        return true;
    }
}
