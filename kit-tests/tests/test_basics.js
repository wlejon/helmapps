// The kit's pure parts: chords, commands, settings, formatting, icons, h().

import { app, eq, press, mod } from '/lib/test.js';
import { normalizeChord, Commands } from '/lib/commands.js';
import { formatBytes, formatCount, formatNumber, formatDuration, formatDate } from '/lib/format.js';
import { iconNames, hasIcon, icon } from '/lib/icons.js';
import { h } from '/lib/dom.js';
import { kindOf, iconFor, userDirs, openApp, appsReady } from '/lib/files.js';

// Chords
const M = process.platform === 'darwin' ? 'Meta' : 'Ctrl';
eq(normalizeChord('shift+mod+z'), `${M}+Shift+Z`, 'mods ordered, Mod resolved');
eq(normalizeChord('Ctrl+Alt+Delete'), 'Ctrl+Alt+Delete', 'named key kept');
eq(normalizeChord('f2'), 'F2', 'a function key in any case');
eq(normalizeChord('alt+left'), 'Alt+ArrowLeft', 'arrow shorthand');
eq(normalizeChord('delete'), 'Delete', 'named keys take KeyboardEvent.key spelling');
eq(normalizeChord('Mod++'), `${M}++`, 'a plus key');

// Commands: enabled, checked, run, keys
const c = new Commands();
let ran = 0;
let on = false;
let allowed = true;
c.add({ id: 'go', label: 'Go', keys: ['Mod+G'], enabled: () => allowed, run: () => { ran++; return 'went'; } });
c.add({ id: 'tog', label: 'Toggle', checked: () => on, run: () => { on = !on; } });
eq(c.run('go'), 'went', 'run answers the result');
allowed = false;
eq(c.run('go'), undefined, 'a disabled command does not run');
eq(c.item('go').disabled, true, 'its menu item is disabled');
allowed = true;
eq(c.item('tog').checked, false, 'checked state in the item');
c.run('tog');
eq(c.item('tog').checked, true, 'and it follows');
eq(c.keysFor('go'), `${M}+G`, 'display keys');

// The app's registry gets real key events.
let appRan = 0;
app.commands.add({ id: 'k', label: 'K', keys: ['Mod+K'], run: () => { appRan++; } });
press(`${mod}+k`);
eq(appRan, 1, 'Mod+K through the engine runs the command');
const field = h('input.field');
document.body.appendChild(field);
field.focus();
press(`${mod}+k`);
eq(appRan, 1, 'not while typing in a field (inText is false)');
field.remove();

// Settings (bro.conf or the memory fallback; both behave the same)
eq(app.settings.get('flag'), false, 'bool default');
eq(app.settings.get('n'), 3, 'int default');
eq(app.settings.get('obj'), { a: 1 }, 'json default');
let seen = null;
const off = app.settings.watch('obj', (v) => { seen = v; });
app.settings.set('obj', { a: 2, b: [1, 2] });
eq(app.settings.get('obj'), { a: 2, b: [1, 2] }, 'json round trip');
eq(seen, { a: 2, b: [1, 2] }, 'watchers hear it');
off();
const got = app.settings.get('obj');
got.a = 99;
eq(app.settings.get('obj').a, 2, 'get answers a copy');
app.settings.reset('obj');
eq(app.settings.get('obj'), { a: 1 }, 'reset to default');

// Formatting
eq(formatBytes(0), '0 B', 'zero bytes');
eq(formatBytes(1536), '1.5 KB', 'KB');
eq(formatBytes(5 * 1024 * 1024 * 1024), '5.0 GB', 'GB');
eq(formatBytes(150 * 1024 * 1024), '150 MB', 'three digits drop the decimal');
eq(formatCount(1, 'file'), '1 file', 'singular');
eq(formatCount(1234, 'file'), '1,234 files', 'plural with grouping');
eq(formatNumber(1234567.891), '1,234,567.89', 'number grouping');
eq(formatDuration(65), '1:05', 'm:ss');
eq(formatDuration(3725), '1:02:05', 'h:mm:ss');
const now = new Date(2026, 9, 9, 15, 0, 0).getTime();
assert(formatDate(new Date(2026, 9, 9, 9, 5).getTime(), now).startsWith('Today '), 'today');
assert(formatDate(new Date(2026, 9, 8, 9, 5).getTime(), now).startsWith('Yesterday '), 'yesterday');
eq(formatDate(new Date(2026, 2, 4).getTime(), now), 'Mar 4', 'this year');
eq(formatDate(new Date(2023, 2, 4).getTime(), now), 'Mar 4, 2023', 'another year');

// Icons and h()
assert(iconNames().length > 120, 'a full icon set');
assert(hasIcon('folder') && !hasIcon('no-such-icon'), 'hasIcon');
eq(icon('folder').tagName.toLowerCase(), 'svg', 'icon() is an svg');
const el = h('button.btn.primary#ok', { title: 'OK', dataset: { x: '1' } }, 'Go', null, [h('span', 'a')]);
eq([el.tagName.toLowerCase(), el.className, el.id, el.title, el.dataset.x, el.textContent], ['button', 'btn primary', 'ok', 'OK', '1', 'Goa'], 'h()');

// Files
eq([kindOf('a.PNG'), kindOf('x.tar.gz'), kindOf('main.cpp'), kindOf('dir', true), kindOf('noext')],
  ['image', 'archive', 'code', 'folder', 'file'], 'kinds');
eq(iconFor({ name: 'song.flac' }), 'file-audio', 'icon for a kind');
assert(userDirs().home && userDirs().pictures.startsWith(userDirs().home), 'user dirs under home');

// Opening another app by id: bro.app.open, which headless records
// (openedApps()) and does not start. helm.music is a sibling in this project.
let opened = null;
openApp('helm.music', ['--play', 'x.flac']).then((ok) => { opened = ok; });
let missing = null;
openApp('helm.no-such-app').then((ok) => { missing = ok; });
for (let i = 0; i < 5 && (opened === null || missing === null); i++) advanceTime(16);
eq([opened, missing], [true, false], 'openApp opens a project sibling, and answers false for an unknown id');
const rec = openedApps({ clear: true }).find((o) => o.id === 'helm.music');
assert(rec && rec.from === 'project' && /music$/.test(rec.dir.replace(/[\\/]+$/, '')), 'found beside this app: ' + JSON.stringify(rec));
eq(rec.args, ['--play', 'x.flac'], 'with its arguments');

let ready = false;
appsReady().then(() => { ready = true; });
for (let i = 0; i < 400 && !ready; i++) { advanceTime(16); wallSleep(5); }
assert(ready, 'appsReady() resolves once the catalog is built');

console.log('test_basics PASSED');
