// The terminal's commands: find, scrolling, prompts, selection and the
// clipboard, shell-integration command actions, and answering a program's
// clipboard request. Registered by id like every other command
// (actions.js), so keybindings and the palette reach all of them.

import { host } from './core/host.js';
import * as term from './term/adapter.js';
import { selectOutput, copyOutput, copyCommandLine, rerun, recentCommands } from './term/command_actions.js';
import { describeCommand } from './term/command_log.js';

export function registerTerminalActions(app) {
    const c = app.commands;
    const ws = app.workspace;
    const pane = () => ws.activePane();
    const has = () => !!pane();
    const view = (f) => () => {
        const p = pane();
        if (!p || !term.caps.viewport) return false;
        const r = f(p.el);
        p.chrome.update();
        return r;
    };
    const canView = () => has() && term.caps.viewport;
    const integrated = () => has() && term.caps.commands && pane().commands().length > 0;

    // ── find ──
    c.register('find', { title: 'Find', category: 'Terminal', enabled: () => term.caps.search && has(),
        run: (a) => app.find(a.query) });
    c.register('findNext', { title: 'Find next', category: 'Terminal', enabled: () => term.caps.search && has(),
        run: () => app.findbar.next() !== null });
    c.register('findPrevious', { title: 'Find previous', category: 'Terminal', enabled: () => term.caps.search && has(),
        run: () => app.findbar.previous() !== null });

    // ── scrolling ──
    c.register('scrollUp', { title: 'Scroll up', category: 'Terminal', enabled: canView,
        run: (a) => view((el) => el.scrollLines(-(Number(a.lines) || 1)))() });
    c.register('scrollDown', { title: 'Scroll down', category: 'Terminal', enabled: canView,
        run: (a) => view((el) => el.scrollLines(Number(a.lines) || 1))() });
    c.register('scrollPageUp', { title: 'Scroll up a page', category: 'Terminal', enabled: canView,
        run: view((el) => el.scrollPages(-1)) });
    c.register('scrollPageDown', { title: 'Scroll down a page', category: 'Terminal', enabled: canView,
        run: view((el) => el.scrollPages(1)) });
    c.register('scrollToTop', { title: 'Scroll to the top', category: 'Terminal', enabled: canView,
        run: view((el) => el.scrollToTop()) });
    c.register('scrollToBottom', { title: 'Scroll to the bottom', category: 'Terminal', enabled: canView,
        run: view((el) => el.scrollToBottom()) });
    c.register('scrollToPreviousPrompt', { title: 'Previous prompt', category: 'Terminal',
        enabled: () => canView() && term.caps.scrollToPrompt, run: view((el) => el.scrollToPrompt(-1)) });
    c.register('scrollToNextPrompt', { title: 'Next prompt', category: 'Terminal',
        enabled: () => canView() && term.caps.scrollToPrompt, run: view((el) => el.scrollToPrompt(1)) });
    c.register('clearScrollback', { title: 'Clear scrollback', category: 'Terminal', enabled: has,
        run: () => term.clearScrollback(pane().el) });

    // ── selection and the clipboard ──
    c.register('selectAll', { title: 'Select all', category: 'Terminal', enabled: () => has() && term.caps.selection,
        run: () => { pane().el.selectAll(); return true; } });
    c.register('clearSelection', { title: 'Clear selection', category: 'Terminal', enabled: () => has() && term.caps.selection,
        run: () => { pane().el.clearSelection(); return true; } });
    c.register('copy', { title: 'Copy', category: 'Terminal', enabled: () => has() && term.caps.selection,
        run: () => {
            const t = pane().el.selectionText();
            if (!t) return false;
            host.clipboard.write(t);
            app.lastCopied = t;
            return true;
        } });
    c.register('paste', { title: 'Paste', category: 'Terminal', enabled: () => has() && term.caps.paste,
        run: () => host.clipboard.read().then((t) => pane() && pane().guard.pasteText(t)) });

    // ── shell integration: commands ──
    c.register('selectCommandOutput', { title: 'Select command output', category: 'Shell', enabled: integrated,
        run: () => selectOutput(pane()) !== null });
    c.register('copyCommandOutput', { title: 'Copy command output', category: 'Shell', enabled: integrated,
        run: () => copyOutput(pane()) });
    c.register('copyCommandLine', { title: 'Copy command line', category: 'Shell', enabled: integrated,
        run: () => copyCommandLine(pane()) });
    c.register('rerunLastCommand', { title: 'Run the last command again', category: 'Shell', enabled: integrated,
        run: () => rerun(pane()) });
    c.register('rerunCommand', { title: 'Run a command again', category: 'Shell', palette: false, enabled: integrated,
        run: (a) => {
            const p = pane();
            const line = typeof a.commandLine === 'string' ? a.commandLine : null;
            const cmd = line ? { commandLine: line, finished: true } : recentCommands(p, 50)[a.index | 0];
            return rerun(p, cmd);
        } });
    c.register('recentCommands', { title: 'Recent commands', category: 'Shell', enabled: integrated,
        run: () => app.palette.show('Run again: ') });

    // ── a program's clipboard request ──
    const asking = () => has() && pane().guard.pending.length > 0;
    c.register('allowClipboardRead', { title: 'Allow the clipboard read', category: 'Terminal', enabled: asking,
        run: () => pane().guard.answer(null, 'allow') });
    c.register('denyClipboardRead', { title: 'Deny the clipboard read', category: 'Terminal', enabled: asking,
        run: () => pane().guard.answer(null, 'deny') });
}

/// Palette rows for the active pane's recent commands: "Run again: <line>".
export function recentCommandItems(app) {
    const p = app.workspace.activePane();
    if (!p) return [];
    return recentCommands(p, 30).map((cmd, i) => ({
        id: 'rerun:' + i,
        label: 'Run again: ' + cmd.commandLine,
        detail: describeCommand(cmd, p.commandLog),
        run: () => rerun(p, cmd),
    }));
}
