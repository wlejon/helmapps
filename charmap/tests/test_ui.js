/**
 * Headless UI acceptance tests for Character Map (helm.charmap):
 * - Sidebar block navigation
 * - VirtualList selection and Inspector encoding display
 * - Favorite toggling and Favorites collection view
 * - Copy Buffer assembly, character count, copy, and clear
 * - Grid / List view switching and zoom slider
 * - Keyboard shortcuts
 */

import { app, waitFor, settle, eq, press, clickEl } from '/lib/test.js';

waitFor(() => app && app.list && app.list.items.length > 0, 'initial block to render');

// ---- 1. Sidebar block navigation --------------------------------------------

const sidebarButtons = Array.from(document.querySelectorAll('.sidebar-item'));
assert(sidebarButtons.length >= 24, `sidebar has collections + blocks (got ${sidebarButtons.length})`);

const mathBtn = sidebarButtons.find((b) => b.textContent.includes('Mathematical Operators'));
assert(mathBtn, 'sidebar has Mathematical Operators item');
clickEl(mathBtn);
eq(app.state.blockId, 'math', 'clicking Mathematical Operators selects math block');
eq(app.list.items.length, 256, 'Mathematical Operators block has 256 characters');

// ---- 2. Selecting a character & verifying Inspector -------------------------

app.selectCodepoint(0x221E); // INFINITY (∞)
advanceTime(16);

eq(app.state.selectedCp, 0x221E, 'selected codepoint is U+221E');
assert(app.inspector.current && app.inspector.current.cp === 0x221E, 'inspector holds U+221E');

const getEncText = (id) => {
  const el = document.querySelector(`[data-encoding="${id}"]`);
  return el ? el.textContent : '';
};

eq(getEncText('char'), '∞', 'inspector shows character ∞');
eq(getEncText('codepoint'), 'U+221E', 'inspector shows codepoint U+221E');
eq(getEncText('utf8'), 'E2 88 9E', 'inspector shows UTF-8 bytes E2 88 9E');
eq(getEncText('utf16'), '221E', 'inspector shows UTF-16 units 221E');
assert(getEncText('html').includes('&infin;') && getEncText('html').includes('&#x221E;'), 'inspector shows HTML entities');
eq(getEncText('css'), '\\221E', 'inspector shows CSS escape \\221E');
eq(getEncText('js'), '\\u221E', 'inspector shows JS escape \\u221E');

// Click copy button on UTF-8 row
const copyUtf8Btn = document.querySelector('[data-encoding-copy="utf8"]');
assert(copyUtf8Btn, 'UTF-8 copy button exists');
clickEl(copyUtf8Btn);
settle(50);
eq(app.state.lastCopied, 'E2 88 9E', 'clicking UTF-8 copy button copies E2 88 9E');

// ---- 3. Favorites toggle & Favorites category -------------------------------

const testCp = 0x2207; // NABLA (∇)
app.selectCodepoint(testCp);
advanceTime(16);
const wasFav = app.isFavorite(testCp);
clickEl(app.inspector.favBtn);
eq(app.isFavorite(testCp), !wasFav, 'clicking inspector favorite button toggles favorite state');

if (!app.isFavorite(testCp)) clickEl(app.inspector.favBtn);
assert(app.isFavorite(testCp), 'U+2207 is now a favorite');

app.selectBlock('favorites');
advanceTime(16);
assert(app.list.items.some((x) => x.cp === testCp), 'Favorites block lists newly favorited U+2207');

// Toggle off with Mod+D shortcut
app.selectCodepoint(testCp);
press('mod+d');
eq(app.isFavorite(testCp), false, 'Mod+D removes U+2207 from favorites');

// ---- 4. Copy Buffer assembly ------------------------------------------------

app.clearBuffer();
eq(app.state.buffer, '', 'buffer starts empty');

// Assemble "α + β → ∞"
app.appendToBuffer(0x03B1); // α
app.appendToBuffer(0x0020);
app.appendToBuffer(0x002B); // +
app.appendToBuffer(0x0020);
app.appendToBuffer(0x03B2); // β
app.appendToBuffer(0x0020);
app.appendToBuffer(0x2192); // →
app.appendToBuffer(0x0020);
app.appendToBuffer(0x221E); // ∞
advanceTime(16);

eq(app.state.buffer, 'α + β → ∞', 'buffer assembled α + β → ∞');
eq(app.bufferInput.value, 'α + β → ∞', 'buffer input value matches');
const countLabel = document.querySelector('.cm-buffer-count').textContent;
eq(countLabel, '9 chars', 'buffer count label shows 9 chars');

// Copy Buffer via Copy Buffer button and keyboard shortcut
clickEl(document.querySelector('.cm-copy-buffer-btn'));
settle(30);
eq(app.state.lastCopied, 'α + β → ∞', 'Copy Buffer button copies the entire buffer');

app.state.lastCopied = '';
press('mod+shift+b');
settle(30);
eq(app.state.lastCopied, 'α + β → ∞', 'Mod+Shift+B shortcut copies the entire buffer');

// Recently copied includes characters appended/copied
app.selectBlock('recent');
advanceTime(16);
assert(app.list.items.some((x) => x.cp === 0x221E), 'Recently Copied includes ∞');

// Clear buffer button
clickEl(document.querySelector('.cm-clear-buffer-btn'));
eq(app.state.buffer, '', 'Clear button empties the buffer');

// ---- 5. Grid vs List view & Zoom --------------------------------------------

app.selectBlock('arrows');
advanceTime(16);
eq(app.state.view, 'grid', 'starts in grid view');
assert(document.querySelectorAll('.vgrid-cell').length > 0, 'grid view renders .vgrid-cell elements');

// Switch to list view with Mod+2
press('mod+2');
eq(app.state.view, 'list', 'Mod+2 switches to list view');
assert(!document.querySelector('.list-header').classList.contains('hidden'), 'list header is visible in list view');
assert(document.querySelectorAll('.vlist-row').length > 0, 'list view renders .vlist-row elements');

// Switch back to grid view with Mod+1
press('mod+1');
eq(app.state.view, 'grid', 'Mod+1 switches back to grid view');

const z0 = app.state.zoom;
press('mod+=');
eq(app.state.zoom, Math.min(120, z0 + 8), 'Mod+= zooms in grid cells');
press('mod+-');
eq(app.state.zoom, z0, 'Mod+- zooms out grid cells');

// ---- 6. Search & Inspector toggle shortcuts ---------------------------------

press('mod+f');
eq(document.activeElement, app.searchInput, 'Mod+F focuses the search input');

app.setSearch('euro');
advanceTime(16);
assert(app.list.items.length > 0 && app.list.items[0].cp === 0x20AC, 'live search "euro" selects U+20AC');

press('escape');
eq(app.state.query, '', 'Escape clears the active search');

const inspBefore = app.state.showInspector;
press('mod+i');
eq(app.state.showInspector, !inspBefore, 'Mod+I toggles the inspector panel');
press('mod+i');
eq(app.state.showInspector, inspBefore, 'second Mod+I restores the inspector panel');

console.log('test_ui PASSED');
