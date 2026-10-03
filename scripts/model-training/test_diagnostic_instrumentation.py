"""CPU-only tests for training execution evidence and diagnostic boundaries."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import train_lora


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        heartbeat = root / "heartbeat.json"
        markers = [
            "BOOT_00_CONTAINER_ENTRY",
            "BOOT_01_ARGS_LOADED",
            "BOOT_02_RUNLOCK_VERIFIED",
            "BOOT_03_DATASET_READY",
            "BOOT_04_BASE_LOAD_START",
            "BOOT_05_BASE_LOAD_DONE",
            "BOOT_06_PARENT_ADAPTER_LOAD_DONE",
            "BOOT_07_TRAINER_CONSTRUCTED",
            "BOOT_08_READY_BEFORE_TRAIN",
        ]
        for marker in markers:
            train_lora.execution_heartbeat(str(heartbeat), "diag-test", marker)
            assert json.loads(heartbeat.read_text(encoding="utf-8"))["marker"] == marker
        success = heartbeat.with_name("heartbeat.success.json")
        train_lora.execution_success_receipt(str(heartbeat), "diag-test")
        success_payload = json.loads(success.read_text(encoding="utf-8"))
        assert success_payload["status"] == "DIAGNOSTIC_PRETRAIN_SUCCESS"
        assert success_payload["optimizerSteps"] == 0
        assert success_payload["trainerTrainCalled"] is False
        assert success_payload["candidateCreated"] is False

        train_lora.execution_heartbeat(str(heartbeat), "failure-test", "BOOT_07_TRAINER_CONSTRUCTED")
        train_lora.execution_failure_receipt(str(heartbeat), "failure-test", RuntimeError("forced post-trainer-construction"))
        failure = json.loads(heartbeat.with_name("heartbeat.failure.json").read_text(encoding="utf-8"))
        assert failure["failurePhase"] == "BOOT_07_TRAINER_CONSTRUCTED"
        assert failure["optimizerStepsCompleted"] == 0
        assert failure["candidateCreated"] is False
        assert failure["trainingStarted"] is False
        assert "post-trainer-construction" in failure["message"]
    print("diagnostic instrumentation CPU tests: PASS")


if __name__ == "__main__":
    main()
