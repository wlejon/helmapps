/**
 * The play queue: songs in the order they will play, the one playing, and
 * what shuffle and repeat do to that order.
 *
 *   const q = new Queue();
 *   q.set(paths, 3);              // play paths[3] now, the rest after it
 *   q.next() / q.prev()           // the new index, or -1 at the end with repeat off
 *   q.playNext(paths)             // right after the current song
 *   q.add(paths)                  // at the end
 *   q.move(from, to), q.remove(ids)
 *
 * Shuffle reorders the queue itself: the current song moves to the front
 * and the rest is shuffled behind it, so the Queue page always shows what
 * plays next, and every song plays once before any repeats. With repeat
 * all, each pass through a shuffled queue starts with a fresh order. Turning
 * shuffle off puts the queue back in the order it had before.
 *
 * Entries have their own ids, so one song can be queued twice.
 */

let seq = 0;
const entry = (path) => ({ id: ++seq, path });

/** Fisher-Yates over a[from..]. */
function shuffleFrom(a, from, random = Math.random) {
  for (let i = a.length - 1; i > from; i--) {
    const j = from + Math.floor(random() * (i - from + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Queue {
  constructor() {
    this.entries = [];
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off';          // 'off' | 'all' | 'one'
    this.original = null;         // entry ids in their order before shuffle
    this.version = 0;
  }

  get current() {
    return this.entries[this.index] || null;
  }

  get length() {
    return this.entries.length;
  }

  changed() {
    this.version++;
  }

  /** Replace the queue with paths, starting at paths[start]. */
  set(paths, start = 0) {
    this.entries = paths.map(entry);
    this.index = paths.length ? Math.max(0, Math.min(start, paths.length - 1)) : -1;
    this.original = null;
    if (this.shuffle) this.shuffleUpcoming();
    this.changed();
  }

  /** Restore a saved queue ({ paths, index }) as it was, without shuffling it again. */
  restore(paths, index) {
    this.entries = paths.map(entry);
    this.index = paths.length ? Math.max(0, Math.min(index, paths.length - 1)) : -1;
    this.original = null;
    this.changed();
  }

  /** Current to the front, everything else shuffled behind it. */
  shuffleUpcoming() {
    if (!this.original) this.original = this.entries.map((e) => e.id);
    const cur = this.current;
    const rest = this.entries.filter((e) => e !== cur);
    shuffleFrom(rest, 0);
    this.entries = cur ? [cur, ...rest] : rest;
    this.index = cur ? 0 : (this.entries.length ? 0 : -1);
  }

  setShuffle(on) {
    if (!!on === this.shuffle) return;
    this.shuffle = !!on;
    if (this.shuffle) {
      this.original = null;
      this.shuffleUpcoming();
    } else if (this.original) {
      const cur = this.current;
      const rank = new Map(this.original.map((id, i) => [id, i]));
      // Songs queued while shuffled keep their place after the ones that were there before.
      const old = this.entries.filter((e) => rank.has(e.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
      const added = this.entries.filter((e) => !rank.has(e.id));
      this.entries = [...old, ...added];
      this.index = cur ? this.entries.indexOf(cur) : -1;
      this.original = null;
    }
    this.changed();
  }

  setRepeat(mode) {
    this.repeat = ['off', 'all', 'one'].includes(mode) ? mode : 'off';
    this.changed();
  }

  /**
   * The index after this one, made current; -1 (and nothing changes) past
   * the end with repeat off. `auto` is a song that ended by itself: with
   * repeat one it plays again.
   */
  next({ auto = false } = {}) {
    const n = this.entries.length;
    if (!n) return -1;
    if (auto && this.repeat === 'one') return this.index;
    if (this.index + 1 < n) {
      this.index++;
    } else if (this.repeat !== 'off') {
      if (this.shuffle && n > 2) {
        // A new pass, freshly shuffled; the song that just played does not lead it.
        const last = this.current;
        shuffleFrom(this.entries, 0);
        if (this.entries[0] === last) [this.entries[0], this.entries[n - 1]] = [this.entries[n - 1], this.entries[0]];
      }
      this.index = 0;
    } else {
      return -1;
    }
    this.changed();
    return this.index;
  }

  /** The index before this one (the last, with repeat on, from the first). */
  prev() {
    const n = this.entries.length;
    if (!n) return -1;
    if (this.index > 0) this.index--;
    else if (this.repeat !== 'off') this.index = n - 1;
    else this.index = 0;
    this.changed();
    return this.index;
  }

  go(i) {
    if (i < 0 || i >= this.entries.length) return -1;
    this.index = i;
    this.changed();
    return i;
  }

  /** Insert right after the current song (at the front of an empty queue). */
  playNext(paths) {
    const at = this.index < 0 ? 0 : this.index + 1;
    this.entries.splice(at, 0, ...paths.map(entry));
    if (this.index < 0 && this.entries.length) this.index = 0;
    this.changed();
  }

  add(paths) {
    this.entries.push(...paths.map(entry));
    if (this.index < 0 && this.entries.length) this.index = 0;
    this.changed();
  }

  /** Remove entries by id; the current one may go too (the next takes its place). */
  remove(ids) {
    const drop = new Set(ids);
    const cur = this.current;
    let before = 0;
    for (let i = 0; i < this.index; i++) if (drop.has(this.entries[i].id)) before++;
    this.entries = this.entries.filter((e) => !drop.has(e.id));
    if (cur && !drop.has(cur.id)) this.index = this.entries.indexOf(cur);
    else this.index = Math.min(this.index - before, this.entries.length - 1);
    if (!this.entries.length) this.index = -1;
    this.changed();
  }

  /** Move the entry at `from` to position `to` (in the list without it). */
  move(from, to) {
    const n = this.entries.length;
    if (from < 0 || from >= n || to < 0 || to >= n || from === to) return;
    const cur = this.current;
    const [e] = this.entries.splice(from, 1);
    this.entries.splice(to, 0, e);
    this.index = cur ? this.entries.indexOf(cur) : -1;
    this.changed();
  }

  clear() {
    this.entries = [];
    this.index = -1;
    this.original = null;
    this.changed();
  }

  paths() {
    return this.entries.map((e) => e.path);
  }
}
