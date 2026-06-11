import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { getBackdropModuleById } from "../content/backdrops";
import type {
  BackdropInstance,
  BackdropModule,
  BackdropParamValue,
  BackdropRuntimeInputs,
} from "../content/backdrops";
import { GAME_CONFIG, OBJECT_DEFINITIONS } from "./config";
import type { ArenaBounds, MusicalObject, ObjectType, Surface, SurfaceKind, TransitionState } from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const hex = (value: string): Color3 => Color3.FromHexString(value);

const PLAYER_BAR_COLOR = "#77f6f2";
const PLAYER_CORE_COLOR = "#f2f8ff";
const PLAYER_METAL_COLOR = "#273543";
const PLAYER_SHADOW_COLOR = "#101722";
const PLAYER_WARN_COLOR = "#ff6b57";
const PLAYER_RADAR_COLOR = "#2b8f97";
const SIGNAL_RING_ALPHA = 0.78;
const SIGNAL_TICK_ALPHA = 0.58;
const SIGNAL_HALO_ALPHA = 0.22;
const PLAYFIELD_RAIL_COLOR = "#7ee9ef";
const PLAYFIELD_RAIL_DIM = "#243746";
const PLAYFIELD_GUIDE_COLOR = "#6bdce6";
const PLAYFIELD_WARN_COLOR = "#ff5a53";
const BUMPER_CORE_COLOR = "#82f8ff";
const BUMPER_DIM_COLOR = "#182430";

interface PulseEffect {
  active: boolean;
  mesh: Mesh;
  material: StandardMaterial;
  baseRadius: number;
  age: number;
  lifetime: number;
  startScale: number;
  endScale: number;
  startAlpha: number;
  endAlpha: number;
}

interface SurfaceHit {
  positionX: number;
  positionY: number;
  closestX: number;
  closestY: number;
  normalX: number;
  normalY: number;
  distance: number;
}

interface PlayfieldDecor {
  centerline: Mesh;
  centerlineMaterial: StandardMaterial;
  centerTicks: Mesh[];
  centerTickMaterials: StandardMaterial[];
  radialRings: Mesh[];
  radialMaterials: StandardMaterial[];
  lowerGuides: Mesh[];
  lowerGuideMaterials: StandardMaterial[];
}

interface PooledBallVisual {
  outer: Mesh;
  core: Mesh;
  variant: "default" | "solo";
  active: boolean;
}

interface SoloLinkEffect {
  active: boolean;
  segments: Mesh[];
  materials: StandardMaterial[];
}

interface WorldOptions {
  backdropPresetId?: string;
  backdropParams?: Record<string, BackdropParamValue>;
}

const MEGA_COLORS = [
  "#000000",
  "#0000D7",
  "#D70000",
  "#D700D7",
  "#00D700",
  "#00D7D7",
  "#D7D700",
  "#D7D7D7",
  "#000000",
  "#0000FF",
  "#FF0000",
  "#FF00FF",
  "#00FF00",
  "#00FFFF",
  "#FFFF00",
  "#FFFFFF",
];
export class World {
  readonly engine: Engine;
  readonly scene: Scene;

  private camera: FreeCamera;
  private bounds: ArenaBounds = {
    left: -16,
    right: 16,
    top: 9,
    bottom: -9,
    floorY: -7.8,
  };
  private objects: MusicalObject[] = [];
  private baseSurfaces: Surface[] = [];
  private pulses: PulseEffect[] = [];
  private ballVisualPool: PooledBallVisual[] = [];
  private soloLinkPool: SoloLinkEffect[] = [];
  private objectPool: MusicalObject[] = [];
  private objectById = new Map<number, MusicalObject>();
  private nextObjectId = 0;
  private objectMaterials = new Map<ObjectType, { outer: StandardMaterial; inner: StandardMaterial }>();
  private playerCoreMaterial: StandardMaterial;
  private playerMesh: Mesh;
  private playerSurface: Surface;
  private backdropTime = 0;
  private backdropBeatPulse = 0;
  private backdropGrooveIntensity = 0;
  private endingProgress = 0;
  private endingIntensity = 0;
  private transitionState: TransitionState = { kind: "none" };
  private backdropScrollDirection = new Vector2(0.78, -0.24);
  private backdropTargetScrollDirection = new Vector2(0.78, -0.24);
  private backdropScrollOffset = new Vector2(0, 0);
  private playfieldDecor?: PlayfieldDecor;
  private cameraBasePosition = new Vector3(0, 0, -18);
  private playerWidth: number = GAME_CONFIG.playerWidth;
  private playerX = 0;
  private previousPositionScratch = new Vector2();
  private backdropModule?: BackdropModule;
  private backdropInstance?: BackdropInstance;
  private backdropParams: Record<string, BackdropParamValue>;
  private backdropGrooveLevel = 1;
  private backdropTotalGrooveLevels = 1;

  constructor(canvas: HTMLCanvasElement, options: WorldOptions = {}) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.015, 0.018, 0.022, 1);
    this.backdropParams = options.backdropParams ?? {};

    this.camera = new FreeCamera("camera", this.cameraBasePosition.clone(), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.setTarget(Vector3.Zero());

    this.playerCoreMaterial = this.createFlatMaterial("player-core", "#d7fff6");

    for (const definition of Object.values(OBJECT_DEFINITIONS)) {
      this.objectMaterials.set(definition.type, {
        outer: this.createFlatMaterial(`${definition.type}-outer`, definition.color),
        inner: this.createFlatMaterial(`${definition.type}-inner`, definition.glowColor),
      });
    }

    this.backdropModule = getBackdropModuleById(options.backdropPresetId ?? "brutalist-club")
      ?? getBackdropModuleById("brutalist-club");
    this.backdropInstance = this.backdropModule?.create({
      scene: this.scene,
      engine: this.engine,
      camera: this.camera,
      params: this.backdropParams,
      getBounds: () => this.bounds,
    });
    this.createPlayfieldDecor();
    this.playerMesh = this.createPlayerAvatar();
    this.playerSurface = this.createPlayerSurface();
    this.resize();
  }

  getBounds(): ArenaBounds {
    return this.bounds;
  }

  getObjectCount(): number {
    return this.objects.length;
  }

  clampPlayerX(x: number): number {
    const halfWidth = this.getResponsivePlayerWidth() * 0.5;
    const sidePadding = Math.max(halfWidth + 0.9, 1.75);
    return clamp(x, this.bounds.left + sidePadding, this.bounds.right - sidePadding);
  }

  render(interpolationAlpha = 1): void {
    const deltaSeconds = this.engine.getDeltaTime() * 0.001;
    this.backdropTime += deltaSeconds;

    const smoothing = Math.min(1, deltaSeconds * 2.2);
    const powerDown = 1 - this.endingIntensity * 0.45;
    const scrollSpeed = (0.045 + this.backdropGrooveIntensity * 0.035) * powerDown;
    this.backdropScrollDirection.x +=
      (this.backdropTargetScrollDirection.x - this.backdropScrollDirection.x) * smoothing;
    this.backdropScrollDirection.y +=
      (this.backdropTargetScrollDirection.y - this.backdropScrollDirection.y) * smoothing;
    this.backdropScrollOffset.x += this.backdropScrollDirection.x * deltaSeconds * scrollSpeed;
    this.backdropScrollOffset.y += this.backdropScrollDirection.y * deltaSeconds * scrollSpeed;

    this.syncPlayfieldDecor();
    this.syncCameraMotion();

    this.backdropInstance?.update({
      elapsedTimeSeconds: this.backdropTime,
      deltaTimeSeconds: deltaSeconds,
      grooveLevel: this.backdropGrooveLevel,
      totalGrooveLevels: this.backdropTotalGrooveLevels,
      grooveIntensity: this.backdropGrooveIntensity,
      beatPulse: this.backdropBeatPulse,
      pulsePhase: this.backdropTime,
      scrollDirectionX: this.backdropScrollDirection.x,
      scrollDirectionY: this.backdropScrollDirection.y,
      scrollOffsetX: this.backdropScrollOffset.x,
      scrollOffsetY: this.backdropScrollOffset.y,
      transitionState: this.transitionState,
      endingProgress: this.endingProgress,
      endingIntensity: this.endingIntensity,
      bounds: this.bounds,
    } satisfies BackdropRuntimeInputs);

    const alpha = clamp(interpolationAlpha, 0, 1);
    for (const object of this.objects) {
      const renderX = object.previousPosition.x + (object.position.x - object.previousPosition.x) * alpha;
      const renderY = object.previousPosition.y + (object.position.y - object.previousPosition.y) * alpha;
      object.mesh.position.set(renderX, renderY, 0);
      object.coreMesh.position.set(renderX, renderY, -0.06);
    }

    this.syncSoloLinks(alpha);

    this.scene.render();
  }

  resize(): void {
    this.engine.resize();

    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    const aspect = width / Math.max(height, 1);
    const halfHeight = GAME_CONFIG.worldHalfHeight;
    const halfWidth = this.getResponsiveWorldHalfWidth(halfHeight, aspect);

    this.bounds = {
      left: -halfWidth,
      right: halfWidth,
      top: halfHeight,
      bottom: -halfHeight,
      floorY: -halfHeight + 1.4,
    };

    this.applyCameraFrame();
    this.backdropInstance?.resize(this.bounds);

    this.rebuildBaseSurfaces();
    this.setPlayerX(this.playerX);
  }

  dispose(): void {
    for (const object of this.objects) {
      this.releaseBallVisual(object.mesh, object.coreMesh);
      this.releaseObject(object);
    }
    this.objectById.clear();

    for (const surface of this.baseSurfaces) {
      surface.mesh?.dispose();
    }

    this.playerMesh.dispose();
    this.playerSurface.mesh?.dispose();
    this.pulses.forEach((pulse) => pulse.mesh.dispose());
    this.ballVisualPool.forEach((visual) => {
      visual.outer.dispose();
      visual.core.dispose();
    });
    this.soloLinkPool.forEach((link) => {
      link.segments.forEach((segment) => segment.dispose());
    });
    this.backdropInstance?.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  reset(): void {
    for (const object of this.objects) {
      this.releaseBallVisual(object.mesh, object.coreMesh);
      this.releaseObject(object);
    }
    this.objectById.clear();

    this.objects = [];
    this.nextObjectId = 0;
    for (const pulse of this.pulses) {
      pulse.active = false;
      pulse.mesh.setEnabled(false);
    }
    for (const link of this.soloLinkPool) {
      link.active = false;
      link.segments.forEach((segment) => segment.setEnabled(false));
    }
    this.transitionState = { kind: "none" };
    this.endingProgress = 0;
    this.endingIntensity = 0;
    this.backdropGrooveLevel = 1;
    this.backdropTotalGrooveLevels = 1;
  }

  setPlayerX(x: number): void {
    this.playerWidth = this.getResponsivePlayerWidth();
    this.playerX = this.clampPlayerX(x);
    const halfWidth = this.playerWidth * 0.5;
    const y = GAME_CONFIG.playerY;

    this.playerSurface.a.x = this.playerX - halfWidth;
    this.playerSurface.a.y = y;
    this.playerSurface.b.x = this.playerX + halfWidth;
    this.playerSurface.b.y = y;
    this.updateSurfaceMesh(this.playerSurface, 0.34);

    this.playerMesh.position.x = this.playerX;
    this.playerMesh.position.y = y - 0.08;
    this.playerMesh.scaling.x = this.playerWidth / GAME_CONFIG.playerWidth;
    this.playerMesh.scaling.y = 1;
    this.playerMesh.scaling.z = 1;
  }

  setCameraBeatPulse(pulse: number, grooveIntensity: number): void {
    this.backdropBeatPulse = clamp(pulse, 0, 1);
    this.backdropGrooveIntensity = clamp(grooveIntensity, 0, 1);
  }

  setBackdropGrooveState(grooveLevel: number, totalGrooveLevels: number): void {
    this.backdropGrooveLevel = Math.max(1, grooveLevel);
    this.backdropTotalGrooveLevels = Math.max(1, totalGrooveLevels);
  }

  setEndingState(progress: number, intensity: number): void {
    this.endingProgress = clamp(progress, 0, 1);
    this.endingIntensity = clamp(intensity, 0, 1);
  }

  setTransitionState(state: TransitionState): void {
    this.transitionState = state;
  }

  setBackdropScrollDirection(direction: Vector2): void {
    const length = direction.length();
    if (length <= 0.0001) {
      return;
    }

    this.backdropTargetScrollDirection = direction.scale(1 / length);
  }

  spawnObject(
    type: ObjectType,
    x: number,
    velocityX?: number,
    velocityY?: number,
    specialFormationId?: string,
    formationColor?: string,
  ): MusicalObject | null {
    const definition = OBJECT_DEFINITIONS[type];
    const radius = definition.radius * this.getResponsiveObjectScale();
    const visual = this.acquireBallVisual(type === "solo" ? "solo" : "default");
    const mesh = visual.outer;
    const coreMesh = visual.core;
    mesh.setEnabled(true);
    coreMesh.setEnabled(true);

    const spawnX = clamp(x, this.bounds.left + 1.6, this.bounds.right - 1.6);
    const spawnY = this.bounds.top - 0.8 + Math.random() * 0.6;
    const outerColor = formationColor ?? definition.color;
    const innerColor = formationColor ? "#fff9dc" : definition.glowColor;
    this.tintMeshMaterials(mesh, outerColor);
    this.tintMeshMaterials(coreMesh, innerColor);

    const object = this.acquireObject();
    object.id = this.nextObjectId += 1;
    object.type = type;
    object.noteFamily = definition.noteFamily;
    object.specialFormationId = specialFormationId;
    object.specialCaught = false;
    object.soloCaught = false;
    object.previousPosition.x = spawnX;
    object.previousPosition.y = spawnY;
    object.position.x = spawnX;
    object.position.y = spawnY;
    object.velocity.x = velocityX ?? (Math.random() - 0.5) * 2.6;
    object.velocity.y = velocityY ?? (-1.5 - Math.random() * 1.4);
    object.radius = radius;
    object.bounce = definition.bounce;
    object.mass = definition.mass;
    object.color = outerColor;
    object.glowColor = innerColor;
    object.visualScale = radius;
    object.noteRange = definition.noteRange;
    object.cooldown = definition.cooldown;
    object.gravityScale = definition.gravityScale;
    object.pulse = 0;
    object.age = 0;
    object.trailTimer = type === "mega" ? 0.02 : 0;
    object.mesh = mesh;
    object.coreMesh = coreMesh;

    this.objects.push(object);
    this.objectById.set(object.id, object);
    object.mesh.position.set(object.position.x, object.position.y, 0);
    object.coreMesh.position.set(object.position.x, object.position.y, -0.06);
    object.mesh.scaling.setAll(radius);
    object.coreMesh.scaling.setAll(radius);
    return object;
  }

  markSpecialCaught(objectId: number): void {
    const object = this.objectById.get(objectId);

    if (!object || object.specialCaught) {
      return;
    }

    object.specialCaught = true;
    object.pulse = Math.max(object.pulse, 0.65);

    this.tintMeshMaterials(object.mesh, "#69f5d8");
    this.tintMeshMaterials(object.coreMesh, "#ecfffa");
  }

  markSoloCaught(objectId: number): void {
    const object = this.objectById.get(objectId);

    if (!object || object.soloCaught) {
      return;
    }

    object.soloCaught = true;
    object.pulse = Math.max(object.pulse, 0.82);
    this.tintMeshMaterials(object.mesh, "#ffd49a");
    this.tintMeshMaterials(object.coreMesh, "#fff6e2");
  }

  update(
    deltaTime: number,
    onSurfaceImpact: (object: MusicalObject, surface: Surface, x: number, y: number, impact: number) => void,
    onPairImpact: (
      source: MusicalObject,
      other: MusicalObject,
      x: number,
      y: number,
      impact: number,
    ) => void,
    onObjectRemoved?: (object: MusicalObject) => void,
  ): void {
    const substeps = Math.max(1, Math.min(8, Math.ceil(deltaTime / (1 / 240))));
    const stepDeltaTime = deltaTime / substeps;

    for (const pulse of this.pulses) {
      if (!pulse.active) {
        continue;
      }
      pulse.age += deltaTime;
      const progress = pulse.age / pulse.lifetime;
      const scale = pulse.baseRadius * (pulse.startScale + (pulse.endScale - pulse.startScale) * progress);
      pulse.mesh.scaling.setAll(scale);
      pulse.material.alpha = Math.max(
        0,
        pulse.startAlpha + (pulse.endAlpha - pulse.startAlpha) * progress,
      );
      if (pulse.age >= pulse.lifetime) {
        pulse.active = false;
        pulse.mesh.setEnabled(false);
      }
    }

    for (let step = 0; step < substeps; step += 1) {
      for (const object of this.objects) {
        object.previousPosition.x = object.position.x;
        object.previousPosition.y = object.position.y;
        object.cooldown = Math.max(0, object.cooldown - stepDeltaTime);
        object.pulse = Math.max(0, object.pulse - stepDeltaTime * 3.6);
        object.age += stepDeltaTime;
        object.trailTimer = Math.max(0, object.trailTimer - stepDeltaTime);
        this.previousPositionScratch.x = object.position.x;
        this.previousPositionScratch.y = object.position.y;

        object.velocity.y -= GAME_CONFIG.gravity * object.gravityScale * stepDeltaTime;
        object.velocity.x *= 1 - GAME_CONFIG.airDrag * stepDeltaTime * 60;
        object.velocity.y *= GAME_CONFIG.damping;
        object.position.x += object.velocity.x * stepDeltaTime;
        object.position.y += object.velocity.y * stepDeltaTime;

        if (object.type === "mega") {
          this.updateMegaAppearance(object);

          if (object.trailTimer <= 0) {
            this.createMegaTrail(object.position.x, object.position.y, this.getMegaPaletteColor(object.age));
            object.trailTimer = 0.045;
          }
        }

        for (const surface of this.baseSurfaces) {
          this.resolveSurfaceCollision(object, this.previousPositionScratch, surface, onSurfaceImpact);
        }
        this.resolveSurfaceCollision(object, this.previousPositionScratch, this.playerSurface, onSurfaceImpact);
      }
      this.resolveObjectCollisions(onPairImpact);
    }

    for (const object of this.objects) {
      const scale = object.visualScale * (1 + object.pulse * 0.22);
      const coreScale = object.visualScale * (1 - object.pulse * 0.12);
      object.mesh.scaling.setAll(scale);
      object.coreMesh.scaling.setAll(coreScale);
    }

    let activeObjectCount = 0;
    for (const object of this.objects) {
      if (object.position.y >= this.bounds.bottom - 2.4) {
        this.objects[activeObjectCount] = object;
        activeObjectCount += 1;
        continue;
      }

      onObjectRemoved?.(object);
      this.objectById.delete(object.id);
      this.releaseBallVisual(object.mesh, object.coreMesh);
      this.releaseObject(object);
    }
    this.objects.length = activeObjectCount;
  }

  private acquireObject(): MusicalObject {
    const pooled = this.objectPool.pop();
    if (pooled) {
      return pooled;
    }

    return {
      id: 0,
      type: "bell",
      noteFamily: "bell",
      specialFormationId: undefined,
      specialCaught: false,
      soloCaught: false,
      previousPosition: new Vector2(0, 0),
      position: new Vector2(0, 0),
      velocity: new Vector2(0, 0),
      radius: 0,
      bounce: 0,
      mass: 1,
      color: "#ffffff",
      glowColor: "#ffffff",
      visualScale: 1,
      noteRange: [60, 72],
      cooldown: 0,
      gravityScale: 1,
      pulse: 0,
      age: 0,
      trailTimer: 0,
      mesh: null as unknown as Mesh,
      coreMesh: null as unknown as Mesh,
    };
  }

  private releaseObject(object: MusicalObject): void {
    object.specialFormationId = undefined;
    object.specialCaught = false;
    object.soloCaught = false;
    object.cooldown = 0;
    object.pulse = 0;
    object.age = 0;
    object.trailTimer = 0;
    this.objectPool.push(object);
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();

    return {
      x: ((x - this.bounds.left) / (this.bounds.right - this.bounds.left)) * width,
      y: ((this.bounds.top - y) / (this.bounds.top - this.bounds.bottom)) * height,
    };
  }

  private applyCameraFrame(): void {
    const halfWidth = (this.bounds.right - this.bounds.left) * 0.5;
    const halfHeight = (this.bounds.top - this.bounds.bottom) * 0.5;
    this.camera.orthoLeft = -halfWidth;
    this.camera.orthoRight = halfWidth;
    this.camera.orthoTop = halfHeight;
    this.camera.orthoBottom = -halfHeight;
  }

  private createPlayfieldDecor(): void {
    const centerTicks: Mesh[] = [];
    const centerTickMaterials: StandardMaterial[] = [];
    const radialRings: Mesh[] = [];
    const radialMaterials: StandardMaterial[] = [];
    const lowerGuides: Mesh[] = [];
    const lowerGuideMaterials: StandardMaterial[] = [];

    const centerline = MeshBuilder.CreatePlane("playfield-centerline", {
      width: 0.03,
      height: 14.8,
    }, this.scene);
    const centerlineMaterial = this.createFlatMaterial("playfield-centerline-material", PLAYFIELD_WARN_COLOR, 0.22);
    centerline.material = centerlineMaterial;
    centerline.position.set(0, 0.38, 1.5);

    for (let index = 0; index < 10; index += 1) {
      const tick = MeshBuilder.CreatePlane(`playfield-center-tick-${index}`, {
        width: index % 2 === 0 ? 0.22 : 0.1,
        height: 0.03,
      }, this.scene);
      const tickMaterial = this.createFlatMaterial(
        `playfield-center-tick-material-${index}`,
        index === 4 ? PLAYFIELD_WARN_COLOR : PLAYFIELD_GUIDE_COLOR,
        index === 4 ? 0.42 : 0.26,
      );
      tick.material = tickMaterial;
      tick.position.set(0, 6.2 - index * 1.28, 1.52);
      centerTicks.push(tick);
      centerTickMaterials.push(tickMaterial);
    }

    for (let index = 0; index < 4; index += 1) {
      const ring = MeshBuilder.CreateTorus(`playfield-radial-ring-${index}`, {
        diameter: 4.8 + index * 2.05,
        thickness: 0.03,
        tessellation: 72,
      }, this.scene);
      const ringMaterial = this.createFlatMaterial(
        `playfield-radial-ring-material-${index}`,
        index === 0 ? PLAYFIELD_RAIL_COLOR : PLAYFIELD_GUIDE_COLOR,
        0.14 - index * 0.02,
      );
      ring.material = ringMaterial;
      ring.rotation.x = Math.PI * 0.5;
      ring.position.set(0, -6.55, 1.42 - index * 0.01);
      radialRings.push(ring);
      radialMaterials.push(ringMaterial);
    }

    for (const direction of [-1, 1]) {
      for (let index = 0; index < 3; index += 1) {
        const guide = MeshBuilder.CreatePlane(`playfield-lower-guide-${direction}-${index}`, {
          width: 2.2 + index * 1.1,
          height: 0.03,
        }, this.scene);
        const guideMaterial = this.createFlatMaterial(
          `playfield-lower-guide-material-${direction}-${index}`,
          PLAYFIELD_GUIDE_COLOR,
          0.16 - index * 0.025,
        );
        guide.material = guideMaterial;
        guide.position.set(direction * (3.2 + index * 1.05), -6.3 + index * 0.34, 1.38 - index * 0.01);
        guide.rotation.z = direction * (0.18 + index * 0.06);
        lowerGuides.push(guide);
        lowerGuideMaterials.push(guideMaterial);
      }
    }

    this.playfieldDecor = {
      centerline,
      centerlineMaterial,
      centerTicks,
      centerTickMaterials,
      radialRings,
      radialMaterials,
      lowerGuides,
      lowerGuideMaterials,
    };
  }

  private syncPlayfieldDecor(): void {
    if (!this.playfieldDecor) {
      return;
    }

    const groove = this.backdropGrooveIntensity;
    const beat = this.backdropBeatPulse;
    const buildLift = this.transitionState.kind === "grooveBuild" ? this.transitionState.intensity * 0.18 : 0;
    const landingLift = this.transitionState.kind === "grooveLanding" ? this.transitionState.intensity * 0.54 : 0;
    const powerDown = 1 - this.endingIntensity * 0.36;

    this.playfieldDecor.centerlineMaterial.alpha = (0.24 + groove * 0.14 + beat * 0.1 + buildLift * 0.08 + landingLift * 0.22) * powerDown;
    this.playfieldDecor.centerlineMaterial.emissiveColor = this.playfieldDecor.centerlineMaterial.diffuseColor.scale(
      (0.34 + groove * 0.58 + beat * 0.36 + buildLift * 0.32 + landingLift * 0.62) * powerDown,
    );

    this.playfieldDecor.centerTickMaterials.forEach((material, index) => {
      const pulse = index === 4 ? 0.26 : 0.1;
      material.alpha = (index === 4 ? 0.52 : 0.34) * powerDown;
      material.emissiveColor = material.diffuseColor.scale((0.32 + groove * 0.28 + beat * (pulse + 0.06) + landingLift * 0.4) * powerDown);
    });

    this.playfieldDecor.radialMaterials.forEach((material, index) => {
      material.alpha = clamp((0.2 + groove * 0.08 - index * 0.025 + beat * 0.04) * powerDown, 0.05, 0.34);
      material.emissiveColor = material.diffuseColor.scale((0.22 + groove * 0.28 + beat * 0.08 + buildLift * 0.18 + landingLift * 0.28) * powerDown);
    });

    this.playfieldDecor.lowerGuideMaterials.forEach((material, index) => {
      material.alpha = clamp((0.18 + groove * 0.07 - index * 0.018 + beat * 0.03) * powerDown, 0.04, 0.28);
      material.emissiveColor = material.diffuseColor.scale((0.18 + groove * 0.22 + beat * 0.06 + buildLift * 0.16 + landingLift * 0.26) * powerDown);
    });
  }

  private syncCameraMotion(): void {
    const groove = this.backdropGrooveIntensity;
    const buildLift = this.transitionState.kind === "grooveBuild" ? this.transitionState.intensity : 0;
    const landingLift = this.transitionState.kind === "grooveLanding" ? this.transitionState.intensity : 0;
    const settle = 1 - this.endingProgress * 0.52;
    const drift = (0.16 + groove * 0.28 + buildLift * 0.04 + landingLift * 0.07) * settle;
    const verticalDrift = (0.08 + groove * 0.16 + buildLift * 0.03 + landingLift * 0.05) * settle;
    const beatLift = this.backdropBeatPulse * (0.08 + groove * 0.14 + landingLift * 0.06) * (1 - this.endingProgress * 0.35);
    this.camera.position.x =
      this.cameraBasePosition.x +
      Math.sin(this.backdropTime * 0.22) * drift +
      Math.cos(this.backdropTime * 0.49) * drift * 0.28;
    this.camera.position.y =
      this.cameraBasePosition.y +
      Math.sin(this.backdropTime * 0.31 + 1.3) * verticalDrift +
      Math.cos(this.backdropTime * 0.18 + 0.4) * verticalDrift * 0.35 +
      Math.sin(this.backdropTime * 5.4) * landingLift * 0.05 +
      beatLift;
    this.camera.rotation.z =
      Math.sin(this.backdropTime * 0.18) * (0.006 + groove * 0.012) * settle +
      Math.sin(this.backdropTime * 6.8) * landingLift * 0.012;
  }

  private createPlayerAvatar(): Mesh {
    const avatar = MeshBuilder.CreateDisc("player-avatar", {
      radius: 0.34,
      tessellation: 32,
    }, this.scene);
    avatar.material = this.createFlatMaterial("player-hub-shell", PLAYER_METAL_COLOR, 0.96);
    avatar.position.z = -0.12;

    const bar = MeshBuilder.CreatePlane("player-fader-bar", {
      width: 3.15,
      height: 0.28,
    }, this.scene);
    bar.parent = avatar;
    bar.material = this.createFlatMaterial("player-fader-bar-material", PLAYER_BAR_COLOR, 0.9);
    bar.position.set(0, 0, 0.02);

    const barShadow = MeshBuilder.CreatePlane("player-fader-shadow", {
      width: 3.35,
      height: 0.52,
    }, this.scene);
    barShadow.parent = avatar;
    barShadow.material = this.createFlatMaterial("player-fader-shadow-material", PLAYER_SHADOW_COLOR, 0.34);
    barShadow.position.set(0, -0.02, 0.09);

    const leftCap = MeshBuilder.CreateBox("player-left-cap", {
      width: 0.58,
      height: 0.44,
      depth: 0.14,
    }, this.scene);
    leftCap.parent = avatar;
    leftCap.material = this.createFlatMaterial("player-left-cap-material", PLAYER_METAL_COLOR);
    leftCap.position.set(-1.42, 0, -0.02);

    const rightCap = leftCap.clone("player-right-cap");
    rightCap.parent = avatar;
    rightCap.position.x = 1.42;

    const leftWing = MeshBuilder.CreatePlane("player-left-wing", {
      width: 0.82,
      height: 0.32,
    }, this.scene);
    leftWing.parent = avatar;
    leftWing.material = this.createFlatMaterial("player-left-wing-material", "#3fd7df", 0.82);
    leftWing.position.set(-0.68, 0.02, -0.01);
    leftWing.rotation.z = 0.18;

    const rightWing = leftWing.clone("player-right-wing");
    rightWing.parent = avatar;
    rightWing.position.x = 0.68;
    rightWing.rotation.z = -0.18;

    const leftCut = MeshBuilder.CreatePlane("player-left-cut", {
      width: 0.34,
      height: 0.06,
    }, this.scene);
    leftCut.parent = avatar;
    leftCut.material = this.createFlatMaterial("player-left-cut-material", PLAYER_SHADOW_COLOR, 0.92);
    leftCut.position.set(-0.72, 0.05, -0.04);
    leftCut.rotation.z = 0.18;

    const rightCut = leftCut.clone("player-right-cut");
    rightCut.parent = avatar;
    rightCut.position.x = 0.72;
    rightCut.rotation.z = -0.18;

    const inner = MeshBuilder.CreateDisc("player-avatar-core", {
      radius: 0.16,
      tessellation: 20,
    }, this.scene);
    inner.material = this.playerCoreMaterial;
    inner.parent = avatar;
    inner.position.z = -0.06;

    const outerHubRing = MeshBuilder.CreateTorus("player-hub-ring", {
      diameter: 0.58,
      thickness: 0.045,
      tessellation: 40,
    }, this.scene);
    outerHubRing.parent = avatar;
    outerHubRing.rotation.x = Math.PI * 0.5;
    outerHubRing.position.z = -0.08;
    outerHubRing.material = this.createFlatMaterial("player-hub-ring-material", PLAYER_CORE_COLOR, 0.7);

    const radarArc = MeshBuilder.CreateDisc("player-radar-arc", {
      radius: 0.92,
      arc: 0.54,
      tessellation: 48,
    }, this.scene);
    radarArc.parent = avatar;
    radarArc.material = this.createFlatMaterial("player-radar-arc-material", PLAYER_RADAR_COLOR, 0.18);
    radarArc.rotation.z = Math.PI;
    radarArc.position.set(0, 0.14, 0.12);
    radarArc.scaling.y = 0.1;

    const leftModule = MeshBuilder.CreatePlane("player-left-module", {
      width: 0.16,
      height: 0.08,
    }, this.scene);
    leftModule.parent = avatar;
    leftModule.material = this.createFlatMaterial("player-left-module-material", PLAYER_WARN_COLOR, 0.92);
    leftModule.position.set(-1.15, 0.16, -0.06);

    const rightModule = leftModule.clone("player-right-module");
    rightModule.parent = avatar;
    rightModule.position.x = 1.15;

    const spine = MeshBuilder.CreatePlane("player-spine", {
      width: 0.08,
      height: 0.62,
    }, this.scene);
    spine.parent = avatar;
    spine.material = this.createFlatMaterial("player-spine-material", "#3c4b5c", 0.88);
    spine.position.set(0, -0.12, 0.01);

    return avatar;
  }

  private createPlayerSurface(): Surface {
    const halfWidth = this.getResponsivePlayerWidth() * 0.5;
    const surface: Surface = {
      id: "player-surface",
      kind: "player",
      a: new Vector2(-halfWidth, GAME_CONFIG.playerY),
      b: new Vector2(halfWidth, GAME_CONFIG.playerY),
      bounce: GAME_CONFIG.playerBounce,
      musical: true,
      transpose: 0,
      color: "#69f5d8",
    };

    this.updateSurfaceMesh(surface, 0.34);
    return surface;
  }

  private createSignalBallVisual(
    name: string,
    radius: number,
    outerMaterial: StandardMaterial,
    coreMaterial: StandardMaterial,
    variant: "default" | "solo" = "default",
  ): { outer: Mesh; core: Mesh } {
    const isSolo = variant === "solo";
    const outer = MeshBuilder.CreateTorus(`${name}-outer-ring`, {
      diameter: radius * 2,
      thickness: Math.max(0.04, radius * 0.11),
      tessellation: 40,
    }, this.scene);
    outer.rotation.x = Math.PI * 0.5;
    outer.material = outerMaterial;
    outer.visibility = SIGNAL_RING_ALPHA;

    const reticleRing = MeshBuilder.CreateTorus(`${name}-reticle-ring`, {
      diameter: radius * (isSolo ? 1.46 : 1.34),
      thickness: Math.max(0.02, radius * (isSolo ? 0.058 : 0.05)),
      tessellation: 32,
    }, this.scene);
    reticleRing.parent = outer;
    reticleRing.rotation.x = Math.PI * 0.5;
    reticleRing.position.z = 0.02;
    reticleRing.material = this.createFlatMaterial(`${name}-reticle-material`, outerMaterial.diffuseColor.toHexString(), 0.34);

    for (const [index, angle] of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5].entries()) {
      const tick = MeshBuilder.CreatePlane(`${name}-tick-${index}`, {
        width: radius * (isSolo ? 0.68 : 0.44),
        height: Math.max(0.02, radius * (isSolo ? 0.068 : 0.06)),
      }, this.scene);
      tick.parent = outer;
      tick.material = this.createFlatMaterial(`${name}-tick-material-${index}`, outerMaterial.diffuseColor.toHexString(), SIGNAL_TICK_ALPHA);
      tick.position.set(
        Math.cos(angle) * radius * (isSolo ? 1.22 : 1.08),
        Math.sin(angle) * radius * (isSolo ? 1.22 : 1.08),
        0.03,
      );
      tick.rotation.z = angle;
    }

    const core = MeshBuilder.CreateDisc(`${name}-core`, {
      radius: radius * 0.54,
      tessellation: 28,
    }, this.scene);
    core.material = coreMaterial;
    core.position.z = -0.06;

    const halo = MeshBuilder.CreateDisc(`${name}-halo`, {
      radius: radius * 0.88,
      tessellation: 28,
    }, this.scene);
    halo.parent = core;
    halo.material = this.createFlatMaterial(
      `${name}-halo-material`,
      coreMaterial.diffuseColor.toHexString(),
      isSolo ? 0.34 : SIGNAL_HALO_ALPHA,
    );
    halo.position.z = 0.03;

    const centerDot = MeshBuilder.CreateDisc(`${name}-center-dot`, {
      radius: radius * 0.18,
      tessellation: 20,
    }, this.scene);
    centerDot.parent = core;
    centerDot.material = this.createFlatMaterial(`${name}-center-dot-material`, "#f8fffd", 0.96);
    centerDot.position.z = -0.02;

    const leftCross = MeshBuilder.CreatePlane(`${name}-cross-left`, {
      width: radius * (isSolo ? 0.42 : 0.28),
      height: Math.max(0.018, radius * (isSolo ? 0.048 : 0.04)),
    }, this.scene);
    leftCross.parent = core;
    leftCross.material = this.createFlatMaterial(`${name}-cross-left-material`, coreMaterial.diffuseColor.toHexString(), isSolo ? 0.6 : 0.46);
    leftCross.position.set(-radius * (isSolo ? 1.08 : 0.82), 0, 0.02);

    const rightCross = leftCross.clone(`${name}-cross-right`);
    rightCross.parent = core;
    rightCross.position.x = radius * (isSolo ? 1.08 : 0.82);

    const topCross = MeshBuilder.CreatePlane(`${name}-cross-top`, {
      width: Math.max(0.018, radius * (isSolo ? 0.048 : 0.04)),
      height: radius * (isSolo ? 0.42 : 0.28),
    }, this.scene);
    topCross.parent = core;
    topCross.material = this.createFlatMaterial(`${name}-cross-top-material`, coreMaterial.diffuseColor.toHexString(), isSolo ? 0.6 : 0.46);
    topCross.position.set(0, radius * (isSolo ? 1.08 : 0.82), 0.02);

    const bottomCross = topCross.clone(`${name}-cross-bottom`);
    bottomCross.parent = core;
    bottomCross.position.y = -radius * (isSolo ? 1.08 : 0.82);

    if (isSolo) {
      const outerHaloRing = MeshBuilder.CreateTorus(`${name}-outer-halo-ring`, {
        diameter: radius * 3.02,
        thickness: Math.max(0.018, radius * 0.05),
        tessellation: 32,
      }, this.scene);
      outerHaloRing.parent = outer;
      outerHaloRing.rotation.x = Math.PI * 0.5;
      outerHaloRing.position.z = 0.015;
      outerHaloRing.material = this.createFlatMaterial(
        `${name}-outer-halo-ring-material`,
        outerMaterial.diffuseColor.toHexString(),
        0.22,
      );

      for (const [index, angle] of [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75].entries()) {
        const blade = MeshBuilder.CreatePlane(`${name}-blade-${index}`, {
          width: radius * 0.82,
          height: Math.max(0.018, radius * 0.06),
        }, this.scene);
        blade.parent = outer;
        blade.material = this.createFlatMaterial(
          `${name}-blade-material-${index}`,
          outerMaterial.diffuseColor.toHexString(),
          0.76,
        );
        blade.position.set(
          Math.cos(angle) * radius * 1.52,
          Math.sin(angle) * radius * 1.52,
          0.035,
        );
        blade.rotation.z = angle;
      }

      const coreDiamond = MeshBuilder.CreatePlane(`${name}-core-diamond`, {
        width: radius * 0.62,
        height: radius * 0.62,
      }, this.scene);
      coreDiamond.parent = core;
      coreDiamond.material = this.createFlatMaterial(
        `${name}-core-diamond-material`,
        "#fff8ec",
        0.42,
      );
      coreDiamond.rotation.z = Math.PI * 0.25;
      coreDiamond.position.z = -0.01;
    }

    outer.metadata = {
      tintMaterials: [outerMaterial, reticleRing.material, ...outer.getChildMeshes().map((child) => child.material).filter((material): material is StandardMaterial => material instanceof StandardMaterial)],
    };
    core.metadata = {
      tintMaterials: [coreMaterial, halo.material, leftCross.material, rightCross.material, topCross.material, bottomCross.material].filter(
        (material): material is StandardMaterial => material instanceof StandardMaterial,
      ),
    };

    return { outer, core };
  }

  private acquireBallVisual(variant: "default" | "solo"): { outer: Mesh; core: Mesh } {
    let pooled = this.ballVisualPool.find((candidate) => !candidate.active && candidate.variant === variant);

    if (!pooled) {
      const created = this.createSignalBallVisual(
        `pooled-object-${this.ballVisualPool.length}`,
        1,
        this.createFlatMaterial(`pooled-${this.ballVisualPool.length}-outer`, "#ffffff", 1),
        this.createFlatMaterial(`pooled-${this.ballVisualPool.length}-core`, "#f2f8ff", 1),
        variant,
      );
      pooled = {
        outer: created.outer,
        core: created.core,
        variant,
        active: false,
      };
      pooled.outer.setEnabled(false);
      pooled.core.setEnabled(false);
      this.ballVisualPool.push(pooled);
    }

    pooled.active = true;
    return { outer: pooled.outer, core: pooled.core };
  }

  private releaseBallVisual(outer: Mesh, core: Mesh): void {
    const pooled = this.ballVisualPool.find((candidate) => candidate.outer === outer && candidate.core === core);
    if (!pooled) {
      outer.dispose();
      core.dispose();
      return;
    }

    pooled.active = false;
    pooled.outer.setEnabled(false);
    pooled.core.setEnabled(false);
  }

  private syncSoloLinks(interpolationAlpha: number): void {
    const soloObjects = this.objects.filter((object) => object.type === "solo");
    if (soloObjects.length < 2) {
      this.hideSoloLinks();
      return;
    }

    const renderPositions = soloObjects
      .map((object) => ({
        x: object.previousPosition.x + (object.position.x - object.previousPosition.x) * interpolationAlpha,
        y: object.previousPosition.y + (object.position.y - object.previousPosition.y) * interpolationAlpha,
      }))
      .sort((a, b) => a.x - b.x);

    let linkIndex = 0;
    for (let startIndex = 0; startIndex < renderPositions.length - 1; startIndex += 1) {
      for (let endIndex = startIndex + 1; endIndex < renderPositions.length; endIndex += 1) {
        const link = this.acquireSoloLink(linkIndex);
        this.updateSoloLink(link, renderPositions[startIndex], renderPositions[endIndex], linkIndex);
        linkIndex += 1;
      }
    }

    for (let index = linkIndex; index < this.soloLinkPool.length; index += 1) {
      const link = this.soloLinkPool[index];
      link.active = false;
      link.segments.forEach((segment) => segment.setEnabled(false));
    }
  }

  private hideSoloLinks(): void {
    for (const link of this.soloLinkPool) {
      if (!link.active) {
        continue;
      }
      link.active = false;
      link.segments.forEach((segment) => segment.setEnabled(false));
    }
  }

  private acquireSoloLink(index: number): SoloLinkEffect {
    let link = this.soloLinkPool[index];
    if (link) {
      link.active = true;
      return link;
    }

    const segments: Mesh[] = [];
    const materials: StandardMaterial[] = [];
    for (let segmentIndex = 0; segmentIndex < 5; segmentIndex += 1) {
      const segment = MeshBuilder.CreatePlane(`solo-link-${index}-${segmentIndex}`, {
        width: 1,
        height: 1,
      }, this.scene);
      const material = this.createFlatMaterial(
        `solo-link-${index}-${segmentIndex}-material`,
        segmentIndex % 2 === 0 ? "#ffd27c" : "#fff6cc",
        0.7,
      );
      segment.material = material;
      segment.position.z = 0.18 - segmentIndex * 0.002;
      segment.setEnabled(false);
      segments.push(segment);
      materials.push(material);
    }

    link = {
      active: true,
      segments,
      materials,
    };
    this.soloLinkPool.push(link);
    return link;
  }

  private updateSoloLink(
    link: SoloLinkEffect,
    start: { x: number; y: number },
    end: { x: number; y: number },
    linkIndex: number,
  ): void {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length < 0.3) {
      link.segments.forEach((segment) => segment.setEnabled(false));
      return;
    }

    const normalX = -(deltaY / length);
    const normalY = deltaX / length;
    const pulse = 0.72 + Math.sin(this.backdropTime * 8.4 + linkIndex * 0.9) * 0.18 + this.backdropBeatPulse * 0.12;
    const amplitude = Math.min(0.28 + this.backdropBeatPulse * 0.18, length * 0.14);
    const segmentCount = link.segments.length;

    let currentX = start.x;
    let currentY = start.y;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const progress = segmentIndex / segmentCount;
      const nextProgress = (segmentIndex + 1) / segmentCount;
      const baseEndX = start.x + deltaX * nextProgress;
      const baseEndY = start.y + deltaY * nextProgress;
      const offsetDirection = segmentIndex % 2 === 0 ? 1 : -1;
      const wobble = Math.sin(this.backdropTime * 13.5 + linkIndex * 1.7 + segmentIndex * 0.8);
      const offset =
        segmentIndex === segmentCount - 1
          ? 0
          : amplitude * offsetDirection * (0.72 + this.backdropBeatPulse * 0.3) * wobble;
      const nextX = segmentIndex === segmentCount - 1 ? end.x : baseEndX + normalX * offset;
      const nextY = segmentIndex === segmentCount - 1 ? end.y : baseEndY + normalY * offset;
      const segmentDeltaX = nextX - currentX;
      const segmentDeltaY = nextY - currentY;
      const segmentLength = Math.hypot(segmentDeltaX, segmentDeltaY);
      const midpointX = (currentX + nextX) * 0.5;
      const midpointY = (currentY + nextY) * 0.5;
      const segment = link.segments[segmentIndex];
      const material = link.materials[segmentIndex];

      segment.setEnabled(true);
      segment.position.set(midpointX, midpointY, 0.16 - progress * 0.01);
      segment.rotation.z = Math.atan2(segmentDeltaY, segmentDeltaX);
      segment.scaling.set(segmentLength * 1.06, 0.06 + pulse * 0.028 + progress * 0.01, 1);
      material.alpha = clamp((0.3 + pulse * 0.42) * (1 - progress * 0.1), 0.22, 0.82);
      material.emissiveColor = hex(segmentIndex % 2 === 0 ? "#ffb347" : "#fff7d1").scale(0.12 + pulse * 0.14);

      currentX = nextX;
      currentY = nextY;
    }

    link.active = true;
  }

  private rebuildBaseSurfaces(): void {
    for (const surface of this.baseSurfaces) {
      surface.mesh?.dispose();
    }

    const leftWallX = this.bounds.left + 0.9;
    const rightWallX = this.bounds.right - 0.9;
    const wallTop = this.bounds.top - 0.9;
    const wallBottom = this.bounds.bottom + 0.9;
    const arenaWidth = this.bounds.right - this.bounds.left;
    const slopeInset = clamp(arenaWidth * 0.085, 0.72, 1.85);
    const slopeLength = clamp(arenaWidth * 0.12, 0.95, 3.1);
    const slopeRise = clamp(slopeLength * 0.24, 0.28, 0.82);
    const slopeTopY = GAME_CONFIG.playerY - clamp(arenaWidth * 0.015 + 0.42, 0.48, 0.78);
    const slopeBottomY = slopeTopY - slopeRise;

    const leftWall: Surface = {
      id: "left-wall",
      kind: "wall",
      a: new Vector2(leftWallX, wallTop),
      b: new Vector2(leftWallX, wallBottom),
      bounce: GAME_CONFIG.wallBounce,
      musical: false,
      transpose: 0,
      color: "#1d4566",
      mesh: this.createSurfaceMesh("left-wall", "#1d4566", "wall"),
    };

    const rightWall: Surface = {
      id: "right-wall",
      kind: "wall",
      a: new Vector2(rightWallX, wallBottom),
      b: new Vector2(rightWallX, wallTop),
      bounce: GAME_CONFIG.wallBounce,
      musical: false,
      transpose: 0,
      color: "#1d4566",
      mesh: this.createSurfaceMesh("right-wall", "#1d4566", "wall"),
    };

    const leftSlope: Surface = {
      id: "left-slope",
      kind: "slope",
      a: new Vector2(leftWallX + slopeInset, slopeBottomY),
      b: new Vector2(leftWallX + slopeInset + slopeLength, slopeTopY),
      bounce: GAME_CONFIG.slopeBounce,
      musical: true,
      transpose: 5,
      color: "#3e6b92",
      mesh: this.createSurfaceMesh("left-slope", "#3e6b92", "slope"),
    };

    const rightSlope: Surface = {
      id: "right-slope",
      kind: "slope",
      a: new Vector2(rightWallX - slopeInset - slopeLength, slopeTopY),
      b: new Vector2(rightWallX - slopeInset, slopeBottomY),
      bounce: GAME_CONFIG.slopeBounce,
      musical: true,
      transpose: 7,
      color: "#3e6b92",
      mesh: this.createSurfaceMesh("right-slope", "#3e6b92", "slope"),
    };

    this.baseSurfaces = [leftWall, rightWall, leftSlope, rightSlope];

    this.baseSurfaces.forEach((surface) => {
      this.updateSurfaceMesh(surface, surface.kind === "wall" ? 0.26 : 0.24);
    });
  }

  private resolveSurfaceCollision(
    object: MusicalObject,
    previousPosition: Vector2,
    surface: Surface,
    onImpact: (object: MusicalObject, surface: Surface, x: number, y: number, impact: number) => void,
  ): void {
    const overlap = this.getSurfaceOverlap(object.position, object.radius, surface);
    const sweptHit = overlap ?? this.getSweptSurfaceHit(previousPosition, object.position, object.radius, surface);

    if (!sweptHit) {
      return;
    }

    const penetration = object.radius - sweptHit.distance + 0.001;
    object.position.x = sweptHit.positionX + sweptHit.normalX * penetration;
    object.position.y = sweptHit.positionY + sweptHit.normalY * penetration;

    const velocityAlongNormal = object.velocity.x * sweptHit.normalX + object.velocity.y * sweptHit.normalY;

    if (velocityAlongNormal >= 0) {
      return;
    }

    const tangentX = -sweptHit.normalY;
    const tangentY = sweptHit.normalX;
    const tangentVelocity = object.velocity.x * tangentX + object.velocity.y * tangentY;
    const restitution =
      object.type === "mega"
        ? Math.min(1.08, object.bounce * surface.bounce + 0.1)
        : Math.min(0.98, object.bounce * surface.bounce);
    object.velocity.x -= sweptHit.normalX * ((1 + restitution) * velocityAlongNormal);
    object.velocity.y -= sweptHit.normalY * ((1 + restitution) * velocityAlongNormal);
    object.velocity.x -= tangentX * (tangentVelocity * 0.025);
    object.velocity.y -= tangentY * (tangentVelocity * 0.025);

    const impact = -velocityAlongNormal;
    if (surface.musical && object.cooldown <= 0 && impact >= GAME_CONFIG.surfaceCollisionThreshold) {
      object.cooldown = OBJECT_DEFINITIONS[object.type].cooldown;
      object.pulse = Math.min(1, object.pulse + impact * 0.045);
      this.createPulse(sweptHit.closestX, sweptHit.closestY, object.color, impact);
      onImpact(object, surface, sweptHit.closestX, sweptHit.closestY, impact);
    }
  }

  private getSurfaceOverlap(
    position: Vector2,
    radius: number,
    surface: Surface,
  ): SurfaceHit | null {
    const segmentX = surface.b.x - surface.a.x;
    const segmentY = surface.b.y - surface.a.y;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

    let closestX = surface.a.x;
    let closestY = surface.a.y;

    if (segmentLengthSquared > 0) {
      const pointOffsetX = position.x - surface.a.x;
      const pointOffsetY = position.y - surface.a.y;
      const t = clamp(
        (pointOffsetX * segmentX + pointOffsetY * segmentY) / segmentLengthSquared,
        0,
        1,
      );
      closestX = surface.a.x + segmentX * t;
      closestY = surface.a.y + segmentY * t;
    }

    const deltaX = position.x - closestX;
    const deltaY = position.y - closestY;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance >= radius) {
      return null;
    }

    let normalX: number;
    let normalY: number;

    if (distance > 0.0001) {
      const inverseDistance = 1 / distance;
      normalX = deltaX * inverseDistance;
      normalY = deltaY * inverseDistance;
    } else {
      const surfaceDeltaX = surface.b.x - surface.a.x;
      const surfaceDeltaY = surface.b.y - surface.a.y;
      const surfaceLength = Math.hypot(surfaceDeltaX, surfaceDeltaY) || 1;
      normalX = -surfaceDeltaY / surfaceLength;
      normalY = surfaceDeltaX / surfaceLength;
    }

    return {
      positionX: position.x,
      positionY: position.y,
      closestX,
      closestY,
      normalX,
      normalY,
      distance,
    };
  }

  private getSweptSurfaceHit(
    previousPosition: Vector2,
    currentPosition: Vector2,
    radius: number,
    surface: Surface,
  ): SurfaceHit | null {
    const lineCrossingHit = this.getLineCrossingHit(previousPosition, currentPosition, radius, surface);

    if (lineCrossingHit) {
      return lineCrossingHit;
    }

    const travelDistance = Vector2.Distance(previousPosition, currentPosition);

    if (travelDistance <= 0.0001) {
      return null;
    }

    const sampleCount = Math.max(4, Math.min(18, Math.ceil(travelDistance / Math.max(radius * 0.55, 0.12))));
    let lowT = 0;
    let highT = 0;
    let foundHit = false;

    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      const sampleT = sampleIndex / sampleCount;
      const samplePosition = this.previousPositionScratch;
      samplePosition.x = previousPosition.x + (currentPosition.x - previousPosition.x) * sampleT;
      samplePosition.y = previousPosition.y + (currentPosition.y - previousPosition.y) * sampleT;
      const overlap = this.getSurfaceOverlap(samplePosition, radius, surface);

      if (overlap) {
        lowT = (sampleIndex - 1) / sampleCount;
        highT = sampleT;
        foundHit = true;
        break;
      }
    }

    if (!foundHit) {
      return null;
    }

    for (let iteration = 0; iteration < 7; iteration += 1) {
      const midT = (lowT + highT) * 0.5;
      const midPosition = this.previousPositionScratch;
      midPosition.x = previousPosition.x + (currentPosition.x - previousPosition.x) * midT;
      midPosition.y = previousPosition.y + (currentPosition.y - previousPosition.y) * midT;
      const overlap = this.getSurfaceOverlap(midPosition, radius, surface);

      if (overlap) {
        highT = midT;
      } else {
        lowT = midT;
      }
    }

    this.previousPositionScratch.x = previousPosition.x + (currentPosition.x - previousPosition.x) * highT;
    this.previousPositionScratch.y = previousPosition.y + (currentPosition.y - previousPosition.y) * highT;
    return this.getSurfaceOverlap(this.previousPositionScratch, radius, surface);
  }

  private getLineCrossingHit(
    previousPosition: Vector2,
    currentPosition: Vector2,
    radius: number,
    surface: Surface,
  ): SurfaceHit | null {
    const surfaceDeltaX = surface.b.x - surface.a.x;
    const surfaceDeltaY = surface.b.y - surface.a.y;
    const surfaceLength = Math.hypot(surfaceDeltaX, surfaceDeltaY) || 1;
    const normalX = -surfaceDeltaY / surfaceLength;
    const normalY = surfaceDeltaX / surfaceLength;
    const previousDistance =
      (previousPosition.x - surface.a.x) * normalX + (previousPosition.y - surface.a.y) * normalY;
    const currentDistance =
      (currentPosition.x - surface.a.x) * normalX + (currentPosition.y - surface.a.y) * normalY;

    if (previousDistance <= radius || currentDistance > radius) {
      return null;
    }

    const distanceDelta = previousDistance - currentDistance;

    if (distanceDelta <= 0.0001) {
      return null;
    }

    const hitT = clamp((previousDistance - radius) / distanceDelta, 0, 1);
    const hitPositionX = previousPosition.x + (currentPosition.x - previousPosition.x) * hitT;
    const hitPositionY = previousPosition.y + (currentPosition.y - previousPosition.y) * hitT;
    const closestX = hitPositionX - normalX * radius;
    const closestY = hitPositionY - normalY * radius;
    const projectedDistance =
      ((closestX - surface.a.x) * surfaceDeltaX + (closestY - surface.a.y) * surfaceDeltaY) / surfaceLength;
    const segmentLength = surfaceLength;

    if (projectedDistance < -radius || projectedDistance > segmentLength + radius) {
      return null;
    }

    return {
      positionX: hitPositionX,
      positionY: hitPositionY,
      closestX,
      closestY,
      normalX,
      normalY,
      distance: radius,
    };
  }

  private resolveObjectCollisions(
    onPairImpact: (
      source: MusicalObject,
      other: MusicalObject,
      x: number,
      y: number,
      impact: number,
    ) => void,
  ): void {
    for (let i = 0; i < this.objects.length; i += 1) {
      const a = this.objects[i];

      for (let j = i + 1; j < this.objects.length; j += 1) {
        const b = this.objects[j];
        const deltaX = b.position.x - a.position.x;
        const deltaY = b.position.y - a.position.y;
        const distance = Math.hypot(deltaX, deltaY);
        const minDistance = a.radius + b.radius;

        if (distance >= minDistance) {
          continue;
        }

        const normalX = distance > 0.0001 ? deltaX / distance : 1;
        const normalY = distance > 0.0001 ? deltaY / distance : 0;
        const penetration = minDistance - distance + 0.0005;
        const correctionX = normalX * penetration * 0.5;
        const correctionY = normalY * penetration * 0.5;
        a.position.x -= correctionX;
        a.position.y -= correctionY;
        b.position.x += correctionX;
        b.position.y += correctionY;

        const relativeVelocityX = b.velocity.x - a.velocity.x;
        const relativeVelocityY = b.velocity.y - a.velocity.y;
        const speedAlongNormal = relativeVelocityX * normalX + relativeVelocityY * normalY;

        if (speedAlongNormal >= 0) {
          continue;
        }

        const restitution =
          a.type === "mega" || b.type === "mega"
            ? Math.min(1.02, Math.max(a.bounce, b.bounce) * 0.94)
            : Math.min(a.bounce, b.bounce) * 0.86;
        const impulse =
          (-(1 + restitution) * speedAlongNormal) / ((1 / a.mass) + (1 / b.mass));
        const impulseX = normalX * impulse;
        const impulseY = normalY * impulse;
        a.velocity.x -= impulseX / a.mass;
        a.velocity.y -= impulseY / a.mass;
        b.velocity.x += impulseX / b.mass;
        b.velocity.y += impulseY / b.mass;

        const impact = -speedAlongNormal;
        const source = a.noteRange[1] >= b.noteRange[1] ? a : b;
        const other = source.id === a.id ? b : a;

        if (impact >= GAME_CONFIG.objectCollisionThreshold && source.cooldown <= 0) {
          source.cooldown = Math.max(source.cooldown, 0.08);
          source.pulse = Math.min(1, source.pulse + impact * 0.04);
          const centerX = (a.position.x + b.position.x) * 0.5;
          const centerY = (a.position.y + b.position.y) * 0.5;
          this.createPulse(centerX, centerY, source.color, impact * 0.75);
          onPairImpact(source, other, centerX, centerY, impact * 0.7);
        }
      }
    }
  }

  private createSurfaceMesh(name: string, color: string, kind: SurfaceKind): Mesh {
    const root = MeshBuilder.CreatePlane(`${name}-mesh`, { width: 1, height: 1 }, this.scene);
    root.material = this.createFlatMaterial(`${name}-root-material`, color, 0.03);
    root.position.z = 0.2;

    const housing = MeshBuilder.CreatePlane(`${name}-housing`, { width: 1, height: 1 }, this.scene);
    housing.parent = root;
    housing.position.z = -0.02;
    housing.scaling.set(kind === "wall" ? 1.02 : 1.01, kind === "wall" ? 0.86 : 0.82, 1);
    housing.material = this.createFlatMaterial(`${name}-housing-material`, PLAYFIELD_RAIL_DIM, 0.34);

    const glowAura = MeshBuilder.CreatePlane(`${name}-glow`, { width: 1, height: 1 }, this.scene);
    glowAura.parent = root;
    glowAura.position.z = 0.01;
    glowAura.scaling.set(kind === "wall" ? 1.0 : 0.98, kind === "wall" ? 0.22 : 0.26, 1);
    glowAura.material = this.createFlatMaterial(`${name}-glow-material`, PLAYFIELD_GUIDE_COLOR, 0.18);

    const beam = MeshBuilder.CreatePlane(`${name}-beam`, { width: 1, height: 1 }, this.scene);
    beam.parent = root;
    beam.position.z = 0.02;
    beam.scaling.set(kind === "wall" ? 0.98 : 0.96, kind === "wall" ? 0.06 : 0.08, 1);
    beam.material = this.createFlatMaterial(
      `${name}-beam-material`,
      kind === "wall" ? PLAYFIELD_RAIL_COLOR : BUMPER_CORE_COLOR,
      0.9,
    );

    const spine = MeshBuilder.CreatePlane(`${name}-spine`, { width: 1, height: 1 }, this.scene);
    spine.parent = root;
    spine.position.z = 0.015;
    spine.scaling.set(kind === "wall" ? 0.96 : 0.9, kind === "wall" ? 0.12 : 0.16, 1);
    spine.material = this.createFlatMaterial(
      `${name}-spine-material`,
      kind === "wall" ? "#0f1e29" : BUMPER_DIM_COLOR,
      0.82,
    );

    const lowerAssembly = MeshBuilder.CreatePlane(`${name}-lower-assembly`, { width: 1, height: 1 }, this.scene);
    lowerAssembly.parent = root;
    lowerAssembly.position.set(-0.39, 0, 0.03);
    lowerAssembly.scaling.set(kind === "wall" ? 0.18 : 0.22, kind === "wall" ? 0.42 : 0.48, 1);
    lowerAssembly.material = this.createFlatMaterial(`${name}-lower-assembly-material`, "#10202b", 0.9);

    const lowerGlow = MeshBuilder.CreatePlane(`${name}-lower-glow`, { width: 1, height: 1 }, this.scene);
    lowerGlow.parent = root;
    lowerGlow.position.set(-0.39, 0, 0.04);
    lowerGlow.scaling.set(kind === "wall" ? 0.06 : 0.08, kind === "wall" ? 0.3 : 0.34, 1);
    lowerGlow.material = this.createFlatMaterial(
      `${name}-lower-glow-material`,
      kind === "wall" ? PLAYFIELD_RAIL_COLOR : BUMPER_CORE_COLOR,
      0.84,
    );

    const warnPlate = MeshBuilder.CreatePlane(`${name}-warn-plate`, { width: 1, height: 1 }, this.scene);
    warnPlate.parent = root;
    warnPlate.position.set(-0.31, kind === "wall" ? 0.13 : 0.15, 0.035);
    warnPlate.scaling.set(0.12, 0.08, 1);
    warnPlate.material = this.createFlatMaterial(`${name}-warn-plate-material`, PLAYFIELD_WARN_COLOR, 0.95);

    const accentLeft = MeshBuilder.CreatePlane(`${name}-accent-left`, { width: 1, height: 1 }, this.scene);
    accentLeft.parent = root;
    accentLeft.position.set(-0.27, kind === "wall" ? -0.12 : -0.15, 0.035);
    accentLeft.scaling.set(0.16, 0.02, 1);
    accentLeft.material = this.createFlatMaterial(`${name}-accent-left-material`, "#d5fbff", 0.66);

    const accentRight = MeshBuilder.CreatePlane(`${name}-accent-right`, { width: 1, height: 1 }, this.scene);
    accentRight.parent = root;
    accentRight.position.set(-0.18, kind === "wall" ? -0.18 : -0.2, 0.035);
    accentRight.scaling.set(0.22, 0.018, 1);
    accentRight.material = this.createFlatMaterial(`${name}-accent-right-material`, PLAYFIELD_GUIDE_COLOR, 0.54);

    return root;
  }

  private updateSurfaceMesh(surface: Surface, thickness: number): void {
    const mesh = surface.mesh;

    if (!mesh) {
      return;
    }

    const deltaX = surface.b.x - surface.a.x;
    const deltaY = surface.b.y - surface.a.y;
    const length = Math.hypot(deltaX, deltaY);
    const midpointX = (surface.a.x + surface.b.x) * 0.5;
    const midpointY = (surface.a.y + surface.b.y) * 0.5;

    mesh.position.set(midpointX, midpointY, 0.2);
    mesh.scaling.set(length, thickness, 1);
    mesh.rotation.z = Math.atan2(deltaY, deltaX);
  }

  private createPulse(x: number, y: number, color: string, impact: number): void {
    this.activatePulseEffect(
      x,
      y,
      color,
      0.34,
      0.42 + impact * 0.02,
      30,
      1,
      2.8,
      0.48,
      0,
      0.34,
    );
  }

  private createMegaTrail(x: number, y: number, color: string): void {
    this.activatePulseEffect(
      x,
      y,
      color,
      0.12,
      0.2,
      22,
      1,
      1.85,
      0.24,
      0,
      0.26,
    );
  }

  private activatePulseEffect(
    x: number,
    y: number,
    color: string,
    z: number,
    radius: number,
    tessellation: number,
    startScale: number,
    endScale: number,
    startAlpha: number,
    endAlpha: number,
    lifetime: number,
  ): void {
    let pulse = this.pulses.find((candidate) => !candidate.active);

    if (!pulse) {
      const mesh = MeshBuilder.CreateDisc(`pulse-${this.pulses.length}`, {
        radius: 1,
        tessellation,
      }, this.scene);
      const material = this.createFlatMaterial(`pulse-material-${this.pulses.length}`, color, startAlpha);
      mesh.material = material;
      pulse = {
        active: false,
        mesh,
        material,
        baseRadius: radius,
        age: 0,
        lifetime,
        startScale,
        endScale,
        startAlpha,
        endAlpha,
      };
      this.pulses.push(pulse);
    }

    pulse.active = true;
    pulse.age = 0;
    pulse.baseRadius = radius;
    pulse.lifetime = lifetime;
    pulse.startScale = startScale;
    pulse.endScale = endScale;
    pulse.startAlpha = startAlpha;
    pulse.endAlpha = endAlpha;
    pulse.material.diffuseColor = hex(color);
    pulse.material.emissiveColor = hex(color).scale(0.08);
    pulse.material.alpha = startAlpha;
    pulse.mesh.scaling.setAll(radius * startScale);
    pulse.mesh.position.set(x, y, z);
    pulse.mesh.setEnabled(true);
  }

  private updateMegaAppearance(object: MusicalObject): void {
    const color = this.getMegaPaletteColor(object.age);
    const nextColor = this.getMegaPaletteColor(object.age + 0.08);
    object.color = color;
    object.glowColor = nextColor;
    this.tintMeshMaterials(object.mesh, color);
    this.tintMeshMaterials(object.coreMesh, nextColor);
  }

  private getMegaPaletteColor(age: number): string {
    const paletteIndex = Math.floor(age * 18) % MEGA_COLORS.length;
    return MEGA_COLORS[(paletteIndex + MEGA_COLORS.length) % MEGA_COLORS.length];
  }

  private getResponsivePlayerWidth(): number {
    if (window.matchMedia("(pointer: coarse)").matches) {
      return GAME_CONFIG.playerWidth * 0.88;
    }
    return GAME_CONFIG.playerWidth;
  }

  private getResponsiveWorldHalfWidth(halfHeight: number, aspect: number): number {
    const baseHalfWidth = halfHeight * aspect;
    if (window.matchMedia("(pointer: coarse)").matches) {
      return Math.max(baseHalfWidth, 5.5);
    }
    return baseHalfWidth;
  }

  private getResponsiveObjectScale(): number {
    const arenaWidth = this.bounds.right - this.bounds.left;
    return clamp(arenaWidth / 18, 0.56, 1);
  }

  private createFlatMaterial(name: string, color: string, alpha = 1): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = hex(color);
    material.emissiveColor = hex(color);
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.alpha = alpha;
    return material;
  }

  private tintMeshMaterials(mesh: Mesh, color: string): void {
    const materials = this.getTintMaterials(mesh);
    const tint = hex(color);
    for (const material of materials) {
      material.diffuseColor = tint;
      material.emissiveColor = tint;
    }
  }

  private getTintMaterials(mesh: Mesh): StandardMaterial[] {
    const metadata = mesh.metadata as { tintMaterials?: StandardMaterial[] } | undefined;
    if (metadata?.tintMaterials?.length) {
      return metadata.tintMaterials;
    }

    return mesh.material instanceof StandardMaterial ? [mesh.material] : [];
  }
}
