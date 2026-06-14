#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from hydrate_song_config import (
    SongContext,
    collect_clips,
    extract_float_field,
    hydrate_config,
    infer_timing,
    parse_preferred_main_bars,
    print_summary,
)
from scaffold_content import (
    GENERATED_HEADER,
    const_name,
    format_string_array,
    scaffold_artist,
    slugify,
    sync_album_songs_index,
    sync_albums_index,
    sync_artists_index,
)


@dataclass
class ImportedAsset:
    identifier: str
    source_path: Path
    target_relative_path: str


@dataclass
class SongImportPlan:
    title: str
    slug: str
    song_id: str
    track_number: int
    difficulty: int
    energy: int
    mood_tags: list[str]
    recommended_weight: float
    availability: str
    duration_label: str | None
    cover_art: str | None
    backdrop_preset: str | None
    backdrop_params: dict[str, Any] | None
    audio_dir: Path
    transport_defaults: dict[str, Any]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import a prepared album source folder into packaged in-game content."
    )
    parser.add_argument(
        "--source-dir",
        required=True,
        help="Folder containing album.json and referenced assets/audio.",
    )
    parser.add_argument(
        "--content-root",
        default="src/content",
        help="Content root. Defaults to src/content",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the planned import without writing files.",
    )
    parser.add_argument(
        "--bootstrap-manifest",
        action="store_true",
        help="Generate a draft album.json from numbered song folders instead of importing.",
    )
    parser.add_argument(
        "--no-hydrate",
        action="store_true",
        help="Skip audio-driven groove hydration after copying clips.",
    )
    parser.add_argument("--artist-id", help="Artist id to use when bootstrapping album.json")
    parser.add_argument("--artist-name", help="Artist display name to use when bootstrapping album.json")
    parser.add_argument("--album-id", help="Album id to use when bootstrapping album.json")
    parser.add_argument("--album-title", help="Album title to use when bootstrapping album.json")
    parser.add_argument("--year", type=int, help="Album year to use when bootstrapping album.json")
    parser.add_argument("--bpm-min", type=int, default=60)
    parser.add_argument("--bpm-max", type=int, default=180)
    parser.add_argument("--bpm-step", type=float, default=0.1)
    parser.add_argument("--max-bars", type=int, default=16)
    parser.add_argument("--beats-per-bar", type=int, default=4)
    parser.add_argument(
        "--preferred-main-bars",
        default="4,8,2,6",
        help="Comma-separated preferred main-loop bar counts for hydration.",
    )
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_text(path: Path, text: str, dry_run: bool) -> None:
    if dry_run:
        print(f"[dry-run] write {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def ensure_dir(path: Path, dry_run: bool) -> None:
    if dry_run:
        print(f"[dry-run] mkdir -p {path}")
        return
    path.mkdir(parents=True, exist_ok=True)


def copy_file(source: Path, target: Path, dry_run: bool) -> None:
    if dry_run:
        print(f"[dry-run] copy {source} -> {target}")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def stringify_ts(value: Any) -> str:
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    return str(value)


def resolve_asset_value(
    value: Any,
    source_root: Path,
    target_base_dir: Path,
    import_prefix: str,
    assets: list[ImportedAsset],
) -> Any:
    if isinstance(value, dict):
        return {
            key: resolve_asset_value(child, source_root, target_base_dir, import_prefix, assets)
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [resolve_asset_value(child, source_root, target_base_dir, import_prefix, assets) for child in value]
    if not isinstance(value, str):
        return value

    candidate = (source_root / value).resolve()
    if not candidate.exists() or not candidate.is_file():
        return value

    relative_path = Path(value)
    target_relative_path = relative_path.as_posix()
    identifier = const_name(f"{import_prefix}_{relative_path.stem}", "_ASSET")
    assets.append(
        ImportedAsset(
            identifier=identifier,
            source_path=candidate,
            target_relative_path=target_relative_path,
        )
    )
    return {"__asset_identifier__": identifier}


def render_ts_object(value: Any, indent_level: int = 0) -> str:
    indent = "  " * indent_level
    child_indent = "  " * (indent_level + 1)
    if isinstance(value, dict):
        asset_identifier = value.get("__asset_identifier__") if "__asset_identifier__" in value else None
        if asset_identifier:
            return str(asset_identifier)
        if not value:
            return "{}"
        lines = ["{"]
        for key, child in value.items():
            lines.append(f"{child_indent}{key}: {render_ts_object(child, indent_level + 1)},")
        lines.append(f"{indent}}}")
        return "\n".join(lines)
    if isinstance(value, list):
        if not value:
            return "[]"
        lines = ["["]
        for child in value:
            lines.append(f"{child_indent}{render_ts_object(child, indent_level + 1)},")
        lines.append(f"{indent}]")
        return "\n".join(lines)
    return stringify_ts(value)


def load_song_plans(manifest: dict[str, Any], source_root: Path, artist_id: str) -> list[SongImportPlan]:
    songs = manifest.get("songs")
    if not isinstance(songs, list) or not songs:
        raise SystemExit("album.json must include a non-empty songs array.")

    plans: list[SongImportPlan] = []
    for index, song in enumerate(songs, start=1):
        if not isinstance(song, dict):
            raise SystemExit("Each song entry in album.json must be an object.")
        title = str(song.get("title") or "").strip()
        if not title:
            raise SystemExit("Each song entry must include title.")
        slug = str(song.get("slug") or slugify(title))
        song_id = str(song.get("id") or f"{artist_id}_{slug}")
        track_number = int(song.get("trackNumber") or index)
        audio_dir_value = song.get("audioDir") or f"songs/{slug}/audio"
        audio_dir = (source_root / str(audio_dir_value)).resolve()
        if not audio_dir.exists():
            raise SystemExit(f"Missing audioDir for song '{title}': {audio_dir}")

        transport_defaults = {
            "bpm": int(song.get("bpm") or 120),
            "beatsPerBar": int(song.get("beatsPerBar") or 4),
            "barsPerLoop": int(song.get("barsPerLoop") or 4),
            "harmonyCycleBars": int(song.get("harmonyCycleBars") or 8),
            "rootNote": str(song.get("rootNote") or "C"),
            "mode": str(song.get("mode") or "pentatonicMinor"),
        }

        plans.append(
            SongImportPlan(
                title=title,
                slug=slug,
                song_id=song_id,
                track_number=track_number,
                difficulty=int(song.get("difficulty") or 3),
                energy=int(song.get("energy") or 3),
                mood_tags=[str(tag) for tag in song.get("moodTags") or ["dark", "driving"]],
                recommended_weight=float(song.get("recommendedWeight") or 0.7),
                availability=str(song.get("availability") or manifest.get("availability") or "hidden"),
                duration_label=str(song["durationLabel"]) if song.get("durationLabel") else None,
                cover_art=str(song["coverArt"]) if song.get("coverArt") else None,
                backdrop_preset=str(song["backdropPreset"]) if song.get("backdropPreset") else None,
                backdrop_params=dict(song["backdropParams"]) if isinstance(song.get("backdropParams"), dict) else None,
                audio_dir=audio_dir,
                transport_defaults=transport_defaults,
            )
        )
    return sorted(plans, key=lambda plan: plan.track_number)


def discover_numbered_song_dirs(source_root: Path) -> list[Path]:
    numbered_dirs = [
        path
        for path in source_root.iterdir()
        if path.is_dir() and path.name.isdigit()
    ]
    return sorted(numbered_dirs, key=lambda path: int(path.name))


def build_bootstrap_manifest(args: argparse.Namespace, source_root: Path) -> dict[str, Any]:
    numbered_dirs = discover_numbered_song_dirs(source_root)
    if not numbered_dirs:
        raise SystemExit(
            "Bootstrap mode expects numbered song folders like 1/, 2/, 3/ inside the source directory."
        )

    artist_id = args.artist_id or slugify(source_root.parent.name or "artist")
    album_title = args.album_title or f"{source_root.parent.name.title()} {source_root.name}"
    album_id = args.album_id or f"{artist_id}_{slugify(album_title)}"

    songs: list[dict[str, Any]] = []
    for song_dir in numbered_dirs:
        track_number = int(song_dir.name)
        slug = f"track-{track_number:02d}"
        songs.append(
            {
                "title": f"Track {track_number}",
                "slug": slug,
                "id": f"{artist_id}_{slug}",
                "trackNumber": track_number,
                "difficulty": 3,
                "energy": 3,
                "moodTags": ["dark", "driving"],
                "recommendedWeight": 0.7,
                "availability": "hidden",
                "audioDir": song_dir.name,
                "bpm": 120,
                "beatsPerBar": 4,
                "barsPerLoop": 4,
                "harmonyCycleBars": 8,
                "rootNote": "C",
                "mode": "pentatonicMinor",
            }
        )

    return {
        "artistId": artist_id,
        "artistName": args.artist_name or artist_id.replace("-", " ").title(),
        "albumId": album_id,
        "title": album_title,
        "year": args.year or 2026,
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
            "backdropPreset": "brutalist-club",
        },
        "songs": songs,
    }


def maybe_bootstrap_manifest(args: argparse.Namespace, source_root: Path) -> bool:
    if not args.bootstrap_manifest:
        return False
    manifest_path = source_root / "album.json"
    if manifest_path.exists():
        raise SystemExit(f"album.json already exists: {manifest_path}")
    manifest = build_bootstrap_manifest(args, source_root)
    rendered = json.dumps(manifest, indent=2) + "\n"
    write_text(manifest_path, rendered, args.dry_run)
    print(f"{'Would write' if args.dry_run else 'Wrote'} draft manifest: {manifest_path}")
    print("Edit the generated titles, tags, theme, and per-song metadata, then rerun without --bootstrap-manifest.")
    return True


def render_album_manifest(
    album_id: str,
    manifest: dict[str, Any],
    source_root: Path,
    album_dir: Path,
    song_ids: list[str],
) -> tuple[str, list[ImportedAsset]]:
    assets: list[ImportedAsset] = []
    title = str(manifest["title"])
    artist_id = str(manifest["artistId"])
    cover_art = resolve_asset_value(manifest.get("coverArt"), source_root, album_dir, f"{album_id}_cover", assets)
    theme = dict(manifest.get("theme") or {})
    if not theme:
        raise SystemExit("album.json must include a theme object.")
    theme = resolve_asset_value(theme, source_root, album_dir, f"{album_id}_theme", assets)
    const = const_name(album_id, "_ALBUM")

    import_lines = ['import type { AlbumManifest } from "../../schema";']
    for asset in assets:
        import_lines.append(f'import {asset.identifier} from "./{asset.target_relative_path}";')

    body = GENERATED_HEADER
    body += "\n".join(import_lines) + "\n\n"
    body += f"export const {const}: AlbumManifest = {{\n"
    body += f'  id: "{album_id}",\n'
    body += f'  slug: "{album_id}",\n'
    body += f'  title: "{title}",\n'
    body += f'  artistId: "{artist_id}",\n'
    if cover_art is not None:
        body += f"  coverArt: {render_ts_object(cover_art)},\n"
    if manifest.get("year"):
        body += f"  year: {int(manifest['year'])},\n"
    if manifest.get("description"):
        body += f"  description: {json.dumps(str(manifest['description']))},\n"
    body += f"  theme: {render_ts_object(theme, 1)},\n"
    body += f"  tags: {format_string_array([str(tag) for tag in manifest.get('tags') or []], 4)},\n"
    body += "  songIds: [\n"
    for song_id in song_ids:
        body += f'    "{song_id}",\n'
    body += "  ],\n"
    if manifest.get("recommendedSongId"):
        body += f'  recommendedSongId: "{str(manifest["recommendedSongId"])}",\n'
    body += f"  sortOrder: {int(manifest.get('sortOrder') or 999)},\n"
    body += f'  availability: "{str(manifest.get("availability") or "hidden")}",\n'
    body += "};\n"
    return body, assets


def render_song_manifest(
    plan: SongImportPlan,
    album_id: str,
    artist_id: str,
    source_root: Path,
    song_dir: Path,
) -> tuple[str, list[ImportedAsset]]:
    assets: list[ImportedAsset] = []
    cover_art = resolve_asset_value(plan.cover_art, source_root, song_dir, f"{plan.slug}_cover", assets)
    backdrop_params = resolve_asset_value(plan.backdrop_params, source_root, song_dir, f"{plan.slug}_backdrop", assets)
    config_const = f"SONG{plan.track_number}_CONFIG"
    manifest_const = const_name(plan.slug, "_SONG")

    import_lines = ['import type { SongManifest } from "../../../../schema";']
    for asset in assets:
        import_lines.append(f'import {asset.identifier} from "./{asset.target_relative_path}";')

    body = GENERATED_HEADER
    body += "\n".join(import_lines) + "\n\n"
    body += f"export const {manifest_const}: SongManifest = {{\n"
    body += f'  id: "{plan.song_id}",\n'
    body += f'  slug: "{plan.slug}",\n'
    body += f'  title: "{plan.title}",\n'
    body += f'  artistId: "{artist_id}",\n'
    body += f'  albumId: "{album_id}",\n'
    body += f"  trackNumber: {plan.track_number},\n"
    if plan.duration_label:
        body += f"  durationLabel: {json.dumps(plan.duration_label)},\n"
    body += f"  difficulty: {plan.difficulty},\n"
    body += f"  energy: {plan.energy},\n"
    body += f"  moodTags: {format_string_array(plan.mood_tags, 4)},\n"
    if cover_art is not None:
        body += f"  coverArt: {render_ts_object(cover_art)},\n"
    body += f"  recommendedWeight: {plan.recommended_weight},\n"
    body += f'  availability: "{plan.availability}",\n'
    if plan.backdrop_preset:
        body += f'  backdropPreset: "{plan.backdrop_preset}",\n'
    if backdrop_params:
        body += f"  backdropParams: {render_ts_object(backdrop_params, 1)},\n"
    body += f'  loadConfig: async () => (await import("./config")).{config_const},\n'
    body += "};\n"
    return body, assets


def render_initial_config(plan: SongImportPlan) -> str:
    config_const = f"SONG{plan.track_number}_CONFIG"
    transport = plan.transport_defaults
    body = GENERATED_HEADER
    body += 'import type { SongConfig } from "../../../../../game/songConfig";\n\n'
    body += "const assetUrl = (relativePath: string): string =>\n"
    body += '  new URL(`./audio/${relativePath}`, import.meta.url).href;\n\n'
    body += f"export const {config_const}: SongConfig = {{\n"
    body += f'  id: "song{plan.track_number}",\n'
    body += "  transport: {\n"
    body += f'    bpm: {transport["bpm"]},\n'
    body += f'    beatsPerBar: {transport["beatsPerBar"]},\n'
    body += f'    barsPerLoop: {transport["barsPerLoop"]},\n'
    body += f'    harmonyCycleBars: {transport["harmonyCycleBars"]},\n'
    body += "  },\n"
    body += "  harmonyTimeline: [\n"
    body += (
        f'    {{ startBar: 1, lengthBars: {transport["harmonyCycleBars"]}, '
        f'rootNote: "{transport["rootNote"]}", mode: "{transport["mode"]}" }},\n'
    )
    body += "  ],\n"
    body += "  grooveLevels: [\n"
    body += "    {\n"
    body += "      level: 1,\n"
    body += "      main: {\n"
    body += '        src: assetUrl("01m.ogg"),\n'
    body += "        bars: 4,\n"
    body += "      },\n"
    body += "      intro: {\n"
    body += '        src: assetUrl("01i.ogg"),\n'
    body += "        bars: 2,\n"
    body += "      },\n"
    body += "    },\n"
    body += "  ],\n"
    body += "};\n"
    return body


def copy_imported_assets(assets: list[ImportedAsset], target_base_dir: Path, dry_run: bool) -> None:
    for asset in assets:
        copy_file(asset.source_path, target_base_dir / asset.target_relative_path, dry_run)


def copy_song_audio(source_audio_dir: Path, target_audio_dir: Path, dry_run: bool) -> None:
    audio_files = sorted(source_audio_dir.glob("*.ogg"))
    if not audio_files:
        raise SystemExit(f"No .ogg files found in {source_audio_dir}")
    ensure_dir(target_audio_dir, dry_run)
    for audio_file in audio_files:
        copy_file(audio_file, target_audio_dir / audio_file.name, dry_run)


def hydrate_imported_song(song_dir: Path, args: argparse.Namespace) -> None:
    context = SongContext(song_dir=song_dir, config_file=song_dir / "config.ts", audio_dir=song_dir / "audio")
    clips = collect_clips(context.audio_dir)
    existing_text = context.config_file.read_text(encoding="utf-8")
    existing_bpm = extract_float_field(existing_text, "bpm") or 120.0
    inference = infer_timing(
        clips,
        beats_per_bar=args.beats_per_bar,
        bpm_min=args.bpm_min,
        bpm_max=args.bpm_max,
        bpm_step=args.bpm_step,
        max_bars=args.max_bars,
        preferred_main_bars=parse_preferred_main_bars(args.preferred_main_bars),
        preferred_bpm=existing_bpm,
    )
    print_summary(context, inference, clips)
    hydrate_config(context, inference, dry_run=False)


def import_album(args: argparse.Namespace) -> None:
    repo_root = Path(__file__).resolve().parents[1]
    source_root = Path(args.source_dir).resolve()
    if maybe_bootstrap_manifest(args, source_root):
        return
    manifest_path = source_root / "album.json"
    if not manifest_path.exists():
        raise SystemExit(
            f"Missing album manifest: {manifest_path}\n"
            "Run again with --bootstrap-manifest to generate a draft album.json from numbered song folders."
        )
    manifest = read_json(manifest_path)

    artist_id = str(manifest.get("artistId") or "").strip()
    title = str(manifest.get("title") or "").strip()
    if not artist_id or not title:
        raise SystemExit("album.json must include artistId and title.")

    content_root = (repo_root / args.content_root).resolve()
    album_id = str(manifest.get("albumId") or f"{artist_id}_{slugify(title)}")
    album_dir = content_root / "albums" / album_id
    if album_dir.exists() and not args.dry_run:
        raise SystemExit(f"Album already exists: {album_dir}")

    song_plans = load_song_plans(manifest, source_root, artist_id)
    song_ids = [plan.song_id for plan in song_plans]

    print(f"Importing album '{title}' -> {album_id}")
    print(f"  source: {source_root}")
    print(f"  songs: {len(song_plans)}")

    scaffold_artist(content_root, artist_id, manifest.get("artistName"), args.dry_run)
    ensure_dir(album_dir / "songs", args.dry_run)

    album_text, album_assets = render_album_manifest(album_id, manifest, source_root, album_dir, song_ids)
    write_text(album_dir / "album.ts", album_text, args.dry_run)
    copy_imported_assets(album_assets, album_dir, args.dry_run)

    for plan in song_plans:
        song_dir = album_dir / "songs" / plan.slug
        ensure_dir(song_dir / "audio", args.dry_run)
        song_text, song_assets = render_song_manifest(plan, album_id, artist_id, source_root, song_dir)
        write_text(song_dir / "song.ts", song_text, args.dry_run)
        write_text(song_dir / "config.ts", render_initial_config(plan), args.dry_run)
        copy_imported_assets(song_assets, song_dir, args.dry_run)
        copy_song_audio(plan.audio_dir, song_dir / "audio", args.dry_run)

    sync_artists_index(content_root, args.dry_run)
    sync_album_songs_index(album_dir, args.dry_run)
    sync_albums_index(content_root, args.dry_run)

    if args.dry_run:
        print("[dry-run] hydrate step skipped")
        return

    if args.no_hydrate:
        print("Hydration skipped by request.")
        return

    print()
    print("Hydrating imported songs...")
    for plan in song_plans:
        print()
        hydrate_imported_song(album_dir / "songs" / plan.slug, args)


def main() -> None:
    args = parse_args()
    import_album(args)


if __name__ == "__main__":
    main()
