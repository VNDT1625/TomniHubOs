from __future__ import annotations
import hashlib, json, math, shutil, sys
from datetime import datetime, timezone
from pathlib import Path

candidate = Path(sys.argv[1]).resolve()
template = Path(sys.argv[2]).resolve()
recipe_path = Path(sys.argv[3]).resolve()
checkpoint = candidate / "checkpoint-25"
for name in ("adapter_model.safetensors", "adapter_config.json", "trainer_state.json"):
    if not (checkpoint / name).is_file():
        raise FileNotFoundError(checkpoint / name)
if (candidate / "training_manifest.json").exists():
    raise FileExistsError(candidate / "training_manifest.json")
def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
def tree(root: Path) -> str:
    h = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root).as_posix().encode()
        h.update(len(rel).to_bytes(4, "big")); h.update(rel); h.update(bytes.fromhex(sha(path)))
    return h.hexdigest()
state = json.loads((checkpoint / "trainer_state.json").read_text(encoding="utf-8"))
if state.get("global_step") != 25 or state.get("max_steps") != 25:
    raise ValueError("checkpoint is not the approved 25-step smoke")
recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
manifest = json.loads(template.read_text(encoding="utf-8"))
shutil.copy2(checkpoint / "adapter_model.safetensors", candidate / "adapter_model.safetensors")
shutil.copy2(checkpoint / "adapter_config.json", candidate / "adapter_config.json")
manifest["candidate"] = {"id":"com.tomny.core.user-understanding", "version":"0.6.0-finite-smoke.2", "path":str(candidate)}
manifest["baseModel"] = {"modelId":"Qwen/Qwen3.5-0.8B", "revision":"2fc06364715b967f1860aea9cf38778875588b17", "contentSha256":"ff3a07808a9e83627e69a07131fdec45c60973f23cc5617204d173461ec65fe6", "path":str((candidate.parents[3] / ".local-models" / "Qwen3.5-0.8B").resolve())}
manifest["purpose"] = "user-understanding"
manifest["recipe"] = {"path":str(recipe_path), "sha256":sha(recipe_path), "content":recipe}
preflight = candidate / "training_preflight.json"
manifest["preflightReceipt"] = {"path":str(preflight), "sha256":sha(preflight)}
manifest["steps"] = 25
manifest["trainRows"] = 32
manifest["validationRows"] = 16
manifest["fullValidation"] = False
manifest["smokeOnly"] = True
train_history = state.get("log_history", [])
losses = [float(row["loss"]) for row in train_history if isinstance(row.get("loss"), (int,float))]
validation = next((row for row in reversed(train_history) if isinstance(row.get("eval_loss"), (int,float))), None)
if not losses or validation is None:
    raise ValueError("checkpoint lacks finite metrics")
best = float(state["best_metric"]); eval_loss = float(validation["eval_loss"]); tolerance = max(abs(best)*1e-4, 1e-4)
manifest["metrics"] = {"train":{"safeFinalization":True,"sourceGlobalStep":25,"train_loss":sum(losses)/len(losses)},"validation":{"eval_loss":eval_loss},"bestEvalLoss":best}
manifest["validationGate"] = {"configuredRegression":0.0,"numericTolerance":tolerance,"observedDelta":eval_loss-best,"allowedMaximum":best+tolerance,"policy":"absolute-or-relative-floating-point-tolerance"}
manifest["finalization"] = {"mode":"checkpoint-eval-only","sourceStep":25,"sourceCheckpoint":str(checkpoint),"sourceAdapterSha256":sha(checkpoint/"adapter_model.safetensors"),"trainerStateSha256":sha(checkpoint/"trainer_state.json"),"unsafeStateLoaded":False,"optimizerStepsExecuted":0}
manifest["curves"] = [{k:v for k,v in row.items() if isinstance(v,(str,int,float,bool)) or v is None} for row in train_history]
manifest["data"]["manifestPath"] = str((candidate.parents[3] / ".training-data-v6-qwen08b-semantic-r4" / "manifest.json").resolve())
manifest["data"]["manifestSha256"] = "90611e83a5308caef481e589818c5631fdfda7d8acd24efd090982d0038646e4"
manifest["data"]["datasetId"] = "tomny-qwen08b-semantic-synthetic"
manifest["data"]["datasetVersion"] = "2026-09-08.v6"
manifest["data"]["outputSchema"] = "tomny.user-understanding.output.v2"
manifest["artifacts"] = {name:{"bytes":(candidate/name).stat().st_size,"sha256":sha(candidate/name)} for name in ("adapter_model.safetensors","adapter_config.json")}
manifest["createdAt"] = datetime.now(timezone.utc).isoformat()
manifest["elapsedSeconds"] = 0.0
(candidate / "training_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print(json.dumps({"finalized":True,"candidate":str(candidate),"manifestSha256":sha(candidate/"training_manifest.json")}, indent=2))