from __future__ import annotations

import argparse
import hashlib
import json
import random
import re

import shutil
import sys
import unicodedata

from collections import Counter
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR.parent))

from data_quality import leakage_report, scan_privacy, sha256_file, validate_closed_ontology
from generate_data import BASE_BINDINGS, OUTPUT_SCHEMAS, SYSTEM_PROMPTS, closed_ontology, write_jsonl

BASE_MANIFEST_SHA256 = "36fb132493dc2090daefb066158b63bc8a99722a9dabb4a0eb46632a1d1fbcb5"
DATASET_SCHEMA = "tomny.dataset-manifest.v2"
FIXTURE_KEYS = {
    "id",
    "boundary",
    "eventFamily",
    "language",
    "difficulty",
    "prompt",
    "expected",
    "critical",
    "source",
}
EXPECTED_KEYS = {
    "riskType",
    "action",
    "confidence",
    "reasonCode",
    "requiresBackendValidation",
    "redactions",
}
ACTIONS = ("allow", "ask", "local_only", "block")
LANGUAGES = ("en", "vi")
DIFFICULTIES = ("clear", "indirect", "noisy", "adversarial")


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as handle:
        for line_number, line in enumerate(handle, start=1):
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"Invalid JSONL at {path}:{line_number}: {error}") from error
            if not isinstance(value, dict):
                raise ValueError(f"Expected an object at {path}:{line_number}")
            rows.append(value)
    return rows


def stable_id(value: str, length: int = 16) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def lexical_tokens(value: str) -> set[str]:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return set(re.findall(r"\w+", normalized, flags=re.UNICODE))


def immutable_similarity_findings(
    candidate_rows: list[dict[str, Any]],
    immutable_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    immutable = [
        (
            row["metadata"]["rowId"],
            lexical_tokens(row["messages"][1]["content"]),
        )
        for row in immutable_rows
    ]
    for row in candidate_rows:
        candidate_tokens = lexical_tokens(row["messages"][1]["content"])
        for immutable_id, immutable_tokens in immutable:
            intersection = candidate_tokens & immutable_tokens
            union = candidate_tokens | immutable_tokens
            if not intersection or not union:
                continue
            jaccard = len(intersection) / len(union)
            containment = len(intersection) / min(len(candidate_tokens), len(immutable_tokens))
            if jaccard >= 0.38 and containment >= 0.58:
                findings.append(
                    {
                        "candidateRowId": row["metadata"]["rowId"],
                        "immutableRowId": immutable_id,
                        "jaccard": round(jaccard, 4),
                        "containment": round(containment, 4),
                    }
                )
    return findings



def split_for_fixture(row: dict[str, Any]) -> str:
    action_index = ACTIONS.index(row["expected"]["action"])
    language_index = LANGUAGES.index(row["language"])
    difficulty_index = DIFFICULTIES.index(row["difficulty"])
    rotation = (row["boundary"] - 1 + action_index + language_index + difficulty_index) % 4
    return "validation" if rotation == 0 else "train"


def validate_fixtures(rows: list[dict[str, Any]]) -> None:
    if len(rows) != 256:
        raise ValueError(f"Candidate 5 requires exactly 256 fixtures, found {len(rows)}")
    ids: set[str] = set()
    event_families: set[str] = set()
    matrix: Counter[tuple[int, str, str, str]] = Counter()
    ontology = closed_ontology("security")
    for index, row in enumerate(rows):
        if set(row) != FIXTURE_KEYS:
            raise ValueError(f"Fixture {index} has unexpected keys: {sorted(set(row) ^ FIXTURE_KEYS)}")
        if set(row["expected"]) != EXPECTED_KEYS:
            raise ValueError(f"Fixture {row.get('id')} has an invalid expected contract")
        if row["id"] in ids or row["eventFamily"] in event_families:
            raise ValueError(f"Fixture id/eventFamily is not independent: {row['id']}")
        ids.add(row["id"])
        event_families.add(row["eventFamily"])
        if row["boundary"] not in range(1, 9):
            raise ValueError(f"Fixture boundary is outside 1..8: {row['id']}")
        if row["language"] not in LANGUAGES or row["difficulty"] not in DIFFICULTIES:
            raise ValueError(f"Fixture language/difficulty is invalid: {row['id']}")
        if row["expected"]["action"] not in ACTIONS:
            raise ValueError(f"Fixture action is invalid: {row['id']}")
        if row["source"] != "candidate5-independent-draft":
            raise ValueError(f"Fixture source is invalid: {row['id']}")
        if not isinstance(row["prompt"], str) or len(row["prompt"].strip()) < 30:
            raise ValueError(f"Fixture prompt is too short: {row['id']}")
        if row["language"] == "vi" and (
            "?" in row["prompt"]
            or "\ufffd" in row["prompt"]
            or re.search(r"[À-ỹĐđ]", row["prompt"]) is None
        ):
            raise ValueError(f"Fixture Vietnamese text is corrupted or lacks Vietnamese diacritics: {row['id']}")

        matrix[(row["boundary"], row["expected"]["action"], row["language"], row["difficulty"])] += 1
        for field, allowed in ontology.items():
            if row["expected"][field] not in allowed:
                raise ValueError(f"Fixture {row['id']} uses an out-of-ontology {field}")
    required = {
        (boundary, action, language, difficulty)
        for boundary in range(1, 9)
        for action in ACTIONS
        for language in LANGUAGES
        for difficulty in DIFFICULTIES
    }
    if set(matrix) != required or any(count != 1 for count in matrix.values()):
        raise ValueError("Candidate 5 fixture matrix must contain every boundary/action/language/difficulty exactly once")


def materialize_fixture(row: dict[str, Any], dataset_version: str) -> dict[str, Any]:
    event_family = row["eventFamily"]
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPTS["security"]},
            {"role": "user", "content": row["prompt"]},
            {
                "role": "assistant",
                "content": json.dumps(row["expected"], ensure_ascii=False, separators=(",", ":")),
            },
        ],
        "metadata": {
            "rowId": stable_id(f"{dataset_version}:{row['id']}", 24),
            "datasetVersion": dataset_version,
            "synthetic": True,
            "source": row["source"],
            "domain": "security",
            "language": row["language"],
            "scenarioFamily": f"candidate5-event-{event_family}",
            "templateFamily": stable_id(f"candidate5-template:{event_family}"),
            "semanticGroup": stable_id(f"candidate5-event:{event_family}"),
            "hardNegative": row["difficulty"] != "clear" or row["expected"]["action"] != "allow",
            "critical": bool(row["critical"]),
            "difficulty": row["difficulty"],
            "boundary": row["boundary"],
            "containsUserData": False,
            "containsRawChat": False,
            "containsSecrets": False,
            "containsSourceCode": False,
        },
    }


def split_manifest_entry(root: Path, path: Path, rows: list[dict[str, Any]], *, immutable: bool) -> dict[str, Any]:
    languages = Counter(row["metadata"]["language"] for row in rows)
    return {
        "path": path.relative_to(root).as_posix(),
        "rows": len(rows),
        "sha256": sha256_file(path),
        "semanticGroups": len({row["metadata"]["semanticGroup"] for row in rows}),
        "languages": dict(sorted(languages.items())),
        "hardNegatives": sum(bool(row["metadata"]["hardNegative"]) for row in rows),
        "immutable": immutable,
        "trainerReadable": not immutable,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the isolated Security Candidate 5 dataset.")
    parser.add_argument("--base", default=".training-data-v4-balanced")
    parser.add_argument("--fixtures", nargs="+", required=True)
    parser.add_argument("--output", default=".training-data-v5-security")
    parser.add_argument("--dataset-version", default="2026-07-29.v5")
    args = parser.parse_args()

    base_root = Path(args.base).resolve()
    base_manifest_path = base_root / "manifest.json"
    if sha256_file(base_manifest_path) != BASE_MANIFEST_SHA256:
        raise ValueError("Candidate 5 base manifest does not match the immutable v4 evidence")
    base_manifest = load_json(base_manifest_path)
    base_domain = base_manifest["domains"]["security"]
    base_train_path = base_root / base_domain["splits"]["train"]["path"]
    base_validation_path = base_root / base_domain["splits"]["validation"]["path"]
    base_test_path = base_root / base_domain["splits"]["test"]["path"]
    for split_name, path in (
        ("train", base_train_path),
        ("validation", base_validation_path),
        ("test", base_test_path),
    ):
        if sha256_file(path) != base_domain["splits"][split_name]["sha256"]:
            raise ValueError(f"Immutable v4 {split_name} file hash mismatch")

    fixture_rows = [row for fixture in args.fixtures for row in load_jsonl(Path(fixture).resolve())]
    validate_fixtures(fixture_rows)
    materialized = [(split_for_fixture(row), materialize_fixture(row, args.dataset_version)) for row in fixture_rows]
    added_train = [row for split, row in materialized if split == "train"]
    dev_hard = [row for split, row in materialized if split == "validation"]
    if len(added_train) != 192 or len(dev_hard) != 64:
        raise RuntimeError("Candidate 5 deterministic split must produce 192 train and 64 dev-hard rows")

    train_rows = load_jsonl(base_train_path) + added_train
    random.Random(f"{args.dataset_version}:security:train").shuffle(train_rows)
    random.Random(f"{args.dataset_version}:security:validation").shuffle(dev_hard)
    test_rows = load_jsonl(base_test_path)
    immutable_similarity = immutable_similarity_findings(added_train + dev_hard, test_rows)
    if immutable_similarity:
        raise RuntimeError(
            "Candidate 5 independent fixtures overlap the immutable benchmark: "
            + json.dumps(immutable_similarity[:20], ensure_ascii=False)
        )

    cross_split_similarity = immutable_similarity_findings(added_train, dev_hard)
    if cross_split_similarity:
        raise RuntimeError(
            "Candidate 5 train and dev-hard contain near-duplicate concrete events: "
            + json.dumps(cross_split_similarity[:20], ensure_ascii=False)
        )

    quality_rows = {"train": train_rows, "validation": dev_hard, "test": test_rows}
    leakage = leakage_report(quality_rows)
    privacy = scan_privacy(row for rows in quality_rows.values() for row in rows)
    ontology = closed_ontology("security")
    ontology_result = validate_closed_ontology(
        (row for rows in quality_rows.values() for row in rows),
        ontology,
    )
    if (not leakage["passed"] or not leakage["scenarioFamily"]["passed"] or not privacy["passed"] or not ontology_result["passed"]):
        raise RuntimeError(
            f"Candidate 5 quality failed: leakage={leakage['passed']} "
            f"privacy={privacy['passed']} ontology={ontology_result['passed']}"
        )

    output_root = Path(args.output).resolve()
    if output_root.exists():
        raise FileExistsError(f"Refusing to overwrite candidate dataset: {output_root}")
    immutable_root = output_root / "immutable-test"
    immutable_root.mkdir(parents=True)
    train_path = output_root / "security-train.jsonl"
    validation_path = output_root / "security-validation.jsonl"
    regression_path = output_root / "security-regression-validation.jsonl"
    test_path = immutable_root / "security-test.jsonl"
    write_jsonl(train_path, train_rows)
    write_jsonl(validation_path, dev_hard)
    shutil.copyfile(base_validation_path, regression_path)
    shutil.copyfile(base_test_path, test_path)
    test_path.chmod(0o444)

    label_distributions = {
        split: dict(
            sorted(Counter(json.loads(row["messages"][2]["content"])["action"] for row in rows).items())
        )
        for split, rows in quality_rows.items()
    }
    split_entries = {
        "train": split_manifest_entry(output_root, train_path, train_rows, immutable=False),
        "validation": split_manifest_entry(output_root, validation_path, dev_hard, immutable=False),
        "test": split_manifest_entry(output_root, test_path, test_rows, immutable=True),
    }
    manifest = {
        "schemaVersion": DATASET_SCHEMA,
        "manifestVersion": 2,
        "datasetId": "tomny-security-candidate5-independent",
        "datasetVersion": args.dataset_version,
        "seed": 20260725,
        "license": "Apache-2.0",
        "splitPolicy": {
            "unit": "independent event family",
            "assignment": "balanced deterministic rotation across boundary, action, language, and difficulty",
            "ratiosApproximate": {"train": 0.75, "validation": 0.25},
            "testIsolation": "v4 immutable benchmark retained read-only and trainerReadable=false",
        },
        "domains": {
            "security": {
                "purpose": "security",
                "baseBinding": dict(BASE_BINDINGS["security"]),
                "outputSchema": OUTPUT_SCHEMAS["security"],
                "closedOntology": ontology,
                "trainerReadableSplits": ["train", "validation"],
                "splits": split_entries,
                "regressionValidation": {
                    "path": regression_path.relative_to(output_root).as_posix(),
                    "rows": len(load_jsonl(base_validation_path)),
                    "sha256": sha256_file(regression_path),
                    "purpose": "v4 non-regression only; never used to select Candidate 5 checkpoints",
                },
            }
        },
        "dataCard": {
            "sources": [
                {
                    "id": "tomny-curated-policy-template-v4",
                    "kind": "synthetic-authored",
                    "location": ".training-data-v4-balanced/security-train.jsonl",
                    "rights": "Project-authored under Apache-2.0",
                },
                {
                    "id": "tomny-security-candidate5-independent",
                    "kind": "synthetic-authored-independent-events",
                    "location": "scripts/model-training/fixtures/security-v5-part-*.jsonl",
                    "rights": "Project-authored under Apache-2.0",
                },
            ],
            "provenance": "Immutable v4 train plus 192 independent Candidate 5 events; 64 disjoint events form dev-hard.",
            "rights": "Apache-2.0 project-authored synthetic data only.",
            "privacy": "No user conversations, identities, raw production traces, secrets, or source code.",
            "reviewerStatus": "machine-validated-awaiting-independent-human-review",
            "limitations": [
                "Synthetic data cannot alone qualify an adapter for pilot promotion.",
                "The immutable benchmark remains separate and cannot be used for checkpoint selection.",
            ],
        },
        "quality": {
            "methodVersion": "tomny-data-quality-v5",
            "domains": {
                "security": {
                    "privacy": privacy,
                    "leakage": leakage,
                    "ontology": ontology_result,
                    "coverage": {
                        "labelDistribution": label_distributions,
                        "independentAddedTrainRows": len(added_train),
                        "devHardRows": len(dev_hard),
                        "criticalDevHardRows": sum(bool(row["metadata"]["critical"]) for row in dev_hard),
                        "passed": True,
                    },
                    "dedup": {
                        "method": "NFKC casefold exact prompt hash, fuzzy comparison, and event-family isolation",
                        "withinSplitDuplicateCount": leakage["withinSplitDuplicateCount"],
                        "passed": not any(leakage["withinSplitDuplicateCount"].values()),
                    },
                }
            },
            "passed": True,
        },
    }
    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(
        json.dumps(
            {
                "manifest": str(manifest_path),
                "sha256": sha256_file(manifest_path),
                "trainRows": len(train_rows),
                "devHardRows": len(dev_hard),
                "criticalDevHardRows": manifest["quality"]["domains"]["security"]["coverage"][
                    "criticalDevHardRows"
                ],
                "labelDistribution": label_distributions,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
