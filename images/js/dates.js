/**
 * Browse by date: a Dates button in the toolbar opens a month calendar of
 * the folder's photos. Each day with photos shows how many and is a click
 * to show that day; the month's name shows the whole month; All dates shows
 * every photo again. The choice filters the grid, the strip and Next /
 * Previous like the Animals menu does, after it (items()), and the counts
 * are of the photos the Animals filter shows.
 *
 * A photo's day is the camera's own: the date in its EXIF (Find Animals'
 * record keeps it) as the camera wrote it, else the day of the file's
 * modified time, local (a camera writes the file as it shoots). The
 * modified times are read in the background (fs.promises.stat, on brokit's
 * I/O threads) once a folder is listed.
 *
 *   const dates = new DateFilter({ folder, recordOf, onChange, onPick });
 *   dates.items(list)        list, filtered to the chosen day or month
 *   dates.button             the toolbar's button
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { formatNumber } from '/lib/format.js';

const fs = require('fs');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATS_AT_ONCE = 32;

const pad = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' of a time, local. */
export function dayOfTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 'YYYY-MM-DD' of an EXIF date as the camera wrote it ('2026-10-05T11:34:38-05:00', '2026:10:05 11:34:38'), or ''. */
export function dayOfExif(s) {
  const m = typeof s === 'string' && /^(\d{4})[-:](\d\d)[-:](\d\d)/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
/** "October 5, 2026" / "October 2026" for a day or month key. */
export function dateText(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  return d ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${y}`;
}
/** "Oct 5, 2026" / "Oct 2026": the button's shorter form. */
function shortText(key) {
  const [y, m, d] = key.split('-').map(Number);
  const mon = MONTHS[m - 1].slice(0, 3);
  return d ? `${mon} ${d}, ${y}` : `${mon} ${y}`;
}

export class DateFilter {
  /**
   * folder: js/folder.js; recordOf(path): Find Animals' record or null;
   * onChange(): what is shown changed (a choice, or days learnt);
   * onPick(): she chose a day or a month (the app shows the grid).
   */
  constructor({ folder, recordOf = () => null, onChange = () => {}, onPick = () => {} }) {
    this.folder = folder;
    this.recordOf = recordOf;
    this.onChange = onChange;
    this.onPick = onPick;
    this.key = '';                 // '' for every date, 'YYYY-MM' a month, 'YYYY-MM-DD' a day
    this.mtimes = new Map();       // path -> mtime ms
    this.statDir = '';
    this.statVersion = -1;
    this.version = 0;              // bumped when a photo's day may have changed
    this.cache = { src: null, key: '', version: -1, items: null };
    this.month = '';               // the month the calendar shows, 'YYYY-MM'
    this.list = [];                // the items the calendar counts (the Animals filter's)
    this.label = h('span.ellipsis', 'Dates');
    this.button = h('button.btn.ghost.small.iv-dates-btn', { 'data-tip': 'Browse by date', onclick: () => this.toggle() },
      icon('calendar'), this.label);
    this.pop = null;
    this.closeOnOutside = (e) => {
      if (this.pop && !this.pop.contains(e.target) && !this.button.contains(e.target)) this.close();
    };
    this.closeOnEscape = (e) => {
      if (e.key !== 'Escape' || !this.pop) return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    };
  }

  // ---- the photos' days ------------------------------------------------------------

  /** A photo's day ('YYYY-MM-DD'), or '' while it is not known. */
  dayOf(p) {
    const rec = this.recordOf(p);
    if (rec && !rec.error) {
      const d = rec.exif ? dayOfExif(rec.exif.dateTaken) : '';
      if (d) return d;
      if (rec.time) return dayOfTime(rec.time);
    }
    const t = this.mtimes.get(p);
    return t ? dayOfTime(t) : '';
  }

  /** The folder's list changed: read the modified times not known yet. */
  folderChanged() {
    const f = this.folder;
    if (f.dir !== this.statDir) { this.statDir = f.dir; this.mtimes.clear(); if (this.key) this.key = ''; this.month = ''; }
    if (f.version === this.statVersion) return;
    this.statVersion = f.version;
    const todo = f.items.map((it) => it.path).filter((p) => !this.mtimes.has(p));
    if (todo.length) this.stat(f.dir, todo);
  }

  async stat(dir, paths) {
    let next = 0;
    const one = async () => {
      while (next < paths.length && this.statDir === dir) {
        const p = paths[next++];
        try { this.mtimes.set(p, (await fs.promises.stat(p)).mtimeMs); } catch (_) { /* gone: no day */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(STATS_AT_ONCE, paths.length) }, one));
    if (this.statDir !== dir) return;
    this.daysChanged();
  }

  /** Days may have changed (modified times read): the shown photos follow. */
  daysChanged() {
    this.recordsChanged();
    if (this.key) this.onChange();
  }

  /** Find Animals' records changed (their EXIF dates): the next items() and the calendar count again. */
  recordsChanged() {
    this.version++;
    if (this.pop) this.render();
  }

  // ---- the filter ------------------------------------------------------------------

  /** `list` with only the chosen day's or month's photos; `list` itself when every date shows. */
  items(list) {
    this.list = list;
    if (!this.key) return list;
    const c = this.cache;
    if (c.src === list && c.key === this.key && c.version === this.version) return c.items;
    const out = list.filter((it) => this.dayOf(it.path).startsWith(this.key));
    // The same photos: the last array, so nothing redraws.
    const same = c.items && c.items.length === out.length && c.items.every((it, i) => it === out[i]);
    this.cache = { src: list, key: this.key, version: this.version, items: same ? c.items : out };
    return this.cache.items;
  }

  /** Show a day ('YYYY-MM-DD'), a month ('YYYY-MM'), or every date (''). */
  set(key) {
    key = key || '';
    if (key === this.key) return;
    this.key = key;
    if (key) this.month = key.slice(0, 7);
    this.label.textContent = key ? shortText(key) : 'Dates';
    this.button.classList.toggle('active', !!key);
    this.onChange();
    if (this.pop) this.render();
  }

  /** The chosen dates as the status bar says them ('' for all). */
  text() {
    return dateText(this.key);
  }

  // ---- the calendar ------------------------------------------------------------------

  toggle() {
    if (this.pop) this.close();
    else this.open();
  }

  open() {
    if (this.pop) return;
    this.pop = h('div.iv-cal', { role: 'dialog', 'aria-label': 'Browse by date' });
    document.body.appendChild(this.pop);
    this.render();
    const r = this.button.getBoundingClientRect();
    const w = this.pop.getBoundingClientRect().width;
    this.pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    this.pop.style.top = `${r.bottom + 6}px`;
    window.addEventListener('pointerdown', this.closeOnOutside, true);
    window.addEventListener('keydown', this.closeOnEscape, true);
  }

  close() {
    if (!this.pop) return;
    this.pop.remove();
    this.pop = null;
    window.removeEventListener('pointerdown', this.closeOnOutside, true);
    window.removeEventListener('keydown', this.closeOnEscape, true);
  }

  /** How many photos of the counted list fall on each day, and the months that have any (sorted). */
  tally() {
    const days = new Map();
    for (const it of this.list) {
      const d = this.dayOf(it.path);
      if (d) days.set(d, (days.get(d) || 0) + 1);
    }
    const months = [...new Set([...days.keys()].map((d) => d.slice(0, 7)))].sort();
    return { days, months };
  }

  /** The calendar's contents for the month it shows. */
  render() {
    const { days, months } = this.tally();
    if (!this.month || (!months.includes(this.month) && months.length && !this.key)) this.month = months[months.length - 1] || '';
    const pick = (key) => { this.set(key); this.close(); this.onPick(key); };
    const kids = [];
    if (!this.month) {
      kids.push(h('div.iv-cal-empty', this.list.length ? 'Reading the photos’ dates…' : 'No photos'));
    } else {
      const [y, m] = this.month.split('-').map(Number);
      const listed = months.includes(this.month);
      // The arrows go to the month before or after with photos.
      const before = months.filter((x) => x < this.month).pop() || '';
      const after = months.find((x) => x > this.month) || '';
      const go = (to) => { if (to) { this.month = to; this.render(); } };
      let monthCount = 0;
      for (const [d, n] of days) if (d.startsWith(this.month)) monthCount += n;
      kids.push(h('div.iv-cal-head',
        h('button.iv-cal-arrow', { 'aria-label': 'Earlier month', title: before ? dateText(before) : '', disabled: !before, onclick: () => go(before) }, icon('chevron-left')),
        h(`button.iv-cal-title${this.key === this.month ? '.active' : ''}`, { title: 'Show the whole month', disabled: !monthCount,
          onclick: () => pick(this.month) },
        h('span', `${MONTHS[m - 1]} ${y}`), monthCount ? h('span.iv-cal-count.num', formatNumber(monthCount)) : null),
        h('button.iv-cal-arrow', { 'aria-label': 'Later month', title: after ? dateText(after) : '', disabled: !after, onclick: () => go(after) }, icon('chevron-right'))));
      const grid = h('div.iv-cal-grid');
      for (const w of WEEKDAYS) grid.appendChild(h('div.iv-cal-wd', w));
      const first = new Date(y, m - 1, 1).getDay();
      const count = new Date(y, m, 0).getDate();
      for (let k = 0; k < first; k++) grid.appendChild(h('div.iv-cal-pad'));
      for (let d = 1; d <= count; d++) {
        const key = `${this.month}-${pad(d)}`;
        const n = days.get(key) || 0;
        grid.appendChild(n
          ? h(`button.iv-cal-day.has${this.key === key ? '.active' : ''}`, { title: `${dateText(key)} · ${formatNumber(n)} photos`,
            onclick: () => pick(key) }, h('span.iv-cal-d', String(d)), h('span.iv-cal-count.num', formatNumber(n)))
          : h('div.iv-cal-day', h('span.iv-cal-d', String(d))));
      }
      kids.push(grid);
      if (!listed) kids.push(h('div.iv-cal-empty', 'No photos this month'));
    }
    kids.push(h('div.iv-cal-foot',
      h(`button.btn.iv-cal-all${this.key ? '' : '.active'}`, { onclick: () => pick('') }, 'All dates')));
    this.pop.replaceChildren(...kids);
  }
}
