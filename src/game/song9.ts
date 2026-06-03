import type { SongConfig } from "./songConfig";

const assetUrl = (relativePath: string): string =>
  new URL(`../../audio/song9/${relativePath}`, import.meta.url).href;

export const SONG9_CONFIG: SongConfig = {
  id: "song9",
  transport: {
    bpm: 120,
    beatsPerBar: 4,
    barsPerLoop: 4,
    harmonyCycleBars: 8,
  },
  harmonyTimeline: [
    { startBar: 1, lengthBars: 8, rootNote: "G", mode: "pentatonicMinor" },
  ],
  impactPalette: {
    voices: {
      bell: {
        mode: "stab",
        gain: 0.54,
        attack: 0.002,
        decay: 0.28,
        cutoff: 1680,
        resonance: 1.4,
        drive: 0.42,
        tone: 0.3,
        detuneCents: -7,
        pitchDrop: 0.0,
        routing: { dry: 0.82, drive: 0.42, delay: 0.58, reverb: 0.14, megaFx: 0.04 },
      },
      bass: {
        mode: "sub",
        gain: 0.44,
        attack: 0.002,
        decay: 0.86,
        cutoff: 760,
        resonance: 1.1,
        drive: 0.38,
        tone: -0.46,
        pitchDrop: 0.0,
        routing: { dry: 0.6, drive: 0.4, delay: 0.04, reverb: 0.06, megaFx: 0.03 },
      },
      spark: {
        mode: "tick",
        gain: 0.46,
        attack: 0.001,
        decay: 0.16,
        cutoff: 2440,
        resonance: 1.5,
        drive: 0.54,
        tone: 0.16,
        detuneCents: 6,
        routing: { dry: 0.76, drive: 0.52, delay: 0.12, reverb: 0.08, megaFx: 0.05 },
      },
      snare: {
        mode: "snare",
        gain: 0.7,
        attack: 0.001,
        decay: 0.22,
        cutoff: 2120,
        resonance: 0.9,
        drive: 0.48,
        tone: 0.06,
        routing: { dry: 0.82, drive: 0.5, delay: 0.08, reverb: 0.1, megaFx: 0.04 },
      },
      mega: {
        mode: "mega",
        gain: 0.9,
        attack: 0.001,
        decay: 0.46,
        cutoff: 1860,
        resonance: 1.7,
        drive: 0.74,
        tone: 0.12,
        pitchDrop: 0.2,
        routing: { dry: 0.7, drive: 0.58, delay: 0.16, reverb: 0.16, megaFx: 0.24 },
      },
    },
    buses: {
      dry: { gain: 0.62, tone: 0, drive: 0 },
      drive: { gain: 0.28, tone: 0.06, drive: 0.42 },
      delay: { gain: 0.28, tone: -0.2, drive: 0.18, delayTime: 1.0, feedback: 0.16 },
      reverb: { gain: 0.16, tone: -0.36, drive: 0.1 },
      megaFx: { gain: 0.2, tone: 0.14, drive: 0.42, delayTime: 1, feedback: 0.16 },
    },
    grooveFxProfile: {
      driveBoost: 0.18,
      delayBoost: 0.1,
      reverbBoost: 0.08,
      megaBoost: 0.14,
      filterOpen: 1200,
      wobbleDepth: 0.22,
    },
    megaFxMacro: {
      duration: 1.25,
      decay: 1.9,
      xToDelay: 0.1,
      xToWidth: 0.18,
      yToDrive: 0.18,
      yToFeedback: 0.08,
      yToFilter: 420,
      comboMultiplier: 1.18,
    },
  },
  grooveLevels: [
    {
      level: 1,
      main: {
        src: assetUrl("01m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("01i.ogg"),
        bars: 12,
      },
    },
    {
      level: 2,
      main: {
        src: assetUrl("02m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("02i.ogg"),
        bars: 4,
      },
    },
    {
      level: 3,
      main: {
        src: assetUrl("03m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("03i.ogg"),
        bars: 4,
      },
    },
    {
      level: 4,
      main: {
        src: assetUrl("04m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("04i.ogg"),
        bars: 4,
      },
    },
    {
      level: 5,
      main: {
        src: assetUrl("05m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("05i.ogg"),
        bars: 4,
      },
    },
    {
      level: 6,
      main: {
        src: assetUrl("06m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("06i.ogg"),
        bars: 4,
      },
    },
    {
      level: 7,
      main: {
        src: assetUrl("07m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("07i.ogg"),
        bars: 4,
      },
    },
    {
      level: 8,
      main: {
        src: assetUrl("08m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("08i.ogg"),
        bars: 4,
      },
    },
    {
      level: 9,
      main: {
        src: assetUrl("09m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("09i.ogg"),
        bars: 4,
      },
    },
    {
      level: 10,
      main: {
        src: assetUrl("10m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("10i.ogg"),
        bars: 4,
      },
    },
    {
      level: 11,
      main: {
        src: assetUrl("11m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("11i.ogg"),
        bars: 4,
      },
    },
    {
      level: 12,
      main: {
        src: assetUrl("12m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("12i.ogg"),
        bars: 4,
      },
    },
    {
      level: 13,
      main: {
        src: assetUrl("13m.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("13i.ogg"),
        bars: 4,
      },
    },
    {
      level: 14,
      intro: {
        src: assetUrl("14i.ogg"),
        bars: 16,
      },
      completesSong: true,
    },
  ],
};
