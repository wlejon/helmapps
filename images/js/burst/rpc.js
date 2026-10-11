/**
 * Requests to a worker, one promise per request, answered by id. A reply
 * carrying `progress` (and not `finished`) is progress: it goes to the
 * request's onProgress and the request stays open.
 *
 *   const w = new WorkerClient('js/burst/track-worker.js');
 *   const { frame } = await w.call({ op: 'segment', ... });
 *   await w.call({ op: 'export', ... }, { onProgress: (m) => bar.set(m.progress) });
 *   w.post({ op: 'cancel' });                // a message with no answer
 */

export class WorkerClient {
  constructor(url) {
    this.url = url;
    this.worker = null;
    this.seq = 0;
    this.pending = new Map();
  }

  ensure() {
    if (this.worker) return this.worker;
    this.worker = new Worker(this.url);
    this.worker.onmessage = (e) => this.reply(e.data || {});
    this.worker.onerror = (e) => {
      const err = new Error((e && e.message) || `${this.url} stopped`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.worker = null;
    };
    return this.worker;
  }

  call(msg, { onProgress = null, transfer = [] } = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject, onProgress });
      this.ensure().postMessage({ ...msg, id }, transfer);
    });
  }

  post(msg) {
    this.ensure().postMessage(msg);
  }

  reply(m) {
    const p = this.pending.get(m.id);
    if (!p) return;
    if (m.progress !== undefined && !m.finished && !m.error && !m.cancelled) {
      if (p.onProgress) p.onProgress(m);
      return;
    }
    this.pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m);
  }

  terminate() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    const err = new Error('stopped');
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
