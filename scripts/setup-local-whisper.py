#!/usr/bin/env python3
"""
One-time setup for local Whisper (INT8) speech-to-text.

    python scripts/setup-local-whisper.py [--size tiny|base|small|medium] [--dir <folder>]

What it does, and the only things it downloads:
  1. pip install faster-whisper            (the runtime: CTranslate2, PyAV for ogg/opus, tokenizers)
  2. the converted model Systran/faster-whisper-<size> from Hugging Face into <folder>

Approximate download sizes: tiny 75 MB, base 145 MB, small 480 MB, medium 1.5 GB. INT8 is applied when the model is loaded,
so RAM use is roughly 150 MB (tiny), 250 MB (base) or 600 MB (small) while the sidecar is running.
Run it yourself; the app never downloads models on its own.
"""

import argparse
import os
import subprocess
import sys

SIZES = ("tiny", "base", "small", "medium")


def default_dir(size):
    appdata = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(appdata, "Tomny", "models", f"whisper-{size}")


def main():
    parser = argparse.ArgumentParser(description="Install local Whisper (INT8) for Tomny")
    parser.add_argument("--size", choices=SIZES, default="base")
    parser.add_argument("--dir", default=None, help="where to put the model (default: user data folder)")
    parser.add_argument("--skip-pip", action="store_true", help="do not install faster-whisper")
    args = parser.parse_args()

    target = args.dir or default_dir(args.size)
    if not args.skip_pip:
        print("Installing faster-whisper ...", flush=True)
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--upgrade", "faster-whisper"])

    from huggingface_hub import snapshot_download

    print(f"Downloading Systran/faster-whisper-{args.size} to {target} ...", flush=True)
    os.makedirs(target, exist_ok=True)
    snapshot_download(repo_id=f"Systran/faster-whisper-{args.size}", local_dir=target)

    if not os.path.isfile(os.path.join(target, "model.bin")):
        print("The download finished but model.bin is missing.", file=sys.stderr)
        return 1
    print(f"Done. Model folder: {target}")
    print("In Tomny: Settings > Channels > Telegram > Voice model > Local Whisper (INT8).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
