// A tab: a tree of panes. Leaves are panes; inner nodes are splits that lay
// their two children side by side ('row') or stacked ('column'), sharing the
// space by `ratio`. The tree is rendered as nested flex boxes, and the panes'
// own elements move between renders rather than being rebuilt, so a split
// never disturbs the processes already running.

import { Emitter } from '../core/emitter.js';

let nextTabId = 1;

const MIN_RATIO = 0.08;

function leaf(pane) { return { type: 'pane', pane }; }

export class Tab extends Emitter {
    constructor(pane) {
        super();
        this.id = nextTabId++;
        this.root = leaf(pane);
        this.focused = pane;
        this.zoomed = null;
        this.userTitle = null;
        this.activity = false;
        this.bell = false;
        this.el = document.createElement('div');
        this.el.className = 'tab-content';
        this.el.dataset.tabId = String(this.id);
        this.render();
    }

    // ── the tree ──

    panes() {
        const out = [];
        const walk = (n) => { if (n.type === 'pane') out.push(n.pane); else { walk(n.a); walk(n.b); } };
        walk(this.root);
        return out;
    }

    _find(pane, node = this.root, parent = null) {
        if (node.type === 'pane') return node.pane === pane ? { node, parent } : null;
        return this._find(pane, node.a, node) || this._find(pane, node.b, node);
    }

    _parentOf(target, node = this.root) {
        if (node.type !== 'split') return null;
        if (node.a === target || node.b === target) return node;
        return this._parentOf(target, node.a) || this._parentOf(target, node.b);
    }

    /// Put `pane` beside `target`: 'right' | 'left' | 'down' | 'up', or
    /// 'auto' (along the longer side of the target, like Windows Terminal).
    split(target, pane, direction, ratio) {
        const found = this._find(target || this.focused);
        if (!found) return false;
        let dir = direction || 'auto';
        if (dir === 'auto') {
            const r = found.node.pane.root.getBoundingClientRect();
            dir = r.width >= r.height ? 'right' : 'down';
        }
        const before = dir === 'left' || dir === 'up';
        const fresh = leaf(pane);
        const split = {
            type: 'split',
            dir: dir === 'left' || dir === 'right' ? 'row' : 'column',
            ratio: typeof ratio === 'number' ? ratio : 0.5,
            a: before ? fresh : found.node,
            b: before ? found.node : fresh,
        };
        this._replace(found.node, split);
        this.zoomed = null;
        this.focused = pane;
        this.render();
        this.emit('structure', this);
        return true;
    }

    _replace(oldNode, newNode) {
        const parent = this._parentOf(oldNode);
        if (!parent) this.root = newNode;
        else if (parent.a === oldNode) parent.a = newNode;
        else parent.b = newNode;
    }

    /// Take a pane out of the tree (its sibling takes the parent's place).
    /// True when the tab has no panes left.
    remove(pane) {
        const found = this._find(pane);
        if (!found) return this.panes().length === 0;
        if (found.node === this.root) {
            this.root = null;
            this.el.remove();
            return true;
        }
        const parent = this._parentOf(found.node);
        const sibling = parent.a === found.node ? parent.b : parent.a;
        this._replace(parent, sibling);
        if (this.zoomed === pane) this.zoomed = null;
        if (this.focused === pane) {
            // The nearest pane in the sibling's subtree inherits the focus.
            let n = sibling;
            while (n.type === 'split') n = n.a;
            this.focused = n.pane;
        }
        this.render();
        this.emit('structure', this);
        return false;
    }

    /// Replace the whole tree (session restore). `root` uses the same node
    /// shapes as the tree itself.
    setTree(root, focused) {
        this.root = root;
        this.focused = focused || this.panes()[0];
        this.zoomed = null;
        this.render();
    }

    // ── rendering ──

    render() {
        while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
        if (!this.root) return;
        this.el.appendChild(this._renderNode(this.root));
        this.el.classList.toggle('zoomed', !!this.zoomed);
        for (const p of this.panes()) {
            p.root.classList.toggle('zoomed', p === this.zoomed);
            p.root.classList.toggle('focused', p === this.focused);
        }
    }

    _renderNode(node) {
        if (node.type === 'pane') {
            node.pane.root.style.flex = '';
            return node.pane.root;
        }
        const box = document.createElement('div');
        box.className = 'split ' + node.dir;
        const a = this._renderNode(node.a);
        const b = this._renderNode(node.b);
        const divider = document.createElement('div');
        divider.className = 'divider ' + node.dir;
        divider.addEventListener('mousedown', (e) => this._startDrag(e, node, box));
        box.appendChild(a);
        box.appendChild(divider);
        box.appendChild(b);
        node.elA = a;
        node.elB = b;
        this._applyRatio(node);
        return box;
    }

    _applyRatio(node) {
        node.elA.style.flex = node.ratio + ' 1 0px';
        node.elB.style.flex = (1 - node.ratio) + ' 1 0px';
    }

    _startDrag(e, node, box) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        const rect = box.getBoundingClientRect();
        const horizontal = node.dir === 'row';
        document.body.classList.add(horizontal ? 'dragging-col' : 'dragging-row');
        const move = (ev) => {
            const pos = horizontal ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
            node.ratio = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, pos));
            this._applyRatio(node);
        };
        const up = () => {
            window.removeEventListener('mousemove', move, true);
            window.removeEventListener('mouseup', up, true);
            document.body.classList.remove('dragging-col', 'dragging-row');
            this.emit('structure', this);
        };
        window.addEventListener('mousemove', move, true);
        window.addEventListener('mouseup', up, true);
    }

    // ── focus, size, zoom ──

    setFocused(pane) {
        if (!this._find(pane)) return;
        this.focused = pane;
        for (const p of this.panes()) p.root.classList.toggle('focused', p === pane);
    }

    /// The pane next to the focused one in a direction, by geometry:
    /// 'left' | 'right' | 'up' | 'down', or 'next' / 'prev' in tree order.
    neighbor(direction) {
        const panes = this.panes();
        const cur = this.focused;
        if (!cur || panes.length < 2) return null;
        if (direction === 'next' || direction === 'prev') {
            const i = panes.indexOf(cur);
            const d = direction === 'next' ? 1 : -1;
            return panes[(i + d + panes.length) % panes.length];
        }
        const r = cur.root.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        let best = null, bestScore = Infinity;
        for (const p of panes) {
            if (p === cur) continue;
            const q = p.root.getBoundingClientRect();
            const qx = q.left + q.width / 2, qy = q.top + q.height / 2;
            let ok, along, across;
            if (direction === 'left') { ok = q.right <= r.left + 2; along = r.left - q.right; across = Math.abs(qy - cy); ok = ok && q.bottom > r.top && q.top < r.bottom; }
            else if (direction === 'right') { ok = q.left >= r.right - 2; along = q.left - r.right; across = Math.abs(qy - cy); ok = ok && q.bottom > r.top && q.top < r.bottom; }
            else if (direction === 'up') { ok = q.bottom <= r.top + 2; along = r.top - q.bottom; across = Math.abs(qx - cx); ok = ok && q.right > r.left && q.left < r.right; }
            else { ok = q.top >= r.bottom - 2; along = q.top - r.bottom; across = Math.abs(qx - cx); ok = ok && q.right > r.left && q.left < r.right; }
            if (!ok) continue;
            const score = along * 4 + across;
            if (score < bestScore) { bestScore = score; best = p; }
        }
        return best;
    }

    /// Move the nearest divider beside the focused pane by `amount` of its
    /// split, in `direction`. True when something moved.
    resize(direction, amount) {
        const want = direction === 'left' || direction === 'right' ? 'row' : 'column';
        const grow = direction === 'right' || direction === 'down' ? 1 : -1;
        let node = this._find(this.focused).node;
        let parent = this._parentOf(node);
        while (parent && parent.dir !== want) { node = parent; parent = this._parentOf(node); }
        if (!parent) return false;
        // Moving the divider right grows the left child.
        const step = (amount || 0.05) * grow;
        parent.ratio = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, parent.ratio + step));
        if (parent.elA) this._applyRatio(parent);
        this.emit('structure', this);
        return true;
    }

    toggleZoom(pane) {
        const p = pane || this.focused;
        this.zoomed = this.zoomed === p ? null : (this.panes().length > 1 ? p : null);
        this.render();
        return !!this.zoomed;
    }

    // ── what the strip shows ──

    get title() {
        return this.userTitle || (this.focused ? this.focused.title : 'Tab');
    }

    markSeen() {
        this.activity = false;
        this.bell = false;
        for (const p of this.panes()) p.markSeen();
    }

    /// Layout for session restore.
    snapshot() {
        const walk = (n) => n.type === 'pane'
            ? { pane: n.pane.snapshot() }
            : { split: n.dir, ratio: Math.round(n.ratio * 1000) / 1000, a: walk(n.a), b: walk(n.b) };
        const panes = this.panes();
        return { title: this.userTitle || undefined, focused: panes.indexOf(this.focused), layout: walk(this.root) };
    }

    /// The splits' structure only, for tests and the session: 'P' for a pane,
    /// 'row(a,b)' / 'column(a,b)' for a split.
    shape(node = this.root) {
        if (!node) return '';
        return node.type === 'pane' ? 'P' : node.dir + '(' + this.shape(node.a) + ',' + this.shape(node.b) + ')';
    }
}
