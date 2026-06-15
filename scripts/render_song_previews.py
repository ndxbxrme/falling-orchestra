#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from hydrate_song_config import SongContext, resolve_song_contexts


@dataclass
class PreviewClip:
    filename: str
    duration_seconds: float


@dataclass
class PreviewSong:
    bpm: float
    beats_per_bar: int
    clips: list[PreviewClip]


def choose_preview_main_repeats(intro_bars: int, main_bars: int, average_total_bars: float, default_repeats: int) -> int:
    default_total_bars = intro_bars + (main_bars * default_repeats)
    if default_total_bars <= average_total_bars:
        return default_repeats

    best_repeats = 1
    best_distance = float("inf")
    for repeats in range(1, default_repeats + 1):
        total_bars = intro_bars + (main_bars * repeats)
        distance = abs(total_bars - average_total_bars)
        if distance < best_distance or (distance == best_distance and repeats < best_repeats):
            best_distance = distance
            best_repeats = repeats
    return best_repeats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render song preview audio using the same structure as the in-app preview player."
    )
    parser.add_argument("--content-root", default="src/content", help="Content root. Defaults to src/content")
    parser.add_argument("--album-id", help="Album id when targeting packaged song(s)")
    parser.add_argument("--song-slug", help="Song slug when targeting a single packaged song")
    parser.add_argument("--song-dir", help="Direct path to a packaged song directory")
    parser.add_argument(
        "--output-root",
        default="tmp/rendered-previews",
        help="Directory to place rendered previews in. Defaults to tmp/rendered-previews",
    )
    parser.add_argument(
        "--main-repeats",
        type=int,
        default=3,
        help="How many times to repeat each groove main loop. Defaults to 3",
    )
    parser.add_argument(
        "--format",
        choices=("wav", "mp3"),
        default="wav",
        help="Output format. Defaults to wav",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print the planned render steps without writing files")
    return parser.parse_args()


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


def extract_number(text: str, field_name: str) -> float:
    match = re.search(rf"{field_name}:\s*(\d+(?:\.\d+)?)", text)
    if not match:
        raise ValueError(f"Missing numeric field '{field_name}'")
    return float(match.group(1))


def extract_block(text: str, field_name: str, bracket: str) -> str:
    match = re.search(rf"{field_name}:\s*{re.escape(bracket)}", text)
    if not match:
        raise ValueError(f"Missing block '{field_name}'")
    open_index = match.end() - 1
    close_index = find_matching_bracket(text, open_index)
    return text[open_index : close_index + 1]


def split_top_level_objects(array_text: str) -> list[str]:
    objects: list[str] = []
    depth = 0
    start: int | None = None
    for index, char in enumerate(array_text):
        if char == "{":
            if depth == 0:
                start = index
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0 and start is not None:
                objects.append(array_text[start : index + 1])
                start = None
    return objects


def parse_clip_block(level_block: str, key: str, bpm: float, beats_per_bar: int) -> PreviewClip | None:
    match = re.search(rf"{key}:\s*{{", level_block)
    if not match:
        return None
    open_index = match.end() - 1
    close_index = find_matching_bracket(level_block, open_index)
    block = level_block[open_index : close_index + 1]

    src_match = re.search(r'src:\s*assetUrl\("([^"]+)"\)', block)
    bars_match = re.search(r"bars:\s*(\d+)", block)
    if not src_match or not bars_match:
        return None

    bars = int(bars_match.group(1))
    duration_seconds = (60.0 / bpm) * beats_per_bar * bars
    return PreviewClip(filename=src_match.group(1), duration_seconds=duration_seconds)


def parse_preview_song(config_file: Path, main_repeats: int) -> PreviewSong:
    text = config_file.read_text(encoding="utf-8")
    transport_block = extract_block(text, "transport", "{")
    bpm = extract_number(transport_block, "bpm")
    beats_per_bar = int(extract_number(transport_block, "beatsPerBar"))

    groove_levels_block = extract_block(text, "grooveLevels", "[")
    level_blocks = split_top_level_objects(groove_levels_block)
    clips: list[PreviewClip] = []
    groove_bar_totals: list[int] = []

    for level_block in level_blocks:
        intro = parse_clip_block(level_block, "intro", bpm, beats_per_bar)
        main = parse_clip_block(level_block, "main", bpm, beats_per_bar)
        if not main:
            continue
        intro_bars = int(round((intro.duration_seconds * bpm) / (60.0 * beats_per_bar))) if intro else 0
        main_bars = int(round((main.duration_seconds * bpm) / (60.0 * beats_per_bar)))
        groove_bar_totals.append(intro_bars + (main_bars * main_repeats))

    average_total_bars = (
        sum(groove_bar_totals) / len(groove_bar_totals)
        if groove_bar_totals
        else float(main_repeats * 4)
    )

    for level_block in level_blocks:
        intro = parse_clip_block(level_block, "intro", bpm, beats_per_bar)
        main = parse_clip_block(level_block, "main", bpm, beats_per_bar)
        if intro:
            clips.append(intro)
        if main:
            intro_bars = int(round((intro.duration_seconds * bpm) / (60.0 * beats_per_bar))) if intro else 0
            main_bars = int(round((main.duration_seconds * bpm) / (60.0 * beats_per_bar)))
            repeats = choose_preview_main_repeats(intro_bars, main_bars, average_total_bars, main_repeats)
            clips.extend([main] * max(0, repeats))

    return PreviewSong(bpm=bpm, beats_per_bar=beats_per_bar, clips=clips)


def render_preview(context: SongContext, preview: PreviewSong, output_file: Path, output_format: str) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)

    if not preview.clips:
        raise SystemExit(f"No preview clips were found in {context.config_file}")

    ffmpeg_command: list[str] = ["ffmpeg", "-y"]
    filter_parts: list[str] = []
    concat_inputs: list[str] = []

    for index, clip in enumerate(preview.clips):
        audio_path = context.audio_dir / clip.filename
        if not audio_path.exists():
            raise SystemExit(f"Missing audio clip referenced by config: {audio_path}")
        ffmpeg_command.extend(["-i", str(audio_path)])
        filter_parts.append(
            f"[{index}:a]atrim=0:{clip.duration_seconds:.6f},asetpts=PTS-STARTPTS[a{index}]"
        )
        concat_inputs.append(f"[a{index}]")

    filter_complex = ";".join(filter_parts + [f"{''.join(concat_inputs)}concat=n={len(preview.clips)}:v=0:a=1[outa]"])
    ffmpeg_command.extend(["-filter_complex", filter_complex, "-map", "[outa]"])

    if output_format == "wav":
        ffmpeg_command.extend(["-c:a", "pcm_s16le"])
    elif output_format == "mp3":
        ffmpeg_command.extend(["-c:a", "libmp3lame", "-q:a", "2"])
    else:
        raise SystemExit(f"Unsupported output format: {output_format}")

    ffmpeg_command.append(str(output_file))
    subprocess.run(ffmpeg_command, check=True)


def describe_preview(preview: PreviewSong) -> str:
    total_duration = sum(clip.duration_seconds for clip in preview.clips)
    clip_list = ", ".join(f"{clip.filename} ({clip.duration_seconds:.1f}s)" for clip in preview.clips)
    return f"{len(preview.clips)} clips, {total_duration:.1f}s total: {clip_list}"


def output_path_for(context: SongContext, output_root: Path, output_format: str) -> Path:
    album_id = context.song_dir.parents[1].name
    song_slug = context.song_dir.name
    return output_root / album_id / f"{song_slug}_preview.{output_format}"


def main() -> None:
    args = parse_args()
    contexts = resolve_song_contexts(args)
    repo_root = Path(__file__).resolve().parents[1]
    output_root = (repo_root / args.output_root).resolve()

    rendered = 0
    for index, context in enumerate(contexts):
        if index > 0:
            print()
        preview = parse_preview_song(context.config_file, args.main_repeats)
        output_file = output_path_for(context, output_root, args.format)
        print(f"Rendering {context.song_dir}")
        print(f"  output: {output_file}")
        print(f"  preview: {describe_preview(preview)}")
        if args.dry_run:
            print("  dry-run: preview not rendered")
            continue
        render_preview(context, preview, output_file, args.format)
        print(f"  wrote {output_file}")
        rendered += 1

    if len(contexts) > 1:
        print()
        action = "Would render" if args.dry_run else "Rendered"
        print(f"{action} {len(contexts) if args.dry_run else rendered} preview(s).")


if __name__ == "__main__":
    main()
