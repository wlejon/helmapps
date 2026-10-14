// Unit and integration tests for recorder/js/wav.js:
// RIFF WAVE 16-bit PCM encoding, decoding, header parsing, clipping, and peak envelopes.

import { app, eq, fixtureDir } from '/lib/test.js';

const path = require('path');
const { encodeWav, decodeWav, parseWavHeader, readWavHeader, computePeaks } = app.wav;

// ---- 1. 48 kHz sine wave round-trip ------------------------------------------
{
  const rate = 48000;
  const durationSec = 0.5;
  const numSamples = Math.round(rate * durationSec);
  const src = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    src[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / rate);
  }

  const bytes = encodeWav(src, rate, 1);
  eq(bytes.byteLength, 44 + numSamples * 2, '48kHz WAV byte length (44 header + 2B/sample)');

  // Check RIFF WAVE ASCII markers
  const ascii = (off, len) => String.fromCharCode(...bytes.subarray(off, off + len));
  eq(ascii(0, 4), 'RIFF', 'RIFF magic');
  eq(ascii(8, 4), 'WAVE', 'WAVE format');
  eq(ascii(12, 4), 'fmt ', 'fmt chunk');
  eq(ascii(36, 4), 'data', 'data chunk');

  const hdr = parseWavHeader(bytes);
  eq(hdr.sampleRate, 48000, 'header sampleRate is 48000');
  eq(hdr.channels, 1, 'header channels is 1');
  eq(hdr.bitsPerSample, 16, 'header bitsPerSample is 16');
  eq(hdr.audioFormat, 1, 'header audioFormat is 1 (PCM)');
  eq(hdr.numFrames, numSamples, 'header numFrames matches');
  eq(Math.abs(hdr.duration - 0.5) < 1e-6, true, 'header duration is 0.5s');

  const dec = decodeWav(bytes, 256);
  eq(dec.sampleRate, 48000, 'decoded sampleRate');
  eq(dec.channels, 1, 'decoded channels');
  eq(dec.samples.length, numSamples, 'decoded sample count');
  eq(dec.peaks.length, 256, 'decoded 256 peak bins');

  // Verify 16-bit quantization accuracy (< 1/32767 + float epsilon)
  let maxErr = 0;
  for (let i = 0; i < numSamples; i++) {
    const err = Math.abs(dec.samples[i] - src[i]);
    if (err > maxErr) maxErr = err;
  }
  assert(maxErr < 0.0001, `48kHz sine round-trip max error ${maxErr} < 0.0001`);

  // Peak of 0.8 sine should be ~0.8 in every bin
  const maxPeak = Math.max(...dec.peaks);
  assert(Math.abs(maxPeak - 0.8) < 0.01, `peak envelope max ${maxPeak} ~ 0.8`);
}

// ---- 2. 24 kHz sine wave round-trip ------------------------------------------
{
  const rate = 24000;
  const numSamples = 6000; // 0.25s
  const src = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    src[i] = 0.45 * Math.cos((2 * Math.PI * 880 * i) / rate);
  }
  const bytes = encodeWav(src, rate, 1);
  const dec = decodeWav(bytes, 128);
  eq(dec.sampleRate, 24000, '24kHz sampleRate preserved');
  eq(dec.numFrames, 6000, '24kHz frame count preserved');
  eq(Math.abs(dec.duration - 0.25) < 1e-6, true, '24kHz duration is 0.25s');
  eq(dec.peaks.length, 128, 'custom peak bin count 128');
}

// ---- 3. Silence & clipping clamp ---------------------------------------------
{
  const silence = new Float32Array(1600);
  const silBytes = encodeWav(silence, 16000, 1);
  const silDec = decodeWav(silBytes, 64);
  const maxSil = Math.max(...silDec.samples.map((x) => Math.abs(x)));
  eq(maxSil, 0, 'silence decodes to exact 0');
  eq(Math.max(...silDec.peaks), 0, 'silence peaks are all 0');

  const extreme = new Float32Array([-3.5, -1.0, -0.5, 0, 0.5, 1.0, 4.2, NaN, Infinity, -Infinity]);
  const extBytes = encodeWav(extreme, 16000, 1);
  const extDec = decodeWav(extBytes, 10);
  eq(extDec.samples[0], -1, 'negative overflow clamped to -1.0');
  eq(extDec.samples[1], -1, '-1.0 preserved');
  assert(Math.abs(extDec.samples[2] - -0.5) < 0.0001, '-0.5 preserved');
  eq(extDec.samples[3], 0, '0 preserved');
  assert(Math.abs(extDec.samples[4] - 0.5) < 0.0001, '0.5 preserved');
  eq(extDec.samples[5], 1, '+1.0 preserved');
  eq(extDec.samples[6], 1, 'positive overflow clamped to +1.0');
  eq(extDec.samples[7], 0, 'NaN sanitized to 0');
  eq(extDec.samples[8], 0, 'Infinity sanitized to 0');
  eq(extDec.samples[9], 0, '-Infinity sanitized to 0');
}

// ---- 4. Async readWavHeader from disk ----------------------------------------
{
  const samples = new Float32Array(16000 * 2); // 2.0 seconds @ 16kHz
  const wavBytes = encodeWav(samples, 16000, 1);
  const dir = fixtureDir({ 'clip.wav': wavBytes });
  const hdr = await readWavHeader(path.join(dir, 'clip.wav'));
  eq(hdr.sampleRate, 16000, 'readWavHeader sampleRate from disk');
  eq(hdr.channels, 1, 'readWavHeader channels from disk');
  eq(hdr.duration, 2, 'readWavHeader 2.0s duration from disk');
}

// ---- 5. computePeaks standalone check ----------------------------------------
{
  const pulse = new Float32Array(1000);
  pulse[250] = -0.9;
  pulse[750] = 0.6;
  const p = computePeaks(pulse, 4, 1);
  eq(p.length, 4, '4 bins');
  assert(Math.abs(p[1] - 0.9) < 0.001, 'bin 1 captures 0.9 peak');
  assert(Math.abs(p[3] - 0.6) < 0.001, 'bin 3 captures 0.6 peak');
}

console.log('test_wav PASSED');
