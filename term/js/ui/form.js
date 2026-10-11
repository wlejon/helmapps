// Small form builders for the settings UI. Every control commits on
// `change` (Enter or leaving the field), never per keystroke: each commit is
// a write of settings.json.

export function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

/// A labelled row: label on the left, control on the right, help under it.
export function row(label, control, help) {
    const r = el('div', 'form-row');
    const l = el('label', 'form-label', label);
    r.appendChild(l);
    const c = el('div', 'form-control');
    c.appendChild(control);
    if (help) c.appendChild(el('div', 'form-help', help));
    r.appendChild(c);
    return r;
}

export function select(options, value, onChange, id) {
    const s = el('select', 'input');
    if (id) s.id = id;
    for (const o of options) {
        const opt = el('option', null, typeof o === 'string' ? o : o.label);
        opt.value = typeof o === 'string' ? o : o.value;
        s.appendChild(opt);
    }
    s.value = value == null ? '' : String(value);
    s.addEventListener('change', () => onChange(s.value));
    return s;
}

export function text(value, onChange, o) {
    const i = el('input', 'input');
    i.type = 'text';
    if (o && o.id) i.id = o.id;
    if (o && o.placeholder) i.placeholder = o.placeholder;
    i.value = value == null ? '' : String(value);
    i.addEventListener('change', () => onChange(i.value));
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') onChange(i.value); });
    return i;
}

export function number(value, onChange, o) {
    const i = el('input', 'input number');
    i.type = 'number';
    if (o && o.id) i.id = o.id;
    if (o && o.min !== undefined) i.min = String(o.min);
    if (o && o.max !== undefined) i.max = String(o.max);
    if (o && o.step !== undefined) i.step = String(o.step);
    i.value = value == null ? '' : String(value);
    const commit = () => {
        const n = Number(i.value);
        if (i.value.trim() === '') onChange(undefined);
        else if (Number.isFinite(n)) onChange(n);
    };
    i.addEventListener('change', commit);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    return i;
}

export function checkbox(value, onChange, id) {
    const wrap = el('label', 'check');
    const c = el('input');
    c.type = 'checkbox';
    if (id) c.id = id;
    c.checked = !!value;
    c.addEventListener('change', () => onChange(!!c.checked));
    wrap.appendChild(c);
    return wrap;
}

export function textarea(value, onChange, o) {
    const t = el('textarea', 'input area');
    if (o && o.id) t.id = o.id;
    if (o && o.rows) t.rows = o.rows;
    if (o && o.placeholder) t.placeholder = o.placeholder;
    t.value = value == null ? '' : String(value);
    t.addEventListener('change', () => onChange(t.value));
    return t;
}

export function button(label, onClick, cls) {
    const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
    b.addEventListener('click', onClick);
    return b;
}

export function section(title, intro) {
    const s = el('section', 'settings-section');
    s.appendChild(el('h2', 'settings-heading', title));
    if (intro) s.appendChild(el('p', 'settings-intro', intro));
    return s;
}

/// Arguments as a person types them: space-separated, "double quotes" group.
export function parseArgsLine(line) {
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
    let m;
    while ((m = re.exec(line || ''))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
    return out;
}

export function formatArgsLine(args) {
    return (args || []).map((a) => (/[\s"]/.test(a) || a === '' ? '"' + a.replace(/(["\\])/g, '\\$1') + '"' : a)).join(' ');
}

/// KEY=VALUE lines <-> an object.
export function parseEnvLines(textValue) {
    const out = {};
    for (const line of String(textValue || '').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1);
    }
    return out;
}

export function formatEnvLines(env) {
    return Object.entries(env || {}).map(([k, v]) => k + '=' + v).join('\n');
}
