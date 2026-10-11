/**
 * What the panel says about the selected frames and the animation, from the
 * session and the schedule: plain data for BurstPanel.update().
 *
 *   const i = inspect({ frames, selection, schedule, cur, correcting });   // panel.showInspector(i)
 *   const text = summaryText(schedule, frames, removed);
 */

import { formatSeconds } from './timeline.js';

const pct = (c) => `${Math.round(c * 100)}%`;
const range = (lo, hi, fmt) => (fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`);

/** The tracking of one frame, as a [value, badge kind] pair. */
function tracking(f) {
  switch (f.status) {
    case 'pending': return ['Not tracked yet', null];
    case 'tracking': return ['Tracking…', null];
    case 'seed': return ['Set by you', 'ok'];
    case 'lost': return ['Lost', 'danger'];
    case 'low': return [`Check · ${pct(f.track.confidence)}`, 'danger'];
    default: return [pct(f.track.confidence), 'ok'];
  }
}

export function inspect({ frames, selection, schedule, cur, correcting }) {
  const slots = new Map(schedule.frames.map((s) => [s.index, s]));
  const sel = [...selection].filter((k) => slots.has(k)).sort((a, b) => a - b);
  if (!sel.length && slots.has(cur)) sel.push(cur);
  if (!sel.length) return null;
  const first = schedule.frames.length ? frames[schedule.frames[0].index].time : 0;
  const flagged = sel.filter((k) => frames[k].status === 'low' || frames[k].status === 'lost');
  const custom = sel.some((k) => slots.get(k).custom);
  const rows = [];
  if (sel.length === 1) {
    const k = sel[0];
    const f = frames[k], s = slots.get(k);
    rows.push(['Hold', `${formatSeconds(s.duration)}${s.custom ? '' : s.gap ? ' · gap trimmed' : ' · as shot'}`]);
    if (s.gap) rows.push(['Gap as shot', formatSeconds(s.interval)]);
    const [v, kind] = tracking(f);
    rows.push(['Tracking', v, kind]);
    rows.push(['Taken', `+${(f.time - first).toFixed(2)} s`]);
    const n = schedule.frames.findIndex((x) => x.index === k);
    return {
      title: `Frame ${n + 1} of ${schedule.frames.length}`, sub: f.name, rows, custom, count: 1,
      flagged: flagged.length ? {
        text: f.status === 'lost'
          ? 'The subject was lost in this frame. Click it on the photo to set it again; the frames after it follow.'
          : 'Tracking is unsure here. If the mask is off, click the subject on the photo to set it again; the frames after it follow.',
        canReseed: !correcting,
      } : null,
    };
  }
  const durs = sel.map((k) => slots.get(k).duration);
  const total = durs.reduce((a, b) => a + b, 0);
  rows.push(['Holds', range(Math.min(...durs), Math.max(...durs), formatSeconds)]);
  rows.push(['Together', formatSeconds(total)]);
  const tracked = sel.filter((k) => frames[k].track && frames[k].track.area > 0);
  if (tracked.length) {
    const cs = tracked.map((k) => frames[k].track.confidence);
    rows.push(['Tracking', range(Math.min(...cs), Math.max(...cs), pct), flagged.length ? 'danger' : 'ok']);
  }
  if (flagged.length) rows.push(['To check', `${flagged.length} of ${sel.length}`, 'danger']);
  return {
    title: `${sel.length} frames`, sub: `${frames[sel[0]].name} – ${frames[sel[sel.length - 1]].name}`, rows, custom, count: sel.length,
    flagged: flagged.length ? {
      text: `Tracking is unsure on ${flagged.length === 1 ? 'one of these frames' : `${flagged.length} of these frames`}. Go to one and click the subject on the photo to set it again.`,
      canReseed: !correcting,
    } : null,
  };
}

/** The line over the Export button. */
export function summaryText(schedule, frames, removed) {
  if (!frames.length) return '';
  const n = schedule.frames.length;
  const parts = [`${n} frame${n === 1 ? '' : 's'}`, `plays ${schedule.total.toFixed(2)} s`, `shot over ${schedule.realElapsed.toFixed(2)} s`];
  if (removed) parts.push(`${removed} removed`);
  return parts.join(' · ');
}
