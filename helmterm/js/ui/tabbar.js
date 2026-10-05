// The tab strip: one button per tab (title, activity / bell marks, close),
// the new-tab button and the profiles dropdown. Tabs reorder by dragging and
// rename by double-clicking (or the renameTab command).

const DRAG_THRESHOLD = 6;

export class TabBar {
    constructor(app, root) {
        this.app = app;
        this.root = root;
        this.list = root.querySelector('#tabs');
        this.items = new Map();  // tab id -> element
        this.renaming = null;
        this.drag = null;
        root.querySelector('#new-tab').addEventListener('click', () => app.commands.run('newTab'));
        root.querySelector('#new-tab-menu').addEventListener('click', (e) => {
            e.stopPropagation();
            app.commands.run('newTabMenu', { anchor: e.currentTarget });
        });
    }

    /// Bring the strip in line with the workspace's tabs.
    render() {
        const tabs = this.app.workspace.tabs;
        const active = this.app.workspace.active;
        const live = new Set(tabs.map((t) => t.id));
        for (const [id, el] of this.items) if (!live.has(id)) { el.remove(); this.items.delete(id); }
        tabs.forEach((tab, i) => {
            let el = this.items.get(tab.id);
            if (!el) { el = this._create(tab); this.items.set(tab.id, el); }
            if (this.list.children[i] !== el) this.list.insertBefore(el, this.list.children[i] || null);
            this._update(el, tab, tab === active);
        });
    }

    updateTab(tab) {
        const el = this.items.get(tab.id);
        if (el) this._update(el, tab, tab === this.app.workspace.active);
    }

    _create(tab) {
        const el = document.createElement('div');
        el.className = 'tab';
        el.dataset.tabId = String(tab.id);
        el.setAttribute('role', 'tab');
        const mark = document.createElement('span');
        mark.className = 'tab-mark';
        const title = document.createElement('span');
        title.className = 'tab-title';
        const close = document.createElement('span');
        close.className = 'tab-close';
        close.textContent = '×';
        close.title = 'Close tab';
        el.appendChild(mark);
        el.appendChild(title);
        el.appendChild(close);

        close.addEventListener('mousedown', (e) => e.stopPropagation());
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            this.app.workspace.requestCloseTab(tab);
        });
        el.addEventListener('mousedown', (e) => this._pointerDown(e, tab, el));
        el.addEventListener('mouseup', (e) => {
            if (e.button === 1) this.app.workspace.requestCloseTab(tab);
        });
        el.addEventListener('dblclick', (e) => {
            if (e.target === close) return;
            this.beginRename(tab);
        });
        return el;
    }

    _update(el, tab, active) {
        el.classList.toggle('active', active);
        el.classList.toggle('activity', !active && tab.activity);
        el.classList.toggle('bell', !active && tab.bell);
        el.classList.toggle('exited', tab.panes().every((p) => p.exited));
        el.classList.toggle('split', tab.panes().length > 1);
        if (this.renaming && this.renaming.tab === tab) return;
        const title = el.querySelector('.tab-title');
        if (title.textContent !== tab.title) title.textContent = tab.title;
        el.title = tab.title;
    }

    // ── drag to reorder ──

    _pointerDown(e, tab, el) {
        if (e.button !== 0) return;
        if (this.renaming && this.renaming.tab === tab) return;
        this.app.workspace.activate(tab);
        const startX = e.clientX;
        this.drag = { tab, el, startX, moved: false };
        const move = (ev) => {
            const d = this.drag;
            if (!d) return;
            if (!d.moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return;
            d.moved = true;
            el.classList.add('dragging');
            this._dragTo(d, ev.clientX);
        };
        const up = () => {
            window.removeEventListener('mousemove', move, true);
            window.removeEventListener('mouseup', up, true);
            const d = this.drag;
            this.drag = null;
            el.classList.remove('dragging');
            if (d && d.moved) this.app.workspace.emitChange('reorder');
        };
        window.addEventListener('mousemove', move, true);
        window.addEventListener('mouseup', up, true);
    }

    _dragTo(d, x) {
        const tabs = this.app.workspace.tabs;
        const from = tabs.indexOf(d.tab);
        // The new index is how many other tabs' midpoints lie left of the pointer.
        let target = 0;
        for (let i = 0; i < tabs.length; i++) {
            if (tabs[i] === d.tab) continue;
            const r = this.items.get(tabs[i].id).getBoundingClientRect();
            if (x > r.left + r.width / 2) target++;
        }
        if (target !== from) this.app.workspace.moveTabTo(d.tab, target, { quiet: true });
    }

    // ── rename ──

    beginRename(tab) {
        const el = this.items.get(tab.id);
        if (!el) return;
        this.endRename(true);
        const title = el.querySelector('.tab-title');
        const input = document.createElement('input');
        input.className = 'tab-rename';
        input.value = tab.title;
        title.textContent = '';
        title.appendChild(input);
        this.renaming = { tab, input };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.endRename(true); }
            else if (e.key === 'Escape') { e.preventDefault(); this.endRename(false); }
            e.stopPropagation();
        });
        input.addEventListener('blur', () => this.endRename(true));
        input.focus();
        if (typeof input.select === 'function') input.select();
    }

    endRename(commit) {
        const r = this.renaming;
        if (!r) return;
        this.renaming = null;
        if (commit) this.app.workspace.renameTab(r.tab, r.input.value);
        const el = this.items.get(r.tab.id);
        if (el) {
            const title = el.querySelector('.tab-title');
            title.textContent = '';
            this._update(el, r.tab, r.tab === this.app.workspace.active);
        }
        const p = this.app.workspace.activePane();
        if (p) p.focus();
    }
}
