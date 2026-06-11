import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { BackdropModule } from "../schema";
import panoramaUrl from "../assets/skybox-360/panorama.webp";

const SKYBOX_VARIANTS: Record<
  string,
  {
    tintLow: [number, number, number];
    tintHigh: [number, number, number];
    saturationBase: number;
    saturationLift: number;
    brightnessFloor: number;
    brightnessCeiling: number;
    chromaScale: number;
  }
> = {
  night: {
    tintLow: [0.82, 0.9, 1.0],
    tintHigh: [0.92, 1.0, 0.96],
    saturationBase: 0.88,
    saturationLift: 0.16,
    brightnessFloor: 0.34,
    brightnessCeiling: 0.7,
    chromaScale: 1,
  },
  neutral: {
    tintLow: [0.92, 0.93, 0.95],
    tintHigh: [1.0, 0.99, 0.97],
    saturationBase: 0.82,
    saturationLift: 0.1,
    brightnessFloor: 0.38,
    brightnessCeiling: 0.72,
    chromaScale: 0.7,
  },
  warm: {
    tintLow: [0.96, 0.87, 0.8],
    tintHigh: [1.0, 0.95, 0.88],
    saturationBase: 0.9,
    saturationLift: 0.12,
    brightnessFloor: 0.36,
    brightnessCeiling: 0.72,
    chromaScale: 0.85,
  },
  dream: {
    tintLow: [0.84, 0.8, 1.0],
    tintHigh: [0.98, 0.9, 1.0],
    saturationBase: 0.94,
    saturationLift: 0.18,
    brightnessFloor: 0.35,
    brightnessCeiling: 0.74,
    chromaScale: 1.15,
  },
};

const SKYBOX_360_VERTEX_SHADER = `
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

const SKYBOX_360_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUV;

uniform sampler2D panoramaSampler;
uniform vec2 resolution;
uniform float iTime;
uniform float beatPulse;
uniform float grooveIntensity;
uniform float yaw;
uniform float pitch;
uniform float endingProgress;
uniform float chromaAberration;
uniform vec3 tintLow;
uniform vec3 tintHigh;
uniform float saturationBase;
uniform float saturationLift;
uniform float brightnessFloor;
uniform float brightnessCeiling;

const float PI = 3.14159265358979323846;

mat3 rotationY(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat3(
    c, 0.0, -s,
    0.0, 1.0, 0.0,
    s, 0.0, c
  );
}

mat3 rotationX(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat3(
    1.0, 0.0, 0.0,
    0.0, c, -s,
    0.0, s, c
  );
}

void main(void) {
  vec2 uv = vUV * 2.0 - 1.0;
  float aspect = resolution.x / max(resolution.y, 1.0);
  uv.x *= aspect;

  float groove = clamp(grooveIntensity, 0.0, 1.0);
  vec3 dir = normalize(vec3(uv.x * 2.18, uv.y * 1.92, 0.78 - groove * 0.03));
  dir = rotationY(yaw) * rotationX(pitch) * dir;

  float panoU = atan(dir.x, dir.z) / (2.0 * PI) + 0.5;
  float panoV = acos(clamp(dir.y, -1.0, 1.0)) / PI;
  vec2 panoUv = vec2(1.0 - panoU, panoV);
  vec2 chromaOffset = vec2(chromaAberration * 0.012, chromaAberration * 0.004);
  vec3 panorama = vec3(
    texture2D(panoramaSampler, panoUv + chromaOffset).r,
    texture2D(panoramaSampler, panoUv).g,
    texture2D(panoramaSampler, panoUv - chromaOffset).b
  );

  float beatGlow = beatPulse * (0.05 + groove * 0.08);
  float scan = sin((vUV.y + iTime * 0.015) * 1200.0) * 0.006;
  float vignette = smoothstep(1.36, 0.26, length(vec2(uv.x * 0.82, uv.y * 0.74)));
  vec3 tint = mix(tintLow, tintHigh, groove * 0.35);
  vec3 color = panorama * tint;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float saturation = saturationBase + groove * saturationLift;
  color = mix(vec3(luma), color, saturation);
  color *= mix(brightnessFloor, brightnessCeiling, groove);
  color += vec3(0.02, 0.05, 0.07) * beatGlow;
  color += scan;
  color *= vignette;
  color = mix(color, color * vec3(0.44, 0.52, 0.6), endingProgress * 0.34);

  gl_FragColor = vec4(color, 1.0);
}
`;

export const SKYBOX_360_BACKDROP: BackdropModule = {
  id: "skybox-360",
  label: "Skybox 360",
  description:
    "Experimental 360 panorama backdrop rendered through an equirectangular shader plane.",
  performanceTier: "medium",
  create(context) {
    const panoramaSource = typeof context.params.panoramaUrl === "string" ? context.params.panoramaUrl : panoramaUrl;
    const variantName =
      typeof context.params.variant === "string" && context.params.variant in SKYBOX_VARIANTS
        ? context.params.variant
        : "night";
    const variant = SKYBOX_VARIANTS[variantName];
    const yawCenterDegrees =
      typeof context.params.yawCenterDegrees === "number" ? context.params.yawCenterDegrees : 0;
    const yawCenter = (yawCenterDegrees * Math.PI) / 180;
    const resolutionVector = new Vector2(context.engine.getRenderWidth(), context.engine.getRenderHeight());
    const plane = MeshBuilder.CreatePlane("skybox-360-plane", { width: 2, height: 2 }, context.scene);
    plane.position.set(0, 0, 9.6);

    const panoramaTexture = new Texture(panoramaSource, context.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    panoramaTexture.wrapU = Texture.WRAP_ADDRESSMODE;
    panoramaTexture.wrapV = Texture.CLAMP_ADDRESSMODE;

    const material = new ShaderMaterial(
      "skybox-360-material",
      context.scene,
      {
        vertexSource: SKYBOX_360_VERTEX_SHADER,
        fragmentSource: SKYBOX_360_FRAGMENT_SHADER,
        spectorName: "skybox360",
      },
      {
        attributes: ["position", "uv"],
        uniforms: [
          "worldViewProjection",
          "resolution",
          "iTime",
          "beatPulse",
          "grooveIntensity",
          "yaw",
          "pitch",
          "endingProgress",
          "chromaAberration",
          "tintLow",
          "tintHigh",
          "saturationBase",
          "saturationLift",
          "brightnessFloor",
          "brightnessCeiling",
        ],
        samplers: ["panoramaSampler"],
      },
    );
    material.backFaceCulling = false;
    material.setTexture("panoramaSampler", panoramaTexture);
    material.setVector2("resolution", resolutionVector);
    material.setFloat("iTime", 0);
    material.setFloat("beatPulse", 0);
    material.setFloat("grooveIntensity", 0);
    material.setFloat("yaw", 0);
    material.setFloat("pitch", 0);
    material.setFloat("endingProgress", 0);
    material.setFloat("chromaAberration", 0);
    material.setVector3("tintLow", new Vector3(variant.tintLow[0], variant.tintLow[1], variant.tintLow[2]));
    material.setVector3("tintHigh", new Vector3(variant.tintHigh[0], variant.tintHigh[1], variant.tintHigh[2]));
    material.setFloat("saturationBase", variant.saturationBase);
    material.setFloat("saturationLift", variant.saturationLift);
    material.setFloat("brightnessFloor", variant.brightnessFloor);
    material.setFloat("brightnessCeiling", variant.brightnessCeiling);
    plane.material = material;
    plane.visibility = 0.8;

    const resizePlane = () => {
      const bounds = context.getBounds();
      plane.scaling.set(
        (bounds.right - bounds.left) * 0.76,
        (bounds.top - bounds.bottom) * 0.76,
        1,
      );
      resolutionVector.x = context.engine.getRenderWidth();
      resolutionVector.y = context.engine.getRenderHeight();
      material.setVector2("resolution", resolutionVector);
    };

    resizePlane();

    return {
      update(inputs) {
        const groove = Math.max(0, Math.min(1, inputs.grooveIntensity));
        const yawAmplitude = 0.16 + groove * 0.06;
        const yawSpeed = 0.035 + groove * 0.012;
        const pitchAmplitude = 0.026 + groove * 0.01;
        const landingKick = inputs.transitionState.kind === "grooveLanding" ? inputs.transitionState.intensity * 0.018 : 0;
        const buildLean = inputs.transitionState.kind === "grooveBuild" ? inputs.transitionState.intensity * 0.01 : 0;
        const chromaAberration =
          inputs.transitionState.kind === "grooveLanding"
            ? 0.75 * inputs.transitionState.intensity * variant.chromaScale
            : inputs.transitionState.kind === "grooveBuild"
              ? 0.12 * inputs.transitionState.intensity * variant.chromaScale
              : 0;
        material.setFloat("iTime", inputs.elapsedTimeSeconds);
        material.setFloat("beatPulse", inputs.beatPulse);
        material.setFloat("grooveIntensity", groove);
        material.setFloat("endingProgress", inputs.endingProgress);
        material.setFloat("chromaAberration", chromaAberration);
        material.setFloat(
          "yaw",
          yawCenter +
            Math.sin(inputs.elapsedTimeSeconds * yawSpeed) * yawAmplitude +
            buildLean +
            landingKick,
        );
        material.setFloat(
          "pitch",
          Math.cos(inputs.elapsedTimeSeconds * 0.028 + 0.7) * pitchAmplitude +
            Math.sin(inputs.elapsedTimeSeconds * 0.061 + 2.2) * 0.008,
        );
        plane.visibility = 0.8 - inputs.endingProgress * 0.12;
      },
      resize() {
        resizePlane();
      },
      dispose() {
        plane.dispose();
        material.dispose();
        panoramaTexture.dispose();
      },
    };
  },
};
