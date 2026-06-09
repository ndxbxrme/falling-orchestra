#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


@dataclass
class SongContext:
    song_id: str
    song_slug: str
    song_dir: Path
    config_file: Path


@dataclass
class HarmonyChoice:
    root: str
    mode: str
    score: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply analyzer-derived default root/mode pairs to every song in an album.",
    )
    parser.add_argument("--content-root", default="src/content", help="Content root. Defaults to src/content")
    parser.add_argument("--album-id", required=True, help="Packaged album id to update")
    parser.add_argument(
        "--suggestions-file",
        default="public/docs/harmony_suggestions.json",
        help="Harmony suggestions JSON path. Defaults to public/docs/harmony_suggestions.json",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print inferred defaults without writing config.ts")
    return parser.parse_args()


def parse_song_manifest_identity(song_manifest: Path) -> tuple[str, str]:
    text = song_manifest.read_text(encoding="utf-8")
    id_match = re.search(r'id:\s*"([^"]+)"', text)
    slug_match = re.search(r'slug:\s*"([^"]+)"', text)
    if not id_match:
        raise SystemExit(f"Could not find song id in {song_manifest}")
    song_id = id_match.group(1)
    song_slug = slug_match.group(1) if slug_match else song_manifest.parent.name
    return song_id, song_slug


def resolve_song_contexts(content_root: Path, album_id: str) -> list[SongContext]:
    songs_dir = content_root / "albums" / album_id / "songs"
    if not songs_dir.exists():
        raise SystemExit(f"Missing songs directory: {songs_dir}")

    contexts: list[SongContext] = []
    for song_dir in sorted(path for path in songs_dir.iterdir() if path.is_dir()):
        song_manifest = song_dir / "song.ts"
        config_file = song_dir / "config.ts"
        if not song_manifest.exists() or not config_file.exists():
            continue
        song_id, song_slug = parse_song_manifest_identity(song_manifest)
        contexts.append(
            SongContext(
                song_id=song_id,
                song_slug=song_slug,
                song_dir=song_dir,
                config_file=config_file,
            )
        )
    if not contexts:
        raise SystemExit(f"No packaged songs found in {songs_dir}")
    return contexts


def load_suggestions(suggestions_path: Path) -> dict[str, object]:
    if not suggestions_path.exists():
        raise SystemExit(f"Missing suggestions file: {suggestions_path}")
    return json.loads(suggestions_path.read_text(encoding="utf-8"))


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


def extract_number_field(text: str, field_name: str) -> int | None:
    match = re.search(rf"{field_name}:\s*(\d+)", text)
    return int(match.group(1)) if match else None


def render_harmony_timeline(cycle_bars: int, choice: HarmonyChoice) -> str:
    return (
        "[\n"
        f'    {{ startBar: 1, lengthBars: {cycle_bars}, rootNote: "{choice.root}", mode: "{choice.mode}" }},\n'
        "  ]"
    )


def select_dominant_harmony(song_suggestions: dict[str, object]) -> HarmonyChoice | None:
    counts: dict[tuple[str, str], int] = defaultdict(int)
    scores: dict[tuple[str, str], list[float]] = defaultdict(list)

    for clip in song_suggestions.get("clips", []):
        overall = clip.get("overall", [])
        if not overall:
            continue
        suggestion = overall[0]
        key = (suggestion["root"], suggestion["mode"])
        counts[key] += 1
        scores[key].append(float(suggestion["score"]))

    if not counts:
        for clip in song_suggestions.get("clips", []):
            for bar in clip.get("bars", []):
                suggestions = bar.get("suggestions", [])
                if not suggestions:
                    continue
                suggestion = suggestions[0]
                key = (suggestion["root"], suggestion["mode"])
                counts[key] += 1
                scores[key].append(float(suggestion["score"]))

    if not counts:
        return None

    ranked = sorted(
        counts.keys(),
        key=lambda key: (
            -counts[key],
            sum(scores[key]) / len(scores[key]),
            key[0],
            key[1],
        ),
    )
    root, mode = ranked[0]
    average_score = sum(scores[ranked[0]]) / len(scores[ranked[0]])
    return HarmonyChoice(root=root, mode=mode, score=average_score)


def apply_default_harmony(context: SongContext, choice: HarmonyChoice, dry_run: bool) -> None:
    original = context.config_file.read_text(encoding="utf-8")
    cycle_bars = extract_number_field(original, "harmonyCycleBars") or 8
    updated = replace_property_value(original, "harmonyTimeline", render_harmony_timeline(cycle_bars, choice))

    print(
        f"{context.song_slug}: {choice.root} {choice.mode} "
        f"(cycle {cycle_bars} bars, score {choice.score:.4f})"
    )
    if dry_run:
        print("  dry-run: config.ts not written")
        return

    context.config_file.write_text(updated, encoding="utf-8")
    print(f"  wrote {context.config_file}")


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    content_root = (repo_root / args.content_root).resolve()
    suggestions_path = (repo_root / args.suggestions_file).resolve()

    suggestions = load_suggestions(suggestions_path)
    suggestion_songs = suggestions.get("songs", {})
    contexts = resolve_song_contexts(content_root, args.album_id)

    applied = 0
    skipped: list[str] = []
    for context in contexts:
        song_suggestions = (
            suggestion_songs.get(context.song_id)
            or suggestion_songs.get(context.song_slug)
        )
        if not isinstance(song_suggestions, dict):
            skipped.append(f"{context.song_slug}: no suggestions found")
            continue

        choice = select_dominant_harmony(song_suggestions)
        if not choice:
            skipped.append(f"{context.song_slug}: no usable suggestions found")
            continue

        apply_default_harmony(context, choice, args.dry_run)
        applied += 1

    if skipped:
        print()
        for warning in skipped:
            print(f"Warning: {warning}")

    print()
    action = "Would update" if args.dry_run else "Updated"
    print(f"{action} {applied} songs in {args.album_id}.")


if __name__ == "__main__":
    main()
