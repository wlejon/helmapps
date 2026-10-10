/**
 * Formatting for display: sizes, counts, dates, durations. The same value
 * reads the same way in every helm app.
 *
 *   formatBytes(1536)            '1.5 KB'
 *   formatCount(3, 'item')       '3 items'
 *   formatDate(ms)               'Today 14:02' / 'Yesterday 09:15' / 'Mar 4' / 'Mar 4, 2023'
 *   formatDuration(3725)         '1:02:05'   (seconds)
 *   formatRelative(ms)           'now' / '5m ago' / '3h ago' / '2d ago'
 */

import { shellPref } from './settings.js';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Bytes in powers of 1024 with KB/MB/GB labels (what file managers show). */
export function formatBytes(n, digits = 1) {
  if (n == null || !isFinite(n)) return '—';
  let v = Math.abs(n);
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) { v /= 1024; u++; }
  const s = u === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : digits);
  return `${n < 0 ? '-' : ''}${s} ${UNITS[u]}`;
}

/** '1 item' / '3 items'; plural defaults to singular + 's'. */
export function formatCount(n, singular, plural) {
  return `${formatNumber(n)} ${n === 1 ? singular : (plural || `${singular}s`)}`;
}

/** 12345 → '12,345'. */
export function formatNumber(n) {
  if (n == null || !isFinite(n)) return '—';
  const [i, f] = String(Math.round(n * 100) / 100).split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return f ? `${grouped}.${f}` : grouped;
}

export function formatPercent(fraction, digits = 0) {
  return `${(fraction * 100).toFixed(digits)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The time of day, following the shell's 24-hour setting. */
export function formatTime(d, { seconds = false } = {}) {
  d = d instanceof Date ? d : new Date(d);
  let m = String(d.getMinutes()).padStart(2, '0');
  if (seconds) m += `:${String(d.getSeconds()).padStart(2, '0')}`;
  if (shellPref('use24h')) return `${String(d.getHours()).padStart(2, '0')}:${m}`;
  const hr = d.getHours() % 12 || 12;
  return `${hr}:${m} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** A timestamp (ms or Date) compactly: today and yesterday with the time, else the date. */
export function formatDate(t, now = Date.now()) {
  if (t == null || t === 0) return '—';
  const d = t instanceof Date ? t : new Date(t);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - day) / 86400000);
  if (diffDays === 0) return `Today ${formatTime(d)}`;
  if (diffDays === 1) return `Yesterday ${formatTime(d)}`;
  if (diffDays > 1 && diffDays < 7) return `${DAYS[d.getDay()]} ${formatTime(d)}`;
  const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === today.getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}

/** A full date and time, for tooltips and properties. */
export function formatDateLong(t) {
  const d = t instanceof Date ? t : new Date(t);
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${formatTime(d, { seconds: true })}`;
}

/** Seconds as m:ss or h:mm:ss. */
export function formatDuration(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export function formatRelative(t, now = Date.now()) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
