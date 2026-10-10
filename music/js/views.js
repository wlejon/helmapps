/**
 * What the content area shows: a head (the view's name, counts, Play and
 * Shuffle) over one kit VirtualList: the songs, the album grid, the
 * artists, an album's tracks, an artist's albums, or a folder. The Queue
 * page is js/queueview.js.
 *
 *   const views = new Views({ library, player, settings, actions });
 *   views.show(state)            state: { view, arg, query, songSort }
 *   views.viewSongs()            the songs of the view on screen, in order (Play, double-click)
 *   views.selectedSongs()        the selection, albums and folders expanded to their songs
 *
 * A row shows its item's fields and nothing else (lib/list.js); the one
 * thing a row reads from the app is whether it is the song playing, and
 * views.playingChanged() redraws the rows on screen when that changes.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { VirtualList } from '/lib/list.js';
import { Breadcrumbs, emptyState } from '/lib/layout.js';
import { formatCount, formatDuration } from '/lib/format.js';
import { artBox, setArt } from './covers.js';
import { trackOrder, libraryOrder } from './library.js';

const path = require('path');

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const SONG_SORTS = {
  track: (a, b) => trackOrder(a, b),
  title: (a, b) => cmp(a.tKey, b.tKey) || libraryOrder(a, b),
  artist: (a, b) => libraryOrder(a, b),
  album: (a, b) => cmp(a.lKey, b.lKey) || trackOrder(a, b),
  length: (a, b) => cmp(a.duration || 0, b.duration || 0) || libraryOrder(a, b),
};

/** "1 h 12 min" / "42 min" for an album's or a view's total. */
export function totalTime(sec) {
  const m = Math.round(sec / 60);
  if (m < 1) return sec > 0 ? '< 1 min' : '';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const trackNo = (s) => (s.track ? String(s.track) : '');
const length = (s) => (s.duration ? formatDuration(s.duration) : '');
const matches = (q) => (x) => x.search.includes(q);

export class Views {
  constructor({ library, player, settings, actions }) {
    this.library = library;
    this.player = player;
    this.settings = settings;
    this.actions = actions;
    this.shownKey = '';
    this.shownVersion = -1;
    this.active = null;

    this.head = this.makeHead();
    const playing = (s) => (s && s.path === this.playingPath() ? 'mu-playing' : '');
    const widths = settings.get('columns') || {};
    const saveWidths = (name) => (w) => settings.set('columns', { ...(settings.get('columns') || {}), [name]: w });
    const songMenu = (e, items) => actions.songMenu(e, items);

    this.songs = new VirtualList({
      layout: 'list',
      rowHeight: 34,
      key: (s) => s.path,
      label: (s) => s.title,
      rowClass: playing,
      columns: [
        { id: 'track', label: '#', width: 48, align: 'right', sortable: true, cell: trackNo },
        { id: 'title', label: 'Title', flex: 2, minWidth: 140, sortable: true, cell: (s) => h('span.ellipsis.mu-title', s.title) },
        { id: 'artist', label: 'Artist', flex: 1, minWidth: 90, sortable: true, cell: (s) => h('span.ellipsis', s.artist) },
        { id: 'album', label: 'Album', flex: 1, minWidth: 90, sortable: true, cell: (s) => h('span.ellipsis', s.album) },
        { id: 'length', label: 'Length', width: 72, align: 'right', sortable: true, cell: length },
      ],
      columnWidths: widths.songs,
      onColumnResize: saveWidths('songs'),
      onSort: (id, dir) => actions.sortSongs({ id, dir }),
      onActivate: (items) => this.activateSong(this.songs, items[0]),
      onContextMenu: songMenu,
      empty: emptyState({ icon: 'music', title: 'No songs', hint: 'Nothing here matches.' }),
    });

    this.tracks = new VirtualList({
      layout: 'list',
      rowHeight: 34,
      key: (s) => s.path,
      label: (s) => s.title,
      rowClass: playing,
      columns: [
        { id: 'track', label: '#', width: 48, align: 'right', cell: trackNo },
        { id: 'title', label: 'Title', flex: 2, minWidth: 140, cell: (s) => h('span.ellipsis.mu-title', s.title) },
        { id: 'artist', label: 'Artist', flex: 1, minWidth: 90, cell: (s) => h('span.ellipsis', s.artist) },
        { id: 'length', label: 'Length', width: 72, align: 'right', cell: length },
      ],
      columnWidths: widths.tracks,
      onColumnResize: saveWidths('tracks'),
      onActivate: (items) => this.activateSong(this.tracks, items[0]),
      onContextMenu: songMenu,
      empty: emptyState({ icon: 'music', title: 'No songs', hint: 'Nothing on this album matches.' }),
    });

    this.albums = new VirtualList({
      layout: 'grid',
      cellWidth: 176,
      fill: true,
      aspect: 1.3,
      gap: 8,
      padding: 16,
      key: (a) => a.key,
      label: (a) => a.title,
      render: (a, el) => this.albumCell(a, el),
      onActivate: (items) => actions.openAlbum(items[0].key),
      onContextMenu: (e, items) => actions.songMenu(e, this.expand(items), items.length === 1 ? items[0].title : ''),
      empty: emptyState({ icon: 'disc', title: 'No albums', hint: 'Nothing here matches.' }),
    });
    this.albums.el.classList.add('mu-albums');

    this.artists = new VirtualList({
      layout: 'list',
      rowHeight: 40,
      key: (a) => a.key,
      label: (a) => a.name,
      columns: [
        { id: 'name', label: 'Artist', flex: 1, minWidth: 160,
          cell: (a) => [artBox(a.cover, 'sm'), h('span.ellipsis.mu-title', a.name)] },
        { id: 'albums', label: 'Albums', width: 90, align: 'right', cell: (a) => String(a.albumCount) },
        { id: 'songs', label: 'Songs', width: 90, align: 'right', cell: (a) => String(a.count) },
      ],
      columnWidths: widths.artists,
      onColumnResize: saveWidths('artists'),
      onActivate: (items) => actions.openArtist(items[0].key),
      onContextMenu: (e, items) => actions.songMenu(e, this.expand(items), items.length === 1 ? items[0].name : ''),
      empty: emptyState({ icon: 'user', title: 'No artists', hint: 'Nothing here matches.' }),
    });

    this.folders = new VirtualList({
      layout: 'list',
      rowHeight: 34,
      key: (x) => x.path,
      label: (x) => (x.isFolder ? x.name : x.title),
      rowClass: (x) => (x.isFolder ? 'mu-folder' : playing(x)),
      columns: [
        { id: 'name', label: 'Name', flex: 2, minWidth: 160,
          cell: (x) => [icon(x.isFolder ? 'folder' : 'music'), h('span.ellipsis.mu-title', x.isFolder ? x.name : x.title)] },
        { id: 'artist', label: 'Artist', flex: 1, minWidth: 90, cell: (x) => (x.isFolder ? '' : h('span.ellipsis', x.artist)) },
        { id: 'length', label: 'Length', width: 96, align: 'right',
          cell: (x) => (x.isFolder ? formatCount(x.count, 'song') : length(x)) },
      ],
      columnWidths: widths.folders,
      onColumnResize: saveWidths('folders'),
      onActivate: (items) => {
        const x = items[0];
        if (x.isFolder) actions.openFolder(x.path);
        else this.activateSong(this.folders, x);
      },
      onContextMenu: (e, items) => actions.songMenu(e, this.expand(items)),
      empty: emptyState({ icon: 'folder', title: 'No music here', hint: 'This folder holds no songs Music can play.' }),
    });

    this.crumbs = new Breadcrumbs({ onNavigate: (p) => actions.openFolder(p) });
    this.lists = [this.songs, this.tracks, this.albums, this.artists, this.folders];
    // Only the list on screen is in the document: a hidden list paints no
    // rows, but the rows it kept are still restyled whenever something
    // changes.
    this.stage = h('div.mu-stage');
  }

  /** Put `el` (a list's element, the queue's, or nothing) on the stage. */
  mount(el) {
    if (el ? this.stage.firstChild === el && this.stage.childNodes.length === 1 : !this.stage.firstChild) return;
    this.stage.replaceChildren(...(el ? [el] : []));
    // A list with covers is filled again: a cover shown elsewhere meanwhile
    // (an artist's row, another page) took the shared <img> (js/covers.js).
    if (el === this.albums.el) this.albums.refresh();
    else if (el === this.artists.el) this.artists.refresh();
  }

  playingPath() {
    const e = this.player.queue.current;
    return e ? e.path : '';
  }

  // ---- the head ---------------------------------------------------------------------

  makeHead() {
    const art = artBox('', 'xl');
    const kind = h('div.micro.mu-kind');
    const title = h('div.mu-head-title.ellipsis');
    const meta = h('div.dim.num.mu-meta');
    const sub = h('button.mu-link.ellipsis', { onclick: () => this.headLink && this.headLink() });
    // The accent belongs to the bar's play button; these are plain buttons.
    const play = h('button.btn', { onclick: () => this.actions.playView(false) }, icon('play'), 'Play');
    const shuffle = h('button.btn', { onclick: () => this.actions.playView(true) }, icon('shuffle'), 'Shuffle');
    const clear = h('button.btn.ghost', { onclick: () => this.actions.clearQueue() }, icon('trash'), 'Clear');
    const crumbsBox = h('div.mu-crumbs');
    const el = h('div.mu-head', art, h('div.mu-head-text', kind, title, sub, crumbsBox, meta), h('div.mu-head-actions', clear, play, shuffle));
    return { el, art, kind, title, meta, sub, play, shuffle, clear, crumbsBox };
  }

  setHead({ kind = '', title = '', sub = '', link = null, meta = '', cover = null, crumbs = null, canPlay = true, queue = false }) {
    const hd = this.head;
    hd.kind.textContent = kind;
    hd.kind.classList.toggle('hidden', !kind);
    hd.title.textContent = title;
    hd.sub.textContent = sub;
    hd.sub.classList.toggle('hidden', !sub);
    hd.sub.disabled = !link;
    this.headLink = link;
    hd.meta.textContent = meta;
    hd.art.classList.toggle('hidden', cover === null);
    if (cover !== null) setArt(hd.art, cover, { own: true });
    hd.crumbsBox.classList.toggle('hidden', !crumbs);
    if (crumbs) {
      if (!hd.crumbsBox.firstChild) hd.crumbsBox.appendChild(this.crumbs.el);
      this.crumbs.set(crumbs);
    }
    hd.play.disabled = !canPlay;
    hd.shuffle.disabled = !canPlay;
    hd.shuffle.classList.toggle('hidden', queue);
    hd.clear.classList.toggle('hidden', !queue);
    hd.clear.disabled = !canPlay;
  }

  // ---- cells ------------------------------------------------------------------------

  albumCell(a, el) {
    if (!el._art) {
      el._art = artBox('', 'cell');
      el._title = h('div.mu-cell-title.ellipsis');
      el._sub = h('div.mu-cell-sub.ellipsis');
      el.replaceChildren(el._art, el._title, el._sub);
    }
    setArt(el._art, a.cover);
    el._title.textContent = a.title;
    el._sub.textContent = this.albumSub(a);
    el.title = `${a.title} — ${a.artist}`;
  }

  albumSub(a) {
    return this.state && this.state.view === 'artist' ? [a.year || '', formatCount(a.count, 'song')].filter(Boolean).join(' · ') : a.artist;
  }

  // ---- showing a view ------------------------------------------------------------------

  /**
   * Fill the content for state. Skipped when nothing it shows changed (same
   * view, query, sort and library version), so the many calls a scan makes
   * cost nothing while the user looks at something it did not touch.
   */
  show(state, { force = false } = {}) {
    this.state = state;
    const key = `${state.view}\n${state.arg}\n${state.query}\n${state.songSort.id}${state.songSort.dir}`;
    if (!force && key === this.shownKey && this.library.version === this.shownVersion) return;
    const sameView = key.split('\n').slice(0, 2).join('\n') === this.shownKey.split('\n').slice(0, 2).join('\n');
    this.shownKey = key;
    this.shownVersion = this.library.version;
    const q = state.query.trim().toLowerCase();
    // On the stage before it is filled: a list fills only the rows it shows,
    // and one that is not in the document shows (and fills) none.
    const shows = { songs: this.songs, albums: this.albums, artists: this.artists, album: this.tracks, artist: this.albums, folders: this.folders }[state.view];
    if (shows) this.mount(shows.el);
    const fn = this[`show_${state.view}`];
    const list = fn ? fn.call(this, state, q) : null;
    this.mount(list ? list.el : null);
    this.active = list;
    if (list && !sameView) list.scroller.scrollTop = 0;
  }

  show_songs(state, q) {
    let items = this.library.songs();
    const sort = SONG_SORTS[state.songSort.id] || SONG_SORTS.artist;
    if (state.songSort.id !== 'artist' || state.songSort.dir < 0) {
      items = items.slice().sort(sort);
      if (state.songSort.dir < 0) items.reverse();
    }
    if (q) items = items.filter(matches(q));
    const total = items.reduce((t, s) => t + (s.duration || 0), 0);
    this.setHead({ title: 'Songs', meta: this.countLine(items.length, 'song', total, q), canPlay: items.length > 0 });
    if (this.songs.sort !== state.songSort) this.songs.setSort(state.songSort);
    this.songs.setItems(items);
    return this.songs;
  }

  show_albums(state, q) {
    let items = this.library.albums();
    if (q) items = items.filter(matches(q));
    this.setHead({ title: 'Albums', meta: q ? `${formatCount(items.length, 'album')} matching` : formatCount(items.length, 'album'),
      canPlay: items.length > 0 });
    this.albums.setItems(items);
    return this.albums;
  }

  show_artists(state, q) {
    let items = this.library.artists();
    if (q) items = items.filter(matches(q));
    this.setHead({ title: 'Artists', meta: q ? `${formatCount(items.length, 'artist')} matching` : formatCount(items.length, 'artist'),
      canPlay: items.length > 0 });
    this.artists.setItems(items);
    return this.artists;
  }

  show_album(state, q) {
    const a = this.library.album(state.arg);
    if (!a) {
      this.setHead({ title: 'This album is no longer in the library', canPlay: false });
      this.tracks.setItems([]);
      return this.tracks;
    }
    const items = q ? a.songs.filter(matches(q)) : a.songs;
    const meta = [a.year || '', formatCount(a.count, 'song'), totalTime(a.duration)].filter(Boolean).join(' · ');
    this.setHead({ kind: 'Album', title: a.title, sub: a.artist, link: () => this.actions.openArtistByName(a.artist), meta, cover: a.cover,
      canPlay: items.length > 0 });
    this.tracks.setItems(items);
    return this.tracks;
  }

  show_artist(state, q) {
    const ar = this.library.artist(state.arg);
    if (!ar) {
      this.setHead({ title: 'This artist is no longer in the library', canPlay: false });
      this.albums.setItems([]);
      return this.albums;
    }
    let albums = ar.albums.map((k) => this.library.album(k)).filter(Boolean);
    albums.sort((x, y) => cmp(x.year, y.year) || cmp(x.tKey, y.tKey));
    if (q) albums = albums.filter(matches(q));
    const total = ar.songs.reduce((t, s) => t + (s.duration || 0), 0);
    this.setHead({ kind: 'Artist', title: ar.name,
      meta: [formatCount(ar.albumCount, 'album'), formatCount(ar.count, 'song'), totalTime(total)].join(' · '),
      cover: ar.cover, canPlay: ar.count > 0 });
    this.albums.setItems(albums);
    return this.albums;
  }

  show_folders(state, q) {
    // With one library folder, the top of Folders is that folder.
    const dir = state.arg || (this.library.roots.length === 1 ? this.library.roots[0] : '');
    const f = this.library.folder(dir);
    let items = [...f.folders, ...f.songs];
    if (q) items = items.filter((x) => (x.isFolder ? x.name.toLowerCase().includes(q) : x.search.includes(q)));
    const root = dir ? this.library.rootOf(dir) : '';
    const chain = [{ label: 'Folders', value: '' }];
    if (root) {
      chain.push({ label: path.basename(root) || root, value: root });
      const rel = path.relative(root, dir);
      let at = root;
      if (rel && !rel.startsWith('..')) for (const part of rel.split(/[\\/]/)) { at = path.join(at, part); chain.push({ label: part, value: at }); }
    }
    const songs = f.songs.length;
    const meta = [f.folders.length ? formatCount(f.folders.length, 'folder') : '', songs ? formatCount(songs, 'song') : '']
      .filter(Boolean).join(' · ') || 'Empty';
    this.setHead({ title: dir ? path.basename(dir) || dir : 'Folders', crumbs: dir ? chain : null, meta,
      canPlay: items.length > 0 });
    this.folders.setItems(items);
    return this.folders;
  }

  countLine(n, what, seconds, q) {
    const c = formatCount(n, what);
    return q ? `${c} matching` : seconds ? `${c} · ${totalTime(seconds)}` : c;
  }

  // ---- what plays ----------------------------------------------------------------------

  /** Albums, artists and folders as their songs, in order. */
  expand(items) {
    // Folders first, in one pass over the library: each song is matched by
    // its parent folders, not each folder against every song.
    const under = new Map();
    for (const x of items) if (x.isFolder && !x.songs) under.set(x.path, []);
    if (under.size) {
      for (const s of this.library.songs()) {
        let dir = path.dirname(s.path);
        for (let up = 0; up < 64; up++) {
          const bucket = under.get(dir);
          if (bucket) { bucket.push(s); break; }
          const parent = path.dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
      }
    }
    const out = [];
    for (const x of items) {
      if (x.songs) out.push(...x.songs);                                        // an album, an artist
      else if (x.isFolder) out.push(...under.get(x.path));
      else if (x.path) out.push(x);
    }
    return out;
  }

  /** Whether the view on screen has anything to play (cheap: for enabling Play). */
  hasSongs() {
    if (!this.active) return false;
    return this.active.items.some((x) => (x.isFolder ? x.count > 0 : x.songs ? x.songs.length > 0 : !!x.path));
  }

  /** The songs of the view on screen, in the order shown (filtered by the search). */
  viewSongs() {
    const st = this.state;
    if (!st || !this.active) return [];
    return this.expand(this.active.items);
  }

  selectedSongs() {
    return this.active ? this.expand(this.active.selectedItems()) : [];
  }

  /** Double-click on a song: play it, with the rest of the view as the queue. */
  activateSong(list, song) {
    const songs = list.items.filter((x) => !x.isFolder);
    const i = songs.indexOf(song);
    if (i >= 0) this.actions.playSongs(songs, i);
  }

  /** The playing song changed: redraw the rows on screen that mark it. */
  playingChanged() {
    for (const l of [this.songs, this.tracks, this.folders]) if (l.el.parentNode === this.stage) l.refresh();
  }
}
