#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ClipInfo:
    key: int
    kind: str
    filename: str
    duration_seconds: float
    inferred_bars: int = 0


@dataclass
class SongContext:
    song_dir: Path
    config_file: Path
    audio_dir: Path


@dataclass
class InferenceResult:
    bpm: float
    beats_per_bar: int
    bars_per_loop: int
    groove_levels: list[dict[str, object]]
    warnings: list[str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Hydrate packaged song config(s) from audio clips.")
    parser.add_argument("--content-root", default="src/content", help="Content root. Defaults to src/content")
    parser.add_argument("--album-id", help="Album id when targeting packaged song(s)")
    parser.add_argument("--song-slug", help="Song slug when targeting a single packaged song")
    parser.add_argument("--song-dir", help="Direct path to a packaged song directory")
    parser.add_argument("--beats-per-bar", type=int, default=4, help="Beats per bar. Defaults to 4")
    parser.add_argument("--bpm-min", type=int, default=60, help="Minimum BPM to consider. Defaults to 60")
    parser.add_argument("--bpm-max", type=int, default=180, help="Maximum BPM to consider. Defaults to 180")
    parser.add_argument("--bpm-step", type=float, default=0.1, help="BPM search step. Defaults to 0.1")
    parser.add_argument("--max-bars", type=int, default=16, help="Maximum clip bars to consider. Defaults to 16")
    parser.add_argument(
        "--preferred-main-bars",
        default="4,8,2,6",
        help="Comma-separated preferred main-loop bar counts for tie-breaking. Defaults to 4,8,2,6",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print inferred values without writing config.ts")
    return parser.parse_args()


def resolve_song_contexts(args: argparse.Namespace) -> list[SongContext]:
    repo_root = Path(__file__).resolve().parents[1]
    content_root = (repo_root / args.content_root).resolve()

    if args.song_dir:
        song_dirs = [Path(args.song_dir).resolve()]
    else:
        if not args.album_id:
            raise SystemExit("Pass either --song-dir, or --album-id with an optional --song-slug.")
        album_songs_dir = content_root / "albums" / args.album_id / "songs"
        if not album_songs_dir.exists():
            raise SystemExit(f"Missing songs directory: {album_songs_dir}")
        if args.song_slug:
            song_dirs = [album_songs_dir / args.song_slug]
        else:
            song_dirs = sorted(path for path in album_songs_dir.iterdir() if path.is_dir())
            if not song_dirs:
                raise SystemExit(f"No song directories found in {album_songs_dir}")

    contexts: list[SongContext] = []
    warnings: list[str] = []
    strict_targeting = bool(args.song_dir or args.song_slug)
    for song_dir in song_dirs:
        config_file = song_dir / "config.ts"
        audio_dir = song_dir / "audio"
        if not config_file.exists():
            message = f"Missing config.ts: {config_file}"
            if strict_targeting:
                raise SystemExit(message)
            warnings.append(message)
            continue
        if not audio_dir.exists():
            message = f"Missing audio directory: {audio_dir}"
            if strict_targeting:
                raise SystemExit(message)
            warnings.append(message)
            continue
        contexts.append(SongContext(song_dir=song_dir, config_file=config_file, audio_dir=audio_dir))

    for warning in warnings:
        print(f"Warning: {warning}")
    if not contexts:
        raise SystemExit("No hydratable songs found.")
    return contexts


def probe_duration_seconds(audio_file: Path) -> float:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(audio_file),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    return float(result.stdout.strip())


def parse_clip(audio_file: Path) -> ClipInfo | None:
    stem = audio_file.stem
    patterns = [
        (r"^gl(\d+)_(main|intro)$", lambda m: (int(m.group(1)), m.group(2))),
        (r"^gl(\d+)_(finale)$", lambda m: (int(m.group(1)), "finale")),
        (r"^(\d+)([im])$", lambda m: (int(m.group(1)), "intro" if m.group(2) == "i" else "main")),
        (r"^(\d+)_(main|intro|finale)$", lambda m: (int(m.group(1)), m.group(2))),
    ]
    for pattern, extractor in patterns:
        match = re.match(pattern, stem, flags=re.IGNORECASE)
        if not match:
            continue
        key, kind = extractor(match)
        return ClipInfo(
            key=key,
            kind=kind,
            filename=audio_file.name,
            duration_seconds=probe_duration_seconds(audio_file),
        )
    return None


def collect_clips(audio_dir: Path) -> list[ClipInfo]:
    clips: list[ClipInfo] = []
    unrecognized: list[str] = []
    for audio_file in sorted(audio_dir.glob("*.ogg")):
        clip = parse_clip(audio_file)
        if clip:
            clips.append(clip)
        else:
            unrecognized.append(audio_file.name)

    if not clips:
        raise SystemExit(f"No recognized loop clips found in {audio_dir}")
    if unrecognized:
        print("Skipped unrecognized clips:")
        for filename in unrecognized:
            print(f"  - {filename}")
    return clips


def mode_int(values: list[int], fallback: int) -> int:
    if not values:
        return fallback
    counts: dict[int, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]


def parse_preferred_main_bars(raw: str) -> list[int]:
    values: list[int] = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        values.append(int(token))
    return values or [4]


def infer_timing(
    clips: list[ClipInfo],
    beats_per_bar: int,
    bpm_min: float,
    bpm_max: float,
    bpm_step: float,
    max_bars: int,
    preferred_main_bars: list[int],
    preferred_bpm: float,
) -> InferenceResult:
    best_score: tuple[float, int, int, float, float, float] | None = None
    best_bpm = bpm_min
    best_bars: list[int] = []

    steps = int(round((bpm_max - bpm_min) / bpm_step))
    sorted_preferred_main_bars = preferred_main_bars or [4]
    primary_preferred_main_bars = sorted_preferred_main_bars[0]
    for step_index in range(steps + 1):
        bpm = bpm_min + (step_index * bpm_step)
        rounded_bars: list[int] = []
        total_error = 0.0
        main_total_error = 0.0
        odd_count = 0
        main_bars: list[int] = []

        for clip in clips:
            raw_bars = clip.duration_seconds * bpm / (60.0 * beats_per_bar)
            rounded = max(1, min(max_bars, int(round(raw_bars))))
            rounded_bars.append(rounded)
            clip_error = abs(raw_bars - rounded) / rounded
            total_error += clip_error
            if clip.kind == "main":
                main_total_error += clip_error
            if clip.kind == "main" and rounded % 2 == 1 and rounded > 1:
                odd_count += 1
            if clip.kind == "main":
                main_bars.append(rounded)

        main_common = mode_int(main_bars, 4)
        unique_main = len(set(main_bars)) if main_bars else 0
        preferred_distance = abs(main_common - primary_preferred_main_bars)
        preferred_match_rank = 0 if main_common in sorted_preferred_main_bars else 1
        score = (
            preferred_distance,
            preferred_match_rank,
            odd_count,
            unique_main,
            round(main_total_error, 6),
            round(total_error, 6),
            abs(bpm - preferred_bpm),
        )
        if best_score is None or score < best_score:
            best_score = score
            best_bpm = bpm
            best_bars = rounded_bars

    for clip, bars in zip(clips, best_bars):
        clip.inferred_bars = bars

    main_bars = [clip.inferred_bars for clip in clips if clip.kind == "main"]
    bars_per_loop = mode_int(main_bars, 4)

    groove_levels: list[dict[str, object]] = []
    warnings: list[str] = []
    grouped: dict[int, list[ClipInfo]] = {}
    for clip in clips:
        grouped.setdefault(clip.key, []).append(clip)

    level_number = 1
    keys = sorted(grouped)
    for key in keys:
        group = grouped[key]
        intro = next((clip for clip in group if clip.kind == "intro"), None)
        main = next((clip for clip in group if clip.kind == "main"), None)
        finale = next((clip for clip in group if clip.kind == "finale"), None)

        if intro or main:
            level: dict[str, object] = {"level": level_number}
            if main:
                level["main"] = {"src": main.filename, "bars": main.inferred_bars}
            if intro:
                level["intro"] = {"src": intro.filename, "bars": intro.inferred_bars}
            groove_levels.append(level)
            level_number += 1

        if finale:
            groove_levels.append(
                {
                    "level": level_number,
                    "intro": {"src": finale.filename, "bars": finale.inferred_bars},
                    "completesSong": True,
                }
            )
            level_number += 1

    if groove_levels:
        last = groove_levels[-1]
        if "intro" in last and "main" not in last:
            last["completesSong"] = True

    if len(keys) > 1:
        final_key = keys[-1]
        for key in keys:
            group = grouped[key]
            intro = next((clip for clip in group if clip.kind == "intro"), None)
            main = next((clip for clip in group if clip.kind == "main"), None)
            finale = next((clip for clip in group if clip.kind == "finale"), None)
            is_final_group = key == final_key and finale is not None or (key == final_key and intro is not None and main is None)

            if is_final_group:
                if intro is None:
                    warnings.append(
                        f"final groove group {key} is missing its ending intro/finale clip"
                    )
                continue

            if intro is None or main is None:
                missing_parts: list[str] = []
                if intro is None:
                    missing_parts.append("intro")
                if main is None:
                    missing_parts.append("main")
                warnings.append(
                    f"groove group {key} is missing {', '.join(missing_parts)} clip(s)"
                )

    return InferenceResult(
        bpm=best_bpm,
        beats_per_bar=beats_per_bar,
        bars_per_loop=bars_per_loop,
        groove_levels=groove_levels,
        warnings=warnings,
    )


def extract_number_field(text: str, field_name: str) -> int | None:
    match = re.search(rf"{field_name}:\s*(\d+)", text)
    return int(match.group(1)) if match else None


def extract_float_field(text: str, field_name: str) -> float | None:
    match = re.search(rf"{field_name}:\s*(\d+(?:\.\d+)?)", text)
    return float(match.group(1)) if match else None


def find_matching_bracket(text: str, open_index: int) -> int:
    pairs = {"{": "}", "[": "]"}
    opener = text[open_index]
    closer = pairs[opener]
    depth = 0
    in_single = False
    in_double = False
    in_backtick = False
    escape = False

    for index in range(open_index, len(text)):
        char = text[index]
        if escape:
            escape = False
            continue
        if char == "\\" and (in_single or in_double or in_backtick):
            escape = True
            continue
        if not in_double and not in_backtick and char == "'" and not in_single:
            in_single = True
            continue
        if in_single and char == "'":
            in_single = False
            continue
        if not in_single and not in_backtick and char == '"' and not in_double:
            in_double = True
            continue
        if in_double and char == '"':
            in_double = False
            continue
        if not in_single and not in_double and char == "`" and not in_backtick:
            in_backtick = True
            continue
        if in_backtick and char == "`":
            in_backtick = False
            continue
        if in_single or in_double or in_backtick:
            continue
        if char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return index
    raise ValueError(f"No matching bracket found for {opener} at {open_index}")


def replace_property_value(text: str, property_name: str, rendered_value: str) -> str:
    match = re.search(rf"(?P<indent>^\s*){property_name}:\s*", text, flags=re.M)
    if not match:
        raise SystemExit(f"Could not find '{property_name}' in config.ts")
    value_start = match.end()
    while value_start < len(text) and text[value_start].isspace():
        value_start += 1
    if text[value_start] not in "{[":
        raise SystemExit(f"Property '{property_name}' does not start with an object/array literal.")
    value_end = find_matching_bracket(text, value_start)
    comma_end = value_end + 1
    while comma_end < len(text) and text[comma_end].isspace():
        comma_end += 1
    include_comma = comma_end < len(text) and text[comma_end] == ","
    replacement = f"{match.group('indent')}{property_name}: {rendered_value}"
    if include_comma:
        replacement += ","
        comma_end += 1
    return text[: match.start()] + replacement + text[comma_end:]


def render_transport(existing_text: str, inference: InferenceResult) -> str:
    harmony_cycle_bars = extract_number_field(existing_text, "harmonyCycleBars") or 8
    bpm_text = f"{inference.bpm:.2f}".rstrip("0").rstrip(".")
    return (
        "{\n"
        f"    bpm: {bpm_text},\n"
        f"    beatsPerBar: {inference.beats_per_bar},\n"
        f"    barsPerLoop: {inference.bars_per_loop},\n"
        f"    harmonyCycleBars: {harmony_cycle_bars},\n"
        "  }"
    )


def render_groove_levels(groove_levels: list[dict[str, object]]) -> str:
    lines = ["["]
    for level in groove_levels:
        lines.append("    {")
        lines.append(f"      level: {level['level']},")
        main = level.get("main")
        if isinstance(main, dict):
            lines.append("      main: {")
            lines.append(f'        src: assetUrl("{main["src"]}"),')
            lines.append(f'        bars: {main["bars"]},')
            lines.append("      },")
        intro = level.get("intro")
        if isinstance(intro, dict):
            lines.append("      intro: {")
            lines.append(f'        src: assetUrl("{intro["src"]}"),')
            lines.append(f'        bars: {intro["bars"]},')
            lines.append("      },")
        if level.get("completesSong"):
            lines.append("      completesSong: true,")
        lines.append("    },")
    lines.append("  ]")
    return "\n".join(lines)


def print_summary(context: SongContext, inference: InferenceResult, clips: list[ClipInfo]) -> None:
    print(f"Hydrating {context.song_dir}")
    print(f"  inferred BPM: {inference.bpm}")
    print(f"  inferred barsPerLoop: {inference.bars_per_loop}")
    print("  clips:")
    for clip in clips:
        print(
            f"    - {clip.filename}: {clip.duration_seconds:.3f}s -> {clip.inferred_bars} bars ({clip.kind})"
        )
    print("  groove levels:")
    for level in inference.groove_levels:
        parts = [f"level {level['level']}"]
        if "intro" in level:
            intro = level["intro"]
            parts.append(f'intro {intro["src"]} ({intro["bars"]} bars)')
        if "main" in level:
            main = level["main"]
            parts.append(f'main {main["src"]} ({main["bars"]} bars)')
        if level.get("completesSong"):
            parts.append("completesSong")
        print("    - " + ", ".join(parts))


def hydrate_config(context: SongContext, inference: InferenceResult, dry_run: bool) -> None:
    original = context.config_file.read_text(encoding="utf-8")
    hydrated = replace_property_value(original, "transport", render_transport(original, inference))
    hydrated = replace_property_value(hydrated, "grooveLevels", render_groove_levels(inference.groove_levels))

    if dry_run:
        print("  dry-run: config.ts not written")
        return

    context.config_file.write_text(hydrated, encoding="utf-8")
    print(f"  wrote {context.config_file}")


def main() -> None:
    args = parse_args()
    contexts = resolve_song_contexts(args)
    hydrated_count = 0
    pooled_warnings: list[tuple[Path, str]] = []

    for index, context in enumerate(contexts):
        if index > 0:
            print()
        clips = collect_clips(context.audio_dir)
        existing_text = context.config_file.read_text(encoding="utf-8")
        existing_bpm = extract_float_field(existing_text, "bpm") or 120.0
        preferred_main_bars = parse_preferred_main_bars(args.preferred_main_bars)
        inference = infer_timing(
            clips,
            beats_per_bar=args.beats_per_bar,
            bpm_min=args.bpm_min,
            bpm_max=args.bpm_max,
            bpm_step=args.bpm_step,
            max_bars=args.max_bars,
            preferred_main_bars=preferred_main_bars,
            preferred_bpm=existing_bpm,
        )
        print_summary(context, inference, clips)
        for warning in inference.warnings:
            pooled_warnings.append((context.song_dir, warning))
        hydrate_config(context, inference, dry_run=args.dry_run)
        hydrated_count += 1

    if len(contexts) > 1:
        print()
        action = "Would hydrate" if args.dry_run else "Hydrated"
        print(f"{action} {hydrated_count} songs.")

    if pooled_warnings:
        print()
        print("Warnings:")
        for song_dir, warning in pooled_warnings:
            print(f"  - {song_dir.name}: {warning}")


if __name__ == "__main__":
    main()
