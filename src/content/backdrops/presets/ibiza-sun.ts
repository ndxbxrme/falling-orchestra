import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { BackdropModule } from "../schema";

/**
 * Variants:
 * - `gold`
 * - `peach`
 * - `violet`
 * - `teal-dusk`
 *
 * Overrides:
 * - `backdropParams.variant`
 * - `backdropParams.baseBrightness`
 * - `backdropParams.speedScale`
 * - `backdropParams.waveScale`
 *
 * Notes:
 * - Intended for warm Balearic / sunset material.
 * - Numeric overrides are trims on top of a named variant, not a full parameter surface.
 */
type IbizaSunVariant = {
  paletteA: [number, number, number];
  paletteB: [number, number, number];
  paletteC: [number, number, number];
  paletteD: [number, number, number];
  ringPaletteA: [number, number, number];
  ringPaletteB: [number, number, number];
  ringPaletteC: [number, number, number];
  ringPaletteD: [number, number, number];
  baseBrightness: number;
  speedScale: number;
  waveScale: number;
};

const IBIZA_SUN_VARIANTS: Record<string, IbizaSunVariant> = {
  gold: {
    paletteA: [0.5, 0.38, 0.26],
    paletteB: [0.5, 0.35, 0.25],
    paletteC: [1, 1, 1],
    paletteD: [0, 0.12, 0.25],
    ringPaletteA: [0.742702, 0.908877, 0.959831],
    ringPaletteB: [-0.711, 0.275, -0.052],
    ringPaletteC: [1, 1.855, 1],
    ringPaletteD: [0.18, 0.091, 0.38],
    baseBrightness: 0.78,
    speedScale: 1,
    waveScale: 1,
  },
  peach: {
    paletteA: [0.58, 0.4, 0.31],
    paletteB: [0.45, 0.29, 0.22],
    paletteC: [1, 1, 1],
    paletteD: [0.02, 0.08, 0.19],
    ringPaletteA: [0.95, 0.84, 0.78],
    ringPaletteB: [-0.36, 0.11, 0.08],
    ringPaletteC: [1, 1.64, 1],
    ringPaletteD: [0.1, 0.07, 0.22],
    baseBrightness: 0.8,
    speedScale: 0.92,
    waveScale: 0.9,
  },
  violet: {
    paletteA: [0.36, 0.23, 0.34],
    paletteB: [0.32, 0.24, 0.35],
    paletteC: [1, 1, 1],
    paletteD: [0.11, 0.2, 0.38],
    ringPaletteA: [0.79, 0.76, 0.96],
    ringPaletteB: [-0.34, 0.03, 0.02],
    ringPaletteC: [1, 1.4, 1],
    ringPaletteD: [0.18, 0.11, 0.44],
    baseBrightness: 0.76,
    speedScale: 1.06,
    waveScale: 1.08,
  },
  "teal-dusk": {
    paletteA: [0.28, 0.34, 0.34],
    paletteB: [0.28, 0.26, 0.21],
    paletteC: [1, 1, 1],
    paletteD: [0.2, 0.1, 0.24],
    ringPaletteA: [0.71, 0.92, 0.9],
    ringPaletteB: [-0.42, 0.18, -0.02],
    ringPaletteC: [1, 1.74, 1],
    ringPaletteD: [0.12, 0.08, 0.28],
    baseBrightness: 0.74,
    speedScale: 0.98,
    waveScale: 1.04,
  },
};

const readNumberParam = (
  params: Record<string, string | number | boolean>,
  key: string,
  fallback: number,
): number => (typeof params[key] === "number" ? params[key] : fallback);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const IBIZA_SUN_VERTEX_SHADER = `
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

const IBIZA_SUN_FRAGMENT_SHADER = `
precision highp float;

uniform vec3 iResolution;
uniform float iTime;
uniform float grooveIntensity;
uniform float beatPulse;
uniform float endingProgress;
uniform float landingPulse;
uniform float baseBrightness;
uniform float speedScale;
uniform float waveScale;
uniform vec3 paletteA;
uniform vec3 paletteB;
uniform vec3 paletteC;
uniform vec3 paletteD;
uniform vec3 ringPaletteA;
uniform vec3 ringPaletteB;
uniform vec3 ringPaletteC;
uniform vec3 ringPaletteD;
varying vec2 vUv;

#define R(a) mat2(cos((a) + vec4(0.0, 33.0, 11.0, 0.0)))

vec3 palette(float i) {
  return paletteA + paletteB * cos(6.2831853 * (paletteC * i + paletteD));
}

vec3 palette2(float i) {
  return ringPaletteA + ringPaletteB * cos(6.2831853 * (ringPaletteC * i + ringPaletteD));
}

void main(void) {
  vec2 fragCoord = vUv * iResolution.xy;
  vec2 u = fragCoord.xy;
  vec2 uv = (u - 0.5 * iResolution.xy + 0.5) / iResolution.y;

  float groove = clamp(grooveIntensity, 0.0, 1.0);
  float beat = clamp(beatPulse, 0.0, 1.0);
  float ending = clamp(endingProgress, 0.0, 1.0);
  float landing = clamp(landingPulse, 0.0, 1.0);

  float i = 0.0;
  float s = 0.0;
  float t = iTime * (0.02 * speedScale + groove * 0.012 + beat * 0.003);
  vec3 p = vec3(0.0);
  vec3 d = normalize(vec3(2.0 * u - iResolution.xy, iResolution.y * (0.82 - groove * 0.1)));
  vec4 fragColor = vec4(0.0);

  p.z = t;
  for (i = 0.0; i < 20.0; i++) {
    p.xy *= R(-p.z * 0.01 - t * 0.05);
    s = 0.6;
    s = max(s, 4.0 * (-length(p.xy) + 10.0));
    s += abs(
      p.y * 0.004 +
      sin(t - p.x * 0.5) * (0.9 * waveScale + groove * 0.18) +
      1.0
    );
    p += d * s;
    fragColor += 1.0 / max(0.001, (s * 0.2));
  }

  float pulse = landing * 0.35 + beat * 0.08;
  float radius = length(uv);
  vec3 tunnelColor = palette(length(p) / (abs(sin(iTime * 0.02) * (50.0 + groove * 18.0)) + 6.0));
  vec3 vignetteColor = palette2(radius - 0.23 + groove * 0.08);
  fragColor *= vec4(tunnelColor, 1.0);
  fragColor /= 50.0;
  fragColor *= 1.22 - radius;
  fragColor.rgb = mix(fragColor.rgb, vignetteColor, 1.0 - smoothstep(0.01, 0.95, radius));
  fragColor.rgb = tanh(fragColor.rgb + fragColor.rgb);

  float exposure = mix(baseBrightness * 0.58, baseBrightness, groove);
  exposure += pulse;
  exposure = mix(exposure, exposure * 0.62, ending * 0.8);
  fragColor.rgb *= exposure;

  gl_FragColor = vec4(fragColor.rgb, 1.0);
}
`;

export const IBIZA_SUN_BACKDROP: BackdropModule = {
  id: "ibiza-sun",
  label: "Ibiza Sun",
  description: "A warm Balearic tunnel of sunset bands and radiating rings that brightens with the groove.",
  performanceTier: "medium",
  create(context) {
    const variantName =
      typeof context.params.variant === "string" && context.params.variant in IBIZA_SUN_VARIANTS
        ? context.params.variant
        : "gold";
    const variant = IBIZA_SUN_VARIANTS[variantName];

    const plane = MeshBuilder.CreatePlane("ibiza-sun-plane", { width: 2, height: 2 }, context.scene);
    plane.position.set(0, 0, 9.56);

    const material = new ShaderMaterial(
      "ibiza-sun-material",
      context.scene,
      {
        vertexSource: IBIZA_SUN_VERTEX_SHADER,
        fragmentSource: IBIZA_SUN_FRAGMENT_SHADER,
        spectorName: "ibizaSun",
      },
      {
        attributes: ["position", "uv"],
        uniforms: [
          "worldViewProjection",
          "iResolution",
          "iTime",
          "grooveIntensity",
          "beatPulse",
          "endingProgress",
          "landingPulse",
          "baseBrightness",
          "speedScale",
          "waveScale",
          "paletteA",
          "paletteB",
          "paletteC",
          "paletteD",
          "ringPaletteA",
          "ringPaletteB",
          "ringPaletteC",
          "ringPaletteD",
        ],
      },
    );

    material.backFaceCulling = false;
    material.setFloat("iTime", 0);
    material.setFloat("grooveIntensity", 0);
    material.setFloat("beatPulse", 0);
    material.setFloat("endingProgress", 0);
    material.setFloat("landingPulse", 0);
    material.setFloat("baseBrightness", clamp(readNumberParam(context.params, "baseBrightness", variant.baseBrightness), 0.1, 1.4));
    material.setFloat("speedScale", clamp(readNumberParam(context.params, "speedScale", variant.speedScale), 0.2, 2.5));
    material.setFloat("waveScale", clamp(readNumberParam(context.params, "waveScale", variant.waveScale), 0.2, 2.5));
    material.setVector3("paletteA", new Vector3(...variant.paletteA));
    material.setVector3("paletteB", new Vector3(...variant.paletteB));
    material.setVector3("paletteC", new Vector3(...variant.paletteC));
    material.setVector3("paletteD", new Vector3(...variant.paletteD));
    material.setVector3("ringPaletteA", new Vector3(...variant.ringPaletteA));
    material.setVector3("ringPaletteB", new Vector3(...variant.ringPaletteB));
    material.setVector3("ringPaletteC", new Vector3(...variant.ringPaletteC));
    material.setVector3("ringPaletteD", new Vector3(...variant.ringPaletteD));
    plane.material = material;
    plane.visibility = 0.95;

    const resizePlane = () => {
      const bounds = context.getBounds();
      plane.scaling.set(
        (bounds.right - bounds.left) * 0.82,
        (bounds.top - bounds.bottom) * 0.82,
        1,
      );
      material.setVector3("iResolution", new Vector3(context.engine.getRenderWidth(), context.engine.getRenderHeight(), 1));
    };

    resizePlane();

    let landingPulse = 0;
    let wasLanding = false;
    let lastLandingLevel = -1;

    return {
      update(inputs) {
        if (inputs.transitionState.kind === "grooveLanding") {
          if (!wasLanding || inputs.transitionState.level !== lastLandingLevel) {
            lastLandingLevel = inputs.transitionState.level;
            landingPulse = 1;
          }
        }
        wasLanding = inputs.transitionState.kind === "grooveLanding";
        landingPulse = Math.max(0, landingPulse - inputs.deltaTimeSeconds * 2.6);

        material.setFloat("iTime", inputs.elapsedTimeSeconds);
        material.setFloat("grooveIntensity", inputs.grooveIntensity);
        material.setFloat("beatPulse", inputs.beatPulse);
        material.setFloat("endingProgress", inputs.endingProgress);
        material.setFloat("landingPulse", landingPulse);
        plane.visibility = 0.95 - inputs.endingProgress * 0.16;
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
