# Falling Orchestra

Falling Orchestra is a small browser prototype built in Babylon.js + TypeScript. Musical objects fall into a single-screen arena, bounce off the walls, slopes, and the player paddle, and trigger notes snapped to the selected root and mode.

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

Live demo: https://ndxbxrme.github.io/falling-orchestra/

## Design Docs

- [`docs/PROTOTYPE-PLAN.md`](./docs/PROTOTYPE-PLAN.md): original prototype brief
- [`docs/BUILD-NOTES.md`](./docs/BUILD-NOTES.md): implementation notes and tradeoffs
- [`docs/EXPERIENCE-DIRECTION.md`](./docs/EXPERIENCE-DIRECTION.md): blue-sky product and experience direction
- [`docs/SONG-DATA-SCHEMA.md`](./docs/SONG-DATA-SCHEMA.md): first-pass song / album serialization plan

## GitHub Pages

GitHub Pages deploys are wired through GitHub Actions in [`.github/workflows/pages.yml`](./.github/workflows/pages.yml).

- In the repo settings, go to `Pages` and set `Source` to `GitHub Actions`.
- There is no Pages directory to choose when using this setup.
- Pushing a tag like `v0.1.0` will build the app, copy `dist/index.html` to `dist/404.html`, and deploy the `dist` artifact.

Example:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Controls

- `A / D` or `Left / Right`: move the conductor paddle
- `Click` or tap in the arena: wake audio
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
- `src/game/UIOverlay.ts`: DOM-based controls, HUD, start card, and floating note labels
- `src/game/config.ts`: centralized tuning constants, modes, roots, and object definitions

## Content Authoring

Albums and songs now live in packaged content folders under `src/content` rather than being split across unrelated directories.

### Package Layout

```txt
src/content/
  artists/
    <artist-id>/
      artist.ts
  albums/
    <album-id>/
      album.ts
      cover.png
      songs/
        <song-slug>/
          song.ts
          config.ts
          audio/
            *.ogg
```

- `artist.ts`: artist metadata
- `album.ts`: album metadata, theme, cover reference, `songIds`, and recommended song
- `song.ts`: library-facing song manifest
- `config.ts`: low-level `SongConfig` for loops, harmony, spawns, FX, and progression
- `audio/`: loop assets for that song only

### Scaffolder

Use the scaffolder to create new album and song packages:

```bash
npm run scaffold:content -- album \
  --artist-id sector-seven \
  --title "Second Album" \
  --year 2026 \
  --tags "dark,techno"
```

```bash
npm run scaffold:content -- song \
  --album-id sector-seven_second-album \
  --title "New Track" \
  --track-number 1
```

Notes:

- `--dry-run` works before or after the subcommand.
- scaffolded songs default to `hidden`
- scaffolded songs create zero-byte placeholder `01i.ogg` / `01m.ogg` files
- replace placeholder audio before making a song visible

Album scaffolding will:

- create the artist manifest if needed
- create the album package and empty `songs/` folder
- regenerate the content index files

Song scaffolding will:

- create `song.ts`, `config.ts`, and `audio/`
- update the parent album `songIds`
- set `recommendedSongId` if the album does not have one yet
- regenerate song and album index files

### Song Hydration

Once a song package exists and real loop files have been copied into its `audio/` folder, you can hydrate `config.ts` from the clips:

```bash
npm run hydrate:song -- \
  --album-id sector-seven_second-album \
  --song-slug new-track
```

Useful flags:

- `--dry-run`: print the inferred BPM / bar lengths without writing `config.ts`
- `--song-dir`: target a song package directly instead of using `--album-id` + `--song-slug`
- `--bpm-min`, `--bpm-max`, `--bpm-step`: tune the BPM search range

The hydrator currently rewrites:

- `transport.bpm`
- `transport.beatsPerBar`
- `transport.barsPerLoop`
- `grooveLevels`

It leaves `harmonyTimeline`, `impactPalette`, and other hand-authored config sections alone.

### Validation

Validate packaged content with:

```bash
npm run validate:content
```

The validator checks:

- duplicate artist / album / song ids
- bad album or artist references
- missing `song.ts`, `config.ts`, `audio/`, or referenced assets
- duplicate track numbers within an album
- broken `recommendedSongId`
- placeholder zero-byte `.ogg` files

At the moment, loose staging folders without an `album.ts` manifest are reported as warnings rather than errors.

## Known Limitations

- Physics are custom and intentionally simple, so rare edge-case overlaps can still happen under heavy object density.
- Audio uses synthesized Web Audio voices instead of a deeper instrument layer or samples.
- The prototype is tuned for desktop browser play and has no mobile UX pass.
- There is no progression, score system, recording, or content pipeline yet.

## Suggested Next Improvements

- Add distinct musical behavior per surface, not just transposition
- Introduce a soft ambient pad or drone that follows the selected mode
- Add better debug overlays for collision normals, recent notes, and impact energy
- Refine the object-object collision response once the musical tuning is locked
