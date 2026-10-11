// Everything that floats over the terminals: modal dialogs (confirmations,
// the about box), dropdown menus and toasts. One overlay is open at a time;
// Escape closes it and the focus goes back to the pane that had it.
//
// No native dialogs: a terminal's confirmations are part of its own UI, and
// a native one would block a headless run.

import { displayKey } from '../core/keys.js';

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

export class Overlays {
    constructor(app, root) {
        this.app = app;
        this.root = root;
        this.current = null;  // { kind, el, close(result) }
        this.toasts = el('div', 'toasts');
        document.body.appendChild(this.toasts);
        window.addEventListener('mousedown', (e) => {
            const c = this.current;
            if (c && c.kind === 'menu' && !c.el.contains(e.target)) this.close();
        }, true);
        // Escape closes the open overlay wherever the focus happens to be.
        window.addEventListener('keydown', (e) => {
            const c = this.current;
            if (e.key === 'Escape' && c && !app.recordingKey &&
                (c.el.classList.contains('modal') || c.el.contains(document.activeElement))) {
                e.preventDefault();
                e.stopPropagation();
                c.close(undefined);
            }
        }, true);
    }

    isOpen(kind) { return !!this.current && (!kind || this.current.kind === kind); }

    /// Show `node` as an overlay of `kind`. `onClose(result)` runs once.
    open(kind, node, onClose, o) {
        this.close();
        const wrap = el('div', 'overlay overlay-' + kind + (o && o.modal === false ? '' : ' modal'));
        wrap.appendChild(node);
        this.root.appendChild(wrap);
        const entry = { kind, el: wrap, node, onClose, closed: false };
        entry.close = (result) => {
            if (entry.closed) return;
            entry.closed = true;
            wrap.remove();
            if (this.current === entry) this.current = null;
            if (onClose) onClose(result);
            if (!this.current) {
                const p = this.app.workspace.activePane();
                if (p) p.focus();
            }
        };
        this.current = entry;
        wrap.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); entry.close(undefined); }
        });
        if (o && o.modal !== false) {
            wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) entry.close(undefined); });
        }
        return entry;
    }

    close(result) {
        if (this.current) this.current.close(result);
    }

    // ── dialogs ──

    /// A yes/no question. Resolves true for the confirm button.
    confirm({ title, message, confirm, cancel }) {
        return new Promise((resolve) => {
            const box = el('div', 'dialog');
            box.appendChild(el('div', 'dialog-title', title || 'Are you sure?'));
            if (message) box.appendChild(el('div', 'dialog-message', message));
            const buttons = el('div', 'dialog-buttons');
            const no = el('button', 'btn', cancel || 'Cancel');
            const yes = el('button', 'btn primary danger', confirm || 'OK');
            no.id = 'dialog-cancel';
            yes.id = 'dialog-confirm';
            buttons.appendChild(no);
            buttons.appendChild(yes);
            box.appendChild(buttons);
            const entry = this.open('dialog', box, (r) => resolve(r === true));
            no.addEventListener('click', () => entry.close(false));
            yes.addEventListener('click', () => entry.close(true));
            box.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); entry.close(document.activeElement !== no); }
            });
            yes.focus();
        });
    }

    /// Answer the open confirmation (tests, and the keyboard).
    answer(yes) {
        if (this.current && this.current.kind === 'dialog') this.current.close(!!yes);
    }

    about() {
        const h = this.app.host;
        const box = el('div', 'dialog about');
        const logo = el('img', 'about-logo');
        logo.src = 'assets/icon.svg';
        box.appendChild(logo);
        box.appendChild(el('div', 'dialog-title', 'Terminal'));
        box.appendChild(el('div', 'dialog-message', 'A terminal on the bro engine.'));
        const facts = el('div', 'about-facts');
        const row = (k, v) => {
            const r = el('div', 'about-row');
            r.appendChild(el('span', 'about-key', k));
            r.appendChild(el('span', 'about-value', v));
            facts.appendChild(r);
        };
        row('Version', h.version);
        row('Platform', h.platform);
        row('Settings', this.app.settings.settingsPath);
        row('Terminal', h.terminalAvailable() ? 'bro <terminal> (bropty)' : 'not available in this build');
        box.appendChild(facts);
        box.appendChild(el('div', 'about-license', 'MIT License. Copyright (c) 2026 Jonny Brannum.'));
        const buttons = el('div', 'dialog-buttons');
        const ok = el('button', 'btn primary', 'Close');
        buttons.appendChild(ok);
        box.appendChild(buttons);
        const entry = this.open('about', box);
        ok.addEventListener('click', () => entry.close());
        ok.focus();
        return entry;
    }

    // ── menus ──

    /// A dropdown of `items`: { label, hint?, run(), separator? }, under
    /// `anchor` (an element) or at the top left.
    menu(items, anchor) {
        const box = el('div', 'menu');
        let index = -1;
        const rows = [];
        for (const item of items) {
            if (item.separator) { box.appendChild(el('div', 'menu-sep')); continue; }
            const r = el('div', 'menu-item');
            r.appendChild(el('span', 'menu-label', item.label));
            if (item.hint) r.appendChild(el('span', 'menu-hint', displayKey(item.hint)));
            r.addEventListener('click', () => { entry.close(); item.run(); });
            r.addEventListener('mousemove', () => select(rows.indexOf(r)));
            rows.push(r);
            box.appendChild(r);
        }
        const select = (i) => {
            if (index >= 0 && rows[index]) rows[index].classList.remove('selected');
            index = i;
            if (rows[index]) rows[index].classList.add('selected');
        };
        box.tabIndex = 0;
        const entry = this.open('menu', box, null, { modal: false });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); select((index + 1) % rows.length); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); select((index - 1 + rows.length) % rows.length); }
            else if (e.key === 'Enter' && index >= 0) { e.preventDefault(); rows[index].click(); }
        });
        if (anchor && anchor.getBoundingClientRect) {
            const r = anchor.getBoundingClientRect();
            box.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 300)) + 'px';
            box.style.top = (r.top + r.height + 2) + 'px';
        }
        select(0);
        box.focus();
        return entry;
    }

    // ── toasts ──

    toast(text, kind) {
        if (!text) return null;
        const t = el('div', 'toast' + (kind ? ' ' + kind : ''), text);
        this.toasts.appendChild(t);
        setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
        return t;
    }
}
