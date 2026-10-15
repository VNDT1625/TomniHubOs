# Laya requirements

**Status: TARGET.** Focused implementation annex to [AI runtime](../ai-runtime.md), not an independent release plan. Repository release/checkpoint ownership remains in [MVP plan](../../execution/mvp-plan.md).

## Evidence boundary

The reviewed worktree is dirty; HEAD `c100fb6807c7d79e53333d4678fa77fa412211f6` alone does not reproduce it. Code paths, executed tests and hashed artifacts establish CURRENT behavior; comments and earlier architecture claims do not establish speed, accuracy or training support.

Desktop paths below are relative to `packages/desktop/src/`:

| CURRENT implementation | Evidence | Limitation |
| --- | --- | --- |
| Early background startup | `index.ts`, `process/utils/warmLaya.ts` | Warm-up errors are swallowed; readiness is not reliable proof of successful inference |
| Shared Python process, ONNX/PyTorch | `process/services/security/layaSidecarClient.ts`, `scripts/laya_sidecar.py` | Python processes stdin serially; caller cancellation does not cancel inference |
| Shared security/intent/tool questions | `process/services/chatPipeline/decisionSession.ts`, `decisionTasks.ts` | One predictor call is not proof of one internal forward pass |
| Separate direct-action/model advice | `process/services/chatPipeline/stages/directActionStage.ts`, `modelRoutingStage.ts` | Separate calls and confidence policies |
| Turn-note worth, agent relevance, notifications | `process/services/database/nativeConversation/turnNotesWiring.ts`, `process/company/routing/groupRelevance.ts`, `process/system/hubActivity/notifications/notificationClassifier.ts` | All compete for the same process |
| Tool-name hints | `process/services/chatPipeline/stages/toolSchemaStage.ts` | Adds context; token savings remain unmeasured |
| ONNX export | `scripts/export_laya_onnx.py` | Verification prints logits; no numerical or decision parity assertion |

**PARTIAL:** Semantic egress adapter and database guard exist, but the review did not establish their production construction paths. Do not present their tests as universal enforcement evidence.

**BLOCKED:** Training strategy selection requires inspection of installed Laya source, checkpoint architecture/license, loss, tokenizer and export compatibility. No Laya training recipe was found in `scripts/model-training` during review.

## Requirements

- R1: Start Laya during desktop bootstrap, asynchronously with UI startup; preload the intended model, successfully warm production question shapes, then report ready. Keep one resident process until shutdown; no idle unload.
- R2: Expose starting/loading/warming/ready/degraded/failed/stopping states and bounded, redacted diagnostics. Recover with bounded retries and stop cleanly with the app.
- R3: Validate protocol version, request identity, payload bounds, question types, answer completeness, enums and finite score ranges. Return explicit unavailable/timeout/cancelled/invalid/abstain results rather than fabricated safe labels.
- R4: Apply per-task calibrated thresholds. Missing or malformed answers must not be cached as completed tasks. Preserve model-independent authorization and deterministic protection.
- R5: A secret detection must result in verified protection or escalation/block under Main policy. Never report redaction when text is unchanged and the finding unresolved. Vault failure must not return a false protection success.
- R6: Bound queue, input size and deadlines; separate queue/inference/IPC latency. Cancel queued work and discard late responses. Do not claim running inference cancellation unless implemented and tested.
- R7: Benchmark all consumers; train initial security/intent/tool selection jointly only after validating the shared model API. Keep other consumers as regression suites.
- R8: Version questions, normalizers, labels, tokenizer, model and evaluator. Split datasets by scenario family; synthetic secrets only; sealed acceptance data never becomes a reusable acceptance set after exposure.
- R9: Compare rules-only, current Laya and candidate Laya end-to-end. Measure task completion, tool recovery, total latency, model calls and tokens; no token-savings claim from classifier accuracy alone.
- R10: Candidate activation is explicit, reversible and gated by [minimum expectations](minimum-expectations.md). No silent cloud classification or permission expansion.

## Ownership

[design.md](design.md) owns this annex's technical proposal; [tasks.md](tasks.md) owns bounded work items; [minimum-expectations.md](minimum-expectations.md) owns candidate targets without weakening repository release gates. Generated action/benchmark history lives at `out/laya/action-history.md`; machine-readable evidence belongs under `out/laya/runs/<run-id>/`. History is evidence, not another normative plan.
