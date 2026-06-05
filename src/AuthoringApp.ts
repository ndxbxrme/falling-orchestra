import { MODE_LABELS, ROOT_NOTES, SCALE_MODES } from "./game/config";
import { ScaleQuantizer } from "./game/ScaleQuantizer";
import type { HarmonySpanConfig } from "./game/songConfig";
import type { RootNoteName, ScaleModeName } from "./game/types";
import { MUSIC_LIBRARY } from "./content/library";
import type { Album, SongEntry } from "./content/types";

type SuggestionEntry = {
  root: RootNoteName;
  mode: ScaleModeName;
  score: number;
};

type HarmonySuggestionBar = {
  bar: number;
  startSeconds: number;
  endSeconds: number;
  suggestions: SuggestionEntry[];
};

type HarmonySuggestionClip = {
  file: string;
  durationSeconds: number;
  estimatedBars: number;
  overall: SuggestionEntry[];
  bars: HarmonySuggestionBar[];
};

type HarmonySuggestionSong = {
  transport?: {
    bpm?: number;
    beatsPerBar?: number;
  };
  clips: HarmonySuggestionClip[];
};

type HarmonySuggestionsPayload = {
  songs?: Record<string, HarmonySuggestionSong>;
};

type AuthoringClipRole = "intro" | "main" | "finale";

type AuthoringClip = {
  key: string;
  label: string;
  filename: string;
  src: string;
  role: AuthoringClipRole;
  grooveLevel: number;
  bars: number;
};

type HarmonyBarState = {
  rootNote: RootNoteName;
  mode: ScaleModeName;
};

type AuthoringFileHandle = {
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }>;
};

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<AuthoringFileHandle[]>;
  }
}

const ROOT_OPTIONS = Object.keys(ROOT_NOTES) as RootNoteName[];
const MODE_OPTIONS = Object.keys(MODE_LABELS) as ScaleModeName[];

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const midiToFrequency = (midi: number): number => 440 * (2 ** ((midi - 69) / 12));

const clipFilenameFromSrc = (src: string): string => {
  try {
    const url = new URL(src);
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    return lastSegment ?? src;
  } catch {
    return src.split("/").filter(Boolean).pop() ?? src;
  }
};

const expandHarmonyTimeline = (
  spans: HarmonySpanConfig[],
  cycleBars: number,
): HarmonyBarState[] => {
  const fallback: HarmonyBarState = { rootNote: "C", mode: "pentatonicMinor" };
  const bars = Array.from({ length: cycleBars }, () => ({ ...fallback }));

  for (const span of spans) {
    for (let index = 0; index < span.lengthBars; index += 1) {
      const barIndex = span.startBar - 1 + index;
      if (barIndex < 0 || barIndex >= cycleBars) {
        continue;
      }
      bars[barIndex] = {
        rootNote: span.rootNote,
        mode: span.mode,
      };
    }
  }

  return bars;
};

const compressHarmonyTimeline = (bars: HarmonyBarState[]): HarmonySpanConfig[] => {
  if (bars.length === 0) {
    return [];
  }

  const spans: HarmonySpanConfig[] = [];
  let current = bars[0];
  let startBar = 1;
  let lengthBars = 1;

  for (let index = 1; index < bars.length; index += 1) {
    const next = bars[index];
    if (next.rootNote === current.rootNote && next.mode === current.mode) {
      lengthBars += 1;
      continue;
    }

    spans.push({
      startBar,
      lengthBars,
      rootNote: current.rootNote,
      mode: current.mode,
    });
    current = next;
    startBar = index + 1;
    lengthBars = 1;
  }

  spans.push({
    startBar,
    lengthBars,
    rootNote: current.rootNote,
    mode: current.mode,
  });
  return spans;
};

const renderHarmonyTimeline = (bars: HarmonyBarState[]): string => {
  const spans = compressHarmonyTimeline(bars);
  if (spans.length === 0) {
    return "[]";
  }

  return [
    "[",
    ...spans.map(
      (span) =>
        `    { startBar: ${span.startBar}, lengthBars: ${span.lengthBars}, rootNote: "${span.rootNote}", mode: "${span.mode}" },`,
    ),
    "  ]",
  ].join("\n");
};

const replaceNumberField = (text: string, fieldName: string, value: number): string => {
  const rendered = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
  const next = text.replace(new RegExp(`(${fieldName}:\\s*)(\\d+(?:\\.\\d+)?)`), `$1${rendered}`);
  if (next === text) {
    throw new Error(`Could not find '${fieldName}' in config.ts`);
  }
  return next;
};

const findMatchingBracket = (text: string, openIndex: number): number => {
  const opener = text[openIndex];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escaped = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && (inSingle || inDouble || inBacktick)) {
      escaped = true;
      continue;
    }
    if (!inDouble && !inBacktick && char === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inBacktick && char === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && char === "`") {
      inBacktick = !inBacktick;
      continue;
    }
    if (inSingle || inDouble || inBacktick) {
      continue;
    }
    if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error(`Could not find matching bracket for ${opener}`);
};

const replacePropertyLiteral = (text: string, propertyName: string, renderedValue: string): string => {
  const match = new RegExp(`(^\\s*)${propertyName}:\\s*`, "m").exec(text);
  if (!match || match.index === undefined) {
    throw new Error(`Could not find '${propertyName}' in config.ts`);
  }

  const propertyStart = match.index;
  let valueStart = propertyStart + match[0].length;
  while (valueStart < text.length && /\s/.test(text[valueStart])) {
    valueStart += 1;
  }
  const valueEnd = findMatchingBracket(text, valueStart);
  let replaceEnd = valueEnd + 1;
  while (replaceEnd < text.length && /\s/.test(text[replaceEnd])) {
    replaceEnd += 1;
  }
  if (text[replaceEnd] === ",") {
    replaceEnd += 1;
  }

  return `${text.slice(0, propertyStart)}${match[1]}${propertyName}: ${renderedValue},${text.slice(replaceEnd)}`;
};

const buildUpdatedConfigText = (originalText: string, cycleBars: number, bars: HarmonyBarState[]): string => {
  let next = replaceNumberField(originalText, "harmonyCycleBars", cycleBars);
  next = replacePropertyLiteral(next, "harmonyTimeline", renderHarmonyTimeline(bars));
  return next;
};

class AuthoringAuditionEngine {
  private audioContext?: AudioContext;
  private sequenceInterval?: number;
  private beatIndex = 0;
  private quantizer = new ScaleQuantizer();

  dispose(): void {
    if (this.sequenceInterval !== undefined) {
      window.clearInterval(this.sequenceInterval);
    }
    void this.audioContext?.close();
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  async resume(): Promise<void> {
    const context = this.ensureContext();
    if (context.state !== "running") {
      await context.resume();
    }
  }

  async previewChord(harmony: HarmonyBarState, family: string): Promise<void> {
    await this.resume();
    this.beatIndex = 0;
    const modeIntervals = SCALE_MODES[harmony.mode];
    const contour = [
      ...modeIntervals.map((_, index) => index),
      ...modeIntervals.slice(1, -1).map((_, index) => modeIntervals.length - 2 - index),
    ];
    contour.forEach((degreeIndex, index) => {
      this.triggerFamilyTone(harmony, family, degreeIndex, 0.34, index * 0.11);
    });
  }

  async toggleSequence(
    enabled: boolean,
    bpm: number,
    getCurrentHarmony: () => HarmonyBarState,
    family: string,
  ): Promise<boolean> {
    if (!enabled) {
      if (this.sequenceInterval !== undefined) {
        window.clearInterval(this.sequenceInterval);
        this.sequenceInterval = undefined;
      }
      this.beatIndex = 0;
      return false;
    }

    await this.resume();
    if (this.sequenceInterval !== undefined) {
      window.clearInterval(this.sequenceInterval);
    }

    const beatMs = (60 / bpm) * 1000;
    const modeLength = SCALE_MODES[getCurrentHarmony().mode].length;
    const pattern = [
      ...Array.from({ length: modeLength }, (_, index) => index),
      ...Array.from({ length: Math.max(0, modeLength - 2) }, (_, index) => modeLength - 2 - index),
    ];
    this.sequenceInterval = window.setInterval(() => {
      const degree = pattern[this.beatIndex % pattern.length];
      this.triggerFamilyTone(getCurrentHarmony(), family, degree, 0.28);
      this.beatIndex += 1;
    }, beatMs);
    return true;
  }

  private triggerFamilyTone(
    harmony: HarmonyBarState,
    family: string,
    degreeIndex: number,
    gainAmount: number,
    offsetSeconds = 0,
  ): void {
    const context = this.ensureContext();
    const modeIntervals = SCALE_MODES[harmony.mode];
    const root = ROOT_NOTES[harmony.rootNote];
    const degree = modeIntervals[degreeIndex % modeIntervals.length] ?? 0;
    const candidateMidi = this.getBaseMidiForFamily(family) + root + degree;
    const midi = this.quantizer.quantizeMidi(root, modeIntervals, candidateMidi);
    const frequency = midiToFrequency(midi);
    const now = context.currentTime + offsetSeconds;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainAmount, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + this.getDecayForFamily(family));
    gain.connect(context.destination);

    if (family === "snare") {
      const noiseBuffer = context.createBuffer(1, Math.max(1, context.sampleRate * 0.08), context.sampleRate);
      const channel = noiseBuffer.getChannelData(0);
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = (Math.random() * 2 - 1) * 0.45;
      }
      const noise = context.createBufferSource();
      noise.buffer = noiseBuffer;
      const filter = context.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 2200;
      filter.Q.value = 0.8;
      noise.connect(filter);
      filter.connect(gain);
      noise.start(now);
      noise.stop(now + 0.08);
    }

    const oscillator = context.createOscillator();
    oscillator.type = this.getWaveformForFamily(family);
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.connect(gain);
    oscillator.start(now);
    oscillator.stop(now + this.getDecayForFamily(family) + 0.04);
  }

  private getBaseMidiForFamily(family: string): number {
    switch (family) {
      case "bass":
        return 36;
      case "snare":
        return 60;
      case "spark":
        return 79;
      case "bell":
      default:
        return 67;
    }
  }

  private getWaveformForFamily(family: string): OscillatorType {
    switch (family) {
      case "bass":
        return "sawtooth";
      case "snare":
        return "triangle";
      case "spark":
        return "square";
      case "bell":
      default:
        return "sine";
    }
  }

  private getDecayForFamily(family: string): number {
    switch (family) {
      case "bass":
        return 0.32;
      case "snare":
        return 0.16;
      case "spark":
        return 0.12;
      case "bell":
      default:
        return 0.24;
    }
  }
}

export class AuthoringApp {
  private authoringRoot!: HTMLDivElement;
  private audio = new Audio();
  private audition = new AuthoringAuditionEngine();
  private saveHandles = new Map<string, AuthoringFileHandle>();
  private selectedAlbumId: string;
  private selectedSongId: string;
  private selectedClipKey = "";
  private selectedBarIndex = 0;
  private harmonyCycleBars = 8;
  private harmonyBars: HarmonyBarState[] = [];
  private selectedFamily = "bell";
  private sequencerEnabled = false;
  private suggestions: HarmonySuggestionsPayload = {};
  private statusMessage = "Load a clip and start auditioning.";
  private animationFrame?: number;
  private currentBarValue?: HTMLElement;
  private progressFill?: HTMLElement;
  private barRulerSpans: HTMLElement[] = [];

  constructor(private root: HTMLDivElement) {
    const firstAlbum = MUSIC_LIBRARY.albums[0];
    const firstSong = firstAlbum
      ? MUSIC_LIBRARY.songs.find((song) => song.albumId === firstAlbum.id) ?? MUSIC_LIBRARY.songs[0]
      : MUSIC_LIBRARY.songs[0];

    if (!firstAlbum || !firstSong) {
      throw new Error("Authoring tool requires packaged album and song content.");
    }

    this.selectedAlbumId = firstAlbum.id;
    this.selectedSongId = firstSong.id;
    this.syncSongState();
    this.renderShell();
    this.bindEvents();
    void this.loadSuggestions();
    this.updateUi();
  }

  dispose(): void {
    this.audio.pause();
    this.audio.src = "";
    if (this.animationFrame !== undefined) {
      window.cancelAnimationFrame(this.animationFrame);
    }
    this.audition.dispose();
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="authoring-root"></div>
    `;
    const authoringRoot = this.root.querySelector<HTMLDivElement>(".authoring-root");
    if (!authoringRoot) {
      throw new Error("Authoring root not created.");
    }
    this.authoringRoot = authoringRoot;
  }

  private bindEvents(): void {
    this.authoringRoot.addEventListener("change", this.handleChange);
    this.authoringRoot.addEventListener("click", this.handleClick);
    this.authoringRoot.addEventListener("input", this.handleInput);
    this.audio.addEventListener("ended", () => {
      this.syncPlaybackUi();
    });
  }

  private handleChange = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.dataset.albumSelect !== undefined) {
      this.selectedAlbumId = target.value;
      const firstSong = this.getSongsForSelectedAlbum()[0];
      if (firstSong) {
        this.selectedSongId = firstSong.id;
      }
      this.syncSongState();
      this.stopSequencer();
      this.updateUi();
      return;
    }

    if (target.dataset.songSelect !== undefined) {
      this.selectedSongId = target.value;
      this.syncSongState();
      this.stopSequencer();
      this.updateUi();
      return;
    }

    if (target.dataset.clipSelect !== undefined) {
      this.selectedClipKey = target.value;
      this.stopClipPlayback();
      this.stopSequencer();
      this.updateUi();
      return;
    }

    if (target.dataset.familySelect !== undefined) {
      this.selectedFamily = target.value;
      void this.restartSequencerIfNeeded();
      this.updateUi();
      return;
    }

    if (target.dataset.selectedBarRoot !== undefined) {
      this.harmonyBars[this.selectedBarIndex] = {
        ...this.harmonyBars[this.selectedBarIndex],
        rootNote: target.value as RootNoteName,
      };
      this.updateUi();
      return;
    }

    if (target.dataset.selectedBarMode !== undefined) {
      this.harmonyBars[this.selectedBarIndex] = {
        ...this.harmonyBars[this.selectedBarIndex],
        mode: target.value as ScaleModeName,
      };
      this.updateUi();
      return;
    }

    if (target.dataset.cycleBars !== undefined) {
      const nextLength = clamp(Number(target.value) || this.harmonyCycleBars, 1, 16);
      this.setHarmonyCycleBars(nextLength);
      this.updateUi();
      return;
    }

    const rootBar = target.dataset.barRoot;
    if (rootBar !== undefined) {
      const index = Number(rootBar);
      this.harmonyBars[index] = {
        ...this.harmonyBars[index],
        rootNote: target.value as RootNoteName,
      };
      this.updateUi();
      return;
    }

    const modeBar = target.dataset.barMode;
    if (modeBar !== undefined) {
      const index = Number(modeBar);
      this.harmonyBars[index] = {
        ...this.harmonyBars[index],
        mode: target.value as ScaleModeName,
      };
      this.updateUi();
    }
  };

  private handleInput = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (target.dataset.cycleBars !== undefined) {
      const nextLength = clamp(Number(target.value) || this.harmonyCycleBars, 1, 16);
      this.setHarmonyCycleBars(nextLength);
      this.updateUi();
    }
  };

  private handleClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const action = target?.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (!action) {
      return;
    }

    if (action === "play-clip") {
      void this.toggleClipPlayback();
      return;
    }

    if (action === "toggle-sequence") {
      void this.toggleSequencer();
      return;
    }

    if (action === "preview-chord") {
      void this.audition.previewChord(this.getSelectedHarmonyBar(), this.selectedFamily);
      return;
    }

    if (action === "pick-config-file") {
      void this.pickConfigHandle();
      return;
    }

    if (action === "save-config") {
      void this.saveConfig();
      return;
    }

    if (action === "copy-harmony") {
      void navigator.clipboard.writeText(renderHarmonyTimeline(this.harmonyBars));
      this.statusMessage = "Copied harmonyTimeline to clipboard.";
      this.updateUi();
      return;
    }

    if (action === "select-bar") {
      const index = Number(target?.closest<HTMLElement>("[data-bar-index]")?.dataset.barIndex ?? "0");
      this.selectedBarIndex = clamp(index, 0, this.harmonyBars.length - 1);
      this.updateUi();
      return;
    }

    if (action === "apply-bar-suggestion") {
      const index = Number(target?.closest<HTMLElement>("[data-suggestion-index]")?.dataset.suggestionIndex ?? "-1");
      const suggestions = this.getSelectedClipSuggestions().bars.find((entry) => entry.bar === this.selectedBarIndex + 1)?.suggestions ?? [];
      const suggestion = suggestions[index];
      if (!suggestion) {
        return;
      }
      this.harmonyBars[this.selectedBarIndex] = {
        rootNote: suggestion.root,
        mode: suggestion.mode,
      };
      this.updateUi();
      return;
    }

    if (action === "apply-overall-suggestion") {
      const index = Number(target?.closest<HTMLElement>("[data-suggestion-index]")?.dataset.suggestionIndex ?? "-1");
      const suggestion = this.getSelectedClipSuggestions().overall[index];
      if (!suggestion) {
        return;
      }
      this.harmonyBars = this.harmonyBars.map(() => ({
        rootNote: suggestion.root,
        mode: suggestion.mode,
      }));
      this.updateUi();
    }
  };

  private async loadSuggestions(): Promise<void> {
    try {
      const response = await fetch("/docs/harmony_suggestions.json");
      if (!response.ok) {
        return;
      }
      this.suggestions = await response.json() as HarmonySuggestionsPayload;
      this.updateUi();
    } catch {
      this.statusMessage = "Harmony suggestions unavailable. Authoring still works without them.";
      this.updateUi();
    }
  }

  private getSelectedAlbum(): Album {
    return MUSIC_LIBRARY.albums.find((album) => album.id === this.selectedAlbumId) ?? MUSIC_LIBRARY.albums[0];
  }

  private getSongsForSelectedAlbum(): SongEntry[] {
    return MUSIC_LIBRARY.songs
      .filter((song) => song.albumId === this.selectedAlbumId)
      .sort((a, b) => a.trackNumber - b.trackNumber);
  }

  private getSelectedSong(): SongEntry {
    return MUSIC_LIBRARY.songs.find((song) => song.id === this.selectedSongId) ?? this.getSongsForSelectedAlbum()[0];
  }

  private getSelectedSongClips(): AuthoringClip[] {
    const clips: AuthoringClip[] = [];
    for (const grooveLevel of this.getSelectedSong().config.grooveLevels) {
      if (grooveLevel.intro) {
        clips.push({
          key: `${grooveLevel.level}:intro`,
          label: `L${grooveLevel.level} Intro`,
          filename: clipFilenameFromSrc(grooveLevel.intro.src),
          src: grooveLevel.intro.src,
          role: grooveLevel.completesSong && !grooveLevel.main ? "finale" : "intro",
          grooveLevel: grooveLevel.level,
          bars: grooveLevel.intro.bars,
        });
      }
      if (grooveLevel.main) {
        clips.push({
          key: `${grooveLevel.level}:main`,
          label: `L${grooveLevel.level} Main`,
          filename: clipFilenameFromSrc(grooveLevel.main.src),
          src: grooveLevel.main.src,
          role: "main",
          grooveLevel: grooveLevel.level,
          bars: grooveLevel.main.bars,
        });
      }
    }
    return clips;
  }

  private getSelectedClip(): AuthoringClip {
    return this.getSelectedSongClips().find((clip) => clip.key === this.selectedClipKey) ?? this.getSelectedSongClips()[0];
  }

  private getSelectedClipSuggestions(): HarmonySuggestionClip {
    const songSuggestions = this.suggestions.songs?.[this.getSelectedSong().config.id];
    const clip = this.getSelectedClip();
    return songSuggestions?.clips.find((entry) => entry.file === clip.filename) ?? {
      file: clip.filename,
      durationSeconds: clip.bars * this.getSecondsPerBar(),
      estimatedBars: clip.bars,
      overall: [],
      bars: [],
    };
  }

  private syncSongState(): void {
    const song = this.getSelectedSong();
    this.harmonyCycleBars = song.config.transport.harmonyCycleBars;
    this.harmonyBars = expandHarmonyTimeline(song.config.harmonyTimeline, this.harmonyCycleBars);
    const firstClip = this.getSelectedSongClips()[0];
    this.selectedClipKey = firstClip?.key ?? "";
    this.selectedBarIndex = 0;
    this.statusMessage = `Loaded ${song.title}.`;
  }

  private setHarmonyCycleBars(nextLength: number): void {
    const previous = this.harmonyBars;
    const fallback = previous[previous.length - 1] ?? { rootNote: "C" as RootNoteName, mode: "pentatonicMinor" as ScaleModeName };
    this.harmonyBars = Array.from({ length: nextLength }, (_, index) => ({
      ...(previous[index] ?? fallback),
    }));
    this.harmonyCycleBars = nextLength;
    this.selectedBarIndex = clamp(this.selectedBarIndex, 0, nextLength - 1);
  }

  private getSecondsPerBar(): number {
    const song = this.getSelectedSong();
    return (60 / song.config.transport.bpm) * song.config.transport.beatsPerBar;
  }

  private getCurrentClipBarIndex(): number {
    const clip = this.getSelectedClip();
    const secondsPerBar = this.getSecondsPerBar();
    const rawBar = Math.floor((this.audio.currentTime % Math.max(0.01, clip.bars * secondsPerBar)) / secondsPerBar);
    return clamp(rawBar, 0, Math.max(0, clip.bars - 1));
  }

  private getSelectedHarmonyBar(): HarmonyBarState {
    const clipBarIndex = this.getCurrentClipBarIndex();
    const cycleIndex = clipBarIndex % this.harmonyBars.length;
    return this.harmonyBars[cycleIndex] ?? this.harmonyBars[0];
  }

  private async toggleClipPlayback(): Promise<void> {
    const clip = this.getSelectedClip();
    if (this.audio.src !== clip.src) {
      this.audio.src = clip.src;
      this.audio.loop = true;
      this.audio.currentTime = 0;
    }

    if (this.audio.paused) {
      await this.audio.play();
      this.statusMessage = `Playing ${clip.filename}.`;
      this.startAnimationLoop();
    } else {
      this.audio.pause();
      this.statusMessage = "Clip paused.";
      if (this.animationFrame !== undefined) {
        window.cancelAnimationFrame(this.animationFrame);
        this.animationFrame = undefined;
      }
    }
    this.updateUi();
  }

  private stopClipPlayback(): void {
    this.audio.pause();
    this.audio.src = "";
    if (this.animationFrame !== undefined) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
  }

  private startAnimationLoop(): void {
    if (this.animationFrame !== undefined) {
      window.cancelAnimationFrame(this.animationFrame);
    }

    const tick = () => {
      this.syncPlaybackUi();
      if (!this.audio.paused) {
        this.animationFrame = window.requestAnimationFrame(tick);
      } else {
        this.animationFrame = undefined;
      }
    };
    this.animationFrame = window.requestAnimationFrame(tick);
  }

  private async toggleSequencer(): Promise<void> {
    const next = await this.audition.toggleSequence(
      !this.sequencerEnabled,
      this.getSelectedSong().config.transport.bpm,
      () => this.getSelectedHarmonyBar(),
      this.selectedFamily,
    );
    this.sequencerEnabled = next;
    this.statusMessage = next ? "Harmony sequencer running." : "Harmony sequencer stopped.";
    this.updateUi();
  }

  private async restartSequencerIfNeeded(): Promise<void> {
    if (!this.sequencerEnabled) {
      return;
    }
    this.sequencerEnabled = await this.audition.toggleSequence(
      true,
      this.getSelectedSong().config.transport.bpm,
      () => this.getSelectedHarmonyBar(),
      this.selectedFamily,
    );
    this.updateUi();
  }

  private stopSequencer(): void {
    void this.audition.toggleSequence(false, this.getSelectedSong().config.transport.bpm, () => this.getSelectedHarmonyBar(), this.selectedFamily);
    this.sequencerEnabled = false;
  }

  private async pickConfigHandle(): Promise<void> {
    if (!window.showOpenFilePicker) {
      this.statusMessage = "Browser file access is unavailable. Use Copy Harmony instead.";
      this.updateUi();
      return;
    }

    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "TypeScript config",
          accept: { "text/typescript": [".ts"] },
        },
      ],
    });
    if (!handle) {
      return;
    }

    this.saveHandles.set(this.getSelectedSong().id, handle);
    this.statusMessage = "Config file bound for direct save.";
    this.updateUi();
  }

  private async saveConfig(): Promise<void> {
    let handle = this.saveHandles.get(this.getSelectedSong().id);
    if (!handle) {
      await this.pickConfigHandle();
      handle = this.saveHandles.get(this.getSelectedSong().id);
    }
    if (!handle) {
      return;
    }

    const file = await handle.getFile();
    const originalText = await file.text();
    const expectedConfigId = this.getSelectedSong().config.id;
    if (!originalText.includes(`id: "${expectedConfigId}"`)) {
      this.statusMessage = `Selected file does not look like ${expectedConfigId}.`;
      this.updateUi();
      return;
    }

    const updatedText = buildUpdatedConfigText(originalText, this.harmonyCycleBars, this.harmonyBars);
    const writable = await handle.createWritable();
    await writable.write(updatedText);
    await writable.close();
    this.statusMessage = "config.ts updated successfully.";
    this.updateUi();
  }

  private updateUi(): void {
    const album = this.getSelectedAlbum();
    const songs = this.getSongsForSelectedAlbum();
    const song = this.getSelectedSong();
    const clips = this.getSelectedSongClips();
    const clip = this.getSelectedClip();
    const clipSuggestions = this.getSelectedClipSuggestions();
    const currentClipBar = clip.src === this.audio.src && !this.audio.paused ? this.getCurrentClipBarIndex() : 0;
    const selectedBarSuggestions =
      clipSuggestions.bars.find((entry) => entry.bar === this.selectedBarIndex + 1)?.suggestions ?? [];
    const overallSuggestions = clipSuggestions.overall;
    const selectedBar = this.harmonyBars[this.selectedBarIndex] ?? this.harmonyBars[0];
    const familyOptions = ["bell", "bass", "spark", "snare"]
      .map((family) => `<option value="${family}"${this.selectedFamily === family ? " selected" : ""}>${family}</option>`)
      .join("");
    const selectedBarRootOptions = ROOT_OPTIONS.map(
      (rootNote) =>
        `<option value="${rootNote}"${selectedBar?.rootNote === rootNote ? " selected" : ""}>${rootNote}</option>`,
    ).join("");
    const selectedBarModeOptions = MODE_OPTIONS.map(
      (mode) =>
        `<option value="${mode}"${selectedBar?.mode === mode ? " selected" : ""}>${MODE_LABELS[mode]}</option>`,
    ).join("");

    this.authoringRoot.innerHTML = `
      <div class="authoring-shell">
        <header class="authoring-header">
          <div>
            <p class="library-kicker">Authoring Tool</p>
            <h1>Harmony Studio</h1>
            <p class="library-subtitle">Loop audition, harmony editing, sequenced preview, and config writeback.</p>
          </div>
        </header>

        <div class="authoring-layout">
          <aside class="authoring-sidebar">
            <section class="authoring-panel">
              <span class="section-label">Selection</span>
              <label class="authoring-label">
                <span>Album</span>
                <select data-album-select>
                  ${MUSIC_LIBRARY.albums
                    .map(
                      (entry) =>
                        `<option value="${entry.id}"${entry.id === album.id ? " selected" : ""}>${escapeHtml(entry.title)}</option>`,
                    )
                    .join("")}
                </select>
              </label>
              <label class="authoring-label">
                <span>Song</span>
                <select data-song-select>
                  ${songs
                    .map(
                      (entry) =>
                        `<option value="${entry.id}"${entry.id === song.id ? " selected" : ""}>${String(entry.trackNumber).padStart(2, "0")} · ${escapeHtml(entry.title)}</option>`,
                    )
                    .join("")}
                </select>
              </label>
              <label class="authoring-label">
                <span>Clip</span>
                <select data-clip-select>
                  ${clips
                    .map(
                      (entry) =>
                        `<option value="${entry.key}"${entry.key === clip.key ? " selected" : ""}>${escapeHtml(entry.label)} · ${entry.bars} bars</option>`,
                    )
                    .join("")}
                </select>
              </label>
            </section>

            <section class="authoring-panel">
              <span class="section-label">Suggestions</span>
              <div class="authoring-suggestion-block">
                <h3>Clip Overall</h3>
                ${
                  overallSuggestions.length > 0
                    ? overallSuggestions
                        .map(
                          (entry, index) => `
                            <button type="button" class="authoring-suggestion" data-action="apply-overall-suggestion" data-suggestion-index="${index}">
                              <strong>${entry.root} ${MODE_LABELS[entry.mode]}</strong>
                              <span>${entry.score.toFixed(3)}</span>
                            </button>
                          `,
                        )
                        .join("")
                    : "<p class=\"authoring-empty\">No clip suggestions loaded.</p>"
                }
              </div>
              <div class="authoring-suggestion-block">
                <h3>Bar ${this.selectedBarIndex + 1}</h3>
                ${
                  selectedBarSuggestions.length > 0
                    ? selectedBarSuggestions
                        .map(
                          (entry, index) => `
                            <button type="button" class="authoring-suggestion" data-action="apply-bar-suggestion" data-suggestion-index="${index}">
                              <strong>${entry.root} ${MODE_LABELS[entry.mode]}</strong>
                              <span>${entry.score.toFixed(3)}</span>
                            </button>
                          `,
                        )
                        .join("")
                    : "<p class=\"authoring-empty\">No per-bar suggestions for this slot.</p>"
                }
              </div>
            </section>
          </aside>

          <main class="authoring-main">
            <section class="authoring-panel authoring-transport">
              <div class="authoring-transport-head">
                <div>
                  <span class="section-label">Clip Transport</span>
                  <h2>${escapeHtml(clip.filename)}</h2>
                  <p>${escapeHtml(song.title)} · ${clip.role} · groove ${clip.grooveLevel}</p>
                </div>
                <div class="authoring-actions">
                  <button type="button" class="play-button" data-action="play-clip">${this.audio.src === clip.src && !this.audio.paused ? "Pause Clip" : "Play Clip"}</button>
                  <button type="button" class="library-chip" data-action="preview-chord">Preview Chord</button>
                  <button type="button" class="library-chip" data-action="toggle-sequence">${this.sequencerEnabled ? "Stop Sequence" : "Start Sequence"}</button>
                </div>
              </div>

              <div class="authoring-stats">
                <div><strong>${song.config.transport.bpm}</strong><span>BPM</span></div>
                <div><strong>${clip.bars}</strong><span>Clip Bars</span></div>
                <div><strong>${this.harmonyCycleBars}</strong><span>Harmony Bars</span></div>
                <div><strong data-current-bar-value>${currentClipBar + 1}</strong><span>Current Bar</span></div>
              </div>

              <div class="authoring-progress">
                <div class="authoring-progress-fill" data-authoring-progress-fill style="width:${clip.src === this.audio.src && clip.bars > 0 ? ((this.audio.currentTime / Math.max(0.001, clip.bars * this.getSecondsPerBar())) % 1) * 100 : 0}%"></div>
              </div>

              <div class="authoring-bar-ruler" data-authoring-bar-ruler>
                ${Array.from({ length: clip.bars }, (_, index) => `<span data-ruler-bar="${index}" class="${index === currentClipBar ? "active" : ""}">${index + 1}</span>`).join("")}
              </div>
            </section>

            <section class="authoring-panel">
              <div class="authoring-grid-head">
                <div>
                  <span class="section-label">Harmony Grid</span>
                  <h2>${this.harmonyCycleBars} Bar Cycle</h2>
                </div>
                <label class="authoring-inline-field">
                  <span>Cycle Bars</span>
                  <input data-cycle-bars type="number" min="1" max="16" value="${this.harmonyCycleBars}" />
                </label>
              </div>

              <div class="authoring-grid">
                ${this.harmonyBars
                  .map((bar, index) => {
                    const rootOptionsMarkup = ROOT_OPTIONS.map(
                      (rootNote) =>
                        `<option value="${rootNote}"${bar.rootNote === rootNote ? " selected" : ""}>${rootNote}</option>`,
                    ).join("");
                    const modeOptionsMarkup = MODE_OPTIONS.map(
                      (mode) =>
                        `<option value="${mode}"${bar.mode === mode ? " selected" : ""}>${MODE_LABELS[mode]}</option>`,
                    ).join("");
                    const selected = index === this.selectedBarIndex;
                    const live = index === (currentClipBar % this.harmonyBars.length) && this.audio.src === clip.src && !this.audio.paused;
                    return `
                      <div class="authoring-bar-card${selected ? " selected" : ""}${live ? " live" : ""}" data-bar-index="${index}">
                        <button type="button" class="authoring-bar-hit" data-action="select-bar" data-bar-index="${index}">
                          <span class="authoring-bar-no">Bar ${index + 1}</span>
                        </button>
                        <select data-bar-root="${index}">${rootOptionsMarkup}</select>
                        <select data-bar-mode="${index}">${modeOptionsMarkup}</select>
                      </div>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          </main>

          <aside class="authoring-inspector">
            <section class="authoring-panel">
              <span class="section-label">Audition</span>
              <label class="authoring-label">
                <span>Note Family</span>
                <select data-family-select>
                  ${familyOptions}
                </select>
              </label>
              <label class="authoring-label">
                <span>Selected Bar Root</span>
                <select data-selected-bar-root>${selectedBarRootOptions}</select>
              </label>
              <label class="authoring-label">
                <span>Selected Bar Mode</span>
                <select data-selected-bar-mode>${selectedBarModeOptions}</select>
              </label>
              <p class="authoring-copy">Sequencer follows the current clip bar and reads harmony from the cycle grid.</p>
            </section>

            <section class="authoring-panel">
              <span class="section-label">Writeback</span>
              <div class="authoring-actions authoring-actions-stack">
                <button type="button" class="library-chip" data-action="pick-config-file">Bind config.ts</button>
                <button type="button" class="play-button" data-action="save-config">Save to config.ts</button>
                <button type="button" class="library-chip" data-action="copy-harmony">Copy harmonyTimeline</button>
              </div>
              <p class="authoring-copy">${escapeHtml(this.statusMessage)}</p>
            </section>
          </aside>
        </div>
      </div>
    `;

    this.currentBarValue = this.authoringRoot.querySelector<HTMLElement>("[data-current-bar-value]") ?? undefined;
    this.progressFill = this.authoringRoot.querySelector<HTMLElement>("[data-authoring-progress-fill]") ?? undefined;
    this.barRulerSpans = Array.from(this.authoringRoot.querySelectorAll<HTMLElement>("[data-ruler-bar]"));
    this.syncPlaybackUi();
  }

  private syncPlaybackUi(): void {
    const clip = this.getSelectedClip();
    const isActiveClip = this.audio.src === clip.src && !this.audio.paused;
    const currentClipBar = isActiveClip ? this.getCurrentClipBarIndex() : 0;
    const progressPercent = isActiveClip && clip.bars > 0
      ? ((this.audio.currentTime / Math.max(0.001, clip.bars * this.getSecondsPerBar())) % 1) * 100
      : 0;

    if (this.currentBarValue) {
      this.currentBarValue.textContent = String(currentClipBar + 1);
    }

    if (this.progressFill) {
      this.progressFill.style.width = `${progressPercent}%`;
    }

    this.barRulerSpans.forEach((span, index) => {
      span.classList.toggle("active", index === currentClipBar);
    });
  }
}
