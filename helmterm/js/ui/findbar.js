// The find bar: a query box over the focused pane, searching its history
// through the element's search API (adapter.find). Until the element has
// one, the bar says so instead of searching a copy of the text in script.

import * as term from '../term/adapter.js';

export class FindBar {
    constructor(app) {
        this.app = app;
        this.entry = null;
        this.last = '';
    }

    get open() { return !!this.entry && !this.entry.closed; }

    show(query) {
        const pane = this.app.workspace.activePane();
        if (!pane) return null;
        if (this.open) this.entry.close();
        const box = document.createElement('div');
        box.className = 'findbar';
        const input = document.createElement('input');
        input.className = 'input find-input';
        input.placeholder = 'Find';
        input.value = query || this.last;
        const status = document.createElement('span');
        status.className = 'find-status';
        box.appendChild(input);
        box.appendChild(status);
        this.entry = this.app.overlays.open('find', box, () => { this.entry = null; }, { modal: false });
        const search = (backwards) => {
            this.last = input.value;
            if (!input.value) { status.textContent = ''; return; }
            const r = term.find(pane.el, input.value, { backwards: !!backwards, caseSensitive: false });
            if (r === null) status.textContent = 'Search arrives with the next <terminal>';
            else if (r && typeof r === 'object' && 'count' in r) status.textContent = r.count ? (r.index + 1) + ' of ' + r.count : 'No matches';
            else status.textContent = r ? '' : 'No matches';
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); search(e.shiftKey); }
        });
        input.focus();
        if (query) search(false);
        return this.entry;
    }
}
