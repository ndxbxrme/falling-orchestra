import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BackdropModule } from "../schema";

export const SCAFFOLD_TEST_BACKDROP: BackdropModule = {
  id: "scaffold-test",
  label: "Scaffold Test",
  description:
    "A generated backdrop module for testing the scaffold workflow.",
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
