import type { SongConfig } from "../../../../../game/songConfig";

const assetUrl = (relativePath: string): string =>
  new URL(`./audio/${relativePath}`, import.meta.url).href;

export const SONG1_CONFIG: SongConfig = {
  id: "song1",
  transport: {
    bpm: 120,
    beatsPerBar: 4,
    barsPerLoop: 4,
    harmonyCycleBars: 8,
  },
  harmonyTimeline: [
    { startBar: 1, lengthBars: 8, rootNote: "F", mode: "bluesMajor" },
  ],
  grooveLevels: [
    {
      level: 1,
      main: {
        src: assetUrl("gl1_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl1_intro.ogg"),
        bars: 2,
      },
    },
    {
      level: 2,
      main: {
        src: assetUrl("gl2_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl2_intro.ogg"),
        bars: 4,
      },
    },
    {
      level: 3,
      main: {
        src: assetUrl("gl3_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl3_intro.ogg"),
        bars: 4,
      },
    },
    {
      level: 4,
      main: {
        src: assetUrl("gl4_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl4_intro.ogg"),
        bars: 4,
      },
    },
    {
      level: 5,
      main: {
        src: assetUrl("gl5_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl5_intro.ogg"),
        bars: 4,
      },
    },
    {
      level: 6,
      main: {
        src: assetUrl("gl6_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl6_intro.ogg"),
        bars: 4,
      },
    },
    {
      level: 7,
      main: {
        src: assetUrl("gl7_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl7_intro.ogg"),
        bars: 4,
      },
    },
    {
      level: 8,
      main: {
        src: assetUrl("gl8_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl8_intro.ogg"),
        bars: 4,
      },
    },
    {
      level: 9,
      main: {
        src: assetUrl("gl9_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl9_intro.ogg"),
        bars: 4,
      },
    },
    {
      level: 10,
      main: {
        src: assetUrl("gl10_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl10_intro.ogg"),
        bars: 4,
      },
    },
    {
      level: 11,
      main: {
        src: assetUrl("gl11_main.ogg"),
        bars: 4,
      },
      intro: {
        src: assetUrl("gl11_intro.ogg"),
        bars: 4,
      },
    },
    {
      level: 12,
      intro: {
        src: assetUrl("gl11_finale.ogg"),
        bars: 4,
      },
      completesSong: true,
    },
  ],
};
