// The settings: settings.json and keybindings.json in the configuration
// directory are the source of truth. They are read at start, watched, and
// re-read whenever either changes on disk (an editor's save, the settings UI,
// another helmterm). A file that does not parse keeps the last good settings
// and reports why.
//
// Writes from the settings UI go through update(): the file is re-read, the
// change applied to the parsed object (unknown keys survive; comments do
// not, since the file is rewritten as plain JSON), and written back. The
// watcher then reloads it like any other change.

import { host } from './host.js';
import { parseJsonc } from './jsonc.js';
import { Emitter, debounce } from './emitter.js';
import { DEFAULT_SETTINGS, DEFAULT_KEYBINDINGS } from './defaults.js';

const SETTINGS_TEMPLATE = `// helmterm settings. This file is watched: saving it applies the change.
// Every key is optional; anything left out takes its default. The settings
// UI (Ctrl+,) edits this file too. See README.md for every key.
{
    // "defaultProfile": "PowerShell",
    // "colorScheme": "Tokyo Night",
    // "font": { "family": "Cascadia Mono", "size": 14 },
    "profiles": {
        "defaults": {},
        "list": []
    },
    "schemes": []
}
`;

const KEYBINDINGS_TEMPLATE = `// helmterm keybindings, in VS Code's format: { "key", "command", "args", "when" }.
// These are added on top of the defaults; "-command" removes a default.
// Example: { "key": "ctrl+shift+e", "command": "splitPane", "args": { "direction": "right" } }
[
]
`;

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/// Deep merge for settings: objects merge key by key, everything else
/// (arrays included) is replaced.
export function mergeSettings(base, over) {
    if (!isPlainObject(over)) return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
        out[k] = isPlainObject(v) && isPlainObject(base[k]) ? mergeSettings(base[k], v) : v;
    }
    return out;
}

export class SettingsStore extends Emitter {
    constructor(dir) {
        super();
        this.dir = dir || host.configDir;
        this.settingsPath = host.join(this.dir, 'settings.json');
        this.keybindingsPath = host.join(this.dir, 'keybindings.json');
        this.values = mergeSettings(DEFAULT_SETTINGS, {});
        this.userKeybindings = [];
        this.errors = [];          // why the last load fell back, if it did
        this.generation = 0;       // bumps on every successful (re)load
        this._lastText = { settings: null, keybindings: null };
        this._watcher = null;
        this._reload = debounce(() => this.reload('watch'), 120);
    }

    load() {
        if (!host.exists(this.settingsPath)) host.writeText(this.settingsPath, SETTINGS_TEMPLATE);
        if (!host.exists(this.keybindingsPath)) host.writeText(this.keybindingsPath, KEYBINDINGS_TEMPLATE);
        this.reload('start');
        return this;
    }

    watch() {
        if (this._watcher) return;
        this._watcher = host.watchDir(this.dir, (event, filename) => {
            const base = String(filename).split(/[\\/]/).pop();
            if (base === 'settings.json' || base === 'keybindings.json') this._reload();
        });
    }

    close() {
        if (this._watcher && typeof this._watcher.close === 'function') this._watcher.close();
        this._watcher = null;
        this._reload.cancel();
    }

    /// Re-read both files. Returns true when anything changed.
    reload(reason) {
        const sText = host.readText(this.settingsPath);
        const kText = host.readText(this.keybindingsPath);
        if (reason === 'watch' && sText === this._lastText.settings && kText === this._lastText.keybindings) return false;
        const errors = [];
        let user = null;
        let keys = null;
        try { user = sText == null ? {} : parseJsonc(sText); } catch (e) { errors.push('settings.json: ' + e.message); }
        try { keys = kText == null ? [] : parseJsonc(kText); } catch (e) { errors.push('keybindings.json: ' + e.message); }
        if (user !== null && !isPlainObject(user)) { errors.push('settings.json: the top level must be an object'); user = null; }
        if (keys !== null && !Array.isArray(keys)) { errors.push('keybindings.json: the top level must be an array'); keys = null; }
        this.errors = errors;
        const settingsChanged = user !== null && (sText !== this._lastText.settings || reason === 'start');
        const keysChanged = keys !== null && (kText !== this._lastText.keybindings || reason === 'start');
        if (settingsChanged) {
            this._lastText.settings = sText;
            this.values = mergeSettings(DEFAULT_SETTINGS, user);
            this.raw = user;
        }
        if (keysChanged) {
            this._lastText.keybindings = kText;
            this.userKeybindings = keys.filter((k) => isPlainObject(k));
        }
        if (!settingsChanged && !keysChanged) {
            if (errors.length) this.emit('error', errors);
            return false;
        }
        this.generation++;
        this.emit('change', { reason, errors });
        if (errors.length) this.emit('error', errors);
        return true;
    }

    get(key) {
        return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.values);
    }

    /// The effective keybinding list: defaults, then the user's on top.
    keybindings() {
        return [...DEFAULT_KEYBINDINGS, ...this.userKeybindings];
    }

    /// Change settings.json: `mutate(obj)` edits the parsed user object in
    /// place. The new file is written and loaded straight away (the watcher's
    /// echo of the same text is then a no-op).
    update(mutate) {
        let obj = {};
        const text = host.readText(this.settingsPath);
        if (text != null) {
            try { obj = parseJsonc(text); } catch (e) {
                this.emit('error', ['settings.json does not parse, so it was not changed: ' + e.message]);
                return false;
            }
        }
        if (!isPlainObject(obj)) obj = {};
        mutate(obj);
        host.writeText(this.settingsPath, JSON.stringify(obj, null, 4) + '\n');
        this.reload('update');
        return true;
    }

    /// Set one dotted key in settings.json (undefined removes it).
    set(key, value) {
        return this.update((obj) => {
            const parts = key.split('.');
            let o = obj;
            for (const p of parts.slice(0, -1)) {
                if (!isPlainObject(o[p])) o[p] = {};
                o = o[p];
            }
            const last = parts[parts.length - 1];
            if (value === undefined) delete o[last]; else o[last] = value;
        });
    }

    /// Replace keybindings.json's user list.
    setUserKeybindings(list) {
        host.writeText(this.keybindingsPath, JSON.stringify(list, null, 4) + '\n');
        this.reload('update');
    }
}
