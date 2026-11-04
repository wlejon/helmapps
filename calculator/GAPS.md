# Gaps Found While Building Calculator

## Ctrl+C / Ctrl+V dispatch `copy` / `paste` events without `keydown`
- **Where:** bro input dispatch
- **Expected:** `Ctrl+C` / `Ctrl+V` fire `keydown` on the page first, then `copy` / `paste`, as a browser does.
- **Actual:** `keyDown` for `Ctrl+C` / `Ctrl+V` dispatches only the `copy` / `paste` clipboard events, with no `keydown`.
- **Repro:** `bro-headless calculator -e "window.addEventListener('keydown', e => console.log('kd', e.key)); keyDown(99, 64, 0x0040);"` prints nothing.
- **Impact:** none for commands: the kit's `Commands.attach` runs `Mod+C` / `Mod+X` / `Mod+V` commands from the clipboard events. A page listening for the keydown itself never sees it.
- **Belongs in:** bro

## `test.js` `SPECIAL` key table lacks `+`, `*`, `(`, `)`, `^`, `%`, `!`
- **Where:** `lib/test.js` (`sdlKey`)
- **Expected:** `press('+')` or `type('12+30')` maps arithmetic operator symbols in `sdlKey`.
- **Actual:** `type('12+30')` catches the missing `sdlKey('+')` and falls back to `textInput('+')` without `keyDown`/`keyUp`.
- **Repro:** `bro-headless calculator -e "import('/lib/test.js').then(t => t.press('+'))"`
- **Impact:** Calculator uses a focused `<input class="calc-expr-input">` so `textInput('+')` from `type('12+30')` works seamlessly.
- **Belongs in:** kit (`lib/test.js`)
