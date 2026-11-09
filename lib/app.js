/**
 * The app's bootstrap. One call wires up what every helm app shares: the
 * shell's accent colour (live), tooltips, the command registry with its
 * keyboard handling, per-app settings, launch arguments and single-instance
 * hand-offs, plus window.app for tests.
 *
 *   import { startApp } from '/lib/app.js';
 *   const app = startApp({
 *     settings: { view: { type: 'string', default: 'grid' } },   // optional schema
 *   });
 *   app.commands.add({ id: 'quit', label: 'Quit', keys: ['Mod+Q'], run: () => app.quit() });
 *   app.onLaunch(({ argv, cwd, first }) => openPaths(argv, cwd));   // first launch and every later one
 *   app.expose({ list, openPath });     // window.app.list etc. for headless tests
 *   app.keep('view', () => ({ path, scroll }));   // across a reload: app.kept('view') in the new page
 *
 * app.id, app.name come from bro.json. app.settings is a lib/settings.js
 * Settings under the app's id. app.quit() quits (a no-op headless).
 */

import { api, attempt } from './dom.js';
import { Commands } from './commands.js';
import { Settings, shellPref, watchShellPrefs } from './settings.js';
import { installTooltips } from './tooltip.js';

/** Apply the shell's accent hue to the kit's tokens, now and on every change. */
export function followShellAccent() {
  const apply = (hue) => {
    const root = document.documentElement.style;
    const hv = Number(hue);
    if (!isFinite(hv)) return;
    root.setProperty('--accent-h', String(hv));
  };
  apply(shellPref('accentHue'));
  return watchShellPrefs((key, value) => { if (key === 'accentHue') apply(value); });
}

export function startApp({ settings: schema = null } = {}) {
  const meta = (typeof bro !== 'undefined' && bro.app) ? bro.app : null;
  const app = {
    id: meta && meta.id ? meta.id : 'helm.app',
    name: meta && meta.name ? meta.name : document.title || 'App',
    argv: meta ? Array.from(meta.argv || []) : [],
    cwd: meta ? meta.cwd : (typeof process !== 'undefined' ? process.cwd() : ''),
    headless: typeof screenshot === 'function',
    commands: new Commands(),
    settings: null,
    launchHandlers: [],
  };

  document.body.classList.add('kit');
  followShellAccent();
  installTooltips();
  app.commands.attach(window);
  if (schema) app.settings = new Settings(app.id, schema);

  /**
   * fn({ argv, cwd, first }) for the first launch (now, on the next tick, so
   * the app finishes building first) and for every later launch handed over
   * by single-instance ("singleInstance": true in bro.json).
   */
  app.onLaunch = (fn) => {
    app.launchHandlers.push(fn);
    if (app.launchHandlers.length === 1) {
      setTimeout(() => {
        for (const h of app.launchHandlers) attempt('launch handler', () => h({ argv: app.argv, cwd: app.cwd, first: true }));
      }, 0);
    }
  };
  if (meta && typeof meta.addEventListener === 'function') {
    meta.addEventListener('instance', (e) => {
      for (const h of app.launchHandlers) attempt('instance handler', () => h({ argv: Array.from(e.argv || []), cwd: e.cwd, first: false }));
    });
  }

  /** Another window of this app (its own process). */
  app.newWindow = (args = []) => {
    if (meta && typeof meta.spawn === 'function') return meta.spawn(args, { newInstance: true });
    return false;
  };

  app.quit = () => {
    if (typeof bro !== 'undefined' && typeof bro.quit === 'function') bro.quit();
  };

  /** The window title: "<doc> — <App name>", or the app name alone. */
  app.setTitle = (doc) => {
    document.title = doc ? `${doc} — ${app.name}` : app.name;
  };

  /**
   * Keep something across a reload (bro reloads the page when the app's
   * source changes, and on F5): save() answers a JSON-able value as the old
   * page goes (its pagehide), and app.kept(name) answers it in the new page,
   * once (undefined when there was no reload, or it was already taken), for
   * the app to put back when it is ready to. Nothing is kept across a quit:
   * the values live in sessionStorage, which lasts as long as the process.
   */
  app.keep = (name, save) => { keepers.set(name, save); };
  app.kept = (name) => {
    if (!Object.prototype.hasOwnProperty.call(kept, name)) return undefined;
    const value = kept[name];
    delete kept[name];
    return value;
  };
  const keepKey = `helm.keep.${app.id}`;
  const keepers = new Map();
  let kept = {};
  try {
    kept = JSON.parse(sessionStorage.getItem(keepKey) || '{}') || {};
    sessionStorage.removeItem(keepKey);
  } catch (_) { kept = {}; }
  window.addEventListener('pagehide', () => {
    const out = {};
    for (const [name, save] of keepers) attempt(`keeping ${name}`, () => { out[name] = save(); });
    try { sessionStorage.setItem(keepKey, JSON.stringify(out)); } catch (_) { /* nothing kept */ }
  });

  /** Put things on window.app for headless tests (and the inspector). */
  app.expose = (obj) => Object.assign(app, obj);

  window.app = app;
  return app;
}

/** Whether bro.<name> is available (re-exported for convenience). */
export { api };
