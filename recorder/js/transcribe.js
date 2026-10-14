/**
 * On-device speech-to-text transcription wrapper around `bro.stt` (`api('stt')`).
 * Supports Parakeet and Whisper checkpoints when `sttModelDir` is configured in
 * settings and present on disk, or an injected test transcriber via
 * `setMockTranscriber(fn)`. When no model is installed, reports a clean
 * unavailable status (`On-device STT available when model installed`) and never
 * fakes a transcript.
 */

import { api } from '/lib/dom.js';

const fs = require('fs');
const path = require('path');

export class Transcriber {
  constructor({ settings, onStatusChange } = {}) {
    this.settings = settings || null;
    this.onStatusChange = onStatusChange || null;
    this.mockFn = null;
    this.modelDir = '';
    this.modelReady = false;
    this.busy = false;
    this._model = null;
    this._tokenizer = null;
    this._modelKind = ''; // 'parakeet' | 'whisper'
  }

  /**
   * Inject or clear a mock transcriber for headless tests.
   * @param {((audio: {samples: Float32Array, sampleRate: number}, item: Object) => Promise<string>|string)|null} fn
   */
  setMockTranscriber(fn) {
    this.mockFn = typeof fn === 'function' ? fn : null;
    this._notify();
  }

  /** Whether transcription can be run right now (mock injected or model installed). */
  isAvailable() {
    if (this.mockFn) return true;
    return !!(api('stt') && this.modelReady);
  }

  /** Human-readable status hint for the Inspector badge. */
  statusHint() {
    if (this.busy) return 'Transcribing audio…';
    if (this.mockFn) return 'On-device STT ready';
    const stt = api('stt');
    if (!stt) return 'On-device STT available when model installed';
    if (!this.modelReady) return 'On-device STT available when model installed';
    return `On-device STT ready (${this._modelKind || 'model'})`;
  }

  /**
   * Asynchronously probe whether `sttModelDir` in settings points to an installed
   * Whisper or Parakeet model directory.
   */
  async checkModelDir() {
    const dir = this.settings ? String(this.settings.get('sttModelDir') || '').trim() : '';
    this.modelDir = dir;
    if (!dir || !api('stt')) {
      this.modelReady = false;
      this._notify();
      return false;
    }
    try {
      const st = await fs.promises.stat(path.join(dir, 'model.safetensors'));
      this.modelReady = !!(st && st.isFile());
    } catch (_) {
      this.modelReady = false;
    }
    this._notify();
    return this.modelReady;
  }

  /**
   * Transcribe decoded audio `{ samples, sampleRate }` for a recording item.
   * @param {{ samples: Float32Array, sampleRate: number }} audio
   * @param {Object} item
   * @returns {Promise<string>}
   */
  async transcribe(audio, item) {
    if (!this.isAvailable()) {
      throw new Error('No STT model is installed');
    }
    this.busy = true;
    this._notify();
    try {
      if (this.mockFn) {
        const res = await this.mockFn(audio, item);
        return String(res == null ? '' : res).trim();
      }
      return await this._runNativeStt(audio);
    } finally {
      this.busy = false;
      this._notify();
    }
  }

  async _runNativeStt(audio) {
    const stt = api('stt');
    if (!stt) throw new Error('bro.stt is unavailable');
    const dir = this.modelDir;
    if (!dir) throw new Error('No STT model directory configured');

    if (!this._model) {
      let hasVocab = false;
      try {
        const st = await fs.promises.stat(path.join(dir, 'vocab.json'));
        hasVocab = !!(st && st.isFile());
      } catch (_) {}

      if (hasVocab && typeof stt.loadWhisper === 'function') {
        this._modelKind = 'whisper';
        this._model = await new Promise((resolve, reject) => {
          stt.loadWhisper(dir, { onReady: resolve, onError: (m) => reject(new Error(m)) });
        });
        this._tokenizer = await new Promise((resolve, reject) => {
          stt.loadTokenizer({
            vocabPath: path.join(dir, 'vocab.json'),
            mergesPath: path.join(dir, 'merges.txt'),
            onReady: resolve,
            onError: (m) => reject(new Error(m)),
          });
        });
      } else if (typeof stt.loadParakeet === 'function') {
        this._modelKind = 'parakeet';
        this._model = await new Promise((resolve, reject) => {
          stt.loadParakeet(dir, { onReady: resolve, onError: (m) => reject(new Error(m)) });
        });
      } else {
        throw new Error('Unsupported STT model format');
      }
    }

    const buf = { samples: audio.samples, sampleRate: audio.sampleRate || 16000 };
    if (this._modelKind === 'whisper') {
      const prompt = this._tokenizer.buildPrompt('en', 'transcribe', false);
      const ids = await new Promise((resolve, reject) => {
        this._model.transcribe(buf, prompt, {
          onDone: (outIds, info) => {
            if (info && info.error) reject(new Error(info.error));
            else resolve(outIds);
          },
        });
      });
      return this._tokenizer.decode(ids, true).trim();
    }

    const result = await new Promise((resolve, reject) => {
      this._model.transcribe(buf, {
        onDone: (res, info) => {
          if (info && info.error) reject(new Error(info.error));
          else resolve(res);
        },
      });
    });
    const tok = this._model.tokenizer;
    return tok && result && result.tokenIds ? tok.decode(result.tokenIds).trim() : '';
  }

  _notify() {
    if (this.onStatusChange) this.onStatusChange();
  }
}
