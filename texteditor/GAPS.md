# Gaps

## `document.execCommand('insertText')` returns `false` on `<textarea>`
- **Where:** bro (`document.execCommand`)
- **Expected:** `document.execCommand('insertText', false, replacement)` on a focused `<textarea>` replaces the selected range and records an entry on the `<textarea>`'s native undo stack, as it does on `contenteditable`.
- **Actual:** `document.execCommand('insertText', false, 'X')` returns `false` and leaves `textarea.value` unchanged when the active selection is inside a `<textarea>`.
- **Repro:** `bro-headless texteditor -e "const ta = document.querySelector('textarea'); ta.focus(); document.execCommand('insertText', false, 'hi')"`
- **Impact:** Replace and Replace All in `js/find.js`, as well as `Tab` indentation in `js/editor-view.js`, assign `textarea.value` directly, which resets the `<textarea>`'s native undo stack for that operation.
- **Belongs in:** bro

## `<textarea>` `setSelectionRange` does not scroll the caret into view
- **Where:** bro (`HTMLTextAreaElement.prototype.setSelectionRange`)
- **Expected:** Moving the selection to a match or target line via `setSelectionRange` (or calling a `scrollIntoView` equivalent for the caret) scrolls the `<textarea>` so the new caret/selection is visible.
- **Actual:** `setSelectionRange` updates `selectionStart` and `selectionEnd` without scrolling the `<textarea>`'s viewport.
- **Repro:** `bro-headless texteditor -e "const ta = document.querySelector('textarea'); ta.value = 'a\\n'.repeat(200); ta.setSelectionRange(390, 395); ta.scrollTop"`
- **Impact:** Find Next/Previous and Go to Line move `selectionStart`/`selectionEnd` accurately, and `js/editor-view.js` approximates vertical scroll position from the target line height when jumping to a distant line.
- **Belongs in:** bro

## `String.prototype.indexOf(sub, fromIndex)` and `String.prototype.replace(re, fn)` are $O(N^2)$ over large strings
- **Where:** bronze (`String.prototype.indexOf`, `String.prototype.replace`)
- **Expected:** Scanning a 300 KB (5,000-line) string with `while ((idx = s.indexOf('\n', idx + 1)) !== -1)` or replacing 200 regex matches with a callback `s.replace(re, () => str)` runs in a few milliseconds.
- **Actual:** `s.indexOf('\n', idx + 1)` across 5,000 lines takes ~700 ms (versus 1.1 ms for `s.split('\n').length`), and `s.replace(re, () => str)` takes ~1,550 ms (versus 7.8 ms for `s.replace(re, str)`).
- **Repro:** `bro-headless texteditor -e "const s = 'line of text\\n'.repeat(5000); let i = -1; while ((i = s.indexOf('\\n', i + 1)) !== -1);"`
- **Impact:** `js/buffer.js` uses `text.split('\n')` for line counting and offset conversion, and `js/find.js` uses `bro.search.Regex.prototype.findAll` and string-pattern `text.replace(re, safeReplacement)`.
- **Belongs in:** bronze

