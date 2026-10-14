// Region selection & cropping acceptance test:
// - Dragging from (100, 100) to (300, 250) selects a 200x150 region
// - Arrow keys nudge the selection by 1 px (10 px with Shift)
// - Enter confirms the region and produces a 200x150 result image

import { app, waitFor, eq, press, drag } from '/lib/test.js';

app.setCaptureSource(() => app.createSyntheticSource(640, 400));
app.settings.set('mode', 'region');
app.settings.set('delay', 0);

await app.takeScreenshot('region');
waitFor(() => app.state.view === 'region', 'Region selection overlay is open');

// Simulated drag from (100, 100) to (300, 250)
drag([100, 100], [300, 250]);
waitFor(() => app.state.regionRect && app.state.regionRect.w === 200, 'region rect dragged');
eq(app.state.regionRect, { x: 100, y: 100, w: 200, h: 150 }, '200x150 selection at (100, 100)');
eq(document.querySelector('.ss-region-pill').textContent, '200 × 150', 'dimension pill shows 200 × 150');

// Arrow keys nudge by 1 px, Shift+Arrow nudges by 10 px
press('right');
eq(app.state.regionRect, { x: 101, y: 100, w: 200, h: 150 }, 'ArrowRight nudges x by +1');
press('down');
eq(app.state.regionRect, { x: 101, y: 101, w: 200, h: 150 }, 'ArrowDown nudges y by +1');
press('shift+right');
eq(app.state.regionRect, { x: 111, y: 101, w: 200, h: 150 }, 'Shift+ArrowRight nudges x by +10');

// Enter accepts the region and crops to 200x150
press('enter');
waitFor(() => app.state.view === 'result', 'Enter transitions to Result view');
eq([app.state.image.width, app.state.image.height], [200, 150], 'cropped image is 200x150');

console.log('test_crop PASSED');
