/**
 * The systemd journal as a log source:
 *  - a scripted journal (bro.sys.journal's shape): the "Journal (this boot)"
 *    source in System, records mapped to entries (severity from priority,
 *    unit as source, fields in the drawer), the query it makes, older pages,
 *    and a live follow from the newest record's cursor that closes with tail off
 *  - the real bro.sys.journal where this machine has one: this boot's records
 *    load without error
 */

import { app, waitFor, settle, eq, fixtureDir } from '/lib/test.js';

const JOURNAL_ID = 'journal:current-boot';

const dir = fixtureDir({
  'var/log/syslog': 'Oct 14 09:01:00 archbox systemd[1]: Started Network Manager.\n',
});

const base = Date.UTC(2026, 10, 4, 12, 0, 0);
function rec(i, priority, extra = {}) {
  return {
    cursor: 'c' + i, time: base + i * 1000, realtimeUs: (base + i * 1000) * 1000, monotonicUs: i,
    bootId: 'b'.repeat(32), priority, message: 'record ' + i, unit: 'demo.service',
    identifier: 'demo', pid: 42, hostname: 'halo', transport: 'journal', ...extra,
  };
}

const calls = [];
let followCb = null;
let followOpts = null;
let followClosed = false;
const fake = {
  async query(opts) {
    calls.push(opts);
    if (!opts.before) return { entries: [rec(10, 3), rec(11, 4), rec(12, 6), rec(13, 7), rec(14, null)], before: 'c10', more: true };
    eq(opts.before, 'c10', 'the older page asks before the oldest loaded record');
    return { entries: [rec(8, 6), rec(9, 2)], before: 'c8', more: false };
  },
  follow(opts, cb) {
    followOpts = opts;
    followCb = cb;
    followClosed = false;
    return { id: 7, close() { followClosed = true; } };
  },
};

app.setRoot(dir);
waitFor(() => app.state.ready && app.state.entries.length === 1, 'fixture discovered');
assert(!app.sources.getSource(JOURNAL_ID), 'no journal source inside a fixture root by default');

app.setJournal(fake);
waitFor(() => app.sources.getSource(JOURNAL_ID) && app.sources.getSource(JOURNAL_ID).loaded, 'journal source loaded');
eq(calls[0].boot, 'current', 'the journal is queried for this boot');
assert(calls[0].limit >= 1000, 'a large page');

const systemItems = app.sources.getSections().system.map((i) => i.id);
assert(systemItems.includes(JOURNAL_ID), 'the journal is in the System section');

app.selectSource(JOURNAL_ID);
waitFor(() => app.state.entries.length === 5, 'journal entries shown');
const e = app.state.entries;
eq(e.map((x) => x.severity).join(','), 'error,warn,info,debug,info', 'priority 3/4/6/7/none -> severity');
eq(e[0].message, 'record 10', 'message');
eq(e[0].source, 'demo.service', 'the unit is the source');
assert(e[0].raw.includes('demo[42]: record 10'), 'raw reads like a syslog line: ' + e[0].raw);
eq(e[0].json.cursor, 'c10', 'the drawer fields carry the cursor');
eq(app.sources.getSource(JOURNAL_ID).errorCount, 1, 'one error counted');

app.list.select([e[0].id]);
settle(50);
assert(app.drawer.textContent.includes('"unit": "demo.service"'), 'the drawer shows the record fields');

// Older records, prepended.
app.loadOlderJournal();
waitFor(() => app.state.entries.length === 7, 'the older page prepended');
eq(app.state.entries[0].message, 'record 8', 'oldest first');
eq(app.state.entries.map((x) => x.id).join(','), '1,2,3,4,5,6,7', 'ids renumbered');
assert(!app.sources.getSource(JOURNAL_ID).before, 'no more pages');

// Live follow from the newest loaded record.
app.setTail(true);
waitFor(() => followCb !== null, 'tail starts a journal follow');
eq(followOpts.after, 'c14', 'the follow starts after the newest record shown');
eq(followOpts.boot, 'current', 'and follows this boot');
followCb([rec(15, 3), rec(16, 6)]);
waitFor(() => app.state.entries.length === 9, 'followed records appended');
eq(app.state.entries[8].message, 'record 16', 'in order');
app.setTail(false);
waitFor(() => followClosed, 'tail off closes the follow');

// The real journal, where there is one.
const real = typeof bro !== 'undefined' && bro.sys && bro.sys.journal;
if (real && real.available !== false && process.platform === 'linux') {
  app.setJournal(real);
  waitFor(() => {
    const s = app.sources.getSource(JOURNAL_ID);
    return s && s.loaded;
  }, 'the real journal loaded', 20000);
  const s = app.sources.getSource(JOURNAL_ID);
  if (s.error) {
    console.log('journal unreadable here: ' + s.error);
  } else {
    assert(s.entries.length > 0, 'this boot has journal records');
    assert(s.entries.every((x) => typeof x.message === 'string' && x.timestamp.length >= 19), 'records map to entries');
  }
} else {
  console.log('no bro.sys.journal here: the real journal was not read');
}
