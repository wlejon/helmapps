/**
 * World Clock page: large local time readout at the top, followed by cards
 * for each added city with live time, day/night indicator (sun/moon), relative
 * day badge (Today/Tomorrow/Yesterday), and offset badge (+9 h / -5 h / Same time).
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { emptyState } from '/lib/layout.js';
import { Dialog } from '/lib/dialog.js';
import { toast } from '/lib/toast.js';
import { now } from './time.js';
import {
  CITIES,
  findCity,
  searchCities,
  formatInZone,
  formatDateInZone,
  getRelativeDayAndOffset,
} from './cities.js';

export function createWorldView({ state, settings, commands }) {
  const localTimeEl = h('div.world-local-time.num');
  const localDateEl = h('div.world-local-date.dim');
  const localHero = h('div.world-hero.card',
    h('div.world-hero-meta',
      h('div.micro', 'LOCAL TIME'),
      localDateEl
    ),
    localTimeEl
  );

  const gridEl = h('div.world-grid');
  const emptyEl = emptyState({
    icon: 'globe',
    title: 'No world clocks added',
    hint: 'Add cities around the world to compare their time and day offset.',
    action: { label: 'Add City…', run: () => commands.run('world-add-city') },
  });

  const root = h('div.clock-page.scroll',
    h('div.page.clock-page-inner',
      localHero,
      h('div.section-bar',
        h('span.micro', 'WORLD CITIES'),
        h('button.btn.small', { onclick: () => commands.run('world-add-city') }, icon('plus'), 'Add City…')
      ),
      gridEl,
      emptyEl
    )
  );

  /** Map from city entry id -> DOM references so ticks only update text when changed. */
  const cardRefs = new Map();
  let renderedIdsKey = '';

  function normalizeCityEntry(item) {
    if (typeof item === 'string') {
      const found = findCity(item);
      if (found) return { ...found };
      return { id: item, city: item.split('/').pop().replace(/_/g, ' '), country: item, zone: item };
    }
    if (item && typeof item === 'object') {
      const found = findCity(item.id || item.zone);
      return {
        id: item.id || (found ? found.id : item.zone || `city-${Math.random().toString(36).slice(2, 7)}`),
        city: item.city || (found ? found.city : 'City'),
        country: item.country || (found ? found.country : ''),
        zone: item.zone || (found ? found.zone : 'UTC'),
      };
    }
    return null;
  }

  function persist() {
    settings.set('cities', state.cities);
  }

  function rebuildCardsIfNeeded() {
    const key = state.cities.map((c) => c.id).join('|');
    if (key === renderedIdsKey) return;
    renderedIdsKey = key;
    cardRefs.clear();

    const hasCities = state.cities.length > 0;
    gridEl.classList.toggle('hidden', !hasCities);
    emptyEl.classList.toggle('hidden', hasCities);
    if (!hasCities) {
      gridEl.replaceChildren();
      return;
    }

    const cards = state.cities.map((c, idx) => {
      const timeEl = h('div.world-city-time.num');
      const dayBadge = h('span.badge.world-day-badge');
      const offsetBadge = h('span.badge.world-offset-badge.num');
      const dnWrap = h('span.world-dn-icon');
      const upBtn = h('button.icon-btn.small.world-move-up', {
        'aria-label': `Move ${c.city} up`,
        'data-tip': 'Move Up',
        disabled: idx === 0,
        onclick: () => commands.run('world-move-city', { id: c.id, delta: -1 }),
      }, icon('arrow-up', 'sm'));
      const downBtn = h('button.icon-btn.small.world-move-down', {
        'aria-label': `Move ${c.city} down`,
        'data-tip': 'Move Down',
        disabled: idx === state.cities.length - 1,
        onclick: () => commands.run('world-move-city', { id: c.id, delta: 1 }),
      }, icon('arrow-down', 'sm'));
      const removeBtn = h('button.icon-btn.small.world-remove-city', {
        'aria-label': `Remove ${c.city}`,
        'data-tip': 'Remove City',
        onclick: () => commands.run('world-remove-city', { id: c.id }),
      }, icon('trash', 'sm'));

      const card = h('div.world-card.card', { dataset: { cityId: c.id, zone: c.zone } },
        h('div.world-card-top',
          h('div.world-card-place',
            h('div.world-city-name.title.ellipsis', c.city),
            h('div.world-city-country.dim.ellipsis', c.country || c.zone)
          ),
          h('div.world-card-actions', upBtn, downBtn, removeBtn)
        ),
        h('div.world-card-bottom',
          h('div.world-card-badges', dnWrap, dayBadge, offsetBadge),
          timeEl
        )
      );

      cardRefs.set(c.id, {
        card,
        timeEl,
        dayBadge,
        offsetBadge,
        dnWrap,
        lastTime: '',
        lastDay: '',
        lastOffset: '',
        lastIsDay: null,
      });
      return card;
    });

    gridEl.replaceChildren(...cards);
  }

  let lastLocalTime = '';
  let lastLocalDate = '';

  function updateValues() {
    const t = now();
    const refZone = state.referenceZone || 'local';
    const localTime = formatInZone(t, refZone, { seconds: true });
    const localDate = formatDateInZone(t, refZone);
    if (localTime !== lastLocalTime) {
      lastLocalTime = localTime;
      localTimeEl.textContent = localTime;
    }
    if (localDate !== lastLocalDate) {
      lastLocalDate = localDate;
      localDateEl.textContent = localDate;
    }

    for (const c of state.cities) {
      const ref = cardRefs.get(c.id);
      if (!ref) continue;
      const cityTime = formatInZone(t, c.zone, { seconds: false });
      const info = getRelativeDayAndOffset(t, c.zone, refZone);
      if (cityTime !== ref.lastTime) {
        ref.lastTime = cityTime;
        ref.timeEl.textContent = cityTime;
      }
      if (info.dayLabel !== ref.lastDay) {
        ref.lastDay = info.dayLabel;
        ref.dayBadge.textContent = info.dayLabel;
        ref.dayBadge.classList.toggle('accent', info.dayLabel !== 'Today');
      }
      if (info.offsetLabel !== ref.lastOffset) {
        ref.lastOffset = info.offsetLabel;
        ref.offsetBadge.textContent = info.offsetLabel;
      }
      if (info.isDay !== ref.lastIsDay) {
        ref.lastIsDay = info.isDay;
        ref.dnWrap.dataset.period = info.isDay ? 'day' : 'night';
        ref.dnWrap.title = info.isDay ? 'Daytime' : 'Nighttime';
        ref.dnWrap.replaceChildren(icon(info.isDay ? 'sun' : 'moon', 'sm'));
      }
    }
  }

  function render() {
    rebuildCardsIfNeeded();
    updateValues();
  }

  function addCity(cityOrIdOrZone) {
    const entry = normalizeCityEntry(cityOrIdOrZone);
    if (!entry) return null;
    const existing = state.cities.find((c) => c.id === entry.id || (c.zone === entry.zone && c.city === entry.city));
    if (existing) return existing;
    state.cities.push(entry);
    persist();
    render();
    return entry;
  }

  function removeCity(idOrZone) {
    const id = typeof idOrZone === 'object' && idOrZone ? idOrZone.id : idOrZone;
    const before = state.cities.length;
    state.cities = state.cities.filter((c) => c.id !== id && c.zone !== id && c.city !== id);
    if (state.cities.length !== before) {
      persist();
      render();
      return true;
    }
    return false;
  }

  function moveCity(idOrObj, deltaArg) {
    let id = idOrObj;
    let delta = deltaArg;
    if (typeof idOrObj === 'object' && idOrObj) {
      id = idOrObj.id;
      delta = idOrObj.delta;
    }
    const idx = state.cities.findIndex((c) => c.id === id || c.zone === id || c.city === id);
    if (idx < 0) return false;
    const target = idx + (Number(delta) || 0);
    if (target < 0 || target >= state.cities.length) return false;
    const [item] = state.cities.splice(idx, 1);
    state.cities.splice(target, 0, item);
    persist();
    render();
    return true;
  }

  async function openAddCityDialog() {
    const d = new Dialog({ title: 'Add World City', icon: 'globe', wide: true });
    const searchInput = h('input', { type: 'text', placeholder: 'Search city, country, or timezone…' });
    const searchWrap = h('div.search-field', icon('search'), searchInput);
    const listWrap = h('div.city-picker-list');
    let chosen = null;

    function drawMatches(query) {
      const addedIds = new Set(state.cities.map((c) => c.id));
      const matches = searchCities(query).slice(0, 60);
      const t = now();
      if (!matches.length) {
        listWrap.replaceChildren(h('div.dim.city-picker-empty', 'No matching cities'));
        return;
      }
      if (!chosen || !matches.some((m) => m.id === chosen.id)) {
        chosen = matches.find((m) => !addedIds.has(m.id)) || matches[0];
      }
      listWrap.replaceChildren(...matches.map((c) => {
        const already = addedIds.has(c.id);
        const row = h('button.list-row.city-picker-row', {
          dataset: { cityId: c.id },
          onclick: () => {
            chosen = c;
            for (const r of listWrap.querySelectorAll('.city-picker-row')) {
              r.classList.toggle('selected', r.dataset.cityId === c.id);
            }
          },
          ondblclick: () => {
            chosen = c;
            d.close(c);
          },
        },
          h('span.grow.ellipsis', `${c.city}, ${c.country}`),
          h('span.meta.ellipsis', c.zone),
          h('span.num.city-picker-time', formatInZone(t, c.zone)),
          already ? h('span.badge', 'Added') : null
        );
        if (chosen && chosen.id === c.id) row.classList.add('selected');
        return row;
      }));
    }

    searchInput.addEventListener('input', () => drawMatches(searchInput.value));
    d.body.append(searchWrap, listWrap);
    d.addButton('Cancel', { value: null });
    d.addButton('Add', { primary: true, onClick: () => {
      if (!chosen) return false;
      d.close(chosen);
      return false;
    } });
    drawMatches('');
    const picked = await d.open();
    if (picked) {
      addCity(picked);
      toast(`Added ${picked.city}`, { icon: 'globe' });
    }
    return picked;
  }

  return {
    el: root,
    render,
    tick: updateValues,
    addCity,
    removeCity,
    moveCity,
    openAddCityDialog,
    normalizeCityEntry,
    catalog: CITIES,
  };
}
