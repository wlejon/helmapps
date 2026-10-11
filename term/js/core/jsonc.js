// JSON with comments and trailing commas, the dialect settings files are
// written in (VS Code, Windows Terminal). Comments and trailing commas are
// blanked out with the same number of characters, so a JSON.parse error
// position still points at the right place in the original text.

export function stripJsonc(text) {
    let out = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === '"') {
            const start = i++;
            while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
            i++;
            out += text.slice(start, i);
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') { out += ' '; i++; }
        } else if (c === '/' && text[i + 1] === '*') {
            out += '  ';
            i += 2;
            while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
            out += '  ';
            i += 2;
        } else {
            out += c;
            i++;
        }
    }
    return blankTrailingCommas(out);
}

// A comma followed only by whitespace before } or ], outside strings.
function blankTrailingCommas(text) {
    let out = '';
    const n = text.length;
    for (let i = 0; i < n; i++) {
        const c = text[i];
        if (c === '"') {
            const start = i++;
            while (i < n && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
            out += text.slice(start, i + 1);
            continue;
        }
        if (c === ',') {
            let j = i + 1;
            while (j < n && /\s/.test(text[j])) j++;
            if (text[j] === '}' || text[j] === ']') { out += ' '; continue; }
        }
        out += c;
    }
    return out;
}

/// Parse JSONC. Throws an Error whose message names the line and column.
export function parseJsonc(text) {
    const clean = stripJsonc(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    if (!clean.trim()) return {};
    try {
        return JSON.parse(clean);
    } catch (e) {
        const m = /position (\d+)/.exec(e.message || '');
        if (m) {
            const pos = Number(m[1]);
            const before = clean.slice(0, pos);
            const line = before.split('\n').length;
            const col = pos - before.lastIndexOf('\n');
            throw new Error(e.message + ' (line ' + line + ', column ' + col + ')');
        }
        throw e;
    }
}
