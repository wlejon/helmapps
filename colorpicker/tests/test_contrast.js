/**
 * Headless tests for WCAG 2.1 contrast ratio, APCA Lc perceptual contrast,
 * compliance level badges, and Oklch minimum-contrast auto-adjustment.
 */

import { app, eq } from '/lib/test.js';

const { wcagContrast, apcaContrast, evaluateContrast, fixContrastColor } = app.colorEngine;

for (const fallback of [false, true]) {
  app.setForceFallbackMath(fallback);
  const label = fallback ? 'fallback' : 'native';

  // 1. Black vs White extremes
  const bw = wcagContrast('#ffffff', '#000000');
  assert(Math.abs(bw - 21.0) < 0.05, `${label}: white on black WCAG contrast is 21:1 (got ${bw})`);

  const same = wcagContrast('#3b82f6', '#3b82f6');
  assert(Math.abs(same - 1.0) < 0.01, `${label}: identical color contrast is 1:1 (got ${same})`);

  // 2. APCA polarity: dark text on light bg is positive, light text on dark bg is negative
  const lcDarkOnLight = apcaContrast('#0f172a', '#ffffff');
  const lcLightOnDark = apcaContrast('#ffffff', '#0f172a');
  assert(lcDarkOnLight > 90, `${label}: dark text on white has APCA Lc > +90 (got ${lcDarkOnLight})`);
  assert(lcLightOnDark < -90, `${label}: white text on dark has APCA Lc < -90 (got ${lcLightOnDark})`);

  // 3. Compliance thresholds
  const lowEval = evaluateContrast('#475569', '#1e293b');
  eq(lowEval.normalAA, false, `${label}: #475569 on #1e293b fails normal AA`);
  eq(lowEval.normalAAA, false, `${label}: #475569 on #1e293b fails normal AAA`);

  // 4. Auto-fix contrast to AA (4.5:1) and AAA (7.0:1)
  const fixedAA = fixContrastColor('#334155', '#0f172a', 4.5);
  const ratioAA = wcagContrast(fixedAA, '#0f172a');
  assert(ratioAA >= 4.45, `${label}: fixContrastColor(4.5) achieves >= 4.5:1 (got ${ratioAA.toFixed(2)} for ${fixedAA})`);

  const fixedAAA = fixContrastColor('#334155', '#0f172a', 7.0);
  const ratioAAA = wcagContrast(fixedAAA, '#0f172a');
  assert(ratioAAA >= 6.95, `${label}: fixContrastColor(7.0) achieves >= 7.0:1 (got ${ratioAAA.toFixed(2)} for ${fixedAAA})`);
}

app.setForceFallbackMath(false);

// 5. Drive the ContrastInspector UI component directly
app.setView('contrast');
app.contrastView.setPair('#334155', '#0f172a');
assert(!app.contrastView.metrics.normalAA, 'UI starts with failing contrast pair');
eq(app.contrastView.wcagOverallBadge.textContent, 'Low Contrast', 'badge shows Low Contrast');

app.commands.run('fix-contrast-aa');
assert(app.contrastView.metrics.normalAA, 'fix-contrast-aa command brings pair to AA compliance');
assert(
  app.contrastView.wcagOverallBadge.textContent === 'AA Compliant' ||
  app.contrastView.wcagOverallBadge.textContent === 'AAA Compliant',
  `badge updates to AA/AAA Compliant (got ${app.contrastView.wcagOverallBadge.textContent})`,
);

const beforeSwapFg = app.contrastView.fg;
const beforeSwapBg = app.contrastView.bg;
app.commands.run('swap-contrast');
eq(app.contrastView.fg, beforeSwapBg, 'swap-contrast swaps fg with bg');
eq(app.contrastView.bg, beforeSwapFg, 'swap-contrast swaps bg with fg');

console.log('test_contrast PASSED');
