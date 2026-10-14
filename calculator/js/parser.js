/**
 * Mathematical expression tokenizer, precedence-climbing / recursive-descent
 * parser, evaluator, and number formatter.
 * Pure module with zero DOM dependencies and no eval() / Function().
 */

const CONSTANTS = {
  pi: Math.PI,
  'π': Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
};

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan',
  'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh',
  'ln', 'log', 'log10', 'log2',
  'sqrt', 'cbrt', 'abs',
  'round', 'floor', 'ceil',
  'exp', 'sqr', 'inv', 'fact',
]);

class EvalError extends Error {
  constructor(message, pos = 0) {
    super(message);
    this.pos = pos;
  }
}

function syntaxError(pos) {
  return new EvalError(`Syntax error at ${pos}`, pos);
}

/**
 * Compute n! for non-negative integers up to 170.
 */
export function factorial(n) {
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new EvalError('Domain error');
  }
  if (n > 170) {
    throw new EvalError('Overflow');
  }
  let acc = 1;
  for (let i = 2; i <= n; i++) acc *= i;
  return acc;
}

/**
 * Clean floating-point noise to 12 significant digits.
 */
export function cleanNumber(val) {
  if (!Number.isFinite(val)) return val;
  if (val === 0) return 0;
  return Number(val.toPrecision(12));
}

/**
 * Format a numeric result to 12 significant digits, using exponential
 * notation for |val| >= 1e15 or (0 < |val| < 1e-9).
 */
export function formatResult(val, { group = false } = {}) {
  if (typeof val === 'string') return val;
  if (val == null || Number.isNaN(val)) return 'Error';
  if (!Number.isFinite(val)) return 'Overflow';
  if (val === 0) return '0';

  const cleaned = cleanNumber(val);
  if (cleaned === 0) return '0';

  const abs = Math.abs(cleaned);
  if (abs >= 1e15 || (abs > 0 && abs < 1e-9)) {
    return cleaned.toExponential();
  }

  const str = String(cleaned);
  if (!group || str.includes('e') || str.includes('E')) {
    return str;
  }

  const [intPart, fracPart] = str.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const digits = sign ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart !== undefined ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`;
}

/**
 * Format a number with thousands separators for the main display.
 */
export function formatDisplayNumber(val) {
  return formatResult(val, { group: true });
}

/**
 * Tokenize a mathematical expression string.
 * Returns { ok: true, tokens } or { ok: false, error }.
 */
export function tokenize(input) {
  const src = String(input ?? '');
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Number literal: digits, optional decimal point, optional scientific exponent
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const start = i;
      let hasDot = false;
      while (i < src.length && (/[0-9_]/.test(src[i]) || src[i] === '.')) {
        if (src[i] === '.') {
          if (hasDot) return { ok: false, error: `Syntax error at ${i + 1}`, pos: i + 1 };
          hasDot = true;
        }
        i++;
      }
      // Check scientific notation e.g. 1e21, 2.5e-4, 1E+6 (only when followed by digit or +/-digit)
      if (i < src.length && (src[i] === 'e' || src[i] === 'E')) {
        const next = src[i + 1] || '';
        const next2 = src[i + 2] || '';
        if (/[0-9]/.test(next) || ((next === '+' || next === '-') && /[0-9]/.test(next2))) {
          i++; // eat e/E
          if (src[i] === '+' || src[i] === '-') i++;
          while (i < src.length && /[0-9_]/.test(src[i])) i++;
        }
      }
      const raw = src.slice(start, i).replace(/_/g, '');
      const num = Number(raw);
      if (Number.isNaN(num)) {
        return { ok: false, error: `Syntax error at ${start + 1}`, pos: start + 1 };
      }
      tokens.push({ type: 'num', value: num, raw, pos: start + 1 });
      continue;
    }

    // Unicode pi or square root or superscripts
    if (ch === 'π') {
      tokens.push({ type: 'id', value: 'pi', pos: i + 1 });
      i++;
      continue;
    }
    if (ch === '√') {
      tokens.push({ type: 'op', value: '√', pos: i + 1 });
      i++;
      continue;
    }
    if (ch === '²') {
      tokens.push({ type: 'op', value: '²', pos: i + 1 });
      i++;
      continue;
    }

    // Identifier (functions and constants: sin, cos, log2, log10, pi, e, ans)
    if (/[a-zA-Z]/.test(ch)) {
      const start = i;
      while (i < src.length && /[a-zA-Z0-9]/.test(src[i])) {
        // Don't swallow trailing digits unless part of known function names like log2, log10
        if (/[0-9]/.test(src[i])) {
          const wordSoFar = src.slice(start, i).toLowerCase();
          if (wordSoFar !== 'log') break;
        }
        i++;
      }
      const id = src.slice(start, i).toLowerCase();
      if (id === 'mod') {
        tokens.push({ type: 'op', value: '%', pos: start + 1 });
      } else {
        tokens.push({ type: 'id', value: id, pos: start + 1 });
      }
      continue;
    }

    // Operators & punctuation
    if ('+-*/×÷^%!(),'.includes(ch)) {
      const norm = ch === '×' ? '*' : ch === '÷' ? '/' : ch;
      tokens.push({ type: 'op', value: norm, pos: i + 1 });
      i++;
      continue;
    }

    return { ok: false, error: `Syntax error at ${i + 1}`, pos: i + 1 };
  }

  return { ok: true, tokens };
}

function applyTrig(fn, x, angleUnit) {
  const isDeg = angleUnit === 'deg';
  if (fn === 'sin') {
    if (isDeg) {
      const m = ((x % 360) + 360) % 360;
      if (m === 0 || m === 180) return 0;
      if (m === 30 || m === 150) return 0.5;
      if (m === 210 || m === 330) return -0.5;
      if (m === 90) return 1;
      if (m === 270) return -1;
      return Math.sin((x * Math.PI) / 180);
    }
    const s = Math.sin(x);
    return Math.abs(s) < 1e-15 ? 0 : s;
  }
  if (fn === 'cos') {
    if (isDeg) {
      const m = ((x % 360) + 360) % 360;
      if (m === 90 || m === 270) return 0;
      if (m === 60 || m === 300) return 0.5;
      if (m === 120 || m === 240) return -0.5;
      if (m === 0) return 1;
      if (m === 180) return -1;
      return Math.cos((x * Math.PI) / 180);
    }
    const c = Math.cos(x);
    return Math.abs(c) < 1e-15 ? 0 : c;
  }
  if (fn === 'tan') {
    if (isDeg) {
      const m = ((x % 180) + 180) % 180;
      if (m === 90) throw new EvalError('Undefined');
      if (m === 0) return 0;
      if (m === 45) return 1;
      if (m === 135) return -1;
      return Math.tan((x * Math.PI) / 180);
    }
    const c = Math.cos(x);
    if (Math.abs(c) < 1e-15) throw new EvalError('Undefined');
    const s = Math.sin(x);
    return Math.abs(s) < 1e-15 ? 0 : s / c;
  }
  if (fn === 'asin') {
    if (x < -1 || x > 1) throw new EvalError('Domain error');
    const r = Math.asin(x);
    return isDeg ? cleanNumber((r * 180) / Math.PI) : r;
  }
  if (fn === 'acos') {
    if (x < -1 || x > 1) throw new EvalError('Domain error');
    const r = Math.acos(x);
    return isDeg ? cleanNumber((r * 180) / Math.PI) : r;
  }
  if (fn === 'atan') {
    const r = Math.atan(x);
    return isDeg ? cleanNumber((r * 180) / Math.PI) : r;
  }
  return NaN;
}

function applyFunction(fn, x, angleUnit) {
  if (['sin', 'cos', 'tan', 'asin', 'acos', 'atan'].includes(fn)) {
    return applyTrig(fn, x, angleUnit);
  }
  switch (fn) {
    case 'sinh': return Math.sinh(x);
    case 'cosh': return Math.cosh(x);
    case 'tanh': return Math.tanh(x);
    case 'asinh': return Math.asinh(x);
    case 'acosh':
      if (x < 1) throw new EvalError('Domain error');
      return Math.acosh(x);
    case 'atanh':
      if (x <= -1 || x >= 1) throw new EvalError('Domain error');
      return Math.atanh(x);
    case 'ln':
      if (x <= 0) throw new EvalError('Domain error');
      return Math.log(x);
    case 'log':
    case 'log10':
      if (x <= 0) throw new EvalError('Domain error');
      return Math.log10(x);
    case 'log2':
      if (x <= 0) throw new EvalError('Domain error');
      return Math.log2(x);
    case 'sqrt':
      if (x < 0) throw new EvalError('Domain error');
      return Math.sqrt(x);
    case 'cbrt': return Math.cbrt(x);
    case 'abs': return Math.abs(x);
    case 'round': return Math.round(x);
    case 'floor': return Math.floor(x);
    case 'ceil': return Math.ceil(x);
    case 'exp': return Math.exp(x);
    case 'sqr': return x * x;
    case 'inv':
      if (x === 0) throw new EvalError("Can't divide by zero");
      return 1 / x;
    case 'fact': return factorial(x);
    default:
      throw new EvalError(`Unknown function ${fn}`);
  }
}

/**
 * Parse and evaluate a mathematical expression string.
 * @param {string} src
 * @param {object} [options]
 * @param {'deg'|'rad'} [options.angleUnit='deg']
 * @param {number} [options.ans=0]
 * @returns {{ ok: boolean, value: number|null, raw: number|null, formatted: string, display: string, error: string|null }}
 */
export function evaluate(src, options = {}) {
  const angleUnit = options.angleUnit === 'rad' ? 'rad' : 'deg';
  const ansVal = Number(options.ans ?? 0);
  const str = String(src ?? '').trim();

  if (!str) {
    return { ok: false, value: null, raw: null, formatted: '', display: '', error: 'Empty expression' };
  }

  const tokRes = tokenize(str);
  if (!tokRes.ok) {
    return {
      ok: false,
      value: null,
      raw: null,
      formatted: tokRes.error,
      display: tokRes.error,
      error: tokRes.error,
    };
  }

  const tokens = tokRes.tokens;
  if (tokens.length === 0) {
    return { ok: false, value: null, raw: null, formatted: '', display: '', error: 'Empty expression' };
  }

  let pos = 0;
  const peek = () => tokens[pos] || null;
  const next = () => tokens[pos++] || null;
  const endPos = () => (tokens.length ? tokens[tokens.length - 1].pos + 1 : 1);

  function canStartPrimary(tk) {
    if (!tk) return false;
    if (tk.type === 'num' || tk.type === 'id') return true;
    if (tk.type === 'op' && (tk.value === '(' || tk.value === '√')) return true;
    return false;
  }

  function parseAtom() {
    const tk = peek();
    if (!tk) throw syntaxError(endPos());

    if (tk.type === 'num') {
      next();
      return tk.value;
    }

    if (tk.type === 'id') {
      next();
      if (tk.value === 'ans') return ansVal;
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, tk.value)) {
        return CONSTANTS[tk.value];
      }
      if (FUNCTIONS.has(tk.value)) {
        const open = peek();
        if (!open || open.type !== 'op' || open.value !== '(') {
          throw syntaxError(open ? open.pos : endPos());
        }
        next(); // eat '('
        if (peek() && peek().type === 'op' && peek().value === ')') {
          throw syntaxError(peek().pos);
        }
        const arg = parseExpr();
        const close = peek();
        if (!close || close.type !== 'op' || close.value !== ')') {
          throw syntaxError(close ? close.pos : endPos());
        }
        next(); // eat ')'
        return applyFunction(tk.value, arg, angleUnit);
      }
      throw syntaxError(tk.pos);
    }

    if (tk.type === 'op' && tk.value === '(') {
      next(); // eat '('
      if (peek() && peek().type === 'op' && peek().value === ')') {
        throw syntaxError(peek().pos);
      }
      const val = parseExpr();
      const close = peek();
      if (!close || close.type !== 'op' || close.value !== ')') {
        throw syntaxError(close ? close.pos : endPos());
      }
      next(); // eat ')'
      return val;
    }

    throw syntaxError(tk.pos);
  }

  function parsePostfix() {
    let val = parseAtom();
    while (peek() && peek().type === 'op') {
      const op = peek().value;
      if (op === '!') {
        next();
        val = factorial(val);
      } else if (op === '²') {
        next();
        val = val * val;
      } else if (op === '%') {
        // If % is followed by a primary starter, let parseTerm handle it as binary modulo.
        // Otherwise treat it as postfix percentage (/ 100).
        const after = tokens[pos + 1] || null;
        if (canStartPrimary(after)) break;
        next();
        val = val / 100;
      } else {
        break;
      }
    }
    return val;
  }

  // Power binds tighter than unary minus (-2^2 = -4), and is right-associative
  // with unary exponent support (2^3^2 = 512, 2^-3 = 0.125).
  function parsePower() {
    const base = parsePostfix();
    if (peek() && peek().type === 'op' && peek().value === '^') {
      next();
      const exp = parseUnary();
      const res = Math.pow(base, exp);
      if (Number.isNaN(res)) throw new EvalError('Domain error');
      return res;
    }
    return base;
  }

  function parseUnary() {
    const tk = peek();
    if (tk && tk.type === 'op') {
      if (tk.value === '-') {
        next();
        return -parseUnary();
      }
      if (tk.value === '+') {
        next();
        return +parseUnary();
      }
      if (tk.value === '√') {
        next();
        const v = parseUnary();
        if (v < 0) throw new EvalError('Domain error');
        return Math.sqrt(v);
      }
    }
    return parsePower();
  }

  function parseTerm() {
    let left = parseUnary();
    while (peek()) {
      const tk = peek();
      if (tk.type === 'op' && tk.value === '*') {
        next();
        left *= parseUnary();
      } else if (tk.type === 'op' && tk.value === '/') {
        next();
        const right = parseUnary();
        if (right === 0) throw new EvalError("Can't divide by zero", tk.pos);
        left /= right;
      } else if (tk.type === 'op' && tk.value === '%') {
        next();
        const right = parseUnary();
        if (right === 0) throw new EvalError("Can't divide by zero", tk.pos);
        left %= right;
      } else if (canStartPrimary(tk)) {
        // Implicit multiplication: 2pi, 3(4+5), (2)(3), 2sin(30)
        left *= parseUnary();
      } else {
        break;
      }
    }
    return left;
  }

  function parseExpr() {
    let left = parseTerm();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const right = parseTerm();
      if (op === '+') left += right;
      else left -= right;
    }
    return left;
  }

  try {
    const raw = parseExpr();
    if (pos < tokens.length) {
      throw syntaxError(tokens[pos].pos);
    }
    if (!Number.isFinite(raw)) {
      return {
        ok: false,
        value: null,
        raw,
        formatted: 'Overflow',
        display: 'Overflow',
        error: 'Overflow',
      };
    }
    const cleaned = cleanNumber(raw);
    const formatted = formatResult(cleaned, { group: false });
    const display = formatResult(cleaned, { group: true });
    return {
      ok: true,
      value: cleaned,
      raw,
      formatted,
      display,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof EvalError ? err.message : `Syntax error at ${endPos()}`;
    return {
      ok: false,
      value: null,
      raw: null,
      formatted: msg,
      display: msg,
      error: msg,
    };
  }
}

export { evaluate as parse };
