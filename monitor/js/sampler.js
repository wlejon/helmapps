/**
 * Unified Sampler controller (no DOM) combining SysSampler and ProcSampler.
 * Manages periodic sampling (0.5, 1, 2, or 5 s), root directory overrides for
 * headless tests, and pausing when the window is hidden.
 */

import {
  RING_SIZE,
  SysSampler,
  parseProcStat,
  computeCpuDelta,
  parseMeminfo,
  parseDiskstats,
  parseNetDev,
  parseLoadavg,
  parseUptime,
  parseCpuinfoModel,
} from './sys-sampler.js';

import {
  PAGE_SIZE,
  STATE_NAMES,
  ProcSampler,
  parsePidStat,
  parsePidStatus,
  parsePidCmdline,
  computeProcCpuPct,
  computeSysProcCpuPct,
} from './proc-sampler.js';

export {
  RING_SIZE,
  PAGE_SIZE,
  STATE_NAMES,
  SysSampler,
  ProcSampler,
  parseProcStat,
  computeCpuDelta,
  parseMeminfo,
  parseDiskstats,
  parseNetDev,
  parseLoadavg,
  parseUptime,
  parseCpuinfoModel,
  parsePidStat,
  parsePidStatus,
  parsePidCmdline,
  computeProcCpuPct,
  computeSysProcCpuPct,
};

export class Sampler {
  constructor({ root = '/', intervalSec = 1, onTick } = {}) {
    this.root = root;
    this.intervalSec = Number(intervalSec) || 1;
    this.onTick = onTick || null;
    this.sys = new SysSampler(root);
    this.proc = new ProcSampler(root);
    this.timer = null;
    this.running = false;
    this.paused = false;
    this.tickCount = 0;
    this.inFlight = null;
    this.gen = 0;
  }

  setRoot(root) {
    this.gen++;
    this.inFlight = null;
    this.root = root || '/';
    this.sys.setRoot(this.root);
    this.proc.setRoot(this.root);
    this.tickCount = 0;
  }

  setSysApi(sysApi) {
    this.gen++;
    this.inFlight = null;
    this.proc.setSysApi(sysApi);
    this.tickCount = 0;
  }

  setIntervalSec(sec) {
    const valid = [0.5, 1, 2, 5].includes(Number(sec)) ? Number(sec) : 1;
    this.intervalSec = valid;
    if (this.running && !this.paused) {
      this._schedule();
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.tick();
    this._schedule();
  }

  stop() {
    this.running = false;
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setPaused(paused) {
    const p = !!paused;
    if (this.paused === p) return;
    this.paused = p;
    if (this.paused) {
      if (this.timer != null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    } else if (this.running) {
      this.tick();
      this._schedule();
    }
  }

  _schedule() {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (!this.running || this.paused) return;
    const ms = Math.round(this.intervalSec * 1000);
    this.timer = setInterval(() => {
      if (!this.paused && !this.inFlight) {
        this.tick();
      }
    }, ms);
  }

  /**
   * Perform one full sample tick (system metrics + processes) and notify listener.
   */
  async tick(nowMs = Date.now()) {
    if (this.inFlight) return this.inFlight;
    const myGen = this.gen;
    const sys = this.sys;
    const proc = this.proc;
    const run = (async () => {
      try {
        await sys.sample(nowMs);
        if (this.gen !== myGen) return this;
        await proc.sample(sys.lastJiffiesDelta, nowMs);
        if (this.gen !== myGen) return this;
        this.tickCount++;
        if (this.onTick) this.onTick(this);
      } finally {
        if (this.inFlight === run) this.inFlight = null;
      }
      return this;
    })();
    this.inFlight = run;
    return run;
  }
}
