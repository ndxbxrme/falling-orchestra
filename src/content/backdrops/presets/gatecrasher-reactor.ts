import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { BackdropModule } from "../schema";

/**
 * Variants:
 * - `cryo-core`
 * - `ultraviolet`
 * - `toxic-teal`
 * - `overload`
 *
 * Overrides:
 * - `backdropParams.variant`
 * - `backdropParams.brightnessScale`
 * - `backdropParams.ringSpeedScale`
 *
 * Notes:
 * - The numeric overrides are intended as small trims on top of a named variant.
 */
type GatecrasherVariant = {
  steel: string;
  deepBlue: string;
  reactorBlue: string;
  iceWhite: string;
  acid: string;
  shadowCyan: string;
  brightnessScale: number;
  ringSpeedScale: number;
};

const GATECRASHER_VARIANTS: Record<string, GatecrasherVariant> = {
  "cryo-core": {
    steel: "#102029",
    deepBlue: "#07131d",
    reactorBlue: "#76e8ff",
    iceWhite: "#d8fbff",
    acid: "#b7ffef",
    shadowCyan: "#2a8597",
    brightnessScale: 1,
    ringSpeedScale: 1,
  },
  ultraviolet: {
    steel: "#1a1228",
    deepBlue: "#0a0818",
    reactorBlue: "#bf86ff",
    iceWhite: "#f3dcff",
    acid: "#f38cff",
    shadowCyan: "#6d4ac7",
    brightnessScale: 0.98,
    ringSpeedScale: 1.08,
  },
  "toxic-teal": {
    steel: "#0f231f",
    deepBlue: "#061714",
    reactorBlue: "#66ffd7",
    iceWhite: "#d8fff6",
    acid: "#b8ff8b",
    shadowCyan: "#199c80",
    brightnessScale: 1.02,
    ringSpeedScale: 1.04,
  },
  overload: {
    steel: "#26140f",
    deepBlue: "#1b0907",
    reactorBlue: "#ff996b",
    iceWhite: "#ffe4d8",
    acid: "#ffd36b",
    shadowCyan: "#b64f37",
    brightnessScale: 1.08,
    ringSpeedScale: 1.14,
  },
};

export const GATECRASHER_REACTOR_BACKDROP: BackdropModule = {
id: "gatecrasher-reactor",
label: "Gatecrasher Reactor",
description:
"A cold fusion chamber backdrop with nested reactor rings, containment arms, cooling fins, and an end-song ignition bloom.",
performanceTier: "medium",
create(context) {
const scene = context.scene;
const bounds = context.getBounds();
const meshes: Mesh[] = [];
const materials: StandardMaterial[] = [];
const variantName =
  typeof context.params.variant === "string" && context.params.variant in GATECRASHER_VARIANTS
    ? context.params.variant
    : "cryo-core";
const variant = GATECRASHER_VARIANTS[variantName];
const brightnessScale =
  typeof context.params.brightnessScale === "number"
    ? context.params.brightnessScale
    : variant.brightnessScale;
const ringSpeedScale =
  typeof context.params.ringSpeedScale === "number"
    ? context.params.ringSpeedScale
    : variant.ringSpeedScale;

const makeMaterial = (
  name: string,
  color: string,
  emissiveScale: number,
  alpha: number,
) => {
  const material = new StandardMaterial(name, scene);
  const base = Color3.FromHexString(color);
  material.disableLighting = true;
  material.diffuseColor.set(base.r, base.g, base.b);
  material.emissiveColor.set(
    base.r * emissiveScale,
    base.g * emissiveScale,
    base.b * emissiveScale,
  );
  material.alpha = alpha;
  materials.push(material);
  return material;
};

const steel = makeMaterial("gatecrasher-reactor-steel", variant.steel, 0.1, 0.86);
const deepBlue = makeMaterial("gatecrasher-reactor-deep-blue", variant.deepBlue, 0.08, 0.9);
const reactorBlue = makeMaterial("gatecrasher-reactor-blue", variant.reactorBlue, 0.44, 0.68);
const iceWhite = makeMaterial("gatecrasher-reactor-ice-white", variant.iceWhite, 0.52, 0.56);
const acid = makeMaterial("gatecrasher-reactor-acid", variant.acid, 0.45, 0.42);
const shadowCyan = makeMaterial("gatecrasher-reactor-shadow-cyan", variant.shadowCyan, 0.24, 0.34);

let width = Math.max(18, bounds.right - bounds.left);
let height = Math.max(12, bounds.top - bounds.bottom);
let baseScale = Math.max(width / 30, height / 20);

const chamber = MeshBuilder.CreateBox(
  "gatecrasher-reactor-chamber-wall",
  { width: 18.5, height: 10.5, depth: 0.08 },
  scene,
);
chamber.position.z = 13.4;
chamber.material = deepBlue;
meshes.push(chamber);

const rings: Mesh[] = [];
for (let i = 0; i < 5; i += 1) {
  const ring = MeshBuilder.CreateTorus(
    `gatecrasher-reactor-ring-${i}`,
    {
      diameter: 3.2 + i * 1.85,
      thickness: i === 2 ? 0.075 : 0.045,
      tessellation: 96,
    },
    scene,
  );
  ring.rotation.x = Math.PI * 0.5;
  ring.position.z = 11.8 - i * 0.035;
  ring.material = i % 2 === 0 ? reactorBlue : shadowCyan;
  rings.push(ring);
  meshes.push(ring);
}

const core = MeshBuilder.CreateSphere(
  "gatecrasher-reactor-core",
  { diameter: 0.72, segments: 24 },
  scene,
);
core.position.z = 11.45;
core.material = iceWhite;
meshes.push(core);

const halo = MeshBuilder.CreateTorus(
  "gatecrasher-reactor-core-halo",
  { diameter: 1.35, thickness: 0.035, tessellation: 72 },
  scene,
);
halo.rotation.x = Math.PI * 0.5;
halo.position.z = 11.42;
halo.material = acid;
meshes.push(halo);

const containmentArms: Mesh[] = [];
for (let i = 0; i < 6; i += 1) {
  const arm = MeshBuilder.CreateBox(
    `gatecrasher-reactor-containment-arm-${i}`,
    { width: 7.8, height: 0.065, depth: 0.06 },
    scene,
  );
  arm.rotation.z = (Math.PI * i) / 6;
  arm.position.z = 11.35 - i * 0.02;
  arm.material = i % 2 === 0 ? reactorBlue : iceWhite;
  containmentArms.push(arm);
  meshes.push(arm);
}

const coolingFins: Mesh[] = [];
for (let i = 0; i < 10; i += 1) {
  const leftFin = MeshBuilder.CreateBox(
    `gatecrasher-reactor-left-cooling-fin-${i}`,
    { width: 1.8, height: 0.13, depth: 0.06 },
    scene,
  );
  leftFin.position.x = -7.7;
  leftFin.position.y = -4.25 + i * 0.95;
  leftFin.position.z = 12.2 + i * 0.01;
  leftFin.material = steel;
  coolingFins.push(leftFin);
  meshes.push(leftFin);

  const rightFin = MeshBuilder.CreateBox(
    `gatecrasher-reactor-right-cooling-fin-${i}`,
    { width: 1.8, height: 0.13, depth: 0.06 },
    scene,
  );
  rightFin.position.x = 7.7;
  rightFin.position.y = -4.25 + i * 0.95;
  rightFin.position.z = 12.2 + i * 0.01;
  rightFin.material = steel;
  coolingFins.push(rightFin);
  meshes.push(rightFin);
}

const verticalStruts: Mesh[] = [];
for (let i = 0; i < 5; i += 1) {
  const strut = MeshBuilder.CreateBox(
    `gatecrasher-reactor-vertical-strut-${i}`,
    { width: 0.08, height: 10.4, depth: 0.05 },
    scene,
  );
  strut.position.x = -6 + i * 3;
  strut.position.z = 12.95;
  strut.material = shadowCyan;
  verticalStruts.push(strut);
  meshes.push(strut);
}

const lowerDeck = MeshBuilder.CreateBox(
  "gatecrasher-reactor-lower-deck",
  { width: 19.5, height: 0.18, depth: 0.08 },
  scene,
);
lowerDeck.position.y = -5.55;
lowerDeck.position.z = 12.45;
lowerDeck.material = steel;
meshes.push(lowerDeck);

const upperDeck = MeshBuilder.CreateBox(
  "gatecrasher-reactor-upper-deck",
  { width: 16.5, height: 0.1, depth: 0.06 },
  scene,
);
upperDeck.position.y = 5.35;
upperDeck.position.z = 12.55;
upperDeck.material = shadowCyan;
meshes.push(upperDeck);

const applyBounds = (nextWidth: number, nextHeight: number) => {
  width = Math.max(18, nextWidth);
  height = Math.max(12, nextHeight);
  baseScale = Math.max(width / 30, height / 20);

  for (let i = 0; i < meshes.length; i += 1) {
    meshes[i].scaling.x = baseScale;
    meshes[i].scaling.y = baseScale;
  }

  lowerDeck.position.y = -height * 0.31;
  upperDeck.position.y = height * 0.3;
};

applyBounds(width, height);

return {
  update(inputs) {
    const time = inputs.elapsedTimeSeconds;
    const groove = Math.max(0, Math.min(1, inputs.grooveIntensity));
    const beat = Math.max(0, Math.min(1, inputs.beatPulse));
    const ending = Math.max(0, Math.min(1, inputs.endingProgress));
    const transitionState = inputs.transitionState as {
      kind: string;
      intensity?: number;
    };
    const landing =
      transitionState.kind === "grooveLanding"
        ? Math.max(0, Math.min(1, transitionState.intensity ?? 1))
        : 0;

    const ignition = Math.max(groove, ending);
    const glow =
      (0.22 + groove * 0.3 + beat * 0.28 + landing * 0.34 + ending * 0.48) *
      brightnessScale;

    reactorBlue.emissiveColor.set(0.32 * glow, 0.78 * glow, glow);
    shadowCyan.emissiveColor.set(0.12 * glow, 0.42 * glow, 0.5 * glow);
    iceWhite.emissiveColor.set(0.78 * glow, 0.98 * glow, glow);
    acid.emissiveColor.set(0.58 * glow, glow, 0.86 * glow);
    steel.emissiveColor.set(0.025 + groove * 0.025, 0.055 + groove * 0.04, 0.07 + groove * 0.06);

    chamber.visibility = 0.58 + groove * 0.12 - ending * 0.18;

    for (let i = 0; i < rings.length; i += 1) {
      const direction = i % 2 === 0 ? 1 : -1;
      const pulse = 1 + beat * (0.018 + i * 0.008) + landing * 0.045 + ending * 0.035;
      rings[i].rotation.z =
        time * direction * (0.08 + i * 0.025 + groove * 0.075) * ringSpeedScale;
      rings[i].scaling.x = baseScale * pulse;
      rings[i].scaling.y = baseScale * pulse;
      rings[i].visibility = 0.64 + groove * 0.18 + beat * 0.12 - ending * i * 0.025;
    }

    core.scaling.x = baseScale * (1 + beat * 0.22 + landing * 0.34 + ending * 0.55);
    core.scaling.y = baseScale * (1 + beat * 0.22 + landing * 0.34 + ending * 0.55);
    core.scaling.z = baseScale * (1 + beat * 0.22 + landing * 0.34 + ending * 0.55);
    core.visibility = 0.36 + ignition * 0.58 + beat * 0.18;

    halo.rotation.z = -time * (0.34 + groove * 0.42);
    halo.scaling.x = baseScale * (1 + beat * 0.16 + landing * 0.28 + ending * 0.42);
    halo.scaling.y = baseScale * (1 + beat * 0.16 + landing * 0.28 + ending * 0.42);
    halo.visibility = 0.4 + groove * 0.28 + beat * 0.18 + ending * 0.26;

    for (let i = 0; i < containmentArms.length; i += 1) {
      const direction = i % 2 === 0 ? 1 : -1;
      containmentArms[i].rotation.z =
        (Math.PI * i) / 6 +
        direction * time * (0.05 + groove * 0.18 + ending * 0.28) * ringSpeedScale;
      containmentArms[i].visibility =
        0.42 + groove * 0.2 + beat * 0.2 + landing * 0.16 + ending * 0.12;
      containmentArms[i].scaling.x = baseScale * (0.82 + groove * 0.16 + beat * 0.05);
    }

    for (let i = 0; i < coolingFins.length; i += 1) {
      const shimmer = Math.sin(time * 2.2 + i * 0.7);
      coolingFins[i].scaling.x = baseScale * (0.92 + groove * 0.08 + Math.max(0, shimmer) * beat * 0.08);
      coolingFins[i].visibility = 0.48 + groove * 0.18 + Math.max(0, shimmer) * 0.12;
    }

    for (let i = 0; i < verticalStruts.length; i += 1) {
      const scan = Math.sin(time * (0.9 + groove * 0.8) + i * 1.35);
      verticalStruts[i].visibility =
        0.22 + Math.max(0, scan) * 0.26 + beat * 0.12 + landing * 0.18;
      verticalStruts[i].scaling.y = baseScale * (0.88 + Math.max(0, scan) * 0.16 + ending * 0.1);
    }

    lowerDeck.scaling.x = baseScale * (1 + groove * 0.05 + landing * 0.04);
    upperDeck.scaling.x = baseScale * (1 + beat * 0.035 + ending * 0.08);
    lowerDeck.visibility = 0.74 - ending * 0.16;
    upperDeck.visibility = 0.36 + groove * 0.16 + beat * 0.12;

    reactorBlue.alpha = 0.5 + beat * 0.18 + landing * 0.14 + ending * 0.12;
    iceWhite.alpha = 0.38 + beat * 0.22 + landing * 0.22 + ending * 0.24;
    acid.alpha = 0.26 + groove * 0.12 + beat * 0.16 + ending * 0.24;
    shadowCyan.alpha = 0.26 + groove * 0.12 + beat * 0.08;
  },
  resize(nextBounds) {
    applyBounds(nextBounds.right - nextBounds.left, nextBounds.top - nextBounds.bottom);
  },
  dispose() {
    for (let i = 0; i < meshes.length; i += 1) {
      meshes[i].dispose();
    }
    for (let i = 0; i < materials.length; i += 1) {
      materials[i].dispose();
    }
  },
};
},
};
