/**
 * Acceptance test 1 & 2: Expression evaluator table (70+ cases) and precision/formatting.
 */

import { eq } from '/lib/test.js';
import { evaluate, formatResult, formatDisplayNumber } from '../js/eval.js';

const TABLE = [
  // Basic arithmetic & precedence
  { expr: '1+1', val: 2 },
  { expr: '12+30', val: 42 },
  { expr: '50-18', val: 32 },
  { expr: '6*7', val: 42 },
  { expr: '6×7', val: 42 },
  { expr: '84/2', val: 42 },
  { expr: '84÷2', val: 42 },
  { expr: '2+3*4', val: 14 },
  { expr: '2+3×4', val: 14 },
  { expr: '(2+3)*4', val: 20 },
  { expr: '(2+3)×4', val: 20 },
  { expr: '20-12/3', val: 16 },
  { expr: '(20-12)/4', val: 2 },
  { expr: '100/5/4', val: 5 },
  { expr: '10-3-2', val: 5 },
  { expr: '((1+2)*(3+4))+5', val: 26 },

  // Power & right-associativity & unary minus
  { expr: '2^10', val: 1024 },
  { expr: '2^3^2', val: 512 },
  { expr: '-2^2', val: -4 },
  { expr: '(-2)^2', val: 4 },
  { expr: '(-2)^3', val: -8 },
  { expr: '2^-3', val: 0.125 },
  { expr: '-2^-2', val: -0.25 },
  { expr: '+5 + -3', val: 2 },
  { expr: '--7', val: 7 },
  { expr: '9^0.5', val: 3 },

  // Implicit multiplication
  { expr: '3(4+5)', val: 27 },
  { expr: '(2)(3)', val: 6 },
  { expr: '(1+2)(3+4)', val: 21 },
  { expr: '2sqrt(9)', val: 6 },
  { expr: '2π', val: Number((2 * Math.PI).toPrecision(12)) },
  { expr: '2pi', val: Number((2 * Math.PI).toPrecision(12)) },
  { expr: '3e', val: Number((3 * Math.E).toPrecision(12)) },
  { expr: '2sin(30)', opts: { angleUnit: 'deg' }, val: 1 },

  // Trig in degrees
  { expr: 'sin(0)', opts: { angleUnit: 'deg' }, val: 0 },
  { expr: 'sin(30)', opts: { angleUnit: 'deg' }, val: 0.5 },
  { expr: 'sin(90)', opts: { angleUnit: 'deg' }, val: 1 },
  { expr: 'sin(180)', opts: { angleUnit: 'deg' }, val: 0 },
  { expr: 'sin(270)', opts: { angleUnit: 'deg' }, val: -1 },
  { expr: 'cos(0)', opts: { angleUnit: 'deg' }, val: 1 },
  { expr: 'cos(60)', opts: { angleUnit: 'deg' }, val: 0.5 },
  { expr: 'cos(90)', opts: { angleUnit: 'deg' }, val: 0 },
  { expr: 'cos(180)', opts: { angleUnit: 'deg' }, val: -1 },
  { expr: 'tan(0)', opts: { angleUnit: 'deg' }, val: 0 },
  { expr: 'tan(45)', opts: { angleUnit: 'deg' }, val: 1 },
  { expr: 'asin(0.5)', opts: { angleUnit: 'deg' }, val: 30 },
  { expr: 'acos(0.5)', opts: { angleUnit: 'deg' }, val: 60 },
  { expr: 'atan(1)', opts: { angleUnit: 'deg' }, val: 45 },

  // Trig in radians
  { expr: 'sin(0)', opts: { angleUnit: 'rad' }, val: 0 },
  { expr: 'sin(pi/2)', opts: { angleUnit: 'rad' }, val: 1 },
  { expr: 'sin(π)', opts: { angleUnit: 'rad' }, val: 0 },
  { expr: 'cos(0)', opts: { angleUnit: 'rad' }, val: 1 },
  { expr: 'cos(pi/2)', opts: { angleUnit: 'rad' }, val: 0 },
  { expr: 'cos(pi)', opts: { angleUnit: 'rad' }, val: -1 },
  { expr: 'tan(pi/4)', opts: { angleUnit: 'rad' }, val: 1 },
  { expr: 'asin(1)', opts: { angleUnit: 'rad' }, val: Number((Math.PI / 2).toPrecision(12)) },

  // Hyperbolic, logarithmic, roots, rounding
  { expr: 'sinh(0)', val: 0 },
  { expr: 'cosh(0)', val: 1 },
  { expr: 'tanh(0)', val: 0 },
  { expr: 'ln(e)', val: 1 },
  { expr: 'ln(1)', val: 0 },
  { expr: 'log(1000)', val: 3 },
  { expr: 'log(0.01)', val: -2 },
  { expr: 'log2(8)', val: 3 },
  { expr: 'log2(1024)', val: 10 },
  { expr: 'sqrt(16)', val: 4 },
  { expr: '√81', val: 9 },
  { expr: 'cbrt(27)', val: 3 },
  { expr: 'cbrt(-8)', val: -2 },
  { expr: 'abs(-7)', val: 7 },
  { expr: 'abs(7)', val: 7 },
  { expr: 'floor(3.7)', val: 3 },
  { expr: 'floor(-1.2)', val: -2 },
  { expr: 'ceil(3.2)', val: 4 },
  { expr: 'round(3.5)', val: 4 },
  { expr: 'round(3.4)', val: 3 },
  { expr: 'exp(0)', val: 1 },
  { expr: 'sqr(9)', val: 81 },
  { expr: 'inv(4)', val: 0.25 },

  // Factorial, modulo, percent, ans
  { expr: '0!', val: 1 },
  { expr: '1!', val: 1 },
  { expr: '5!', val: 120 },
  { expr: '3!+2', val: 8 },
  { expr: '-3!', val: -6 },
  { expr: '(2+3)!', val: 120 },
  { expr: '10%3', val: 1 },
  { expr: '17 mod 5', val: 2 },
  { expr: '50%', val: 0.5 },
  { expr: '200*15%', val: 30 },
  { expr: 'ans+5', opts: { ans: 37 }, val: 42 },
  { expr: '2ans', opts: { ans: 21 }, val: 42 },
];

assert(TABLE.length >= 65, `table has at least 65 cases (${TABLE.length})`);

for (const tc of TABLE) {
  const res = evaluate(tc.expr, tc.opts || {});
  assert(res.ok, `${tc.expr} should succeed, got error: ${res.error}`);
  eq(res.value, tc.val, `evaluate(${tc.expr})`);
}

// Precision & formatting checks
const p1 = evaluate('0.1+0.2');
assert(p1.ok, '0.1+0.2 ok');
eq(p1.formatted, '0.3', '0.1+0.2 displays 0.3');
eq(p1.display, '0.3', '0.1+0.2 display 0.3');

const p2 = evaluate('1e21');
assert(p2.ok, '1e21 ok');
assert(p2.formatted.includes('e'), `1e21 uses exponent notation: ${p2.formatted}`);
eq(p2.formatted, '1e+21', '1e21 formatted as 1e+21');

const p3 = evaluate('1e-12');
assert(p3.ok, '1e-12 ok');
eq(p3.formatted, '1e-12', '1e-12 formatted with exponent');

eq(formatDisplayNumber(1234567.89), '1,234,567.89', 'thousands separators in display only');
eq(formatResult(1234567.89, { group: false }), '1234567.89', 'raw formatResult has no commas');

// Structured error cases (never thrown)
const ERRORS = [
  { expr: '1/0', want: "Can't divide by zero" },
  { expr: '5%0', want: "Can't divide by zero" },
  { expr: 'inv(0)', want: "Can't divide by zero" },
  { expr: '2+', wantPrefix: 'Syntax error at' },
  { expr: '(1', wantPrefix: 'Syntax error at' },
  { expr: '*3', wantPrefix: 'Syntax error at' },
  { expr: '2+*3', wantPrefix: 'Syntax error at' },
  { expr: '()', wantPrefix: 'Syntax error at' },
  { expr: '(-1)!', want: 'Domain error' },
  { expr: '2.5!', want: 'Domain error' },
  { expr: 'sqrt(-4)', want: 'Domain error' },
  { expr: 'ln(0)', want: 'Domain error' },
  { expr: 'tan(90)', opts: { angleUnit: 'deg' }, want: 'Undefined' },
];

for (const ec of ERRORS) {
  const res = evaluate(ec.expr, ec.opts || {});
  assert(!res.ok, `${ec.expr} should return error`);
  if (ec.want) {
    eq(res.error, ec.want, `error for ${ec.expr}`);
  } else {
    assert(
      res.error && res.error.startsWith(ec.wantPrefix),
      `error for ${ec.expr}: got "${res.error}", expected prefix "${ec.wantPrefix}"`
    );
  }
}

console.log(`test_parser PASSED (${TABLE.length} valid + ${ERRORS.length} error cases)`);
