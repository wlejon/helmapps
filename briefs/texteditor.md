# Brief: Text Editor

| | |
|---|---|
| Folder | `helmapps/texteditor/` |
| id | `helm.texteditor` |
| Replaces | Kate, gedit, Notepad |
| Size | about 2500 lines |
| Permissions | `["files"]`: files named on its command line, as well as those picked |

## What it is

A plain-text editor for notes, config files and quick code edits. It has
tabs, find and replace, safe saving, and remembers what was open. It is
**not** an IDE: no syntax highlighting, completion or language servers in
this pass.

## The editing surface

Use a `<textarea>` per document. bro's textarea handles typing, selection,
IME, clipboard and undo natively (`../bro/docs/headless.md`, "Text editing
undo/redo" and "Editing commands"). `contenteditable` is plain-text only
in bro today, so do not use it. Do not build your own text layout or caret
on a canvas. If the textarea cannot do something the brief asks for (for
example scrolling the caret into view after `setSelectionRange`, or tab
characters at a set width), file the gap and leave that part out.

## Read first

- `../AGENTS.md`, `../lib/README.md`, `../diskusage/`
- `../bro/docs/headless.md` (text editing, undo, IME and editing commands, all of which you test with)
- `../bro/docs/brokit-api.js`: `fs` (`readFile`, `writeFile`, `rename`, `stat`), `fs.watch`
- `../bro/docs/dialogs-api.js`: `showOpenFileDialog`, `showSaveFileDialog`
- `../bro/docs/app-api.js`: single instance, `instance` events (open a file into the running window)

## Must have

1. **Documents in tabs** (`Tabs` from the kit). New (Mod+N opens an
   "Untitled" tab), Open (Mod+O, multi-select), Close tab (Mod+W),
   Next/Previous tab (Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+PageDown/Up). A
   modified tab shows its dirty dot.
2. **Open** from the command line and from single-instance launches
   (`bro texteditor a.txt b.md`, opened as tabs in the running window).
   Detect encoding as UTF-8, or UTF-8 with BOM (keep the BOM on save), and
   line endings (LF or CRLF, kept on save, shown in the status bar). A file
   that is not valid UTF-8 or contains NUL bytes opens read-only with a
   banner ("Binary or non-UTF-8 file"). Files over 20 MB ask first.
3. **Save** (Mod+S), **Save As** (Mod+Shift+S), **Save All**. Write to a
   temp file in the same folder and then `rename` over the original, so a
   crash never leaves half a file. Saving an untitled document asks for a
   path.
4. **Never lose work.**
   - Closing a modified tab asks Save / Don't Save / Cancel (a `Dialog`
     with three buttons).
   - Quitting with modified tabs asks once for all of them.
   - Every 5 s of idle after a change, autosave a recovery copy of each
     modified document to `bro.app.dataDir/recovery/`. On the next start,
     offer to restore any recovery files left behind.
5. **External changes.** Watch each open file (`fs.watch`). If it changes
   on disk and the tab is clean, reload silently. If the tab is dirty, show
   a banner: "Changed on disk. Reload / Keep mine". If it is deleted, mark
   the tab and let Save recreate it.
6. **Find and replace** (Mod+F, Mod+H): a bar above the text with Next /
   Previous (Enter / Shift+Enter, F3), match case, whole word, regex,
   Replace and Replace All (a single undo step if bro allows it; else file
   the gap), and a match count (`3 of 12`). Escape closes it and returns
   focus to the text.
7. **Go to line** (Mod+G) with a prompt.
8. **View options**, persisted: word wrap (Alt+Z), font size (Mod+= /
   Mod+- / Mod+0), monospace or UI font, tab width (2/4/8; the Tab key
   inserts spaces or a tab per setting), show the status bar.
9. **Status bar:** Ln, Col, selection length, encoding, line endings (click
   to change), and indentation.
10. **Session.** Reopen the tabs open at the last quit (paths, active tab,
    caret positions) when started with no arguments.
11. **Recent files** in a toolbar drop-down (10, persisted), also recorded
    with `addRecent` for the system list.
12. Title: `name.txt — Text Editor`, with a `•` prefix when modified.

## Settings

`wordWrap`, `fontSize`, `monospace`, `tabWidth`, `insertSpaces`,
`showStatusBar`, `recent` (json), `session` (json).

## Acceptance tests

1. Open a fixture file: the text appears in a tab titled with its name, and
   the status bar shows LF or CRLF to match the file.
2. Type into it (`type('hello')`): the tab is dirty. Save, and the file on
   disk has the new text, line endings preserved and BOM preserved.
3. Close a dirty tab: the dialog appears, and Cancel keeps the tab. Don't
   Save closes it and leaves the file unchanged.
4. Find: three matches counted. Next moves the selection to each in turn
   (assert `selectionStart`), and Replace All replaces them, giving the
   expected file text after save.
5. Regex find with a capture-group replace (`(\w+)@` → `$1 at `).
6. An external write to a clean open file reloads it, and to a dirty one
   shows the banner.
7. Open a file with a NUL byte: read-only banner, and typing does not
   change it.
8. Recovery: make a change, advance past the autosave delay, check the
   recovery file exists, start a fresh app instance of the test (or call
   the restore path directly), and the offer appears.
9. Launch arguments with two files open two tabs, and a second launch
   (simulate the `instance` handler via `app.onLaunch`'s callback) adds a
   tab to the same window.
10. The word-wrap and font-size settings persist.

## Not in this pass

Syntax highlighting, line numbers in wrap mode, split views, multiple
cursors, printing, encodings other than UTF-8, a file tree.
