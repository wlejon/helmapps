// The command palette: one fuzzy search over every command, every profile
// (new tab / split with it), every open tab and every colour scheme.

import { fuzzyFilter } from '../core/fuzzy.js';
import { displayKey } from '../core/keys.js';

const MAX_ROWS = 60;

export class Palette {
    constructor(app) {
        this.app = app;
        this.entry = null;
        this.results = [];
        this.index = 0;
    }

    get open() { return !!this.entry && !this.entry.closed; }

    /// Everything the palette can run, as { label, detail?, key?, run }.
    items() {
        const app = this.app;
        const out = [];
        for (const c of app.commands.list()) {
            if (c.palette === false || !app.commands.enabled(c.id)) continue;
            out.push({ id: c.id, label: (c.category ? c.category + ': ' : '') + c.title,
                key: app.keymap.keyFor(c.id), run: () => app.commands.run(c.id) });
        }
        app.profiles.visible().forEach((p, i) => {
            out.push({ id: 'newTab:' + p.name, label: 'New tab: ' + p.name,
                key: app.keymap.keyFor('newTab', { profileIndex: i }),
                run: () => app.commands.run('newTab', { profile: p.name }) });
            out.push({ id: 'splitRight:' + p.name, label: 'Split right: ' + p.name,
                run: () => app.commands.run('splitPane', { direction: 'right', profile: p.name }) });
            out.push({ id: 'splitDown:' + p.name, label: 'Split down: ' + p.name,
                run: () => app.commands.run('splitPane', { direction: 'down', profile: p.name }) });
        });
        app.workspace.tabs.forEach((t, i) => {
            out.push({ id: 'tab:' + t.id, label: 'Switch to tab: ' + t.title, detail: String(i + 1),
                run: () => app.workspace.activate(t) });
        });
        for (const s of app.schemes.list) {
            out.push({ id: 'scheme:' + s.name, label: 'Color scheme: ' + s.name,
                run: () => app.commands.run('setColorScheme', { name: s.name }) });
        }
        return out;
    }

    show(initial) {
        if (this.open) { this.entry.close(); return; }
        const box = document.createElement('div');
        box.className = 'palette';
        const input = document.createElement('input');
        input.className = 'palette-input';
        input.placeholder = 'Type a command, profile, tab or scheme';
        const list = document.createElement('div');
        list.className = 'palette-list';
        box.appendChild(input);
        box.appendChild(list);
        this.input = input;
        this.list = list;
        this.all = this.items();
        this.entry = this.app.overlays.open('palette', box, () => { this.entry = null; });
        input.addEventListener('input', () => this.filter(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); this.select(this.index + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); this.select(this.index - 1); }
            else if (e.key === 'PageDown') { e.preventDefault(); this.select(this.index + 10); }
            else if (e.key === 'PageUp') { e.preventDefault(); this.select(this.index - 10); }
            else if (e.key === 'Enter') { e.preventDefault(); this.runSelected(); }
        });
        input.value = initial || '';
        this.filter(input.value);
        input.focus();
        return this.entry;
    }

    close() { if (this.open) this.entry.close(); }

    filter(query) {
        this.query = query;
        this.results = fuzzyFilter(query, this.all, (it) => it.label).slice(0, MAX_ROWS);
        this.render();
        this.select(0);
    }

    render() {
        const list = this.list;
        while (list.firstChild) list.removeChild(list.firstChild);
        if (!this.results.length) {
            const empty = document.createElement('div');
            empty.className = 'palette-empty';
            empty.textContent = 'Nothing matches.';
            list.appendChild(empty);
            return;
        }
        this.results.forEach((r, i) => {
            const row = document.createElement('div');
            row.className = 'palette-row';
            const label = document.createElement('span');
            label.className = 'palette-label';
            const marks = new Set(r.positions);
            let run = '';
            let marked = false;
            const flush = () => {
                if (!run) return;
                const s = document.createElement('span');
                if (marked) s.className = 'match';
                s.textContent = run;
                label.appendChild(s);
                run = '';
            };
            for (let k = 0; k < r.item.label.length; k++) {
                const m = marks.has(k);
                if (m !== marked) { flush(); marked = m; }
                run += r.item.label[k];
            }
            flush();
            row.appendChild(label);
            if (r.item.key) {
                const k = document.createElement('span');
                k.className = 'palette-key';
                k.textContent = displayKey(r.item.key);
                row.appendChild(k);
            }
            row.addEventListener('mousemove', () => { if (this.index !== i) this.select(i); });
            row.addEventListener('click', () => { this.select(i); this.runSelected(); });
            list.appendChild(row);
        });
    }

    select(i) {
        if (!this.results.length) { this.index = 0; return; }
        const n = this.results.length;
        this.index = Math.max(0, Math.min(n - 1, i));
        const rows = this.list.querySelectorAll('.palette-row');
        rows.forEach((r, k) => r.classList.toggle('selected', k === this.index));
        const row = rows[this.index];
        if (row && typeof row.scrollIntoView === 'function') {
            try { row.scrollIntoView({ block: 'nearest' }); } catch (e) { /* layout without scrolling */ }
        }
    }

    /// The labels currently listed (for tests).
    labels() { return this.results.map((r) => r.item.label); }

    runSelected() {
        const r = this.results[this.index];
        if (!r) return false;
        this.close();
        r.item.run();
        return true;
    }
}
