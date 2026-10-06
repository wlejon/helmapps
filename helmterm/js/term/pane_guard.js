// A pane's gatekeeping between programs and the user's clipboard.
//
// Clipboard reads (OSC 52 "?"): the profile's clipboardRead decides.
//   'allow'  bro answers from the clipboard itself
//   'deny'   the element never raises the request (options.clipboard)
//   'ask'    a bar along the bottom of the pane asks; the program waits and
//            the terminal keeps the keyboard. Allow answers this request,
//            Always allow also saves clipboardRead: 'allow' on the profile,
//            Deny refuses it (the program gets no reply).
// Clipboard writes (OSC 52 set): allowed unless clipboardWrite is false.
//
// Pastes (Ctrl+Shift+V, Shift+Insert, a middle click, the paste command):
//   trimPasteTrailingNewline drops the newlines a paste ends with, so a
//   copied line does not run itself; warnOnMultiLinePaste asks before text
//   with line breaks goes in:
//     'prompt'  only when the shell sits at its prompt (OSC 133 says so; with
//               no shell integration, a shell profile not on the alternate
//               screen), where each line would run as a command. A program
//               that reads the paste as text (an editor, a REPL that set
//               bracketed paste) is not asked about.
//     'always'  whenever the text has a line break
//     'never'

import { host } from '../core/host.js';
import * as term from './adapter.js';

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

export class PaneGuard {
    constructor(pane) {
        this.pane = pane;
        this.pending = [];   // clipboard-read requests waiting on the user
        this.log = [];       // { kind, id?, decision } for the tests and the curious
        this.bar = el('div', 'pane-prompts');
        pane.root.appendChild(this.bar);
    }

    get app() { return this.pane.app; }

    // ── clipboard reads ──

    clipboardRead(e) {
        const d = e.detail || {};
        const policy = this.pane.behaviour.clipboardRead || 'ask';
        if (policy === 'allow') { this.log.push({ kind: 'read', id: d.id, decision: 'allow' }); return; }
        e.preventDefault();
        if (policy === 'deny') {
            this.pane.el.denyClipboard(d.id);
            this.log.push({ kind: 'read', id: d.id, decision: 'deny' });
            return;
        }
        this._ask(d.id);
    }

    _ask(id) {
        const pane = this.pane;
        const row = el('div', 'pane-prompt');
        row.dataset.requestId = String(id);
        const name = pane.title;
        row.appendChild(el('span', 'pane-prompt-text', '"' + name + '" wants to read the clipboard.'));
        const buttons = el('span', 'pane-prompt-buttons');
        const mk = (label, cls, decision) => {
            const b = el('button', 'btn small ' + cls, label);
            b.dataset.decision = decision;
            b.addEventListener('mousedown', (ev) => ev.stopPropagation());
            b.addEventListener('click', (ev) => { ev.stopPropagation(); this.answer(id, decision); });
            buttons.appendChild(b);
            return b;
        };
        mk('Allow', 'primary', 'allow');
        mk('Always allow', '', 'always');
        mk('Deny', 'danger', 'deny');
        row.appendChild(buttons);
        this.bar.appendChild(row);
        this.pending.push({ id, row });
        pane.root.classList.add('has-prompt');
        pane.emit('clipboardprompt', pane, id);
    }

    /// Answer a waiting request: 'allow' | 'always' | 'deny'. With no id,
    /// the oldest one.
    answer(id, decision) {
        const i = id === undefined || id === null ? 0 : this.pending.findIndex((p) => p.id === id);
        const req = this.pending[i];
        if (!req) return false;
        this.pending.splice(i, 1);
        req.row.remove();
        if (!this.pending.length) this.pane.root.classList.remove('has-prompt');
        this.log.push({ kind: 'read', id: req.id, decision });
        const el = this.pane.el;
        if (decision === 'deny') {
            el.denyClipboard(req.id);
        } else {
            if (decision === 'always' && this.app) this.app.setProfileSetting(this.pane.profile.name, 'clipboardRead', 'allow');
            host.clipboard.read().then((text) => { el.answerClipboard(req.id, text); });
        }
        if (this.app && this.app.workspace.activePane() === this.pane) this.pane.focus();
        return true;
    }

    dismissAll() {
        for (const p of this.pending.slice()) this.answer(p.id, 'deny');
    }

    // ── clipboard writes ──

    clipboardWrite(e) {
        const d = e.detail || {};
        if (this.pane.behaviour.clipboardWrite === false) {
            e.preventDefault();
            this.log.push({ kind: 'write', decision: 'deny' });
            return;
        }
        this.log.push({ kind: 'write', decision: 'allow', length: String(d.text || '').length });
    }

    // ── pastes ──

    /// Whether a multi-line paste into this pane now needs a confirmation.
    pasteNeedsWarning(text) {
        if (!/[\r\n]/.test(text)) return false;
        const mode = this.pane.behaviour.warnOnMultiLinePaste || 'prompt';
        if (mode === 'never') return false;
        if (mode === 'always') return true;
        const st = this.pane.shellState;
        if (st === 'prompt') return true;
        if (st === 'running') return false;
        const v = term.viewport(this.pane.el);
        const bp = this.pane.bracketedPaste;
        return !!this.pane.profile.isShell && !this.pane.launch.commandline && !(v && v.altScreen);
    }

    /// Apply the paste settings to text about to go in: the text to paste.
    prepare(text) {
        let t = String(text || '');
        if (this.pane.behaviour.trimPasteTrailingNewline !== false) t = t.replace(/[\r\n]+$/, '');
        return t;
    }

    paste(e) {
        const raw = e.clipboardData && typeof e.clipboardData.getData === 'function' ? e.clipboardData.getData('text/plain') : '';
        if (!raw) return;
        const t = this.prepare(raw);
        const warn = this.pasteNeedsWarning(t);
        if (!warn && t === raw) return;  // bro pastes it as it is
        e.preventDefault();
        if (!t) return;
        if (!warn) { this.pane.el.paste(t); return; }
        this.confirmPaste(t);
    }

    /// Paste `text` the way a key would: through the settings above.
    pasteText(text) {
        const t = this.prepare(text);
        if (!t) return false;
        if (this.pasteNeedsWarning(t)) { this.confirmPaste(t); return 'confirm'; }
        return this.pane.el.paste(t);
    }

    confirmPaste(t) {
        const pane = this.pane;
        if (!this.app) return pane.el.paste(t);
        const lines = t.split(/\r\n|\r|\n/);
        const preview = lines.slice(0, 6).map((l) => (l.length > 90 ? l.slice(0, 89) + '…' : l)).join('\n') +
            (lines.length > 6 ? '\n… and ' + (lines.length - 6) + ' more lines' : '');
        const bp = pane.bracketedPaste;
        this.log.push({ kind: 'paste', decision: 'ask', lines: lines.length, bracketed: bp });
        return this.app.overlays.confirm({
            title: 'Paste ' + lines.length + ' lines?',
            message: 'Each line may run as a command at the shell\'s prompt.\n\n' + preview,
            confirm: 'Paste',
        }).then((ok) => {
            this.log.push({ kind: 'paste', decision: ok ? 'paste' : 'cancel', lines: lines.length, bracketed: bp });
            if (ok) pane.el.paste(t);
            pane.focus();
            return ok;
        });
    }
}
