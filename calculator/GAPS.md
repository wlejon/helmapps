# Gaps Found While Building Calculator

## Ctrl+C / Ctrl+V dispatch `copy` / `paste` events without `keydown`
- **Where:** `lib/commands.js` (`Commands.attach`) / bro input dispatch
- **Expected:** Registering a command with `keys: ['Mod+C']` or `keys: ['Mod+V']` in `app.commands` triggers the command when the user presses `Ctrl+C` / `Ctrl+V`.
- **Actual:** `keyDown` for `Ctrl+C` / `Ctrl+V` in `bro` dispatches `copy` / `paste` clipboard events on `window`/`document` without firing a `keydown` event, so `Commands.attach` (which only listens to `keydown`) never sees `Mod+C` or `Mod+V`.
- **Repro:** `bro-headless calculator -e "window.addEventListener('keydown', e => console.log('kd', e.key)); keyDown(99, 6, 0x0040);"`
- **Impact:** Calculator binds `window` `'copy'` and `'paste'` listeners that delegate to `commands.run('copy')` and `commands.run('paste')`.
- **Belongs in:** kit (`lib/commands.js`)

## `test.js` `SPECIAL` key table lacks `+`, `*`, `(`, `)`, `^`, `%`, `!`
- **Where:** `lib/test.js` (`sdlKey`)
- **Expected:** `press('+')` or `type('12+30')` maps arithmetic operator symbols in `sdlKey`.
- **Actual:** `type('12+30')` catches the missing `sdlKey('+')` and falls back to `textInput('+')` without `keyDown`/`keyUp`.
- **Repro:** `bro-headless calculator -e "import('/lib/test.js').then(t => t.press('+'))"`
- **Impact:** Calculator uses a focused `<input class="calc-expr-input">` so `textInput('+')` from `type('12+30')` works seamlessly.
- **Belongs in:** kit (`lib/test.js`)
