# Experience Direction

## Current Read

Falling Orchestra has moved past "musical physics toy" territory.

The strongest version of the project now looks like:

- a playable generative record
- a meditative but skillful music-world
- a sequence of authored songs rather than one endless sandbox

The most important discovery so far is that the game works best when the player has **indirect but meaningful control**.

The player does not need to choose notes manually.
The player does need to feel that they are:

- shaping flow
- storing and releasing pressure
- steering formations
- earning new layers
- transforming the arrangement over time

That balance is where the project becomes distinctive.

## Design Pillars

### 1. Playable Album

The long-term structure should be closer to an album than a score-attack arcade game.

That suggests:

- songs instead of generic runs
- albums instead of disconnected levels
- a listening-oriented interface, possibly inspired by a music player
- strong identity per song and per album

Each song should feel authored, even if the exact performance is always slightly different.

### 2. Indirect Authorship

The player should influence the music through movement, timing, interception, and survival of special events.

Good examples:

- catching most of a formation to earn groove
- keeping a mega-ball alive
- colliding two mega-balls to trigger a set-piece event
- surviving a dense snare roll into a section lift

Less promising examples:

- direct note entry
- too many simultaneous tools
- over-abstract UI-heavy control

### 3. Readable Musical Events

The game is strongest when musical moments are legible in both sound and visuals.

Important event types should be easy to read:

- regular family impacts
- special formations
- groove level-ups
- mega-ball arrivals
- mega-ball combo events
- section changes

If the player cannot tell what just happened, the game starts to feel random instead of alive.

### 4. Transformation Over Time

A run or song should travel somewhere.

That means:

- changing harmony
- changing density
- changing spawn families
- changing background motion / palette / reactivity
- changing available groove layers
- changing the emotional temperature of the arena

The ideal result is that the player feels they are moving through a piece of music, not just looping inside a toy.

## Product Direction

## Song-Based Structure

A likely long-term shape:

- album select
- song select
- each song is a self-contained interactive piece
- songs can share systems but differ in identity, arrangement, and visuals

Example song qualities:

- harmonic language
- tempo
- dominant object families
- special formation frequency
- mega-ball behavior
- groove unlock ladder
- background behavior
- visual palette

## Album Identity

Albums should have a coherent audiovisual world.

Examples worth exploring:

- aquatic / dub / tide
- glass / crystalline / bells
- ash / bass-heavy / storm pressure
- neon / rhythmic / high-contrast / snare-driven

An album should not just be a folder of songs. It should feel like a place.

## Interface Direction

The eventual front-end could borrow language from music players rather than games.

Ideas:

- album covers
- track lists
- "now playing" treatment
- per-song visual themes
- unlocks represented as arrangement layers rather than points

This does not need to become literal Spotify parody UI, but the emotional framing matters:

- you are entering a record
- you are performing inside a song
- you are listening and shaping at the same time

## Systems Worth Expanding

## Groove System

The groove ladder already works as a progression mechanic.
Long-term, groove should do more than turn on audio layers.

Potential groove effects:

- unlock new drum layers
- unlock drones or pads
- alter background pulse and palette
- enable new formation types
- make mega-ball events stronger
- open temporary "drop" or "breakdown" moments

## Mega-Ball System

Mega-balls should become true set-piece events rather than just unusual objects.

Potential directions:

- temporary filter lift across the mix
- snare fill leading into a drop
- gravity shift for a short window
- background rupture / bloom
- special bar-long transition state
- song-specific mega reactions

The goal is for a mega event to feel memorable and story-like within a run.

## Special Formations

Special formations are already doing useful design work.
They create:

- readable goals
- phrasing opportunities
- tension
- payoff

Long-term, each formation family could reward a different musical layer or behavior.

Examples:

- bell formations strengthen melody ornaments
- bass formations deepen low-end support
- snare formations intensify rhythm and fills
- spark formations open hats, delay, or shimmer

This would turn player skill into arrangement rather than score alone.

## Background / World Reactivity

The background should feel like part of the song.
It should evolve with:

- beat
- section
- groove level
- mega events
- album identity

Important constraint:

The background should feel alive without harming readability or motion comfort.
The camera should remain stable unless a very deliberate special event justifies otherwise.

## Open Directions

These ideas are intentionally broad and should not all be implemented at once.

### 1. Song Journey Runs

Each song has a clear arc:

- intro
- build
- lift
- break
- return
- release

### 2. Biome Albums

Each album defines its own sound-world, visual rules, and event grammar.

### 3. Set-Piece Sections

Some sections could act like "boss fights" without traditional enemies.

Examples:

- a giant snare roll wave
- a sacred mega-ball survival section
- a blackout section with minimal silhouettes
- a drop gate triggered by double mega collision

### 4. Recording / Replay

Runs could eventually be serialized by seed and song definition so players can revisit memorable performances.

### 5. Multiple Modes

Possible future modes:

- album mode
- free-play shrine mode
- score-attack mode
- curated performance mode

## Near-Term Priorities

If the project moves from prototype toward a polished experience, the clearest next priorities are:

1. define a data-driven song format
2. move current harmony / spawn / background tuning into song data
3. structure the experience around songs instead of generic endless play
4. turn mega events into song-aware set pieces
5. give the background and world state a stronger relationship to song sections

## Summary

The current prototype suggests a strong future:

- not pure rhythm game
- not pure sandbox
- not conventional action game

The most exciting version is an **interactive album** where skill changes arrangement, arrangement changes atmosphere, and each song becomes a playable place.
