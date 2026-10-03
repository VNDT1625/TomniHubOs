from __future__ import annotations

import ast
from pathlib import Path

from security_v3_constrained_decoding import SecurityV3TokenConstraint

ROOT = Path(__file__).resolve().parents[2]
DAEMON = ROOT / "scripts" / "model-training" / "qwen_inference_daemon.py"


def main() -> None:
    source = DAEMON.read_text(encoding="utf-8")
    tree = ast.parse(source)
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "generate"]
    assert len(calls) >= 2
    security_calls = [node for node in calls if any(keyword.arg == "prefix_allowed_tokens_fn" for keyword in node.keywords)]
    assert len(security_calls) >= 2
    for call in security_calls:
        names = {keyword.arg for keyword in call.keywords}
        assert "eos_token_id" in names
    assert source.count('effective_eos_token_id = getattr(tokenizer, "eos_token_id", None)') == 1
    assert 'getattr(model.generation_config, "eos_token_id"' not in source

    constraint = SecurityV3TokenConstraint([(1, 2)], [248046])
    assert constraint.allowed_tokens([1, 2]) == [248046]
    assert 248044 not in constraint.allowed_tokens([1, 2])
    print("capturedFailureRegressionTest=PASS")


if __name__ == "__main__":
    main()