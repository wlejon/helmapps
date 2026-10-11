// Settings: settings.json is watched and reloaded live, a broken file keeps
// the last good settings and says why, and the settings UI edits the file.

import { app, waitFor, eq, press, mod, settle, clickEl, requireApp, writeSettings, configDir } from './lib/harness.js';
import * as term from '../js/term/adapter.js';

const fs = require('fs');

function fileJson(p) {
    const text = fs.readFileSync(p, 'utf-8').replace(/^\s*\/\/.*$/mg, '');
    return JSON.parse(text);
}

if (requireApp()) {
    const ws = app.workspace;
    const st = app.settings;
    waitFor(() => ws.activePane() && ws.activePane().running, 'the first shell');

    // The files exist from the first start, in the configuration directory.
    const slash = (p) => require('path').resolve(p).replace(/\\/g, '/').toLowerCase();
    assert(slash(st.settingsPath).startsWith(slash(configDir)) && fs.existsSync(st.settingsPath),
           'settings.json created in the config dir: ' + st.settingsPath);
    assert(fs.existsSync(st.keybindingsPath), 'keybindings.json created');
    eq(st.values.colorScheme, 'Tokyo Night', 'the default scheme');

    // An edit on disk (comments, trailing commas and all) applies live.
    const pane = ws.activePane();
    const cols = pane.el.cols;
    writeSettings(`// edited by hand
{
    "colorScheme": "Campbell",   // the Windows default
    "font": { "size": 20, },
    "padding": 0,
}`);
    eq(st.values.colorScheme, 'Campbell', 'colorScheme reloaded');
    eq(st.values.font.size, 20, 'font.size reloaded');
    assert(st.values.font.family && st.values.font.family.length > 0, 'unset keys keep their defaults');
    eq(pane.scheme.name, 'Campbell', 'the open pane took the new scheme');
    eq(pane.el.style.fontSize, '20px', 'and the new font size');
    eq(pane.el.style.backgroundColor ? true : false, true, 'its background is set');
    waitFor(() => pane.el.cols < cols, 'a bigger font gives fewer columns (' + cols + ' -> ' + pane.el.cols + ')');
    eq(document.documentElement.style.getPropertyValue('--term-bg').toUpperCase(), '#0C0C0C', 'the chrome follows the scheme');

    // A broken file keeps the last good settings and reports the problem.
    const gen = st.generation;
    fs.writeFileSync(st.settingsPath, '{ "colorScheme": "Dracula", ');
    waitFor(() => st.errors.length > 0, 'the parse error to be reported');
    eq(st.values.colorScheme, 'Campbell', 'the last good settings stay');
    eq(st.generation, gen, 'a failed load is not a reload');
    assert(/settings\.json/.test(st.errors[0]), 'the error names the file: ' + st.errors[0]);
    waitFor(() => [...document.querySelectorAll('.toast.error')].some((t) => /settings\.json/.test(t.textContent)), 'a toast saying so');
    writeSettings({ colorScheme: 'Dracula', font: { size: 14 } });
    eq(st.errors.length, 0, 'fixing the file clears the error');
    eq(pane.scheme.name, 'Dracula', 'and applies it');

    // A user scheme in Windows Terminal's format joins the list.
    writeSettings({ colorScheme: 'Mine', schemes: [{ name: 'Mine', background: '#101010', foreground: '#E0E0E0', red: '#FF0000' }] });
    eq(pane.scheme.name, 'Mine', 'a user scheme can be the active one');
    eq(pane.scheme.red, '#FF0000', 'with its colours');
    eq(pane.scheme.blue, app.schemes.byName.get('Tokyo Night').blue, 'missing colours come from the base scheme');

    // ── the settings UI ──
    press(mod + '+,');
    assert(app.settingsUI.open, 'ctrl+, opens the settings');
    assert(document.querySelector('.settings'), 'the settings panel is in the document');

    // Appearance: change the cursor through the select and the font size through the field.
    clickEl(document.querySelector('.settings-nav-item[data-page="appearance"]'));
    const cursor = document.getElementById('set-cursorStyle');
    assert(cursor, 'the cursor control');
    cursor.value = 'bar';
    cursor.dispatchEvent(new Event('change'));
    eq(fileJson(st.settingsPath).cursorStyle, 'bar', 'the UI wrote cursorStyle to settings.json');
    eq(st.values.cursorStyle, 'bar', 'and it applied');
    waitFor(() => pane.el.cursor.shape === 'bar', 'the pane\'s cursor became a bar');
    eq(pane.el.options.cursorStyle, 'bar', 'options.cursorStyle took effect');

    // Cursor blink through UI
    const blink = document.getElementById('set-cursorBlink');
    assert(blink, 'the cursor blink control');
    blink.checked = false;
    blink.dispatchEvent(new Event('change'));
    eq(fileJson(st.settingsPath).cursorBlink, false, 'cursorBlink written');
    eq(st.values.cursorBlink, false, 'cursorBlink setting applied');
    eq(pane.el.options.cursorBlink, false, 'options.cursorBlink took effect');

    // Scrollback through UI
    const sb = document.getElementById('set-scrollback');
    assert(sb, 'the scrollback control');
    sb.value = '50000';
    sb.dispatchEvent(new Event('change'));
    eq(fileJson(st.settingsPath).scrollback, 50000, 'scrollback written');
    eq(pane.el.options.scrollback, 50000, 'options.scrollback took effect');

    // Direct applyCursor and applyScrollback via options
    term.applyCursor(pane.el, 'underline', true);
    eq(pane.el.options.cursorStyle, 'underline', 'applyCursor configured options.cursorStyle');
    eq(pane.el.options.cursorBlink, true, 'applyCursor configured options.cursorBlink');
    term.applyScrollback(pane.el, 30000);
    eq(pane.el.options.scrollback, 30000, 'applyScrollback configured options.scrollback');

    // Previewing effective palette in settings UI
    const preview = document.querySelector('.scheme-preview');
    assert(preview, 'preview element exists');
    assert(preview.dataset.effective === 'true', 'preview marks effective palette');
    assert(app.settingsUI.activePalette, 'settingsUI inspects active palette');
    eq(app.settingsUI.activePalette.foreground, pane.palette.foreground, 'settingsUI activePalette foreground matches pane.palette');

    const size = document.getElementById('set-fontSize');
    size.value = '16';
    size.dispatchEvent(new Event('change'));
    eq(fileJson(st.settingsPath).font.size, 16, 'font.size written');
    eq(pane.el.style.fontSize, '16px', 'and applied');
    eq(fileJson(st.settingsPath).schemes[0].name, 'Mine', 'keys the UI did not touch survive its writes');

    // General: a checkbox.
    clickEl(document.querySelector('.settings-nav-item[data-page="general"]'));
    const restore = document.getElementById('set-restoreSession');
    restore.checked = false;
    restore.dispatchEvent(new Event('change'));
    eq(fileJson(st.settingsPath).restoreSession, false, 'restoreSession written');

    // Profiles: a new profile, edited, made the default.
    clickEl(document.querySelector('.settings-nav-item[data-page="profiles"]'));
    clickEl(document.getElementById('profile-new'));
    const created = fileJson(st.settingsPath).profiles.list.find((p) => /^Profile \d+$/.test(p.name));
    assert(created, 'New profile adds one to profiles.list');
    const name = created.name;
    const args = document.getElementById('profile-args');
    args.value = '-x "a b" c';
    args.dispatchEvent(new Event('change'));
    eq(fileJson(st.settingsPath).profiles.list.find((p) => p.name === name).args, ['-x', 'a b', 'c'], 'arguments parsed with quotes');
    const env = document.getElementById('profile-env');
    env.value = 'A=1\nB=two words';
    env.dispatchEvent(new Event('change'));
    eq(fileJson(st.settingsPath).profiles.list.find((p) => p.name === name).env, { A: '1', B: 'two words' }, 'environment lines');
    clickEl(document.getElementById('profile-make-default'));
    eq(fileJson(st.settingsPath).defaultProfile, name, 'Make default');
    eq(app.profiles.defaultProfile().name, name, 'the new default applies');
    clickEl(document.getElementById('profile-delete'));
    assert(!fileJson(st.settingsPath).profiles.list.some((p) => p.name === name), 'Delete removes it');
    assert(!fileJson(st.settingsPath).defaultProfile, 'and the default that named it');

    // An edit on disk while the UI is open shows up in it.
    clickEl(document.querySelector('.settings-nav-item[data-page="appearance"]'));
    const obj = fileJson(st.settingsPath);
    obj.colorScheme = 'Nord';
    writeSettings(obj);
    eq(document.getElementById('set-colorScheme').value, 'Nord', 'the open UI shows the file\'s new value');

    press('escape');
    assert(!app.settingsUI.open, 'Escape closes the settings');
    settle(100);
    console.log('test_settings: finished');
}
