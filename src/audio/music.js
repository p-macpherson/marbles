// Background music: an original, fast "comedy chase" ragtime tune, synthesised
// live with the Web Audio API (no audio files). Bouncy stride bass, piano stabs,
// a honky sax-like lead that scoops into its notes, chromatic runs, light drums
// and a slide whistle at the end of the loop.

const STORAGE_KEY = 'marble-race:muted';
const BPM = 176;
const STEP = 60 / BPM / 4; // one sixteenth note
const BAR = 16;

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const m = (name) => {
  const [, n, o] = name.match(/^([A-G]#?)(\d)$/);
  return NOTE[n] + (Number(o) + 1) * 12;
};
const mtof = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// ---- the tune ------------------------------------------------------------
// Each bar: [note|null, sixteenths] pairs summing to 16.
const MELODY = [
  // A section: C C A7 A7 D7 G7 C G7
  [['E4', 1], ['F4', 1], ['F#4', 1], ['G4', 1], ['C5', 2], ['E5', 2], ['G5', 2], ['E5', 2], [null, 2], ['C5', 2]],
  [['D5', 1], ['C5', 1], ['B4', 1], ['C5', 1], ['E5', 2], ['D5', 2], ['C5', 2], ['A4', 2], ['G4', 4]],
  [['C#5', 1], ['D5', 1], ['D#5', 1], ['E5', 1], ['G5', 2], ['E5', 2], ['C#5', 2], ['A4', 2], [null, 2], ['A4', 2]],
  [['G5', 2], ['F5', 1], ['E5', 1], ['D5', 2], ['C#5', 2], ['E5', 4], [null, 4]],
  [['F#4', 1], ['G4', 1], ['G#4', 1], ['A4', 1], ['D5', 2], ['F#5', 2], ['A5', 2], ['F#5', 2], ['D5', 2], ['C5', 2]],
  [['B4', 2], ['D5', 2], ['F5', 2], ['D5', 2], ['G5', 1], ['F5', 1], ['E5', 1], ['D5', 1], ['B4', 2], ['G4', 2]],
  [['C5', 2], ['E5', 1], ['G5', 1], ['C6', 4], ['B5', 1], ['A#5', 1], ['A5', 1], ['G#5', 1], ['G5', 4]],
  [['F5', 1], ['E5', 1], ['D#5', 1], ['D5', 1], ['C#5', 1], ['C5', 1], ['B4', 1], ['A#4', 1], ['A4', 2], ['B4', 2], ['D5', 2], ['F5', 2]],
  // B section: F F#dim C A7 D7 G7 C C
  [['A4', 2], ['C5', 2], ['F5', 3], ['E5', 1], ['F5', 2], ['A5', 2], [null, 2], ['F5', 2]],
  [['A5', 1], ['G#5', 1], ['A5', 1], [null, 1], ['C6', 2], ['A5', 2], ['F#5', 2], ['D#5', 2], ['C5', 4]],
  [['G4', 2], ['C5', 1], ['E5', 1], ['G5', 2], ['E5', 2], [null, 2], ['G5', 1], ['G5', 1], ['A5', 2], ['G5', 2]],
  [['E5', 1], ['F5', 1], ['F#5', 1], ['G5', 1], ['A5', 4], ['G5', 2], ['E5', 2], ['C#5', 4]],
  [['D5', 2], ['F#5', 2], ['A5', 2], ['D6', 2], ['C6', 1], ['A5', 1], ['F#5', 1], ['D5', 1], [null, 2], ['A4', 2]],
  [['G4', 1], ['B4', 1], ['D5', 1], ['F5', 1], ['G5', 2], [null, 2], ['F5', 1], ['E5', 1], ['D5', 1], ['B4', 1], ['G4', 4]],
  [['C5', 2], [null, 2], ['E5', 2], [null, 2], ['G5', 2], [null, 2], ['C6', 4]],
  [[null, 4], ['G4', 1], ['G4', 1], [null, 2], ['C5', 2], [null, 6]],
];

// bass root, bass fifth, stab voicing
const CHORDS = {
  C: [36, 43, [55, 60, 64]],
  A7: [33, 40, [55, 61, 64]],
  D7: [38, 45, [54, 60, 62]],
  G7: [31, 38, [53, 59, 62]],
  F: [41, 48, [57, 60, 65]],
  'F#dim': [42, 48, [54, 57, 60]],
};
const PROGRESSION = ['C', 'C', 'A7', 'A7', 'D7', 'G7', 'C', 'G7', 'F', 'F#dim', 'C', 'A7', 'D7', 'G7', 'C', 'C'];

function buildSong() {
  const steps = Array.from({ length: PROGRESSION.length * BAR }, () => []);
  MELODY.forEach((bar, b) => {
    let s = b * BAR;
    for (const [note, len] of bar) {
      if (note) steps[s].push({ type: 'lead', midi: m(note), len });
      s += len;
    }
  });
  PROGRESSION.forEach((name, b) => {
    const [root, fifth, stab] = CHORDS[name];
    const s = b * BAR;
    const last = b === PROGRESSION.length - 1;
    // stride: bass on 1 & 3, chord stabs on 2 & 4 (plus a pickup "and")
    steps[s].push({ type: 'bass', midi: root, len: 4 });
    steps[s + 8].push({ type: 'bass', midi: fifth, len: 4 });
    steps[s + 4].push({ type: 'stab', notes: stab });
    steps[s + 12].push({ type: 'stab', notes: stab });
    if (b % 2 === 1) steps[s + 14].push({ type: 'stab', notes: stab });
    // drums
    steps[s].push({ type: 'kick' });
    steps[s + 8].push({ type: 'kick' });
    if (b % 4 === 3) steps[s + 10].push({ type: 'kick' });
    steps[s + 4].push({ type: 'snare' });
    steps[s + 12].push({ type: 'snare' });
    for (let k = 2; k < 16; k += 4) steps[s + k].push({ type: 'hat' });
    if (last) {
      // drum fill + slide whistle back to the top
      for (const k of [13, 14, 15]) steps[s + k].push({ type: 'snare' });
      steps[s + 10].push({ type: 'whistle' });
    }
  });
  return steps;
}
const SONG = buildSong();

// ---- engine ---------------------------------------------------------------
export class Music {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.muted = false;
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {}
    this.onChange = null;
    this._timer = 0;
  }

  /** Must be called from a user gesture (click/tap) so browsers allow audio. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.35;
      this.sfxBus.connect(this.master);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) this.ctx.suspend();
        else this.ctx.resume();
      });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {}
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.03);
    this.onChange?.(muted);
  }

  toggleMute() {
    this.setMuted(!this.muted);
  }

  /** Start the loop from the top. */
  start() {
    if (!this.ctx) return;
    this.stop(0);
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setValueAtTime(0.32, this.ctx.currentTime);
    this._timer = setInterval(() => this._tick(), 25);
    this._tick();
  }

  /** Fade out and stop. */
  stop(fade = 1.2) {
    clearInterval(this._timer);
    if (!this.ctx || !this.playing) {
      this.playing = false;
      return;
    }
    this.playing = false;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (fade > 0) g.linearRampToValueAtTime(0, t + fade);
    else g.setValueAtTime(0, t);
    // anything already scheduled is silenced by the bus; restore level for next start()
  }

  _tick() {
    const ctx = this.ctx;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.03; // fell behind (tab was hidden)
    while (this.nextTime < ctx.currentTime + 0.15) {
      for (const ev of SONG[this.step % SONG.length]) this._play(ev, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  _play(ev, t) {
    switch (ev.type) {
      case 'lead': return this._lead(t, ev.midi, ev.len * STEP);
      case 'bass': return this._bass(t, ev.midi, ev.len * STEP);
      case 'stab': return this._stab(t, ev.notes);
      case 'kick': return this._kick(t);
      case 'snare': return this._snare(t);
      case 'hat': return this._hat(t);
      case 'whistle': return this._whistle(t, 520, 1900, STEP * 6, this.musicBus, 0.18);
    }
  }

  // ---- instruments ----
  _env(t, peak, attack, hold, release, bus = this.musicBus) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(bus);
    return g;
  }

  _lead(t, midi, dur, bus = this.musicBus, level = 0.2) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const len = Math.max(0.06, dur * 0.88);
    const out = this._env(t, level, 0.012, len * 0.6, len * 0.4 + 0.05, bus);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 4;
    filt.frequency.setValueAtTime(3800, t);
    filt.frequency.exponentialRampToValueAtTime(1500, t + 0.12);
    filt.connect(out);
    const end = t + len + 0.1;
    for (const [type, detune, gain] of [['sawtooth', -6, 0.7], ['square', 7, 0.35]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      // sax-style scoop up into the note
      o.frequency.setValueAtTime(f * 0.92, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(filt);
      if (len > 0.22) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 6.2;
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(f * 0.018, t + len);
        lfo.connect(depth).connect(o.frequency);
        lfo.start(t);
        lfo.stop(end);
      }
      o.start(t);
      o.stop(end);
    }
  }

  _bass(t, midi, dur) {
    const ctx = this.ctx;
    const len = dur * 0.7;
    const out = this._env(t, 0.55, 0.006, 0.02, len, this.musicBus);
    for (const [type, mult, gain] of [['triangle', 1, 0.9], ['sine', 0.5, 0.6]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(midi) * mult;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 0.1);
    }
  }

  _stab(t, notes) {
    const ctx = this.ctx;
    const out = this._env(t, 0.09, 0.004, 0.03, 0.12, this.musicBus);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 2200;
    filt.connect(out);
    for (const n of notes) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mtof(n);
      o.connect(filt);
      o.start(t);
      o.stop(t + 0.2);
    }
  }

  _noise(t, dur, filterType, freq, peak, bus = this.musicBus) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    const out = this._env(t, peak, 0.002, 0, dur, bus);
    src.connect(filt).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    o.connect(this._env(t, 0.8, 0.003, 0.01, 0.14));
    o.start(t);
    o.stop(t + 0.2);
  }

  _snare(t) {
    this._noise(t, 0.11, 'bandpass', 1900, 0.32);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 190;
    o.connect(this._env(t, 0.18, 0.002, 0, 0.06));
    o.start(t);
    o.stop(t + 0.1);
  }

  _hat(t) {
    this._noise(t, 0.035, 'highpass', 7500, 0.12);
  }

  _whistle(t, from, to, dur, bus, level) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 9;
    depth.gain.value = 18;
    lfo.connect(depth).connect(o.frequency);
    o.connect(this._env(t, level, 0.03, dur - 0.06, 0.05, bus));
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.1);
    lfo.stop(t + dur + 0.1);
  }

  // ---- sound effects ----
  /** Countdown beep; `go` = the higher final beep. */
  beep(go = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = go ? 1046.5 : 523.25;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3000;
    o.connect(f).connect(this._env(t, 0.35, 0.005, go ? 0.25 : 0.1, 0.08, this.sfxBus));
    o.start(t);
    o.stop(t + 0.5);
  }
}
