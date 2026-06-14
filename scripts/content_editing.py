from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class SongPaths:
    song_id: str
    song_dir: Path
    song_file: Path
    config_file: Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def content_root() -> Path:
    return repo_root() / "src" / "content" / "albums"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


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
        if not in_double and not in_backtick and char == "'":
            in_single = not in_single
            continue
        if not in_single and not in_backtick and char == '"':
            in_double = not in_double
            continue
        if not in_single and not in_double and char == "`":
            in_backtick = not in_backtick
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


def replace_number_field(text: str, field_name: str, value: int | float) -> str:
    rendered = str(int(value)) if int(value) == value else (f"{value:.4f}".rstrip("0").rstrip("."))
    next_text = re.sub(rf"({field_name}:\s*)(\d+(?:\.\d+)?)", rf"\1{rendered}", text, count=1)
    if next_text == text:
        raise ValueError(f"Could not find '{field_name}' in file")
    return next_text


def replace_property_literal(text: str, property_name: str, rendered_value: str) -> str:
    match = re.search(rf"(?P<indent>^\s*){property_name}:\s*", text, flags=re.M)
    if not match:
        raise ValueError(f"Could not find '{property_name}' in file")
    property_start = match.start()
    value_start = match.end()
    while value_start < len(text) and text[value_start].isspace():
        value_start += 1
    value_end = find_matching_bracket(text, value_start)
    replace_end = value_end + 1
    while replace_end < len(text) and text[replace_end].isspace():
        replace_end += 1
    if replace_end < len(text) and text[replace_end] == ",":
        replace_end += 1
    return f"{text[:property_start]}{match.group('indent')}{property_name}: {rendered_value},{text[replace_end:]}"


def render_harmony_timeline(bars: list[dict[str, str]]) -> str:
    if not bars:
        return "[]"
    spans: list[dict[str, Any]] = []
    current = bars[0]
    start_bar = 1
    length_bars = 1
    for index in range(1, len(bars)):
        next_bar = bars[index]
        if next_bar["rootNote"] == current["rootNote"] and next_bar["mode"] == current["mode"]:
            length_bars += 1
            continue
        spans.append({
            "startBar": start_bar,
            "lengthBars": length_bars,
            "rootNote": current["rootNote"],
            "mode": current["mode"],
        })
        current = next_bar
        start_bar = index + 1
        length_bars = 1
    spans.append({
        "startBar": start_bar,
        "lengthBars": length_bars,
        "rootNote": current["rootNote"],
        "mode": current["mode"],
    })
    return "[\n" + "\n".join(
        f'    {{ startBar: {span["startBar"]}, lengthBars: {span["lengthBars"]}, rootNote: "{span["rootNote"]}", mode: "{span["mode"]}" }},'
        for span in spans
    ) + "\n  ]"


def build_updated_config_text(original_text: str, cycle_bars: int, bars: list[dict[str, str]]) -> str:
    next_text = replace_number_field(original_text, "harmonyCycleBars", cycle_bars)
    next_text = replace_property_literal(next_text, "harmonyTimeline", render_harmony_timeline(bars))
    return next_text


def _find_property_block(text: str, property_name: str) -> tuple[int, int, int, str] | None:
    match = re.search(rf"(?P<indent>^\s*){property_name}:\s*", text, flags=re.M)
    if not match:
        return None
    value_start = match.end()
    while value_start < len(text) and text[value_start].isspace():
        value_start += 1
    value_end = find_matching_bracket(text, value_start)
    return match.start(), value_start, value_end, match.group("indent")


def _find_level_block(groove_levels_text: str, level: int) -> tuple[int, int] | None:
    search_index = 0
    while True:
        block_start = groove_levels_text.find("{", search_index)
        if block_start < 0:
            return None
        block_end = find_matching_bracket(groove_levels_text, block_start)
        block_text = groove_levels_text[block_start:block_end + 1]
        if re.search(rf"\blevel:\s*{level}\b", block_text):
            return block_start, block_end
        search_index = block_end + 1


def _insert_or_replace_number_property(block_text: str, property_name: str, value: int) -> str:
    existing = re.search(rf"({property_name}:\s*)(\d+)", block_text)
    if existing:
        return re.sub(rf"({property_name}:\s*)(\d+)", rf"\g<1>{value}", block_text, count=1)

    closing_index = block_text.rfind("}")
    line_start = block_text.rfind("\n", 0, closing_index) + 1
    closing_indent = block_text[line_start:closing_index]
    entry_indent = closing_indent + "  "
    insertion = f"{entry_indent}{property_name}: {value},\n{closing_indent}"
    return block_text[:closing_index] + insertion + block_text[closing_index:]


def update_groove_landing(path: SongPaths, groove_level: int, role: str, bars_after: int) -> None:
    text = read_text(path.config_file)
    property_block = _find_property_block(text, "grooveLevels")
    if not property_block:
        raise ValueError("Could not find 'grooveLevels' in config.ts")
    property_start, value_start, value_end, _ = property_block
    groove_levels_text = text[value_start:value_end + 1]
    level_block = _find_level_block(groove_levels_text, groove_level)
    if not level_block:
        raise ValueError(f"Could not find groove level {groove_level} in config.ts")
    level_start, level_end = level_block
    level_text = groove_levels_text[level_start:level_end + 1]
    role_block = _find_property_block(level_text, role)
    if not role_block:
        raise ValueError(f"Could not find role '{role}' on groove level {groove_level}")
    role_start, role_value_start, role_value_end, _ = role_block
    role_text = level_text[role_value_start:role_value_end + 1]
    updated_role_text = _insert_or_replace_number_property(role_text, "grooveChangeAfterBars", bars_after)
    updated_level_text = level_text[:role_value_start] + updated_role_text + level_text[role_value_end + 1:]
    updated_groove_levels_text = groove_levels_text[:level_start] + updated_level_text + groove_levels_text[level_end + 1:]
    updated_text = text[:value_start] + updated_groove_levels_text + text[value_end + 1:]
    write_text(path.config_file, updated_text)


def _render_backdrop_params(params: dict[str, str | int | float | bool]) -> str:
    if not params:
        return "{}"
    lines: list[str] = []
    for key, value in params.items():
        if isinstance(value, str):
            rendered = json.dumps(value)
        elif isinstance(value, bool):
            rendered = "true" if value else "false"
        else:
            rendered = str(value)
        lines.append(f"    {key}: {rendered},")
    return "{\n" + "\n".join(lines) + "\n  }"


def _replace_or_insert_simple_property(text: str, property_name: str, rendered_value: str, before_property: str = "loadConfig") -> str:
    match = re.search(rf"^(?P<indent>\s*){property_name}:\s*.*?(,\s*)$", text, flags=re.M)
    if match:
        line_start = match.start()
        line_end = text.find("\n", match.end())
        if line_end < 0:
            line_end = len(text)
        return text[:line_start] + f"{match.group('indent')}{property_name}: {rendered_value}," + text[line_end:]

    anchor = re.search(rf"^(?P<indent>\s*){before_property}:", text, flags=re.M)
    if not anchor:
        raise ValueError(f"Could not find insertion point before '{before_property}'")
    insert_at = anchor.start()
    indent = anchor.group("indent")
    return text[:insert_at] + f"{indent}{property_name}: {rendered_value},\n" + text[insert_at:]


def _replace_or_insert_object_property(text: str, property_name: str, rendered_value: str, before_property: str = "loadConfig") -> str:
    block = _find_property_block(text, property_name)
    if block:
        property_start, _, value_end, indent = block
        replace_end = value_end + 1
        while replace_end < len(text) and text[replace_end].isspace():
            replace_end += 1
        if replace_end < len(text) and text[replace_end] == ",":
            replace_end += 1
        return text[:property_start] + f"{indent}{property_name}: {rendered_value}," + text[replace_end:]

    anchor = re.search(rf"^(?P<indent>\s*){before_property}:", text, flags=re.M)
    if not anchor:
        raise ValueError(f"Could not find insertion point before '{before_property}'")
    insert_at = anchor.start()
    indent = anchor.group("indent")
    return text[:insert_at] + f"{indent}{property_name}: {rendered_value},\n" + text[insert_at:]


def _remove_property(text: str, property_name: str) -> str:
    block = _find_property_block(text, property_name)
    if block:
        property_start, _, value_end, _ = block
        replace_end = value_end + 1
        while replace_end < len(text) and text[replace_end].isspace():
            replace_end += 1
        if replace_end < len(text) and text[replace_end] == ",":
            replace_end += 1
        if replace_end < len(text) and text[replace_end] == "\n":
            replace_end += 1
        return text[:property_start] + text[replace_end:]

    line_match = re.search(rf"^\s*{property_name}:\s*.*?,\n?", text, flags=re.M)
    if line_match:
        return text[:line_match.start()] + text[line_match.end():]
    return text


def update_song_backdrop(path: SongPaths, backdrop_preset: str | None, backdrop_params: dict[str, Any] | None) -> None:
    text = read_text(path.song_file)
    text = _remove_property(text, "backdropPreset")
    text = _remove_property(text, "backdropParams")
    if backdrop_preset:
        text = _replace_or_insert_simple_property(text, "backdropPreset", json.dumps(backdrop_preset))
    if backdrop_params:
        text = _replace_or_insert_object_property(text, "backdropParams", _render_backdrop_params(backdrop_params))
    write_text(path.song_file, text)


def find_song_paths(song_id: str) -> SongPaths:
    for song_file in content_root().glob("*/songs/*/song.ts"):
        text = read_text(song_file)
        match = re.search(r'id:\s*"([^"]+)"', text)
        if match and match.group(1) == song_id:
            song_dir = song_file.parent
            config_file = song_dir / "config.ts"
            if not config_file.exists():
                raise FileNotFoundError(f"Config file not found for {song_id}")
            return SongPaths(song_id=song_id, song_dir=song_dir, song_file=song_file, config_file=config_file)
    raise FileNotFoundError(f"Could not find song manifest for '{song_id}'")
