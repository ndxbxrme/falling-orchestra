import type { Vector2 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

export type ObjectType = "bell" | "bass" | "spark";
export type InstrumentFamily = "bell" | "bass" | "spark";
export type SurfaceKind = "floor" | "wall" | "slope" | "player" | "temporary";
export type SpawnPattern = "rain" | "lanes" | "swing";
export type ScaleModeName =
  | "ionian"
  | "aeolian"
  | "dorian"
  | "mixolydian"
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
  position: Vector2;
  velocity: Vector2;
  radius: number;
  bounce: number;
  mass: number;
  color: string;
  glowColor: string;
  noteRange: [number, number];
  cooldown: number;
  pulse: number;
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

export interface TemporaryPlatform {
  id: string;
  x: number;
  y: number;
  length: number;
  ttl: number;
  transpose: number;
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
  started: boolean;
  activeObjects: number;
  activePlatforms: number;
  rootNote: RootNoteName;
  mode: ScaleModeName;
  liveMode: boolean;
  hudVisible: boolean;
  spawnInterval: number;
  spawnLiveInterval: number;
  spawnPattern: SpawnPattern;
  grooveCharge: number;
  grooveTarget: number;
  snareUnlocked: boolean;
  hatsUnlocked: boolean;
  droneUnlocked: boolean;
  grooveLayerLabel: string;
  activeFormationCaught: number;
  activeFormationRequired: number;
  activeFormationVisible: boolean;
  paused: boolean;
  muted: boolean;
  freezeSpawning: boolean;
  debugLabels: boolean;
  masterVolume: number;
}
