/**
 * The details panel: what the file is. Name, folder, dimensions, size, type,
 * modified time, and the photo's EXIF (camera, lens, exposure, date taken,
 * location, orientation) when the file carries it. `extra(file)` adds what
 * a feature knows about it below (Find Animals: js/wildlife/labels.js), and
 * refresh(file) redraws when that changes.
 */

import { h } from '/lib/dom.js';
import { formatBytes, formatDateLong, formatNumber } from '/lib/format.js';
import { formatOf, orientationText } from './formats.js';

const fs = require('fs');
const path = require('path');

export class Details {
  constructor({ extra = null } = {}) {
    this.body = h('div.iv-details-body');
    this.el = h('aside.iv-details',
      h('div.iv-details-head', h('div.micro', 'Details')),
      this.body);
    this.extra = extra;
    this.shownFor = null;
    this.stat = null;
    this.last = null;            // [file, pic, st] as last drawn
  }

  /** Draw `file` again if it is the one shown (what extra() says about it changed). */
  refresh(file) {
    if (this.last && this.last[0] === file && this.shownFor === file) this.render(...this.last);
  }

  /**
   * Show a picture's details. `pic` may still be loading (null): the file's
   * own facts show first, the pixel size when it arrives.
   */
  async show(file, pic) {
    if (!file) {
      this.shownFor = null;
      this.body.replaceChildren(h('div.dim', 'No image open'));
      return;
    }
    const key = file;
    this.shownFor = key;
    this.render(file, pic, this.stat && this.stat.path === file ? this.stat.st : null);
    if (!this.stat || this.stat.path !== file) {
      let st = null;
      try { st = await fs.promises.stat(file); } catch (_) { st = null; }
      if (this.shownFor !== key) return;
      this.stat = { path: file, st };
      this.render(file, pic, st);
    }
  }

  /** The file changed on disk (renamed, rewritten): read its facts again. */
  invalidate() {
    this.stat = null;
  }

  render(file, pic, st) {
    const f = formatOf(file);
    const rows = [
      ['Name', path.basename(file)],
      ['Folder', path.dirname(file)],
      ['Dimensions', pic ? `${formatNumber(pic.width)} × ${formatNumber(pic.height)} pixels` : ''],
      ['Megapixels', pic && pic.kind !== 'vector' ? `${(pic.width * pic.height / 1e6).toFixed(1)} MP` : ''],
      ['File size', st ? `${formatBytes(st.size)} (${formatNumber(st.size)} bytes)` : '…'],
      ['Type', f ? f.type : ''],
      ['Modified', st ? formatDateLong(st.mtime) : '…'],
    ];
    const parts = [section('File', rows)];
    if (pic && pic.exif) parts.push(section('Camera', exifRows(pic)));
    const more = this.extra ? this.extra(file) : null;
    if (more) parts.push(more);
    this.last = [file, pic, st];
    this.body.replaceChildren(...parts);
  }
}

/** The photo's EXIF (bro.image.readExif) as rows; absent fields are left out. */
function exifRows(pic) {
  const e = pic.exif;
  const o = pic.orientation > 1 ? orientationText(pic.orientation) : '';
  const camera = [e.make, e.model && e.make && e.model.startsWith(e.make) ? e.model.slice(e.make.length).trim() : e.model]
    .filter(Boolean).join(' ');
  const focal = e.focalLength !== undefined
    ? `${trim(e.focalLength)} mm${e.focalLength35mm ? ` (${e.focalLength35mm} mm equiv.)` : ''}` : '';
  const hasGps = e.latitude !== undefined && e.longitude !== undefined;
  return [
    ['Camera', camera],
    ['Lens', e.lensModel || ''],
    ['Exposure', e.exposureTimeText ? `${e.exposureTimeText} s` : ''],
    ['Aperture', e.fNumber !== undefined ? `f/${trim(e.fNumber)}` : ''],
    ['ISO', e.iso !== undefined ? String(e.iso) : ''],
    ['Focal length', focal],
    ['Taken', e.dateTaken ? formatDateLong(new Date(e.dateTaken)) : ''],
    ['Location', hasGps ? `${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}` : ''],
    ['Altitude', e.altitude !== undefined ? `${Math.round(e.altitude)} m` : ''],
    ['Orientation', o ? `${o} (shown upright)` : ''],
  ];
}

const trim = (n) => String(Math.round(n * 10) / 10);

/**
 * A titled section of label / value rows; rows whose value is '' are left
 * out. A row's third element { dim: true } shows its value muted (a guess).
 */
export function section(title, rows) {
  return h('div.iv-details-section',
    h('div.micro.iv-details-title', title),
    ...rows.filter(([, v]) => v !== '').map(([k, v, o]) =>
      h('div.iv-prop', h('div.iv-prop-key', k), h(o && o.dim ? 'div.iv-prop-value.num.dim' : 'div.iv-prop-value.num', { title: v }, v))));
}
