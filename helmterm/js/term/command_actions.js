// What can be done with one of a shell's commands (an OSC 133 record): copy
// its output or its command line, select its output, run it again, go to
// its prompt. The palette, the keys and a command mark's menu all use these.

import { host } from '../core/host.js';
import { describeCommand } from './command_log.js';

/// The command a key or palette action means: the one whose output fills the
/// top of a scrolled-back view, else the last finished one.
export function targetCommand(pane) {
    if (!pane) return null;
    const chrome = pane.chrome;
    if (chrome && chrome.stickyCommand) return chrome.stickyCommand;
    return pane.command();
}

/// Select a command's output. Returns its text ('' when it printed none),
/// or null when there is no such output.
export function selectOutput(pane, cmd) {
    const c = cmd || targetCommand(pane);
    if (!pane || !c || !c.output) return null;
    let ok = false;
    try { ok = pane.el.selectOutput(c.output.row, c.output.col); } catch (e) { ok = false; }
    if (!ok) return null;
    return pane.el.selectionText().replace(/\r/g, '');
}

export function copyOutput(pane, cmd) {
    const text = selectOutput(pane, cmd);
    if (text === null) {
        if (pane && pane.app) pane.app.toast('There is no command output to copy (shell integration marks it).');
        return false;
    }
    const trimmed = text.replace(/\n+$/, '');
    host.clipboard.write(trimmed);
    if (pane.app) pane.app.lastCopied = trimmed;
    return true;
}

export function copyCommandLine(pane, cmd) {
    const c = cmd || targetCommand(pane);
    if (!c || !c.commandLine) return false;
    host.clipboard.write(c.commandLine);
    if (pane.app) pane.app.lastCopied = c.commandLine;
    return true;
}

export function rerun(pane, cmd) {
    const c = cmd || (pane && pane.command());
    if (!pane || !c || !c.commandLine) return false;
    if (pane.shellState === 'running') {
        if (pane.app) pane.app.toast('A command is still running in this pane.');
        return false;
    }
    return pane.run(c.commandLine);
}

export function scrollToCommand(pane, cmd) {
    if (!pane || !cmd) return false;
    return pane.el.scrollToRow(cmd.prompt.row);
}

/// The menu a command mark opens.
export function commandMenu(pane, cmd, anchor) {
    const app = pane.app;
    if (!app) return null;
    const items = [
        { label: describeCommand(cmd, pane.commandLog), run: () => scrollToCommand(pane, cmd) },
        { separator: true },
        { label: 'Copy command', run: () => copyCommandLine(pane, cmd) },
        { label: 'Copy output', run: () => copyOutput(pane, cmd) },
        { label: 'Select output', run: () => selectOutput(pane, cmd) },
        { label: 'Run again', run: () => { rerun(pane, cmd); pane.focus(); } },
    ];
    if (!cmd.commandLine) items.splice(2, 1);
    if (!cmd.output) items.splice(items.findIndex((i) => i.label === 'Copy output'), 2);
    return app.overlays.menu(items, anchor);
}

/// The pane's finished commands, newest first, one per distinct command
/// line: what "recent commands" offers.
export function recentCommands(pane, limit) {
    if (!pane) return [];
    const seen = new Set();
    const out = [];
    const list = pane.commands();
    for (let i = list.length - 1; i >= 0 && out.length < (limit || 50); i--) {
        const c = list[i];
        if (!c.finished || !c.commandLine || seen.has(c.commandLine)) continue;
        seen.add(c.commandLine);
        out.push(c);
    }
    return out;
}
