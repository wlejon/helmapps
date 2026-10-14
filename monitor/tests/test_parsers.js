// Unit tests for /proc parsers and CPU/Memory formulas (Acceptance Tests #1, #2, #3).

import { app, eq } from '/lib/test.js';

const {
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
} = app.parsers;

// ---- 1. CPU % from two /proc/stat snapshots (Acceptance Test #1) -------------

const statSnap1 = [
  'cpu  1000 100 300 8400 200 0 0 0 0 0',
  'cpu0 600 50 150 4100 100 0 0 0 0 0',
  'cpu1 400 50 150 4300 100 0 0 0 0 0',
  'intr 12345',
].join('\n');

// Total delta:
// snap1: active = 1000+100+300 = 1400, idle = 8400+200 = 8600, total = 10000
// snap2: active = 1250+100+400 = 1750 (+350), idle = 9000+250 = 9250 (+650), total = 11000 (+1000)
// Expected total CPU % = 350 / 1000 * 100 = 35%
// Core 0 delta: active 800 -> 1050 (+250), idle 4200 -> 4450 (+250), total +500 => 50%
// Core 1 delta: active 600 -> 700 (+100), idle 4400 -> 4800 (+400), total +500 => 20%
const statSnap2 = [
  'cpu  1250 100 400 9000 250 0 0 0 0 0',
  'cpu0 800 50 200 4350 100 0 0 0 0 0',
  'cpu1 450 50 200 4650 150 0 0 0 0 0',
  'intr 12900',
].join('\n');

const s1 = parseProcStat(statSnap1);
const s2 = parseProcStat(statSnap2);

eq(s1.total.active, 1400, 'snap1 total active jiffies');
eq(s1.total.idle, 8600, 'snap1 total idle jiffies (idle + iowait)');
eq(s1.total.total, 10000, 'snap1 total jiffies');
eq(s1.cores.length, 2, 'two per-core entries parsed');

const cpuDelta = computeCpuDelta(s1, s2);
eq(Math.round(cpuDelta.totalPct * 10) / 10, 35, 'expected total CPU percentage (35%)');
eq(cpuDelta.corePcts.map((v) => Math.round(v * 10) / 10), [50, 20], 'expected per-core CPU percentages (50%, 20%)');
eq(cpuDelta.totalJiffiesDelta, 1000, 'expected total jiffies delta (1000)');

// ---- 2. Process CPU % from two snapshots of a fake PID (Acceptance Test #2) --
// Also verifies comm names containing spaces and nested parentheses.

const pidStat1 = '4242 (Web Content (1)) R 1000 4242 4242 0 -1 4194304 120 0 2 0 500 200 0 0 20 0 8 0 98765 209715200 10240 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 1 0 0 0 0 0';
const pidStat2 = '4242 (Web Content (1)) S 1000 4242 4242 0 -1 4194304 150 0 2 0 620 230 0 0 20 0 8 0 98765 209715200 12000 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 1 0 0 0 0 0';

const p1 = parsePidStat(pidStat1);
const p2 = parsePidStat(pidStat2);

eq(p1.pid, 4242, 'parsed PID');
eq(p1.name, 'Web Content (1)', 'parsed comm with spaces and parentheses');
eq(p1.state, 'R', 'parsed state R');
eq(p1.ppid, 1000, 'parsed parent PID');
eq(p1.utime, 500, 'parsed utime');
eq(p1.stime, 200, 'parsed stime');
eq(p1.ticks, 700, 'parsed total ticks (utime + stime)');
eq(p1.threads, 8, 'parsed num_threads');
eq(p1.rssBytes, 10240 * 4096, 'parsed RSS bytes from pages');

// Process ticks delta = (620 + 230) - (500 + 200) = 850 - 700 = 150
// Against totalJiffiesDelta = 1000 -> 15.0%
const procCpuPct = computeProcCpuPct(p1, p2, cpuDelta.totalJiffiesDelta);
eq(Math.round(procCpuPct * 10) / 10, 15, 'process CPU % matches utime+stime delta against total jiffies');

// Verify status & cmdline parsers
const statusParsed = parsePidStatus([
  'Name:\tWeb Content',
  'State:\tS (sleeping)',
  'Uid:\t1000\t1000\t1000\t1000',
  'VmSize:\t  204800 kB',
  'VmRSS:\t   48000 kB',
  'VmSwap:\t    1024 kB',
  'Threads:\t8',
].join('\n'));
eq(statusParsed.uid, 1000, 'parsed Uid');
eq(statusParsed.vmRssBytes, 48000 * 1024, 'parsed VmRSS bytes');
eq(statusParsed.vmSwapBytes, 1024 * 1024, 'parsed VmSwap bytes');
eq(statusParsed.threads, 8, 'parsed Threads');

eq(parsePidCmdline('/usr/lib/firefox/firefox\x00-contentproc\x00-childID\x001\x00'),
  '/usr/lib/firefox/firefox -contentproc -childID 1',
  'parsed null-separated cmdline');

// ---- 3. Memory used and percentage from fake meminfo (Acceptance Test #3) ----

const memText = [
  'MemTotal:       16000000 kB',
  'MemFree:         2000000 kB',
  'MemAvailable:    6000000 kB',
  'Buffers:          500000 kB',
  'Cached:          3500000 kB',
  'SwapTotal:       4000000 kB',
  'SwapFree:        3000000 kB',
].join('\n');

const mem = parseMeminfo(memText);
eq(mem.totalBytes, 16000000 * 1024, 'MemTotal in bytes');
eq(mem.availableBytes, 6000000 * 1024, 'MemAvailable in bytes');
eq(mem.usedBytes, 10000000 * 1024, 'Memory used = MemTotal - MemAvailable');
eq(Math.round(mem.usedPct * 100) / 100, 62.5, 'Memory used percentage = 62.5%');
eq(mem.swapTotalBytes, 4000000 * 1024, 'SwapTotal in bytes');
eq(mem.swapUsedBytes, 1000000 * 1024, 'SwapUsed in bytes');
eq(Math.round(mem.swapPct * 10) / 10, 25, 'Swap percentage = 25%');

// ---- 4. Disk, Network, Loadavg, Uptime, Cpuinfo parsers ----------------------

const disk = parseDiskstats([
  '   8       0 sda 100 0 2000 50 200 0 4000 80 0 100 130',
  '   8       1 sda1 90 0 1800 45 190 0 3800 75 0 90 120',
  ' 259       0 nvme0n1 50 0 1000 10 60 0 2000 20 0 30 30',
  ' 259       1 nvme0n1p1 50 0 1000 10 60 0 2000 20 0 30 30',
  '   7       0 loop0 10 0 100 1 0 0 0 0 0 1 1',
].join('\n'));
eq(disk.readBytes, (2000 + 1000) * 512, 'whole disk read bytes (excludes partitions and loop)');
eq(disk.writeBytes, (4000 + 2000) * 512, 'whole disk write bytes');

const net = parseNetDev([
  'Inter-|   Receive                                                |  Transmit',
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
  '    lo:   99999     100    0    0    0     0          0         0    99999     100    0    0    0     0       0          0',
  ' wlan0:  250000     200    0    0    0     0          0         0   120000     150    0    0    0     0       0          0',
  '  eth0:  500000     400    0    0    0     0          0         0   300000     250    0    0    0     0       0          0',
].join('\n'));
eq(net.rxBytes, 750000, 'net rxBytes sums non-loopback interfaces');
eq(net.txBytes, 420000, 'net txBytes sums non-loopback interfaces');

const load = parseLoadavg('1.25 0.80 0.45 3/612 9412\n');
eq([load.load1, load.load5, load.load15], [1.25, 0.8, 0.45], 'loadavg 1/5/15m');
eq(parseUptime('3661.50 7000.00\n'), 3661.5, 'uptime seconds');
eq(parseCpuinfoModel('processor\t: 0\nmodel name\t: AMD Ryzen 9 7950X\n'), 'AMD Ryzen 9 7950X', 'cpuinfo model');

console.log('test_parsers PASSED');
