import type { RootNoteName, ScaleModeName } from "./types";

export type ImpactBusName = "dry" | "drive" | "delay" | "reverb" | "megaFx";
export type ImpactVoiceMode = "stab" | "sub" | "tick" | "snare" | "mega";

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

export interface ImpactSampleLayerConfig {
  src: string;
  gain: number;
  playbackRate?: number;
  filterType?: BiquadFilterType;
  filterFrequency?: number;
}

export interface ImpactRoutingConfig {
  dry: number;
  drive: number;
  delay: number;
  reverb: number;
  megaFx: number;
}

export interface ImpactVoiceConfig {
  mode: ImpactVoiceMode;
  gain: number;
  attack: number;
  decay: number;
  cutoff: number;
  resonance: number;
  drive: number;
  tone: number;
  routing: ImpactRoutingConfig;
  detuneCents?: number;
  pitchDrop?: number;
  sampleLayer?: ImpactSampleLayerConfig;
}

export interface ImpactBusConfig {
  gain: number;
  tone: number;
  drive: number;
  delayTime?: number;
  feedback?: number;
}

export interface GrooveFxProfileConfig {
  driveBoost: number;
  delayBoost: number;
  reverbBoost: number;
  megaBoost: number;
  filterOpen: number;
  wobbleDepth: number;
}

export interface MegaFxMacroConfig {
  duration: number;
  decay: number;
  xToDelay: number;
  xToWidth: number;
  yToDrive: number;
  yToFeedback: number;
  yToFilter: number;
  comboMultiplier: number;
}

export interface ImpactPaletteConfig {
  voices: Record<"bell" | "bass" | "spark" | "snare" | "mega", ImpactVoiceConfig>;
  buses: Record<ImpactBusName, ImpactBusConfig>;
  grooveFxProfile: GrooveFxProfileConfig;
  megaFxMacro: MegaFxMacroConfig;
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
  impactPalette?: ImpactPaletteConfig;
}
