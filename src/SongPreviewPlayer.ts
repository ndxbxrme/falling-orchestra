import type { LoopClipConfig, SongConfig } from "./game/songConfig";

interface PreviewCallbacks {
  onEnded?: () => void;
}

interface PreviewStep {
  src: string;
  duration: number;
}

const INITIAL_PREVIEW_LEAD = 0.05;
const DEFAULT_PREVIEW_MAIN_REPEATS = 3;

const choosePreviewMainRepeats = (
  introBars: number,
  mainBars: number,
  averageTotalBars: number,
): number => {
  const defaultTotalBars = introBars + (mainBars * DEFAULT_PREVIEW_MAIN_REPEATS);
  if (defaultTotalBars <= averageTotalBars) {
    return DEFAULT_PREVIEW_MAIN_REPEATS;
  }

  let bestRepeats = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let repeats = 1; repeats <= DEFAULT_PREVIEW_MAIN_REPEATS; repeats += 1) {
    const totalBars = introBars + (mainBars * repeats);
    const distance = Math.abs(totalBars - averageTotalBars);
    if (distance < bestDistance || (distance === bestDistance && repeats < bestRepeats)) {
      bestDistance = distance;
      bestRepeats = repeats;
    }
  }

  return bestRepeats;
};

export class SongPreviewPlayer {
  private audioContext?: AudioContext;
  private masterGain?: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private sources = new Set<AudioBufferSourceNode>();
  private currentToken = 0;
  private endTimeout?: number;
  private active = false;

  async playSong(song: SongConfig, callbacks: PreviewCallbacks = {}): Promise<void> {
    this.stop();
    const token = ++this.currentToken;
    const context = await this.ensureAudioContext();
    const steps = await this.loadPreviewSteps(song);
    if (token !== this.currentToken) {
      return;
    }

    const startTime = context.currentTime + INITIAL_PREVIEW_LEAD;
    let cursor = startTime;

    for (const step of steps) {
      const buffer = this.buffers.get(step.src);
      if (!buffer || !this.masterGain) {
        continue;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.masterGain);
      source.start(cursor);
      source.stop(cursor + step.duration);
      source.onended = () => {
        this.sources.delete(source);
      };
      this.sources.add(source);
      cursor += step.duration;
    }

    this.active = steps.length > 0;
    if (this.endTimeout !== undefined) {
      window.clearTimeout(this.endTimeout);
    }

    const previewDurationMs = Math.max(0, (cursor - context.currentTime) * 1000);
    this.endTimeout = window.setTimeout(() => {
      if (token !== this.currentToken) {
        return;
      }
      this.active = false;
      this.endTimeout = undefined;
      callbacks.onEnded?.();
    }, previewDurationMs + 50);
  }

  stop(): void {
    this.currentToken += 1;
    this.active = false;
    if (this.endTimeout !== undefined) {
      window.clearTimeout(this.endTimeout);
      this.endTimeout = undefined;
    }
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // no-op
      }
    }
    this.sources.clear();
  }

  dispose(): void {
    this.stop();
    void this.audioContext?.close();
  }

  isActive(): boolean {
    return this.active;
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (!this.audioContext) {
      this.audioContext = new window.AudioContext();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.66;
      this.masterGain.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    return this.audioContext;
  }

  private async loadPreviewSteps(song: SongConfig): Promise<PreviewStep[]> {
    const context = await this.ensureAudioContext();
    const steps: PreviewStep[] = [];
    const beatsPerBar = song.transport.beatsPerBar;
    const bpm = song.transport.bpm;
    const grooveBarTotals = song.grooveLevels
      .filter((grooveLevel) => grooveLevel.main)
      .map((grooveLevel) => (grooveLevel.intro?.bars ?? 0) + (grooveLevel.main!.bars * DEFAULT_PREVIEW_MAIN_REPEATS));
    const averageTotalBars = grooveBarTotals.length > 0
      ? grooveBarTotals.reduce((sum, totalBars) => sum + totalBars, 0) / grooveBarTotals.length
      : DEFAULT_PREVIEW_MAIN_REPEATS * (song.grooveLevels[0]?.main?.bars ?? 4);

    for (const grooveLevel of song.grooveLevels) {
      if (grooveLevel.intro) {
        await this.ensureBufferLoaded(grooveLevel.intro.src, context);
        steps.push(this.createStep(grooveLevel.intro, bpm, beatsPerBar));
      }

      if (grooveLevel.main) {
        await this.ensureBufferLoaded(grooveLevel.main.src, context);
        const mainStep = this.createStep(grooveLevel.main, bpm, beatsPerBar);
        const repeats = choosePreviewMainRepeats(
          grooveLevel.intro?.bars ?? 0,
          grooveLevel.main.bars,
          averageTotalBars,
        );
        steps.push(...Array.from({ length: repeats }, () => mainStep));
      }
    }

    return steps;
  }

  private createStep(clip: LoopClipConfig, bpm: number, beatsPerBar: number): PreviewStep {
    return {
      src: clip.src,
      duration: (60 / bpm) * beatsPerBar * clip.bars,
    };
  }

  private async ensureBufferLoaded(assetUrl: string, context: AudioContext): Promise<void> {
    if (this.buffers.has(assetUrl)) {
      return;
    }

    const response = await fetch(assetUrl);
    if (!response.ok) {
      throw new Error(`Failed to load preview clip: ${assetUrl}`);
    }

    const audioData = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(audioData.slice(0));
    this.buffers.set(assetUrl, buffer);
  }
}
