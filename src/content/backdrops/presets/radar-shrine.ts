import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { BackdropModule } from "../schema";

export const RADAR_SHRINE_BACKDROP: BackdropModule = {
id: "radar-shrine",
label: "Radar Shrine",
description:
"A cold techno radar shrine: concentric surgical rings, rotating targeting arms, and suspended vertical scan panels.",
performanceTier: "medium",
create(context) {
const scene = context.scene;
const bounds = context.getBounds();
const meshes: Mesh[] = [];
const materials: StandardMaterial[] = [];

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

const cyan = makeMaterial("radar-shrine-cyan", "#8cecff", 0.48, 0.72);
const dimCyan = makeMaterial("radar-shrine-dim-cyan", "#4ab8cc", 0.26, 0.34);
const ice = makeMaterial("radar-shrine-ice", "#d8fbff", 0.54, 0.52);
const deep = makeMaterial("radar-shrine-deep", "#061116", 0.08, 0.76);
const panelMat = makeMaterial("radar-shrine-panel", "#78dfff", 0.4, 0.2);
const warning = makeMaterial("radar-shrine-landing", "#bfffff", 0.65, 0.62);

const width = Math.max(18, bounds.right - bounds.left);
const height = Math.max(12, bounds.top - bounds.bottom);
const baseScale = Math.max(width / 28, height / 18);

const altar = MeshBuilder.CreateBox(
  "radar-shrine-altar-slab",
  { width: 18, height: 0.12, depth: 0.08 },
  scene,
);
altar.position.y = -height * 0.22;
altar.position.z = 12.4;
altar.material = deep;
meshes.push(altar);

const rings: Mesh[] = [];
for (let i = 0; i < 5; i += 1) {
  const ring = MeshBuilder.CreateTorus(
    `radar-shrine-ring-${i}`,
    {
      diameter: 4.8 + i * 2.2,
      thickness: i % 2 === 0 ? 0.045 : 0.028,
      tessellation: 96,
    },
    scene,
  );
  ring.rotation.x = Math.PI * 0.5;
  ring.position.z = 12 + i * 0.035;
  ring.material = i === 0 || i === 3 ? cyan : dimCyan;
  rings.push(ring);
  meshes.push(ring);
}

const core = MeshBuilder.CreateTorus(
  "radar-shrine-core-reticle",
  { diameter: 1.15, thickness: 0.06, tessellation: 72 },
  scene,
);
core.rotation.x = Math.PI * 0.5;
core.position.z = 11.85;
core.material = ice;
meshes.push(core);

const arms: Mesh[] = [];
for (let i = 0; i < 4; i += 1) {
  const arm = MeshBuilder.CreateBox(
    `radar-shrine-targeting-arm-${i}`,
    { width: 6.8 - i * 0.72, height: 0.035, depth: 0.035 },
    scene,
  );
  arm.position.z = 11.75 - i * 0.025;
  arm.rotation.z = (Math.PI * i) / 4;
  arm.material = i % 2 === 0 ? cyan : ice;
  arms.push(arm);
  meshes.push(arm);
}

const ticks: Mesh[] = [];
for (let i = 0; i < 12; i += 1) {
  const tick = MeshBuilder.CreateBox(
    `radar-shrine-calibration-tick-${i}`,
    { width: 0.06, height: 0.48, depth: 0.035 },
    scene,
  );
  const angle = (Math.PI * 2 * i) / 12;
  tick.position.x = Math.cos(angle) * 6.95;
  tick.position.y = Math.sin(angle) * 6.95;
  tick.position.z = 11.7;
  tick.rotation.z = angle;
  tick.material = dimCyan;
  ticks.push(tick);
  meshes.push(tick);
}

const panels: Mesh[] = [];
for (let i = 0; i < 7; i += 1) {
  const panel = MeshBuilder.CreatePlane(
    `radar-shrine-scan-panel-${i}`,
    { width: 0.48 + (i % 2) * 0.24, height: 8.5 - Math.abs(i - 3) * 0.75 },
    scene,
  );
  panel.position.x = (i - 3) * 2.15;
  panel.position.y = height * 0.06 + (i % 2 === 0 ? 0.35 : -0.2);
  panel.position.z = 13.1 + i * 0.015;
  panel.material = panelMat;
  panels.push(panel);
  meshes.push(panel);
}

const gate = MeshBuilder.CreateBox(
  "radar-shrine-upper-gate",
  { width: 13.5, height: 0.08, depth: 0.05 },
  scene,
);
gate.position.y = height * 0.3;
gate.position.z = 12.8;
gate.material = warning;
meshes.push(gate);

const applyBounds = (nextWidth: number, nextHeight: number) => {
  const nextScale = Math.max(nextWidth / 28, nextHeight / 18);
  for (let i = 0; i < meshes.length; i += 1) {
    meshes[i].scaling.x = nextScale;
    meshes[i].scaling.y = nextScale;
  }
  altar.position.y = -nextHeight * 0.22;
  gate.position.y = nextHeight * 0.3;
};

applyBounds(width, height);

return {
  update(inputs) {
    const time = inputs.elapsedTimeSeconds;
    const groove = Math.max(0, Math.min(1, inputs.grooveIntensity));
    const beat = Math.max(0, Math.min(1, inputs.beatPulse));
    const landing =
      inputs.transitionState.kind === "grooveLanding"
        ? Math.max(0, Math.min(1, inputs.transitionState.intensity))
        : 0;
    const ending = Math.max(0, Math.min(1, inputs.endingProgress));

    const glow = 0.24 + groove * 0.28 + beat * 0.28 + landing * 0.38;
    cyan.emissiveColor.set(0.55 * glow, 0.93 * glow, glow);
    dimCyan.emissiveColor.set(0.2 * glow, 0.55 * glow, 0.64 * glow);
    ice.emissiveColor.set(0.78 * glow, 0.98 * glow, glow);
    warning.emissiveColor.set(0.75 * glow, glow, glow);

    for (let i = 0; i < rings.length; i += 1) {
      const direction = i % 2 === 0 ? 1 : -1;
      rings[i].rotation.z = time * (0.08 + i * 0.018) * direction;
      const pulseScale = 1 + beat * (0.018 + i * 0.006) + landing * 0.045;
      rings[i].scaling.x = baseScale * pulseScale;
      rings[i].scaling.y = baseScale * pulseScale;
      rings[i].visibility = 1 - ending * (0.2 + i * 0.055);
    }

    core.rotation.z = -time * 0.22;
    core.scaling.x = baseScale * (1 + beat * 0.12 + landing * 0.18);
    core.scaling.y = baseScale * (1 + beat * 0.12 + landing * 0.18);

    for (let i = 0; i < arms.length; i += 1) {
      const direction = i % 2 === 0 ? 1 : -1;
      arms[i].rotation.z =
        (Math.PI * i) / 4 + time * direction * (0.28 + groove * 0.38);
      arms[i].visibility = 0.55 + beat * 0.35 + landing * 0.1 - ending * 0.36;
    }

    for (let i = 0; i < ticks.length; i += 1) {
      ticks[i].visibility =
        0.24 + ((i + Math.floor(time * 10)) % 4 === 0 ? beat * 0.68 : groove * 0.22);
    }

    for (let i = 0; i < panels.length; i += 1) {
      const sweep = Math.sin(time * (0.9 + groove * 0.7) + i * 0.85);
      panels[i].scaling.y = baseScale * (0.88 + sweep * 0.045 + beat * 0.08);
      panels[i].visibility =
        0.23 + Math.max(0, sweep) * 0.22 + beat * 0.16 + landing * 0.18 - ending * 0.28;
      panels[i].position.y =
        height * 0.06 + (i % 2 === 0 ? 0.35 : -0.2) + sweep * 0.16;
    }

    altar.scaling.x = baseScale * (1 + groove * 0.08);
    altar.visibility = 0.68 - ending * 0.24;

    gate.scaling.x = baseScale * (1 + landing * 0.1);
    gate.visibility = 0.28 + beat * 0.22 + landing * 0.42 - ending * 0.3;

    panelMat.alpha = 0.14 + groove * 0.1 + beat * 0.08 + landing * 0.12;
    cyan.alpha = 0.52 + beat * 0.18 + landing * 0.16;
    ice.alpha = 0.38 + beat * 0.26 + landing * 0.2;
  },
  resize(nextBounds) {
    const nextWidth = Math.max(18, nextBounds.right - nextBounds.left);
    const nextHeight = Math.max(12, nextBounds.top - nextBounds.bottom);
    applyBounds(nextWidth, nextHeight);
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