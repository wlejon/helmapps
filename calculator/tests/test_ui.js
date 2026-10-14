/**
 * Acceptance test 3 & 5: UI interaction, keyboard entry, history tape recall,
 * mode switching, angle unit, memory buttons, and settings persistence.
 */

import { app, waitFor, eq, press, type, clickEl, mod } from '/lib/test.js';

// Start clean in basic mode
app.setMode('basic');
app.clearHistory();
app.clearAll();

// Acceptance scenario 3:
// "Typing 12+30 then Enter shows 42 and adds a history entry, and clicking the entry puts the expression back."
type('12+30');
eq(app.state.input, '12+30', 'typed 12+30 into expression');
eq(app.state.result, '42', 'live preview updates as you type');

press('enter');
eq(app.state.result, '42', 'Enter evaluates to 42');
eq(document.querySelector('.calc-result').textContent, '42', 'display shows 42');
eq(app.state.history.length, 1, 'history entry added');
eq(app.state.history[0].expr, '12+30', 'history entry stores expression');
eq(app.state.history[0].result, '42', 'history entry stores result');

// Clear display with Escape, then click the history entry to put the expression back
press('escape');
eq(app.state.input, '', 'Escape clears input');
eq(app.state.result, '0', 'Escape resets result to 0');

const histItem = document.querySelector('.calc-history-item');
assert(histItem, 'history item rendered in history pane');
clickEl(histItem);
eq(app.state.input, '12+30', 'clicking history entry puts expression 12+30 back');
eq(document.querySelector('.calc-expr').textContent, '12+30', 'display expression shows 12+30');
eq(app.state.result, '42', 'result shows 42');

// Keypad button clicks in basic mode
press('escape');
const keyBtn = (label) =>
  Array.from(document.querySelectorAll('.calc-pad-basic .calc-key')).find((b) => b.dataset.key === label);

clickEl(keyBtn('7'));
clickEl(keyBtn('×'));
clickEl(keyBtn('6'));
clickEl(keyBtn('='));
eq(app.state.result, '42', '7 × 6 = 42 via keypad buttons');
eq(app.state.history.length, 2, 'second calculation added to history');

// Memory buttons: MS, M+, MR, MC
clickEl(document.querySelector('[data-mem="MS"]'));
eq(app.state.memory, 42, 'MS stores 42 in memory');
clickEl(document.querySelector('[data-mem="M+"]'));
eq(app.state.memory, 84, 'M+ adds 42 to make 84');
press('escape');
clickEl(document.querySelector('[data-mem="MR"]'));
eq(app.state.result, '84', 'MR recalls 84');
clickEl(document.querySelector('[data-mem="MC"]'));
eq(app.state.memory, 0, 'MC clears memory');

// Mode switching & angle unit persistence (Acceptance scenario 5)
app.setMode('scientific');
eq(app.settings.get('mode'), 'scientific', 'mode persisted in settings');
app.setAngleUnit('rad');
eq(app.settings.get('angleUnit'), 'rad', 'angleUnit persisted in settings');

app.setInput('sin(pi/2)');
press('enter');
eq(app.state.result, '1', 'sin(pi/2) = 1 in RAD mode');

app.setAngleUnit('deg');
eq(app.settings.get('angleUnit'), 'deg', 'angleUnit deg persisted in settings');
app.setInput('sin(30)');
press('enter');
eq(app.state.result, '0.5', 'sin(30) = 0.5 in DEG mode');

// Toggle history pane with Mod+H
const initialShowHistory = app.state.showHistory;
press(`${mod}+h`);
eq(app.state.showHistory, !initialShowHistory, 'Mod+H toggles history pane');
eq(app.settings.get('showHistory'), !initialShowHistory, 'showHistory persisted');
press(`${mod}+h`);
eq(app.state.showHistory, initialShowHistory, 'Mod+H restores history pane');

// Copy & Paste with Mod+C / Mod+V
app.setInput('123+456');
press('enter');
eq(app.state.result, '579', '123+456 = 579');
press(`${mod}+c`);
waitFor(() => document.querySelector('.toast'), 'copy toast shown');
press('escape');
press(`${mod}+v`);
waitFor(() => app.state.input === '579', 'Mod+V pastes copied result');

// Persisted history check
assert(Array.isArray(app.settings.get('history')) && app.settings.get('history').length >= 4, 'history persisted in settings');

console.log('test_ui PASSED');
