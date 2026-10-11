// Paste safety. warnOnMultiLinePaste 'prompt' (the default) asks before text
// with line breaks goes to a shell sitting at its prompt, where each line
// would run, and not to a program that reads it as text; 'always' asks
// whenever there is a line break; 'never' does not ask. A cancelled paste
// sends nothing. trimPasteTrailingNewline (default on) drops the newline a
// copied line ends with, so pasting it does not run it.

import { app, waitFor, settle, eq, childAvailable, requireApp, writeSettings, reportPath,
         childProfile } from './lib/harness.js';
import { shellProfiles, makeHome, homeEnv, waitPrompt } from './lib/shells.js';

const dialog = () => (app.overlays.current && app.overlays.current.kind === 'dialog' ? document.querySelector('.dialog') : null);

function into(pane, text) {
    pane.focus();
    advanceTime(16);
    paste(text);
    advanceTime(16);
}

if (requireApp() && !childAvailable()) {
    skipTest('term-testchild is not built beside the headless binary');
} else if (app) {
    const ws = app.workspace;
    writeSettings({
        confirmClose: 'never',
        profiles: { list: [
            childProfile('Paste Child', reportPath('p')),
            childProfile('Paste Always', reportPath('a'), { warnOnMultiLinePaste: 'always' }),
            childProfile('Paste Raw', reportPath('r'), { warnOnMultiLinePaste: 'never', trimPasteTrailingNewline: false }),
        ] },
    });

    // ── a program that is not a shell: 'prompt' does not ask ──
    const child = ws.openTab({ profile: 'Paste Child' }).focused;
    waitFor(() => child.el.screenText().includes('TESTCHILD READY'), 'the child');
    into(child, 'first-line\nsecond-line');
    assert(!dialog(), 'no question for a program that is not at a shell prompt');
    child.el.write('\r');
    waitFor(() => child.el.screenText().includes('TESTCHILD GOT first-line') &&
        child.el.screenText().includes('TESTCHILD GOT second-line'), 'both lines went in: ' + child.el.screenText());
    // A trailing newline is trimmed: the line waits for Enter.
    into(child, 'trim-me\n');
    settle(300);
    assert(!child.el.screenText().includes('TESTCHILD GOT trim-me'), 'the pasted line did not run itself');
    child.el.write('\r');
    waitFor(() => child.el.screenText().includes('TESTCHILD GOT trim-me'), 'it was typed, waiting for Enter');

    // ── 'always' ──
    const always = ws.openTab({ profile: 'Paste Always' }).focused;
    waitFor(() => always.el.screenText().includes('TESTCHILD READY'), 'the second child');
    into(always, 'al-one\nal-two');
    waitFor(() => dialog(), '\'always\' asks');
    eq(document.querySelector('.dialog-title').textContent, 'Paste 2 lines?', 'how many lines');
    assert(document.querySelector('.dialog-message').textContent.includes('al-two'), 'and shows them');
    app.overlays.answer(false);
    always.el.write('\r');
    settle(300);
    assert(!always.el.screenText().includes('TESTCHILD GOT al-one'), 'Cancel sends nothing');
    eq(always.guard.log.slice(-2).map((e) => e.decision), ['ask', 'cancel'], 'logged as asked, then cancelled');
    into(always, 'al-one\nal-two');
    waitFor(() => dialog(), 'asks again');
    app.overlays.answer(true);
    waitFor(() => always.guard.log[always.guard.log.length - 1].decision === 'paste', 'the answer');
    always.el.write('\r');
    waitFor(() => always.el.screenText().includes('TESTCHILD GOT al-two'), 'Paste sends it');
    into(always, 'single line');
    assert(!dialog(), 'a single line is never asked about');

    // ── 'never', and no trimming ──
    const raw = ws.openTab({ profile: 'Paste Raw' }).focused;
    waitFor(() => raw.el.screenText().includes('TESTCHILD READY'), 'the third child');
    into(raw, 'raw-one\nraw-two\n');
    assert(!dialog(), '\'never\' does not ask');
    waitFor(() => raw.el.screenText().includes('TESTCHILD GOT raw-two'),
        'with trimPasteTrailingNewline false the final newline goes in too: ' + raw.el.screenText());

    // ── a real shell at its prompt ──
    const found = shellProfiles();
    const kind = found.bash.length ? 'bash' : found.powershell.length ? 'powershell' : found.zsh.length ? 'zsh' : null;
    if (!kind) {
        console.log('test_paste: no integrated shell here; the prompt case is skipped');
    } else {
        const profile = found[kind][0];
        const home = makeHome('paste');
        const sh = ws.openTab({ profile: profile.name, cwd: home, env: kind === 'powershell' ? {} : homeEnv(home) }).focused;
        waitPrompt(sh, profile.name);
        const ps = kind === 'powershell';
        const l1 = ps ? 'echo ("pa-" + (1+1))' : 'echo pa-$((1+1))';
        const l2 = ps ? 'echo ("pb-" + (2+2))' : 'echo pb-$((2+2))';
        into(sh, l1 + '\n' + l2);
        waitFor(() => dialog(), profile.name + ' at its prompt: a multi-line paste asks');
        app.overlays.answer(false);
        settle(500);
        assert(!sh.el.screenText().includes('pa-2'), 'cancelled: nothing ran');
        into(sh, l1 + '\n' + l2 + '\n');
        waitFor(() => dialog(), 'asks again');
        app.overlays.answer(true);
        waitFor(() => sh.guard.log[sh.guard.log.length - 1].decision === 'paste', 'the answer');
        // Readline with bracketed paste holds the lines until Enter.
        settle(300);
        if (!sh.el.screenText().includes('pb-4')) sh.el.write('\r');
        waitFor(() => /^pa-2\s*$/m.test(sh.el.screenText()) && /^pb-4\s*$/m.test(sh.el.screenText()),
            'confirmed: both commands ran: ' + sh.el.screenText().slice(-400), 20000);
        // A copied line with its newline does not run.
        waitFor(() => sh.shellState === 'prompt', 'back at the prompt');
        const l3 = ps ? 'echo ("tr-" + (3+3))' : 'echo tr-$((3+3))';
        into(sh, l3 + '\n');
        assert(!dialog(), 'one line (once trimmed) is not asked about');
        settle(800);
        assert(!/^tr-6\s*$/m.test(sh.el.screenText()), 'the trimmed line waits at the prompt');
        sh.el.write('\r');
        waitFor(() => /^tr-6\s*$/m.test(sh.el.screenText()), 'and runs on Enter');
        // A program running in the shell reads the paste as input: no question.
        app.settings.set('warnOnMultiLinePaste', 'prompt');
        sh.el.write((ps ? 'Start-Sleep -Seconds 3' : 'sleep 3') + '\r');
        waitFor(() => sh.shellState === 'running', 'a command running');
        into(sh, 'x\ny');
        assert(!dialog(), 'while a command runs the paste is not asked about');
    }
    console.log('test_paste: finished');
}
