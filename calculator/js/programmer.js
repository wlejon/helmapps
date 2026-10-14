/**
 * Programmer calculator mode: 64-bit integer arithmetic via BigInt,
 * word widths (QWORD, DWORD, WORD, BYTE), signed/unsigned two's complement,
 * multi-base conversion (HEX, DEC, OCT, BIN), bitwise operations, and bit grid helpers.
 */

export const WORD_SIZES = {
  QWORD: 64,
  DWORD: 32,
  WORD: 16,
  BYTE: 8,
};

export const BASES = {
  HEX: 16,
  DEC: 10,
  OCT: 8,
  BIN: 2,
};

const KEYWORDS = new Set([
  'AND', 'OR', 'XOR', 'NOT', 'NAND', 'NOR',
  'LSH', 'RSH', 'ROL', 'ROR', 'MOD', 'ANS',
]);

class ProgError extends Error {
  constructor(message, pos = 0) {
    super(message);
    this.pos = pos;
  }
}

export function wordBits(wordSize = 'QWORD') {
  return WORD_SIZES[wordSize] || 64;
}

export function wordMask(wordSize = 'QWORD') {
  const b = BigInt(wordBits(wordSize));
  return (1n << b) - 1n;
}

/**
 * Return the unsigned representation of val within wordSize (0 .. 2^bits - 1).
 */
export function unsignedWord(val, wordSize = 'QWORD') {
  const mask = wordMask(wordSize);
  return BigInt(val ?? 0) & mask;
}

/**
 * Clamp/wrap a BigInt value to the active wordSize and signedness (two's complement).
 */
export function maskWord(val, wordSize = 'QWORD', signed = true) {
  const bits = BigInt(wordBits(wordSize));
  const mask = (1n << bits) - 1n;
  const u = BigInt(val ?? 0) & mask;
  if (!signed) return u;
  const signBit = 1n << (bits - 1n);
  return (u & signBit) !== 0n ? u - (1n << bits) : u;
}

/**
 * Toggle bit `bitIndex` (0..63) of `val` within the active wordSize.
 */
export function toggleBitVal(val, bitIndex, wordSize = 'QWORD', signed = true) {
  const bits = wordBits(wordSize);
  if (bitIndex < 0 || bitIndex >= bits) {
    return maskWord(val, wordSize, signed);
  }
  const next = BigInt(val ?? 0) ^ (1n << BigInt(bitIndex));
  return maskWord(next, wordSize, signed);
}

/**
 * Read bit `bitIndex` (0..63) of `val` as 0 or 1.
 */
export function getBit(val, bitIndex, wordSize = 'QWORD') {
  const bits = wordBits(wordSize);
  if (bitIndex < 0 || bitIndex >= bits) return 0;
  const u = unsignedWord(val, wordSize);
  return Number((u >> BigInt(bitIndex)) & 1n);
}

/**
 * Return an array of 64 bits (index 0 = LSB, index 63 = MSB).
 */
export function getBitArray(val, wordSize = 'QWORD') {
  const out = new Array(64);
  const bits = wordBits(wordSize);
  const u = unsignedWord(val, wordSize);
  for (let i = 0; i < 64; i++) {
    out[i] = i < bits ? Number((u >> BigInt(i)) & 1n) : 0;
  }
  return out;
}

/**
 * Format a BigInt value in the requested base ('HEX' | 'DEC' | 'OCT' | 'BIN').
 * HEX, OCT, BIN use the unsigned two's complement representation for the active wordSize.
 * DEC uses the signed/unsigned value according to `signed`.
 */
export function formatBase(val, base = 'DEC', { wordSize = 'QWORD', signed = true, group = false } = {}) {
  const bName = String(base).toUpperCase();
  if (bName === 'DEC') {
    const m = maskWord(val, wordSize, signed);
    const s = m.toString(10);
    if (!group) return s;
    const neg = s.startsWith('-');
    const digits = neg ? s.slice(1) : s;
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return neg ? `-${grouped}` : grouped;
  }
  const u = unsignedWord(val, wordSize);
  if (bName === 'HEX') {
    const s = u.toString(16).toUpperCase();
    return group ? s.replace(/\B(?=(.{4})+(?!.))/g, ' ') : s;
  }
  if (bName === 'OCT') {
    const s = u.toString(8);
    return group ? s.replace(/\B(?=(.{3})+(?!.))/g, ' ') : s;
  }
  if (bName === 'BIN') {
    const s = u.toString(2);
    return group ? s.replace(/\B(?=(.{4})+(?!.))/g, ' ') : s;
  }
  return maskWord(val, wordSize, signed).toString(10);
}

/**
 * Format a BigInt value across all four bases at once.
 */
export function formatAllBases(val, { wordSize = 'QWORD', signed = true, group = false } = {}) {
  return {
    HEX: formatBase(val, 'HEX', { wordSize, signed, group }),
    DEC: formatBase(val, 'DEC', { wordSize, signed, group }),
    OCT: formatBase(val, 'OCT', { wordSize, signed, group }),
    BIN: formatBase(val, 'BIN', { wordSize, signed, group }),
  };
}

function parseLiteralInBase(raw, activeBase, pos) {
  const clean = raw.replace(/_/g, '');
  if (!clean) throw new ProgError(`Syntax error at ${pos}`, pos);

  if (/^0[xX][0-9a-fA-F]+$/.test(clean)) {
    return BigInt(clean);
  }
  if (/^0[bB][01]+$/.test(clean)) {
    return BigInt(clean);
  }
  if (/^0[oO][0-7]+$/.test(clean)) {
    return BigInt(clean);
  }

  const radix = BASES[String(activeBase).toUpperCase()] || 10;
  const patterns = {
    16: /^[0-9a-fA-F]+$/,
    10: /^[0-9]+$/,
    8: /^[0-7]+$/,
    2: /^[01]+$/,
  };
  if (!patterns[radix].test(clean)) {
    throw new ProgError(`Syntax error at ${pos}`, pos);
  }
  if (radix === 16) return BigInt(`0x${clean}`);
  if (radix === 8) return BigInt(`0o${clean}`);
  if (radix === 2) return BigInt(`0b${clean}`);
  return BigInt(clean);
}

export function tokenizeProgrammer(input, activeBase = 'DEC') {
  const src = String(input ?? '');
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (src.slice(i, i + 2) === '<<') {
      tokens.push({ type: 'op', value: 'LSH', pos: i + 1 });
      i += 2;
      continue;
    }
    if (src.slice(i, i + 2) === '>>') {
      tokens.push({ type: 'op', value: 'RSH', pos: i + 1 });
      i += 2;
      continue;
    }

    if (/[0-9a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < src.length && /[0-9a-zA-Z_]/.test(src[i])) i++;
      const word = src.slice(start, i);
      const upper = word.toUpperCase();
      if (KEYWORDS.has(upper)) {
        if (upper === 'ANS') {
          tokens.push({ type: 'ans', value: 'ANS', pos: start + 1 });
        } else {
          tokens.push({ type: 'op', value: upper, pos: start + 1 });
        }
      } else {
        const val = parseLiteralInBase(word, activeBase, start + 1);
        tokens.push({ type: 'num', value: val, raw: word, pos: start + 1 });
      }
      continue;
    }

    if ('+-*/×÷%~&|^()'.includes(ch)) {
      const map = {
        '×': '*',
        '÷': '/',
        '%': 'MOD',
        '~': 'NOT',
        '&': 'AND',
        '|': 'OR',
        '^': 'XOR',
      };
      tokens.push({ type: 'op', value: map[ch] || ch, pos: i + 1 });
      i++;
      continue;
    }

    throw new ProgError(`Syntax error at ${i + 1}`, i + 1);
  }

  return tokens;
}

/**
 * Evaluate a programmer expression using 64-bit (or narrower wordSize) BigInt math.
 */
export function evaluateProgrammer(src, options = {}) {
  const activeBase = String(options.base || 'DEC').toUpperCase();
  const wordSize = String(options.wordSize || 'QWORD').toUpperCase();
  const signed = options.signed !== false;
  const ansVal = maskWord(options.ans ?? 0n, wordSize, signed);
  const bits = BigInt(wordBits(wordSize));
  const mask = wordMask(wordSize);

  const str = String(src ?? '').trim();
  if (!str) {
    return {
      ok: false,
      value: 0n,
      number: 0,
      formatted: '',
      bases: formatAllBases(0n, { wordSize, signed }),
      error: 'Empty expression',
    };
  }

  let tokens;
  try {
    tokens = tokenizeProgrammer(str, activeBase);
  } catch (err) {
    const msg = err instanceof ProgError ? err.message : 'Syntax error at 1';
    return {
      ok: false,
      value: null,
      number: null,
      formatted: msg,
      bases: null,
      error: msg,
    };
  }

  if (tokens.length === 0) {
    return {
      ok: false,
      value: 0n,
      number: 0,
      formatted: '',
      bases: formatAllBases(0n, { wordSize, signed }),
      error: 'Empty expression',
    };
  }

  let pos = 0;
  const peek = () => tokens[pos] || null;
  const next = () => tokens[pos++] || null;
  const endPos = () => (tokens.length ? tokens[tokens.length - 1].pos + 1 : 1);
  const clamp = (v) => maskWord(v, wordSize, signed);

  function parseAtom() {
    const tk = peek();
    if (!tk) throw new ProgError(`Syntax error at ${endPos()}`, endPos());
    if (tk.type === 'num') {
      next();
      return clamp(tk.value);
    }
    if (tk.type === 'ans') {
      next();
      return ansVal;
    }
    if (tk.type === 'op' && tk.value === '(') {
      next();
      if (peek() && peek().type === 'op' && peek().value === ')') {
        throw new ProgError(`Syntax error at ${peek().pos}`, peek().pos);
      }
      const v = parseOr();
      const close = peek();
      if (!close || close.type !== 'op' || close.value !== ')') {
        throw new ProgError(`Syntax error at ${close ? close.pos : endPos()}`, close ? close.pos : endPos());
      }
      next();
      return clamp(v);
    }
    throw new ProgError(`Syntax error at ${tk.pos}`, tk.pos);
  }

  function parseUnary() {
    const tk = peek();
    if (tk && tk.type === 'op') {
      if (tk.value === '-') {
        next();
        return clamp(-parseUnary());
      }
      if (tk.value === '+') {
        next();
        return clamp(parseUnary());
      }
      if (tk.value === 'NOT') {
        next();
        return clamp(~parseUnary());
      }
    }
    return parseAtom();
  }

  function parseMul() {
    let left = parseUnary();
    while (peek() && peek().type === 'op' && ['*', '/', 'MOD'].includes(peek().value)) {
      const op = next();
      const right = parseUnary();
      if (op.value === '*') {
        left = clamp(left * right);
      } else if (op.value === '/') {
        if (right === 0n) throw new ProgError("Can't divide by zero", op.pos);
        left = clamp(left / right);
      } else {
        if (right === 0n) throw new ProgError("Can't divide by zero", op.pos);
        left = clamp(left % right);
      }
    }
    return left;
  }

  function parseAdd() {
    let left = parseMul();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const right = parseMul();
      left = clamp(op === '+' ? left + right : left - right);
    }
    return left;
  }

  function parseShift() {
    let left = parseAdd();
    while (peek() && peek().type === 'op' && ['LSH', 'RSH', 'ROL', 'ROR'].includes(peek().value)) {
      const op = next().value;
      const right = parseAdd();
      if (op === 'LSH') {
        const s = right < 0n ? 0n : right;
        left = s >= bits ? 0n : clamp(left << s);
      } else if (op === 'RSH') {
        const s = right < 0n ? 0n : right;
        if (!signed) {
          left = s >= bits ? 0n : clamp((left & mask) >> s);
        } else {
          left = s >= bits ? (left < 0n ? -1n : 0n) : clamp(left >> s);
        }
      } else if (op === 'ROL') {
        const u = left & mask;
        const s = ((right % bits) + bits) % bits;
        const rot = s === 0n ? u : ((u << s) | (u >> (bits - s))) & mask;
        left = clamp(rot);
      } else if (op === 'ROR') {
        const u = left & mask;
        const s = ((right % bits) + bits) % bits;
        const rot = s === 0n ? u : ((u >> s) | (u << (bits - s))) & mask;
        left = clamp(rot);
      }
    }
    return left;
  }

  function parseAnd() {
    let left = parseShift();
    while (peek() && peek().type === 'op' && (peek().value === 'AND' || peek().value === 'NAND')) {
      const op = next().value;
      const right = parseShift();
      left = clamp(op === 'AND' ? (left & right) : ~(left & right));
    }
    return left;
  }

  function parseXor() {
    let left = parseAnd();
    while (peek() && peek().type === 'op' && peek().value === 'XOR') {
      next();
      const right = parseAnd();
      left = clamp(left ^ right);
    }
    return left;
  }

  function parseOr() {
    let left = parseXor();
    while (peek() && peek().type === 'op' && (peek().value === 'OR' || peek().value === 'NOR')) {
      const op = next().value;
      const right = parseXor();
      left = clamp(op === 'OR' ? (left | right) : ~(left | right));
    }
    return left;
  }

  try {
    const val = parseOr();
    if (pos < tokens.length) {
      throw new ProgError(`Syntax error at ${tokens[pos].pos}`, tokens[pos].pos);
    }
    const bases = formatAllBases(val, { wordSize, signed });
    const formatted = bases[activeBase] || bases.DEC;
    return {
      ok: true,
      value: val,
      number: Number(val),
      formatted,
      display: formatBase(val, activeBase, { wordSize, signed, group: true }),
      bases,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof ProgError ? err.message : `Syntax error at ${endPos()}`;
    return {
      ok: false,
      value: null,
      number: null,
      formatted: msg,
      display: msg,
      bases: null,
      error: msg,
    };
  }
}
