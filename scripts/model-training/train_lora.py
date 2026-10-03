from __future__ import annotations

import argparse
import gc
import hashlib
import importlib.metadata
import inspect
import json
import math
import os
import platform
import re
import subprocess
import shutil
import tempfile
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from packaging.version import Version
from typing import Any

import psutil
import torch
from accelerate.utils import GradScalerKwargs
from safetensors.torch import load_file
from datasets import DatasetDict, load_dataset
from peft import (
    LoraConfig,
    get_peft_model,
    prepare_model_for_kbit_training,
    set_peft_model_state_dict,
)
from transformers import (
    AutoTokenizer,
    BitsAndBytesConfig,
    DataCollatorForSeq2Seq,
    EarlyStoppingCallback,
    Qwen3_5Config,
    Qwen3_5ForCausalLM,
    Trainer,
    TrainerCallback,
    TrainerControl,
    TrainerState,
    TrainingArguments,
)
from transformers.trainer_utils import get_last_checkpoint
from data_quality import split_isolation_report
from warm_start_loader import load_standalone_adapter


PURPOSE_FILES = {
    "security": "security",
    "user-understanding": "user-understanding",
    "semantic-analysis": "semantic-analysis",

}

# Qwen3.5 mixes normal attention and gated linear-attention layers. This list
# covers both mixers while intentionally excluding the larger MLP projections in
# the 4 GB profile. Use --target-profile all-linear on a larger GPU.
SMALL_GPU_TARGETS = [
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "in_proj_qkv",
    "in_proj_z",
    "in_proj_a",
    "in_proj_b",
    "out_proj",
]


DATASET_SCHEMA = "tomny.dataset-manifest.v2"
RECIPE_SCHEMA = "tomny.qlora-recipe.v1"
SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


FINAL_EVAL_REL_TOLERANCE = 1e-4
FINAL_EVAL_ABS_TOLERANCE = 5e-5
MEMORY_PRESSURE_EXIT_CODE = 75
MEMORY_PRESSURE_RECEIPT_SCHEMA = "tomny.memory-pressure-pause.v1"
MIN_MEMORY_PRESSURE_FREE_MIB = 1536
MAX_PRIMARY_LABEL_TOTAL_VARIATION = 0.20
TRAINING_CACHE_CLEAR_STEPS = 10
EVALUATION_CACHE_CLEAR_INTERVAL = 32
AMP_INITIAL_LOSS_SCALE = 2048.0
AMP_MAX_LOSS_SCALE = 2048.0
AMP_GROWTH_INTERVAL = 2_147_483_647


def validation_tolerance(best_metric: float) -> float:
    return max(FINAL_EVAL_ABS_TOLERANCE, abs(best_metric) * FINAL_EVAL_REL_TOLERANCE)


def validation_regressed(
    eval_loss: float, best_metric: float, max_regression: float
) -> bool:
    maximum = best_metric + max_regression + validation_tolerance(best_metric)
    return eval_loss > maximum


def reconstruct_logged_train_loss(state: TrainerState) -> float:
    losses = [
        entry["loss"]
        for entry in state.log_history
        if isinstance(entry.get("loss"), (int, float))
    ]
    if not losses or any(not math.isfinite(loss) for loss in losses):
        raise ValueError(
            "Checkpoint trainer state has no finite logged training losses"
        )
    return sum(losses) / len(losses)


def load_safe_finalization_state(
    model: Any, checkpoint: str, max_steps: int
) -> TrainerState | None:
    checkpoint_path = Path(checkpoint).resolve()
    state_path = checkpoint_path / "trainer_state.json"
    weights_path = checkpoint_path / "adapter_model.safetensors"
    state = TrainerState.load_from_json(str(state_path))
    if state.global_step < max_steps:
        return None
    if state.global_step != max_steps:
        raise ValueError(
            f"Checkpoint step {state.global_step} does not equal recipe maxSteps {max_steps}"
        )
    if Path(state.best_model_checkpoint or "").resolve() != checkpoint_path:
        raise ValueError("Final checkpoint is not the recorded best-model checkpoint")
    if not weights_path.is_file():
        raise FileNotFoundError(f"Missing safe adapter weights: {weights_path}")
    adapter_state = load_file(str(weights_path), device="cpu")
    load_result = set_peft_model_state_dict(model, adapter_state)
    if load_result.unexpected_keys:
        raise RuntimeError(
            f"Unexpected adapter keys during safe finalization: {load_result.unexpected_keys}"
        )
    return state


def load_standalone_adapter_weights(
    model: torch.nn.Module,
    adapter_path: str,
    expected_sha256: str,
    expected_tensor_count: int = 44,
) -> dict[str, Any]:
    """Load one frozen adapter artifact strictly before Trainer construction."""
    path = Path(adapter_path).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Warm-start adapter does not exist: {path}")
    actual_sha = sha256_file(path)
    if actual_sha != expected_sha256:
        raise ValueError(f"Warm-start adapter SHA mismatch: expected {expected_sha256}, got {actual_sha}")
    parent_state = load_file(str(path), device="cpu")
    if len(parent_state) != expected_tensor_count:
        raise ValueError(f"Warm-start adapter tensor count mismatch: {len(parent_state)}")
    if any(not torch.isfinite(value).all() for value in parent_state.values()):
        raise FloatingPointError("Warm-start adapter contains non-finite values")
    adapter_keys = {name for name, _ in model.named_parameters() if ".lora_" in name}
    if adapter_keys != set(parent_state):
        missing = sorted(adapter_keys - set(parent_state))
        unexpected = sorted(set(parent_state) - adapter_keys)
        raise ValueError(f"Warm-start adapter key mismatch: missing={missing}, unexpected={unexpected}")
    before = {name: parameter.detach().cpu().clone() for name, parameter in model.named_parameters() if name in parent_state}
    result = set_peft_model_state_dict(model, parent_state)
    if result.missing_keys or result.unexpected_keys:
        raise ValueError(f"Warm-start adapter load mismatch: missing={result.missing_keys}, unexpected={result.unexpected_keys}")
    mismatches = [name for name, parameter in model.named_parameters() if name in parent_state and not torch.equal(parameter.detach().cpu(), parent_state[name])]
    if mismatches:
        raise ValueError(f"Warm-start adapter value mismatch after load: {mismatches}")
    return {"sha256": actual_sha, "tensorCount": len(parent_state), "loadedKeys": sorted(parent_state), "valueMismatches": 0, "preexistingKeys": len(before)}



def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train an immutable, provenance-complete Tomny Qwen3.5 QLoRA candidate."
    )
    parser.add_argument(
        "--recipe",
        help="Versioned tomny.qlora-recipe.v1 JSON file; required for every training mode.",
    )
    parser.add_argument(
        "--hash-model",
        help="Print the deterministic base-model content SHA-256 and exit.",
    )
    parser.add_argument("--model", help="Local immutable base-model directory.")
    parser.add_argument(
        "--dataset-manifest", help="tomny.dataset-manifest.v2 JSON file."
    )
    parser.add_argument("--candidate-root", default=".model-adapters/candidates")
    parser.add_argument(
        "--candidate-id", help="Immutable adapter id; becomes a directory component."
    )
    parser.add_argument(
        "--candidate-version",
        help="Immutable candidate version; becomes a directory component.",
    )
    parser.add_argument(
        "--resume-from", help="Checkpoint path inside this candidate, or 'latest'."

    )
    parser.add_argument("--warm-start-adapter", help="Standalone adapter weights to load before Trainer construction.")
    parser.add_argument("--execution-id", default=None, help="Stable execution identifier for heartbeat/receipt evidence.")
    parser.add_argument("--heartbeat-path", default=None, help="Persistent heartbeat JSON path.")
    parser.add_argument("--diagnostic-pre-train-only", action="store_true", help="Stop after Trainer construction without calling train().")
    parser.add_argument(
        "--force-failure-phase",
        choices=("before-model-load", "after-trainer-construction"),
        default=None,
        help="Test-only deterministic failure injection; never set by production recipes.",
    )



    parser.add_argument(
        "--validate-recipe",
        action="store_true",
        help="Validate recipe only; no data, CUDA, or writes.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate recipe, data, base binding, and output immutability without CUDA or writes.",
    )
    parser.add_argument(
        "--load-only",
        action="store_true",
        help="Run full preflight and load the quantized text model, then exit without writing.",
    )
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Allow explicitly bounded train/validation rows; output is labeled smoke-only.",
    )
    parser.add_argument(
        "--train-limit",
        type=int,
        default=0,
        help="Smoke only. Production default 0 consumes the full train split.",
    )
    parser.add_argument(
        "--validation-limit",
        type=int,
        default=0,
        help="Smoke only. Production default 0 consumes full validation.",
    )
    parser.add_argument(
        "--allow-low-host-memory",
        action="store_true",
        help="Deliberate smoke-only override; never changes the recipe.",
    )
    parser.add_argument(
        "--memory-pressure-low-mib",
        type=int,
        default=MIN_MEMORY_PRESSURE_FREE_MIB,
        help="Memory pressure protection preserves a checkpoint before controlled pause.",
    )
    args = parser.parse_args()
    if args.memory_pressure_low_mib < MIN_MEMORY_PRESSURE_FREE_MIB:
        parser.error(
            f"--memory-pressure-low-mib must be at least {MIN_MEMORY_PRESSURE_FREE_MIB}"
        )
    return args


def human_bytes(value: int | float) -> str:
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    amount = float(value)
    for unit in units:
        if abs(amount) < 1024 or unit == units[-1]:
            return f"{amount:.2f} {unit}"
        amount /= 1024
    return f"{amount:.2f} TiB"


def memory_snapshot() -> dict[str, Any]:
    virtual = psutil.virtual_memory()
    swap = psutil.swap_memory()
    result: dict[str, Any] = {
        "hostTotal": virtual.total,
        "hostAvailable": virtual.available,
        "hostPercent": virtual.percent,
        "pagefileTotal": swap.total,
        "pagefileFree": max(0, swap.total - swap.used),
    }
    if torch.cuda.is_available():
        free, total = torch.cuda.mem_get_info(0)
        result.update(
            {
                "gpuName": torch.cuda.get_device_name(0),
                "gpuFree": free,
                "gpuTotal": total,
                "gpuAllocated": torch.cuda.memory_allocated(0),
                "gpuReserved": torch.cuda.memory_reserved(0),
            }
        )
    return result


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    os.replace(temporary, path)

def execution_heartbeat(
    heartbeat_path: str | None, execution_id: str, marker: str, **details: Any
) -> None:
    """Emit a flushed marker and persist the latest bounded execution state."""
    payload: dict[str, Any] = {
        "schemaVersion": "tomny.training-heartbeat.v1",
        "executionId": execution_id,
        "marker": marker,
        "updatedAt": datetime.now(UTC).isoformat(),
        "pid": os.getpid(),
        **details,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    if heartbeat_path:
        path = Path(heartbeat_path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_json(path, payload)



def execution_success_receipt(
    heartbeat_path: str | None, execution_id: str, optimizer_steps: int = 0
) -> None:
    payload = {
        "schemaVersion": "tomny.training-diagnostic-success.v1",
        "executionId": execution_id,
        "status": "DIAGNOSTIC_PRETRAIN_SUCCESS",
        "optimizerSteps": optimizer_steps,
        "trainerTrainCalled": False,
        "candidateCreated": False,
        "trainingStarted": False,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    if heartbeat_path:
        path = Path(heartbeat_path).resolve()
        atomic_write_json(path.with_name(f"{path.stem}.success.json"), payload)

def execution_failure_receipt(
    heartbeat_path: str | None, execution_id: str, error: BaseException
) -> None:
    """Persist a bounded terminal failure receipt without exposing a traceback."""
    last_heartbeat: dict[str, Any] = {}
    if heartbeat_path:
        heartbeat_file = Path(heartbeat_path).resolve()
        if heartbeat_file.is_file():
            try:
                loaded = json.loads(heartbeat_file.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    last_heartbeat = loaded
            except (OSError, json.JSONDecodeError):
                last_heartbeat = {}
    failure_phase = str(last_heartbeat.get("marker", "UNKNOWN"))

    payload = {
        "schemaVersion": "tomny.training-failure.v1",
        "executionId": execution_id,
        "status": "FAILED",
        "lastHeartbeat": last_heartbeat,
        "failurePhase": failure_phase,
        "optimizerStepsCompleted": 0,
        "candidateCreated": False,
        "trainingStarted": False,
        "timestamp": datetime.now(UTC).isoformat(),

        "updatedAt": datetime.now(UTC).isoformat(),
        "errorType": type(error).__name__,
        "message": str(error)[:500],
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)
    if heartbeat_path:
        path = Path(heartbeat_path).resolve()
        atomic_write_json(path.with_name(f"{path.stem}.failure.json"), payload)



def observe_memory_pressure(
    minimum_available_mib: int, global_step: int
) -> dict[str, Any] | None:
    available_mib = int(psutil.virtual_memory().available / 1024**2)
    if available_mib >= minimum_available_mib:
        return None
    return {
        "code": "host-memory-pressure",
        "observedAt": datetime.now(UTC).isoformat(),
        "availableMiB": available_mib,
        "thresholdMiB": minimum_available_mib,
        "globalStep": global_step,
    }


class MemoryPressurePause(RuntimeError):
    def __init__(self, details: dict[str, Any]) -> None:
        super().__init__("Controlled candidate pause due to host memory pressure")
        self.details = details


class MemoryPressurePauseCallback(TrainerCallback):
    def __init__(self, minimum_available_mib: int) -> None:
        self.minimum_available_mib = minimum_available_mib
        self.details: dict[str, Any] | None = None

    def _observe(self, state: TrainerState, control: TrainerControl) -> TrainerControl:
        if self.details is not None:
            return control
        details = observe_memory_pressure(self.minimum_available_mib, state.global_step)
        if details is None:
            return control
        self.details = details
        control.should_save = True
        control.should_training_stop = True
        return control

    def on_step_end(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs: Any,
    ) -> TrainerControl:
        return self._observe(state, control)

    def on_evaluate(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs: Any,
    ) -> TrainerControl:
        return self._observe(state, control)

    def on_save(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs: Any,
    ) -> TrainerControl:
        if self.details is not None:
            raise MemoryPressurePause(self.details)
        return control


def printable_memory(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        key: human_bytes(value)
        if isinstance(value, int) and key != "hostPercent"
        else value
        for key, value in snapshot.items()
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def require_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value


def require_int(value: Any, label: str, minimum: int = 0) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise ValueError(f"{label} must be an integer >= {minimum}")
    return value


def primary_label_total_variation(
    train: dict[str, Any], validation: dict[str, Any]
) -> float:
    distributions: list[dict[str, int]] = []
    for label, values in (("train", train), ("validation", validation)):
        normalized: dict[str, int] = {}
        for key, value in values.items():
            if (
                not isinstance(key, str)
                or not key
                or not isinstance(value, int)
                or isinstance(value, bool)
                or value < 0
            ):
                raise ValueError(
                    f"dataset {label} label distribution must contain non-negative integer counts"
                )
            normalized[key] = value
        if sum(normalized.values()) <= 0:
            raise ValueError(f"dataset {label} label distribution must not be empty")
        distributions.append(normalized)
    train_counts, validation_counts = distributions
    train_total = sum(train_counts.values())
    validation_total = sum(validation_counts.values())
    labels = set(train_counts) | set(validation_counts)
    return 0.5 * sum(
        abs(
            train_counts.get(label, 0) / train_total
            - validation_counts.get(label, 0) / validation_total
        )
        for label in labels
    )


def load_json_object(path: Path, label: str) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"Missing {label}: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid {label} JSON at {path}: {error}") from error
    return require_object(value, label)


def resolve_bounded_file(root: Path, relative_value: Any, label: str) -> Path:
    relative = Path(require_string(relative_value, label))
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"{label} must be a traversal-free relative path")
    resolved_root = root.resolve()
    resolved = (resolved_root / relative).resolve()
    if resolved_root not in resolved.parents:
        raise ValueError(f"{label} escapes the dataset root")
    return resolved


def count_jsonl_rows(path: Path) -> int:
    with path.open("rb") as handle:
        return sum(1 for line in handle if line.strip())


def iter_jsonl_objects(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(
                    f"Invalid JSONL row at {path}:{line_number}"
                ) from error
            if not isinstance(row, dict):
                raise ValueError(f"JSONL row at {path}:{line_number} must be an object")
            yield row


def validate_recipe(recipe_path: Path) -> dict[str, Any]:
    recipe = load_json_object(recipe_path, "recipe")
    if recipe.get("schemaVersion") != RECIPE_SCHEMA:
        raise ValueError(f"recipe.schemaVersion must equal {RECIPE_SCHEMA}")
    require_int(recipe.get("recipeVersion"), "recipe.recipeVersion", 1)
    require_string(recipe.get("id"), "recipe.id")
    require_string(recipe.get("version"), "recipe.version")
    if recipe.get("promotionStatus") != "candidate-only":
        raise ValueError("recipe.promotionStatus must be candidate-only")
    dataset = require_object(recipe.get("dataset"), "recipe.dataset")
    require_string(dataset.get("datasetId"), "recipe.dataset.datasetId")
    require_string(dataset.get("datasetVersion"), "recipe.dataset.datasetVersion")
    dataset_hash = require_string(
        dataset.get("manifestSha256"), "recipe.dataset.manifestSha256"
    )
    if not re.fullmatch(r"[0-9a-f]{64}", dataset_hash):
        raise ValueError("recipe.dataset.manifestSha256 must be lowercase SHA-256")
    purpose = require_string(recipe.get("purpose"), "recipe.purpose")
    if purpose not in PURPOSE_FILES:
        raise ValueError(f"recipe.purpose must be one of {sorted(PURPOSE_FILES)}")
    base = require_object(recipe.get("baseModel"), "recipe.baseModel")
    require_string(base.get("modelId"), "recipe.baseModel.modelId")
    require_string(base.get("revision"), "recipe.baseModel.revision")
    expected_hash = require_string(
        base.get("contentSha256"), "recipe.baseModel.contentSha256"
    )
    if not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
        raise ValueError("recipe.baseModel.contentSha256 must be lowercase SHA-256")
    training = require_object(recipe.get("training"), "recipe.training")
    for key in ("earlyStoppingEnabled", "loadBestModelAtEnd"):
        if key in training and not isinstance(training[key], bool):
            raise ValueError(f"recipe.training.{key} must be boolean")
























    required_ints = {
        "maxSteps": 1,
        "maxLength": 64,
        "rank": 1,
        "loraAlpha": 1,
        "gradientAccumulationSteps": 1,
        "evalSteps": 1,
        "saveSteps": 1,
        "loggingSteps": 1,
    }
    for key, minimum in required_ints.items():
        require_int(training.get(key), f"recipe.training.{key}", minimum)
    if training.get("earlyStoppingEnabled", True):
        require_int(training.get("earlyStoppingPatience"), "recipe.training.earlyStoppingPatience", 1)
    numeric_keys = ["learningRate"]
    if training.get("earlyStoppingEnabled", True):
        numeric_keys.extend(["earlyStoppingThreshold", "maxValidationRegression"])
    for key in numeric_keys:
        value = training.get(key)
        if (
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(value)
            or value < 0
        ):
            raise ValueError(f"recipe.training.{key} must be a finite number >= 0")
    if training["learningRate"] <= 0: raise ValueError("recipe.training.learningRate must be > 0")
    precision_value = training.get("precision", "fp16")
    precision = require_string(precision_value, "recipe.training.precision")
    if precision not in {"fp16", "bf16"}:
        raise ValueError("recipe.training.precision must be fp16 or bf16")
    target_profile = require_string(
        training.get("targetProfile"), "recipe.training.targetProfile"
    )
    if target_profile not in {
        "last-block",
        "last-three-full-attention",
        "full-attention",
        "small-gpu",
        "all-linear",
        "topology-aware-last-four",
        "shield-full-24",
    }:
        raise ValueError("recipe.training.targetProfile is unsupported")
    if training["saveSteps"] % training["evalSteps"] != 0:
        raise ValueError(
            "recipe.training.saveSteps must be a multiple of evalSteps for best-model selection"
        )
    require_int(recipe.get("seed"), "recipe.seed", 0)
    limitations = recipe.get("qualityLimitations")
    if not isinstance(limitations, list) or any(
        not isinstance(item, str) or not item for item in limitations
    ):
        raise ValueError("recipe.qualityLimitations must be a string array")
    if target_profile == "last-block" and not limitations:
        raise ValueError(
            "last-block recipes must explicitly record their quality limitation"
        )
    hardware = require_object(recipe.get("hardwareProfile"), "recipe.hardwareProfile")
    if not isinstance(hardware.get("finiteGradientSmokePassed"), bool):
        raise ValueError(
            "recipe.hardwareProfile.finiteGradientSmokePassed must be boolean"
        )
    return recipe


def enforce_finite_gradient_smoke_gate(
    recipe: dict[str, Any], args: argparse.Namespace
) -> None:
    hardware = recipe["hardwareProfile"]
    if hardware["profile"] != "rtx-3050-4gb" or hardware["finiteGradientSmokePassed"]:
        return
    preflight_only = (
        args.validate_recipe or args.dry_run or args.load_only or args.smoke
    )
    if not preflight_only:
        raise ValueError(
            "RTX 3050 4 GB production training requires finiteGradientSmokePassed=true; run a bounded smoke first"
        )


def verify_finite_gradient_smoke_evidence(
    recipe: dict[str, Any], recipe_path: Path, args: argparse.Namespace
) -> None:
    """Bind an RTX production recipe to one completed finite-gradient smoke artifact."""
    hardware = recipe["hardwareProfile"]
    if (
        hardware["profile"] != "rtx-3050-4gb"
        or hardware["finiteGradientSmokePassed"] is not True
        or args.smoke
    ):
        return
    evidence = hardware.get("stabilitySmokeEvidence")
    expected_fields = {
        "candidateId",
        "candidateVersion",
        "manifestSha256",
        "verificationReportSha256",
        "recipeSha256",
        "steps",
        "precision",
    }
    if not isinstance(evidence, dict) or set(evidence) != expected_fields:
        raise ValueError(
            "RTX 3050 production recipe requires exact stabilitySmokeEvidence"
        )
    candidate_id = evidence["candidateId"]
    candidate_version = evidence["candidateVersion"]
    if not (
        isinstance(candidate_id, str)
        and SAFE_COMPONENT.fullmatch(candidate_id)
        and isinstance(candidate_version, str)
        and SAFE_COMPONENT.fullmatch(candidate_version)
    ):
        raise ValueError("stability smoke candidate identity is invalid")
    for name in ("manifestSha256", "verificationReportSha256", "recipeSha256"):
        value = evidence[name]
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
            raise ValueError(f"stability smoke {name} is invalid")
    if evidence["steps"] != 25 or evidence["precision"] != "fp16":
        raise ValueError("finite-gradient smoke evidence must bind the approved v6 25-step FP16 protocol")

    repository_root = recipe_path.parents[2]
    smoke_root = (
        repository_root
        / ".model-adapters"
        / "candidates"
        / candidate_id
        / candidate_version
    )
    manifest_path = smoke_root / "training_manifest.json"
    report_path = smoke_root / "verification-report.json"
    if not manifest_path.is_file() or not report_path.is_file():
        raise FileNotFoundError("stability smoke evidence is missing its immutable artifacts")
    if sha256_file(manifest_path) != evidence["manifestSha256"]:
        raise ValueError("stability smoke manifest hash mismatch")
    if sha256_file(report_path) != evidence["verificationReportSha256"]:
        raise ValueError("stability smoke verification report hash mismatch")
    manifest = load_json_object(manifest_path, "stability smoke training manifest")
    if (
        manifest.get("completed") is not True
        or manifest.get("status") != "candidate"
        or manifest.get("purpose") != recipe["purpose"]
        or manifest.get("candidate", {}).get("id") != candidate_id
        or manifest.get("candidate", {}).get("version") != candidate_version
        or manifest.get("steps") != evidence["steps"]
        or manifest.get("precision") != evidence["precision"]
        or manifest.get("smokeOnly") is not True
        or manifest.get("fullValidation") is not False
        or manifest.get("recipe", {}).get("sha256") != evidence["recipeSha256"]
    ):
        raise ValueError("stability smoke manifest does not match the required protocol")
    curves = manifest.get("curves")
    if not isinstance(curves, list) or not curves:
        raise ValueError("stability smoke curve evidence is missing")
    for index, row in enumerate(curves):
        if not isinstance(row, dict):
            raise ValueError(f"stability smoke curve row {index} is invalid")
        for name, value in row.items():
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError(f"stability smoke curve contains non-finite {name}")
    validation = manifest.get("metrics", {}).get("validation", {})
    if not isinstance(validation.get("eval_loss"), (int, float)) or not math.isfinite(
        validation["eval_loss"]
    ):
        raise ValueError("stability smoke validation metric is missing or non-finite")
    report = load_json_object(report_path, "stability smoke verification report")
    adapter = report.get("adapters", [None])
    if (
        report.get("verified") is not True
        or report.get("adapterCount") != 1
        or not isinstance(adapter, list)
        or len(adapter) != 1
        or not isinstance(adapter[0], dict)
        or adapter[0].get("manifestSha256") != evidence["manifestSha256"]
        or adapter[0].get("allFinite") is not True
        or adapter[0].get("purpose") != recipe["purpose"]
    ):
        raise ValueError("stability smoke verification report does not attest a finite adapter")


def validate_dataset_manifest(
    manifest_path: Path, purpose: str, expected_base: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Path]]:
    manifest = load_json_object(manifest_path, "dataset manifest")
    if (
        manifest.get("schemaVersion") != DATASET_SCHEMA
        or manifest.get("manifestVersion") != 2
    ):
        raise ValueError(f"Dataset must use {DATASET_SCHEMA} with manifestVersion=2")
    for key in ("datasetId", "datasetVersion", "license"):
        require_string(manifest.get(key), f"dataset.{key}")
    require_int(manifest.get("seed"), "dataset.seed", 0)
    card = require_object(manifest.get("dataCard"), "dataset.dataCard")
    if not isinstance(card.get("sources"), list) or not card["sources"]:
        raise ValueError("dataset.dataCard.sources must be a non-empty array")
    for index, source in enumerate(card["sources"]):
        source_object = require_object(source, f"dataset.dataCard.sources[{index}]")
        require_string(
            source_object.get("kind"), f"dataset.dataCard.sources[{index}].kind"
        )
    for key in ("provenance", "rights", "privacy"):
        require_string(card.get(key), f"dataset.dataCard.{key}")
    require_string(card.get("reviewerStatus"), "dataset.dataCard.reviewerStatus")
    if not isinstance(card.get("limitations"), list):
        raise ValueError("dataset.dataCard.limitations must be an array")
    quality = require_object(manifest.get("quality"), "dataset.quality")
    quality_domains = require_object(quality.get("domains"), "dataset.quality.domains")
    domain_quality = require_object(
        quality_domains.get(purpose), f"dataset.quality.domains.{purpose}"
    )
    for gate in ("privacy", "leakage", "ontology", "dedup"):
        if (
            require_object(domain_quality.get(gate), f"dataset quality {gate}").get(
                "passed"
            )
            is not True
        ):
            raise ValueError(f"dataset quality gate failed for {purpose}: {gate}")
    coverage = require_object(
        domain_quality.get("coverage"), f"dataset.quality.domains.{purpose}.coverage"
    )
    label_distribution = require_object(
        coverage.get("labelDistribution"), "dataset coverage labelDistribution"
    )
    train_distribution = require_object(
        label_distribution.get("train"), "dataset train label distribution"
    )
    validation_distribution = require_object(
        label_distribution.get("validation"), "dataset validation label distribution"
    )
    distribution_shift = primary_label_total_variation(
        train_distribution, validation_distribution
    )
    if distribution_shift > MAX_PRIMARY_LABEL_TOTAL_VARIATION:
        raise ValueError(
            f"Primary label distribution shift {distribution_shift:.4f} exceeds "
            f"{MAX_PRIMARY_LABEL_TOTAL_VARIATION:.4f} between train and validation"
        )
    domains = require_object(manifest.get("domains"), "dataset.domains")
    domain = require_object(domains.get(purpose), f"dataset.domains.{purpose}")
    if domain.get("purpose") != purpose:
        raise ValueError("Dataset purpose binding mismatch")
    binding = require_object(domain.get("baseBinding"), "dataset domain baseBinding")
    for key in ("modelId", "revision", "contentSha256"):
        if binding.get(key) != expected_base.get(key):
            raise ValueError(f"Dataset base-model {key} binding does not match recipe")
    require_string(domain.get("outputSchema"), "dataset domain outputSchema")
    if not isinstance(domain.get("closedOntology"), (dict, list)):
        raise ValueError("dataset domain closedOntology must be an object or array")
    if domain.get("trainerReadableSplits") != ["train", "validation"]:
        raise ValueError(
            "trainerReadableSplits must be exactly ['train', 'validation']; test is forbidden"
        )
    splits = require_object(domain.get("splits"), "dataset domain splits")
    test = require_object(splits.get("test"), "dataset test split")
    if test.get("trainerReadable") is not False or test.get("immutable") is not True:
        raise ValueError("Test split must be immutable and trainerReadable=false")
    test_path = Path(require_string(test.get("path"), "dataset test path"))
    if (
        test_path.is_absolute()
        or ".." in test_path.parts
        or not test_path.parts
        or test_path.parts[0] != "immutable-test"
    ):
        raise ValueError(
            "Test split must remain under immutable-test/ and is never opened by the trainer"
        )
    readable: dict[str, Path] = {}
    root = manifest_path.parent
    for split_name in ("train", "validation"):
        entry = require_object(splits.get(split_name), f"dataset {split_name} split")
        if entry.get("trainerReadable") is not True:
            raise ValueError(f"{split_name} must be trainerReadable=true")
        path = resolve_bounded_file(
            root, entry.get("path"), f"dataset {split_name} path"
        )
        if not path.is_file():
            raise FileNotFoundError(f"Missing {split_name} split: {path}")
        expected_hash = require_string(
            entry.get("sha256"), f"dataset {split_name} sha256"
        )
        if (
            not re.fullmatch(r"[0-9a-f]{64}", expected_hash)
            or sha256_file(path) != expected_hash
        ):
            raise ValueError(f"{split_name} split SHA-256 mismatch")
        expected_rows = require_int(entry.get("rows"), f"dataset {split_name} rows", 1)
        if count_jsonl_rows(path) != expected_rows:
            raise ValueError(f"{split_name} split row count mismatch")
        require_int(
            entry.get("semanticGroups"), f"dataset {split_name} semanticGroups", 1
        )
        require_object(entry.get("languages"), f"dataset {split_name} languages")
        require_int(
            entry.get("hardNegatives"), f"dataset {split_name} hardNegatives", 0
        )
        readable[split_name] = path
    isolation_report = split_isolation_report(
        {split_name: iter_jsonl_objects(path) for split_name, path in readable.items()}
    )
    if not isolation_report["passed"]:
        raise ValueError("Template or semantic-group split isolation failed")
    return manifest, readable


def sha256_tree(root: Path) -> str:
    if not root.is_dir():
        raise FileNotFoundError(f"Base model directory does not exist: {root}")
    digest = hashlib.sha256()
    files = sorted(
        (path for path in root.rglob("*") if path.is_file()),
        key=lambda path: tuple(part.lower() for part in path.relative_to(root).parts),
    )
    if not files:
        raise ValueError(f"Base model directory is empty: {root}")
    for path in files:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(bytes.fromhex(sha256_file(path)))
    return digest.hexdigest()


def resolve_candidate(args: argparse.Namespace, allow_existing: bool = False) -> Path:
    for label, value in (
        ("candidate id", args.candidate_id),
        ("candidate version", args.candidate_version),
    ):
        if not value or not SAFE_COMPONENT.fullmatch(value):
            raise ValueError(f"{label} must match {SAFE_COMPONENT.pattern}")
    root = Path(args.candidate_root).resolve()
    if any(part.lower() in {"active", "pilot", "production"} for part in root.parts):
        raise ValueError(
            "Candidate root must not target an active, pilot, or production directory"
        )
    candidate = (root / args.candidate_id / args.candidate_version).resolve()
    if root not in candidate.parents:
        raise ValueError("Candidate path escapes candidate root")
    if candidate.exists() and not allow_existing:
        raise FileExistsError(f"Immutable candidate already exists: {candidate}")
    return candidate


def git_provenance() -> dict[str, Any]:
    if __import__("shutil").which("git") is None: return {"gitAvailable": False, "revision": "unavailable", "dirty": False}
    def run(*values: str) -> str:
        result = subprocess.run(
            ["git", *values], capture_output=True, text=True, check=False
        )
        return result.stdout.strip() if result.returncode == 0 else "unavailable"

    return {
        "revision": run("rev-parse", "HEAD"),
        "gitAvailable": True,
        "dirty": bool(run("status", "--porcelain")),
    }


def package_versions() -> dict[str, str]:
    names = (
        "torch",
        "transformers",
        "peft",
        "datasets",
        "accelerate",
        "bitsandbytes",
        "safetensors",
        "psutil",
    )
    result: dict[str, str] = {}
    for name in names:
        try:
            result[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            result[name] = "missing"
    return result


def require_safe_resume_runtime(resume_from: str | None) -> None:
    if resume_from is None:
        return
    installed = Version(torch.__version__.split("+", 1)[0])
    required = Version("2.6")
    if installed < required:
        raise RuntimeError(
            "Safe checkpoint resume requires PyTorch >=2.6 because optimizer and scheduler state "
            f"must not be loaded by vulnerable torch.load; installed {torch.__version__}"
        )


def verify_environment(args: argparse.Namespace) -> dict[str, Any]:
    if not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA is required for the 4-bit bitsandbytes training profile."
        )
    if args.precision == "bf16" and not torch.cuda.is_bf16_supported():
        raise RuntimeError("Recipe requires bf16 but the active CUDA device does not support it")
    if not args.model:
        raise ValueError("--model is required for load-only and training")
    model_path = Path(args.model)
    if not model_path.is_dir():
        raise FileNotFoundError(f"Model path does not exist: {model_path}")
    if args.allow_low_host_memory and not args.smoke:
        raise ValueError("--allow-low-host-memory is permitted only with --smoke")

    snapshot = memory_snapshot()
    # Model construction and checkpoint indexing use host commit memory even
    # when the final weights are 4-bit on GPU. Refuse a likely crash unless the
    # caller explicitly accepts it.
    minimum_host_available = 2 * 1024**3
    minimum_pagefile_free = 3 * 1024**3
    low_host = snapshot["hostAvailable"] < minimum_host_available
    low_pagefile = (
        snapshot["pagefileTotal"] > 0
        and snapshot["pagefileFree"] < minimum_pagefile_free
    )
    if (low_host or low_pagefile) and not args.allow_low_host_memory:
        raise MemoryError(
            "Insufficient host memory commit for safe model construction. "
            f"Available RAM={human_bytes(snapshot['hostAvailable'])}, "
            f"free pagefile={human_bytes(snapshot['pagefileFree'])}. "
            "Close memory-heavy apps or increase the Windows pagefile, then retry. "
            "Use --allow-low-host-memory only for a deliberate smoke test."
        )
    return snapshot


def load_text_only_qwen35(
    model_path: str, compute_dtype: torch.dtype
) -> tuple[torch.nn.Module, Any, dict[str, Any]]:
    tokenizer = AutoTokenizer.from_pretrained(
        model_path, local_files_only=True, trust_remote_code=False
    )
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    parent_config = Qwen3_5Config.from_pretrained(
        model_path, local_files_only=True, trust_remote_code=False
    )
    text_config = parent_config.text_config
    text_config.use_cache = False

    quantization = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=compute_dtype,
        bnb_4bit_use_double_quant=True,
    )

    # Qwen3_5ForCausalLM is the explicit text-only class. Transformers applies
    # its built-in qwen3_5_text conversion, renaming model.language_model.* to
    # model.* while ignoring model.visual.* and mtp.* checkpoint keys.
    loaded = Qwen3_5ForCausalLM.from_pretrained(
        model_path,
        config=text_config,
        quantization_config=quantization,
        device_map={"": 0},
        # The 4-bit base remains in the small-GPU storage dtype.  BF16 is an
        # autocast/4-bit compute choice; PEFT keeps trainable adapters in its
        # preparation dtype instead of loading a second full BF16 base.
        dtype=torch.float16,
        local_files_only=True,
        trust_remote_code=False,
        attn_implementation="eager",
        output_loading_info=True,
    )
    model, loading_info = loaded
    model.config.use_cache = False
    summary = {
        "modelClass": model.__class__.__name__,
        "configClass": model.config.__class__.__name__,
        "modelType": model.config.model_type,
        "unexpectedKeys": len(loading_info.get("unexpected_keys", [])),
        "missingKeys": len(loading_info.get("missing_keys", [])),
        "mismatchedKeys": len(loading_info.get("mismatched_keys", [])),
        "errorMessages": loading_info.get("error_msgs", []),
    }
    return model, tokenizer, summary


def available_linear_leaf_names(model: torch.nn.Module) -> set[str]:
    result = set()
    for name, module in model.named_modules():
        class_name = module.__class__.__name__.lower()
        if isinstance(module, torch.nn.Linear) or "linear4bit" in class_name:
            result.add(name.rsplit(".", 1)[-1])
    return result


def attach_lora(
    model: torch.nn.Module, args: argparse.Namespace
) -> tuple[torch.nn.Module, list[str], bool]:
    use_gradient_checkpointing = args.target_profile != "last-block"
    checkpoint_kwargs = {"use_reentrant": False}
    model = prepare_model_for_kbit_training(
        model,
        use_gradient_checkpointing=use_gradient_checkpointing,
        gradient_checkpointing_kwargs=checkpoint_kwargs
        if use_gradient_checkpointing
        else None,
    )
    if use_gradient_checkpointing and hasattr(model, "enable_input_require_grads"):
        model.enable_input_require_grads()

    available = available_linear_leaf_names(model)
    lora_kwargs: dict[str, Any] = {}
    if args.target_profile == "all-linear":
        target_modules: str | list[str] = "all-linear"
        resolved_targets = sorted(available - {"lm_head"})
    elif args.target_profile == "small-gpu":
        resolved_targets = [name for name in SMALL_GPU_TARGETS if name in available]
        target_modules = resolved_targets
    elif args.target_profile == "last-three-full-attention":
        resolved_targets = [
            name
            for name in ["q_proj", "k_proj", "v_proj", "o_proj"]
            if name in available
        ]
        target_modules = resolved_targets
        layer_types = getattr(model.config, "layer_types", None)
        if (
            not isinstance(layer_types, list)
            or len(layer_types) != model.config.num_hidden_layers
        ):
            raise RuntimeError(
                "Qwen3.5 layer_types are required for the last-three-full-attention profile"
            )
        full_attention_layers = [
            index
            for index, layer_type in enumerate(layer_types)
            if layer_type == "full_attention"
        ]
        if len(full_attention_layers) < 3:
            raise RuntimeError("The model does not expose three full-attention layers")
        lora_kwargs["layers_to_transform"] = full_attention_layers[-3:]
        lora_kwargs["layers_pattern"] = "layers"

    elif args.target_profile == "shield-full-24":
        resolved_targets = [
            name
            for name in ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
            if name in available
        ]
        target_modules = resolved_targets
        lora_kwargs["layers_to_transform"] = list(range(model.config.num_hidden_layers))
        lora_kwargs["layers_pattern"] = "layers"
        lora_kwargs["use_rslora"] = True
    elif args.target_profile == "topology-aware-last-four":
        resolved_targets = [
            name
            for name in [
                "q_proj", "k_proj", "v_proj", "o_proj",
                "in_proj_qkv", "out_proj",
                "gate_proj", "up_proj", "down_proj",
            ]
            if name in available
        ]
        target_modules = resolved_targets
        lora_kwargs["layers_to_transform"] = [20, 21, 22, 23]
        lora_kwargs["layers_pattern"] = "layers"
    elif args.target_profile == "full-attention":
        resolved_targets = [
            name
            for name in ["q_proj", "k_proj", "v_proj", "o_proj"]
            if name in available
        ]
        target_modules = resolved_targets
    else:
        resolved_targets = [
            name
            for name in [
                "q_proj",
                "k_proj",
                "v_proj",
                "o_proj",
                "gate_proj",
                "up_proj",
                "down_proj",
            ]
            if name in available
        ]
        target_modules = resolved_targets
        lora_kwargs["layers_to_transform"] = [model.config.num_hidden_layers - 1]
        lora_kwargs["layers_pattern"] = "layers"

    if not resolved_targets:
        raise RuntimeError(
            f"No LoRA targets were found for {args.target_profile}. Available linear leaves: {sorted(available)}"
        )

    config = LoraConfig(
        r=args.rank,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        bias="none",
        target_modules=target_modules,
        task_type="CAUSAL_LM",
        **lora_kwargs,
    )
    model = get_peft_model(model, config)
    model.config.use_cache = False
    return model, resolved_targets, use_gradient_checkpointing


def limit_split(
    dataset: DatasetDict, train_limit: int, validation_limit: int, seed: int
) -> DatasetDict:
    result = DatasetDict()
    train = dataset["train"].shuffle(seed=seed)
    validation = dataset["validation"].shuffle(seed=seed + 1)
    if train_limit > 0:
        train = train.select(range(min(train_limit, len(train))))
    if validation_limit > 0:
        validation = validation.select(range(min(validation_limit, len(validation))))
    result["train"] = train
    result["validation"] = validation
    return result


def tokenize_dataset(
    dataset: DatasetDict, tokenizer: Any, max_length: int
) -> tuple[DatasetDict, dict[str, Any]]:
    def encode(example: dict[str, Any]) -> dict[str, Any]:
        messages = example["messages"]
        if not messages or messages[-1].get("role") != "assistant":
            raise ValueError("Each training row must end with an assistant message")
        prompt_text = tokenizer.apply_chat_template(
            messages[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False
        )
        full_text = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=False, enable_thinking=False
        )
        prompt_ids = tokenizer(prompt_text, add_special_tokens=False)["input_ids"]
        encoded = tokenizer(full_text, add_special_tokens=False)
        input_ids = encoded["input_ids"]
        if len(input_ids) > max_length:
            raise ValueError("Complete training target exceeds maxLength; do not truncate labels")
        if input_ids[:len(prompt_ids)] != prompt_ids:
            raise ValueError("Chat template prompt is not a token prefix of the full conversation")
        prompt_length = len(prompt_ids)
        labels = [-100] * prompt_length + list(input_ids[prompt_length:])
        target_tokens = sum(token != -100 for token in labels)
        return {
            "input_ids": input_ids,
            "attention_mask": encoded["attention_mask"],
            "labels": labels,
            "input_token_count": len(input_ids),
            "target_token_count": target_tokens,
        }

    tokenized = dataset.map(
        encode,
        remove_columns=dataset["train"].column_names,
        desc="Tokenizing with assistant-only loss",
    )
    stats: dict[str, Any] = {}
    for split in ("train", "validation"):
        target_counts = list(tokenized[split]["target_token_count"])
        input_counts = list(tokenized[split]["input_token_count"])
        if not target_counts or min(target_counts) <= 0:
            raise RuntimeError(
                f"{split} contains a row with zero assistant target tokens; increase maxLength"
            )
        stats[split] = {
            "rows": len(target_counts),
            "inputTokens": sum(input_counts),
            "targetTokens": sum(target_counts),
            "minTargetTokens": min(target_counts),
            "maxTargetTokens": max(target_counts),
            "meanTargetTokens": round(sum(target_counts) / len(target_counts), 4),
        }
    tokenized = tokenized.remove_columns(["input_token_count", "target_token_count"])
    return tokenized, stats


def make_training_arguments(
    args: argparse.Namespace, output: Path, use_gradient_checkpointing: bool
) -> TrainingArguments:
    requested: dict[str, Any] = {
        "output_dir": str(output),
        "max_steps": args.steps,
        "per_device_train_batch_size": 1,
        "per_device_eval_batch_size": 1,
        "gradient_accumulation_steps": args.grad_acc,
        "learning_rate": args.learning_rate,
        "logging_steps": args.logging_steps,
        "save_steps": args.save_steps,
        "eval_steps": args.eval_steps,
        "save_strategy": "steps",
        "eval_strategy": "steps",
        "load_best_model_at_end": args.load_best_model_at_end,
        "save_total_limit": 3,
        "fp16": args.precision == "fp16",
        "bf16": args.precision == "bf16",
        "tf32": args.precision == "bf16",
        "optim": "paged_adamw_8bit",
        "gradient_checkpointing": use_gradient_checkpointing,
        "gradient_checkpointing_kwargs": {"use_reentrant": False}
        if use_gradient_checkpointing
        else None,
        "max_grad_norm": 1.0,
        "warmup_ratio": args.warmup_ratio,
        "lr_scheduler_type": "cosine",
        "dataloader_num_workers": 0,
        "dataloader_pin_memory": False,
        "torch_empty_cache_steps": TRAINING_CACHE_CLEAR_STEPS,
        "eval_accumulation_steps": EVALUATION_CACHE_CLEAR_INTERVAL,
        "prediction_loss_only": True,
        "remove_unused_columns": False,
        "report_to": "none",
        "seed": args.seed,
        "data_seed": args.seed,
        "save_only_model": False,
    }
    if args.load_best_model_at_end:
        requested["metric_for_best_model"] = "eval_loss"
        requested["greater_is_better"] = False
    signature = inspect.signature(TrainingArguments.__init__).parameters
    if "eval_strategy" not in signature and "evaluation_strategy" in signature:
        requested["evaluation_strategy"] = requested.pop("eval_strategy")
    missing = [key for key in requested if key not in signature]
    if missing:
        raise RuntimeError(
            f"Installed transformers lacks required production trainer arguments: {missing}"
        )
    return TrainingArguments(**requested)



def _non_finite_gradient_names(model: torch.nn.Module) -> list[str]:
    names = []
    for name, parameter in model.named_parameters():
        if parameter.requires_grad and parameter.grad is not None:
            if not torch.isfinite(parameter.grad).all():
                names.append(name)
                if len(names) >= 8:
                    break
    return names


def _amp_overflow_detected(optimizer: Any) -> bool:
    scaler = getattr(optimizer, "scaler", None)
    if scaler is None:
        return False
    base_optimizer = getattr(optimizer, "optimizer", optimizer)
    state = getattr(scaler, "_per_optimizer_states", {}).get(id(base_optimizer), {})
    found_inf = state.get("found_inf_per_device", {})
    return any(bool(value.detach().item()) for value in found_inf.values())


class AmpNumericalGuardCallback(TrainerCallback):
    """Allow recoverable AMP overflow, but fail closed after unscale."""

    def __init__(self) -> None:
        self.overflow_batches = 0
        self.non_finite_batches = 0
        self.scales: list[float] = []

    def on_pre_optimizer_step(self, _args, _state, control, **kwargs):
        optimizer = kwargs.get("optimizer")
        if _amp_overflow_detected(optimizer):
            self.overflow_batches += 1
            return control
        model = kwargs.get("model")
        if not isinstance(model, torch.nn.Module):
            raise RuntimeError("Trainer did not provide the model for gradient validation")
        non_finite = _non_finite_gradient_names(model)
        if non_finite:
            self.non_finite_batches += 1
            raise FloatingPointError(
                "Non-finite effective gradients after AMP unscale: "
                f"{non_finite}"
            )
        return control

    def on_optimizer_step(self, _args, _state, control, **kwargs):
        optimizer = kwargs.get("optimizer")
        scaler = getattr(optimizer, "scaler", None)
        if scaler is not None:
            current = float(scaler.get_scale())
            self.scales.append(current)
            if current > AMP_MAX_LOSS_SCALE and getattr(scaler, "_scale", None) is not None:
                scaler._scale.fill_(AMP_MAX_LOSS_SCALE)
        return control




class FiniteGradientTrainer(Trainer):
    peak_process_rss = 0

    def _build_accelerator_args(self, **kwargs: Any) -> dict[str, Any]:
        args = super()._build_accelerator_args(**kwargs)
        handlers = list(args.get("kwargs_handlers", []))
        handlers.append(
            GradScalerKwargs(
                init_scale=AMP_INITIAL_LOSS_SCALE,
                growth_interval=AMP_GROWTH_INTERVAL,
            )
        )
        args["kwargs_handlers"] = handlers
        return args

    def create_accelerator_and_postprocess(self) -> None:
        super().create_accelerator_and_postprocess()
        scaler = getattr(self.accelerator, "scaler", None)
        if scaler is not None and float(scaler.get_scale()) > AMP_MAX_LOSS_SCALE:
            scaler._scale.fill_(AMP_MAX_LOSS_SCALE)























    def _record_memory(self) -> None:
        self.peak_process_rss = max(
            self.peak_process_rss, psutil.Process().memory_info().rss
        )

    def training_step(
        self,
        model: torch.nn.Module,
        inputs: dict[str, torch.Tensor | Any],
        num_items_in_batch: torch.Tensor | None = None,
    ) -> torch.Tensor:
        loss = super().training_step(model, inputs, num_items_in_batch)
        self._record_memory()
        if not torch.isfinite(loss).all():
            raise FloatingPointError("Non-finite training loss detected")
        # Effective-gradient checks run in AmpNumericalGuardCallback after unscale.
        # Non-finite gradients detected; refusing to save adapter is enforced by callbacks after unscale.













        return loss

    def evaluate(self, *args: Any, **kwargs: Any) -> dict[str, float]:
        self._evaluation_batch_count = 0
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            gc.collect()
            torch.cuda.empty_cache()
        metrics = super().evaluate(*args, **kwargs)
        self._record_memory()
        for key, value in metrics.items():
            if isinstance(value, (int, float)) and not math.isfinite(value):
                raise FloatingPointError(f"Non-finite evaluation metric: {key}={value}")
        return metrics

    def prediction_step(
        self,
        model: torch.nn.Module,
        inputs: dict[str, torch.Tensor | Any],
        prediction_loss_only: bool,
        ignore_keys: list[str] | None = None,
    ) -> tuple[torch.Tensor | None, torch.Tensor | None, torch.Tensor | None]:
        result = super().prediction_step(
            model, inputs, prediction_loss_only, ignore_keys=ignore_keys
        )
        self._evaluation_batch_count = getattr(self, "_evaluation_batch_count", 0) + 1
        loss = result[0]
        if loss is None or not torch.isfinite(loss).all():
            labels = inputs.get("labels")
            supervised_tokens = (
                int((labels != -100).sum().item())
                if isinstance(labels, torch.Tensor)
                else None
            )
            raise FloatingPointError(
                "Non-finite evaluation loss "
                f"at batch={self._evaluation_batch_count} "
                f"supervisedTokens={supervised_tokens}"
            )
        if (
            torch.cuda.is_available()
            and self._evaluation_batch_count % EVALUATION_CACHE_CLEAR_INTERVAL == 0
        ):
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
            self._record_memory()
            print(
                json.dumps(
                    {
                        "phase": "evaluation-heartbeat",
                        "completedBatches": self._evaluation_batch_count,
                        "processRssBytes": self.peak_process_rss,
                    }
                ),
                flush=True,
            )
        return result


def assert_trainable_weights_finite(model: torch.nn.Module) -> None:
    non_finite = []
    for name, parameter in model.named_parameters():
        if parameter.requires_grad and not torch.isfinite(parameter.detach()).all():
            non_finite.append(name)
            if len(non_finite) >= 8:
                break
    if non_finite:
        raise FloatingPointError(
            f"Non-finite trainable weights detected; adapter is invalid: {non_finite}"
        )


class FiniteWeightCallback(TrainerCallback):
    """Stop before evaluation/save if an optimizer update made LoRA weights invalid."""

    def on_step_end(
        self,
        _args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs: Any,
    ) -> TrainerControl:
        model = kwargs.get("model")
        if not isinstance(model, torch.nn.Module):
            raise RuntimeError("Trainer did not provide the model for finite-weight validation")
        try:
            assert_trainable_weights_finite(model)
        except FloatingPointError as error:
            raise FloatingPointError(
                f"Non-finite trainable weights after optimizer step {state.global_step}"
            ) from error
        return control


def build_callbacks(
    training_config: dict[str, Any], memory_pressure_low_mib: int
) -> list[TrainerCallback]:
    """Build callbacks while preserving legacy early-stopping defaults."""
    callbacks: list[TrainerCallback] = [AmpNumericalGuardCallback()]
    if training_config.get("earlyStoppingEnabled", True):
        callbacks.append(
            EarlyStoppingCallback(
                early_stopping_patience=training_config["earlyStoppingPatience"],
                early_stopping_threshold=float(training_config["earlyStoppingThreshold"]),
            )
        )
    callbacks.extend(
        [MemoryPressurePauseCallback(memory_pressure_low_mib), FiniteWeightCallback()]
    )
    return callbacks



def pause_for_memory_pressure(
    candidate: Path,
    args: argparse.Namespace,
    resume_contract: dict[str, Any],
    details: dict[str, Any],
) -> None:
    observed_step = details.get("globalStep")
    available_mib = details.get("availableMiB")
    observed_at = details.get("observedAt")
    if (
        not isinstance(observed_step, int)
        or isinstance(observed_step, bool)
        or observed_step < 1
        or not isinstance(available_mib, int)
        or isinstance(available_mib, bool)
        or available_mib < 0
        or not isinstance(observed_at, str)
        or not observed_at
        or details.get("thresholdMiB") != args.memory_pressure_low_mib
    ):
        raise RuntimeError("Memory pressure pause details are invalid")
    checkpoint_value = get_last_checkpoint(str(candidate))
    if not checkpoint_value:
        raise RuntimeError(
            "Memory pressure pause requested before a checkpoint was safely written"
        )
    candidate_root = candidate.resolve()
    checkpoint = Path(checkpoint_value).resolve()
    if candidate_root not in checkpoint.parents:
        raise RuntimeError(
            "Memory pressure checkpoint escapes the immutable candidate directory"
        )
    state_path = checkpoint / "trainer_state.json"
    if not state_path.is_file():
        raise FileNotFoundError(
            f"Memory pressure checkpoint has no trainer state: {state_path}"
        )
    state = TrainerState.load_from_json(str(state_path))
    if state.global_step != observed_step:
        raise RuntimeError(
            f"Memory pressure checkpoint step {state.global_step} does not match observed step {observed_step}"
        )
    receipt = {
        "schemaVersion": MEMORY_PRESSURE_RECEIPT_SCHEMA,
        "code": "host-memory-pressure",
        "candidate": {
            "id": args.candidate_id,
            "version": args.candidate_version,
            "path": str(candidate_root),
        },
        "checkpoint": {
            "path": str(checkpoint),
            "globalStep": state.global_step,
            "trainerStateSha256": sha256_file(state_path),
        },
        "memory": {
            "availableMiB": available_mib,
            "pauseThresholdMiB": args.memory_pressure_low_mib,
            "observedAt": observed_at,
        },
        "resumeContract": resume_contract,
        "candidateOnly": True,
        "promotionAllowed": False,
    }
    atomic_write_json(candidate_root / "memory-pressure-pause.json", receipt)
    print(
        json.dumps(
            {
                "phase": "memory-pressure-paused",
                "exitCode": MEMORY_PRESSURE_EXIT_CODE,
                "pause": receipt,
            },
            ensure_ascii=False,
        )
    )
    raise SystemExit(MEMORY_PRESSURE_EXIT_CODE)


def apply_recipe_args(args: argparse.Namespace, recipe: dict[str, Any]) -> None:
    training = recipe["training"]
    args.purpose = recipe["purpose"]
    args.steps = training["maxSteps"]
    args.max_length = training["maxLength"]
    args.rank = training["rank"]
    args.lora_alpha = training["loraAlpha"]
    args.grad_acc = training["gradientAccumulationSteps"]
    args.learning_rate = float(training["learningRate"])
    args.precision = training.get("precision", "fp16")
    args.target_profile = training["targetProfile"]
    args.load_best_model_at_end = training.get("loadBestModelAtEnd", True)
    args.eval_steps = training["evalSteps"]
    args.save_steps = training["saveSteps"]
    args.logging_steps = training["loggingSteps"]
    args.seed = recipe["seed"]
    args.warmup_ratio = float(training.get("warmupRatio", 0.1))
    if not 0 <= args.warmup_ratio < 1:
        raise ValueError("recipe.training.warmupRatio must be >= 0 and < 1")


def finite_history(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in history:
        clean: dict[str, Any] = {}
        for key, value in row.items():
            if isinstance(value, float) and not math.isfinite(value):
                raise FloatingPointError(
                    f"Non-finite training curve value: {key}={value}"
                )
            if isinstance(value, (str, int, float, bool)) or value is None:
                clean[key] = value
        result.append(clean)
    return result


def artifact_hashes(output: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for name in ("adapter_model.safetensors", "adapter_config.json"):
        path = output / name
        if not path.is_file():
            raise FileNotFoundError(
                f"Training did not produce required artifact: {path}"
            )
        result[name] = {"bytes": path.stat().st_size, "sha256": sha256_file(path)}
    return result


def main() -> None:
    args = parse_args()
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    execution_id = args.execution_id or os.environ.get("TOMNY_EXECUTION_ID", "unknown")
    heartbeat_path = args.heartbeat_path or os.environ.get("TOMNY_HEARTBEAT_PATH")
    execution_heartbeat(heartbeat_path, execution_id, "BOOT_00_CONTAINER_ENTRY", gpuRequested=False)
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

    if args.hash_model:
        model_root = Path(args.hash_model).resolve()
        print(
            json.dumps(
                {"model": str(model_root), "contentSha256": sha256_tree(model_root)},
                indent=2,
            )
        )
        return
    if not args.recipe:
        raise ValueError("--recipe is required unless --hash-model is used")
    recipe_path = Path(args.recipe).resolve()
    recipe = validate_recipe(recipe_path)
    recipe_hash = sha256_file(recipe_path)
    apply_recipe_args(args, recipe)
    execution_heartbeat(heartbeat_path, execution_id, "BOOT_01_ARGS_LOADED", recipeSha256=recipe_hash)
    enforce_finite_gradient_smoke_gate(recipe, args)
    verify_finite_gradient_smoke_evidence(recipe, recipe_path, args)
    if args.validate_recipe:
        print(
            json.dumps(
                {
                    "valid": True,
                    "recipe": str(recipe_path),
                    "sha256": sha256_file(recipe_path),
                },
                indent=2,
            )
        )
        return
    require_safe_resume_runtime(args.resume_from)
    execution_heartbeat(heartbeat_path, execution_id, "BOOT_02_RUNLOCK_VERIFIED", resumeFrom=args.resume_from)

    if not args.model or not args.dataset_manifest:
        raise ValueError(
            "--model and --dataset-manifest are required except with --validate-recipe"
        )
    if (
        args.train_limit > 0 or args.validation_limit > 0 or args.allow_low_host_memory
    ) and not args.smoke:
        raise ValueError(
            "Dataset or memory limits require explicit --smoke; production always uses full validation"
        )

    start_time = time.time()
    manifest_path = Path(args.dataset_manifest).resolve()
    dataset_manifest, split_paths = validate_dataset_manifest(
        manifest_path, args.purpose, recipe["baseModel"]
    )
    manifest_hash = sha256_file(manifest_path)
    dataset_binding = recipe["dataset"]
    if manifest_hash != dataset_binding["manifestSha256"]:
        raise ValueError(
            "Dataset manifest SHA-256 does not match the immutable recipe binding"
        )
    if dataset_manifest["datasetId"] != dataset_binding["datasetId"]:
        raise ValueError("Dataset id does not match the recipe binding")
    if dataset_manifest["datasetVersion"] != dataset_binding["datasetVersion"]:
        raise ValueError("Dataset version does not match the recipe binding")




    execution_heartbeat(heartbeat_path, execution_id, "BOOT_03_DATASET_READY", datasetManifestSha256=manifest_hash)

    model_path = Path(args.model).resolve()
    execution_heartbeat(heartbeat_path, execution_id, "BOOT_04_BASE_LOAD_START", modelPath=str(args.model))
    if args.force_failure_phase == "before-model-load":
        raise RuntimeError("forced failure phase: before-model-load")

    base_hash = sha256_tree(model_path)
    if base_hash != recipe["baseModel"]["contentSha256"]:
        raise ValueError(
            "Base-model content hash mismatch: "
            f"expected {recipe['baseModel']['contentSha256']}, got {base_hash}"
        )
    diagnostic_candidate = False
    if args.diagnostic_pre_train_only:
        diagnostic_root = Path(".tmp") / "tomny-diagnostic"
        diagnostic_root.mkdir(parents=True, exist_ok=True)
        candidate = Path(tempfile.mkdtemp(prefix="execution-", dir=diagnostic_root))
        diagnostic_candidate = True
    else:
        candidate = resolve_candidate(args, allow_existing=bool(args.resume_from))


    resume_contract = {
        "purpose": args.purpose,
        "candidateId": args.candidate_id,
        "candidateVersion": args.candidate_version,
        "recipeSha256": recipe_hash,
        "datasetManifestSha256": manifest_hash,
        "trainerImplementationSha256": sha256_file(Path(__file__).resolve()),
        "baseModel": {
            "modelId": recipe["baseModel"]["modelId"],
            "revision": recipe["baseModel"]["revision"],
            "contentSha256": base_hash,
        },
    }
    preflight = {
        "phase": "preflight",
        "purpose": args.purpose,
        "recipeSha256": recipe_hash,
        "datasetManifestSha256": manifest_hash,
        "baseModelContentSha256": base_hash,
        "candidate": str(candidate),
        "fullValidation": args.validation_limit == 0,
        "smokeOnly": args.smoke,
        "resumeContract": resume_contract,
    }
    print(json.dumps(preflight, ensure_ascii=False, indent=2))
    if args.dry_run:
        return

    before = verify_environment(args)
    print(
        json.dumps(
            {"phase": "cuda-preflight", "memory": printable_memory(before)},
            ensure_ascii=False,
            indent=2,
        )
    )
    gc.collect()
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats(0)
    compute_dtype = torch.bfloat16 if args.precision == "bf16" else torch.float16
    model, tokenizer, load_summary = load_text_only_qwen35(str(model_path), compute_dtype)
    execution_heartbeat(heartbeat_path, execution_id, "BOOT_05_BASE_LOAD_DONE", load=load_summary)
    after_load = memory_snapshot()
    print(
        json.dumps(
            {
                "phase": "text-only-load",
                "load": load_summary,
                "memory": printable_memory(after_load),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if load_summary["errorMessages"] or load_summary["mismatchedKeys"]:
        raise RuntimeError(
            f"Checkpoint load is not exact enough for training: {load_summary}"
        )
    if args.load_only:
        return

    model, resolved_targets, use_gradient_checkpointing = attach_lora(model, args)
    warm_start_result = None
    if args.warm_start_adapter:
        if args.resume_from:
            raise ValueError("--warm-start-adapter cannot be combined with --resume-from")
        warm_start_result = load_standalone_adapter(


            model,
            Path(args.warm_start_adapter),
            recipe.get("training", {}).get("parentAdapterSha256", ""),
            44,


        )



    execution_heartbeat(heartbeat_path, execution_id, "BOOT_06_PARENT_ADAPTER_LOAD_DONE", warmStart=warm_start_result)

    trainable_params, total_params = model.get_nb_trainable_parameters()
    print(
        json.dumps(
            {
                "phase": "lora-attached",
                "targets": resolved_targets,
                "rank": args.rank,
                "trainableParams": trainable_params,
                "totalParams": total_params,
                "trainablePercent": round(100 * trainable_params / total_params, 6),
            },
            indent=2,
        )
    )

    dataset = load_dataset(
        "json",
        data_files={
            "train": str(split_paths["train"]),
            "validation": str(split_paths["validation"]),
        },
    )
    dataset = limit_split(dataset, args.train_limit, args.validation_limit, args.seed)
    tokenized, token_stats = tokenize_dataset(dataset, tokenizer, args.max_length)






    receipt_path = candidate / "training_preflight.json"
    if args.resume_from:
        completed = candidate / "training_manifest.json"
        if completed.exists():
            raise FileExistsError(
                f"Completed immutable candidate cannot be resumed: {candidate}"
            )
        receipt = load_json_object(receipt_path, "training preflight receipt")
        if receipt.get("schemaVersion") != "tomny.training-preflight.v1":
            raise ValueError("Checkpoint preflight receipt schema is unsupported")
        if receipt.get("resumeContract") != resume_contract:
            raise ValueError(
                "Checkpoint resume contract differs from recipe, dataset, base, purpose, or candidate"
            )
        if args.resume_from == "latest":
            resume_checkpoint = get_last_checkpoint(str(candidate))
            if not resume_checkpoint:
                raise FileNotFoundError(f"No checkpoint exists under {candidate}")
        else:
            resume_checkpoint = str(Path(args.resume_from).resolve())
            checkpoint_path = Path(resume_checkpoint)
            if candidate not in checkpoint_path.parents or not checkpoint_path.is_dir():
                raise ValueError(
                    "--resume-from must be a checkpoint directory inside this candidate"
                )
    else:
        candidate.mkdir(parents=True, exist_ok=True)
        receipt = {
            "schemaVersion": "tomny.training-preflight.v1",
            "createdAt": datetime.now(UTC).isoformat(),
            "resumeContract": resume_contract,
        }
        with receipt_path.open("x", encoding="utf-8") as handle:
            json.dump(receipt, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        resume_checkpoint = None

    collator = DataCollatorForSeq2Seq(
        tokenizer=tokenizer,
        model=None,
        padding=True,
        pad_to_multiple_of=8,
        label_pad_token_id=-100,
        return_tensors="pt",
    )
    training_args = make_training_arguments(args, candidate, use_gradient_checkpointing)
    callbacks = build_callbacks(recipe["training"], args.memory_pressure_low_mib)



    memory_pressure = next(callback for callback in callbacks if isinstance(callback, MemoryPressurePauseCallback))
    trainer = FiniteGradientTrainer(
        model=model,
        args=training_args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized["validation"],
        data_collator=collator,
        callbacks=callbacks,


    )
    execution_heartbeat(heartbeat_path, execution_id, "BOOT_07_TRAINER_CONSTRUCTED", trainableParams=trainable_params, totalParams=total_params)
    if args.force_failure_phase == "after-trainer-construction":
        raise RuntimeError("forced failure phase: post-trainer-construction")


    if args.diagnostic_pre_train_only:
        execution_heartbeat(heartbeat_path, execution_id, "BOOT_08_READY_BEFORE_TRAIN", optimizerSteps=0, trainerTrainCalled=False)
        execution_success_receipt(heartbeat_path, execution_id, optimizer_steps=0)
        if diagnostic_candidate:
            shutil.rmtree(candidate)


        print(json.dumps({"diagnosticPreTrainOnly": True, "optimizerSteps": 0}, indent=2), flush=True)
        return

    safe_finalization_state = (
        load_safe_finalization_state(model, resume_checkpoint, args.steps)
        if resume_checkpoint
        else None
    )
    if safe_finalization_state is not None:
        trainer.state = safe_finalization_state
        train_metrics = {
            "safeFinalization": True,
            "sourceGlobalStep": safe_finalization_state.global_step,
            "train_loss": reconstruct_logged_train_loss(safe_finalization_state),
        }
    else:
        try:
            execution_heartbeat(heartbeat_path, execution_id, "BOOT_08_READY_BEFORE_TRAIN", optimizerSteps=trainer.state.global_step, trainerTrainCalled=False)

            train_result = trainer.train(resume_from_checkpoint=resume_checkpoint)
        except MemoryPressurePause as error:
            pause_for_memory_pressure(candidate, args, resume_contract, error.details)
        train_metrics = dict(train_result.metrics)
    if memory_pressure.details is not None:
        pause_for_memory_pressure(
            candidate, args, resume_contract, memory_pressure.details
        )
    final_eval_pressure = observe_memory_pressure(
        args.memory_pressure_low_mib, trainer.state.global_step
    )
    if final_eval_pressure is not None:
        pause_for_memory_pressure(candidate, args, resume_contract, final_eval_pressure)

    assert_trainable_weights_finite(model)
    eval_metrics = dict(trainer.evaluate())
    if memory_pressure.details is not None:
        pause_for_memory_pressure(
            candidate, args, resume_contract, memory_pressure.details
        )
    eval_loss = eval_metrics.get("eval_loss")
    if not isinstance(eval_loss, (int, float)) or not math.isfinite(eval_loss):
        raise FloatingPointError("Final validation loss is missing or non-finite")
    best_metric = trainer.state.best_metric
    if args.load_best_model_at_end:
        if not isinstance(best_metric, (int, float)) or not math.isfinite(best_metric):
            raise RuntimeError("Best-model selection produced no finite eval_loss")
        configured_regression = float(recipe["training"].get("maxValidationRegression", 0.0))
        numeric_tolerance = validation_tolerance(best_metric)
        maximum = best_metric + configured_regression + numeric_tolerance
        if validation_regressed(eval_loss, best_metric, configured_regression):
            raise RuntimeError(
                f"Validation regression: final eval_loss={eval_loss} exceeds allowed {maximum}"
            )
        validation_gate = {
            "enabled": True,
            "configuredRegression": configured_regression,
            "numericTolerance": numeric_tolerance,
            "observedDelta": eval_loss - best_metric,
            "allowedMaximum": maximum,
            "policy": "absolute-or-relative-floating-point-tolerance",
        }
    else:
        best_metric = None
        validation_gate = {
            "enabled": False,
            "policy": "observational-only; final epoch state is retained",
        }

    finalization_evidence = None
    if safe_finalization_state is not None and resume_checkpoint is not None:
        checkpoint_path = Path(resume_checkpoint).resolve()
        finalization_evidence = {
            "mode": "checkpoint-eval-only",
            "sourceStep": safe_finalization_state.global_step,
            "sourceCheckpoint": str(checkpoint_path),
            "sourceAdapterSha256": sha256_file(
                checkpoint_path / "adapter_model.safetensors"
            ),
            "trainerStateSha256": sha256_file(checkpoint_path / "trainer_state.json"),
            "unsafeStateLoaded": False,
            "optimizerStepsExecuted": 0,
        }

    model.save_pretrained(candidate, safe_serialization=True)
    tokenizer.save_pretrained(candidate)
    assert_trainable_weights_finite(model)
    artifacts = artifact_hashes(candidate)
    after_training = memory_snapshot()
    curves = finite_history(trainer.state.log_history)
    data_domain = dataset_manifest["domains"][args.purpose]
    manifest = {
        "schemaVersion": "tomny.training-provenance.v2",
        "completed": True,
        "status": "candidate",
        "candidate": {
            "id": args.candidate_id,
            "version": args.candidate_version,
            "path": str(candidate),
        },
        "baseModel": {
            "modelId": recipe["baseModel"]["modelId"],
            "revision": recipe["baseModel"]["revision"],
            "contentSha256": base_hash,
            "path": str(model_path),
        },
        "modelClass": model.base_model.model.__class__.__name__
        if hasattr(model, "base_model")
        else model.__class__.__name__,
        "textOnly": True,
        "purpose": args.purpose,
        "recipe": {"path": str(recipe_path), "sha256": recipe_hash, "content": recipe},
        "preflightReceipt": {
            "path": str(receipt_path),
            "sha256": sha256_file(receipt_path),
        },
        "steps": trainer.state.global_step,
        "maxLength": args.max_length,
        "precision": args.precision,
        "rank": args.rank,
        "loraAlpha": args.lora_alpha,
        "targetProfile": args.target_profile,
        "targetModules": resolved_targets,
        "qualityLimitations": recipe["qualityLimitations"],
        "trainableParams": trainable_params,
        "totalParams": total_params,
        "trainRows": len(tokenized["train"]),
        "validationRows": len(tokenized["validation"]),
        "fullValidation": args.validation_limit == 0,
        "smokeOnly": args.smoke,
        "metrics": {
            "train": train_metrics,
            "validation": eval_metrics,
            "bestEvalLoss": best_metric,
        },
        "validationGate": validation_gate,
        "finalization": finalization_evidence,
        "curves": curves,
        "tokenStats": token_stats,
        "data": {
            "manifestPath": str(manifest_path),
            "manifestSha256": sha256_file(manifest_path),
            "datasetId": dataset_manifest["datasetId"],
            "datasetVersion": dataset_manifest["datasetVersion"],
            "reviewerStatus": dataset_manifest["dataCard"]["reviewerStatus"],
            "outputSchema": data_domain["outputSchema"],
            "train": {
                "path": str(split_paths["train"]),
                "sha256": sha256_file(split_paths["train"]),
                "bytes": split_paths["train"].stat().st_size,
            },
            "validation": {
                "path": str(split_paths["validation"]),
                "sha256": sha256_file(split_paths["validation"]),
                "bytes": split_paths["validation"].stat().st_size,
            },
            "testAccessed": False,
        },
        "syntheticDataOnly": all(
            source.get("kind", "").startswith("synthetic")
            for source in dataset_manifest["dataCard"]["sources"]
        ),
        "artifacts": artifacts,
        "provenance": {
            "seed": args.seed,
            "git": git_provenance(),
            "packages": package_versions(),
            "python": sys.version,
            "platform": platform.platform(),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(0),
        },
        "memory": {
            "before": printable_memory(before),
            "afterLoad": printable_memory(after_load),
            "afterTraining": printable_memory(after_training),
            "peakProcessRss": trainer.peak_process_rss,
            "peakGpuAllocated": torch.cuda.max_memory_allocated(0),
            "peakGpuReserved": torch.cuda.max_memory_reserved(0),
        },
        "createdAt": datetime.now(UTC).isoformat(),
        "elapsedSeconds": round(time.time() - start_time, 3),
    }
    manifest_path_out = candidate / "training_manifest.json"
    manifest_path_out.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    verifier = Path(__file__).with_name("verify_adapters.py")
    verification_path = candidate / "verification-report.json"
    subprocess.run(
        [
            sys.executable,
            str(verifier),
            str(candidate),
            "--output",
            str(verification_path),
        ],
        check=True,
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))



def run_with_failure_receipt() -> None:
    args = parse_args()
    execution_id = args.execution_id or os.environ.get("TOMNY_EXECUTION_ID", "unknown")
    heartbeat_path = args.heartbeat_path or os.environ.get("TOMNY_HEARTBEAT_PATH")
    try:
        main()
    except Exception as error:
        execution_failure_receipt(heartbeat_path, execution_id, error)
        raise

if __name__ == "__main__":
    run_with_failure_receipt()
