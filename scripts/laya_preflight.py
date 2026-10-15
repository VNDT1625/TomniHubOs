#!/usr/bin/env python3
"""Emit reproducible metadata required before a Laya training experiment."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from importlib.metadata import distribution, version
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="multilingual")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    import torch
    from laya import Router

    router = Router(preload=False)
    agent = router.load(args.model)
    package = distribution("laya")
    record = {
        "schemaVersion": 1,
        "python": sys.version,
        "platform": platform.platform(),
        "laya": {"version": version("laya"), "license": package.metadata.get("License"), "requires": package.requires or []},
        "model": {
            "route": args.model,
            "class": f"{agent.model.__class__.__module__}.{agent.model.__class__.__name__}",
            "parameters": sum(parameter.numel() for parameter in agent.model.parameters()),
            "device": str(agent.device),
            "maxLength": agent.cfg.get("max_len"),
            "headMaxLength": agent.cfg.get("head_max_len"),
            "encoder": agent.cfg.get("encoder"),
            "headLayers": agent.cfg.get("head_layers"),
            "tokenizer": f"{agent.tok.__class__.__module__}.{agent.tok.__class__.__name__}",
            "checkpointPath": None,
        },
        "torch": {"version": torch.__version__, "cudaAvailable": torch.cuda.is_available()},
        "training": {
            "packagePublicTrainingApi": False,
            "adapterSupportVerified": False,
            "decision": "blocked_pending_checkpoint_training_recipe",
        },
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "sha256": sha256(output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
