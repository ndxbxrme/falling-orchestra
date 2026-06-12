import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { BackdropModule } from "../schema";

/**
 * Variants:
 * - `cobalt`
 * - `magenta`
 * - `teal`
 * - `ember`
 *
 * Overrides:
 * - `backdropParams.variant`
 * - `backdropParams.baseBrightness`
 * - `backdropParams.speedScale`
 * - `backdropParams.streakDensity`
 *
 * Notes:
 * - The numeric overrides are intended as small trims on top of a named variant, not a full palette system.
 */
type SlipstreamVariantPalette = {
  lowSky: [number, number, number];
  highSky: [number, number, number];
  cloud: [number, number, number];
  glow: [number, number, number];
  streak: [number, number, number];
  centerGlow: [number, number, number];
  gradeLow: [number, number, number];
  gradeHigh: [number, number, number];
  baseBrightness: number;
  speedScale: number;
  streakDensity: number;
};

const AFTERBURNER_VARIANTS: Record<string, SlipstreamVariantPalette> = {
  cobalt: {
    lowSky: [0.01, 0.04, 0.11],
    highSky: [0.08, 0.27, 0.62],
    cloud: [0.88, 0.96, 1.0],
    glow: [0.14, 0.42, 1.0],
    streak: [0.7, 0.88, 1.0],
    centerGlow: [0.08, 0.28, 0.82],
    gradeLow: [0.55, 0.74, 1.0],
    gradeHigh: [0.82, 0.92, 1.0],
    baseBrightness: 0.24,
    speedScale: 1,
    streakDensity: 1,
  },
  magenta: {
    lowSky: [0.07, 0.01, 0.05],
    highSky: [0.46, 0.07, 0.24],
    cloud: [1.0, 0.89, 0.96],
    glow: [1.0, 0.26, 0.62],
    streak: [1.0, 0.78, 0.93],
    centerGlow: [0.76, 0.13, 0.48],
    gradeLow: [0.94, 0.66, 0.9],
    gradeHigh: [1.0, 0.9, 0.97],
    baseBrightness: 0.23,
    speedScale: 1.08,
    streakDensity: 1.08,
  },
  teal: {
    lowSky: [0.01, 0.07, 0.08],
    highSky: [0.02, 0.34, 0.39],
    cloud: [0.88, 1.0, 0.98],
    glow: [0.14, 0.86, 1.0],
    streak: [0.72, 1.0, 0.97],
    centerGlow: [0.04, 0.62, 0.78],
    gradeLow: [0.6, 0.95, 0.92],
    gradeHigh: [0.86, 1.0, 0.97],
    baseBrightness: 0.22,
    speedScale: 1.03,
    streakDensity: 1.12,
  },
  ember: {
    lowSky: [0.08, 0.02, 0.01],
    highSky: [0.44, 0.12, 0.04],
    cloud: [1.0, 0.91, 0.82],
    glow: [1.0, 0.45, 0.08],
    streak: [1.0, 0.84, 0.45],
    centerGlow: [0.84, 0.28, 0.03],
    gradeLow: [0.94, 0.72, 0.46],
    gradeHigh: [1.0, 0.9, 0.72],
    baseBrightness: 0.21,
    speedScale: 1.12,
    streakDensity: 1.04,
  },
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const readNumberParam = (
  params: Record<string, string | number | boolean>,
  key: string,
  fallback: number,
) => (typeof params[key] === "number" ? params[key] : fallback);

const AFTERBURNER_SLIPSTREAM_VERTEX_SHADER = `
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

const AFTERBURNER_SLIPSTREAM_FRAGMENT_SHADER = `
precision highp float;

uniform vec2 uRes;
uniform float uTime;
uniform float grooveIntensity;
uniform float beatPulse;
uniform float endingProgress;
uniform float buildIntensity;
uniform float landingIntensity;
uniform float baseBrightness;
uniform float speedScale;
uniform float streakDensity;
uniform vec3 lowSkyColor;
uniform vec3 highSkyColor;
uniform vec3 cloudColor;
uniform vec3 glowColor;
uniform vec3 streakColor;
uniform vec3 centerGlowColor;
uniform vec3 gradeLowColor;
uniform vec3 gradeHighColor;
varying vec2 vUV;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = hash(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));

  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

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
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / max(uRes.y, 1.0);

  float groove = clamp(grooveIntensity, 0.0, 1.0);
  float beat = clamp(beatPulse, 0.0, 1.0);
  float ending = clamp(endingProgress, 0.0, 1.0);
  float build = clamp(buildIntensity, 0.0, 1.0);
  float landing = clamp(landingIntensity, 0.0, 1.0);

  float yaw = sin(uTime * 0.08) * 0.06 + build * 0.03 - landing * 0.05;
  float pitch = cos(uTime * 0.053 + 0.8) * 0.045 + groove * 0.02 + landing * 0.018;
  mat3 camRot = rotationY(yaw) * rotationX(pitch);

  vec3 camRight = normalize(camRot * vec3(1.0, 0.0, 0.0));
  vec3 camUp = normalize(camRot * vec3(0.0, 1.0, 0.0));
  vec3 camForward = normalize(camRot * vec3(0.0, 0.0, 1.0));
  vec3 flightDir = normalize(rotationY(sin(uTime * 0.035) * 0.04) * vec3(0.0, 0.0, 1.0));

  vec3 rd = normalize(camRight * uv.x + camUp * uv.y + camForward * (1.05 + groove * 0.22));

  vec3 col = mix(lowSkyColor, highSkyColor, uv.y + 0.58);

  float cloud = 0.0;
  float glow = 0.0;
  float flightSpeed = (8.0 + groove * 10.0 + build * 3.0 + landing * 6.0) * speedScale;

  for (int i = 0; i < 32; i++) {
    float d = float(i) * 0.52;
    vec3 p = rd * d;

    vec3 q = vec3(
      dot(p, camRight) * 0.45,
      dot(p, camUp) * 0.26,
      (dot(p, camForward) + uTime * flightSpeed) * 0.082
    );

    float n = fbm(q);
    float c = smoothstep(0.47, 0.84, n);
    c *= smoothstep(1.12, 0.16, length(uv));

    cloud += c * 0.052;
    glow += c * exp(-d * 0.06);
  }

  col = mix(col, cloudColor, clamp(cloud, 0.0, 1.0));
  col += glowColor * glow * (0.028 + groove * 0.02 + beat * 0.012);

  vec3 v = vec3(
    dot(flightDir, camRight),
    dot(flightDir, camUp),
    dot(flightDir, camForward)
  );

  vec2 vanish = (abs(v.z) > 0.0001) ? (v.xy / v.z) * 1.22 : vec2(0.0);
  float streak = 0.0;
  vec3 ro = flightDir * uTime * (16.0 + groove * 16.0 + landing * 6.0);

  for (int i = 0; i < 60; i++) {
    float fi = float(i);
    float h1 = hash(vec3(fi, 1.23, 4.56));
    float h2 = hash(vec3(fi, 7.89, 0.12));
    float h3 = hash(vec3(fi, 3.45, 6.78));

    vec2 lane = vec2(h1, h2) * 2.0 - 1.0;
    lane *= mix(4.2, 6.5, groove) * streakDensity;

    float z = fract(h3 - uTime * (2.1 + groove * 1.8 + landing * 0.5) * speedScale) * 28.0 + 0.5;

    vec3 worldPos = ro + flightDir * z + camRight * lane.x + camUp * lane.y;
    vec3 rel3 = worldPos - ro;

    vec3 viewPos = vec3(
      dot(rel3, camRight),
      dot(rel3, camUp),
      dot(rel3, camForward)
    );

    if (viewPos.z > 0.01) {
      vec2 screenPos = viewPos.xy / viewPos.z * 1.22;
      vec2 dir = normalize(screenPos - vanish + vec2(0.0001));
      vec2 rel = uv - screenPos;

      float radial = smoothstep(0.05, 0.85, length(screenPos - vanish));
      float len = mix(0.012, 0.58, radial * (1.0 - viewPos.z / 28.5));
      float width = mix(0.0012, 0.0135, radial);

      float side = abs(rel.x * dir.y - rel.y * dir.x);
      float along = dot(rel, dir);

      float body =
        smoothstep(width, 0.0, side) *
        smoothstep(0.0, 0.03, along) *
        smoothstep(len, len * 0.15, along);

      body *= smoothstep(28.5, 2.5, viewPos.z);
      streak += body;
    }
  }

  col += streak * streakColor * (0.92 + groove * 0.56 + landing * 0.45);

  float centerGlow = exp(-length(uv - vanish) * 4.4);
  col += centerGlowColor * centerGlow * (0.22 + groove * 0.1 + landing * 0.12);

  float vignette = 1.08 - length(uv) * 0.36;
  col *= vignette;

  vec3 grade = mix(gradeLowColor, gradeHighColor, groove * 0.45);
  col *= grade;
  col *= baseBrightness + groove * 0.26 + beat * 0.04 + landing * 0.05;
  col = mix(col, col * vec3(0.34, 0.46, 0.7), ending * 0.48);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const AFTERBURNER_SLIPSTREAM_BACKDROP: BackdropModule = {
  id: "afterburner-slipstream",
  label: "Afterburner Slipstream",
  description:
    "A high-speed cloud tunnel with reactive vapor bloom and vanishing-point light streaks.",
  performanceTier: "high",
  create(context) {
    const variantName =
      typeof context.params.variant === "string" && context.params.variant in AFTERBURNER_VARIANTS
        ? context.params.variant
        : "cobalt";
    const variant = AFTERBURNER_VARIANTS[variantName];
    const lowSky = variant.lowSky;
    const highSky = variant.highSky;
    const cloudColor = variant.cloud;
    const glowColor = variant.glow;
    const streakColor = variant.streak;
    const centerGlowColor = variant.centerGlow;
    const gradeLow = variant.gradeLow;
    const gradeHigh = variant.gradeHigh;
    const baseBrightness = clamp01(readNumberParam(context.params, "baseBrightness", variant.baseBrightness));
    const speedScale = Math.max(0.35, readNumberParam(context.params, "speedScale", variant.speedScale));
    const streakDensity = Math.max(0.45, readNumberParam(context.params, "streakDensity", variant.streakDensity));
    const resolution = new Vector2(context.engine.getRenderWidth(), context.engine.getRenderHeight());
    const plane = MeshBuilder.CreatePlane("afterburner-slipstream-plane", { width: 2, height: 2 }, context.scene);
    plane.position.set(0, 0, 9.54);

    const material = new ShaderMaterial(
      "afterburner-slipstream-material",
      context.scene,
      {
        vertexSource: AFTERBURNER_SLIPSTREAM_VERTEX_SHADER,
        fragmentSource: AFTERBURNER_SLIPSTREAM_FRAGMENT_SHADER,
        spectorName: "afterburnerSlipstream",
      },
      {
        attributes: ["position", "uv"],
        uniforms: [
          "worldViewProjection",
          "uRes",
          "uTime",
          "grooveIntensity",
          "beatPulse",
          "endingProgress",
          "buildIntensity",
          "landingIntensity",
          "baseBrightness",
          "speedScale",
          "streakDensity",
          "lowSkyColor",
          "highSkyColor",
          "cloudColor",
          "glowColor",
          "streakColor",
          "centerGlowColor",
          "gradeLowColor",
          "gradeHighColor",
        ],
      },
    );

    material.backFaceCulling = false;
    material.setVector2("uRes", resolution);
    material.setFloat("uTime", 0);
    material.setFloat("grooveIntensity", 0);
    material.setFloat("beatPulse", 0);
    material.setFloat("endingProgress", 0);
    material.setFloat("buildIntensity", 0);
    material.setFloat("landingIntensity", 0);
    material.setFloat("baseBrightness", baseBrightness);
    material.setFloat("speedScale", speedScale);
    material.setFloat("streakDensity", streakDensity);
    material.setVector3("lowSkyColor", new Vector3(lowSky[0], lowSky[1], lowSky[2]));
    material.setVector3("highSkyColor", new Vector3(highSky[0], highSky[1], highSky[2]));
    material.setVector3("cloudColor", new Vector3(cloudColor[0], cloudColor[1], cloudColor[2]));
    material.setVector3("glowColor", new Vector3(glowColor[0], glowColor[1], glowColor[2]));
    material.setVector3("streakColor", new Vector3(streakColor[0], streakColor[1], streakColor[2]));
    material.setVector3(
      "centerGlowColor",
      new Vector3(centerGlowColor[0], centerGlowColor[1], centerGlowColor[2]),
    );
    material.setVector3("gradeLowColor", new Vector3(gradeLow[0], gradeLow[1], gradeLow[2]));
    material.setVector3("gradeHighColor", new Vector3(gradeHigh[0], gradeHigh[1], gradeHigh[2]));
    plane.material = material;
    plane.visibility = 0.88;

    const resizePlane = () => {
      const bounds = context.getBounds();
      plane.scaling.set(
        (bounds.right - bounds.left) * 0.8,
        (bounds.top - bounds.bottom) * 0.8,
        1,
      );
      resolution.x = context.engine.getRenderWidth();
      resolution.y = context.engine.getRenderHeight();
      material.setVector2("uRes", resolution);
    };

    resizePlane();

    return {
      update(inputs) {
        const buildIntensity =
          inputs.transitionState.kind === "grooveBuild" ? inputs.transitionState.intensity : 0;
        const landingIntensity =
          inputs.transitionState.kind === "grooveLanding" ? inputs.transitionState.intensity : 0;

        material.setFloat("uTime", inputs.elapsedTimeSeconds);
        material.setFloat("grooveIntensity", inputs.grooveIntensity);
        material.setFloat("beatPulse", inputs.beatPulse);
        material.setFloat("endingProgress", inputs.endingProgress);
        material.setFloat("buildIntensity", buildIntensity);
        material.setFloat("landingIntensity", landingIntensity);
        plane.visibility = 0.88 - inputs.endingProgress * 0.18;
      },
      resize() {
        resizePlane();
      },
      dispose() {
        plane.dispose();
        material.dispose();
      },
    };
  },
};
