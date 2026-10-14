/**
 * Alarms page: list of alarms with time (HH:MM), label, repeat day toggles,
 * enabled Switch, Edit/Delete, plus an explicit banner ("Alarms ring while
 * Clocks is open") and a ringing banner/modal with Snooze (10 min) and Dismiss.
 */

import { h, api, attempt } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { emptyState } from '/lib/layout.js';
import { Dialog } from '/lib/dialog.js';
import { Switch } from '/lib/controls.js';
import { toast } from '/lib/toast.js';
import { now } from './time.js';
import { getZonedParts } from './cities.js';
import { playChime } from './sound.js';

const DAY_LABELS = [
  { dow: 1, short: 'M', name: 'Mon' },
  { dow: 2, short: 'T', name: 'Tue' },
  { dow: 3, short: 'W', name: 'Wed' },
  { dow: 4, short: 'T', name: 'Thu' },
  { dow: 5, short: 'F', name: 'Fri' },
  { dow: 6, short: 'S', name: 'Sat' },
  { dow: 0, short: 'S', name: 'Sun' },
];

let alarmSeq = 1;

export function formatAlarmTime(hour, minute) {
  return `${String(Number(hour) || 0).padStart(2, '0')}:${String(Number(minute) || 0).padStart(2, '0')}`;
}

function parseTimeString(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
  if (!m) return null;
  const hour = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const minute = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return { hour, minute };
}

export function createAlarmsView({ state, settings, commands, onRing }) {
  const infoBanner = h('div.alarm-info-banner.card',
    icon('info', 'sm'),
    h('span.alarm-info-text', 'Alarms ring while Clocks is open'),
    h('button.btn.primary.small', {
      onclick: () => commands.run('alarm-new'),
    }, icon('plus', 'sm'), 'Add Alarm…')
  );

  // Active ringing banner shown prominently when any alarm is ringing
  const ringingTitleEl = h('div.title.alarm-ringing-title', 'Alarm');
  const ringingTimeEl = h('div.dim.num.alarm-ringing-time', '');
  const ringingBanner = h('div.alarm-ringing-banner.card.hidden',
    h('div.alarm-ringing-left',
      h('div.alarm-ringing-glyph', icon('bell')),
      h('div.alarm-ringing-meta', ringingTitleEl, ringingTimeEl)
    ),
    h('div.alarm-ringing-actions',
      h('button.btn.alarm-snooze-btn', {
        onclick: () => commands.run('alarm-snooze'),
      }, 'Snooze (10 min)'),
      h('button.btn.primary.alarm-dismiss-btn', {
        onclick: () => commands.run('alarm-dismiss'),
      }, 'Dismiss')
    )
  );

  const listEl = h('div.alarms-list');
  const emptyEl = emptyState({
    icon: 'alarm',
    title: 'No alarms set',
    hint: 'Add an alarm for a specific time of day or repeating schedule.',
    action: { label: 'Add Alarm…', run: () => commands.run('alarm-new') },
  });

  const root = h('div.clock-page.scroll',
    h('div.page.clock-page-inner',
      infoBanner,
      ringingBanner,
      listEl,
      emptyEl
    )
  );

  let renderedSignature = '';

  function persist() {
    settings.set('alarms', state.alarms);
  }

  function normalizeAlarm(input = {}) {
    let hour = 7;
    let minute = 0;
    if (typeof input === 'string') {
      const parsed = parseTimeString(input);
      if (parsed) {
        hour = parsed.hour;
        minute = parsed.minute;
      }
    } else if (input && typeof input === 'object') {
      if (typeof input.time === 'string') {
        const parsed = parseTimeString(input.time);
        if (parsed) {
          hour = parsed.hour;
          minute = parsed.minute;
        }
      } else {
        if (input.hour != null) hour = Math.max(0, Math.min(23, Number(input.hour) || 0));
        if (input.minute != null) minute = Math.max(0, Math.min(59, Number(input.minute) || 0));
      }
    }
    const days = Array.isArray(input.days)
      ? Array.from(new Set(input.days.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)))
      : [];
    const id = (input && input.id) || `alarm-${now()}-${alarmSeq++}`;
    return {
      id,
      hour,
      minute,
      time: formatAlarmTime(hour, minute),
      label: (input && input.label) ? String(input.label) : 'Alarm',
      days,
      enabled: input && input.enabled !== undefined ? !!input.enabled : true,
      snoozedUntil: (input && input.snoozedUntil) || null,
      lastFiredMinuteKey: (input && input.lastFiredMinuteKey) || null,
      ringing: !!(input && input.ringing),
      firedCount: Number((input && input.firedCount) || 0),
    };
  }

  function updateRingingBanner() {
    const ringingAlarm = state.alarms.find((a) => a.ringing) || state.ringingAlarm || null;
    state.ringingAlarm = ringingAlarm;
    ringingBanner.classList.toggle('hidden', !ringingAlarm);
    if (ringingAlarm) {
      ringingTitleEl.textContent = ringingAlarm.label || 'Alarm';
      ringingTimeEl.textContent = formatAlarmTime(ringingAlarm.hour, ringingAlarm.minute);
    }
  }

  function rebuildListIfNeeded() {
    const sig = state.alarms.map((a) =>
      `${a.id}:${a.hour}:${a.minute}:${a.label}:${a.enabled}:${(a.days || []).join(',')}:${a.ringing}:${a.snoozedUntil || ''}`
    ).join('|');
    updateRingingBanner();
    if (sig === renderedSignature) return;
    renderedSignature = sig;

    const has = state.alarms.length > 0;
    listEl.classList.toggle('hidden', !has);
    emptyEl.classList.toggle('hidden', has);
    if (!has) {
      listEl.replaceChildren();
      return;
    }

    const cards = state.alarms.map((a) => {
      const sw = new Switch({
        on: !!a.enabled,
        label: `Enable ${a.label || 'Alarm'}`,
        onChange: (on) => toggleAlarm(a.id, on),
      });

      const dayChips = DAY_LABELS.map((d) => {
        const active = Array.isArray(a.days) && a.days.includes(d.dow);
        return h(`button.alarm-day-chip${active ? '.active' : ''}`, {
          title: d.name,
          dataset: { dow: String(d.dow) },
          onclick: () => {
            const set = new Set(a.days || []);
            if (set.has(d.dow)) set.delete(d.dow);
            else set.add(d.dow);
            updateAlarm(a.id, { days: Array.from(set) });
          },
        }, d.short);
      });

      const snoozeBadge = a.snoozedUntil
        ? h('span.badge.warn.num', `Snoozed until ${formatSnoozeTarget(a.snoozedUntil)}`)
        : null;
      const ringingBadge = a.ringing
        ? h('span.badge.danger', 'Ringing')
        : null;

      const editBtn = h('button.icon-btn.small.alarm-edit-btn', {
        'aria-label': `Edit ${a.label}`,
        'data-tip': 'Edit Alarm',
        onclick: () => openAlarmDialog(a),
      }, icon('edit', 'sm'));

      const delBtn = h('button.icon-btn.small.alarm-delete-btn', {
        'aria-label': `Delete ${a.label}`,
        'data-tip': 'Delete Alarm',
        onclick: () => commands.run('alarm-delete', { id: a.id }),
      }, icon('trash', 'sm'));

      const card = h(`div.alarm-card.card${a.enabled ? '' : '.disabled'}${a.ringing ? '.ringing' : ''}`, {
        dataset: { alarmId: a.id, enabled: String(!!a.enabled), ringing: String(!!a.ringing) },
      },
        h('div.alarm-card-left',
          h('div.alarm-time.num', formatAlarmTime(a.hour, a.minute)),
          h('div.alarm-meta',
            h('span.title.ellipsis', a.label || 'Alarm'),
            ringingBadge,
            snoozeBadge
          )
        ),
        h('div.alarm-days', ...dayChips),
        h('div.alarm-card-actions',
          sw.el,
          editBtn,
          delBtn
        )
      );
      return card;
    });

    listEl.replaceChildren(...cards);
  }

  function formatSnoozeTarget(epochMs) {
    const p = getZonedParts(epochMs, state.referenceZone || 'local');
    return formatAlarmTime(p.hour, p.minute);
  }

  function fireAlarm(a, minuteKey) {
    a.ringing = true;
    a.snoozedUntil = null;
    if (minuteKey) a.lastFiredMinuteKey = minuteKey;
    a.firedCount = (a.firedCount || 0) + 1;
    state.ringingAlarm = a;
    state.alarmFireEvents = (state.alarmFireEvents || 0) + 1;
    state.lastFiredAlarmId = a.id;

    playChime(state, 'alarm');
    toast(`Alarm: ${a.label || formatAlarmTime(a.hour, a.minute)}`, {
      icon: 'bell',
      key: `alarm-${a.id}`,
      ms: 10000,
      action: 'Snooze 10m',
      onAction: () => snoozeAlarm(a.id, 10),
    });

    const win = api('window');
    if (win && typeof win.requestAttention === 'function') {
      attempt('window.requestAttention', () => win.requestAttention(true));
    }
    if (typeof Notification === 'function') {
      attempt('alarm.Notification', () => new Notification('Alarm', {
        body: `${formatAlarmTime(a.hour, a.minute)} — ${a.label || 'Alarm'}`,
      }));
    }
    if (onRing) onRing(a);
  }

  function checkAlarms() {
    const currentNow = now();
    const parts = getZonedParts(currentNow, state.referenceZone || 'local');
    const minuteKey = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}:${parts.minute}`;
    let changed = false;

    for (const a of state.alarms) {
      if (!a.enabled) continue;

      // Check snooze deadline first
      if (a.snoozedUntil != null && currentNow >= a.snoozedUntil) {
        fireAlarm(a, minuteKey);
        changed = true;
        continue;
      }

      // Check scheduled hour:minute
      const dayMatches = !a.days || a.days.length === 0 || a.days.includes(parts.weekday);
      if (
        dayMatches &&
        parts.hour === Number(a.hour) &&
        parts.minute === Number(a.minute) &&
        a.lastFiredMinuteKey !== minuteKey &&
        !a.ringing
      ) {
        fireAlarm(a, minuteKey);
        changed = true;
      }
    }

    if (changed) {
      persist();
      rebuildListIfNeeded();
    }
  }

  function render() {
    rebuildListIfNeeded();
  }

  function addAlarm(input = {}) {
    const alarm = normalizeAlarm(input);
    // If added for the current exact minute, don't immediately fire on the same minute unless requested
    if (!input.fireImmediately) {
      const parts = getZonedParts(now(), state.referenceZone || 'local');
      if (parts.hour === alarm.hour && parts.minute === alarm.minute) {
        alarm.lastFiredMinuteKey = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}:${parts.minute}`;
      }
    }
    state.alarms.push(alarm);
    persist();
    render();
    return alarm;
  }

  function findAlarm(idOrObj) {
    const id = typeof idOrObj === 'object' && idOrObj ? idOrObj.id : idOrObj;
    if (!id) return state.ringingAlarm || state.alarms.find((a) => a.ringing) || state.alarms[0] || null;
    return state.alarms.find((a) => a.id === id) || null;
  }

  function updateAlarm(idOrObj, patch = {}) {
    const a = findAlarm(idOrObj);
    if (!a) return null;
    if (typeof patch.time === 'string') {
      const parsed = parseTimeString(patch.time);
      if (parsed) {
        a.hour = parsed.hour;
        a.minute = parsed.minute;
      }
    }
    if (patch.hour != null) a.hour = Math.max(0, Math.min(23, Number(patch.hour) || 0));
    if (patch.minute != null) a.minute = Math.max(0, Math.min(59, Number(patch.minute) || 0));
    a.time = formatAlarmTime(a.hour, a.minute);
    if (patch.label !== undefined) a.label = String(patch.label || 'Alarm');
    if (Array.isArray(patch.days)) a.days = Array.from(new Set(patch.days.map(Number)));
    if (patch.enabled !== undefined) {
      a.enabled = !!patch.enabled;
      if (!a.enabled) {
        a.ringing = false;
        a.snoozedUntil = null;
      }
    }
    persist();
    render();
    return a;
  }

  function toggleAlarm(idOrObj, forceState) {
    const a = findAlarm(idOrObj);
    if (!a) return null;
    const next = forceState !== undefined ? !!forceState : !a.enabled;
    return updateAlarm(a.id, { enabled: next });
  }

  function deleteAlarm(idOrObj) {
    const id = typeof idOrObj === 'object' && idOrObj ? idOrObj.id : idOrObj;
    const before = state.alarms.length;
    state.alarms = state.alarms.filter((a) => a.id !== id);
    if (state.ringingAlarm && state.ringingAlarm.id === id) {
      state.ringingAlarm = state.alarms.find((a) => a.ringing) || null;
    }
    if (state.alarms.length !== before) {
      persist();
      render();
      return true;
    }
    return false;
  }

  function snoozeAlarm(idOrObj, minutes = 10) {
    let targetId = idOrObj;
    let snoozeMin = minutes;
    if (typeof idOrObj === 'object' && idOrObj) {
      targetId = idOrObj.id;
      if (idOrObj.minutes != null) snoozeMin = idOrObj.minutes;
    }
    const a = findAlarm(targetId);
    if (!a) return null;
    const mins = Math.max(1, Number(snoozeMin) || 10);
    a.ringing = false;
    a.snoozedUntil = now() + mins * 60 * 1000;
    state.ringingAlarm = state.alarms.find((x) => x.ringing) || null;
    persist();
    render();
    return a;
  }

  function dismissAlarm(idOrObj) {
    const a = findAlarm(idOrObj);
    if (!a) return null;
    a.ringing = false;
    a.snoozedUntil = null;
    state.ringingAlarm = state.alarms.find((x) => x.ringing) || null;
    persist();
    render();
    return a;
  }

  async function openAlarmDialog(existing = null) {
    const isEdit = !!(existing && existing.id);
    const parts = getZonedParts(now(), state.referenceZone || 'local');
    const initHour = isEdit ? existing.hour : (parts.hour + 1) % 24;
    const initMin = isEdit ? existing.minute : 0;
    const d = new Dialog({ title: isEdit ? 'Edit Alarm' : 'Add Alarm', icon: 'alarm' });

    const hrInput = h('input.field.num', { type: 'number', min: '0', max: '23', value: String(initHour).padStart(2, '0') });
    const minInput = h('input.field.num', { type: 'number', min: '0', max: '59', value: String(initMin).padStart(2, '0') });
    const labelInput = h('input.field', { type: 'text', value: isEdit ? existing.label : 'Alarm', placeholder: 'Alarm label' });

    const selectedDays = new Set(isEdit && Array.isArray(existing.days) ? existing.days : []);
    const dayBtns = DAY_LABELS.map((dl) => {
      const btn = h(`button.alarm-day-chip${selectedDays.has(dl.dow) ? '.active' : ''}`, {
        title: dl.name,
        onclick: () => {
          if (selectedDays.has(dl.dow)) selectedDays.delete(dl.dow);
          else selectedDays.add(dl.dow);
          btn.classList.toggle('active', selectedDays.has(dl.dow));
        },
      }, dl.short);
      return btn;
    });

    d.body.append(
      h('div.timer-dialog-fields',
        h('label.timer-dialog-col', h('span.micro', 'HOUR (0-23)'), hrInput),
        h('label.timer-dialog-col', h('span.micro', 'MINUTE (0-59)'), minInput)
      ),
      labelInput,
      h('div.alarm-dialog-days',
        h('span.micro', 'REPEAT DAYS'),
        h('div.alarm-days', ...dayBtns)
      )
    );
    d.addButton('Cancel', { value: null });
    d.addButton(isEdit ? 'Save' : 'Add Alarm', { primary: true, onClick: () => {
      const hh = Math.max(0, Math.min(23, parseInt(hrInput.value, 10) || 0));
      const mm = Math.max(0, Math.min(59, parseInt(minInput.value, 10) || 0));
      d.close({
        hour: hh,
        minute: mm,
        label: labelInput.value.trim() || 'Alarm',
        days: Array.from(selectedDays),
      });
      return false;
    } });

    const res = await d.open();
    if (!res) return null;
    if (isEdit) return updateAlarm(existing.id, res);
    return addAlarm(res);
  }

  return {
    el: root,
    render,
    tick: checkAlarms,
    normalizeAlarm,
    addAlarm,
    updateAlarm,
    toggleAlarm,
    deleteAlarm,
    snoozeAlarm,
    dismissAlarm,
    openAlarmDialog,
  };
}
