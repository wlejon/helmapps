/**
 * Exporting screenshots: dated filename formatting, PNG/JPEG encoding via
 * bro.image, Save, Save As, Copy to Clipboard, Open With, and Show in Files.
 */

import { api } from '/lib/dom.js';
import { userDirs, openFile, openApp, addRecent } from '/lib/files.js';
import { toast } from '/lib/toast.js';
import { renderFlattenedPixels } from './tools.js';

const fs = require('fs');
const path = require('path');

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Format a screenshot filename: "Screenshot YYYY-MM-DD HH-MM-SS.png".
 * @param {Date} [date=new Date()]
 * @param {string} [ext='png']
 * @returns {string}
 */
export function formatFilename(date = new Date(), ext = 'png') {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  const cleanExt = String(ext || 'png').replace(/^\./, '').toLowerCase() === 'jpg' ? 'jpg' : 'png';
  return `Screenshot ${yyyy}-${mm}-${dd} ${hh}-${min}-${ss}.${cleanExt}`;
}

/** Resolve the configured save folder, defaulting to ~/Pictures/Screenshots. */
export function getSaveFolder(settings) {
  const custom = settings && settings.get('saveFolder');
  if (custom && String(custom).trim()) return String(custom).trim();
  return path.join(userDirs().pictures, 'Screenshots');
}

/**
 * Write an RGBA8 image + annotations to `filePath` as PNG or JPEG.
 * @param {string} filePath
 * @param {{width: number, height: number, pixels: Uint8Array}} baseImage
 * @param {Array<object>} annotations
 * @param {number} [jpegQuality=90]
 * @returns {Promise<boolean>}
 */
export async function writeImageFile(filePath, baseImage, annotations = [], jpegQuality = 90) {
  const imgApi = api('image');
  if (!imgApi || !baseImage || !baseImage.width || !baseImage.height) return false;
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const flat = renderFlattenedPixels(baseImage, annotations);
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    const rgb = new Uint8Array(baseImage.width * baseImage.height * 3);
    imgApi.rgbaToRgb(rgb, flat, baseImage.width * baseImage.height);
    return !!imgApi.encodeJpegFile(filePath, rgb, baseImage.width, baseImage.height, 3, jpegQuality || 90);
  }
  return !!imgApi.encodePngFile(filePath, flat, baseImage.width, baseImage.height, 4);
}

/**
 * Save the current screenshot to the configured folder with a dated filename.
 * @returns {Promise<string|null>} Written file path, or null on failure
 */
export async function saveScreenshotToFolder({ state, settings, quiet = false }) {
  if (!state.image) return null;
  const ext = settings.get('format') === 'jpg' ? 'jpg' : 'png';
  const folder = getSaveFolder(settings);
  const name = formatFilename(new Date(), ext);
  const target = path.join(folder, name);
  try {
    const ok = await writeImageFile(target, state.image, state.annotations, settings.get('jpegQuality'));
    if (!ok) {
      if (!quiet) toast('Could not encode screenshot file', { error: true });
      return null;
    }
    state.lastSavedPath = target;
    addRecent(target);
    if (!quiet) {
      toast(`Saved ${name}`, { key: 'save', icon: 'check-circle' });
    }
    return target;
  } catch (err) {
    if (!quiet) toast(`Could not save: ${err.message || err}`, { error: true });
    return null;
  }
}

/**
 * Save the current screenshot via the native Save File dialog.
 * @returns {Promise<string|null>}
 */
export async function saveScreenshotAsDialog({ state, settings }) {
  if (!state.image) return null;
  const ext = settings.get('format') === 'jpg' ? 'jpg' : 'png';
  const defaultName = formatFilename(new Date(), ext);
  const filter = ext === 'jpg' ? 'JPEG Image|jpg;jpeg' : 'PNG Image|png';
  let chosen = null;
  if (typeof showSaveFileDialogAsync === 'function') {
    chosen = await showSaveFileDialogAsync(filter, defaultName);
  } else if (typeof showSaveFileDialog === 'function') {
    chosen = showSaveFileDialog(filter, defaultName);
  }
  if (!chosen) return null;
  try {
    const ok = await writeImageFile(chosen, state.image, state.annotations, settings.get('jpegQuality'));
    if (!ok) {
      toast('Could not save screenshot', { error: true });
      return null;
    }
    state.lastSavedPath = chosen;
    addRecent(chosen);
    toast(`Saved ${path.basename(chosen)}`, { key: 'save', icon: 'check-circle' });
    return chosen;
  } catch (err) {
    toast(`Could not save: ${err.message || err}`, { error: true });
    return null;
  }
}

/**
 * Copy the screenshot to the clipboard (as PNG image when supported, else
 * saves and copies the file path).
 */
export async function copyScreenshotToClipboard({ state, settings }) {
  if (!state.image) return false;
  const imgApi = api('image');
  if (
    imgApi &&
    typeof imgApi.encodePng === 'function' &&
    typeof ClipboardItem !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function'
  ) {
    try {
      const flat = renderFlattenedPixels(state.image, state.annotations);
      const pngBytes = imgApi.encodePng(flat, state.image.width, state.image.height, 4);
      if (pngBytes) {
        const blob = new Blob([pngBytes], { type: 'image/png' });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('Copied screenshot to clipboard', { key: 'copy', icon: 'copy' });
        return true;
      }
    } catch (_) {
      // Fall through to path copy
    }
  }
  // Fallback when image clipboard is unavailable: ensure saved and copy path
  let saved = state.lastSavedPath;
  if (!saved) {
    saved = await saveScreenshotToFolder({ state, settings, quiet: true });
  }
  if (saved && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(saved);
      toast('Copied screenshot path to clipboard', { key: 'copy', icon: 'copy' });
      return true;
    } catch (err) {
      toast(`Could not copy: ${err.message || err}`, { error: true });
      return false;
    }
  }
  toast('Copied screenshot path', { key: 'copy', icon: 'copy' });
  return !!saved;
}

export async function openSavedInViewer({ state, settings }) {
  let saved = state.lastSavedPath;
  if (!saved) saved = await saveScreenshotToFolder({ state, settings, quiet: true });
  if (!saved) return false;
  const ok = await openFile(saved);
  if (!ok) toast('No image viewer is installed to open this file', { error: true });
  return ok;
}

export async function showSavedInFiles({ state, settings }) {
  let saved = state.lastSavedPath;
  if (!saved) saved = await saveScreenshotToFolder({ state, settings, quiet: true });
  const dir = saved ? path.dirname(saved) : getSaveFolder(settings);
  const ok = await openApp('helm.files', [dir]);
  if (!ok) toast('The Files app is not installed', { error: true });
  return ok;
}
