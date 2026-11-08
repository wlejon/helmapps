// The mouse's way around: the nav bar over a photo (big Previous / Next side
// by side at the bottom centre, back to the grid, Leave Full Screen in full
// screen) runs the same commands as the keys, which still work; and Browse
// by Date: the Dates calendar counts the photos of each day (the file's
// modified day here, no Find Animals records), a day or the month's name
// filters the grid, the strip and Next / Previous, All dates shows every
// photo again. Scrollbars there are wide (scrollbar-width).

import { app, waitFor, eq, press, clickEl, fixtureDir } from '/lib/test.js';
import { jpeg, shown } from '/app/tests/images.js';

const fs = require('fs');
const path = require('path');

app.settings.set('findAnimals', false);
const names = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'f.jpg'];
const tree = {};
for (const n of names) tree[n] = jpeg(40, 30);
const dir = fixtureDir(tree);
// Noon local: three on Oct 5, two on Oct 7, one on Sep 20.
const at = (m, d) => new Date(2026, m - 1, d, 12, 0, 0) / 1000;
const when = { 'a.jpg': at(10, 5), 'b.jpg': at(10, 5), 'c.jpg': at(10, 5), 'd.jpg': at(10, 7), 'e.jpg': at(10, 7), 'f.jpg': at(9, 20) };
for (const n of names) fs.utimesSync(path.join(dir, n), when[n], when[n]);

// ---- the nav bar --------------------------------------------------------------------

app.openPath(path.join(dir, 'b.jpg'));
shown(app, waitFor, 'b.jpg');
waitFor(() => app.folder.items.length === 6, 'the folder listed');
const nav = document.querySelector('.iv-nav');
assert(nav && !nav.closest('.hidden'), 'the nav bar shows over a photo');
const btn = (cmd) => nav.querySelector(`[data-command="${cmd}"]`);
const prev = btn('prev').getBoundingClientRect(), next = btn('next').getBoundingClientRect();
assert(prev.width >= 64 && prev.height >= 60, `big targets: ${prev.width}x${prev.height}`);
assert(next.left - prev.right < 140, `Previous and Next side by side (${Math.round(next.left - prev.right)} px apart)`);
const view = document.querySelector('.iv-view').getBoundingClientRect();
assert(Math.abs((prev.left + next.right) / 2 - (view.left + view.right) / 2) < 80, 'at the centre');
assert(prev.bottom > view.bottom - 120, 'at the bottom');
eq(nav.querySelector('.iv-nav-pos').textContent, '2 / 6', 'where she is');
clickEl(btn('next'));
shown(app, waitFor, 'c.jpg', 'Next on the bar');
clickEl(btn('prev'));
clickEl(btn('prev'));
shown(app, waitFor, 'a.jpg', 'Previous on the bar, twice');
press('right');
shown(app, waitFor, 'b.jpg', 'the keys still step');
assert(btn('exit-fullscreen').classList.contains('hidden'), 'no Leave Full Screen out of full screen');
clickEl(btn('show-folder'));
waitFor(() => app.state.mode === 'grid', 'the grid button shows the folder');

// ---- wide scrollbars ------------------------------------------------------------------

eq(getComputedStyle(app.grid.scroller).getPropertyValue('scrollbar-width').trim(), '18px', 'the grid\'s bar is wide');

// ---- Browse by date ---------------------------------------------------------------------

const datesBtn = document.querySelector('.iv-dates-btn');
assert(datesBtn && !datesBtn.classList.contains('hidden'), 'the Dates button shows');
waitFor(() => app.dates.mtimes.size === 6, 'the photos\' days read');
clickEl(datesBtn);
const cal = () => document.querySelector('.iv-cal');
assert(cal(), 'the calendar opens');
eq(cal().querySelector('.iv-cal-title').textContent, 'October 20265', 'the latest month with photos, and its count');
const days = () => Array.from(cal().querySelectorAll('.iv-cal-day.has')).map((d) => d.textContent);
eq(days(), ['53', '72'], 'the days with photos and their counts');
const grid = () => app.grid.items.map((it) => it.name).join();
clickEl(cal().querySelectorAll('.iv-cal-day.has')[0]);
assert(!cal(), 'a day picked: the calendar closes');
eq(grid(), 'a.jpg,b.jpg,c.jpg', 'the grid shows that day');
eq(datesBtn.textContent, 'Oct 5, 2026', 'the button says the day');
assert(document.querySelector('.statusbar').textContent.includes('October 5, 2026'), 'and the status bar');

// Over a photo, Next stays within the day.
app.openImage(path.join(dir, 'c.jpg'));
shown(app, waitFor, 'c.jpg');
press('right');
shown(app, waitFor, 'a.jpg', 'Next wraps within the day');

// The earlier month by its arrow, the whole month by its name; a day picked over a photo shows the grid.
clickEl(datesBtn);
clickEl(cal().querySelector('.iv-cal-arrow'));
eq(cal().querySelector('.iv-cal-title').textContent, 'September 20261', 'the earlier month with photos');
clickEl(cal().querySelector('.iv-cal-title'));
waitFor(() => app.state.mode === 'grid', 'picked over a photo: the grid');
eq(grid(), 'f.jpg', 'the month');
eq(datesBtn.textContent, 'Sep 2026', 'the button says the month');

// Escape closes the calendar and nothing else.
clickEl(datesBtn);
press('escape');
assert(!cal(), 'Escape closes it');
eq(app.state.mode, 'grid', 'and leaves the grid be');

// Dates arriving while a day is pressed (a folder still being read) leave its
// button in place, so the release still picks it.
clickEl(datesBtn);
clickEl(cal().querySelectorAll('.iv-cal-arrow')[1]);  // back to October
const day5 = cal().querySelectorAll('.iv-cal-day.has')[0];
const r5 = day5.getBoundingClientRect();
mouseDown(r5.left + r5.width / 2, r5.top + r5.height / 2, 0);
for (let i = 0; i < 3; i++) { app.dates.recordsChanged(); advanceTime(16); }
assert(cal().querySelectorAll('.iv-cal-day.has')[0] === day5, 'the pressed day is the same button after dates arrive');
mouseUp(r5.left + r5.width / 2, r5.top + r5.height / 2, 0);
advanceTime(16);
assert(!cal(), 'the release picks the day');
eq(datesBtn.textContent, 'Oct 5, 2026', 'the day pressed while dates arrived');

// All dates.
clickEl(datesBtn);
clickEl(cal().querySelector('.iv-cal-all'));
eq(grid(), names.join(), 'every photo again');
eq(datesBtn.textContent, 'Dates', 'the button too');

console.log('test_dates_nav PASSED');
