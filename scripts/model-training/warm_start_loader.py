from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import torch
from peft import get_peft_model_state_dict, set_peft_model_state_dict
from safetensors.torch import load_file


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_standalone_adapter(
    model: torch.nn.Module,
    adapter_path: Path,
    expected_sha256: str,
    expected_tensor_count: int = 44,
) -> dict[str, Any]:
    """Strictly load one frozen adapter into an already constructed PEFT model."""
    path = adapter_path.resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    actual = sha256_file(path)
    if actual != expected_sha256:
        raise ValueError(f"adapter SHA mismatch: expected {expected_sha256}, got {actual}")
    state = load_file(str(path), device="cpu")
    if len(state) != expected_tensor_count:
        raise ValueError(f"adapter tensor count mismatch: {len(state)}")
    if any(not bool(torch.isfinite(value).all()) for value in state.values()):
        raise FloatingPointError("adapter contains non-finite values")
    # PEFT inserts the adapter name in live parameter names, while safetensors
    # uses PEFT's canonical checkpoint keys. Compare canonical keys strictly.
    live_state = get_peft_model_state_dict(model)
    live_keys = set(live_state)
    if live_keys != set(state):
        missing = sorted(live_keys - set(state))
        unexpected = sorted(set(state) - live_keys)
        raise ValueError(
            f"adapter key mismatch: missing={missing}, unexpected={unexpected}"
        )
    result = set_peft_model_state_dict(model, state)
    if result.unexpected_keys:
        raise ValueError(f"adapter load mismatch: unexpected={result.unexpected_keys}")
    restored_state = get_peft_model_state_dict(model)
    mismatches = [
        name
        for name, value in state.items()
        if name not in restored_state or not torch.equal(restored_state[name].cpu(), value)
    ]
    if mismatches:
        raise ValueError(f"adapter value mismatch after load: {mismatches}")
    trainable = [(name, parameter) for name, parameter in model.named_parameters() if parameter.requires_grad]
    if len(trainable) != expected_tensor_count:
        raise ValueError(f"trainable tensor count mismatch: {len(trainable)}")
    return {"sha256": actual, "tensorCount": len(state), "trainableTensorCount": len(trainable), "valueMismatches": 0}
