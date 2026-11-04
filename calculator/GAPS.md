# Gaps Found While Building Calculator

## `test.js` `SPECIAL` key table lacks `+`, `*`, `(`, `)`, `^`, `%`, `!`
- **Where:** `lib/test.js` (`sdlKey`)
- **Expected:** `press('+')` or `type('12+30')` maps arithmetic operator symbols in `sdlKey`.
- **Actual:** `type('12+30')` catches the missing `sdlKey('+')` and falls back to `textInput('+')` without `keyDown`/`keyUp`.
- **Repro:** `bro-headless calculator -e "import('/lib/test.js').then(t => t.press('+'))"`
- **Impact:** Calculator uses a focused `<input class="calc-expr-input">` so `textInput('+')` from `type('12+30')` works seamlessly.
- **Belongs in:** kit (`lib/test.js`)
