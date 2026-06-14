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

Backdrop presets can also be scaffolded:

```bash
npm run scaffold:backdrop -- --name "Radar Shrine"
```

Notes:

- `--dry-run` works before or after the subcommand.
- scaffolded songs default to `hidden`
- scaffolded songs create zero-byte placeholder `01i.ogg` / `01m.ogg` files
- replace placeholder audio before making a song visible
- scaffolded backdrops are created from `src/content/backdrops/templates/backdrop-template.ts`
- scaffolded backdrops are auto-registered in `src/content/backdrops/registry.ts`

Album scaffolding will:

- create the artist manifest if needed
- create the album package and empty `songs/` folder
- regenerate the content index files

Song scaffolding will:

- create `song.ts`, `config.ts`, and `audio/`
- update the parent album `songIds`
- set `recommendedSongId` if the album does not have one yet
- regenerate song and album index files

Backdrop scaffolding will:

- create `src/content/backdrops/presets/<backdrop-id>.ts`
- regenerate `src/content/backdrops/registry.ts`
- regenerate `src/content/backdrops/index.ts`

To use a backdrop in an album, set the album theme’s `backdropPreset` to the scaffolded backdrop id:

```ts
theme: {
  // ...
  backdropPreset: "radar-shrine",
}
```

### Album Cover Optimization

Album covers are imported directly by the library and end-screen UI, so oversized source art will hurt mobile boot and scrolling.

Use the destructive optimizer to convert packaged album art to `cover.webp`, resize it, and rewrite each album manifest import:

```bash
npm run optimize:cover-art
```

Useful flags:

- `--dry-run`: show what would be converted without touching files
- `--album-id <id>`: limit the run to one or more albums
- `--max-size <px>`: clamp the longest edge, default `1280`
- `--quality <0-100>`: WebP quality, default `82`

Example:

```bash
npm run optimize:cover-art -- --album-id sector-seven_artificial-heat --max-size 1024
```

Notes:

- this script is intentionally destructive and will delete the previous cover source after creating `cover.webp`
- keep your original artwork elsewhere if you want a master copy
- `ffmpeg` must be available on your machine

### Song Preview Rendering

You can now render offline song previews using the same structure as the in-library preview player:

- one `intro` per groove level
- three `main` loops per groove level
- final ending intro included if the song has one

Render a whole album:

```bash
npm run render:song-preview -- --album-id sector-seven_artificial-heat
```

Render one song:

```bash
npm run render:song-preview -- --album-id sector-seven_artificial-heat --song-slug burning
```

Useful flags:

- `--output-root <dir>`: defaults to `tmp/rendered-previews`
- `--main-repeats <n>`: defaults to `3`
- `--format wav|mp3`: defaults to `wav`
- `--dry-run`: print the planned clip sequence without rendering

Notes:

- this script reads the packaged `config.ts` files, not the browser runtime
- it trims each clip to its authored bar duration before concatenating
- `ffmpeg` must be available on your machine

### Local Authoring API

The browser authoring tool can now talk to a lightweight local Python API so it can write directly to packaged `song.ts` and `config.ts` files.

Run it in a second terminal:

```bash
npm run authoring:api
```

It listens on:

```txt
http://127.0.0.1:8765
```

Then open the authoring tool as usual:

```txt
http://localhost:5177/?tool=authoring
```

When the API is connected, Harmony Studio can now:

- save `harmonyTimeline` directly to the selected song’s `config.ts`
- save `grooveChangeAfterBars` for the selected transition clip
- save per-song `backdropPreset` / `backdropParams` to `song.ts`
- trigger album import/bootstrap endpoints programmatically

Notes:

- if the API is offline, `Save to config.ts` falls back to the older file-handle binding flow
- landing-bar saving and song-backdrop saving require the local API
- the current API is intentionally narrow and focused on the highest-friction edits

### Album Import Bootstrap

There is now a draft import pipeline for taking a prepared source folder of loop files and turning it into a packaged in-game album.

The importer expects either:

1. an `album.json` manifest plus referenced audio/assets
2. or a source folder full of numbered song directories (`1/`, `2/`, `3/`...) which you bootstrap into an `album.json` first

Bootstrap a draft manifest from numbered folders:

```bash
npm run import:album -- \
  --source-dir "/mnt/d/Downloads/falling orchestra audio/subterranean/2" \
  --bootstrap-manifest \
  --artist-id subterranean \
  --artist-name "Subterranean" \
  --album-title "Album 2"
```

That writes `album.json` into the source folder with placeholder song titles like `Track 1`, `Track 2`, etc. Edit that file, then run the real import:

```bash
npm run import:album -- \
  --source-dir "/mnt/d/Downloads/falling orchestra audio/subterranean/2"
```

Useful flags:

- `--dry-run`: print the planned import without writing files
- `--no-hydrate`: scaffold and copy audio, but skip groove hydration

`album.json` shape:

```json
{
  "artistId": "subterranean",
  "artistName": "Subterranean",
  "albumId": "subterranean_album-2",
  "title": "Album 2",
  "year": 2026,
  "description": "",
  "sortOrder": 999,
  "availability": "hidden",
  "tags": [],
  "theme": {
    "accent": "#7ee9ef",
    "accentSoft": "#213645",
    "text": "#eaf7ff",
    "background": "#081522",
    "panel": "#101b29",
    "backdropPreset": "brutalist-club"
  },
  "songs": [
    {
      "title": "Track 1",
      "slug": "track-01",
      "id": "subterranean_track-01",
      "trackNumber": 1,
      "difficulty": 3,
      "energy": 3,
      "moodTags": ["dark", "driving"],
      "recommendedWeight": 0.7,
      "availability": "hidden",
      "audioDir": "1",
      "bpm": 120,
      "beatsPerBar": 4,
      "barsPerLoop": 4,
      "harmonyCycleBars": 8,
      "rootNote": "C",
      "mode": "pentatonicMinor"
    }
  ]
}
```

Asset handling rules:

- any string value in `coverArt`, `theme.backdropParams`, or `song.backdropParams` that points at a real file relative to the source folder is copied into the packaged album/song and turned into a TypeScript asset import automatically
- `audioDir` should point to the folder containing that song’s `.ogg` loop files

### Local Audio Metadata POC

There is now a narrow proof-of-concept path for trying local audio-model metadata generation.

1. Prepare a short `16kHz` mono WAV excerpt:

```bash
npm run prepare:audio-excerpt -- --input path/to/song-preview.wav
```

Useful flags:

- `--start <seconds>`: choose where the excerpt begins
- `--duration <seconds>`: default `30`
- `--output <path>`: write to a custom location

2. Run the local metadata probe:

```bash
npm run generate:song-metadata -- path/to/song-preview_16000hz_excerpt.wav
```

Notes:

- this currently defaults to:
  - model: `/mnt/d/AI/models/Qwen2-Audio-7B-Instruct-Q4_K_M.gguf`
  - mmproj: `/mnt/d/AI/models/Qwen2-Audio-7B-Instruct.mmproj-f16.gguf`
- the `mmproj` file is required for local multimodal runs
- `llama_cpp` must be installed in a build that actually exposes the needed multimodal handler
- the current script uses the existing local audio compatibility hack path and should be treated as experimental
- output is printed twice:
  - raw model text
  - best-effort parsed JSON

Useful flags:

- `--prompt "..."`: override the metadata prompt
- `--chat-handler <ClassName>`: try a different `llama_cpp.llama_chat_format` handler
- `--raw-output path/to/response.txt`: keep the unparsed output for inspection

### Song Hydration

Once a song package exists and real loop files have been copied into its `audio/` folder, you can hydrate `config.ts` from the clips.

Single song:

```bash
npm run hydrate:song -- \
  --album-id sector-seven_second-album \
  --song-slug new-track
```

Whole album:

```bash
npm run hydrate:song -- \
  --album-id sector-seven_second-album
```

Useful flags:

- `--dry-run`: print the inferred BPM / bar lengths without writing `config.ts`
- `--song-dir`: target a song package directly instead of using packaged album/song ids
- omit `--song-slug` to hydrate every packaged song in the album
- `--bpm-min`, `--bpm-max`, `--bpm-step`: tune the BPM search range

The hydrator currently rewrites:

- `transport.bpm`
- `transport.beatsPerBar`
- `transport.barsPerLoop`
- `grooveLevels`

It leaves `harmonyTimeline`, `impactPalette`, and other hand-authored config sections alone.

### Content Override Reference

These are the main places you can override content behavior once a song package has been scaffolded and hydrated.

#### Album (`album.ts`)

Album manifests mostly control library metadata and the default visual theme for every song in the album.

Important optional fields:

- `year?`
- `description?`
- `coverArt?`
- `recommendedSongId?`

Album theme fields:

- `theme.accent`
- `theme.accentSoft`
- `theme.text`
- `theme.background`
- `theme.panel`
- `theme.backdropPreset`
- `theme.backdropParams?`

`theme.backdropParams` is a shallow key/value bag (`string | number | boolean`) for preset-specific overrides such as:

- `panoramaUrl`
- `yawCenterDegrees`

Example:

```ts
theme: {
  accent: "#d97c52",
  accentSoft: "#5e2f24",
  text: "#f6efe8",
  background: "#0f0d0b",
  panel: "#181310",
  backdropPreset: "skybox-360",
  backdropParams: {
    panoramaUrl: sunsetPanorama,
    yawCenterDegrees: 24,
  },
}
```

#### Song Manifest (`song.ts`)

Song manifests are the lightweight library-facing layer. They control metadata, recommendation weighting, and optional per-song visual overrides.

Important optional fields:

- `durationLabel?`
- `difficulty?`
- `energy?`
- `coverArt?`
- `backdropPreset?`
- `backdropParams?`

Notes:

- `moodTags` and `recommendedWeight` are required, even though they are often hand-authored later.
- `backdropPreset?` overrides the album default for that song only.
- `backdropParams?` shallow-override the album `theme.backdropParams`.

Example:

```ts
export const BURNING: SongManifest = {
  id: "sector-seven_artificial-heat_burning",
  slug: "burning",
  title: "Burning",
  artistId: "sector-seven",
  albumId: "sector-seven_artificial-heat",
  trackNumber: 3,
  durationLabel: "5:42",
  difficulty: 4,
  energy: 5,
  moodTags: ["driving", "heavy"],
  recommendedWeight: 0.8,
  availability: "included",
  backdropParams: {
    panoramaUrl: winterPanorama,
    yawCenterDegrees: 90,
  },
  loadConfig: async () => (await import("./config")).BURNING_CONFIG,
};
```

#### Song Config (`config.ts`)

`config.ts` is the real playback/gameplay layer. This is where you tune transport, harmony, groove transitions, spawns, impact synth routing, and solo voice behavior.

Top-level fields:

- `transport`
- `harmonyTimeline`
- `grooveLevels`
- `impactPalette?`
- `soloVoice?`

Useful optional top-level overrides:

- `impactPalette?`
  - full per-family impact synth/sample/routing override
- `soloVoice?.baseGain?`
- `soloVoice?.glideTime?`
- `soloVoice?.pulseDivision?`
- `soloVoice?.pulsePattern?`

#### Groove Level (`grooveLevels[]`)

Each groove level can optionally define:

- `main?`
- `intro?`
- `completesSong?`
- `spawnProfile?`

Useful optional groove-level overrides:

- `completesSong?: true`
  - marks that groove as the final transmission / ending stage
- `spawnProfile?.spawnInterval?`
- `spawnProfile?.spawnPattern?`
- `spawnProfile?.spawnCenter?`
- `spawnProfile?.spawnWeights?`

#### Loop Clip (`grooveLevels[n].intro` / `grooveLevels[n].main`)

Each clip entry can optionally define:

- `grooveChangeAfterBars?`
- `harmonyStartBar?`
- `harmonyTimeline?`

The important one for transition timing is:

- `grooveChangeAfterBars?`
  - this controls the transition landing point
  - for an `intro` clip, it is the number of bars to wait before the groove handoff lands on the target `main`
  - if you wanted to change where a build lands, this is the field to edit

The harmony helpers are:

- `harmonyStartBar?`
  - offset this clip into the song-level `harmonyTimeline`
- `harmonyTimeline?`
  - override harmony locally for this clip only instead of using the song-level timeline

Example groove level:

```ts
{
  level: 4,
  intro: {
    src: groove4Intro,
    bars: 8,
    grooveChangeAfterBars: 6,
  },
  main: {
    src: groove4Main,
    bars: 8,
  },
  spawnProfile: {
    spawnInterval: 0.9,
    spawnPattern: "alternate",
    spawnCenter: 0.15,
    spawnWeights: {
      bell: 1,
      spark: 2,
      snare: 1,
    },
  },
}
```

In practice the override order is:

1. album theme backdrop defaults
2. song backdrop overrides
3. song-level config
4. groove-level overrides
5. clip-level overrides

So if you are adjusting where a transition lands, you almost always want `grooveLevels[n].intro.grooveChangeAfterBars`.

### Harmony Defaults

After running the harmony analyzer, you can stamp a first-pass default root/mode onto every song in an album:

```bash
npm run analyze:harmony
npm run apply:harmony-defaults -- --album-id sector-seven_second-album
```

This tool:

- reads `public/docs/harmony_suggestions.json`
- picks the dominant analyzer suggestion per song
- rewrites `harmonyTimeline` to a single span covering the song's full `harmonyCycleBars`
- sets both `rootNote` and `mode`

Useful flags:

- `--dry-run`: print the inferred defaults without writing `config.ts`
- `--suggestions-file`: point at a different harmony suggestions JSON file

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
