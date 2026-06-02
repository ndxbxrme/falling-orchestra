import type { RootNoteName, ScaleModeName } from "./types";

export interface HarmonySpanConfig {
  startBar: number;
  lengthBars: number;
  rootNote: RootNoteName;
  mode: ScaleModeName;
}

export interface LoopClipConfig {
  src: string;
  bars: number;
  harmonyStartBar?: number;
  harmonyTimeline?: HarmonySpanConfig[];
}

export interface GrooveLevelConfig {
  level: number;
  main?: LoopClipConfig;
  intro?: LoopClipConfig;
  completesSong?: boolean;
}

export interface SongConfig {
  id: string;
  transport: {
    bpm: number;
    beatsPerBar: number;
    barsPerLoop: number;
    harmonyCycleBars: number;
  };
  harmonyTimeline: HarmonySpanConfig[];
  grooveLevels: GrooveLevelConfig[];
}
