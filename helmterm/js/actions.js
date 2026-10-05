// Every command broterm has, registered by id. Keybindings name these ids
// (with optional args), as do the palette, the menus and the tests.

import { host } from './core/host.js';
import * as term from './term/adapter.js';

export function registerActions(app) {
    const c = app.commands;
    const ws = app.workspace;
    const pane = () => ws.activePane();
    const tab = () => ws.active;
    const anyTab = () => !!ws.active;

    // ── tabs ──
    c.register('newTab', { title: 'New tab', category: 'Tab',
        run: (a) => ws.openTab({ profile: a.profile, profileIndex: a.profileIndex, cwd: a.cwd,
            commandline: a.commandline, title: a.title }) });
    c.register('duplicateTab', { title: 'Duplicate tab', category: 'Tab', enabled: anyTab,
        run: () => {
            const p = pane();
            return ws.openTab({ profile: p.profile.name, cwd: p.cwd || p.launch.spawn.cwd,
                commandline: p.launch.commandline, index: ws.tabs.indexOf(tab()) + 1 });
        } });
    c.register('closeTab', { title: 'Close tab', category: 'Tab', enabled: anyTab, run: () => { ws.requestCloseTab(tab()); } });
    c.register('closeOtherTabs', { title: 'Close other tabs', category: 'Tab', enabled: () => ws.tabs.length > 1,
        run: () => { for (const t of ws.tabs.filter((x) => x !== tab())) ws.closeTab(t); } });
    c.register('closeTabsToRight', { title: 'Close tabs to the right', category: 'Tab',
        enabled: () => ws.tabs.indexOf(tab()) < ws.tabs.length - 1,
        run: () => { for (const t of ws.tabs.slice(ws.tabs.indexOf(tab()) + 1)) ws.closeTab(t); } });
    c.register('nextTab', { title: 'Next tab', category: 'Tab', run: () => ws.cycle(1) });
    c.register('prevTab', { title: 'Previous tab', category: 'Tab', run: () => ws.cycle(-1) });
    c.register('switchToTab', { title: 'Switch to tab', category: 'Tab', palette: false,
        run: (a) => ws.activateIndex(typeof a.index === 'number' ? a.index : 0) });
    c.register('moveTab', { title: 'Move tab', category: 'Tab', palette: false, enabled: anyTab,
        run: (a) => ws.moveTab(tab(), a.direction === 'left' ? -1 : 1) });
    c.register('moveTabLeft', { title: 'Move tab left', category: 'Tab', enabled: anyTab, run: () => ws.moveTab(tab(), -1) });
    c.register('moveTabRight', { title: 'Move tab right', category: 'Tab', enabled: anyTab, run: () => ws.moveTab(tab(), 1) });
    c.register('renameTab', { title: 'Rename tab', category: 'Tab', enabled: anyTab,
        run: (a) => {
            if (typeof a.title === 'string') ws.renameTab(tab(), a.title);
            else app.tabbar.beginRename(tab());
        } });
    c.register('resetTabTitle', { title: 'Reset tab title', category: 'Tab', enabled: anyTab,
        run: () => ws.renameTab(tab(), '') });
    c.register('newTabMenu', { title: 'New tab menu', category: 'Tab', run: (a) => app.showNewTabMenu(a.anchor) });

    // ── panes ──
    c.register('splitPane', { title: 'Split pane', category: 'Pane', enabled: anyTab,
        run: (a) => ws.splitPane({ direction: a.direction || 'auto', profile: a.profile, cwd: a.cwd,
            commandline: a.commandline, ratio: a.ratio }) });
    c.register('splitRight', { title: 'Split right', category: 'Pane', enabled: anyTab,
        run: () => ws.splitPane({ direction: 'right' }) });
    c.register('splitDown', { title: 'Split down', category: 'Pane', enabled: anyTab,
        run: () => ws.splitPane({ direction: 'down' }) });
    c.register('closePane', { title: 'Close pane', category: 'Pane', enabled: anyTab, run: () => { ws.requestClosePane(pane()); } });
    c.register('moveFocus', { title: 'Move focus', category: 'Pane', palette: false,
        run: (a) => ws.moveFocus(a.direction || 'next') });
    c.register('focusNextPane', { title: 'Focus next pane', category: 'Pane', run: () => ws.moveFocus('next') });
    c.register('focusPrevPane', { title: 'Focus previous pane', category: 'Pane', run: () => ws.moveFocus('prev') });
    c.register('resizePane', { title: 'Resize pane', category: 'Pane', palette: false, enabled: anyTab,
        run: (a) => tab().resize(a.direction || 'right', a.amount) });
    c.register('togglePaneZoom', { title: 'Zoom pane', category: 'Pane', enabled: () => !!tab() && tab().panes().length > 1,
        run: () => { const z = tab().toggleZoom(); const p = pane(); if (p) p.focus(); return z; } });
    c.register('restartPane', { title: 'Restart pane', category: 'Pane', enabled: () => !!pane(),
        run: () => { const p = pane(); if (p.running) p.el.kill(); p.restart(); p.focus(); } });

    // ── the terminal ──
    c.register('find', { title: 'Find', category: 'Terminal', enabled: () => term.caps.search && !!pane(),
        run: (a) => app.find(a.query) });
    c.register('clearScrollback', { title: 'Clear scrollback', category: 'Terminal', enabled: () => !!pane(),
        run: () => term.clearScrollback(pane().el) });
    c.register('scrollUp', { title: 'Scroll up', category: 'Terminal', palette: false, enabled: () => term.caps.scrollView,
        run: (a) => term.scrollLines(pane().el, -(a.lines || 3)) });
    c.register('scrollDown', { title: 'Scroll down', category: 'Terminal', palette: false, enabled: () => term.caps.scrollView,
        run: (a) => term.scrollLines(pane().el, a.lines || 3) });
    c.register('sendInput', { title: 'Send input', category: 'Terminal', palette: false, enabled: () => !!pane(),
        run: (a) => pane().el.write(String(a.input || '')) });
    c.register('adjustFontSize', { title: 'Adjust font size', category: 'View', palette: false, enabled: () => !!pane(),
        run: (a) => { for (const p of tab().panes()) p.adjustFont(Number(a.delta) || 1); } });
    c.register('increaseFontSize', { title: 'Increase font size', category: 'View', enabled: () => !!pane(),
        run: () => { for (const p of tab().panes()) p.adjustFont(1); } });
    c.register('decreaseFontSize', { title: 'Decrease font size', category: 'View', enabled: () => !!pane(),
        run: () => { for (const p of tab().panes()) p.adjustFont(-1); } });
    c.register('resetFontSize', { title: 'Reset font size', category: 'View', enabled: () => !!pane(),
        run: () => { for (const p of tab().panes()) p.adjustFont(0); } });
    c.register('setColorScheme', { title: 'Set color scheme', category: 'View', palette: false,
        run: (a) => (a.name && app.schemes.byName.has(a.name) ? app.settings.set('colorScheme', a.name) : false) });

    // ── the application ──
    c.register('commandPalette', { title: 'Command palette', category: 'View', run: (a) => app.palette.show(a.query) });
    c.register('openSettings', { title: 'Settings', category: 'Preferences', run: (a) => app.settingsUI.show(a.page) });
    c.register('openSettingsFile', { title: 'Open settings file', category: 'Preferences',
        run: (a) => app.openInEditor(a.file === 'keybindings' ? app.settings.keybindingsPath : app.settings.settingsPath) });
    c.register('openKeybindingsFile', { title: 'Open keybindings file', category: 'Preferences',
        run: () => app.openInEditor(app.settings.keybindingsPath) });
    c.register('reloadSettings', { title: 'Reload settings', category: 'Preferences',
        run: () => { app.settings.reload('command'); return true; } });
    c.register('about', { title: 'About broterm', category: 'Help', run: () => app.overlays.about() });
    c.register('newWindow', { title: 'New window', category: 'Window', enabled: () => !host.headless,
        run: () => host.spawnSelf(['--no-restore']) });
    c.register('toggleMaximize', { title: 'Maximize / restore window', category: 'Window',
        run: () => app.toggleMaximize() });
    c.register('quit', { title: 'Quit', category: 'Window', run: () => app.requestQuit() });
}
