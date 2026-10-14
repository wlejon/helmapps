/**
 * Stopwatch page: high-precision hundredths readout (.num), Start/Stop (Space),
 * Lap (L), Reset (R), Copy Laps as TSV (Mod+C), and lap list marking fastest
 * (best) and slowest (worst) laps when >= 2 laps are recorded.
 */

import { h, attempt } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { toast } from '/lib/toast.js';
import { now } from './time.js';

export function formatStopwatchMs(ms) {
  const clamped = Math.max(0, Math.round(Number(ms) || 0));
  const totalCs = Math.floor(clamped / 10);
  const cs = String(totalCs % 100).padStart(2, '0');
  const totalSec = Math.floor(totalCs / 100);
  const ss = String(totalSec % 60).padStart(2, '0');
  const totalMin = Math.floor(totalSec / 60);
  const mm = String(totalMin % 60).padStart(2, '0');
  const hh = Math.floor(totalMin / 60);
  return hh > 0 ? `${hh}:${mm}:${ss}.${cs}` : `${mm}:${ss}.${cs}`;
}

export function createStopwatchView({ state, settings, commands }) {
  const timeEl = h('div.sw-readout.num', '00:00.00');
  const currentLapEl = h('div.sw-sub.dim.num', 'Lap 1 · 00:00.00');

  const toggleBtn = h('button.btn.primary.sw-toggle-btn', {
    onclick: () => commands.run('sw-toggle'),
  }, icon('play', 'sm'), 'Start');

  const lapBtn = h('button.btn.sw-lap-btn', {
    onclick: () => commands.run('sw-lap'),
  }, icon('plus', 'sm'), 'Lap');

  const resetBtn = h('button.btn.sw-reset-btn', {
    onclick: () => commands.run('sw-reset'),
  }, icon('rotate-ccw', 'sm'), 'Reset');

  const copyBtn = h('button.btn.ghost.small.sw-copy-btn', {
    onclick: () => commands.run('sw-copy-laps'),
  }, icon('copy', 'sm'), 'Copy TSV');

  const hero = h('div.sw-hero.card',
    timeEl,
    currentLapEl,
    h('div.sw-controls', toggleBtn, lapBtn, resetBtn)
  );

  const lapsHeader = h('div.sw-laps-head',
    h('span.micro', 'LAPS'),
    copyBtn
  );

  const lapsTableHead = h('div.sw-laps-cols.micro',
    h('span.sw-col-num', 'LAP'),
    h('span.sw-col-tag', ''),
    h('span.sw-col-lap', 'LAP TIME'),
    h('span.sw-col-split', 'SPLIT TIME')
  );

  const lapsListEl = h('div.sw-laps-list');
  const lapsWrap = h('div.sw-laps-card.card.hidden',
    lapsHeader,
    lapsTableHead,
    lapsListEl
  );

  const root = h('div.clock-page.scroll',
    h('div.page.clock-page-inner',
      hero,
      lapsWrap
    )
  );

  let renderedLapsKey = '';
  let lastRunning = null;
  let lastElapsedText = '';
  let lastSubText = '';

  function persist() {
    settings.set('stopwatch', state.stopwatch);
  }

  function getElapsedMs(currentNow = now()) {
    const sw = state.stopwatch;
    if (sw.running && sw.startedAt != null) {
      return Math.max(0, (Number(sw.elapsedMs) || 0) + (currentNow - sw.startedAt));
    }
    return Math.max(0, Number(sw.elapsedMs) || 0);
  }

  function computeBestWorstIds(laps) {
    if (!laps || laps.length < 2) return { bestIndex: -1, worstIndex: -1 };
    let bestIdx = 0;
    let worstIdx = 0;
    for (let i = 1; i < laps.length; i++) {
      if (laps[i].lapMs < laps[bestIdx].lapMs) bestIdx = i;
      if (laps[i].lapMs > laps[worstIdx].lapMs) worstIdx = i;
    }
    if (laps[bestIdx].lapMs === laps[worstIdx].lapMs) {
      return { bestIndex: bestIdx, worstIndex: -1 };
    }
    return { bestIndex: bestIdx, worstIndex: worstIdx };
  }

  function rebuildLapsIfNeeded() {
    const sw = state.stopwatch;
    const laps = sw.laps || [];
    const key = laps.map((l) => `${l.index}:${l.lapMs}:${l.splitMs}`).join('|');
    if (key === renderedLapsKey) return;
    renderedLapsKey = key;

    const hasLaps = laps.length > 0;
    lapsWrap.classList.toggle('hidden', !hasLaps);
    copyBtn.disabled = !hasLaps;
    if (!hasLaps) {
      lapsListEl.replaceChildren();
      return;
    }

    const { bestIndex, worstIndex } = computeBestWorstIds(laps);
    const rows = laps.map((lap, idx) => {
      const isBest = idx === bestIndex;
      const isWorst = idx === worstIndex;
      const cls = ['sw-lap-row'];
      if (isBest) cls.push('best');
      if (isWorst) cls.push('worst');
      return h(`div.${cls.join('.')}`, {
        dataset: {
          lapIndex: String(lap.index),
          best: isBest ? 'true' : 'false',
          worst: isWorst ? 'true' : 'false',
        },
      },
        h('span.sw-col-num.num', `#${lap.index}`),
        h('span.sw-col-tag',
          isBest ? h('span.badge.ok.sw-badge-best', 'Best') : null,
          isWorst ? h('span.badge.danger.sw-badge-worst', 'Worst') : null
        ),
        h('span.sw-col-lap.num', formatStopwatchMs(lap.lapMs)),
        h('span.sw-col-split.num.dim', formatStopwatchMs(lap.splitMs))
      );
    });

    lapsListEl.replaceChildren(...rows);
  }

  function updateControls() {
    const sw = state.stopwatch;
    const elapsed = getElapsedMs();
    if (sw.running !== lastRunning) {
      lastRunning = sw.running;
      toggleBtn.classList.toggle('primary', !sw.running);
      toggleBtn.replaceChildren(icon(sw.running ? 'pause' : 'play', 'sm'), sw.running ? 'Stop' : (elapsed > 0 ? 'Resume' : 'Start'));
    } else if (!sw.running) {
      const wantLabel = elapsed > 0 ? 'Resume' : 'Start';
      if (toggleBtn.textContent !== wantLabel) {
        toggleBtn.replaceChildren(icon('play', 'sm'), wantLabel);
      }
    }
    lapBtn.disabled = !sw.running && elapsed === 0;
    resetBtn.disabled = !sw.running && elapsed === 0 && (!sw.laps || sw.laps.length === 0);
  }

  function updateValues() {
    const sw = state.stopwatch;
    const totalMs = getElapsedMs();
    const text = formatStopwatchMs(totalMs);
    if (text !== lastElapsedText) {
      lastElapsedText = text;
      timeEl.textContent = text;
    }
    const laps = sw.laps || [];
    const prevSplit = laps.length > 0 ? laps[laps.length - 1].splitMs : 0;
    const currentLapMs = Math.max(0, totalMs - prevSplit);
    const subText = `Lap ${laps.length + 1} · ${formatStopwatchMs(currentLapMs)}`;
    if (subText !== lastSubText) {
      lastSubText = subText;
      currentLapEl.textContent = subText;
    }
    updateControls();
  }

  function render() {
    rebuildLapsIfNeeded();
    updateValues();
  }

  function swStart() {
    const sw = state.stopwatch;
    if (!sw.running) {
      sw.running = true;
      sw.startedAt = now();
      persist();
      render();
    }
    return sw;
  }

  function swStop() {
    const sw = state.stopwatch;
    if (sw.running) {
      sw.elapsedMs = getElapsedMs(now());
      sw.running = false;
      sw.startedAt = null;
      persist();
      render();
    }
    return sw;
  }

  function swToggle() {
    return state.stopwatch.running ? swStop() : swStart();
  }

  function swLap() {
    const sw = state.stopwatch;
    const totalMs = getElapsedMs(now());
    if (!sw.running && totalMs <= 0) return null;
    if (!Array.isArray(sw.laps)) sw.laps = [];
    const prevSplit = sw.laps.length > 0 ? sw.laps[sw.laps.length - 1].splitMs : 0;
    const lapMs = Math.max(0, totalMs - prevSplit);
    const entry = {
      index: sw.laps.length + 1,
      lapMs,
      splitMs: totalMs,
      lapFormatted: formatStopwatchMs(lapMs),
      splitFormatted: formatStopwatchMs(totalMs),
    };
    sw.laps.push(entry);
    const { bestIndex, worstIndex } = computeBestWorstIds(sw.laps);
    sw.laps.forEach((l, i) => {
      l.best = i === bestIndex;
      l.worst = i === worstIndex;
    });
    persist();
    render();
    return entry;
  }

  function swReset() {
    state.stopwatch = {
      running: false,
      startedAt: null,
      elapsedMs: 0,
      laps: [],
    };
    persist();
    render();
    return state.stopwatch;
  }

  async function swCopyLaps() {
    const laps = state.stopwatch.laps || [];
    if (!laps.length) return '';
    const lines = ['Lap\tLap Time\tSplit Time'];
    for (const l of laps) {
      lines.push(`${l.index}\t${formatStopwatchMs(l.lapMs)}\t${formatStopwatchMs(l.splitMs)}`);
    }
    const tsv = lines.join('\n');
    state.lastCopiedTsv = tsv;
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await attempt('stopwatch.clipboard', () => navigator.clipboard.writeText(tsv));
    }
    toast(`Copied ${laps.length} ${laps.length === 1 ? 'lap' : 'laps'}`, { icon: 'copy' });
    return tsv;
  }

  return {
    el: root,
    render,
    tick: updateValues,
    getElapsedMs,
    swStart,
    swStop,
    swToggle,
    swLap,
    swReset,
    swCopyLaps,
  };
}
