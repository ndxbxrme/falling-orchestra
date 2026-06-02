# Spec Sheet: 90s Sheffield Techno Visualizer (Babylon.js)

This specification defines a modular, performant, and highly atmospheric 3D background scene/visualizer for a rhythm game/experience. The visual aesthetic is inspired by 1990s industrial Sheffield (Warp Records, The Leadmill), featuring a gritty, rain-slicked, brutalist warehouse environment that evolves dynamically across four audio "groove levels."

---

## 1. Scene Architecture & Materials
To optimize performance and eliminate external asset dependencies, all geometry must be generated programmatically.

* **Layout & Scale:** An elongated, modular industrial corridor or warehouse vault (approx. 20m wide, 100m long, 6m high) allowing for an infinite camera fly-through.
* **Geometry:** 
  * Repeating structural concrete pillars (`BABYLON.MeshBuilder.CreateBox`) spaced exactly every 10 meters along the Z-axis.
  * Exposed ceiling infrastructure, such as horizontal metal support beams and HVAC pipes (`BABYLON.MeshBuilder.CreateCylinder`).
* **Materials (PBR):**
  * **Walls/Pillars/Ceiling:** Low-reflectivity concrete texture. Set `roughness = 0.85`, `metallic = 0.10`, and base color to a dark charcoal grey (`Color3(0.08, 0.08, 0.08)`).
  * **Floor:** A wet, rain-slicked concrete slab or asphalt. Set `roughness = 0.15`, `metallic = 0.40`, and specularity to sharply catch and reflect flashing overhead lights.

---

## 2. Atmospherics & Post-Processing
Achieving the lo-fi, underground 90s aesthetic relies heavily on the post-process stack rather than detailed geometry.

* **Exponential Fog:** 
  * `scene.fogMode = BABYLON.Scene.FOGMODE_EXP2`
  * `scene.fogColor = new BABYLON.Color3(0.03, 0.03, 0.04)`
  * Base `scene.fogDensity = 0.03` (modulates with groove level).
* **Film Grain:** Apply a `BABYLON.GrainPostProcess` with `intensity = 0.4` to mimic a gritty CRT monitor, VHS tape, or high-ISO film emulsion.
* **Chromatic Aberration:** Apply a `BABYLON.ChromaticAberrationPostProcess`. Keep `aberrationAmount = 0` by default, but expose it globally to be driven by audio peaks.
* **Rain/Sweat Particles:** A `BABYLON.GPUParticleSystem` emitting from a thin box emitter boundary mapped to the ceiling. Particles should render as fast-falling, semi-translucent grey vertical streaks (`direction1 = new BABYLON.Vector3(-1, -12, 0)`).

---

## 3. Global State & Audio Architecture
Create a global state manager object (`window.raveState`) accessible by both the Web Audio API analyzer loop and the rendering loop.

```javascript
window.raveState = {
  currentGrooveLevel: 1, // Integer: 1, 2, 3, or 4
  quantizedBeatTrigger: false, // Boolean flag flipped true for 1 frame on beat
  audioData: {
    bass: 0.0,   // Normalized float 0.0 - 1.0
    mids: 0.0,   // Normalized float 0.0 - 1.0
    highs: 0.0   // Normalized float 0.0 - 1.0
  }
};
```

---

## 4. Infinite Camera Fly-Through & Looping Logic
* **Camera System:** Use a `BABYLON.FreeCamera` or `BABYLON.TargetCamera` placed down the center of the corridor.
* **Camera Movement:** 
  * **Level 1:** Static position.
  * **Levels 2-4:** Progressively faster continuous forward motion along the Z-axis (`camera.position.z += forwardSpeed`).
* **Infinite Corridor Mechanism:** Implement object pooling for structural elements. When a pair of concrete pillars or a ceiling segment falls more than 20 units behind the camera's Z position, automatically translate its position 80 units forward along the Z-axis.
* **Camera Shake (Bass Displacement):** Inside the rendering loop, apply an offset to the camera's X and Y coordinates using a combination of `Math.sin(time)` and random noise, scaled directly by `window.raveState.audioData.bass` and multiplied by the `currentGrooveLevel`.

---

## 5. Groove Level Progression Rules
Hook an animation/state updating function into `scene.onBeforeRenderObservable` that continuously evaluates `window.raveState` and updates the environment accordingly:

### Groove Level 1: Cold Alleyway / Minimalist Intro
* **Environment:** Low fog density (`0.02`). Rain particle `emitRate` is moderate.
* **Lighting:** Single amber streetlight (`BABYLON.SpotLight`) pointing downwards. Implement a pseudo-random flicker routine using a timed `Math.random()` script to simulate bad wiring.
* **Camera:** Fully static camera tracking the player's UI or interaction box.

### Groove Level 2: Inside the Vault / The Bass Baseline
* **Environment:** Shift fog density to `0.04`. Move camera inside the warehouse structure.
* **Movement:** Begin slow camera progression forward (`forwardSpeed = 0.02`).
* **Lighting:** Turn off the flickering amber streetlight. Turn on 4 dim, deep blue or monochrome grey overhead spotlights pointing straight down.
* **Reactivity:** Pulse the light intensity of the blue spotlights between `0.2` and `0.8`, linked directly to `audioData.bass`.

### Groove Level 3: The Warp Records Era / Lasers & Smoke
* **Environment:** Increase fog density to `0.06` (heavy smoke-machine aesthetic). Double the particle generation rate of the rain/condensation.
* **Movement:** Increase camera speed (`forwardSpeed = 0.05`).
* **Lighting:** Introduce 4 thin geometric cylinders with `BABYLON.StandardMaterial` and an emissive cyan/green color to act as laser beams. 
* **Reactivity:** Sweep the lasers back and forth along their X-rotation using a sine wave. Scale the laser mesh `visibility` or alpha transparency dynamically with `audioData.highs`.

### Groove Level 4: Peak Acid Overdrive / Total Distortion
* **Environment:** Maximize atmosphere. Increase camera speed (`forwardSpeed = 0.09`).
* **Reactivity & Visual Abuse:**
  * Map `audioData.bass` directly to `chromaticAberration.aberrationAmount` (spiking up violently between `10.0` and `30.0` during kicks).
  * If `window.raveState.quantizedBeatTrigger` is true, apply an instantaneous structural position jolt to the camera (simulating an explosive bass thud).
  * Rapidly strobe the emissive intensity of the Level 3 laser geometries and invert or flash the background fog color on peak frequencies.

---

## 6. Code Execution & Architectural Guidelines
* **No Assets:** Do not attempt to load external `.gltf`, `.obj`, or `.babylon` files. All structural meshes must be built via `BABYLON.MeshBuilder`.
* **Clean Loops:** Decouple the user interaction hooks from the environmental visualizer hooks. The visualizer must read state entirely from the `window.raveState` object.
* **Materials Optimization:** Share materials across repeating instances of meshes (pillars, beams) to minimize draw calls and conserve GPU memory.