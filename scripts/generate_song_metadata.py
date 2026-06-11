#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import json
import sys
from pathlib import Path
from typing import Any


DEFAULT_PROMPT = (
    "Analyze this short electronic music preview and respond with JSON only. "
    "Use this exact schema: "
    '{"energy": 1-5 integer, "moodTags": ["tag", "tag"], "description": "one short sentence"}. '
    "Keep moodTags short, lower-case, and music-library friendly."
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a local llama.cpp/llama-cpp-python audio metadata proof of concept."
    )
    parser.add_argument("audio", type=Path, help="Prepared 16kHz mono WAV snippet.")
    parser.add_argument(
        "--model-path",
        type=Path,
        default=Path("/mnt/d/AI/models/Qwen2-Audio-7B-Instruct-Q4_K_M.gguf"),
        help="Path to the GGUF model file.",
    )
    parser.add_argument(
        "--mmproj-path",
        type=Path,
        default=Path("/mnt/d/AI/models/Qwen2-Audio-7B-Instruct.mmproj-f16.gguf"),
        help="Path to the multimodal projector GGUF file.",
    )
    parser.add_argument(
        "--chat-handler",
        default="MoondreamChatHandler",
        help="Chat handler class name to import from llama_cpp.llama_chat_format.",
    )
    parser.add_argument("--prompt", default=DEFAULT_PROMPT, help="User prompt sent alongside the audio.")
    parser.add_argument("--n-ctx", type=int, default=2048, help="Context window. Default: 2048.")
    parser.add_argument("--n-gpu-layers", type=int, default=-1, help="GPU offload layers. Default: -1.")
    parser.add_argument("--max-tokens", type=int, default=256, help="Max output tokens. Default: 256.")
    parser.add_argument(
        "--raw-output",
        type=Path,
        help="Optional path to save the raw model response text.",
    )
    return parser.parse_args()


def extract_json(text: str) -> Any:
    stripped = text.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        return json.loads(stripped[start : end + 1])

    raise ValueError("Model output did not contain valid JSON.")


def main() -> int:
    args = parse_args()

    if not args.audio.exists():
        print(f"Audio snippet not found: {args.audio}", file=sys.stderr)
        return 1
    if not args.model_path.exists():
        print(f"Model file not found: {args.model_path}", file=sys.stderr)
        return 1
    if not args.mmproj_path.exists():
        print(
            f"Multimodal projector file not found: {args.mmproj_path}\n"
            "Qwen2-Audio local runs need a matching mmproj file.",
            file=sys.stderr,
        )
        return 1

    try:
        from llama_cpp import Llama
        from llama_cpp import llama_chat_format
    except ImportError as exc:
        print(
            "llama_cpp is not installed in this environment.\n"
            "Install a multimodal-capable llama-cpp-python build before running this script.",
            file=sys.stderr,
        )
        print(str(exc), file=sys.stderr)
        return 1

    handler_factory = getattr(llama_chat_format, args.chat_handler, None)
    if handler_factory is None:
        print(
            f"Chat handler '{args.chat_handler}' was not found in llama_cpp.llama_chat_format.\n"
            "You may need a fork/build with multimodal audio support or a different handler name.",
            file=sys.stderr,
        )
        return 1

    handler = handler_factory(clip_model_path=str(args.mmproj_path))
    llm = Llama(
        model_path=str(args.model_path),
        chat_handler=handler,
        n_ctx=args.n_ctx,
        n_gpu_layers=args.n_gpu_layers,
        verbose=False,
    )

    response = llm.create_chat_completion(
        max_tokens=args.max_tokens,
        temperature=0.1,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": args.prompt},
                    # This is intentionally using the current multimodal compatibility hack path.
                    {"type": "image_url", "image_url": str(args.audio.resolve())},
                ],
            }
        ],
    )

    text = response["choices"][0]["message"]["content"]
    if args.raw_output:
        args.raw_output.parent.mkdir(parents=True, exist_ok=True)
        args.raw_output.write_text(text, encoding="utf-8")

    print("Raw response:")
    print(text)
    print()
    print("Parsed JSON:")
    try:
        parsed = extract_json(text)
        print(json.dumps(parsed, indent=2))
    finally:
        del llm
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
