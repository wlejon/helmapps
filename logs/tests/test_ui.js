/**
 * End-to-end UI tests for helm.logs:
 *  - Discovers Desktop & Apps and System log sources from fixture root
 *  - Renders parsed entries in VirtualList and opens Detail Drawer on selection
 *  - Filters by severity (Errors, Warnings, All)
 *  - Filters by substring query and regex query
 *  - Opens custom log file via openLogFile()
 *  - Live follows (tails) newly appended lines in active log file
 *  - Exports filtered entries to disk via exportFiltered()
 */

import { app, waitFor, settle, eq, clickEl, press, fixtureDir } from '/lib/test.js';

const fs = require('fs');
const path = require('path');

const dir = fixtureDir({
  'state/helm.files/helm.files.log': [
    '[2026-10-14 09:00:01.100] [INFO] [helm.files] Mounted /home/user',
    '[2026-10-14 09:00:02.250] [WARN] [helm.files] Slow thumbnail generation for video.mkv',
    '[2026-10-14 09:00:03.500] [ERROR] [helm.files] Permission denied reading /root/secret',
    '    at readDir (files.js:45:12)',
    '    at async scan (files.js:90:5)',
  ].join('\n') + '\n',
  'var/log/syslog': [
    'Oct 14 09:01:00 archbox systemd[1]: Started Network Manager.',
    'Oct 14 09:01:05 archbox kernel: [   14.220100] amdgpu 0000:03:00.0: [drm] *ERROR* ring gfx timeout',
    'Oct 14 09:01:10 archbox sshd[812]: Server listening on 0.0.0.0 port 22.',
  ].join('\n') + '\n',
  'var/log/app.jsonl': [
    '{"timestamp":"2026-10-14T09:02:00.000Z","level":"info","service":"indexer","message":"Index ready","docs":1250}',
    '{"timestamp":"2026-10-14T09:02:15.000Z","level":"error","service":"indexer","message":"Corrupt segment detected","segment":"seg_04"}',
  ].join('\n') + '\n',
  'custom/my-service.log': [
    '2026-10-14T09:05:00.000Z INFO [worker] Job 101 started',
    '2026-10-14T09:05:01.000Z WARN [worker] High memory pressure (89%)',
    '2026-10-14T09:05:02.000Z ERROR [worker] Job 101 failed with code 137',
  ].join('\n') + '\n',
});

// 1. Point log source discovery at fixture root
app.setRoot(dir);
waitFor(() => app.state.ready && app.state.entries.length === 8, 'fixture sources to discover and load all 8 entries');

const sections = Array.from(document.querySelectorAll('.sidebar-section')).map((e) => e.textContent);
assert(sections.includes('Desktop & Apps'), 'Sidebar has Desktop & Apps section');
assert(sections.includes('System'), 'Sidebar has System section');

// 2. Verify VirtualList rows and clicking an entry opens Detail Drawer
waitFor(() => document.querySelectorAll('.vlist-row').length > 0, 'VirtualList rows rendered');

// Select the JSONL error entry and verify Detail Drawer shows pretty-printed JSON
const jsonErrEntry = app.state.filtered.find((e) => e.message === 'Corrupt segment detected');
assert(jsonErrEntry, 'JSONL error entry present');
app.list.select([jsonErrEntry.id]);
settle(50);

assert(!app.drawer.classList.contains('hidden'), 'Detail drawer is visible when entry is selected');
const drawerText = app.drawer.textContent;
assert(drawerText.includes('Corrupt segment detected'), 'Drawer displays entry message');
assert(drawerText.includes('"segment": "seg_04"'), 'Drawer displays pretty-printed JSON fields');

// Select the stack trace error entry and verify stack trace in drawer
const stackErrEntry = app.state.filtered.find((e) => e.message.includes('Permission denied reading /root/secret'));
assert(stackErrEntry, 'Stack trace error entry present');
app.list.select([stackErrEntry.id]);
settle(50);
assert(app.drawer.textContent.includes('at readDir (files.js:45:12)'), 'Drawer displays multi-line stack trace');

// 3. Severity filtering
app.setSeverity('error');
waitFor(() => app.state.filtered.length === 3, 'Filtering by error shows 3 errors');

app.setSeverity('warn');
waitFor(() => app.state.filtered.length === 1, 'Filtering by warn shows 1 warning');

app.setSeverity('all');
waitFor(() => app.state.filtered.length === 8, 'Resetting severity filter to all shows 8 entries');

// 4. Substring search & Regex search
app.setQuery('amdgpu');
waitFor(() => app.state.filtered.length === 1, 'Substring search for amdgpu finds 1 kernel entry');

app.setUseRegex(true);
app.setQuery('sshd\\[\\d+\\]|systemd\\[1\\]');
waitFor(() => app.state.filtered.length === 2, 'Regex search matches sshd and systemd entries');

// Escape clears active search filter
press('escape');
waitFor(() => app.state.query === '' && app.state.filtered.length === 8, 'Escape clears search query');
app.setUseRegex(false);

// 5. Open a custom log file via openLogFile()
const customPath = path.join(dir, 'custom', 'my-service.log');
app.openLogFile(customPath);
waitFor(() => app.state.activeSourceId === path.resolve(customPath) && app.state.entries.length === 3, 'Custom log file opened and active');

const sectionsAfterOpen = Array.from(document.querySelectorAll('.sidebar-section')).map((e) => e.textContent);
assert(sectionsAfterOpen.includes('Opened Files'), 'Opened Files section appears in sidebar');

// 6. Live Follow (Tail) when new lines are appended
app.setTail(true);
assert(app.state.tail === true, 'Live tail mode enabled');
fs.appendFileSync(
  customPath,
  '2026-10-14T09:05:05.000Z ERROR [worker] Urgent tail alert triggered\n',
  'utf8',
);
waitFor(
  () => app.state.entries.length === 4 && app.state. entries[3].message.includes('Urgent tail alert triggered'),
  'Live tail picks up newly appended log line',
);
app.setTail(false);

// 7. Export filtered entries to a file
app.setSeverity('error');
waitFor(() => app.state.filtered.length === 2, 'Custom log has 2 errors when filtered');

const exportPath = path.join(dir, 'exported-errors.log');
app.exportFiltered(exportPath);
waitFor(() => fs.existsSync(exportPath), 'Exported file created on disk');

const exportedContent = fs.readFileSync(exportPath, 'utf8').trim().split(/\r?\n/);
eq(exportedContent.length, 2, 'Exported file has 2 error lines');
assert(exportedContent[1].includes('Urgent tail alert triggered'), 'Exported file contains tailed error line');

console.log('test_ui PASSED');
