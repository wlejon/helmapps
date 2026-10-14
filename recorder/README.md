# Sound Recorder (`helm.recorder`)

Desktop voice memo and audio clip recorder for **helm**, built on `bro.mic`, `AudioContext`, `bro.stt`, and the helm app kit (`/lib`).

## Features

- **Real-Time Microphone Capture**: Streams fixed-size PCM frames from `bro.mic` with optional Automatic Gain Control (`agc`), live peak/RMS metering, and scrolling `<canvas>` waveform visualization.
- **Timestamped Markers**: Drop markers (`M`) during live recording or playback/inspection, and click any marker pill or timeline flag to jump directly to its timestamp.
- **RIFF WAVE + Sidecar Metadata**: Encodes standard 16-bit PCM `.wav` files alongside `.json` metadata sidecars (title, creation timestamp, duration, sample rate, markers, transcript, and 256-bin waveform peak envelope). Any standalone `.wav` file without a sidecar is inspected on the fly via fast header parsing (`readWavHeader`).
- **Playback & Scrubbing**: Interactive `<canvas>` waveform scrubber with played/unplayed regions, 5-second skip back/forward, and variable playback speed (`0.5x` to `2.0x`).
- **On-Device Transcription**: Integrates with `bro.stt` (Whisper / Parakeet) when an on-device model is configured, displaying a clear status badge when no model is installed.

## Running & Testing

```bash
# Verify clean headless boot
../bro/build/Release/bro-headless.exe recorder -e "0"

# Run all headless acceptance and performance tests
VERBOSE=1 bash scripts/run_tests.sh recorder
```

## Keyboard Shortcuts

| Shortcut | Command | Action |
|---|---|---|
| `Ctrl+R` | `record-toggle` | Start recording, or Stop & Save active recording |
| `P` | `pause-resume` | Pause / Resume active recording |
| `M` | `add-marker` | Drop a timestamped marker at current recording or playback position |
| `Escape` | `cancel-record` | Discard active recording |
| `Space` | `play-toggle` | Play / Pause selected recording |
| `ArrowLeft` | `seek-back` | Skip back 5 seconds |
| `ArrowRight` | `seek-forward` | Skip forward 5 seconds |
| `F2` | `rename` | Rename selected recording |
| `Ctrl+S` | `export` | Export selected recording as `.wav` |
| `Delete` | `delete` | Delete selected recording (with Undo) |
| `Ctrl+F` | `search` | Focus search box (searches title, markers, and transcript) |
| `Ctrl+T` | `transcribe` | Transcribe selected recording with on-device STT |
| `Ctrl+O` | `open-file` | Import an external `.wav` file |
| `Ctrl+Q` | `quit` | Quit Sound Recorder |
