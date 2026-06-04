#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


STRING_FIELD_RE = r'"(?P<value>[^"]+)"'


@dataclass
class ValidationResult:
    errors: list[str]
    warnings: list[str]

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate packaged content manifests and assets.")
    parser.add_argument(
        "--root",
        default="src/content",
        help="Content root to validate. Defaults to src/content",
    )
    return parser.parse_args()


def extract_string_field(text: str, field_name: str) -> str | None:
    match = re.search(rf"{field_name}:\s*{STRING_FIELD_RE}", text)
    return match.group("value") if match else None


def extract_number_field(text: str, field_name: str) -> int | None:
    match = re.search(rf"{field_name}:\s*(\d+)", text)
    return int(match.group(1)) if match else None


def extract_string_array_field(text: str, field_name: str) -> list[str]:
    match = re.search(rf"{field_name}:\s*\[(?P<body>.*?)\]", text, flags=re.S)
    if not match:
      return []
    return re.findall(STRING_FIELD_RE, match.group("body"))


def extract_imported_local_assets(text: str) -> list[str]:
    return re.findall(r'from\s+"(\./[^"]+)"', text)


def extract_config_asset_refs(text: str) -> list[str]:
    return re.findall(r'assetUrl\("([^"]+)"\)', text)


def directory_has_files(root: Path) -> bool:
    return any(path.is_file() for path in root.rglob("*"))


def validate_artists(artists_root: Path, result: ValidationResult) -> set[str]:
    artist_ids: set[str] = set()
    for artist_file in sorted(artists_root.glob("*/artist.ts")):
        text = artist_file.read_text(encoding="utf-8")
        artist_id = extract_string_field(text, "id")
        if not artist_id:
            result.error(f"{artist_file}: missing artist id")
            continue
        if artist_id in artist_ids:
            result.error(f"duplicate artist id: {artist_id}")
            continue
        artist_ids.add(artist_id)
    return artist_ids


def validate_playlists(playlists_file: Path, known_song_ids: set[str], result: ValidationResult) -> None:
    if not playlists_file.exists():
        return
    text = playlists_file.read_text(encoding="utf-8")
    blocks = re.findall(r"songIds:\s*\[(?P<body>.*?)\]", text, flags=re.S)
    for index, body in enumerate(blocks, start=1):
        for song_id in re.findall(STRING_FIELD_RE, body):
            if song_id not in known_song_ids:
                result.error(f"{playlists_file}: playlist #{index} references unknown song id '{song_id}'")


def validate_album(album_dir: Path, known_artist_ids: set[str], result: ValidationResult) -> tuple[str | None, set[str]]:
    album_file = album_dir / "album.ts"
    if not album_file.exists():
        if directory_has_files(album_dir):
            result.warn(f"{album_dir}: no album.ts manifest found")
        return None, set()

    text = album_file.read_text(encoding="utf-8")
    album_id = extract_string_field(text, "id")
    if not album_id:
        result.error(f"{album_file}: missing album id")
        return None, set()

    artist_id = extract_string_field(text, "artistId")
    if not artist_id:
        result.error(f"{album_file}: missing artistId")
    elif artist_id not in known_artist_ids:
        result.error(f"{album_file}: unknown artistId '{artist_id}'")

    for relative_asset in extract_imported_local_assets(text):
        asset_path = (album_dir / relative_asset).resolve()
        if not asset_path.exists():
            result.error(f"{album_file}: missing imported asset {relative_asset}")

    declared_song_ids = set(extract_string_array_field(text, "songIds"))
    recommended_song_id = extract_string_field(text, "recommendedSongId")
    songs_root = album_dir / "songs"
    if not songs_root.exists():
        result.error(f"{album_file}: missing songs directory")
        return album_id, declared_song_ids

    discovered_song_ids: set[str] = set()
    track_numbers: dict[int, str] = {}
    for song_dir in sorted(path for path in songs_root.iterdir() if path.is_dir()):
        validate_song(song_dir, album_id, artist_id, discovered_song_ids, track_numbers, result)

    missing_song_dirs = declared_song_ids - discovered_song_ids
    extra_song_dirs = discovered_song_ids - declared_song_ids
    for song_id in sorted(missing_song_dirs):
        result.error(f"{album_file}: songIds references missing packaged song '{song_id}'")
    for song_id in sorted(extra_song_dirs):
        result.error(f"{album_file}: packaged song '{song_id}' is missing from songIds")

    if recommended_song_id and recommended_song_id not in discovered_song_ids:
        result.error(f"{album_file}: recommendedSongId '{recommended_song_id}' does not exist in album package")

    return album_id, discovered_song_ids


def validate_song(
    song_dir: Path,
    album_id: str,
    artist_id: str | None,
    discovered_song_ids: set[str],
    track_numbers: dict[int, str],
    result: ValidationResult,
) -> None:
    song_file = song_dir / "song.ts"
    config_file = song_dir / "config.ts"
    audio_dir = song_dir / "audio"

    if not song_file.exists():
        if config_file.exists() or directory_has_files(song_dir):
            result.warn(f"{song_dir}: partial song package found without song.ts")
        return

    text = song_file.read_text(encoding="utf-8")
    song_id = extract_string_field(text, "id")
    if not song_id:
        result.error(f"{song_file}: missing song id")
        return

    if song_id in discovered_song_ids:
        result.error(f"duplicate song id: {song_id}")
        return
    discovered_song_ids.add(song_id)

    song_album_id = extract_string_field(text, "albumId")
    if song_album_id != album_id:
        result.error(f"{song_file}: albumId '{song_album_id}' does not match parent album '{album_id}'")

    song_artist_id = extract_string_field(text, "artistId")
    if artist_id and song_artist_id != artist_id:
        result.error(f"{song_file}: artistId '{song_artist_id}' does not match parent album artist '{artist_id}'")

    track_number = extract_number_field(text, "trackNumber")
    if track_number is None:
        result.error(f"{song_file}: missing trackNumber")
    else:
        previous_song = track_numbers.get(track_number)
        if previous_song:
            result.error(f"{song_file}: duplicate trackNumber {track_number} already used by '{previous_song}'")
        track_numbers[track_number] = song_id

    if not config_file.exists():
        result.error(f"{song_file}: missing config.ts")
        return

    if not audio_dir.exists():
        result.error(f"{song_file}: missing audio directory")
        return

    audio_files = sorted(audio_dir.glob("*.ogg"))
    if not audio_files:
        result.error(f"{song_file}: audio directory contains no .ogg files")
    else:
        for audio_file in audio_files:
            if audio_file.stat().st_size == 0:
                result.warn(f"{song_file}: placeholder audio file detected at {audio_file.name}")

    config_text = config_file.read_text(encoding="utf-8")
    config_song_id = extract_string_field(config_text, "id")
    if not config_song_id:
        result.error(f"{config_file}: missing SongConfig id")

    for asset_name in extract_config_asset_refs(config_text):
        asset_path = audio_dir / asset_name
        if not asset_path.exists():
            result.error(f"{config_file}: missing referenced audio file '{asset_name}'")


def validate_content(content_root: Path) -> ValidationResult:
    result = ValidationResult(errors=[], warnings=[])
    artists_root = content_root / "artists"
    albums_root = content_root / "albums"
    playlists_file = content_root / "playlists.ts"

    if not artists_root.exists():
        result.error(f"{artists_root}: missing artists directory")
        return result
    if not albums_root.exists():
        result.error(f"{albums_root}: missing albums directory")
        return result

    known_artist_ids = validate_artists(artists_root, result)
    known_album_ids: set[str] = set()
    known_song_ids: set[str] = set()

    for album_dir in sorted(path for path in albums_root.iterdir() if path.is_dir()):
        album_id, song_ids = validate_album(album_dir, known_artist_ids, result)
        if album_id:
            if album_id in known_album_ids:
                result.error(f"duplicate album id: {album_id}")
            known_album_ids.add(album_id)
            known_song_ids.update(song_ids)

    validate_playlists(playlists_file, known_song_ids, result)
    return result


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    content_root = (repo_root / args.root).resolve()
    result = validate_content(content_root)

    if result.warnings:
        print("Warnings:")
        for warning in result.warnings:
            print(f"  - {warning}")

    if result.errors:
        print("Errors:")
        for error in result.errors:
            print(f"  - {error}")
        raise SystemExit(1)

    print("Content validation passed.")


if __name__ == "__main__":
    main()
