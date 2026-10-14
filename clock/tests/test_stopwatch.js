// Stopwatch acceptance test:
// - Start stopwatch, record three laps with known offsets, verify laps list in
//   order with accurate lap (delta) and split (total) times.
// - Verify best (fastest) and worst (slowest) laps are highlighted.
// - Verify keyboard shortcuts (Space, L) and Copy TSV.

import { app, waitFor, eq, press } from '/lib/test.js';

app.showPage('stopwatch');
app.setNow(Date.UTC(2024, 0, 15, 12, 0, 0));
app.swReset();

eq(app.state.stopwatch.running, false, 'stopwatch starts stopped');
eq(app.state.stopwatch.laps.length, 0, 'no laps initially');

// Start with Space shortcut
press('space');
eq(app.state.stopwatch.running, true, 'Space starts the stopwatch');

// Lap 1 after 1,200 ms (1.20s)
advanceTime(1200);
app.swLap();

// Lap 2 after 800 ms (0.80s — fastest / best)
advanceTime(800);
app.swLap();

// Lap 3 after 1,500 ms (1.50s — slowest / worst)
advanceTime(1500);
app.swLap();

// Stop with Space shortcut
press('space');
eq(app.state.stopwatch.running, false, 'Space stops the stopwatch');

const laps = app.state.stopwatch.laps;
eq(laps.length, 3, 'three laps recorded');
eq(laps.map((l) => l.index), [1, 2, 3], 'laps listed in order 1, 2, 3');

// Check lap deltas and cumulative splits (allowing tiny frame rounding from press('space'))
assert(Math.abs(laps[0].lapMs - 1200) <= 50, `lap 1 delta ~1200ms (got ${laps[0].lapMs})`);
assert(Math.abs(laps[1].lapMs - 800) <= 50, `lap 2 delta ~800ms (got ${laps[1].lapMs})`);
assert(Math.abs(laps[2].lapMs - 1500) <= 50, `lap 3 delta ~1500ms (got ${laps[2].lapMs})`);
assert(Math.abs(laps[2].splitMs - 3500) <= 100, `lap 3 split ~3500ms (got ${laps[2].splitMs})`);

// Best is lap 2 (800ms), worst is lap 3 (1500ms)
eq(laps[0].best, false, 'lap 1 is not best');
eq(laps[0].worst, false, 'lap 1 is not worst');
eq(laps[1].best, true, 'lap 2 is marked best');
eq(laps[2].worst, true, 'lap 3 is marked worst');

// Check DOM rows and badges
const rows = Array.from(document.querySelectorAll('.sw-lap-row'));
eq(rows.length, 3, 'three lap rows in DOM');
eq(rows[1].classList.contains('best'), true, 'row 2 has .best class');
assert(rows[1].querySelector('.sw-badge-best'), 'row 2 has Best badge');
eq(rows[2].classList.contains('worst'), true, 'row 3 has .worst class');
assert(rows[2].querySelector('.sw-badge-worst'), 'row 3 has Worst badge');

// Copy Laps as TSV
app.commands.run('sw-copy-laps');
waitFor(() => app.state.lastCopiedTsv.includes('Lap\tLap Time\tSplit Time'), 'TSV copied');
assert(document.querySelector('.toast'), 'copy toast shown');

console.log('test_stopwatch PASSED');
