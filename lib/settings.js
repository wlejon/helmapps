/**
 * App settings: one bro.conf schema per app, with an in-memory fallback so
 * the app still runs where bro.conf is missing (and in tests, where
 * BRO_APP_HOME keeps it away from the user's own settings).
 *
 *   import { Settings } from '/lib/settings.js';
 *   export const settings = new Settings('helm.files', {
 *     showHidden: { type: 'bool', default: false },
 *     view:       { type: 'string', default: 'grid' },
 *     iconSize:   { type: 'int', default: 64, min: 32, max: 256 },
 *     bookmarks:  { type: 'json', default: [] },
 *   });
 *   settings.get('view');                    // 'grid'
 *   settings.set('view', 'list');            // persists, notifies watchers
 *   const off = settings.watch('view', (v) => render(v));
 *
 * Types are bro.conf's (bool, int, double, string, string_list, color) plus
 * 'json': any JSON value, stored as a string. Values changed by another
 * process (a second window of the app, a settings page) arrive through
 * watch() as well.
 *
 * Use the app's id (bro.json "id") as the path. Store state worth keeping
 * across launches here (view modes, sizes, recent items); never write your
 * own settings files.
 */

import { api, attempt } from './dom.js';

export class Settings {
  /**
   * @param {string} path    the bro.conf section, normally the app id
   * @param {Object<string, {type: string, default: *, min?: number, max?: number}>} schema
   */
  constructor(path, schema) {
    this.path = path;
    this.schema = schema;
    this.mem = {};
    this.watchers = new Map();
    this.conf = null;
    const conf = api('conf');
    if (conf) {
      const keys = {};
      for (const [k, def] of Object.entries(schema)) {
        const entry = def.type === 'json'
          ? { type: 'string', default: JSON.stringify(def.default ?? null) }
          : { type: def.type, default: def.default };
        if (def.min != null) entry.min = def.min;
        if (def.max != null) entry.max = def.max;
        keys[k] = entry;
      }
      const ok = attempt(`conf.registerSchema ${path}`, () => {
        conf.registerSchema({ id: path, path, keys });
        return true;
      }, false);
      if (ok) this.conf = conf;
    }
    if (this.conf) {
      attempt(`conf.watch ${path}`, () => this.conf.watch(path, (key, value) => this.emit(key, this.decode(key, value))));
    }
  }

  decode(key, raw) {
    const def = this.schema[key];
    if (!def || def.type !== 'json' || typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch (_) { return clone(def.default); }
  }

  /** The value of key, else its schema default. */
  get(key) {
    const def = this.schema[key];
    if (!def) throw new Error(`settings: no key '${key}' in ${this.path}`);
    if (this.conf) {
      const v = attempt(`conf.get ${this.path}.${key}`, () => this.conf.getOptional(`${this.path}.${key}`));
      return v === undefined || v === null ? clone(def.default) : this.decode(key, v);
    }
    return key in this.mem ? clone(this.mem[key]) : clone(def.default);
  }

  /** Persist a value and tell the watchers. */
  set(key, value) {
    const def = this.schema[key];
    if (!def) throw new Error(`settings: no key '${key}' in ${this.path}`);
    if (this.conf) {
      const stored = def.type === 'json' ? JSON.stringify(value) : value;
      attempt(`conf.set ${key}`, () => {
        const p = this.conf.set(`${this.path}.${key}`, stored);
        if (p && typeof p.catch === 'function') {
          p.catch((err) => console.warn(`settings: ${this.path}.${key}: ${err && err.message}`));
        }
      });
    } else {
      this.mem[key] = clone(value);
    }
    this.emit(key, value);
  }

  /** Back to the schema default. */
  reset(key) {
    if (this.conf) attempt(`conf.reset ${key}`, () => this.conf.reset(`${this.path}.${key}`));
    else delete this.mem[key];
    this.emit(key, this.get(key));
  }

  /** fn(value) on every change to key; returns an unsubscribe function. */
  watch(key, fn) {
    if (!this.watchers.has(key)) this.watchers.set(key, new Set());
    this.watchers.get(key).add(fn);
    return () => this.watchers.get(key).delete(fn);
  }

  emit(key, value) {
    const fns = this.watchers.get(key);
    if (!fns) return;
    for (const fn of fns) attempt(`settings watcher ${key}`, () => fn(value));
  }
}

function clone(v) {
  return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
}

/**
 * The helm shell's own preferences (helm/ui/js/settings.js), read-only from
 * an app: accentHue, use24h. Answers the shell's defaults when helm is not
 * running or bro.conf is missing.
 */
const SHELL_PATH = 'helm.shell';
const SHELL_DEFAULTS = { accentHue: 255, use24h: true };

export function shellPref(key) {
  const conf = api('conf');
  const v = conf ? attempt(`conf.get ${SHELL_PATH}.${key}`, () => conf.getOptional(`${SHELL_PATH}.${key}`)) : null;
  return v === undefined || v === null ? SHELL_DEFAULTS[key] : v;
}

/** fn(key, value) when a shell preference changes; returns an unsubscribe function. */
export function watchShellPrefs(fn) {
  const conf = api('conf');
  if (!conf) return () => {};
  const handle = attempt('conf.watch helm.shell', () => conf.watch(SHELL_PATH, (key, value) => fn(key, value)));
  return () => { if (handle && handle.unwatch) handle.unwatch(); };
}
