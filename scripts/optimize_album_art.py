#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
ALBUMS_ROOT = REPO_ROOT / "src" / "content" / "albums"
IMPORT_PATTERN = re.compile(r'from\s+"(\./cover\.[A-Za-z0-9]+)"')


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert packaged album cover art to optimized WebP and rewrite album manifests.",
    )
    parser.add_argument(
        "--album-id",
        action="append",
        help="Limit processing to one or more packaged album ids.",
    )
    parser.add_argument(
        "--max-size",
        type=int,
        default=1280,
        help="Maximum width or height of the optimized cover. Default: 1280.",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=82,
        help="WebP quality. Default: 82.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show planned conversions without writing files.",
    )
    return parser.parse_args()


def find_album_dirs(album_ids: list[str] | None) -> list[Path]:
    if album_ids:
        album_dirs: list[Path] = []
        for album_id in album_ids:
            album_dir = ALBUMS_ROOT / album_id
            if not album_dir.is_dir():
                raise FileNotFoundError(f"Album package not found: {album_id}")
            album_dirs.append(album_dir)
        return album_dirs

    return sorted(path for path in ALBUMS_ROOT.iterdir() if path.is_dir())


def find_cover_import(album_manifest: Path) -> str | None:
    match = IMPORT_PATTERN.search(album_manifest.read_text())
    return match.group(1) if match else None


def optimized_cover_path(source_cover: Path) -> Path:
    return source_cover.with_name("cover.webp")


def format_size(byte_count: int) -> str:
    units = ["B", "KB", "MB", "GB"]
    value = float(byte_count)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{byte_count}B"


def convert_cover(source: Path, destination: Path, max_size: int, quality: int, dry_run: bool) -> None:
    if dry_run:
        return

    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_destination = destination.with_name(f"{destination.stem}.tmp{destination.suffix}")
    scale_filter = (
        f"scale='if(gt(iw,ih),min(iw,{max_size}),-2)':'if(gt(iw,ih),-2,min(ih,{max_size}))':flags=lanczos"
    )
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(source),
        "-vf",
        scale_filter,
        "-c:v",
        "libwebp",
        "-quality",
        str(quality),
        "-compression_level",
        "6",
        str(temp_destination),
    ]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    temp_destination.replace(destination)


def rewrite_manifest_import(album_manifest: Path, old_import: str, dry_run: bool) -> None:
    text = album_manifest.read_text()
    updated = text.replace(old_import, "./cover.webp")
    if updated == text or dry_run:
        return
    album_manifest.write_text(updated)


def main() -> int:
    args = parse_args()

    if shutil.which("ffmpeg") is None:
        print("ffmpeg is required for cover optimization but was not found in PATH.", file=sys.stderr)
        return 1

    album_dirs = find_album_dirs(args.album_id)
    planned = []

    for album_dir in album_dirs:
        album_manifest = album_dir / "album.ts"
        if not album_manifest.is_file():
            continue

        import_path = find_cover_import(album_manifest)
        if not import_path:
            continue

        source_cover = (album_dir / import_path.removeprefix("./")).resolve()
        if not source_cover.is_file():
            raise FileNotFoundError(f"Cover file not found for {album_dir.name}: {source_cover}")

        destination_cover = optimized_cover_path(source_cover)
        planned.append((album_manifest, import_path, source_cover, destination_cover))

    if not planned:
        print("No album covers found to optimize.")
        return 0

    print(f"{'Would optimize' if args.dry_run else 'Optimizing'} {len(planned)} album covers:")

    for album_manifest, import_path, source_cover, destination_cover in planned:
        before_size = source_cover.stat().st_size
        if args.dry_run:
            print(
                f"  - {album_manifest.parent.name}: {source_cover.name} ({format_size(before_size)}) -> {destination_cover.name}",
            )
            continue

        convert_cover(source_cover, destination_cover, args.max_size, args.quality, args.dry_run)
        rewrite_manifest_import(album_manifest, import_path, args.dry_run)

        after_size = destination_cover.stat().st_size
        print(
            f"  - {album_manifest.parent.name}: {source_cover.name} ({format_size(before_size)}) -> "
            f"{destination_cover.name} ({format_size(after_size)})",
        )

        if source_cover.resolve() != destination_cover.resolve() and source_cover.exists():
            source_cover.unlink()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
