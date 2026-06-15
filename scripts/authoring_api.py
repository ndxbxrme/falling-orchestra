#!/usr/bin/env python3
from __future__ import annotations

import argparse
import cgi
import json
import shutil
import subprocess
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from content_editing import (
    build_updated_config_text,
    find_song_paths,
    read_text,
    update_groove_landing,
    update_song_backdrop,
    write_text,
)


class AuthoringApiHandler(BaseHTTPRequestHandler):
    server_version = "FallingOrchestraAuthoringAPI/0.1"

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self._send_json({"ok": True})
            return

        if parsed.path == "/api/song-config":
            query = parse_qs(parsed.query)
            song_id = query.get("songId", [None])[0]
            if not song_id:
                self._send_error(HTTPStatus.BAD_REQUEST, "Missing songId")
                return
            try:
                paths = find_song_paths(song_id)
                self._send_json(
                    {
                        "ok": True,
                        "songId": song_id,
                        "configText": read_text(paths.config_file),
                        "songText": read_text(paths.song_file),
                        "configPath": str(paths.config_file),
                        "songPath": str(paths.song_file),
                    }
                )
            except Exception as exc:
                self._send_error(HTTPStatus.NOT_FOUND, str(exc))
            return

        self._send_error(HTTPStatus.NOT_FOUND, f"Unknown route: {parsed.path}")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/import-album/upload":
            try:
                self._handle_import_album_upload()
            except Exception as exc:
                self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return
        payload = self._read_json_body()
        if payload is None:
            return

        try:
            if parsed.path == "/api/song-config/save-harmony":
                self._handle_save_harmony(payload)
                return
            if parsed.path == "/api/song-config/set-groove-landing":
                self._handle_set_groove_landing(payload)
                return
            if parsed.path == "/api/song-manifest/set-backdrop":
                self._handle_set_song_backdrop(payload)
                return
            if parsed.path == "/api/import-album/bootstrap":
                self._handle_import_album(payload, bootstrap=True, dry_run=bool(payload.get("dryRun")))
                return
            if parsed.path == "/api/import-album/plan":
                self._handle_import_album(payload, bootstrap=False, dry_run=True)
                return
            if parsed.path == "/api/import-album/run":
                self._handle_import_album(payload, bootstrap=False, dry_run=False)
                return
        except Exception as exc:
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return

        self._send_error(HTTPStatus.NOT_FOUND, f"Unknown route: {parsed.path}")

    def log_message(self, format: str, *args) -> None:
        return

    def _read_json_body(self) -> dict | None:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length)
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            self._send_error(HTTPStatus.BAD_REQUEST, "Invalid JSON body")
            return None

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status: HTTPStatus, message: str) -> None:
        self._send_json({"ok": False, "error": message}, status)

    def _handle_save_harmony(self, payload: dict) -> None:
        song_id = str(payload.get("songId") or "")
        cycle_bars = int(payload.get("cycleBars") or 0)
        bars = payload.get("bars")
        if not song_id:
            raise ValueError("Missing songId")
        if cycle_bars <= 0:
            raise ValueError("cycleBars must be positive")
        if not isinstance(bars, list) or not bars:
            raise ValueError("bars must be a non-empty list")
        normalized_bars: list[dict[str, str]] = []
        for bar in bars:
            if not isinstance(bar, dict):
                raise ValueError("each bar must be an object")
            root_note = str(bar.get("rootNote") or "")
            mode = str(bar.get("mode") or "")
            if not root_note or not mode:
                raise ValueError("each bar must include rootNote and mode")
            normalized_bars.append({"rootNote": root_note, "mode": mode})
        paths = find_song_paths(song_id)
        original_text = read_text(paths.config_file)
        updated_text = build_updated_config_text(original_text, cycle_bars, normalized_bars)
        write_text(paths.config_file, updated_text)
        self._send_json({"ok": True, "saved": "harmony", "configPath": str(paths.config_file)})

    def _handle_set_groove_landing(self, payload: dict) -> None:
        song_id = str(payload.get("songId") or "")
        groove_level = int(payload.get("grooveLevel") or 0)
        role = str(payload.get("role") or "")
        bars_after = int(payload.get("grooveChangeAfterBars") or 0)
        if not song_id:
            raise ValueError("Missing songId")
        if groove_level <= 0:
            raise ValueError("grooveLevel must be positive")
        if role not in {"intro", "main"}:
            raise ValueError("role must be 'intro' or 'main'")
        if bars_after < 0:
            raise ValueError("grooveChangeAfterBars must be >= 0")
        paths = find_song_paths(song_id)
        update_groove_landing(paths, groove_level, role, bars_after)
        self._send_json({"ok": True, "saved": "groove-landing", "configPath": str(paths.config_file)})

    def _handle_set_song_backdrop(self, payload: dict) -> None:
        song_id = str(payload.get("songId") or "")
        if not song_id:
            raise ValueError("Missing songId")
        preset = payload.get("backdropPreset")
        backdrop_preset = str(preset).strip() if isinstance(preset, str) and preset.strip() else None
        raw_params = payload.get("backdropParams")
        if raw_params is None:
            backdrop_params = None
        elif not isinstance(raw_params, dict):
            raise ValueError("backdropParams must be an object when provided")
        else:
            backdrop_params = raw_params
        paths = find_song_paths(song_id)
        update_song_backdrop(paths, backdrop_preset, backdrop_params)
        self._send_json({"ok": True, "saved": "song-backdrop", "songPath": str(paths.song_file)})

    def _handle_import_album(self, payload: dict, *, bootstrap: bool, dry_run: bool) -> None:
        source_dir = str(payload.get("sourceDir") or "").strip()
        if not source_dir:
            raise ValueError("Missing sourceDir")

        repo_root = Path(__file__).resolve().parents[1]
        script_path = repo_root / "scripts" / "import_album_package.py"
        command = ["python3", str(script_path), "--source-dir", source_dir]
        if bootstrap:
            command.append("--bootstrap-manifest")
        if dry_run:
            command.append("--dry-run")
        if payload.get("noHydrate"):
            command.append("--no-hydrate")
        if payload.get("applyHarmonyDefaults"):
            command.append("--apply-harmony-defaults")

        for arg_name, flag in (
            ("artistId", "--artist-id"),
            ("artistName", "--artist-name"),
            ("albumId", "--album-id"),
            ("albumTitle", "--album-title"),
        ):
            value = payload.get(arg_name)
            if isinstance(value, str) and value.strip():
                command.extend([flag, value.strip()])

        year = payload.get("year")
        if isinstance(year, int):
            command.extend(["--year", str(year)])

        result = subprocess.run(
            command,
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
        status = HTTPStatus.OK if result.returncode == 0 else HTTPStatus.BAD_REQUEST
        self._send_json(
            {
                "ok": result.returncode == 0,
                "bootstrap": bootstrap,
                "dryRun": dry_run,
                "command": command,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
            },
            status=status,
        )

    def _handle_import_album_upload(self) -> None:
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            },
        )
        manifest_field = form["manifest"] if "manifest" in form else None
        if manifest_field is None:
            raise ValueError("Missing manifest field")
        manifest_raw = manifest_field.value
        if not isinstance(manifest_raw, str):
            raise ValueError("Manifest must be JSON text")
        manifest = json.loads(manifest_raw)
        apply_harmony_defaults = False
        if "applyHarmonyDefaults" in form:
            raw_apply = form["applyHarmonyDefaults"].value
            apply_harmony_defaults = str(raw_apply).lower() in {"1", "true", "yes", "on"}

        repo_root = Path(__file__).resolve().parents[1]
        staging_root = repo_root / "tmp" / "import-staging"
        album_id = str(manifest.get("albumId") or "import")
        safe_album_id = "".join(char if char.isalnum() or char in {"-", "_"} else "-" for char in album_id)
        target_root = staging_root / safe_album_id
        if target_root.exists():
            shutil.rmtree(target_root)
        target_root.mkdir(parents=True, exist_ok=True)
        (target_root / "album.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

        file_fields = form["files"] if "files" in form else []
        if not isinstance(file_fields, list):
            file_fields = [file_fields]
        for field in file_fields:
            if not getattr(field, "filename", None):
                continue
            relative_path = Path(str(field.filename).lstrip("/\\"))
            target_path = (target_root / relative_path).resolve()
            if target_root not in target_path.parents and target_path != target_root:
                raise ValueError(f"Unsafe upload path: {field.filename}")
            target_path.parent.mkdir(parents=True, exist_ok=True)
            with target_path.open("wb") as handle:
                data = field.file.read()
                handle.write(data)

        script_path = repo_root / "scripts" / "import_album_package.py"
        command = ["python3", str(script_path), "--source-dir", str(target_root)]
        if apply_harmony_defaults:
            command.append("--apply-harmony-defaults")
        result = subprocess.run(
            command,
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
        status = HTTPStatus.OK if result.returncode == 0 else HTTPStatus.BAD_REQUEST
        self._send_json(
            {
                "ok": result.returncode == 0,
                "uploadedRoot": str(target_root),
                "command": command,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode,
            },
            status=status,
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Falling Orchestra local authoring API.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), AuthoringApiHandler)
    print(f"Authoring API listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
