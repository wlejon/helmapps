// The find bar: a search over the focused pane's whole buffer (history and
// screen) through the element's search API. Typing searches as you go; the
// element highlights every match and the current one more strongly, and
// reports its count as it searches history in the background
// (searchchange). Enter / F3 go to the next match, Shift+Enter / Shift+F3
// the previous; the toggles are match case, whole word and regular
// expression. Escape closes the bar and clears the highlights.

import * as term from '../term/adapter.js';

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

const TOGGLES = [
    { key: 'caseSensitive', label: 'Aa', title: 'Match case' },
    { key: 'wholeWord', label: 'ab', title: 'Whole word' },
    { key: 'regex', label: '.*', title: 'Regular expression' },
];

export class FindBar {
    constructor(app) {
        this.app = app;
        this.entry = null;
        this.pane = null;
        this.last = '';
        this.opts = { caseSensitive: false, wholeWord: false, regex: false };
        this.error = null;
    }

    get open() { return !!this.entry && !this.entry.closed; }

    show(query) {
        const pane = this.app.workspace.activePane();
        if (!pane) return null;
        if (this.open) {
            if (this.pane === pane) {
                if (typeof query === 'string') { this.input.value = query; this.search(); }
                this.input.focus();
                return this.entry;
            }
            this.entry.close();
        }
        this.pane = pane;
        const box = el('div', 'findbar');
        const input = el('input', 'input find-input');
        input.placeholder = 'Find';
        input.value = typeof query === 'string' ? query : this.last;
        box.appendChild(input);
        this.toggles = {};
        for (const t of TOGGLES) {
            const b = el('button', 'find-toggle' + (this.opts[t.key] ? ' on' : ''), t.label);
            b.title = t.title;
            b.dataset.option = t.key;
            b.addEventListener('mousedown', (e) => e.preventDefault());
            b.addEventListener('click', () => this.toggle(t.key));
            this.toggles[t.key] = b;
            box.appendChild(b);
        }
        const status = el('span', 'find-status');
        box.appendChild(status);
        const prev = el('button', 'find-nav find-prev', '↑');
        prev.title = 'Previous match (Shift+Enter)';
        const next = el('button', 'find-nav find-next', '↓');
        next.title = 'Next match (Enter)';
        const close = el('button', 'find-nav find-close', '×');
        close.title = 'Close (Escape)';
        for (const b of [prev, next, close]) b.addEventListener('mousedown', (e) => e.preventDefault());
        prev.addEventListener('click', () => this.previous());
        next.addEventListener('click', () => this.next());
        close.addEventListener('click', () => this.close());
        box.appendChild(prev);
        box.appendChild(next);
        box.appendChild(close);
        this.input = input;
        this.status = status;
        this.box = box;
        this.entry = this.app.overlays.open('find', box, () => this._closed(pane), { modal: false });
        input.addEventListener('input', () => this.search());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) this.previous(); else this.next();
            }
        });
        input.focus();
        if (typeof input.select === 'function') try { input.select(); } catch (e) { /* no selection API */ }
        if (input.value) this.search();
        else this._status();
        return this.entry;
    }

    close() { if (this.open) this.entry.close(); }

    _closed(pane) {
        this.entry = null;
        try { if (term.caps.search) pane.el.clearSearch(); } catch (e) { /* the pane went away */ }
        this.pane = null;
    }

    toggle(key) {
        this.opts[key] = !this.opts[key];
        if (this.toggles && this.toggles[key]) this.toggles[key].classList.toggle('on', this.opts[key]);
        this.search();
        if (this.input) this.input.focus();
    }

    /// The element's search options for the toggles.
    searchOptions() {
        return {
            regex: !!this.opts.regex,
            caseMode: this.opts.caseSensitive ? 'sensitive' : 'smart',
            wholeWord: !!this.opts.wholeWord,
        };
    }

    search() {
        const pane = this.pane;
        if (!pane) return false;
        const q = this.input ? this.input.value : '';
        this.last = q;
        this.error = null;
        if (!term.caps.search) { this._status('This build of <terminal> cannot search.'); return false; }
        try {
            if (!q) pane.el.clearSearch();
            else pane.el.search(q, this.searchOptions());
        } catch (e) {
            this.error = e && e.name === 'SyntaxError' ? 'Invalid pattern' : (e && e.message) || String(e);
            try { pane.el.clearSearch(); } catch (_) { /* nothing to clear */ }
        }
        this._status();
        return !this.error;
    }

    next() { return this._step(1); }
    previous() { return this._step(-1); }

    _step(dir) {
        const pane = this.pane || this.app.workspace.activePane();
        if (!pane || !term.caps.search) return null;
        if (!this.open) { this.show(this.last); }
        let st = null;
        try { st = pane.el.searchStatus; } catch (e) { st = null; }
        if (!st || !st.active) { if (!this.search()) return null; }
        let r = null;
        try { r = dir > 0 ? pane.el.searchNext() : pane.el.searchPrevious(); } catch (e) { r = null; }
        this._status();
        return r;
    }

    /// The pane's searchchange: keep the count current as history is searched.
    searchChanged(pane, detail) {
        if (pane === this.pane && this.open) this._status();
    }

    _status(message) {
        if (!this.status) return;
        const box = this.box;
        let text = message || '';
        let state = 'idle';
        if (!text && this.error) { text = this.error; state = 'error'; }
        if (!text && this.pane && this.input && this.input.value && term.caps.search) {
            let st = null;
            try { st = this.pane.el.searchStatus; } catch (e) { st = null; }
            if (st && st.active) {
                if (st.count) {
                    text = (st.current === null || st.current === undefined ? '' : (st.current + 1) + ' / ') + st.count +
                        (st.current === null || st.current === undefined ? (st.count === 1 ? ' match' : ' matches') : '');
                    if (!st.complete) text += '+';
                    state = 'found';
                } else {
                    text = st.complete ? 'No matches' : 'Searching…';
                    state = st.complete ? 'none' : 'searching';
                }
            }
        }
        this.status.textContent = text;
        if (box) box.dataset.state = state;
    }
}
