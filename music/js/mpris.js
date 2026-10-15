/**
 * MPRIS2 player service bridge (`bro.mpris.createService`).
 *
 * Publishes Music's identity ("Music", desktopEntry "helm.music"), playback
 * state, track metadata, capabilities, volume, loop status, shuffle, and
 * position to the desktop session (and media controls), and routes incoming
 * MPRIS commands to the player and app commands.
 */

export const MPRIS_STATUS = {
  playing: 'Playing',
  paused: 'Paused',
  stopped: 'Stopped',
};

export const MPRIS_LOOP = {
  off: 'None',
  all: 'Playlist',
  one: 'Track',
};

export const REPEAT_FROM_MPRIS = {
  none: 'off',
  playlist: 'all',
  track: 'one',
};

export function fileToUri(filePath) {
  if (!filePath) return '';
  if (filePath.startsWith('file://')) return filePath;
  const normalized = String(filePath).replace(/\\/g, '/');
  const encoded = normalized.split('/').map((seg, i) => (i === 0 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`;
}

export function uriToFile(uri) {
  if (!uri) return '';
  const str = String(uri).trim();
  if (!str.startsWith('file://')) return str;
  let rest = str.slice('file://'.length);
  if (rest.startsWith('localhost/')) rest = rest.slice('localhost'.length);
  try {
    rest = decodeURIComponent(rest);
  } catch (_) {
    // keep raw if malformed percent-encoding
  }
  if (/^\/[a-zA-Z]:\//.test(rest)) rest = rest.slice(1);
  return rest;
}

export class MprisBridge {
  constructor({
    player,
    commands,
    onSeek,
    onVolume,
    onRepeat,
    onShuffle,
    onOpenUri,
    onRaise,
    createService,
  } = {}) {
    this.player = player;
    this.commands = commands;
    this.onSeek = onSeek || ((sec) => player.seek(sec));
    this.onVolume = onVolume || ((v) => player.setVolume(v));
    this.onRepeat = onRepeat || ((mode) => player.setRepeat(mode));
    this.onShuffle = onShuffle || ((on) => player.setShuffle(on));
    this.onOpenUri = onOpenUri || null;
    this.onRaise = onRaise || null;

    this.shown = {
      status: 'Stopped',
      trackKey: '',
      metadata: null,
      loop: 'None',
      shuffle: false,
      volume: -1,
      positionUs: 0,
      seekedUs: 0,
      caps: null,
      capsKey: '',
    };

    this.service = null;
    this.initService(createService);
  }

  initService(customCreateService) {
    const factory = customCreateService || (
      typeof bro !== 'undefined' &&
      bro &&
      bro.mpris &&
      bro.mpris.available !== false &&
      typeof bro.mpris.createService === 'function'
        ? (opts) => bro.mpris.createService(opts)
        : null
    );
    if (!factory) {
      this.update(true);
      return null;
    }

    try {
      const svc = factory({
        name: 'helm_music',
        identity: 'Music',
        desktopEntry: 'helm.music',
        playbackStatus: 'Stopped',
        loopStatus: MPRIS_LOOP[this.player.queue.repeat] || 'None',
        shuffle: !!this.player.queue.shuffle,
        volume: this.player.muted ? 0 : this.player.volume,
        position: 0,
        capabilities: this.buildCapabilities(),
        onPlay: () => this.handleCommand('play'),
        onPause: () => this.handleCommand('pause'),
        onPlayPause: () => this.handleCommand('playPause'),
        onStop: () => this.handleCommand('stop'),
        onNext: () => this.handleCommand('next'),
        onPrevious: () => this.handleCommand('previous'),
        onSeek: (ev, offArg) => this.handleCommand('seek', ev, offArg),
        onSetPosition: (ev, posArg, trackArg) => this.handleCommand('setPosition', ev, posArg, trackArg),
        onVolume: (ev, volArg) => this.handleCommand('volume', ev, volArg),
        onLoopStatus: (ev, loopArg) => this.handleCommand('loopStatus', ev, loopArg),
        onShuffle: (ev, shufArg) => this.handleCommand('shuffle', ev, shufArg),
        onOpenUri: (ev, uriArg) => this.handleCommand('openUri', ev, uriArg),
        onRaise: () => this.handleCommand('raise'),
        onQuit: () => this.handleCommand('quit'),
      });
      if (!svc) {
        this.update(true);
        return null;
      }
      if (typeof svc.isRunning === 'function' && !svc.isRunning() && typeof svc.start === 'function') {
        svc.start();
      }
      this.service = svc;
      this.update(true);
      return svc;
    } catch (_) {
      this.service = null;
      this.update(true);
      return null;
    }
  }

  get available() {
    return !!this.service;
  }

  buildCapabilities() {
    const p = this.player;
    const hasCurrent = !!p.queue.current;
    const hasQueue = p.queue.length > 0;
    return {
      canControl: true,
      canPlay: hasCurrent || hasQueue,
      canPause: p.state === 'playing' || hasCurrent,
      canGoNext: hasQueue,
      canGoPrevious: hasQueue,
      canSeek: hasCurrent && p.duration > 0,
      canRaise: true,
      canQuit: true,
    };
  }

  trackIdFor(entry) {
    if (!entry) return '/org/mpris/MediaPlayer2/TrackList/NoTrack';
    return `/org/mpris/MediaPlayer2/Track/${entry.id}`;
  }

  buildMetadata() {
    const p = this.player;
    const s = p.current;
    const e = p.queue.current;
    if (!s || !e) return null;
    const durSec = p.duration || s.duration || 0;
    const artist = s.artist || '';
    const albumArtist = s.albumArtist || artist;
    return {
      trackId: this.trackIdFor(e),
      title: s.title || '',
      artist,
      artists: artist ? [artist] : [],
      album: s.album || '',
      albumArtist,
      albumArtists: albumArtist ? [albumArtist] : [],
      lengthUs: Math.max(0, Math.round(durSec * 1e6)),
      artUrl: s.cover ? fileToUri(s.cover) : '',
      url: s.path ? fileToUri(s.path) : '',
      trackNumber: s.track || 0,
      discNumber: s.disc || 0,
    };
  }

  /** Sync playback status, metadata, capabilities, loop, shuffle, volume, and position. */
  update(force = false) {
    const svc = this.service;
    const p = this.player;

    const status = MPRIS_STATUS[p.state] || 'Stopped';
    if (force || status !== this.shown.status) {
      this.shown.status = status;
      if (svc && typeof svc.setPlaybackStatus === 'function') svc.setPlaybackStatus(status);
    }

    const caps = this.buildCapabilities();
    const capsKey = `${caps.canPlay}:${caps.canPause}:${caps.canGoNext}:${caps.canGoPrevious}:${caps.canSeek}`;
    if (force || capsKey !== this.shown.capsKey) {
      this.shown.caps = caps;
      this.shown.capsKey = capsKey;
      if (svc && typeof svc.setCapabilities === 'function') svc.setCapabilities(caps);
    }

    const meta = this.buildMetadata();
    const trackKey = meta
      ? `${meta.trackId}\n${meta.title}\n${meta.artist}\n${meta.album}\n${meta.lengthUs}\n${meta.artUrl}`
      : '';
    if (force || trackKey !== this.shown.trackKey) {
      this.shown.metadata = meta;
      this.shown.trackKey = trackKey;
      if (svc && typeof svc.setMetadata === 'function') svc.setMetadata(meta);
    }

    const loop = MPRIS_LOOP[p.queue.repeat] || 'None';
    if (force || loop !== this.shown.loop) {
      this.shown.loop = loop;
      if (svc && typeof svc.setLoopStatus === 'function') svc.setLoopStatus(loop);
    }

    const shuf = !!p.queue.shuffle;
    if (force || shuf !== this.shown.shuffle) {
      this.shown.shuffle = shuf;
      if (svc && typeof svc.setShuffle === 'function') svc.setShuffle(shuf);
    }

    const vol = p.muted ? 0 : Math.round(p.volume * 1000) / 1000;
    if (force || Math.abs(vol - this.shown.volume) > 1e-4) {
      this.shown.volume = vol;
      if (svc && typeof svc.setVolume === 'function') svc.setVolume(vol);
    }

    this.tick();
  }

  /** Update playback position in microseconds. */
  tick() {
    const posUs = Math.max(0, Math.round(this.player.readPosition() * 1e6));
    this.shown.positionUs = posUs;
    const svc = this.service;
    if (svc && typeof svc.setPosition === 'function') {
      svc.setPosition(posUs);
    }
  }

  /** Emit MPRIS Seeked(posUs) signal when playback jumps to a new position. */
  seeked(sec) {
    const posSec = typeof sec === 'number' ? sec : this.player.readPosition();
    const posUs = Math.max(0, Math.round(posSec * 1e6));
    this.shown.positionUs = posUs;
    this.shown.seekedUs = posUs;
    const svc = this.service;
    if (!svc) return;
    if (typeof svc.setPosition === 'function') svc.setPosition(posUs);
    if (typeof svc.emitSeeked === 'function') svc.emitSeeked(posUs);
  }

  /** Route an incoming MPRIS command to the player and app controls. */
  handleCommand(command, evOrArg1, arg2, arg3) {
    const p = this.player;
    const cmd = typeof command === 'object' && command !== null ? command.command || command.type : command;
    const payload = typeof command === 'object' && command !== null ? command : evOrArg1;

    switch (cmd) {
      case 'play':
        if (p.queue.current) p.play();
        else if (this.commands) this.commands.run('play-pause');
        break;
      case 'pause':
        p.pause();
        break;
      case 'playPause':
        if (this.commands) this.commands.run('play-pause');
        else p.toggle();
        break;
      case 'stop':
        p.pause();
        this.onSeek(0);
        this.seeked(0);
        break;
      case 'next':
        p.next();
        break;
      case 'previous':
        p.prev();
        break;
      case 'seek': {
        const offsetUs = Number(
          payload && typeof payload === 'object'
            ? (payload.offsetUs ?? payload.offsetUsec ?? payload.offset ?? arg2 ?? 0)
            : (payload ?? 0)
        ) || 0;
        const target = Math.max(0, p.readPosition() + offsetUs / 1e6);
        this.onSeek(target);
        this.seeked(p.readPosition());
        break;
      }
      case 'setPosition': {
        const posUs = Number(
          payload && typeof payload === 'object'
            ? (payload.positionUs ?? payload.positionUsec ?? payload.position ?? arg2 ?? 0)
            : (payload ?? 0)
        ) || 0;
        const trackId = payload && typeof payload === 'object' ? payload.trackId : arg3;
        const curTrackId = this.trackIdFor(p.queue.current);
        if (!trackId || trackId === curTrackId) {
          const target = Math.max(0, posUs / 1e6);
          this.onSeek(target);
          this.seeked(p.readPosition());
        }
        break;
      }
      case 'volume': {
        const rawVol = payload && typeof payload === 'object'
          ? (payload.volume ?? payload.value ?? arg2)
          : payload;
        const vol = Math.max(0, Math.min(1, Number(rawVol)));
        if (!Number.isNaN(vol)) this.onVolume(vol, true);
        break;
      }
      case 'loopStatus': {
        const rawLoop = payload && typeof payload === 'object'
          ? (payload.loopStatus ?? payload.status ?? payload.value ?? arg2)
          : payload;
        const mode = REPEAT_FROM_MPRIS[String(rawLoop || '').toLowerCase()];
        if (mode) this.onRepeat(mode);
        break;
      }
      case 'shuffle': {
        const rawShuf = payload && typeof payload === 'object'
          ? (payload.shuffle ?? payload.value ?? arg2)
          : payload;
        const on = typeof rawShuf === 'string'
          ? rawShuf.toLowerCase() === 'on' || rawShuf.toLowerCase() === 'true'
          : !!rawShuf;
        this.onShuffle(on);
        break;
      }
      case 'openUri': {
        const rawUri = payload && typeof payload === 'object'
          ? (payload.uri ?? payload.url ?? arg2)
          : payload;
        const filePath = uriToFile(rawUri);
        if (filePath && this.onOpenUri) this.onOpenUri(filePath);
        break;
      }
      case 'raise':
        if (this.onRaise) {
          this.onRaise();
        } else if (typeof bro !== 'undefined' && bro.window) {
          if (typeof bro.window.requestAttention === 'function') bro.window.requestAttention();
          if (typeof bro.window.focus === 'function') bro.window.focus();
        }
        break;
      case 'quit':
        if (this.commands) this.commands.run('quit');
        break;
    }
    this.update();
  }

  close() {
    if (this.service && typeof this.service.close === 'function') {
      try { this.service.close(); } catch (_) {}
    }
    this.service = null;
  }
}
