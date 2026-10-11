// Colour schemes: the curated set term ships, in Windows Terminal's scheme
// format (so a scheme copied out of a Windows Terminal settings.json drops
// straight into term's "schemes" list), and how one is applied.
//
// Importing iTerm2 / Alacritty / kitty / Ghostty files is brothemes' job
// (a C++ library with those parsers); term takes it once brothemes has a
// JS binding rather than carrying a second set of parsers here.

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white'];
export const PALETTE_KEYS = [...ANSI, ...ANSI.map((k) => 'bright' + k[0].toUpperCase() + k.slice(1))];

function s(name, bg, fg, cursor, sel, normal, bright) {
    const o = { name, background: bg, foreground: fg, cursorColor: cursor, selectionBackground: sel };
    normal.split(' ').forEach((c, i) => { o[PALETTE_KEYS[i]] = c; });
    bright.split(' ').forEach((c, i) => { o[PALETTE_KEYS[8 + i]] = c; });
    return o;
}

export const BUILTIN_SCHEMES = [
    s('Tokyo Night', '#1A1B26', '#C0CAF5', '#C0CAF5', '#33467C',
      '#15161E #F7768E #9ECE6A #E0AF68 #7AA2F7 #BB9AF7 #7DCFFF #A9B1D6',
      '#414868 #F7768E #9ECE6A #E0AF68 #7AA2F7 #BB9AF7 #7DCFFF #C0CAF5'),
    s('Campbell', '#0C0C0C', '#CCCCCC', '#FFFFFF', '#FFFFFF',
      '#0C0C0C #C50F1F #13A10E #C19C00 #0037DA #881798 #3A96DD #CCCCCC',
      '#767676 #E74856 #16C60C #F9F1A5 #3B78FF #B4009E #61D6D6 #F2F2F2'),
    s('One Half Dark', '#282C34', '#DCDFE4', '#FFFFFF', '#FFFFFF',
      '#282C34 #E06C75 #98C379 #E5C07B #61AFEF #C678DD #56B6C2 #DCDFE4',
      '#5A6374 #E06C75 #98C379 #E5C07B #61AFEF #C678DD #56B6C2 #DCDFE4'),
    s('One Half Light', '#FAFAFA', '#383A42', '#4F525D', '#4F525D',
      '#383A42 #E45649 #50A14F #C18301 #0184BC #A626A4 #0997B3 #FAFAFA',
      '#4F525D #DF6C75 #98C379 #E4C07A #61AFEF #C577DD #56B5C1 #FFFFFF'),
    s('Solarized Dark', '#002B36', '#839496', '#FFFFFF', '#FFFFFF',
      '#002B36 #DC322F #859900 #B58900 #268BD2 #D33682 #2AA198 #EEE8D5',
      '#073642 #CB4B16 #586E75 #657B83 #839496 #6C71C4 #93A1A1 #FDF6E3'),
    s('Solarized Light', '#FDF6E3', '#657B83', '#002B36', '#073642',
      '#002B36 #DC322F #859900 #B58900 #268BD2 #D33682 #2AA198 #EEE8D5',
      '#073642 #CB4B16 #586E75 #657B83 #839496 #6C71C4 #93A1A1 #FDF6E3'),
    s('Tango Dark', '#000000', '#D3D7CF', '#FFFFFF', '#FFFFFF',
      '#000000 #CC0000 #4E9A06 #C4A000 #3465A4 #75507B #06989A #D3D7CF',
      '#555753 #EF2929 #8AE234 #FCE94F #729FCF #AD7FA8 #34E2E2 #EEEEEC'),
    s('Dracula', '#282A36', '#F8F8F2', '#F8F8F2', '#44475A',
      '#21222C #FF5555 #50FA7B #F1FA8C #BD93F9 #FF79C6 #8BE9FD #F8F8F2',
      '#6272A4 #FF6E6E #69FF94 #FFFFA5 #D6ACFF #FF92DF #A4FFFF #FFFFFF'),
    s('Nord', '#2E3440', '#D8DEE9', '#D8DEE9', '#434C5E',
      '#3B4252 #BF616A #A3BE8C #EBCB8B #81A1C1 #B48EAD #88C0D0 #E5E9F0',
      '#4C566A #BF616A #A3BE8C #EBCB8B #81A1C1 #B48EAD #8FBCBB #ECEFF4'),
    s('Gruvbox Dark', '#282828', '#EBDBB2', '#EBDBB2', '#504945',
      '#282828 #CC241D #98971A #D79921 #458588 #B16286 #689D6A #A89984',
      '#928374 #FB4934 #B8BB26 #FABD2F #83A598 #D3869B #8EC07C #EBDBB2'),
    s('Catppuccin Mocha', '#1E1E2E', '#CDD6F4', '#F5E0DC', '#585B70',
      '#45475A #F38BA8 #A6E3A1 #F9E2AF #89B4FA #F5C2E7 #94E2D5 #BAC2DE',
      '#585B70 #F38BA8 #A6E3A1 #F9E2AF #89B4FA #F5C2E7 #94E2D5 #A6ADC8'),
    s('Catppuccin Latte', '#EFF1F5', '#4C4F69', '#DC8A78', '#ACB0BE',
      '#5C5F77 #D20F39 #40A02B #DF8E1D #1E66F5 #EA76CB #179299 #ACB0BE',
      '#6C6F85 #D20F39 #40A02B #DF8E1D #1E66F5 #EA76CB #179299 #BCC0CC'),
];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeColor(c) {
    if (typeof c !== 'string' || !HEX.test(c.trim())) return null;
    let h = c.trim().slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return '#' + h.toUpperCase();
}

/// A scheme from settings, checked: every colour a #rgb/#rrggbb, missing ones
/// taken from `base`. Returns { scheme, problems }.
export function validateScheme(raw, base) {
    const problems = [];
    if (!raw || typeof raw.name !== 'string' || !raw.name) return { scheme: null, problems: ['a scheme has no name'] };
    const out = { name: raw.name };
    for (const k of ['background', 'foreground', 'cursorColor', 'selectionBackground', ...PALETTE_KEYS]) {
        const v = raw[k] === undefined ? null : normalizeColor(raw[k]);
        if (raw[k] !== undefined && !v) problems.push(raw.name + ': ' + k + ' is not a colour');
        out[k] = v || (base ? base[k] : '#000000');
    }
    return { scheme: out, problems };
}

// A scheme reaches a terminal as the element's `theme` (term/adapter.js
// themeFromScheme): base colours, which a program's OSC 104 / 110 / 111 / 112
// resets return to.

function rgb(hex) {
    const h = hex.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function isDark(scheme) {
    const [r, g, b] = rgb(scheme.background);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

/// The application chrome (tab strip, menus, dialogs) follows the active
/// scheme: CSS custom properties derived from it.
export function chromeVariables(scheme) {
    const dark = isDark(scheme);
    const bg = scheme.background, fg = scheme.foreground;
    return {
        '--term-bg': bg,
        '--term-fg': fg,
        '--chrome-bg': mix(bg, dark ? '#000000' : '#FFFFFF', dark ? 0.35 : 0.5),
        '--chrome-fg': fg,
        '--chrome-dim': mix(fg, bg, 0.45),
        '--chrome-hover': mix(bg, fg, 0.08),
        '--chrome-active': bg,
        '--chrome-border': mix(bg, fg, 0.16),
        '--panel-bg': mix(bg, dark ? '#000000' : '#FFFFFF', dark ? 0.15 : 0.3),
        '--accent': scheme.blue,
        '--accent-fg': dark ? '#0B0D12' : '#FFFFFF',
        '--bell': scheme.yellow,
        '--danger': scheme.red,
        '--activity': scheme.green,
        '--selection': scheme.selectionBackground || mix(bg, fg, 0.3),
    };
}

/// The built-in schemes plus the user's (a user scheme with a built-in's name
/// replaces it). Returns { list, byName, problems }.
export function buildSchemeSet(userSchemes) {
    const byName = new Map();
    for (const sc of BUILTIN_SCHEMES) byName.set(sc.name, sc);
    const problems = [];
    for (const raw of Array.isArray(userSchemes) ? userSchemes : []) {
        const { scheme, problems: p } = validateScheme(raw, byName.get(raw && raw.name) || BUILTIN_SCHEMES[0]);
        problems.push(...p);
        if (scheme) byName.set(scheme.name, scheme);
    }
    return { list: [...byName.values()], byName, problems };
}
