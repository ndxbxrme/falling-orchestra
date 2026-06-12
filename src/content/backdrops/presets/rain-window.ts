import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { BackdropModule } from "../schema";
import backgroundUrl from "../assets/rain-window/background.webp";

/**
 * Variants:
 * - `moody`
 * - `storm`
 * - `sodium`
 * - `frost`
 *
 * Overrides:
 * - `backdropParams.variant`
 * - `backdropParams.backgroundUrl`
 *
 * Notes:
 * - `backgroundUrl` should point to the image rendered behind the rain/distortion shader.
 */
const RAIN_WINDOW_VARIANTS: Record<
  string,
  {
    tintLow: [number, number, number];
    tintHigh: [number, number, number];
    outputGain: number;
    rainBase: number;
    rainLift: number;
    distortionScale: number;
  }
> = {
  moody: {
    tintLow: [0.82, 0.9, 0.98],
    tintHigh: [0.74, 0.86, 0.92],
    outputGain: 0.82,
    rainBase: 0.24,
    rainLift: 0.66,
    distortionScale: 1,
  },
  storm: {
    tintLow: [0.74, 0.83, 0.94],
    tintHigh: [0.62, 0.77, 0.88],
    outputGain: 0.78,
    rainBase: 0.34,
    rainLift: 0.74,
    distortionScale: 1.2,
  },
  sodium: {
    tintLow: [0.96, 0.83, 0.7],
    tintHigh: [0.88, 0.74, 0.58],
    outputGain: 0.84,
    rainBase: 0.22,
    rainLift: 0.58,
    distortionScale: 0.92,
  },
  frost: {
    tintLow: [0.88, 0.94, 1.0],
    tintHigh: [0.72, 0.84, 0.94],
    outputGain: 0.8,
    rainBase: 0.26,
    rainLift: 0.64,
    distortionScale: 1.05,
  },
};

const RAIN_WINDOW_VERTEX_SHADER = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;

varying vec2 vUv;

void main(void) {
  vUv = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const RAIN_WINDOW_FRAGMENT_SHADER = `
precision highp float;

uniform float iGlobalTime;
uniform vec3 iResolution;
uniform sampler2D iChannel0;
uniform float beatPulse;
uniform float grooveIntensity;
uniform float endingProgress;
uniform vec3 tintLow;
uniform vec3 tintHigh;
uniform float outputGain;
uniform float rainBase;
uniform float rainLift;
uniform float distortionScale;
varying vec2 vUv;

#define S(a, b, t) smoothstep(a, b, t)

vec3 N13(float p) {
  vec3 p3 = fract(vec3(p) * vec3(.1031, .11369, .13787));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec3((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
}

float N(float t) {
  return fract(sin(t * 12345.564) * 7658.76);
}

float Saw(float b, float t) {
  return S(0., b, t) * S(1., b, t);
}

vec2 DropLayer2(vec2 uv, float t) {
  vec2 UV = uv;

  uv.y += t * 0.75;
  vec2 a = vec2(6., 1.);
  vec2 grid = a * 2.;
  vec2 id = floor(uv * grid);

  float colShift = N(id.x);
  uv.y += colShift;

  id = floor(uv * grid);
  vec3 n = N13(id.x * 35.2 + id.y * 2376.1);
  vec2 st = fract(uv * grid) - vec2(.5, 0);

  float x = n.x - .5;

  float y = UV.y * 20.;
  float wiggle = sin(y + sin(y));
  x += wiggle * (.5 - abs(x)) * (n.z - .5);
  x *= .7;
  float ti = fract(t + n.z);
  y = (Saw(.85, ti) - .5) * .9 + .5;
  vec2 p = vec2(x, y);

  float d = length((st - p) * a.yx);
  float mainDrop = S(.4, .0, d);

  float r = sqrt(S(1., y, st.y));
  float cd = abs(st.x - x);
  float trail = S(.23 * r, .15 * r * r, cd);
  float trailFront = S(-.02, .02, st.y - y);
  trail *= trailFront * r * r;

  y = UV.y;
  float trail2 = S(.2 * r, .0, cd);
  float droplets = max(0., (sin(y * (1. - y) * 120.) - st.y)) * trail2 * trailFront * n.z;
  y = fract(y * 10.) + (st.y - .5);
  float dd = length(st - vec2(x, y));
  droplets = S(.3, 0., dd);
  float m = mainDrop + droplets * r * trailFront;

  return vec2(m, trail);
}

float StaticDrops(vec2 uv, float t) {
  uv *= 40.;

  vec2 id = floor(uv);
  uv = fract(uv) - .5;
  vec3 n = N13(id.x * 107.45 + id.y * 3543.654);
  vec2 p = (n.xy - .5) * .7;
  float d = length(uv - p);

  float fade = Saw(.025, fract(t + n.z));
  float c = S(.3, 0., d) * fract(n.z * 10.) * fade;
  return c;
}

vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
  float s = StaticDrops(uv, t) * l0;
  vec2 m1 = DropLayer2(uv, t) * l1;
  vec2 m2 = DropLayer2(uv * 1.85, t) * l2;

  float c = s + m1.x + m2.x;
  c = S(.3, 1., c);

  return vec2(c, max(m1.y * l0, m2.y * l1));
}

vec3 sampleBackdrop(vec2 uv, vec2 normal, float blurStrength) {
  vec2 distortion = normal * blurStrength;
  vec3 center = texture2D(iChannel0, uv + distortion).rgb;
  vec3 sideA = texture2D(iChannel0, uv + distortion * 0.55 + vec2(0.0016, 0.0)).rgb;
  vec3 sideB = texture2D(iChannel0, uv + distortion * 0.55 - vec2(0.0016, 0.0)).rgb;
  vec3 vertical = texture2D(iChannel0, uv + distortion * 0.7 + vec2(0.0, 0.0014)).rgb;
  return center * 0.46 + sideA * 0.18 + sideB * 0.18 + vertical * 0.18;
}

void main(void) {
  vec2 fragCoord = vUv * iResolution.xy;
  vec2 uv = (fragCoord - .5 * iResolution.xy) / iResolution.y;
  vec2 UV = fragCoord / iResolution.xy;
  float T = iGlobalTime;
  float t = T * .2;

  float groove = clamp(grooveIntensity, 0.0, 1.0);
  float rainAmount = clamp(rainBase + groove * rainLift + beatPulse * 0.08, 0.0, 1.0);
  float zoom = 1.0 + sin(T * .17) * 0.025;
  uv *= .78 + zoom * .22;
  UV = (UV - .5) * (.94 + zoom * .06) + .5;

  float staticDrops = S(-.5, 1., rainAmount) * .55;
  float layer1 = S(.15, .7, rainAmount);
  float layer2 = S(.0, .45, rainAmount);
  vec2 c = Drops(uv, t, staticDrops, layer1, layer2);

  vec2 e = vec2(.0015, 0.0);
  float cx = Drops(uv + e, t, staticDrops, layer1, layer2).x;
  float cy = Drops(uv + e.yx, t, staticDrops, layer1, layer2).x;
  vec2 n = vec2(cx - c.x, cy - c.x);

  float distortionStrength = (0.012 + rainAmount * 0.018 + beatPulse * 0.004) * distortionScale;
  vec3 col = sampleBackdrop(UV, n, distortionStrength);

  float dropletGlow = c.x * (0.08 + groove * 0.08 + beatPulse * 0.06);
  vec3 tint = mix(tintLow, tintHigh, groove * 0.45);
  col *= tint;
  col += vec3(0.10, 0.16, 0.20) * dropletGlow;

  vec2 vignetteUv = UV - .5;
  col *= 1.0 - dot(vignetteUv, vignetteUv) * 0.92;
  col = mix(col, col * vec3(0.44, 0.5, 0.58), endingProgress * 0.38);

  gl_FragColor = vec4(col * outputGain, 1.0);
}
`;

export const RAIN_WINDOW_BACKDROP: BackdropModule = {
  id: "rain-window",
  label: "Rain Window",
  description:
    "A moody rain-on-glass backdrop with groove-reactive droplet density and gentle lens distortion.",
  performanceTier: "medium",
  create(context) {
    const variantName =
      typeof context.params.variant === "string" && context.params.variant in RAIN_WINDOW_VARIANTS
        ? context.params.variant
        : "moody";
    const variant = RAIN_WINDOW_VARIANTS[variantName];
    const backdropSource = typeof context.params.backgroundUrl === "string" ? context.params.backgroundUrl : backgroundUrl;
    const resolutionVector = new Vector2(context.engine.getRenderWidth(), context.engine.getRenderHeight());
    const plane = MeshBuilder.CreatePlane("rain-window-plane", { width: 2, height: 2 }, context.scene);
    plane.position.set(0, 0, 9.58);

    const backgroundTexture = new Texture(backdropSource, context.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    backgroundTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
    backgroundTexture.wrapV = Texture.CLAMP_ADDRESSMODE;

    const material = new ShaderMaterial(
      "rain-window-material",
      context.scene,
      {
        vertexSource: RAIN_WINDOW_VERTEX_SHADER,
        fragmentSource: RAIN_WINDOW_FRAGMENT_SHADER,
        spectorName: "rainWindow",
      },
      {
        attributes: ["position", "uv"],
        uniforms: [
          "worldViewProjection",
          "iGlobalTime",
          "iResolution",
          "beatPulse",
          "grooveIntensity",
          "endingProgress",
          "tintLow",
          "tintHigh",
          "outputGain",
          "rainBase",
          "rainLift",
          "distortionScale",
        ],
        samplers: ["iChannel0"],
      },
    );

    material.backFaceCulling = false;
    material.setTexture("iChannel0", backgroundTexture);
    material.setVector3("iResolution", { x: resolutionVector.x, y: resolutionVector.y, z: 1 });
    material.setFloat("iGlobalTime", 0);
    material.setFloat("beatPulse", 0);
    material.setFloat("grooveIntensity", 0);
    material.setFloat("endingProgress", 0);
    material.setVector3("tintLow", new Vector3(variant.tintLow[0], variant.tintLow[1], variant.tintLow[2]));
    material.setVector3("tintHigh", new Vector3(variant.tintHigh[0], variant.tintHigh[1], variant.tintHigh[2]));
    material.setFloat("outputGain", variant.outputGain);
    material.setFloat("rainBase", variant.rainBase);
    material.setFloat("rainLift", variant.rainLift);
    material.setFloat("distortionScale", variant.distortionScale);
    plane.material = material;
    plane.visibility = 0.92;

    const resizePlane = () => {
      const bounds = context.getBounds();
      plane.scaling.set(
        (bounds.right - bounds.left) * 0.78,
        (bounds.top - bounds.bottom) * 0.78,
        1,
      );
      resolutionVector.x = context.engine.getRenderWidth();
      resolutionVector.y = context.engine.getRenderHeight();
      material.setVector3("iResolution", { x: resolutionVector.x, y: resolutionVector.y, z: 1 });
    };

    resizePlane();

    return {
      update(inputs) {
        material.setFloat("iGlobalTime", inputs.elapsedTimeSeconds);
        material.setFloat("beatPulse", inputs.beatPulse);
        material.setFloat("grooveIntensity", inputs.grooveIntensity);
        material.setFloat("endingProgress", inputs.endingProgress);
        plane.visibility = 0.92 - inputs.endingProgress * 0.18;
      },
      resize() {
        resizePlane();
      },
      dispose() {
        plane.dispose();
        material.dispose();
        backgroundTexture.dispose();
      },
    };
  },
};
