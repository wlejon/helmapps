// What every setting is when settings.json says nothing about it, and the
// keybindings every user starts with.

import { host } from './host.js';

function defaultFontFamily() {
    if (host.platform === 'win32') return '"Cascadia Mono", Consolas, monospace';
    if (host.platform === 'darwin') return 'Menlo, Monaco, monospace';
    return '"DejaVu Sans Mono", "Noto Sans Mono", "Liberation Mono", monospace';
}

export const DEFAULT_SETTINGS = {
    // The profile new tabs open with: a profile name. null = the first
    // detected shell (PowerShell 7, else Windows PowerShell; the login shell).
    defaultProfile: null,

    // Appearance; every one of these can be overridden per profile.
    colorScheme: 'Tokyo Night',
    font: { family: defaultFontFamily(), size: 14 },
    cursorStyle: 'block',      // block | underline | bar
    cursorBlink: true,
    padding: 6,                // px around the grid
    scrollback: 10000,         // lines (applied once <terminal> exposes it)
    opacity: 1,                // window opacity (applied once bro supports it)

    // Behaviour.
    closeOnExit: 'graceful',   // always | graceful (exit code 0) | never
    confirmClose: 'running',   // always | running | never
    restoreSession: true,
    bell: 'visual',            // visual | none
    tabActivity: true,         // mark background tabs that printed
    environment: {},           // added to every profile's environment

    profiles: {
        defaults: {},          // applied under every profile
        list: [],              // user profiles; a name that matches a detected one overrides it
    },
    schemes: [],               // Windows Terminal-format schemes, added to the built-in set
};

// VS Code-shaped: { key, command, args?, when? }. A command prefixed "-"
// removes a default binding of that key (keybindings.json, like VS Code).
const mod = host.platform === 'darwin' ? 'cmd' : 'ctrl';

export const DEFAULT_KEYBINDINGS = [
    { key: mod + '+shift+t', command: 'newTab' },
    { key: mod + '+shift+n', command: 'newWindow' },
    { key: mod + '+shift+w', command: 'closePane' },
    { key: mod + '+shift+d', command: 'duplicateTab' },
    { key: 'ctrl+tab', command: 'nextTab' },
    { key: 'ctrl+shift+tab', command: 'prevTab' },
    { key: mod + '+pagedown', command: 'nextTab' },
    { key: mod + '+pageup', command: 'prevTab' },
    { key: mod + '+shift+pagedown', command: 'moveTab', args: { direction: 'right' } },
    { key: mod + '+shift+pageup', command: 'moveTab', args: { direction: 'left' } },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ key: mod + '+alt+' + n, command: 'switchToTab', args: { index: n - 1 } })),
    { key: mod + '+alt+9', command: 'switchToTab', args: { index: -1 } },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ key: mod + '+shift+' + n, command: 'newTab', args: { profileIndex: n - 1 } })),

    { key: 'alt+shift+=', command: 'splitPane', args: { direction: 'right' } },
    { key: 'alt+shift+-', command: 'splitPane', args: { direction: 'down' } },
    { key: 'alt+shift+d', command: 'splitPane', args: { direction: 'auto' } },
    { key: 'alt+left', command: 'moveFocus', args: { direction: 'left' } },
    { key: 'alt+right', command: 'moveFocus', args: { direction: 'right' } },
    { key: 'alt+up', command: 'moveFocus', args: { direction: 'up' } },
    { key: 'alt+down', command: 'moveFocus', args: { direction: 'down' } },
    { key: 'alt+shift+left', command: 'resizePane', args: { direction: 'left' } },
    { key: 'alt+shift+right', command: 'resizePane', args: { direction: 'right' } },
    { key: 'alt+shift+up', command: 'resizePane', args: { direction: 'up' } },
    { key: 'alt+shift+down', command: 'resizePane', args: { direction: 'down' } },
    { key: mod + '+shift+z', command: 'togglePaneZoom' },

    { key: mod + '+shift+p', command: 'commandPalette' },
    { key: mod + '+shift+space', command: 'newTabMenu' },
    { key: mod + '+,', command: 'openSettings' },
    { key: mod + '+shift+,', command: 'openSettingsFile' },
    { key: mod + '+shift+f', command: 'find' },
    { key: mod + '+=', command: 'adjustFontSize', args: { delta: 1 } },
    { key: mod + '+-', command: 'adjustFontSize', args: { delta: -1 } },
    { key: mod + '+0', command: 'resetFontSize' },
    { key: 'f11', command: 'toggleMaximize' },
];
