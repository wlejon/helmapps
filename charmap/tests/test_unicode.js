/**
 * Headless unit & integration tests for charmap/js/unicode-data.js:
 * - Unicode block catalog completeness
 * - Encoding conversions (UTF-8, UTF-16 surrogate pairs, HTML named/hex/dec, CSS/JS escapes)
 * - Search by name/keyword, hex codepoint, and literal glyph
 */

import { app, eq } from '/lib/test.js';

const u = app.unicode;
assert(u, 'app.unicode is exposed');

// ---- 1. Block catalog -------------------------------------------------------

const expectedBlocks = [
  'basic-latin', 'latin-1', 'latin-ext-a', 'greek', 'cyrillic',
  'punctuation', 'super-sub', 'currency', 'letterlike', 'number-forms',
  'arrows', 'math', 'technical', 'box-drawing', 'block-elements',
  'geometric', 'misc-symbols', 'dingbats', 'braille', 'supp-arrows-math',
  'emoticons',
];

const actualBlockIds = u.UNICODE_BLOCKS.map((b) => b.id);
eq(actualBlockIds, expectedBlocks, 'all 21 curated Unicode blocks are present in order');
assert(u.TOTAL_CHAR_COUNT > 2000, `catalog has >2000 characters (got ${u.TOTAL_CHAR_COUNT})`);

for (const id of expectedBlocks) {
  const chars = u.getBlockChars(id);
  assert(chars.length > 0, `block ${id} has characters (${chars.length})`);
}

const allChars = u.getBlockChars('all');
eq(allChars.length, u.TOTAL_CHAR_COUNT, 'all block returns TOTAL_CHAR_COUNT items');

// Algorithmic Braille naming
const brailleBlank = u.getCharEntry(0x2800);
eq(brailleBlank.name, 'BRAILLE PATTERN BLANK', 'U+2800 is BRAILLE PATTERN BLANK');
const braille123 = u.getCharEntry(0x2807);
eq(braille123.name, 'BRAILLE PATTERN DOTS-123', 'U+2807 is BRAILLE PATTERN DOTS-123');

// ---- 2. Encoding conversions ------------------------------------------------

// Codepoint formatting
eq(u.formatCodepoint(0x0041), 'U+0041', 'formatCodepoint ASCII');
eq(u.formatCodepoint(0x2192), 'U+2192', 'formatCodepoint BMP');
eq(u.formatCodepoint(0x1F600), 'U+1F600', 'formatCodepoint astral plane');

// UTF-8 Hex
eq(u.encodeUtf8Hex(0x0041), '41', 'UTF-8 1-byte (A)');
eq(u.encodeUtf8Hex(0x00A9), 'C2 A9', 'UTF-8 2-byte (©)');
eq(u.encodeUtf8Hex(0x03BB), 'CE BB', 'UTF-8 2-byte (λ)');
eq(u.encodeUtf8Hex(0x2192), 'E2 86 92', 'UTF-8 3-byte (→)');
eq(u.encodeUtf8Hex(0x221E), 'E2 88 9E', 'UTF-8 3-byte (∞)');
eq(u.encodeUtf8Hex(0x1F600), 'F0 9F 98 80', 'UTF-8 4-byte (😀)');

// UTF-16 Hex (including astral surrogate pair)
eq(u.encodeUtf16Hex(0x0041), '0041', 'UTF-16 BMP (A)');
eq(u.encodeUtf16Hex(0x2192), '2192', 'UTF-16 BMP (→)');
eq(u.encodeUtf16Hex(0x1F600), 'D83D DE00', 'UTF-16 surrogate pair for U+1F600');

// HTML Entities (named + hex + decimal)
const htmlArrow = u.encodeHtmlEntity(0x2192);
assert(htmlArrow.includes('&rarr;'), 'U+2192 HTML entity includes &rarr;');
assert(htmlArrow.includes('&#x2192;'), 'U+2192 HTML entity includes &#x2192;');
assert(htmlArrow.includes('&#8594;'), 'U+2192 HTML entity includes &#8594;');

const htmlCopy = u.encodeHtmlEntity(0x00A9);
assert(htmlCopy.includes('&copy;') && htmlCopy.includes('&#xA9;') && htmlCopy.includes('&#169;'), 'U+00A9 HTML entity');

const htmlAlpha = u.encodeHtmlEntity(0x03B1);
assert(htmlAlpha.includes('&alpha;') && htmlAlpha.includes('&#x3B1;') && htmlAlpha.includes('&#945;'), 'U+03B1 HTML entity');

const htmlInfin = u.encodeHtmlEntity(0x221E);
assert(htmlInfin.includes('&infin;') && htmlInfin.includes('&#x221E;') && htmlInfin.includes('&#8734;'), 'U+221E HTML entity');

// CSS and JS Escapes
eq(u.encodeCssEscape(0x2192), '\\2192', 'CSS escape for U+2192');
eq(u.encodeCssEscape(0x1F600), '\\1F600', 'CSS escape for U+1F600');
eq(u.encodeJsEscape(0x2192), '\\u2192', 'JS escape for BMP U+2192');
eq(u.encodeJsEscape(0x1F600), '\\u{1F600}', 'JS escape for astral U+1F600');

// ---- 3. Search by name, keyword, codepoint, and literal ---------------------

// Search by name/keyword
const arrowHits = u.searchCharacters('rightwards arrow');
assert(arrowHits.length > 0, 'search "rightwards arrow" returns results');
eq(arrowHits[0].cp, 0x2192, '"rightwards arrow" top result is U+2192');

const genericArrowHits = u.searchCharacters('arrow');
assert(genericArrowHits.some((x) => x.cp === 0x2192), 'search "arrow" includes U+2192');

const infHits = u.searchCharacters('infinity');
assert(infHits.length > 0 && infHits[0].cp === 0x221E, 'search "infinity" finds U+221E first');

const euroHits = u.searchCharacters('euro');
assert(euroHits.length > 0 && euroHits[0].cp === 0x20AC, 'search "euro" finds U+20AC first');

const lambdaHits = u.searchCharacters('lambda');
assert(lambdaHits.some((x) => x.cp === 0x03BB || x.cp === 0x039B), 'search "lambda" finds Greek lambda');

const checkHits = u.searchCharacters('check');
assert(checkHits.some((x) => x.cp === 0x2713), 'search "check" finds U+2713 CHECK MARK');

// Search by hex codepoint
const cpHits1 = u.searchCharacters('U+2192');
assert(cpHits1.length > 0 && cpHits1[0].cp === 0x2192, 'search "U+2192" finds U+2192 first');

const cpHits2 = u.searchCharacters('2192');
assert(cpHits2.length > 0 && cpHits2[0].cp === 0x2192, 'search "2192" finds U+2192 first');

// Search by literal glyph
const litHits = u.searchCharacters('→');
assert(litHits.length > 0 && litHits[0].cp === 0x2192, 'search literal "→" finds U+2192 first');

const litEuro = u.searchCharacters('€');
assert(litEuro.length > 0 && litEuro[0].cp === 0x20AC, 'search literal "€" finds U+20AC first');

console.log('test_unicode PASSED');
