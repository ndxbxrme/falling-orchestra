import type { Vector2 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

export type ObjectType = "bell" | "bass" | "spark" | "snare" | "mega" | "solo";
export type InstrumentFamily = "bell" | "bass" | "spark" | "snare" | "mega";
export type SurfaceKind = "floor" | "wall" | "slope" | "player";
export type SpawnPattern = "rain" | "lanes" | "swing";
export type ScaleModeName =
  | "ionian"
  | "aeolian"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "locrian"
  | "mixolydian"
  | "harmonicMinor"
  | "melodicMinor"
  | "bluesMajor"
  | "bluesMinor"
  | "pentatonicMajor"
  | "pentatonicMinor";
export type RootNoteName =
  | "C"
  | "C#"
  | "D"
  | "D#"
  | "E"
  | "F"
  | "F#"
  | "G"
  | "G#"
  | "A"
  | "A#"
  | "B";
export type GameSessionPhase = "idle" | "countdown" | "playing" | "ending" | "completed";
export type TransitionState =
  | { kind: "none" }
  | { kind: "grooveBuild"; targetLevel: number; progress: number; intensity: number }
  | { kind: "grooveLanding"; level: number; progress: number; intensity: number }
  | { kind: "songEnding"; progress: number; intensity: number };

export interface ArenaBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  floorY: number;
}

export interface MusicalObject {
  id: number;
  type: ObjectType;
  noteFamily: InstrumentFamily;
  specialFormationId?: string;
  specialCaught?: boolean;
  soloCaught?: boolean;
  previousPosition: Vector2;
  position: Vector2;
  velocity: Vector2;
  radius: number;
  bounce: number;
  mass: number;
  color: string;
  glowColor: string;
  visualScale: number;
  noteRange: [number, number];
  cooldown: number;
  gravityScale: number;
  pulse: number;
  age: number;
  trailTimer: number;
  mesh: Mesh;
  coreMesh: Mesh;
}

export interface Surface {
  id: string;
  kind: SurfaceKind;
  a: Vector2;
  b: Vector2;
  bounce: number;
  musical: boolean;
  transpose: number;
  color: string;
  ttl?: number;
  mesh?: Mesh;
}

export interface WorldImpact {
  x: number;
  y: number;
  color: string;
  strength: number;
}

export interface PlayedNote {
  label: string;
  color: string;
}

export interface OverlayState {
  sessionPhase: GameSessionPhase;
  transitionState: TransitionState;
  activeObjects: number;
  fps: number;
  frameTimeMs: number;
  rootNote: RootNoteName;
  mode: ScaleModeName;
  liveMode: boolean;
  hudVisible: boolean;
  spawnInterval: number;
  spawnLiveInterval: number;
  spawnPattern: SpawnPattern;
  grooveCharge: number;
  grooveTarget: number;
  grooveLevel: number;
  grooveLevelTotal: number;
  grooveLayerLabel: string;
  activeFormationCaught: number;
  activeFormationRequired: number;
  activeFormationVisible: boolean;
  soloModeActive: boolean;
  soloMissesRemaining: number;
  paused: boolean;
  muted: boolean;
  freezeSpawning: boolean;
  debugLabels: boolean;
  masterVolume: number;
}

export interface MusicRuntimeSnapshot {
  rootNote: RootNoteName;
  mode: ScaleModeName;
  currentGrooveLevel: number;
  beatPulse: number;
  transportQuarterIndex: number | null;
  pendingGrooveBoost: { targetLevel: number; intensity: number } | null;
  endingState: { progress: number; intensity: number } | null;
  grooveLandingLevel: number | null;
  grooveLandingSequence: number;
  songCompleted: boolean;
}

export interface GameCompletionStats {
  specialCatches: number;
  longestSolo: number;
}
