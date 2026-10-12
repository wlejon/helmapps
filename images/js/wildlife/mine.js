/**
 * Her answers as names: what answers.js keeps, turned into the labels every
 * view shows (the shape bro.vision.wildlife.labels() answers, with `mine`),
 * and the small rules around them: the text she types ("4 Mallard"), the
 * animal it names, which names are spiders (never put in front of her).
 */

const RANK_TITLES = { genus: 'Genus', family: 'Family', order: 'Order', class: 'Class' };

/** Text as names are compared: no case, no accents, no apostrophes, punctuation a space. */
export function fold(s) {
  let t = String(s == null ? '' : s).toLowerCase();
  if (typeof t.normalize === 'function') t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return t.replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** A label's key: the filter and the counts tell taxa apart by rank and scientific name; her own words by themselves. */
export const labelKey = (l) => (l.rank ? `${l.rank}:${l.scientific}` : `name:${fold(l.common || l.scientific)}`);

/**
 * Her record as labels, best first as she gave them: { common, scientific,
 * rank (null for her own words), score: 1, from: 'user', boxes, mine: true,
 * count?, confirmed? }. A name the identifier also gave keeps its boxes (so
 * it still isolates and zooms). "No animal" is no labels.
 */
export function answerLabels(rec, theirs = []) {
  if (!rec || !rec.answer || rec.answer.none) return [];
  return (rec.answer.animals || []).map((a) => {
    const l = { common: a.name, scientific: a.scientific || a.name, rank: a.rank || null, score: 1, from: 'user', boxes: [], mine: true };
    if (a.count > 1) l.count = a.count;
    if (rec.confirmed) l.confirmed = true;
    const same = theirs.find((t) => labelKey(t) === labelKey(l));
    if (same && same.boxes) l.boxes = same.boxes;
    return l;
  });
}

/** A label as an animal of her answer: { name, scientific?, rank?, count? }. */
export function animalOf(l) {
  const a = { name: l.rank ? (l.common || l.scientific) : (l.common || l.scientific) };
  if (l.rank) { a.scientific = l.scientific; a.rank = l.rank; }
  if (l.count > 1) a.count = l.count;
  return a;
}

/** "4 Mallard", "4 x Mallard", "4× Mallard" -> { count: 4, name: 'Mallard' }; else { count: 0, name }. */
export function parseNameText(text) {
  const m = /^\s*(\d{1,4})\s*[x×]?\s+(\S.*)$/i.exec(String(text || ''));
  if (m && Number(m[1]) > 0) return { count: Number(m[1]), name: m[2].trim() };
  return { count: 0, name: String(text || '').trim() };
}

/** The text a label is edited as: its name, the count first when more than one ("4 Mallard"). */
export function editText(l, text) {
  return l && l.count > 1 ? `${l.count} ${text}` : text;
}

/**
 * The animal a commit names: a suggestion's entry (nameIndex), else the
 * typed text when the lists know it (find), else her own words. `count` 0
 * keeps `keepCount`.
 */
export function animalFromText({ entry = null, text = '', index = null, keepCount = 0 }) {
  const { count, name } = parseNameText(text);
  const e = entry || (index && name ? index.find(name) : null);
  const n = count || keepCount;
  if (!e && !name) return null;
  const a = e ? { name: e.common || e.scientific, scientific: e.scientific, rank: e.rank } : { name };
  if (n > 1) a.count = n;
  return a;
}

/** What a suggestion says under its name: the scientific name of a species, the rank of a group. */
export function suggestionDetail(e) {
  return e.rank === 'species' ? e.scientific : RANK_TITLES[e.rank] || '';
}

const ARACHNIDS = new Set(['arachnida', 'araneae']);

/**
 * Whether a name is a spider or another arachnid (class Arachnida): by its
 * own name, its lineage in the lists (index: nameIndex), or her own words.
 * Jennie dislikes spiders: nothing that brings photos to her attention
 * (the next photo to check) ever lands on one.
 */
export function isArachnid(l, index = null) {
  if (!l) return false;
  if (ARACHNIDS.has(fold(l.scientific)) || ARACHNIDS.has(fold(l.common))) return true;
  const e = index && l.scientific ? index.find(l.scientific) : null;
  if (e && e.lineage && (e.lineage.class === 'Arachnida' || e.lineage.order === 'Araneae')) return true;
  if (e && (e.scientific === 'Arachnida' || e.scientific === 'Araneae')) return true;
  return /\b(spiders?|arachnids?|orb ?weavers?|tarantulas?|ticks?|mites?|harvestmen)\b/i.test(String(l.common || ''));
}

/** Whether a record's own crops lean to an arachnid (a spider box, or a crop whose best guess is one). */
export function recordHasArachnid(rec) {
  if (!rec || rec.error) return false;
  if ((rec.detections || []).some((d) => d.label === 'a spider')) return true;
  return (rec.animals || []).some((a) => {
    const top = a.species && a.species[0];
    return !!top && (top.class === 'Arachnida' || top.order === 'Araneae');
  });
}
