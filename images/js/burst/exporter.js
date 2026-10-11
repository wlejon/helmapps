/**
 * Export the stabilized burst as an animated GIF (each frame its own delay)
 * or a WebM (a fixed frame rate, frames repeated to keep the timing), at the
 * output size the panel shows. Rendered and encoded on the media worker
 * from the full-resolution photos; the page shows progress.
 *
 *   const out = await exportBurst({ view, media, dir, format });   // the file written, or null (cancelled)
 */

import { gifDelays, repeatCounts } from './timing.js';

const path = require('path');

/** The WebM's frame rate: fine enough that a burst's ~0.1 s steps land within 17 ms. */
export const WEBM_FPS = 30;

const FILTERS = { gif: 'GIF animation|gif', webm: 'WebM video|webm' };

/** A name for the export from its first and last photos: IMG_1462-1475.gif. */
export function exportName(first, last, ext) {
  const a = path.basename(first).replace(/\.[^.]+$/, '');
  const b = path.basename(last).replace(/\.[^.]+$/, '');
  if (a === b) return `${a}.${ext}`;
  const prefix = a.replace(/\d+$/, '');
  const tail = prefix && b.startsWith(prefix) ? b.slice(prefix.length) : b;
  return `${a}-${tail}.${ext}`;
}

/** Ask where (the native save dialog, in the photos' folder), then render. */
export async function exportBurst({ view, media, dir, format }) {
  const plan = view.exportPlan();
  if (plan.length < 2) return null;
  const ext = format === 'webm' ? 'webm' : 'gif';
  const suggested = path.join(dir, exportName(plan[0].path, plan[plan.length - 1].path, ext));
  if (typeof showSaveFileDialog !== 'function') throw new Error('this bro has no save dialog');
  let out = showSaveFileDialog(FILTERS[ext], suggested);
  if (!out) return null;
  if (!new RegExp(`\\.${ext}$`, 'i').test(out)) out = `${out}.${ext}`;
  return render({ view, media, out, format: ext });
}

/** Render the plan into `out` (no dialog): what exportBurst does once it has a path. */
export async function render({ view, media, out, format }) {
  const plan = view.exportPlan();
  const s = view.timeline();
  const { width, height } = view.outputSize();
  const delays = gifDelays(s);
  const repeats = repeatCounts(s, WEBM_FPS);
  const frames = plan.map((f, i) => ({ path: f.path, T: f.T, delayCs: delays[i], repeats: repeats[i] }));
  view.exporting = true;
  view.changed();
  view.panel.setProgress(0, `Rendering 0 of ${frames.length}`);
  const t0 = Date.now();
  try {
    const r = await media.call({ op: 'export', format, out, crop: view.crop, width, height, fps: WEBM_FPS, frames }, {
      onProgress: (m) => view.panel.setProgress(m.progress, `Rendering ${m.done} of ${m.total}`),
    });
    if (r.cancelled) return null;
    return { path: out, frames: r.frames, bytes: r.bytes, width, height, ms: Date.now() - t0, delays, repeats };
  } finally {
    view.exporting = false;
    view.panel.setProgress(undefined);
    view.changed();
  }
}
