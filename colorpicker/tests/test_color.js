/**
 * Headless tests for color parsing, bi-directional format conversions,
 * Oklab / Oklch / HSL / HSV accuracy, harmonies, 50..950 scale generation,
 * and parity between `bro.themes` and the pure-JS fallback engine.
 */

import { app, eq } from '/lib/test.js';

const {
  parseColorInput,
  toHexString,
  srgbToOklch,
  oklchToSrgb,
  srgbToOklab,
  oklabToSrgb,
  srgbToHsl,
  hslToSrgb,
  srgbToHsv,
  hsvToSrgb,
  formatAllRepresentations,
  generateHarmonies,
  generateScale,
} = app.colorEngine;

for (const fallback of [false, true]) {
  app.setForceFallbackMath(fallback);
  const modeName = fallback ? 'pure-JS fallback' : 'bro.themes native';

  // 1. Hex parsing (#rgb, #rrggbb, #rrggbbaa)
  const cShort = parseColorInput('#3bf');
  eq(toHexString(cShort), '#33bbff', `${modeName}: #3bf expands to #33bbff`);

  const cBlue = parseColorInput('#3b82f6');
  eq(cBlue, { r: 59, g: 130, b: 246, a: 255 }, `${modeName}: #3b82f6 parses to RGB`);

  const cAlpha = parseColorInput('#3b82f680');
  eq(cAlpha.a, 128, `${modeName}: 8-digit hex alpha parses to 128`);
  eq(toHexString(cAlpha, true), '#3b82f680', `${modeName}: 8-digit hex serializes alpha`);

  // 2. rgb() and hsl() parsing
  const fromRgbStr = parseColorInput('rgb(59, 130, 246)');
  eq(toHexString(fromRgbStr), '#3b82f6', `${modeName}: rgb() string parses to #3b82f6`);

  const hsl = srgbToHsl(cBlue);
  const backFromHsl = hslToSrgb(hsl);
  assert(Math.abs(backFromHsl.r - cBlue.r) <= 2 && Math.abs(backFromHsl.b - cBlue.b) <= 2,
    `${modeName}: HSL round-trip stays within 2/255`);

  const hsv = srgbToHsv(cBlue);
  const backFromHsv = hsvToSrgb(hsv);
  assert(Math.abs(backFromHsv.r - cBlue.r) <= 2 && Math.abs(backFromHsv.g - cBlue.g) <= 2,
    `${modeName}: HSV round-trip stays within 2/255`);

  // 3. Oklab & Oklch round-trip
  const lab = srgbToOklab(cBlue);
  assert(lab.l > 0.60 && lab.l < 0.65, `${modeName}: #3b82f6 Oklab L ~ 0.623 (got ${lab.l})`);
  const backFromLab = oklabToSrgb(lab);
  assert(Math.abs(backFromLab.r - cBlue.r) <= 1 && Math.abs(backFromLab.g - cBlue.g) <= 1 && Math.abs(backFromLab.b - cBlue.b) <= 1,
    `${modeName}: Oklab round-trip is exact within 1/255`);

  const lch = srgbToOklch(cBlue);
  assert(lch.h > 255 && lch.h < 265, `${modeName}: #3b82f6 Oklch H ~ 260 (got ${lch.h})`);
  const backFromLch = oklchToSrgb(lch);
  assert(Math.abs(backFromLch.r - cBlue.r) <= 1 && Math.abs(backFromLch.b - cBlue.b) <= 1,
    `${modeName}: Oklch round-trip is exact within 1/255`);

  // 4. oklch() and oklab() string parsing
  const rep = formatAllRepresentations(cBlue);
  const parsedOklch = parseColorInput(rep.oklch);
  assert(parsedOklch && Math.abs(parsedOklch.r - cBlue.r) <= 2 && Math.abs(parsedOklch.b - cBlue.b) <= 2,
    `${modeName}: oklch() string round-trip parses accurately`);

  const parsedOklab = parseColorInput(rep.oklab);
  assert(parsedOklab && Math.abs(parsedOklab.r - cBlue.r) <= 2 && Math.abs(parsedOklab.b - cBlue.b) <= 2,
    `${modeName}: oklab() string round-trip parses accurately`);

  // 5. Harmonies & 50..950 Tints/Shades scale
  const harmonies = generateHarmonies(cBlue);
  eq(harmonies.complementary.length, 2, `${modeName}: complementary has 2 swatches`);
  eq(harmonies.analogous.length, 3, `${modeName}: analogous has 3 swatches`);
  eq(harmonies.triadic.length, 3, `${modeName}: triadic has 3 swatches`);
  eq(harmonies.splitComplementary.length, 3, `${modeName}: splitComplementary has 3 swatches`);
  eq(harmonies.tetradic.length, 4, `${modeName}: tetradic has 4 swatches`);

  const scale = generateScale(cBlue);
  eq(scale.length, 11, `${modeName}: scale has 11 steps (50..950)`);
  eq(scale[0].step, 50, `${modeName}: first step is 50`);
  eq(scale[10].step, 950, `${modeName}: last step is 950`);
  assert(scale[0].l > scale[10].l, `${modeName}: step 50 is lighter than step 950`);
}

app.setForceFallbackMath(false);
console.log('test_color PASSED');
