/**
 * Files and paths, as every app needs them: the user's folders, a file's
 * kind and icon, opening a file with its default app, recording recent
 * files. Built on brokit's Node modules (fs, path, os) and bro.vfs / bro.apps
 * where present.
 *
 *   import { userDirs, kindOf, iconFor, openFile, addRecent, basename } from '/lib/files.js';
 *   userDirs().pictures            '/home/j/Pictures' (XDG user-dirs on Linux)
 *   kindOf('a.png')                'image'
 *   iconFor({ name: 'a.png' })     'file-image'
 *   await openFile('/home/j/a.pdf')   true when an app was launched for it
 *
 * File I/O itself is plain Node: const fs = require('fs'); fs.readFileSync(p, 'utf8'),
 * fs.promises.readdir(dir, { withFileTypes: true }), ... (docs/brokit-api.js).
 * Prefer the async forms for anything that may be large or slow (network
 * mounts), so the window stays responsive.
 */

import { api, attempt } from './dom.js';

const fs = require('fs');
const path = require('path');
const os = require('os');

export const sep = path.sep;
export const basename = (p) => path.basename(p);
export const dirname = (p) => path.dirname(p);
export const extname = (p) => path.extname(p).slice(1).toLowerCase();
export const join = (...parts) => path.join(...parts);

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = !isWindows && !isMac;

export function homeDir() {
  return os.homedir();
}

/** Hidden by convention: a dot file (all platforms). */
export function isHidden(name) {
  return name.startsWith('.');
}

let dirsCache = null;

/**
 * The user's standard folders: { home, desktop, documents, downloads, music,
 * pictures, videos, templates, publicShare }. On Linux these follow
 * ~/.config/user-dirs.dirs; elsewhere the platform's names under home. A
 * folder that does not exist is still answered (the app checks).
 */
export function userDirs() {
  if (dirsCache) return dirsCache;
  const home = homeDir();
  const d = {
    home,
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents'),
    downloads: path.join(home, 'Downloads'),
    music: path.join(home, 'Music'),
    pictures: path.join(home, 'Pictures'),
    videos: path.join(home, isMac ? 'Movies' : 'Videos'),
    templates: path.join(home, 'Templates'),
    publicShare: path.join(home, 'Public'),
  };
  if (isLinux) {
    const cfg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const text = attempt('user-dirs.dirs', () => fs.readFileSync(path.join(cfg, 'user-dirs.dirs'), 'utf8'), '');
    const keys = { DESKTOP: 'desktop', DOCUMENTS: 'documents', DOWNLOAD: 'downloads', MUSIC: 'music',
      PICTURES: 'pictures', VIDEOS: 'videos', TEMPLATES: 'templates', PUBLICSHARE: 'publicShare' };
    for (const line of text.split('\n')) {
      const m = /^XDG_([A-Z]+)_DIR="(.*)"$/.exec(line.trim());
      if (m && keys[m[1]]) d[keys[m[1]]] = m[2].replace(/^\$HOME/, home);
    }
  }
  dirsCache = d;
  return d;
}

/** stat that answers null instead of throwing. */
export function statOrNull(p) {
  try { return fs.statSync(p); } catch (_) { return null; }
}

export function exists(p) {
  return statOrNull(p) != null;
}

export function isDirectory(p) {
  const s = statOrNull(p);
  return !!(s && s.isDirectory());
}

// ---- kinds, MIME types, icons -----------------------------------------------

const KIND_BY_EXT = {
  image: 'png jpg jpeg gif webp bmp tif tiff svg ico heic avif tga psd exr hdr qoi',
  audio: 'mp3 wav flac ogg oga opus m4a aac wma aiff mid midi',
  video: 'mp4 mkv webm mov avi wmv m4v mpg mpeg flv',
  archive: 'zip tar gz tgz bz2 xz zst 7z rar deb rpm',
  code: 'js mjs cjs ts tsx jsx c h cc cpp hpp cxx rs go py rb java kt swift cs php sh bash zsh ps1 lua zig css scss html htm xml json jsonc yaml yml toml ini cmake glsl hlsl wgsl sql',
  text: 'txt md markdown rst log csv tsv conf cfg nfo',
  document: 'pdf epub doc docx odt rtf xls xlsx ods ppt pptx odp',
  font: 'ttf otf woff woff2',
  model: 'gltf glb obj fbx stl ply',
};

const EXT_KIND = {};
for (const [kind, list] of Object.entries(KIND_BY_EXT)) for (const e of list.split(' ')) EXT_KIND[e] = kind;

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', ico: 'image/x-icon', avif: 'image/avif', heic: 'image/heic',
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus', m4a: 'audio/mp4',
  mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', '7z': 'application/x-7z-compressed',
  pdf: 'application/pdf', json: 'application/json', xml: 'application/xml', html: 'text/html', htm: 'text/html',
  css: 'text/css', js: 'text/javascript', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

/** 'folder' | 'image' | 'audio' | 'video' | 'archive' | 'code' | 'text' | 'document' | 'font' | 'model' | 'file' */
export function kindOf(name, isDir = false) {
  if (isDir) return 'folder';
  return EXT_KIND[extname(name)] || 'file';
}

/** The MIME type: bro.vfs's detection when present (it sniffs content), else by extension. */
export function mimeOf(p, isDir = false) {
  if (isDir) return 'inode/directory';
  const vfs = api('vfs');
  const sniffed = vfs ? attempt('vfs.getMime', () => vfs.getMime(p), null) : null;
  if (sniffed) return sniffed;
  const kind = kindOf(p);
  return MIME_BY_EXT[extname(p)] || (kind === 'text' || kind === 'code' ? 'text/plain' : 'application/octet-stream');
}

const ICON_BY_KIND = {
  folder: 'folder', image: 'file-image', audio: 'file-audio', video: 'file-video', archive: 'file-archive',
  code: 'file-code', text: 'file-text', document: 'file-text', font: 'type', model: 'package', file: 'file',
};

/** A kit icon name (lib/icons.js) for an entry { name, isDir? }. */
export function iconFor(entry) {
  return ICON_BY_KIND[kindOf(entry.name || '', !!entry.isDir)] || 'file';
}

// ---- opening -------------------------------------------------------------------

/** The app that opens this MIME type by default ({ id, name, icon }) or null. */
export function defaultAppFor(mime) {
  const apps = api('apps');
  return apps ? attempt('apps.getDefaultApp', () => apps.getDefaultApp(mime), null) : null;
}

/** Every app that says it opens this MIME type. */
export function appsFor(mime) {
  const apps = api('apps');
  return apps ? attempt('apps.getAppsForMime', () => apps.getAppsForMime(mime), []) || [] : [];
}

/**
 * Open files with an app: appId (a desktop id, 'org.example.App.desktop')
 * or, when omitted, the default app for the first file's MIME type. Answers
 * true when an app was launched. bro.apps is the only launcher; when it is
 * missing this answers false and the app says so (no shell-outs).
 */
export async function openFile(paths, appId) {
  const list = Array.isArray(paths) ? paths : [paths];
  if (!list.length) return false;
  const apps = api('apps');
  if (!apps) return false;
  let id = appId;
  if (!id) {
    const app = defaultAppFor(mimeOf(list[0], isDirectory(list[0])));
    id = app && app.id;
  }
  if (!id) return false;
  try {
    await apps.launch(id, { files: list });
    for (const p of list) addRecent(p, id);
    return true;
  } catch (err) {
    console.warn(`openFile: ${id}: ${err && err.message}`);
    return false;
  }
}

/**
 * Start another helm app by its bro app id ('helm.files') with arguments.
 * Uses the desktop entry `bro --install` writes (Linux); answers false where
 * there is none (Windows, an app not installed). See GAPS.md: bro has no
 * cross-platform "open app by id" yet.
 */
export async function openApp(id, args = []) {
  const apps = api('apps');
  if (!apps) return false;
  try {
    await apps.launch(`${id}.desktop`, { args });
    return true;
  } catch (err) {
    console.warn(`openApp: ${id}: ${err && err.message}`);
    return false;
  }
}

/** Record a file in the system's recent list (bro.apps), when available. */
export function addRecent(p, appId) {
  const apps = api('apps');
  const id = appId || (typeof bro !== 'undefined' && bro.app && bro.app.id ? `${bro.app.id}.desktop` : '');
  if (apps) attempt('apps.addRecent', () => apps.addRecent(p, id));
}
