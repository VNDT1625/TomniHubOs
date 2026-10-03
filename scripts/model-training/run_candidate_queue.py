from __future__ import annotations

import argparse
import csv
import ctypes
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

try:
    import psutil
except ModuleNotFoundError:
    # The queue must retain its host-memory safety gate even in the minimal
    # bundled Python runtime. `available_host_memory_mib` uses OS primitives
    # below when the optional convenience dependency is absent.
    psutil = None

REPO_ROOT = Path(__file__).resolve().parents[2]
TRAINER = REPO_ROOT / "scripts" / "model-training" / "train_lora.py"
QWEN_08B = REPO_ROOT / ".local-models" / "Qwen3.5-0.8B"
BASE_MODELS = {
    "security": QWEN_08B,
    "user-understanding": QWEN_08B,
    "semantic-analysis": QWEN_08B,
}
DATASET_MANIFEST = REPO_ROOT / ".tmp" / "regenerated-v8" / "manifest.json"
CANDIDATE_ROOT = REPO_ROOT / ".model-adapters" / "candidates"
QUEUE_ROOT = CANDIDATE_ROOT / "_queue"
EXPECTED_DATASET_SHA256 = "82a30f9d72d93f07f3f31e7bb39ef45fd890fca6b05b91c66f922429804c6812"
QWEN_08B_BINDING = {
    "modelId": "Qwen/Qwen3.5-0.8B",
    "revision": "2fc06364715b967f1860aea9cf38778875588b17",
    "contentSha256": "ff3a07808a9e83627e69a07131fdec45c60973f23cc5617204d173461ec65fe6",
}
BASE_BINDINGS = {purpose: QWEN_08B_BINDING for purpose in BASE_MODELS}


QUEUE = [
    {
        "purpose": "security",
        "recipe": REPO_ROOT / ".training-recipes" / "v6" / "security-modal-v8.json",
        "candidateId": "com.tomny.core.security",
        "recipeSha256": "a2907799c91e58ff01a2f60f90df3fbc78d5d03223e8351b684b1938d21527c0",
    },
    {
        "purpose": "user-understanding",
        "recipe": REPO_ROOT / ".training-recipes" / "v6" / "user-understanding-modal-v8.json",
        "candidateId": "com.tomny.core.user-understanding",
        "recipeSha256": "0d665106abc6051b9aa176e510790fa17283fbc75e96ec2af8cd93449a60e528",
    },
    {
        "purpose": "semantic-analysis",
        "recipe": REPO_ROOT / ".training-recipes" / "v6" / "semantic-analysis-modal-v8.json",
        "candidateId": "com.tomny.core.semantic-analysis",
        "recipeSha256": "ea2c488dc73eeb6611e5d4257c755297eade2ffd960f1e3dd2412a2fa92b2bb0",
    },
]
EXECUTION_PURPOSES = tuple(item["purpose"] for item in QUEUE)
DEFAULT_CANDIDATE_VERSION = "0.6.0-candidate.1"
SECURITY_CHECKPOINT_RESUME_PURPOSE = "security"
SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID = "com.tomny.core.security"
SECURITY_CHECKPOINT_RESUME_VERSION = "0.4.0-candidate.1"
SECURITY_CHECKPOINT_RESUME_STEP = 50
SECURITY_CHECKPOINT_RESUME_TERMINAL_STATES = frozenset({"failed", "cancelled"})
SECURITY_STABILITY_CANDIDATE_VERSION = "0.5.0-candidate.1"
SECURITY_STABILITY_SMOKE_VERSION = "0.5.0-stability-smoke.1"
SECURITY_STABILITY_CANCELLED_RESUME_MODE = 'resume-cancelled-security-stability-candidate'
SECURITY_STABILITY_ORPHANED_WAITING_RECOVERY_MODE = (
    'recover-orphaned-waiting-security-stability-candidate'
)
SECURITY_STABILITY_ITEM = {
    "purpose": "security",
    "recipe": REPO_ROOT / ".training-recipes" / "v5" / "security-rtx3050-bf16-production-v5.json",
    "candidateId": "com.tomny.core.security",
    "recipeSha256": "5d339fa2c222c0cae2a5ed09279c38dd703fdae35526eb73d73bd189b60526af",
}
SECURITY_STABILITY_SMOKE_ITEM = {
    "purpose": "security",
    "recipe": REPO_ROOT / ".training-recipes" / "v5" / "security-rtx3050-bf16-stability-smoke-v5.json",
    "candidateId": "com.tomny.core.security",
    "recipeSha256": "29dc4d5044b5abd9799af00e38ad5f7737f06df67b0c12758e46dd67c9c2ca97",
    "stabilitySmoke": True,
}
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
# A hung trainer must release the GPU promptly; retry with a hard kill after a
# short graceful tree-termination window rather than stalling a safety stop.
PROCESS_TERMINATION_TIMEOUT_SECONDS = 3


class QueueCancelled(Exception):
    """A user-requested stop that must not be recorded as a trainer failure."""


DEFAULT_STABLE_GATE_SAMPLES = 3

MEMORY_PRESSURE_RESTART_MARGIN_MIB = 512
TRAINING_RUNTIME_PACKAGES = (
    'torch',
    'safetensors',
    'datasets',
    'peft',
    'transformers',
    'accelerate',
    'bitsandbytes',
)


def available_host_memory_mib() -> int:
    """Return currently available host RAM, or fail closed when it is unknowable."""
    if psutil is not None:
        try:
            available = psutil.virtual_memory().available
        except (AttributeError, OSError) as error:
            raise RuntimeError("psutil could not determine available host memory") from error
        if isinstance(available, int) and available >= 0:
            return available // 1024**2
        raise RuntimeError("psutil returned invalid available host memory")

    if os.name == "nt":
        class MemoryStatusEx(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatusEx()
        status.dwLength = ctypes.sizeof(MemoryStatusEx)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            raise RuntimeError("Windows could not determine available host memory")
        return int(status.ullAvailPhys // 1024**2)

    try:
        pages = os.sysconf("SC_AVPHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
    except (AttributeError, OSError, ValueError) as error:
        raise RuntimeError(
            "Unable to determine available host memory; install psutil or use a supported OS"
        ) from error
    if not isinstance(pages, int) or not isinstance(page_size, int) or pages < 0 or page_size < 1:
        raise RuntimeError("OS returned invalid available host memory")
    return (pages * page_size) // 1024**2


def training_runtime_gate() -> dict[str, Any]:
    """Inspect the exact Python runtime that will launch candidate training."""
    probe = (
        'import importlib.util,json; '
        f'names={list(TRAINING_RUNTIME_PACKAGES)!r}; '
        "print(json.dumps({name: importlib.util.find_spec(name) is not None for name in names}, sort_keys=True))"
    )
    try:
        result = subprocess.run(
            [sys.executable, '-c', probe],
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'ready': False, 'missing': list(TRAINING_RUNTIME_PACKAGES), 'error': type(error).__name__}
    if result.returncode != 0:
        return {'ready': False, 'missing': list(TRAINING_RUNTIME_PACKAGES), 'error': 'runtime-probe-failed'}
    try:
        discovered = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {'ready': False, 'missing': list(TRAINING_RUNTIME_PACKAGES), 'error': 'runtime-probe-invalid'}
    if not isinstance(discovered, dict) or set(discovered) != set(TRAINING_RUNTIME_PACKAGES):
        return {'ready': False, 'missing': list(TRAINING_RUNTIME_PACKAGES), 'error': 'runtime-probe-invalid'}
    missing = sorted(name for name in TRAINING_RUNTIME_PACKAGES if discovered.get(name) is not True)
    return {'ready': not missing, 'missing': missing}


def require_training_runtime() -> dict[str, Any]:
    gate = training_runtime_gate()
    if gate['ready'] is not True:
        missing = gate.get('missing')
        if isinstance(missing, list) and all(isinstance(name, str) for name in missing):
            detail = ', '.join(missing)
        else:
            detail = 'unknown runtime dependencies'
        raise RuntimeError(f'Training runtime is not ready; missing or unavailable packages: {detail}')
    return gate

def public_failure(error: BaseException) -> dict[str, str]:
    """Return bounded failure evidence without exposing exception messages."""
    error_type = type(error).__name__
    if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,127}', error_type) is None:
        error_type = 'Exception'
    return {'code': 'queue-failed', 'type': error_type}


def cancellation_requested(cancel_file: Path | None) -> bool:
    """Return whether the per-run local cancellation signal has been created."""
    if cancel_file is None:
        return False
    try:
        if not cancel_file.exists():
            return False
        if not cancel_file.is_file():
            raise RuntimeError('Cancellation signal must be a regular file')
        return True
    except OSError as error:
        raise RuntimeError('Cancellation signal cannot be read') from error


def raise_if_cancelled(cancel_file: Path | None) -> None:
    if cancellation_requested(cancel_file):
        raise QueueCancelled('user-requested cancellation')


def preserved_checkpoint_progress(candidate: Path | None) -> dict[str, Any] | None:
    """Report the newest checkpoint without modifying candidate artifacts during cancellation."""
    if candidate is None or not candidate.exists():
        return None
    checkpoint = latest_checkpoint(candidate)
    if checkpoint is None:
        return None
    try:
        return checkpoint_progress(checkpoint)
    except (FileNotFoundError, ValueError):
        return {'path': str(checkpoint.resolve()), 'verified': False}


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
    # The launch sample proves that this candidate was able to start, but it is
    # an observation rather than a restart reservation. Available RAM can rise
    # or fall because of unrelated processes, so promoting one high launch
    # sample into a new threshold can strand a safely configured recovery.
    # Keep the explicit configured threshold as the governing lower bound, with
    # only the active-pause floor plus its restart margin able to raise it.
    safety_floor_mib = max(
        configured_resume_mib,
        pause_threshold_mib + MEMORY_PRESSURE_RESTART_MARGIN_MIB,
    )
    effective_resume_mib = safety_floor_mib
    return {
        'observedRunConsumptionMiB': observed_consumption_mib,
        # Retain the threshold field for existing status readers. It names the
        # stable configured safety floor, not the instantaneous RAM sample.
        'launchEvidenceThresholdMiB': safety_floor_mib,
        'launchEvidenceAvailableMiB': launch_available_mib,
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


def process_command_error(result: subprocess.CompletedProcess[str], command: str) -> str:
    """Return a bounded diagnostic while preserving fail-closed process telemetry."""
    stderr = result.stderr if isinstance(result.stderr, str) else ""
    stdout = result.stdout if isinstance(result.stdout, str) else ""
    detail = stderr.strip() or stdout.strip() or "no diagnostic"
    return f"{command} failed: {detail[:512]}"


def tasklist_access_denied(result: subprocess.CompletedProcess[str]) -> bool:
    """Permit the narrow PowerShell fallback only for tasklist access denial."""
    if result.returncode == 0:
        return False
    stderr = result.stderr if isinstance(result.stderr, str) else ""
    stdout = result.stdout if isinstance(result.stdout, str) else ""
    diagnostic = f"{stderr}\n{stdout}".lower()
    return "access is denied" in diagnostic or "access denied" in diagnostic


def windows_powershell_process_names() -> set[str]:
    """Read strictly shaped process telemetry when tasklist is access-denied.

    This is intentionally not a general fallback: a missing or malformed field
    leaves the GPU gate unsafe rather than allowing an unobserved game process.
    """
    command = (
        "$ErrorActionPreference = 'Stop'; "
        "Get-Process | ForEach-Object { [pscustomobject]@{ "
        "Id = [int]$_.Id; ProcessName = [string]$_.ProcessName; "
        "WorkingSet64 = [Int64]$_.WorkingSet64 } } | ConvertTo-Json -Compress"
    )
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )
    if result.returncode != 0:
        raise RuntimeError(process_command_error(result, "PowerShell process fallback"))
    if not isinstance(result.stdout, str):
        raise RuntimeError("PowerShell process fallback returned malformed telemetry")
    try:
        records = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("PowerShell process fallback returned malformed telemetry") from error
    if isinstance(records, dict):
        records = [records]
    if not isinstance(records, list) or not records:
        raise RuntimeError("PowerShell process fallback returned malformed telemetry")

    names: set[str] = set()
    for record in records:
        if not isinstance(record, dict) or set(record) != {"Id", "ProcessName", "WorkingSet64"}:
            raise RuntimeError("PowerShell process fallback returned malformed telemetry")
        process_id = record["Id"]
        working_set = record["WorkingSet64"]
        process_name = record["ProcessName"]
        if (
            isinstance(process_id, bool)
            or not isinstance(process_id, int)
            or process_id < 0
            or isinstance(working_set, bool)
            or not isinstance(working_set, int)
            or working_set < 0
            or not isinstance(process_name, str)
        ):
            raise RuntimeError("PowerShell process fallback returned malformed telemetry")
        normalized = process_name.strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9 ._-]{0,255}", normalized):
            raise RuntimeError("PowerShell process fallback returned malformed telemetry")
        # Windows always reports the Idle pseudo-process with PID 0. No other
        # zero PID is trustworthy for the game-process safety decision.
        if process_id == 0 and normalized != "idle":
            raise RuntimeError("PowerShell process fallback returned malformed telemetry")
        names.add(normalized)
        names.add(normalized if normalized.endswith(".exe") else f"{normalized}.exe")
    return names


def system_process_names() -> set[str]:
    if os.name == "nt":
        result = subprocess.run(
            ["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, check=False, timeout=15
        )
        if result.returncode != 0:
            if tasklist_access_denied(result):
                return windows_powershell_process_names()
            raise RuntimeError(process_command_error(result, "tasklist"))
        if not isinstance(result.stdout, str):
            raise RuntimeError("tasklist returned malformed telemetry")
        return {row[0].strip().lower() for row in csv.reader(result.stdout.splitlines()) if row}
    result = subprocess.run(
        ["ps", "-eo", "comm="], capture_output=True, text=True, check=False, timeout=15
    )
    if result.returncode != 0:
        raise RuntimeError(process_command_error(result, "process listing"))
    if not isinstance(result.stdout, str):
        raise RuntimeError("process listing returned malformed telemetry")
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
        host_available_mib = available_host_memory_mib()
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

def validate_queue_contract(
    items: tuple[dict[str, Any], ...] | list[dict[str, Any]] = QUEUE,
) -> list[dict[str, Any]]:
    if not TRAINER.is_file() or not all(path.is_dir() for path in BASE_MODELS.values()):
        raise FileNotFoundError("Trainer or a required mixed-topology base model is missing")
    dataset_manifest = read_json(DATASET_MANIFEST, "dataset manifest")
    manifest_hash = sha256_file(DATASET_MANIFEST)
    if manifest_hash != EXPECTED_DATASET_SHA256:
        raise ValueError(f"Dataset manifest hash changed: {manifest_hash}")
    plans: list[dict[str, Any]] = []
    for item in items:
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
    if item.get("stabilitySmoke") is True:
        command.extend(["--smoke", "--train-limit", "64", "--validation-limit", "64"])
        action = "train-stability-smoke"
    return {
        "action": action,
        "candidate": str(candidate),
        "command": command,
        'resumeCheckpoint': resume_checkpoint,
    }

def security_checkpoint_resume_plan(
    plans: list[dict[str, Any]], version: str
) -> dict[str, Any]:
    """Authorize one pinned recovery path only after its interrupted-run evidence matches."""
    if version != SECURITY_CHECKPOINT_RESUME_VERSION:
        raise ValueError('Security checkpoint resume version is not the approved interrupted candidate')
    if len(plans) != 1 or plans[0].get('purpose') != SECURITY_CHECKPOINT_RESUME_PURPOSE:
        raise ValueError('Security checkpoint resume must select exactly the Security purpose')
    item = plans[0]
    if item.get('candidateId') != SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID:
        raise ValueError('Security checkpoint resume candidate identity mismatch')
    candidate = CANDIDATE_ROOT / SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID / version
    checkpoint = candidate / f'checkpoint-{SECURITY_CHECKPOINT_RESUME_STEP}'
    if (candidate / 'training_manifest.json').exists():
        raise ValueError('Completed or finalized Security candidate cannot use interrupted checkpoint resume')
    if latest_checkpoint(candidate) != checkpoint:
        raise ValueError('Security checkpoint resume requires checkpoint-50 to be the latest checkpoint')
    progress = checkpoint_progress(checkpoint)
    if progress['globalStep'] != SECURITY_CHECKPOINT_RESUME_STEP:
        raise ValueError('Security checkpoint resume step evidence mismatch')
    verify_resume_receipt(candidate, item, version)
    preflight_path = candidate / 'training_preflight.json'

    latest = load_latest_status()
    if not isinstance(latest, dict):
        raise FileNotFoundError('Security checkpoint resume requires the interrupted queue status')
    status_path_value = latest.get('statusPath')
    if not isinstance(status_path_value, str) or not status_path_value:
        raise ValueError('Security checkpoint resume latest status path is invalid')
    status_path = Path(status_path_value).resolve()
    if QUEUE_ROOT.resolve() not in status_path.parents or status_path.name != 'status.json':
        raise ValueError('Security checkpoint resume latest status is outside the queue root')
    interrupted = read_json(status_path, 'Security interrupted queue status')
    interrupted_state = interrupted.get('state')
    if (
        interrupted.get('runId') != latest.get('runId')
        or interrupted_state != latest.get('state')
        or interrupted_state not in SECURITY_CHECKPOINT_RESUME_TERMINAL_STATES
        or interrupted.get('candidateVersion') != version
        or interrupted.get('promotionAllowed') is not False
    ):
        raise ValueError('Security checkpoint resume latest terminal state mismatch')
    selection = interrupted.get('selection')
    if selection != {
        'mode': 'exact-one-purpose',
        'purpose': SECURITY_CHECKPOINT_RESUME_PURPOSE,
        'promotionAllowed': False,
    }:
        raise ValueError('Security checkpoint resume interrupted selection mismatch')
    adapters = interrupted.get('adapters')
    if not isinstance(adapters, list) or len(adapters) != 1 or not isinstance(adapters[0], dict):
        raise ValueError('Security checkpoint resume interrupted adapter evidence is invalid')
    adapter = adapters[0]
    expected_candidate = str(candidate.resolve())
    if (
        adapter.get('purpose') != SECURITY_CHECKPOINT_RESUME_PURPOSE
        or adapter.get('candidateId') != SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID
        or adapter.get('recipeSha256') != item.get('recipeSha256')
        or adapter.get('baseModel') != BASE_BINDINGS[SECURITY_CHECKPOINT_RESUME_PURPOSE]
        or adapter.get('candidate') != expected_candidate
        or adapter.get('action') != 'train-new'
        or adapter.get('state') != interrupted_state
    ):
        raise ValueError('Security checkpoint resume interrupted adapter mismatch')

    command = [
        sys.executable,
        str(TRAINER),
        '--recipe',
        str(item['recipe']),
        '--model',
        str(BASE_MODELS[SECURITY_CHECKPOINT_RESUME_PURPOSE]),
        '--dataset-manifest',
        str(DATASET_MANIFEST),
        '--candidate-id',
        SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
        '--candidate-version',
        version,
        '--resume-from',
        str(checkpoint.resolve()),
    ]
    provenance = {
        'mode': 'exact-security-checkpoint-50-resume',
        'candidate': {
            'id': SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
            'version': version,
            'purpose': SECURITY_CHECKPOINT_RESUME_PURPOSE,
            'path': expected_candidate,
        },
        'checkpoint': {
            **progress,
            'adapterConfigSha256': sha256_file(checkpoint / 'adapter_config.json'),
        },
        'preflight': {
            'path': str(preflight_path.resolve()),
            'sha256': sha256_file(preflight_path),
            'resumeContract': expected_resume_contract(item, version),
        },
        'interruptedRun': {
            'runId': interrupted['runId'],
            'state': interrupted_state,
            'statusPath': str(status_path),
        },
        'candidateOnly': True,
        'promotionAllowed': False,
    }
    return {
        'action': 'resume-interrupted-security-checkpoint-50',
        'candidate': expected_candidate,
        'command': command,
        'resumeCheckpoint': progress,
        'resumeProvenance': provenance,
    }


def security_stability_cancelled_resume_plan(
    plans: list[dict[str, Any]], version: str
) -> dict[str, Any]:
    """Resume an exact user-cancelled Security stability checkpoint, never a failed run."""
    if version != SECURITY_STABILITY_CANDIDATE_VERSION:
        raise ValueError('Security stability cancelled resume version is not the approved candidate')
    if len(plans) != 1 or plans[0].get('purpose') != SECURITY_CHECKPOINT_RESUME_PURPOSE:
        raise ValueError('Security stability cancelled resume must select exactly the Security purpose')
    item = plans[0]
    if item.get('candidateId') != SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID:
        raise ValueError('Security stability cancelled resume candidate identity mismatch')
    candidate = CANDIDATE_ROOT / SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID / version
    if (candidate / 'training_manifest.json').exists():
        raise ValueError('Completed or finalized Security candidate cannot use cancelled checkpoint resume')
    verify_resume_receipt(candidate, item, version)

    latest = load_latest_status()
    if not isinstance(latest, dict):
        raise FileNotFoundError('Security stability cancelled resume requires the cancelled queue status')
    status_path_value = latest.get('statusPath')
    if not isinstance(status_path_value, str) or not status_path_value:
        raise ValueError('Security stability cancelled resume latest status path is invalid')
    status_path = Path(status_path_value).resolve()
    if QUEUE_ROOT.resolve() not in status_path.parents or status_path.name != 'status.json':
        raise ValueError('Security stability cancelled resume latest status is outside the queue root')
    interrupted = read_json(status_path, 'Security stability cancelled queue status')
    if (
        interrupted.get('runId') != latest.get('runId')
        or interrupted.get('state') != latest.get('state')
        or interrupted.get('state') != 'cancelled'
        or interrupted.get('candidateVersion') != version
        or interrupted.get('promotionAllowed') is not False
    ):
        raise ValueError('Security stability cancelled resume latest terminal state mismatch')
    allowed_selections = (
        {'mode': 'exact-one-purpose', 'purpose': 'security', 'promotionAllowed': False},
        {'mode': SECURITY_STABILITY_CANCELLED_RESUME_MODE, 'purpose': 'security', 'promotionAllowed': False},
        {
            'mode': SECURITY_STABILITY_ORPHANED_WAITING_RECOVERY_MODE,
            'purpose': 'security',
            'promotionAllowed': False,
        },
    )
    if interrupted.get('selection') not in allowed_selections:
        raise ValueError('Security stability cancelled resume interrupted selection mismatch')
    cancellation = interrupted.get('cancellation')
    if not isinstance(cancellation, dict) or cancellation.get('code') != 'user-requested':
        raise ValueError('Security stability cancelled resume requires a user-requested cancellation receipt')
    checkpoint_record = cancellation.get('checkpoint')
    if not isinstance(checkpoint_record, dict):
        raise ValueError('Security stability cancelled resume receipt has no checkpoint evidence')
    checkpoint_value = checkpoint_record.get('path')
    if not isinstance(checkpoint_value, str) or not checkpoint_value:
        raise ValueError('Security stability cancelled resume checkpoint path is invalid')
    checkpoint = Path(checkpoint_value).resolve()
    latest_checkpoint_path = latest_checkpoint(candidate)
    if (
        candidate.resolve() not in checkpoint.parents
        or latest_checkpoint_path is None
        or checkpoint != latest_checkpoint_path.resolve()
    ):
        raise ValueError('Security stability cancelled resume checkpoint is not the latest candidate checkpoint')
    progress = checkpoint_progress(checkpoint)
    if checkpoint_record != progress or progress['remainingSteps'] < 1:
        raise ValueError('Security stability cancelled resume checkpoint evidence mismatch')

    adapters = interrupted.get('adapters')
    if not isinstance(adapters, list) or len(adapters) != 1 or not isinstance(adapters[0], dict):
        raise ValueError('Security stability cancelled resume interrupted adapter evidence is invalid')
    adapter = adapters[0]
    expected_candidate = str(candidate.resolve())
    if (
        adapter.get('purpose') != 'security'
        or adapter.get('candidateId') != SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID
        or adapter.get('recipeSha256') != item.get('recipeSha256')
        or adapter.get('baseModel') != BASE_BINDINGS['security']
        or adapter.get('candidate') != expected_candidate
        or adapter.get('state') != 'cancelled'
        or adapter.get('action') not in {
            'train-new',
            'resume-paused-checkpoint',
            SECURITY_STABILITY_CANCELLED_RESUME_MODE,
            SECURITY_STABILITY_ORPHANED_WAITING_RECOVERY_MODE,
        }
        or adapter.get('cancellation') != cancellation
    ):
        raise ValueError('Security stability cancelled resume interrupted adapter mismatch')

    preflight_path = candidate / 'training_preflight.json'
    command = [
        sys.executable,
        str(TRAINER),
        '--recipe',
        str(item['recipe']),
        '--model',
        str(BASE_MODELS['security']),
        '--dataset-manifest',
        str(DATASET_MANIFEST),
        '--candidate-id',
        SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
        '--candidate-version',
        version,
        '--resume-from',
        str(checkpoint),
    ]
    provenance = {
        'mode': SECURITY_STABILITY_CANCELLED_RESUME_MODE,
        'candidate': {
            'id': SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
            'version': version,
            'purpose': 'security',
            'path': expected_candidate,
        },
        'checkpoint': {
            **progress,
            'adapterConfigSha256': sha256_file(checkpoint / 'adapter_config.json'),
        },
        'preflight': {
            'path': str(preflight_path.resolve()),
            'sha256': sha256_file(preflight_path),
            'resumeContract': expected_resume_contract(item, version),
        },
        'interruptedRun': {
            'runId': interrupted['runId'],
            'state': 'cancelled',
            'statusPath': str(status_path),
        },
        'candidateOnly': True,
        'promotionAllowed': False,
    }
    return {
        'action': SECURITY_STABILITY_CANCELLED_RESUME_MODE,
        'candidate': expected_candidate,
        'command': command,
        'resumeCheckpoint': progress,
        'resumeProvenance': provenance,
    }


def active_candidate_training_processes() -> list[dict[str, Any]]:
    """Return active queue/trainer identities, or fail closed if they cannot be inspected."""
    if psutil is None:
        raise RuntimeError('Cannot inspect candidate queue process identities without psutil')
    active: list[dict[str, Any]] = []
    for process in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            info = process.info
            process_id = info.get('pid')
            name = info.get('name')
            command_line = info.get('cmdline')
        except (AttributeError, OSError, psutil.Error) as error:
            raise RuntimeError('Cannot inspect candidate queue process identities') from error
        if isinstance(process_id, bool) or not isinstance(process_id, int) or process_id < 0:
            raise RuntimeError('Candidate queue process telemetry is malformed')
        if process_id == 0:
            if not isinstance(name, str) or name.strip().lower() not in {'idle', 'system idle process'}:
                raise RuntimeError('Candidate queue process telemetry is malformed')
            continue
        if process_id == os.getpid():
            continue
        if name is not None and not isinstance(name, str):
            raise RuntimeError('Candidate queue process telemetry is malformed')
        normalized_name = name.strip().lower() if isinstance(name, str) else ''
        plausible_python = normalized_name in {'py', 'py.exe', 'python', 'python.exe', 'pythonw', 'pythonw.exe'}
        # Windows routinely omits cmdline for protected/system processes. That
        # is benign for a process whose executable cannot be the queue/trainer;
        # it remains unsafe for any Python launcher that could be the trainer.
        if command_line is None or command_line == []:
            if plausible_python:
                raise RuntimeError('Cannot inspect a possible candidate queue or trainer process')
            continue
        if not isinstance(command_line, list) or not all(isinstance(part, str) for part in command_line):
            raise RuntimeError('Candidate queue process telemetry is malformed')
        command = ' '.join(command_line).replace('\\', '/').lower()
        if plausible_python and ('run_candidate_queue.py' in command or 'train_lora.py' in command):
            active.append({'pid': process_id, 'name': normalized_name or 'unknown'})
        elif not normalized_name and ('run_candidate_queue.py' in command or 'train_lora.py' in command):
            raise RuntimeError('Cannot inspect a possible candidate queue or trainer process')
    return active


def safe_queue_status_path(value: object, label: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError(f'{label} status path is invalid')
    path = Path(value).resolve()
    if QUEUE_ROOT.resolve() not in path.parents or path.name != 'status.json':
        raise ValueError(f'{label} status is outside the queue root')
    return path


def exact_cancelled_security_stability_receipt(
    candidate: Path,
    item: dict[str, Any],
    version: str,
    expected_progress: dict[str, Any],
    excluded_status_path: Path,
) -> tuple[dict[str, Any], Path]:
    """Find one earlier immutable cancellation receipt for the exact checkpoint only."""
    expected_candidate = str(candidate.resolve())
    allowed_selections = (
        {'mode': 'exact-one-purpose', 'purpose': 'security', 'promotionAllowed': False},
        {'mode': SECURITY_STABILITY_CANCELLED_RESUME_MODE, 'purpose': 'security', 'promotionAllowed': False},
    )
    matching: list[tuple[dict[str, Any], Path]] = []
    for status_path in QUEUE_ROOT.glob('*/status.json'):
        if status_path.resolve() == excluded_status_path:
            continue
        status = read_json(status_path, 'earlier Security stability cancelled queue status')
        if (
            status.get('schemaVersion') != 'tomny.candidate-queue-status.v1'
            or status.get('state') != 'cancelled'
            or status.get('candidateVersion') != version
            or status.get('promotionAllowed') is not False
            or status.get('selection') not in allowed_selections
        ):
            continue
        cancellation = status.get('cancellation')
        adapters = status.get('adapters')
        if (
            not isinstance(cancellation, dict)
            or cancellation.get('code') != 'user-requested'
            or cancellation.get('checkpoint') != expected_progress
            or not isinstance(adapters, list)
            or len(adapters) != 1
            or not isinstance(adapters[0], dict)
        ):
            continue
        adapter = adapters[0]
        if (
            adapter.get('purpose') != 'security'
            or adapter.get('candidateId') != SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID
            or adapter.get('recipeSha256') != item.get('recipeSha256')
            or adapter.get('baseModel') != BASE_BINDINGS['security']
            or adapter.get('candidate') != expected_candidate
            or adapter.get('state') != 'cancelled'
            or adapter.get('action') not in {
                'train-new',
                'resume-paused-checkpoint',
                SECURITY_STABILITY_CANCELLED_RESUME_MODE,
            }
            or adapter.get('cancellation') != cancellation
        ):
            continue
        if not isinstance(status.get('runId'), str) or status['runId'] != status_path.parent.name:
            continue
        matching.append((status, status_path.resolve()))
    if len(matching) != 1:
        raise ValueError('Security orphaned waiting recovery requires exactly one matching earlier user-cancelled receipt')
    return matching[0]


def security_stability_orphaned_waiting_recovery_plan(
    plans: list[dict[str, Any]],
    version: str,
    cancel_file: Path | None,
    *,
    queue_lock_held_by_current_process: bool = False,
) -> dict[str, Any]:
    """Terminally recover one orphaned waiting Security queue without launching a trainer."""
    if version != SECURITY_STABILITY_CANDIDATE_VERSION:
        raise ValueError('Security orphaned waiting recovery version is not the approved candidate')
    if len(plans) != 1 or plans[0].get('purpose') != SECURITY_CHECKPOINT_RESUME_PURPOSE:
        raise ValueError('Security orphaned waiting recovery must select exactly the Security purpose')
    if cancel_file is None or cancel_file.exists():
        raise ValueError('Security orphaned waiting recovery requires a fresh absent --cancel-file path')
    if not queue_lock_held_by_current_process and lock_is_held(QUEUE_ROOT / 'candidate-queue.lock'):
        raise RuntimeError('Security orphaned waiting recovery rejects a live candidate queue lock')
    active_processes = active_candidate_training_processes()
    if active_processes:
        raise RuntimeError('Security orphaned waiting recovery rejects active queue or trainer processes')
    item = plans[0]
    if item.get('candidateId') != SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID:
        raise ValueError('Security orphaned waiting recovery candidate identity mismatch')
    candidate = CANDIDATE_ROOT / SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID / version
    if (candidate / 'training_manifest.json').exists():
        raise ValueError('Completed or finalized Security candidate cannot use orphaned waiting recovery')
    verify_resume_receipt(candidate, item, version)
    latest = load_latest_status()
    if not isinstance(latest, dict):
        raise FileNotFoundError('Security orphaned waiting recovery requires the active queue status')
    if set(latest) != {'runId', 'state', 'updatedAt', 'statusPath'}:
        raise ValueError('Security orphaned waiting recovery latest receipt shape is invalid')
    status_path = safe_queue_status_path(latest.get('statusPath'), 'Security orphaned waiting recovery latest')
    waiting = read_json(status_path, 'Security orphaned waiting queue status')
    if set(waiting) != {
        'schemaVersion', 'runId', 'state', 'createdAt', 'updatedAt', 'promotionAllowed',
        'candidateVersion', 'executionStartAt', 'selection', 'adapters', 'gpuGate',
    }:
        raise ValueError('Security orphaned waiting recovery queue status shape is invalid')
    if (
        waiting.get('runId') != latest.get('runId')
        or waiting.get('runId') != status_path.parent.name
        or waiting.get('state') != latest.get('state')
        or waiting.get('state') != 'waiting-for-gpu'
        or waiting.get('candidateVersion') != version
        or waiting.get('promotionAllowed') is not False
        or waiting.get('executionStartAt') != 'security'
        or waiting.get('selection') != {
            'mode': SECURITY_STABILITY_CANCELLED_RESUME_MODE,
            'purpose': 'security',
            'promotionAllowed': False,
        }
    ):
        raise ValueError('Security orphaned waiting recovery latest state mismatch')
    adapters = waiting.get('adapters')
    expected_candidate = str(candidate.resolve())
    if (
        not isinstance(adapters, list)
        or len(adapters) != 1
        or adapters[0] != {
            'purpose': 'security',
            'candidateId': SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
            'recipeSha256': item.get('recipeSha256'),
            'baseModel': BASE_BINDINGS['security'],
            'state': 'pending',
        }
    ):
        raise ValueError('Security orphaned waiting recovery adapter evidence mismatch')
    gpu_gate = waiting.get('gpuGate')
    if not isinstance(gpu_gate, dict) or gpu_gate.get('safe') is not False:
        raise ValueError('Security orphaned waiting recovery GPU evidence mismatch')
    probe = gpu_gate.get('probe')
    if not isinstance(probe, dict) or probe.get('computeProcesses') != []:
        raise ValueError('Security orphaned waiting recovery process evidence mismatch')
    checkpoint = latest_checkpoint(candidate)
    if checkpoint is None:
        raise FileNotFoundError('Security orphaned waiting recovery has no checkpoint')
    progress = checkpoint_progress(checkpoint)
    if progress['globalStep'] != 500 or progress['remainingSteps'] < 1:
        raise ValueError('Security orphaned waiting recovery checkpoint progress mismatch')
    cancelled, cancelled_path = exact_cancelled_security_stability_receipt(
        candidate,
        item,
        version,
        progress,
        status_path,
    )
    preflight_path = candidate / 'training_preflight.json'
    provenance = {
        'mode': SECURITY_STABILITY_ORPHANED_WAITING_RECOVERY_MODE,
        'candidate': {
            'id': SECURITY_CHECKPOINT_RESUME_CANDIDATE_ID,
            'version': version,
            'purpose': 'security',
            'path': expected_candidate,
        },
        'checkpoint': {
            **progress,
            'adapterConfigSha256': sha256_file(checkpoint / 'adapter_config.json'),
        },
        'preflight': {
            'path': str(preflight_path.resolve()),
            'sha256': sha256_file(preflight_path),
            'resumeContract': expected_resume_contract(item, version),
        },
        'orphanedRun': {
            'runId': waiting['runId'],
            'state': 'waiting-for-gpu',
            'statusPath': str(status_path),
        },
        'earlierCancelledRun': {
            'runId': cancelled['runId'],
            'state': 'cancelled',
            'statusPath': str(cancelled_path),
            'cancellation': cancelled['cancellation'],
        },
        'freshCancelPath': str(cancel_file.resolve()),
        'candidateOnly': True,
        'promotionAllowed': False,
    }
    return {
        'action': SECURITY_STABILITY_ORPHANED_WAITING_RECOVERY_MODE,
        'candidate': expected_candidate,
        'resumeCheckpoint': progress,
        'recoveryProvenance': provenance,
        'cancellation': cancelled['cancellation'],
    }


def resolve_execution_plans(
    plans: list[dict[str, Any]],
    version: str,
    start_at: str | None,
    resume_security_checkpoint_50: bool = False,
    resume_security_stability_candidate: bool = False,
    recover_orphaned_waiting_security_stability_candidate: bool = False,
    cancel_file: Path | None = None,
) -> list[dict[str, Any]]:
    if resume_security_checkpoint_50:
        if start_at is not None:
            raise ValueError('Security checkpoint resume cannot be combined with --start-at')
        return [{**plans[0], **security_checkpoint_resume_plan(plans, version)}]
    if resume_security_stability_candidate:
        if start_at is not None:
            raise ValueError('Security stability cancelled resume cannot be combined with --start-at')
        return [{**plans[0], **security_stability_cancelled_resume_plan(plans, version)}]
    if recover_orphaned_waiting_security_stability_candidate:
        if start_at is not None:
            raise ValueError('Security orphaned waiting recovery cannot be combined with --start-at')
        return [{
            **plans[0],
            **security_stability_orphaned_waiting_recovery_plan(plans, version, cancel_file),
        }]
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


def select_exact_purpose(plans: list[dict[str, Any]], only_purpose: str | None) -> list[dict[str, Any]]:
    """Narrow a queue to exactly one declared purpose without reordering it."""
    if only_purpose is None:
        return plans
    selected = [item for item in plans if item["purpose"] == only_purpose]
    if len(selected) != 1:
        raise ValueError(f"Unknown or ambiguous queue purpose: {only_purpose}")
    return selected


def selection_receipt(args: argparse.Namespace) -> dict[str, Any]:
    if getattr(args, "security_stability_smoke", False):
        return {"mode": "security-stability-smoke", "purpose": "security", "promotionAllowed": False}
    if getattr(args, 'resume_security_stability_candidate', False):
        return {'mode': SECURITY_STABILITY_CANCELLED_RESUME_MODE, 'purpose': 'security', 'promotionAllowed': False}
    if getattr(args, 'recover_orphaned_waiting_security_stability_candidate', False):
        return {
            'mode': SECURITY_STABILITY_ORPHANED_WAITING_RECOVERY_MODE,
            'purpose': 'security',
            'promotionAllowed': False,
        }
    if args.only_purpose is not None:
        return {"mode": "exact-one-purpose", "purpose": args.only_purpose, "promotionAllowed": False}
    return {
        "mode": "queue-from-purpose",
        "purpose": args.start_at or EXECUTION_PURPOSES[0],
        "promotionAllowed": False,
    }


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
    cancel_file: Path | None = None,
) -> dict[str, Any]:
    started = time.monotonic()
    stable_samples = 0
    while True:
        raise_if_cancelled(cancel_file)
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
    available_mib = available_host_memory_mib()
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
    cancel_file: Path | None = None,
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
        raise_if_cancelled(cancel_file)
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
    cancel_file: Path | None = None,
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

    def stop_for_cancellation() -> None:
        if not cancellation_requested(cancel_file):
            return
        terminated = terminate_process_tree(process)
        append_log(
            log_path,
            'trainer-cancelled',
            processId=process.pid,
            processTerminated=terminated,
        )
        if not terminated:
            raise RuntimeError('Trainer did not terminate after cancellation')
        raise QueueCancelled('user-requested cancellation')

    stop_for_cancellation()
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
            stop_for_cancellation()
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
        resume_security_checkpoint_50 = getattr(args, 'resume_security_checkpoint_50', False)
        resume_security_stability_candidate = getattr(args, 'resume_security_stability_candidate', False)
        recover_orphaned_waiting_security_stability_candidate = getattr(
            args, 'recover_orphaned_waiting_security_stability_candidate', False
        )
        if resume_security_checkpoint_50:
            plans = [{**plans[0], **security_checkpoint_resume_plan(plans, args.candidate_version)}]
        elif resume_security_stability_candidate:
            plans = [{
                **plans[0],
                **security_stability_cancelled_resume_plan(plans, args.candidate_version),
            }]
        elif recover_orphaned_waiting_security_stability_candidate:
            plans = [{
                **plans[0],
                **security_stability_orphaned_waiting_recovery_plan(
                    plans,
                    args.candidate_version,
                    args.cancel_file,
                    queue_lock_held_by_current_process=True,
                ),
            }]
        status: dict[str, Any] = {
            "schemaVersion": "tomny.candidate-queue-status.v1",
            "runId": run_id,
            "state": "starting",
            "createdAt": utc_now(),
            "promotionAllowed": False,
            "candidateVersion": args.candidate_version,
            "executionStartAt": args.only_purpose or args.start_at or EXECUTION_PURPOSES[0],
            "selection": selection_receipt(args),
            "adapters": [
                {"purpose": item["purpose"], "candidateId": item["candidateId"], "recipeSha256": item["recipeSha256"], "baseModel": BASE_BINDINGS[item["purpose"]], "state": "pending"}
                for item in plans
            ],
        }
        write_run_status(run_dir, status)
        log_path = run_dir / "queue.log"
        if recover_orphaned_waiting_security_stability_candidate:
            item = plans[0]
            adapter = status['adapters'][0]
            recovery = item['recoveryProvenance']
            cancellation = item['cancellation']
            status['state'] = 'cancelled'
            status['cancellation'] = cancellation
            status['recovery'] = recovery
            adapter.update({
                'state': 'cancelled',
                'action': item['action'],
                'candidate': item['candidate'],
                'resumeCheckpoint': item['resumeCheckpoint'],
                'cancellation': cancellation,
                'recovery': recovery,
                'cancelledAt': utc_now(),
            })
            write_run_status(run_dir, status)
            append_log(
                log_path,
                SECURITY_STABILITY_ORPHANED_WAITING_RECOVERY_MODE,
                orphanedRun=recovery['orphanedRun'],
                earlierCancelledRun=recovery['earlierCancelledRun'],
                checkpoint=recovery['checkpoint'],
                promotionAllowed=False,
            )
            return
        current_adapter: dict[str, Any] | None = None
        current_candidate: Path | None = None
        try:
            wait_for_safe_gpu(args, status, run_dir, cancel_file=args.cancel_file)
            if not resume_security_checkpoint_50 and not resume_security_stability_candidate:
                plans = resolve_execution_plans(plans, args.candidate_version, args.start_at)
            for index, item in enumerate(plans):
                adapter = status["adapters"][index]
                current_adapter = adapter
                current_candidate = Path(item['candidate'])
                raise_if_cancelled(args.cancel_file)
                resume_provenance = item.get('resumeProvenance')
                if resume_provenance is not None:
                    status['resume'] = resume_provenance
                    adapter['resume'] = resume_provenance
                    append_log(
                        log_path,
                        'queue-resume-authorized',
                        mode=resume_provenance['mode'],
                        candidate=resume_provenance['candidate'],
                        checkpoint=resume_provenance['checkpoint'],
                        interruptedRun=resume_provenance['interruptedRun'],
                        promotionAllowed=False,
                    )
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
                wait_for_safe_gpu(args, status, run_dir, cancel_file=args.cancel_file)
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
                    launch_available_mib = available_host_memory_mib()
                    exit_code = run_training(
                        command,
                        log_path,
                        output_idle_timeout_seconds=args.trainer_output_idle_timeout_seconds,
                        cancel_file=args.cancel_file,
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
                        'launchEvidenceThresholdMiB': adaptation['launchEvidenceThresholdMiB'],
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
                    if not wait_for_memory_recovery(
                        args, status, run_dir, adapter, pressure, cancel_file=args.cancel_file
                    ):
                        return
                    wait_for_safe_gpu(
                        args,
                        status,
                        run_dir,
                        minimum_host_mib=effective_resume_mib,
                        cancel_file=args.cancel_file,
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
                raise_if_cancelled(args.cancel_file)
                adapter["state"] = "completed-candidate"
                adapter["completedAt"] = utc_now()
                write_run_status(run_dir, status)
            raise_if_cancelled(args.cancel_file)
            status["state"] = "completed-candidates"
            write_run_status(run_dir, status)
            append_log(log_path, "queue-complete", promotionAllowed=False)
        except QueueCancelled:
            checkpoint = preserved_checkpoint_progress(current_candidate)
            cancellation: dict[str, Any] = {'code': 'user-requested'}
            if checkpoint is not None:
                cancellation['checkpoint'] = checkpoint
            status['state'] = 'cancelled'
            status['cancellation'] = cancellation
            if current_adapter is not None:
                current_adapter['state'] = 'cancelled'
                current_adapter['cancelledAt'] = utc_now()
                current_adapter['cancellation'] = dict(cancellation)
            write_run_status(run_dir, status)
            append_log(log_path, 'queue-cancelled', **cancellation)
            return
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
    parser = argparse.ArgumentParser(description="Run Tomny candidate-only QLoRA recipes sequentially.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Validate and print plans without locks, writes, or training.")
    mode.add_argument("--status", action="store_true", help="Print latest status, lock state, and current GPU gate without writes.")
    parser.add_argument("--candidate-version", default=DEFAULT_CANDIDATE_VERSION)

    parser.add_argument(
        '--resume-security-checkpoint-50',
        action='store_true',
        help='Resume only the audited Security 0.4.0-candidate.1 checkpoint-50 through queue safeguards.',
    )
    parser.add_argument(
        '--resume-security-stability-candidate',
        action='store_true',
        help='Resume only the exact user-cancelled Security BF16 stability candidate checkpoint through queue safeguards.',
    )
    parser.add_argument(
        '--recover-orphaned-waiting-security-stability-candidate',
        action='store_true',
        help=(
            'Terminally recover only the exact orphaned waiting Security BF16 candidate queue; '
            'never launches a trainer.'
        ),
    )
    parser.add_argument(
        '--security-stability-candidate',
        action='store_true',
        help='Train only the pinned BF16 Security stability candidate after its bounded smoke gate passes.',
    )
    parser.add_argument(
        '--security-stability-smoke',
        action='store_true',
        help='Run only the bounded BF16 Security stability smoke before a new candidate is authorized.',
    )
    parser.add_argument("--run-id")
    parser.add_argument(
        '--cancel-file',
        type=Path,
        help='Treat creation of this local regular file as a request to stop this queue without promotion.',
    )
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
    parser.add_argument(
        "--only-purpose",
        choices=EXECUTION_PURPOSES,
        help='Execute exactly one declared purpose; cannot be combined with --start-at.',
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
    if args.resume_security_checkpoint_50:
        if (
            args.resume_security_stability_candidate
            or args.recover_orphaned_waiting_security_stability_candidate
            or args.start_at is not None
            or args.only_purpose not in (None, SECURITY_CHECKPOINT_RESUME_PURPOSE)
        ):
            parser.error('--resume-security-checkpoint-50 cannot be combined with another purpose selector')
        if args.candidate_version not in (DEFAULT_CANDIDATE_VERSION, SECURITY_CHECKPOINT_RESUME_VERSION):
            parser.error('--resume-security-checkpoint-50 is pinned to 0.4.0-candidate.1')
        args.candidate_version = SECURITY_CHECKPOINT_RESUME_VERSION
        args.only_purpose = SECURITY_CHECKPOINT_RESUME_PURPOSE
    if args.resume_security_stability_candidate:
        if (
            args.recover_orphaned_waiting_security_stability_candidate
            or args.security_stability_candidate
            or args.security_stability_smoke
            or args.start_at is not None
            or args.only_purpose not in (None, SECURITY_CHECKPOINT_RESUME_PURPOSE)
        ):
            parser.error('--resume-security-stability-candidate cannot be combined with another execution selector')
        if args.candidate_version not in (DEFAULT_CANDIDATE_VERSION, SECURITY_STABILITY_CANDIDATE_VERSION):
            parser.error('--resume-security-stability-candidate is pinned to 0.5.0-candidate.1')
        args.candidate_version = SECURITY_STABILITY_CANDIDATE_VERSION
        args.only_purpose = SECURITY_CHECKPOINT_RESUME_PURPOSE
    if args.recover_orphaned_waiting_security_stability_candidate:
        if (
            args.resume_security_checkpoint_50
            or args.resume_security_stability_candidate
            or args.security_stability_candidate
            or args.security_stability_smoke
            or args.start_at is not None
            or args.only_purpose not in (None, SECURITY_CHECKPOINT_RESUME_PURPOSE)
        ):
            parser.error('--recover-orphaned-waiting-security-stability-candidate cannot be combined with another execution selector')
        if args.candidate_version not in (DEFAULT_CANDIDATE_VERSION, SECURITY_STABILITY_CANDIDATE_VERSION):
            parser.error('--recover-orphaned-waiting-security-stability-candidate is pinned to 0.5.0-candidate.1')
        if args.cancel_file is None or args.cancel_file.exists():
            parser.error('--recover-orphaned-waiting-security-stability-candidate requires a fresh absent --cancel-file path')
        args.candidate_version = SECURITY_STABILITY_CANDIDATE_VERSION
        args.only_purpose = SECURITY_CHECKPOINT_RESUME_PURPOSE
    if args.security_stability_candidate:
        if (
            args.resume_security_checkpoint_50
            or args.resume_security_stability_candidate
            or args.recover_orphaned_waiting_security_stability_candidate
            or args.security_stability_smoke
            or args.start_at is not None
            or args.only_purpose is not None
        ):
            parser.error('--security-stability-candidate cannot be combined with another execution selector')
        if args.candidate_version not in (DEFAULT_CANDIDATE_VERSION, SECURITY_STABILITY_CANDIDATE_VERSION):
            parser.error('--security-stability-candidate is pinned to 0.5.0-candidate.1')
        args.candidate_version = SECURITY_STABILITY_CANDIDATE_VERSION
        args.only_purpose = SECURITY_CHECKPOINT_RESUME_PURPOSE
    if args.security_stability_smoke:
        if (
            args.resume_security_checkpoint_50
            or args.resume_security_stability_candidate
            or args.recover_orphaned_waiting_security_stability_candidate
            or args.start_at is not None
            or args.only_purpose is not None
        ):
            parser.error('--security-stability-smoke cannot be combined with another execution selector')
        if args.candidate_version not in (DEFAULT_CANDIDATE_VERSION, SECURITY_STABILITY_SMOKE_VERSION):
            parser.error('--security-stability-smoke is pinned to 0.5.0-stability-smoke.1')
        args.candidate_version = SECURITY_STABILITY_SMOKE_VERSION
        args.only_purpose = SECURITY_CHECKPOINT_RESUME_PURPOSE
    if args.only_purpose and args.start_at:
        parser.error("--only-purpose cannot be combined with --start-at")

    if args.cancel_file is not None:
        args.cancel_file = args.cancel_file.resolve()
        if args.cancel_file.exists() and not args.cancel_file.is_file():
            parser.error('--cancel-file must name a regular file or a path that does not exist yet')
    return args


def main() -> None:
    args = parse_args()
    selected_items = (
        [SECURITY_STABILITY_SMOKE_ITEM]
        if args.security_stability_smoke
        else [SECURITY_STABILITY_ITEM]
        if (
            args.security_stability_candidate
            or args.resume_security_stability_candidate
            or args.recover_orphaned_waiting_security_stability_candidate
        )
        else QUEUE
    )
    plans = validate_queue_contract(selected_items)
    plans = select_exact_purpose(plans, args.only_purpose)
    resolved = (
        resolve_execution_plans(
            plans,
            args.candidate_version,
            args.start_at,
            getattr(args, 'resume_security_checkpoint_50', False),
            getattr(args, 'resume_security_stability_candidate', False),
            getattr(args, 'recover_orphaned_waiting_security_stability_candidate', False),
            args.cancel_file,
        )
        if args.status or args.dry_run
        else plans
    )
    runtime = training_runtime_gate()
    if args.status:
        result = {
            "latest": load_latest_status(),
            "lockHeld": lock_is_held(QUEUE_ROOT / "candidate-queue.lock"),
            "gpuGate": current_gate(args),
            "trainingRuntime": runtime,
            "plans": resolved,
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    if args.dry_run:
        gate = current_gate(args)
        result = {
            "dryRun": True,
            "gpuGate": gate,
            "trainingRuntime": runtime,
            "plans": resolved,
            "promotionAllowed": False,
            "selection": selection_receipt(args),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if not gate["safe"] or runtime["ready"] is not True:
            raise SystemExit(2)
        return
    require_training_runtime()
    run_queue(args, plans)


if __name__ == "__main__":
    main()
