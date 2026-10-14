/**
 * Keypad definitions and programmer panel DOM builders for Calculator.
 */

import { h } from '/lib/dom.js';

export const BASIC_KEYS = [
  { label: 'C', cmd: 'clear', cls: 'fn' },
  { label: '⌫', cmd: 'backspace', cls: 'fn' },
  { label: '%', token: '%', cls: 'op' },
  { label: '÷', token: '÷', cls: 'op' },

  { label: '7', token: '7', cls: 'digit' },
  { label: '8', token: '8', cls: 'digit' },
  { label: '9', token: '9', cls: 'digit' },
  { label: '×', token: '×', cls: 'op' },

  { label: '4', token: '4', cls: 'digit' },
  { label: '5', token: '5', cls: 'digit' },
  { label: '6', token: '6', cls: 'digit' },
  { label: '-', token: '-', cls: 'op' },

  { label: '1', token: '1', cls: 'digit' },
  { label: '2', token: '2', cls: 'digit' },
  { label: '3', token: '3', cls: 'digit' },
  { label: '+', token: '+', cls: 'op' },

  { label: '±', cmd: 'negate', cls: 'fn' },
  { label: '0', token: '0', cls: 'digit' },
  { label: '.', token: '.', cls: 'digit' },
  { label: '=', cmd: 'evaluate', cls: 'primary' },
];

export const SCIENTIFIC_KEYS = [
  { label: 'sin', token: 'sin(', cls: 'fn' },
  { label: 'cos', token: 'cos(', cls: 'fn' },
  { label: 'tan', token: 'tan(', cls: 'fn' },
  { label: '(', token: '(', cls: 'fn' },
  { label: ')', token: ')', cls: 'fn' },
  { label: 'C', cmd: 'clear', cls: 'fn' },

  { label: 'asin', token: 'asin(', cls: 'fn' },
  { label: 'acos', token: 'acos(', cls: 'fn' },
  { label: 'atan', token: 'atan(', cls: 'fn' },
  { label: 'x²', token: '^2', cls: 'fn' },
  { label: 'xʸ', token: '^', cls: 'fn' },
  { label: '⌫', cmd: 'backspace', cls: 'fn' },

  { label: 'sinh', token: 'sinh(', cls: 'fn' },
  { label: 'cosh', token: 'cosh(', cls: 'fn' },
  { label: 'tanh', token: 'tanh(', cls: 'fn' },
  { label: '√', token: 'sqrt(', cls: 'fn' },
  { label: '∛', token: 'cbrt(', cls: 'fn' },
  { label: '÷', token: '÷', cls: 'op' },

  { label: 'ln', token: 'ln(', cls: 'fn' },
  { label: 'log', token: 'log(', cls: 'fn' },
  { label: '7', token: '7', cls: 'digit' },
  { label: '8', token: '8', cls: 'digit' },
  { label: '9', token: '9', cls: 'digit' },
  { label: '×', token: '×', cls: 'op' },

  { label: '1/x', token: 'inv(', cls: 'fn' },
  { label: 'n!', token: '!', cls: 'fn' },
  { label: '4', token: '4', cls: 'digit' },
  { label: '5', token: '5', cls: 'digit' },
  { label: '6', token: '6', cls: 'digit' },
  { label: '-', token: '-', cls: 'op' },

  { label: 'π', token: 'π', cls: 'fn' },
  { label: 'e', token: 'e', cls: 'fn' },
  { label: '1', token: '1', cls: 'digit' },
  { label: '2', token: '2', cls: 'digit' },
  { label: '3', token: '3', cls: 'digit' },
  { label: '+', token: '+', cls: 'op' },

  { label: 'abs', token: 'abs(', cls: 'fn' },
  { label: 'ans', token: 'ans', cls: 'fn' },
  { label: '±', cmd: 'negate', cls: 'fn' },
  { label: '0', token: '0', cls: 'digit' },
  { label: '.', token: '.', cls: 'digit' },
  { label: '=', cmd: 'evaluate', cls: 'primary' },
];

export const PROGRAMMER_KEYS = [
  { label: 'A', token: 'A', cls: 'digit', hexDigit: 10 },
  { label: 'B', token: 'B', cls: 'digit', hexDigit: 11 },
  { label: 'AND', token: ' AND ', cls: 'fn' },
  { label: 'OR', token: ' OR ', cls: 'fn' },
  { label: 'C', cmd: 'clear', cls: 'fn' },
  { label: '⌫', cmd: 'backspace', cls: 'fn' },

  { label: 'C', token: 'C', cls: 'digit', hexDigit: 12 },
  { label: 'D', token: 'D', cls: 'digit', hexDigit: 13 },
  { label: 'XOR', token: ' XOR ', cls: 'fn' },
  { label: 'NOT', token: 'NOT ', cls: 'fn' },
  { label: '<<', token: ' << ', cls: 'fn' },
  { label: '>>', token: ' >> ', cls: 'fn' },

  { label: 'E', token: 'E', cls: 'digit', hexDigit: 14 },
  { label: 'F', token: 'F', cls: 'digit', hexDigit: 15 },
  { label: '7', token: '7', cls: 'digit', hexDigit: 7 },
  { label: '8', token: '8', cls: 'digit', hexDigit: 8 },
  { label: '9', token: '9', cls: 'digit', hexDigit: 9 },
  { label: '÷', token: '÷', cls: 'op' },

  { label: 'ROL', token: 'ROL ', cls: 'fn' },
  { label: 'ROR', token: 'ROR ', cls: 'fn' },
  { label: '4', token: '4', cls: 'digit', hexDigit: 4 },
  { label: '5', token: '5', cls: 'digit', hexDigit: 5 },
  { label: '6', token: '6', cls: 'digit', hexDigit: 6 },
  { label: '×', token: '×', cls: 'op' },

  { label: 'NAND', token: ' NAND ', cls: 'fn' },
  { label: 'NOR', token: ' NOR ', cls: 'fn' },
  { label: '1', token: '1', cls: 'digit', hexDigit: 1 },
  { label: '2', token: '2', cls: 'digit', hexDigit: 2 },
  { label: '3', token: '3', cls: 'digit', hexDigit: 3 },
  { label: '-', token: '-', cls: 'op' },

  { label: '(', token: '(', cls: 'fn' },
  { label: ')', token: ')', cls: 'fn' },
  { label: 'mod', token: ' MOD ', cls: 'fn' },
  { label: '0', token: '0', cls: 'digit', hexDigit: 0 },
  { label: '+', token: '+', cls: 'op' },
  { label: '=', cmd: 'evaluate', cls: 'primary' },
];

export function buildProgrammerPanel(commands) {
  const baseRowEls = new Map();
  const baseValEls = new Map();
  const basesContainer = h('div.calc-bases');

  for (const bName of ['HEX', 'DEC', 'OCT', 'BIN']) {
    const valEl = h('span.calc-base-val.num', '0');
    const rowEl = h('button.calc-base-row', {
      dataset: { base: bName },
      onclick: () => commands.run(`base-${bName.toLowerCase()}`),
    }, h('span.calc-base-label.num', bName), valEl);
    baseRowEls.set(bName, rowEl);
    baseValEls.set(bName, valEl);
    basesContainer.appendChild(rowEl);
  }

  const bitButtons = new Array(64);
  const bitGridEl = h('div.calc-bitgrid');

  for (let row = 0; row < 4; row++) {
    const rowStart = 63 - row * 16;
    const nibbles = [];
    for (let nib = 0; nib < 4; nib++) {
      const msb = rowStart - nib * 4;
      const lsb = msb - 3;
      const bitsRow = h('div.calc-nibble-bits');
      for (let b = msb; b >= lsb; b--) {
        const btn = h('button.calc-bit.num', {
          dataset: { bit: String(b) },
          title: `Bit ${b}`,
          onclick: () => commands.run('toggle-bit', b),
        }, '0');
        bitButtons[b] = btn;
        bitsRow.appendChild(btn);
      }
      const idxRow = h('div.calc-nibble-idx.num',
        h('span', nib === 0 ? String(msb) : ''),
        h('span', nib === 3 ? String(lsb) : ''));
      nibbles.push(h('div.calc-nibble', bitsRow, idxRow));
    }
    bitGridEl.appendChild(h('div.calc-bitrow', ...nibbles));
  }

  const progPanel = h('div.calc-prog-panel', basesContainer, bitGridEl);
  return { progPanel, baseRowEls, baseValEls, bitButtons };
}

export function buildKeypads(commands, onAfterClick) {
  const progDigitButtons = [];

  function makeGrid(keys, extraCls, trackHex = false) {
    const grid = h(`div.calc-pad.${extraCls}`);
    for (const k of keys) {
      const btn = h(`button.btn.calc-key.num.${k.cls || ''}`, {
        dataset: { key: k.label, token: k.token || '', cmd: k.cmd || '' },
        onclick: () => {
          if (k.cmd) commands.run(k.cmd);
          else commands.run('insert-token', k.token);
          if (onAfterClick) onAfterClick();
        },
      }, k.label);
      if (trackHex && typeof k.hexDigit === 'number') {
        progDigitButtons.push({ btn, digit: k.hexDigit });
      }
      grid.appendChild(btn);
    }
    return grid;
  }

  const padBasic = makeGrid(BASIC_KEYS, 'calc-pad-basic');
  const padScientific = makeGrid(SCIENTIFIC_KEYS, 'calc-pad-scientific');
  const padProgrammer = makeGrid(PROGRAMMER_KEYS, 'calc-pad-programmer', true);
  const keypadWrap = h('div.calc-keypad-wrap', padBasic, padScientific, padProgrammer);

  return { keypadWrap, padBasic, padScientific, padProgrammer, progDigitButtons };
}
