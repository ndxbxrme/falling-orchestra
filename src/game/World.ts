import { Camera } from "@babylonjs/core/Cameras/camera";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { GAME_CONFIG, OBJECT_DEFINITIONS } from "./config";
import type { ArenaBounds, MusicalObject, ObjectType, Surface } from "./types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const closestPointOnSegment = (point: Vector2, a: Vector2, b: Vector2): Vector2 => {
  const segment = b.subtract(a);
  const segmentLengthSquared = segment.lengthSquared();

  if (segmentLengthSquared === 0) {
    return a.clone();
  }

  const t = clamp(Vector2.Dot(point.subtract(a), segment) / segmentLengthSquared, 0, 1);
  return a.add(segment.scale(t));
};

const segmentNormal = (a: Vector2, b: Vector2): Vector2 => {
  const delta = b.subtract(a);
  return new Vector2(-delta.y, delta.x).normalize();
};

const segmentDirection = (a: Vector2, b: Vector2): Vector2 => b.subtract(a).normalize();

const lerpVector2 = (a: Vector2, b: Vector2, t: number): Vector2 =>
  a.scale(1 - t).add(b.scale(t));

const hex = (value: string): Color3 => Color3.FromHexString(value);

interface PulseEffect {
  mesh: Mesh;
  material: StandardMaterial;
  age: number;
  lifetime: number;
  startScale: number;
  endScale: number;
  startAlpha: number;
  endAlpha: number;
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

const BACKDROP_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;

varying vec2 vUV;

void main(void) {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const BACKDROP_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUV;

uniform float iTime;
uniform float beatPulse;
uniform float grooveIntensity;
uniform vec2 resolution;
uniform vec2 scrollDirection;
uniform vec2 scrollOffset;

mat2 rot(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

float waveField(vec2 p, float time) {
  float layerA = sin(p.x * 2.0 + time * 0.22);
  float layerB = sin(p.y * 3.3 - time * 0.18 + layerA * 0.9);
  float layerC = sin((p.x + p.y) * 2.6 + time * 0.12 + layerB * 0.8);
  float layerD = sin(length(p * vec2(1.1, 0.8)) * 4.2 - time * 0.16);
  return layerA * 0.28 + layerB * 0.26 + layerC * 0.24 + layerD * 0.22;
}

void main(void) {
  vec2 uv = vUV * 2.0 - 1.0;
  uv.x *= resolution.x / max(resolution.y, 1.0);
  vec2 normalizedDirection = normalize(scrollDirection + vec2(0.0001, 0.0001));
  float pulseWarp = beatPulse * (0.012 + grooveIntensity * 0.012);
  vec2 flowUv = uv + scrollOffset * 2.6;
  flowUv += vec2(-normalizedDirection.y, normalizedDirection.x) * sin(iTime * 0.18) * 0.06;
  flowUv += normalize(uv + vec2(0.0001, 0.0001)) * pulseWarp;
  vec2 detailUv = rot(0.75) * flowUv * 1.35;
  vec2 wideUv = rot(-0.45) * flowUv * 0.72;

  float radial = length(uv);
  float flow = waveField(wideUv, iTime) * 0.65 + waveField(detailUv, iTime + 12.0) * 0.35;
  float bloom = smoothstep(1.35, 0.08, radial);
  float centerGlow = smoothstep(0.95, 0.0, radial) * beatPulse;
  float pulseRipple = (1.0 - smoothstep(0.18, 0.95, radial)) * beatPulse;
  float pulseAmount = beatPulse * (0.18 + grooveIntensity * 0.22);
  float softBands = smoothstep(-0.55, 0.75, flow);
  float mist = smoothstep(-0.15, 0.95, flow + 0.18);

  vec3 base = vec3(0.03, 0.09, 0.14);
  vec3 tide = vec3(0.06, 0.25, 0.34) * (0.14 + softBands * 0.3) * (0.75 + grooveIntensity * 0.42);
  vec3 mistGlow = vec3(0.10, 0.34, 0.36) * mist * (0.18 + grooveIntensity * 0.1);
  vec3 glow = vec3(0.98, 0.81, 0.44) * centerGlow * (0.04 + pulseAmount * 0.85);
  vec3 ripple = vec3(0.42, 0.88, 0.84) * pulseRipple * (0.02 + pulseAmount * 0.4);
  vec3 center = vec3(0.10, 0.45, 0.48) * bloom * (0.1 + grooveIntensity * 0.1 + beatPulse * 0.08);

  vec3 color = base + tide * bloom + mistGlow * bloom + center + glow + ripple;
  color *= 1.0 - smoothstep(0.75, 1.38, radial) * 0.65;

  gl_FragColor = vec4(color, 1.0);
}
`;

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
  private nextObjectId = 0;
  private objectMaterials = new Map<ObjectType, { outer: StandardMaterial; inner: StandardMaterial }>();
  private playerMaterial: StandardMaterial;
  private playerCoreMaterial: StandardMaterial;
  private playerMesh: Mesh;
  private playerSurface: Surface;
  private backdropPlane?: Mesh;
  private backdropMaterial?: ShaderMaterial;
  private backdropTime = 0;
  private backdropBeatPulse = 0;
  private backdropGrooveIntensity = 0;
  private backdropScrollDirection = new Vector2(0.78, -0.24);
  private backdropTargetScrollDirection = new Vector2(0.78, -0.24);
  private backdropScrollOffset = new Vector2(0, 0);
  private playerWidth: number = GAME_CONFIG.playerWidth;
  private playerX = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.03, 0.09, 0.14, 1);

    this.camera = new FreeCamera("camera", new Vector3(0, 0, -18), this.scene);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.setTarget(Vector3.Zero());

    this.playerMaterial = this.createFlatMaterial("player-material", "#69f5d8");
    this.playerCoreMaterial = this.createFlatMaterial("player-core", "#d7fff6");

    for (const definition of Object.values(OBJECT_DEFINITIONS)) {
      this.objectMaterials.set(definition.type, {
        outer: this.createFlatMaterial(`${definition.type}-outer`, definition.color),
        inner: this.createFlatMaterial(`${definition.type}-inner`, definition.glowColor),
      });
    }

    this.createBackdrop();
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
    const sidePadding = Math.max(halfWidth + 0.7, 1.55);
    return clamp(x, this.bounds.left + sidePadding, this.bounds.right - sidePadding);
  }

  render(): void {
    if (this.backdropMaterial) {
      const deltaSeconds = this.engine.getDeltaTime() * 0.001;
      const smoothing = Math.min(1, deltaSeconds * 2.2);
      const scrollSpeed = 0.045 + this.backdropGrooveIntensity * 0.035;
      this.backdropTime += deltaSeconds;
      this.backdropScrollDirection = this.backdropScrollDirection.scale(1 - smoothing).add(
        this.backdropTargetScrollDirection.scale(smoothing),
      );
      this.backdropScrollOffset.addInPlace(
        this.backdropScrollDirection.scale(deltaSeconds * scrollSpeed),
      );
      this.backdropMaterial.setFloat("iTime", this.backdropTime);
      this.backdropMaterial.setFloat("beatPulse", this.backdropBeatPulse);
      this.backdropMaterial.setFloat("grooveIntensity", this.backdropGrooveIntensity);
      this.backdropMaterial.setVector2("scrollDirection", this.backdropScrollDirection);
      this.backdropMaterial.setVector2("scrollOffset", this.backdropScrollOffset);
    }

    this.scene.render();
  }

  resize(): void {
    this.engine.resize();

    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    const aspect = width / Math.max(height, 1);
    const halfHeight = GAME_CONFIG.worldHalfHeight;
    const halfWidth = halfHeight * aspect;

    this.bounds = {
      left: -halfWidth,
      right: halfWidth,
      top: halfHeight,
      bottom: -halfHeight,
      floorY: -halfHeight + 1.4,
    };

    this.applyCameraFrame();
    this.resizeBackdrop();

    this.rebuildBaseSurfaces();
    this.setPlayerX(this.playerX);
  }

  dispose(): void {
    for (const object of this.objects) {
      object.mesh.dispose();
      object.coreMesh.dispose();
    }

    for (const surface of this.baseSurfaces) {
      surface.mesh?.dispose();
    }

    this.playerMesh.dispose();
    this.playerSurface.mesh?.dispose();
    this.pulses.forEach((pulse) => pulse.mesh.dispose());
    this.scene.dispose();
    this.engine.dispose();
  }

  reset(): void {
    for (const object of this.objects) {
      object.mesh.dispose();
      object.coreMesh.dispose();
    }

    this.objects = [];
    this.nextObjectId = 0;
    this.pulses.forEach((pulse) => pulse.mesh.dispose());
    this.pulses = [];
  }

  setPlayerX(x: number): void {
    this.playerWidth = this.getResponsivePlayerWidth();
    this.playerX = this.clampPlayerX(x);
    const halfWidth = this.playerWidth * 0.5;
    const y = GAME_CONFIG.playerY;

    this.playerSurface.a = new Vector2(this.playerX - halfWidth, y);
    this.playerSurface.b = new Vector2(this.playerX + halfWidth, y);
    this.updateSurfaceMesh(this.playerSurface, 0.34);

    this.playerMesh.position.x = this.playerX;
    this.playerMesh.position.y = y - 0.56;
  }

  setCameraBeatPulse(pulse: number, grooveIntensity: number): void {
    this.backdropBeatPulse = clamp(pulse, 0, 1);
    this.backdropGrooveIntensity = clamp(grooveIntensity, 0, 1);
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
    const materialSet = this.objectMaterials.get(type);
    const radius = definition.radius * this.getResponsiveObjectScale();

    if (!materialSet) {
      return null;
    }

    const mesh = MeshBuilder.CreateDisc(`object-${this.nextObjectId}`, {
      radius,
      tessellation: 34,
    }, this.scene);
    mesh.material =
      type === "mega"
        ? this.createFlatMaterial(`mega-${this.nextObjectId}-outer`, definition.color)
        : formationColor
          ? this.createFlatMaterial(`special-${this.nextObjectId}-outer`, formationColor)
          : materialSet.outer;
    mesh.position.z = 0;

    const coreMesh = MeshBuilder.CreateDisc(`object-core-${this.nextObjectId}`, {
      radius: radius * 0.55,
      tessellation: 24,
    }, this.scene);
    coreMesh.material =
      type === "mega"
        ? this.createFlatMaterial(`mega-${this.nextObjectId}-core`, definition.glowColor)
        : formationColor
          ? this.createFlatMaterial(`special-${this.nextObjectId}-core`, "#fff9dc")
          : materialSet.inner;
    coreMesh.position.z = -0.06;

    const object: MusicalObject = {
      id: this.nextObjectId += 1,
      type,
      noteFamily: definition.noteFamily,
      specialFormationId,
      specialCaught: false,
      position: new Vector2(
        clamp(x, this.bounds.left + 1.6, this.bounds.right - 1.6),
        this.bounds.top - 0.8 + Math.random() * 0.6,
      ),
      velocity: new Vector2(
        velocityX ?? (Math.random() - 0.5) * 2.6,
        velocityY ?? (-1.5 - Math.random() * 1.4),
      ),
      radius,
      bounce: definition.bounce,
      mass: definition.mass,
      color: definition.color,
      glowColor: definition.glowColor,
      noteRange: definition.noteRange,
      cooldown: definition.cooldown,
      gravityScale: definition.gravityScale,
      pulse: 0,
      age: 0,
      trailTimer: type === "mega" ? 0.02 : 0,
      mesh,
      coreMesh,
    };

    this.objects.push(object);
    return object;
  }

  markSpecialCaught(objectId: number): void {
    const object = this.objects.find((candidate) => candidate.id === objectId);

    if (!object || object.specialCaught) {
      return;
    }

    object.specialCaught = true;
    object.pulse = Math.max(object.pulse, 0.65);

    const outerMaterial = object.mesh.material;
    const coreMaterial = object.coreMesh.material;

    if (outerMaterial instanceof StandardMaterial) {
      outerMaterial.diffuseColor = hex("#69f5d8");
      outerMaterial.emissiveColor = hex("#69f5d8");
    }

    if (coreMaterial instanceof StandardMaterial) {
      coreMaterial.diffuseColor = hex("#ecfffa");
      coreMaterial.emissiveColor = hex("#ecfffa");
    }
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
    const surfaces = [...this.baseSurfaces, this.playerSurface];
    const substeps = Math.max(1, Math.min(5, Math.ceil(deltaTime / (1 / 120))));
    const stepDeltaTime = deltaTime / substeps;

    for (const pulse of this.pulses) {
      pulse.age += deltaTime;
      const progress = pulse.age / pulse.lifetime;
      const scale = pulse.startScale + (pulse.endScale - pulse.startScale) * progress;
      pulse.mesh.scaling.setAll(scale);
      pulse.material.alpha = Math.max(
        0,
        pulse.startAlpha + (pulse.endAlpha - pulse.startAlpha) * progress,
      );
    }

    this.pulses = this.pulses.filter((pulse) => {
      if (pulse.age >= pulse.lifetime) {
        pulse.mesh.dispose();
        return false;
      }

      return true;
    });

    for (let step = 0; step < substeps; step += 1) {
      for (const object of this.objects) {
        object.cooldown = Math.max(0, object.cooldown - stepDeltaTime);
        object.pulse = Math.max(0, object.pulse - stepDeltaTime * 3.6);
        object.age += stepDeltaTime;
        object.trailTimer = Math.max(0, object.trailTimer - stepDeltaTime);
        const previousPosition = object.position.clone();

        object.velocity.y -= GAME_CONFIG.gravity * object.gravityScale * stepDeltaTime;
        object.velocity.x *= 1 - GAME_CONFIG.airDrag * stepDeltaTime * 60;
        object.velocity.y *= GAME_CONFIG.damping;
        object.position.addInPlace(object.velocity.scale(stepDeltaTime));

        if (object.type === "mega") {
          this.updateMegaAppearance(object);

          if (object.trailTimer <= 0) {
            this.createMegaTrail(object.position.x, object.position.y, this.getMegaPaletteColor(object.age));
            object.trailTimer = 0.045;
          }
        }

        for (const surface of surfaces) {
          this.resolveSurfaceCollision(object, previousPosition, surface, onSurfaceImpact);
        }
      }
      this.resolveObjectCollisions(onPairImpact);
    }

    for (const object of this.objects) {
      const scale = 1 + object.pulse * 0.22;
      object.mesh.position.set(object.position.x, object.position.y, 0);
      object.coreMesh.position.set(object.position.x, object.position.y, -0.06);
      object.mesh.scaling.set(scale, scale, 1);
      object.coreMesh.scaling.set(1 - object.pulse * 0.12, 1 - object.pulse * 0.12, 1);
    }

    this.objects = this.objects.filter((object) => {
      if (object.position.y >= this.bounds.bottom - 2.4) {
        return true;
      }

      onObjectRemoved?.(object);
      object.mesh.dispose();
      object.coreMesh.dispose();
      return false;
    });
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

  private createBackdrop(): void {
    this.backdropPlane = MeshBuilder.CreatePlane("backdrop-shader-plane", {
      width: 2,
      height: 2,
    }, this.scene);
    this.backdropPlane.position.set(0, 0, 9.4);
    this.backdropMaterial = new ShaderMaterial(
      "backdrop-shader-material",
      this.scene,
      {
        vertexSource: BACKDROP_VERTEX_SHADER,
        fragmentSource: BACKDROP_FRAGMENT_SHADER,
        spectorName: "backdropPulse",
      },
      {
        attributes: ["position", "uv"],
        uniforms: [
          "worldViewProjection",
          "iTime",
          "beatPulse",
          "grooveIntensity",
          "resolution",
          "scrollDirection",
          "scrollOffset",
        ],
      },
    );
    this.backdropMaterial.backFaceCulling = false;
    this.backdropMaterial.setFloat("iTime", 0);
    this.backdropMaterial.setFloat("beatPulse", 0);
    this.backdropMaterial.setFloat("grooveIntensity", 0);
    this.backdropMaterial.setVector2(
      "resolution",
      new Vector2(this.engine.getRenderWidth(), this.engine.getRenderHeight()),
    );
    this.backdropMaterial.setVector2("scrollDirection", this.backdropScrollDirection);
    this.backdropMaterial.setVector2("scrollOffset", this.backdropScrollOffset);
    this.backdropPlane.material = this.backdropMaterial;

    const glowLeft = MeshBuilder.CreateDisc("backdrop-left", {
      radius: 6.4,
      tessellation: 48,
    }, this.scene);
    glowLeft.position.set(-7.5, 3.8, 7);
    glowLeft.material = this.createFlatMaterial("backdrop-left-material", "#124f7d", 0.22);

    const glowRight = MeshBuilder.CreateDisc("backdrop-right", {
      radius: 4.8,
      tessellation: 48,
    }, this.scene);
    glowRight.position.set(8.6, -0.4, 7);
    glowRight.material = this.createFlatMaterial("backdrop-right-material", "#2f7d78", 0.18);

    const horizon = MeshBuilder.CreatePlane("horizon", {
      width: 48,
      height: 8,
    }, this.scene);
    horizon.position.set(0, -7.2, 8);
    horizon.material = this.createFlatMaterial("horizon-material", "#0d2442", 0.55);
  }

  private resizeBackdrop(): void {
    if (!this.backdropPlane || !this.backdropMaterial) {
      return;
    }

    this.backdropPlane.scaling.set(
      (this.bounds.right - this.bounds.left) * 0.68,
      (this.bounds.top - this.bounds.bottom) * 0.72,
      1,
    );
    this.backdropMaterial.setVector2(
      "resolution",
      new Vector2(this.engine.getRenderWidth(), this.engine.getRenderHeight()),
    );
  }

  private createPlayerAvatar(): Mesh {
    const avatar = MeshBuilder.CreateDisc("player-avatar", {
      radius: 0.42,
      tessellation: 32,
    }, this.scene);
    avatar.material = this.playerMaterial;
    avatar.position.z = -0.12;

    const inner = MeshBuilder.CreateDisc("player-avatar-core", {
      radius: 0.2,
      tessellation: 20,
    }, this.scene);
    inner.material = this.playerCoreMaterial;
    inner.parent = avatar;
    inner.position.z = -0.06;

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
      mesh: this.createSurfaceMesh("player-surface", "#69f5d8"),
    };

    this.updateSurfaceMesh(surface, 0.34);
    return surface;
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
    const slopeInset = clamp(arenaWidth * 0.06, 0.42, 1.3);
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
      mesh: this.createSurfaceMesh("left-wall", "#1d4566"),
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
      mesh: this.createSurfaceMesh("right-wall", "#1d4566"),
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
      mesh: this.createSurfaceMesh("left-slope", "#3e6b92"),
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
      mesh: this.createSurfaceMesh("right-slope", "#3e6b92"),
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
    object.position = sweptHit.position.add(sweptHit.normal.scale(penetration));

    const velocityAlongNormal = Vector2.Dot(object.velocity, sweptHit.normal);

    if (velocityAlongNormal >= 0) {
      return;
    }

    const tangent = new Vector2(-sweptHit.normal.y, sweptHit.normal.x);
    const tangentVelocity = Vector2.Dot(object.velocity, tangent);
    const restitution =
      object.type === "mega"
        ? Math.min(1.08, object.bounce * surface.bounce + 0.1)
        : Math.min(0.98, object.bounce * surface.bounce);
    object.velocity = object.velocity.subtract(
      sweptHit.normal.scale((1 + restitution) * velocityAlongNormal),
    );
    object.velocity = object.velocity.subtract(tangent.scale(tangentVelocity * 0.025));

    const impact = -velocityAlongNormal;
    if (surface.musical && object.cooldown <= 0 && impact >= GAME_CONFIG.surfaceCollisionThreshold) {
      object.cooldown = OBJECT_DEFINITIONS[object.type].cooldown;
      object.pulse = Math.min(1, object.pulse + impact * 0.045);
      this.createPulse(sweptHit.closest.x, sweptHit.closest.y, object.color, impact);
      onImpact(object, surface, sweptHit.closest.x, sweptHit.closest.y, impact);
    }
  }

  private getSurfaceOverlap(
    position: Vector2,
    radius: number,
    surface: Surface,
  ): { position: Vector2; closest: Vector2; normal: Vector2; distance: number } | null {
    const closest = closestPointOnSegment(position, surface.a, surface.b);
    const delta = position.subtract(closest);
    const distance = delta.length();

    if (distance >= radius) {
      return null;
    }

    return {
      position: position.clone(),
      closest,
      normal: distance > 0.0001 ? delta.scale(1 / distance) : segmentNormal(surface.a, surface.b),
      distance,
    };
  }

  private getSweptSurfaceHit(
    previousPosition: Vector2,
    currentPosition: Vector2,
    radius: number,
    surface: Surface,
  ): { position: Vector2; closest: Vector2; normal: Vector2; distance: number } | null {
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
      const samplePosition = lerpVector2(previousPosition, currentPosition, sampleT);
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
      const midPosition = lerpVector2(previousPosition, currentPosition, midT);
      const overlap = this.getSurfaceOverlap(midPosition, radius, surface);

      if (overlap) {
        highT = midT;
      } else {
        lowT = midT;
      }
    }

    return this.getSurfaceOverlap(lerpVector2(previousPosition, currentPosition, highT), radius, surface);
  }

  private getLineCrossingHit(
    previousPosition: Vector2,
    currentPosition: Vector2,
    radius: number,
    surface: Surface,
  ): { position: Vector2; closest: Vector2; normal: Vector2; distance: number } | null {
    const normal = segmentNormal(surface.a, surface.b);
    const previousDistance = Vector2.Dot(previousPosition.subtract(surface.a), normal);
    const currentDistance = Vector2.Dot(currentPosition.subtract(surface.a), normal);

    if (previousDistance <= radius || currentDistance > radius) {
      return null;
    }

    const distanceDelta = previousDistance - currentDistance;

    if (distanceDelta <= 0.0001) {
      return null;
    }

    const hitT = clamp((previousDistance - radius) / distanceDelta, 0, 1);
    const hitPosition = lerpVector2(previousPosition, currentPosition, hitT);
    const closest = hitPosition.subtract(normal.scale(radius));
    const direction = segmentDirection(surface.a, surface.b);
    const projectedDistance = Vector2.Dot(closest.subtract(surface.a), direction);
    const segmentLength = Vector2.Distance(surface.a, surface.b);

    if (projectedDistance < -radius || projectedDistance > segmentLength + radius) {
      return null;
    }

    return {
      position: hitPosition,
      closest,
      normal,
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
        const delta = b.position.subtract(a.position);
        const distance = delta.length();
        const minDistance = a.radius + b.radius;

        if (distance >= minDistance) {
          continue;
        }

        const normal = distance > 0.0001 ? delta.scale(1 / distance) : new Vector2(1, 0);
        const penetration = minDistance - distance + 0.0005;
        const correction = normal.scale(penetration * 0.5);
        a.position.addInPlace(correction.scale(-1));
        b.position.addInPlace(correction);

        const relativeVelocity = b.velocity.subtract(a.velocity);
        const speedAlongNormal = Vector2.Dot(relativeVelocity, normal);

        if (speedAlongNormal >= 0) {
          continue;
        }

        const restitution =
          a.type === "mega" || b.type === "mega"
            ? Math.min(1.02, Math.max(a.bounce, b.bounce) * 0.94)
            : Math.min(a.bounce, b.bounce) * 0.86;
        const impulse =
          (-(1 + restitution) * speedAlongNormal) / ((1 / a.mass) + (1 / b.mass));
        const impulseVector = normal.scale(impulse);
        a.velocity = a.velocity.subtract(impulseVector.scale(1 / a.mass));
        b.velocity = b.velocity.add(impulseVector.scale(1 / b.mass));

        const impact = -speedAlongNormal;
        const source = a.noteRange[1] >= b.noteRange[1] ? a : b;
        const other = source.id === a.id ? b : a;

        if (impact >= GAME_CONFIG.objectCollisionThreshold && source.cooldown <= 0) {
          source.cooldown = Math.max(source.cooldown, 0.08);
          source.pulse = Math.min(1, source.pulse + impact * 0.04);
          const center = a.position.add(b.position).scale(0.5);
          this.createPulse(center.x, center.y, source.color, impact * 0.75);
          onPairImpact(source, other, center.x, center.y, impact * 0.7);
        }
      }
    }
  }

  private createSurfaceMesh(name: string, color: string): Mesh {
    const mesh = MeshBuilder.CreatePlane(`${name}-mesh`, { width: 1, height: 1 }, this.scene);
    mesh.material = this.createFlatMaterial(`${name}-material`, color, 0.9);
    mesh.position.z = 0.2;
    return mesh;
  }

  private updateSurfaceMesh(surface: Surface, thickness: number): void {
    const mesh = surface.mesh;

    if (!mesh) {
      return;
    }

    const delta = surface.b.subtract(surface.a);
    const length = delta.length();
    const midpoint = surface.a.add(surface.b).scale(0.5);

    mesh.position.set(midpoint.x, midpoint.y, 0.2);
    mesh.scaling.set(length, thickness, 1);
    mesh.rotation.z = Math.atan2(delta.y, delta.x);
  }

  private createPulse(x: number, y: number, color: string, impact: number): void {
    const mesh = MeshBuilder.CreateDisc(`pulse-${this.pulses.length}`, {
      radius: 0.42 + impact * 0.02,
      tessellation: 30,
    }, this.scene);
    const material = this.createFlatMaterial(`pulse-material-${this.pulses.length}`, color, 0.48);
    mesh.material = material;
    mesh.position.set(x, y, 0.34);
    this.pulses.push({
      mesh,
      material,
      age: 0,
      lifetime: 0.34,
      startScale: 1,
      endScale: 2.8,
      startAlpha: 0.48,
      endAlpha: 0,
    });
  }

  private createMegaTrail(x: number, y: number, color: string): void {
    const mesh = MeshBuilder.CreateDisc(`mega-trail-${this.pulses.length}`, {
      radius: 0.2,
      tessellation: 22,
    }, this.scene);
    const material = this.createFlatMaterial(`mega-trail-material-${this.pulses.length}`, color, 0.26);
    mesh.material = material;
    mesh.position.set(x, y, 0.12);
    this.pulses.push({
      mesh,
      material,
      age: 0,
      lifetime: 0.26,
      startScale: 1,
      endScale: 1.85,
      startAlpha: 0.24,
      endAlpha: 0,
    });
  }

  private updateMegaAppearance(object: MusicalObject): void {
    const outerMaterial = object.mesh.material;
    const coreMaterial = object.coreMesh.material;
    const color = this.getMegaPaletteColor(object.age);
    const nextColor = this.getMegaPaletteColor(object.age + 0.08);
    object.color = color;
    object.glowColor = nextColor;

    if (outerMaterial instanceof StandardMaterial) {
      outerMaterial.diffuseColor = hex(color);
      outerMaterial.emissiveColor = hex(color);
    }

    if (coreMaterial instanceof StandardMaterial) {
      coreMaterial.diffuseColor = hex(nextColor);
      coreMaterial.emissiveColor = hex(nextColor);
    }
  }

  private getMegaPaletteColor(age: number): string {
    const paletteIndex = Math.floor(age * 18) % MEGA_COLORS.length;
    return MEGA_COLORS[(paletteIndex + MEGA_COLORS.length) % MEGA_COLORS.length];
  }

  private getResponsivePlayerWidth(): number {
    const arenaWidth = this.bounds.right - this.bounds.left;
    return clamp(arenaWidth * 0.2, 1.85, GAME_CONFIG.playerWidth);
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
}
