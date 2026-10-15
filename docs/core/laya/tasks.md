# Laya implementation tasks

**Status: TARGET.** Bounded work breakdown for [requirements](requirements.md), not a replacement for the [master execution plan](../../execution/mvp-plan.md). No implementation item is complete merely because this spec exists.

## Ordered acceptance atoms

- [x] A0: Read current Laya runtime/consumer/export code; present findings for user review. User approved moving to spec. Prior test observations remain diagnostic, not release proof.
- [x] A1: Inspected installed Laya source/checkpoint/license and production registration paths. `scripts/laya_preflight.py` emits reproducible metadata; package version 0.3.4 is Apache-2.0, multilingual checkpoint is 321,908,995 parameters with 1,024-token context, and multi-question prediction batches into one model call. Public train/LoRA API remains BLOCKED pending a compatible checkpoint training recipe.
- [ ] A2: Freeze task contracts, evaluator, family split and dirty-source manifest; establish rules-only/current baseline. Exit: machine-readable results, reliable nonzero failure exits and generated action history.
- [ ] B1: Implement lifecycle/readiness, process generation isolation, shutdown and observable failures. Test early exit, warm-up failure, restart races and offline startup. Rollback: disable candidate, retain old approved bundle.
- [ ] B2: Implement bounded admission/deadlines and validated complete responses; test concurrency, abort/late responses, cache validity and mixed consumer load. Rollback: restore prior scheduler with protective fallback.
- [ ] B3: Fix verified redaction/vault failure handling, source boundaries and direct-action fallback semantics. Contract tests must reach Main execution/egress seams. Rollback never permits unresolved raw secrets.
- [ ] T1: Build family-separated synthetic training data and immutable evaluation sets using frozen production questions; audit labels/duplicates/leakage/truncation. No paid training before budget approval.
- [ ] T2: Train one supported multitask candidate; compare against unchanged base on validation and all consumer regressions. Record hyperparameters, seed, cost and checkpoint hashes. Candidate remains inactive.
- [ ] E1: Add original/patched/ONNX/INT8 parity assertions across shapes, languages and length limits; retain reference artifacts and emit failing exit codes. No runtime candidate replacement on export alone.
- [ ] E2: Run sealed acceptance against minimum expectations, including paired end-to-end token/time tests, cold start and soak. Preserve every failed result; decide iterate/blocked/qualify.
- [ ] I1: Integrate explicit artifact activation, rollback and disable switch; prove packaged clean-machine offline startup, shutdown and absence of undeclared dependencies. Run applicable repo gates.

Dependencies: A1 -> A2; after frozen contracts A2, B1/B2/B3 and T1/T2 may proceed in parallel with independent evaluator work. T2 + E1 + backend acceptance -> E2 -> I1. Any discovered shared-contract change returns to Integrator ownership and invalidates mismatched evaluations.

## Ownership and parallel execution

Before delegation, pin starting revision plus dirty-file hashes and reconcile existing user edits. Each atom gets an exact file allowlist, forbidden shared files, acceptance command/exit criteria, migration/rollback/kill behavior and commit ownership. No agent commits by default.

Integrator owns shared contracts, bootstrap/IPC/schema changes, registries, activation and canonical status. Training owns approved training-only paths; runtime owns approved sidecar/lifecycle paths; verification owns approved test/evaluator paths. These are responsibility boundaries, not permission to edit an entire directory. Follow the four-slot and Store-track obligations in the master plan when cross-domain implementation begins.

## Verification and evidence

Use meaningful unit tests plus lifecycle/security contract and integration tests. After code changes run `bun run lint`, `bun run format:check`, `bunx tsc --noEmit`, `bun run test`; renderer/i18n changes additionally run `bun run i18n:types` and `node scripts/check-i18n.js`. Do not run training or paid-provider benchmarks as accidental default test side effects.

Every atom records generated `out/laya/action-history.md` and `out/laya/runs/<run-id>/` evidence: UTC timing, starting source/dirty hashes, exact command, exit code, changed files, model/data/evaluator identity, metrics/denominators, failure slices, decision and rollback. No raw private input. Unknown output/exit status is BLOCKED, never PASS. Retain historical failures; update canonical status only from concrete evidence.
