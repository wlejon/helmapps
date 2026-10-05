// Settings UI: the Profiles page. Detected shells and the user's own, side by
// side; editing a detected profile writes an override with the same name into
// settings.profiles.list, so the detected values stay underneath.

import { el, row, select, text, number, checkbox, textarea, button, section,
         parseArgsLine, formatArgsLine, parseEnvLines, formatEnvLines } from './form.js';

function editEntry(app, name, mutate) {
    return app.settings.update((obj) => {
        if (!obj.profiles || typeof obj.profiles !== 'object') obj.profiles = {};
        if (!Array.isArray(obj.profiles.list)) obj.profiles.list = [];
        let e = obj.profiles.list.find((x) => x && x.name === name);
        if (!e) { e = { name }; obj.profiles.list.push(e); }
        mutate(e, obj);
    });
}

export function renderProfiles(ui) {
    const app = ui.app;
    const s = section('Profiles', 'What a tab can run. Detected shells are found at start; edits to one are saved as an override.');
    const layout = el('div', 'profiles');
    const list = el('div', 'profile-list');
    const editor = el('div', 'profile-editor');
    layout.appendChild(list);
    layout.appendChild(editor);
    s.appendChild(layout);

    const all = app.profiles.list;
    if (!ui.profileName || !app.profiles.get(ui.profileName)) ui.profileName = all.length ? all[0].name : null;
    const def = app.profiles.defaultProfile();
    for (const p of all) {
        const item = el('div', 'profile-item' + (p.name === ui.profileName ? ' active' : '') + (p.hidden ? ' hidden' : ''));
        item.dataset.profile = p.name;
        item.appendChild(el('span', 'profile-name', p.name));
        const badges = [];
        if (p === def) badges.push('default');
        badges.push(p.source === 'user' ? 'custom' : 'detected');
        if (p.hidden) badges.push('hidden');
        item.appendChild(el('span', 'profile-badge', badges.join(' · ')));
        item.addEventListener('click', () => { ui.profileName = p.name; ui.refresh(); });
        list.appendChild(item);
    }
    const add = button('New profile', () => {
        let n = 1;
        while (app.profiles.get('Profile ' + n)) n++;
        const name = 'Profile ' + n;
        editEntry(app, name, (e) => { e.command = app.host.defaultShell(); e.args = []; });
        ui.profileName = name;
        ui.refresh();
    });
    add.id = 'profile-new';
    list.appendChild(add);

    const p = app.profiles.get(ui.profileName);
    if (p) editor.appendChild(profileEditor(ui, p));
    return s;
}

function profileEditor(ui, p) {
    const app = ui.app;
    const box = el('div');
    const user = p.source === 'user';
    const set = (k, v) => editEntry(app, p.name, (e) => { if (v === undefined || v === '') delete e[k]; else e[k] = v; });

    const nameInput = text(p.name, (v) => {
        const nv = String(v).trim();
        if (!nv || nv === p.name || app.profiles.get(nv)) return;
        editEntry(app, p.name, (e, obj) => {
            e.name = nv;
            if (obj.defaultProfile === p.name) obj.defaultProfile = nv;
        });
        ui.profileName = nv;
    }, { id: 'profile-name' });
    if (!user) nameInput.disabled = true;
    box.appendChild(row('Name', nameInput, user ? null : 'A detected profile keeps its name.'));
    box.appendChild(row('Command', text(p.command, (v) => set('command', v), { id: 'profile-command', placeholder: 'the default shell' })));
    box.appendChild(row('Arguments', text(formatArgsLine(p.args), (v) => set('args', parseArgsLine(v)), { id: 'profile-args' }),
        'Separated by spaces; "quote" an argument with spaces in it.'));
    box.appendChild(row('Starting directory', text(p.cwd || '', (v) => set('cwd', v || undefined), { id: 'profile-cwd', placeholder: '~ (home)' })));
    box.appendChild(row('Environment', textarea(formatEnvLines(p.env), (v) => set('env', parseEnvLines(v)), { id: 'profile-env', rows: 4, placeholder: 'NAME=value, one per line' })));
    box.appendChild(row('Tab title', text(p.tabTitle || '', (v) => set('tabTitle', v || undefined), { id: 'profile-tabTitle', placeholder: 'the program\'s title' })));

    const schemes = [{ value: '', label: '(default)' }, ...app.schemes.list.map((x) => x.name)];
    box.appendChild(row('Color scheme', select(schemes, p.colorScheme || '', (v) => set('colorScheme', v || undefined), 'profile-colorScheme')));
    const font = p.font || {};
    box.appendChild(row('Font family', text(font.family || '', (v) => editEntry(app, p.name, (e) => {
        e.font = { ...(e.font || {}) };
        if (v) e.font.family = v; else delete e.font.family;
    }), { id: 'profile-fontFamily', placeholder: '(default)' })));
    box.appendChild(row('Font size', number(font.size, (v) => editEntry(app, p.name, (e) => {
        e.font = { ...(e.font || {}) };
        if (v === undefined) delete e.font.size; else e.font.size = v;
    }), { min: 6, max: 72, id: 'profile-fontSize' })));
    box.appendChild(row('Cursor', select([{ value: '', label: '(default)' }, 'block', 'underline', 'bar'], p.cursorStyle || '',
        (v) => set('cursorStyle', v || undefined), 'profile-cursorStyle')));
    box.appendChild(row('Padding', number(p.padding, (v) => set('padding', v), { min: 0, max: 64, id: 'profile-padding' })));
    box.appendChild(row('Scrollback', number(p.scrollback, (v) => set('scrollback', v), { min: 0, id: 'profile-scrollback' })));
    box.appendChild(row('Hidden', checkbox(p.hidden, (v) => set('hidden', v || undefined), 'profile-hidden'),
        'Keep it out of the new-tab menu and the palette.'));

    const actions = el('div', 'button-row');
    const makeDefault = button('Make default', () => app.settings.set('defaultProfile', p.name));
    makeDefault.id = 'profile-make-default';
    actions.appendChild(makeDefault);
    actions.appendChild(button('Open a tab', () => { ui.close(); app.commands.run('newTab', { profile: p.name }); }));
    const del = button(user ? 'Delete' : 'Reset to detected', () => {
        app.settings.update((obj) => {
            if (obj.profiles && Array.isArray(obj.profiles.list)) obj.profiles.list = obj.profiles.list.filter((x) => !x || x.name !== p.name);
            if (user && obj.defaultProfile === p.name) delete obj.defaultProfile;
        });
        if (user) ui.profileName = null;
    }, 'danger');
    del.id = 'profile-delete';
    if (user || p.overridden) actions.appendChild(del);
    box.appendChild(actions);
    return box;
}
