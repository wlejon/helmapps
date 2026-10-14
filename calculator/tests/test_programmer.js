/**
 * Acceptance test 4: Programmer mode (BigInt 64-bit integer operations,
 * HEX/DEC/OCT/BIN readouts, bit grid toggling, and word widths).
 */

import { app, eq, clickEl, press } from '/lib/test.js';
import { evaluateProgrammer, maskWord, formatAllBases, toggleBitVal } from '../js/programmer.js';

// Switch app to programmer mode
app.setMode('programmer');
eq(app.state.mode, 'programmer', 'mode switched to programmer');

// Acceptance scenario 4:
// "0xFF AND 0x0F = 15, and switching to BIN shows 1111. Clicking bit 4 makes it 31."
app.setInput('0xFF AND 0x0F');
press('enter');
eq(app.state.result, '15', '0xFF AND 0x0F evaluates to 15 in DEC');
eq(app.state.bases.DEC, '15', 'DEC readout is 15');
eq(app.state.bases.HEX, 'F', 'HEX readout is F');
eq(app.state.bases.OCT, '17', 'OCT readout is 17');
eq(app.state.bases.BIN, '1111', 'BIN readout is 1111');

// Switch to BIN by clicking the BIN row
const binRow = document.querySelector('.calc-base-row[data-base="BIN"]');
assert(binRow, 'BIN base row exists');
clickEl(binRow);
eq(app.state.base, 'BIN', 'active base is BIN');
eq(app.state.result, '1111', 'switching to BIN shows 1111');
eq(document.querySelector('.calc-result').textContent.replace(/\s+/g, ''), '1111', 'display shows 1111');

// Click bit 4 in the bit grid -> makes it 31 (11111 in BIN)
const bit4 = document.querySelector('.calc-bit[data-bit="4"]');
assert(bit4, 'bit 4 button exists');
clickEl(bit4);
eq(Number(app.state.progVal), 31, 'clicking bit 4 makes value 31');
eq(app.state.bases.DEC, '31', 'DEC readout is 31');
eq(app.state.bases.BIN, '11111', 'BIN readout is 11111');
eq(app.state.bases.HEX, '1F', 'HEX readout is 1F');

// Clicking bit 4 again toggles it back to 15
clickEl(bit4);
eq(Number(app.state.progVal), 15, 'clicking bit 4 again restores 15');

// Test bitwise operations: OR, XOR, NOT, NAND, NOR, LSH (<<), RSH (>>), ROL, ROR, MOD
const PROG_CASES = [
  { expr: '0xF0 OR 0x0F', opts: { wordSize: 'QWORD', signed: true }, want: 255n },
  { expr: '0xFF XOR 0x0F', opts: { wordSize: 'QWORD', signed: true }, want: 240n },
  { expr: 'NOT 0', opts: { wordSize: 'BYTE', signed: true }, want: -1n },
  { expr: 'NOT 0', opts: { wordSize: 'BYTE', signed: false }, want: 255n },
  { expr: '0xFF NAND 0x0F', opts: { wordSize: 'BYTE', signed: false }, want: 240n },
  { expr: '0xF0 NOR 0x0F', opts: { wordSize: 'BYTE', signed: false }, want: 0n },
  { expr: '1 << 8', opts: { wordSize: 'QWORD', signed: true }, want: 256n },
  { expr: '3 LSH 4', opts: { wordSize: 'QWORD', signed: true }, want: 48n },
  { expr: '64 >> 2', opts: { wordSize: 'QWORD', signed: true }, want: 16n },
  { expr: '64 RSH 3', opts: { wordSize: 'QWORD', signed: true }, want: 8n },
  { expr: '0x80 ROL 1', opts: { wordSize: 'BYTE', signed: false }, want: 1n },
  { expr: '1 ROR 1', opts: { wordSize: 'BYTE', signed: false }, want: 128n },
  { expr: '29 MOD 6', opts: { wordSize: 'QWORD', signed: true }, want: 5n },
  { expr: '0b1010 + 0o12', opts: { wordSize: 'QWORD', signed: true }, want: 20n },
];

for (const tc of PROG_CASES) {
  const r = evaluateProgrammer(tc.expr, tc.opts);
  assert(r.ok, `${tc.expr} should succeed, got ${r.error}`);
  eq(String(r.value), String(tc.want), `evaluateProgrammer(${tc.expr})`);
}

// Word size wrapping & signed/unsigned behavior
eq(String(maskWord(255n, 'BYTE', true)), '-1', '255 in signed BYTE is -1');
eq(String(maskWord(255n, 'BYTE', false)), '255', '255 in unsigned BYTE is 255');
eq(String(maskWord(256n, 'BYTE', false)), '0', '256 wraps to 0 in BYTE');
eq(String(maskWord(65535n, 'WORD', true)), '-1', '65535 in signed WORD is -1');
eq(String(maskWord(65535n, 'WORD', false)), '65535', '65535 in unsigned WORD is 65535');
eq(String(maskWord(0xFFFFFFFFn, 'DWORD', true)), '-1', '0xFFFFFFFF in signed DWORD is -1');

// Verify disabled bits when wordSize is BYTE
app.setWordSize('BYTE');
const bit7 = document.querySelector('.calc-bit[data-bit="7"]');
const bit8 = document.querySelector('.calc-bit[data-bit="8"]');
eq(bit7.disabled, false, 'bit 7 enabled in BYTE mode');
eq(bit8.disabled, true, 'bit 8 disabled in BYTE mode');

// Restore defaults
app.setWordSize('QWORD');
app.setBase('DEC');
app.setMode('basic');
app.clearAll();

console.log('test_programmer PASSED');
