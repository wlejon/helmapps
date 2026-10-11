// Settings UI: the Keybindings page. Every command with its keys; "Record"
// takes the next key press as a new binding (written to keybindings.json),
// "Reset" drops the user's bindings for that command.

import { el, text, button, section } from './form.js';
import { displayKey, pressFromEvent } from '../core/keys.js';

export function renderKeybindings(ui) {
    const app = ui.app;
    const s = section('Keybindings', 'Saved to keybindings.json in VS Code\'s format. Chords ("ctrl+k ctrl+s") can be typed into the file.');
    const filter = text(ui.keyFilter || '', (v) => { ui.keyFilter = v; ui.refresh(); }, { id: 'keys-filter', placeholder: 'Filter commands' });
    s.appendChild(filter);
    const table = el('div', 'keys-table');
    s.appendChild(table);
    const q = (ui.keyFilter || '').toLowerCase();
    const user = app.settings.userKeybindings;
    const commands = app.commands.list().filter((c) => c.palette !== false || app.keymap.keyFor(c.id));
    for (const c of commands) {
        if (q && !(c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))) continue;
        const keys = app.keymap.bindings.filter((b) => b.command === c.id);
        const r = el('div', 'keys-row');
        r.dataset.command = c.id;
        r.appendChild(el('span', 'keys-command', c.title));
        const k = el('span', 'keys-keys');
        if (!keys.length) k.appendChild(el('span', 'keys-none', 'unbound'));
        for (const b of keys) {
            const chip = el('span', 'key-chip', displayKey(b.key));
            if (b.args !== undefined) chip.title = JSON.stringify(b.args);
            k.appendChild(chip);
        }
        r.appendChild(k);
        const rec = button('Record', () => record(ui, c.id, rec), 'small');
        rec.classList.add('keys-record');
        r.appendChild(rec);
        if (user.some((b) => b && (b.command === c.id || b.command === '-' + c.id))) {
            r.appendChild(button('Reset', () => {
                app.settings.setUserKeybindings(user.filter((b) => !b || (b.command !== c.id && b.command !== '-' + c.id)));
            }, 'small'));
        }
        table.appendChild(r);
    }
    return s;
}

/// Capture the next key press (with modifiers) as a binding for `command`.
function record(ui, command, btn) {
    const app = ui.app;
    btn.textContent = 'Press a key...';
    app.recordingKey = (e) => {
        const press = pressFromEvent(e);
        if (!press) return false;  // a modifier on its own: keep waiting
        app.recordingKey = null;
        if (press !== 'escape') {
            const list = [...app.settings.userKeybindings, { key: press, command }];
            app.settings.setUserKeybindings(list);
            app.toast(displayKey(press) + ' now runs ' + command);
        }
        ui.refresh();
        return true;
    };
}
