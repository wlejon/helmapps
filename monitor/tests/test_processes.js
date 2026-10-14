// End-to-end tests for the Processes page (Acceptance Tests #4, #5, #6, #7, #8).

import {
  app,
  waitFor,
  eq,
  press,
  clickEl,
  rightClickEl,
  menuLabels,
  chooseMenu,
  currentDialog,
  dialogButton,
  fixtureDir,
  mod,
} from '/lib/test.js';

const fs = require('fs');
const path = require('path');

function runTick(nowMs = Date.now()) {
  let done = false;
  app.tick(nowMs).then(() => { done = true; });
  waitFor(() => done, 'sampler tick to finish');
}

function makePidStat({ pid, name, state = 'S', ppid = 1, utime = 100, stime = 50, threads = 2, starttime = 1000, rssPages = 1000 }) {
  return `${pid} (${name}) ${state} ${ppid} ${pid} ${pid} 0 -1 4194304 10 0 0 0 ${utime} ${stime} 0 0 20 0 ${threads} 0 ${starttime} 104857600 ${rssPages} 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0\n`;
}

// Stop automatic background timer during deterministic test steps
app.sampler.stop();

// ---- Acceptance Test #7: Platform without /proc (Windows) or non-proc root ---
const emptyRoot = fixtureDir({});
app.setRoot(emptyRoot);
runTick(1000);

eq(app.procSampler.supported, false, 'without /proc, procSampler.supported is false');
eq(app.processesView.unsupportedEl.classList.contains('hidden'), false, 'Processes shows empty state when /proc is absent');
assert(
  app.processesView.unsupportedEl.textContent.includes('needs bro support'),
  'empty state explains that platform process data needs bro support'
);

// File Systems page lists volumes where bro.vfs is available
if (typeof bro !== 'undefined' && bro.vfs && typeof bro.vfs.volumes === 'function') {
  waitFor(() => app.filesystemsView.loaded, 'File Systems volumes to load');
  assert(app.filesystemsView.volumes.length > 0, 'File Systems lists mounted volumes');
}

// ---- Build fake /proc with fixtureDir() -------------------------------------
const fakeRoot = fixtureDir({
  'etc/passwd': 'root:x:0:0:root:/root:/bin/bash\njonny:x:1000:1000:Jonny:/home/jonny:/bin/bash\n',
  'proc/stat': [
    'cpu  1000 0 500 8500 0 0 0 0 0 0',
    'cpu0 500 0 250 4250 0 0 0 0 0 0',
    'cpu1 500 0 250 4250 0 0 0 0 0 0',
  ].join('\n'),
  'proc/meminfo': [
    'MemTotal:       8000000 kB',
    'MemFree:        2000000 kB',
    'MemAvailable:   5000000 kB',
    'SwapTotal:      2000000 kB',
    'SwapFree:       1500000 kB',
  ].join('\n'),
  'proc/loadavg': '0.50 0.40 0.30 1/200 500\n',
  'proc/uptime': '1200.00 2000.00\n',
  'proc/101/stat': makePidStat({ pid: 101, name: 'alpha-srv', state: 'R', ppid: 1, utime: 100, stime: 50, threads: 4, rssPages: 2000 }),
  'proc/101/cmdline': '/usr/bin/alpha-srv\0--port=8080\0',
  'proc/101/status': 'Name:\talpha-srv\nUid:\t1000\t1000\t1000\t1000\nVmRSS:\t8000 kB\nThreads:\t4\n',
  'proc/202/stat': makePidStat({ pid: 202, name: 'beta-worker', state: 'S', ppid: 101, utime: 200, stime: 100, threads: 8, rssPages: 8000 }),
  'proc/202/cmdline': '/usr/bin/beta-worker\0--jobs=4\0',
  'proc/202/status': 'Name:\tbeta-worker\nUid:\t0\t0\t0\t0\nVmRSS:\t32000 kB\nThreads:\t8\n',
});

app.setPage('processes');
app.setRoot(fakeRoot);
runTick(2000);

eq(app.procSampler.supported, true, 'fake /proc is supported');
eq(app.list.items.length, 2, 'two processes listed on first tick');

// Advance /proc/stat by +1000 total jiffies; PID 101 uses +250 ticks (25%), PID 202 uses +50 ticks (5%)
fs.writeFileSync(path.join(fakeRoot, 'proc/stat'), [
  'cpu  1300 0 600 9100 0 0 0 0 0 0',
  'cpu0 700 0 300 4500 0 0 0 0 0 0',
  'cpu1 600 0 300 4600 0 0 0 0 0 0',
].join('\n'));
fs.writeFileSync(path.join(fakeRoot, 'proc/101/stat'),
  makePidStat({ pid: 101, name: 'alpha-srv', state: 'R', ppid: 1, utime: 300, stime: 100, threads: 4, rssPages: 2000 }));
fs.writeFileSync(path.join(fakeRoot, 'proc/202/stat'),
  makePidStat({ pid: 202, name: 'beta-worker', state: 'S', ppid: 101, utime: 230, stime: 120, threads: 8, rssPages: 8000 }));

runTick(3000);

// Default sort is CPU descending -> alpha-srv (25%) first, beta-worker (5%) second
eq(app.list.items.map((p) => p.pid), [101, 202], 'sorted by CPU descending by default');
eq(app.list.items[0].cpu, 25, 'PID 101 CPU % is 25%');
eq(app.list.items[1].cpu, 5, 'PID 202 CPU % is 5%');
eq(app.list.items[0].user, 'jonny', 'PID 101 UID 1000 mapped to username jonny');
eq(app.list.items[1].user, 'root', 'PID 202 UID 0 mapped to root');

// ---- Acceptance Test #4: PID disappears, new PID appears, selection kept -----
waitFor(() => document.querySelectorAll('.vlist-row').length === 2, 'two DOM rows rendered');
const row101 = Array.from(document.querySelectorAll('.vlist-row')).find((r) => r.textContent.includes('alpha-srv'));
clickEl(row101);
eq(app.list.selectedItems().map((p) => p.pid), [101], 'PID 101 is selected');

// Remove PID 202 and add PID 303
fs.rmSync(path.join(fakeRoot, 'proc/202'), { recursive: true, force: true });
fs.mkdirSync(path.join(fakeRoot, 'proc/303'), { recursive: true });
fs.writeFileSync(path.join(fakeRoot, 'proc/303/stat'),
  makePidStat({ pid: 303, name: 'gamma-daemon', state: 'S', ppid: 101, utime: 50, stime: 50, threads: 1, rssPages: 16000 }));
fs.writeFileSync(path.join(fakeRoot, 'proc/303/cmdline'), '/usr/sbin/gamma-daemon\0--foreground\0');
fs.writeFileSync(path.join(fakeRoot, 'proc/303/status'), 'Name:\tgamma-daemon\nUid:\t1000\t1000\t1000\t1000\n');
fs.writeFileSync(path.join(fakeRoot, 'proc/stat'), [
  'cpu  1500 0 700 9800 0 0 0 0 0 0',
  'cpu0 800 0 350 4850 0 0 0 0 0 0',
  'cpu1 700 0 350 4950 0 0 0 0 0 0',
].join('\n'));
fs.writeFileSync(path.join(fakeRoot, 'proc/101/stat'),
  makePidStat({ pid: 101, name: 'alpha-srv', state: 'R', ppid: 1, utime: 450, stime: 150, threads: 4, rssPages: 2000 }));

runTick(4000);

eq(app.list.items.map((p) => p.pid), [101, 303], 'PID 202 left the list and PID 303 appeared');
eq(app.list.selectedItems().map((p) => p.pid), [101], 'selection on PID 101 is preserved across ticks');

// ---- Acceptance Test #5: Sort by Memory when header clicked, sort persists ---
const findMemHeader = () => Array.from(document.querySelectorAll('.list-header .col')).find((c) => c.textContent.startsWith('Memory'));
clickEl(findMemHeader());
const firstSortDir = app.settings.get('sort');
eq(firstSortDir.id, 'memory', 'sort setting id persisted as memory');
if (firstSortDir.dir === 1) {
  eq(app.list.items.map((p) => p.pid), [101, 303], 'sorted by Memory ascending');
  clickEl(findMemHeader());
}
eq(app.list.items.map((p) => p.pid), [303, 101], 'sorted by Memory descending (gamma-daemon 64 MB first)');
eq(app.settings.get('sort'), { id: 'memory', dir: -1 }, 'Memory sort order persisted in settings');

// ---- Acceptance Test #6: Filter narrows to matching names, cmdlines, PIDs ----
app.setFilter('gamma');
eq(app.list.items.map((p) => p.pid), [303], 'filter matches process name');

app.setFilter('8080');
eq(app.list.items.map((p) => p.pid), [101], 'filter matches command line argument');

app.setFilter('303');
eq(app.list.items.map((p) => p.pid), [303], 'filter matches PID');

app.setFilter('');
eq(app.list.items.length, 2, 'clearing filter restores all processes');

// ---- Tree mode (by parent PID) -----------------------------------------------
// Currently sorted by Memory descending ([303, 101]), where 303 is a child of 101 (ppid=101).
// Turning on Tree Mode puts parent 101 at depth 0 followed by child 303 at depth 1.
press(`${mod}+t`);
eq(app.settings.get('treeMode'), true, 'Mod+T toggles treeMode on');
eq(app.list.items.map((p) => [p.pid, p.depth]), [[101, 0], [303, 1]], 'tree mode places child under parent with depth 1');
press(`${mod}+t`);
eq(app.settings.get('treeMode'), false, 'Mod+T toggles treeMode off');

// ---- Context menu & Process Properties dialog --------------------------------
app.setSysApi(null);
const row = Array.from(document.querySelectorAll('.vlist-row')).find((r) => r.textContent.includes('alpha-srv'));
rightClickEl(row);
const labelsNoSys = menuLabels();
assert(labelsNoSys.includes('Properties'), 'context menu includes Properties');
assert(labelsNoSys.includes('Copy Command Line'), 'context menu includes Copy Command Line');
assert(labelsNoSys.some((l) => l.includes('End Process') && l.includes('needs bro support')), 'End Process shows needs bro support when bro.sys is absent');
assert(labelsNoSys.some((l) => l.includes('Kill Process') && l.includes('needs bro support')), 'Kill Process shows needs bro support when bro.sys is absent');

chooseMenu('Properties');
waitFor(() => currentDialog(), 'Process Properties dialog to open');
assert(currentDialog().el.textContent.includes('--port=8080'), 'Properties dialog shows command line');
dialogButton('Close');
waitFor(() => !currentDialog(), 'Process Properties dialog to close');

// ---- End Process (SIGTERM/15) & Kill Process (SIGKILL/9) ---------------------
const killedSignals = [];
let mockProcList = [
  {
    pid: 501,
    ppid: 1,
    name: 'win-render.exe',
    cmdline: 'C:\\App\\win-render.exe --gpu',
    state: 'R',
    user: 'jonny',
    uid: 1000,
    rssBytes: 64 * 1024 * 1024,
    vszBytes: 128 * 1024 * 1024,
    userTimeMs: 200,
    kernelTimeMs: 100,
    threads: 6,
  },
  {
    pid: 502,
    ppid: 501,
    name: 'win-helper.exe',
    cmdline: 'C:\\App\\win-helper.exe',
    state: 'S',
    user: 'jonny',
    uid: 1000,
    rssBytes: 16 * 1024 * 1024,
    vszBytes: 32 * 1024 * 1024,
    cpuTimeMs: 50,
    threads: 2,
  },
];

const mockSys = {
  processes: {
    list: () => mockProcList,
    kill: (pid, sig) => {
      killedSignals.push({ pid, sig });
      return true;
    },
  },
};

app.setSysApi(mockSys);
// Select PID 101 in the current /proc view and test End Process (Delete -> SIGTERM=15)
const rowForSignal = Array.from(document.querySelectorAll('.vlist-row')).find((r) => r.textContent.includes('alpha-srv'));
clickEl(rowForSignal);
eq(app.list.selectedItems().map((p) => p.pid), [101], 'PID 101 selected for signal test');

press('Delete');
waitFor(() => killedSignals.length === 1, 'Delete key triggers End Process (SIGTERM)');
eq(killedSignals[0], { pid: 101, sig: 15 }, 'End Process sends signal 15 (SIGTERM)');

// Test Kill Process (Shift+Delete -> confirmation dialog -> SIGKILL=9)
press('Shift+Delete');
waitFor(() => currentDialog(), 'Kill Process confirmation dialog opens on Shift+Delete');
assert(currentDialog().el.textContent.includes('alpha-srv'), 'confirmation dialog names the target process');
dialogButton('Kill Process');
waitFor(() => !currentDialog() && killedSignals.length === 2, 'confirming Kill Process sends signal');
eq(killedSignals[1], { pid: 101, sig: 9 }, 'Kill Process sends signal 9 (SIGKILL)');

// ---- bro.sys.processes fallback when /proc is absent -------------------------
app.processesView.setSort({ id: 'cpu', dir: -1 });
app.setRoot(emptyRoot);
app.setSysApi(mockSys);
runTick(10000);

eq(app.procSampler.supported, true, 'bro.sys.processes fallback marks procSampler.supported = true');
eq(app.list.items.length, 2, 'two processes loaded from bro.sys.processes fallback');

// Advance 1000 ms wall-clock: PID 501 uses +300 ms (200+100 -> 400+200 = 30% CPU), PID 502 uses +50 ms (50 -> 100 = 5% CPU)
mockProcList = [
  {
    ...mockProcList[0],
    userTimeMs: 400,
    kernelTimeMs: 200,
  },
  {
    ...mockProcList[1],
    cpuTimeMs: 100,
  },
];
runTick(11000);

eq(app.list.items.map((p) => p.pid), [501, 502], 'bro.sys.processes sorted by CPU descending');
eq(app.list.items[0].cpu, 30, 'PID 501 CPU % computed from userTimeMs+kernelTimeMs delta (30%)');
eq(app.list.items[1].cpu, 5, 'PID 502 CPU % computed from cpuTimeMs delta (5%)');

// ---- Acceptance Test #8: Real system sampler sees live processes -------------
app.setSysApi(undefined);
app.setRoot('/');
runTick(12000);
if (process.platform === 'linux' || (typeof bro !== 'undefined' && bro.sys && typeof bro.sys.processes?.list === 'function')) {
  eq(app.procSampler.supported, true, 'real system sampler is supported');
  assert(app.procSampler.processes.length > 0, 'real system sampler sees running processes');
  if (typeof process.pid === 'number' && process.pid > 0) {
    assert(
      app.procSampler.processes.some((p) => p.pid === process.pid),
      `real sampler sees own process (PID ${process.pid})`
    );
  }
}

console.log('test_processes PASSED');
