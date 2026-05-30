# Song Data Schema

## Goal

Define a flexible, data-driven song format for Falling Orchestra.

The format should support:

- album and song metadata
- transport settings
- song form
- harmony changes
- spawn rules
- groove rules
- mega-ball rules
- background rules
- event hooks
- future expansion without constant format rewrites

The format should be expressive enough to author songs, but simple enough that it does not become a programming language.

## Design Principles

### 1. Versioned

Every file should include a `schemaVersion`.

This allows migration later as the format evolves.

### 2. Data-Driven, Not Script-Driven

Prefer structured config and small event/action lists over arbitrary embedded code.

Good:

- per-section overrides
- named presets
- typed event actions

Avoid for now:

- arbitrary scripts
- inline function bodies
- overly clever rule languages

### 3. Bar-Based Timing

Song structure should be described in bars, not seconds.

Why:

- easier to reason about musically
- adapts naturally to BPM
- simpler section editing
- simpler harmony changes
- simpler event scheduling

### 4. Defaults Plus Overrides

Each song should define a core identity in `defaults`, then change only what is necessary in later sections.

This keeps song files readable and avoids repeating full config blocks.

### 5. Expandable

The schema should leave room for unknown future systems.

Recommended tools:

- `schemaVersion`
- `extensions`
- typed `events`

## Recommended File Model

Use JSON-shaped data as the runtime source of truth.

Good options:

- JSON
- JSON5
- YAML authored and compiled to JSON

For the runtime model, JSON is the simplest choice.

## Proposed Content Layout

```text
content/
  catalog.json
  albums/
    weather-systems/
      album.json
      low-tide.song.json
      second-sky.song.json
      assets/
        cover.jpg
        low-tide.jpg
```

This keeps:

- catalog-level browsing separate from song logic
- album metadata grouped together
- per-song definitions isolated and easy to diff

## Top-Level Song Shape

Recommended top-level structure:

```json
{
  "schemaVersion": 1,
  "id": "low-tide",
  "title": "Low Tide",
  "album": {
    "id": "weather-systems",
    "title": "Weather Systems"
  },
  "artist": "Kieron",
  "ui": {},
  "transport": {},
  "defaults": {},
  "form": [],
  "events": {},
  "extensions": {}
}
```

## Core Fields

### `schemaVersion`

Integer schema version.

Example:

```json
{ "schemaVersion": 1 }
```

### `id`

Stable internal identifier.

Used for:

- save / replay references
- internal linking
- asset lookup

### `title`

Display title for the song.

### `album`

Minimal album reference:

```json
{
  "id": "weather-systems",
  "title": "Weather Systems"
}
```

Later this could become a foreign key into `album.json`.

### `artist`

Simple display field for now.

### `ui`

Song-specific presentation data.

Suggested fields:

- `theme`
- `accentColor`
- `coverArt`
- `backgroundPreset`
- `description`

Example:

```json
{
  "theme": "tide",
  "accentColor": "#69f5d8",
  "coverArt": "albums/weather-systems/assets/low-tide.jpg"
}
```

### `transport`

Global transport settings for the song.

Suggested fields:

- `bpm`
- `beatsPerBar`
- `barsPerSection`

Example:

```json
{
  "bpm": 118,
  "beatsPerBar": 4,
  "barsPerSection": 4
}
```

## Defaults Block

`defaults` defines the baseline identity of the song.

Suggested child blocks:

- `harmony`
- `spawn`
- `background`
- `groove`
- `mega`
- `mix`
- `visuals`

Example:

```json
{
  "harmony": {
    "root": "D",
    "mode": "dorian"
  },
  "spawn": {
    "baseInterval": 0.9,
    "intervalJitter": 0.25,
    "pattern": "rain",
    "weights": {
      "bass": 0.34,
      "bell": 0.24,
      "snare": 0.14,
      "spark": 0.28
    },
    "specialChance": 0.35,
    "allowedSpecials": ["snakeBell", "sparkRibbon", "snareRoll", "bassMarch"],
    "formationTuning": {
      "snareRoll": {
        "count": 22,
        "requiredCaught": 18
      }
    }
  },
  "background": {
    "preset": "tide",
    "scrollSpeed": 0.08,
    "pulseAmount": 0.2,
    "palette": ["#081522", "#113050", "#1f7b88"],
    "reactivity": {
      "beat": 0.5,
      "groove": 0.7,
      "mega": 1.0
    }
  },
  "groove": {
    "levels": [
      { "threshold": 3, "unlock": "snareBackbeat" },
      { "threshold": 6, "unlock": "hats" },
      { "threshold": 9, "unlock": "drone" }
    ]
  },
  "mega": {
    "enabled": true,
    "spawnOnFormationClear": true,
    "comboReward": 2,
    "comboEffect": "dropGate"
  }
}
```

## Harmony Model

The minimum useful harmony unit is:

```json
{
  "root": "D",
  "mode": "dorian"
}
```

For now, this is enough.

Later it could grow to include:

- `pedal`
- `colorTone`
- `voicingBias`
- `quantizerPreset`

## Spawn Model

Spawn config needs to support both baseline behavior and song/section variation.

Suggested fields:

- `baseInterval`
- `intervalJitter`
- `pattern`
- `weights`
- `specialChance`
- `allowedSpecials`
- `formationTuning`

`weights` should be normalized at load time rather than requiring exact sums in the file.

Suggested object family keys:

- `bass`
- `bell`
- `snare`
- `spark`

Suggested special formation ids:

- `snakeBell`
- `sparkRibbon`
- `snareRoll`
- `bassMarch`

## Background Model

The background needs its own data block rather than a loose set of shader knobs.

Suggested fields:

- `preset`
- `palette`
- `scrollSpeed`
- `pulseAmount`
- `evolve`
- `reactivity`

This allows:

- album-level look and feel
- song-level identity
- section-level atmosphere changes
- mega-aware reactions

## Groove Model

The current prototype uses groove as a lightweight progression track.

Song data should eventually control:

- thresholds
- unlock order
- which layers exist
- which visual transitions are tied to level-ups

Suggested shape:

```json
{
  "levels": [
    { "threshold": 3, "unlock": "snareBackbeat" },
    { "threshold": 6, "unlock": "hats" },
    { "threshold": 9, "unlock": "drone" }
  ]
}
```

Later this might grow into:

- per-level background changes
- per-level spawn changes
- per-level mega behavior changes

## Mega Model

Mega-ball behavior should be song-aware.

Suggested fields:

- `enabled`
- `spawnOnFormationClear`
- `comboReward`
- `comboEffect`
- `impactEffect`

This leaves room for songs where mega events behave very differently.

## Form Model

Songs should be structured as a sequence of sections.

Suggested shape:

```json
[
  {
    "id": "intro",
    "label": "Intro",
    "lengthBars": 8,
    "harmony": [
      { "startBar": 0, "lengthBars": 4, "root": "D", "mode": "dorian" },
      { "startBar": 4, "lengthBars": 4, "root": "G", "mode": "mixolydian" }
    ],
    "overrides": {
      "spawn": {
        "baseInterval": 1.1,
        "specialChance": 0.18
      },
      "background": {
        "preset": "mist",
        "evolve": 0.2
      }
    }
  },
  {
    "id": "lift",
    "label": "Lift",
    "lengthBars": 16,
    "overrides": {
      "spawn": {
        "baseInterval": 0.72,
        "specialChance": 0.42,
        "allowedSpecials": ["snakeBell", "snareRoll", "sparkRibbon"]
      },
      "mega": {
        "comboEffect": "dropGate"
      }
    }
  }
]
```

### Why Sections Matter

Sections give the song:

- form
- pacing
- mood transitions
- structure for special events

This is one of the main tools for turning the prototype into an authored experience.

## Event Model

Events should be declarative and typed.

Suggested event groups:

- `onFormationClear`
- `onMegaCombo`
- `onGrooveLevelUp`
- `onSectionEnter`
- `onSectionExit`

Example:

```json
{
  "onFormationClear": [
    {
      "formation": "snareRoll",
      "actions": ["spawnMega", "banner:Snare Surge"]
    }
  ],
  "onMegaCombo": [
    {
      "actions": ["filterLift", "snareFill", "backgroundFlash"]
    }
  ],
  "onGrooveLevelUp": [
    {
      "level": 1,
      "actions": ["unlock:snareBackbeat"]
    },
    {
      "level": 2,
      "actions": ["unlock:hats", "backgroundBloom"]
    }
  ]
}
```

### Recommended First Action Types

Useful first actions:

- `spawnMega`
- `banner:<text>`
- `unlock:<layer>`
- `backgroundFlash`
- `backgroundBloom`
- `filterLift`
- `snareFill`
- `dropGate`

These should be interpreted by code, not executed as scripts.

## Extensions

Every song should be allowed an `extensions` object.

Example:

```json
{
  "extensions": {
    "prototypeNotes": {
      "needsCustomMegaMoment": true
    }
  }
}
```

This gives room for experiments without constantly revising the stable core schema.

## Validation Recommendation

The runtime should validate song data at load time.

Suggested approach:

- TypeScript interfaces for editor support
- `zod` or JSON Schema for runtime validation
- normalization step after validation

Normalization should:

- fill defaults
- normalize spawn weights
- resolve relative section timing if needed
- ensure section bars do not overlap incorrectly

## Initial Implementation Plan

Recommended sequence:

1. define TS interfaces for the schema
2. add runtime validation
3. create one song file that matches the current prototype
4. move current harmony cycle into song data
5. move spawn weights and special rules into song data
6. move background tuning into song data
7. add section overrides
8. add event hook handling
9. add album/catalog loading

## First Practical Scope

Do not try to solve everything in the first schema pass.

A sensible first shipping scope is:

- metadata
- transport
- defaults
- form
- spawn rules
- harmony changes
- background rules
- groove thresholds
- mega rules

That is enough to turn the current prototype into a song-driven system.

## Summary

The song schema should be:

- versioned
- bar-based
- defaults-plus-overrides
- event-capable
- expandable

The aim is not to invent a language.
The aim is to make songs into structured content that can drive the game, the music, and the visuals together.
