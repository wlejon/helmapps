# Character Map (`helm.charmap`)

Browse, search, inspect, and copy Unicode characters, symbols, and encodings for the **helm** desktop environment.

## Features

- **21 Curated Unicode Blocks**: Basic Latin, Latin-1 Supplement, Latin Extended-A, Greek and Coptic, Cyrillic, General Punctuation, Superscripts and Subscripts, Currency Symbols, Letterlike Symbols, Number Forms, Arrows, Mathematical Operators, Miscellaneous Technical, Box Drawing, Block Elements, Geometric Shapes, Miscellaneous Symbols, Dingbats, Braille Patterns, Supplemental Arrows & Math, and Emoticons & Symbols.
- **Collections**: Pin frequently used symbols to **Favorites**, revisit **Recently Copied** glyphs, or browse **All Characters** in a virtualized grid or multi-column table.
- **Live Search**: Search by character name or keyword (`rightwards arrow`, `infinity`, `euro`, `lambda`, `check`), hex codepoint (`U+2192` or `2192`), or literal glyph (`→`), powered by `bro.search.fuzzy` with deterministic token scoring.
- **Character Inspector**: Inspect any glyph with one-click copy for Character, Codepoint (`U+XXXX`), UTF-8 Bytes, UTF-16 Code Units (including astral surrogate pairs), HTML Entities (named, hex, and decimal), CSS Escape, and JS/JSON Escape, plus a quick strip of related characters.
- **Copy Buffer**: Assemble sequences of symbols (`α + β → ∞`) and copy the entire string at once.

## Running and Testing

Run tests via `bro-headless`:

```bash
bash scripts/run_tests.sh charmap
VERBOSE=1 bash scripts/run_tests.sh charmap perf
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+F` | Focus search field |
| `Escape` | Clear active search |
| `Ctrl+C` | Copy selected character |
| `Ctrl+Alt+C` | Copy selected character codepoint (`U+XXXX`) |
| `Ctrl+Shift+C` | Copy the assembled Copy Buffer |
| `Ctrl+D` | Toggle Favorite for the selected character |
| `Ctrl+1` | Switch to Grid View |
| `Ctrl+2` | Switch to List View |
| `Ctrl+=` / `Ctrl+-` | Zoom grid cells in / out |
| `Ctrl+I` | Toggle Inspector side panel |
| `Enter` / Double-Click | Copy character and append to Copy Buffer |
| `Ctrl+N` | Open a new window |
| `Ctrl+Q` | Quit Character Map |
