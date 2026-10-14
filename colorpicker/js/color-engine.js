/**
 * Color Engine for helm.colorpicker.
 * Powered by `bro.themes` (Oklab, Oklch, sRGB, HSL, HSV, WCAG 2.1, APCA Lc,
 * and minimum-contrast adjustment) with complete pure-JS fallback math when
 * `bro.themes` is unavailable or disabled in tests.
 */

import { api, clamp } from '/lib/dom.js';

let forceFallback = false;

export function setForceFallbackMath(force) {
  forceFallback = !!force;
}

export function isUsingNativeThemes() {
  return !forceFallback && !!api('themes');
}

function themesApi() {
  return forceFallback ? null : api('themes');
}

// ---- sRGB <-> Linear sRGB <-> Oklab <-> Oklch pure-JS math ------------------

export function srgbChannelToLinear(u8) {
  const c = clamp(u8, 0, 255) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearChannelToSrgb(lin) {
  const c = clamp(lin, 0, 1);
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(clamp(s * 255, 0, 255));
}

export function jsSrgbToOklab({ r, g, b }) {
  const lr = srgbChannelToLinear(r);
  const lg = srgbChannelToLinear(g);
  const lb = srgbChannelToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

export function jsOklabToLinearRgb({ l, a, b }) {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  return {
    r: +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    b: -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S,
  };
}

export function jsOklabToSrgb(lab, alpha = 255) {
  const lin = jsOklabToLinearRgb(lab);
  return {
    r: linearChannelToSrgb(lin.r),
    g: linearChannelToSrgb(lin.g),
    b: linearChannelToSrgb(lin.b),
    a: clamp(Math.round(alpha), 0, 255),
  };
}

export function jsOklabToOklch({ l, a, b }) {
  const c = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: clamp(l, 0, 1), c: Math.max(0, c), h: c < 1e-5 ? 0 : h };
}

export function jsOklchToOklab({ l, c, h }) {
  const rad = ((Number(h) || 0) * Math.PI) / 180;
  return {
    l: clamp(Number(l) || 0, 0, 1),
    a: Math.max(0, Number(c) || 0) * Math.cos(rad),
    b: Math.max(0, Number(c) || 0) * Math.sin(rad),
  };
}

export function isLinearInGamut({ r, g, b }) {
  const eps = 1e-4;
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
}

export function jsFitOklchToGamut({ l, c, h }) {
  const L = clamp(Number(l) || 0, 0, 1);
  const H = ((Number(h) || 0) % 360 + 360) % 360;
  let C = Math.max(0, Number(c) || 0);
  if (L <= 0) return { l: 0, c: 0, h: H };
  if (L >= 1) return { l: 1, c: 0, h: H };
  if (isLinearInGamut(jsOklabToLinearRgb(jsOklchToOklab({ l: L, c: C, h: H })))) {
    return { l: L, c: C, h: H };
  }
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) * 0.5;
    if (isLinearInGamut(jsOklabToLinearRgb(jsOklchToOklab({ l: L, c: mid, h: H })))) lo = mid;
    else hi = mid;
  }
  return { l: L, c: lo, h: H };
}

// ---- HSL & HSV conversions --------------------------------------------------

export function jsSrgbToHsl({ r, g, b }) {
  const rf = clamp(r, 0, 255) / 255;
  const gf = clamp(g, 0, 255) / 255;
  const bf = clamp(b, 0, 255) / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) * 60;
  else if (max === gf) h = ((bf - rf) / d + 2) * 60;
  else h = ((rf - gf) / d + 4) * 60;
  return { h, s, l };
}

export function jsHslToSrgb({ h, s, l }, a = 255) {
  const H = (((Number(h) || 0) % 360) + 360) % 360;
  const S = clamp(Number(s) || 0, 0, 1);
  const L = clamp(Number(l) || 0, 0, 1);
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (H < 60) [r1, g1, b1] = [c, x, 0];
  else if (H < 120) [r1, g1, b1] = [x, c, 0];
  else if (H < 180) [r1, g1, b1] = [0, c, x];
  else if (H < 240) [r1, g1, b1] = [0, x, c];
  else if (H < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return {
    r: Math.round(clamp((r1 + m) * 255, 0, 255)),
    g: Math.round(clamp((g1 + m) * 255, 0, 255)),
    b: Math.round(clamp((b1 + m) * 255, 0, 255)),
    a: clamp(Math.round(a), 0, 255),
  };
}

export function jsSrgbToHsv({ r, g, b }) {
  const rf = clamp(r, 0, 255) / 255;
  const gf = clamp(g, 0, 255) / 255;
  const bf = clamp(b, 0, 255) / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) * 60;
    else if (max === gf) h = ((bf - rf) / d + 2) * 60;
    else h = ((rf - gf) / d + 4) * 60;
  }
  return { h, s, v };
}

export function jsHsvToSrgb({ h, s, v }, a = 255) {
  const H = (((Number(h) || 0) % 360) + 360) % 360;
  const S = clamp(Number(s) || 0, 0, 1);
  const V = clamp(Number(v) || 0, 0, 1);
  const c = V * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = V - c;
  let r1 = 0, g1 = 0, b1 = 0;
  if (H < 60) [r1, g1, b1] = [c, x, 0];
  else if (H < 120) [r1, g1, b1] = [x, c, 0];
  else if (H < 180) [r1, g1, b1] = [0, c, x];
  else if (H < 240) [r1, g1, b1] = [0, x, c];
  else if (H < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return {
    r: Math.round(clamp((r1 + m) * 255, 0, 255)),
    g: Math.round(clamp((g1 + m) * 255, 0, 255)),
    b: Math.round(clamp((b1 + m) * 255, 0, 255)),
    a: clamp(Math.round(a), 0, 255),
  };
}

// ---- Wrapper APIs delegating to bro.themes with pure-JS fallback ------------

export function toHexString(c, includeAlpha = false) {
  const r = clamp(Math.round(c.r || 0), 0, 255);
  const g = clamp(Math.round(c.g || 0), 0, 255);
  const b = clamp(Math.round(c.b || 0), 0, 255);
  const a = c.a == null ? 255 : clamp(Math.round(c.a), 0, 255);
  const hex2 = (n) => n.toString(16).padStart(2, '0');
  if (includeAlpha && a < 255) return `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a)}`;
  const t = themesApi();
  if (t && typeof t.toHexString === 'function') {
    try { return t.toHexString({ r, g, b, a: 255 }).toLowerCase(); } catch (_) {}
  }
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function srgbToOklab(c) {
  const t = themesApi();
  if (t && typeof t.srgbToOklab === 'function') {
    try { return t.srgbToOklab(c); } catch (_) {}
  }
  return jsSrgbToOklab(c);
}

export function oklabToSrgb(lab, alpha = 255) {
  const t = themesApi();
  if (t && typeof t.oklabToSrgb === 'function') {
    try {
      const res = t.oklabToSrgb(lab);
      return { r: res.r, g: res.g, b: res.b, a: clamp(Math.round(alpha), 0, 255) };
    } catch (_) {}
  }
  return jsOklabToSrgb(lab, alpha);
}

export function srgbToOklch(c) {
  const t = themesApi();
  if (t && typeof t.srgbToOklch === 'function') {
    try { return t.srgbToOklch(c); } catch (_) {}
  }
  return jsOklabToOklch(jsSrgbToOklab(c));
}

export function oklchToSrgb(lch, alpha = 255) {
  const fitted = fitOklchToGamut(lch);
  const t = themesApi();
  if (t && typeof t.oklchToSrgb === 'function') {
    try {
      const res = t.oklchToSrgb(fitted);
      return { r: res.r, g: res.g, b: res.b, a: clamp(Math.round(alpha), 0, 255) };
    } catch (_) {}
  }
  return jsOklabToSrgb(jsOklchToOklab(fitted), alpha);
}

export function fitOklchToGamut(lch) {
  const t = themesApi();
  if (t && typeof t.fitOklchToGamut === 'function') {
    try { return t.fitOklchToGamut(lch); } catch (_) {}
  }
  return jsFitOklchToGamut(lch);
}

export function srgbToHsl(c) {
  const t = themesApi();
  if (t && typeof t.srgbToHsl === 'function') {
    try { return t.srgbToHsl(c); } catch (_) {}
  }
  return jsSrgbToHsl(c);
}

export function hslToSrgb(hsl, alpha = 255) {
  const t = themesApi();
  if (t && typeof t.hslToSrgb === 'function') {
    try {
      const res = t.hslToSrgb(hsl);
      return { r: res.r, g: res.g, b: res.b, a: clamp(Math.round(alpha), 0, 255) };
    } catch (_) {}
  }
  return jsHslToSrgb(hsl, alpha);
}

export function srgbToHsv(c) {
  const t = themesApi();
  if (t && typeof t.srgbToHsv === 'function') {
    try { return t.srgbToHsv(c); } catch (_) {}
  }
  return jsSrgbToHsv(c);
}

export function hsvToSrgb(hsv, alpha = 255) {
  const t = themesApi();
  if (t && typeof t.hsvToSrgb === 'function') {
    try {
      const res = t.hsvToSrgb(hsv);
      return { r: res.r, g: res.g, b: res.b, a: clamp(Math.round(alpha), 0, 255) };
    } catch (_) {}
  }
  return jsHsvToSrgb(hsv, alpha);
}

// ---- Multi-format Color Parser ----------------------------------------------

export function parseColorInput(input) {
  if (!input) return null;
  if (typeof input === 'object' && input.r != null && input.g != null && input.b != null) {
    return {
      r: clamp(Math.round(input.r), 0, 255),
      g: clamp(Math.round(input.g), 0, 255),
      b: clamp(Math.round(input.b), 0, 255),
      a: input.a == null ? 255 : clamp(Math.round(input.a), 0, 255),
    };
  }
  const str = String(input).trim();
  if (!str) return null;

  // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa (with or without leading #)
  const hexMatch = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(str);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3 || h.length === 4) {
      h = h.split('').map((ch) => ch + ch).join('');
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
    return { r, g, b, a };
  }

  // rgb() / rgba()
  const rgbMatch = /^rgba?\(\s*([0-9.]+%?)\s*(?:,|\s)\s*([0-9.]+%?)\s*(?:,|\s)\s*([0-9.]+%?)(?:\s*(?:,|\/)\s*([0-9.]+%?))?\s*\)$/i.exec(str);
  if (rgbMatch) {
    const chan = (s) => (s.endsWith('%') ? (parseFloat(s) / 100) * 255 : parseFloat(s));
    const alpha = (s) => {
      if (!s) return 255;
      return s.endsWith('%') ? (parseFloat(s) / 100) * 255 : parseFloat(s) * 255;
    };
    return {
      r: clamp(Math.round(chan(rgbMatch[1])), 0, 255),
      g: clamp(Math.round(chan(rgbMatch[2])), 0, 255),
      b: clamp(Math.round(chan(rgbMatch[3])), 0, 255),
      a: clamp(Math.round(alpha(rgbMatch[4])), 0, 255),
    };
  }

  // hsl() / hsla()
  const hslMatch = /^hsla?\(\s*(-?[0-9.]+)(?:deg)?\s*(?:,|\s)\s*([0-9.]+)%\s*(?:,|\s)\s*([0-9.]+)%(?:\s*(?:,|\/)\s*([0-9.]+%?))?\s*\)$/i.exec(str);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]);
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;
    const aStr = hslMatch[4];
    const a = !aStr ? 255 : aStr.endsWith('%') ? (parseFloat(aStr) / 100) * 255 : parseFloat(aStr) * 255;
    return hslToSrgb({ h, s, l }, a);
  }

  // oklch(L C H [/ A])
  const lchMatch = /^oklch\(\s*([0-9.]+%?)\s+(?:,\s*)?([0-9.]+)\s+(?:,\s*)?(-?[0-9.]+)(?:deg)?(?:\s*\/\s*([0-9.]+%?))?\s*\)$/i.exec(str);
  if (lchMatch) {
    const lRaw = lchMatch[1];
    const l = lRaw.endsWith('%') ? parseFloat(lRaw) / 100 : parseFloat(lRaw);
    const c = parseFloat(lchMatch[2]);
    const h = parseFloat(lchMatch[3]);
    const aStr = lchMatch[4];
    const a = !aStr ? 255 : aStr.endsWith('%') ? (parseFloat(aStr) / 100) * 255 : parseFloat(aStr) * 255;
    return oklchToSrgb({ l, c, h }, a);
  }

  // oklab(L a b [/ A])
  const labMatch = /^oklab\(\s*([0-9.]+%?)\s+(?:,\s*)?(-?[0-9.]+)\s+(?:,\s*)?(-?[0-9.]+)(?:\s*\/\s*([0-9.]+%?))?\s*\)$/i.exec(str);
  if (labMatch) {
    const lRaw = labMatch[1];
    const l = lRaw.endsWith('%') ? parseFloat(lRaw) / 100 : parseFloat(lRaw);
    const aVal = parseFloat(labMatch[2]);
    const bVal = parseFloat(labMatch[3]);
    const aStr = labMatch[4];
    const alpha = !aStr ? 255 : aStr.endsWith('%') ? (parseFloat(aStr) / 100) * 255 : parseFloat(aStr) * 255;
    return oklabToSrgb({ l, a: aVal, b: bVal }, alpha);
  }

  // Delegate to bro.themes.parseColor if available
  const t = themesApi();
  if (t && typeof t.parseColor === 'function') {
    try {
      const parsed = t.parseColor(str);
      if (parsed && typeof parsed.r === 'number') {
        return { r: parsed.r, g: parsed.g, b: parsed.b, a: parsed.a == null ? 255 : parsed.a };
      }
    } catch (_) {}
  }
  return null;
}

export function formatAllRepresentations(c) {
  const r = clamp(Math.round(c.r || 0), 0, 255);
  const g = clamp(Math.round(c.g || 0), 0, 255);
  const b = clamp(Math.round(c.b || 0), 0, 255);
  const a = c.a == null ? 255 : clamp(Math.round(c.a), 0, 255);
  const alphaFrac = Math.round((a / 255) * 100) / 100;
  const hasAlpha = a < 255;

  const hex = toHexString({ r, g, b, a }, true);
  const hex6 = toHexString({ r, g, b, a: 255 }, false);
  const rgb = hasAlpha ? ` rgba(${r}, ${g}, ${b}, ${alphaFrac})`.trim() : `rgb(${r}, ${g}, ${b})`;

  const hslObj = srgbToHsl({ r, g, b });
  const hDeg = Math.round(hslObj.h || 0);
  const sPct = Math.round((hslObj.s || 0) * 100);
  const lPct = Math.round((hslObj.l || 0) * 100);
  const hsl = hasAlpha ? `hsla(${hDeg}, ${sPct}%, ${lPct}%, ${alphaFrac})` : `hsl(${hDeg}, ${sPct}%, ${lPct}%)`;

  const lchObj = srgbToOklch({ r, g, b });
  const lStr = (lchObj.l || 0).toFixed(3);
  const cStr = (lchObj.c || 0).toFixed(3);
  const chDeg = Math.round(lchObj.h || 0);
  const oklch = hasAlpha
    ? `oklch(${lStr} ${cStr} ${chDeg} / ${alphaFrac})`
    : `oklch(${lStr} ${cStr} ${chDeg})`;

  const labObj = srgbToOklab({ r, g, b });
  const oklab = hasAlpha
    ? `oklab(${(labObj.l || 0).toFixed(3)} ${(labObj.a || 0).toFixed(3)} ${(labObj.b || 0).toFixed(3)} / ${alphaFrac})`
    : `oklab(${(labObj.l || 0).toFixed(3)} ${(labObj.a || 0).toFixed(3)} ${(labObj.b || 0).toFixed(3)})`;

  const cssVar = `--color-accent: ${oklch}; /* ${hex6} */`;

  return { hex, hex6, rgb, hsl, oklch, oklab, cssVar, hslObj, lchObj, labObj };
}

// ---- WCAG 2.1 & APCA Contrast Calculation & Auto-Fix ------------------------

export function relativeLuminance(color) {
  const c = typeof color === 'string' ? parseColorInput(color) : color;
  if (!c) return 0;
  const t = themesApi();
  if (t && typeof t.relativeLuminance === 'function') {
    try { return t.relativeLuminance(toHexString(c)); } catch (_) {}
  }
  const R = srgbChannelToLinear(c.r);
  const G = srgbChannelToLinear(c.g);
  const B = srgbChannelToLinear(c.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function wcagContrast(fg, bg) {
  const c1 = typeof fg === 'string' ? parseColorInput(fg) : fg;
  const c2 = typeof bg === 'string' ? parseColorInput(bg) : bg;
  if (!c1 || !c2) return 1;
  const t = themesApi();
  if (t && typeof t.contrast === 'function') {
    try { return t.contrast(toHexString(c1), toHexString(c2)); } catch (_) {}
  }
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** APCA-W3 0.0.98G-4g perceptual contrast Lc (signed: + dark on light, - light on dark). */
export function apcaContrast(fg, bg) {
  const c1 = typeof fg === 'string' ? parseColorInput(fg) : fg;
  const c2 = typeof bg === 'string' ? parseColorInput(bg) : bg;
  if (!c1 || !c2) return 0;
  const t = themesApi();
  if (t && typeof t.apcaContrast === 'function') {
    try { return t.apcaContrast(toHexString(c1), toHexString(c2)); } catch (_) {}
  }
  const sRco = 0.2126729, sGco = 0.7151522, sBco = 0.0721750;
  const mainTRC = 2.4;
  const screenLum = (c) => sRco * Math.pow(c.r / 255, mainTRC) + sGco * Math.pow(c.g / 255, mainTRC) + sBco * Math.pow(c.b / 255, mainTRC);
  let Ytxt = screenLum(c1);
  let Ybg = screenLum(c2);
  const blkThrs = 0.022, blkClmp = 1.414;
  if (Ytxt < blkThrs) Ytxt += Math.pow(blkThrs - Ytxt, blkClmp);
  if (Ybg < blkThrs) Ybg += Math.pow(blkThrs - Ybg, blkClmp);
  if (Math.abs(Ybg - Ytxt) < 0.0005) return 0;
  const scaleBoW = 1.14, scaleWoB = 1.14;
  const normBG = 0.56, normTXT = 0.57, revTXT = 0.62, revBG = 0.65;
  const loBoWoffset = 0.027, loWoBoffset = 0.027, loClip = 0.1;
  if (Ybg > Ytxt) {
    const SAPC = (Math.pow(Ybg, normBG) - Math.pow(Ytxt, normTXT)) * scaleBoW;
    return (SAPC < loClip ? 0 : SAPC - loBoWoffset) * 100;
  } else {
    const SAPC = (Math.pow(Ybg, revBG) - Math.pow(Ytxt, revTXT)) * scaleWoB;
    return (SAPC > -loClip ? 0 : SAPC + loWoBoffset) * 100;
  }
}

export function evaluateContrast(fg, bg) {
  const ratio = wcagContrast(fg, bg);
  const lc = apcaContrast(fg, bg);
  const absLc = Math.abs(lc);
  return {
    ratio,
    lc,
    absLc,
    normalAA: ratio >= 4.5,
    normalAAA: ratio >= 7.0,
    largeAA: ratio >= 3.0,
    largeAAA: ratio >= 4.5,
    uiAA: ratio >= 3.0,
    apcaBody: absLc >= 75,
    apcaLarge: absLc >= 60,
    apcaSub: absLc >= 45,
  };
}

/**
 * Adjust `fg` lightness in Oklch space so its WCAG contrast against `bg` meets
 * `minRatio` (e.g. 4.5 for AA or 7.0 for AAA) while preserving hue.
 */
export function fixContrastColor(fg, bg, minRatio = 4.5) {
  const cFg = typeof fg === 'string' ? parseColorInput(fg) : fg;
  const cBg = typeof bg === 'string' ? parseColorInput(bg) : bg;
  if (!cFg || !cBg) return '#ffffff';
  if (wcagContrast(cFg, cBg) >= minRatio) return toHexString(cFg);

  const t = themesApi();
  if (t && typeof t.adjustContrast === 'function') {
    try {
      const hex = t.adjustContrast(toHexString(cFg), toHexString(cBg), { minRatio });
      const parsed = parseColorInput(hex);
      if (parsed && wcagContrast(parsed, cBg) >= minRatio - 0.05) {
        return toHexString(parsed);
      }
    } catch (_) {}
  }

  // Pure-JS binary search on Oklch L in the direction away from bg's luminance
  const bgLum = relativeLuminance(cBg);
  const lch = srgbToOklch(cFg);
  const goLighter = bgLum < 0.5;
  let lo = goLighter ? lch.l : 0;
  let hi = goLighter ? 1 : lch.l;
  let best = goLighter ? { r: 255, g: 255, b: 255, a: 255 } : { r: 0, g: 0, b: 0, a: 255 };

  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) * 0.5;
    const candidate = oklchToSrgb({ l: mid, c: lch.c, h: lch.h });
    const r = wcagContrast(candidate, cBg);
    if (r >= minRatio) {
      best = candidate;
      if (goLighter) hi = mid;
      else lo = mid;
    } else {
      if (goLighter) lo = mid;
      else hi = mid;
    }
  }
  return toHexString(best);
}

// ---- Harmonies & Tints/Shades Scale (50..950) -------------------------------

export function generateHarmonies(color) {
  const c = typeof color === 'string' ? parseColorInput(color) : color;
  const lch = srgbToOklch(c || { r: 59, g: 130, b: 246 });
  const rot = (deg) => {
    const h = ((lch.h + deg) % 360 + 360) % 360;
    const rgb = oklchToSrgb({ l: lch.l, c: lch.c, h });
    return { hex: toHexString(rgb), rgb, h: Math.round(h) };
  };
  return {
    complementary: [rot(0), rot(180)],
    analogous: [rot(-30), rot(0), rot(30)],
    triadic: [rot(0), rot(120), rot(240)],
    splitComplementary: [rot(0), rot(150), rot(210)],
    tetradic: [rot(0), rot(90), rot(180), rot(270)],
  };
}

const SCALE_STEPS = [
  { step: 50, l: 0.97, cScale: 0.18 },
  { step: 100, l: 0.93, cScale: 0.32 },
  { step: 200, l: 0.86, cScale: 0.55 },
  { step: 300, l: 0.78, cScale: 0.78 },
  { step: 400, l: 0.70, cScale: 0.95 },
  { step: 500, l: 0.62, cScale: 1.00 },
  { step: 600, l: 0.54, cScale: 0.96 },
  { step: 700, l: 0.46, cScale: 0.85 },
  { step: 800, l: 0.37, cScale: 0.70 },
  { step: 900, l: 0.28, cScale: 0.55 },
  { step: 950, l: 0.20, cScale: 0.42 },
];

export function generateScale(color) {
  const c = typeof color === 'string' ? parseColorInput(color) : color;
  const lch = srgbToOklch(c || { r: 59, g: 130, b: 246 });
  const baseC = Math.max(0.02, lch.c);
  return SCALE_STEPS.map(({ step, l, cScale }) => {
    const rgb = oklchToSrgb({ l, c: lch.c < 0.01 ? 0 : baseC * cScale, h: lch.h });
    return { step, hex: toHexString(rgb), rgb, l, h: Math.round(lch.h) };
  });
}
