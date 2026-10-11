/**
 * What the user changed about the burst's frames: which are removed from
 * the animation and each frame's own hold, with undo and redo. The state is
 * the session's frames (frame.included, frame.hold); each edit records the
 * frames' state before it, so Undo puts it back whatever it was.
 *
 *   const edits = new FrameEdits(session);
 *   edits.remove([3, 4]);               // out of the animation and the timeline
 *   edits.restore();                    // every removed frame back (or restore([3]))
 *   edits.setHolds([1, 2], 0.25);       // seconds at 1x; null puts back the time as shot
 *   const drag = edits.begin();          // a drag: many setHolds, one undo step
 *   drag.end();
 *   edits.undo(); edits.redo();
 *
 * A frame that failed to load (frame.error) is never in the animation and
 * never counts as removed.
 */

/** Holds are kept between these, in seconds. */
export const MIN_HOLD = 0.02;
export const MAX_HOLD = 10;

const DEPTH = 100;

export class FrameEdits {
  constructor(session) {
    this.session = session;
    this.undoStack = [];
    this.redoStack = [];
    this.open = null;                 // the state before a drag in progress
  }

  /** A new burst: nothing to undo. */
  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.open = null;
  }

  state() {
    return this.session.frames.map((f) => ({ included: f.included, hold: f.hold }));
  }

  apply(state) {
    this.session.frames.forEach((f, k) => {
      const s = state[k];
      if (!s) return;
      f.included = s.included && !f.error;
      f.hold = s.hold;
    });
  }

  same(a, b) {
    return a.length === b.length && a.every((s, k) => s.included === b[k].included && s.hold === b[k].hold);
  }

  /** Run fn as one undo step; answers whether anything changed. */
  edit(fn) {
    const before = this.state();
    fn();
    if (this.open) return !this.same(before, this.state());
    if (this.same(before, this.state())) return false;
    this.push(before);
    return true;
  }

  push(before) {
    this.undoStack.push(before);
    if (this.undoStack.length > DEPTH) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Start a drag: the edits until end() are one step. */
  begin() {
    const before = this.state();
    this.open = before;
    return {
      end: () => {
        if (this.open !== before) return false;
        this.open = null;
        if (this.same(before, this.state())) return false;
        this.push(before);
        return true;
      },
      cancel: () => {
        if (this.open !== before) return;
        this.open = null;
        this.apply(before);
      },
    };
  }

  /** The frames in the animation (loaded and not removed), as indices. */
  kept() {
    return this.session.frames.map((f, k) => (f.included && !f.error ? k : -1)).filter((k) => k >= 0);
  }

  /** The frames removed from the animation, as indices. */
  removed() {
    return this.session.frames.map((f, k) => (!f.included && !f.error ? k : -1)).filter((k) => k >= 0);
  }

  remove(indices) {
    return this.edit(() => {
      for (const k of indices) { const f = this.session.frames[k]; if (f) f.included = false; }
    });
  }

  /** Put removed frames back: these, or every one. */
  restore(indices = null) {
    const list = indices || this.removed();
    return this.edit(() => {
      for (const k of list) { const f = this.session.frames[k]; if (f && !f.error) f.included = true; }
    });
  }

  setIncluded(k, on) {
    return on ? this.restore([k]) : this.remove([k]);
  }

  /** Each frame's own hold (seconds at 1x), or null for its time as shot. */
  setHolds(indices, seconds) {
    const v = seconds == null ? null : Math.min(MAX_HOLD, Math.max(MIN_HOLD, Number(seconds)));
    return this.edit(() => {
      for (const k of indices) { const f = this.session.frames[k]; if (f) f.hold = v; }
    });
  }

  get canUndo() { return this.undoStack.length > 0 && !this.open; }
  get canRedo() { return this.redoStack.length > 0 && !this.open; }

  undo() {
    if (!this.canUndo) return false;
    const now = this.state();
    this.apply(this.undoStack.pop());
    this.redoStack.push(now);
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    const now = this.state();
    this.apply(this.redoStack.pop());
    this.undoStack.push(now);
    return true;
  }
}
