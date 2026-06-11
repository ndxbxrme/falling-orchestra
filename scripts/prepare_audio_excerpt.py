#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a short 16kHz mono WAV excerpt for local audio-model experiments."
    )
    parser.add_argument("input", type=Path, help="Source audio file.")
    parser.add_argument(
        "--output",
        type=Path,
        help="Output WAV path. Defaults to <input-stem>_16k_excerpt.wav next to the input.",
    )
    parser.add_argument("--start", type=float, default=0.0, help="Start time in seconds. Default: 0.")
    parser.add_argument("--duration", type=float, default=30.0, help="Excerpt duration in seconds. Default: 30.")
    parser.add_argument("--sample-rate", type=int, default=16000, help="Target sample rate. Default: 16000.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if shutil.which("ffmpeg") is None:
        print("ffmpeg is required but was not found in PATH.", file=sys.stderr)
        return 1

    if not args.input.exists():
        print(f"Input audio not found: {args.input}", file=sys.stderr)
        return 1

    output = args.output or args.input.with_name(f"{args.input.stem}_{args.sample_rate}hz_excerpt.wav")
    output.parent.mkdir(parents=True, exist_ok=True)

    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        str(args.start),
        "-t",
        str(args.duration),
        "-i",
        str(args.input),
        "-ac",
        "1",
        "-ar",
        str(args.sample_rate),
        "-vn",
        str(output),
    ]

    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        print("ffmpeg failed to create the excerpt.", file=sys.stderr)
        return completed.returncode

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
