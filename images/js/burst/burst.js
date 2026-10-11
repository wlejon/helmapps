/**
 * Stabilize a burst: the feature as the Image Viewer wires it in.
 *
 *   1. Select Subject (S) on a photo: click the subject, more clicks add,
 *      Alt+click removes. The strip selects the photo's own burst; Shift+click
 *      in the strip extends the range, Ctrl+click toggles a frame.
 *   2. Stabilize Burst (B): the selected frames open in the stabilize view,
 *      the subject is tracked through them, and the crop, the lock, the
 *      timing and the export are set there (js/burst/view.js).
 *
 *   const burst = new BurstFeature({ settings, viewer, viewHost, host, strip, folder, current, onMode });
 *   commands.addAll(burst.commands());
 *   burst.photoChanged(path);        // main.js, when another photo is shown
 *
 * The heavy work is on two workers: tracking (decode, crops, the subject
 * model, alignment) and media (previews, export render and encode).
 */

import { h } from '/lib/dom.js';
import { toast } from '/lib/toast.js';
import { WorkerClient } from './rpc.js';
import { BurstSession, findModelSpec, downloadableModel } from './session.js';
import { Progress } from '/lib/controls.js';
import { SubjectTool } from './subject-tool.js';
import { StabilizeView } from './view.js';
import { exportBurst } from './exporter.js';
import { bursts, fillTimes } from './timing.js';
import { formatBytes } from '/lib/format.js';

const path = require('path');

/** How far either side of the photo its burst is looked for, in photos. */
const BURST_WINDOW = 60;

/** The app settings this feature keeps (merged into startApp's schema). */
export const BURST_SETTINGS = {
  burstLock: { type: 'string', default: 'subject' },      // subject | scene: the last one used
  burstAspect: { type: 'string', default: '1:1' },
  burstHoldMs: { type: 'int', default: 100, min: 0, max: 5000 },
  burstSpeedPct: { type: 'int', default: 100, min: 10, max: 1000 },
  burstFormat: { type: 'string', default: 'gif' },
  burstSize: { type: 'int', default: 720, min: 64, max: 4096 },
};

export class BurstFeature {
  /**
   * settings  the app's settings (BURST_SETTINGS in its schema)
   * viewer    the photo view; viewHost the element it sits in (the tool draws there)
   * host      where the stabilize view goes
   * strip     the thumbnail strip (multiSelect); folder the folder's items
   * current() the photo on screen (its path), or ''
   * onMode(mode)  'burst' when the stabilize view opens, 'image' when it closes
   */
  constructor({ settings, viewer, viewHost, host, strip, folder, current, onMode, onChange }) {
    this.settings = settings;
    this.viewer = viewer;
    this.strip = strip;
    this.folder = folder;
    this.current = current;
    this.onMode = onMode;
    this.onChangeCb = onChange;
    this.spec = undefined;            // the model to use; undefined = not looked for yet
    this.subject = null;              // { path, points, labels, track }
    this.active = false;              // the stabilize view is open
    this.selectSeq = 0;
    this.media = new WorkerClient('js/burst/media-worker.js');
    this.session = new BurstSession({ onChange: () => this.sessionChanged() });
    this.tool = new SubjectTool({ viewer, host: viewHost, onClicks: (p, l) => this.clicked(p, l) });
    this.clearBtn = h('button.btn.ghost.small', { onclick: () => this.clearSubject() }, 'Clear');
    this.stabilizeBtn = h('button.btn.small', { onclick: () => this.openStabilize() }, 'Stabilize…');
    // No model on the machine: the offer to download one, its progress, a retry.
    this.download = null;             // { state: 'running' | 'failed', ac, error } while one is wanted
    this.progress = new Progress(0);
    this.progress.el.classList.add('iv-subject-progress', 'hidden');
    this.downloadBtn = h('button.btn.small.iv-subject-download.hidden', { onclick: () => this.downloadModel() });
    this.cancelBtn = h('button.btn.ghost.small.iv-subject-cancel.hidden', { onclick: () => this.cancelDownload() }, 'Cancel');
    this.tool.bar.append(this.progress.el, this.downloadBtn, this.cancelBtn, this.clearBtn, this.stabilizeBtn);
    this.view = new StabilizeView({
      session: this.session, media: this.media, settings,
      onChange: () => this.changed(), onExport: () => this.export(),
    });
    host.append(this.view.el);
  }

  changed() { if (this.onChangeCb) this.onChangeCb(); }

  sessionChanged() {
    if (this.active) this.view.sessionChanged();
    this.changed();
  }

  /** The model, looked for once (tests set their own with useModel). */
  modelSpec() {
    if (this.spec === undefined) this.spec = findModelSpec();
    return this.spec;
  }

  useModel(spec) { this.spec = spec; }

  noModelText() {
    const m = downloadableModel();
    if (m) return `Select Subject needs a segmentation model: download ${m.label} (${formatBytes(m.bytes)})`;
    const dirs = typeof bro !== 'undefined' && bro.models ? bro.models.dirs : [];
    return `No segmentation model found: put sam-vit-base (or a SAM 2.1 folder) in ${dirs.join(', ') || 'a models folder'}`;
  }

  /** The bar's words and buttons for what the tool can do now. */
  showToolState() {
    const spec = this.modelSpec();
    const m = spec ? null : downloadableModel();
    const d = this.download;
    const running = !!(m && d && d.state === 'running');
    this.clearBtn.classList.toggle('hidden', !spec);
    this.stabilizeBtn.classList.toggle('hidden', !spec);
    this.downloadBtn.classList.toggle('hidden', !m || running);
    this.cancelBtn.classList.toggle('hidden', !running);
    this.progress.el.classList.toggle('hidden', !running);
    if (spec) { this.tool.setHint('Click the subject · Alt+click removes an area'); return; }
    if (!m) { this.tool.setHint(this.noModelText()); return; }
    if (running) {
      const { done = 0, total = m.bytes } = d;
      this.progress.set(total > 0 ? done / total : null);
      this.tool.setHint(`Downloading ${m.label} · ${formatBytes(done)} of ${formatBytes(total)}`);
    } else if (d && d.state === 'failed') {
      this.downloadBtn.textContent = 'Retry';
      this.tool.setHint(d.error);
    } else {
      this.downloadBtn.textContent = `Download ${m.label} (${formatBytes(m.bytes)})`;
      this.tool.setHint('No segmentation model on this machine');
    }
  }

  /**
   * Fetch the model (bro.models.fetch: verified, resumable, installed where
   * bro.models.find looks), then carry on selecting the subject.
   */
  async downloadModel() {
    const m = downloadableModel();
    if (!m || (this.download && this.download.state === 'running')) return;
    const d = { state: 'running', ac: new AbortController(), done: 0, total: m.bytes, error: '' };
    this.download = d;
    this.showToolState();
    this.changed();
    try {
      await bro.models.fetch(m.name, {
        signal: d.ac.signal,
        onProgress: ({ done, total }) => {
          d.done = done; d.total = total || m.bytes;
          if (this.download === d && this.tool.active) this.showToolState();
        },
      });
      this.download = null;
      this.spec = undefined;          // look again: find() answers the new folder
      if (this.modelSpec()) toast(`${m.label} is installed`, { icon: 'check' });
    } catch (err) {
      if (this.download !== d) return;
      if (err && err.name === 'AbortError') {
        this.download = null;
      } else {
        const why = err && err.code === 'network'
          ? 'no connection to the model server (offline?)'
          : String((err && err.message) || err).replace(/^bro\.models\.fetch: /, '');
        this.download = { state: 'failed', error: `Could not download ${m.label}: ${why}` };
      }
    }
    if (this.tool.active) this.showToolState();
    this.changed();
  }

  cancelDownload() {
    if (this.download && this.download.state === 'running') this.download.ac.abort();
  }

  // ---- the subject tool -------------------------------------------------------------------

  get picking() { return this.tool.active; }

  togglePicking() {
    if (this.tool.active) { this.tool.setActive(false); this.changed(); return; }
    this.tool.setActive(true);
    const p = this.current();
    if (!this.subject || this.subject.path !== p) { this.tool.clear(); this.subject = null; }
    this.showToolState();
    this.selectBurst(p);
    this.changed();
  }

  clearSubject() {
    this.subject = null;
    this.tool.clear();
    this.tool.setHint('Click the subject · Alt+click removes an area');
    this.changed();
  }

  /** Another photo is on screen: the subject was the last one's. */
  photoChanged(p) {
    if (this.subject && this.subject.path !== p) { this.subject = null; this.tool.clear(); }
    if (this.tool.active) {
      this.showToolState();
      this.selectBurst(p);
    }
  }

  async clicked(points, labels) {
    const spec = this.modelSpec();
    const p = this.current();
    if (!spec || !p) return;
    this.tool.setBusy(true);
    this.tool.setHint('Finding the subject…');
    try {
      await this.session.useModel(spec);
      // More clicks refine the same crop the first one was segmented on.
      const rect = this.subject && this.subject.path === p && this.subject.track && this.subject.track.mask && points.length > 1
        ? this.subject.track.mask.rect : null;
      const track = await this.session.segmentPath(p, points, labels, rect);
      if (this.current() !== p) return;
      this.subject = { path: p, points, labels, track };
      this.tool.show({ track, points, labels });
      const n = this.strip.selection.size;
      this.tool.setHint(track.area > 0
        ? `Subject selected · ${n} frame${n === 1 ? '' : 's'} selected (Shift+click the strip to change) · B to stabilize`
        : 'Nothing found there: click on the subject');
    } catch (err) {
      this.tool.setHint(`Could not segment: ${err.message}`);
    } finally {
      this.tool.setBusy(false);
      this.changed();
    }
  }

  /** Select the photo's own burst in the strip (by EXIF time). */
  async selectBurst(p) {
    const seq = ++this.selectSeq;
    const items = this.folder.items;
    const i = this.folder.indexOf(p);
    if (i < 0) return;
    const lo = Math.max(0, i - BURST_WINDOW), hi = Math.min(items.length - 1, i + BURST_WINDOW);
    const near = items.slice(lo, hi + 1);
    let info;
    try { info = await this.session.info(near.map((it) => it.path)); } catch (_) { return; }
    if (seq !== this.selectSeq || this.current() !== p) return;
    const times = fillTimes(info.map((x) => x.time));
    const b = bursts(times).find(([a, z]) => i - lo >= a && i - lo <= z) || [i - lo, i - lo];
    const keys = near.slice(b[0], b[1] + 1).map((it) => it.path);
    // The photo first, so the range's anchor is the photo on screen.
    this.strip.select([p, ...keys.filter((k) => k !== p)], { scroll: false });
    this.changed();
  }

  /** The frames for the stabilize view: the strip's selection in folder order, with the photo. */
  framePaths() {
    const p = this.current();
    const sel = new Set(this.strip.selectedItems().map((it) => it.path));
    sel.add(p);
    return this.folder.items.filter((it) => sel.has(it.path)).map((it) => it.path);
  }

  // ---- the stabilize view ---------------------------------------------------------------------

  canStabilize() {
    return !!(this.subject && this.subject.track && this.subject.track.area > 0 && this.subject.path === this.current());
  }

  async openStabilize() {
    // No model yet: Select Subject, where the download is offered.
    if (!this.modelSpec() && downloadableModel()) {
      if (!this.tool.active) this.togglePicking();
      return false;
    }
    if (!this.canStabilize()) {
      toast(this.modelSpec() ? 'Select the subject first: click it in the photo' : this.noModelText(), { icon: 'info' });
      return false;
    }
    const paths = this.framePaths();
    if (paths.length < 2) {
      toast('Select the frames too: Shift+click the last one in the strip', { icon: 'info' });
      return false;
    }
    const subject = this.subject;
    await this.session.useModel(this.modelSpec());
    await this.session.load(paths, subject.path);
    this.session.place(this.session.ref, subject.track, { clicks: { points: subject.points, labels: subject.labels } });
    this.tool.setActive(false);
    this.active = true;
    if (this.onMode) this.onMode('burst');
    this.view.open();
    this.view.stage.focus();
    this.changed();
    return true;
  }

  closeStabilize() {
    if (!this.active) return;
    this.session.stop();
    this.view.close();
    this.active = false;
    if (this.onMode) this.onMode('image');
    this.changed();
  }

  async export() {
    if (!this.view.canExport()) return null;
    this.view.pause();
    const dir = path.dirname(this.session.frames[this.session.ref].path);
    try {
      const r = await exportBurst({ view: this.view, media: this.media, dir, format: this.view.format });
      if (r) toast(`Saved ${path.basename(r.path)} · ${r.width} × ${r.height} · ${formatBytes(r.bytes)}`, { icon: 'check' });
      return r;
    } catch (err) {
      toast(`Could not export: ${err.message}`, { error: true });
      return null;
    }
  }

  /** The status bar's words while the stabilize view is open. */
  statusText() {
    const s = this.session;
    if (!this.active) return '';
    if (s.error) return `Tracking stopped: ${s.error}`;
    const n = s.frames.length;
    const done = s.frames.filter((f) => f.track).length;
    const look = s.frames.filter((f) => f.included && (f.status === 'low' || f.status === 'lost')).length;
    const parts = [];
    if (s.busy) parts.push(`Tracking ${done} of ${n}`);
    if (look) parts.push(`${look} frame${look === 1 ? ' needs' : 's need'} a look (click it, then the subject)`);
    if (!parts.length) parts.push(`${n} frames · ${this.view.lock === 'scene' ? 'scene' : 'subject'} held still`);
    return parts.join(' · ');
  }

  // ---- commands -----------------------------------------------------------------------------

  commands({ imageShown }) {
    const inView = () => this.active;
    return [
      { id: 'burst-close', label: 'Close Stabilize', icon: 'arrow-left', keys: ['Escape'], enabled: inView, run: () => this.closeStabilize() },
      { id: 'subject-exit', label: 'Stop Selecting Subject', keys: ['Escape'], enabled: () => !this.active && this.tool.active,
        run: () => this.togglePicking() },
      { id: 'subject', label: 'Select Subject', icon: 'sparkles', keys: ['S'], enabled: () => imageShown() && !this.active,
        checked: () => this.tool.active, run: () => this.togglePicking() },
      { id: 'stabilize', label: 'Stabilize Burst…', icon: 'layers', keys: ['B'], enabled: () => imageShown() && !this.active && (this.canStabilize() || (!this.modelSpec() && !!downloadableModel())),
        run: () => this.openStabilize() },
      { id: 'burst-play', label: 'Play', icon: 'play', keys: ['Space'], enabled: () => inView() && !!this.view.crop,
        checked: () => this.view.playing, run: () => (this.view.playing ? this.view.pause() : this.view.play()) },
      { id: 'burst-prev', label: 'Previous Frame', icon: 'chevron-left', keys: ['ArrowLeft'], enabled: inView, run: () => { this.view.pause(); this.view.step(-1); } },
      { id: 'burst-next', label: 'Next Frame', icon: 'chevron-right', keys: ['ArrowRight'], enabled: inView, run: () => { this.view.pause(); this.view.step(1); } },
      { id: 'burst-correct', label: 'Correct Subject', icon: 'edit', keys: ['C'], enabled: () => inView() && !this.view.playing,
        checked: () => this.view.correcting, run: () => this.view.setCorrecting(!this.view.correcting) },
      { id: 'burst-exclude', label: 'Leave Out Frame', icon: 'eye-off', keys: ['X'], enabled: inView,
        checked: () => this.active && !!this.session.frames[this.view.cur] && !this.session.frames[this.view.cur].included,
        run: () => { const f = this.session.frames[this.view.cur]; if (f) this.view.setIncluded(this.view.cur, !f.included); } },
      { id: 'burst-lock', label: 'Hold the Scene Still', icon: 'crop', keys: ['L'], enabled: inView,
        checked: () => this.view.lock === 'scene',
        run: () => { this.settings.set('burstLock', this.view.lock === 'scene' ? 'subject' : 'scene'); this.view.recompute({ keepCrop: true }); } },
      { id: 'burst-export', label: 'Export…', icon: 'download', keys: ['Mod+E'], enabled: () => inView() && this.view.canExport(),
        run: () => this.export() },
    ];
  }

  dispose() {
    this.session.dispose();
    this.media.terminate();
  }
}
