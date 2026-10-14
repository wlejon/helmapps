/**
 * File Systems page: lists mounted volumes from bro.vfs.volumes() with mount
 * point, filesystem type, used/total as a Progress bar, free space, and an
 * "Open in Disk Usage" action.
 */

import { h, api } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { emptyState } from '/lib/layout.js';
import { Progress } from '/lib/controls.js';
import { toast } from '/lib/toast.js';
import { formatBytes, formatPercent } from '/lib/format.js';
import { openApp } from '/lib/files.js';

const vfs = api('vfs');

export class FilesystemsView {
  constructor() {
    this.volumes = [];
    this.loaded = false;
    this.gridEl = h('div.mon-fs-grid');
    this.emptyEl = emptyState({
      icon: 'hard-drive',
      title: 'No file systems available',
      hint: vfs ? 'No mounted volumes were reported.' : 'This build of bro does not include bro.vfs.',
    });
    this.emptyEl.classList.add('hidden');

    this.el = h('div.mon-page-fs',
      h('div.head', 'File Systems'),
      this.gridEl,
      this.emptyEl
    );
  }

  async refresh() {
    if (!vfs || typeof vfs.volumes !== 'function') {
      this.setVolumes([]);
      return this.volumes;
    }
    try {
      const raw = await vfs.volumes();
      const filtered = (raw || []).filter((v) =>
        v && v.mountPoint && v.totalBytes > 0 &&
        !/^\/(proc|sys|dev|run|snap)(\/|$)/.test(v.mountPoint)
      );
      this.setVolumes(filtered);
    } catch (_) {
      this.setVolumes([]);
    }
    return this.volumes;
  }

  setVolumes(volumes) {
    this.volumes = Array.isArray(volumes) ? volumes : [];
    this.loaded = true;
    this.render();
  }

  async openInDiskUsage(mountPoint) {
    if (!mountPoint) return false;
    const ok = await openApp('helm.diskusage', [mountPoint]);
    if (!ok) {
      toast('Disk Usage (helm.diskusage) is not installed', { error: true });
    }
    return ok;
  }

  render() {
    if (!this.volumes.length) {
      this.gridEl.replaceChildren();
      this.gridEl.classList.add('hidden');
      this.emptyEl.classList.remove('hidden');
      return;
    }

    this.emptyEl.classList.add('hidden');
    this.gridEl.classList.remove('hidden');

    const cards = this.volumes.map((v) => {
      const total = v.totalBytes || 0;
      const avail = v.availableBytes != null ? v.availableBytes : (v.freeBytes || 0);
      const used = Math.max(0, total - avail);
      const frac = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
      const prog = new Progress(frac);
      const label = v.volumeLabel
        ? `${v.volumeLabel} (${v.mountPoint})`
        : v.mountPoint;

      return h('div.mon-fs-card', { 'data-mount': v.mountPoint },
        h('div.mon-fs-top',
          h('div.mon-fs-title-group',
            icon('hard-drive', 'lg'),
            h('div.mon-fs-names',
              h('div.title.ellipsis', label),
              h('div.dim.mono', { style: { fontSize: 'var(--fs-cap)' } }, v.mountPoint)
            )
          ),
          v.fsType ? h('span.mon-proc-badge', v.fsType) : null
        ),
        prog.el,
        h('div.mon-fs-stats.num',
          h('span', `${formatBytes(used)} used of ${formatBytes(total)} (${formatPercent(frac)})`),
          h('span.dim', `${formatBytes(avail)} free`)
        ),
        h('div.mon-fs-actions',
          h('button.btn.small', {
            onclick: () => this.openInDiskUsage(v.mountPoint),
          }, icon('pie-chart', 'sm'), 'Open in Disk Usage')
        )
      );
    });

    this.gridEl.replaceChildren(...cards);
  }
}
