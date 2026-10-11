// What term draws over and beside a pane's terminal, from the element's
// view and its shell's commands:
//
//   the scrollbar      thumb from `viewport` (it spans `rows` of
//                      `historyRows + rows`), with a tick for every prompt
//                      and failed commands' ticks in the error colour; drag,
//                      or click the track to page
//   command marks      a bar in the left padding beside each prompt on
//                      screen: green after success, red after a failure,
//                      blue while running; a click opens the command's menu
//   the sticky header  scrolled back into a command's output, its command
//                      line stays at the top; a click goes to its prompt
//   the link hint      over a link, what Ctrl+click (Cmd+click) opens
//
// Every update is coalesced into one per frame.

import * as term from './adapter.js';
import { formatDuration, commandStatus, describeCommand } from './command_log.js';
import { commandMenu } from './command_actions.js';

const MAX_TICKS = 400;

function div(cls, parent) {
    const d = document.createElement('div');
    d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
}

export class PaneChrome {
    constructor(pane) {
        this.pane = pane;
        this.settings = { scrollbar: true, commandMarks: true, stickyCommand: true };
        const root = pane.root;
        this.gutter = div('pane-gutter', root);
        this.scrollbar = div('pane-scrollbar', root);
        this.ticks = div('sb-ticks', this.scrollbar);
        this.thumb = div('sb-thumb', this.scrollbar);
        this.sticky = div('pane-sticky', root);
        this.stickyText = div('sticky-text', this.sticky);
        this.stickyStatus = div('sticky-status', this.sticky);
        this.hint = div('pane-hint', root);
        this._pending = false;
        this.stickyCommand = null;

        this.scrollbar.addEventListener('mousedown', (e) => this._trackDown(e));
        this.sticky.addEventListener('mousedown', (e) => e.stopPropagation());
        this.sticky.addEventListener('click', () => {
            const c = this.stickyCommand;
            if (c) { this.pane.el.scrollToRow(c.prompt.row); this.update(); }
        });
        this.gutter.addEventListener('mousedown', (e) => e.stopPropagation());
        root.addEventListener('mousemove', (e) => this._hover(e));
        root.addEventListener('mouseleave', () => this._showHint(null));
    }

    attach(el) {
        this.el = el;
        this.update();
    }

    configure(values) {
        const s = values || {};
        this.settings = {
            scrollbar: s.scrollbar !== false,
            commandMarks: s.commandMarks !== false,
            stickyCommand: s.stickyCommand !== false,
        };
        const root = this.pane.root;
        root.classList.toggle('with-scrollbar', this.settings.scrollbar && term.caps.viewport);
        root.classList.toggle('with-marks', this.settings.commandMarks);
        this.update();
    }

    /// Schedule a redraw (one per frame however many events ask).
    update() {
        if (this._pending) return;
        this._pending = true;
        requestAnimationFrame(() => { this._pending = false; this.render(); });
    }

    render() {
        const el = this.pane.el;
        if (!el || !el.isConnected) return;
        const v = term.viewport(el);
        if (!v) return;
        const cmds = term.commands(el);
        this._renderScrollbar(v, cmds);
        this._renderGutter(v, cmds);
        this._renderSticky(v, cmds);
    }

    _renderScrollbar(v, cmds) {
        const sb = this.scrollbar;
        const on = this.settings.scrollbar && !v.altScreen && v.historyRows > 0;
        sb.classList.toggle('empty', !on);
        if (!on) { while (this.ticks.firstChild) this.ticks.firstChild.remove(); return; }
        const total = v.historyRows + v.rows;
        const h = sb.getBoundingClientRect().height || 1;
        const thumbH = Math.max(18, (v.rows / total) * h);
        const top = ((v.topRow - v.firstRow) / Math.max(1, total - v.rows)) * (h - thumbH);
        this.thumb.style.height = thumbH + 'px';
        this.thumb.style.top = Math.max(0, Math.min(h - thumbH, top)) + 'px';
        while (this.ticks.firstChild) this.ticks.firstChild.remove();
        if (!this.settings.commandMarks) return;
        for (const c of cmds.slice(-MAX_TICKS)) {
            if (c.prompt.row < v.firstRow) continue;
            const t = div('sb-tick ' + commandStatus(c), this.ticks);
            t.style.top = Math.min(h - 2, ((c.prompt.row - v.firstRow) / total) * h) + 'px';
        }
    }

    _metrics() {
        const m = term.metrics(this.pane.el);
        const pad = parseFloat(this.pane.el.style.padding) || 0;
        return { cellH: m && m.cellHeight > 0 ? m.cellHeight : 16, pad };
    }

    _renderGutter(v, cmds) {
        const g = this.gutter;
        while (g.firstChild) g.firstChild.remove();
        if (!this.settings.commandMarks || v.altScreen) return;
        const { cellH, pad } = this._metrics();
        const log = this.pane.commandLog;
        const bottom = v.topRow + v.rows;
        for (const c of cmds) {
            const r = c.prompt.row;
            if (r < v.topRow || r >= bottom) continue;
            // From the prompt to the output's last line on screen.
            let endRow = c.end ? c.end.row : c.output ? bottom - 1 : r;
            endRow = Math.max(r, Math.min(bottom - 1, endRow));
            const m = div('cmd-mark ' + commandStatus(c), g);
            m.style.top = (pad + (r - v.topRow) * cellH) + 'px';
            m.style.height = Math.max(cellH - 2, (endRow - r + 1) * cellH - 2) + 'px';
            m.title = describeCommand(c, log);
            m.dataset.row = String(r);
            m.addEventListener('click', (e) => {
                e.stopPropagation();
                commandMenu(this.pane, c, m);
            });
        }
    }

    _renderSticky(v, cmds) {
        let show = null;
        if (this.settings.stickyCommand && !v.atBottom && !v.altScreen) {
            // The last command whose prompt is above the view, while its
            // output still reaches the top line (a command ends on the row
            // the next prompt starts, so that row is the next one's).
            let best = null;
            let next = null;
            for (const c of cmds) {
                if (c.prompt.row < v.topRow) best = c;
                else { next = c; break; }
            }
            const covers = best && best.output && (!best.end || best.end.row > v.topRow ||
                (best.end.row === v.topRow && best.end.col > 0 && !(next && next.prompt.row === v.topRow)));
            if (covers) show = best;
        }
        this.stickyCommand = show;
        this.sticky.classList.toggle('shown', !!show);
        if (!show) return;
        this.stickyText.textContent = show.commandLine || '(command)';
        const st = commandStatus(show);
        this.sticky.dataset.status = st;
        const d = show.finished ? this.pane.commandLog.duration(show) : this.pane.commandLog.elapsed(show);
        const bits = [];
        if (st === 'failed') bits.push('exit ' + show.exitCode);
        if (st === 'running') bits.push('running');
        if (d !== null) bits.push(formatDuration(d));
        this.stickyStatus.textContent = bits.join(' · ');
    }

    // ── the scrollbar's mouse ──

    _trackDown(e) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const el = this.pane.el;
        const v = term.viewport(el);
        if (!v || v.historyRows <= 0) return;
        const rect = this.scrollbar.getBoundingClientRect();
        const t = this.thumb.getBoundingClientRect();
        if (e.clientY >= t.top && e.clientY <= t.bottom) {
            const grab = e.clientY - t.top;
            const move = (ev) => {
                const vv = term.viewport(el);
                if (!vv) return;
                const span = Math.max(1, rect.height - t.height);
                const frac = Math.max(0, Math.min(1, (ev.clientY - rect.top - grab) / span));
                el.scrollToRow(vv.firstRow + Math.round(frac * vv.historyRows));
                this.update();
            };
            const up = () => {
                window.removeEventListener('mousemove', move, true);
                window.removeEventListener('mouseup', up, true);
                this.scrollbar.classList.remove('dragging');
            };
            this.scrollbar.classList.add('dragging');
            window.addEventListener('mousemove', move, true);
            window.addEventListener('mouseup', up, true);
        } else {
            el.scrollPages(e.clientY < t.top ? -1 : 1);
            this.update();
        }
    }

    // ── links ──

    /// At most one link lookup per 40 ms, but always one for where the
    /// pointer came to rest: a move inside the window is looked up when the
    /// window ends.
    _hover(e) {
        if (!term.caps.links || !this.el) return;
        this._hoverAt = [e.clientX, e.clientY];
        const now = Date.now();
        const wait = this._lastHover ? 40 - (now - this._lastHover) : 0;
        if (wait > 0 && !this._hintShown) {
            if (!this._hoverTimer) {
                this._hoverTimer = setTimeout(() => {
                    this._hoverTimer = null;
                    this._lookup();
                }, wait);
            }
            return;
        }
        this._lookup();
    }

    _lookup() {
        if (!this._hoverAt || !this.el) return;
        this._lastHover = Date.now();
        const [x, y] = this._hoverAt;
        const cell = term.cellAt(this.el, x, y);
        let link = null;
        if (cell) { try { link = this.el.linkAt(cell.row, cell.col); } catch (err) { link = null; } }
        this._showHint(link);
    }

    _showHint(link) {
        this._hintShown = !!link;
        this.hint.classList.toggle('shown', !!link);
        if (!link) return;
        const mod = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
        const what = link.kind === 'path' ? 'open the file' : 'open the link';
        this.hint.textContent = mod + '+click to ' + what + ': ' + link.uri;
    }
}
