import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BackdropModule } from "../schema";

/**
 * Backdrop preset contract:
 * - `theme.backdropPreset` or `song.backdropPreset` selects this module by `id`.
 * - `theme.backdropParams` and `song.backdropParams` are shallow-merged and exposed as `context.params`.
 *
 * Standard comment format for real presets:
 * - `Variants:` named looks accepted via `backdropParams.variant`
 * - `Overrides:` additional supported `backdropParams.*` keys
 * - `Notes:` optional authoring/runtime caveats
 *
 * Lifecycle rules:
 * - Create all meshes/materials/textures inside `create()`.
 * - Update only your own objects inside `update()`.
 * - Dispose everything in `dispose()`.
 * - If you cache width/height/scale/anchor values from `bounds`, recompute and store them in `resize()`.
 */
export const BACKDROP_TEMPLATE: BackdropModule = {
  id: "template-name",
  label: "Template Name",
  description:
    "Replace this with the visual idea. This file is meant to be handed to an LLM or edited by hand. Keep all meshes/materials created inside create(), update only your own objects, dispose everything in dispose(), and if you derive any width/height/scale/anchor values from bounds make sure resize() recomputes and stores them.",
  performanceTier: "medium",
  create(context) {
    const bounds = context.getBounds();
    let liveWidth = bounds.right - bounds.left;
    let liveHeight = bounds.top - bounds.bottom;
    let liveScale = Math.max(liveWidth / 24, liveHeight / 18);

    const panel = MeshBuilder.CreatePlane("template-panel", {
      width: Math.max(6, liveWidth * 0.4),
      height: Math.max(4, liveHeight * 0.3),
    }, context.scene);
    panel.position.z = 8;

    const panelMaterial = new StandardMaterial("template-panel-material", context.scene);
    panelMaterial.disableLighting = true;
    panelMaterial.diffuseColor = Color3.FromHexString("#7ee9ef");
    panelMaterial.emissiveColor = Color3.FromHexString("#7ee9ef").scale(0.35);
    panelMaterial.alpha = 0.22;
    panel.material = panelMaterial;

    return {
      update(inputs) {
        panel.rotation.z = Math.sin(inputs.elapsedTimeSeconds * 0.3) * 0.08;
        panel.scaling.x = liveScale * (1 + inputs.grooveIntensity * 0.12);
        panel.scaling.y = liveScale * (1 + inputs.beatPulse * 0.08);
        panelMaterial.emissiveColor = Color3.FromHexString("#7ee9ef").scale(
          0.2 +
            inputs.beatPulse * 0.25 +
            (inputs.transitionState.kind === "grooveLanding" ? inputs.transitionState.intensity * 0.4 : 0),
        );
        panel.visibility = 1 - inputs.endingProgress * 0.24;
      },
      resize(nextBounds) {
        liveWidth = nextBounds.right - nextBounds.left;
        liveHeight = nextBounds.top - nextBounds.bottom;
        liveScale = Math.max(liveWidth / 24, liveHeight / 18);
      },
      dispose() {
        panel.dispose();
        panelMaterial.dispose();
      },
    };
  },
};
