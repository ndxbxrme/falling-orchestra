import { ROOT_NOTES, SCALE_MODES } from "./config";
import { ScaleQuantizer } from "./ScaleQuantizer";
import type {
  HarmonySpanConfig,
  ImpactPaletteConfig,
  ImpactRoutingConfig,
  ImpactSampleLayerConfig,
  ImpactVoiceConfig,
  LoopClipConfig,
  SoloVoiceConfig,
  SongConfig,
} from "./songConfig";
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
const MAX_ACTIVE_IMPACT_VOICES = 36;
const MAX_ACTIVE_MEGA_VOICES = 8;
const DEFAULT_LOOP_BUS_GAIN = 1;
const DEFAULT_PLAYER_BUS_GAIN = 0.62;
const DEFAULT_IMPACT_PALETTE: ImpactPaletteConfig = {
  voices: {
    bell: {
      mode: "stab",
      gain: 0.58,
      attack: 0.002,
      decay: 0.24,
      cutoff: 1820,
      resonance: 1.2,
      drive: 0.34,
      tone: 0.2,
      routing: { dry: 0.74, drive: 0.42, delay: 0.08, reverb: 0.12, megaFx: 0.08 },
    },
    bass: {
      mode: "sub",
      gain: 0.76,
      attack: 0.002,
      decay: 0.42,
      cutoff: 840,
      resonance: 1,
      drive: 0.3,
      tone: -0.34,
      routing: { dry: 0.84, drive: 0.38, delay: 0.04, reverb: 0.08, megaFx: 0.08 },
    },
    spark: {
      mode: "tick",
      gain: 0.4,
      attack: 0.001,
      decay: 0.12,
      cutoff: 2400,
      resonance: 1.25,
      drive: 0.4,
      tone: 0.16,
      routing: { dry: 0.6, drive: 0.48, delay: 0.14, reverb: 0.08, megaFx: 0.12 },
    },
    snare: {
      mode: "snare",
      gain: 0.66,
      attack: 0.001,
      decay: 0.18,
      cutoff: 2240,
      resonance: 0.92,
      drive: 0.4,
      tone: 0,
      routing: { dry: 0.74, drive: 0.46, delay: 0.08, reverb: 0.1, megaFx: 0.12 },
    },
    mega: {
      mode: "mega",
      gain: 0.88,
      attack: 0.001,
      decay: 0.38,
      cutoff: 1760,
      resonance: 1.5,
      drive: 0.68,
      tone: 0.08,
      routing: { dry: 0.5, drive: 0.64, delay: 0.3, reverb: 0.18, megaFx: 0.82 },
    },
  },
  buses: {
    dry: { gain: 0.74, tone: 0, drive: 0 },
    drive: { gain: 0.34, tone: 0.08, drive: 0.46 },
    delay: { gain: 0.18, tone: -0.2, drive: 0.16, delayTime: 0.26, feedback: 0.28 },
    reverb: { gain: 0.14, tone: -0.28, drive: 0.08 },
    megaFx: { gain: 0.22, tone: 0.1, drive: 0.62, delayTime: 0.18, feedback: 0.38 },
  },
  grooveFxProfile: {
    driveBoost: 0.22,
    delayBoost: 0.18,
    reverbBoost: 0.12,
    megaBoost: 0.24,
    filterOpen: 800,
    wobbleDepth: 0,
    delayWobbleDepth: 0,
    filterResonance: 7.5,
    filterSweepDepth: 1480,
    filterLfoRateA: 0.031,
    filterLfoRateB: 0.009,
    filterLfoDepthA: 0.72,
    filterLfoDepthB: 0.48,
  },
  megaFxMacro: {
    duration: 1,
    decay: 1.6,
    xToDelay: 0.16,
    xToWidth: 0.24,
    yToDrive: 0.3,
    yToFeedback: 0.16,
    yToFilter: 600,
    comboMultiplier: 1.2,
  },
};
const midiToLabel = (midi: number): string => {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
};

const logLoopDebug = (message: string, details?: Record<string, unknown>): void => {
  void message;
  void details;
};

export class MusicSystem {
  rootNote: RootNoteName = "C";
  mode: ScaleModeName = "ionian";
  muted = false;
  paused = false;
  volume = 0.72;
  currentGrooveLevel = 1;
  loopBusVolume = DEFAULT_LOOP_BUS_GAIN;
  playerBusVolume = DEFAULT_PLAYER_BUS_GAIN;

  private audioContext?: AudioContext;
  private masterGain?: GainNode;
  private loopBusGain?: GainNode;
  private playerBusGain?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private impactMixGain?: GainNode;
  private impactMotionFilter?: BiquadFilterNode;
  private dryBusGain?: GainNode;
  private driveBusInput?: GainNode;
  private driveBusFilter?: BiquadFilterNode;
  private driveBusShaper?: WaveShaperNode;
  private driveBusGain?: GainNode;
  private delayBusInput?: GainNode;
  private delayBusFilter?: BiquadFilterNode;
  private delayBusNode?: DelayNode;
  private delayBusFeedback?: GainNode;
  private delayBusWet?: GainNode;
  private reverbBusInput?: GainNode;
  private reverbBusFilter?: BiquadFilterNode;
  private reverbBusWet?: GainNode;
  private megaBusInput?: GainNode;
  private megaBusFilter?: BiquadFilterNode;
  private megaBusShaper?: WaveShaperNode;
  private megaBusDelay?: DelayNode;
  private megaBusWet?: GainNode;
  private megaBusPanner?: StereoPannerNode;
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
  private impactPalette: ImpactPaletteConfig = DEFAULT_IMPACT_PALETTE;
  private grooveLevels = new Map<
    number,
    { main?: LoopClipConfig; intro?: LoopClipConfig; completesSong?: boolean }
  >();
  private harmonyTimeline: HarmonySpanConfig[] = [];
  private loopAudioData = new Map<string, ArrayBuffer>();
  private loopFetchPromise?: Promise<void>;
  private loopBuffers = new Map<string, AudioBuffer>();
  private loopLoadPromise?: Promise<void>;
  private impactSampleAudioData = new Map<string, ArrayBuffer>();
  private impactSampleFetchPromise?: Promise<void>;
  private impactSampleBuffers = new Map<string, AudioBuffer>();
  private impactSampleLoadPromise?: Promise<void>;
  private soloVoice?: {
    motionGain: GainNode;
    articulationGain: GainNode;
    filter: BiquadFilterNode;
    panner: StereoPannerNode;
    oscA: OscillatorNode;
    oscB: OscillatorNode;
    baseGain: number;
  };
  private soloVoiceConfig: SoloVoiceConfig = {};
  private lastSoloMidi?: number;
  private soloStepDirection: 1 | -1 = 1;
  private desiredGrooveLevel = 1;
  private queuedTransitionLevel: number | null = null;
  private transitionNoticeLevel: number | null = null;
  private transitionNoticeQueuedAt?: number;
  private transitionNoticeHandoffTime?: number;
  private pendingGrooveLandingLevel: number | null = null;
  private pendingGrooveLandingTime?: number;
  private landedGrooveLevel: number | null = null;
  private endingStartedAt?: number;
  private endingCompletesAt?: number;
  private scheduledLoopSources = new Set<AudioBufferSourceNode>();
  private songCompleted = false;
  private songEndingScheduled = false;
  private megaMacroState = {
    triggeredAt: Number.NEGATIVE_INFINITY,
    x: 0.5,
    y: 0,
    intensity: 0,
  };
  private activeImpactVoiceEnds: number[] = [];

  loadSong(song: SongConfig): void {
    this.song = song;
    this.impactPalette = song.impactPalette ?? DEFAULT_IMPACT_PALETTE;
    this.soloVoiceConfig = song.soloVoice ?? {};
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
    this.clearTransitionNotice();
    this.clearPendingGrooveLanding();
    this.landedGrooveLevel = null;
    this.endingStartedAt = undefined;
    this.endingCompletesAt = undefined;
    this.songCompleted = false;
    this.songEndingScheduled = false;
    this.activeImpactVoiceEnds = [];
    this.lastSoloMidi = undefined;
    this.soloStepDirection = 1;
    this.nextGrooveBoundaryTime = undefined;
    if (this.harmonyTimeline.length > 0) {
      this.rootNote = this.harmonyTimeline[0].rootNote;
      this.mode = this.harmonyTimeline[0].mode;
    }
    void this.prefetchLoopAssets();
    void this.prefetchImpactSampleAssets();
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
      this.loopBusGain = this.audioContext.createGain();
      this.loopBusGain.gain.value = this.loopBusVolume;
      this.playerBusGain = this.audioContext.createGain();
      this.playerBusGain.gain.value = this.playerBusVolume;
      this.loopBusGain.connect(this.masterGain);
      this.playerBusGain.connect(this.masterGain);
      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.audioContext.destination);
      this.noiseBuffer = this.createNoiseBuffer();
      this.initializeImpactGraph();
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    await this.ensureLoopBuffersLoaded();
    await this.ensureImpactSampleBuffersLoaded();

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

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.syncMasterVolume(true);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.syncMasterVolume();
  }

  setLoopBusVolume(volume: number): void {
    this.loopBusVolume = clamp(volume, 0, 2);
    if (!this.loopBusGain || !this.audioContext) {
      return;
    }
    this.loopBusGain.gain.setTargetAtTime(this.loopBusVolume, this.audioContext.currentTime, 0.02);
  }

  setPlayerBusVolume(volume: number): void {
    this.playerBusVolume = clamp(volume, 0, 2);
    if (!this.playerBusGain || !this.audioContext) {
      return;
    }
    this.playerBusGain.gain.setTargetAtTime(this.playerBusVolume, this.audioContext.currentTime, 0.02);
  }

  setGrooveLevel(level: number): void {
    if (!this.grooveLevels.has(level) || this.songCompleted || this.songEndingScheduled) {
      return;
    }

    this.desiredGrooveLevel = level;

    if (level === this.currentGrooveLevel) {
      this.queuedTransitionLevel = null;
      this.clearTransitionNotice();
      return;
    }

    this.queuedTransitionLevel = level;
    this.updateTransitionNotice(level);
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
    this.clearTransitionNotice();
    this.clearPendingGrooveLanding();
    this.landedGrooveLevel = null;
    this.endingStartedAt = undefined;
    this.endingCompletesAt = undefined;
    this.songCompleted = false;
    this.songEndingScheduled = false;
    this.activeImpactVoiceEnds = [];
    this.lastSoloMidi = undefined;
    this.soloStepDirection = 1;
    this.stopSoloVoice();
    this.resetImpactMixLevel();
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
      this.playVoice({
        family: "mega",
        midi: 43,
        pan: clamp(options.pan, -0.9, 0.9),
        gain: clamp(0.24 + options.impact / 18, 0.24, 1),
        when,
        impact: options.impact,
        normalizedX: options.normalizedX,
      });
      return {
        label: "MEGA",
        color: options.color,
      };
    }

    if (options.family === "snare") {
      this.playVoice({
        family: "snare",
        midi: 62,
        pan: clamp(options.pan, -0.9, 0.9),
        gain: clamp(0.12 + options.impact / 18, 0.12, 0.82),
        when,
        impact: options.impact,
        normalizedX: options.normalizedX,
      });
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
      impact: options.impact,
      normalizedX: options.normalizedX,
    });

    return {
      label: midiToLabel(quantized),
      color: options.color,
    };
  }

  triggerMegaCombo(options: { impact: number; pan: number }): void {
    const when = this.getNextSixteenthTime();
    const normalizedX = clamp((options.pan + 1) * 0.5, 0, 1);
    const impact = clamp(options.impact, 0, 20);
    this.playVoice({
      family: "mega",
      midi: 38,
      pan: clamp(options.pan * 0.72, -0.9, 0.9),
      gain: clamp(0.4 + impact / 20, 0.4, 1.15),
      when,
      impact,
      normalizedX,
      combo: true,
    });
  }

  triggerSoloNote(options: {
    noteRange: [number, number];
    normalizedX: number;
    impact: number;
  }): PlayedNote {
    const when = (this.audioContext?.currentTime ?? 0) + 0.008;
    const harmony =
      this.harmonyControlMode === "cycle"
        ? this.getHarmonyForTime(when)
        : { rootNote: this.rootNote, mode: this.mode };
    const baseMidi =
      options.noteRange[0] +
      options.normalizedX * (options.noteRange[1] - options.noteRange[0]) +
      clamp(options.impact, 0, 18) * 0.12;
    let quantized = this.quantizer.quantizeMidi(
      ROOT_NOTES[harmony.rootNote],
      SCALE_MODES[harmony.mode],
      baseMidi,
    );
    quantized = this.resolveSoloMidi(
      quantized,
      ROOT_NOTES[harmony.rootNote],
      SCALE_MODES[harmony.mode],
      options.noteRange,
      options.normalizedX,
    );
    this.lastSoloMidi = quantized;

    this.playSoloVoice(quantized, options.normalizedX, when);
    return {
      label: midiToLabel(quantized),
      color: "#ffd6ad",
    };
  }

  stopSoloVoice(): void {
    if (!this.audioContext || !this.soloVoice) {
      return;
    }

    const now = this.audioContext.currentTime;
    const { motionGain, articulationGain, oscA, oscB } = this.soloVoice;
    motionGain.gain.cancelScheduledValues(now);
    articulationGain.gain.cancelScheduledValues(now);
    motionGain.gain.setValueAtTime(Math.max(motionGain.gain.value, 0.0001), now);
    articulationGain.gain.setValueAtTime(Math.max(articulationGain.gain.value, 0.0001), now);
    motionGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    articulationGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    oscA.stop(now + 0.42);
    oscB.stop(now + 0.42);
    this.soloVoice = undefined;
    this.lastSoloMidi = undefined;
    this.soloStepDirection = 1;
  }

  dispose(): void {
    this.stopSoloVoice();
    this.activeImpactVoiceEnds = [];
    void this.audioContext?.close();
  }

  isSongCompleted(): boolean {
    return this.songCompleted;
  }

  getPendingGrooveBoost(): { targetLevel: number; intensity: number } | null {
    if (!this.audioContext || this.transitionNoticeLevel === null || this.transitionNoticeHandoffTime === undefined) {
      return null;
    }

    const now = this.audioContext.currentTime;
    if (now >= this.transitionNoticeHandoffTime) {
      this.clearTransitionNotice();
      return null;
    }

    const queuedAt = this.transitionNoticeQueuedAt ?? Math.max(0, this.transitionNoticeHandoffTime - 0.001);
    const totalWindow = Math.max(0.001, this.transitionNoticeHandoffTime - queuedAt);
    const progress = clamp((now - queuedAt) / totalWindow, 0, 1);

    return {
      targetLevel: this.transitionNoticeLevel,
      intensity: 0.16 + progress * 0.84,
    };
  }

  getEndingState(): { progress: number; intensity: number } | null {
    if (
      !this.audioContext ||
      this.songCompleted ||
      this.endingStartedAt === undefined ||
      this.endingCompletesAt === undefined
    ) {
      return null;
    }

    const now = this.audioContext.currentTime;
    if (now >= this.endingCompletesAt) {
      return null;
    }

    const totalWindow = Math.max(0.001, this.endingCompletesAt - this.endingStartedAt);
    const progress = clamp((now - this.endingStartedAt) / totalWindow, 0, 1);

    return {
      progress,
      intensity: 0.22 + progress * 0.78,
    };
  }

  consumeGrooveLandingEvent(): { level: number } | null {
    if (this.landedGrooveLevel === null) {
      return null;
    }

    const level = this.landedGrooveLevel;
    this.landedGrooveLevel = null;
    return { level };
  }

  update(): void {
    if (!this.audioContext || !this.loopBusGain) {
      return;
    }

    if (this.transportStartTime === undefined) {
      return;
    }

    const quarterDuration = 60 / this.bpm;
    const eighthDuration = quarterDuration / 2;
    const barDuration = quarterDuration * this.beatsPerBar;
    const now = this.audioContext.currentTime;
    if (
      this.pendingGrooveLandingLevel !== null &&
      this.pendingGrooveLandingTime !== undefined &&
      now >= this.pendingGrooveLandingTime
    ) {
      this.currentGrooveLevel = this.pendingGrooveLandingLevel;
      this.desiredGrooveLevel = this.pendingGrooveLandingLevel;
      this.landedGrooveLevel = this.pendingGrooveLandingLevel;
      this.clearPendingGrooveLanding();
      this.clearTransitionNotice();
    }
    if (this.transitionNoticeHandoffTime !== undefined && now >= this.transitionNoticeHandoffTime) {
      this.clearTransitionNotice();
    }
    this.updateImpactFxState(now);
    this.updateSoloVoiceMotion(now);
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

  private syncMasterVolume(immediate = false): void {
    if (!this.masterGain || !this.audioContext) {
      return;
    }

    const targetGain = this.paused || this.muted ? 0.0001 : this.volume;

    if (immediate) {
      this.masterGain.gain.cancelScheduledValues(this.audioContext.currentTime);
      this.masterGain.gain.setValueAtTime(targetGain, this.audioContext.currentTime);
      return;
    }

    this.masterGain.gain.setTargetAtTime(targetGain, this.audioContext.currentTime, 0.02);
  }

  private playVoice(options: {
    family: InstrumentFamily;
    midi: number;
    gain: number;
    pan: number;
    when: number;
    impact: number;
    normalizedX: number;
    combo?: boolean;
  }): void {
    if (!this.audioContext || !this.impactMixGain) {
      return;
    }

    this.pruneActiveImpactVoices(options.when);
    const voiceConfig = this.impactPalette.voices[options.family];
    if (!this.canScheduleImpactVoice(options.family, options.gain, options.combo ?? false)) {
      return;
    }
    const frequency = midiToFrequency(options.midi);
    const output = this.audioContext.createGain();
    output.gain.setValueAtTime(1, options.when);
    const cleanupNodes = this.routeImpactVoice(output, voiceConfig.routing, options.pan, options.when);
    let voiceDuration = this.playImpactSampleLayer(voiceConfig.sampleLayer, output, options.when, options.gain);

    if (voiceConfig.mode === "stab") {
      voiceDuration = Math.max(
        voiceDuration,
        this.playStabVoice(voiceConfig, frequency, options.gain, options.when, output),
      );
      this.registerImpactVoiceLifetime(options.when, voiceDuration, output, cleanupNodes);
      return;
    }

    if (voiceConfig.mode === "sub") {
      voiceDuration = Math.max(
        voiceDuration,
        this.playSubVoice(voiceConfig, frequency, options.gain, options.when, output),
      );
      this.registerImpactVoiceLifetime(options.when, voiceDuration, output, cleanupNodes);
      return;
    }

    if (voiceConfig.mode === "tick") {
      voiceDuration = Math.max(
        voiceDuration,
        this.playTickVoice(voiceConfig, frequency, options.gain, options.when, output),
      );
      this.registerImpactVoiceLifetime(options.when, voiceDuration, output, cleanupNodes);
      return;
    }

    if (voiceConfig.mode === "snare") {
      voiceDuration = Math.max(
        voiceDuration,
        this.playSnareVoice(voiceConfig, options.impact, options.when, output),
      );
      this.registerImpactVoiceLifetime(options.when, voiceDuration, output, cleanupNodes);
      return;
    }

    this.triggerMegaMacro(options.normalizedX, clamp(options.impact / 18, 0, 1), options.combo ?? false);
    voiceDuration = Math.max(
      voiceDuration,
      this.playMegaVoice(voiceConfig, frequency, options.impact, options.when, output, options.combo ?? false),
    );
    this.registerImpactVoiceLifetime(options.when, voiceDuration, output, cleanupNodes);
  }

  private pruneActiveImpactVoices(now: number): void {
    if (this.activeImpactVoiceEnds.length === 0) {
      return;
    }

    this.activeImpactVoiceEnds = this.activeImpactVoiceEnds.filter((endTime) => endTime > now);
  }

  private canScheduleImpactVoice(family: InstrumentFamily, gain: number, combo: boolean): boolean {
    const activeCount = this.activeImpactVoiceEnds.length;
    if (family === "mega" || combo) {
      return activeCount < MAX_ACTIVE_MEGA_VOICES;
    }

    if (activeCount >= MAX_ACTIVE_IMPACT_VOICES) {
      return false;
    }

    if (activeCount >= Math.floor(MAX_ACTIVE_IMPACT_VOICES * 0.85) && gain < 0.2) {
      return false;
    }

    return true;
  }

  private registerImpactVoiceLifetime(
    when: number,
    duration: number,
    output: GainNode,
    cleanupNodes: AudioNode[],
  ): void {
    if (!this.audioContext) {
      return;
    }

    const safeDuration = Math.max(0.06, duration);
    const endTime = when + safeDuration;
    this.activeImpactVoiceEnds.push(endTime);
    const cleanupDelayMs = Math.max(0, (endTime - this.audioContext.currentTime + 0.08) * 1000);

    window.setTimeout(() => {
      output.disconnect();
      for (const node of cleanupNodes) {
        node.disconnect();
      }
      this.pruneActiveImpactVoices(this.audioContext?.currentTime ?? Number.POSITIVE_INFINITY);
    }, cleanupDelayMs);
  }

  private getNextSixteenthTime(): number {
    if (!this.audioContext) {
      return 0;
    }

    const now = this.audioContext.currentTime;
    const transportStartTime = this.transportStartTime ?? now + 0.05;

    const stepDuration = 60 / this.bpm / SIXTEENTH_NOTES_PER_BEAT;

    if (now <= transportStartTime) {
      return transportStartTime;
    }

    const stepsSinceStart = Math.ceil((now - transportStartTime) / stepDuration);
    let scheduledTime = transportStartTime + stepsSinceStart * stepDuration;

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

  private async ensureImpactSampleBuffersLoaded(): Promise<void> {
    if (this.impactSampleLoadPromise) {
      return this.impactSampleLoadPromise;
    }

    if (!this.audioContext) {
      return;
    }

    await this.prefetchImpactSampleAssets();

    this.impactSampleLoadPromise = Promise.all(
      [...this.impactSampleAudioData.entries()].map(async ([assetUrl, audioData]) => {
        if (this.impactSampleBuffers.has(assetUrl)) {
          return;
        }

        const buffer = await this.audioContext!.decodeAudioData(audioData.slice(0));
        this.impactSampleBuffers.set(assetUrl, buffer);
      }),
    ).then(() => undefined);

    return this.impactSampleLoadPromise;
  }

  private async prefetchImpactSampleAssets(): Promise<void> {
    if (this.impactSampleFetchPromise) {
      return this.impactSampleFetchPromise;
    }

    const assetUrls = new Set<string>();
    for (const voice of Object.values(this.impactPalette.voices)) {
      if (voice.sampleLayer?.src) {
        assetUrls.add(voice.sampleLayer.src);
      }
    }

    if (assetUrls.size === 0) {
      return;
    }

    this.impactSampleFetchPromise = Promise.all(
      [...assetUrls].map(async (assetUrl) => {
        if (this.impactSampleAudioData.has(assetUrl)) {
          return;
        }

        const response = await fetch(assetUrl);
        if (!response.ok) {
          throw new Error(`Failed to load impact sample asset: ${assetUrl}`);
        }

        this.impactSampleAudioData.set(assetUrl, await response.arrayBuffer());
      }),
    ).then(() => undefined);

    return this.impactSampleFetchPromise;
  }

  private getBaseGrooveLevel(): number {
    return this.song?.grooveLevels[0]?.level ?? this.currentGrooveLevel;
  }

  private getInitialTransportStartTime(): number {
    return (this.audioContext?.currentTime ?? 0) + INITIAL_TRANSPORT_LEAD;
  }

  private updateTransitionNotice(level: number): void {
    if (!this.audioContext || this.nextGrooveBoundaryTime === undefined) {
      return;
    }

    this.transitionNoticeLevel = level;
    this.transitionNoticeQueuedAt = this.audioContext.currentTime;
    this.transitionNoticeHandoffTime = this.getGrooveTransitionHandoffTime(level, this.nextGrooveBoundaryTime);
  }

  private clearTransitionNotice(): void {
    this.transitionNoticeLevel = null;
    this.transitionNoticeQueuedAt = undefined;
    this.transitionNoticeHandoffTime = undefined;
  }

  private setPendingGrooveLanding(level: number, landingTime: number): void {
    this.pendingGrooveLandingLevel = level;
    this.pendingGrooveLandingTime = landingTime;
  }

  private clearPendingGrooveLanding(): void {
    this.pendingGrooveLandingLevel = null;
    this.pendingGrooveLandingTime = undefined;
  }

  private getGrooveTransitionHandoffTime(level: number, boundaryTime: number): number {
    const intro = this.grooveLevels.get(level)?.intro;
    if (!intro) {
      return boundaryTime;
    }

    const clampedBars = clamp(intro.grooveChangeAfterBars ?? 2, 0, intro.bars);
    return boundaryTime + (60 / this.bpm) * this.beatsPerBar * clampedBars;
  }

  private primeTransport(startTime: number): void {
    this.transportStartTime = startTime;
    this.nextGrooveBoundaryTime = undefined;
    this.nextQuarterIndex = 0;
    this.nextEighthIndex = 0;
    this.nextBarIndex = 0;
    this.resetImpactMixLevel();
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
        const grooveLandingTime = this.getGrooveTransitionHandoffTime(nextLevel, when);
        this.transitionNoticeHandoffTime = grooveLandingTime;
        this.setPendingGrooveLanding(nextLevel, grooveLandingTime);
        if (grooveLevel?.completesSong) {
          this.endingStartedAt = when;
          this.endingCompletesAt = introEndTime;
          this.scheduleImpactFadeOut(when, this.getClipDuration(intro));
        }
        this.scheduleGrooveClip(nextLevel, "intro", when, {
          onEnded: grooveLevel?.completesSong
            ? () => {
                this.songCompleted = true;
                this.songEndingScheduled = false;
                this.endingStartedAt = undefined;
                this.endingCompletesAt = undefined;
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
        this.clearTransitionNotice();
        this.setPendingGrooveLanding(nextLevel, when);
        this.scheduleGrooveClip(nextLevel, "main", when);
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

    const loopBusGain = this.loopBusGain;
    if (!loopBusGain) {
      return;
    }

    const source = this.audioContext.createBufferSource();
    const gainNode = this.audioContext.createGain();
    const now = this.audioContext.currentTime;

    source.buffer = buffer;
    gainNode.gain.setValueAtTime(kind === "intro" ? 0.96 : 1, when);
    source.connect(gainNode);
    gainNode.connect(loopBusGain);
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

  private scheduleImpactFadeOut(startTime: number, duration: number): void {
    if (!this.audioContext || !this.impactMixGain) {
      return;
    }

    const gain = this.impactMixGain.gain;
    const currentTime = this.audioContext.currentTime;
    const effectiveStart = Math.max(startTime, currentTime);
    const currentValue = gain.value;

    gain.cancelScheduledValues(currentTime);
    gain.setValueAtTime(currentValue, currentTime);
    gain.setValueAtTime(currentValue, effectiveStart);
    gain.linearRampToValueAtTime(0.0001, effectiveStart + Math.max(0.001, duration));
  }

  private resetImpactMixLevel(): void {
    if (!this.audioContext || !this.impactMixGain) {
      return;
    }

    const gain = this.impactMixGain.gain;
    const now = this.audioContext.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(1, now);
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

  private initializeImpactGraph(): void {
    if (!this.audioContext || !this.playerBusGain || this.impactMixGain) {
      return;
    }

    const ctx = this.audioContext;
    const impactMix = ctx.createGain();
    const motionFilter = ctx.createBiquadFilter();
    const dryBus = ctx.createGain();
    const driveInput = ctx.createGain();
    const driveFilter = ctx.createBiquadFilter();
    const driveShaper = ctx.createWaveShaper();
    const driveGain = ctx.createGain();
    const delayInput = ctx.createGain();
    const delayFilter = ctx.createBiquadFilter();
    const delayNode = ctx.createDelay(1.5);
    const delayFeedback = ctx.createGain();
    const delayWet = ctx.createGain();
    const reverbInput = ctx.createGain();
    const reverbFilter = ctx.createBiquadFilter();
    const reverbConvolver = ctx.createConvolver();
    const reverbWet = ctx.createGain();
    const megaInput = ctx.createGain();
    const megaFilter = ctx.createBiquadFilter();
    const megaShaper = ctx.createWaveShaper();
    const megaDelay = ctx.createDelay(1.2);
    const megaWet = ctx.createGain();
    const megaPanner = ctx.createStereoPanner();

    impactMix.gain.value = 1;
    motionFilter.type = "lowpass";
    dryBus.gain.value = 0;
    driveInput.gain.value = 1;
    driveGain.gain.value = 0;
    delayInput.gain.value = 1;
    delayFeedback.gain.value = 0;
    delayWet.gain.value = 0;
    reverbInput.gain.value = 1;
    reverbWet.gain.value = 0;
    megaInput.gain.value = 1;
    megaWet.gain.value = 0;
    megaPanner.pan.value = 0;

    impactMix.connect(motionFilter);
    motionFilter.connect(this.playerBusGain);

    dryBus.connect(impactMix);

    driveFilter.type = "lowpass";
    driveInput.connect(driveFilter);
    driveFilter.connect(driveShaper);
    driveShaper.connect(driveGain);
    driveGain.connect(impactMix);

    delayFilter.type = "lowpass";
    delayInput.connect(delayFilter);
    delayFilter.connect(delayNode);
    delayNode.connect(delayWet);
    delayWet.connect(impactMix);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayFilter);

    reverbFilter.type = "lowpass";
    reverbInput.connect(reverbFilter);
    reverbFilter.connect(reverbConvolver);
    reverbConvolver.connect(reverbWet);
    reverbWet.connect(impactMix);
    reverbConvolver.buffer = this.createImpulseResponse(1.9, 2.4);

    megaFilter.type = "bandpass";
    megaInput.connect(megaFilter);
    megaFilter.connect(megaShaper);
    megaShaper.connect(megaDelay);
    megaDelay.connect(megaPanner);
    megaPanner.connect(megaWet);
    megaWet.connect(impactMix);

    this.impactMixGain = impactMix;
    this.impactMotionFilter = motionFilter;
    this.dryBusGain = dryBus;
    this.driveBusInput = driveInput;
    this.driveBusFilter = driveFilter;
    this.driveBusShaper = driveShaper;
    this.driveBusGain = driveGain;
    this.delayBusInput = delayInput;
    this.delayBusFilter = delayFilter;
    this.delayBusNode = delayNode;
    this.delayBusFeedback = delayFeedback;
    this.delayBusWet = delayWet;
    this.reverbBusInput = reverbInput;
    this.reverbBusFilter = reverbFilter;
    this.reverbBusWet = reverbWet;
    this.megaBusInput = megaInput;
    this.megaBusFilter = megaFilter;
    this.megaBusShaper = megaShaper;
    this.megaBusDelay = megaDelay;
    this.megaBusWet = megaWet;
    this.megaBusPanner = megaPanner;
    this.updateImpactFxState(ctx.currentTime);
  }

  private updateImpactFxState(now: number): void {
    if (
      !this.impactMotionFilter ||
      !this.dryBusGain ||
      !this.driveBusFilter ||
      !this.driveBusShaper ||
      !this.driveBusGain ||
      !this.delayBusFilter ||
      !this.delayBusNode ||
      !this.delayBusFeedback ||
      !this.delayBusWet ||
      !this.reverbBusFilter ||
      !this.reverbBusWet ||
      !this.megaBusFilter ||
      !this.megaBusShaper ||
      !this.megaBusDelay ||
      !this.megaBusWet ||
      !this.megaBusPanner
    ) {
      return;
    }

    const groove = this.getGrooveFxIntensity();
    const profile = this.getResolvedGrooveFxProfile();
    const macro = this.getMegaMacroSnapshot(now);
    const lfoA = Math.sin(now * Math.PI * 2 * profile.filterLfoRateA);
    const lfoB = Math.sin(now * Math.PI * 2 * profile.filterLfoRateB + 1.7);
    const filterSweep =
      (lfoA * profile.filterLfoDepthA + lfoB * profile.filterLfoDepthB) *
      profile.filterSweepDepth *
      (0.34 + groove * 0.66);
    const delayWobble =
      Math.sin(now * Math.PI * 2 * 0.17) * (0.002 + groove * profile.delayWobbleDepth * 0.01);
    const width = (macro.x * 2 - 1) * macro.intensity * this.impactPalette.megaFxMacro.xToWidth;

    this.impactMotionFilter.frequency.setTargetAtTime(
      clamp(
        1450 +
          groove * (profile.filterOpen * 1.05) +
          filterSweep +
          macro.y * this.impactPalette.megaFxMacro.yToFilter * macro.intensity,
        260,
        9600,
      ),
      now,
      0.18,
    );
    this.impactMotionFilter.Q.setTargetAtTime(
      clamp(profile.filterResonance + groove * 1.1 + macro.y * 0.85 * macro.intensity, 0.8, 18),
      now,
      0.16,
    );

    this.dryBusGain.gain.setTargetAtTime(this.impactPalette.buses.dry.gain, now, 0.03);

    this.driveBusFilter.frequency.setTargetAtTime(
      clamp(
        1100 +
          this.impactPalette.buses.drive.tone * 1000 +
          groove * profile.filterOpen +
          filterSweep * 0.42 +
          macro.y * this.impactPalette.megaFxMacro.yToFilter * macro.intensity,
        420,
        6400,
      ),
      now,
      0.06,
    );
    this.driveBusFilter.Q.setTargetAtTime(
      clamp(1.2 + profile.filterResonance * 0.24 + groove * 0.4, 0.7, 9),
      now,
      0.08,
    );
    this.driveBusGain.gain.setTargetAtTime(
      this.impactPalette.buses.drive.gain + groove * profile.driveBoost + macro.y * 0.12 * macro.intensity,
      now,
      0.04,
    );
    this.driveBusShaper.curve = this.createDriveCurve(
      clamp(this.impactPalette.buses.drive.drive + groove * profile.driveBoost + macro.y * 0.2 * macro.intensity, 0, 1.4),
    ) as unknown as Float32Array<ArrayBuffer>;

    this.delayBusFilter.frequency.setTargetAtTime(
      clamp(1900 + groove * 900 + filterSweep * 0.22 + macro.y * 700 * macro.intensity, 700, 5200),
      now,
      0.08,
    );
    this.delayBusFilter.Q.setTargetAtTime(
      clamp(0.7 + profile.filterResonance * 0.12 + groove * 0.22, 0.4, 5),
      now,
      0.1,
    );
    this.delayBusNode.delayTime.setTargetAtTime(
      clamp(
        (this.impactPalette.buses.delay.delayTime ?? 0.26) +
          delayWobble +
          (macro.x - 0.5) * this.impactPalette.megaFxMacro.xToDelay * macro.intensity,
        0.08,
        0.58,
      ),
      now,
      0.06,
    );
    this.delayBusFeedback.gain.setTargetAtTime(
      clamp(
        (this.impactPalette.buses.delay.feedback ?? 0.18) + groove * 0.03 + macro.y * 0.08 * macro.intensity,
        0.04,
        0.24,
      ),
      now,
      0.06,
    );
    this.delayBusWet.gain.setTargetAtTime(
      this.impactPalette.buses.delay.gain + groove * profile.delayBoost + macro.intensity * 0.08,
      now,
      0.06,
    );

    this.reverbBusFilter.frequency.setTargetAtTime(
      clamp(1400 + groove * 700 + filterSweep * 0.16 + macro.y * 380 * macro.intensity, 500, 4200),
      now,
      0.1,
    );
    this.reverbBusFilter.Q.setTargetAtTime(
      clamp(0.45 + profile.filterResonance * 0.08 + groove * 0.12, 0.2, 3.5),
      now,
      0.12,
    );
    this.reverbBusWet.gain.setTargetAtTime(
      this.impactPalette.buses.reverb.gain + groove * profile.reverbBoost + macro.intensity * 0.06,
      now,
      0.08,
    );

    this.megaBusFilter.frequency.setTargetAtTime(
      clamp(900 + groove * 1200 + filterSweep * 0.34 + macro.y * 1100 * macro.intensity, 260, 7000),
      now,
      0.04,
    );
    this.megaBusFilter.Q.setTargetAtTime(
      clamp(1.8 + profile.filterResonance * 0.3 + groove * 0.55, 0.8, 11),
      now,
      0.06,
    );
    this.megaBusDelay.delayTime.setTargetAtTime(
      clamp(
        (this.impactPalette.buses.megaFx.delayTime ?? 0.18) +
          delayWobble * 0.8 +
          macro.x * 0.08 * macro.intensity,
        0.05,
        0.42,
      ),
      now,
      0.03,
    );
    this.megaBusWet.gain.setTargetAtTime(
      this.impactPalette.buses.megaFx.gain + groove * profile.megaBoost * 0.36 + macro.intensity * 0.12,
      now,
      0.04,
    );
    this.megaBusPanner.pan.setTargetAtTime(width, now, 0.04);
    this.megaBusShaper.curve = this.createDriveCurve(
      clamp(this.impactPalette.buses.megaFx.drive + groove * 0.26 + macro.y * this.impactPalette.megaFxMacro.yToDrive * macro.intensity, 0, 1.4),
    ) as unknown as Float32Array<ArrayBuffer>;
  }

  private getResolvedGrooveFxProfile() {
    const fallback = DEFAULT_IMPACT_PALETTE.grooveFxProfile;
    const profile = this.impactPalette.grooveFxProfile;
    return {
      ...fallback,
      ...profile,
      delayWobbleDepth: profile.delayWobbleDepth ?? 0,
      filterResonance: profile.filterResonance ?? fallback.filterResonance ?? 7.5,
      filterSweepDepth: profile.filterSweepDepth ?? fallback.filterSweepDepth ?? 1480,
      filterLfoRateA: profile.filterLfoRateA ?? fallback.filterLfoRateA ?? 0.031,
      filterLfoRateB: profile.filterLfoRateB ?? fallback.filterLfoRateB ?? 0.009,
      filterLfoDepthA: profile.filterLfoDepthA ?? fallback.filterLfoDepthA ?? 0.72,
      filterLfoDepthB: profile.filterLfoDepthB ?? fallback.filterLfoDepthB ?? 0.48,
    };
  }

  private playSoloVoice(midi: number, normalizedX: number, when: number): void {
    if (!this.audioContext) {
      return;
    }

    const frequency = midiToFrequency(midi);
    const pan = clamp(normalizedX * 1.2 - 0.6, -0.6, 0.6);
    const baseGain = this.soloVoiceConfig.baseGain ?? 0.12;
    const glideTime = this.soloVoiceConfig.glideTime ?? 0.11;
    const barDuration = (60 / this.bpm) * this.beatsPerBar;
    const decayDuration = 2;//Math.max(2.6, Math.min(2.2, barDuration * 1.0));
    const sustainHoldDuration = Math.max(0.6, Math.min(2.4, barDuration * 0.58));
    const releaseDuration = Math.max(1.2, Math.min(4.2, barDuration * 0.95));
    const sustainLevel = 0.48;
    const releaseStartTime = when + decayDuration + sustainHoldDuration;
    const releaseEndTime = releaseStartTime + releaseDuration;

    if (!this.soloVoice) {
      const ctx = this.audioContext;
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const mix = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const motionGain = ctx.createGain();
      const articulationGain = ctx.createGain();
      const panner = ctx.createStereoPanner();

      oscA.type = "triangle";
      oscB.type = "sawtooth";
      oscA.frequency.setValueAtTime(frequency, when);
      oscB.frequency.setValueAtTime(frequency * 1.002, when);

      mix.gain.value = 0.7;
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(880, when);
      filter.Q.setValueAtTime(5.2, when);
      motionGain.gain.setValueAtTime(0.0001, when);
      motionGain.gain.linearRampToValueAtTime(baseGain * 1.28, when + 0.03);
      articulationGain.gain.setValueAtTime(0.0001, when);
      articulationGain.gain.linearRampToValueAtTime(1.62, when + 0.016);
      articulationGain.gain.linearRampToValueAtTime(sustainLevel, when + decayDuration);
      articulationGain.gain.setValueAtTime(sustainLevel, releaseStartTime);
      articulationGain.gain.exponentialRampToValueAtTime(0.0001, releaseEndTime);
      panner.pan.setValueAtTime(pan, when);

      oscA.connect(mix);
      oscB.connect(mix);
      mix.connect(filter);
      filter.connect(motionGain);
      motionGain.connect(articulationGain);
      articulationGain.connect(panner);
      this.connectBusSend(panner, this.dryBusGain, 0.7, when);
      this.connectBusSend(panner, this.driveBusInput, 0.24, when);
      this.connectBusSend(panner, this.delayBusInput, 0.1, when);
      this.connectBusSend(panner, this.reverbBusInput, 0.08, when);

      oscA.start(when);
      oscB.start(when);

      this.soloVoice = {
        motionGain,
        articulationGain,
        filter,
        panner,
        oscA,
        oscB,
        baseGain,
      };
      return;
    }

    this.soloVoice.baseGain = baseGain;
    this.soloVoice.oscA.frequency.setTargetAtTime(frequency, when, glideTime);
    this.soloVoice.oscB.frequency.setTargetAtTime(frequency * 1.002, when, glideTime);
    this.soloVoice.panner.pan.setTargetAtTime(pan, when, 0.08);
    this.soloVoice.motionGain.gain.cancelScheduledValues(when);
    this.soloVoice.motionGain.gain.setValueAtTime(
      Math.max(this.soloVoice.motionGain.gain.value, 0.0001),
      when,
    );
    this.soloVoice.motionGain.gain.linearRampToValueAtTime(baseGain * 1.34, when + 0.03);
    this.soloVoice.articulationGain.gain.cancelScheduledValues(when);
    this.soloVoice.articulationGain.gain.setValueAtTime(
      Math.max(this.soloVoice.articulationGain.gain.value, 0.0001),
      when,
    );
    this.soloVoice.articulationGain.gain.linearRampToValueAtTime(1.72, when + 0.016);
    this.soloVoice.articulationGain.gain.linearRampToValueAtTime(sustainLevel, when + decayDuration);
    this.soloVoice.articulationGain.gain.setValueAtTime(sustainLevel, releaseStartTime);
    this.soloVoice.articulationGain.gain.exponentialRampToValueAtTime(0.0001, releaseEndTime);
  }

  private updateSoloVoiceMotion(now: number): void {
    if (!this.soloVoice) {
      return;
    }

    const groove = this.getGrooveFxIntensity();
    const sweepA = Math.sin(now * Math.PI * 2 * 0.021);
    const sweepB = Math.sin(now * Math.PI * 2 * 0.008 + 1.2);
    const cutoff =
      860 +
      groove * 980 +
      (sweepA * 0.68 + sweepB * 0.42) * 520;
    const pulse = this.getSoloPulseAtTime(now);
    this.soloVoice.filter.frequency.setTargetAtTime(
      clamp(cutoff + pulse * 260, 320, 4600),
      now,
      0.1,
    );
    this.soloVoice.filter.Q.setTargetAtTime(4.8 + groove * 1.4 + Math.max(0, sweepA) * 0.7, now, 0.22);
    this.soloVoice.motionGain.gain.setTargetAtTime(
      this.soloVoice.baseGain * (1.34 + groove * 0.1 + pulse * 0.1),
      now,
      0.03,
    );
  }

  private getSoloPulseAtTime(time: number): number {
    const pattern = this.soloVoiceConfig.pulsePattern?.length
      ? this.soloVoiceConfig.pulsePattern
      : [1, 0.92, 0.96, 0.9];
    const division = this.soloVoiceConfig.pulseDivision ?? "quarter";
    const stepDuration =
      division === "sixteenth"
        ? 60 / this.bpm / SIXTEENTH_NOTES_PER_BEAT
        : division === "eighth"
          ? 60 / this.bpm / 2
          : 60 / this.bpm;
    const startTime = this.transportStartTime ?? time;
    const elapsed = Math.max(0, time - startTime);
    const stepIndex = Math.floor(elapsed / stepDuration);
    const phase = (elapsed % stepDuration) / Math.max(stepDuration, 0.0001);
    const stepStrength = clamp(pattern[stepIndex % pattern.length] ?? 0, 0, 1.4);
    const hit = Math.exp(-phase * 5.2);
    return clamp(stepStrength * (0.74 + hit * 0.26), 0, 1.6);
  }

  private resolveSoloMidi(
    quantized: number,
    root: number,
    scaleIntervals: number[],
    noteRange: [number, number],
    normalizedX: number,
  ): number {
    if (this.lastSoloMidi === undefined || quantized !== this.lastSoloMidi) {
      if (normalizedX > 0.66) {
        this.soloStepDirection = 1;
      } else if (normalizedX < 0.34) {
        this.soloStepDirection = -1;
      }
      return quantized;
    }

    const candidates = this.getScaleCandidatesInRange(root, scaleIntervals, noteRange);
    if (candidates.length <= 1) {
      return quantized;
    }

    if (normalizedX > 0.66) {
      this.soloStepDirection = 1;
    } else if (normalizedX < 0.34) {
      this.soloStepDirection = -1;
    }

    const lastIndex = candidates.indexOf(this.lastSoloMidi);
    if (lastIndex >= 0) {
      const stepCandidate = candidates[lastIndex + this.soloStepDirection];
      if (stepCandidate !== undefined) {
        return stepCandidate;
      }

      this.soloStepDirection = this.soloStepDirection === 1 ? -1 : 1;
      const fallbackStep = candidates[lastIndex + this.soloStepDirection];
      if (fallbackStep !== undefined) {
        return fallbackStep;
      }
    }

    return candidates.find((midi) => midi !== this.lastSoloMidi) ?? quantized;
  }

  private getScaleCandidatesInRange(
    root: number,
    scaleIntervals: number[],
    noteRange: [number, number],
  ): number[] {
    const candidates: number[] = [];
    for (let midi = noteRange[0] - 12; midi <= noteRange[1] + 12; midi += 1) {
      const quantized = this.quantizer.quantizeMidi(root, scaleIntervals, midi);
      if (quantized < noteRange[0] || quantized > noteRange[1]) {
        continue;
      }
      if (!candidates.includes(quantized)) {
        candidates.push(quantized);
      }
    }
    return candidates.sort((a, b) => a - b);
  }

  private routeImpactVoice(
    source: AudioNode,
    routing: ImpactRoutingConfig,
    pan: number,
    when: number,
  ): AudioNode[] {
    if (!this.audioContext) {
      return [];
    }

    const panner = this.audioContext.createStereoPanner();
    const cleanupNodes: AudioNode[] = [panner];
    source.connect(panner);
    panner.pan.setValueAtTime(pan, when);
    this.connectBusSend(panner, this.dryBusGain, routing.dry, when, cleanupNodes);
    this.connectBusSend(panner, this.driveBusInput, routing.drive, when, cleanupNodes);
    this.connectBusSend(panner, this.delayBusInput, routing.delay, when, cleanupNodes);
    this.connectBusSend(panner, this.reverbBusInput, routing.reverb, when, cleanupNodes);
    this.connectBusSend(panner, this.megaBusInput, routing.megaFx, when, cleanupNodes);
    return cleanupNodes;
  }

  private connectBusSend(
    source: AudioNode,
    destination: AudioNode | undefined,
    amount: number,
    when: number,
    cleanupNodes?: AudioNode[],
  ): void {
    if (!this.audioContext || !destination || amount <= 0) {
      return;
    }

    const send = this.audioContext.createGain();
    send.gain.setValueAtTime(amount, when);
    source.connect(send);
    send.connect(destination);
    cleanupNodes?.push(send);
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
  private createImpulseResponse(duration: number, decay: number): AudioBuffer {
    const ctx = this.audioContext!;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
      const channel = buffer.getChannelData(channelIndex);
      for (let index = 0; index < length; index += 1) {
        const time = index / length;
        channel[index] = (Math.random() * 2 - 1) * (1 - time) ** decay;
      }
    }

    return buffer;
  }

  private createDriveCurve(amount: number): Float32Array<ArrayBufferLike> {
    const curve = new Float32Array(512);
    const drive = 8 + amount * 48;
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = ((1 + drive) * x) / (1 + drive * Math.abs(x));
    }
    return curve;
  }

  private createVoiceChain(
    config: ImpactVoiceConfig,
    output: GainNode,
    when: number,
    filterType: BiquadFilterType,
  ): { env: GainNode; filter: BiquadFilterNode } {
    const ctx = this.audioContext!;
    const filter = ctx.createBiquadFilter();
    const shaper = ctx.createWaveShaper();
    const env = ctx.createGain();

    filter.type = filterType;
    filter.frequency.setValueAtTime(clamp(config.cutoff, 120, 12000), when);
    filter.Q.value = config.resonance;
    shaper.curve = this.createDriveCurve(config.drive) as unknown as Float32Array<ArrayBuffer>;
    env.gain.setValueAtTime(0.0001, when);

    filter.connect(shaper);
    shaper.connect(env);
    env.connect(output);

    return { env, filter };
  }

  private playImpactSampleLayer(
    sampleLayer: ImpactSampleLayerConfig | undefined,
    output: GainNode,
    when: number,
    gainAmount: number,
  ): number {
    if (!this.audioContext || !sampleLayer?.src) {
      return 0;
    }

    const buffer = this.impactSampleBuffers.get(sampleLayer.src);
    if (!buffer) {
      return 0;
    }

    const source = this.audioContext.createBufferSource();
    const gain = this.audioContext.createGain();
    let tail: AudioNode = gain;

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(sampleLayer.playbackRate ?? 1, when);
    gain.gain.setValueAtTime(sampleLayer.gain * gainAmount, when);

    if (sampleLayer.filterType && sampleLayer.filterFrequency) {
      const filter = this.audioContext.createBiquadFilter();
      filter.type = sampleLayer.filterType;
      filter.frequency.setValueAtTime(sampleLayer.filterFrequency, when);
      source.connect(filter);
      filter.connect(gain);
      tail = filter;
    } else {
      source.connect(gain);
    }

    gain.connect(output);
    source.start(when);
    const duration = buffer.duration / (sampleLayer.playbackRate ?? 1);
    source.stop(when + duration);
    source.addEventListener("ended", () => {
      source.disconnect();
      gain.disconnect();
      tail.disconnect();
    });
    return duration;
  }

  private playStabVoice(
    config: ImpactVoiceConfig,
    frequency: number,
    gainAmount: number,
    when: number,
    output: GainNode,
  ): number {
    const ctx = this.audioContext!;
    const bodyA = ctx.createOscillator();
    const bodyB = ctx.createOscillator();
    const metallic = ctx.createOscillator();
    const metallicGain = ctx.createGain();
    const { env, filter } = this.createVoiceChain(config, output, when, "bandpass");
    const targetGain = config.gain * gainAmount;
    const detune = config.detuneCents ?? 0;
    const endFrequency = frequency * (1 - (config.pitchDrop ?? 0));

    bodyA.type = "sawtooth";
    bodyA.frequency.setValueAtTime(frequency, when);
    bodyA.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), when + config.decay);
    bodyA.detune.setValueAtTime(detune, when);

    bodyB.type = "triangle";
    bodyB.frequency.setValueAtTime(frequency * 0.997, when);
    bodyB.detune.setValueAtTime(-detune * 0.7, when);

    metallic.type = "square";
    metallic.frequency.setValueAtTime(frequency * 1.98, when);
    metallicGain.gain.setValueAtTime(0.22 + config.tone * 0.14, when);

    env.gain.linearRampToValueAtTime(targetGain, when + config.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, when + config.decay);
    filter.frequency.exponentialRampToValueAtTime(clamp(config.cutoff * 0.56, 160, 8000), when + config.decay);

    bodyA.connect(filter);
    bodyB.connect(filter);
    metallic.connect(metallicGain);
    metallicGain.connect(filter);

    bodyA.start(when);
    bodyB.start(when);
    metallic.start(when);
    bodyA.stop(when + config.decay + 0.08);
    bodyB.stop(when + config.decay + 0.08);
    metallic.stop(when + config.decay + 0.06);
    return config.decay + 0.08;
  }

  private playSubVoice(
    config: ImpactVoiceConfig,
    frequency: number,
    gainAmount: number,
    when: number,
    output: GainNode,
  ): number {
    const ctx = this.audioContext!;
    const body = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const click = ctx.createBufferSource();
    const clickFilter = ctx.createBiquadFilter();
    const clickGain = ctx.createGain();
    const subGain = ctx.createGain();
    const { env, filter } = this.createVoiceChain(config, output, when, "lowpass");
    const targetGain = config.gain * gainAmount;
    const endFrequency = frequency * (1 - (config.pitchDrop ?? 0));

    body.type = "triangle";
    body.frequency.setValueAtTime(frequency, when);
    body.frequency.exponentialRampToValueAtTime(Math.max(36, endFrequency), when + config.decay);

    sub.type = "sine";
    sub.frequency.setValueAtTime(Math.max(30, frequency / 2), when);
    subGain.gain.setValueAtTime(0.38, when);

    click.buffer = this.noiseBuffer ?? this.createNoiseBuffer();
    clickFilter.type = "highpass";
    clickFilter.frequency.setValueAtTime(1200, when);
    clickGain.gain.setValueAtTime(0.0001, when);
    clickGain.gain.linearRampToValueAtTime(0.08, when + 0.003);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);

    env.gain.linearRampToValueAtTime(targetGain, when + config.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, when + config.decay);
    filter.frequency.exponentialRampToValueAtTime(clamp(config.cutoff * 0.72, 120, 6000), when + config.decay);

    body.connect(filter);
    sub.connect(subGain);
    subGain.connect(filter);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(filter);

    body.start(when);
    sub.start(when);
    click.start(when);
    body.stop(when + config.decay + 0.12);
    sub.stop(when + config.decay + 0.16);
    click.stop(when + 0.06);
    return config.decay + 0.16;
  }

  private playTickVoice(
    config: ImpactVoiceConfig,
    frequency: number,
    gainAmount: number,
    when: number,
    output: GainNode,
  ): number {
    const ctx = this.audioContext!;
    const body = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    const overtoneGain = ctx.createGain();
    const { env, filter } = this.createVoiceChain(config, output, when, "highpass");
    const targetGain = config.gain * gainAmount;

    body.type = "square";
    body.frequency.setValueAtTime(frequency, when);
    body.detune.setValueAtTime(config.detuneCents ?? 0, when);
    body.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.78), when + config.decay);

    overtone.type = "triangle";
    overtone.frequency.setValueAtTime(frequency * 2.6, when);
    overtoneGain.gain.setValueAtTime(0.16, when);

    noise.buffer = this.noiseBuffer ?? this.createNoiseBuffer();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(clamp(config.cutoff * 1.08, 400, 9000), when);
    noiseFilter.Q.value = 1.2;
    noiseGain.gain.setValueAtTime(0.0001, when);
    noiseGain.gain.linearRampToValueAtTime(0.08 + gainAmount * 0.12, when + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + config.decay * 0.7);

    env.gain.linearRampToValueAtTime(targetGain, when + config.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, when + config.decay);
    filter.frequency.exponentialRampToValueAtTime(clamp(config.cutoff * 1.4, 720, 10000), when + config.decay);

    body.connect(filter);
    overtone.connect(overtoneGain);
    overtoneGain.connect(filter);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(filter);

    body.start(when);
    overtone.start(when);
    noise.start(when);
    body.stop(when + config.decay + 0.08);
    overtone.stop(when + config.decay + 0.08);
    noise.stop(when + config.decay * 0.78);
    return config.decay + 0.08;
  }

  private playSnareVoice(
    config: ImpactVoiceConfig,
    impact: number,
    when: number,
    output: GainNode,
  ): number {
    const ctx = this.audioContext!;
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const click = ctx.createOscillator();
    const clickGain = ctx.createGain();
    const { env, filter } = this.createVoiceChain(config, output, when, "bandpass");
    const energy = config.gain * (0.52 + clamp(impact / 18, 0, 1) * 0.52);

    noise.buffer = this.noiseBuffer ?? this.createNoiseBuffer();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.setValueAtTime(config.cutoff, when);
    noiseFilter.Q.value = config.resonance;
    noiseGain.gain.setValueAtTime(0.0001, when);
    noiseGain.gain.linearRampToValueAtTime(energy, when + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + config.decay);

    body.type = "triangle";
    body.frequency.setValueAtTime(248, when);
    body.frequency.exponentialRampToValueAtTime(126, when + config.decay * 0.74);
    bodyGain.gain.setValueAtTime(0.0001, when);
    bodyGain.gain.linearRampToValueAtTime(energy * 0.42, when + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + config.decay * 0.8);

    click.type = "square";
    click.frequency.setValueAtTime(2800, when);
    click.frequency.exponentialRampToValueAtTime(1260, when + 0.02);
    clickGain.gain.setValueAtTime(0.0001, when);
    clickGain.gain.linearRampToValueAtTime(0.08, when + 0.001);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.022);

    env.gain.linearRampToValueAtTime(1, when + config.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, when + config.decay + 0.04);
    filter.frequency.exponentialRampToValueAtTime(clamp(config.cutoff * 0.64, 400, 6400), when + config.decay);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(filter);
    body.connect(bodyGain);
    bodyGain.connect(filter);
    click.connect(clickGain);
    clickGain.connect(filter);

    noise.start(when);
    body.start(when);
    click.start(when);
    noise.stop(when + config.decay + 0.02);
    body.stop(when + config.decay * 0.84);
    click.stop(when + 0.024);
    return config.decay + 0.04;
  }

  private playMegaVoice(
    config: ImpactVoiceConfig,
    frequency: number,
    impact: number,
    when: number,
    output: GainNode,
    combo: boolean,
  ): number {
    const ctx = this.audioContext!;
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    const sub = ctx.createOscillator();
    const bodyA = ctx.createOscillator();
    const bodyB = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const { env, filter } = this.createVoiceChain(config, output, when, "lowpass");
    const energy = config.gain * (0.6 + clamp(impact / 20, 0, 1) * (combo ? 0.86 : 0.62));
    const lowFrequency = Math.max(36, frequency * (combo ? 0.82 : 1));

    noise.buffer = this.noiseBuffer ?? this.createNoiseBuffer();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(config.cutoff * 0.92, when);
    noiseFilter.Q.value = 1.3;
    noiseGain.gain.setValueAtTime(0.0001, when);
    noiseGain.gain.linearRampToValueAtTime(energy * 0.56, when + 0.003);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, when + config.decay * 0.88);

    sub.type = "sine";
    sub.frequency.setValueAtTime(lowFrequency * 0.48, when);
    sub.frequency.exponentialRampToValueAtTime(Math.max(28, lowFrequency * 0.26), when + config.decay);

    bodyA.type = "sawtooth";
    bodyA.frequency.setValueAtTime(lowFrequency, when);
    bodyA.frequency.exponentialRampToValueAtTime(Math.max(46, lowFrequency * 0.54), when + config.decay * 0.86);
    bodyB.type = "triangle";
    bodyB.frequency.setValueAtTime(lowFrequency * 1.52, when);
    bodyB.frequency.exponentialRampToValueAtTime(Math.max(58, lowFrequency * 0.78), when + config.decay * 0.7);

    bodyGain.gain.setValueAtTime(combo ? 0.82 : 0.72, when);
    env.gain.linearRampToValueAtTime(energy, when + config.attack);
    env.gain.exponentialRampToValueAtTime(0.0001, when + config.decay + (combo ? 0.18 : 0.1));
    filter.frequency.setValueAtTime(clamp(config.cutoff + (combo ? 220 : 0), 300, 8000), when);
    filter.frequency.exponentialRampToValueAtTime(clamp(config.cutoff * 0.34, 180, 4800), when + config.decay);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(filter);
    sub.connect(filter);
    bodyA.connect(bodyGain);
    bodyB.connect(bodyGain);
    bodyGain.connect(filter);

    noise.start(when);
    sub.start(when);
    bodyA.start(when);
    bodyB.start(when);
    noise.stop(when + config.decay * 0.92);
    sub.stop(when + config.decay + 0.16);
    bodyA.stop(when + config.decay + 0.14);
    bodyB.stop(when + config.decay + 0.1);
    return config.decay + (combo ? 0.18 : 0.16);
  }

  private triggerMegaMacro(normalizedX: number, normalizedY: number, combo: boolean): void {
    if (!this.audioContext) {
      return;
    }

    this.megaMacroState.triggeredAt = this.audioContext.currentTime;
    this.megaMacroState.x = clamp(normalizedX, 0, 1);
    this.megaMacroState.y = clamp(normalizedY, 0, 1);
    this.megaMacroState.intensity = combo ? this.impactPalette.megaFxMacro.comboMultiplier : 1;
  }

  private getMegaMacroSnapshot(now: number): { intensity: number; x: number; y: number } {
    const elapsed = now - this.megaMacroState.triggeredAt;
    if (elapsed < 0 || elapsed > this.impactPalette.megaFxMacro.duration) {
      return { intensity: 0, x: 0.5, y: 0 };
    }

    const fade = Math.exp(-elapsed * this.impactPalette.megaFxMacro.decay);
    return {
      intensity: this.megaMacroState.intensity * fade,
      x: this.megaMacroState.x,
      y: this.megaMacroState.y,
    };
  }

  private getGrooveFxIntensity(): number {
    const levels = this.song?.grooveLevels.map((grooveLevel) => grooveLevel.level) ?? [1];
    if (levels.length <= 1) {
      return 0;
    }

    const grooveIndex = levels.indexOf(this.currentGrooveLevel);
    if (grooveIndex <= 0) {
      return 0;
    }

    return grooveIndex / (levels.length - 1);
  }
}
