import modal
from pathlib import Path
app=modal.App("tomny-semantic-adapters-v8")
root=Path(r"C:\NDT\PJ\TomniHubOS")
image=modal.Image.debian_slim(python_version="3.11").apt_install("git").pip_install("torch","transformers==5.5.0","datasets","peft","accelerate","bitsandbytes","packaging","psutil","safetensors").add_local_dir(str(root/".tmp"/"regenerated-v8"),remote_path="/workspace/data").add_local_dir(str(root/".training-recipes"/"v6"),remote_path="/workspace/a/recipes").add_local_dir(str(root/"scripts"/"model-training"),remote_path="/workspace/scripts/model-training").add_local_dir(str(root/".model-adapters"),remote_path="/workspace/.model-adapters").add_local_dir(str(root/".local-models"/"Qwen3.5-0.8B"),remote_path="/workspace/model")





volume=modal.Volume.from_name("tomny-semantic-candidates",create_if_missing=True)
@app.function(image=image,gpu="T4",timeout=3600,volumes={"/outputs":volume})
def train():
 import subprocess
 import shutil
 shutil.copyfile("/workspace/scripts/model-training/train_lora_modal.py", "/workspace/scripts/model-training/train_lora.py")
 jobs = [("security", "com.tomny.core.security")]
 
 
 
 
 try:
  for domain, candidate_id in jobs: subprocess.run(["python", "/workspace/scripts/model-training/train_lora.py", "--recipe", f"/workspace/a/recipes/{domain}-modal-v8.json", "--model", "/workspace/model", "--dataset-manifest", "/workspace/data/manifest.json", "--candidate-root", "/outputs/candidates", "--candidate-id", candidate_id, "--candidate-version", "0.8.0-modal-v8"], check=True)
 finally:
  volume.commit()
benchmark_image=image.add_local_dir(str(root/".tmp"/"regenerated-v8"),remote_path="/workspace/data")
@app.function(image=benchmark_image,gpu="T4",timeout=3600,volumes={"/outputs":volume})
def benchmark():
 import os
 import sys
 import json
 os.chdir("/workspace")
 sys.path.insert(0,"/workspace/scripts/model-training")
 import benchmark_adapters as runner
 out=Path("/outputs/benchmarks/security-understanding-v4-2")
 out.mkdir(parents=True,exist_ok=False)
 Path(".model-benchmarks").mkdir(exist_ok=True)
 Path(".model-benchmarks/candidates").mkdir(exist_ok=True)
 try:
  cases,_=runner.load_immutable_cases(Path("benchmark-data/manifest.json"),["security","user-understanding"])
  independence=runner.check_training_overlap(cases,Path("data"))
  assert independence["qualityVerified"] and independence["exactNormalizedOverlapCount"]==0
  (out/"v6-independence.json").write_text(json.dumps(independence,indent=2))
  sys.argv=["benchmark_adapters.py","--domains","security","user-understanding","--candidate-root",".model-adapters/candidates","--candidate-version","0.6.0-candidate.1","--base-model-08b","model","--immutable-test-manifest","benchmark-data/manifest.json","--output",".model-benchmarks/candidates/security-understanding-v4-2/run"]
  try:
   runner.main()
  finally:
   import shutil
   local=Path(".model-benchmarks/candidates/security-understanding-v4-2/run")
   if local.exists():
    shutil.copytree(local,out/"run")
 finally:
  volume.commit()
@app.function(image=image,timeout=1800,volumes={"/outputs":volume})
def verify_semantic():
 import subprocess
 import shutil
 shutil.copyfile("/workspace/scripts/model-training/train_lora_modal.py","/workspace/scripts/model-training/train_lora.py")
 candidate=Path("/outputs/candidates/com.tomny.core.security/0.8.0-modal-v8").resolve()
 try:
  subprocess.run(["python","/workspace/scripts/model-training/verify_adapters.py",str(candidate),"--output","/tmp/semantic-verification.json"],check=True)
  (candidate/"verification-report.json").write_bytes(Path("/tmp/semantic-verification.json").read_bytes())

 finally:
  volume.commit()
@app.function(image=image,gpu="T4",timeout=3600,volumes={"/outputs":volume})
def benchmark_v6():
 import sys
 sys.path.insert(0,"/workspace/scripts/model-training")
 sys.path.insert(0,"/workspace/scripts/model-training/fixtures")
 from benchmark_v6_diagnostic import run
 try:
  import json
  import hashlib
  candidate = Path("/outputs/candidates/com.tomny.core.security/0.8.0-modal-v8")
  expected_weight = "5bcb4104c1b08695e746eac5071c8a1ac10ea476acdff267ce20d85d74ff073e"
  actual_weight = hashlib.sha256((candidate / "adapter_model.safetensors").read_bytes()).hexdigest()
  if actual_weight != expected_weight:
   raise ValueError("Security benchmark candidate weight binding mismatch")
  print(json.dumps({"phase": "benchmark-binding", "candidate": str(candidate), "weightSha256": actual_weight}), flush=True)
  run(domains=("security",), candidate_root=Path("/outputs/candidates"), candidate_versions={"security": candidate.name}, output_path=Path("/outputs/benchmarks/v8-security-rerun-4"))
 finally:
  volume.commit()
@app.local_entrypoint()
def main(): train.remote()
