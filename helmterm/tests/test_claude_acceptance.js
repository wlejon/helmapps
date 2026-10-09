// Acceptance test: Claude Code in helmterm
// Exercises command execution, fast output streaming, Unicode/formatting,
// terminal resize, keyboard interrupts, and clean process exit.

import { app, waitFor, settle, eq, requireApp, writeSettings, CHILD, childAvailable } from './lib/harness.js';

const fs = require('fs');

const CLAUDE_BIN = '/home/j/.local/bin/claude';
const hasClaude = fs.existsSync(CLAUDE_BIN);

if (requireApp()) {
    const ws = app.workspace;
    writeSettings({ confirmClose: 'never' });

    console.log('test_claude_acceptance: testing Claude Code in helmterm');

    if (hasClaude) {
        // ── 1. Fast streaming output & CLI invocation: claude --version ──
        const tabVer = ws.openTab({ commandline: [CLAUDE_BIN, '--version'] });
        const paneVer = tabVer.focused;
        waitFor(() => paneVer.exited, 'claude --version to exit', 10000);
        eq(paneVer.exitCode, 0, 'claude --version exited with code 0');
        const verText = paneVer.el.screenText();
        assert(/Claude Code/i.test(verText) || /\d+\.\d+\.\d+/.test(verText),
            'claude --version output rendered: ' + verText);

        // ── 2. Full formatted text & help output ──
        const tabHelp = ws.openTab({ commandline: [CLAUDE_BIN, '--help'] });
        const paneHelp = tabHelp.focused;
        waitFor(() => paneHelp.exited, 'claude --help to exit', 10000);
        eq(paneHelp.exitCode, 0, 'claude --help exited with code 0');
        const helpText = paneHelp.el.screenText();
        assert(/Usage:/i.test(helpText) || /claude/i.test(helpText),
            'claude --help displayed formatted help: ' + helpText.slice(0, 200));

        // ── 3. Resize mid-stream on active Claude tab ──
        const tabRun = ws.openTab({ commandline: [CLAUDE_BIN, '--help'] });
        const paneRun = tabRun.focused;
        // Resize during execution
        paneRun.el.style.width = '800px';
        paneRun.el.style.height = '600px';
        advanceTime(32);
        waitFor(() => paneRun.exited, 'claude after resize to exit', 10000);
        eq(paneRun.exitCode, 0, 'exited cleanly after resize');
    } else {
        console.log('test_claude_acceptance: claude binary not found, skipping CLI invocations');
    }

    // ── 4. Interactive emulator capabilities used by Claude Code ──
    // Claude Code relies heavily on: alternate screen, cursor positioning,
    // wide characters, UTF-8 emoji, OSC 8 hyperlinks, fast line updates.
    if (childAvailable()) {
        const tabChild = ws.openTab({ commandline: [CHILD] });
        const pane = tabChild.focused;
        waitFor(() => pane.el.screenText().includes('TESTCHILD READY'), 'child ready');

        // Switch to alternate screen (smcup: \x1b[?1049h)
        pane.el.feed('\x1b[?1049h\x1b[H\x1b[2J');
        advanceTime(32);
        assert(pane.el.viewport.altScreen, 'alternate screen activated');

        // Unicode, wide characters, and emoji streaming
        pane.el.feed('Claude Code 🤖⚡ ─ Progress: [████████░░] 80%\r\n');
        advanceTime(32);
        const altText = pane.el.screenText();
        assert(altText.includes('Claude Code') && altText.includes('80%'),
            'rendered wide characters and progress bar');

        // OSC 8 hyperlink handling
        pane.el.feed('\x1b]8;;https://docs.anthropic.com\x07Anthropic Docs\x1b]8;;\x07\r\n');
        advanceTime(32);
        assert(pane.el.screenText().includes('Anthropic Docs'), 'rendered OSC 8 link label');

        // Keyboard interrupt (Ctrl+C: \x03)
        pane.el.write('\x03');
        advanceTime(32);

        // Exit alternate screen (rmcup: \x1b[?1049l)
        pane.el.feed('\x1b[?1049l');
        advanceTime(32);
        assert(!pane.el.viewport.altScreen, 'restored from alternate screen');

        pane.el.feed('exit\r\n');
        pane.el.write('exit\r\n');
        settle(200);
    }

    console.log('test_claude_acceptance: finished successfully');
}
