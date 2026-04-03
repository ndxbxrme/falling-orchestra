import type {
  InstrumentFamily,
  ObjectType,
  RootNoteName,
  ScaleModeName,
  SpawnPattern,
} from "./types";

export const ROOT_NOTES: Record<RootNoteName, number> = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};

export const SCALE_MODES: Record<ScaleModeName, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
};

export const MODE_LABELS: Record<ScaleModeName, string> = {
  ionian: "Major / Ionian",
  aeolian: "Minor / Aeolian",
  dorian: "Dorian",
  mixolydian: "Mixolydian",
  pentatonicMajor: "Pentatonic Major",
  pentatonicMinor: "Pentatonic Minor",
};

export const SPAWN_PATTERN_LABELS: Record<SpawnPattern, string> = {
  rain: "Rain",
  lanes: "Lanes",
  swing: "Swing",
};

export const GAME_CONFIG = {
  worldHalfHeight: 9,
  gravity: 22,
  damping: 0.998,
  airDrag: 0.008,
  maxObjects: 32,
  playerSpeed: 13,
  playerWidth: 3.6,
  playerY: -5.6,
  objectCollisionThreshold: 4.8,
  surfaceCollisionThreshold: 3.6,
  maxDeltaTime: 1 / 30,
  platformLifetime: 7.2,
  maxPlatforms: 3,
  platformLength: 3.4,
  spawnIntervalDefault: 0.74,
  spawnIntervalMin: 0,
  spawnIntervalMax: 3,
  spawnIntervalSafeMin: 0.05,
  spawnIntervalKeyStep: 0.1,
  baseSurfaceBounce: 0.92,
  wallBounce: 0.86,
  slopeBounce: 0.94,
  playerBounce: 0.96,
  platformBounce: 0.98,
} as const;

export interface ObjectDefinition {
  type: ObjectType;
  noteFamily: InstrumentFamily;
  radius: number;
  bounce: number;
  mass: number;
  color: string;
  glowColor: string;
  noteRange: [number, number];
  cooldown: number;
  gravityScale: number;
}

export const OBJECT_DEFINITIONS: Record<ObjectType, ObjectDefinition> = {
  bell: {
    type: "bell",
    noteFamily: "bell",
    radius: 0.38,
    bounce: 0.78,
    mass: 1.2,
    color: "#ffd166",
    glowColor: "#fff0a6",
    noteRange: [72, 93],
    cooldown: 0.15,
    gravityScale: 1,
  },
  bass: {
    type: "bass",
    noteFamily: "bass",
    radius: 0.54,
    bounce: 0.52,
    mass: 2.4,
    color: "#ff7b6b",
    glowColor: "#ffb3a7",
    noteRange: [38, 62],
    cooldown: 0.22,
    gravityScale: 1,
  },
  spark: {
    type: "spark",
    noteFamily: "spark",
    radius: 0.28,
    bounce: 0.9,
    mass: 0.75,
    color: "#8deaff",
    glowColor: "#d6fdff",
    noteRange: [79, 103],
    cooldown: 0.09,
    gravityScale: 1,
  },
  mega: {
    type: "mega",
    noteFamily: "mega",
    radius: 0.72,
    bounce: 1.14,
    mass: 1.6,
    color: "#fff178",
    glowColor: "#ffffff",
    noteRange: [56, 82],
    cooldown: 0.3,
    gravityScale: 0.34,
  },
};
