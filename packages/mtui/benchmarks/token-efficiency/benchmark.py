#!/usr/bin/env python3
"""Reproducible MTUI token-efficiency benchmark.

The benchmark measures payload and full JSON (wire) token counts with the
o200k_base tokenizer. It intentionally includes both favorable and adversarial
queries so the report cannot be reduced to hand-picked examples.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import statistics
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import tiktoken


REPEATS = 15
WARMUPS = 2
ENCODING_NAME = "o200k_base"
ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
LINE_NUMBER_RE = re.compile(r"^\s*\d+:\s?")
SIGNAL_RE = re.compile(
    r"(?i)(error|failed|failure|fatal|panic|exception|traceback|warning|"
    r"assert|mismatch|not found|cannot find|permission denied|exit code|"
    r"test result|short test summary|runtimeerror|error\s+ts\d+)"
)


LOG_FILES = [
    ".training-logs/security-candidate7-r64-20260730T105946.err.log",
    ".training-logs/security-candidate7-r64-20260730T105946.out.log",
    ".training-logs/security-candidate7-r64-smoke1-20260730T105116.err.log",
    ".training-logs/security-candidate7-r64-smoke2-20260730T105540.err.log",
    ".training-logs/security-candidate7-r64-smoke2-20260730T105540.out.log",
    ".training-logs/security-candidate8-benchmark-20260730T185908.out.log",
    ".training-logs/security-candidate8-r64-20260730T120358.err.log",
    ".training-logs/security-candidate8-r64-20260730T120358.out.log",
    ".training-logs/security-candidate8-r64-smoke1-20260730T115248.err.log",
    ".training-logs/security-candidate8-r64-smoke2-20260730T115642.err.log",
    ".training-logs/security-candidate8-r64-smoke2-20260730T115642.out.log",
    "tcz_err.txt",
]


SOURCE_CASES = [
    ("packages/mtui/src/ops/mod.rs", "compass_read_file"),
    ("packages/mtui/src/understand/mod.rs", "query_context"),
    ("packages/mtui/src/main.rs", "resolve_delete_text"),
    ("packages/mtui/src/cli/mod.rs", "MemoryCompactArgs"),
    ("packages/mtui/src/analyze.rs", "parse_issue_line"),
    ("packages/mtui/src/understand/ranking.rs", "graph_boosts"),
    ("packages/mtui/src/policy/mod.rs", "detect_policy_violations"),
    ("packages/mtui/src/compact/mod.rs", "compact_text"),
    ("packages/mtui/src/history/mod.rs", "search_commands"),
    ("packages/mtui/src/exp/mod.rs", "queue_feedback"),
]


def parse_args() -> argparse.Namespace:
    script = Path(__file__).resolve()
    default_repo = script.parents[4]
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=default_repo)
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--repeats", type=int, default=REPEATS)
    parser.add_argument("--warmups", type=int, default=WARMUPS)
    parser.add_argument("--skip-generated-logs", action="store_true")
    parser.add_argument(
        "--ablations",
        action="store_true",
        help="Run one controlled ablation per deterministic MTUI reduction stage",
    )
    parser.add_argument(
        "--ablation-repeats",
        type=int,
        default=3,
        help="Timed runs per case for ablations (defaults to 3)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=script.parent / "results",
    )
    return parser.parse_args()


def run_process(
    command: list[str], cwd: Path, check: bool = False
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check and result.returncode != 0:
        raise RuntimeError(
            f"Command failed ({result.returncode}): {' '.join(command)}\n"
            f"{result.stdout}\n{result.stderr}"
        )
    return result


def mtui_call(
    binary: Path,
    repo: Path,
    args: list[str],
    env: dict[str, str] | None = None,
) -> tuple[str, float]:
    started = time.perf_counter_ns()
    process_env = os.environ.copy()
    if env:
        process_env.update(env)
    result = subprocess.run(
        [str(binary), "--json", *args],
        cwd=repo,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=process_env,
        check=False,
    )
    elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000
    if result.returncode != 0:
        raise RuntimeError(
            f"MTUI failed ({result.returncode}): {' '.join(args)}\n"
            f"{result.stdout}\n{result.stderr}"
        )
    return result.stdout.strip(), elapsed_ms


def timed_mtui(
    binary: Path,
    repo: Path,
    args: list[str],
    warmups: int,
    repeats: int,
    env: dict[str, str] | None = None,
) -> tuple[dict[str, Any], str, list[float], bool]:
    for _ in range(warmups):
        mtui_call(binary, repo, args, env)
    outputs: list[str] = []
    timings: list[float] = []
    for _ in range(repeats):
        output, elapsed = mtui_call(binary, repo, args, env)
        outputs.append(output)
        timings.append(elapsed)
    hashes = {hashlib.sha256(value.encode("utf-8")).hexdigest() for value in outputs}
    parsed = json.loads(outputs[0])
    if not parsed.get("ok"):
        raise RuntimeError(f"MTUI returned a non-success response: {outputs[0]}")
    return parsed, outputs[0], timings, len(hashes) == 1


def percentile(values: Iterable[float], value: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = max(0, min(len(ordered) - 1, math.ceil(value * len(ordered)) - 1))
    return ordered[index]


def normalize_line(line: str, strip_number: bool = False) -> str:
    clean = ANSI_RE.sub("", line).replace("\x00", "").strip()
    if strip_number:
        clean = LINE_NUMBER_RE.sub("", clean)
    return " ".join(clean.split()).casefold()


def unique_signals(text: str) -> set[str]:
    signals: set[str] = set()
    for line in text.splitlines():
        normalized = normalize_line(line)
        if normalized and SIGNAL_RE.search(normalized):
            signals.add(normalized)
    return signals


def retained_count(anchors: set[str], output: str, strip_number: bool = False) -> int:
    output_lines = {
        normalize_line(line, strip_number=strip_number)
        for line in output.splitlines()
        if normalize_line(line, strip_number=strip_number)
    }
    return sum(1 for anchor in anchors if anchor in output_lines)


def reduction(raw_tokens: int, output_tokens: int) -> float:
    if raw_tokens == 0:
        return 0.0
    return 100.0 * (raw_tokens - output_tokens) / raw_tokens


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def token_metrics(encoding: Any, raw: str, payload: str, wire: str) -> dict[str, Any]:
    raw_tokens = len(encoding.encode(raw))
    payload_tokens = len(encoding.encode(payload))
    wire_tokens = len(encoding.encode(wire))
    return {
        "raw_chars": len(raw),
        "payload_chars": len(payload),
        "wire_chars": len(wire),
        "raw_tokens": raw_tokens,
        "payload_tokens": payload_tokens,
        "wire_tokens": wire_tokens,
        "payload_reduction_pct": round(reduction(raw_tokens, payload_tokens), 3),
        "wire_reduction_pct": round(reduction(raw_tokens, wire_tokens), 3),
    }


def timing_metrics(values: list[float]) -> dict[str, float]:
    return {
        "p50_ms": round(statistics.median(values), 3),
        "p95_ms": round(percentile(values, 0.95), 3),
        "min_ms": round(min(values), 3),
        "max_ms": round(max(values), 3),
    }


def generated_logs(repo: Path) -> list[tuple[str, str, str]]:
    logs: list[tuple[str, str, str]] = []
    cargo = run_process(
        ["cargo", "test", "--locked", "--", "--nocapture"],
        repo / "packages" / "mtui",
    )
    cargo_text = "\n".join(part for part in [cargo.stdout, cargo.stderr] if part)
    logs.append(("generated/cargo-test-mtui", cargo_text, "cargo"))

    vitest_case = repo / "tests" / "unit" / "foundation" / "ipcInventory.test.ts"
    if vitest_case.exists():
        vitest = run_process(
            [
                "bun",
                "x",
                "vitest",
                "run",
                "tests/unit/foundation/ipcInventory.test.ts",
                "--reporter",
                "verbose",
                "--no-color",
            ],
            repo,
        )
        vitest_text = "\n".join(part for part in [vitest.stdout, vitest.stderr] if part)
        logs.append(("generated/vitest-ipc-inventory", vitest_text, "vitest"))
    return logs


def run_compact_cases(
    repo: Path,
    binary: Path,
    encoding: Any,
    warmups: int,
    repeats: int,
    skip_generated: bool,
    disabled_filters: str | None = None,
    all_mode: bool = False,
) -> list[dict[str, Any]]:
    cases: list[tuple[str, str, str, Path | None]] = []
    for relative in LOG_FILES:
        path = repo / relative
        if path.exists() and path.stat().st_size > 0:
            cases.append((relative, path.read_text(encoding="utf-8", errors="replace"), "auto", path))

    generated_dir = repo / "packages" / "mtui" / "target" / "benchmark-corpus"
    if not skip_generated:
        generated_dir.mkdir(parents=True, exist_ok=True)
        for name, text, profile in generated_logs(repo):
            generated_path = generated_dir / f"{name.split('/')[-1]}.log"
            generated_path.write_text(text, encoding="utf-8")
            cases.append((name, text, profile, generated_path))

    results: list[dict[str, Any]] = []
    for name, raw, profile, path in cases:
        if path is None:
            continue
        command = ["compact", "--file", str(path), "--profile", profile]
        if all_mode:
            command.append("--all")
        parsed, wire, timings, deterministic = timed_mtui(
            binary,
            repo,
            command,
            warmups,
            repeats,
            {"MTUI_BENCHMARK_ABLATION": "1", "MTUI_DISABLED_FILTERS": disabled_filters} if disabled_filters else None,
        )
        payload = parsed.get("text", "")
        signals = unique_signals(raw)
        retained = retained_count(signals, payload)
        results.append(
            {
                "name": name,
                "input_path": str(path),
                "raw_sha256": sha256_text(raw),
                "requested_profile": profile,
                "detected_profile": parsed.get("profile"),
                **token_metrics(encoding, raw, payload, wire),
                "original_lines": parsed.get("original_lines"),
                "output_lines": parsed.get("output_lines"),
                "critical_unique_signals": len(signals),
                "retained_unique_signals": retained,
                "signal_recall_pct": round(100.0 * retained / len(signals), 3)
                if signals
                else None,
                "deterministic": deterministic,
                "latency": timing_metrics(timings),
            }
        )
    return results


ABLATION_FILTERS = (
    "json-canonicalization",
    "important-lines",
    "profile-patterns",
    "noise-lines",
    "head-tail",
)


def run_ablations(
    repo: Path,
    binary: Path,
    encoding: Any,
    warmups: int,
    repeats: int,
    skip_generated: bool,
) -> dict[str, Any]:
    """Measure each named stage with only that stage disabled."""
    results: dict[str, Any] = {}
    for filter_name in ABLATION_FILTERS:
        cases = run_compact_cases(
            repo,
            binary,
            encoding,
            warmups,
            repeats,
            skip_generated,
            disabled_filters=filter_name,
        )
        summary = aggregate(cases, "signal_recall_pct")
        summary["weighted_signal_recall_pct"] = compact_weighted_signal_recall(cases)
        summary["deterministic_cases"] = sum(bool(case["deterministic"]) for case in cases)
        results[filter_name] = summary
    return results


def query_anchors(raw: str, query: str) -> set[str]:
    query_folded = query.casefold()
    return {
        normalize_line(line)
        for line in raw.splitlines()
        if query_folded in line.casefold() and normalize_line(line)
    }


def run_source_cases(
    repo: Path,
    binary: Path,
    encoding: Any,
    warmups: int,
    repeats: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    compass_results: list[dict[str, Any]] = []
    read_results: list[dict[str, Any]] = []
    for relative, query in SOURCE_CASES:
        path = repo / relative
        raw = path.read_text(encoding="utf-8", errors="replace")

        parsed, wire, timings, deterministic = timed_mtui(
            binary,
            repo,
            ["compass", "read", relative, "--query", query],
            warmups,
            repeats,
        )
        payload = parsed.get("text", "")
        anchors = query_anchors(raw, query)
        retained = retained_count(anchors, payload, strip_number=True)
        compass_results.append(
            {
                "file": relative,
                "query": query,
                "raw_sha256": sha256_text(raw),
                **token_metrics(encoding, raw, payload, wire),
                "total_lines": parsed.get("total_lines"),
                "returned_lines": parsed.get("returned_lines"),
                "query_anchor_lines": len(anchors),
                "retained_query_anchor_lines": retained,
                "query_anchor_recall_pct": round(100.0 * retained / len(anchors), 3)
                if anchors
                else None,
                "deterministic": deterministic,
                "latency": timing_metrics(timings),
            }
        )

        read_parsed, read_wire, read_timings, read_deterministic = timed_mtui(
            binary,
            repo,
            ["read", relative, "--no-line-numbers"],
            warmups,
            repeats,
        )
        read_payload = read_parsed.get("text", "")
        read_results.append(
            {
                "file": relative,
                "raw_sha256": sha256_text(raw),
                **token_metrics(encoding, raw, read_payload, read_wire),
                "total_lines": read_parsed.get("total_lines"),
                "returned_lines": read_parsed.get("returned_lines"),
                "deterministic": read_deterministic,
                "latency": timing_metrics(read_timings),
            }
        )
    return compass_results, read_results


def aggregate(cases: list[dict[str, Any]], recall_key: str | None = None) -> dict[str, Any]:
    raw = sum(case["raw_tokens"] for case in cases)
    payload = sum(case["payload_tokens"] for case in cases)
    wire = sum(case["wire_tokens"] for case in cases)
    all_p50 = [case["latency"]["p50_ms"] for case in cases]
    all_p95 = [case["latency"]["p95_ms"] for case in cases]
    summary: dict[str, Any] = {
        "cases": len(cases),
        "raw_tokens": raw,
        "payload_tokens": payload,
        "wire_tokens": wire,
        "weighted_payload_reduction_pct": round(reduction(raw, payload), 3),
        "weighted_wire_reduction_pct": round(reduction(raw, wire), 3),
        "median_payload_reduction_pct": round(
            statistics.median(case["payload_reduction_pct"] for case in cases), 3
        ),
        "median_wire_reduction_pct": round(
            statistics.median(case["wire_reduction_pct"] for case in cases), 3
        ),
        "min_wire_reduction_pct": round(
            min(case["wire_reduction_pct"] for case in cases), 3
        ),
        "max_wire_reduction_pct": round(
            max(case["wire_reduction_pct"] for case in cases), 3
        ),
        "median_case_p50_latency_ms": round(statistics.median(all_p50), 3),
        "max_case_p95_latency_ms": round(max(all_p95), 3),
        "deterministic_cases": sum(bool(case["deterministic"]) for case in cases),
    }
    if recall_key:
        recall_values = [case[recall_key] for case in cases if case.get(recall_key) is not None]
        summary["median_recall_pct"] = (
            round(statistics.median(recall_values), 3) if recall_values else None
        )
    return summary


def git_value(repo: Path, *args: str) -> str:
    result = run_process(["git", *args], repo)
    return result.stdout.strip()


def compact_weighted_signal_recall(cases: list[dict[str, Any]]) -> float | None:
    total = sum(case["critical_unique_signals"] for case in cases)
    retained = sum(case["retained_unique_signals"] for case in cases)
    return round(100.0 * retained / total, 3) if total else None


def compass_weighted_anchor_recall(cases: list[dict[str, Any]]) -> float | None:
    total = sum(case["query_anchor_lines"] for case in cases)
    retained = sum(case["retained_query_anchor_lines"] for case in cases)
    return round(100.0 * retained / total, 3) if total else None


def retention_totals(
    cases: list[dict[str, Any]], total_key: str, retained_key: str
) -> dict[str, int]:
    return {
        "total": sum(case[total_key] for case in cases),
        "retained": sum(case[retained_key] for case in cases),
    }


def markdown_table(rows: list[list[Any]], headers: list[str]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    lines.extend("| " + " | ".join(str(value) for value in row) + " |" for row in rows)
    return "\n".join(lines)


def build_markdown(report: dict[str, Any]) -> str:
    summaries = report["summary"]
    compact = summaries["compact"]
    compass = summaries["compass"]
    read = summaries["bounded_read"]
    lines = [
        "# MTUI Token-Efficiency Benchmark",
        "",
        f"Generated: `{report['generated_at']}`  ",
        f"Commit: `{report['git']['commit']}`  ",
        f"Tokenizer: `{report['method']['tokenizer']}`  ",
        f"Protocol: {report['method']['warmups']} warmups + {report['method']['repeats']} timed runs per case",
        "",
        "## Headline results",
        "",
        markdown_table(
            [
                ["Log compact", compact["cases"], f"{compact['weighted_wire_reduction_pct']}%", f"{compact['median_wire_reduction_pct']}%", f"{report['summary']['compact_signal_totals']['retained']}/{report['summary']['compact_signal_totals']['total']} ({report['summary']['compact_weighted_signal_recall_pct']}%)", f"{compact['median_case_p50_latency_ms']} ms"],
                ["Compass source slices", compass["cases"], f"{compass['weighted_wire_reduction_pct']}%", f"{compass['median_wire_reduction_pct']}%", f"{report['summary']['compass_anchor_totals']['retained']}/{report['summary']['compass_anchor_totals']['total']} ({report['summary']['compass_weighted_anchor_recall_pct']}%)", f"{compass['median_case_p50_latency_ms']} ms"],
                ["Bounded read", read["cases"], f"{read['weighted_wire_reduction_pct']}%", f"{read['median_wire_reduction_pct']}%", "n/a", f"{read['median_case_p50_latency_ms']} ms"],
            ],
            ["Mode", "Cases", "Weighted wire reduction", "Median case reduction", "Signal/anchor recall", "Median p50 latency"],
        ),
        "",
        "Wire reduction compares raw input tokens with the complete JSON response received by an agent. Payload-only numbers are available in `latest.json`.",
        "",
        f"For the {report['summary']['compact_nontrivial']['cases']} non-trivial log inputs (at least 1,000 raw tokens), weighted wire reduction was {report['summary']['compact_nontrivial']['weighted_wire_reduction_pct']}% and median per-case reduction was {report['summary']['compact_nontrivial']['median_wire_reduction_pct']}%.",
        "",
        "## Baseline and filter ablations",
        "",
        f"The paired uncompacted baseline used the same input corpus; integrated MTUI delivered {report['summary']['incremental_vs_uncompacted_wire_reduction_pct']}% incremental wire-token reduction.",
        "",
    ]
    if report["summary"].get("ablations"):
        lines.extend(
            [
                markdown_table(
                    [
                        [name, value["weighted_wire_reduction_pct"], value["weighted_signal_recall_pct"], value["deterministic_cases"]]
                        for name, value in report["summary"]["ablations"].items()
                    ],
                    ["Disabled stage", "Wire reduction", "Signal recall", "Deterministic cases"],
                ),
                "",
                "Each row disables exactly one named stage in a fresh MTUI process; results are diagnostic ablations, not production settings.",
                "",
            ]
        )
    lines.extend(
        [
        "## Log compact cases",
        "",
        markdown_table(
            [
                [
                    case["name"],
                    case["detected_profile"],
                    case["raw_tokens"],
                    case["wire_tokens"],
                    f"{case['wire_reduction_pct']}%",
                    "n/a" if case["signal_recall_pct"] is None else f"{case['signal_recall_pct']}%",
                    f"{case['latency']['p50_ms']} ms",
                ]
                for case in report["cases"]["compact"]
            ],
            ["Case", "Profile", "Raw tokens", "Wire tokens", "Reduction", "Signal recall", "p50"],
        ),
        "",
        "## Compass source-slice cases",
        "",
        markdown_table(
            [
                [
                    case["file"],
                    case["query"],
                    case["raw_tokens"],
                    case["wire_tokens"],
                    f"{case['wire_reduction_pct']}%",
                    f"{case['retained_query_anchor_lines']}/{case['query_anchor_lines']}",
                    f"{case['latency']['p50_ms']} ms",
                ]
                for case in report["cases"]["compass"]
            ],
            ["File", "Query", "Raw tokens", "Wire tokens", "Reduction", "Anchors retained", "p50"],
        ),
        "",
        "## Interpretation",
        "",
        "- Token counts use the exact `o200k_base` tokenizer, not a characters-per-token heuristic.",
        "- Every timed case was checked for byte-identical deterministic output.",
        "- Critical-signal recall is conservative: a unique normalized diagnostic line must remain verbatim in the compact payload.",
        "- Compass anchor recall checks whether source lines containing the requested symbol survive in the returned code slice.",
        "- This is a local corpus benchmark, not a universal percentage for every repository or model workflow.",
        "",
        "## Known limitations exposed by the benchmark",
        "",
    ]
    )

    missed = [
        case
        for case in report["cases"]["compass"]
        if case["retained_query_anchor_lines"] < case["query_anchor_lines"]
    ]
    if missed:
        lines.append(
            f"- `{len(missed)}/{len(report['cases']['compass'])}` Compass cases did not retain every explicit query-anchor line. Structural lines earlier in a large file can consume the default line budget before a late symbol is emitted."
        )
    else:
        lines.append("- All Compass cases retained their explicit query-anchor lines.")
    negative = [case for case in report["cases"]["compact"] if case["wire_reduction_pct"] < 0]
    if negative:
        lines.append(
            f"- `{len(negative)}` small log case(s) expanded after JSON metadata overhead; MTUI compaction is most useful above a minimum input size."
        )
    else:
        lines.append("- Every compact case reduced tokens even after JSON metadata overhead.")
    lines.extend(
        [
            "",
            "## Defensible portfolio claim",
            "",
            f"> On a reproducible {compact['cases']}-log local corpus, MTUI reduced full agent-visible JSON tokens by {compact['weighted_wire_reduction_pct']}% overall (median {compact['median_wire_reduction_pct']}% per log), retained {report['summary']['compact_weighted_signal_recall_pct']}% of unique critical diagnostic lines, and produced deterministic output across {report['method']['repeats']} repeated runs per case.",
            "",
            "Do not generalize this percentage beyond the stated corpus until the benchmark is repeated across additional repositories and task-level agent evaluations.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    repo = args.repo_root.resolve()
    binary = args.binary.resolve() if args.binary else repo / "packages" / "mtui" / "target" / "release" / ("mtui.exe" if os.name == "nt" else "mtui")
    if not binary.exists():
        raise SystemExit(f"MTUI release binary not found: {binary}. Run cargo build --release --locked first.")
    encoding = tiktoken.get_encoding(ENCODING_NAME)

    compact_cases = run_compact_cases(
        repo,
        binary,
        encoding,
        args.warmups,
        args.repeats,
        args.skip_generated_logs,
    )
    baseline_cases = run_compact_cases(
        repo,
        binary,
        encoding,
        args.warmups,
        args.repeats,
        args.skip_generated_logs,
        all_mode=True,
    )
    ablation_summaries = (
        run_ablations(
            repo,
            binary,
            encoding,
            0,
            args.ablation_repeats,
            args.skip_generated_logs,
        )
        if args.ablations
        else {}
    )
    compass_cases, read_cases = run_source_cases(
        repo,
        binary,
        encoding,
        args.warmups,
        args.repeats,
    )
    source_status = git_value(
        repo,
        "status",
        "--porcelain",
        "--",
        "packages/mtui/src",
        "packages/mtui/tests",
        "packages/mtui/Cargo.toml",
        "packages/mtui/Cargo.lock",
    )
    report: dict[str, Any] = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git": {
            "commit": git_value(repo, "rev-parse", "HEAD"),
            "branch": git_value(repo, "branch", "--show-current"),
            "mtui_source_clean": not bool(source_status),
            "mtui_source_status": source_status.splitlines(),
        },
        "environment": {
            "platform": platform.platform(),
            "python": sys.version.split()[0],
            "tiktoken": getattr(tiktoken, "__version__", "unknown"),
            "binary": str(binary),
            "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        },
        "method": {
            "tokenizer": ENCODING_NAME,
            "warmups": args.warmups,
            "repeats": args.repeats,
            "payload_definition": "MTUI text field only",
            "wire_definition": "complete compact JSON response received by the agent",
            "signal_definition": SIGNAL_RE.pattern,
        },
        "corpus": {
            "log_profiles": dict(Counter(case["detected_profile"] for case in compact_cases)),
            "source_cases": len(SOURCE_CASES),
        },
        "summary": {
            "baseline_uncompacted": aggregate(baseline_cases, "signal_recall_pct"),
            "compact": aggregate(compact_cases, "signal_recall_pct"),
            "incremental_vs_uncompacted_wire_reduction_pct": round(
                reduction(
                    sum(case["wire_tokens"] for case in baseline_cases),
                    sum(case["wire_tokens"] for case in compact_cases),
                ),
                3,
            ),
            "ablations": ablation_summaries,
            "compact_nontrivial": aggregate(
                [case for case in compact_cases if case["raw_tokens"] >= 1_000],
                "signal_recall_pct",
            ),
            "compass": aggregate(compass_cases, "query_anchor_recall_pct"),
            "bounded_read": aggregate(read_cases),
            "compact_weighted_signal_recall_pct": compact_weighted_signal_recall(compact_cases),
            "compass_weighted_anchor_recall_pct": compass_weighted_anchor_recall(compass_cases),
            "compact_signal_totals": retention_totals(
                compact_cases, "critical_unique_signals", "retained_unique_signals"
            ),
            "compass_anchor_totals": retention_totals(
                compass_cases, "query_anchor_lines", "retained_query_anchor_lines"
            ),
        },
        "cases": {
            "compact": compact_cases,
            "compass": compass_cases,
            "bounded_read": read_cases,
        },
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    json_path = args.output_dir / "latest.json"
    md_path = args.output_dir / "latest.md"
    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md_path.write_text(build_markdown(report), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(f"JSON: {json_path}")
    print(f"Markdown: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
