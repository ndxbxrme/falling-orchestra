import { ROOT_NOTES, SCALE_MODES } from "./config";
import { ScaleQuantizer } from "./ScaleQuantizer";
import type { HarmonySpanConfig, LoopClipConfig, SongConfig } from "./songConfig";
import type { InstrumentFamily, PlayedNote, RootNoteName, ScaleModeName } from "./types";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const midiToFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
const SIXTEENTH_NOTES_PER_BEAT = 4;
const DEFAULT_BEATS_PER_BAR = 4;
const DEFAULT_BPM = 120;
const INITIAL_TRANSPORT_LEAD = 0.35;
const MIN_SCHEDULE_LOOKAHEAD = 0.012;
const TRANSPORT_LOOKAHEAD = 0.16;
const LOOP_DEBUG =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const midiToLabel = (midi: number): string => {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
};

const logLoopDebug = (message: string, details?: Record<string, unknown>): void => {
  if (!LOOP_DEBUG) {
    return;
  }

  if (details) {
    console.debug(`[MusicSystem] ${message}`, details);
    return;
  }

  console.debug(`[MusicSystem] ${message}`);
};

export class MusicSystem {
  rootNote: RootNoteName = "C";
  mode: ScaleModeName = "ionian";
  muted = false;
  volume = 0.72;
  currentGrooveLevel = 1;

  private audioContext?: AudioContext;
  private masterGain?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private quantizer = new ScaleQuantizer();
  private bpm = DEFAULT_BPM;
  private beatsPerBar = DEFAULT_BEATS_PER_BAR;
  private harmonyCycleBars = 4;
  private transportStartTime?: number;
  private nextGrooveBoundaryTime?: number;
  private nextQuarterIndex = 0;
  private nextEighthIndex = 0;
  private nextBarIndex = 0;
  private noiseBuffer?: AudioBuffer;
  private harmonyControlMode: "cycle" | "manual" = "cycle";
  private song?: SongConfig;
  private grooveLevels = new Map<
    number,
    { main?: LoopClipConfig; intro?: LoopClipConfig; completesSong?: boolean }
  >();
  private harmonyTimeline: HarmonySpanConfig[] = [];
  private loopAudioData = new Map<string, ArrayBuffer>();
  private loopFetchPromise?: Promise<void>;
  private loopBuffers = new Map<string, AudioBuffer>();
  private loopLoadPromise?: Promise<void>;
  private desiredGrooveLevel = 1;
  private queuedTransitionLevel: number | null = null;
  private scheduledLoopSources = new Set<AudioBufferSourceNode>();
  private songCompleted = false;
  private songEndingScheduled = false;

  loadSong(song: SongConfig): void {
    this.song = song;
    this.bpm = song.transport.bpm;
    this.beatsPerBar = song.transport.beatsPerBar;
    this.harmonyCycleBars = song.transport.harmonyCycleBars;
    this.harmonyTimeline = song.harmonyTimeline;
    this.grooveLevels = new Map(
      song.grooveLevels.map((grooveLevel) => [
        grooveLevel.level,
        {
          main: grooveLevel.main,
          intro: grooveLevel.intro,
          completesSong: grooveLevel.completesSong,
        },
      ]),
    );

    const baseLevel = song.grooveLevels[0]?.level;
    if (baseLevel === undefined) {
      throw new Error(`Song "${song.id}" is missing groove levels`);
    }

    this.currentGrooveLevel = baseLevel;
    this.desiredGrooveLevel = baseLevel;
    this.queuedTransitionLevel = null;
    this.songCompleted = false;
    this.songEndingScheduled = false;
    this.nextGrooveBoundaryTime = undefined;
    if (this.harmonyTimeline.length > 0) {
      this.rootNote = this.harmonyTimeline[0].rootNote;
      this.mode = this.harmonyTimeline[0].mode;
    }
    void this.prefetchLoopAssets();
  }

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

    await this.ensureLoopBuffersLoaded();

    if (this.transportStartTime === undefined) {
      const startTime = this.getInitialTransportStartTime();
      this.primeTransport(startTime);
      this.scheduleStartupGroove(startTime);
      logLoopDebug("unlock scheduled initial groove loop", {
        currentTime: this.audioContext.currentTime,
        startTime,
        leadTime: startTime - this.audioContext.currentTime,
        grooveLevel: this.currentGrooveLevel,
      });
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

  setGrooveLevel(level: number): void {
    if (!this.grooveLevels.has(level) || this.songCompleted || this.songEndingScheduled) {
      return;
    }

    this.desiredGrooveLevel = level;

    if (level === this.currentGrooveLevel) {
      this.queuedTransitionLevel = null;
      return;
    }

    this.queuedTransitionLevel = level;
  }

  resetGroovePlayback(): void {
    if (!this.audioContext) {
      return;
    }

    const baseLevel = this.getBaseGrooveLevel();
    const nextStartTime = this.getInitialTransportStartTime();
    this.stopScheduledLoopSources();
    this.currentGrooveLevel = baseLevel;
    this.desiredGrooveLevel = baseLevel;
    this.queuedTransitionLevel = null;
    this.songCompleted = false;
    this.songEndingScheduled = false;
    this.primeTransport(nextStartTime);
    this.scheduleStartupGroove(nextStartTime);
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

  isSongCompleted(): boolean {
    return this.songCompleted;
  }

  update(): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    if (this.transportStartTime === undefined) {
      return;
    }

    const quarterDuration = 60 / this.bpm;
    const eighthDuration = quarterDuration / 2;
    const barDuration = quarterDuration * this.beatsPerBar;
    const now = this.audioContext.currentTime;
    const startTime = this.transportStartTime;
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
      this.nextQuarterIndex += 1;
    }

    while (startTime + this.nextEighthIndex * eighthDuration <= horizon) {
      this.nextEighthIndex += 1;
    }

    while (startTime + this.nextBarIndex * barDuration <= horizon) {
      this.nextBarIndex += 1;
    }

    while (
      this.nextGrooveBoundaryTime !== undefined &&
      this.nextGrooveBoundaryTime <= horizon &&
      !this.songEndingScheduled &&
      !this.songCompleted
    ) {
      const when = this.nextGrooveBoundaryTime;
      this.scheduleLoopBoundary(when);
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
    const fallbackHarmony = this.harmonyTimeline[0] ?? {
      rootNote: this.rootNote,
      mode: this.mode,
      startBar: 1,
      lengthBars: this.harmonyCycleBars,
    };

    if (this.transportStartTime === undefined || this.harmonyTimeline.length === 0) {
      return { rootNote: fallbackHarmony.rootNote, mode: fallbackHarmony.mode };
    }

    const barDuration = (60 / this.bpm) * this.beatsPerBar;

    if (time <= this.transportStartTime) {
      return { rootNote: fallbackHarmony.rootNote, mode: fallbackHarmony.mode };
    }

    const barsSinceStart = Math.floor((time - this.transportStartTime) / barDuration);
    const cycleBar = ((barsSinceStart % this.harmonyCycleBars) + this.harmonyCycleBars) % this.harmonyCycleBars + 1;
    const harmony =
      this.harmonyTimeline.find((span) => cycleBar >= span.startBar && cycleBar < span.startBar + span.lengthBars) ??
      fallbackHarmony;

    return {
      rootNote: harmony.rootNote,
      mode: harmony.mode,
    };
  }

  private async ensureLoopBuffersLoaded(): Promise<void> {
    if (this.loopLoadPromise) {
      return this.loopLoadPromise;
    }

    if (!this.audioContext) {
      return;
    }

    await this.prefetchLoopAssets();

    this.loopLoadPromise = Promise.all(
      [...this.loopAudioData.entries()].map(async ([assetUrl, audioData]) => {
        if (this.loopBuffers.has(assetUrl)) {
          return;
        }
        const buffer = await this.audioContext!.decodeAudioData(audioData.slice(0));
        this.loopBuffers.set(assetUrl, buffer);
        logLoopDebug("decoded loop buffer", {
          assetUrl,
          duration: buffer.duration,
          sampleRate: buffer.sampleRate,
        });
      }),
    ).then(() => undefined);

    return this.loopLoadPromise;
  }

  private async prefetchLoopAssets(): Promise<void> {
    if (this.loopFetchPromise) {
      return this.loopFetchPromise;
    }

    const assetUrls = new Set<string>();
    for (const grooveLevel of this.grooveLevels.values()) {
      if (grooveLevel.main) {
        assetUrls.add(grooveLevel.main.src);
      }
      if (grooveLevel.intro) {
        assetUrls.add(grooveLevel.intro.src);
      }
    }

    this.loopFetchPromise = Promise.all(
      [...assetUrls].map(async (assetUrl) => {
        if (this.loopAudioData.has(assetUrl)) {
          return;
        }

        const response = await fetch(assetUrl);
        if (!response.ok) {
          throw new Error(`Failed to load loop asset: ${assetUrl}`);
        }

        this.loopAudioData.set(assetUrl, await response.arrayBuffer());
      }),
    ).then(() => undefined);

    return this.loopFetchPromise;
  }

  private getBaseGrooveLevel(): number {
    return this.song?.grooveLevels[0]?.level ?? this.currentGrooveLevel;
  }

  private getInitialTransportStartTime(): number {
    return (this.audioContext?.currentTime ?? 0) + INITIAL_TRANSPORT_LEAD;
  }

  private primeTransport(startTime: number): void {
    this.transportStartTime = startTime;
    this.nextGrooveBoundaryTime = undefined;
    this.nextQuarterIndex = 0;
    this.nextEighthIndex = 0;
    this.nextBarIndex = 0;
    logLoopDebug("primed transport", { startTime });
  }

  private scheduleStartupGroove(startTime: number): void {
    const baseLevel = this.getBaseGrooveLevel();
    const grooveLevel = this.grooveLevels.get(baseLevel);
    const intro = grooveLevel?.intro;
    const main = grooveLevel?.main;
    let mainStartTime = startTime;

    if (intro) {
      this.scheduleGrooveClip(baseLevel, "intro", startTime);
      mainStartTime += this.getClipDuration(intro);
    }

    if (!main) {
      this.nextGrooveBoundaryTime = undefined;
      return;
    }

    this.scheduleGrooveClip(baseLevel, "main", mainStartTime);
    this.nextGrooveBoundaryTime = mainStartTime + this.getClipDuration(main);
  }

  private scheduleLoopBoundary(when: number): void {
    logLoopDebug("loop boundary", {
      when,
      currentGrooveLevel: this.currentGrooveLevel,
      desiredGrooveLevel: this.desiredGrooveLevel,
      queuedTransitionLevel: this.queuedTransitionLevel,
      nextGrooveBoundaryTime: this.nextGrooveBoundaryTime,
    });

    this.nextGrooveBoundaryTime = undefined;

    const nextLevel = this.queuedTransitionLevel;
    if (nextLevel !== null && nextLevel !== this.currentGrooveLevel) {
      const grooveLevel = this.grooveLevels.get(nextLevel);
      this.queuedTransitionLevel = null;
      const intro = grooveLevel?.intro;
      const main = grooveLevel?.main;

      if (intro) {
        const introEndTime = when + this.getClipDuration(intro);
        this.scheduleGrooveClip(nextLevel, "intro", when, {
          onEnded: grooveLevel?.completesSong
            ? () => {
                this.songCompleted = true;
                this.songEndingScheduled = false;
                this.queuedTransitionLevel = null;
                this.desiredGrooveLevel = nextLevel;
                this.nextGrooveBoundaryTime = undefined;
              }
            : undefined,
        });

        if (main) {
          this.scheduleGrooveClip(nextLevel, "main", introEndTime);
          this.currentGrooveLevel = nextLevel;
          this.desiredGrooveLevel = nextLevel;
          this.nextGrooveBoundaryTime = introEndTime + this.getClipDuration(main);
          return;
        }

        if (grooveLevel?.completesSong) {
          this.currentGrooveLevel = nextLevel;
          this.desiredGrooveLevel = nextLevel;
          this.songEndingScheduled = true;
          return;
        }

        const fallbackMain = this.grooveLevels.get(this.currentGrooveLevel)?.main;
        if (fallbackMain) {
          this.scheduleGrooveClip(this.currentGrooveLevel, "main", introEndTime);
          this.desiredGrooveLevel = this.currentGrooveLevel;
          this.nextGrooveBoundaryTime = introEndTime + this.getClipDuration(fallbackMain);
        }
        return;
      }

      if (main) {
        this.scheduleGrooveClip(nextLevel, "main", when);
        this.currentGrooveLevel = nextLevel;
        this.desiredGrooveLevel = nextLevel;
        this.nextGrooveBoundaryTime = when + this.getClipDuration(main);
        return;
      }
    }

    const currentMain = this.grooveLevels.get(this.currentGrooveLevel)?.main;
    if (!currentMain) {
      return;
    }

    this.scheduleGrooveClip(this.currentGrooveLevel, "main", when);
    this.nextGrooveBoundaryTime = when + this.getClipDuration(currentMain);
  }

  private scheduleGrooveClip(
    level: number,
    kind: "main" | "intro",
    when: number,
    options?: { onEnded?: () => void },
  ): void {
    if (!this.audioContext || !this.masterGain) {
      return;
    }

    const grooveLevel = this.grooveLevels.get(level);
    const clip = kind === "intro" ? grooveLevel?.intro : grooveLevel?.main;
    const assetUrl = clip?.src;
    if (!clip || !assetUrl) {
      return;
    }

    const buffer = this.loopBuffers.get(assetUrl);
    if (!buffer) {
      logLoopDebug("missing loop buffer", { level, kind, assetUrl });
      return;
    }

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();
    const now = this.audioContext.currentTime;

    source.buffer = buffer;
    gainNode.gain.setValueAtTime(kind === "intro" ? 0.96 : 1, when);
    source.connect(gainNode);
    gainNode.connect(this.masterGain);
    logLoopDebug("scheduling groove clip", {
      level,
      kind,
      assetUrl,
      now,
      when,
      delay: when - now,
      bufferDuration: buffer.duration,
      stopTime: when + Math.min(buffer.duration, this.getClipDuration(clip)),
    });
    source.start(when);
    source.stop(when + Math.min(buffer.duration, this.getClipDuration(clip)));
    source.addEventListener("ended", () => {
      this.scheduledLoopSources.delete(source);
      source.disconnect();
      gainNode.disconnect();
      options?.onEnded?.();
      logLoopDebug("groove clip ended", {
        level,
        kind,
        assetUrl,
        endedAt: this.audioContext?.currentTime,
      });
    });
    this.scheduledLoopSources.add(source);
  }

  private getClipDuration(clip: LoopClipConfig): number {
    return (60 / this.bpm) * this.beatsPerBar * clip.bars;
  }

  private stopScheduledLoopSources(): void {
    for (const source of this.scheduledLoopSources) {
      try {
        source.stop();
      } catch {
        // Ignore sources that already ended or were never started.
      }
      source.disconnect();
    }
    this.scheduledLoopSources.clear();
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
