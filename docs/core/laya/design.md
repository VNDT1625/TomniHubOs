# Laya design

**Status: TARGET.** Implements [requirements](requirements.md); intended boundaries remain in [AI runtime](../ai-runtime.md) and [Trust](../trust-and-understanding.md).

## Runtime

Reuse the shared sidecar client and existing early bootstrap. Do not create a second model service. A single lifecycle owner registers shutdown, manages retries and exposes state. Resolve Python and all model/tokenizer assets explicitly; package readiness must be demonstrated on a clean machine without undeclared Python or cache dependencies.

State machine: stopped -> starting -> loading -> warming -> ready. Initialization or warm-up failure -> failed; limited exponential retry -> starting. Backend fallback is visible as degraded and must successfully warm before serving. Shutdown -> stopping -> stopped rejects outstanding requests and prevents restart. Process generations prevent late exit/ready events from mutating a replacement process.

The ready handshake carries protocol version, backend, model/tokenizer identity and successful warm-up status. A bare process spawn is not readiness. Offline startup must not contact a model registry; provisioning is a separate explicit action.

## Request contract

Versioned request: requestId, task IDs, contract version, input with source role, questions, bounded input/token budget and deadline. Responses distinguish success, abstain, invalid-output, timeout, cancelled and unavailable; include backend/model identity and queue/inference timing. Main validates every expected answer before cache admission. Logs contain IDs, hashes, counts and timings, never raw secrets or private inputs.

Introduce bounded queue admission with interactive work prioritized over background notification work and starvation protection. Determine queue limits from recorded concurrency benchmarks, freeze them before acceptance. Abort removes unsent jobs. Running inference is allowed to finish if the backend cannot interrupt safely; its result is discarded and cannot mutate a cancelled run. No unbounded piped backlog or overlapping retry storm.

## Task integration

Retain shared decision session for compatible questions. Measure separate versus grouped questions before asserting one-pass efficiency. Include input, task/question version and source role in cache identity. Do not reuse security answers for redacted text without an explicit validity rule; intent reuse and security reuse are separate decisions.

Security: model detects semantic risk; Main owns authorization and final egress. Deterministic scanners produce spans; the classifier alone does not identify safe redaction offsets. An unresolved positive signal cannot be marked protected. Preserve context/source boundaries and test injection plus credential co-occurrence, PII and vault failures. Over-limit security input must not silently discard an uninspected suffix.

Intent/tool selection: low confidence becomes abstention or bounded rules fallback. Tool recommendations never grant capabilities. Existing ToolSearch remains available when selection misses; measure recovery cost. Direct Action must distinguish explicit one-step requests from quoted URLs and multi-step tasks, even when regex fallback runs. Model advice remains a proposal checked against available targets.

Turn-note worth, group relevance and notification classification retain separate task contracts, thresholds and deadlines. Their scores cannot authorize persistence, agent capabilities or outbound data disclosure.

## Training and export

Preflight: inspect installed library and checkpoint source; record license, parameter count, architecture, sequence construction, batching, losses, head behavior, truncation and reproducible versions. Select a supported training approach only after this inspection. Train from a trainable checkpoint, not the deployed INT8 graph.

First compare unchanged base against one multitask fine-tune. LoRA is an optional training technique, not a promise of live adapter switching. Try separate heads/adapters only if measured task interference warrants it. Every adapter needs an explicit base hash and isolated load/switch tests.

Pipeline: frozen dataset -> train -> validation/calibration -> original PyTorch vs patched PyTorch vs ONNX FP32 vs INT8 parity -> nominated sealed acceptance -> activation. Test all question types, batch shapes, language slices and supported length boundaries. Exporter verification must assert correctness and fail nonzero; do not delete the reference graph before parity evidence exists.

Dataset rows record task/version, source role, scenario family, language, expected labels, negative/positive strata and provenance. Include Vietnamese slang/no accents/typos, mixed language, negation, quotations, multiple intents and cross-boundary secrets. Train/validation/test must be disjoint by family and checked for duplicates. Paid compute budget and target hardware must be declared before any paid run.

## Evaluation and rollback

Freeze corpus/evaluator/model hashes, dirty-source manifest, hardware, threads and warm/cold conditions. Compare rules-only/current/candidate with identical provider model and settings; keep live-provider and deterministic replay evidence separate. Measure both classification and final application behavior.

An activation pointer selects a validated artifact bundle (weights, tokenizer, task contracts, thresholds). Switch only after successful load/warm-up, retain previous bundle, and atomically roll back on health failure. Existing deterministic protections remain active. A candidate-disable switch returns to the previous approved configuration, not permissive security.

Each action appends generated evidence with run ID, UTC times, source/model/data/evaluator identities, command and exit code, changed paths, metrics with denominators, failed slices, decision and rollback. Unknown fields stay unknown. Historical diagnostics lacking hashes are not acceptance evidence.
