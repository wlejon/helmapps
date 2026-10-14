# Engine and Kit Gaps (`helm.recorder`)

None found.

- `bro.mic` (`start`, `stop`, `isActive`, `engineRate`, `stats`, `levels`, `feed`, `drain`) works as documented for both live capture and headless synthetic feed.
- `AudioContext` clip playback (`createClip`, `playClip`, `setPlaybackRate`, `seekPlayback`, `setPlaybackPlaying`, `stopPlayback`) and `bro.stt` (`loadWhisper`, `loadParakeet`, `transcribe`) provide the native primitives needed for audio playback and on-device transcription.
