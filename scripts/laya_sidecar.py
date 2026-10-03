#!/usr/bin/env python3
"""
Laya Decision Engine Sidecar Daemon for TomniHubOS.
Communicates with Electron Main Process via newline-delimited JSON on stdin/stdout.
Supports both fast quantized ONNX Runtime (INT8) and fallback PyTorch execution.
"""

import sys
import os
import json
import time
import traceback
import laya
from laya import Router

class OnnxModelWrapper:
    """Lightweight ONNX Runtime inference wrapper matching PyTorch DecisionModel interface."""
    def __init__(self, onnx_path: str):
        import onnxruntime as ort
        import torch
        self._torch = torch
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_options.intra_op_num_threads = max(1, os.cpu_count() // 2 if os.cpu_count() else 2)
        self.session = ort.InferenceSession(onnx_path, sess_options, providers=["CPUExecutionProvider"])

    def __call__(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
        inputs = {
            "input_ids": input_ids.cpu().numpy(),
            "attention_mask": attention_mask.cpu().numpy(),
            "marker_pos": marker_pos.cpu().numpy(),
            "marker_mask": marker_mask.cpu().numpy(),
            "qtype": qtype.cpu().numpy(),
        }
        logits, act = self.session.run(None, inputs)
        return self._torch.from_numpy(logits), self._torch.from_numpy(act)

    def to(self, device):
        return self

    def eval(self):
        return self


def resolve_onnx_model_path():
    """Find available ONNX quantized model in standard package paths."""
    candidates = [
        os.environ.get("LAYA_ONNX_MODEL_PATH"),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "resources", "models", "laya_multilingual_int8.onnx")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models", "laya_multilingual_int8.onnx")),
        os.path.abspath(os.path.join(os.getcwd(), "resources", "models", "laya_multilingual_int8.onnx")),
    ]
    for p in candidates:
        if p and os.path.isfile(p):
            return os.path.normpath(p)
    return None


def main():
    # Force utf-8 for stdout and stdin
    if sys.platform == "win32":
        import io
        sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

    sys.stderr.write("[LayaSidecar] Initializing Laya Decision Engine...\n")
    sys.stderr.flush()

    router = Router(preload=False)
    backend = "pytorch"
    onnx_path = resolve_onnx_model_path()

    if onnx_path:
        try:
            sys.stderr.write(f"[LayaSidecar] Found ONNX INT8 model at: {onnx_path}\n")
            sys.stderr.write("[LayaSidecar] Activating ONNX Runtime INT8 acceleration...\n")
            sys.stderr.flush()
            # Preload multilingual agent and replace underlying model with ONNX session
            agent = router.load("multilingual")
            agent.model = OnnxModelWrapper(onnx_path)
            for k in ['english', 'multilingual', 'typed-decisions', 'default', 'laya', 'laya-multilingual']: router._agents[k] = agent
            backend = "onnx-int8"
            sys.stderr.write("[LayaSidecar] ONNX Runtime INT8 backend active.\n")
            sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"[LayaSidecar] Warning: failed to load ONNX model ({e}), falling back to PyTorch.\n")
            sys.stderr.flush()
            backend = "pytorch"

    sys.stderr.write(f"[LayaSidecar] Laya Engine ready (backend={backend}).\n")
    sys.stderr.flush()

    # Signal ready to parent process immediately
    sys.stdout.write(json.dumps({
        "status": "ready",
        "version": getattr(laya, "__version__", "0.3.4"),
        "backend": backend,
        "modelPath": onnx_path if backend == "onnx-int8" else None
    }) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            action = req.get("action", "predict")

            if action == "ping":
                sys.stdout.write(json.dumps({
                    "id": req_id,
                    "status": "pong",
                    "time": time.time(),
                    "backend": backend
                }) + "\n")
                sys.stdout.flush()
                continue

            if action == "predict":
                state = req.get("state", {})
                questions = req.get("questions", {})

                start_t = time.perf_counter()
                result = router.predict(state, questions)
                elapsed_ms = (time.perf_counter() - start_t) * 1000

                res = {
                    "id": req_id,
                    "status": "ok",
                    "answers": result.get("answers", {}),
                    "routing": result.get("routing", {}),
                    "latencyMs": round(elapsed_ms, 2),
                    "backend": backend
                }
                sys.stdout.write(json.dumps(res, ensure_ascii=False) + "\n")
                sys.stdout.flush()
                continue

            sys.stdout.write(json.dumps({"id": req_id, "status": "error", "error": f"Unknown action: {action}"}) + "\n")
            sys.stdout.flush()

        except Exception as err:
            err_msg = traceback.format_exc()
            sys.stderr.write(f"[LayaSidecar] Error handling request {req_id}: {err_msg}\n")
            sys.stderr.flush()
            sys.stdout.write(json.dumps({"id": req_id, "status": "error", "error": str(err)}) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
