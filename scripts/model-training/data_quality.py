from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

_SECRET_PATTERNS = {
    "awsAccessKey": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "githubToken": re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    "genericSecretAssignment": re.compile(
        r"(?i)\b(?:api[_ -]?key|password|secret|token)\s*[:=]\s*['\"]?[A-Za-z0-9_./+=-]{12,}"
    ),
    "privateKey": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}
_PII_PATTERNS = {
    "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE),
    "ipv4": re.compile(r"(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)"),
    "phone": re.compile(r"(?<!\d)(?:\+?\d[\d .()-]{8,}\d)(?!\d)"),
}


def canonical_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(re.findall(r"\w+", normalized, flags=re.UNICODE))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def user_prompt(row: dict[str, Any]) -> str:
    messages = row.get("messages", [])
    return "\n".join(str(message.get("content", "")) for message in messages if message.get("role") == "user")


def assistant_payload(row: dict[str, Any]) -> dict[str, Any]:
    messages = row.get("messages", [])
    assistant = [message.get("content", "") for message in messages if message.get("role") == "assistant"]
    if len(assistant) != 1:
        raise ValueError("Each row must contain exactly one assistant message")
    parsed = json.loads(assistant[0])
    if not isinstance(parsed, dict):
        raise ValueError("Assistant output must be one JSON object")
    return parsed


def scan_privacy(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    scanned = 0
    for row_index, row in enumerate(rows):
        scanned += 1
        text = "\n".join(str(message.get("content", "")) for message in row.get("messages", []))
        for category, pattern in {**_SECRET_PATTERNS, **_PII_PATTERNS}.items():
            if pattern.search(text):
                findings.append({"rowIndex": row_index, "category": category})
    return {"rowsScanned": scanned, "findingCount": len(findings), "findings": findings[:100], "passed": not findings}


def _fuzzy_candidates(entries: list[tuple[str, str, str]], threshold: float) -> list[dict[str, Any]]:
    buckets: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for split, row_id, normalized in entries:
        tokens = normalized.split()
        fingerprint = " ".join(sorted(set(tokens))[:8])
        buckets[fingerprint].append((split, row_id, normalized))
    findings: list[dict[str, Any]] = []
    for bucket in buckets.values():
        for index, left in enumerate(bucket):
            for right in bucket[index + 1 :]:
                if left[0] == right[0]:
                    continue
                ratio = SequenceMatcher(None, left[2], right[2], autojunk=False).ratio()
                if ratio >= threshold:
                    findings.append(
                        {"leftSplit": left[0], "leftRow": left[1], "rightSplit": right[0], "rightRow": right[1], "ratio": round(ratio, 6)}
                    )
                    if len(findings) >= 100:
                        return findings
    return findings


def scenario_family_split_report(rows_by_split: dict[str, Iterable[dict[str, Any]]]) -> dict[str, Any]:
    """Ensure each scenario family is held out from either train or validation."""
    required_splits = ("train", "validation")
    missing_splits = [split for split in required_splits if split not in rows_by_split]
    memberships: dict[str, set[str]] = defaultdict(set)
    missing: list[dict[str, Any]] = []

    for split in required_splits:
        for index, row in enumerate(rows_by_split.get(split, ())):
            metadata = row.get("metadata")
            family = metadata.get("scenarioFamily") if isinstance(metadata, dict) else None
            if not isinstance(family, str) or not family.strip():
                missing.append({"split": split, "rowIndex": index})
                continue
            memberships[family].add(split)

    overlaps = [
        {"scenarioFamily": family, "splits": sorted(splits)}
        for family, splits in sorted(memberships.items())
        if set(required_splits) <= splits
    ]
    return {
        "requiredSplitsPresent": not missing_splits,
        "missingSplits": missing_splits,
        "missingScenarioFamilyCount": len(missing),
        "missingScenarioFamilyFindings": missing[:100],
        "scenarioFamilyCrossSplitCount": len(overlaps),
        "scenarioFamilyCrossSplitFindings": overlaps[:100],
        "passed": not missing_splits and not missing and not overlaps,
    }




def split_isolation_report(rows_by_split: dict[str, Iterable[dict[str, Any]]]) -> dict[str, Any]:
    """Validate template and semantic-group isolation across train and validation."""
    required_splits = ("train", "validation")
    missing_splits = [split for split in required_splits if split not in rows_by_split]
    memberships: dict[str, dict[str, set[str]]] = {
        "templateFamily": defaultdict(set),
        "semanticGroup": defaultdict(set),
    }
    missing_metadata: list[dict[str, Any]] = []

    for split in required_splits:
        for index, row in enumerate(rows_by_split.get(split, ())):
            metadata = row.get("metadata")
            for key in memberships:
                value = metadata.get(key) if isinstance(metadata, dict) else None
                if not isinstance(value, str) or not value.strip():
                    missing_metadata.append({"split": split, "rowIndex": index, "key": key})
                    continue
                memberships[key][value].add(split)

    overlaps = {
        key: [
            {key: value, "splits": sorted(splits)}
            for value, splits in sorted(values.items())
            if set(required_splits) <= splits
        ]
        for key, values in memberships.items()
    }
    return {
        "requiredSplitsPresent": not missing_splits,
        "missingSplits": missing_splits,
        "missingMetadataCount": len(missing_metadata),
        "missingMetadataFindings": missing_metadata[:100],
        "templateCrossSplitCount": len(overlaps["templateFamily"]),
        "templateCrossSplitFindings": overlaps["templateFamily"][:100],
        "semanticGroupCrossSplitCount": len(overlaps["semanticGroup"]),
        "semanticGroupCrossSplitFindings": overlaps["semanticGroup"][:100],
        "passed": (
            not missing_splits
            and not missing_metadata
            and not overlaps["templateFamily"]
            and not overlaps["semanticGroup"]
        ),
    }



def leakage_report(rows_by_split: dict[str, list[dict[str, Any]]], fuzzy_threshold: float = 0.94) -> dict[str, Any]:
    exact_seen: dict[str, tuple[str, str]] = {}
    exact: list[dict[str, Any]] = []
    template_splits: dict[str, set[str]] = defaultdict(set)
    entries: list[tuple[str, str, str]] = []
    within_split_duplicates: dict[str, int] = defaultdict(int)
    within_seen: dict[str, set[str]] = defaultdict(set)
    semantic_group_splits: dict[str, set[str]] = defaultdict(set)

    for split, rows in rows_by_split.items():
        for index, row in enumerate(rows):
            row_id = str(row.get("metadata", {}).get("rowId", index))
            normalized = canonical_text(user_prompt(row))
            digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
            if digest in within_seen[split]:
                within_split_duplicates[split] += 1
            within_seen[split].add(digest)
            previous = exact_seen.get(digest)
            if previous and previous[0] != split:
                exact.append({"leftSplit": previous[0], "leftRow": previous[1], "rightSplit": split, "rightRow": row_id})
            else:
                exact_seen[digest] = (split, row_id)
            metadata = row.get("metadata", {})
            template_splits[str(metadata.get("templateFamily", ""))].add(split)
            semantic_group_splits[str(metadata.get("semanticGroup", ""))].add(split)
            entries.append((split, row_id, normalized))

    template = [
        {"templateFamily": family, "splits": sorted(splits)}
        for family, splits in sorted(template_splits.items())
        if family and len(splits) > 1
    ]
    semantic = [
        {"semanticGroup": group, "splits": sorted(splits)}
        for group, splits in sorted(semantic_group_splits.items())
        if group and len(splits) > 1
    ]
    fuzzy = _fuzzy_candidates(entries, fuzzy_threshold)
    scenario_family = scenario_family_split_report(rows_by_split)
    split_isolation = split_isolation_report(rows_by_split)
    passed = (
        not exact
        and not fuzzy
        and not template
        and not semantic
        and not any(within_split_duplicates.values())
        and split_isolation["passed"]
    )


    return {
        "methodVersion": "tomny-data-quality-v4",
        "fuzzyThreshold": fuzzy_threshold,
        "exactCrossSplitCount": len(exact),
        "fuzzyCrossSplitCount": len(fuzzy),
        "templateCrossSplitCount": len(template),
        "semanticGroupCrossSplitCount": len(semantic),
        "withinSplitDuplicateCount": dict(sorted(within_split_duplicates.items())),
        "exactFindings": exact[:100],
        "fuzzyFindings": fuzzy,
        "templateFindings": template[:100],
        "semanticGroupFindings": semantic[:100],
        "scenarioFamily": scenario_family,
        "splitIsolation": split_isolation,
        "passed": passed,
    }


def validate_closed_ontology(rows: Iterable[dict[str, Any]], ontology: dict[str, list[Any]]) -> dict[str, Any]:
    violations: list[dict[str, Any]] = []
    row_count = 0
    for row_index, row in enumerate(rows):
        row_count += 1
        payload = assistant_payload(row)
        for field, allowed in ontology.items():
            value = payload.get(field)
            comparable = tuple(value) if isinstance(value, list) else value
            allowed_comparable = {tuple(item) if isinstance(item, list) else item for item in allowed}
            if comparable not in allowed_comparable:
                violations.append({"rowIndex": row_index, "field": field, "value": value})
    return {"rowsScanned": row_count, "violationCount": len(violations), "violations": violations[:100], "passed": not violations}
