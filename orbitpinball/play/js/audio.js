// Port of PinballAudio.swift on the Web Audio API.
export const SoundNames = ['launch', 'bumper', 'metal', 'flipper', 'target', 'lane', 'warp', 'mission', 'drain', 'tilt',
  'missionSelect', 'missionStart', 'missionStep', 'missionComplete', 'bonus', 'extraBall', 'ballSave', 'skillShot',
  'ramp', 'hyperspace', 'blackHole', 'wormhole', 'gravityWell', 'kickback', 'dropTarget', 'fuel', 'rankUp',
  'gameStart', 'gameOver', 'jackpot', 'upgrade', 'spinner', 'sling', 'outlane', 'reflex'];
const Cues = new Set(['missionSelect', 'missionStart', 'missionStep', 'missionComplete', 'extraBall', 'ballSave', 'skillShot', 'bonus',
  'rankUp', 'jackpot', 'gameStart', 'gameOver', 'hyperspace', 'blackHole']);
const MUSIC_VOLUME = 0.3;

export class PinballAudio {
  constructor() {
    this.enabled = true; this.musicEnabled = true; this.hapticsEnabled = true;
    this.buffers = new Map(); this.music = new Map();
    this.ctx = null; this.duckUntil = 0; this.currentTrack = null; this.lastHaptic = 0;
  }
  /** Must run inside a user gesture (browsers keep audio locked until then). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.effectsBus = this.ctx.createGain(); this.effectsBus.connect(this.master);
      this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = MUSIC_VOLUME; this.musicBus.connect(this.master);
      this.load();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  async fetchBuffer(url) {
    const data = await (await fetch(url)).arrayBuffer();
    return await new Promise((resolve, reject) => this.ctx.decodeAudioData(data, resolve, reject));
  }
  load() {
    for (const name of SoundNames) this.fetchBuffer(`assets/audio/${name}.m4a`).then((b) => this.buffers.set(name, b)).catch(() => {});
    this.fetchBuffer('assets/audio/rolling.wav').then((b) => { this.rollingBuffer = b; }).catch(() => {});
    for (const [track, file] of [['cruise', 'musicCruise'], ['mission', 'musicMission']]) {
      this.fetchBuffer(`assets/audio/${file}.wav`).then((b) => {
        this.music.set(track, b);
        if (this.currentTrack === track && !this.musicSource) this.startTrack(track);
      }).catch(() => {});
    }
  }
  play(feedback) {
    const sound = feedback.sound, now = performance.now() / 1000;
    if (sound === 'rolling') return;
    if (this.enabled && Cues.has(sound)) this.duckUntil = now + 0.9;
    if (this.enabled && this.ctx && this.buffers.has(sound)) {
      const src = this.ctx.createBufferSource(); src.buffer = this.buffers.get(sound);
      src.playbackRate.value = feedback.rate;
      const gain = this.ctx.createGain(); gain.gain.value = feedback.volume;
      let tail = gain;
      if (this.ctx.createStereoPanner) { const pan = this.ctx.createStereoPanner(); pan.pan.value = feedback.pan; gain.connect(pan); tail = pan; }
      src.connect(gain); tail.connect(this.effectsBus); src.start();
    }
    if (this.hapticsEnabled && navigator.vibrate && ['bumper', 'flipper', 'kickback', 'missionComplete', 'rankUp', 'jackpot', 'extraBall'].includes(sound) && now - this.lastHaptic > 0.075) {
      navigator.vibrate(sound === 'flipper' ? 8 : 14); this.lastHaptic = now;
    }
  }
  playName(sound) { this.play({ sound, volume: 0.68, rate: 1, pan: 0 }); }
  setMusic(track) {
    const wanted = this.musicEnabled ? track : null;
    if (wanted === this.currentTrack) return;
    this.currentTrack = wanted;
    if (!this.ctx) return;
    if (this.musicSource) {
      const old = this.musicSource, oldGain = this.musicGain, t = this.ctx.currentTime;
      oldGain.gain.setTargetAtTime(0, t, 0.1); old.stop(t + 0.45);
      this.musicSource = null;
    }
    if (wanted) this.startTrack(wanted);
  }
  startTrack(track) {
    const buffer = this.music.get(track);
    if (!buffer || !this.ctx) return;
    const src = this.ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const gain = this.ctx.createGain(); gain.gain.value = 0; gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.15);
    src.connect(gain); gain.connect(this.musicBus); src.start();
    this.musicSource = src; this.musicGain = gain;
  }
  updateRolling(speed, x, active) {
    if (!this.ctx) return;
    const ducked = performance.now() / 1000 < this.duckUntil;
    this.musicBus.gain.setTargetAtTime(ducked ? MUSIC_VOLUME * 0.35 : MUSIC_VOLUME, this.ctx.currentTime, 0.12);
    if (!this.rollingBuffer) return;
    if (!this.rolling) {
      const src = this.ctx.createBufferSource(); src.buffer = this.rollingBuffer; src.loop = true;
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      let tail = gain;
      if (this.ctx.createStereoPanner) { this.rollingPan = this.ctx.createStereoPanner(); gain.connect(this.rollingPan); tail = this.rollingPan; }
      src.connect(gain); tail.connect(this.effectsBus); src.start();
      this.rolling = { src, gain };
    }
    const on = this.enabled && active && speed > 12;
    const amount = Math.min(1, Math.max(0, speed / 650));
    const target = on ? (0.018 + 0.065 * amount) * (ducked ? 0.2 : 1) * 1.6 : 0;
    this.rolling.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    this.rolling.src.playbackRate.setTargetAtTime(0.8 + 0.5 * amount, this.ctx.currentTime, 0.05);
    if (this.rollingPan) this.rollingPan.pan.setTargetAtTime(Math.min(0.5, Math.max(-0.5, (x - 200) / 400)), this.ctx.currentTime, 0.05);
  }
  setEnabled(on) { this.enabled = on; }
  setMusicEnabled(on) { this.musicEnabled = on; if (!on) this.setMusic(null); }
  suspend() { this.setMusic(null); if (this.rolling) this.rolling.gain.gain.value = 0; }
}
