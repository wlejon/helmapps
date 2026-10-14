/**
 * Timers page: multiple concurrent countdown timers with preset chips, custom
 * duration dialog, circular SVG progress ring, +1:00 quick-add, start/pause/
 * resume/reset/delete, and exact deadline tracking based on now().
 */

import { h, api, attempt } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { emptyState } from '/lib/layout.js';
import { Dialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { formatDuration } from '/lib/format.js';
import { now } from './time.js';
import { playChime } from './sound.js';

const PRESETS = [
  { label: '1m', ms: 60 * 1000, title: '1 min' },
  { label: '3m', ms: 3 * 60 * 1000, title: '3 min' },
  { label: '5m', ms: 5 * 60 * 1000, title: '5 min' },
  { label: '10m', ms: 10 * 60 * 1000, title: '10 min' },
  { label: '15m', ms: 15 * 60 * 1000, title: '15 min' },
  { label: '30m', ms: 30 * 60 * 1000, title: '30 min' },
  { label: '1h', ms: 60 * 60 * 1000, title: '1 hour' },
];

const RING_RADIUS = 50;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

let timerSeq = 1;

export function createTimersView({ state, settings, commands, onEnd }) {
  const presetButtons = PRESETS.map((p) =>
    h('button.btn.small.timer-preset-chip', {
      dataset: { presetMs: String(p.ms) },
      onclick: () => commands.run('timer-add-preset', { durationMs: p.ms, label: p.title, start: true }),
    }, icon('plus', 'sm'), p.label)
  );

  const presetsBar = h('div.timer-presets-bar.card',
    h('div.timer-presets-left',
      h('span.micro', 'QUICK TIMER'),
      h('div.timer-preset-chips', ...presetButtons)
    ),
    h('button.btn.primary.small', {
      onclick: () => commands.run('timer-new'),
    }, icon('plus', 'sm'), 'Custom Timer…')
  );

  const gridEl = h('div.timers-grid');
  const emptyEl = emptyState({
    icon: 'timer',
    title: 'No active timers',
    hint: 'Pick a preset duration above or create a custom countdown timer.',
    action: { label: 'New Timer…', run: () => commands.run('timer-new') },
  });

  const root = h('div.clock-page.scroll',
    h('div.page.clock-page-inner',
      presetsBar,
      gridEl,
      emptyEl
    )
  );

  const cardRefs = new Map();
  let renderedSignature = '';

  function persist() {
    settings.set('timers', state.timers);
  }

  function computeRemainingMs(t, currentNow = now()) {
    if (t.status === 'running' && t.endAt != null) {
      return Math.max(0, t.endAt - currentNow);
    }
    return Math.max(0, Number(t.remainingMs) || 0);
  }

  function formatTimerReadout(ms) {
    const totalSec = Math.ceil(Math.max(0, ms) / 1000);
    return formatDuration(totalSec);
  }

  function makeSvgRing() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('class', 'timer-ring-svg');
    const track = document.createElementNS(ns, 'circle');
    track.setAttribute('cx', '60');
    track.setAttribute('cy', '60');
    track.setAttribute('r', String(RING_RADIUS));
    track.setAttribute('class', 'timer-ring-track');
    const fill = document.createElementNS(ns, 'circle');
    fill.setAttribute('cx', '60');
    fill.setAttribute('cy', '60');
    fill.setAttribute('r', String(RING_RADIUS));
    fill.setAttribute('class', 'timer-ring-fill');
    fill.setAttribute('stroke-dasharray', String(RING_CIRC.toFixed(2)));
    fill.setAttribute('stroke-dashoffset', '0');
    svg.append(track, fill);
    return { svg, fill };
  }

  function rebuildCardsIfNeeded() {
    const sig = state.timers.map((t) => `${t.id}:${t.status}:${t.label}`).join('|');
    if (sig === renderedSignature) return;
    renderedSignature = sig;
    cardRefs.clear();

    const has = state.timers.length > 0;
    gridEl.classList.toggle('hidden', !has);
    emptyEl.classList.toggle('hidden', has);
    if (!has) {
      gridEl.replaceChildren();
      return;
    }

    const cards = state.timers.map((t) => {
      const { svg, fill } = makeSvgRing();
      const timeEl = h('div.timer-readout.num');
      const subEl = h('div.timer-sub.dim.num');
      const ringWrap = h('div.timer-ring-wrap',
        svg,
        h('div.timer-ring-center', timeEl, subEl)
      );

      const isRunning = t.status === 'running';
      const isFinished = t.status === 'finished';

      const toggleBtn = h(
        isRunning ? 'button.btn.timer-toggle-btn' : 'button.btn.primary.timer-toggle-btn',
        {
          dataset: { action: isRunning ? 'pause' : 'start' },
          onclick: () => {
            if (t.status === 'running') commands.run('timer-pause', { id: t.id });
            else commands.run('timer-start', { id: t.id });
          },
        },
        icon(isRunning ? 'pause' : 'play', 'sm'),
        isRunning ? 'Pause' : isFinished ? 'Restart' : t.remainingMs < t.durationMs ? 'Resume' : 'Start'
      );

      const plusMinBtn = h('button.btn.small.timer-plus-min', {
        'data-tip': 'Add 1 minute',
        onclick: () => commands.run('timer-add-minute', { id: t.id }),
      }, '+1:00');

      const resetBtn = h('button.btn.small.timer-reset-btn', {
        'data-tip': 'Reset Timer',
        onclick: () => commands.run('timer-reset', { id: t.id }),
      }, icon('rotate-ccw', 'sm'), 'Reset');

      const delBtn = h('button.icon-btn.small.timer-delete-btn', {
        'aria-label': `Delete ${t.label}`,
        'data-tip': 'Delete Timer',
        onclick: () => commands.run('timer-delete', { id: t.id }),
      }, icon('trash', 'sm'));

      const card = h('div.timer-card.card', {
        dataset: { timerId: t.id, status: t.status },
      },
        h('div.timer-card-head',
          h('span.title.ellipsis', t.label || 'Timer'),
          delBtn
        ),
        ringWrap,
        h('div.timer-card-controls',
          toggleBtn,
          plusMinBtn,
          resetBtn
        )
      );
      if (isFinished) card.classList.add('finished');

      cardRefs.set(t.id, {
        card,
        fill,
        timeEl,
        subEl,
        lastReadout: '',
        lastOffset: '',
        lastSub: '',
      });
      return card;
    });

    gridEl.replaceChildren(...cards);
  }

  function notifyTimerFinished(t) {
    t.status = 'finished';
    t.remainingMs = 0;
    t.endAt = null;
    t.firedCount = (t.firedCount || 0) + 1;
    state.timerEndEvents = (state.timerEndEvents || 0) + 1;
    state.lastFinishedTimerId = t.id;

    playChime(state, 'timer');
    toast(`Timer finished: ${t.label || 'Timer'}`, {
      icon: 'timer',
      key: `timer-${t.id}`,
      action: '+1:00',
      onAction: () => addOneMinute(t.id),
    });

    const win = api('window');
    if (win && typeof win.requestAttention === 'function') {
      attempt('window.requestAttention', () => win.requestAttention(true));
    }
    if (typeof Notification === 'function') {
      attempt('timer.Notification', () => new Notification('Timer Finished', { body: t.label || 'Timer is up' }));
    }
    if (onEnd) onEnd(t);
  }

  function updateValues() {
    const currentNow = now();
    let statusChanged = false;

    for (const t of state.timers) {
      if (t.status === 'running' && t.endAt != null && currentNow >= t.endAt) {
        notifyTimerFinished(t);
        statusChanged = true;
      }
    }

    if (statusChanged) {
      persist();
      rebuildCardsIfNeeded();
    }

    for (const t of state.timers) {
      const ref = cardRefs.get(t.id);
      if (!ref) continue;
      const rem = computeRemainingMs(t, currentNow);
      const readout = formatTimerReadout(rem);
      if (readout !== ref.lastReadout) {
        ref.lastReadout = readout;
        ref.timeEl.textContent = readout;
      }
      const total = Math.max(1000, Number(t.durationMs) || 1000);
      const frac = Math.max(0, Math.min(1, rem / total));
      const dashOffset = ((1 - frac) * RING_CIRC).toFixed(2);
      if (dashOffset !== ref.lastOffset) {
        ref.lastOffset = dashOffset;
        ref.fill.setAttribute('stroke-dashoffset', dashOffset);
      }
      const subText = t.status === 'finished'
        ? 'Done'
        : `${formatDuration(Math.round(total / 1000))} total`;
      if (subText !== ref.lastSub) {
        ref.lastSub = subText;
        ref.subEl.textContent = subText;
      }
    }
  }

  function render() {
    rebuildCardsIfNeeded();
    updateValues();
  }

  function addTimer(opts = {}) {
    let durationMs = 60000;
    let label = '';
    let start = true;
    if (typeof opts === 'number') {
      durationMs = opts;
    } else if (opts && typeof opts === 'object') {
      if (opts.durationMs != null) durationMs = Number(opts.durationMs);
      else if (opts.seconds != null) durationMs = Number(opts.seconds) * 1000;
      else if (opts.minutes != null) durationMs = Number(opts.minutes) * 60000;
      label = opts.label || '';
      if (opts.start !== undefined) start = !!opts.start;
    }
    durationMs = Math.max(1000, Math.round(durationMs));
    if (!label) {
      label = `${formatDuration(Math.round(durationMs / 1000))} Timer`;
    }
    const currentNow = now();
    const id = (opts && opts.id) || `timer-${currentNow}-${timerSeq++}`;
    const timer = {
      id,
      label,
      durationMs,
      remainingMs: durationMs,
      endAt: start ? currentNow + durationMs : null,
      status: start ? 'running' : 'paused',
      firedCount: 0,
    };
    state.timers.push(timer);
    persist();
    render();
    return timer;
  }

  function findTimer(idOrObj) {
    const id = typeof idOrObj === 'object' && idOrObj ? idOrObj.id : idOrObj;
    if (!id) return state.timers[0] || null;
    return state.timers.find((t) => t.id === id) || null;
  }

  function startTimer(idOrObj) {
    const t = findTimer(idOrObj);
    if (!t) return null;
    const currentNow = now();
    if (t.status === 'finished' || t.remainingMs <= 0) {
      t.remainingMs = t.durationMs;
    }
    t.status = 'running';
    t.endAt = currentNow + t.remainingMs;
    persist();
    render();
    return t;
  }

  function pauseTimer(idOrObj) {
    const t = findTimer(idOrObj);
    if (!t) return null;
    if (t.status === 'running') {
      t.remainingMs = computeRemainingMs(t, now());
      t.endAt = null;
      t.status = 'paused';
      persist();
      render();
    }
    return t;
  }

  function resetTimer(idOrObj) {
    const t = findTimer(idOrObj);
    if (!t) return null;
    t.status = 'paused';
    t.remainingMs = t.durationMs;
    t.endAt = null;
    persist();
    render();
    return t;
  }

  function deleteTimer(idOrObj) {
    const id = typeof idOrObj === 'object' && idOrObj ? idOrObj.id : idOrObj;
    const before = state.timers.length;
    state.timers = state.timers.filter((t) => t.id !== id);
    if (state.timers.length !== before) {
      persist();
      render();
      return true;
    }
    return false;
  }

  function addOneMinute(idOrObj) {
    const t = findTimer(idOrObj);
    if (!t) return null;
    const currentNow = now();
    const extra = 60 * 1000;
    if (t.status === 'running' && t.endAt != null) {
      t.endAt += extra;
      t.remainingMs = Math.max(0, t.endAt - currentNow);
    } else if (t.status === 'finished') {
      t.status = 'running';
      t.remainingMs = extra;
      t.endAt = currentNow + extra;
    } else {
      t.remainingMs = (Number(t.remainingMs) || 0) + extra;
    }
    if (t.remainingMs > t.durationMs) {
      t.durationMs = t.remainingMs;
    }
    persist();
    render();
    return t;
  }

  async function openNewTimerDialog() {
    const d = new Dialog({ title: 'New Timer', icon: 'timer' });
    const hrsInput = h('input.field.num', { type: 'number', min: '0', max: '99', value: '0' });
    const minInput = h('input.field.num', { type: 'number', min: '0', max: '59', value: '5' });
    const secInput = h('input.field.num', { type: 'number', min: '0', max: '59', value: '0' });
    const labelInput = h('input.field', { type: 'text', placeholder: 'Label (e.g. Tea, Pasta, Workout)' });

    d.body.append(
      h('div.timer-dialog-fields',
        h('label.timer-dialog-col', h('span.micro', 'HOURS'), hrsInput),
        h('label.timer-dialog-col', h('span.micro', 'MINUTES'), minInput),
        h('label.timer-dialog-col', h('span.micro', 'SECONDS'), secInput)
      ),
      labelInput
    );
    d.addButton('Cancel', { value: null });
    d.addButton('Start Timer', { primary: true, onClick: () => {
      const hh = Math.max(0, parseInt(hrsInput.value, 10) || 0);
      const mm = Math.max(0, parseInt(minInput.value, 10) || 0);
      const ss = Math.max(0, parseInt(secInput.value, 10) || 0);
      const ms = (hh * 3600 + mm * 60 + ss) * 1000;
      if (ms <= 0) return false;
      d.close({ durationMs: ms, label: labelInput.value.trim(), start: true });
      return false;
    } });

    const res = await d.open();
    if (res) {
      return addTimer(res);
    }
    return null;
  }

  return {
    el: root,
    render,
    tick: updateValues,
    computeRemainingMs,
    addTimer,
    startTimer,
    pauseTimer,
    resetTimer,
    deleteTimer,
    addOneMinute,
    openNewTimerDialog,
  };
}
