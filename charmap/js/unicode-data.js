/**
 * Unicode block catalog, character entry builder, encoding converters,
 * and search engine (using bro.search.fuzzy with deterministic token/codepoint matching).
 */

import { api } from '/lib/dom.js';
import { HTML_ENTITIES, CHAR_NAMES, describeCodepoint } from './unicode-names.js';

const EMOTICON_CPS = Object.keys(CHAR_NAMES)
  .map(Number)
  .filter((cp) => cp >= 0x1F300 && cp <= 0x1F64F)
  .sort((a, b) => a - b);

export const UNICODE_BLOCKS = [
  { id: 'basic-latin', name: 'Basic Latin', icon: 'type', start: 0x0020, end: 0x007E },
  { id: 'latin-1', name: 'Latin-1 Supplement', icon: 'type', start: 0x00A0, end: 0x00FF },
  { id: 'latin-ext-a', name: 'Latin Extended-A', icon: 'type', start: 0x0100, end: 0x017F },
  { id: 'greek', name: 'Greek and Coptic', icon: 'book', start: 0x0370, end: 0x03FF,
    filter: (cp) => (cp >= 0x0391 && cp <= 0x03A1) || (cp >= 0x03A3 && cp <= 0x03A9) || (cp >= 0x03B1 && cp <= 0x03C9) },
  { id: 'cyrillic', name: 'Cyrillic', icon: 'globe', start: 0x0400, end: 0x04FF,
    filter: (cp) => cp >= 0x0401 && cp <= 0x045F },
  { id: 'punctuation', name: 'General Punctuation', icon: 'align-left', start: 0x2000, end: 0x206F,
    filter: (cp) => cp >= 0x2010 && cp <= 0x205E },
  { id: 'super-sub', name: 'Superscripts and Subscripts', icon: 'hash', start: 0x2070, end: 0x209F,
    filter: (cp) => cp === 0x2070 || cp === 0x2071 || (cp >= 0x2074 && cp <= 0x208E) || (cp >= 0x2090 && cp <= 0x209C) },
  { id: 'currency', name: 'Currency Symbols', icon: 'tag', start: 0x20A0, end: 0x20CF,
    filter: (cp) => cp >= 0x20A0 && cp <= 0x20BF },
  { id: 'letterlike', name: 'Letterlike Symbols', icon: 'sparkles', start: 0x2100, end: 0x214F },
  { id: 'number-forms', name: 'Number Forms', icon: 'hash', start: 0x2150, end: 0x218F,
    filter: (cp) => cp >= 0x2150 && cp <= 0x2188 },
  { id: 'arrows', name: 'Arrows', icon: 'arrow-right', start: 0x2190, end: 0x21FF },
  { id: 'math', name: 'Mathematical Operators', icon: 'calculator', start: 0x2200, end: 0x22FF },
  { id: 'technical', name: 'Miscellaneous Technical', icon: 'cpu', start: 0x2300, end: 0x23FF,
    filter: (cp) => (cp >= 0x2300 && cp <= 0x232B) || (cp >= 0x2380 && cp <= 0x239A) || (cp >= 0x23CE && cp <= 0x23FA) },
  { id: 'box-drawing', name: 'Box Drawing', icon: 'grid', start: 0x2500, end: 0x257F },
  { id: 'block-elements', name: 'Block Elements', icon: 'layers', start: 0x2580, end: 0x259F },
  { id: 'geometric', name: 'Geometric Shapes', icon: 'disc', start: 0x25A0, end: 0x25FF },
  { id: 'misc-symbols', name: 'Miscellaneous Symbols', icon: 'sun', start: 0x2600, end: 0x26FF,
    filter: (cp) => cp >= 0x2600 && cp <= 0x26B8 },
  { id: 'dingbats', name: 'Dingbats', icon: 'check-circle', start: 0x2700, end: 0x27BF,
    filter: (cp) => cp >= 0x2701 && cp <= 0x27BE },
  { id: 'braille', name: 'Braille Patterns', icon: 'apps', start: 0x2800, end: 0x28FF },
  { id: 'supp-arrows-math', name: 'Supplemental Arrows & Math', icon: 'arrow-up-down', start: 0x2900, end: 0x2AFF,
    filter: (cp) => (cp >= 0x2900 && cp <= 0x294F) || (cp >= 0x2980 && cp <= 0x2998) || (cp >= 0x2A00 && cp <= 0x2A3F) || (cp >= 0x2A70 && cp <= 0x2AAF) },
  { id: 'emoticons', name: 'Emoticons & Symbols', icon: 'smile', start: 0x1F300, end: 0x1F64F,
    codepoints: EMOTICON_CPS },
];

// ---- Encoding Helpers -------------------------------------------------------

/** Format a codepoint as 'U+XXXX' (minimum 4 uppercase hex digits). */
export function formatCodepoint(cp) {
  const n = Number(cp) || 0;
  return 'U+' + n.toString(16).toUpperCase().padStart(4, '0');
}

/** Encode a codepoint into space-separated uppercase UTF-8 hex bytes (e.g. 'E2 86 92'). */
export function encodeUtf8Hex(cp) {
  const n = Number(cp) || 0;
  const bytes = [];
  if (n <= 0x7F) {
    bytes.push(n);
  } else if (n <= 0x7FF) {
    bytes.push(0xC0 | (n >> 6), 0x80 | (n & 0x3F));
  } else if (n <= 0xFFFF) {
    bytes.push(0xE0 | (n >> 12), 0x80 | ((n >> 6) & 0x3F), 0x80 | (n & 0x3F));
  } else {
    bytes.push(
      0xF0 | (n >> 18),
      0x80 | ((n >> 12) & 0x3F),
      0x80 | ((n >> 6) & 0x3F),
      0x80 | (n & 0x3F)
    );
  }
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** Encode a codepoint into space-separated 4-digit uppercase UTF-16 code units (surrogate pair for astral). */
export function encodeUtf16Hex(cp) {
  const n = Number(cp) || 0;
  if (n <= 0xFFFF) {
    return n.toString(16).toUpperCase().padStart(4, '0');
  }
  const v = n - 0x10000;
  const high = 0xD800 + (v >> 10);
  const low = 0xDC00 + (v & 0x3FF);
  return `${high.toString(16).toUpperCase().padStart(4, '0')} ${low.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Return structured HTML entity forms: { named, hex, dec, display }. */
export function encodeHtmlEntities(cp) {
  const n = Number(cp) || 0;
  const named = HTML_ENTITIES[n] || null;
  const hex = `&#x${n.toString(16).toUpperCase()};`;
  const dec = `&#${n};`;
  const display = named ? `${named} / ${hex} / ${dec}` : `${hex} / ${dec}`;
  return { named, hex, dec, display };
}

/** Format HTML entity string: named entity (if known) + hex + decimal. */
export function encodeHtmlEntity(cp) {
  return encodeHtmlEntities(cp).display;
}

/** Format CSS escape string (e.g. '\\2192'). */
export function encodeCssEscape(cp) {
  const n = Number(cp) || 0;
  return '\\' + n.toString(16).toUpperCase();
}

/** Format JS / JSON escape string ('\\u2192' or '\\u{1F600}'). */
export function encodeJsEscape(cp) {
  const n = Number(cp) || 0;
  if (n <= 0xFFFF) {
    return '\\u' + n.toString(16).toUpperCase().padStart(4, '0');
  }
  return `\\u{${n.toString(16).toUpperCase()}}`;
}

/** Full encoding bundle for an inspector or test. */
export function getEncodings(cp) {
  const n = Number(cp) || 0;
  const htmlObj = encodeHtmlEntities(n);
  return {
    char: String.fromCodePoint(n),
    codepoint: formatCodepoint(n),
    utf8: encodeUtf8Hex(n),
    utf16: encodeUtf16Hex(n),
    html: htmlObj.display,
    htmlNamed: htmlObj.named,
    htmlHex: htmlObj.hex,
    htmlDec: htmlObj.dec,
    css: encodeCssEscape(n),
    js: encodeJsEscape(n),
  };
}

// ---- Block & Character Catalog ----------------------------------------------

const blockById = new Map();
const blockItemsCache = new Map();
const charByCp = new Map();
let allCharsCache = null;

function computeBlockCodepoints(b) {
  if (b.codepoints) return b.codepoints;
  const out = [];
  for (let cp = b.start; cp <= b.end; cp++) {
    if (!b.filter || b.filter(cp)) out.push(cp);
  }
  return out;
}

// Precompute lightweight codepoint lists & counts for sidebar (takes < 0.3 ms)
for (const b of UNICODE_BLOCKS) {
  b._cps = computeBlockCodepoints(b);
  b.count = b._cps.length;
  b.rangeLabel = `${formatCodepoint(b.start)}–${formatCodepoint(b.end)}`;
  blockById.set(b.id, b);
}

export const TOTAL_CHAR_COUNT = UNICODE_BLOCKS.reduce((sum, b) => sum + b.count, 0);

export function getBlockById(id) {
  if (id === 'all') {
    return { id: 'all', name: 'All Characters', icon: 'apps', rangeLabel: 'U+0020–U+1F64F', count: TOTAL_CHAR_COUNT };
  }
  if (id === 'favorites') {
    return { id: 'favorites', name: 'Favorites', icon: 'star', rangeLabel: 'Pinned characters', count: 0 };
  }
  if (id === 'recent') {
    return { id: 'recent', name: 'Recently Copied', icon: 'history', rangeLabel: 'Recent history', count: 0 };
  }
  return blockById.get(id) || null;
}

export function findBlockForCodepoint(cp) {
  for (const b of UNICODE_BLOCKS) {
    if (cp >= b.start && cp <= b.end) return b;
  }
  return null;
}

/** Build or retrieve a cached character entry for codepoint `cp`. */
export function getCharEntry(cp) {
  const n = Number(cp) || 0;
  let entry = charByCp.get(n);
  if (entry) return entry;
  const blk = findBlockForCodepoint(n);
  const blockId = blk ? blk.id : 'other';
  const blockName = blk ? blk.name : 'Unicode';
  const { name, keywords } = describeCodepoint(n, blockName);
  const char = String.fromCodePoint(n);
  const codepoint = formatCodepoint(n);
  const hexLower = n.toString(16).toLowerCase().padStart(4, '0');
  const utf8 = encodeUtf8Hex(n);
  const entity = HTML_ENTITIES[n] || '';
  const searchKey = `${name} ${keywords} ${codepoint} ${hexLower} ${entity} ${blockName}`.toLowerCase();
  entry = {
    cp: n,
    char,
    codepoint,
    name,
    keywords,
    blockId,
    blockName,
    utf8,
    entity,
    searchKey,
  };
  charByCp.set(n, entry);
  return entry;
}

/** Return the character entries for a block id ('all', 'favorites', 'recent', or block). */
export function getBlockChars(blockId, { favorites = [], recent = [] } = {}) {
  if (blockId === 'favorites') {
    return favorites.map((cp) => getCharEntry(cp));
  }
  if (blockId === 'recent') {
    return recent.map((cp) => getCharEntry(cp));
  }
  if (blockId === 'all') {
    if (!allCharsCache) {
      const all = [];
      for (const b of UNICODE_BLOCKS) {
        const items = getBlockChars(b.id);
        for (let i = 0; i < items.length; i++) all.push(items[i]);
      }
      allCharsCache = all;
    }
    return allCharsCache;
  }
  let cached = blockItemsCache.get(blockId);
  if (!cached) {
    const b = blockById.get(blockId);
    if (!b) return [];
    cached = b._cps.map((cp) => getCharEntry(cp));
    blockItemsCache.set(blockId, cached);
  }
  return cached;
}

const relatedCache = new Map();

/** Return related/similar characters for the inspector strip. */
export function getRelatedChars(cp, limit = 10) {
  let cached = relatedCache.get(cp);
  if (cached && cached.length >= limit) return cached.slice(0, limit);
  const entry = getCharEntry(cp);
  const blockItems = getBlockChars(entry.blockId);
  const out = [];
  const seen = new Set([entry.cp]);

  // First: characters sharing primary keywords in the same block
  const words = entry.name.toLowerCase().split(/[\s-]+/).filter((w) => w.length > 3 && w !== 'letter' && w !== 'sign' && w !== 'symbol');
  if (words.length > 0) {
    const keyWord = words[words.length - 1];
    for (const item of blockItems) {
      if (!seen.has(item.cp) && item.searchKey.includes(keyWord)) {
        seen.add(item.cp);
        out.push(item);
        if (out.length >= limit) break;
      }
    }
  }

  // Next: neighbors in the same block
  const idx = blockItems.findIndex((x) => x.cp === entry.cp);
  for (let offset = 1; out.length < limit && offset < blockItems.length; offset++) {
    for (const dir of [1, -1]) {
      const j = idx + offset * dir;
      if (j >= 0 && j < blockItems.length) {
        const cand = blockItems[j];
        if (!seen.has(cand.cp)) {
          seen.add(cand.cp);
          out.push(cand);
          if (out.length >= limit) break;
        }
      }
    }
  }
  relatedCache.set(cp, out);
  return out;
}

// ---- Search -----------------------------------------------------------------

let fuzzyIndex = null;
let fuzzyEntryByName = null;

function ensureFuzzyIndex() {
  if (fuzzyIndex) return fuzzyIndex;
  const searchApi = api('search');
  if (!searchApi || typeof searchApi.FuzzyIndex !== 'function') return null;
  const all = getBlockChars('all');
  fuzzyEntryByName = new Map();
  const names = [];
  for (let i = 0; i < all.length; i++) {
    const key = `${all[i].name} (${all[i].codepoint})`;
    fuzzyEntryByName.set(key, all[i]);
    names.push(key);
  }
  try {
    fuzzyIndex = new searchApi.FuzzyIndex(names);
  } catch (_) {
    fuzzyIndex = null;
  }
  return fuzzyIndex;
}

/**
 * Search characters by literal glyph ('→'), hex codepoint ('U+2192', '2192'),
 * or name/keyword ('rightwards arrow', 'infinity', 'euro', 'lambda', 'check').
 * Uses bro.search.FuzzyIndex / bro.search.fuzzy when available alongside deterministic token scoring.
 */
export function searchCharacters(query, candidates = null) {
  const pool = candidates || getBlockChars('all');
  const raw = String(query || '').trim();
  if (!raw) return pool;

  const qLower = raw.toLowerCase();
  const codepoints = Array.from(raw);

  // 1. Single literal character match (e.g. '→', '€', '∞', '😀')
  let literalCp = -1;
  if (codepoints.length === 1) {
    literalCp = codepoints[0].codePointAt(0);
  }

  // 2. Explicit hex codepoint query ('U+2192', '0x2192', or 4..6 hex digits like '2192')
  let parsedHexCp = -1;
  const hexMatch = /^(?:u\+|0x)([0-9a-f]{1,6})$/i.exec(raw) || /^([0-9a-f]{4,6})$/i.exec(raw);
  if (hexMatch) {
    parsedHexCp = parseInt(hexMatch[1], 16);
  }

  const tokens = qLower.split(/\s+/).filter(Boolean);
  const scored = [];
  const seen = new Set();

  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    let score = 0;

    if (item.cp === literalCp) {
      score += 10000;
    }
    if (parsedHexCp >= 0 && item.cp === parsedHexCp) {
      score += 9000;
    }

    const nameLower = item.name.toLowerCase();
    if (nameLower === qLower) {
      score += 5000;
    } else if (nameLower.startsWith(qLower)) {
      score += 2000;
    } else if (
      nameLower.includes(qLower) ||
      item.keywords.includes(qLower)
    ) {
      score += 1200;
    }

    if (tokens.length > 0) {
      let allMatch = true;
      let tokenBonus = 0;
      for (let t = 0; t < tokens.length; t++) {
        const tok = tokens[t];
        if (item.searchKey.includes(tok)) {
          tokenBonus += nameLower.includes(tok) ? 300 : 150;
        } else {
          allMatch = false;
          break;
        }
      }
      if (allMatch) score += tokenBonus;
    }

    if (score > 0) {
      scored.push({ item, score });
      seen.add(item.cp);
    }
  }

  // Supplement with pre-indexed bro.search.FuzzyIndex when query has few exact token matches
  if (qLower.length >= 2 && scored.length < 25 && !candidates) {
    const idx = ensureFuzzyIndex();
    if (idx) {
      try {
        const fuzzyHits = idx.search(qLower, { maxResults: 40 });
        for (let i = 0; i < fuzzyHits.length; i++) {
          const hit = fuzzyHits[i];
          const entry = fuzzyEntryByName.get(hit.item || hit.text || hit);
          if (entry && !seen.has(entry.cp) && (hit.score == null || hit.score > 30)) {
            seen.add(entry.cp);
            scored.push({ item: entry, score: Math.min(250, hit.score || 100) });
          }
        }
      } catch (_) {
        // Deterministic results already in `scored`
      }
    }
  }

  scored.sort((a, b) => b.score - a.score || a.item.cp - b.item.cp);
  return scored.map((s) => s.item);
}

