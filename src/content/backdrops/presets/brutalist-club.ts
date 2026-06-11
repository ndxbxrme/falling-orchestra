import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { BackdropModule } from "../schema";

interface BackdropFrame {
  concrete: Mesh[];
  lampMaterial: StandardMaterial;
  reflectionMaterial: StandardMaterial;
}

interface BackdropLaser {
  mesh: Mesh;
  material: StandardMaterial;
  direction: number;
  baseX: number;
  baseY: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const hex = (value: string): Color3 => Color3.FromHexString(value);

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

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += noise(p) * amplitude;
    p = rot(0.45) * p * 2.04 + 4.7;
    amplitude *= 0.52;
  }
  return value;
}

float stripe(float x, float width, float blur) {
  return smoothstep(width + blur, width, abs(x));
}

void main(void) {
  vec2 uv = vUV * 2.0 - 1.0;
  float aspect = resolution.x / max(resolution.y, 1.0);
  uv.x *= aspect;

  float groove = clamp(grooveIntensity, 0.0, 1.0);
  float level2 = smoothstep(0.18, 0.34, groove);
  float level3 = smoothstep(0.46, 0.66, groove);
  float level4 = smoothstep(0.76, 0.96, groove);
  vec2 normalizedDirection = normalize(scrollDirection + vec2(0.0001, 0.0001));
  float forwardSpeed = mix(0.0, 0.18, level2) + level3 * 0.28 + level4 * 0.36;
  float travel = iTime * forwardSpeed + dot(scrollOffset, normalizedDirection) * 0.8;
  float beatJolt = beatPulse * (0.018 + level4 * 0.05);
  vec2 cam = vec2(
    sin(iTime * 0.41) * 0.02 * level2 + sin(iTime * 1.3) * 0.006,
    sin(iTime * 0.83) * 0.015 * level2 + beatJolt
  );
  uv += cam;

  vec3 color = vec3(0.01, 0.012, 0.016);
  vec3 fogColor = mix(vec3(0.028, 0.024, 0.02), vec3(0.018, 0.026, 0.034), level2);
  fogColor = mix(fogColor, vec3(0.025, 0.032, 0.038), level3);
  fogColor = mix(fogColor, vec3(0.06, 0.065, 0.074), beatPulse * 0.12 * level4);

  float horizonY = -0.08 + level2 * 0.02;
  float depth = 1.0 / max(uv.y + 1.18, 0.18);
  vec2 world = vec2(uv.x * depth * 2.7, depth * 7.2 + travel * 5.2);
  float corridorHalf = mix(2.3, 3.0, 0.35 + level2 * 0.2);
  float wallMask = smoothstep(corridorHalf + 0.14, corridorHalf - 0.02, abs(world.x));
  float floorMask = smoothstep(horizonY + 0.02, horizonY - 0.42, uv.y);
  float ceilingMask = smoothstep(-0.92, -0.55, -uv.y);

  vec3 floorBase = vec3(0.016, 0.017, 0.019);
  vec3 wallBase = vec3(0.032, 0.032, 0.035);
  vec3 ceilingBase = vec3(0.022, 0.024, 0.026);

  float pillarSpacing = 2.8;
  float pillarPhase = fract(world.y / pillarSpacing);
  float pillarBand = smoothstep(0.08, 0.0, abs(pillarPhase - 0.18));
  float pillarEdge = stripe(abs(world.x) - (corridorHalf - 0.18), 0.18, 0.09);
  float pillars = pillarBand * pillarEdge * wallMask;

  float beamPhase = fract(world.y / 1.6 + 0.16);
  float beamBand = smoothstep(0.12, 0.0, abs(beamPhase - 0.15));
  float ceilingBeams = beamBand * ceilingMask * smoothstep(0.82, 0.24, abs(uv.x));

  float concreteNoise = fbm(world * vec2(0.65, 0.22));
  wallBase += vec3(concreteNoise * 0.06);
  floorBase += vec3(fbm(world * vec2(0.9, 0.32)) * 0.04);

  vec3 lampWarm = vec3(1.0, 0.58, 0.16);
  vec3 lampCold = vec3(0.56, 0.76, 1.0);
  vec3 laserColor = mix(vec3(0.0, 0.9, 0.88), vec3(0.48, 1.0, 0.72), 0.45);

  float lampSpacing = 2.15;
  float lampPulse = fract(world.y / lampSpacing + 0.12);
  float lampBand = smoothstep(0.1, 0.0, abs(lampPulse - 0.14));
  float overheadCone = smoothstep(0.82, 0.0, abs(uv.x) + max(0.0, uv.y + 0.22) * 0.65);
  float amberFlicker = mix(0.65, 1.18, step(0.72, hash11(floor(iTime * 11.0))));
  float warmLamp = lampBand * overheadCone * (1.0 - level2) * amberFlicker;
  float coldLamp = lampBand * overheadCone * level2 * (0.35 + beatPulse * (0.9 + level3 * 0.8));

  float floorReflect = smoothstep(-0.12, -0.88, uv.y) * smoothstep(1.45, 0.12, abs(uv.x));
  float reflectionBreakup = 0.5 + 0.5 * fbm(vec2(world.x * 1.6, world.y * 0.7));

  float crowdBand = smoothstep(0.16, -0.08, abs(uv.x));
  float crowdNoise = fbm(vec2(uv.x * 9.0, 4.0 + iTime * 0.03));
  float crowdPulse = smoothstep(0.42, 0.75, crowdNoise) * smoothstep(-0.18, -0.76, uv.y) * level2;

  float laserSweepA = sin(world.y * 0.22 + iTime * 1.7) * (0.65 + level4 * 0.28);
  float laserSweepB = sin(world.y * 0.19 - iTime * 1.45 + 1.4) * (0.55 + level4 * 0.32);
  float laserA = stripe(uv.x - laserSweepA * 0.38, 0.012 + beatPulse * 0.012, 0.03) * level3;
  float laserB = stripe(uv.x + laserSweepB * 0.34, 0.014 + beatPulse * 0.015, 0.035) * level3;
  float laserFog = smoothstep(-0.48, 0.16, uv.y) * (laserA + laserB) * (0.35 + level4 * 0.9);

  color += wallBase * wallMask;
  color += floorBase * floorMask;
  color += ceilingBase * ceilingMask;
  color += vec3(0.12, 0.11, 0.1) * pillars * (0.35 + level2 * 0.4);
  color += vec3(0.18, 0.18, 0.18) * ceilingBeams * (0.4 + level2 * 0.25);
  color += lampWarm * warmLamp * (0.24 + beatPulse * 0.28);
  color += lampCold * coldLamp * (0.22 + level3 * 0.18);
  color += laserColor * laserFog;
  color += laserColor * floorReflect * reflectionBreakup * (laserA + laserB) * 0.32;
  color += vec3(0.07, 0.11, 0.13) * crowdPulse * (0.55 + beatPulse * 0.35);

  float haze = 0.24 + groove * 0.18 + beatPulse * 0.05;
  color = mix(color, fogColor, haze * smoothstep(0.95, -0.35, uv.y));

  float vignette = smoothstep(1.52, 0.42, length(vec2(uv.x * 0.82, uv.y * 0.68)));
  color *= vignette;

  float strobe = level4 * beatPulse * smoothstep(0.8, 0.2, abs(uv.x));
  color += lampCold * strobe * 0.35 + laserColor * strobe * 0.22;

  gl_FragColor = vec4(color, 1.0);
}
`;

export const BRUTALIST_CLUB_BACKDROP_MODULE: BackdropModule = {
  id: "brutalist-club",
  label: "Brutalist Club",
  description:
    "A concrete corridor with cold haze, laser sweeps, and brutalist signal architecture.",
  performanceTier: "medium",
  create(context) {
    const { scene, engine } = context;
    const meshes: Mesh[] = [];
    const materials: StandardMaterial[] = [];
    const backdropFrames: BackdropFrame[] = [];
    const backdropLasers: BackdropLaser[] = [];
    const resolutionVector = new Vector2(engine.getRenderWidth(), engine.getRenderHeight());
    const scrollDirectionVector = new Vector2(0.78, -0.24);
    const scrollOffsetVector = new Vector2(0, 0);
    let backdropPlane: Mesh | undefined;
    let backdropMaterial: ShaderMaterial | undefined;

    const createFlatMaterial = (name: string, hexColor: string, alpha = 1) => {
      const material = new StandardMaterial(name, scene);
      material.disableLighting = true;
      material.diffuseColor = Color3.FromHexString(hexColor);
      material.emissiveColor = material.diffuseColor.scale(0.45);
      material.alpha = alpha;
      materials.push(material);
      return material;
    };

    const createBackdrop = () => {
      backdropPlane = MeshBuilder.CreatePlane("backdrop-shader-plane", {
        width: 2,
        height: 2,
      }, scene);
      backdropPlane.position.set(0, 0, 9.4);
      meshes.push(backdropPlane);
      backdropMaterial = new ShaderMaterial(
        "backdrop-shader-material",
        scene,
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
      backdropMaterial.backFaceCulling = false;
      backdropMaterial.setFloat("iTime", 0);
      backdropMaterial.setFloat("beatPulse", 0);
      backdropMaterial.setFloat("grooveIntensity", 0);
      backdropMaterial.setVector2("resolution", resolutionVector);
      backdropMaterial.setVector2("scrollDirection", scrollDirectionVector);
      backdropMaterial.setVector2("scrollOffset", scrollOffsetVector);
      backdropPlane.material = backdropMaterial;
      backdropPlane.visibility = 0.62;

      const fogBand = MeshBuilder.CreatePlane("backdrop-fog-band", {
        width: 54,
        height: 10,
      }, scene);
      fogBand.position.set(0, -6.8, 8);
      fogBand.material = createFlatMaterial("backdrop-fog-band-material", "#0a1116", 0.42);
      meshes.push(fogBand);

      const frameCount = 6;
      for (let index = 0; index < frameCount; index += 1) {
        const scale = 1 - index * 0.1;
        const halfWidth = 10.5 * scale;
        const halfHeight = 6.9 * scale;
        const beamThickness = 0.9 * scale;
        const pillarWidth = 1.18 * scale;
        const frameZ = 8.75 + index * 0.06;
        const concreteAlpha = 0.58 - index * 0.035;
        const concreteMaterial = createFlatMaterial(
          `backdrop-frame-${index}-concrete`,
          index === 0 ? "#565961" : "#3d4148",
          concreteAlpha,
        );

        const leftPillar = MeshBuilder.CreateBox(`backdrop-frame-${index}-left`, {
          width: pillarWidth,
          height: halfHeight * 2,
          depth: 0.2,
        }, scene);
        leftPillar.position.set(-halfWidth + pillarWidth * 0.5, 0.2 - index * 0.08, frameZ);
        leftPillar.material = concreteMaterial;
        meshes.push(leftPillar);

        const rightPillar = MeshBuilder.CreateBox(`backdrop-frame-${index}-right`, {
          width: pillarWidth,
          height: halfHeight * 2,
          depth: 0.2,
        }, scene);
        rightPillar.position.set(halfWidth - pillarWidth * 0.5, 0.2 - index * 0.08, frameZ);
        rightPillar.material = concreteMaterial;
        meshes.push(rightPillar);

        const topBeam = MeshBuilder.CreateBox(`backdrop-frame-${index}-top`, {
          width: halfWidth * 2,
          height: beamThickness,
          depth: 0.2,
        }, scene);
        topBeam.position.set(0, halfHeight - beamThickness * 0.5 - index * 0.1, frameZ);
        topBeam.material = concreteMaterial;
        meshes.push(topBeam);

        const insetLeft = MeshBuilder.CreateBox(`backdrop-frame-${index}-inset-left`, {
          width: 0.38 * scale,
          height: halfHeight * 1.6,
          depth: 0.2,
        }, scene);
        insetLeft.position.set(-halfWidth + 2.6 * scale, 0.05 - index * 0.06, frameZ - 0.01);
        insetLeft.material = concreteMaterial;
        meshes.push(insetLeft);

        const insetRight = MeshBuilder.CreateBox(`backdrop-frame-${index}-inset-right`, {
          width: 0.38 * scale,
          height: halfHeight * 1.6,
          depth: 0.2,
        }, scene);
        insetRight.position.set(halfWidth - 2.6 * scale, 0.05 - index * 0.06, frameZ - 0.01);
        insetRight.material = concreteMaterial;
        meshes.push(insetRight);

        const lampMaterial = createFlatMaterial(
          `backdrop-frame-${index}-lamp`,
          index === 0 ? "#d07a2f" : "#5a7f9c",
          0.22 + index * 0.025,
        );
        const lamp = MeshBuilder.CreatePlane(`backdrop-frame-${index}-lamp`, {
          width: halfWidth * 0.9,
          height: 0.22 * scale,
        }, scene);
        lamp.position.set(0, halfHeight - 1.05 * scale - index * 0.1, frameZ - 0.03);
        lamp.material = lampMaterial;
        meshes.push(lamp);

        const reflectionMaterial = createFlatMaterial(
          `backdrop-frame-${index}-reflection`,
          index === 0 ? "#9f6734" : "#315269",
          0.1,
        );
        const reflection = MeshBuilder.CreatePlane(`backdrop-frame-${index}-reflection`, {
          width: halfWidth * 1.55,
          height: 0.52 * scale,
        }, scene);
        reflection.position.set(0, -halfHeight + 1.32 * scale, frameZ - 0.04);
        reflection.material = reflectionMaterial;
        meshes.push(reflection);

        backdropFrames.push({
          concrete: [leftPillar, rightPillar, topBeam, insetLeft, insetRight],
          lampMaterial,
          reflectionMaterial,
        });
      }

      const backWallMaterial = createFlatMaterial("backdrop-back-wall-material", "#474b52", 0.34);
      const backWall = MeshBuilder.CreatePlane("backdrop-back-wall", {
        width: 7.2,
        height: 5.4,
      }, scene);
      backWall.position.set(0, 0.1, 9.38);
      backWall.material = backWallMaterial;
      meshes.push(backWall);
      backdropFrames.push({
        concrete: [backWall],
        lampMaterial: createFlatMaterial("backdrop-back-wall-dummy-lamp", "#000000", 0),
        reflectionMaterial: createFlatMaterial("backdrop-back-wall-dummy-reflect", "#000000", 0),
      });

      for (const direction of [-1, 1]) {
        const laserMaterial = createFlatMaterial(
          `backdrop-laser-${direction > 0 ? "right" : "left"}`,
          direction > 0 ? "#57ffe0" : "#7de86f",
          0,
        );
        const laser = MeshBuilder.CreatePlane(`backdrop-laser-${direction > 0 ? "right" : "left"}`, {
          width: 0.18,
          height: 28,
        }, scene);
        laser.position.set(direction * 4.2, 0.2, 8.72);
        laser.rotation.z = direction * 0.22;
        laser.material = laserMaterial;
        meshes.push(laser);
        backdropLasers.push({
          mesh: laser,
          material: laserMaterial,
          direction,
          baseX: direction * 4.2,
          baseY: 0.2,
        });
      }
    };

    const resizeBackdrop = (left: number, right: number, top: number, bottom: number) => {
      if (!backdropPlane || !backdropMaterial) {
        return;
      }

      backdropPlane.scaling.set(
        (right - left) * 0.68,
        (top - bottom) * 0.72,
        1,
      );
      resolutionVector.x = engine.getRenderWidth();
      resolutionVector.y = engine.getRenderHeight();
      backdropMaterial.setVector2("resolution", resolutionVector);
    };

    createBackdrop();
    const initialBounds = context.getBounds();
    resizeBackdrop(initialBounds.left, initialBounds.right, initialBounds.top, initialBounds.bottom);

    return {
      update(inputs) {
        if (backdropMaterial) {
          backdropMaterial.setFloat("iTime", inputs.elapsedTimeSeconds);
          backdropMaterial.setFloat("beatPulse", inputs.beatPulse);
          backdropMaterial.setFloat("grooveIntensity", inputs.grooveIntensity * (1 - inputs.endingProgress * 0.22));
          scrollDirectionVector.x = inputs.scrollDirectionX;
          scrollDirectionVector.y = inputs.scrollDirectionY;
          scrollOffsetVector.x = inputs.scrollOffsetX;
          scrollOffsetVector.y = inputs.scrollOffsetY;
          backdropMaterial.setVector2("scrollDirection", scrollDirectionVector);
          backdropMaterial.setVector2("scrollOffset", scrollOffsetVector);
        }

        const groove = inputs.grooveIntensity;
        const buildLift = inputs.transitionState.kind === "grooveBuild" ? inputs.transitionState.intensity * 0.22 : 0;
        const landingLift = inputs.transitionState.kind === "grooveLanding" ? inputs.transitionState.intensity * 0.48 : 0;
        const powerDown = 1 - inputs.endingIntensity * 0.34;
        const level2 = clamp((groove - 0.18) / 0.24, 0, 1);
        const level3 = clamp((groove - 0.46) / 0.2, 0, 1);
        const level4 = clamp((groove - 0.76) / 0.2, 0, 1);
        const amber = hex("#9f5218");
        const steel = hex("#5e768c");
        const laserA = hex("#57ffe0");
        const laserB = hex("#7de86f");

        for (let index = 0; index < backdropFrames.length; index += 1) {
          const frame = backdropFrames[index];
          const visibilityRamp = clamp(
            (0.22 + groove * 0.55 - index * 0.05 + buildLift * 0.08 + landingLift * 0.12) * powerDown,
            0.12,
            0.72,
          );
          for (let meshIndex = 0; meshIndex < frame.concrete.length; meshIndex += 1) {
            frame.concrete[meshIndex].visibility = visibilityRamp;
          }

          const lampColor = Color3.Lerp(amber, steel, level2);
          frame.lampMaterial.diffuseColor = lampColor;
          frame.lampMaterial.emissiveColor = lampColor.scale(
            (0.34 + inputs.beatPulse * (0.32 + level3 * 0.24) + buildLift * 0.24 + landingLift * 0.42) * powerDown,
          );
          frame.lampMaterial.alpha = (0.2 + level2 * 0.1 + inputs.beatPulse * 0.08) * powerDown;

          const reflectionColor = Color3.Lerp(hex("#6b431e"), hex("#2d4657"), level2);
          frame.reflectionMaterial.diffuseColor = reflectionColor;
          frame.reflectionMaterial.emissiveColor = reflectionColor.scale(
            (0.14 + inputs.beatPulse * 0.12) * powerDown,
          );
          frame.reflectionMaterial.alpha = (0.06 + level2 * 0.05 + level3 * 0.04) * powerDown;
        }

        for (let index = 0; index < backdropLasers.length; index += 1) {
          const laser = backdropLasers[index];
          const sweep = Math.sin(inputs.elapsedTimeSeconds * (1.4 + index * 0.22) + index * 1.4);
          laser.mesh.rotation.z = laser.direction * (0.12 + level3 * 0.42 + sweep * 0.08);
          laser.mesh.position.x = laser.baseX + laser.direction * sweep * 1.2;
          laser.mesh.position.y = laser.baseY;
          laser.material.diffuseColor = index === 0 ? laserA : laserB;
          laser.material.emissiveColor = (index === 0 ? laserA : laserB).scale(
            level3 * (0.3 + inputs.beatPulse * (0.7 + level4 * 0.8) + buildLift * 0.4 + landingLift * 0.68) * powerDown,
          );
          laser.material.alpha =
            (level3 * 0.3 + level4 * 0.28 + inputs.beatPulse * level4 * 0.18 + buildLift * 0.12 + landingLift * 0.24) * powerDown;
          laser.mesh.visibility = level3 * powerDown;
        }

        if (backdropPlane) {
          backdropPlane.visibility = 0.62 - inputs.endingProgress * 0.16;
        }
      },
      resize(bounds) {
        resizeBackdrop(bounds.left, bounds.right, bounds.top, bounds.bottom);
      },
      dispose() {
        if (backdropMaterial) {
          backdropMaterial.dispose();
        }
        for (let index = 0; index < materials.length; index += 1) {
          materials[index].dispose();
        }
        for (let index = 0; index < meshes.length; index += 1) {
          meshes[index].dispose();
        }
      },
    };
  },
};
