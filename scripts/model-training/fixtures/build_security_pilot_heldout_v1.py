from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent))

from benchmark_cases import build_cases
from data_quality import leakage_report, scan_privacy, sha256_file

DATASET_SCHEMA = "tomny.dataset-manifest.v2"
FIXTURE_SCHEMA = "tomny.security-pilot-heldout-fixture.v1"
SOURCE_KIND = "synthetic-authored-independent-events"
V5_MANIFEST_SHA256 = "7e2004f0d150bdcd4e6a2584a4d15732be309b6952ad3d4f9ff6956414d4d455"
VARIANTS = ("clean", "paraphrase", "noisy", "adversarial")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def stable_id(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def read_json(path: Path, label: str) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be one JSON object")
    return value


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def load_fixture(path: Path) -> tuple[dict[str, Any], str]:
    raw = path.read_bytes()
    fixture = json.loads(raw)
    if not isinstance(fixture, dict) or set(fixture) != {
        "schemaVersion",
        "datasetId",
        "datasetVersion",
        "seed",
        "rootIds",
    }:
        raise ValueError("Pilot held-out fixture has an invalid contract")
    if (
        fixture["schemaVersion"] != FIXTURE_SCHEMA
        or fixture["datasetId"] != "tomny-security-pilot-heldout"
    ):
        raise ValueError("Pilot held-out fixture identity mismatch")
    if not isinstance(fixture["datasetVersion"], str) or not fixture["datasetVersion"]:
        raise ValueError("Pilot held-out fixture lacks a version")
    if type(fixture["seed"]) is not int:
        raise ValueError("Pilot held-out fixture seed must be an integer")
    ids = fixture["rootIds"]
    if (
        not isinstance(ids, list)
        or len(ids) != 30
        or any(not isinstance(item, str) or not item for item in ids)
        or len(set(ids)) != 30
    ):
        raise ValueError("Pilot held-out fixture must declare exactly 30 unique roots")
    return fixture, sha256_bytes(raw)


def load_frozen_training_rows(
    root: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    manifest_path = root / "manifest.json"
    if sha256_file(manifest_path) != V5_MANIFEST_SHA256:
        raise ValueError("Frozen v5 training manifest hash mismatch")
    manifest = read_json(manifest_path, "Frozen v5 training manifest")
    security = manifest.get("domains", {}).get("security", {})
    splits = security.get("splits", {})
    rows: list[dict[str, Any]] = []
    split_hashes: dict[str, str] = {}
    for name in ("train", "validation"):
        entry = splits.get(name, {})
        path = root / str(entry.get("path", ""))
        if not path.is_file() or sha256_file(path) != entry.get("sha256"):
            raise ValueError(f"Frozen v5 {name} hash mismatch")
        split_hashes[name] = str(entry["sha256"])
        rows.extend(read_jsonl(path))
    return rows, {"manifestSha256": V5_MANIFEST_SHA256, "splits": split_hashes}


def materialize(case: dict[str, Any], dataset_version: str) -> dict[str, Any]:
    return {
        "messages": [
            {"role": "system", "content": case["system"]},
            {"role": "user", "content": case["prompt"]},
            {"role": "assistant", "content": canonical_json(case["expected"])},
        ],
        "metadata": {
            "rowId": stable_id(f"{dataset_version}:{case['caseId']}"),
            "datasetVersion": dataset_version,
            "synthetic": True,
            "source": "security-pilot-heldout-v1",
            "domain": "security",
            "language": case["language"],
            "variant": case["variant"],
            "scenarioFamily": f"security-pilot-heldout:{case['groupId']}",
            "templateFamily": f"security-pilot-heldout:{case['groupId']}",
            "semanticGroup": case["groupId"],
            "hardNegative": case["expected"]["action"] != "allow",
            "critical": case["critical"] is True,
            "containsUserData": False,
            "containsRawChat": False,
            "containsSecrets": False,
            "containsSourceCode": False,
        },
    }


def expected_rows(fixture: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    cases = build_cases(["security"])
    groups = {case["groupId"] for case in cases}
    expected_groups = set(fixture["rootIds"])
    if groups != expected_groups or len(cases) != 120:
        raise ValueError(
            "Pilot fixture and reviewed security roots are not an exact 30-group/120-case match"
        )
    by_group = Counter(case["groupId"] for case in cases)
    if set(by_group.values()) != {len(VARIANTS)}:
        raise ValueError(
            "Each pilot group must contain clean, paraphrase, noisy, and adversarial cases"
        )
    critical_groups = {case["groupId"] for case in cases if case["critical"]}
    if len(critical_groups) < 10:
        raise ValueError(
            "Pilot held-out corpus must retain at least 10 independent critical groups"
        )
    rows = [
        materialize(case, fixture["datasetVersion"])
        for case in sorted(cases, key=lambda item: item["caseId"])
    ]
    return rows, sha256_bytes(canonical_json(cases).encode("utf-8"))


def serialize_rows(rows: list[dict[str, Any]]) -> bytes:
    return ("".join(canonical_json(row) + "\n" for row in rows)).encode("utf-8")


def manifest_for(
    fixture: dict[str, Any],
    fixture_sha256: str,
    rows: list[dict[str, Any]],
    rows_sha256: str,
    definition_sha256: str,
    training_binding: dict[str, Any],
    quality: dict[str, Any],
) -> dict[str, Any]:
    languages = dict(
        sorted(Counter(row["metadata"]["language"] for row in rows).items())
    )
    return {
        "schemaVersion": DATASET_SCHEMA,
        "manifestVersion": 2,
        "datasetId": fixture["datasetId"],
        "datasetVersion": fixture["datasetVersion"],
        "seed": fixture["seed"],
        "license": "Apache-2.0",
        "domains": {
            "security": {
                "purpose": "security",
                "trainerReadableSplits": [],
                "splits": {
                    "test": {
                        "path": "immutable-test/security-test.jsonl",
                        "rows": len(rows),
                        "sha256": rows_sha256,
                        "semanticGroups": len(
                            {row["metadata"]["semanticGroup"] for row in rows}
                        ),
                        "languages": languages,
                        "hardNegatives": sum(
                            bool(row["metadata"]["hardNegative"]) for row in rows
                        ),
                        "immutable": True,
                        "trainerReadable": False,
                    }
                },
            }
        },
        "dataCard": {
            "sources": [
                {
                    "id": "tomny-security-pilot-authored-v1",
                    "kind": SOURCE_KIND,
                    "location": "scripts/model-training/fixtures/security-pilot-heldout-v1.json",
                    "rights": "Project-authored under Apache-2.0",
                }
            ],
            "provenance": "Thirty project-authored independent security groups, each with clean, paraphrase, noisy, and adversarial variants; isolated from frozen v5 train and validation.",
            "rights": "Apache-2.0 project-authored synthetic data only.",
            "privacy": "No user conversations, identities, raw production traces, secrets, or source code.",
            "reviewerStatus": "machine-validated-awaiting-independent-human-review",
            "limitations": [
                "Synthetic data cannot alone qualify an adapter for pilot promotion.",
                "Independent red-team/replay and rollback evidence remain required.",
            ],
        },
        "provenanceBinding": {
            "fixtureSha256": fixture_sha256,
            "reviewedDefinitionsSha256": definition_sha256,
            "frozenTraining": training_binding,
        },
        "quality": {
            "methodVersion": "tomny-security-pilot-heldout-v1",
            "domains": {"security": quality},
            "passed": True,
        },
    }


def build(fixture_path: Path, training_root: Path, output_root: Path) -> dict[str, Any]:
    if output_root.exists():
        raise FileExistsError("Refusing to overwrite pilot held-out evidence")
    fixture, fixture_sha256 = load_fixture(fixture_path)
    rows, definition_sha256 = expected_rows(fixture)
    training_rows, training_binding = load_frozen_training_rows(training_root)
    leakage = leakage_report({"train": training_rows, "validation": [], "test": rows})
    privacy = scan_privacy(rows)
    if not leakage["passed"] or not privacy["passed"]:
        raise RuntimeError(
            f"Pilot held-out quality failed: leakage={leakage['passed']} privacy={privacy['passed']}"
        )
    payload = serialize_rows(rows)
    test_path = output_root / "immutable-test" / "security-test.jsonl"
    test_path.parent.mkdir(parents=True)
    test_path.write_bytes(payload)
    test_path.chmod(0o444)
    quality = {
        "privacy": privacy,
        "leakage": leakage,
        "coverage": {
            "criticalIndependentGroups": len(
                {
                    row["metadata"]["semanticGroup"]
                    for row in rows
                    if row["metadata"]["critical"]
                }
            ),
            "passed": True,
        },
    }
    manifest = manifest_for(
        fixture,
        fixture_sha256,
        rows,
        sha256_bytes(payload),
        definition_sha256,
        training_binding,
        quality,
    )
    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return {
        "manifest": str(manifest_path),
        "manifestSha256": sha256_file(manifest_path),
        "testSha256": sha256_bytes(payload),
        "rows": len(rows),
        "semanticGroups": 30,
    }


def verify(
    fixture_path: Path, training_root: Path, output_root: Path
) -> dict[str, Any]:
    fixture, fixture_sha256 = load_fixture(fixture_path)
    rows, definition_sha256 = expected_rows(fixture)
    _training_rows, training_binding = load_frozen_training_rows(training_root)
    manifest_path = output_root / "manifest.json"
    manifest = read_json(manifest_path, "Pilot held-out manifest")
    test_path = output_root / "immutable-test" / "security-test.jsonl"
    payload = serialize_rows(rows)
    entry = (
        manifest.get("domains", {})
        .get("security", {})
        .get("splits", {})
        .get("test", {})
    )
    if (
        sha256_file(test_path) != entry.get("sha256")
        or test_path.read_bytes() != payload
    ):
        raise ValueError(
            "Pilot held-out test artifact is tampered or differs from reviewed definitions"
        )
    binding = manifest.get("provenanceBinding")
    if binding != {
        "fixtureSha256": fixture_sha256,
        "reviewedDefinitionsSha256": definition_sha256,
        "frozenTraining": training_binding,
    }:
        raise ValueError("Pilot held-out provenance binding is tampered")
    if (
        manifest.get("schemaVersion") != DATASET_SCHEMA
        or entry.get("rows") != 120
        or entry.get("semanticGroups") != 30
        or entry.get("trainerReadable") is not False
        or entry.get("immutable") is not True
    ):
        raise ValueError("Pilot held-out manifest has invalid immutable test contract")
    return {
        "verified": True,
        "manifestSha256": sha256_file(manifest_path),
        "testSha256": sha256_file(test_path),
        "rows": 120,
        "semanticGroups": 30,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build or verify the immutable Security pilot held-out corpus."
    )
    parser.add_argument(
        "--fixture", default=str(SCRIPT_DIR / "security-pilot-heldout-v1.json")
    )
    parser.add_argument("--training-root", default=".training-data-v5-security")
    parser.add_argument("--output", default=".training-data-v5-security-pilot-heldout")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    result = (
        verify(
            Path(args.fixture).resolve(),
            Path(args.training_root).resolve(),
            Path(args.output).resolve(),
        )
        if args.verify
        else build(
            Path(args.fixture).resolve(),
            Path(args.training_root).resolve(),
            Path(args.output).resolve(),
        )
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
