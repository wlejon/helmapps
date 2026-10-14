/**
 * Right-side Inspector panel for Character Map.
 * Displays the large glyph preview, favorite toggle, character name & block badge,
 * primary actions ("Copy Character", "Append to Buffer"), all 7 copyable encoding
 * rows, and a strip of related/similar characters.
 */

import { h } from '/lib/dom.js';
import { icon } from '/lib/icons.js';
import { emptyState } from '/lib/layout.js';
import { getEncodings, getRelatedChars } from './unicode-data.js';

const ENCODING_FIELDS = [
  { id: 'char', label: 'Character' },
  { id: 'codepoint', label: 'Codepoint' },
  { id: 'utf8', label: 'UTF-8 Bytes' },
  { id: 'utf16', label: 'UTF-16 Units' },
  { id: 'html', label: 'HTML Entity' },
  { id: 'css', label: 'CSS Escape' },
  { id: 'js', label: 'JS / JSON Escape' },
];

const MAX_RELATED = 10;

export class Inspector {
  constructor({ onCopyValue, onCopyChar, onAppendChar, onToggleFavorite, onSelectChar } = {}) {
    this.onCopyValue = onCopyValue;
    this.onCopyChar = onCopyChar;
    this.onAppendChar = onAppendChar;
    this.onToggleFavorite = onToggleFavorite;
    this.onSelectChar = onSelectChar;
    this.current = null;
    this.encodings = null;

    this.favBtn = h('button.icon-btn.cm-fav-btn', {
      'aria-label': 'Toggle Favorite',
      'data-tip': 'Toggle Favorite',
      'data-keys': 'Mod+D',
      onclick: () => { if (this.current && this.onToggleFavorite) this.onToggleFavorite(this.current.cp); },
    }, icon('star'));

    this.glyphEl = h('div.cm-preview-glyph');
    this.nameEl = h('div.cm-preview-name');
    this.codeBadge = h('span.cm-badge.code');
    this.blockBadge = h('span.cm-badge.block');

    this.previewCard = h('div.cm-preview-card',
      this.favBtn,
      this.glyphEl,
      this.nameEl,
      h('div.cm-preview-meta', this.codeBadge, this.blockBadge)
    );

    this.copyCharBtn = h('button.btn.primary.cm-copy-char-btn', {
      'data-tip': 'Copy Character',
      'data-keys': 'Mod+C',
      onclick: () => { if (this.current && this.onCopyChar) this.onCopyChar(this.current); },
    }, icon('copy'), 'Copy Character');

    this.appendBtn = h('button.btn.cm-append-btn', {
      'data-tip': 'Append to Buffer',
      'data-keys': 'Enter',
      onclick: () => { if (this.current && this.onAppendChar) this.onAppendChar(this.current); },
    }, icon('plus'), 'Append to Buffer');

    this.actionRow = h('div.cm-inspector-actions', this.copyCharBtn, this.appendBtn);

    this.valueEls = new Map();
    this.encodingRows = ENCODING_FIELDS.map((field) => {
      const valEl = h('div.cm-enc-val', { 'data-encoding': field.id });
      this.valueEls.set(field.id, valEl);
      const copyBtn = h('button.icon-btn.small.cm-enc-copy', {
        'aria-label': `Copy ${field.label}`,
        'data-tip': `Copy ${field.label}`,
        'data-encoding-copy': field.id,
        onclick: () => {
          if (!this.encodings || !this.onCopyValue) return;
          const val = this.encodings[field.id];
          this.onCopyValue(val, field.label);
        },
      }, icon('copy', 'sm'));
      return h('div.cm-enc-row', { 'data-encoding-row': field.id },
        h('div.cm-enc-info',
          h('div.cm-enc-label', field.label),
          valEl),
        copyBtn
      );
    });

    this.encodingsGroup = h('div.group',
      h('div.micro', 'ENCODINGS'),
      h('div.cm-encodings', ...this.encodingRows)
    );

    this.relatedChips = [];
    for (let i = 0; i < MAX_RELATED; i++) {
      const chip = h('button.cm-related-chip.hidden', {
        onclick: () => {
          const cp = Number(chip.dataset.cp);
          if (cp && this.onSelectChar) this.onSelectChar(cp);
        },
      });
      this.relatedChips.push(chip);
    }
    this.relatedStrip = h('div.cm-related-strip', ...this.relatedChips);
    this.relatedSection = h('div.cm-related-section',
      h('div.micro', 'RELATED CHARACTERS'),
      this.relatedStrip
    );

    this.bodyEl = h('div.cm-inspector',
      this.previewCard,
      this.actionRow,
      this.encodingsGroup,
      this.relatedSection
    );

    this.emptyEl = emptyState({
      icon: 'type',
      title: 'No character selected',
      hint: 'Click a character in the grid or list to inspect its encodings.',
    });
    this.emptyEl.classList.add('hidden');

    this.el = h('aside', {
      style: { display: 'flex', flexDirection: 'column', flex: '1 1 0px', minWidth: '0', minHeight: '0' },
    }, this.bodyEl, this.emptyEl);
  }

  setChar(entry, isFav = false) {
    if (this.current && entry && this.current.cp === entry.cp) {
      this.setFavoriteState(isFav);
      return;
    }
    this.current = entry || null;
    if (!entry) {
      this.encodings = null;
      this.bodyEl.classList.add('hidden');
      this.emptyEl.classList.remove('hidden');
      return;
    }
    this.emptyEl.classList.add('hidden');
    this.bodyEl.classList.remove('hidden');

    const enc = getEncodings(entry.cp);
    this.encodings = enc;

    this.glyphEl.textContent = entry.cp === 0x0020 ? '␣' : entry.char;
    this.nameEl.textContent = entry.name;
    this.codeBadge.textContent = enc.codepoint;
    this.blockBadge.textContent = entry.blockName;
    this.setFavoriteState(isFav);

    for (const field of ENCODING_FIELDS) {
      const el = this.valueEls.get(field.id);
      if (el) el.textContent = enc[field.id];
    }

    const related = getRelatedChars(entry.cp, MAX_RELATED);
    for (let i = 0; i < MAX_RELATED; i++) {
      const chip = this.relatedChips[i];
      const rel = related[i];
      if (rel) {
        chip.textContent = rel.cp === 0x0020 ? '␣' : rel.char;
        chip.dataset.cp = String(rel.cp);
        chip.title = `${rel.name} (${rel.codepoint})`;
        chip.classList.remove('hidden');
      } else {
        chip.classList.add('hidden');
      }
    }
  }

  setFavoriteState(isFav) {
    this.favBtn.classList.toggle('is-fav', !!isFav);
    this.favBtn.setAttribute('aria-pressed', String(!!isFav));
  }
}
