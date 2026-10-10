# Brief: Calculator

| | |
|---|---|
| Folder | `helmapps/calculator/` |
| id | `helm.calculator` |
| Replaces | KCalc, GNOME Calculator, Windows Calculator |
| Size | about 1500 lines |
| Permissions | none |

## What it is

A calculator with a basic keypad mode, a scientific mode, a programmer
mode, and a history tape. Expressions are typed or clicked, and the result
updates as you type.

## Read first

- `../AGENTS.md`, `../lib/README.md`, `../diskusage/`
- `../../helm/ui/js/calc.js`: helm's launcher calculator. Read it for the
  expected feel; write your own evaluator (do not import from helm).

## Must have

1. **The evaluator** (`js/eval.js`, no DOM): a tokenizer and a
   precedence-climbing parser, never `eval` or `Function`. Supports
   `+ - × ÷ * / ^ %`, unary minus, parentheses, implicit multiplication
   (`2π`, `3(4+5)`), factorial `!`, constants `π e`, functions `sin cos tan
   asin acos atan sinh cosh tanh ln log log2 sqrt cbrt abs round floor ceil
   exp`, degrees/radians mode, and `ans` (the last result). Errors are
   values ("Syntax error at 5"), not exceptions to the UI.
2. **Precision.** Double precision, but display rounded to 12 significant
   digits so `0.1+0.2` shows `0.3`, with an exponent for very large or small
   values. Thousands separators in the display only.
3. **Basic mode:** a display (expression above, live result below) and a
   keypad grid of kit `.btn`s (`C`, `⌫`, `%`, `÷`, digits, `.`, `=`, `±`).
   The keyboard works throughout: digits, operators, Enter or `=`,
   Backspace, Escape (clear), and Mod+C/V for the result and pasting an
   expression.
4. **Scientific mode** adds the function keys, `x²`, `xʸ`, `√`, `1/x`,
   `π`, `e`, `(`, `)`, and a DEG/RAD toggle.
5. **Programmer mode:** 64-bit integers via `BigInt`. HEX, DEC, OCT and BIN
   shown together (the active one editable), `AND OR XOR NOT << >>` and
   `mod`, and a bit grid that toggles bits by click.
6. **History** in a side panel (a `SplitPane`, toggle with Mod+H): each
   expression = result, click to reuse, Clear History. Persisted (last
   100).
7. The mode is a `Segmented` in the toolbar and remembered. The window
   resizes from 320 px wide (basic) up, and the keypad scales.

## Acceptance tests

1. Evaluator table: at least 60 cases including precedence (`2+3×4`=14),
   right-associative power (`2^3^2`=512), unary minus with power (`-2^2`=-4),
   implicit multiplication, functions in both angle modes, factorial, `%`,
   and the error cases (`2+`, `(1`, `1/0` → "Can't divide by zero").
2. `0.1+0.2` displays `0.3`, and `1e21` shows an exponent.
3. Typing `12+30` then Enter shows 42 and adds a history entry, and
   clicking the entry puts the expression back.
4. Programmer: `0xFF AND 0x0F` = 15, and switching to BIN shows `1111`.
   Clicking bit 4 makes it 31.
5. The mode, angle unit and history persist.

## Not in this pass

Graphing, unit and currency conversion, arbitrary precision.
