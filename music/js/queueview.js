/**
 * The Queue page: the songs that will play, in order, the current one
 * marked. Rows reorder by dragging their grip (or Alt+Up / Alt+Down), and
 * Remove takes them out. The kit's VirtualList has no drag-to-reorder, so
 * the drag is built here on its geometry (GAPS.md: it belongs in the kit).
 *
 *   const qv = new QueueView({ player, library, onMove, onActivate, onContextMenu });
 *   qv.show(query)                 rebuild the rows from player.queue
 *   qv.list.selectedItems()        rows: { id, index, path, title, artist, duration, current }
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { VirtualList } from '/lib/list.js';
import { emptyState } from '/lib/layout.js';
import { formatDuration } from '/lib/format.js';

export class QueueView {
  constructor({ player, library, onMove, onActivate, onContextMenu }) {
    this.player = player;
    this.library = library;
    this.onMove = onMove;
    this.shownVersion = -1;
    this.shownQuery = null;
    this.list = new VirtualList({
      layout: 'list',
      rowHeight: 34,
      key: (r) => r.id,
      label: (r) => r.title,
      rowClass: (r) => (r.current ? 'mu-playing' : ''),
      columns: [
        { id: 'grip', label: '', width: 28, resizable: false, cell: () => h('span.mu-grip', { 'data-tip': 'Drag to reorder' }, icon('grip')) },
        { id: 'n', label: '#', width: 44, align: 'right', resizable: false, cell: (r) => String(r.index + 1) },
        { id: 'title', label: 'Title', flex: 2, minWidth: 140, cell: (r) => h('span.ellipsis.mu-title', r.title) },
        { id: 'artist', label: 'Artist', flex: 1, minWidth: 90, cell: (r) => h('span.ellipsis', r.artist) },
        { id: 'album', label: 'Album', flex: 1, minWidth: 90, cell: (r) => h('span.ellipsis', r.album) },
        { id: 'length', label: 'Length', width: 72, align: 'right', cell: (r) => (r.duration ? formatDuration(r.duration) : '') },
      ],
      onActivate: (items) => onActivate(items[0]),
      onContextMenu,
      empty: emptyState({ icon: 'list', title: 'The queue is empty',
        hint: 'Double-click a song to play it with the songs around it, or choose Add to Queue from a song\'s menu.' }),
    });
    this.list.el.classList.add('mu-queue');
    // Capture on the wrapper: a press on a grip starts a drag, not a selection.
    this.list.el.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && e.target && e.target.closest && e.target.closest('.mu-grip')) this.drag(e);
    }, true);
  }

  get el() {
    return this.list.el;
  }

  /** Rows for the queue as it is now (filtered by `query`). */
  show(query = '', { force = false } = {}) {
    const q = this.player.queue;
    if (!force && q.version === this.shownVersion && query === this.shownQuery && this.library.version === this.libVersion) return;
    this.shownVersion = q.version;
    this.shownQuery = query;
    this.libVersion = this.library.version;
    const cur = q.current;
    let rows = q.entries.map((e, index) => {
      const s = this.library.song(e.path);
      return {
        id: e.id, index, path: e.path,
        title: s ? s.title : e.path.split(/[\\/]/).pop(),
        artist: s ? s.artist : '', album: s ? s.album : '',
        duration: s ? s.duration : 0,
        current: e === cur,
        search: s ? s.search : e.path.toLowerCase(),
      };
    });
    const needle = query.trim().toLowerCase();
    if (needle) rows = rows.filter((r) => r.search.includes(needle));
    this.list.setItems(rows);
  }

  /** Drag the row under the grip to where the pointer lets go. */
  drag(e) {
    e.preventDefault();
    e.stopPropagation();
    const list = this.list;
    const from = list.indexAt(e);
    if (from < 0 || this.shownQuery) return;                 // reordering a filtered list would be ambiguous
    const row = list.items[from];
    list.select([row.id], { scroll: false });
    const marker = h('div.mu-drop');
    list.spacer.appendChild(marker);
    const r0 = list.scroller.getBoundingClientRect();
    let to = from;
    const place = (ev) => {
      const y = ev.clientY - r0.top + list.scroller.scrollTop;
      const slot = Math.max(0, Math.min(list.items.length, Math.round((y - list.padding) / list.rowHeight)));
      to = slot > from ? slot - 1 : slot;
      marker.style.top = `${list.padding + slot * list.rowHeight - 1}px`;
    };
    place(e);
    list.el.classList.add('dragging');
    const move = (ev) => place(ev);
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      list.el.classList.remove('dragging');
      marker.remove();
      if (to !== from) this.onMove(from, to);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }
}
