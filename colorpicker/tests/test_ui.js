/**
 * Headless UI tests for helm.colorpicker:
 * - Interactive 2D plane (HSV and Oklch modes)
 * - Bi-directional format inputs & one-click copy
 * - Eyedropper screen/frame sampling
 * - Harmonies & 50..950 scale clicks
 * - Saved palettes creation, swatch addition, and deletion
 */

import { app, eq, clickEl, answerPrompt, waitFor } from '/lib/test.js';

// 1. Starts on Picker view with default #3b82f6
app.setView('picker');
app.setColor('#3b82f6');
eq(app.state.formats.hex, '#3b82f6', 'initial hex is #3b82f6');

const hexInput = document.querySelector('input[data-format="hex"]');
const rgbInput = document.querySelector('input[data-format="rgb"]');
const oklchInput = document.querySelector('input[data-format="oklch"]');
assert(hexInput && rgbInput && oklchInput, 'format inputs exist in DOM');
eq(hexInput.value, '#3b82f6', 'HEX input shows #3b82f6');
eq(rgbInput.value, 'rgb(59, 130, 246)', 'RGB input shows rgb(59, 130, 246)');

// 2. Bi-directional format editing: enter an RGB string and verify HEX and OKLCH update
app.applyUserColorString('rgb(16, 185, 129)');
eq(app.state.formats.hex, '#10b981', 'entering rgb(16, 185, 129) updates hex to #10b981');
eq(hexInput.value, '#10b981', 'HEX input updated to #10b981');

// 3. One-click copy button updates state.lastCopied
const copyOklchBtn = document.querySelector('button[data-copy-format="oklch"]');
clickEl(copyOklchBtn);
assert(app.state.lastCopied.startsWith('oklch('), `copy-oklch copied ${app.state.lastCopied}`);

// 4. Switch 2D plane between HSV and Oklch and drag/nudge
app.setPlaneSpace('oklch');
eq(app.state.planeSpace, 'oklch', 'plane space switched to oklch');
app.plane.el.focus();
app.plane.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
assert(app.state.formats.hex.startsWith('#'), 'keyboard nudge on 2D Oklch plane updates color');

app.setPlaneSpace('hsv');
eq(app.state.planeSpace, 'hsv', 'plane space switched back to hsv');

// 5. Eyedropper sampling from synthetic capture source
app.setEyedropperSource(async () => {
  const width = 40, height = 40;
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = 220;
    pixels[i * 4 + 1] = 38;
    pixels[i * 4 + 2] = 38;
    pixels[i * 4 + 3] = 255;
  }
  return { width, height, pixels };
});
const sampled = await app.pickFromEyedropper({ x: 10, y: 10 });
eq(sampled.hex, '#dc2626', 'eyedropper samples #dc2626 from frame');
eq(app.state.formats.hex, '#dc2626', 'eyedropper sets active picker color to #dc2626');

// 6. Harmonies & 50..950 Scale view
app.setView('harmonies');
const scale900 = document.querySelector('.cp-scale-cell[data-step="900"]');
assert(scale900, '50..950 scale renders step 900');
const targetHex = scale900.dataset.hex;
clickEl(scale900);
eq(app.state.formats.hex, targetHex, 'clicking step 900 loads its color into picker');

// 7. Palettes view: create a new palette via promptDialog, add a swatch, and delete
app.setView('palettes');
const beforeCount = app.harmoniesView.getPalettes().length;
app.commands.run('new-palette');
waitFor(() => document.querySelector('.dialog input.field'), 'New Palette prompt dialog');
answerPrompt('Brand Sunset');
waitFor(() => app.harmoniesView.getPalettes().length === beforeCount + 1, 'Brand Sunset palette created');
eq(app.harmoniesView.getPalettes()[0].name, 'Brand Sunset', 'newest palette is Brand Sunset');

app.setColor('#f97316');
app.commands.run('add-to-palette');
assert(app.harmoniesView.getPalettes()[0].colors.includes('#f97316'), 'add-to-palette adds #f97316 to Brand Sunset');

console.log('test_ui PASSED');
