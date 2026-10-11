// Settings UI: the Terminal page. The element's behaviour (selection, the
// clipboard, scrolling, text), pastes, shell integration and its features,
// and how the bell and notifications reach the user. Every one of the
// per-profile keys (core/profiles.js BEHAVIOUR_KEYS) can also be set on a
// profile, on the Profiles page.

import { el, row, select, number, checkbox, section } from './form.js';

export function renderTerminal(ui) {
    const v = ui.app.settings.values;
    const set = (k) => (x) => ui.set(k, x);
    const wrap = el('div');

    const sel = section('Selection and the clipboard');
    sel.appendChild(row('Copy on select', checkbox(v.copyOnSelect, set('copyOnSelect'), 'set-copyOnSelect'),
        'A finished mouse selection is copied to the clipboard.'));
    sel.appendChild(row('Middle click pastes', checkbox(v.middleClickPaste, set('middleClickPaste'), 'set-middleClickPaste'),
        'From the primary selection on Linux, the clipboard elsewhere.'));
    sel.appendChild(row('Programs may set the clipboard', checkbox(v.clipboardWrite, set('clipboardWrite'), 'set-clipboardWrite'),
        'OSC 52 writes, as editors and tmux use over ssh.'));
    sel.appendChild(row('Programs reading the clipboard',
        select([{ value: 'ask', label: 'Ask each time' }, { value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }],
            v.clipboardRead, set('clipboardRead'), 'set-clipboardRead'),
        'OSC 52 reads. Asking shows a bar in the pane; the program waits for the answer.'));
    sel.appendChild(row('Warn before a multi-line paste',
        select([{ value: 'prompt', label: 'At a shell prompt' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }],
            v.warnOnMultiLinePaste, set('warnOnMultiLinePaste'), 'set-warnOnMultiLinePaste'),
        'At a prompt every line would run as a command. An editor or other program reading the paste is not asked about.'));
    sel.appendChild(row('Drop a paste\'s trailing newline', checkbox(v.trimPasteTrailingNewline, set('trimPasteTrailingNewline'), 'set-trimPasteTrailingNewline'),
        'So a copied line waits at the prompt instead of running.'));
    wrap.appendChild(sel);

    const scroll = section('Scrolling');
    scroll.appendChild(row('Typing scrolls to the bottom', checkbox(v.scrollOnInput, set('scrollOnInput'), 'set-scrollOnInput')));
    scroll.appendChild(row('Lines per wheel notch', number(v.wheelLines, set('wheelLines'), { min: 1, max: 100, id: 'set-wheelLines' })));
    scroll.appendChild(row('Scrollbar', checkbox(v.scrollbar, set('scrollbar'), 'set-scrollbar'),
        'With a mark for every prompt; failed commands\' marks in red.'));
    scroll.appendChild(row('Pin the command when scrolled back', checkbox(v.stickyCommand, set('stickyCommand'), 'set-stickyCommand'),
        'The command whose output is at the top of the view stays visible above it.'));
    wrap.appendChild(scroll);

    const text = section('Text');
    text.appendChild(row('Bold text in bright colours', checkbox(v.boldIsBright, set('boldIsBright'), 'set-boldIsBright')));
    text.appendChild(row('Minimum contrast', number(v.minimumContrast, set('minimumContrast'), { min: 1, max: 21, step: 0.5, id: 'set-minimumContrast' }),
        'The contrast ratio every character keeps against its background: 1 is off, 4.5 is WCAG AA.'));
    text.appendChild(row('Ligatures', checkbox(v.ligatures, set('ligatures'), 'set-ligatures'),
        'Programming ligatures across cells, for fonts that have them.'));
    text.appendChild(row('Image memory (MiB)', number(v.imageMemory === null || v.imageMemory === undefined ? 320 : v.imageMemory,
        set('imageMemory'), { min: 0, max: 4096, step: 16, id: 'set-imageMemory' }),
        'Inline images (kitty graphics, sixel, iTerm2) each terminal may hold decoded. 0 turns images off.'));
    wrap.appendChild(text);

    const shell = section('Shell integration',
        'helmterm loads a small script into PowerShell, bash, zsh and fish at launch (your own startup files still run, untouched), so the terminal knows where each prompt, command and output is.');
    shell.appendChild(row('Shell integration', checkbox(v.shellIntegration, set('shellIntegration'), 'set-shellIntegration'),
        'For new panes. A profile can turn it off for itself.'));
    shell.appendChild(row('Command marks', checkbox(v.commandMarks, set('commandMarks'), 'set-commandMarks'),
        'A mark beside each prompt: green after success, red after a failure. Click one for its menu.'));
    shell.appendChild(row('Notify after a long command', number(v.notifyOnLongCommand, set('notifyOnLongCommand'), { min: 0, step: 1, id: 'set-notifyOnLongCommand' }),
        'Seconds. A command that ran longer and finished while its tab was not in view says so. 0 turns it off.'));
    shell.appendChild(row('New tabs start in the current directory', checkbox(v.inheritCwd, set('inheritCwd'), 'set-inheritCwd'),
        'The directory the focused pane\'s shell reported, unless the new profile names its own.'));
    wrap.appendChild(shell);

    const att = section('Bell and notifications');
    att.appendChild(row('Bell', select([
        { value: 'visual', label: 'Flash the pane and mark the tab' },
        { value: 'audible', label: 'Play the system sound and mark the tab' },
        { value: 'both', label: 'Flash and play the sound' },
        { value: 'none', label: 'Ignore' }], v.bell, set('bell'), 'set-bell')));
    att.appendChild(row('Desktop notifications', select([
        { value: 'unfocused', label: 'When helmterm or the tab is not in view' },
        { value: 'always', label: 'Always' },
        { value: 'never', label: 'Never' }], v.desktopNotifications, set('desktopNotifications'), 'set-desktopNotifications'),
        'Programs\' notifications (OSC 9, 777, 99) and long commands. They also show in helmterm and on the tab.'));
    wrap.appendChild(att);
    return wrap;
}
