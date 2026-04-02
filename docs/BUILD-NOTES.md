# Build Notes

- Chosen stack: Babylon.js + TypeScript. The brief explicitly preferred Babylon.js, and it fits this prototype well because an orthographic camera plus flat meshes gives a clean 2D-feeling arena without needing a separate 2D framework.
- Key design choice: the physics are custom rather than engine-driven. That keeps tuning local and readable for gravity, bounce, collision thresholds, cooldowns, and per-surface musical behavior.
- Key design choice: audio is synthesized directly with Web Audio. That avoided blocking on asset hunting while still giving three distinct sound families with low latency and simple dynamic control.
- Key design choice: the UI is DOM-based instead of in-canvas. It is faster to tune, easier to extend, and keeps the playfield visually clear.
- Simplified for speed: temporary platforms are horizontal rather than fully rotatable.
- Simplified for speed: note timing is immediate on impact rather than rhythm-grid quantized.
- Simplified for speed: visuals use flat meshes, pulses, and color identity instead of a more elaborate art pipeline.
