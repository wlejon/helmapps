// What shell integration gives on top of the marks, in a real shell: new
// tabs and splits start in the directory the shell is in; a command's
// output and command line copy; the last command (or one from the palette)
// runs again; Ctrl+Up / Ctrl+Down go from prompt to prompt; scrolled into a
// command's output, its command line sticks to the top and takes you to its
// prompt; the scrollbar shows the view, ticks a mark per command and pages
// on the track; a command mark opens a menu; a long command finishing in a
// tab you are not looking at notifies.

import { app, waitFor, settle, eq, press, clickEl, CHILD, requireApp, writeSettings } from './lib/harness.js';
import { shellProfiles, makeHome, homeEnv, script, run, waitPrompt, finished, norm } from './lib/shells.js';

const fs = require('fs');
const path = require('path');

const tidy = (s) => String(s || '').replace(/[ \t]+$/gm, '').replace(/\r/g, '');
const frame = () => { advanceTime(16); advanceTime(16); };

if (requireApp()) {
    const found = shellProfiles();
    const kinds = ['bash', 'powershell', 'zsh', 'fish'].filter((k) => found[k].length);
    if (!kinds.length) {
        skipTest('no shell that broterm integrates is installed');
    } else {
        writeSettings({ confirmClose: 'never', notifyOnLongCommand: 1, desktopNotifications: 'unfocused' });
        for (const kind of kinds) check(found[kind][0], kind);
    }
}

function check(profile, kind) {
    {
        const ws = app.workspace;
        const what = profile.name + ' (' + kind + ')';
        const s = script(kind);
        const home = makeHome('cmds-' + kind);
        const start = path.join(home, 'start');
        const sub = path.join(home, 'deeper dir');
        fs.mkdirSync(start, { recursive: true });
        fs.mkdirSync(sub, { recursive: true });
        const env = kind === 'powershell' ? {} : homeEnv(home);
        const tab = ws.openTab({ profile: profile.name, cwd: start, env });
        const pane = tab.focused;
        waitPrompt(pane, what);

        // ── the directory carries over ──
        run(pane, s.cd(sub), 'cd');
        waitFor(() => pane.reportedCwd && norm(pane.reportedCwd) === norm(sub),
            'the shell reported its directory: ' + pane.reportedCwd);
        const t2 = ws.openTab({ profile: profile.name, env });
        eq(norm(t2.focused.launch.spawn.cwd), norm(sub), 'a new tab starts where the shell is');
        ws.closeTab(t2);
        ws.activate(tab);
        const split = ws.splitPane({ env });
        eq(norm(split.launch.spawn.cwd), norm(sub), 'and so does a split');
        ws.closePane(split);
        const child = ws.openTab({ commandline: [CHILD] });
        assert(!child.focused.launch.spawn.cwd || norm(child.focused.launch.spawn.cwd) !== norm(sub),
            'a tab running a command line of its own is not moved');
        ws.closeTab(child);
        ws.activate(tab);
        app.settings.set('inheritCwd', false);
        const t3 = ws.openTab({ profile: profile.name, env });
        assert(!t3.focused.launch.spawn.cwd || norm(t3.focused.launch.spawn.cwd) !== norm(sub), 'inheritCwd false: it does not');
        ws.closeTab(t3);
        app.settings.set('inheritCwd', true);
        ws.activate(tab);
        pane.focus();
        frame();

        // ── copy output, copy the command line, run again ──
        const three = run(pane, s.lines(3), 'three lines');
        press('ctrl+shift+o');
        eq(tidy(app.lastCopied).split('\n'), ['line 1', 'line 2', 'line 3'], 'Ctrl+Shift+O copies the last command\'s output');
        eq(app.host.clipboard.local, app.lastCopied, 'to the clipboard');
        assert(app.commands.run('copyCommandLine'), 'copy the command line');
        eq(app.lastCopied, three.commandLine, 'the command line was copied');
        const before = finished(pane).length;
        assert(app.commands.run('rerunLastCommand'), 'run it again');
        waitFor(() => finished(pane).length === before + 1 && pane.shellState === 'prompt', 'it ran again');
        eq(finished(pane).pop().commandLine, three.commandLine, 'the same command line');

        // ── the palette's recent commands ──
        run(pane, s.ok, 'another command');
        const items = app.palette.items().filter((i) => i.label.startsWith('Run again: '));
        assert(items.length >= 2, 'the palette offers recent commands: ' + JSON.stringify(items.map((i) => i.label)));
        eq(items[0].label, 'Run again: ' + s.ok, 'newest first');
        const again = items.find((i) => i.label === 'Run again: ' + three.commandLine);
        assert(again, 'one entry per distinct command line');
        const n = finished(pane).length;
        again.run();
        waitFor(() => finished(pane).length === n + 1 && pane.shellState === 'prompt', 'the palette entry ran it');
        eq(finished(pane).pop().commandLine, three.commandLine, 'that command');

        // ── a failure, then enough output to scroll ──
        run(pane, s.fail, 'a failing command');
        const long = run(pane, s.lines(150), 'a long listing');
        waitFor(() => pane.el.viewport.historyRows > 50, 'scrollback to move through');
        frame();
        const sb = pane.root.querySelector('.pane-scrollbar');
        assert(pane.root.classList.contains('with-scrollbar') && !sb.classList.contains('empty'), 'the scrollbar shows');
        waitFor(() => sb.querySelectorAll('.sb-tick').length >= finished(pane).length, 'a tick per command');
        assert(sb.querySelector('.sb-tick.failed') && sb.querySelector('.sb-tick.ok'), 'failed and succeeded ticks differ');
        const thumbAtBottom = sb.querySelector('.sb-thumb').getBoundingClientRect();

        // Prompt to prompt.
        press('ctrl+up');
        frame();
        const v1 = pane.el.viewport;
        assert(!v1.atBottom, 'Ctrl+Up scrolls back');
        const prompts = pane.commands().map((c) => c.prompt.row);
        assert(prompts.includes(v1.topRow), 'to a prompt: top ' + v1.topRow + ' of ' + JSON.stringify(prompts));
        press('ctrl+up');
        frame();
        const v2 = pane.el.viewport;
        assert(v2.topRow < v1.topRow && prompts.includes(v2.topRow), 'and to the one before');
        press('ctrl+down');
        frame();
        eq(pane.el.viewport.topRow, v1.topRow, 'Ctrl+Down goes forward again');
        const thumbUp = sb.querySelector('.sb-thumb').getBoundingClientRect();
        assert(thumbUp.top < thumbAtBottom.top, 'the thumb follows the view');

        // The sticky command line.
        pane.el.scrollToRow(long.output.row + 40);
        frame();
        const sticky = pane.root.querySelector('.pane-sticky');
        waitFor(() => sticky.classList.contains('shown'), 'inside a command\'s output its command line sticks to the top');
        assert(sticky.textContent.includes(long.commandLine), 'that command\'s: ' + sticky.textContent);
        eq(sticky.dataset.status, 'ok', 'with its state');
        clickEl(sticky);
        frame();
        eq(pane.el.viewport.topRow, long.prompt.row, 'a click goes to its prompt');
        frame();
        assert(!sticky.classList.contains('shown'), 'where it is no longer needed');

        // The track pages.
        const top = pane.el.viewport.topRow;
        const tr = sb.getBoundingClientRect();
        click(tr.left + tr.width / 2, tr.bottom - 3);
        frame();
        assert(pane.el.viewport.topRow > top, 'clicking the track below the thumb pages down');
        pane.el.scrollToBottom();
        frame();

        // A command's mark and its menu.
        run(pane, s.lines(2), 'two lines');
        frame();
        const last = finished(pane).pop();
        let mark = null;
        waitFor(() => (mark = pane.root.querySelector('.cmd-mark[data-row="' + last.prompt.row + '"]')), 'a mark beside the last command');
        assert(mark.classList.contains('ok'), 'marked as succeeded');
        clickEl(mark);
        const items2 = [...document.querySelectorAll('.menu .menu-item')];
        assert(items2.length >= 4, 'the mark opens a menu: ' + items2.map((i) => i.textContent).join(' | '));
        app.lastCopied = null;
        clickEl(items2.find((i) => i.textContent === 'Copy output'));
        eq(tidy(app.lastCopied).split('\n'), ['line 1', 'line 2'], 'Copy output from the menu');

        // ── a long command finishing unseen ──
        const other = ws.openTab({ commandline: [CHILD] });
        ws.activate(tab);
        pane.focus();
        const logged = app.attention.log.length;
        const desk = app.host.desktopLog.length;
        pane.el.write(s.sleep(2) + '\r');
        waitFor(() => pane.shellState === 'running', 'the long command started');
        ws.activate(other);
        waitFor(() => app.attention.log.length > logged, 'its finishing is announced', 20000);
        const e = app.attention.log[app.attention.log.length - 1];
        eq([e.kind, e.commandLine, e.exitCode], ['command', s.sleep(2), 0], 'which command, and that it succeeded');
        assert(e.duration >= 1000, 'it took over the threshold: ' + e.duration);
        assert(tab.notified, 'its tab is marked');
        assert(app.host.desktopLog.slice(desk).some((d) => d.kind === 'notify' && /finished/.test(d.args[1])),
            'the desktop was told: ' + JSON.stringify(app.host.desktopLog.slice(desk)));
        ws.activate(tab);
        assert(!tab.notified, 'looking at the tab clears its mark');

        // Not when you are watching, and not for short commands.
        const quiet = app.attention.log.length;
        run(pane, s.sleep(2), 'a long command in view');
        pane.el.write(s.ok + '\r');
        ws.activate(other);
        settle(1000);
        ws.activate(tab);
        waitFor(() => pane.shellState === 'prompt', 'done');
        eq(app.attention.log.length, quiet, 'neither a watched long command nor a short unseen one is announced');
        ws.closeTab(other);
        ws.closeTab(tab);
        console.log('test_commands: finished (' + what + ')');
    }
}
