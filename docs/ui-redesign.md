We’re building a Babylon.js rhythm/action game. The screenshot currently uses simple test geometry. Please upgrade the playfield visuals while preserving gameplay positions, collision shapes, timing, and performance.

Goal:
Create a dark 1990s Sheffield techno / Warp Records / Designers Republic-inspired playfield. It should feel like an industrial nightclub machine, not generic cyberpunk.

Important visual direction:
- Paddle becomes a mechanical actuator / audio fader assembly.
- Falling balls become glowing signal packets / radar targets.
- Add thin reticle rings, scan lines, dotted trails, small crosshair ticks, and subtle industrial HUD markings.
- Avoid overloading gameplay readability.
- Keep main gameplay objects abstract and clear.

Babylon.js implementation notes:
- Use MeshBuilder primitives where possible.
- Use TransformNode groups for composed objects.
- Use emissive materials and GlowLayer for neon/glow accents.
- Keep gameplay collision meshes separate from decorative meshes.
- Decorative pieces should follow the existing paddle/ball transforms.
- Add object pooling for ball trails/pulse rings if animated.
- Respect existing beat/groove values; visuals should scale with grooveLevel and beatPulse.

Please implement:
1. `TechnoPaddle`:
   - central circular hub
   - long cyan fader bar
   - black/dark metal end caps
   - small orange/red light modules
   - optional rotating semicircle/radar arc behind it
   - returns a TransformNode with named child meshes

2. `SignalBall`:
   - glowing core sphere/disc
   - outer reticle ring
   - 2–3 thin orbit rings or crosshair ticks
   - optional beat pulse scale animation
   - returns TransformNode

3. `PlayfieldDecor`:
   - side guide rails
   - faint centerline
   - dotted calibration grid
   - transparent radial rings around lower play area
   - very subtle industrial text labels, if text rendering already exists


Constraints:
- Do not rewrite game logic.
- Do not introduce heavy external assets.
- Prefer procedural geometry.
- Keep frame rate stable.
- Make all colors/constants configurable at the top of the module.


The vibe should be: “industrial audio equipment / rave flyer / technical schematic / nightclub lighting rig,” not polished sci-fi spaceship UI.