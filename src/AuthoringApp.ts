import { MODE_LABELS, ROOT_NOTES, SCALE_MODES } from "./game/config";
import { ScaleQuantizer } from "./game/ScaleQuantizer";
import type { SongConfig } from "./game/songConfig";
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

type LocalAuthoringApiHealth = {
  ok: boolean;
};

type AuthoringViewMode = "harmony" | "import";

type ImportSongDraft = {
  trackNumber: number;
  folderName: string;
  title: string;
  files: File[];
  warnings: string[];
};

type ImportAlbumDraft = {
  sourceLabel: string;
  artistId: string;
  artistName: string;
  title: string;
  year: number;
  description: string;
  sortOrder: number;
  availability: string;
  tags: string;
  coverArtPath: string;
  backdropPreset: string;
  applyHarmonyDefaults: boolean;
  extraFiles: File[];
  songs: ImportSongDraft[];
};

const KNOWN_IMPORT_TAGS = [
  "ambient",
  "broken",
  "dark",
  "driving",
  "heavy",
  "hypnotic",
  "melodic",
  "uplifting",
] as const;

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

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled";

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

const normalizeClipFilename = (filename: string): string => {
  const match = filename.match(/^(.*?)-[A-Za-z0-9_-]{6,}(\.[^.]+)$/);
  if (!match) {
    return filename;
  }
  return `${match[1]}${match[2]}`;
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

const parseImportedSongWarnings = (files: File[]): string[] => {
  const grouped = new Map<number, Set<AuthoringClipRole>>();
  for (const file of files) {
    const name = file.name;
    const stem = name.replace(/\.[^.]+$/, "");
    let key: number | null = null;
    let role: AuthoringClipRole | null = null;
    const matchers: Array<[RegExp, (match: RegExpMatchArray) => [number, AuthoringClipRole]]> = [
      [/^gl(\d+)_(main|intro)$/i, (match) => [Number(match[1]), match[2].toLowerCase() as AuthoringClipRole]],
      [/^gl(\d+)_(finale)$/i, (match) => [Number(match[1]), "finale"]],
      [/^(\d+)([im])$/i, (match) => [Number(match[1]), match[2].toLowerCase() === "i" ? "intro" : "main"]],
      [/^(\d+)_(main|intro|finale)$/i, (match) => [Number(match[1]), match[2].toLowerCase() as AuthoringClipRole]],
    ];
    for (const [pattern, resolve] of matchers) {
      const match = stem.match(pattern);
      if (match) {
        [key, role] = resolve(match);
        break;
      }
    }
    if (key === null || role === null) {
      continue;
    }
    const existing = grouped.get(key) ?? new Set<AuthoringClipRole>();
    existing.add(role);
    grouped.set(key, existing);
  }

  const warnings: string[] = [];
  const keys = Array.from(grouped.keys()).sort((a, b) => a - b);
  const lastKey = keys[keys.length - 1] ?? 0;
  for (const key of keys) {
    const roles = grouped.get(key) ?? new Set<AuthoringClipRole>();
    const isFinalLike = key === lastKey && (roles.has("finale") || (roles.has("intro") && !roles.has("main")));
    if (isFinalLike) {
      if (!roles.has("finale") && !roles.has("intro")) {
        warnings.push(`final groove group ${key} is missing its ending intro/finale clip`);
      }
      continue;
    }
    if (!roles.has("intro") || !roles.has("main")) {
      const missing: string[] = [];
      if (!roles.has("intro")) {
        missing.push("intro");
      }
      if (!roles.has("main")) {
        missing.push("main");
      }
      warnings.push(`groove group ${key} is missing ${missing.join(", ")} clip(s)`);
    }
  }
  return warnings;
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
    const midi = this.getScaleMidiForFamily(family, root, modeIntervals, degreeIndex);
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

  private getScaleMidiForFamily(
    family: string,
    root: number,
    modeIntervals: number[],
    degreeIndex: number,
  ): number {
    return this.quantizer.scaleDegreeToMidi(root, modeIntervals, this.getBaseMidiForFamily(family), degreeIndex);
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
  private readonly apiBaseUrl = "http://127.0.0.1:8765";
  private authoringRoot!: HTMLDivElement;
  private importFolderInput?: HTMLInputElement;
  private audio = new Audio();
  private audition = new AuthoringAuditionEngine();
  private saveHandles = new Map<string, AuthoringFileHandle>();
  private songConfigCache = new Map<string, SongConfig>();
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
  private songStateLoadToken = 0;
  private localApiAvailable = false;
  private localApiChecked = false;
  private backdropPresetDraft = "";
  private backdropParamsDraft = "{}";
  private viewMode: AuthoringViewMode = "harmony";
  private importDraft?: ImportAlbumDraft;
  private importStatus = "Pick a numbered album folder to bootstrap a draft import.";
  private importBusy = false;

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
    this.statusMessage = `Loading ${firstSong.title}...`;
    this.renderShell();
    this.bindEvents();
    void this.loadSuggestions();
    void this.detectLocalAuthoringApi();
    void this.syncSongState();
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
      <input class="authoring-import-input" type="file" data-import-folder-input webkitdirectory directory multiple />
    `;
    const authoringRoot = this.root.querySelector<HTMLDivElement>(".authoring-root");
    const importFolderInput = this.root.querySelector<HTMLInputElement>("[data-import-folder-input]");
    if (!authoringRoot) {
      throw new Error("Authoring root not created.");
    }
    if (!importFolderInput) {
      throw new Error("Authoring import input not created.");
    }
    this.authoringRoot = authoringRoot;
    this.importFolderInput = importFolderInput;
  }

  private bindEvents(): void {
    this.authoringRoot.addEventListener("change", this.handleChange);
    this.authoringRoot.addEventListener("click", this.handleClick);
    this.authoringRoot.addEventListener("input", this.handleInput);
    this.importFolderInput?.addEventListener("change", this.handleImportFolderPicked);
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
      void this.syncSongState();
      this.stopSequencer();
      this.updateUi();
      return;
    }

    if (target.dataset.songSelect !== undefined) {
      const wasPlaying = !this.audio.paused;
      this.selectedSongId = target.value;
      void this.syncSongState();
      this.stopSequencer();
      if (wasPlaying) {
        void this.playSelectedClip(true);
      }
      this.updateUi();
      return;
    }

    if (target.dataset.clipSelect !== undefined) {
      const wasPlaying = !this.audio.paused;
      this.selectedClipKey = target.value;
      this.stopSequencer();
      if (wasPlaying) {
        void this.playSelectedClip(true);
      } else {
        this.stopClipPlayback();
      }
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
      return;
    }

    const importField = target.dataset.importField;
    if (importField && this.importDraft) {
      const songIndex = Number(target.dataset.songIndex ?? "-1");
      if (songIndex >= 0) {
        const songDraft = this.importDraft.songs[songIndex];
        if (songDraft) {
          (songDraft as unknown as Record<string, string>)[importField] = target.value;
        }
      } else {
        (this.importDraft as unknown as Record<string, string>)[importField] = target.value;
      }
      this.updateUi();
      return;
    }
  };

  private handleInput = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return;
    }
    if (target.dataset.cycleBars !== undefined) {
      const nextLength = clamp(Number(target.value) || this.harmonyCycleBars, 1, 16);
      this.setHarmonyCycleBars(nextLength);
      this.updateUi();
      return;
    }

    if (target instanceof HTMLInputElement && target.dataset.backdropPreset !== undefined) {
      this.backdropPresetDraft = target.value;
      this.updateUi();
      return;
    }

    if (target instanceof HTMLTextAreaElement && target.dataset.backdropParams !== undefined) {
      this.backdropParamsDraft = target.value;
      this.updateUi();
      return;
    }

    const importField = target.dataset.importField;
    if (importField && this.importDraft) {
      const songIndex = Number(target.dataset.songIndex ?? "-1");
      const assignDraftValue = (draft: ImportAlbumDraft | ImportSongDraft, field: string, rawValue: string): void => {
        if (field === "applyHarmonyDefaults") {
          (draft as Record<string, unknown>)[field] = rawValue === "true";
          return;
        }
        if (field === "artistPreset" && "artistId" in draft && "artistName" in draft) {
          if (rawValue === "__custom__") {
            return;
          }
          const artist = this.getKnownImportArtists().find((entry) => entry.id === rawValue);
          if (artist) {
            draft.artistId = artist.id;
            draft.artistName = artist.name;
          }
          return;
        }
        if (field === "year" || field === "sortOrder") {
          (draft as Record<string, unknown>)[field] = Number(rawValue) || 0;
          return;
        }
        (draft as Record<string, unknown>)[field] = rawValue;
      };

      if (songIndex >= 0) {
        const songDraft = this.importDraft.songs[songIndex];
        if (songDraft) {
          assignDraftValue(songDraft, importField, target.value);
        }
      } else {
        assignDraftValue(this.importDraft, importField, target.value);
      }
      return;
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
      return;
    }

    if (action === "save-landing") {
      void this.saveGrooveLanding();
      return;
    }

    if (action === "save-backdrop") {
      void this.saveSongBackdrop();
      return;
    }

    if (action === "switch-harmony-view") {
      this.viewMode = "harmony";
      this.updateUi();
      return;
    }

    if (action === "switch-import-view") {
      this.viewMode = "import";
      this.updateUi();
      return;
    }

    if (action === "pick-import-folder") {
      this.importFolderInput?.click();
      return;
    }

    if (action === "toggle-import-tag") {
      const tag = target?.closest<HTMLElement>("[data-tag]")?.dataset.tag?.trim().toLowerCase();
      if (!tag || !this.importDraft) {
        return;
      }
      const tags = this.getImportTagsSet();
      if (tags.has(tag)) {
        tags.delete(tag);
      } else {
        tags.add(tag);
      }
      this.importDraft.tags = [...tags].sort((a, b) => a.localeCompare(b)).join(", ");
      this.updateUi();
      return;
    }

    if (action === "run-import-upload") {
      void this.runImportUpload();
    }
  };

  private async detectLocalAuthoringApi(): Promise<void> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/health`);
      if (!response.ok) {
        throw new Error("health check failed");
      }
      const payload = await response.json() as LocalAuthoringApiHealth;
      this.localApiAvailable = Boolean(payload.ok);
    } catch {
      this.localApiAvailable = false;
    } finally {
      this.localApiChecked = true;
      this.updateUi();
    }
  }

  private async loadSuggestions(): Promise<void> {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}docs/harmony_suggestions.json`);
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

  private getSelectedSongConfig(): SongConfig | undefined {
    return this.songConfigCache.get(this.selectedSongId);
  }

  private async ensureSongConfig(song: SongEntry): Promise<SongConfig> {
    const cached = this.songConfigCache.get(song.id);
    if (cached) {
      return cached;
    }
    const loaded = await song.loadConfig();
    this.songConfigCache.set(song.id, loaded);
    return loaded;
  }

  private getSelectedSongClips(): AuthoringClip[] {
    const songConfig = this.getSelectedSongConfig();
    if (!songConfig) {
      return [];
    }

    const clips: AuthoringClip[] = [];
    for (const grooveLevel of songConfig.grooveLevels) {
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

  private getSelectedClip(): AuthoringClip | undefined {
    const clips = this.getSelectedSongClips();
    return clips.find((clip) => clip.key === this.selectedClipKey) ?? clips[0];
  }

  private getSelectedClipSuggestions(): HarmonySuggestionClip {
    const song = this.getSelectedSong();
    const songSuggestions =
      this.suggestions.songs?.[song.id] ??
      this.suggestions.songs?.[song.slug] ??
      this.suggestions.songs?.[this.getSelectedSongConfig()?.id ?? ""];
    const clip = this.getSelectedClip();
    if (!clip) {
      return {
        file: "",
        durationSeconds: 0,
        estimatedBars: 0,
        overall: [],
        bars: [],
      };
    }
    const normalizedClipFilename = normalizeClipFilename(clip.filename);
    return songSuggestions?.clips.find(
      (entry) => entry.file === clip.filename || normalizeClipFilename(entry.file) === normalizedClipFilename,
    ) ?? {
      file: clip.filename,
      durationSeconds: clip.bars * this.getSecondsPerBar(),
      estimatedBars: clip.bars,
      overall: [],
      bars: [],
    };
  }

  private async syncSongState(): Promise<void> {
    const song = this.getSelectedSong();
    const token = ++this.songStateLoadToken;
    this.selectedClipKey = "";
    this.selectedBarIndex = 0;
    this.statusMessage = `Loading ${song.title}...`;
    this.updateUi();

    const songConfig = await this.ensureSongConfig(song);
    if (token != this.songStateLoadToken || this.selectedSongId !== song.id) {
      return;
    }

    this.harmonyCycleBars = songConfig.transport.harmonyCycleBars;
    this.harmonyBars = expandHarmonyTimeline(songConfig.harmonyTimeline, this.harmonyCycleBars);
    this.backdropPresetDraft = song.backdropPreset ?? "";
    this.backdropParamsDraft = JSON.stringify(song.backdropParams ?? {}, null, 2);
    const firstClip = this.getSelectedSongClips()[0];
    this.selectedClipKey = firstClip?.key ?? "";
    this.selectedBarIndex = 0;
    this.statusMessage = `Loaded ${song.title}.`;
    this.updateUi();
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
    const songConfig = this.getSelectedSongConfig();
    if (!songConfig) {
      return 2;
    }
    return (60 / songConfig.transport.bpm) * songConfig.transport.beatsPerBar;
  }

  private getCurrentClipBarIndex(): number {
    const clip = this.getSelectedClip();
    if (!clip) {
      return 0;
    }
    const secondsPerBar = this.getSecondsPerBar();
    const rawBar = Math.floor((this.audio.currentTime % Math.max(0.01, clip.bars * secondsPerBar)) / secondsPerBar);
    return clamp(rawBar, 0, Math.max(0, clip.bars - 1));
  }

  private getSelectedHarmonyBar(): HarmonyBarState {
    if (this.harmonyBars.length === 0) {
      return { rootNote: "C", mode: "pentatonicMinor" };
    }
    const clipBarIndex = this.getCurrentClipBarIndex();
    const cycleIndex = clipBarIndex % this.harmonyBars.length;
    return this.harmonyBars[cycleIndex] ?? this.harmonyBars[0];
  }

  private async toggleClipPlayback(): Promise<void> {
    if (this.audio.paused) {
      await this.playSelectedClip();
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

  private async playSelectedClip(autoplay = false): Promise<void> {
    await this.ensureSongConfig(this.getSelectedSong());
    const clip = this.getSelectedClip();
    if (!clip) {
      this.statusMessage = "No clip is available for the selected song.";
      this.updateUi();
      return;
    }
    if (this.audio.src !== clip.src) {
      this.audio.src = clip.src;
      this.audio.loop = true;
      this.audio.currentTime = 0;
    }

    await this.audio.play();
    this.statusMessage = autoplay ? `Switched to ${clip.filename}.` : `Playing ${clip.filename}.`;
    this.startAnimationLoop();
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
    const readyConfig = await this.ensureSongConfig(this.getSelectedSong());
    const next = await this.audition.toggleSequence(
      !this.sequencerEnabled,
      readyConfig.transport.bpm,
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
    const songConfig = this.getSelectedSongConfig();
    if (!songConfig) {
      return;
    }
    this.sequencerEnabled = await this.audition.toggleSequence(
      true,
      songConfig.transport.bpm,
      () => this.getSelectedHarmonyBar(),
      this.selectedFamily,
    );
    this.updateUi();
  }

  private stopSequencer(): void {
    const bpm = this.getSelectedSongConfig()?.transport.bpm ?? 120;
    void this.audition.toggleSequence(false, bpm, () => this.getSelectedHarmonyBar(), this.selectedFamily);
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
    const song = this.getSelectedSong();
    if (this.localApiAvailable) {
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/song-config/save-harmony`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            songId: song.id,
            cycleBars: this.harmonyCycleBars,
            bars: this.harmonyBars,
          }),
        });
        const payload = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Direct save failed.");
        }
        this.statusMessage = "config.ts updated successfully via local API.";
        this.updateUi();
        return;
      } catch (error) {
        this.statusMessage = error instanceof Error ? error.message : "Local API save failed.";
        this.updateUi();
        return;
      }
    }

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
    const expectedConfigId = this.getSelectedSongConfig()?.id;
    if (!expectedConfigId) {
      this.statusMessage = "Song config is still loading.";
      this.updateUi();
      return;
    }
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

  private getSelectedClipLandingBars(): number | "" {
    const clip = this.getSelectedClip();
    const songConfig = this.getSelectedSongConfig();
    if (!clip || !songConfig || clip.role === "finale") {
      return "";
    }
    const grooveLevel = songConfig.grooveLevels.find((entry) => entry.level === clip.grooveLevel);
    const loopClip = clip.role === "intro" ? grooveLevel?.intro : grooveLevel?.main;
    return loopClip?.grooveChangeAfterBars ?? "";
  }

  private async saveGrooveLanding(): Promise<void> {
    if (!this.localApiAvailable) {
      this.statusMessage = "Local authoring API is unavailable.";
      this.updateUi();
      return;
    }
    const clip = this.getSelectedClip();
    if (!clip || clip.role === "finale") {
      this.statusMessage = "Selected clip does not support groove landings.";
      this.updateUi();
      return;
    }
    const landingInput = this.authoringRoot.querySelector<HTMLInputElement>("[data-landing-bars]");
    const nextValue = Math.max(0, Number(landingInput?.value ?? this.getSelectedClipLandingBars() ?? 0) || 0);
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/song-config/set-groove-landing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songId: this.getSelectedSong().id,
          grooveLevel: clip.grooveLevel,
          role: clip.role,
          grooveChangeAfterBars: nextValue,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to save groove landing.");
      }
      const songConfig = this.getSelectedSongConfig();
      const grooveLevel = songConfig?.grooveLevels.find((entry) => entry.level === clip.grooveLevel);
      if (grooveLevel) {
        const loopClip = clip.role === "intro" ? grooveLevel.intro : grooveLevel.main;
        if (loopClip) {
          loopClip.grooveChangeAfterBars = nextValue;
        }
      }
      this.statusMessage = `Saved groove landing for L${clip.grooveLevel} ${clip.role}.`;
      this.updateUi();
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : "Failed to save groove landing.";
      this.updateUi();
    }
  }

  private async saveSongBackdrop(): Promise<void> {
    if (!this.localApiAvailable) {
      this.statusMessage = "Local authoring API is unavailable.";
      this.updateUi();
      return;
    }
    let parsedParams: Record<string, string | number | boolean> | null = null;
    const trimmedPreset = this.backdropPresetDraft.trim();
    const trimmedParams = this.backdropParamsDraft.trim();
    try {
      if (trimmedParams) {
        const parsed = JSON.parse(trimmedParams);
        if (parsed !== null && typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Backdrop params JSON must be an object.");
        }
        parsedParams = parsed as Record<string, string | number | boolean>;
      }
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : "Invalid backdrop params JSON.";
      this.updateUi();
      return;
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/song-manifest/set-backdrop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          songId: this.getSelectedSong().id,
          backdropPreset: trimmedPreset || null,
          backdropParams: parsedParams,
        }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to save song backdrop.");
      }
      const song = this.getSelectedSong();
      song.backdropPreset = trimmedPreset || undefined;
      song.backdropParams = parsedParams ?? undefined;
      this.backdropParamsDraft = JSON.stringify(song.backdropParams ?? {}, null, 2);
      this.statusMessage = "Saved song backdrop overrides.";
      this.updateUi();
    } catch (error) {
      this.statusMessage = error instanceof Error ? error.message : "Failed to save song backdrop.";
      this.updateUi();
    }
  }

  private handleImportFolderPicked = (event: Event): void => {
    const target = event.target as HTMLInputElement | null;
    const files = Array.from(target?.files ?? []);
    if (files.length === 0) {
      return;
    }
    this.buildImportDraftFromFiles(files);
    if (target) {
      target.value = "";
    }
  };

  private buildImportDraftFromFiles(files: File[]): void {
    const sourceLabel = ((files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? "").split("/")[0] || "folder import";
    const topLevelFolders = new Map<string, File[]>();
    const extraFiles: File[] = [];
    for (const file of files) {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
      const [, topLevel, maybeFilename] = relativePath.split("/");
      if (!topLevel) {
        continue;
      }
      if (maybeFilename && !/^\d+$/.test(topLevel)) {
        extraFiles.push(file);
        continue;
      }
      if (!/^\d+$/.test(topLevel)) {
        continue;
      }
      const bucket = topLevelFolders.get(topLevel) ?? [];
      bucket.push(file);
      topLevelFolders.set(topLevel, bucket);
    }

    const numberedFolders = Array.from(topLevelFolders.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    if (numberedFolders.length === 0) {
      this.importStatus = "No numbered song folders were detected.";
      this.updateUi();
      return;
    }

    const songs: ImportSongDraft[] = numberedFolders.map(([folderName, songFiles]) => {
      const trackNumber = Number(folderName);
      return {
        trackNumber,
        folderName,
        title: `Track ${trackNumber}`,
        files: songFiles.filter((file) => file.name.toLowerCase().endsWith(".ogg")),
        warnings: parseImportedSongWarnings(songFiles),
      };
    });

    const selectedAlbumArtistId = this.getSelectedAlbum().artistId || "artist";
    const artistId = slugify(selectedAlbumArtistId || "artist");
    const albumTitle = sourceLabel.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "New Album";
    this.importDraft = {
      sourceLabel,
      artistId,
      artistName: artistId.replace(/-/g, " ").replace(/\b\w/g, (char: string) => char.toUpperCase()),
      title: albumTitle,
      year: new Date().getFullYear(),
      description: "",
      sortOrder: 999,
      availability: "hidden",
      tags: "",
      coverArtPath: "",
      backdropPreset: "brutalist-club",
      applyHarmonyDefaults: true,
      extraFiles,
      songs,
    };
    this.importStatus = `Prepared draft for ${songs.length} songs from ${sourceLabel}.`;
    this.viewMode = "import";
    this.updateUi();
  }

  private buildImportManifest(): Record<string, unknown> | null {
    const draft = this.importDraft;
    if (!draft) {
      return null;
    }
    const normalizedArtistId = slugify(draft.artistId || "artist");
    const normalizedAlbumTitle = draft.title.trim() || "album";
    const albumId = `${normalizedArtistId}_${slugify(normalizedAlbumTitle)}`;
    return {
      artistId: normalizedArtistId,
      artistName: draft.artistName,
      albumId,
      title: normalizedAlbumTitle,
      year: draft.year,
      description: draft.description,
      sortOrder: draft.sortOrder,
      availability: draft.availability,
      tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      coverArt: draft.coverArtPath.trim() || undefined,
      theme: {
        accent: "#7ee9ef",
        accentSoft: "#213645",
        text: "#eaf7ff",
        background: "#081522",
        panel: "#101b29",
        backdropPreset: draft.backdropPreset.trim() || "brutalist-club",
      },
      songs: draft.songs.map((song) => ({
        title: song.title.trim() || `Track ${song.trackNumber}`,
        slug: slugify(song.title.trim() || `track-${String(song.trackNumber).padStart(2, "0")}`),
        id: `${normalizedArtistId}_${slugify(song.title.trim() || `track-${String(song.trackNumber).padStart(2, "0")}`)}`,
        trackNumber: song.trackNumber,
        audioDir: song.folderName,
      })),
    };
  }

  private getKnownImportArtists(): Array<{ id: string; name: string }> {
    return [...MUSIC_LIBRARY.artists]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((artist) => ({ id: artist.id, name: artist.name }));
  }

  private getSelectedImportArtistId(): string {
    if (!this.importDraft) {
      return "__custom__";
    }
    const draftId = slugify(this.importDraft.artistId || "artist");
    const match = this.getKnownImportArtists().find((artist) => artist.id === draftId);
    return match ? match.id : "__custom__";
  }

  private getImportTagsSet(): Set<string> {
    return new Set(
      (this.importDraft?.tags ?? "")
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private async runImportUpload(): Promise<void> {
    if (!this.localApiAvailable) {
      this.importStatus = "Local authoring API is unavailable.";
      this.updateUi();
      return;
    }
    const draft = this.importDraft;
    const manifest = this.buildImportManifest();
    if (!draft || !manifest) {
      this.importStatus = "No import draft is loaded.";
      this.updateUi();
      return;
    }
    this.importBusy = true;
    this.importStatus = "Uploading album source and running import...";
    this.updateUi();
    try {
      const formData = new FormData();
      formData.append("manifest", JSON.stringify(manifest));
      formData.append("applyHarmonyDefaults", draft.applyHarmonyDefaults ? "true" : "false");
      for (const song of draft.songs) {
        for (const file of song.files) {
          formData.append("files", file, `${song.folderName}/${file.name}`);
        }
      }
      for (const file of draft.extraFiles) {
        const relativePath = ((file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name).split("/").slice(1).join("/");
        formData.append("files", file, relativePath || file.name);
      }
      const response = await fetch(`${this.apiBaseUrl}/api/import-album/upload`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json() as { ok?: boolean; stdout?: string; stderr?: string; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? payload.stderr ?? "Album import failed.");
      }
      this.importStatus = (payload.stdout?.trim() || "Album imported successfully.").trim();
    } catch (error) {
      this.importStatus = error instanceof Error ? error.message : "Album import failed.";
    } finally {
      this.importBusy = false;
      this.updateUi();
    }
  }

  private renderAuthoringHeader(title: string, subtitle: string): string {
    return `
      <header class="authoring-header">
        <div>
          <p class="library-kicker">Authoring Tool</p>
          <h1>${escapeHtml(title)}</h1>
          <p class="library-subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <div class="authoring-actions">
          <button type="button" class="library-chip${this.viewMode === "harmony" ? " active" : ""}" data-action="switch-harmony-view">Harmony Studio</button>
          <button type="button" class="library-chip${this.viewMode === "import" ? " active" : ""}" data-action="switch-import-view">Album Import</button>
        </div>
      </header>
    `;
  }

  private renderImportView(): string {
    const draft = this.importDraft;
    const totalWarnings = draft?.songs.reduce((count, song) => count + song.warnings.length, 0) ?? 0;
    const knownArtists = this.getKnownImportArtists();
    const selectedImportArtistId = this.getSelectedImportArtistId();
    const selectedTags = this.getImportTagsSet();
    return `
      <div class="authoring-shell">
        ${this.renderAuthoringHeader("Album Import", "Turn a numbered folder of loop clips into a packaged album draft.")}
        <div class="authoring-layout">
          <aside class="authoring-sidebar">
            <section class="authoring-panel">
              <span class="section-label">Source</span>
              <div class="authoring-actions authoring-actions-stack">
                <button type="button" class="play-button" data-action="pick-import-folder">Pick Numbered Folder</button>
                <button type="button" class="play-button" data-action="run-import-upload"${draft && this.localApiAvailable && !this.importBusy ? "" : " disabled"}>${this.importBusy ? "Importing..." : "Import Album"}</button>
              </div>
              <p class="authoring-copy">Local API: ${!this.localApiChecked ? "checking…" : this.localApiAvailable ? "connected" : "offline"}</p>
              ${draft ? `<p class="authoring-copy">${draft.extraFiles.length} top-level asset file(s) detected.</p>` : ""}
              <p class="authoring-copy">${escapeHtml(this.importStatus)}</p>
            </section>

            <section class="authoring-panel">
              <span class="section-label">Warnings</span>
              ${
                !draft
                  ? "<p class=\"authoring-empty\">Pick a folder to generate a draft.</p>"
                  : totalWarnings > 0
                    ? draft.songs
                      .flatMap((song) => song.warnings.map((warning) => `<p class="authoring-copy"><strong>${String(song.trackNumber).padStart(2, "0")}</strong> · ${escapeHtml(warning)}</p>`))
                      .join("")
                    : "<p class=\"authoring-copy\">No structural warnings detected from the loop filenames.</p>"
              }
            </section>
          </aside>

          <main class="authoring-main">
            <section class="authoring-panel">
              <span class="section-label">Album Metadata</span>
              ${
                !draft
                  ? "<p class=\"authoring-empty\">No import draft loaded.</p>"
                  : `
                    <div class="authoring-grid authoring-import-grid">
                      <label class="authoring-label"><span>Known Artist</span><select data-import-field="artistPreset">
                        <option value="__custom__"${selectedImportArtistId === "__custom__" ? " selected" : ""}>Custom Artist</option>
                        ${knownArtists.map((artist) => `<option value="${escapeHtml(artist.id)}"${selectedImportArtistId === artist.id ? " selected" : ""}>${escapeHtml(artist.name)}</option>`).join("")}
                      </select></label>
                      <label class="authoring-label"><span>Artist Id</span><input data-import-field="artistId" type="text" value="${escapeHtml(draft.artistId)}" /></label>
                      <label class="authoring-label"><span>Artist Name</span><input data-import-field="artistName" type="text" value="${escapeHtml(draft.artistName)}" /></label>
                      <label class="authoring-label"><span>Album Title</span><input data-import-field="title" type="text" value="${escapeHtml(draft.title)}" /></label>
                      <label class="authoring-label"><span>Year</span><input data-import-field="year" type="number" value="${draft.year}" /></label>
                      <label class="authoring-label"><span>Sort Order</span><input data-import-field="sortOrder" type="number" value="${draft.sortOrder}" /></label>
                      <label class="authoring-label"><span>Availability</span><select data-import-field="availability">
                        ${["included", "locked", "hidden"].map((option) => `<option value="${option}"${draft.availability === option ? " selected" : ""}>${option}</option>`).join("")}
                      </select></label>
                      <label class="authoring-label"><span>Backdrop Preset</span><input data-import-field="backdropPreset" type="text" value="${escapeHtml(draft.backdropPreset)}" /></label>
                      <label class="authoring-label authoring-label-wide"><span>Known Tags</span><div class="authoring-tag-grid">
                        ${KNOWN_IMPORT_TAGS.map((tag) => `<button type="button" class="library-chip${selectedTags.has(tag) ? " active" : ""}" data-action="toggle-import-tag" data-tag="${tag}">${tag}</button>`).join("")}
                      </div></label>
                      <label class="authoring-label"><span>Tags</span><input data-import-field="tags" type="text" value="${escapeHtml(draft.tags)}" placeholder="deep house, ambient house" /></label>
                      <label class="authoring-label"><span>Cover Art Path</span><input data-import-field="coverArtPath" type="text" value="${escapeHtml(draft.coverArtPath)}" placeholder="cover.webp" /></label>
                      <label class="authoring-label"><span>Default Harmony</span><select data-import-field="applyHarmonyDefaults">
                        <option value="true"${draft.applyHarmonyDefaults ? " selected" : ""}>Analyze + apply on import</option>
                        <option value="false"${!draft.applyHarmonyDefaults ? " selected" : ""}>Leave at placeholder</option>
                      </select></label>
                      <label class="authoring-label authoring-label-wide"><span>Description</span><textarea data-import-field="description" rows="4">${escapeHtml(draft.description)}</textarea></label>
                    </div>
                    <p class="authoring-copy">Derived album id: ${escapeHtml(`${slugify(draft.artistId || "artist")}_${slugify(draft.title.trim() || "album")}`)}</p>
                  `
              }
            </section>

            <section class="authoring-panel">
              <span class="section-label">Songs</span>
              ${
                !draft
                  ? "<p class=\"authoring-empty\">Song drafts will appear here once a folder is loaded.</p>"
                  : draft.songs.map((song, index) => `
                    <div class="authoring-import-song">
                      <div class="authoring-grid-head">
                        <div>
                          <h2>${String(song.trackNumber).padStart(2, "0")} · ${escapeHtml(song.folderName)}</h2>
                          <p>${song.files.length} loop files · ${escapeHtml(`${slugify(draft.artistId || "artist")}_${slugify(song.title.trim() || `track-${String(song.trackNumber).padStart(2, "0")}`)}`)}</p>
                        </div>
                      </div>
                      <div class="authoring-grid authoring-import-grid">
                        <label class="authoring-label"><span>Title</span><input data-import-field="title" data-song-index="${index}" type="text" value="${escapeHtml(song.title)}" /></label>
                      </div>
                    </div>
                  `).join("")
              }
            </section>
          </main>
        </div>
      </div>
    `;
  }

  private updateUi(): void {
    if (this.viewMode === "import") {
      this.authoringRoot.innerHTML = this.renderImportView();
      return;
    }

    const album = this.getSelectedAlbum();
    const songs = this.getSongsForSelectedAlbum();
    const song = this.getSelectedSong();
    const songConfig = this.getSelectedSongConfig();
    const clips = this.getSelectedSongClips();
    const clip = this.getSelectedClip();
    const clipSuggestions = this.getSelectedClipSuggestions();
    const currentClipBar = clip && clip.src === this.audio.src && !this.audio.paused ? this.getCurrentClipBarIndex() : 0;
    const selectedBarSuggestions =
      clipSuggestions.bars.find((entry) => entry.bar === this.selectedBarIndex + 1)?.suggestions ?? [];
    const overallSuggestions = songConfig ? clipSuggestions.overall : [];
    const selectedBar = this.harmonyBars[this.selectedBarIndex] ?? this.harmonyBars[0] ?? { rootNote: "C", mode: "pentatonicMinor" as ScaleModeName };
    const selectedClipLandingBars = this.getSelectedClipLandingBars();
    const canSaveLanding = Boolean(songConfig && clip && clip.role !== "finale");
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
        ${this.renderAuthoringHeader("Harmony Studio", "Loop audition, harmony editing, sequenced preview, and config writeback.")}

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
                <select data-clip-select${songConfig ? "" : " disabled"}>
                  ${songConfig
                    ? clips
                    .map(
                      (entry) =>
                        `<option value="${entry.key}"${entry.key === clip?.key ? " selected" : ""}>${escapeHtml(entry.label)} · ${entry.bars} bars</option>`,
                    )
                    .join("")
                    : "<option>Loading song config...</option>"}
                </select>
              </label>
              <p class="authoring-copy">
                Local API:
                ${
                  !this.localApiChecked
                    ? "checking…"
                    : this.localApiAvailable
                      ? "connected"
                      : "offline"
                }
              </p>
            </section>

            <section class="authoring-panel">
              <span class="section-label">Suggestions</span>
              <div class="authoring-suggestion-block">
                <h3>Clip Overall</h3>
                ${
                  !songConfig
                    ? "<p class=\"authoring-empty\">Song config is loading.</p>"
                    : overallSuggestions.length > 0
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
                  !songConfig
                    ? "<p class=\"authoring-empty\">Song config is loading.</p>"
                    : selectedBarSuggestions.length > 0
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
                  <h2>${escapeHtml(clip?.filename ?? "Loading clip...")}</h2>
                  <p>${escapeHtml(song.title)}${clip ? ` · ${clip.role} · groove ${clip.grooveLevel}` : " · loading config"}</p>
                </div>
                <div class="authoring-actions">
                  <button type="button" class="play-button" data-action="play-clip"${clip ? "" : " disabled"}>${clip && this.audio.src === clip.src && !this.audio.paused ? "Pause Clip" : "Play Clip"}</button>
                  <button type="button" class="library-chip" data-action="preview-chord"${songConfig ? "" : " disabled"}>Preview Chord</button>
                  <button type="button" class="library-chip" data-action="toggle-sequence"${songConfig ? "" : " disabled"}>${this.sequencerEnabled ? "Stop Sequence" : "Start Sequence"}</button>
                </div>
              </div>

              <div class="authoring-stats">
                <div><strong>${songConfig?.transport.bpm ?? "…"}</strong><span>BPM</span></div>
                <div><strong>${clip?.bars ?? "…"}</strong><span>Clip Bars</span></div>
                <div><strong>${this.harmonyCycleBars}</strong><span>Harmony Bars</span></div>
                <div><strong data-current-bar-value>${currentClipBar + 1}</strong><span>Current Bar</span></div>
              </div>

              <div class="authoring-progress">
                <div class="authoring-progress-fill" data-authoring-progress-fill style="width:${clip && clip.src === this.audio.src && clip.bars > 0 ? ((this.audio.currentTime / Math.max(0.001, clip.bars * this.getSecondsPerBar())) % 1) * 100 : 0}%"></div>
              </div>

              <div class="authoring-bar-ruler" data-authoring-bar-ruler>
                ${Array.from({ length: clip?.bars ?? 0 }, (_, index) => `<span data-ruler-bar="${index}" class="${index === currentClipBar ? "active" : ""}">${index + 1}</span>`).join("")}
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
                    const live =
                      Boolean(clip) &&
                      this.harmonyBars.length > 0 &&
                      index === (currentClipBar % this.harmonyBars.length) &&
                      this.audio.src === clip?.src &&
                      !this.audio.paused;
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
              <span class="section-label">Groove Landing</span>
              <label class="authoring-label">
                <span>Selected Clip</span>
                <input type="text" value="${clip ? `${clip.label}` : ""}" disabled />
              </label>
              <label class="authoring-label">
                <span>grooveChangeAfterBars</span>
                <input data-landing-bars type="number" min="0" max="${clip?.bars ?? 16}" value="${selectedClipLandingBars}" ${canSaveLanding ? "" : "disabled"} />
              </label>
              <div class="authoring-actions authoring-actions-stack">
                <button type="button" class="play-button" data-action="save-landing"${canSaveLanding && this.localApiAvailable ? "" : " disabled"}>Save Landing</button>
              </div>
              <p class="authoring-copy">Best used on transition clips, usually the intro clip.</p>
            </section>

            <section class="authoring-panel">
              <span class="section-label">Song Backdrop</span>
              <label class="authoring-label">
                <span>Backdrop Preset</span>
                <input data-backdrop-preset type="text" value="${escapeHtml(this.backdropPresetDraft)}" placeholder="inherit album default" />
              </label>
              <label class="authoring-label">
                <span>Backdrop Params JSON</span>
                <textarea data-backdrop-params rows="8" spellcheck="false">${escapeHtml(this.backdropParamsDraft)}</textarea>
              </label>
              <div class="authoring-actions authoring-actions-stack">
                <button type="button" class="play-button" data-action="save-backdrop"${this.localApiAvailable ? "" : " disabled"}>Save Backdrop</button>
              </div>
              <p class="authoring-copy">Leave preset blank to inherit the album backdrop. Params should be a JSON object.</p>
            </section>

            <section class="authoring-panel">
              <span class="section-label">Writeback</span>
              <div class="authoring-actions authoring-actions-stack">
                <button type="button" class="library-chip" data-action="pick-config-file"${this.localApiAvailable ? " disabled" : ""}>Bind config.ts</button>
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
    if (!clip) {
      if (this.currentBarValue) {
        this.currentBarValue.textContent = "0";
      }
      if (this.progressFill) {
        this.progressFill.style.width = "0%";
      }
      this.barRulerSpans.forEach((span) => {
        span.classList.remove("active");
      });
      return;
    }

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
