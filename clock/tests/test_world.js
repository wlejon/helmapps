// World Clock acceptance test:
// - Fixed instant formatting in Asia/Tokyo (21:00) and America/New_York (07:00)
// - Relative day offset (Tomorrow when Tokyo crosses midnight) and hour difference (+9 h, -5 h)
// - Adding, reordering, and removing a city through UI and exposed API

import { app, waitFor, eq, clickEl, currentDialog, dialogButton, type } from '/lib/test.js';

app.showPage('world');

// 1. Fixed instant: 2024-01-15 12:00:00 UTC
//    Asia/Tokyo (UTC+9) -> 21:00 (Today, +9 h)
//    America/New_York (UTC-5 in Jan) -> 07:00 (Today, -5 h)
const fixedNoonUtc = Date.UTC(2024, 0, 15, 12, 0, 0);
app.setNow(fixedNoonUtc);

eq(app.formatInZone(fixedNoonUtc, 'Asia/Tokyo', { use24h: true }), '21:00', 'Tokyo at 12:00 UTC is 21:00');
eq(app.formatInZone(fixedNoonUtc, 'America/New_York', { use24h: true }), '07:00', 'New York at 12:00 UTC is 07:00');

// Reset cities to a known pair: Tokyo and New York
while (app.state.cities.length) {
  app.removeCity(app.state.cities[0].id);
}
app.addCity('tokyo');
app.addCity('new-york');

waitFor(() => document.querySelectorAll('.world-card').length === 2, 'two world city cards on screen');

const cardFor = (id) => document.querySelector(`.world-card[data-city-id="${id}"]`);
eq(cardFor('tokyo').querySelector('.world-city-time').textContent, '21:00', 'Tokyo card displays 21:00');
eq(cardFor('tokyo').querySelector('.world-offset-badge').textContent, '+9 h', 'Tokyo offset is +9 h');
eq(cardFor('tokyo').querySelector('.world-day-badge').textContent, 'Today', 'Tokyo day is Today at 12:00 UTC');
eq(cardFor('tokyo').querySelector('.world-dn-icon').dataset.period, 'night', 'Tokyo at 21:00 is night (moon)');

eq(cardFor('new-york').querySelector('.world-city-time').textContent, '07:00', 'New York card displays 07:00');
eq(cardFor('new-york').querySelector('.world-offset-badge').textContent, '-5 h', 'New York offset is -5 h');
eq(cardFor('new-york').querySelector('.world-dn-icon').dataset.period, 'day', 'New York at 07:00 is day (sun)');

// 2. Relative day offset when Tokyo crosses midnight: 2024-01-15 18:00:00 UTC
//    Asia/Tokyo -> 2024-01-16 03:00 (Tomorrow)
//    America/New_York -> 2024-01-15 13:00 (Today)
const fixedEveningUtc = Date.UTC(2024, 0, 15, 18, 0, 0);
app.setNow(fixedEveningUtc);

eq(cardFor('tokyo').querySelector('.world-city-time').textContent, '03:00', 'Tokyo at 18:00 UTC is 03:00');
eq(cardFor('tokyo').querySelector('.world-day-badge').textContent, 'Tomorrow', 'Tokyo is Tomorrow at 18:00 UTC');
eq(cardFor('new-york').querySelector('.world-city-time').textContent, '13:00', 'New York at 18:00 UTC is 13:00');
eq(cardFor('new-york').querySelector('.world-day-badge').textContent, 'Today', 'New York is Today at 18:00 UTC');

// 3. Add a city through the Add City dialog
app.commands.run('world-add-city');
waitFor(() => currentDialog(), 'Add World City dialog opens');
const searchInput = currentDialog().body.querySelector('input');
searchInput.focus();
type('Sydney');
waitFor(() => currentDialog().body.querySelector('.city-picker-row[data-city-id="sydney"]'), 'Sydney appears in search');
clickEl(currentDialog().body.querySelector('.city-picker-row[data-city-id="sydney"]'));
dialogButton('Add');
waitFor(() => !currentDialog(), 'Add World City dialog closes');

eq(app.state.cities.map((c) => c.id), ['tokyo', 'new-york', 'sydney'], 'Sydney added to city list');
waitFor(() => cardFor('sydney') !== null, 'Sydney card rendered');

// 4. Reorder cities (move Sydney up) and remove a city
clickEl(cardFor('sydney').querySelector('.world-move-up'));
eq(app.state.cities.map((c) => c.id), ['tokyo', 'sydney', 'new-york'], 'Sydney moved up before New York');

clickEl(cardFor('new-york').querySelector('.world-remove-city'));
eq(app.state.cities.map((c) => c.id), ['tokyo', 'sydney'], 'New York removed');
eq(cardFor('new-york'), null, 'New York card removed from DOM');

console.log('test_world PASSED');
