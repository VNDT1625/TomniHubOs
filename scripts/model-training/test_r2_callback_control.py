from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import train_lora


def _config(value: object = None) -> dict[str, object]:
    config: dict[str, object] = {
        "earlyStoppingPatience": 3,
        "earlyStoppingThreshold": 0.001,
    }
    if value is not None:
        config["earlyStoppingEnabled"] = value
    return config


def _names(callbacks: list[object]) -> list[str]:
    return [type(callback).__name__ for callback in callbacks]


def main() -> None:
    disabled = train_lora.build_callbacks(_config(False), 1024)
    assert _names(disabled) == ["AmpNumericalGuardCallback", "MemoryPressurePauseCallback", "FiniteWeightCallback"]
    assert not any(name == "EarlyStoppingCallback" for name in _names(disabled))

    enabled = train_lora.build_callbacks(_config(True), 1024)
    assert "EarlyStoppingCallback" in _names(enabled)
    early_stopping = next(callback for callback in enabled if type(callback).__name__ == "EarlyStoppingCallback")
    assert early_stopping.early_stopping_patience == 3
    assert early_stopping.early_stopping_threshold == 0.001

    legacy = train_lora.build_callbacks(_config(), 1024)
    assert "EarlyStoppingCallback" in _names(legacy)

    args = argparse.Namespace(
        purpose="", steps=0, max_length=0, rank=0, lora_alpha=0,
        grad_acc=0, learning_rate=0.0, precision="", target_profile="",
        eval_steps=0, save_steps=0, logging_steps=0, seed=0, warmup_ratio=0.0,
    )
    recipe = train_lora.validate_recipe(
        Path(__file__).parents[2] / ".training-recipes/v9/security-qwen35-08b-v9-a1-r2.json"
    )
    train_lora.apply_recipe_args(args, recipe)
    assert args.steps == 80
    assert args.eval_steps == 10
    print("PASS R2 callback control: disabled=0, enabled=1, legacy=1, maxSteps=80, evalSteps=10")


if __name__ == "__main__":
    main()
