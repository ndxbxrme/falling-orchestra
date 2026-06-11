import type { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import type { ArenaBounds, TransitionState } from "../../game/types";

export type BackdropParamValue = string | number | boolean;
export type BackdropPerformanceTier = "low" | "medium" | "high" | "extreme";

export interface BackdropRuntimeInputs {
  elapsedTimeSeconds: number;
  deltaTimeSeconds: number;
  grooveLevel: number;
  totalGrooveLevels: number;
  grooveIntensity: number;
  beatPulse: number;
  pulsePhase: number;
  scrollDirectionX: number;
  scrollDirectionY: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  transitionState: TransitionState;
  endingProgress: number;
  endingIntensity: number;
  bounds: ArenaBounds;
}

export interface BackdropContext {
  scene: Scene;
  engine: Engine;
  camera: FreeCamera;
  params: Record<string, BackdropParamValue>;
  getBounds: () => ArenaBounds;
}

export interface BackdropInstance {
  // Called every frame. Avoid per-frame allocations and only mutate objects owned by this backdrop.
  update(inputs: BackdropRuntimeInputs): void;
  // Called whenever arena bounds change. If you cache width/height/scale/anchor values from create(),
  // recompute and store them here; otherwise your backdrop will drift or scale incorrectly after resize.
  resize(bounds: ArenaBounds): void;
  dispose(): void;
}

export interface BackdropModule {
  id: string;
  label: string;
  description?: string;
  performanceTier?: BackdropPerformanceTier;
  create(context: BackdropContext): BackdropInstance;
}
