// A program asking for the clipboard (OSC 52 "?") under each per-profile
// policy: deny never reaches helmterm; ask shows a bar in the pane that does
// not take the keyboard, and Allow / Deny / Always allow answer it (Always
// allow saves the profile's policy); allow lets bro answer. Clipboard writes
// are refused under clipboardWrite: false.
//
// On Windows ConPTY drops the terminal's OSC replies before they reach the
// program, so there the answer is checked at the terminal (the request is
// consumed); elsewhere the program prints what it received.

import { app, waitFor, settle, eq, clickEl, childAvailable, requireApp, writeSettings, reportPath,
         childProfile } from './lib/harness.js';

const WIN = process.platform === 'win32';
const QUERY = '\x1b]52;c;?\x07';

if (requireApp() && !childAvailable()) {
    skipTest('helmterm-testchild is not built beside the headless binary');
} else if (app) {
    const ws = app.workspace;
    writeSettings({
        confirmClose: 'never',
        profiles: { list: [
            childProfile('Clip Ask', reportPath('a')),
            childProfile('Clip Deny', reportPath('d'), { clipboardRead: 'deny' }),
            childProfile('Clip Allow', reportPath('l'), { clipboardRead: 'allow' }),
            childProfile('Clip Locked', reportPath('k'), { clipboardRead: 'deny', clipboardWrite: false }),
            childProfile('Clip NoWrite', reportPath('n'), { clipboardWrite: false }),
        ] },
    });
    const open = (name) => {
        const t = ws.openTab({ profile: name });
        const p = t.focused;
        waitFor(() => p.el.screenText().includes('TESTCHILD READY'), name);
        p.focus();
        advanceTime(16);
        return p;
    };
    app.host.clipboard.write('secret text');

    // ── deny: the request never reaches the page ──
    const deny = open('Clip Deny');
    eq(deny.el.options.clipboard, 'write', 'clipboardRead deny: the element keeps reads from the page');
    deny.el.feed(QUERY);
    settle(200);
    assert(!deny.root.querySelector('.pane-prompt'), 'no prompt');
    eq(deny.guard.log.length, 0, 'nothing to decide');
    const locked = open('Clip Locked');
    eq(locked.el.options.clipboard, 'deny', 'and with clipboardWrite false as well, no OSC 52 at all');

    // ── ask ──
    const ask = open('Clip Ask');
    eq(ask.el.options.clipboard, 'read-write', 'ask: reads come to helmterm');
    ask.el.feed(QUERY);
    waitFor(() => ask.root.querySelector('.pane-prompt'), 'the request shows a prompt in the pane');
    const prompt = ask.root.querySelector('.pane-prompt');
    assert(/wants to read the clipboard/.test(prompt.textContent), 'saying what is asked: ' + prompt.textContent);
    assert(document.activeElement === ask.el, 'the terminal keeps the keyboard while it asks');
    let id = ask.guard.pending[0].id;
    clickEl(prompt.querySelector('[data-decision="deny"]'));
    assert(!ask.root.querySelector('.pane-prompt'), 'Deny dismisses it');
    eq(ask.guard.log.pop(), { kind: 'read', id, decision: 'deny' }, 'and refuses');
    eq(ask.el.answerClipboard(id, 'late'), false, 'the request is closed at the terminal');

    ask.el.feed(QUERY);
    waitFor(() => ask.guard.pending.length === 1, 'a second request');
    id = ask.guard.pending[0].id;
    clickEl(ask.root.querySelector('.pane-prompt [data-decision="allow"]'));
    waitFor(() => ask.el.answerClipboard(id, 'late') === false, 'Allow answers the request');
    eq(ask.guard.log.pop().decision, 'allow', 'allowed');
    if (!WIN) {
        ask.el.write('\r');
        waitFor(() => ask.el.screenText().includes('52;c;' + btoa('secret text')),
            'the program received the clipboard: ' + ask.el.screenText());
    }

    // The keyboard can answer too (the palette's Allow / Deny commands).
    ask.el.feed(QUERY);
    waitFor(() => ask.guard.pending.length === 1, 'a third request');
    assert(app.commands.run('denyClipboardRead'), 'denyClipboardRead answers it');
    eq(ask.guard.pending.length, 0, 'none waiting');

    // Always allow saves the policy on the profile.
    ask.el.feed(QUERY);
    waitFor(() => ask.guard.pending.length === 1, 'a fourth request');
    clickEl(ask.root.querySelector('.pane-prompt [data-decision="always"]'));
    waitFor(() => app.profiles.get('Clip Ask').clipboardRead === 'allow', 'Always allow writes clipboardRead: allow to the profile');
    const saved = JSON.parse(require('fs').readFileSync(app.settings.settingsPath, 'utf-8'));
    eq(saved.profiles.list.find((p) => p.name === 'Clip Ask').clipboardRead, 'allow', 'in settings.json');
    waitFor(() => ask.behaviour.clipboardRead === 'allow', 'the running pane takes it');
    ask.el.feed(QUERY);
    settle(200);
    assert(!ask.root.querySelector('.pane-prompt'), 'and does not ask again');
    eq(ask.guard.log.pop().decision, 'allow', 'bro answers it');

    // ── allow ──
    const allow = open('Clip Allow');
    allow.el.feed(QUERY);
    waitFor(() => allow.guard.log.length === 1, 'the request');
    eq(allow.guard.log[0].decision, 'allow', 'clipboardRead allow: no prompt, bro answers');
    assert(!allow.root.querySelector('.pane-prompt'), 'nothing shown');

    // ── writes ──
    const nw = open('Clip NoWrite');
    nw.el.feed('\x1b]52;c;' + btoa('from the program') + '\x07');
    waitFor(() => nw.guard.log.some((e) => e.kind === 'write'), 'the write request');
    eq(nw.guard.log.find((e) => e.kind === 'write').decision, 'deny', 'clipboardWrite false refuses it');
    allow.el.feed('\x1b]52;c;' + btoa('allowed write') + '\x07');
    waitFor(() => allow.guard.log.some((e) => e.kind === 'write'), 'a write where writes are allowed');
    eq(allow.guard.log.find((e) => e.kind === 'write').decision, 'allow', 'is let through');

    // A pane that exits with a request waiting refuses it.
    ask.behaviour.clipboardRead = 'ask';
    ask.el.feed(QUERY);
    waitFor(() => ask.guard.pending.length === 1, 'a request left waiting');
    // Where replies reach the child they sit on its input line unterminated;
    // end that line first so "q" is a line of its own.
    ask.el.write('\rq\r');
    waitFor(() => ask.exited, 'the child exits');
    eq(ask.guard.pending.length, 0, 'the waiting request was refused');
    console.log('test_clipboard: finished');
}
