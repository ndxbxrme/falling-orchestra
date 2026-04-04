import { ROOT_NOTES, SCALE_MODES } from "./config";
import { ScaleQuantizer } from "./ScaleQuantizer";
import type { InstrumentFamily, PlayedNote, RootNoteName, ScaleModeName } from "./types";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const midiToFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const SIXTEENTH_NOTES_PER_BEAT = 4;
const BEATS_PER_BAR = 4;
const BARS_PER_SECTION = 4;
const DEFAULT_BPM = 120;
const MIN_SCHEDULE_LOOKAHEAD = 0.012;
const TRANSPORT_LOOKAHEAD = 0.16;
const EVOLVING_HARMONIES: Array<{ rootNote: RootNoteName; mode: ScaleModeName }> = [
  { rootNote: "D", mode: "dorian" },
  { rootNote: "G", mode: "mixolydian" },
];

const midiToLabel = (midi: number): string => {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
};

export class MusicSystem {
  rootNote: RootNoteName = "C";
  mode: ScaleModeName = "ionian";
  muted = false;
  volume = 0.72;
  snareEnabled = false;
  hatsEnabled = false;
  droneEnabled = false;

  private audioContext?: AudioContext;
  private masterGain?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private quantizer = new ScaleQuantizer();
  private bpm = DEFAULT_BPM;
  private transportStartTime?: number;
  private nextQuarterIndex = 0;
  private nextEighthIndex = 0;
  private nextBarIndex = 0;
  private noiseBuffer?: AudioBuffer;
  private harmonyControlMode: "cycle" | "manual" = "cycle";

  async unlock(): Promise<void> {
    if (!this.audioContext) {
      const AudioCtor = window.AudioContext;
      this.audioContext = new AudioCtor();
      this.compressor = this.audioContext.createDynamicsCompressor();
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 22;
      this.compressor.ratio.value = 7;
      this.compressor.attack.value = 0.005;
      this.compressor.release.value = 0.18;

      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.audioContext.destination);
      this.noiseBuffer = this.createNoiseBuffer();
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    if (this.transportStartTime === undefined) {
      this.transportStartTime = this.audioContext.currentTime + 0.05;
      this.nextQuarterIndex = 0;
      this.nextEighthIndex = 0;
      this.nextBarIndex = 0;
    }
  }

  setRootNote(note: RootNoteName): void {
    this.rootNote = note;
  }

  setMode(mode: ScaleModeName): void {
    this.mode = mode;
  }

  setHarmonyControlMode(mode: "cycle" | "manual"): void {
    this.harmonyControlMode = mode;

    if (mode === "cycle" && this.audioContext) {
      this.syncDisplayedHarmony(this.audioContext.currentTime);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.syncMasterVolume();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.syncMasterVolume();
  }

  setSnareEnabled(enabled: boolean): void {
    this.snareEnabled = enabled;
  }

  setHatsEnabled(enabled: boolean): void {
    this.hatsEnabled = enabled;
  }

  setDroneEnabled(enabled: boolean): void {
    this.droneEnabled = enabled;
  }

  triggerImpact(options: {
    family: InstrumentFamily;
    noteRange: [number, number];
    impact: number;
    normalizedX: number;
    pan: number;
    transpose?: number;
    color: string;
  }): PlayedNote {
    const when = this.getNextSixteenthTime();

    if (options.family === "mega") {
      this.playMegaVoice(clamp(options.impact, 0, 18), clamp(options.pan, -0.9, 0.9), when);
      return {
        label: "MEGA",
        color: options.color,
      };
    }

    if (options.family === "snare") {
      this.playSnareImpact(clamp(options.impact, 0, 18), clamp(options.pan, -0.9, 0.9), when);
      return {
        label: "SNARE",
        color: options.color,
      };
    }

    const harmony =
      this.harmonyControlMode === "cycle"
        ? this.getHarmonyForTime(when)
        : { rootNote: this.rootNote, mode: this.mode };
    const baseMidi =
      options.noteRange[0] +
      options.normalizedX * (options.noteRange[1] - options.noteRange[0]) +
      clamp(options.impact, 0, 18) * 0.22 +
      (options.transpose ?? 0);

    const quantized = this.quantizer.quantizeMidi(
      ROOT_NOTES[harmony.rootNote],
      SCALE_MODES[harmony.mode],
      baseMidi,
    );

    this.playVoice({
      family: options.family,
      midi: quantized,
      pan: clamp(options.pan, -0.9, 0.9),
      gain: clamp(0.1 + options.impact / 18, 0.1, 0.8),
      when,
    });

    return {
      label: midiToLabel(quantized),
      color: options.color,
    };
  }

  triggerMegaCombo(options: { impact: number; pan: number }): void {
    const when = this.getNextSixteenthTime();
    this.playMegaComboVoice(clamp(options.impact, 0, 20), clamp(options.pan, -0.9, 0.9), when);
  }

  dispose(): void {
    void this.audioContext?.close();
  }

  update(): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const quarterDuration = 60 / this.bpm;
    const eighthDuration = quarterDuration / 2;
    const barDuration = quarterDuration * BEATS_PER_BAR;
    const now = this.audioContext.currentTime;
    const startTime = this.transportStartTime ?? (now + 0.05);
    this.transportStartTime = startTime;
    if (this.harmonyControlMode === "cycle") {
      this.syncDisplayedHarmony(now);
    }

    const currentQuarterIndex = Math.max(0, Math.ceil((now - startTime) / quarterDuration));
    if (this.nextQuarterIndex < currentQuarterIndex) {
      this.nextQuarterIndex = currentQuarterIndex;
    }

    const currentEighthIndex = Math.max(0, Math.ceil((now - startTime) / eighthDuration));
    if (this.nextEighthIndex < currentEighthIndex) {
      this.nextEighthIndex = currentEighthIndex;
    }

    const currentBarIndex = Math.max(0, Math.ceil((now - startTime) / barDuration));
    if (this.nextBarIndex < currentBarIndex) {
      this.nextBarIndex = currentBarIndex;
    }

    const horizon = now + TRANSPORT_LOOKAHEAD;

    while (startTime + this.nextQuarterIndex * quarterDuration <= horizon) {
      const when = startTime + this.nextQuarterIndex * quarterDuration;
      this.playKick(when, this.nextQuarterIndex % 4 === 0);
      if (this.snareEnabled && (this.nextQuarterIndex % 4 === 1 || this.nextQuarterIndex % 4 === 3)) {
        this.playSnare(when);
      }
      this.nextQuarterIndex += 1;
    }

    while (startTime + this.nextEighthIndex * eighthDuration <= horizon) {
      const when = startTime + this.nextEighthIndex * eighthDuration;
      if (this.hatsEnabled) {
        this.playHat(when, this.nextEighthIndex % 2 === 1);
      }
      this.nextEighthIndex += 1;
    }

    while (startTime + this.nextBarIndex * barDuration <= horizon) {
      const when = startTime + this.nextBarIndex * barDuration;
      if (this.droneEnabled) {
        this.playDrone(when, barDuration);
      }
      this.nextBarIndex += 1;
    }
  }

  getTransportQuarterIndex(): number | null {
    if (!this.audioContext || this.transportStartTime === undefined) {
      return null;
    }

    const quarterDuration = 60 / this.bpm;
    const elapsed = this.audioContext.currentTime - this.transportStartTime;

    if (elapsed <= 0) {
      return 0;
    }

    return Math.floor(elapsed / quarterDuration);
  }

  getBeatPulse(): number {
    if (!this.audioContext || this.transportStartTime === undefined) {
      return 0;
    }

    const quarterDuration = 60 / this.bpm;
    const elapsed = this.audioContext.currentTime - this.transportStartTime;

    if (elapsed <= 0) {
      return 0;
    }

    const phase = (elapsed / quarterDuration) % 1;
    const quarterIndex = Math.floor(elapsed / quarterDuration);
    const accent = quarterIndex % 4 === 0 ? 1 : 0.78;
    const basePulse = Math.exp(-phase * 7.6);
    const tail = Math.max(0, 1 - phase * 1.8);

    return clamp(basePulse * tail * accent, 0, 1);
  }

  private syncMasterVolume(): void {
    if (!this.masterGain || !this.audioContext) {
      return;
    }

    this.masterGain.gain.setTargetAtTime(
      this.muted ? 0.0001 : this.volume,
      this.audioContext.currentTime,
      0.02,
    );
  }

  private playVoice(options: {
    family: InstrumentFamily;
    midi: number;
    gain: number;
    pan: number;
    when: number;
  }): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const frequency = midiToFrequency(options.midi);
    const output = this.audioContext.createGain();
    const panNode = this.audioContext.createStereoPanner();

    output.connect(panNode);
    panNode.connect(this.masterGain);
    panNode.pan.setValueAtTime(options.pan, options.when);

    if (options.family === "bell") {
      this.playBellVoice(frequency, options.gain, options.when, output);
      return;
    }

    if (options.family === "bass") {
      this.playBassVoice(frequency, options.gain, options.when, output);
      return;
    }

    if (options.family === "snare") {
      this.playSnareImpact(options.gain * 18, options.pan, options.when);
      return;
    }

    this.playSparkVoice(frequency, options.gain, options.when, output);
  }

  private getNextSixteenthTime(): number {
    if (!this.audioContext) {
      return 0;
    }

    const now = this.audioContext.currentTime;

    if (this.transportStartTime === undefined) {
      this.transportStartTime = now + 0.05;
    }

    const stepDuration = 60 / this.bpm / SIXTEENTH_NOTES_PER_BEAT;

    if (now <= this.transportStartTime) {
      return this.transportStartTime;
    }

    const stepsSinceStart = Math.ceil((now - this.transportStartTime) / stepDuration);
    let scheduledTime = this.transportStartTime + stepsSinceStart * stepDuration;

    if (scheduledTime - now < MIN_SCHEDULE_LOOKAHEAD) {
      scheduledTime += stepDuration;
    }

    return scheduledTime;
  }

  private syncDisplayedHarmony(time: number): void {
    const harmony = this.getHarmonyForTime(time);
    this.rootNote = harmony.rootNote;
    this.mode = harmony.mode;
  }

  private getHarmonyForTime(time: number): { rootNote: RootNoteName; mode: ScaleModeName } {
    if (this.transportStartTime === undefined) {
      return EVOLVING_HARMONIES[0];
    }

    const barDuration = (60 / this.bpm) * BEATS_PER_BAR;

    if (time <= this.transportStartTime) {
      return EVOLVING_HARMONIES[0];
    }

    const barsSinceStart = Math.floor((time - this.transportStartTime) / barDuration);
    const sectionIndex = Math.floor(barsSinceStart / BARS_PER_SECTION);
    return EVOLVING_HARMONIES[sectionIndex % EVOLVING_HARMONIES.length];
  }

  private playKick(when: number, accented: boolean): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const ctx = this.audioContext;
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const clickFilter = ctx.createBiquadFilter();
    const click = ctx.createBufferSource();
    const clickGain = ctx.createGain();
    const output = ctx.createGain();
    const duration = accented ? 0.32 : 0.26;
    const peakGain = accented ? 0.54 : 0.42;
    const startFrequency = accented ? 156 : 138;
    const endFrequency = accented ? 44 : 48;

    body.type = "sine";
    body.frequency.setValueAtTime(startFrequency, when);
    body.frequency.exponentialRampToValueAtTime(endFrequency, when + 0.11);

    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.linearRampToValueAtTime(peakGain, when + 0.005);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    clickFilter.type = "highpass";
    clickFilter.frequency.setValueAtTime(1600, when);
    clickGain.gain.setValueAtTime(accented ? 0.12 : 0.08, when);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);

    output.gain.setValueAtTime(0.78, when);

    body.connect(bodyGain);
    bodyGain.connect(output);

    click.buffer = this.noiseBuffer ?? this.createNoiseBuffer();
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(output);

    output.connect(this.masterGain);

    body.start(when);
    body.stop(when + duration + 0.02);
    click.start(when);
    click.stop(when + 0.03);
  }

  private createNoiseBuffer(): AudioBuffer {
    const ctx = this.audioContext!;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.floor(sampleRate * 0.04), sampleRate);
    const channel = buffer.getChannelData(0);

    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = (Math.random() * 2 - 1) * (1 - index / channel.length);
    }

    return buffer;
  }

  private playSnare(when: number): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const ctx = this.audioContext;
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const snap = ctx.createOscillator();
    const snapGain = ctx.createGain();
    const output = ctx.createGain();

    noise.buffer = this.noiseBuffer ?? this.createNoiseBuffer();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(2050, when);
    noiseFilter.Q.value = 0.9;
    noiseGain.gain.setValueAtTime(0.0001, when);
    noiseGain.gain.linearRampToValueAtTime(0.3, when + 0.003);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);

    body.type = "triangle";
    body.frequency.setValueAtTime(240, when);
    body.frequency.exponentialRampToValueAtTime(118, when + 0.1);
    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.linearRampToValueAtTime(0.16, when + 0.002);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);

    snap.type = "square";
    snap.frequency.setValueAtTime(3100, when);
    snap.frequency.exponentialRampToValueAtTime(900, when + 0.026);
    snapGain.gain.setValueAtTime(0.0001, when);
    snapGain.gain.linearRampToValueAtTime(0.1, when + 0.001);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.028);

    output.gain.setValueAtTime(0.94, when);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(output);

    body.connect(bodyGain);
    bodyGain.connect(output);

    snap.connect(snapGain);
    snapGain.connect(output);

    output.connect(this.masterGain);

    noise.start(when);
    noise.stop(when + 0.17);
    body.start(when);
    body.stop(when + 0.13);
    snap.start(when);
    snap.stop(when + 0.03);
  }

  private playSnareImpact(impact: number, pan: number, when: number): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const ctx = this.audioContext;
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const click = ctx.createOscillator();
    const clickGain = ctx.createGain();
    const output = ctx.createGain();
    const panNode = ctx.createStereoPanner();
    const energy = 0.42 + clamp(impact / 18, 0, 1) * 0.5;

    output.connect(panNode);
    panNode.connect(this.masterGain);
    panNode.pan.setValueAtTime(pan, when);

    noise.buffer = this.noiseBuffer ?? this.createNoiseBuffer();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(2280, when);
    noiseFilter.Q.value = 0.95;
    noiseGain.gain.setValueAtTime(0.0001, when);
    noiseGain.gain.linearRampToValueAtTime(0.22 * energy, when + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.11);

    body.type = "triangle";
    body.frequency.setValueAtTime(284, when);
    body.frequency.exponentialRampToValueAtTime(138, when + 0.07);
    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.linearRampToValueAtTime(0.14 * energy, when + 0.002);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);

    click.type = "square";
    click.frequency.setValueAtTime(3600, when);
    click.frequency.exponentialRampToValueAtTime(1200, when + 0.018);
    clickGain.gain.setValueAtTime(0.0001, when);
    clickGain.gain.linearRampToValueAtTime(0.075 * energy, when + 0.001);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.02);

    output.gain.setValueAtTime(0.92, when);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(output);

    body.connect(bodyGain);
    bodyGain.connect(output);

    click.connect(clickGain);
    clickGain.connect(output);

    noise.start(when);
    noise.stop(when + 0.12);
    body.start(when);
    body.stop(when + 0.1);
    click.start(when);
    click.stop(when + 0.022);
  }

  private playHat(when: number, offbeat: boolean): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const ctx = this.audioContext;
    const noise = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const tightFilter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    const output = ctx.createGain();

    noise.buffer = this.noiseBuffer ?? this.createNoiseBuffer();

    filter.type = "highpass";
    filter.frequency.setValueAtTime(offbeat ? 6200 : 5600, when);
    filter.Q.value = 0.8;

    tightFilter.type = "bandpass";
    tightFilter.frequency.setValueAtTime(offbeat ? 9800 : 9200, when);
    tightFilter.Q.value = 1.3;

    env.gain.setValueAtTime(0.0001, when);
    env.gain.linearRampToValueAtTime(offbeat ? 0.13 : 0.09, when + 0.0015);
    env.gain.exponentialRampToValueAtTime(0.0001, when + (offbeat ? 0.075 : 0.05));

    output.gain.setValueAtTime(0.62, when);

    noise.connect(filter);
    filter.connect(tightFilter);
    tightFilter.connect(env);
    env.connect(output);
    output.connect(this.masterGain);

    noise.start(when);
    noise.stop(when + 0.08);
  }

  private playDrone(when: number, barDuration: number): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const harmony =
      this.harmonyControlMode === "cycle"
        ? this.getHarmonyForTime(when)
        : { rootNote: this.rootNote, mode: this.mode };
    const rootMidi = this.quantizer.quantizeMidi(
      ROOT_NOTES[harmony.rootNote],
      SCALE_MODES[harmony.mode],
      47,
    );
    const fifthMidi = this.quantizer.quantizeMidi(
      ROOT_NOTES[harmony.rootNote],
      SCALE_MODES[harmony.mode],
      rootMidi + 7,
    );
    const ninthMidi = this.quantizer.quantizeMidi(
      ROOT_NOTES[harmony.rootNote],
      SCALE_MODES[harmony.mode],
      rootMidi + 14,
    );
    const sustain = barDuration * 0.94;
    const endTime = when + sustain;
    const ctx = this.audioContext;
    const output = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const root = ctx.createOscillator();
    const fifth = ctx.createOscillator();
    const air = ctx.createOscillator();
    const rootGain = ctx.createGain();
    const fifthGain = ctx.createGain();
    const airGain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();

    root.type = "triangle";
    root.frequency.setValueAtTime(midiToFrequency(rootMidi), when);
    fifth.type = "sine";
    fifth.frequency.setValueAtTime(midiToFrequency(fifthMidi), when);
    air.type = "triangle";
    air.frequency.setValueAtTime(midiToFrequency(ninthMidi), when);
    air.detune.setValueAtTime(5, when);

    rootGain.gain.setValueAtTime(0.16, when);
    fifthGain.gain.setValueAtTime(0.08, when);
    airGain.gain.setValueAtTime(0.035, when);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(720, when);
    filter.frequency.linearRampToValueAtTime(960, endTime);
    filter.Q.value = 0.7;

    output.gain.setValueAtTime(0.0001, when);
    output.gain.linearRampToValueAtTime(0.16, when + 0.18);
    output.gain.setValueAtTime(0.16, Math.max(when + 0.18, endTime - 0.42));
    output.gain.exponentialRampToValueAtTime(0.0001, endTime);

    lfo.type = "sine";
    lfo.frequency.setValueAtTime(0.16, when);
    lfoDepth.gain.setValueAtTime(24, when);

    lfo.connect(lfoDepth);
    lfoDepth.connect(filter.detune);

    root.connect(rootGain);
    rootGain.connect(filter);
    fifth.connect(fifthGain);
    fifthGain.connect(filter);
    air.connect(airGain);
    airGain.connect(filter);
    filter.connect(output);
    output.connect(this.masterGain);

    root.start(when);
    fifth.start(when);
    air.start(when);
    lfo.start(when);
    root.stop(endTime + 0.04);
    fifth.stop(endTime + 0.04);
    air.stop(endTime + 0.04);
    lfo.stop(endTime + 0.04);
  }

  private playMegaVoice(impact: number, pan: number, when: number): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const ctx = this.audioContext;
    const output = ctx.createGain();
    const panNode = ctx.createStereoPanner();
    const variant = Math.floor(Math.random() * 3);
    const energy = 0.42 + clamp(impact / 18, 0, 1) * 0.48;

    output.connect(panNode);
    panNode.connect(this.masterGain);
    panNode.pan.setValueAtTime(pan, when);
    output.gain.setValueAtTime(0.88, when);

    if (variant === 0) {
      const noise = ctx.createBufferSource();
      const noiseFilter = ctx.createBiquadFilter();
      const noiseGain = ctx.createGain();
      const body = ctx.createOscillator();
      const bodyGain = ctx.createGain();

      noise.buffer = this.noiseBuffer ?? this.createNoiseBuffer();
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.setValueAtTime(1240, when);
      noiseFilter.Q.value = 1.1;
      noiseGain.gain.setValueAtTime(0.0001, when);
      noiseGain.gain.linearRampToValueAtTime(0.18 * energy, when + 0.004);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.24);

      body.type = "sawtooth";
      body.frequency.setValueAtTime(290, when);
      body.frequency.exponentialRampToValueAtTime(92, when + 0.2);
      bodyGain.gain.setValueAtTime(0.0001, when);
      bodyGain.gain.linearRampToValueAtTime(0.22 * energy, when + 0.006);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);

      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(output);
      body.connect(bodyGain);
      bodyGain.connect(output);

      noise.start(when);
      noise.stop(when + 0.25);
      body.start(when);
      body.stop(when + 0.3);
      return;
    }

    if (variant === 1) {
      const shimmer = ctx.createOscillator();
      const shimmerGain = ctx.createGain();
      const noise = ctx.createBufferSource();
      const noiseFilter = ctx.createBiquadFilter();
      const noiseGain = ctx.createGain();

      shimmer.type = "triangle";
      shimmer.frequency.setValueAtTime(620, when);
      shimmer.frequency.exponentialRampToValueAtTime(210, when + 0.12);
      shimmerGain.gain.setValueAtTime(0.0001, when);
      shimmerGain.gain.linearRampToValueAtTime(0.18 * energy, when + 0.002);
      shimmerGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);

      noise.buffer = this.noiseBuffer ?? this.createNoiseBuffer();
      noiseFilter.type = "highpass";
      noiseFilter.frequency.setValueAtTime(1800, when);
      noiseGain.gain.setValueAtTime(0.0001, when);
      noiseGain.gain.linearRampToValueAtTime(0.14 * energy, when + 0.002);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);

      shimmer.connect(shimmerGain);
      shimmerGain.connect(output);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(output);

      shimmer.start(when);
      shimmer.stop(when + 0.2);
      noise.start(when);
      noise.stop(when + 0.14);
      return;
    }

    const body = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const subGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(920, when);
    filter.frequency.exponentialRampToValueAtTime(420, when + 0.22);
    filter.Q.value = 1.4;

    body.type = "square";
    body.frequency.setValueAtTime(184, when);
    body.frequency.exponentialRampToValueAtTime(74, when + 0.18);
    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.linearRampToValueAtTime(0.2 * energy, when + 0.005);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.26);

    sub.type = "sine";
    sub.frequency.setValueAtTime(62, when);
    subGain.gain.setValueAtTime(0.0001, when);
    subGain.gain.linearRampToValueAtTime(0.16 * energy, when + 0.008);
    subGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);

    body.connect(bodyGain);
    bodyGain.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    filter.connect(output);

    body.start(when);
    body.stop(when + 0.28);
    sub.start(when);
    sub.stop(when + 0.32);
  }

  private playMegaComboVoice(impact: number, pan: number, when: number): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const ctx = this.audioContext;
    const output = ctx.createGain();
    const panNode = ctx.createStereoPanner();
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    const bodyA = ctx.createOscillator();
    const bodyB = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const toneFilter = ctx.createBiquadFilter();
    const energy = 0.55 + clamp(impact / 20, 0, 1) * 0.55;

    output.connect(panNode);
    panNode.connect(this.masterGain);
    panNode.pan.setValueAtTime(pan * 0.65, when);
    output.gain.setValueAtTime(1.05, when);

    noise.buffer = this.noiseBuffer ?? this.createNoiseBuffer();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(1680, when);
    noiseFilter.frequency.exponentialRampToValueAtTime(740, when + 0.24);
    noiseFilter.Q.value = 1.2;
    noiseGain.gain.setValueAtTime(0.0001, when);
    noiseGain.gain.linearRampToValueAtTime(0.22 * energy, when + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.26);

    sub.type = "sine";
    sub.frequency.setValueAtTime(92, when);
    sub.frequency.exponentialRampToValueAtTime(39, when + 0.42);
    subGain.gain.setValueAtTime(0.0001, when);
    subGain.gain.linearRampToValueAtTime(0.24 * energy, when + 0.01);
    subGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.5);

    bodyA.type = "sawtooth";
    bodyA.frequency.setValueAtTime(440, when);
    bodyA.frequency.exponentialRampToValueAtTime(176, when + 0.22);
    bodyB.type = "triangle";
    bodyB.frequency.setValueAtTime(660, when);
    bodyB.frequency.exponentialRampToValueAtTime(248, when + 0.18);

    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.linearRampToValueAtTime(0.16 * energy, when + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);

    toneFilter.type = "lowpass";
    toneFilter.frequency.setValueAtTime(2200, when);
    toneFilter.frequency.exponentialRampToValueAtTime(620, when + 0.28);
    toneFilter.Q.value = 1.05;

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(output);

    sub.connect(subGain);
    subGain.connect(output);

    bodyA.connect(bodyGain);
    bodyB.connect(bodyGain);
    bodyGain.connect(toneFilter);
    toneFilter.connect(output);

    noise.start(when);
    noise.stop(when + 0.28);
    sub.start(when);
    sub.stop(when + 0.52);
    bodyA.start(when);
    bodyA.stop(when + 0.32);
    bodyB.start(when);
    bodyB.stop(when + 0.28);
  }

  private playBellVoice(
    frequency: number,
    gainAmount: number,
    now: number,
    output: GainNode,
  ): void {
    const ctx = this.audioContext!;
    const env = ctx.createGain();
    const partialA = ctx.createOscillator();
    const partialB = ctx.createOscillator();
    const shimmer = ctx.createGain();

    partialA.type = "sine";
    partialA.frequency.setValueAtTime(frequency, now);

    partialB.type = "triangle";
    partialB.frequency.setValueAtTime(frequency * 2.01, now);

    shimmer.gain.setValueAtTime(0.32, now);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gainAmount * 0.52, now + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 1.45);

    partialA.connect(env);
    partialB.connect(shimmer);
    shimmer.connect(env);
    env.connect(output);

    partialA.start(now);
    partialB.start(now);
    partialA.stop(now + 1.6);
    partialB.stop(now + 1.6);
  }

  private playBassVoice(
    frequency: number,
    gainAmount: number,
    now: number,
    output: GainNode,
  ): void {
    const ctx = this.audioContext!;
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const body = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(760, now);
    filter.Q.value = 1.2;

    body.type = "triangle";
    body.frequency.setValueAtTime(frequency, now);

    sub.type = "sine";
    sub.frequency.setValueAtTime(frequency / 2, now);

    subGain.gain.setValueAtTime(0.34, now);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gainAmount * 0.68, now + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);

    body.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    filter.connect(env);
    env.connect(output);

    body.start(now);
    sub.start(now);
    body.stop(now + 0.82);
    sub.stop(now + 0.82);
  }

  private playSparkVoice(
    frequency: number,
    gainAmount: number,
    now: number,
    output: GainNode,
  ): void {
    const ctx = this.audioContext!;
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const body = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const overtoneGain = ctx.createGain();

    filter.type = "highpass";
    filter.frequency.setValueAtTime(720, now);
    filter.Q.value = 0.9;

    body.type = "square";
    body.frequency.setValueAtTime(frequency, now);
    body.detune.setValueAtTime(-4, now);

    overtone.type = "triangle";
    overtone.frequency.setValueAtTime(frequency * 2.03, now);
    overtoneGain.gain.setValueAtTime(0.25, now);

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gainAmount * 0.42, now + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    body.connect(filter);
    overtone.connect(overtoneGain);
    overtoneGain.connect(filter);
    filter.connect(env);
    env.connect(output);

    body.start(now);
    overtone.start(now);
    body.stop(now + 0.28);
    overtone.stop(now + 0.28);
  }
}
