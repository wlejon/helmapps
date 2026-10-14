# Calculator (`helm.calculator`)

A native desktop calculator for the helm environment supporting **Basic**, **Scientific**, and **Programmer** modes, live expression preview, 64-bit `BigInt` bitwise arithmetic with an interactive 64-bit bit-toggle grid, and a persistent history tape.

## Modes

- **Basic**: Standard arithmetic (`+`, `-`, `×`, `÷`, `%`, `±`), parentheses, memory bar (`MC`, `MR`, `M+`, `M-`, `MS`), and live evaluation as you type.
- **Scientific**: Trigonometric (`sin`, `cos`, `tan`, `asin`, `acos`, `atan`) in `DEG` or `RAD`, hyperbolic (`sinh`, `cosh`, `tanh`), logarithmic (`ln`, `log`, `log2`), powers and roots (`x²`, `xʸ`, `√`, `∛`), factorial (`n!`), reciprocal (`1/x`), constants (`π`, `e`), and `ans`.
- **Programmer**: 64-bit two's-complement integer arithmetic via `BigInt` with selectable word widths (`QWORD`, `DWORD`, `WORD`, `BYTE`), signed/unsigned toggle, simultaneous `HEX`, `DEC`, `OCT`, and `BIN` readouts, bitwise operators (`AND`, `OR`, `XOR`, `NOT`, `NAND`, `NOR`, `<<`, `>>`, `ROL`, `ROR`, `MOD`), and a 64-bit click-to-toggle bit grid.

## Running & Testing

```bash
# Boot check (headless)
../bro/build-release/bro-headless calculator -e "0"

# Run all acceptance and performance tests
VERBOSE=1 scripts/run_tests.sh calculator
```

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `0-9`, `A-F` (HEX), `+ - * / ^ % ( ) ! .` | Enter expression |
| `Enter` or `=` | Evaluate and commit to history |
| `Backspace` | Delete last character |
| `Escape` | Clear expression and result (`C`) |
| `Mod+C` | Copy current result to clipboard |
| `Mod+V` | Paste expression from clipboard |
| `Mod+H` | Toggle History side panel |
| `Mod+N` | Open a new Calculator window |
| `Mod+Q` | Quit Calculator |
