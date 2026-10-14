// Search tests:
// 1. Typing in the search field (Mod+F) filters the current folder live by name.
// 2. Pressing Enter runs an async recursive search below the current folder.
// 3. Pressing Escape clears the search and restores the normal folder view.

import { app, waitFor, eq, press, type, fixtureDir, mod } from '/lib/test.js';

const dir = fixtureDir({
  'invoice_2025.pdf': 'pdf1',
  'notes.txt': 'text',
  'summary.md': 'md',
  'archive/2024/invoice_2024.pdf': 'pdf2',
  'archive/deep/nested_invoice.txt': 'inv3',
});

app.views.setViewMode('list');
app.openPath(dir);
waitFor(() => app.state.currentPath === dir && app.state.done && app.list.items.length === 4, 'folder loaded');

const names = () => app.list.items.map((it) => it.name);

// 1. Focus search with Mod+F and type to filter the current folder.
press(`${mod}+f`);
eq(document.activeElement, app.search.input, 'Mod+F focused search input');

type('invoice');
waitFor(() => app.list.items.length === 1, 'filtered current folder to 1 matching item');
eq(names(), ['invoice_2025.pdf'], 'live filter matched invoice_2025.pdf');

// 2. Press Enter to search recursively below the current folder.
press('enter');
waitFor(() => app.state.searchRecursive && !app.state.searching && app.list.items.length === 3,
  'recursive search found all 3 invoice files across subdirectories');
eq(names().slice().sort(), ['invoice_2024.pdf', 'invoice_2025.pdf', 'nested_invoice.txt'],
  'recursive search results include nested matches');
assert(!app.search.bannerEl.classList.contains('hidden'), 'search results banner is shown');

// 3. Press Escape to clear the search and restore the folder listing.
press('escape');
waitFor(() => !app.state.searchRecursive && app.state.filterQuery === '' && app.list.items.length === 4,
  'Escape cleared search and restored all 4 entries in root folder');
assert(app.search.bannerEl.classList.contains('hidden'), 'search banner hidden after Escape');

console.log('test_search PASSED');
