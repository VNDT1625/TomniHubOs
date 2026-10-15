#!/usr/bin/env python3
"""
Local Whisper speech-to-text sidecar for TomniHubOS (INT8 on CPU).

Talks to the Electron main process with newline-delimited JSON on stdin/stdout, like laya_sidecar.py.

    argv:  <model_dir> [language]
    in:    {"id": "...", "action": "transcribe", "path": "<audio file>", "language": "vi", "prompt": "<words to expect>"}
           {"id": "...", "action": "ping"}
    out:   {"status": "ready", "backend": "faster-whisper", "compute": "int8", "model": "<dir>"}
           {"id": "...", "status": "ok", "text": "...", "language": "vi", "duration": 3.2, "ms": 410}
           {"id": "...", "status": "error", "code": "...", "error": "..."}

The model is loaded from a local folder only. Nothing is ever downloaded here, so the first run cannot fetch
anything behind the user's back; scripts/setup-local-whisper.py is the one place that downloads.
"""

import json
import os
import sys
import time


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fail_startup(code, message):
    emit({"status": "startup_error", "code": code, "error": message})
    sys.exit(2)


def main():
    if sys.platform == "win32":
        import io

        sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    if len(sys.argv) < 2:
        fail_startup("USAGE", "model directory argument is required")
    model_dir = sys.argv[1]
    default_language = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None

    if not os.path.isdir(model_dir) or not os.path.isfile(os.path.join(model_dir, "model.bin")):
        fail_startup("MODEL_NOT_FOUND", f"no Whisper model in {model_dir}")

    try:
        from faster_whisper import WhisperModel
    except Exception as error:  # noqa: BLE001 - any import failure means the dependency is unusable
        fail_startup("DEPENDENCY_MISSING", f"faster-whisper is not installed: {error}")

    threads = max(1, min(8, (os.cpu_count() or 4) // 2))
    try:
        model = WhisperModel(
            model_dir,
            device="cpu",
            compute_type="int8",
            cpu_threads=threads,
            local_files_only=True,
        )
    except Exception as error:  # noqa: BLE001
        fail_startup("MODEL_LOAD_FAILED", str(error))

    emit({"status": "ready", "backend": "faster-whisper", "compute": "int8", "model": model_dir, "threads": threads})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            action = request.get("action", "transcribe")
            if action == "ping":
                emit({"id": request_id, "status": "pong"})
                continue
            if action != "transcribe":
                emit({"id": request_id, "status": "error", "code": "BAD_ACTION", "error": f"unknown action {action}"})
                continue
            path = request.get("path")
            if not isinstance(path, str) or not os.path.isfile(path):
                emit({"id": request_id, "status": "error", "code": "NO_AUDIO", "error": "audio file not found"})
                continue
            language = request.get("language") or default_language
            prompt = request.get("prompt") or None
            started = time.perf_counter()
            segments, info = model.transcribe(
                path,
                language=language,
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
                temperature=0.0,
                initial_prompt=prompt,
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()
            emit(
                {
                    "id": request_id,
                    "status": "ok",
                    "text": text,
                    "language": info.language,
                    "duration": round(float(info.duration), 2),
                    "ms": round((time.perf_counter() - started) * 1000),
                }
            )
        except Exception as error:  # noqa: BLE001 - one bad request must not stop the daemon
            emit({"id": request_id, "status": "error", "code": "TRANSCRIBE_FAILED", "error": str(error)[:300]})


if __name__ == "__main__":
    main()
