# Falling Orchestra — Prototype Brief for Coding Agent

## Goal

Build a small, playable prototype called **Falling Orchestra**.

This is an **interactive musical physics toy / game prototype** where objects fall from the sky, bounce around a 2D playfield, and trigger **quantized musical notes** when they collide with the ground or other musical surfaces.

The prototype should feel:
- playful
- immediate
- musical
- visually clean
- easy to extend

This is **not** a polished product. Prioritize:
1. a tight interactive loop
2. satisfying audiovisual feedback
3. clean, modular code
4. easy tuning of musical and physics parameters

---

## Recommended Tech

Preferred stack: **Babylon.js + TypeScript**

Use Babylon.js even though the game is effectively 2D:
- orthographic camera
- flat sprites / simple meshes
- lightweight physics-style movement implemented manually unless a physics plugin is clearly beneficial

Why Babylon.js:
- I’ve been using it recently
- good browser iteration speed
- easy audio integration
- clean rendering pipeline
- simple deployment

### Acceptable alternative
If you strongly believe Babylon.js is the wrong choice for rapid prototyping, you may use **Phaser + TypeScript** instead, but only if it materially simplifies the implementation. If you switch, explain why in a short note.

Default to **Babylon.js**.

---

## High-Level Concept

The player stands in a small arena / playfield while “musical creatures” or “note blobs” fall from above.

When these objects hit the floor, platforms, bumpers, or other designated surfaces, they trigger notes from a constrained musical scale.

The player can influence the emergent music by:
- moving left/right
- placing or repositioning temporary platforms
- nudging falling objects
- changing the musical mode / root note
- changing object spawn types or density

The result should be a **controlled-chaos generative music experience**.

---

## Prototype Scope

Build a **single-screen prototype** with the following:

### Core features
- 2D playfield rendered in browser
- falling musical objects spawned continuously
- gravity and bouncy collisions
- note playback on impact
- note quantization to a selected scale / mode
- player can move and influence where objects land
- score or “musical satisfaction” system is optional
- simple UI for changing musical settings

### Non-goals
Do **not** spend time on:
- story
- menus beyond a simple start/reset overlay
- advanced art pipeline
- multiplayer
- save/load
- mobile support
- account systems
- content pipeline tooling

---

## MVP Gameplay Loop

1. Objects spawn from the top of the screen at semi-random x positions.
2. They fall under gravity.
3. They bounce when they hit surfaces.
4. Each impact triggers a note.
5. Notes are constrained to a selected root + mode.
6. The player moves around and can place temporary platforms or bumpers to redirect the falling objects.
7. The musical texture evolves as more objects appear and interact.

The first 30 seconds should already feel fun.

---

## Design Pillars

### 1. Musical first
The prototype should sound good even when the player is not especially skilled.

### 2. Emergent but controlled
There should be randomness, but it must be shaped by musical rules and readable physics.

### 3. Immediate interaction
The player should be able to affect the music within seconds.

### 4. Readability
It should be visually obvious:
- what object hit what
- why a note played
- which object maps to which sound family

### 5. Small-scope extensibility
Architect the code so that adding new:
- object types
- scales
- instruments
- surfaces
is straightforward.

---

## Required Systems

## 1. Scene / World
Create a simple single-screen arena:
- floor
- left/right walls
- maybe 2–3 static angled surfaces or optional bumpers
- clean background
- orthographic camera

Visual style:
- minimalist
- abstract
- colorful but not noisy
- readable at a glance

---

## 2. Falling Objects
Implement at least **3 object types**:

### A. Bell Drop
- medium bounce
- bright timbre
- upper register notes

### B. Bass Blob
- heavier
- lower bounce
- bass / marimba / muted synth style notes
- lower register notes

### C. Spark Orb
- small and lively
- high bounce
- short plucky notes
- occasional quick repeated impacts are okay

Each object should have:
- position
- velocity
- radius / size
- bounce coefficient
- note family / instrument
- base pitch range or note lane
- color / visual identity
- cooldown to avoid absurd note spam from micro-collisions

Objects should spawn often enough that the scene becomes musically interesting, but not so often that it turns into unreadable noise.

Good starting target:
- 1 spawn every 0.5–1.25 seconds
- cap active objects at a reasonable number like 20–40

---

## 3. Collision and Note Triggering
A note should trigger when:
- an object hits the floor
- an object hits a musical platform
- optionally object-object collisions if it sounds good

Use a velocity threshold so tiny jitter collisions do not constantly retrigger notes.

Each trigger should:
- choose a scale-constrained note
- vary velocity / volume based on impact strength
- optionally vary pan slightly by horizontal screen position
- emit a short visual pulse

Important: impacts should feel expressive, not random and harsh.

---

## 4. Music System
Implement a simple generative music system with:

### Root note selection
Examples:
- C
- D
- F
- A

### Mode / scale selection
At minimum include:
- major / ionian
- minor / aeolian
- dorian
- mixolydian
- pentatonic major
- pentatonic minor

### Quantization
All notes must be snapped to the selected scale.

### Register mapping
Different object types should prefer different octaves / note ranges.

### Rhythmic feel
If possible, optionally quantize note onset very lightly to a pulse grid, but do **not** introduce enough latency to make impacts feel disconnected.

If that tradeoff feels bad, prioritize **responsive impacts** over rhythmic quantization.

---

## 5. Audio Implementation
Use Web Audio API directly or a lightweight library if useful.

Requirements:
- low-latency playback
- at least 3 distinct synthesized or sample-based sound families
- volume envelope per note
- master volume control
- no harsh clipping when many notes play
- basic limiter/compressor or conservative gain staging if needed

Prefer synthesized sound generation over hunting for lots of assets, unless a few tiny built-in samples accelerate the prototype.

Do not block on perfect sound design. “Clean and pleasant” is enough.

---

## 6. Player Interaction
Implement a controllable player avatar or cursor-agent.

### Minimum controls
- move left/right
- jump is optional
- place a temporary platform or bumper
- reset prototype
- change root note / mode
- tweak spawn rate

### Best interaction idea
Let the player place **1–3 temporary platforms** that:
- last a few seconds, or
- can be repositioned

This turns the player into a kind of conductor shaping the falling orchestra.

If a full avatar complicates things, it is acceptable to use:
- a cursor-driven platform placement tool, or
- a simple paddle-like controllable surface

But preserve the feeling of direct influence.

---

## 7. UI / Debug Controls
Add a small clean overlay with:
- current root note
- current mode
- spawn rate
- active object count
- pause / reset
- mute toggle
- instructions

Helpful extras:
- toggle collision debug
- toggle note labels
- switch between 2–3 spawn patterns
- freeze/unfreeze spawning

A compact debug/tuning panel is welcome.

---

## 8. Juice / Feedback
This prototype lives or dies on feedback.

Every impact should have some combination of:
- squash / stretch or scale pulse
- flash or ring effect
- particle burst
- screen-space pulse on strong impacts
- small note label popup on debug mode

Keep it tasteful.

---

## Suggested Architecture

Use modular TypeScript code with clear separation such as:

- `GameApp`
- `World`
- `Spawner`
- `MusicalObject`
- `CollisionSystem`
- `MusicSystem`
- `ScaleQuantizer`
- `InputController`
- `PlatformTool`
- `UIOverlay`
- `Config`

Prefer readable, editable code over clever abstractions.

Keep tuning constants centralized.

---

## Implementation Notes

### Physics
A fully realistic physics engine is not necessary.
Simple custom 2D physics is acceptable:
- gravity
- integration
- circle vs line / AABB collision
- bounce response
- damping
- boundary collisions

The prototype should feel stable and deterministic enough for play.

### Rendering
Simple circles, capsules, lines, and flat materials are fine.

### Performance
Should run smoothly in a desktop browser.

---

## Tuning Guidelines

Aim for these qualities:
- pleasant density
- not too chaotic
- not too sparse
- enough bounce to create cascades
- low notes feel weighty
- high notes feel sparkly
- different object types clearly audible

Avoid:
- machine-gun retriggering
- dissonant unquantized notes
- muddy low-end overload
- visual clutter
- overly dark or overdesigned visuals

---

## Deliverables

Please produce:

### 1. Working prototype
A browser-runnable prototype using the chosen tech stack.

### 2. Short README
Include:
- how to install/run
- controls
- architecture overview
- known limitations
- next suggested improvements

### 3. Brief build note
Explain in a few bullets:
- why you chose Babylon.js or why you switched
- key design choices
- what you simplified for speed

---

## Nice-to-Have Features
Only do these if the core prototype is already solid:

- different surfaces transpose notes differently
- combo meter for pleasing rhythmic streaks
- “storm intensity” that increases spawn complexity over time
- recording / replay of a short musical session
- background drone or chord bed matching the selected mode
- slow automatic mode changes every minute
- simple procedural drum layer driven by impact density

---

## Success Criteria

I should be able to launch the prototype and within 1–2 minutes feel:

- “this is fun to mess with”
- “my actions shape the music”
- “the system sounds musical instead of random”
- “there’s a clear path to expanding this idea into a bigger game”

---

## Optional Next Steps After MVP
Design the code so the concept could later evolve into one of these:
- sandbox music toy
- score-attack survival mode
- puzzle mode
- platformer-like variant

But do not build those now.

---

## Final Instruction

Bias toward **playable, musical, and elegant** over feature-complete.

If you have to cut scope, preserve these in order:
1. satisfying falling/bouncing interaction
2. good quantized musical output
3. meaningful player influence
4. clear visual feedback
5. extra content

Make something small that feels surprisingly good.
