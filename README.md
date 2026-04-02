# Falling Orchestra

Falling Orchestra is a small browser prototype built in Babylon.js + TypeScript. Musical objects fall into a single-screen arena, bounce off the floor, slopes, the player paddle, and temporary platforms, and trigger notes snapped to the selected root and mode.

## Install and Run

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
npm run preview
```

## Controls

- `A / D` or `Left / Right`: move the conductor paddle
- `Click` in the arena: place a temporary platform
- `P`: pause / resume
- `R`: reset the prototype
- `M`: mute / unmute
- UI overlay: change root note, mode, spawn cadence, spawn pattern, master volume, and debug note labels

## Architecture Overview

- `src/game/GameApp.ts`: top-level orchestration for the main loop, settings, and UI wiring
- `src/game/World.ts`: Babylon scene creation, object rendering, custom 2D-style physics, collisions, and impact pulse visuals
- `src/game/Spawner.ts`: spawn timing plus rain / lanes / swing patterns
- `src/game/MusicSystem.ts`: Web Audio synth voices, scale quantization, master gain, and compression
- `src/game/ScaleQuantizer.ts`: snaps candidate pitches to the active root and mode
- `src/game/InputController.ts`: keyboard input and quick commands
- `src/game/PlatformTool.ts`: temporary platform placement and expiry
- `src/game/UIOverlay.ts`: DOM-based controls, HUD, start card, and floating note labels
- `src/game/config.ts`: centralized tuning constants, modes, roots, and object definitions

## Known Limitations

- Physics are custom and intentionally simple, so rare edge-case overlaps can still happen under heavy object density.
- Audio uses synthesized Web Audio voices instead of a deeper instrument layer or samples.
- The prototype is tuned for desktop browser play and has no mobile UX pass.
- There is no progression, score system, recording, or content pipeline yet.

## Suggested Next Improvements

- Add distinct musical behavior per surface, not just transposition
- Introduce a soft ambient pad or drone that follows the selected mode
- Expand the player toolset with angled bumpers or draggable platforms
- Add better debug overlays for collision normals, recent notes, and impact energy
- Refine the object-object collision response once the musical tuning is locked
