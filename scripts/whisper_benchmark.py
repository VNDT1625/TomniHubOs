#!/usr/bin/env python3
"""
Measure local Whisper (INT8) on a set of recorded voice commands.

    python scripts/whisper_benchmark.py --audio <folder> --refs <references.tsv> \
        [--sizes tiny base small] [--models-root <folder>] [--prompt "Chrome, VS Code"] \
        [--language vi] [--out results.csv]

references.tsv: one line per recording, tab separated, no header:
    <file name in the audio folder> <TAB> <what was said> [<TAB> <keyword;keyword;...>]
The optional third column lists the words that must appear for the command to count as understood
("intent"). Without it, intent is not scored for that line.

For every size the model is read from <models-root>/whisper-<size> (default: the folder that
setup-local-whisper.py uses), once without and once with --prompt, and for each recording the script writes the
transcript, the word error rate (WER), whether the intent was kept, and the time taken. Nothing is downloaded.
"""

import argparse
import csv
import os
import re
import statistics
import sys
import time
import unicodedata

try:
    import psutil
except Exception:  # noqa: BLE001 - memory use is reported only when psutil is available
    psutil = None


def normalize(text):
    """Lower case, one form of each accent, no punctuation; Vietnamese tone marks are kept as letters."""
    text = unicodedata.normalize("NFC", text).lower()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return text.split()


def edit_distance(a, b):
    previous = list(range(len(b) + 1))
    for i, left in enumerate(a, 1):
        current = [i]
        for j, right in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (left != right)))
        previous = current
    return previous[-1]


def wer(reference, hypothesis):
    """Word error rate: edits needed to turn the hypothesis into the reference, over the reference length."""
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    return edit_distance(ref, hyp) / len(ref)


def intent_kept(keywords, hypothesis):
    """True when every keyword is present; None when the line has no keywords."""
    wanted = [normalize(k) for k in keywords if k.strip()]
    if not wanted:
        return None
    words = " ".join(normalize(hypothesis))
    return all(" ".join(k) in words for k in wanted)


def read_refs(path):
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                raise SystemExit(f"{path}: expected '<file><TAB><text>', got: {line!r}")
            rows.append((parts[0].strip(), parts[1].strip(), parts[2].split(";") if len(parts) > 2 else []))
    return rows


def default_root():
    appdata = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(appdata, "Tomny", "models")


def percentile(values, q):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))]


def summarize(results):
    wers = [r["wer"] for r in results]
    times = [r["ms"] for r in results]
    intents = [r["intent"] for r in results if r["intent"] is not None]
    return {
        "samples": len(results),
        "wer": statistics.mean(wers),
        "intent": (sum(1 for i in intents if i) / len(intents)) if intents else None,
        "ms_mean": statistics.mean(times),
        "ms_p95": percentile(times, 0.95),
    }


def run(model, rows, audio_dir, language, prompt):
    results = []
    for name, reference, keywords in rows:
        path = os.path.join(audio_dir, name)
        started = time.perf_counter()
        segments, _info = model.transcribe(
            path, language=language, beam_size=1, vad_filter=True,
            condition_on_previous_text=False, temperature=0.0, initial_prompt=prompt,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        results.append({
            "file": name, "reference": reference, "text": text,
            "wer": wer(reference, text), "intent": intent_kept(keywords, text),
            "ms": round((time.perf_counter() - started) * 1000),
        })
    return results


def main():
    parser = argparse.ArgumentParser(description="Measure local Whisper INT8 on recorded commands")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--refs", required=True)
    parser.add_argument("--sizes", nargs="+", default=["tiny", "base", "small"])
    parser.add_argument("--models-root", default=default_root())
    parser.add_argument("--prompt", default=None, help="words to expect; adds a second run per size")
    parser.add_argument("--language", default="vi")
    parser.add_argument("--out", default="whisper-benchmark.csv")
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    rows = read_refs(args.refs)
    if not rows:
        raise SystemExit("no recordings listed")
    missing = [n for n, _, _ in rows if not os.path.isfile(os.path.join(args.audio, n))]
    if missing:
        raise SystemExit(f"missing audio: {', '.join(missing[:5])}")
    try:
        from faster_whisper import WhisperModel
    except Exception as error:  # noqa: BLE001
        raise SystemExit(f"faster-whisper is not installed: {error}")

    threads = max(1, min(8, (os.cpu_count() or 4) // 2))
    runs = [("without", None)] + ([("with", args.prompt)] if args.prompt else [])
    summary = []
    with open(args.out, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["size", "prompt", "file", "reference", "transcript", "wer", "intent", "ms"])
        for size in args.sizes:
            model_dir = os.path.join(args.models_root, f"whisper-{size}")
            if not os.path.isfile(os.path.join(model_dir, "model.bin")):
                print(f"[{size}] no model in {model_dir}; skipped", file=sys.stderr)
                continue
            model = WhisperModel(model_dir, device="cpu", compute_type="int8", cpu_threads=threads, local_files_only=True)
            # The first request pays for warming up; measure it apart so it does not skew the times.
            model.transcribe(os.path.join(args.audio, rows[0][0]), language=args.language, beam_size=1)
            for label, prompt in runs:
                results = run(model, rows, args.audio, args.language, prompt)
                # Working set of this process; run one size per process for a figure that is not mixed with others.
                ram = round(psutil.Process().memory_info().rss / 1048576) if psutil else None
                for r in results:
                    writer.writerow([size, label, r["file"], r["reference"], r["text"], f"{r['wer']:.3f}",
                                     "" if r["intent"] is None else int(r["intent"]), r["ms"]])
                summary.append((size, label, {**summarize(results), "ram": ram}))
            del model

    print(f"{'size':8}{'prompt':9}{'n':>4}{'WER':>8}{'intent':>9}{'mean ms':>10}{'p95 ms':>9}{'RAM MB':>9}")
    for size, label, s in summary:
        intent = "-" if s["intent"] is None else f"{s['intent'] * 100:.0f}%"
        print(f"{size:8}{label:9}{s['samples']:>4}{s['wer'] * 100:>7.1f}%{intent:>9}{s['ms_mean']:>10.0f}{s['ms_p95']:>9.0f}{'-' if s['ram'] is None else s['ram']:>9}")
    print(f"Per-recording results: {args.out}")


if __name__ == "__main__":
    main()
