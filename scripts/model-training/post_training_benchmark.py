from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
DOMAINS = ("security", "user-understanding", "semantic-analysis")
CANDIDATE_IDS = {
    "security": "com.tomny.core.security",
    "user-understanding": "com.tomny.core.user-understanding",
    "semantic-analysis": "com.tomny.core.semantic-analysis",

}
RECIPE_SHA256 = {
    "security": "94a7a98596be2abe651830ef05e49a5ad6ab52744c7d531e31c00ecc5e9967f7",
    "user-understanding": "3b3d158107c39c4117c3278b174a4ce6c2f2bd148021ae2d9572c208b7368db9",
    "semantic-analysis": "78054fb777d1dc24661e1787942702f804dc7d96de7b9ce0a4100ba8b4226b47",

}

DATASET_SHA256 = '90611e83a5308caef481e589818c5631fdfda7d8acd24efd090982d0038646e4'
PROVENANCE_SCHEMA = 'tomny.training-provenance.v2'
BASE_BINDING = {"path": ".local-models/Qwen3.5-0.8B", "modelId": "Qwen/Qwen3.5-0.8B", "revision": "2fc06364715b967f1860aea9cf38778875588b17", "contentSha256": "ff3a07808a9e83627e69a07131fdec45c60973f23cc5617204d173461ec65fe6"}
BASES = {purpose: BASE_BINDING for purpose in DOMAINS}
SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
FORBIDDEN_PROMOTION_PARTS = {"active", "pilot", "production"}
ALLOWED_COMPLETED_STATES = {'completed-candidate', 'skipped-completed'}
BENCHMARK_REPORT_SCHEMA = 'tomny.adapter-benchmark-report.v1'
RUN_MANIFEST_SCHEMA = 'tomny.adapter-benchmark-run-manifest.v1'
BENCHMARK_VARIANTS = ('clean', 'paraphrase', 'noisy', 'adversarial')
SHA256_HEX = re.compile(r'^[0-9a-f]{64}$')
SECURITY_V05_CANDIDATE_VERSION = '0.5.0-candidate.1'
SECURITY_V05_PURPOSE = 'security'
SECURITY_V05_CANDIDATE_ID = 'com.tomny.core.security'
SECURITY_V05_RECIPE_SHA256 = '5d339fa2c222c0cae2a5ed09279c38dd703fdae35526eb73d73bd189b60526af'
SECURITY_V05_HELDOUT_MANIFEST = REPO_ROOT / '.training-data-v5-security-pilot-heldout' / 'manifest.json'
SECURITY_V05_HELDOUT_MANIFEST_SHA256 = '1e20b818a3f05cee5d8c9d99cfac0ca75e032c3819a13319aa0a7e23b3e9c2f9'
SECURITY_V05_QUEUE_LATEST = REPO_ROOT / '.model-adapters' / 'candidates' / '_queue' / 'latest.json'
SECURITY_V05_OUTPUT_ROOT = REPO_ROOT / '.model-benchmarks' / 'checkpoints' / 'security-v05'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Candidate-only mixed-base post-training benchmark orchestrator.")
    parser.add_argument("--candidate-version", default="0.1.0-candidate.1")
    parser.add_argument("--candidate-root", default=".model-adapters/candidates")
    parser.add_argument("--queue-latest", default=".model-adapters/candidates/_queue/latest.json")
    parser.add_argument("--dataset-manifest", default=".training-data-v6-qwen08b-semantic-r4/manifest.json")
    parser.add_argument("--output-root", default=".model-benchmarks/candidates")
    parser.add_argument("--run-id")
    parser.add_argument("--dry-run", action="store_true", help="Verify/plan only; never invoke GPU benchmark or write reports.")
    parser.add_argument("--gate-fixture", help="Synthetic benchmark-report fixture, allowed only with --dry-run.")
    parser.add_argument(
        '--security-v05-single-domain',
        action='store_true',
        help='Benchmark only the completed Security 0.5 candidate through its trainer-selected finalized checkpoint.',
    )
    return parser.parse_args()


def read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_bytes())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError('Candidate evidence JSON is unreadable or malformed') from None
    if not isinstance(value, dict):
        raise RuntimeError(f'{label} must be a JSON object')
    return value


def write_new_text_atomic(path: Path, content: str) -> None:
    if path.exists():
        raise RuntimeError('Candidate evidence output already exists')
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    try:
        with temporary.open('x', encoding='utf-8', newline='\n') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    except FileExistsError:
        raise RuntimeError('Candidate evidence output already exists') from None
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_tree(root: Path) -> str:
    if not root.is_dir():
        raise FileNotFoundError(root)
    files = sorted(path for path in root.rglob("*") if path.is_file())
    if not files:
        raise ValueError(f"Empty base model: {root}")
    digest = hashlib.sha256()
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def safe_component(value: str, label: str) -> str:
    if not SAFE_COMPONENT.fullmatch(value):
        raise ValueError(f"{label} must match {SAFE_COMPONENT.pattern}")
    if any(token in value.lower() for token in FORBIDDEN_PROMOTION_PARTS):
        raise ValueError(f"{label} cannot name a promotion channel")
    return value


def resolve_scoped(relative: str, allowed_root: Path, label: str) -> Path:
    source = Path(relative)
    if source.is_absolute():
        raise ValueError(f"{label} must be repository-relative")
    resolved = (REPO_ROOT / source).resolve()
    allowed = allowed_root.resolve()
    if resolved != allowed and allowed not in resolved.parents:
        raise ValueError(f"{label} escapes its repository scope")
    if any(token in part.lower() for part in resolved.parts for token in FORBIDDEN_PROMOTION_PARTS):
        raise ValueError(f"{label} contains a promotion path component")
    return resolved


def expected_paths(candidate_root: Path, version: str) -> dict[str, Path]:
    return {purpose: (candidate_root / candidate_id / version).resolve() for purpose, candidate_id in CANDIDATE_IDS.items()}


def validate_queue(latest_path: Path, version: str, paths: dict[str, Path]) -> dict[str, Any]:
    latest = read_json(latest_path, "latest queue pointer")
    run_id = safe_component(str(latest.get("runId", "")), "queue run id")
    queue_root = latest_path.parent.resolve()
    expected_status = (queue_root / run_id / "status.json").resolve()
    if Path(str(latest.get("statusPath", ""))).resolve() != expected_status:
        raise RuntimeError("latest.statusPath is not bound to _queue/<runId>/status.json")
    status = read_json(expected_status, "queue status")
    if latest.get("state") != "completed-candidates" or status.get("state") != "completed-candidates":
        raise RuntimeError("Queue is not completed-candidates; benchmark fails closed")
    if status.get("runId") != run_id or status.get("candidateVersion") != version or status.get("promotionAllowed") is not False:
        raise RuntimeError("Queue identity/version/candidate-only provenance mismatch")
    adapters = status.get("adapters")
    if not isinstance(adapters, list) or len(adapters) != 4:
        raise RuntimeError("Completed queue must contain exactly four adapters")
    seen: set[str] = set()
    for adapter in adapters:
        purpose = adapter.get("purpose")
        if purpose not in DOMAINS or purpose in seen or adapter.get("candidateId") != CANDIDATE_IDS.get(purpose):
            raise RuntimeError("Queue has missing, duplicate, or unknown candidate identity")
        seen.add(purpose)
        if adapter.get("state") not in ALLOWED_COMPLETED_STATES or Path(str(adapter.get("candidate", ""))).resolve() != paths[purpose]:
            raise RuntimeError(f"{purpose}: queue candidate is incomplete or path-mismatched")
        if adapter.get("recipeSha256") != RECIPE_SHA256[purpose]:
            raise RuntimeError(f"{purpose}: queue recipe SHA-256 mismatch")
        expected_base = {key: BASES[purpose][key] for key in ("modelId", "revision", "contentSha256")}
        if adapter.get("baseModel") != expected_base:
            raise RuntimeError(f"{purpose}: queue base binding mismatch")
    if seen != set(DOMAINS):
        raise RuntimeError("Queue does not cover exactly four purposes")
    return {"latest": latest, "status": status, "statusPath": str(expected_status)}


def verify_candidates(paths: dict[str, Path], version: str) -> dict[str, Any]:
    for purpose, path in paths.items():
        manifest = read_json(path / "training_manifest.json", f"{purpose} manifest")
        candidate = manifest.get("candidate", {})
        expected_base = {key: BASES[purpose][key] for key in ("modelId", "revision", "contentSha256")}
        if manifest.get('schemaVersion') != PROVENANCE_SCHEMA or manifest.get('completed') is not True or manifest.get('status') != 'candidate':
            raise RuntimeError(f"{purpose}: not a completed production candidate")
        if manifest.get("purpose") != purpose or candidate.get("id") != CANDIDATE_IDS[purpose] or candidate.get("version") != version:
            raise RuntimeError(f"{purpose}: candidate identity mismatch")
        if Path(str(candidate.get("path", ""))).resolve() != path or manifest.get("baseModel", {}) != {**expected_base, "path": manifest.get("baseModel", {}).get("path")}:
            raise RuntimeError(f"{purpose}: candidate path/base provenance mismatch")
        if manifest.get("data", {}).get("manifestSha256") != DATASET_SHA256 or manifest.get("data", {}).get("testAccessed") is not False:
            raise RuntimeError(f"{purpose}: dataset/test-isolation provenance mismatch")
        if manifest.get("recipe", {}).get("sha256") != RECIPE_SHA256[purpose]:
            raise RuntimeError(f"{purpose}: pinned recipe provenance mismatch")
    verifier = Path(__file__).with_name("verify_adapters.py")
    command = [sys.executable, str(verifier), *(str(paths[purpose]) for purpose in DOMAINS), "--output", os.devnull]
    result = subprocess.run(command, cwd=REPO_ROOT, capture_output=True, text=True, check=False, timeout=1800)
    if result.returncode != 0:
        raise RuntimeError('Candidate provenance verification failed')
    report = json.loads(result.stdout)
    if report.get("verified") is not True or [item.get("purpose") for item in report.get("adapters", [])] != list(DOMAINS):
        raise RuntimeError("Verifier did not confirm exactly the four required adapters")
    return report


def immutable_snapshot(manifest_path: Path) -> dict[str, Any]:
    if sha256_file(manifest_path) != DATASET_SHA256:
        raise RuntimeError("Dataset manifest SHA-256 mismatch")
    manifest = read_json(manifest_path, "dataset manifest")
    root = manifest_path.parent.resolve()
    tests: dict[str, Any] = {}
    for purpose in DOMAINS:
        entry = manifest.get("domains", {}).get(purpose, {}).get("splits", {}).get("test", {})
        path = (root / str(entry.get("path", ""))).resolve()
        if root not in path.parents or entry.get("immutable") is not True or entry.get("trainerReadable") is not False or sha256_file(path) != entry.get("sha256"):
            raise RuntimeError(f"{purpose}: immutable test provenance mismatch")
        tests[purpose] = {"path": str(path), "sha256": entry["sha256"], "rows": entry["rows"], "semanticGroups": entry["semanticGroups"]}
    data_card = manifest.get("dataCard")
    sources = data_card.get("sources") if isinstance(data_card, dict) else None
    source_kinds = {
        source.get("kind")
        for source in sources
        if isinstance(source, dict) and isinstance(source.get("kind"), str)
    } if isinstance(sources, list) else set()
    if (
        not isinstance(manifest.get("datasetId"), str)
        or not isinstance(manifest.get("datasetVersion"), str)
        or not manifest["datasetId"].strip()
        or not manifest["datasetVersion"].strip()
        or len(source_kinds) != len(sources or [])
        or not source_kinds <= {"synthetic-authored", "synthetic-authored-independent-events", "licensed"}
    ):
        raise RuntimeError("Dataset manifest is not a reproducible non-user benchmark corpus")
    return {
        "datasetId": manifest["datasetId"],
        "datasetVersion": manifest["datasetVersion"],
        "manifestSha256": DATASET_SHA256,
        "manifestSchemaVersion": manifest.get("schemaVersion"),
        "sourceKinds": sorted(source_kinds),
        "containsUserData": False,
        "tests": tests,
    }


def require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeError(f'{label} must be an object')
    return value


def require_exact_keys(value: dict[str, Any], keys: set[str], label: str) -> None:
    if set(value) != keys:
        raise RuntimeError(f'{label} has an unexpected evidence schema')


def require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or not SHA256_HEX.fullmatch(value):
        raise RuntimeError(f'{label} must be a lowercase SHA-256')
    return value


def require_bound_path(value: Any, expected: Path, label: str) -> None:
    if not isinstance(value, str) or Path(value).resolve() != expected.resolve():
        raise RuntimeError(f'{label} is not bound to the current benchmark output')


def is_finite_number(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(float(value))


def is_count_at_least(value: Any, minimum: int) -> bool:
    return type(value) is int and value >= minimum


def verify_benchmark_inputs_unchanged(
    paths: dict[str, Path],
    version: str,
    expected_verification: dict[str, Any],
    expected_base_hashes: dict[str, str],
) -> dict[str, Any]:
    """Reject a benchmark when its candidate or base artifacts changed after preflight."""
    verification = verify_candidates(paths, version)
    if verification != expected_verification:
        raise RuntimeError('Candidate artifacts or provenance changed during benchmark')
    for name, purpose in (("qwen35-08b", "security"), ("qwen35-08b", "user-understanding")):
        base_path = (REPO_ROOT / BASES[purpose]["path"]).resolve()
        if sha256_tree(base_path) != expected_base_hashes.get(name):
            raise RuntimeError(f"{name}: base model changed during benchmark")
    return verification


def validate_benchmark_evidence(
    output: Path,
    report: dict[str, Any],
    dataset: Path,
    immutable_tests: dict[str, Any],
    candidates: dict[str, Path],
) -> dict[str, Any]:
    report_path = output / 'benchmark-report.json'
    cases_path = output / 'benchmark-cases.jsonl'
    raw_path = output / 'raw-generations.jsonl'
    manifest_path = output / 'run-manifest.json'
    run_manifest = read_json(manifest_path, 'benchmark run manifest')
    require_exact_keys(
        run_manifest,
        {
            'schemaVersion',
            'candidateOnly',
            'promotionAllowed',
            'reportSha256',
            'rawGenerationsSha256',
            'benchmarkCasesSha256',
            'report',
            'rawGenerations',
            'benchmarkCases',
        },
        'Benchmark run manifest',
    )
    if (
        run_manifest.get('schemaVersion') != RUN_MANIFEST_SCHEMA
        or run_manifest.get('candidateOnly') is not True
        or run_manifest.get('promotionAllowed') is not False
    ):
        raise RuntimeError('Benchmark run manifest is not candidate-only evidence')
    require_bound_path(run_manifest.get('report'), report_path, 'Benchmark run manifest report')
    require_bound_path(run_manifest.get('rawGenerations'), raw_path, 'Benchmark run manifest raw generations')
    require_bound_path(run_manifest.get('benchmarkCases'), cases_path, 'Benchmark run manifest cases')
    for path, field, label in (
        (report_path, 'reportSha256', 'benchmark report'),
        (raw_path, 'rawGenerationsSha256', 'raw generations'),
        (cases_path, 'benchmarkCasesSha256', 'benchmark cases'),
    ):
        if sha256_file(path) != require_sha256(run_manifest.get(field), f'Benchmark run manifest {field}'):
            raise RuntimeError(f'Benchmark {label} hash does not match its run manifest')

    require_exact_keys(
        report,
        {
            'schemaVersion',
            'candidateOnly',
            'promotionAllowed',
            'benchmark',
            'dataIndependence',
            'immutableTestSources',
            'resourceGate',
            'standardsCrosswalk',
            'acceptanceGates',
            'domains',
            'modelLoads',
        },
        'Benchmark report',
    )
    if (
        report.get('schemaVersion') != BENCHMARK_REPORT_SCHEMA
        or report.get('candidateOnly') is not True
        or report.get('promotionAllowed') is not False
    ):
        raise RuntimeError('Benchmark report is not candidate-only evidence')
    benchmark = require_object(report.get('benchmark'), 'Benchmark metadata')
    expected_case_counts = {purpose: immutable_tests['tests'][purpose]['rows'] for purpose in DOMAINS}
    expected_group_counts = {purpose: immutable_tests['tests'][purpose]['semanticGroups'] for purpose in DOMAINS}
    if (
        benchmark.get('caseCount') != sum(expected_case_counts.values())
        or benchmark.get('caseCountsByDomain') != expected_case_counts
        or benchmark.get('semanticGroupsByDomain') != expected_group_counts
        or benchmark.get('variants') != list(BENCHMARK_VARIANTS)
        or benchmark.get('sha256') != run_manifest['benchmarkCasesSha256']
    ):
        raise RuntimeError('Benchmark metadata is not bound to the immutable test set')
    expected_sources = {'manifestPath': str(dataset.resolve()), **immutable_tests}
    if report.get('immutableTestSources') != expected_sources:
        raise RuntimeError('Benchmark immutable-test sources do not match the verified snapshot')
    resource_gate = require_object(report.get('resourceGate'), 'Benchmark resource gate')
    if resource_gate.get('safeAtLaunch') is not True or resource_gate.get('overrideUsed') is not False:
        raise RuntimeError('Benchmark resource gate was not safely satisfied')
    independence = require_object(report.get('dataIndependence'), 'Benchmark data-independence evidence')
    if independence.get('qualityVerified') is not True or independence.get('exactNormalizedOverlapCount') != 0:
        raise RuntimeError('Benchmark data-independence evidence is incomplete')
    domains = require_object(report.get('domains'), 'Benchmark domains')
    if set(domains) != set(DOMAINS):
        raise RuntimeError('Benchmark report must contain exactly three domains')
    expected_model_ids = {purpose: 'qwen35-08b-candidate' for purpose in DOMAINS}
    for purpose in DOMAINS:
        domain = require_object(domains[purpose], f'{purpose} benchmark domain')
        expected_base = (REPO_ROOT / BASES[purpose]['path']).resolve()
        if domain.get('modelId') != expected_model_ids[purpose]:
            raise RuntimeError(f'{purpose}: benchmark model topology mismatch')
        require_bound_path(domain.get('baseModel'), expected_base, f'{purpose} benchmark base model')
        require_bound_path(domain.get('adapterPath'), candidates[purpose], f'{purpose} benchmark adapter')
    return {
        'verified': True,
        'runManifestSha256': sha256_file(manifest_path),
        'benchmarkReportSha256': sha256_file(report_path),
        'rawGenerationsSha256': sha256_file(raw_path),
        'benchmarkCasesSha256': sha256_file(cases_path),
    }


def confidence_gate(report: dict[str, Any]) -> dict[str, Any]:
    domains = report.get('domains')
    if not isinstance(domains, dict) or set(domains) != set(DOMAINS):
        raise RuntimeError('Benchmark report must contain exactly three domains')
    results: dict[str, Any] = {}
    any_evidence_shortfall = False
    for purpose in DOMAINS:
        domain = require_object(domains[purpose], f'{purpose} benchmark domain')
        adapter = require_object(domain.get('adapter'), f'{purpose} adapter')
        metrics = require_object(adapter.get('metrics'), f'{purpose} metrics')
        comparison = require_object(domain.get('comparison'), f'{purpose} comparison')
        delta_ci = comparison.get('clusteredBootstrapCI95', [None, None])
        evidence = is_count_at_least(metrics.get('semanticGroupCount'), 100) and is_count_at_least(
            metrics.get('criticalIndependentGroupCount'), 30
        )
        any_evidence_shortfall = any_evidence_shortfall or not evidence
        checks = {
            'productionGate': require_object(metrics.get('productionGate'), f'{purpose} production gate').get('passed') is True,
            'compositeLowerBound95': is_finite_number(metrics.get('compositeAccuracyLowerBound95'))
            and 0.90 <= metrics['compositeAccuracyLowerBound95'] <= 1.0,
            'criticalLowerBound95': is_finite_number(metrics.get('criticalCorrectLowerBound95'))
            and 0.98 <= metrics['criticalCorrectLowerBound95'] <= 1.0,
            'nonRegressionLowerBound95': isinstance(delta_ci, list)
            and len(delta_ci) == 2
            and is_finite_number(delta_ci[0])
            and is_finite_number(delta_ci[1])
            and -1.0 <= delta_ci[0] <= delta_ci[1] <= 1.0
            and delta_ci[0] >= 0,
            'zeroCatastrophicFailures': type(metrics.get('catastrophicFailures')) is int
            and metrics['catastrophicFailures'] == 0,
            'minimumIndependentGroups': evidence,
        }
        results[purpose] = {'passed': all(checks.values()), 'checks': checks}
    passed = all(value['passed'] for value in results.values())
    status = 'candidate-gate-pass' if passed else 'insufficient-evidence' if any_evidence_shortfall else 'candidate-gate-fail'
    return {
        'passed': passed,
        'status': status,
        'promotionAllowed': False,
        'domains': results,
        'evidencePolicy': {
            'semanticGroupsMinimum': 100,
            'criticalIndependentGroupsMinimum': 30,
            'currentSyntheticGroupsPerDomain': 12,
            'note': 'The current 12-group synthetic test is intentionally insufficient for production promotion; expand independent human-reviewed evidence.',
        },
    }

def require_exact_path(path: Path, expected: Path, label: str) -> Path:
    resolved = path.resolve()
    if resolved != expected.resolve():
        raise RuntimeError(f'{label} is not the fixed Security v0.5 evidence path')
    return resolved


def security_v05_heldout_snapshot(manifest_path: Path) -> dict[str, Any]:
    require_exact_path(manifest_path, SECURITY_V05_HELDOUT_MANIFEST, 'Security held-out manifest')
    if sha256_file(manifest_path) != SECURITY_V05_HELDOUT_MANIFEST_SHA256:
        raise RuntimeError('Security v0.5 held-out manifest SHA-256 mismatch')
    manifest = read_json(manifest_path, 'Security held-out manifest')
    domain = require_object(require_object(manifest.get('domains'), 'Security held-out domains').get('security'), 'Security held-out domain')
    test = require_object(require_object(domain.get('splits'), 'Security held-out splits').get('test'), 'Security held-out test split')
    test_path = (manifest_path.parent / str(test.get('path', ''))).resolve()
    if (
        manifest.get('schemaVersion') != 'tomny.dataset-manifest.v2'
        or manifest.get('datasetId') != 'tomny-security-pilot-heldout'
        or manifest.get('datasetVersion') != '2026-08-21.v1'
        or domain.get('purpose') != SECURITY_V05_PURPOSE
        or domain.get('trainerReadableSplits') != []
        or test.get('immutable') is not True
        or test.get('trainerReadable') is not False
        or test.get('rows') != 120
        or test.get('semanticGroups') != 30
        or not test_path.is_file()
        or sha256_file(test_path) != test.get('sha256')
        or require_object(manifest.get('quality'), 'Security held-out quality').get('passed') is not True
    ):
        raise RuntimeError('Security v0.5 held-out evidence is incomplete or changed')
    return {
        'manifestPath': str(manifest_path.resolve()),
        'manifestSha256': SECURITY_V05_HELDOUT_MANIFEST_SHA256,
        'testPath': str(test_path),
        'testSha256': test['sha256'],
        'rows': 120,
        'semanticGroups': 30,
        'candidateOnly': True,
        'promotionAllowed': False,
    }


def security_v05_candidate_evidence(candidate_root: Path) -> dict[str, Any]:
    expected_root = (REPO_ROOT / '.model-adapters' / 'candidates').resolve()
    require_exact_path(candidate_root, expected_root, 'Security candidate root')
    candidate = (expected_root / SECURITY_V05_CANDIDATE_ID / SECURITY_V05_CANDIDATE_VERSION).resolve()
    manifest_path = candidate / 'training_manifest.json'
    report_path = candidate / 'verification-report.json'
    manifest = read_json(manifest_path, 'Security training manifest')
    verification = read_json(report_path, 'Security verification report')
    finalization = require_object(manifest.get('finalization'), 'Security finalization')
    checkpoint_value = finalization.get('sourceCheckpoint')
    if not isinstance(checkpoint_value, str):
        raise RuntimeError('Security finalization has no trainer-selected checkpoint')
    checkpoint = Path(checkpoint_value).resolve()
    if candidate not in checkpoint.parents or not re.fullmatch(r'checkpoint-[1-9][0-9]*', checkpoint.name):
        raise RuntimeError('Security finalization checkpoint is outside the finalized candidate')
    checkpoint_state = read_json(checkpoint / 'trainer_state.json', 'Security final checkpoint state')
    expected_base = {key: BASES['security'][key] for key in ('modelId', 'revision', 'contentSha256')}
    required_files = ('adapter_model.safetensors', 'adapter_config.json')
    if (
        manifest.get('schemaVersion') != PROVENANCE_SCHEMA
        or manifest.get('completed') is not True
        or manifest.get('status') != 'candidate'
        or manifest.get('purpose') != SECURITY_V05_PURPOSE
        or manifest.get('precision') != 'bf16'
        or manifest.get('candidate') != {'id': SECURITY_V05_CANDIDATE_ID, 'version': SECURITY_V05_CANDIDATE_VERSION, 'path': str(candidate)}
        or manifest.get('baseModel', {}).get('modelId') != expected_base['modelId']
        or manifest.get('baseModel', {}).get('revision') != expected_base['revision']
        or manifest.get('baseModel', {}).get('contentSha256') != expected_base['contentSha256']
        or manifest.get('recipe', {}).get('sha256') != SECURITY_V05_RECIPE_SHA256
        or finalization.get('mode') != 'checkpoint-eval-only'
        or finalization.get('unsafeStateLoaded') is not False
        or finalization.get('optimizerStepsExecuted') != 0
        or finalization.get('sourceStep') != checkpoint_state.get('global_step')
        or checkpoint_state.get('best_model_checkpoint') != str(checkpoint)
        or verification.get('schemaVersion') != 'tomny.adapter-verification-report.v1'
        or verification.get('verified') is not True
        or verification.get('adapterCount') != 1
        or not isinstance(verification.get('adapters'), list)
        or len(verification['adapters']) != 1
    ):
        raise RuntimeError('Security v0.5 finalized candidate provenance mismatch')
    adapter = verification['adapters'][0]
    if not isinstance(adapter, dict) or adapter.get('path') != str(candidate) or adapter.get('purpose') != SECURITY_V05_PURPOSE:
        raise RuntimeError('Security verification report targets a different adapter')
    hashes: dict[str, str] = {}
    for filename in required_files:
        candidate_file = candidate / filename
        checkpoint_file = checkpoint / filename
        if not candidate_file.is_file() or not checkpoint_file.is_file() or sha256_file(candidate_file) != sha256_file(checkpoint_file):
            raise RuntimeError('Security trainer-selected checkpoint does not match finalized adapter artifacts')
        hashes[filename] = sha256_file(candidate_file)
    if (
        finalization.get('sourceAdapterSha256') != hashes['adapter_model.safetensors']
        or finalization.get('trainerStateSha256') != sha256_file(checkpoint / 'trainer_state.json')
        or adapter.get('manifestSha256') != sha256_file(manifest_path)
        or adapter.get('weightSha256') != hashes['adapter_model.safetensors']
        or adapter.get('adapterConfigSha256') != hashes['adapter_config.json']
    ):
        raise RuntimeError('Security final checkpoint hashes do not match the verification report')
    return {
        'candidate': str(candidate),
        'manifest': str(manifest_path),
        'manifestSha256': sha256_file(manifest_path),
        'verificationReport': str(report_path),
        'verificationReportSha256': sha256_file(report_path),
        'checkpoint': str(checkpoint),
        'checkpointWeightSha256': hashes['adapter_model.safetensors'],
        'checkpointConfigSha256': hashes['adapter_config.json'],
        'trainerStateSha256': sha256_file(checkpoint / 'trainer_state.json'),
        'candidateOnly': True,
        'promotionAllowed': False,
    }


def validate_security_v05_queue(latest_path: Path, candidate: Path) -> dict[str, Any]:
    require_exact_path(latest_path, SECURITY_V05_QUEUE_LATEST, 'Security queue pointer')
    latest = read_json(latest_path, 'Security latest queue pointer')
    run_id = safe_component(str(latest.get('runId', '')), 'Security queue run id')
    status_path = (latest_path.parent / run_id / 'status.json').resolve()
    if Path(str(latest.get('statusPath', ''))).resolve() != status_path:
        raise RuntimeError('Security latest queue status is not bound to its run id')
    status = read_json(status_path, 'Security queue status')
    adapters = status.get('adapters')
    if (
        latest.get('state') != 'completed-candidates'
        or status.get('state') != 'completed-candidates'
        or status.get('runId') != run_id
        or status.get('candidateVersion') != SECURITY_V05_CANDIDATE_VERSION
        or status.get('promotionAllowed') is not False
        or not isinstance(adapters, list)
        or len(adapters) != 1
        or not isinstance(adapters[0], dict)
    ):
        raise RuntimeError('Security queue is not one completed candidate; benchmark fails closed')
    adapter = adapters[0]
    if (
        adapter.get('purpose') != SECURITY_V05_PURPOSE
        or adapter.get('candidateId') != SECURITY_V05_CANDIDATE_ID
        or adapter.get('recipeSha256') != SECURITY_V05_RECIPE_SHA256
        or adapter.get('baseModel') != {key: BASES['security'][key] for key in ('modelId', 'revision', 'contentSha256')}
        or adapter.get('candidate') != str(candidate)
        or adapter.get('state') != 'completed-candidate'
    ):
        raise RuntimeError('Security queue adapter identity or completion evidence mismatch')
    return {'runId': run_id, 'statusPath': str(status_path), 'candidateOnly': True, 'promotionAllowed': False}


def security_v05_benchmark_command(output: Path, evidence: dict[str, Any]) -> list[str]:
    benchmark = Path(__file__).with_name('benchmark_adapters.py')
    return [
        sys.executable, str(benchmark), '--output', str(output), '--domains', SECURITY_V05_PURPOSE,
        '--checkpoint-domain', SECURITY_V05_PURPOSE, '--checkpoint-adapter', evidence['checkpoint'],
        '--checkpoint-verification-report', evidence['verificationReport'], '--base-model-08b',
        str((REPO_ROOT / BASES['security']['path']).resolve()), '--immutable-test-manifest',
        str(SECURITY_V05_HELDOUT_MANIFEST),
    ]


def run_security_v05_single_domain_benchmark(args: argparse.Namespace) -> None:
    if args.candidate_version not in {'0.1.0-candidate.1', SECURITY_V05_CANDIDATE_VERSION}:
        raise ValueError('Security v0.5 benchmark does not accept a different candidate version')
    run_id = safe_component(args.run_id or datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8], 'Security benchmark run id')
    output = (SECURITY_V05_OUTPUT_ROOT / SECURITY_V05_CANDIDATE_VERSION / run_id).resolve()
    if output.exists():
        raise FileExistsError(f'Immutable Security benchmark output already exists: {output}')
    candidate = security_v05_candidate_evidence((REPO_ROOT / '.model-adapters' / 'candidates').resolve())
    queue = validate_security_v05_queue(SECURITY_V05_QUEUE_LATEST, Path(candidate['candidate']))
    heldout = security_v05_heldout_snapshot(SECURITY_V05_HELDOUT_MANIFEST)
    command = security_v05_benchmark_command(output, candidate)
    plan = {
        'queue': queue, 'candidate': candidate, 'heldout': heldout, 'command': command,
        'output': str(output), 'candidateOnly': True, 'promotionAllowed': False,
    }
    if args.dry_run:
        print(json.dumps({'dryRun': True, 'plan': plan}, ensure_ascii=False, indent=2))
        return
    result = subprocess.run(command, cwd=REPO_ROOT, check=False)
    if result.returncode != 0:
        raise RuntimeError(f'Security benchmark exited with code {result.returncode}')
    if security_v05_candidate_evidence((REPO_ROOT / '.model-adapters' / 'candidates').resolve()) != candidate:
        raise RuntimeError('Security candidate changed during benchmark')
    if security_v05_heldout_snapshot(SECURITY_V05_HELDOUT_MANIFEST) != heldout:
        raise RuntimeError('Security held-out evidence changed during benchmark')
    queue_after = validate_security_v05_queue(SECURITY_V05_QUEUE_LATEST, Path(candidate['candidate']))
    if queue_after != queue:
        raise RuntimeError('Security queue evidence changed during benchmark')
    report = read_json(output / 'benchmark-report.json', 'Security benchmark report')
    run_manifest = read_json(output / 'run-manifest.json', 'Security benchmark run manifest')
    if (
        report.get('candidateOnly') is not True
        or report.get('promotionAllowed') is not False
        or set(require_object(report.get('domains'), 'Security benchmark domains')) != {SECURITY_V05_PURPOSE}
        or report['domains']['security'].get('adapterPath') != candidate['checkpoint']
        or report['domains']['security'].get('baseModel') != str((REPO_ROOT / BASES['security']['path']).resolve())
        or run_manifest.get('candidateOnly') is not True
        or run_manifest.get('promotionAllowed') is not False
        or require_object(run_manifest.get('verificationEvidence'), 'Security benchmark verification evidence').get('reportSha256') != candidate['verificationReportSha256']
    ):
        raise RuntimeError('Security benchmark output is not immutable candidate-only evidence')
    receipt = {
        'schemaVersion': 'tomny.security-v05-post-training-benchmark.v1', 'runId': run_id,
        'candidateOnly': True, 'promotionAllowed': False, 'queue': queue, 'candidate': candidate,
        'heldout': heldout, 'benchmarkReportSha256': sha256_file(output / 'benchmark-report.json'),
        'runManifestSha256': sha256_file(output / 'run-manifest.json'),
    }
    receipt_path = output / 'security-v05-post-training-receipt.json'
    write_new_text_atomic(receipt_path, json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'completed': True, 'candidateOnly': True, 'promotionAllowed': False, 'receipt': str(receipt_path)}, ensure_ascii=False, indent=2))


def main() -> None:
    args = parse_args()
    if args.security_v05_single_domain:
        if args.gate_fixture:
            raise ValueError('--security-v05-single-domain cannot use --gate-fixture')
        run_security_v05_single_domain_benchmark(args)
        return
    if args.gate_fixture and not args.dry_run:
        raise ValueError("--gate-fixture is restricted to --dry-run")
    if args.gate_fixture:
        print(json.dumps({"dryRun": True, "candidateOnly": True, "confidenceGate": confidence_gate(read_json(Path(args.gate_fixture), "gate fixture"))}, ensure_ascii=False, indent=2))
        return
    version = safe_component(args.candidate_version, "candidate version")
    run_id = safe_component(args.run_id or datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8], "benchmark run id")
    candidate_root = resolve_scoped(args.candidate_root, REPO_ROOT / ".model-adapters" / "candidates", "candidate root")
    latest = resolve_scoped(args.queue_latest, candidate_root / "_queue", "queue latest")
    dataset = resolve_scoped(args.dataset_manifest, REPO_ROOT / ".training-data-v2", "dataset manifest")
    output_root = resolve_scoped(args.output_root, REPO_ROOT / ".model-benchmarks" / "candidates", "output root")
    output = (output_root / version / run_id).resolve()
    if output.exists():
        raise FileExistsError(f"Immutable benchmark output already exists: {output}")
    paths = expected_paths(candidate_root, version)
    queue = validate_queue(latest, version, paths)
    verification = verify_candidates(paths, version)
    tests_before = immutable_snapshot(dataset)
    base_hashes: dict[str, str] = {}
    base_path = (REPO_ROOT / BASE_BINDING["path"]).resolve()
    actual = sha256_tree(base_path)
    if actual != BASE_BINDING["contentSha256"]:
        raise RuntimeError("qwen35-08b: base tree hash mismatch")
    base_hashes["qwen35-08b"] = actual
    benchmark = Path(__file__).with_name("benchmark_adapters.py")
    command = [sys.executable, str(benchmark), "--output", str(output), "--candidate-root", str(candidate_root), "--candidate-version", version, "--base-model-08b", str(base_path), "--immutable-test-manifest", str(dataset)]
    plan = {"queueRunId": queue["latest"]["runId"], "candidateVersion": version, "candidates": {key: str(value) for key, value in paths.items()}, "verification": verification, "baseTreeHashes": base_hashes, "immutableTests": tests_before, "command": command, "output": str(output), "candidateOnly": True, "promotionAllowed": False}
    if args.dry_run:
        print(json.dumps({"dryRun": True, "plan": plan}, ensure_ascii=False, indent=2))
        return
    result = subprocess.run(command, cwd=REPO_ROOT, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Benchmark exited with code {result.returncode}")
    if immutable_snapshot(dataset) != tests_before:
        raise RuntimeError("Immutable test snapshot changed during benchmark")
    verify_benchmark_inputs_unchanged(paths, version, verification, base_hashes)
    benchmark_report = read_json(output / 'benchmark-report.json', 'benchmark report')
    evidence_contract = validate_benchmark_evidence(output, benchmark_report, dataset, tests_before, paths)
    report = {
        'schemaVersion': 'tomny.post-training-candidate-report.v1',
        'runId': run_id,
        'createdAt': datetime.now(UTC).isoformat(),
        'candidateVersion': version,
        'status': 'candidate-only',
        'promotionAllowed': False,
        'promotionDecision': 'not-performed',
        'queueRunId': queue['latest']['runId'],
        'verification': verification,
        'baseTreeHashes': base_hashes,
        'immutableTests': tests_before,
        'evidenceContract': evidence_contract,
        'confidenceGate': confidence_gate(benchmark_report),
        'benchmark': benchmark_report,
    }

    report_path = output / "post-training-candidate-report.json"
    write_new_text_atomic(report_path, json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({"completed": True, "candidateOnly": True, "promotionAllowed": False, "report": str(report_path)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, TypeError, KeyError, subprocess.TimeoutExpired):
        print('candidate-evidence-verification-failed', file=sys.stderr)
        raise SystemExit(2)
