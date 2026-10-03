from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any
import uuid

import torch
from safetensors import safe_open

DEFAULT_ADAPTERS = [
    ".model-adapters/candidates/com.tomny.core.security/0.6.0-candidate.1",
    ".model-adapters/candidates/com.tomny.core.user-understanding/0.6.0-candidate.1",
    ".model-adapters/candidates/com.tomny.core.semantic-analysis/0.6.0-candidate.1",

]
PROVENANCE_SCHEMA = "tomny.training-provenance.v2"
PREFLIGHT_SCHEMA = "tomny.training-preflight.v1"
VERIFICATION_REPORT_SCHEMA = "tomny.adapter-verification-report.v1"
ALLOWED_TARGET_PROFILES = frozenset(
    {
        "last-block",
        "last-three-full-attention",
        "full-attention",
        "small-gpu",
        "all-linear",
        "topology-aware-last-four",
        "shield-full-24",
    }
)
TARGET_PROFILE_SPECS = {
    "shield-full-24": {
        "layers": tuple(range(24)),
        "targetModules": frozenset(
            {
                "q_proj",
                "k_proj",
                "v_proj",
                "o_proj",
                "gate_proj",
                "up_proj",
                "down_proj",
            }
        ),
        "rank": 64,
        "alpha": 128,
        "useRslora": True,
        "dropout": 0.05,
        "bias": "none",
        "modulesToSave": None,
        "tensorCount": 192,
        "elementCount": 25_559_040,
    }
}
PROVENANCE_REQUIRED_FIELDS = frozenset(
    {
        "schemaVersion",
        "completed",
        "status",
        "candidate",
        "baseModel",
        "modelClass",
        "textOnly",
        "purpose",
        "recipe",
        "preflightReceipt",
        "steps",
        "maxLength",
        "rank",
        "loraAlpha",
        "targetProfile",
        "targetModules",
        "qualityLimitations",
        "trainableParams",
        "totalParams",
        "trainRows",
        "validationRows",
        "fullValidation",
        "smokeOnly",
        "metrics",
        "curves",
        "tokenStats",
        "data",
        "syntheticDataOnly",
        "artifacts",
        "provenance",
        "memory",
        "createdAt",
        "elapsedSeconds",
    }
)
PROVENANCE_OPTIONAL_FIELDS = frozenset(
    {"validationGate", "finalization", "precision"}
)
PROVENANCE_ALLOWED_FIELDS = PROVENANCE_REQUIRED_FIELDS | PROVENANCE_OPTIONAL_FIELDS
PROVENANCE_OBJECT_FIELDS = {
    "candidate": frozenset({"id", "version", "path"}),
    "baseModel": frozenset({"modelId", "revision", "contentSha256", "path"}),
    "recipe": frozenset({"path", "sha256", "content"}),
    "preflightReceipt": frozenset({"path", "sha256"}),
    "data": frozenset(
        {
            "manifestPath",
            "manifestSha256",
            "datasetId",
            "datasetVersion",
            "reviewerStatus",
            "outputSchema",
            "train",
            "validation",
            "testAccessed",
        }
    ),
    "artifacts": frozenset({"adapter_model.safetensors", "adapter_config.json"}),
}

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_new_text_atomic(path: Path, content: str) -> None:
    """Create an immutable verification report without replacing prior evidence."""
    if str(path).casefold() == os.devnull.casefold():
        return
    if path.exists():
        raise RuntimeError("Verification evidence output already exists")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except FileExistsError:
        raise RuntimeError("Verification evidence output already exists") from None
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def sha256_tree(root: Path) -> str:
    if not root.is_dir():
        raise FileNotFoundError(f"Base model directory no longer exists: {root}")
    digest = hashlib.sha256()
    files = sorted((path for path in root.rglob("*") if path.is_file()), key=lambda path: tuple(part.lower() for part in path.relative_to(root).parts))
    if not files:
        raise ValueError(f"Base model directory is empty: {root}")
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def assert_finite_json(value: Any, label: str = "manifest") -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise FloatingPointError(f"{label} contains non-finite value")
    if isinstance(value, dict):
        for key, child in value.items():
            assert_finite_json(child, f"{label}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_finite_json(child, f"{label}[{index}]")


def require_finite_number(value: Any, label: str) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise FloatingPointError(f"{label} must be a finite number")
    return float(value)


VALIDATION_GATE_MIGRATION_SCHEMA = "tomny.validation-gate-migration.v1"
VALIDATION_GATE_MIGRATION_FILE = "validation-gate-migration.json"
FINAL_EVAL_REL_TOLERANCE = 1e-4
FINAL_EVAL_ABS_TOLERANCE = 5e-5


def validation_tolerance(best_metric: float) -> float:
    return max(FINAL_EVAL_ABS_TOLERANCE, abs(best_metric) * FINAL_EVAL_REL_TOLERANCE)


def resolve_validation_gate(
    path: Path,
    manifest: dict[str, Any],
    best_eval_loss: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    gate = manifest.get("validationGate")
    if gate is not None:
        if not isinstance(gate, dict):
            raise ValueError(f"{path}: validationGate must be an object")
        return gate, {"kind": "manifest"}

    migration_path = path / VALIDATION_GATE_MIGRATION_FILE
    if not migration_path.is_file():
        raise ValueError(
            f"{path}: validationGate is missing and no audited migration sidecar exists"
        )
    migration = json.loads(migration_path.read_text(encoding="utf-8"))
    if not isinstance(migration, dict):
        raise ValueError(f"{path}: validation-gate migration must be a JSON object")
    assert_finite_json(migration, "validationGateMigration")
    if migration.get("schemaVersion") != VALIDATION_GATE_MIGRATION_SCHEMA:
        raise ValueError(f"{path}: validation-gate migration schema mismatch")
    if (
        not isinstance(migration.get("migrationId"), str)
        or not migration["migrationId"].strip()
    ):
        raise ValueError(f"{path}: validation-gate migration id is missing")
    if (
        not isinstance(migration.get("createdAt"), str)
        or not migration["createdAt"].strip()
    ):
        raise ValueError(f"{path}: validation-gate migration timestamp is missing")
    if migration.get("reason") != "legacy-manifest-predates-validation-gate":
        raise ValueError(f"{path}: validation-gate migration reason is unsupported")

    candidate = manifest.get("candidate", {})
    expected_candidate = {
        "id": candidate.get("id"),
        "version": candidate.get("version"),
        "purpose": manifest.get("purpose"),
    }
    if migration.get("candidate") != expected_candidate:
        raise ValueError(
            f"{path}: validation-gate migration candidate binding mismatch"
        )

    manifest_path = path / "training_manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"{path}: source training manifest is missing")
    manifest_on_disk = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest_on_disk != manifest:
        raise ValueError(
            f"{path}: source manifest content differs from verification input"
        )
    source = migration.get("source")
    if (
        not isinstance(source, dict)
        or source.get("manifestFile") != "training_manifest.json"
    ):
        raise ValueError(
            f"{path}: validation-gate migration source manifest binding is missing"
        )
    source_manifest_sha = sha256_file(manifest_path)
    if source.get("manifestSha256") != source_manifest_sha:
        raise ValueError(
            f"{path}: validation-gate migration source manifest hash mismatch"
        )
    if source.get("manifestSchemaVersion") != manifest.get("schemaVersion"):
        raise ValueError(f"{path}: validation-gate migration source schema mismatch")
    if source.get("manifestCreatedAt") != manifest.get("createdAt"):
        raise ValueError(f"{path}: validation-gate migration source timestamp mismatch")

    prior = migration.get("priorVerification")
    if (
        not isinstance(prior, dict)
        or prior.get("reportFile") != "verification-report.json"
    ):
        raise ValueError(
            f"{path}: validation-gate migration prior verification binding is missing"
        )
    prior_path = path / "verification-report.json"
    if not prior_path.is_file() or prior.get("reportSha256") != sha256_file(prior_path):
        raise ValueError(
            f"{path}: validation-gate migration prior verification hash mismatch"
        )
    prior_report = json.loads(prior_path.read_text(encoding="utf-8"))
    prior_adapters = (
        prior_report.get("adapters") if isinstance(prior_report, dict) else None
    )
    if (
        prior_report.get("verified") is not True
        or prior_report.get("adapterCount") != 1
        or not isinstance(prior_adapters, list)
        or len(prior_adapters) != 1
        or Path(str(prior_adapters[0].get("path", ""))).resolve() != path.resolve()
        or prior_adapters[0].get("purpose") != manifest.get("purpose")
        or prior_adapters[0].get("schemaVersion") != manifest.get("schemaVersion")
    ):
        raise ValueError(
            f"{path}: validation-gate migration prior verification is not bound to this candidate"
        )

    expected_derivation = {
        "method": "derive-from-immutable-manifest-v1",
        "configuredRegressionSource": "recipe.content.training.maxValidationRegression",
        "numericTolerancePolicy": "max(5e-5, abs(bestEvalLoss) * 1e-4)",
    }
    if migration.get("derivation") != expected_derivation:
        raise ValueError(
            f"{path}: validation-gate migration derivation policy mismatch"
        )
    migrated_gate = migration.get("validationGate")
    if not isinstance(migrated_gate, dict):
        raise ValueError(f"{path}: migrated validationGate is missing")
    expected_regression = require_finite_number(
        manifest.get("recipe", {})
        .get("content", {})
        .get("training", {})
        .get("maxValidationRegression"),
        f"{path}: recipe.content.training.maxValidationRegression",
    )
    migrated_regression = require_finite_number(
        migrated_gate.get("configuredRegression"),
        f"{path}: migrated validationGate.configuredRegression",
    )
    migrated_tolerance = require_finite_number(
        migrated_gate.get("numericTolerance"),
        f"{path}: migrated validationGate.numericTolerance",
    )
    if not math.isclose(
        migrated_regression, expected_regression, rel_tol=0.0, abs_tol=1e-12
    ):
        raise ValueError(
            f"{path}: migrated validationGate regression is not recipe-bound"
        )
    if not math.isclose(
        migrated_tolerance,
        validation_tolerance(best_eval_loss),
        rel_tol=0.0,
        abs_tol=1e-12,
    ):
        raise ValueError(f"{path}: migrated validationGate tolerance policy mismatch")
    return migrated_gate, {
        "kind": "migration-sidecar",
        "path": str(migration_path.resolve()),
        "sha256": sha256_file(migration_path),
        "migrationId": migration["migrationId"],
        "createdAt": migration["createdAt"],
        "sourceManifestSha256": source_manifest_sha,
        "priorVerificationSha256": prior["reportSha256"],
    }


def verify_validation_evidence(path: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    metrics = manifest.get("metrics")
    if not isinstance(metrics, dict):
        raise ValueError(f"{path}: validation metrics are missing")
    validation = metrics.get("validation")
    if not isinstance(validation, dict):
        raise ValueError(f"{path}: validation metrics are missing")

    eval_loss = require_finite_number(
        validation.get("eval_loss"), f"{path}: metrics.validation.eval_loss"
    )
    best_eval_raw = metrics.get("bestEvalLoss")
    if best_eval_raw is None:
        gate = manifest.get("validationGate")
        expected_gate = {
            "enabled": False,
            "policy": "observational-only; final epoch state is retained",
        }
        if gate != expected_gate:
            raise ValueError(
                f"{path}: disabled validation gate must be explicitly recorded"
            )
        return {
            "evalLoss": eval_loss,
            "bestEvalLoss": None,
            "observedDelta": None,
            "allowedMaximum": None,
            "policy": expected_gate["policy"],
            "evidenceSource": {"kind": "disabled"},
        }
    best_eval_loss = require_finite_number(
        best_eval_raw, f"{path}: metrics.bestEvalLoss"
    )
    gate, evidence_source = resolve_validation_gate(path, manifest, best_eval_loss)
    if not isinstance(gate, dict):
        raise ValueError(f"{path}: validationGate is missing")
    configured_regression = require_finite_number(
        gate.get("configuredRegression"), f"{path}: validationGate.configuredRegression"
    )
    numeric_tolerance = require_finite_number(
        gate.get("numericTolerance"), f"{path}: validationGate.numericTolerance"
    )
    observed_delta = require_finite_number(
        gate.get("observedDelta"), f"{path}: validationGate.observedDelta"
    )
    allowed_maximum = require_finite_number(
        gate.get("allowedMaximum"), f"{path}: validationGate.allowedMaximum"
    )
    if configured_regression < 0 or numeric_tolerance < 0:
        raise ValueError(f"{path}: validationGate tolerances must be non-negative")
    if gate.get("policy") != "absolute-or-relative-floating-point-tolerance":
        raise ValueError(f"{path}: validationGate policy is missing or unsupported")

    expected_delta = eval_loss - best_eval_loss
    expected_maximum = best_eval_loss + configured_regression + numeric_tolerance
    if not math.isclose(observed_delta, expected_delta, rel_tol=0.0, abs_tol=1e-12):
        raise ValueError(
            f"{path}: validationGate observed delta does not match validation metrics"
        )
    if not math.isclose(allowed_maximum, expected_maximum, rel_tol=0.0, abs_tol=1e-12):
        raise ValueError(
            f"{path}: validationGate allowed maximum does not match validation metrics"
        )
    if eval_loss > allowed_maximum:
        raise ValueError(f"{path}: final validation loss exceeds the allowed maximum")
    return {
        "evalLoss": eval_loss,
        "bestEvalLoss": best_eval_loss,
        "observedDelta": observed_delta,
        "allowedMaximum": allowed_maximum,
        "policy": gate["policy"],
        "evidenceSource": evidence_source,
    }


def verify_safe_finalization(
    path: Path,
    manifest: dict[str, Any],
    recipe_content: dict[str, Any],
    validation: dict[str, Any],
) -> dict[str, Any]:
    train_metrics = manifest.get("metrics", {}).get("train", {})
    finalization = manifest.get("finalization")
    safe_finalization = (
        isinstance(train_metrics, dict)
        and train_metrics.get("safeFinalization") is True
    )
    if not safe_finalization and finalization is None:
        return {}
    if not safe_finalization or not isinstance(finalization, dict):
        raise ValueError(
            f"{path}: safe-finalization metrics and evidence must be present together"
        )
    if finalization.get("mode") != "checkpoint-eval-only":
        raise ValueError(f"{path}: unsupported safe-finalization mode")
    if finalization.get("unsafeStateLoaded") is not False:
        raise ValueError(
            f"{path}: safe finalization must prove unsafeStateLoaded=false"
        )
    optimizer_steps = finalization.get("optimizerStepsExecuted")
    if (
        isinstance(optimizer_steps, bool)
        or not isinstance(optimizer_steps, int)
        or optimizer_steps != 0
    ):
        raise ValueError(f"{path}: safe finalization must execute zero optimizer steps")

    source_step = finalization.get("sourceStep")
    manifest_steps = manifest.get("steps")
    recipe_steps = recipe_content.get("training", {}).get("maxSteps")
    if (
        isinstance(source_step, bool)
        or not isinstance(source_step, int)
        or source_step <= 0
    ):
        raise ValueError(
            f"{path}: safe-finalization sourceStep must be a positive integer"
        )
    if (
        isinstance(manifest_steps, bool)
        or not isinstance(manifest_steps, int)
        or isinstance(recipe_steps, bool)
        or not isinstance(recipe_steps, int)
        or source_step != manifest_steps
        or source_step != recipe_steps
    ):
        raise ValueError(
            f"{path}: safe-finalization source step is not bound to manifest and recipe"
        )
    source_checkpoint_value = finalization.get("sourceCheckpoint")
    if not isinstance(source_checkpoint_value, str):
        raise ValueError(f"{path}: safe-finalization source checkpoint is missing")
    source_checkpoint = Path(source_checkpoint_value).resolve()
    if (
        not source_checkpoint.is_dir()
        or source_checkpoint.parent != path.resolve()
        or source_checkpoint.name != f"checkpoint-{source_step}"
    ):
        raise ValueError(
            f"{path}: safe-finalization source checkpoint binding mismatch"
        )

    weights_path = source_checkpoint / "adapter_model.safetensors"
    state_path = source_checkpoint / "trainer_state.json"
    if not weights_path.is_file() or sha256_file(weights_path) != finalization.get(
        "sourceAdapterSha256"
    ):
        raise ValueError(f"{path}: safe-finalization source adapter hash mismatch")
    if not state_path.is_file() or sha256_file(state_path) != finalization.get(
        "trainerStateSha256"
    ):
        raise ValueError(f"{path}: safe-finalization trainer-state hash mismatch")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state_step = state.get("global_step")
    state_max_steps = state.get("max_steps")
    if (
        isinstance(state_step, bool)
        or not isinstance(state_step, int)
        or isinstance(state_max_steps, bool)
        or not isinstance(state_max_steps, int)
        or state_step != source_step
        or state_max_steps != recipe_steps
    ):
        raise ValueError(
            f"{path}: safe-finalization trainer state step binding mismatch"
        )
    state_best = require_finite_number(
        state.get("best_metric"), f"{path}: trainer_state.best_metric"
    )
    if not math.isclose(
        state_best, validation["bestEvalLoss"], rel_tol=0.0, abs_tol=1e-12
    ):
        raise ValueError(f"{path}: safe-finalization best metric binding mismatch")
    best_checkpoint = state.get("best_model_checkpoint")
    if (
        not isinstance(best_checkpoint, str)
        or Path(best_checkpoint).resolve() != source_checkpoint
    ):
        raise ValueError(f"{path}: safe-finalization best checkpoint binding mismatch")
    return {
        "mode": finalization["mode"],
        "sourceCheckpoint": str(source_checkpoint),
        "sourceStep": source_step,
        "sourceAdapterSha256": finalization["sourceAdapterSha256"],
        "trainerStateSha256": finalization["trainerStateSha256"],
        "bestEvalLoss": state_best,
        "unsafeStateLoaded": False,
        "optimizerStepsExecuted": 0,
    }


def verify_hash_entry(owner: Path, entry: dict[str, Any], label: str) -> dict[str, Any]:
    path_value = entry.get("path")
    expected_hash = entry.get("sha256")
    if not isinstance(path_value, str) or not isinstance(expected_hash, str):
        raise ValueError(f"{owner}: missing {label} provenance")
    source = Path(path_value)
    if not source.is_file():
        raise FileNotFoundError(f"{owner}: provenance file no longer exists: {source}")
    actual_hash = sha256_file(source)
    if actual_hash != expected_hash:
        raise ValueError(f"{owner}: {label} hash mismatch")
    return {
        "path": str(source.resolve()),
        "sha256": actual_hash,
        "bytes": source.stat().st_size,
    }


def verify_provenance_schema(path: Path, manifest: dict[str, Any]) -> None:
    if (
        not isinstance(manifest, dict)
        or manifest.get("schemaVersion") != PROVENANCE_SCHEMA
    ):
        raise ValueError(f"{path}: training provenance schema mismatch")
    unknown = sorted(set(manifest) - PROVENANCE_ALLOWED_FIELDS)
    if unknown:
        raise ValueError(f"{path}: unsupported training provenance fields: {unknown}")
    missing = sorted(PROVENANCE_REQUIRED_FIELDS - set(manifest))
    if missing:
        raise ValueError(f"{path}: missing training provenance fields: {missing}")
    target_profile = manifest.get("targetProfile")
    if target_profile not in ALLOWED_TARGET_PROFILES:
        raise ValueError(f"{path}: unsupported target profile")
    precision = manifest.get("precision")
    if precision is not None and precision not in {"fp16", "bf16"}:
        raise ValueError(f"{path}: unsupported training precision")
    for name, expected_fields in PROVENANCE_OBJECT_FIELDS.items():
        value = manifest.get(name)
        if not isinstance(value, dict) or set(value) != expected_fields:
            raise ValueError(f"{path}: {name} provenance fields mismatch")
    # Schema and shape are checked above.
    # Production-specific bindings are checked below.


def verify_target_profile_config(
    path: Path, manifest: dict[str, Any], adapter_config: dict[str, Any]
) -> dict[str, Any] | None:
    """Reject a known profile unless its saved PEFT configuration is exact."""
    profile = manifest.get("targetProfile")
    spec = TARGET_PROFILE_SPECS.get(profile)
    if spec is None:
        return None
    if set(manifest.get("targetModules", [])) != spec["targetModules"]:
        raise ValueError(f"{path}: target modules differ from {profile}")
    if manifest.get("rank") != spec["rank"]:
        raise ValueError(f"{path}: LoRA rank differs from {profile}")
    if manifest.get("loraAlpha") != spec["alpha"]:
        raise ValueError(f"{path}: LoRA alpha differs from {profile}")
    if manifest.get("trainableParams") != spec["elementCount"]:
        raise ValueError(f"{path}: trainable parameter count differs from {profile}")
    checks = {
        "layers_to_transform": list(spec["layers"]),
        "target_modules": spec["targetModules"],
        "r": spec["rank"],
        "lora_alpha": spec["alpha"],
        "use_rslora": spec["useRslora"],
        "bias": spec["bias"],
        "modules_to_save": spec["modulesToSave"],
    }
    for field, expected in checks.items():
        actual = adapter_config.get(field)
        if field == "target_modules":
            actual = set(actual) if isinstance(actual, list) else actual
        if actual != expected:
            raise ValueError(f"{path}: adapter config {field} differs from {profile}")
    dropout = adapter_config.get("lora_dropout")
    if not isinstance(dropout, (int, float)) or not math.isclose(
        float(dropout), spec["dropout"], rel_tol=0.0, abs_tol=1e-12
    ):
        raise ValueError(f"{path}: adapter config dropout differs from {profile}")
    return spec


def verify_preflight_resume_contract(
    path: Path,
    receipt: dict[str, Any],
    expected_contract: dict[str, Any],
) -> None:
    if receipt.get("schemaVersion") != PREFLIGHT_SCHEMA:
        raise ValueError(f"{path}: preflight receipt schema mismatch")
    actual_contract = receipt.get("resumeContract")
    if actual_contract == expected_contract:
        return
    if not isinstance(actual_contract, dict):
        raise ValueError(f"{path}: preflight resume contract mismatch")
    raise ValueError(f"{path}: preflight resume contract mismatch")


def verify_production_manifest(path: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    if manifest.get("status") != "candidate":
        raise ValueError(f"{path}: production trainer artifact must begin as candidate")
    candidate = manifest.get("candidate", {})
    if Path(candidate.get("path", "")).resolve() != path.resolve():
        raise ValueError(f"{path}: candidate path binding mismatch")
    if (
        manifest.get("testAccessed") is True
        or manifest.get("data", {}).get("testAccessed") is not False
    ):
        raise ValueError(
            f"{path}: immutable test split was accessed or access provenance is missing"
        )
    if (
        manifest.get("smokeOnly") is not True
        and manifest.get("fullValidation") is not True
    ):
        raise ValueError(f"{path}: production candidate did not use full validation")
    assert_finite_json(manifest.get("metrics"), "metrics")
    assert_finite_json(manifest.get("curves"), "curves")
    validation = verify_validation_evidence(path, manifest)
    token_stats = manifest.get("tokenStats", {})
    for split in ("train", "validation"):
        if token_stats.get(split, {}).get("targetTokens", 0) <= 0:
            raise ValueError(f"{path}: {split} has zero target tokens")

    artifacts = manifest.get("artifacts", {})
    for name in ("adapter_model.safetensors", "adapter_config.json"):
        source = path / name
        entry = artifacts.get(name, {})
        if (
            not source.is_file()
            or source.stat().st_size != entry.get("bytes")
            or sha256_file(source) != entry.get("sha256")
        ):
            raise ValueError(f"{path}: immutable artifact binding failed for {name}")
    recipe = verify_hash_entry(path, manifest.get("recipe", {}), "recipe")
    recipe_content = json.loads(Path(recipe["path"]).read_text(encoding="utf-8"))
    if manifest.get("recipe", {}).get("content") != recipe_content:
        raise ValueError(
            f"{path}: embedded recipe content does not match the immutable recipe"
        )
    recipe_target_profile = recipe_content.get("training", {}).get("targetProfile")
    if manifest.get("targetProfile") != recipe_target_profile:
        raise ValueError(f"{path}: target profile differs from immutable recipe")
    recipe_precision = recipe_content.get("training", {}).get("precision", "fp16")
    manifest_precision = manifest.get("precision", "fp16")
    if manifest_precision != recipe_precision:
        raise ValueError(f"{path}: training precision differs from immutable recipe")
    finalization = verify_safe_finalization(path, manifest, recipe_content, validation)
    dataset = verify_hash_entry(
        path,
        {
            "path": manifest.get("data", {}).get("manifestPath"),
            "sha256": manifest.get("data", {}).get("manifestSha256"),
        },
        "dataset manifest",
    )
    receipt = verify_hash_entry(
        path, manifest.get("preflightReceipt", {}), "preflight receipt"
    )
    receipt_content = json.loads(Path(receipt["path"]).read_text(encoding="utf-8"))
    expected_contract = {
        "purpose": manifest.get("purpose"),
        "candidateId": candidate.get("id"),
        "candidateVersion": candidate.get("version"),
        "recipeSha256": recipe["sha256"],
        "datasetManifestSha256": dataset["sha256"],
        "trainerImplementationSha256": sha256_file(
            Path(__file__).with_name("train_lora.py")
        ),
        "baseModel": {
            "modelId": manifest.get("baseModel", {}).get("modelId"),
            "revision": manifest.get("baseModel", {}).get("revision"),
            "contentSha256": manifest.get("baseModel", {}).get("contentSha256"),
        },
    }
    verify_preflight_resume_contract(path, receipt_content, expected_contract)
    base = manifest.get("baseModel", {})
    base_path = Path(base.get("path", ""))
    actual_base_hash = sha256_tree(base_path)
    if actual_base_hash != base.get("contentSha256"):
        raise ValueError(f"{path}: base-model content hash mismatch")
    return {
        "recipe": recipe,
        "datasetManifest": dataset,
        "preflightReceipt": receipt,
        "baseModelContentSha256": actual_base_hash,
        "validation": validation,
        "finalization": finalization,
    }


def verify_adapter(path: Path) -> dict[str, Any]:
    required = [
        "adapter_config.json",
        "adapter_model.safetensors",
        "training_manifest.json",
    ]
    missing = [name for name in required if not (path / name).is_file()]
    if missing:
        raise FileNotFoundError(f"{path}: missing required files: {missing}")
    manifest = json.loads((path / "training_manifest.json").read_text(encoding="utf-8"))
    if manifest.get("completed") is not True:
        raise ValueError(f"{path}: manifest is not marked completed")
    if manifest.get("textOnly") is not True:
        raise ValueError(f"{path}: adapter was not trained with the text-only loader")

    verify_provenance_schema(path, manifest)
    adapter_config = json.loads((path / "adapter_config.json").read_text(encoding="utf-8"))
    profile_spec = verify_target_profile_config(path, manifest, adapter_config)
    production = verify_production_manifest(path, manifest)

    weights_path = path / "adapter_model.safetensors"
    tensor_count = 0
    element_count = 0
    non_finite: list[str] = []
    with safe_open(weights_path, framework="pt", device="cpu") as handle:
        keys = list(handle.keys())
        if not keys:
            raise ValueError(f"{path}: adapter has no tensors")
        for key in keys:
            tensor = handle.get_tensor(key)
            tensor_count += 1
            element_count += tensor.numel()
            if not torch.isfinite(tensor).all():
                non_finite.append(key)
                if len(non_finite) >= 8:
                    break
    if non_finite:
        raise FloatingPointError(f"{path}: non-finite adapter tensors: {non_finite}")
    if profile_spec is not None and tensor_count != profile_spec["tensorCount"]:
        raise ValueError(f"{path}: LoRA tensor count differs from {manifest.get('targetProfile')}")
    if profile_spec is not None and element_count != profile_spec["elementCount"]:
        raise ValueError(f"{path}: LoRA element count differs from {manifest.get('targetProfile')}")

    verified_data: dict[str, Any] = {}
    for split in ("train", "validation"):
        entry = manifest.get("data", {}).get(split, {})
        verified_data[split] = verify_hash_entry(path, entry, f"{split} dataset")

    return {
        "path": str(path.resolve()),
        "schemaVersion": manifest.get("schemaVersion", "legacy"),
        "manifestSha256": sha256_file(path / "training_manifest.json"),
        "adapterConfigSha256": sha256_file(path / "adapter_config.json"),
        "purpose": manifest.get("purpose"),
        "baseModel": manifest.get("baseModel"),
        "steps": manifest.get("steps"),
        "rank": manifest.get("rank"),
        "targetProfile": manifest.get("targetProfile"),
        "trainableParams": manifest.get("trainableParams"),
        "trainLoss": manifest.get("metrics", {}).get("train", {}).get("train_loss"),
        "evalLoss": manifest.get("metrics", {}).get("validation", {}).get("eval_loss"),
        "weightFileBytes": weights_path.stat().st_size,
        "weightSha256": sha256_file(weights_path),
        "tensorCount": tensor_count,
        "elementCount": element_count,
        "allFinite": True,
        "data": verified_data,
        "productionProvenance": production,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify Tomny LoRA adapter artifacts and provenance."
    )
    parser.add_argument("adapters", nargs="*", default=DEFAULT_ADAPTERS)
    parser.add_argument("--output", default=".model-adapters/verification-report.json")
    args = parser.parse_args()
    reports = [verify_adapter(Path(value)) for value in args.adapters]
    result = {
        "schemaVersion": VERIFICATION_REPORT_SCHEMA,
        "verified": True,
        "adapterCount": len(reports),
        "adapters": reports,
    }
    write_new_text_atomic(
        Path(args.output), json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
