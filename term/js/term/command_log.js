// What a pane knows about its shell's commands beyond the element's own
// `commands` list: when each one started and finished (the element keeps
// positions and exit codes, not times), and where the shell is now.
//
// Timing is keyed by a command's prompt row, which is absolute and stays
// with its line for as long as the line is in history. The state follows
// the OSC 133 marks: A/B a prompt is waiting, C a command is running, D it
// finished. 'unknown' until the first mark (no shell integration).

import { Emitter } from '../core/emitter.js';
import * as term from './adapter.js';

const MAX_TIMES = 2000;

export class CommandLog extends Emitter {
    constructor() {
        super();
        this.state = 'unknown';     // unknown | prompt | running
        this.marks = 0;             // marks seen; > 0 means the shell is integrated
        this.times = new Map();     // prompt row -> { start, end }
        this.runningSince = 0;
    }

    get integrated() { return this.marks > 0; }

    /// A promptmark event's detail: { mark, params, exitCode }. `el` is the
    /// terminal, for the current command's prompt row.
    mark(el, detail) {
        const d = detail || {};
        const m = String(d.mark || '').toUpperCase();
        this.marks++;
        const list = term.commands(el);
        const cur = list.length ? list[list.length - 1] : null;
        const now = Date.now();
        if (m === 'A' || m === 'B') {
            this.state = 'prompt';
        } else if (m === 'C') {
            this.state = 'running';
            if (!this.runningSince) this.runningSince = now;
            // Events arrive after the parser has moved on, so the running
            // record is the last one with output that has not finished (if
            // the command already finished in the same PTY batch, fall back
            // to the latest record with output that has no start time yet).
            const running = [...list].reverse().find((c) => c.output && !c.finished)
                || [...list].reverse().find((c) => c.output && !this.times.has(c.prompt.row));
            if (running) {
                const t = this._time(running.prompt.row);
                if (!t.start) t.start = now;
            }
            this.emit('start', running || cur);
        } else if (m === 'D') {
            this.state = 'prompt';
            // The element has already closed the record: the last finished one.
            const done = [...list].reverse().find((c) => c.finished) || null;
            let duration = null;
            if (done) {
                const t = this._time(done.prompt.row);
                if (!t.start) t.start = this.runningSince || now;
                if (!t.end) t.end = Math.max(t.start, now);
                duration = t.end - t.start;
            } else if (this.runningSince) {
                duration = now - this.runningSince;
            }
            this.runningSince = 0;
            const exitCode = typeof d.exitCode === 'number' ? d.exitCode : done ? done.exitCode : null;
            this.emit('finish', { command: done, exitCode, duration });
        }
        this.emit('change', m);
    }

    _time(row) {
        let t = this.times.get(row);
        if (!t) {
            t = { start: 0, end: 0 };
            this.times.set(row, t);
            if (this.times.size > MAX_TIMES) this.times.delete(this.times.keys().next().value);
        }
        return t;
    }

    /// The duration of a command record in ms, null when unknown or still
    /// running (then `elapsed` says how long so far).
    duration(cmd) {
        const t = cmd && this.times.get(cmd.prompt.row);
        if (!t || !t.start || !t.end) return null;
        return t.end - t.start;
    }

    elapsed(cmd) {
        const t = cmd && this.times.get(cmd.prompt.row);
        return t && t.start ? (t.end || Date.now()) - t.start : null;
    }
}

/// "850 ms", "4.2 s", "3 min 05 s", "1 h 02 min".
export function formatDuration(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
    if (ms < 1000) return Math.max(0, Math.round(ms)) + ' ms';
    const s = ms / 1000;
    if (s < 60) return (s < 10 ? s.toFixed(1) : String(Math.round(s))) + ' s';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ' + String(Math.round(s - m * 60)).padStart(2, '0') + ' s';
    const h = Math.floor(m / 60);
    return h + ' h ' + String(m - h * 60).padStart(2, '0') + ' min';
}

/// A command record's state: 'ok' | 'failed' | 'running' | 'prompt' | 'unknown'.
export function commandStatus(c) {
    if (!c) return 'unknown';
    if (!c.finished) return c.output ? 'running' : 'prompt';
    if (c.exitCode === null || c.exitCode === undefined) return 'unknown';
    return c.exitCode === 0 ? 'ok' : 'failed';
}

/// "make test · exit code 2 · 4.2 s".
export function describeCommand(c, log) {
    const parts = [c.commandLine || '(no command line)'];
    if (c.finished && typeof c.exitCode === 'number') parts.push(c.exitCode === 0 ? 'succeeded' : 'exit code ' + c.exitCode);
    else if (!c.finished && c.output) parts.push('running');
    const d = log ? (c.finished ? log.duration(c) : log.elapsed(c)) : null;
    if (d !== null) parts.push(formatDuration(d));
    return parts.join(' · ');
}

/// The command (from `list`) whose prompt, input or output covers `row`.
export function commandAtRow(list, row) {
    let best = null;
    for (const c of list) {
        if (c.prompt.row <= row) best = c; else break;
    }
    if (!best) return null;
    if (best.end && best.end.row < row) return null;
    return best;
}
