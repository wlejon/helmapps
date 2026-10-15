/**
 * The atlas's anchors: instrumental style prompts, each a place on the map.
 *
 * A prompt is YuE2 "[Tags]" text in the shape the research streams used
 * ("genre, instrument, instrument, mood, instrumental"). The vocabulary is a
 * genre's usual instruments (its kit) crossed with moods, so every genre has
 * several places, and a seeded pick keeps the list the same on every machine
 * and every start (the cache of their embeddings is keyed by it).
 *
 * The prompt text is never the UI: the map shows dots. Only the now strip
 * names where the music is, in a few words (anchor.label).
 */

/** A genre's usual instruments (the yue2-lab's kits). */
const KITS = {
  'indie folk': ['acoustic guitar', 'violin', 'cello', 'piano'],
  'City Pop': ['Rhodes piano', 'groovy bass', 'electric guitar', 'brass'],
  'R&B': ['Rhodes piano', 'groovy bass', '808', 'pads'],
  'jazz-funk': ['Rhodes piano', 'groovy bass', 'saxophone', 'brass'],
  'rock': ['electric guitar', 'electric bass', 'tight drums', 'organ'],
  'post-rock': ['electric guitar', 'strings', 'pads', 'tight drums'],
  'metal': ['electric guitar', 'electric bass', 'tight drums'],
  'hip hop': ['808', 'drum machine', 'piano', 'synth'],
  'lo-fi': ['Rhodes piano', 'drum machine', 'pads', 'electric bass'],
  'synthwave': ['synth', 'drum machine', 'pads', 'electric bass'],
  'EDM': ['synth', 'drum machine', '808', 'pads'],
  'house': ['synth', 'drum machine', 'piano', 'groovy bass'],
  'nu-disco': ['groovy bass', 'synth', 'strings', 'drum machine'],
  'country': ['acoustic guitar', 'violin', 'electric guitar', 'piano'],
  'blues': ['electric guitar', 'organ', 'electric bass', 'tight drums'],
  'soul': ['Rhodes piano', 'organ', 'brass', 'groovy bass'],
  'gospel': ['organ', 'piano', 'brass', 'tight drums'],
  'bossa nova': ['acoustic guitar', 'piano', 'saxophone'],
  'reggae': ['organ', 'electric bass', 'electric guitar', 'tight drums'],
  'orchestral': ['strings', 'brass', 'cello', 'violin'],
  'ambient': ['pads', 'synth', 'piano', 'strings'],
  'jazz': ['piano', 'saxophone', 'upright bass', 'brushed drums'],
  'classical': ['piano', 'strings', 'cello', 'violin'],
  'trip hop': ['drum machine', 'Rhodes piano', 'strings', 'electric bass'],
};

const MOODS = ['upbeat', 'melancholic', 'dreamy', 'energetic', 'tender', 'dark', 'euphoric', 'nostalgic',
  'romantic', 'aggressive', 'calm', 'joyful', 'bittersweet', 'epic'];

/** Moods each genre gets an anchor in. */
const PER_GENRE = 5;

/** Bump when the list changes: the embedding cache is keyed by it. */
export const ANCHORS_VERSION = 1;

/** A small seeded generator (mulberry32), so the list is the same everywhere. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(r, list, n) {
  const pool = list.slice(), out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
}

/**
 * The anchors: [{ id, genre, mood, instruments, style, label }]. id is the
 * index, stable for a given ANCHORS_VERSION.
 */
export function buildAnchors() {
  const r = rng(20261014);
  const out = [];
  for (const [genre, kit] of Object.entries(KITS)) {
    for (const mood of pick(r, MOODS, PER_GENRE)) {
      const instruments = pick(r, kit, 2);
      out.push({
        id: out.length,
        genre, mood, instruments,
        style: `${genre}, ${instruments.join(', ')}, ${mood}, instrumental`,
        label: `${mood} ${genre}`,
      });
    }
  }
  return out;
}
