from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import queue as thread_queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO
import psutil

REPO_ROOT = Path(__file__).resolve().parents[2]
TRAINER = REPO_ROOT / "scripts" / "model-training" / "train_lora.py"
BASE_MODELS = {
    "security": REPO_ROOT / ".local-models" / "Qwen3.5-0.8B",
    "user-understanding": REPO_ROOT / ".local-models" / "Qwen3.5-2B",
    "orchestrator": REPO_ROOT / ".local-models" / "Qwen3.5-2B",
    "assistant": REPO_ROOT / ".local-models" / "Qwen3.5-2B",
}
DATASET_MANIFEST = REPO_ROOT / ".training-data-v4-balanced" / "manifest.json"
CANDIDATE_ROOT = REPO_ROOT / ".model-adapters" / "candidates"
QUEUE_ROOT = CANDIDATE_ROOT / "_queue"
EXPECTED_DATASET_SHA256 = "36fb132493dc2090daefb066158b63bc8a99722a9dabb4a0eb46632a1d1fbcb5"
BASE_BINDINGS = {
    "security": {
        "modelId": "Qwen/Qwen3.5-0.8B",
        "revision": "2fc06364715b967f1860aea9cf38778875588b17",
        "contentSha256": "ff3a07808a9e83627e69a07131fdec45c60973f23cc5617204d173461ec65fe6",
    },
    "user-understanding": {
        "modelId": "Qwen/Qwen3.5-2B",
        "revision": "15852e8c16360a2fea060d615a32b45270f8a8fc",
        "contentSha256": "f6656ba07f0a996924643f29c971be830b87cfbeea8254d6029b0e98a2a1c8dd",
    },
}
BASE_BINDINGS["orchestrator"] = BASE_BINDINGS["user-understanding"]
BASE_BINDINGS["assistant"] = BASE_BINDINGS["user-understanding"]
QUEUE = [
    {
        "purpose": "security",
        "recipe": REPO_ROOT / ".training-recipes" / "v4" / "security-rtx3050-v4.json",
        "candidateId": "com.tomny.core.security",
        "recipeSha256": "f88678ff357f0ffe88fc3601441bc17c75cb08098f958e0b4c5d6f8927bcc199",
    },
    {
        "purpose": "user-understanding",
        "recipe": REPO_ROOT / ".training-recipes" / "v4" / "user-understanding-rtx3050-v4.json",
        "candidateId": "com.tomny.core.user-understanding",
        "recipeSha256": "7370ea7d63b9ed88efeef4707e61df9e29b0f6d1a56909c2df7ae229982379f5",
    },
    {
        "purpose": "orchestrator",
        "recipe": REPO_ROOT / ".training-recipes" / "v4" / "orchestrator-rtx3050-v4.json",
        "candidateId": "com.tomny.core.orchestrator",
        "recipeSha256": "6d588143c5553c00d5cfb2c68d4c1defcda311ad2e77ee994ae53ad80479b240",
    },
    {
        "purpose": "assistant",
        "recipe": REPO_ROOT / ".training-recipes" / "v4" / "assistant-rtx3050-v4.json",
        "candidateId": "com.tomny.core.assistant",
        "recipeSha256": "89fd6d26cd0c9d69ea45e1c3c9d00494a26d3e0ec2b584fac2e9ca0b6d7250cc",
    },
]
EXECUTION_PURPOSES = tuple(item["purpose"] for item in QUEUE)
DEFAULT_BLOCKED_PROCESSES = ["valorant.exe", "valorant-win64-shipping.exe"]
SAFE_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


MEMORY_PRESSURE_EXIT_CODE = 75
MEMORY_PRESSURE_RECEIPT_SCHEMA = 'tomny.memory-pressure-pause.v1'
MIN_MEMORY_PRESSURE_FREE_MIB = 1536
DEFAULT_MIN_FREE_HOST_MIB = 3072
CUDA_FATAL_EXIT_CODE = 76
CUDA_FATAL_MARKERS = ('CUDA error:', 'CUDA kernel errors might be asynchronously reported')
TRAINER_HUNG_EXIT_CODE = 77
DEFAULT_TRAINER_OUTPUT_IDLE_TIMEOUT_SECONDS = 300
PROCESS_TERMINATION_TIMEOUT_SECONDS = 10

DEFAULT_STABLE_GATE_SAMPLES = 3

MEMORY_PRESSURE_RESTART_MARGIN_MIB = 512

def public_failure(error: BaseException) -> dict[str, str]:
    """Return bounded failure evidence without exposing exception messages."""
    error_type = type(error).__name__
    if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,127}', error_type) is None:
        error_type = 'Exception'
    return {'code': 'queue-failed', 'type': error_type}


def update_stable_gate_streak(current: int, safe: bool, required: int) -> tuple[int, bool]:
    if required < 2:
        raise ValueError('Stable gate requires at least two consecutive samples')
    streak = current + 1 if safe else 0
    return streak, streak >= required



def adaptive_resume_evidence(
    configured_resume_mib: int,
    pause_threshold_mib: int,
    launch_available_mib: int,
    paused_available_mib: int,
    previous_effective_mib: int,
) -> dict[str, int]:
    values = (
        configured_resume_mib,
        pause_threshold_mib,
        launch_available_mib,
        paused_available_mib,
        previous_effective_mib,
    )
    if any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in values):
        raise ValueError('Adaptive resume evidence values must be non-negative integers')
    if configured_resume_mib <= pause_threshold_mib or previous_effective_mib < configured_resume_mib:
        raise ValueError('Adaptive resume thresholds violate the queue safety contract')
    observed_consumption_mib = max(0, launch_available_mib - paused_available_mib)
    effective_resume_mib = max(
        previous_effective_mib,
        pause_threshold_mib + observed_consumption_mib + MEMORY_PRESSURE_RESTART_MARGIN_MIB,
    )
    return {
        'observedRunConsumptionMiB': observed_consumption_mib,
        'effectiveResumeThresholdMiB': effective_resume_mib,
        'restartMarginMiB': MEMORY_PRESSURE_RESTART_MARGIN_MIB,
    }


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path, label: str) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"Missing {label}: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object: {path}")
    return value


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def append_log(path: Path, event: str, **fields: Any) -> None:
    row = {"at": utc_now(), "event": event, **fields}
    rendered = json.dumps(row, ensure_ascii=False)
    print(rendered, flush=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(rendered + "\n")


def lock_file(handle: BinaryIO, blocking: bool) -> None:
    handle.seek(0)
    if os.name == "nt":
        import msvcrt

        mode = msvcrt.LK_LOCK if blocking else msvcrt.LK_NBLCK
        msvcrt.locking(handle.fileno(), mode, 1)
    else:
        import fcntl

        flags = fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB)
        fcntl.flock(handle.fileno(), flags)


def unlock_file(handle: BinaryIO) -> None:
    handle.seek(0)
    if os.name == "nt":
        import msvcrt

        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl

        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


class QueueLock(AbstractContextManager["QueueLock"]):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle: BinaryIO | None = None

    def __enter__(self) -> "QueueLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+b")
        if self.path.stat().st_size == 0:
            handle.write(b"0")
            handle.flush()
        try:
            lock_file(handle, blocking=False)
        except OSError as error:
            handle.close()
            raise RuntimeError("Another candidate training queue already holds the single-instance lock") from error
        self.handle = handle
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        if self.handle is not None:
            unlock_file(self.handle)
            self.handle.close()
            self.handle = None


def lock_is_held(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size == 0:
        return False
    with path.open("r+b") as handle:
        try:
            lock_file(handle, blocking=False)
        except OSError:
            return True
        unlock_file(handle)
        return False


def parse_nvidia_row(value: str) -> tuple[int, int, int]:
    rows = [row for row in csv.reader(value.splitlines()) if row]
    if not rows or len(rows[0]) < 3:
        raise ValueError("nvidia-smi returned no GPU telemetry")
    free_vram, temperature, utilization = (int(part.strip()) for part in rows[0][:3])
    return free_vram, temperature, utilization


def system_process_names() -> set[str]:
    if os.name == "nt":
        result = subprocess.run(
            ["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, check=False, timeout=15
        )
        if result.returncode != 0:
            raise RuntimeError(f"tasklist failed: {result.stderr.strip()}")
        return {row[0].strip().lower() for row in csv.reader(result.stdout.splitlines()) if row}
    result = subprocess.run(
        ["ps", "-eo", "comm="], capture_output=True, text=True, check=False, timeout=15
    )
    if result.returncode != 0:
        raise RuntimeError(f"process listing failed: {result.stderr.strip()}")
    return {Path(line.strip()).name.lower() for line in result.stdout.splitlines() if line.strip()}


def live_gpu_probe(blocked_names: set[str]) -> dict[str, Any]:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return {"probeOk": False, "error": "nvidia-smi was not found"}
    try:
        telemetry = subprocess.run(
            [
                executable,
                "--query-gpu=memory.free,temperature.gpu,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
        )
        if telemetry.returncode != 0:
            return {"probeOk": False, "error": f"nvidia-smi telemetry failed: {telemetry.stderr.strip()}"}
        free_vram, temperature, utilization = parse_nvidia_row(telemetry.stdout)
        compute = subprocess.run(
            [
                executable,
                "--query-compute-apps=pid,process_name,used_gpu_memory",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
        )
        if compute.returncode != 0:
            return {"probeOk": False, "error": f"nvidia-smi process query failed: {compute.stderr.strip()}"}
        compute_processes = [line.strip() for line in compute.stdout.splitlines() if line.strip()]
        names = system_process_names()
        blocked = sorted(name for name in blocked_names if name in names)
        host_available_mib = int(psutil.virtual_memory().available / 1024**2)
        return {
            "probeOk": True,
            'hostAvailableMiB': host_available_mib,
            'freeVramMiB': free_vram,
            "temperatureC": temperature,
            "gpuUtilizationPercent": utilization,
            "computeProcesses": compute_processes,
            "blockedProcesses": blocked,
        }
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as error:
        return {"probeOk": False, "error": str(error)}


def fixture_gpu_probe(path: Path) -> dict[str, Any]:
    value = read_json(path, "GPU probe fixture")
    required = {
        "probeOk": bool,
        'hostAvailableMiB': int,
        'freeVramMiB': int,
        "temperatureC": int,
        "gpuUtilizationPercent": int,
        "computeProcesses": list,
        "blockedProcesses": list,
    }
    for key, expected_type in required.items():
        if not isinstance(value.get(key), expected_type):
            raise ValueError(f"GPU probe fixture {key} must be {expected_type.__name__}")
    return value


def gate_probe(
    probe: dict[str, Any], args: argparse.Namespace, minimum_host_mib: int | None = None
) -> dict[str, Any]:
    reasons: list[str] = []
    required_host_mib = max(args.min_free_host_mib, minimum_host_mib or 0)
    if probe.get("probeOk") is not True:
        reasons.append(str(probe.get("error", "GPU probe failed")))
    else:
        if probe['hostAvailableMiB'] < required_host_mib:
            reasons.append(
                'free host memory {} MiB is below {} MiB'.format(
                    probe['hostAvailableMiB'], required_host_mib
                )
            )
        if probe['freeVramMiB'] < args.min_free_vram_mib:
            reasons.append(
                f"free VRAM {probe['freeVramMiB']} MiB is below {args.min_free_vram_mib} MiB"
            )
        if probe["temperatureC"] > args.max_temp_c:
            reasons.append(f"GPU temperature {probe['temperatureC']} C exceeds {args.max_temp_c} C")
        if probe["gpuUtilizationPercent"] > args.max_gpu_utilization:
            reasons.append(
                f"GPU utilization {probe['gpuUtilizationPercent']}% exceeds {args.max_gpu_utilization}%"
            )
        if probe["computeProcesses"]:
            reasons.append(f"GPU compute processes are active: {probe['computeProcesses']}")
        if probe["blockedProcesses"]:
            reasons.append(f"blocked GPU applications are active: {probe['blockedProcesses']}")
    return {
        "safe": not reasons,
        "reasons": reasons,
        "probe": probe,
        'requiredHostMiB': required_host_mib,
    }


def current_gate(args: argparse.Namespace, minimum_host_mib: int | None = None) -> dict[str, Any]:
    if args.probe_json:
        if not (args.dry_run or args.status):
            raise ValueError("--probe-json is restricted to --dry-run or --status")
        probe = fixture_gpu_probe(Path(args.probe_json))
    else:
        probe = live_gpu_probe(set(args.blocked_process))
    return gate_probe(probe, args, minimum_host_mib)

def validate_queue_contract() -> list[dict[str, Any]]:
    if not TRAINER.is_file() or not all(path.is_dir() for path in BASE_MODELS.values()):
        raise FileNotFoundError("Trainer or a required mixed-topology base model is missing")
    dataset_manifest = read_json(DATASET_MANIFEST, "dataset manifest")
    manifest_hash = sha256_file(DATASET_MANIFEST)
    if manifest_hash != EXPECTED_DATASET_SHA256:
        raise ValueError(f"Dataset manifest hash changed: {manifest_hash}")
    plans: list[dict[str, Any]] = []
    for item in QUEUE:
        recipe = read_json(item["recipe"], f"{item['purpose']} recipe")
        if recipe.get("purpose") != item["purpose"]:
            raise ValueError(f"Recipe purpose mismatch: {item['recipe']}")
        if recipe.get("promotionStatus") != "candidate-only":
            raise ValueError(f"Recipe is not candidate-only: {item['recipe']}")
        if recipe.get("dataset", {}).get("manifestSha256") != EXPECTED_DATASET_SHA256:
            raise ValueError(f"Recipe dataset binding mismatch: {item['recipe']}")
        expected_base = BASE_BINDINGS[item["purpose"]]
        if recipe.get("baseModel") != expected_base:
            raise ValueError(f"Recipe base binding mismatch: {item['recipe']}")
        if dataset_manifest.get("domains", {}).get(item["purpose"], {}).get("baseBinding") != expected_base:
            raise ValueError(f"Dataset base binding mismatch: {item['purpose']}")
        if recipe.get("hardwareProfile", {}).get("sequentialOnly") is not True:
            raise ValueError(f"Recipe does not require sequential execution: {item['recipe']}")
        actual_recipe_hash = sha256_file(item["recipe"])
        if actual_recipe_hash != item["recipeSha256"]:
            raise ValueError(f"Pinned recipe SHA-256 mismatch: {item['recipe']}")
        plans.append({**item, "recipe": str(item["recipe"])})
    return plans


def latest_checkpoint(candidate: Path) -> Path | None:
    checkpoints: list[tuple[int, Path]] = []
    for path in candidate.glob("checkpoint-*"):
        if path.is_dir():
            try:
                checkpoints.append((int(path.name.split("-", 1)[1]), path))
            except (IndexError, ValueError):
                continue
    return max(checkpoints, default=(0, None), key=lambda item: item[0])[1]


def checkpoint_progress(checkpoint: Path) -> dict[str, Any]:
    try:
        directory_step = int(checkpoint.name.split('-', 1)[1])
    except (IndexError, ValueError) as error:
        raise ValueError(f'Checkpoint directory has no numeric step: {checkpoint}') from error
    state_path = checkpoint / 'trainer_state.json'
    weights_path = checkpoint / 'adapter_model.safetensors'
    state = read_json(state_path, 'checkpoint trainer state')
    global_step = state.get('global_step')
    max_steps = state.get('max_steps')
    if (
        not isinstance(global_step, int)
        or isinstance(global_step, bool)
        or global_step != directory_step
        or not isinstance(max_steps, int)
        or isinstance(max_steps, bool)
        or max_steps < global_step
    ):
        raise ValueError(f'Checkpoint progress is internally inconsistent: {checkpoint}')
    if not weights_path.is_file():
        raise FileNotFoundError(f'Checkpoint adapter weights are missing: {weights_path}')
    return {
        'path': str(checkpoint.resolve()),
        'globalStep': global_step,
        'maxSteps': max_steps,

        'remainingSteps': max_steps - global_step,
        'completedPercent': round(100 * global_step / max_steps, 2),
        'trainerStateSha256': sha256_file(state_path),
        'adapterSha256': sha256_file(weights_path),
    }


def expected_resume_contract(item: dict[str, Any], version: str) -> dict[str, Any]:
    return {
        "purpose": item["purpose"],
        "candidateId": item["candidateId"],
        "candidateVersion": version,
        "recipeSha256": item["recipeSha256"],
        "datasetManifestSha256": EXPECTED_DATASET_SHA256,
        "trainerImplementationSha256": sha256_file(TRAINER),
        "baseModel": BASE_BINDINGS[item["purpose"]],
    }


def verify_resume_receipt(candidate: Path, item: dict[str, Any], version: str) -> None:
    receipt = read_json(candidate / "training_preflight.json", "training preflight receipt")
    if receipt.get("schemaVersion") != "tomny.training-preflight.v1":
        raise ValueError(f"Unsupported checkpoint preflight receipt: {candidate}")
    if receipt.get("resumeContract") != expected_resume_contract(item, version):
        raise ValueError(f"Checkpoint resume contract mismatch: {candidate}")


def verify_memory_pressure_pause_receipt(
    candidate: Path, item: dict[str, Any], version: str
) -> dict[str, Any]:
    receipt = read_json(candidate / 'memory-pressure-pause.json', 'memory pressure pause receipt')
    if receipt.get('schemaVersion') != MEMORY_PRESSURE_RECEIPT_SCHEMA:
        raise ValueError(f'Unsupported memory pressure pause receipt: {candidate}')
    if receipt.get('code') != 'host-memory-pressure':
        raise ValueError(f'Memory pressure pause receipt has an invalid code: {candidate}')
    expected_candidate = {
        'id': item['candidateId'],
        'version': version,
        'path': str(candidate.resolve()),
    }
    if receipt.get('candidate') != expected_candidate:
        raise ValueError(f'Memory pressure pause candidate binding mismatch: {candidate}')
    if receipt.get('resumeContract') != expected_resume_contract(item, version):
        raise ValueError(f'Memory pressure pause resume contract mismatch: {candidate}')
    if receipt.get('candidateOnly') is not True or receipt.get('promotionAllowed') is not False:
        raise ValueError(f'Memory pressure pause receipt must remain candidate-only: {candidate}')
    memory = receipt.get('memory')
    if not isinstance(memory, dict):
        raise ValueError(f'Memory pressure pause receipt has no memory evidence: {candidate}')
    available_mib = memory.get('availableMiB')
    threshold_mib = memory.get('pauseThresholdMiB')
    observed_at = memory.get('observedAt')
    if (
        not isinstance(available_mib, int)
        or isinstance(available_mib, bool)
        or available_mib < 0
        or not isinstance(threshold_mib, int)
        or isinstance(threshold_mib, bool)
        or threshold_mib < MIN_MEMORY_PRESSURE_FREE_MIB
        or not isinstance(observed_at, str)
        or not observed_at
    ):
        raise ValueError(f'Memory pressure pause receipt has invalid memory evidence: {candidate}')
    checkpoint_record = receipt.get('checkpoint')
    if not isinstance(checkpoint_record, dict):
        raise ValueError(f'Memory pressure pause receipt has no checkpoint evidence: {candidate}')
    checkpoint_value = checkpoint_record.get('path')
    global_step = checkpoint_record.get('globalStep')
    trainer_state_hash = checkpoint_record.get('trainerStateSha256')
    if (
        not isinstance(checkpoint_value, str)
        or not checkpoint_value
        or not isinstance(global_step, int)
        or isinstance(global_step, bool)
        or global_step < 1
        or not isinstance(trainer_state_hash, str)
        or len(trainer_state_hash) != 64
    ):
        raise ValueError(f'Memory pressure pause receipt has invalid checkpoint evidence: {candidate}')
    checkpoint = Path(checkpoint_value).resolve()
    latest = latest_checkpoint(candidate)
    if candidate.resolve() not in checkpoint.parents or latest is None or checkpoint != latest.resolve():
        raise ValueError(f'Memory pressure pause checkpoint is not the latest candidate checkpoint: {candidate}')
    progress = checkpoint_progress(checkpoint)
    if progress['globalStep'] != global_step:
        raise ValueError(f'Memory pressure pause checkpoint progress mismatch: {candidate}')
    state_path = checkpoint / 'trainer_state.json'
    if not state_path.is_file() or sha256_file(state_path) != trainer_state_hash:
        raise ValueError(f'Memory pressure pause trainer state hash mismatch: {candidate}')
    state = read_json(state_path, 'memory pressure checkpoint trainer state')
    state_step = state.get('global_step')
    if not isinstance(state_step, int) or isinstance(state_step, bool) or state_step != global_step:
        raise ValueError(f'Memory pressure pause checkpoint step mismatch: {candidate}')
    return receipt


def candidate_plan(item: dict[str, Any], version: str) -> dict[str, Any]:
    candidate = CANDIDATE_ROOT / item["candidateId"] / version
    manifest_path = candidate / "training_manifest.json"
    if manifest_path.is_file():
        manifest = read_json(manifest_path, "training manifest")
        if manifest.get("completed") is not True:
            raise ValueError(f"Candidate manifest exists but is not completed: {manifest_path}")
        verify_completed_candidate(candidate)
        return {"action": "skip-completed", "candidate": str(candidate), "command": None}
    checkpoint = latest_checkpoint(candidate) if candidate.exists() else None
    resume_checkpoint: dict[str, Any] | None = None
    if candidate.exists() and checkpoint is None and any(candidate.iterdir()):
        raise RuntimeError(f"Incomplete candidate has no resumable checkpoint: {candidate}")
    command = [
        sys.executable,
        str(TRAINER),
        "--recipe",
        str(item["recipe"]),
        "--model",
        str(BASE_MODELS[item["purpose"]]),
        "--dataset-manifest",
        str(DATASET_MANIFEST),
        "--candidate-id",
        item["candidateId"],
        "--candidate-version",
        version,
    ]
    action = "train-new"
    if checkpoint is not None:
        verify_resume_receipt(candidate, item, version)
        pause_receipt = verify_memory_pressure_pause_receipt(candidate, item, version)
        exact_checkpoint = Path(pause_receipt['checkpoint']['path']).resolve()
        resume_checkpoint = checkpoint_progress(exact_checkpoint)
        command.extend(["--resume-from", str(exact_checkpoint)])
        action = "resume-paused-checkpoint"
    return {
        "action": action,
        "candidate": str(candidate),
        "command": command,
        'resumeCheckpoint': resume_checkpoint,
    }

def resolve_execution_plans(
    plans: list[dict[str, Any]], version: str, start_at: str | None
) -> list[dict[str, Any]]:
    start_index = EXECUTION_PURPOSES.index(start_at) if start_at is not None else 0
    resolved: list[dict[str, Any]] = []
    for index, item in enumerate(plans):
        plan = candidate_plan(item, version)
        if index < start_index and plan['action'] != 'skip-completed':
            raise RuntimeError(
                f"Cannot start at {start_at}: earlier candidate {item['purpose']} is not completed"
            )
        resolved.append({**item, **plan})
    return resolved

def load_latest_status() -> dict[str, Any] | None:
    latest = QUEUE_ROOT / "latest.json"
    if not latest.is_file():
        return None
    return read_json(latest, "latest queue status")


def write_run_status(run_dir: Path, status: dict[str, Any]) -> None:
    status["updatedAt"] = utc_now()
    atomic_write_json(run_dir / "status.json", status)
    atomic_write_json(
        QUEUE_ROOT / "latest.json",
        {
            "runId": status["runId"],
            "state": status["state"],
            "updatedAt": status["updatedAt"],
            "statusPath": str((run_dir / "status.json").resolve()),
        },
    )


def wait_for_safe_gpu(
    args: argparse.Namespace,
    status: dict[str, Any],
    run_dir: Path,
    minimum_host_mib: int | None = None,
) -> dict[str, Any]:
    started = time.monotonic()
    stable_samples = 0
    while True:
        gate = current_gate(args, minimum_host_mib)
        stable_samples, stable = update_stable_gate_streak(
            stable_samples, gate['safe'], args.stable_gate_samples
        )
        gate['stableSamplesObserved'] = stable_samples
        gate['stableSamplesRequired'] = args.stable_gate_samples
        status['gpuGate'] = gate
        if gate['safe'] and stable:
            write_run_status(run_dir, status)
            return gate
        if gate['safe']:
            status['state'] = 'waiting-for-gpu-stability'
            write_run_status(run_dir, status)
            append_log(
                run_dir / 'queue.log',
                'gpu-stabilizing',
                stableSamplesObserved=stable_samples,
                stableSamplesRequired=args.stable_gate_samples,
            )
        else:
            status['state'] = 'waiting-for-gpu'
            write_run_status(run_dir, status)
            append_log(run_dir / 'queue.log', 'gpu-wait', reasons=gate['reasons'])
        if args.no_wait:
            if gate['safe']:
                raise RuntimeError(
                    'GPU safety gate did not reach the required consecutive stable samples: '
                    f'{stable_samples}/{args.stable_gate_samples}'
                )
            raise RuntimeError(f"GPU safety gate refused execution: {gate['reasons']}")
        if args.max_wait_seconds > 0 and time.monotonic() - started >= args.max_wait_seconds:
            if gate['safe']:
                raise TimeoutError(
                    'GPU safety stability wait timed out: '
                    f'{stable_samples}/{args.stable_gate_samples} consecutive samples'
                )
            raise TimeoutError(f"GPU safety wait timed out: {gate['reasons']}")
        time.sleep(args.poll_seconds)

def memory_pressure_command(
    command: list[str], args: argparse.Namespace, resume_checkpoint: Path | None
) -> list[str]:
    guarded = list(command)
    if '--memory-pressure-low-mib' in guarded:
        raise RuntimeError('Queue command already declares a memory pressure threshold')
    declared_resume = False
    while '--resume-from' in guarded:
        resume_index = guarded.index('--resume-from')
        if resume_index + 1 >= len(guarded):
            raise RuntimeError('Queue command has an incomplete resume argument')
        declared_resume = True
        del guarded[resume_index : resume_index + 2]
    if declared_resume and resume_checkpoint is None:
        raise RuntimeError('Queue resume command is missing verified checkpoint evidence')
    if resume_checkpoint is not None:
        checkpoint = resume_checkpoint.resolve()
        if not checkpoint.is_dir():
            raise FileNotFoundError(f'Queue resume checkpoint is unavailable: {checkpoint}')
        guarded.extend(['--resume-from', str(checkpoint)])
    guarded.extend(['--memory-pressure-low-mib', str(args.pause_free_host_mib)])
    return guarded


def memory_recovery_gate(
    args: argparse.Namespace, required_mib: int | None = None
) -> dict[str, Any]:
    available_mib = int(psutil.virtual_memory().available / 1024**2)
    threshold_mib = max(args.resume_free_host_mib, required_mib or 0)
    reasons: list[str] = []
    if available_mib < threshold_mib:
        reasons.append(
            f'free host memory {available_mib} MiB is below memory-pressure resume threshold '
            f'{threshold_mib} MiB'
        )
    return {
        'safe': not reasons,
        'reasons': reasons,
        'hostAvailableMiB': available_mib,
        'requiredMiB': threshold_mib,
    }


def wait_for_memory_recovery(
    args: argparse.Namespace,
    status: dict[str, Any],
    run_dir: Path,
    adapter: dict[str, Any],
    pressure: dict[str, Any],
) -> bool:
    started = time.monotonic()
    log_path = run_dir / 'queue.log'
    stable_samples = 0
    effective_resume_mib = pressure.get('effectiveResumeThresholdMiB')
    if (
        not isinstance(effective_resume_mib, int)
        or isinstance(effective_resume_mib, bool)
        or effective_resume_mib < args.resume_free_host_mib
    ):
        raise RuntimeError('Memory pressure state has an invalid effective resume threshold')
    while True:
        gate = memory_recovery_gate(args, effective_resume_mib)
        stable_samples, stable = update_stable_gate_streak(
            stable_samples, gate['safe'], args.stable_gate_samples
        )
        pressure['lastCheckedAt'] = utc_now()
        pressure['hostAvailableMiB'] = gate['hostAvailableMiB']
        pressure['resumeGateReasons'] = gate['reasons']
        pressure['stableSamplesObserved'] = stable_samples
        pressure['stableSamplesRequired'] = args.stable_gate_samples
        status['memoryPressure'] = pressure
        adapter['memoryPressure'] = pressure
        if gate['safe'] and stable:
            write_run_status(run_dir, status)
            append_log(
                log_path,
                'memory-recovered',
                code='host-memory-pressure',
                hostAvailableMiB=gate['hostAvailableMiB'],
                resumeThresholdMiB=gate['requiredMiB'],
                stableSamplesObserved=stable_samples,
                stableSamplesRequired=args.stable_gate_samples,
            )
            return True
        adapter['state'] = 'paused-memory-pressure'
        if gate['safe']:
            status['state'] = 'waiting-for-memory-stability'
            write_run_status(run_dir, status)
            append_log(
                log_path,
                'memory-recovery-stabilizing',
                code='host-memory-pressure',
                hostAvailableMiB=gate['hostAvailableMiB'],
                resumeThresholdMiB=gate['requiredMiB'],
                stableSamplesObserved=stable_samples,
                stableSamplesRequired=args.stable_gate_samples,
            )
        else:
            status['state'] = 'waiting-for-memory-recovery'
            write_run_status(run_dir, status)
            append_log(
                log_path,
                'memory-recovery-wait',
                code='host-memory-pressure',
                hostAvailableMiB=gate['hostAvailableMiB'],
                resumeThresholdMiB=gate['requiredMiB'],
                reasons=gate['reasons'],
            )
        timed_out = args.max_wait_seconds > 0 and time.monotonic() - started >= args.max_wait_seconds
        if args.no_wait or timed_out:
            status['state'] = 'paused-memory-pressure'
            adapter['state'] = 'paused-memory-pressure'
            write_run_status(run_dir, status)
            append_log(
                log_path,
                'queue-paused-memory-pressure',
                code='host-memory-pressure',
                noWait=args.no_wait,
                timedOut=timed_out,
                reasons=gate['reasons'],
                stableSamplesObserved=stable_samples,
                stableSamplesRequired=args.stable_gate_samples,
            )
            return False
        time.sleep(args.poll_seconds)

def fatal_cuda_output(line: str) -> bool:
    return any(marker in line for marker in CUDA_FATAL_MARKERS)


def wait_for_process_exit(process: subprocess.Popen[str], timeout_seconds: int) -> bool:
    try:
        process.wait(timeout=timeout_seconds)
        return True
    except subprocess.TimeoutExpired:
        return False


def terminate_process_tree(process: subprocess.Popen[str]) -> bool:
    if process.poll() is not None:
        return True
    if os.name == 'nt':
        try:
            subprocess.run(
                ['taskkill', '/PID', str(process.pid), '/T', '/F'],
                capture_output=True,
                text=True,
                check=False,
                timeout=PROCESS_TERMINATION_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass
        if wait_for_process_exit(process, PROCESS_TERMINATION_TIMEOUT_SECONDS):
            return True
        try:
            process.kill()
        except OSError:
            pass
        return wait_for_process_exit(process, PROCESS_TERMINATION_TIMEOUT_SECONDS)
    try:
        process.terminate()
    except OSError:
        pass
    if wait_for_process_exit(process, PROCESS_TERMINATION_TIMEOUT_SECONDS):
        return True
    try:
        process.kill()
    except OSError:
        pass
    return wait_for_process_exit(process, PROCESS_TERMINATION_TIMEOUT_SECONDS)


def stream_process_output(
    stream: Any,
    messages: thread_queue.Queue[tuple[str, Any]],
) -> None:
    try:
        for line in stream:
            messages.put(('line', line))
    except BaseException as error:
        messages.put(('error', error))
    finally:
        messages.put(('eof', None))


def run_training(
    command: list[str],
    log_path: Path,
    output_idle_timeout_seconds: int = DEFAULT_TRAINER_OUTPUT_IDLE_TIMEOUT_SECONDS,
) -> int:
    if output_idle_timeout_seconds < 1:
        raise ValueError('Trainer output idle timeout must be positive')
    append_log(log_path, "trainer-start", command=command)
    process = subprocess.Popen(
        command,
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert process.stdout is not None
    messages: thread_queue.Queue[tuple[str, Any]] = thread_queue.Queue()
    reader = threading.Thread(
        target=stream_process_output,
        args=(process.stdout, messages),
        daemon=True,
        name=f'trainer-output-{process.pid}',
    )
    reader.start()
    last_output_at = time.monotonic()
    with log_path.open("a", encoding="utf-8") as handle:
        while True:
            try:
                event, payload = messages.get(timeout=1)
            except thread_queue.Empty:
                if process.poll() is not None and not reader.is_alive():
                    break
                idle_seconds = time.monotonic() - last_output_at
                if idle_seconds >= output_idle_timeout_seconds:
                    terminated = terminate_process_tree(process)
                    append_log(
                        log_path,
                        'trainer-output-timeout',
                        exitCode=TRAINER_HUNG_EXIT_CODE,
                        idleSeconds=round(idle_seconds, 3),
                        timeoutSeconds=output_idle_timeout_seconds,
                        processTerminated=terminated,
                    )
                    return TRAINER_HUNG_EXIT_CODE
                continue
            if event == 'eof':
                break
            if event == 'error':
                terminated = terminate_process_tree(process)
                raise RuntimeError(f'Trainer output reader failed; process terminated={terminated}') from payload
            line = str(payload)
            last_output_at = time.monotonic()
            print(line, end="", flush=True)
            handle.write(line)
            handle.flush()
            if fatal_cuda_output(line):
                terminated = terminate_process_tree(process)
                append_log(
                    log_path,
                    'trainer-cuda-fatal',
                    exitCode=CUDA_FATAL_EXIT_CODE,
                    processTerminated=terminated,
                )
                return CUDA_FATAL_EXIT_CODE
    return process.wait()


def verify_completed_candidate(candidate: Path) -> None:
    manifest = read_json(candidate / "training_manifest.json", "completed training manifest")
    verification = read_json(candidate / "verification-report.json", "candidate verification report")
    if manifest.get("completed") is not True or manifest.get("status") != "candidate":
        raise RuntimeError(f"Trainer did not leave a completed candidate: {candidate}")
    if verification.get("verified") is not True:
        raise RuntimeError(f"Candidate verification failed: {candidate}")
    verifier = Path(__file__).with_name("verify_adapters.py")
    result = subprocess.run(
        [sys.executable, str(verifier), str(candidate), "--output", os.devnull],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=600,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"Full candidate re-verification failed for {candidate}: {detail}")


def run_queue(args: argparse.Namespace, plans: list[dict[str, Any]]) -> None:
    run_id = args.run_id or datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + f"-{uuid.uuid4().hex[:8]}"
    if not SAFE_RUN_ID.fullmatch(run_id):
        raise ValueError("--run-id contains unsafe characters")
    run_dir = QUEUE_ROOT / run_id
    with QueueLock(QUEUE_ROOT / "candidate-queue.lock"):
        if run_dir.exists():
            raise FileExistsError(f"Run status directory already exists: {run_dir}")
        status: dict[str, Any] = {
            "schemaVersion": "tomny.candidate-queue-status.v1",
            "runId": run_id,
            "state": "starting",
            "createdAt": utc_now(),
            "promotionAllowed": False,
            "candidateVersion": args.candidate_version,
            "executionStartAt": args.start_at or EXECUTION_PURPOSES[0],
            "adapters": [
                {"purpose": item["purpose"], "candidateId": item["candidateId"], "recipeSha256": item["recipeSha256"], "baseModel": BASE_BINDINGS[item["purpose"]], "state": "pending"}
                for item in plans
            ],
        }
        write_run_status(run_dir, status)
        log_path = run_dir / "queue.log"
        current_adapter: dict[str, Any] | None = None
        try:
            wait_for_safe_gpu(args, status, run_dir)
            plans = resolve_execution_plans(plans, args.candidate_version, args.start_at)
            for index, item in enumerate(plans):
                adapter = status["adapters"][index]
                current_adapter = adapter
                adapter.update(
                    {
                        "action": item["action"],
                        "candidate": item["candidate"],
                        'resumeCheckpoint': item.get('resumeCheckpoint'),
                    }
                )
                if item["action"] == "skip-completed":
                    adapter["state"] = "skipped-completed"
                    write_run_status(run_dir, status)
                    continue
                wait_for_safe_gpu(args, status, run_dir)
                status["state"] = "running"
                adapter["state"] = "running"
                adapter["startedAt"] = utc_now()
                write_run_status(run_dir, status)
                candidate = Path(item['candidate'])
                initial_resume_checkpoint = (
                    Path(item['resumeCheckpoint']['path']).resolve()
                    if item.get('resumeCheckpoint') is not None
                    else None
                )
                command = memory_pressure_command(item['command'], args, initial_resume_checkpoint)
                pause_count = 0
                effective_resume_mib = args.resume_free_host_mib
                while True:
                    launch_available_mib = int(psutil.virtual_memory().available / 1024**2)
                    exit_code = run_training(
                        command,
                        log_path,
                        output_idle_timeout_seconds=args.trainer_output_idle_timeout_seconds,
                    )
                    if exit_code != MEMORY_PRESSURE_EXIT_CODE:
                        break
                    receipt = verify_memory_pressure_pause_receipt(candidate, item, args.candidate_version)
                    if receipt['memory']['pauseThresholdMiB'] != args.pause_free_host_mib:
                        raise RuntimeError('Memory pressure pause threshold does not match the queue contract')
                    pause_count += 1
                    adaptation = adaptive_resume_evidence(
                        args.resume_free_host_mib,
                        args.pause_free_host_mib,
                        launch_available_mib,
                        receipt['memory']['availableMiB'],
                        effective_resume_mib,
                    )
                    observed_consumption_mib = adaptation['observedRunConsumptionMiB']
                    effective_resume_mib = adaptation['effectiveResumeThresholdMiB']
                    pressure = {
                        'code': receipt['code'],
                        'reason': 'available host RAM fell below the configured pause threshold',
                        'exitCode': MEMORY_PRESSURE_EXIT_CODE,
                        'pauseCount': pause_count,
                        'receiptPath': str(candidate / 'memory-pressure-pause.json'),
                        'checkpoint': receipt['checkpoint'],
                        'memory': receipt['memory'],
                        'launchAvailableMiB': launch_available_mib,
                        'observedRunConsumptionMiB': observed_consumption_mib,
                        'restartMarginMiB': MEMORY_PRESSURE_RESTART_MARGIN_MIB,
                        'configuredResumeThresholdMiB': args.resume_free_host_mib,
                        'effectiveResumeThresholdMiB': effective_resume_mib,
                        'resumeThresholdMiB': effective_resume_mib,
                    }
                    status['state'] = 'paused-memory-pressure'
                    status['memoryPressure'] = pressure
                    adapter['state'] = 'paused-memory-pressure'
                    adapter['pausedAt'] = utc_now()
                    adapter['memoryPressure'] = pressure
                    write_run_status(run_dir, status)
                    append_log(
                        log_path,
                        'trainer-paused-memory-pressure',
                        code=receipt['code'],
                        reason=pressure['reason'],
                        exitCode=MEMORY_PRESSURE_EXIT_CODE,
                        pauseCount=pause_count,
                        availableMiB=receipt['memory']['availableMiB'],
                        pauseThresholdMiB=receipt['memory']['pauseThresholdMiB'],
                        launchAvailableMiB=launch_available_mib,
                        observedRunConsumptionMiB=observed_consumption_mib,
                        configuredResumeThresholdMiB=args.resume_free_host_mib,
                        effectiveResumeThresholdMiB=effective_resume_mib,
                    )
                    if not wait_for_memory_recovery(args, status, run_dir, adapter, pressure):
                        return
                    wait_for_safe_gpu(
                        args,
                        status,
                        run_dir,
                        minimum_host_mib=effective_resume_mib,
                    )
                    status['state'] = 'running'
                    adapter['state'] = 'resuming-memory-pressure'
                    adapter['resumedAt'] = utc_now()
                    write_run_status(run_dir, status)
                    resume_receipt = verify_memory_pressure_pause_receipt(candidate, item, args.candidate_version)
                    resume_checkpoint = Path(resume_receipt['checkpoint']['path']).resolve()
                    adapter['resumeCheckpoint'] = checkpoint_progress(resume_checkpoint)
                    command = memory_pressure_command(item['command'], args, resume_checkpoint)
                # Keep a final post-run failure guard after controlled resumption.
                if exit_code != 0:
                    raise RuntimeError(f"{item['purpose']} trainer exited with code {exit_code}")
                candidate = Path(item["candidate"])
                verify_completed_candidate(candidate)
                adapter["state"] = "completed-candidate"
                adapter["completedAt"] = utc_now()
                write_run_status(run_dir, status)
            status["state"] = "completed-candidates"
            write_run_status(run_dir, status)
            append_log(log_path, "queue-complete", promotionAllowed=False)
        except BaseException as error:
            failure = public_failure(error)
            status["state"] = "failed"
            status["error"] = failure
            if current_adapter is not None:
                current_adapter["state"] = "failed"
                current_adapter["error"] = dict(failure)
                current_adapter["failedAt"] = utc_now()
            write_run_status(run_dir, status)
            append_log(log_path, "queue-failed", error=failure)
            raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the four Tomny candidate-only QLoRA recipes sequentially.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Validate and print plans without locks, writes, or training.")
    mode.add_argument("--status", action="store_true", help="Print latest status, lock state, and current GPU gate without writes.")
    parser.add_argument("--candidate-version", default="0.1.0-candidate.4")
    parser.add_argument("--run-id")
    parser.add_argument("--no-wait", action="store_true", help="Fail instead of waiting when the GPU gate is unsafe.")
    parser.add_argument("--poll-seconds", type=int, default=30)
    parser.add_argument(
        '--stable-gate-samples',
        type=int,
        default=DEFAULT_STABLE_GATE_SAMPLES,
        help='Require this many consecutive safe samples before launch or memory-pressure resume.',
    )
    parser.add_argument("--max-wait-seconds", type=int, default=0, help="0 waits indefinitely.")
    parser.add_argument('--min-free-vram-mib', type=int, default=3000)
    parser.add_argument('--min-free-host-mib', type=int, default=3072)
    parser.add_argument(
        '--pause-free-host-mib',
        type=int,
        default=MIN_MEMORY_PRESSURE_FREE_MIB,
        help='Checkpoint and pause an active trainer below this host-RAM threshold.',
    )
    parser.add_argument(
        '--resume-free-host-mib',
        type=int,
        default=DEFAULT_MIN_FREE_HOST_MIB,
        help='Resume a paused candidate only after host RAM recovers to this threshold.',
    )
    parser.add_argument("--max-temp-c", type=int, default=78)
    parser.add_argument("--max-gpu-utilization", type=int, default=15)
    parser.add_argument("--blocked-process", action="append", default=list(DEFAULT_BLOCKED_PROCESSES))
    parser.add_argument("--probe-json", help="Test fixture; allowed only with --dry-run or --status.")
    parser.add_argument(
        '--trainer-output-idle-timeout-seconds',
        type=int,
        default=DEFAULT_TRAINER_OUTPUT_IDLE_TIMEOUT_SECONDS,
        help='Fail closed when an active trainer emits no heartbeat or log output within this interval.',
    )
    parser.add_argument(
        "--start-at",
        choices=EXECUTION_PURPOSES,
        help='Execute this purpose and later entries; earlier candidates must re-verify as completed.',
    )

    args = parser.parse_args()
    if args.poll_seconds < 1 or args.max_wait_seconds < 0:
        parser.error("poll and wait values are invalid")

    if not 2 <= args.stable_gate_samples <= 60:
        parser.error('stable-gate-samples must be between 2 and 60')
    if args.trainer_output_idle_timeout_seconds < 30:
        parser.error('trainer-output-idle-timeout-seconds must be at least 30')
    if args.min_free_vram_mib < 1 or args.min_free_host_mib < 1 or args.max_temp_c < 1 or not 0 <= args.max_gpu_utilization <= 100:
        parser.error("GPU thresholds are invalid")
    if args.min_free_host_mib < DEFAULT_MIN_FREE_HOST_MIB:
        parser.error('min-free-host-mib cannot lower the 3072 MiB safety gate')
    if args.pause_free_host_mib < MIN_MEMORY_PRESSURE_FREE_MIB:
        parser.error('pause-free-host-mib must be at least 1536 MiB')
    if args.resume_free_host_mib <= args.pause_free_host_mib:
        parser.error('resume-free-host-mib must be greater than the pause threshold')
    if args.resume_free_host_mib < args.min_free_host_mib:
        parser.error('resume-free-host-mib must preserve the launch safety gate')
    if not SAFE_RUN_ID.fullmatch(args.candidate_version):
        parser.error("candidate version contains unsafe characters")
    if args.probe_json and not (args.dry_run or args.status):
        parser.error("--probe-json is restricted to --dry-run or --status")
    return args


def main() -> None:
    args = parse_args()
    plans = validate_queue_contract()
    resolved = resolve_execution_plans(plans, args.candidate_version, args.start_at) if args.status or args.dry_run else plans
    if args.status:
        result = {
            "latest": load_latest_status(),
            "lockHeld": lock_is_held(QUEUE_ROOT / "candidate-queue.lock"),
            "gpuGate": current_gate(args),
            "plans": resolved,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    if args.dry_run:
        gate = current_gate(args)
        result = {"dryRun": True, "gpuGate": gate, "plans": resolved, "promotionAllowed": False}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if not gate["safe"]:
            raise SystemExit(2)
        return
    run_queue(args, plans)


if __name__ == "__main__":
    main()
