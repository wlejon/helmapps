/**
 * Pure JavaScript 16-bit PCM RIFF WAVE (.wav) encoder, decoder, header parser,
 * and waveform peak-envelope calculator.
 */

const fs = require('fs');

/**
 * Compute a downsampled peak envelope (0..1) of `numBins` bins from float PCM.
 * @param {Float32Array|Array<number>} samples
 * @param {number} [numBins=256]
 * @param {number} [channels=1]
 * @returns {Float32Array}
 */
export function computePeaks(samples, numBins = 256, channels = 1) {
  const bins = Math.max(1, Math.floor(numBins));
  const out = new Float32Array(bins);
  if (!samples || !samples.length) return out;
  const ch = Math.max(1, Math.floor(channels));
  const totalFrames = Math.floor(samples.length / ch);
  if (totalFrames <= 0) return out;

  for (let b = 0; b < bins; b++) {
    const startFrame = Math.floor((b * totalFrames) / bins);
    const endFrame = Math.max(startFrame + 1, Math.floor(((b + 1) * totalFrames) / bins));
    let max = 0;
    const endIdx = Math.min(samples.length, endFrame * ch);
    // Step to bound work on huge buffers while remaining accurate on normal clips
    const span = endIdx - startFrame * ch;
    const step = span > 4096 ? Math.floor(span / 1024) * ch : 1;
    for (let i = startFrame * ch; i < endIdx; i += step) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    out[b] = Math.min(1, max);
  }
  return out;
}

/**
 * Encode Float32Array PCM samples (-1..1) into a standard 44-byte RIFF WAVE
 * 16-bit signed little-endian PCM Uint8Array.
 * @param {Float32Array|Array<number>} samplesFloat32
 * @param {number} sampleRate
 * @param {number} [numChannels=1]
 * @returns {Uint8Array}
 */
export function encodeWav(samplesFloat32, sampleRate = 48000, numChannels = 1) {
  const samples = samplesFloat32 || new Float32Array(0);
  const rate = Math.max(1, Math.round(Number(sampleRate) || 48000));
  const channels = Math.max(1, Math.min(32, Math.round(Number(numChannels) || 1)));
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataBytes = numSamples * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const byteRate = rate * blockAlign;

  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  // RIFF chunk descriptor
  writeAscii(out, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(out, 8, 'WAVE');

  // 'fmt ' sub-chunk (16 bytes for PCM)
  writeAscii(out, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // audioFormat = 1 (PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bitsPerSample = 16

  // 'data' sub-chunk
  writeAscii(out, 36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    let s = samples[i];
    if (!isFinite(s)) s = 0;
    else if (s > 1) s = 1;
    else if (s < -1) s = -1;
    const pcm = s < 0 ? Math.max(-32768, Math.round(s * 32768)) : Math.min(32767, Math.round(s * 32767));
    view.setInt16(offset, pcm, true);
    offset += 2;
  }

  return out;
}

/**
 * Parse the RIFF WAVE header from the leading bytes of a WAV file.
 * @param {Uint8Array|ArrayBuffer} bytesInput
 * @returns {{ sampleRate: number, channels: number, bitsPerSample: number, audioFormat: number, blockAlign: number, dataOffset: number, dataBytes: number, numFrames: number, duration: number }}
 */
export function parseWavHeader(bytesInput) {
  const bytes = toUint8Array(bytesInput);
  if (bytes.byteLength < 44) {
    throw new Error('Invalid WAV: buffer shorter than 44 bytes');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WAVE') {
    throw new Error('Invalid WAV: missing RIFF/WAVE signature');
  }

  let audioFormat = 1;
  let channels = 1;
  let sampleRate = 48000;
  let bitsPerSample = 16;
  let blockAlign = 2;
  let fmtFound = false;
  let dataOffset = -1;
  let dataBytes = 0;

  let pos = 12;
  while (pos + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, pos, 4);
    const chunkSize = view.getUint32(pos + 4, true);
    const bodyStart = pos + 8;

    if (chunkId === 'fmt ') {
      if (bodyStart + 16 > bytes.byteLength) {
        throw new Error('Invalid WAV: truncated fmt chunk');
      }
      audioFormat = view.getUint16(bodyStart, true);
      channels = Math.max(1, view.getUint16(bodyStart + 2, true));
      sampleRate = Math.max(1, view.getUint32(bodyStart + 4, true));
      blockAlign = view.getUint16(bodyStart + 12, true);
      bitsPerSample = view.getUint16(bodyStart + 14, true);
      if (!blockAlign) blockAlign = Math.max(1, channels * Math.ceil(bitsPerSample / 8));
      fmtFound = true;
    } else if (chunkId === 'data') {
      dataOffset = bodyStart;
      dataBytes = chunkSize;
      break;
    }

    // RIFF chunks are word-aligned (padded to even byte boundary)
    const paddedSize = chunkSize + (chunkSize & 1);
    pos = bodyStart + paddedSize;
  }

  if (!fmtFound || dataOffset < 0) {
    throw new Error('Invalid WAV: missing fmt or data chunk');
  }

  const bytesPerFrame = Math.max(1, blockAlign || (channels * Math.max(1, bitsPerSample >> 3)));
  const numFrames = Math.floor(dataBytes / bytesPerFrame);
  const duration = sampleRate > 0 ? numFrames / sampleRate : 0;

  return {
    audioFormat,
    channels,
    sampleRate,
    bitsPerSample,
    blockAlign: bytesPerFrame,
    dataOffset,
    dataBytes,
    numFrames,
    duration,
  };
}

/**
 * Decode a RIFF WAVE Uint8Array into Float32Array samples and a downsampled peak envelope.
 * Supports 16-bit signed PCM, 8-bit unsigned PCM, 24-bit signed PCM, 32-bit signed PCM,
 * and 32-bit IEEE float WAVE files.
 * @param {Uint8Array|ArrayBuffer} bytesInput
 * @param {number} [peakBins=256]
 * @returns {{ sampleRate: number, channels: number, bitsPerSample: number, duration: number, numFrames: number, samples: Float32Array, peaks: Float32Array }}
 */
export function decodeWav(bytesInput, peakBins = 256) {
  const bytes = toUint8Array(bytesInput);
  const hdr = parseWavHeader(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const availBytes = Math.max(0, Math.min(hdr.dataBytes, bytes.byteLength - hdr.dataOffset));
  const bytesPerSample = Math.max(1, hdr.bitsPerSample >> 3);
  const totalSamples = Math.floor(availBytes / bytesPerSample);
  const numFrames = Math.floor(totalSamples / hdr.channels);
  const duration = hdr.sampleRate > 0 ? numFrames / hdr.sampleRate : 0;
  const samples = new Float32Array(numFrames * hdr.channels);

  let offset = hdr.dataOffset;
  const count = samples.length;

  if (hdr.audioFormat === 3 && hdr.bitsPerSample === 32) {
    // 32-bit IEEE float
    for (let i = 0; i < count; i++, offset += 4) {
      const v = view.getFloat32(offset, true);
      samples[i] = isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
    }
  } else if (hdr.bitsPerSample === 16) {
    // 16-bit signed PCM
    for (let i = 0; i < count; i++, offset += 2) {
      const pcm = view.getInt16(offset, true);
      samples[i] = pcm < 0 ? pcm / 32768 : pcm / 32767;
    }
  } else if (hdr.bitsPerSample === 8) {
    // 8-bit unsigned PCM
    for (let i = 0; i < count; i++, offset += 1) {
      samples[i] = (view.getUint8(offset) - 128) / 128;
    }
  } else if (hdr.bitsPerSample === 24) {
    // 24-bit signed PCM
    for (let i = 0; i < count; i++, offset += 3) {
      let val = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
      if (val & 0x800000) val |= ~0xffffff;
      samples[i] = val < 0 ? val / 8388608 : val / 8388607;
    }
  } else if (hdr.bitsPerSample === 32) {
    // 32-bit signed PCM
    for (let i = 0; i < count; i++, offset += 4) {
      const pcm = view.getInt32(offset, true);
      samples[i] = pcm < 0 ? pcm / 2147483648 : pcm / 2147483647;
    }
  } else {
    throw new Error(`Unsupported WAV format: audioFormat=${hdr.audioFormat} bitsPerSample=${hdr.bitsPerSample}`);
  }

  const peaks = computePeaks(samples, peakBins, hdr.channels);

  return {
    sampleRate: hdr.sampleRate,
    channels: hdr.channels,
    bitsPerSample: hdr.bitsPerSample,
    numFrames,
    duration,
    samples,
    peaks,
  };
}

/**
 * Fast async WAV header reader. Reads only the first 4 KB of a file path
 * (or parses a buffer directly) so listing recordings does not read multi-MB wave bodies.
 * @param {string|Uint8Array|ArrayBuffer} pathOrBytes
 * @returns {Promise<{ sampleRate: number, channels: number, bitsPerSample: number, dataOffset: number, dataBytes: number, numFrames: number, duration: number }>}
 */
export async function readWavHeader(pathOrBytes) {
  if (typeof pathOrBytes !== 'string') {
    return parseWavHeader(pathOrBytes);
  }
  let fh = null;
  try {
    if (fs.promises && typeof fs.promises.open === 'function') {
      fh = await fs.promises.open(pathOrBytes, 'r');
      const buf = new Uint8Array(4096);
      const res = await fh.read(buf, 0, buf.byteLength, 0);
      const bytesRead = typeof res === 'number' ? res : (res && typeof res.bytesRead === 'number' ? res.bytesRead : buf.byteLength);
      return parseWavHeader(buf.subarray(0, bytesRead));
    }
    const full = await fs.promises.readFile(pathOrBytes);
    const bytes = toUint8Array(full);
    return parseWavHeader(bytes.subarray(0, Math.min(4096, bytes.byteLength)));
  } finally {
    if (fh && typeof fh.close === 'function') {
      try { await fh.close(); } catch (_) {}
    }
  }
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return new Uint8Array(input);
  throw new TypeError('Expected Uint8Array or ArrayBuffer');
}

function writeAscii(bytes, offset, str) {
  for (let i = 0; i < str.length; i++) {
    bytes[offset + i] = str.charCodeAt(i) & 0xff;
  }
}

function readAscii(bytes, offset, len) {
  let s = '';
  for (let i = 0; i < len && offset + i < bytes.byteLength; i++) {
    s += String.fromCharCode(bytes[offset + i]);
  }
  return s;
}
