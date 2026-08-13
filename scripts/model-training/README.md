# Tomny local-core model training

This offline pipeline creates immutable QLoRA candidates. Training is intentionally separate from benchmark and promotion: a successful checkpoint is only a `candidate`, never an active adapter.

## Current status

The four existing adapters are reproducible baselines and are not production-promoted. Dataset v2 now provides 640 train and 160 validation semantic groups per domain plus an independent immutable benchmark set (12 groups x 4 variants). Machine privacy/leakage/ontology/dedup gates pass, but the dataset remains candidate-only and awaits independent human review. Long retraining remains held until integrator approval of the final recipes; the trainer never reads the immutable benchmark split.

## Production contract

`train_lora.py` enforces Section 21 of the local-core runtime design:

- only `tomny.dataset-manifest.v2` plus a versioned `tomny.qlora-recipe.v1` are accepted;
- train and validation hashes, row counts, privacy, leakage, ontology, dedup, purpose, output schema, and base-model binding are validated before CUDA allocation;
- the immutable `test` path is checked as metadata only and is never opened;
- NF4 double-quantized, text-only QLoRA uses assistant-only loss and dynamic padding;
- full validation is the default; row limits require explicit `--smoke` and remain smoke-only;
- evaluation and resumable checkpoints run at recipe-defined intervals; the best validation-loss model is restored with early stopping;
- non-finite loss, metrics, gradients, weights, curves, zero target tokens, base mismatch, and validation regression fail closed;
- candidates are written to `.model-adapters/candidates/<id>/<version>` and an existing completed candidate is never overwritten;
- provenance records base revision/content hash, dataset and recipe hashes, seed, git state, package versions, token statistics, curves, and peak host/GPU memory;
- artifact verification runs after training; benchmark and promotion remain independent gates.

The script never silently narrows a recipe. `last-block` is the finite-gradient RTX 3050 Laptop 4 GB profile, but its limited adaptation capacity must be declared in `qualityLimitations`. Broader profiles require a separately validated hardware recipe.

## Recipe v1

Every training value is explicit and reviewable. Create one immutable recipe per purpose/version:

```json
{
  "schemaVersion": "tomny.qlora-recipe.v1",
  "recipeVersion": 1,
  "id": "tomny-qwen35-08b-security-rtx3050",
  "version": "2026-07-25.1",
  "promotionStatus": "candidate-only",
  "purpose": "security",
  "dataset": {
    "datasetId": "tomny-core-adapters-synthetic",
    "datasetVersion": "2026-07-25.v2",
    "manifestSha256": "59f0cb64f23854abb6b0938f3af3205b9b0f77bf0230bd7f60aaae0b42013406"
  },
  "baseModel": {
    "modelId": "Qwen/Qwen3.5-0.8B",
    "revision": "2fc06364715b967f1860aea9cf38778875588b17",
    "contentSha256": "ff3a07808a9e83627e69a07131fdec45c60973f23cc5617204d173461ec65fe6"
  },
  "seed": 20260725,
  "hardwareProfile": {
    "profile": "rtx-3050-4gb",
    "finiteGradientSmokePassed": true
  },
  "qualityLimitations": ["Only the final transformer block is adapted; quality may trail wider target profiles."],
  "training": {
    "maxSteps": 600,
    "maxLength": 256,
    "rank": 8,
    "loraAlpha": 16,
    "gradientAccumulationSteps": 8,
    "learningRate": 0.0001,
    "warmupRatio": 0.1,
    "targetProfile": "last-block",
    "loggingSteps": 1,
    "evalSteps": 25,
    "saveSteps": 25,
    "earlyStoppingPatience": 4,
    "earlyStoppingThreshold": 0.001,
    "maxValidationRegression": 0.0
  }
}
```

The numeric values above are a reviewable starting recipe, not an automatic claim of optimality. Select a final recipe using bounded finite-gradient/memory smoke tests and independent task benchmarks.

The reviewed candidate-only recipes are stored in `.training-recipes/`: security uses Qwen3.5-0.8B; user-understanding, orchestrator, and assistant use Qwen3.5-2B. Security and orchestrator use 600 maximum steps at `1e-4`; user-understanding and assistant use 800 maximum steps at `8e-5`. All use rank 8, alpha 16, effective batch 8, full validation every 50 steps, early stopping, dataset manifest SHA-256 `59f0cb64f23854abb6b0938f3af3205b9b0f77bf0230bd7f60aaae0b42013406`, and sequential execution on the 4 GB GPU. Runtime must maintain separate 0.8B and 2B base pools; adapters never cross a base binding.

## Preflight before training

Compute the deterministic content hash used by the recipe:

```cmd
py -3.11 scripts\model-training\train_lora.py --hash-model .local-models\Qwen3.5-0.8B
py -3.11 scripts\model-training\train_lora.py --hash-model .local-models\Qwen3.5-2B
```

Validate only the recipe (no data, CUDA, or writes):

```cmd
py -3.11 scripts\model-training\train_lora.py --recipe .training-recipes\security-rtx3050-v1.json --validate-recipe
```

Validate recipe, dataset v2, all readable split hashes/counts, base content, and candidate immutability without CUDA or writes:

```cmd
py -3.11 scripts\model-training\train_lora.py --recipe .training-recipes\security-rtx3050-v1.json --model .local-models\Qwen3.5-0.8B --dataset-manifest .training-data-v2\manifest.json --candidate-id com.tomny.core.security --candidate-version 0.1.0-candidate.1 --dry-run
```

Load the exact quantized text-only base after the same preflight:

```cmd
py -3.11 scripts\model-training\train_lora.py --recipe .training-recipes\security-rtx3050-v1.json --model .local-models\Qwen3.5-0.8B --dataset-manifest .training-data-v2\manifest.json --candidate-id com.tomny.core.security --candidate-version 0.1.0-candidate.1 --load-only
```

## Train and resume

Run adapters sequentially on the RTX 3050 4 GB machine. Close memory-heavy applications; the trainer refuses unsafe host commit pressure and does not lower quality settings automatically.

```cmd
py -3.11 scripts\model-training\train_lora.py --recipe .training-recipes\security-rtx3050-v1.json --model .local-models\Qwen3.5-0.8B --dataset-manifest .training-data-v2\manifest.json --candidate-id com.tomny.core.security --candidate-version 0.1.0-candidate.1
```

Resume the latest checkpoint in the same incomplete candidate:

```cmd
py -3.11 scripts\model-training\train_lora.py --recipe .training-recipes\security-rtx3050-v1.json --model .local-models\Qwen3.5-0.8B --dataset-manifest .training-data-v2\manifest.json --candidate-id com.tomny.core.security --candidate-version 0.1.0-candidate.1 --resume-from latest
```

A completed candidate cannot be resumed or overwritten. Use a new candidate version for every new run.

## Sequential candidate queue

`run_candidate_queue.py` is the only supported local operator for running all four official recipes. It holds a cross-process single-instance lock, revalidates the immutable recipe/dataset/base bindings, gates every adapter on live host-memory and `nvidia-smi` telemetry, and launches one trainer subprocess at a time. It never promotes a candidate.

The default resource gate requires at least 3072 MiB available host RAM and 3000 MiB free VRAM, GPU temperature at or below 78 °C, GPU utilization at or below 15%, no reported CUDA compute process, and no running `VALORANT.exe` or `VALORANT-Win64-Shipping.exe`. Missing or malformed telemetry is unsafe. The queue waits and records the reason by default; `--no-wait` makes it refuse immediately.

Inspect the most recent run, lock state, current GPU gate, and resume plan without writing:

```cmd
py -3.11 scripts\model-training\run_candidate_queue.py --status
```

Validate the queue and print all commands without acquiring the lock, writing status, or training:

```cmd
py -3.11 scripts\model-training\run_candidate_queue.py --dry-run
```

Dry-run exits with code 2 when the GPU gate is unsafe. Deterministic tests may supply `--probe-json <fixture>` only with `--dry-run` or `--status`; injected probes are forbidden for real training.

After review, start the queue explicitly:

```cmd
py -3.11 scripts\model-training\run_candidate_queue.py --candidate-version 0.1.0-candidate.1
```

An incomplete candidate is resumed only when a numbered checkpoint and durable `training_preflight.json` receipt exist. Its candidate id/version, purpose, pinned recipe SHA-256, dataset SHA-256, and base id/revision/content hash must exactly match the current queue contract. A completed candidate is fully re-verified before it is skipped, while a non-empty candidate without a checkpoint or matching receipt fails closed. Any trainer or verification failure stops the remaining queue. Per-run `status.json` and `queue.log` are written under `.model-adapters/candidates/_queue/<run-id>/`; candidate artifacts remain under their immutable versioned directories.

### Controlled memory-pressure pause

For future runs, the trainer checks host RAM at a safe step boundary. If it falls below `--pause-free-host-mib` (minimum 1536 MiB, default 1536 MiB), it requests a checkpoint, waits until that checkpoint is durable, writes a candidate-only `memory-pressure-pause.json` receipt, and exits with the controlled internal code `75`. It never kills the process or writes a completed training manifest on that path.

The queue maps `--pause-free-host-mib` to the trainer's `--memory-pressure-low-mib`; direct trainer invocations use the latter option.

The queue validates the receipt, records `paused-memory-pressure` with code and reason in both `status.json` and `queue.log`, then resumes only from `--resume-from latest` after host RAM reaches `--resume-free-host-mib` (default 3072 MiB). The resume threshold must be higher than the pause threshold and cannot fall below the normal 3072 MiB launch gate. With `--no-wait` or a configured wait timeout, the queue leaves a durable paused status rather than treating this controlled pause as a failed or promoted candidate.

## Verify artifacts

Training automatically invokes verification. It can also be repeated independently:

```cmd
py -3.11 scripts\model-training\verify_adapters.py .model-adapters\candidates\com.tomny.core.security\0.1.0-candidate.1 --output .model-adapters\candidates\com.tomny.core.security\0.1.0-candidate.1\verification-report.json
```

Verification checks finite safetensors, immutable artifact hashes, recipe and dataset provenance, base content binding, full-validation evidence, token counts, and finite metrics/curves. Verification is not a benchmark or promotion decision.

A completed legacy candidate that predates `validationGate` is never edited in place. Verification accepts only `validation-gate-migration.json` using schema `tomny.validation-gate-migration.v1`; the sidecar must bind the unchanged training-manifest SHA-256, the prior verification-report SHA-256, candidate identity, recipe regression, and the current numeric-tolerance derivation. The new verification report records the sidecar SHA-256 as an auditable evidence source.

## Candidate-only post-training benchmark

After the queue reaches exactly `completed-candidates`, run a read-only preflight. It re-verifies all four candidate artifacts, recipe/data/base provenance, both local base-model tree hashes, the queue status-path binding, and every immutable test hash. It refuses incomplete or tampered candidates and never launches the GPU benchmark in dry-run mode.

```cmd
py -3.11 scripts\model-training\post_training_benchmark.py --dry-run
```

A real invocation calls `benchmark_adapters.py` with the mixed 0.8B/2B candidate paths and immutable test manifest, writes only beneath `.model-benchmarks/candidates/<version>/<run-id>/`, and emits `post-training-candidate-report.json`. Paths containing `active`, `pilot`, or `production` are rejected, and the report always has `promotionAllowed=false`.

The current synthetic test has 12 independent semantic groups per domain. The confidence-bound production evidence policy requires at least 100 groups and 30 critical groups, so the expected current result is `insufficient-evidence`, not promotion and not a mysterious permanent failure. Add independent human-reviewed, isolated evidence before reconsidering those gates.
