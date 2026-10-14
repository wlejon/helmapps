/**
 * Inspector & Quick Preview pane for Archive Manager (helm.archives).
 * Shows entry metadata (Name, Path, Unpacked Size, Packed Size, Ratio %,
 * Modified, CRC-32 / Method) and an inline preview for text/code/json/md
 * (up to 64 KB UTF-8) or images without full archive extraction.
 */

import { h, replaceChildren } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { emptyState } from '/lib/layout.js';
import { formatBytes, formatDateLong, formatPercent, formatCount } from '/lib/format.js';
import { kindOf, iconFor, mimeOf } from '/lib/files.js';
import { readEntry } from './archive-codec.js';

const MAX_TEXT_PREVIEW_BYTES = 64 * 1024;
const textDecoder = new TextDecoder('utf-8', { fatal: false });

function isTextPreviewable(name, kind) {
  if (kind === 'text' || kind === 'code') return true;
  const lower = String(name || '').toLowerCase();
  return lower.endsWith('.json') || lower.endsWith('.md') || lower.endsWith('.txt') ||
    lower.endsWith('.csv') || lower.endsWith('.xml') || lower.endsWith('.svg') ||
    lower.endsWith('.yml') || lower.endsWith('.yaml') || lower.endsWith('.ini') ||
    lower.endsWith('.toml') || lower.endsWith('.log') || lower.endsWith('.sh');
}

function uint8ToBase64(u8) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.byteLength; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function metaRow(label, value, isNum = false) {
  return h('div.inspector-row',
    h('span.inspector-label', label),
    h(`span.inspector-value${isNum ? '.num' : ''}`, value),
  );
}

export class ArchiveInspector {
  constructor() {
    this.el = h('aside.inspector-pane');
    this.currentEntry = null;
    this.previewText = '';
    this.reqSeq = 0;
    this.showEmpty();
  }

  showEmpty(archive = null) {
    this.currentEntry = null;
    this.previewText = '';
    if (!archive) {
      replaceChildren(this.el, emptyState({
        icon: 'file-archive',
        title: 'No Selection',
        hint: 'Select an entry to inspect its metadata and quick preview.',
      }));
      return;
    }

    const saved = archive.totalSize > 0
      ? Math.max(0, 1 - (archive.totalPackedSize / archive.totalSize))
      : 0;

    replaceChildren(this.el,
      h('div.inspector-header',
        h('div.inspector-glyph', icon('file-archive', 'lg')),
        h('div.inspector-title-wrap',
          h('div.inspector-title', archive.name || 'Archive'),
          h('div.inspector-subtitle', archive.format ? archive.format.toUpperCase() : 'ARCHIVE'),
        ),
      ),
      h('div.inspector-meta',
        metaRow('Format', (archive.format || 'zip').toUpperCase()),
        metaRow('Files', formatCount(archive.fileCount || 0, 'file'), true),
        metaRow('Folders', formatCount(archive.dirCount || 0, 'folder'), true),
        metaRow('Unpacked Size', formatBytes(archive.totalSize || 0), true),
        metaRow('Packed Size', formatBytes(archive.totalPackedSize || 0), true),
        metaRow('Space Saved', formatPercent(saved, 0), true),
      ),
      emptyState({
        icon: 'info',
        title: 'Select an Item',
        hint: 'Click a file or folder in the list to preview its contents.',
      }),
    );
  }

  async inspect(archive, entries) {
    const seq = ++this.reqSeq;
    if (!archive || !entries || entries.length === 0) {
      this.showEmpty(archive);
      return;
    }

    if (entries.length > 1) {
      this.currentEntry = null;
      this.previewText = '';
      const totalUnpacked = entries.reduce((s, e) => s + (e.size || 0), 0);
      const totalPacked = entries.reduce((s, e) => s + (e.packedSize || 0), 0);
      replaceChildren(this.el,
        h('div.inspector-header',
          h('div.inspector-glyph', icon('layers', 'lg')),
          h('div.inspector-title-wrap',
            h('div.inspector-title', formatCount(entries.length, 'item') + ' selected'),
            h('div.inspector-subtitle', archive.name || ''),
          ),
        ),
        h('div.inspector-meta',
          metaRow('Selected Items', String(entries.length), true),
          metaRow('Unpacked Size', formatBytes(totalUnpacked), true),
          metaRow('Packed Size', formatBytes(totalPacked), true),
        ),
      );
      return;
    }

    const entry = entries[0];
    this.currentEntry = entry;
    this.previewText = '';
    const kind = kindOf(entry.name, entry.isDirectory);
    const glyphIcon = iconFor({ name: entry.name, isDir: entry.isDirectory });
    const ratioPct = entry.isDirectory
      ? '—'
      : formatPercent(entry.size > 0 ? Math.min(1, entry.packedSize / entry.size) : 1, 0);
    const crcHex = entry.isDirectory || !entry.crc32
      ? '—'
      : (entry.crc32 >>> 0).toString(16).toUpperCase().padStart(8, '0');

    const previewSection = h('div.inspector-preview-section');

    replaceChildren(this.el,
      h('div.inspector-header',
        h('div.inspector-glyph', icon(glyphIcon, 'lg')),
        h('div.inspector-title-wrap',
          h('div.inspector-title', entry.name),
          h('div.inspector-subtitle.mono', entry.path),
        ),
      ),
      h('div.inspector-meta',
        metaRow('Kind', kind),
        metaRow('Path', entry.path),
        metaRow('Unpacked Size', entry.isDirectory ? '—' : formatBytes(entry.size), true),
        metaRow('Packed Size', entry.isDirectory ? '—' : formatBytes(entry.packedSize), true),
        metaRow('Compression Ratio', ratioPct, true),
        metaRow('Modified', formatDateLong(entry.mtimeMs), true),
        metaRow('Method', entry.method || 'store'),
        metaRow('CRC-32', crcHex, true),
      ),
      previewSection,
    );

    if (entry.isDirectory) {
      const childCount = archive.entries.filter((e) => e.parentPath === entry.path).length;
      previewSection.appendChild(emptyState({
        icon: 'folder',
        title: entry.name,
        hint: `${formatCount(childCount, 'item')} in this folder`,
      }));
      return;
    }

    if (isTextPreviewable(entry.name, kind)) {
      try {
        const bytes = await readEntry(archive, entry);
        if (seq !== this.reqSeq) return;
        const slice = bytes.byteLength > MAX_TEXT_PREVIEW_BYTES
          ? bytes.subarray(0, MAX_TEXT_PREVIEW_BYTES)
          : bytes;
        const decoded = textDecoder.decode(slice);
        this.previewText = decoded;
        const truncated = bytes.byteLength > MAX_TEXT_PREVIEW_BYTES;
        replaceChildren(previewSection,
          h('div.micro', truncated ? 'PREVIEW (FIRST 64 KB)' : 'PREVIEW'),
          h('pre.inspector-preview-box.selectable', decoded || '(Empty file)'),
        );
      } catch (err) {
        if (seq !== this.reqSeq) return;
        replaceChildren(previewSection, emptyState({
          icon: 'alert',
          title: 'Preview unavailable',
          hint: err.message,
        }));
      }
      return;
    }

    if (kind === 'image' && entry.size <= 8 * 1024 * 1024) {
      try {
        const bytes = await readEntry(archive, entry);
        if (seq !== this.reqSeq) return;
        const mime = mimeOf(entry.name, false);
        const dataUrl = `data:${mime};base64,${uint8ToBase64(bytes)}`;
        replaceChildren(previewSection,
          h('div.micro', 'IMAGE PREVIEW'),
          h('div.inspector-image-wrap', h('img', { src: dataUrl, alt: entry.name })),
        );
      } catch (err) {
        if (seq !== this.reqSeq) return;
        replaceChildren(previewSection, emptyState({
          icon: 'alert',
          title: 'Image preview unavailable',
          hint: err.message,
        }));
      }
      return;
    }

    replaceChildren(previewSection, emptyState({
      icon: glyphIcon,
      title: 'Binary File',
      hint: `${formatBytes(entry.size)} • Extract to open with external application`,
    }));
  }
}
