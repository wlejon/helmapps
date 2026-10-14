// Annotation & Undo/Redo acceptance test:
// - Capture a uniform dark-gray 400x300 image ([30, 30, 30, 255])
// - Add two red rectangles, then Undo leaves only the first
// - Save burns in only the first rectangle (verified by decoding the saved PNG)
// - Also exercises arrow, highlighter, blur, and counter annotations

import { app, waitFor, eq, press, fixtureDir, mod } from '/lib/test.js';

const dir = fixtureDir({});
app.settings.set('saveFolder', dir);
app.settings.set('format', 'png');
app.settings.set('color', '#ef4444');
app.settings.set('strokeWidth', 4);

// Capture uniform 400x300 dark gray image
app.setCaptureSource(() => app.createSyntheticSource(400, 300, [30, 30, 30, 255]));
await app.takeScreenshot('full');
waitFor(() => app.state.view === 'result' && app.state.image, 'Result view ready');

// Add two rectangles at distinct locations
app.addAnnotation({ type: 'rect', x: 20, y: 20, w: 80, h: 60, color: '#ef4444', strokeWidth: 4 });
app.addAnnotation({ type: 'rect', x: 200, y: 150, w: 80, h: 60, color: '#ef4444', strokeWidth: 4 });
eq(app.state.annotations.length, 2, 'two rectangles added');

// Undo leaves one, Redo restores two, Undo again leaves one
press(`${mod}+z`);
eq(app.state.annotations.length, 1, 'Mod+Z undoes second rectangle');
press(`${mod}+shift+z`);
eq(app.state.annotations.length, 2, 'Mod+Shift+Z redoes second rectangle');
press(`${mod}+z`);
eq(app.state.annotations.length, 1, 'Mod+Z leaves only first rectangle');

// Save and decode the written PNG to verify burned-in pixels
const savedPath = await app.saveScreenshot();
assert(savedPath, 'saved annotated PNG');
const decoded = bro.image.decodeOriented(savedPath);
eq([decoded.width, decoded.height], [400, 300], 'decoded saved PNG is 400x300');

const pixelAt = (x, y) => {
  const i = (y * decoded.width + x) * 4;
  return [decoded.pixels[i], decoded.pixels[i + 1], decoded.pixels[i + 2]];
};

// Rect 1 top-left border at (20, 20) is red [239, 68, 68]
eq(pixelAt(20, 20), [239, 68, 68], 'first rectangle is burned into saved PNG at (20, 20)');
// Rect 2 top-left border at (200, 150) was undone, so it remains [30, 30, 30]
eq(pixelAt(200, 150), [30, 30, 30], 'undone second rectangle is not present at (200, 150)');

// Exercise arrow, highlighter, counter, and blur in renderFlattenedPixels
app.addAnnotation({ type: 'arrow', x1: 50, y1: 220, x2: 140, y2: 220, color: '#22c55e', strokeWidth: 4 });
app.addAnnotation({ type: 'highlighter', x: 160, y: 20, w: 50, h: 30, color: '#eab308' });
app.addAnnotation({ type: 'counter', x: 320, y: 60, number: 1, color: '#3b82f6' });
app.addAnnotation({ type: 'blur', x: 20, y: 20, w: 40, h: 40, blockSize: 10 });
const flat = app.renderFlattenedPixels();
const arrowIdx = (220 * 400 + 95) * 4;
eq([flat[arrowIdx], flat[arrowIdx + 1], flat[arrowIdx + 2]], [34, 197, 94], 'arrow burned in green');

console.log('test_annotate PASSED');
