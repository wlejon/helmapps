/**
 * What the radio can play, in words a listener reads: a genre (from three
 * families), up to three of that genre's instruments, and a mood.
 *
 * Moods sit on the mood plane at fixed places (the valence-arousal
 * circumplex): x runs dark (-1) to bright (+1), y runs calm (-1) to
 * energetic (+1). Where the listener stands picks the mood word (the
 * nearest) and also sets the stream's knobs continuously (moodKnobs), so a
 * small move is heard within a second or two and a move into another mood's
 * region is a style change.
 *
 * A target's tag encodes the style ("g=jazz|m=calm|i=piano,saxophone"), so
 * every event the stream sends says what that chunk was made as.
 */

export const FAMILIES = [
  { id: 'acoustic', label: 'Acoustic', genres: ['indie folk', 'country', 'bossa nova', 'jazz', 'blues', 'classical', 'orchestral'] },
  { id: 'band', label: 'Band', genres: ['rock', 'post-rock', 'metal', 'soul', 'gospel', 'reggae', 'jazz-funk', 'City Pop'] },
  { id: 'electronic', label: 'Electronic', genres: ['ambient', 'lo-fi', 'trip hop', 'hip hop', 'R&B', 'synthwave', 'house', 'nu-disco', 'EDM'] },
];

/** A genre's usual instruments (the first two are its default). */
export const KITS = {
  'indie folk': ['acoustic guitar', 'violin', 'cello', 'piano'],
  'country': ['acoustic guitar', 'violin', 'electric guitar', 'piano'],
  'bossa nova': ['acoustic guitar', 'piano', 'saxophone'],
  'jazz': ['piano', 'saxophone', 'upright bass', 'brushed drums'],
  'blues': ['electric guitar', 'organ', 'electric bass', 'tight drums'],
  'classical': ['piano', 'strings', 'cello', 'violin'],
  'orchestral': ['strings', 'brass', 'cello', 'violin'],
  'rock': ['electric guitar', 'electric bass', 'tight drums', 'organ'],
  'post-rock': ['electric guitar', 'strings', 'pads', 'tight drums'],
  'metal': ['electric guitar', 'electric bass', 'tight drums'],
  'soul': ['Rhodes piano', 'organ', 'brass', 'groovy bass'],
  'gospel': ['organ', 'piano', 'brass', 'tight drums'],
  'reggae': ['organ', 'electric bass', 'electric guitar', 'tight drums'],
  'jazz-funk': ['Rhodes piano', 'groovy bass', 'saxophone', 'brass'],
  'City Pop': ['Rhodes piano', 'groovy bass', 'electric guitar', 'brass'],
  'ambient': ['pads', 'synth', 'piano', 'strings'],
  'lo-fi': ['Rhodes piano', 'drum machine', 'pads', 'electric bass'],
  'trip hop': ['drum machine', 'Rhodes piano', 'strings', 'electric bass'],
  'hip hop': ['808', 'drum machine', 'piano', 'synth'],
  'R&B': ['Rhodes piano', 'groovy bass', '808', 'pads'],
  'synthwave': ['synth', 'drum machine', 'pads', 'electric bass'],
  'house': ['synth', 'drum machine', 'piano', 'groovy bass'],
  'nu-disco': ['groovy bass', 'synth', 'strings', 'drum machine'],
  'EDM': ['synth', 'drum machine', '808', 'pads'],
};

export const GENRES = FAMILIES.flatMap((f) => f.genres);
export const familyOf = (genre) => FAMILIES.find((f) => f.genres.includes(genre));

/** Mood words at their place on the plane (x: dark..bright, y: calm..energetic). */
export const MOODS = [
  { id: 'euphoric', x: 0.75, y: 0.75 },
  { id: 'joyful', x: 0.85, y: 0.3 },
  { id: 'upbeat', x: 0.45, y: 0.55 },
  { id: 'energetic', x: 0.05, y: 0.9 },
  { id: 'epic', x: -0.3, y: 0.65 },
  { id: 'aggressive', x: -0.75, y: 0.75 },
  { id: 'dark', x: -0.85, y: 0.1 },
  { id: 'melancholic', x: -0.65, y: -0.45 },
  { id: 'bittersweet', x: -0.25, y: -0.3 },
  { id: 'nostalgic', x: 0.1, y: -0.4 },
  { id: 'romantic', x: 0.5, y: -0.2 },
  { id: 'tender', x: 0.35, y: -0.65 },
  { id: 'dreamy', x: -0.1, y: -0.8 },
  { id: 'calm', x: 0.7, y: -0.75 },
];

/** The mood nearest (x, y); `current` holds until another is clearly nearer. */
export function moodAt(x, y, current = null, margin = 0.25) {
  let best = MOODS[0], bd = Infinity;
  for (const m of MOODS) { const d = Math.hypot(m.x - x, m.y - y); if (d < bd) { bd = d; best = m; } }
  if (!current || best.id === current) return best;
  const cur = MOODS.find((m) => m.id === current);
  if (!cur) return best;
  return bd < Math.hypot(cur.x - x, cur.y - y) * (1 - margin) ? best : cur;
}

/**
 * The knobs a place on the plane sets. Energetic (up) is louder and fuller,
 * calm (down) softer and sparser; bright (right) is brighter, dark (left)
 * warmer and darker. Kept inside the ranges the research found clean.
 */
export function moodKnobs(x, y) {
  const c = (v) => Math.max(-1, Math.min(1, v));
  return {
    energy: +(c(y) >= 0 ? 0.6 * c(y) : 1.0 * c(y)).toFixed(2),
    density: +(c(y) >= 0 ? 0.6 * c(y) : 0.8 * c(y)).toFixed(2),
    timbre: +(c(x) >= 0 ? 0.6 * c(x) : 0.8 * c(x)).toFixed(2),
  };
}

/** A style: { genre, mood, instruments }. Fills in the defaults. */
export function makeStyle({ genre = 'lo-fi', mood = 'calm', instruments = null } = {}) {
  if (!KITS[genre]) genre = 'lo-fi';
  if (!MOODS.some((m) => m.id === mood)) mood = 'calm';
  const kit = KITS[genre];
  let ins = (instruments || []).filter((i) => kit.includes(i)).slice(0, 3);
  if (!ins.length) ins = kit.slice(0, 2);
  return { genre, mood, instruments: ins };
}

/** YuE2's "[Tags]" text for a style. */
export const styleText = (s) => `${s.genre}, ${s.instruments.join(', ')}, ${s.mood}, instrumental`;

/** A few words for the UI. */
export const styleLabel = (s) => (s ? `${s.mood} ${s.genre}` : '');

export const styleTag = (s) => `g=${s.genre}|m=${s.mood}|i=${s.instruments.join(',')}`;

/** The style a tag names, or null. */
export function tagStyle(tag) {
  if (!tag || !tag.startsWith('g=')) return null;
  const f = {};
  for (const part of tag.split('|')) { const i = part.indexOf('='); f[part.slice(0, i)] = part.slice(i + 1); }
  return makeStyle({ genre: f.g, mood: f.m, instruments: f.i ? f.i.split(',') : [] });
}

export const sameStyle = (a, b) => !!a && !!b && styleTag(a) === styleTag(b);
