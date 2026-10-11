// Fuzzy matching for the command palette: every query character must appear
// in order. Matches at word starts, consecutive runs and an early first match
// score higher; the matched positions come back for highlighting.

function isWordStart(text, i) {
    if (i === 0) return true;
    const prev = text[i - 1];
    const cur = text[i];
    return prev === ' ' || prev === ':' || prev === '-' || prev === '_' || prev === '/' || prev === '.' ||
        (prev === prev.toLowerCase() && cur !== cur.toLowerCase());
}

/// Score `text` against `query`. Returns { score, positions } or null.
export function fuzzyMatch(query, text) {
    const q = query.trim().toLowerCase();
    if (!q) return { score: 0, positions: [] };
    const t = text.toLowerCase();
    // Best of: greedy from each occurrence of the first character.
    let best = null;
    for (let start = t.indexOf(q[0]); start !== -1; start = t.indexOf(q[0], start + 1)) {
        const positions = [];
        let ti = start;
        let score = 0;
        let prev = -2;
        let ok = true;
        for (let qi = 0; qi < q.length; qi++) {
            const c = q[qi];
            if (c === ' ') { continue; }
            const nextPlain = t.indexOf(c, ti);
            if (nextPlain === -1) { ok = false; break; }
            // Continue a run if we can, else prefer the next word start.
            let found = nextPlain;
            if (nextPlain !== prev + 1) {
                for (let j = nextPlain; j < t.length; j++) {
                    if (t[j] === c && isWordStart(text, j)) { found = j; break; }
                }
            }
            score += 1;
            if (found === prev + 1) score += 5;
            if (isWordStart(text, found)) score += 8;
            positions.push(found);
            prev = found;
            ti = found + 1;
        }
        if (!ok) continue;
        score -= start * 0.2;
        score -= (t.length - q.length) * 0.02;
        if (t.startsWith(q)) score += 20;
        if (!best || score > best.score) best = { score, positions };
    }
    return best;
}

/// Filter and sort `items` by `key(item)` against `query`.
export function fuzzyFilter(query, items, key) {
    if (!query || !query.trim()) return items.map((item) => ({ item, score: 0, positions: [] }));
    const out = [];
    for (const item of items) {
        const m = fuzzyMatch(query, key(item));
        if (m) out.push({ item, score: m.score, positions: m.positions });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
}
