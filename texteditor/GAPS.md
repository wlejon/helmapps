# Gaps

## Resolved: `document.execCommand('insertText')` on `<textarea>`
- **Where:** bro (`document.execCommand`)
- **Status:** Resolved. `js/editor-view.js` (`Tab` / `Shift+Tab` indentation) and `js/find.js` (`replaceOne` / `replaceAll`) use `document.execCommand('insertText', false, replacement)` when available so the `<textarea>`'s native undo stack is preserved, with fallback to direct `textarea.value` assignment.

## Resolved: `<textarea>` `setSelectionRange` scrolls the caret into view
- **Where:** bro (`HTMLTextAreaElement.prototype.setSelectionRange`)
- **Status:** Resolved. `setSelectionRange` auto-scrolls the `<textarea>` viewport to keep the caret/selection visible, and `js/editor-view.js` / `js/find.js` synchronize the line-number gutter accordingly.

## Resolved: `String.prototype.indexOf(sub, fromIndex)` and `String.prototype.replace(re, fn)` $O(N^2)$ over large strings
- **Where:** bronze (`String.prototype.indexOf`, `String.prototype.replace`)
- **Status:** Resolved in `bronze` commit `53f30c3` (O(N) string search and regex callback replacement).
