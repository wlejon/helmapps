/**
 * The details panel: what the file is. Name, folder, dimensions, size, type,
 * modified time, and the EXIF fields bro exposes (only the orientation: bro
 * has no EXIF reader beyond it; see GAPS.md).
 */

import { h } from '/lib/dom.js';
import { formatBytes, formatDateLong, formatNumber } from '/lib/format.js';
import { formatOf, orientationText } from './formats.js';

const fs = require('fs');
const path = require('path');

export class Details {
  constructor() {
    this.body = h('div.iv-details-body');
    this.el = h('aside.iv-details',
      h('div.iv-details-head', h('div.micro', 'Details')),
      this.body);
    this.shownFor = null;
    this.stat = null;
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
    const exif = pic && pic.orientation > 1 ? orientationText(pic.orientation) : '';
    const exifRows = [['Orientation', exif ? `${exif} (shown upright)` : 'Normal']];
    const parts = [section('File', rows)];
    if (pic && pic.kind === 'bitmap') {
      parts.push(section('EXIF', exifRows),
        h('div.iv-details-note.dim', 'bro reads only the orientation from EXIF; camera, lens and exposure details are not available yet.'));
    }
    this.body.replaceChildren(...parts);
  }
}

function section(title, rows) {
  return h('div.iv-details-section',
    h('div.micro.iv-details-title', title),
    ...rows.filter(([, v]) => v !== '').map(([k, v]) =>
      h('div.iv-prop', h('div.iv-prop-key', k), h('div.iv-prop-value.num', { title: v }, v))));
}
