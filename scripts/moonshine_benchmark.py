#!/usr/bin/env python3
"""
Measure Moonshine speech-to-text on the same recordings and the same scoring as scripts/whisper_benchmark.py.

    python scripts/moonshine_benchmark.py --audio <folder> --refs <references.tsv> \
        [--language vi] [--keyterms "Chrome, Zalo"] [--out results.csv]

Needs `pip install moonshine-voice`; the language model is fetched by the library on first use (about 32 MB for vi).
The audio is decoded with PyAV (installed with faster-whisper), so m4a/ogg/wav all work. With --keyterms the
decoder is biased toward those words (Moonshine's own mechanism), and a second run is added next to the plain one.
"""

import argparse
import csv
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import whisper_benchmark as common  # noqa: E402  (same WER, intent and summary code)


def load_audio(path, rate=16000):
    import av
    import numpy as np

    container = av.open(path)
    resampler = av.AudioResampler(format="flt", layout="mono", rate=rate)
    chunks = []
    for frame in container.decode(audio=0):
        for out in resampler.resample(frame):
            chunks.append(out.to_ndarray().reshape(-1))
    for out in resampler.resample(None):
        chunks.append(out.to_ndarray().reshape(-1))
    container.close()
    return np.concatenate(chunks).astype("float32").tolist()


def transcribe(transcriber, audio):
    transcript = transcriber.transcribe_without_streaming(audio, 16000)
    return " ".join(line.text.strip() for line in transcript.lines if line.text).strip()


def main():
    parser = argparse.ArgumentParser(description="Measure Moonshine on recorded commands")
    parser.add_argument("--audio", required=True)
    parser.add_argument("--refs", required=True)
    parser.add_argument("--language", default="vi")
    parser.add_argument("--keyterms", default=None, help="comma separated words to bias toward")
    parser.add_argument("--out", default="moonshine-benchmark.csv")
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    rows = common.read_refs(args.refs)
    missing = [n for n, _, _ in rows if not os.path.isfile(os.path.join(args.audio, n))]
    if missing:
        raise SystemExit(f"missing audio: {', '.join(missing[:5])}")
    import moonshine_voice
    from moonshine_voice.transcriber import Transcriber

    model_path, arch = moonshine_voice.get_model_for_language(args.language)
    transcriber = Transcriber(model_path=model_path, model_arch=arch)
    audio = {name: load_audio(os.path.join(args.audio, name)) for name, _, _ in rows}
    transcribe(transcriber, audio[rows[0][0]])  # warm-up, not measured

    runs = [("without", None)]
    if args.keyterms:
        runs.append(("with", [t.strip() for t in args.keyterms.split(",") if t.strip()]))
    summary = []
    with open(args.out, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["size", "prompt", "file", "reference", "transcript", "wer", "intent", "ms"])
        for label, terms in runs:
            transcriber.set_keyterms(terms)
            results = []
            for name, reference, keywords in rows:
                started = time.perf_counter()
                text = transcribe(transcriber, audio[name])
                ms = round((time.perf_counter() - started) * 1000)
                result = {"wer": common.wer(reference, text), "intent": common.intent_kept(keywords, text), "ms": ms}
                results.append(result)
                writer.writerow(["moonshine-" + args.language, label, name, reference, text, f"{result['wer']:.3f}",
                                 "" if result["intent"] is None else int(result["intent"]), ms])
            summary.append((label, results))

    print(f"{'keyterms':10}{'n':>4}{'WER':>8}{'median':>8}{'intent':>9}{'mean ms':>10}{'p95 ms':>9}")
    for label, results in summary:
        s = common.summarize(results)
        median = statistics.median(r["wer"] for r in results)
        intent = "-" if s["intent"] is None else f"{s['intent'] * 100:.0f}%"
        print(f"{label:10}{s['samples']:>4}{s['wer'] * 100:>7.1f}%{median * 100:>7.0f}%{intent:>9}{s['ms_mean']:>10.0f}{s['ms_p95']:>9.0f}")
    print(f"Per-recording results: {args.out}")


if __name__ == "__main__":
    main()
