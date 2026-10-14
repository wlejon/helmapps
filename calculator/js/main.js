/**
 * Calculator (helm.calculator): Basic, Scientific, and Programmer calculator
 * with live evaluation, 64-bit BigInt bitwise/base panel, and persistent history tape.
 */

import { startApp } from '/lib/app.js';
import { h } from '/lib/dom.js';
import { appFrame, Toolbar, SplitPane, emptyState } from '/lib/layout.js';
import { Segmented } from '/lib/controls.js';
import { toast } from '/lib/toast.js';
import { evaluate, parse, formatResult, formatDisplayNumber } from './parser.js';
import {
  WORD_SIZES, BASES, wordBits, maskWord, toggleBitVal,
  getBitArray, formatBase, formatAllBases, evaluateProgrammer,
} from './programmer.js';
import { buildProgrammerPanel, buildKeypads } from './keypads.js';

const MAX_HISTORY = 100;

const app = startApp({
  settings: {
    mode: { type: 'string', default: 'basic' },
    angleUnit: { type: 'string', default: 'deg' },
    showHistory: { type: 'bool', default: true },
    history: { type: 'json', default: [] },
    memory: { type: 'double', default: 0 },
    wordSize: { type: 'string', default: 'QWORD' },
    signed: { type: 'bool', default: true },
    base: { type: 'string', default: 'DEC' },
  },
});

const { commands, settings } = app;

const initialHistory = Array.isArray(settings.get('history'))
  ? settings.get('history').slice(0, MAX_HISTORY) : [];

const state = {
  mode: ['basic', 'scientific', 'programmer'].includes(settings.get('mode')) ? settings.get('mode') : 'basic',
  angleUnit: settings.get('angleUnit') === 'rad' ? 'rad' : 'deg',
  showHistory: settings.get('showHistory') !== false,
  history: initialHistory,
  memory: Number(settings.get('memory') || 0),
  wordSize: WORD_SIZES[settings.get('wordSize')] ? settings.get('wordSize') : 'QWORD',
  signed: settings.get('signed') !== false,
  base: BASES[settings.get('base')] ? settings.get('base') : 'DEC',
  input: '',
  lastExpr: '',
  result: '0',
  displayResult: '0',
  error: null,
  ans: 0,
  progVal: 0n,
  bases: formatAllBases(0n, {
    wordSize: WORD_SIZES[settings.get('wordSize')] ? settings.get('wordSize') : 'QWORD',
    signed: settings.get('signed') !== false,
  }),
  committed: false,
};

// ---- the window -------------------------------------------------------------

const ui = appFrame({ toolbar: true, sidebar: false, statusbar: true });
document.body.appendChild(ui.frame);

const toolbar = new Toolbar(ui.toolbar, commands);
const statusText = h('span.grow.num');
const statusRight = h('span.dim.num');
ui.statusbar.append(statusText, statusRight);

const split = new SplitPane({ fixed: 'second', size: 250, min: 180, max: 420 });
ui.content.appendChild(split.el);

const modeBadge = h('span.badge', state.mode.toUpperCase());
const unitBadge = h('span.badge.accent', state.angleUnit.toUpperCase());
const memBadge = h('span.badge', 'M');
const exprLine = h('div.calc-expr.num', '');
const exprInput = h('input.calc-expr-input.field.num', {
  type: 'text', placeholder: '0', 'aria-label': 'Expression', spellcheck: 'false', autocomplete: 'off',
});
const resultLine = h('div.calc-result.num.selectable', '0');

const displayCard = h('div.calc-display.card',
  h('div.calc-display-meta', h('div.calc-badges', modeBadge, unitBadge, memBadge), exprLine),
  exprInput,
  resultLine);

function focusInputEnd() {
  exprInput.focus();
  const len = exprInput.value.length;
  if (typeof exprInput.setSelectionRange === 'function') exprInput.setSelectionRange(len, len);
}

const { progPanel, baseRowEls, baseValEls, bitButtons } = buildProgrammerPanel(commands);
const { keypadWrap, padBasic, padScientific, padProgrammer, progDigitButtons } = buildKeypads(commands, focusInputEnd);

const memButtons = {};
const memBar = h('div.calc-membar');
for (const [id, label, tip] of [
  ['mem-clear', 'MC', 'Memory Clear'],
  ['mem-recall', 'MR', 'Memory Recall'],
  ['mem-add', 'M+', 'Memory Add'],
  ['mem-sub', 'M-', 'Memory Subtract'],
  ['mem-store', 'MS', 'Memory Store'],
]) {
  const b = h('button.btn.ghost.small.num', {
    dataset: { mem: label }, 'data-tip': tip,
    onclick: () => { commands.run(id); focusInputEnd(); },
  }, label);
  memButtons[id] = b;
  memBar.appendChild(b);
}

split.first.appendChild(h('div.calc-main', displayCard, memBar, progPanel, keypadWrap));

const clearHistoryBtn = h('button.btn.ghost.small', {
  onclick: () => { commands.run('clear-history'); focusInputEnd(); },
}, 'Clear');
const historyHead = h('div.calc-history-head', h('span.micro', 'HISTORY'), clearHistoryBtn);
const historyEmpty = emptyState({
  icon: 'history', title: 'No history yet', hint: 'Expressions you evaluate with = or Enter appear here.',
});
const historyList = h('div.calc-history-list');
split.second.appendChild(h('div.calc-history-pane', historyHead, historyEmpty, historyList));

// ---- logic & evaluation -----------------------------------------------------

let syncingInput = false;
let lastRenderedBitsVal = null;
let lastRenderedBitsWord = '';

const isBinaryContinuation = (str) => /^\s*[+\-*/×÷^%!]/.test(str);

function evaluateLive() {
  const raw = state.input.trim();
  if (state.mode === 'programmer') {
    if (!raw) {
      state.error = null;
      state.bases = formatAllBases(state.progVal, { wordSize: state.wordSize, signed: state.signed });
      state.result = state.bases[state.base];
      state.displayResult = formatBase(state.progVal, state.base, { wordSize: state.wordSize, signed: state.signed, group: true });
      return;
    }
    const r = evaluateProgrammer(raw, { base: state.base, wordSize: state.wordSize, signed: state.signed, ans: state.progVal });
    if (r.ok) {
      state.progVal = r.value;
      state.bases = r.bases;
      state.result = r.bases[state.base];
      state.displayResult = r.display;
      state.error = null;
    } else if (r.error === "Can't divide by zero") {
      state.error = state.result = state.displayResult = r.error;
    }
    return;
  }
  if (!raw) {
    state.result = state.displayResult = '0';
    state.error = null;
    return;
  }
  const r = evaluate(raw, { angleUnit: state.angleUnit, ans: state.ans });
  if (r.ok) {
    state.result = r.formatted;
    state.displayResult = r.display;
    state.error = null;
  } else if (["Can't divide by zero", 'Undefined', 'Overflow', 'Domain error'].includes(r.error)) {
    state.error = state.result = state.displayResult = r.error;
  }
}

function syncInputBox() {
  syncingInput = true;
  if (exprInput.value !== state.input) exprInput.value = state.input;
  syncingInput = false;
}

function setInput(text, { fromCommit = false } = {}) {
  state.input = String(text ?? '');
  state.committed = fromCommit;
  syncInputBox();
  evaluateLive();
  renderDisplay();
}

function insertToken(token) {
  const tk = String(token ?? '');
  if (!tk) return;
  if (state.committed) {
    const cont = isBinaryContinuation(tk) || /^\s*(AND|OR|XOR|NAND|NOR|<<|>>|ROL|ROR|MOD)\s*$/i.test(tk);
    setInput(cont ? state.result + tk : tk, { fromCommit: false });
    return;
  }
  setInput(state.input + tk, { fromCommit: false });
}

function commit() {
  const raw = state.input.trim();
  if (!raw) return state.result;
  if (state.mode === 'programmer') {
    const r = evaluateProgrammer(raw, { base: state.base, wordSize: state.wordSize, signed: state.signed, ans: state.progVal });
    if (!r.ok) {
      state.error = state.result = state.displayResult = r.error;
      renderDisplay();
      return r.error;
    }
    state.lastExpr = raw;
    state.progVal = r.value;
    state.bases = r.bases;
    state.result = r.bases[state.base];
    state.displayResult = r.display;
    state.error = null;
    pushHistory({ expr: raw, result: state.result, display: state.displayResult, mode: 'programmer' });
    state.input = state.result;
    state.committed = true;
    syncInputBox();
    renderDisplay();
    return state.result;
  }
  const r = evaluate(raw, { angleUnit: state.angleUnit, ans: state.ans });
  if (!r.ok) {
    state.error = state.result = state.displayResult = r.error;
    renderDisplay();
    return r.error;
  }
  state.lastExpr = raw;
  state.ans = r.value;
  state.result = r.formatted;
  state.displayResult = r.display;
  state.error = null;
  pushHistory({ expr: raw, result: r.formatted, display: r.display, mode: state.mode });
  state.input = r.formatted;
  state.committed = true;
  syncInputBox();
  renderDisplay();
  return state.result;
}

function clearAll() {
  state.input = state.lastExpr = '';
  state.result = state.displayResult = '0';
  state.error = null;
  state.committed = false;
  if (state.mode === 'programmer') {
    state.progVal = 0n;
    state.bases = formatAllBases(0n, { wordSize: state.wordSize, signed: state.signed });
  }
  syncInputBox();
  renderDisplay();
}

function backspace() {
  if (state.committed) { clearAll(); return; }
  if (state.input) setInput(state.input.slice(0, -1));
}

function negate() {
  if (!state.input) {
    if (state.result && state.result !== '0' && !state.error) {
      setInput(state.result.startsWith('-') ? state.result.slice(1) : `-${state.result}`);
    } else setInput('-');
    return;
  }
  setInput(state.input.startsWith('-') ? state.input.slice(1) : `-(${state.input})`);
}

function buildHistoryItemEl(entry) {
  return h('button.calc-history-item', {
    dataset: { expr: entry.expr, result: entry.result },
    onclick: () => { state.lastExpr = entry.expr; setInput(entry.expr, { fromCommit: false }); focusInputEnd(); },
  },
  h('div.calc-history-expr.num', `${entry.expr} =`),
  h('div.calc-history-res.num', entry.display || entry.result));
}

function pushHistory(entry) {
  const wasEmpty = state.history.length === 0;
  state.history.unshift(entry);
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
  settings.set('history', state.history);
  clearHistoryBtn.disabled = false;
  if (wasEmpty) {
    historyEmpty.classList.add('hidden');
    historyList.classList.remove('hidden');
  }
  historyList.prepend(buildHistoryItemEl(entry));
  while (historyList.children.length > MAX_HISTORY) historyList.lastElementChild.remove();
}

function recallHistory(index = 0) {
  const item = state.history[index];
  if (!item) return;
  state.lastExpr = item.expr;
  setInput(item.expr, { fromCommit: false });
}

function clearHistory() {
  state.history = [];
  settings.set('history', []);
  renderHistory();
  toolbar.refresh();
}

function refreshProgReadout() {
  state.progVal = maskWord(state.progVal, state.wordSize, state.signed);
  state.bases = formatAllBases(state.progVal, { wordSize: state.wordSize, signed: state.signed });
  if (state.mode === 'programmer') {
    state.result = state.bases[state.base];
    state.displayResult = formatBase(state.progVal, state.base, { wordSize: state.wordSize, signed: state.signed, group: true });
  }
}

function setMode(mode) {
  if (!['basic', 'scientific', 'programmer'].includes(mode) || state.mode === mode) return;
  state.mode = mode;
  settings.set('mode', mode);
  modeSeg.set(mode);
  if (mode === 'programmer') {
    const n = Number(state.result);
    if (Number.isFinite(n)) state.progVal = maskWord(BigInt(Math.trunc(n)), state.wordSize, state.signed);
    refreshProgReadout();
    state.input = state.progVal === 0n ? '' : state.result;
    syncInputBox();
  } else {
    evaluateLive();
  }
  renderChrome();
  renderDisplay();
}

function setAngleUnit(unit) {
  const u = unit === 'rad' ? 'rad' : 'deg';
  if (state.angleUnit === u) return;
  state.angleUnit = u;
  settings.set('angleUnit', u);
  angleSeg.set(u);
  evaluateLive();
  renderChrome();
  renderDisplay();
}

function setWordSize(wordSize) {
  if (!WORD_SIZES[wordSize] || state.wordSize === wordSize) return;
  state.wordSize = wordSize;
  settings.set('wordSize', wordSize);
  wordSeg.set(wordSize);
  refreshProgReadout();
  renderChrome();
  renderDisplay();
}

function setSigned(signed) {
  const s = !!signed;
  if (state.signed === s) return;
  state.signed = s;
  settings.set('signed', state.signed);
  refreshProgReadout();
  renderChrome();
  renderDisplay();
}

function setBase(base) {
  const b = String(base).toUpperCase();
  if (!BASES[b] || state.base === b) return;
  state.base = b;
  settings.set('base', b);
  refreshProgReadout();
  if (state.committed || !/[+\-*/×÷&|^~<>()]|\b(AND|OR|XOR|NOT|NAND|NOR|LSH|RSH|ROL|ROR|MOD)\b/i.test(state.input)) {
    state.input = state.progVal === 0n && !state.input ? '' : state.result;
    syncInputBox();
  }
  renderChrome();
  renderDisplay();
}

function toggleBit(bitIndex) {
  state.progVal = toggleBitVal(state.progVal, Number(bitIndex), state.wordSize, state.signed);
  refreshProgReadout();
  state.input = state.result;
  state.committed = true;
  state.error = null;
  syncInputBox();
  renderDisplay();
  return state.progVal;
}

function pressKey(key) {
  const k = String(key);
  if (k === '=' || k === 'Enter') return commit();
  if (k === 'C' || k === 'Escape') { clearAll(); return state.result; }
  if (k === '⌫' || k === 'Backspace') { backspace(); return state.result; }
  if (k === '±') { negate(); return state.result; }
  insertToken(k);
  return state.result;
}

// ---- input field & clipboard event wiring -----------------------------------

exprInput.addEventListener('input', () => {
  if (syncingInput) return;
  let val = exprInput.value;
  if (val.endsWith('=')) {
    state.input = val.slice(0, -1);
    syncInputBox();
    commit();
    return;
  }
  if (state.committed) {
    if (val.startsWith(state.input) && val.length > state.input.length) {
      const suffix = val.slice(state.input.length);
      if (!isBinaryContinuation(suffix)) { setInput(suffix, { fromCommit: false }); return; }
    }
    state.committed = false;
  }
  state.input = val;
  evaluateLive();
  renderDisplay();
});

window.addEventListener('copy', (e) => { e.preventDefault(); commands.run('copy'); });
window.addEventListener('paste', (e) => { e.preventDefault(); commands.run('paste'); });
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
    const k = (e.key || '').toLowerCase();
    if (k === 'c' || k === 'v') {
      e.preventDefault();
      e.stopPropagation();
      commands.run(k === 'c' ? 'copy' : 'paste');
    }
  }
}, true);

// ---- commands ---------------------------------------------------------------

const currentNumericValue = () => (state.mode === 'programmer' ? Number(state.progVal) : (Number(state.result) || 0));

function setMemory(val) {
  state.memory = Number.isFinite(val) ? Number(val.toPrecision(12)) : 0;
  settings.set('memory', state.memory);
  renderDisplay();
  toolbar.refresh();
}

commands.addAll([
  { id: 'mode-basic', label: 'Basic Mode', checked: () => state.mode === 'basic', run: () => setMode('basic') },
  { id: 'mode-scientific', label: 'Scientific Mode', checked: () => state.mode === 'scientific', run: () => setMode('scientific') },
  { id: 'mode-programmer', label: 'Programmer Mode', checked: () => state.mode === 'programmer', run: () => setMode('programmer') },
  { id: 'toggle-angle', label: 'Toggle Angle Unit', run: () => setAngleUnit(state.angleUnit === 'deg' ? 'rad' : 'deg') },
  { id: 'angle-deg', label: 'Degrees (DEG)', checked: () => state.angleUnit === 'deg', run: () => setAngleUnit('deg') },
  { id: 'angle-rad', label: 'Radians (RAD)', checked: () => state.angleUnit === 'rad', run: () => setAngleUnit('rad') },
  { id: 'word-qword', label: '64-bit (QWORD)', checked: () => state.wordSize === 'QWORD', run: () => setWordSize('QWORD') },
  { id: 'word-dword', label: '32-bit (DWORD)', checked: () => state.wordSize === 'DWORD', run: () => setWordSize('DWORD') },
  { id: 'word-word', label: '16-bit (WORD)', checked: () => state.wordSize === 'WORD', run: () => setWordSize('WORD') },
  { id: 'word-byte', label: '8-bit (BYTE)', checked: () => state.wordSize === 'BYTE', run: () => setWordSize('BYTE') },
  { id: 'toggle-signed', label: 'Toggle Signed/Unsigned', checked: () => state.signed, run: () => setSigned(!state.signed) },
  { id: 'base-hex', label: 'Hexadecimal (HEX)', checked: () => state.base === 'HEX', run: () => setBase('HEX') },
  { id: 'base-dec', label: 'Decimal (DEC)', checked: () => state.base === 'DEC', run: () => setBase('DEC') },
  { id: 'base-oct', label: 'Octal (OCT)', checked: () => state.base === 'OCT', run: () => setBase('OCT') },
  { id: 'base-bin', label: 'Binary (BIN)', checked: () => state.base === 'BIN', run: () => setBase('BIN') },
  { id: 'toggle-bit', label: 'Toggle Bit', run: (b) => toggleBit(b) },
  { id: 'insert-token', label: 'Insert Token', run: (t) => insertToken(t) },
  { id: 'evaluate', label: 'Evaluate', keys: ['Enter', '='], inText: true, run: () => commit() },
  { id: 'clear', label: 'Clear', keys: ['Escape'], inText: true, run: () => clearAll() },
  { id: 'backspace', label: 'Backspace', keys: ['Backspace'], run: () => backspace() },
  { id: 'negate', label: 'Negate (±)', run: () => negate() },
  { id: 'mem-clear', label: 'Memory Clear (MC)', enabled: () => state.memory !== 0, run: () => setMemory(0) },
  { id: 'mem-recall', label: 'Memory Recall (MR)', enabled: () => state.memory !== 0,
    run: () => setInput(formatResult(state.memory, { group: false })) },
  { id: 'mem-add', label: 'Memory Add (M+)', run: () => setMemory(state.memory + currentNumericValue()) },
  { id: 'mem-sub', label: 'Memory Subtract (M-)', run: () => setMemory(state.memory - currentNumericValue()) },
  { id: 'mem-store', label: 'Memory Store (MS)', run: () => setMemory(currentNumericValue()) },
  { id: 'copy', label: 'Copy Result', icon: 'copy', keys: ['Mod+C'], inText: true,
    run: async () => {
      const text = String(state.result);
      toast(`Copied ${text}`, { icon: 'copy', key: 'calc-copy' });
      try { await navigator.clipboard.writeText(text); } catch (err) { toast(`Could not copy: ${err.message}`, { error: true }); }
    } },
  { id: 'paste', label: 'Paste Expression', icon: 'paste', keys: ['Mod+V'], inText: true,
    run: async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text != null && text.trim()) setInput(text.trim());
      } catch (err) { toast(`Could not paste: ${err.message}`, { error: true }); }
    } },
  { id: 'toggle-history', label: 'Toggle History', icon: 'history', keys: ['Mod+H'], inText: true,
    checked: () => state.showHistory,
    run: () => { state.showHistory = !state.showHistory; settings.set('showHistory', state.showHistory); renderChrome(); } },
  { id: 'clear-history', label: 'Clear History', icon: 'trash', enabled: () => state.history.length > 0, run: () => clearHistory() },
  { id: 'new-window', label: 'New Window', keys: ['Mod+N'], inText: true, run: () => app.newWindow() },
  { id: 'quit', label: 'Quit', keys: ['Mod+Q'], inText: true, run: () => app.quit() },
]);

const modeSeg = new Segmented({
  options: [
    { value: 'basic', label: 'Basic', title: 'Basic Calculator' },
    { value: 'scientific', label: 'Scientific', title: 'Scientific Calculator' },
    { value: 'programmer', label: 'Programmer', title: 'Programmer Calculator' },
  ],
  value: state.mode, onChange: (m) => commands.run(`mode-${m}`),
});
const angleSeg = new Segmented({
  options: [{ value: 'deg', label: 'DEG', title: 'Degrees' }, { value: 'rad', label: 'RAD', title: 'Radians' }],
  value: state.angleUnit, onChange: (u) => commands.run(`angle-${u}`),
});
const wordSeg = new Segmented({
  options: ['QWORD', 'DWORD', 'WORD', 'BYTE'].map((v) => ({ value: v, label: v, title: v })),
  value: state.wordSize, onChange: (w) => commands.run(`word-${w.toLowerCase()}`),
});
const signedBtn = h('button.btn.small.num', {
  'data-tip': 'Toggle Signed / Unsigned', onclick: () => commands.run('toggle-signed'),
}, state.signed ? 'SIGN' : 'UNSIGN');

for (const el of [modeSeg.el, toolbar.sep(), angleSeg.el, wordSeg.el, signedBtn, toolbar.spacer()]) toolbar.add(el);
for (const id of ['copy', 'paste', 'toggle-history']) toolbar.button(id);

// ---- rendering --------------------------------------------------------------

function setText(el, val) {
  const s = String(val ?? '');
  if (el.textContent !== s) el.textContent = s;
}

function renderChrome() {
  const isSci = state.mode === 'scientific';
  const isProg = state.mode === 'programmer';
  angleSeg.el.classList.toggle('hidden', !isSci);
  wordSeg.el.classList.toggle('hidden', !isProg);
  signedBtn.classList.toggle('hidden', !isProg);
  setText(signedBtn, state.signed ? 'SIGN' : 'UNSIGN');
  progPanel.classList.toggle('hidden', !isProg);
  padBasic.classList.toggle('hidden', state.mode !== 'basic');
  padScientific.classList.toggle('hidden', !isSci);
  padProgrammer.classList.toggle('hidden', !isProg);
  split.setCollapsed(!state.showHistory);
  if (isProg) {
    const activeRadix = BASES[state.base] || 10;
    for (const { btn, digit } of progDigitButtons) btn.disabled = digit >= activeRadix;
  }
  toolbar.refresh();
}

function renderDisplay() {
  setText(modeBadge, state.mode.toUpperCase());
  setText(unitBadge, state.mode === 'programmer' ? `${state.wordSize} · ${state.base}` : state.angleUnit.toUpperCase());
  memBadge.classList.toggle('hidden', state.memory === 0);
  memButtons['mem-clear'].disabled = state.memory === 0;
  memButtons['mem-recall'].disabled = state.memory === 0;
  setText(exprLine, state.input || state.lastExpr || '');
  setText(resultLine, state.displayResult);
  resultLine.classList.toggle('error', !!state.error);

  if (state.mode === 'programmer') {
    for (const bName of ['HEX', 'DEC', 'OCT', 'BIN']) {
      baseRowEls.get(bName).classList.toggle('active', state.base === bName);
      setText(baseValEls.get(bName), state.bases[bName] || '0');
    }
    if (lastRenderedBitsVal !== state.progVal || lastRenderedBitsWord !== state.wordSize) {
      lastRenderedBitsVal = state.progVal;
      lastRenderedBitsWord = state.wordSize;
      const bits = getBitArray(state.progVal, state.wordSize);
      const activeWidth = wordBits(state.wordSize);
      for (let i = 0; i < 64; i++) {
        const btn = bitButtons[i];
        const on = bits[i] === 1;
        setText(btn, on ? '1' : '0');
        btn.classList.toggle('on', on);
        btn.disabled = i >= activeWidth;
      }
    }
  }

  setText(statusText, state.error ? state.error : state.mode === 'programmer'
    ? `${state.wordSize} (${wordBits(state.wordSize)}-bit ${state.signed ? 'signed' : 'unsigned'})`
    : `Ans = ${formatResult(state.ans)}`);
  setText(statusRight, `${state.history.length} in history`);
}

function renderHistory() {
  const items = state.history;
  clearHistoryBtn.disabled = items.length === 0;
  historyEmpty.classList.toggle('hidden', items.length > 0);
  historyList.classList.toggle('hidden', items.length === 0);
  historyList.replaceChildren(...items.map((entry) => buildHistoryItemEl(entry)));
}

renderChrome();
renderHistory();
renderDisplay();
focusInputEnd();

app.onLaunch(() => focusInputEnd());

app.expose({
  state, evaluate, parse, formatResult, formatDisplayNumber,
  evaluateProgrammer, formatBase, formatAllBases,
  setMode, setAngleUnit, setWordSize, setSigned, setBase,
  setInput, insertToken, commit, clearAll, backspace, negate,
  pressKey, toggleBit, recallHistory, clearHistory,
});
