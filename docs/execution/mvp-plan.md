# Store-first autonomous multi-agent MVP master plan

**Status:** TARGET execution order with CURRENT and PARTIAL evidence identified at each gate.
P7 packaged Windows evidence (2026-09-09): `bun run package` completed the renderer build, `electron-builder --config packages/desktop/electron-builder.yml --win --x64 --dir --publish=never` exited 0, and the rebuilt `out/win-unpacked/Tomny.exe` passed `scripts/release/verify-windows-desktop-lifecycle.mjs` (exit 0) with `clean-machine-ready.json` under `.tmp/p7-current-20260909`. P7 remains PARTIAL for release because production Authenticode signing and independent host attestation are unavailable; this does not mark C5/C6A CURRENT.

P7 clean-profile rerun (2026-09-09): existing `out/win-unpacked/Tomny.exe` passed `scripts/release/verify-windows-desktop-lifecycle.mjs` exit 0 with a fresh isolated profile `.tmp/p7-live-check-current`; receipt proved `isPackaged=true`, matching `runId`, matching `userDataPath`, and renderer load. This is local artifact evidence only; production signing and independent attestation remain BLOCKED.

P7 rebuild and clean-profile verification (2026-09-09): `bun run package` exit 0; `electron-builder --config packages/desktop/electron-builder.yml --win --x64 --dir --publish=never` exit 0 with native module rebuild and executable signing steps; fresh `.tmp/p7-post-build-check` lifecycle verifier exit 0 and receipt proved packaged startup, renderer load, run ID, and profile binding. Production Authenticode certificate/independent attestation remain BLOCKED.

**Objective:** ship an account-first, local-first Hub Agent OS whose Store can safely publish, review, discover, install, update, remove, and activate Package Apps before AI is allowed to operate their Surfaces. Security and causal User Intelligence standardize on the **Laya Decision Engine** (~33ms); Orchestration improves through API LLM evaluation and benchmarks, without local adapter training. Managed AI and managed cloud follow behind independent billing and resource gates.

This is the only implementation plan. Product intent, current evidence, target architecture, Trust, AI runtime, package, Store, billing, cloud, and release rules remain owned by their canonical documents. This plan owns dependency order, parallel-agent allocation, convergence journeys, and release evidence.

Canonical references: [product vision](../product/vision.md), [current architecture](../architecture/current.md), [target architecture](../architecture/target.md), [Trust and User Intelligence](../core/trust-and-understanding.md), [AI runtime](../core/ai-runtime.md), [packages](../platform/packages.md), [Store commerce](../platform/store-commerce.md), [credits and billing](../platform/credits-and-billing.md), [cloud execution](../platform/cloud-execution.md), and [testing and release](../engineering/testing-and-release.md).

## Model topology lock (Standardized on Laya, 2026-09-21)

All local decision and runtime work uses the **Laya Decision Engine** (~322M/421M non-autoregressive encoder) serving three capabilities: security, user-understanding, and combined semantic-analysis. Generative autoregressive Qwen models are removed from the target local architecture and orchestration uses an API LLM. No local decision model grants capability or performs autonomous orchestration.

## Semantic cleanup and bounded experiments (2026-09-08)

**TARGET, user-requested execution order:** finish cleanup and benchmark design before starting further GPU jobs. Stop every project Modal app and notebook kernel, verify no running containers, and preserve verified candidates/raw reports locally. Idle Volumes may still incur storage charges; zero compute is not a zero-bill claim. Inventory remote storage, download and hash-check all evidence before removing remote copies. Remove obsolete 2B artifacts through the repository write boundary; report any tool restriction instead of claiming deletion. Preserve unrelated dirty work and immutable prior evidence.

**CURRENT cleanup (2026-09-08):** Modal app listing shows all project apps stopped with zero tasks; container and Volume listings are empty. Before deleting `tomny-semantic-candidates`, all 54 files (85,622,760 bytes) were downloaded and SHA-256 checked against streamed remote bytes. Recovery evidence is under `C:/Users/MyPC/.codex/artifacts/tomny-modal-cleanup-20260908/`, with `backup-manifest.json`. Nine obsolete 2B recipes and the obsolete aggregate verification report were removed through MTUI. The user authorized direct deletion after MTUI exhausted memory. The 4,548,221,488-byte 2B weight was deleted and its absence verified; a recursive audit found only empty Hugging Face cache directories and no remaining files. No new GPU job is started during cleanup.

The minimum and desired benchmark contracts, output schemas and safety invariants are owned by [Testing and release](../engineering/testing-and-release.md#semantic-benchmark-contracts-2026-09-08).

### Production completion plan (2026-09-08)

The end state is production-usable chat with security inspection on the shared Main egress seam and confirmed-only user-understanding running asynchronously. The canonical backend design and ten-scenario review are in [Trust and user understanding](../core/trust-and-understanding.md#production-semantic-backend-design-2026-09-08). These are acceptance gates, not a serial work queue. After B0, prioritize B3 corpus/recipe preparation so B4 training starts as soon as data and spending gates pass; implement B1/B2 locally while remote training runs. B1/B2 completion does not block training. Preserve immutable evidence:

1. **B0 contract:** freeze output schemas, secret vault/fingerprint boundary, long-input envelope, cache/single-flight scope, queue/deadline/cancellation receipts and feature flags. First resolve conflicts found in the ten analytical scenarios; then derive contract tests from the accepted design.
   **CURRENT seed evidence (2026-09-08):** The previous semantic v7 authored fixture was rejected and deleted because its rows repeated four scenarios under fabricated family IDs. No v7 three-domain manifest is currently frozen, and no new GPU job is authorized until independent bilingual train/validation/test families pass the loader.

2. **B1 deterministic backend:** implement/verify exact-payload scanning, registered-secret keyed matching, cross-field coverage, rewrite and final pre-transport recheck. Prove no secret plaintext in model, renderer, cache or audit.
3. **B2 selective runtime:** wire security only for unresolved gray-zone egress; run understanding asynchronously with revision/correction/deletion checks. Add bounded fair queue, single-flight, cache invalidation, cancellation and worker recovery. Security never waits for understanding.
4. **B3 authored corpus:** create v7 train/validation/test with 30+ independent bilingual families per adapter, all memory kinds/scopes, secret/temporary boundaries and all four semantic branch combinations. Generate manifest only after preflight passes.
5. **B4 candidate experiments:** train corrected candidates on Modal with spending cap and stopped compute between cleanup/evidence actions. Evaluate an immutable completed candidate in parallel with training a different candidate; never share a mutable checkpoint.
6. **B5 quality/performance:** run frozen minimum/desired quality tests plus long-input 128/256/512/1024/2048 token workloads, concurrency 1/2/4/5, cache-hit/single-flight, queue deadline, cancellation, OOM and recovery. Diagnose defects through Plan A; at most two bounded alternatives in B and one constrained-decoding variant in C.
7. **B6 production integration:** connect the nominated inactive candidates to chat/security/understanding behind kill switches; verify receipts, rollback, clean restart, secret rotation, user correction/deletion and no external egress on failures. Activate only if every minimum security and runtime gate passes.
8. **B7 stop rule:** if corrected implementations and bounded A/B/C comparisons still miss the minimum, keep the best candidate inactive, stop Modal, preserve reports and document the measured limitation. Never label it production or absolute model impossibility.

Completion means all gates have same-revision evidence, not merely that training finished.
**CURRENT evidence update (2026-09-09):** Security v7 full candidate verified on Modal (275 steps, finite weights, immutable base/provenance) but held-out quality failed: schema 59/60, action 34/60, exact 0/60. Plan A found held-out reason-code novelty (test codes absent from train), so this candidate remains inactive and no A/B/C job starts until a corrected corpus contract is frozen. Main egress queue bound and recovery tests pass 13/13.
**CURRENT security v8 diagnostic (2026-09-09):** Run ap-Vkwze6gZAYL9DjsdX4wY6F evaluated candidate 0.8.0-modal-v8 with weight SHA-256 5bcb4104c1b08695e746eac5071c8a1ac10ea476acdff267ce20d85d74ff073e. Schema is 57/60, exact correctness 0/60, mean GPU inference 2.861 seconds. Field inspection finds action 32/60, riskType 35/60 and reasonCode 4/60; this is not only a formatting failure. The v8 corpus still has test codes DESTINATION_CHANGED and LOCAL_SECRET absent from train, and all ten validation reason codes absent from train. Preserve the frozen report and raw outputs in Modal volume tomny-semantic-candidates at benchmarks/v8-security-rerun-4; raw SHA-256 cec49e0f26d64e1c69d543b7f4d780f5e95c3b99ffd36ba454e08e4180734c0a. Modal is stopped with zero tasks. Candidate remains inactive; correct and validate label coverage before another paid experiment. These synthetic diagnostic results do not establish a model capacity ceiling or production readiness.

### Training-first execution order (user clarification, 2026-09-08)

The ten scenarios are a thought exercise about WHEN to invoke local semantic inference (Laya), not a request for ten new tests. Resolve routing tradeoffs quickly, then freeze the input/output contract. Do not postpone corpus authoring to add unrelated guard tests or documentation refinements.

1. Finish authored v7 data, validate independence/coverage/privacy/token lengths, freeze validation and heldout, and bind new immutable recipes to the existing 0.8B base. Check live Modal balance/rates and the cycle cap before launching.
2. Launch understanding smoke/full on remote GPU A. During this job, implement B1/B2 backend locally without loading the training model on the desktop. Capture job ID, logs, timeout and persistent checkpoint location.
3. GPU B may benchmark the completed security candidate against the frozen compatible contract while GPU A trains understanding. Reverify historical artifact/source provenance first; an old verify report does not bind a changed trainer. A failed security evaluation schedules a corrected security candidate on GPU A after understanding, not an unbounded retry.
4. Benchmark completed understanding on GPU B while GPU A trains the next eligible candidate. Start combined semantic full training after standalone minimum gates pass. Keep at most two remote GPU jobs and the total cycle budget; stop each worker after its assigned job.
5. Apply bounded A/B/C comparisons only for diagnosed failures; preserve failed evidence and never lower thresholds. Finish local chat integration during remote jobs, then run final host performance qualification alone without competing training. Production activation still requires all quality/security/integration gates.

### Parallel schedule

- CPU lane: audit corpus, fix split coverage and tokenizer/label alignment, freeze evaluation contracts, run security/integration tests and prepare provenance. No GPU is needed here.
- GPU training lane: train one independent adapter candidate at a time, starting with understanding. Run a bounded smoke and verify it before full training. Persist artifacts in a dedicated Volume path with timeout and final commit on failure.
- GPU evaluation lane: benchmark a previously completed immutable candidate while the training lane works on a different candidate. Never evaluate a checkpoint still being written. Maximum two GPU jobs total; inference measurements for deployment concurrency run alone on the named deployment host.
- Integration: once security and understanding pass their own minimum, train/evaluate combined semantic using the same frozen base. A failure of the combined adapter must not erase passing standalone evidence; it remains disabled until its own gates pass.
- Stop each job after its single work item; no automatic rerun or unbounded retry loop. Use T4 by default, cap full training jobs at two hours and benchmark jobs at one hour, and record actual elapsed time/cost. Existing roughly $42 credit is not a verified current balance. Check available balance/rate before launch; reserve a maximum $10 for one A/B/C cycle, never enable paid overage, and stop if credit/rate visibility cannot establish that ceiling.

### Plan A: repair correctness first

Audit train/inference chat templates, thinking mode, assistant loss masks, complete target tokens, data labels, adapter switching and benchmark schema. Rebuild versioned train/validation coverage for all understanding kinds/scopes and all four semantic branch combinations, using disjoint scenario families and natural Vietnamese/English text. Keep secrets synthetic. Run one controlled smoke and then one full corrected candidate. If a concrete bug is found, fix it and rerun its regression check; do not interpret that failure as model capacity.

### Plan B: bounded capacity experiment

If A is correct but validation remains weak, compare at most two predeclared alternatives: broaden LoRA targets beyond the last block, then adjust rank/learning rate based on validation. Change one variable group per comparison; use the same data split, seed and inference settings. Run the baseline and selected alternative on two fixed seeds only if the first comparison shows material improvement. Material improvement means >=2 percentage points in structured correctness with no critical-safety regression. Prefer the smaller/faster candidate when improvements are within uncertainty.

### Plan C: bounded completion or stop

If schema remains the main defect, evaluate schema-constrained decoding as a separately labelled runtime variant, including semantic correctness and latency; grammar cannot fix a wrong decision. Do not change the expected answers or omit hard cases. Allow at most one final candidate within the remaining cycle budget. If two successive valid comparisons improve by <2 points or any budget limit is reached while the minimum is unmet, stop training, retain evidence and the best inactive temporary result, and report the measured limits to the user. A standalone pass does not constitute completion of the three-adapter objective.

## 1. Canonical product model

### 1.1 Package App and Surface

- One **Package App equals one Surface**.
- Every Surface has a user interface that a person can open and use.
- A Surface may allow AI access or may remain user-only. There is no separate “user Surface” type.
- AI access is an explicit, versioned policy on the Surface: allowed operations, schemas, permission requirements, secret use, data destinations, cancellation, limits, and evidence.
- Installing a Package App does not grant AI access. Installation consent and AI-access consent are separate decisions.
- Core may depend only on published package contracts. It never imports a Surface implementation.

Workflow, skill, theme, model metadata, and remote capability metadata may be distributed by the package ecosystem, but only a Package App creates a Surface. Remote capability metadata is signed placement metadata owned by a named Package App and Surface; it cannot be listed, selected, or invoked as an independent app and has no separate Surface identity or UI.

### 1.2 Local, cloud, and hybrid placement

Local and cloud are execution placements of a Surface, not different Surface concepts.

- **Local Surface:** the Package App is installed on the device; its UI is available to the user; permitted AI operations run through the local package broker.
- **Cloud Surface:** the complete app runtime is available remotely without requiring its executable package on the device; its user UI remains accessible through an approved remote presentation/control path and it produces the same class of product.
- **Hybrid task:** the Orchestrator may use local and cloud Surfaces in one governed Run when that produces the best safe outcome.

The system is local-first, not local-only:

1. prefer a healthy installed matching Surface when capability, privacy, budget, and consent permit;
2. propose local installation when the user needs persistent device-local control, offline use, local-data placement, or repeated use and the device can support it; remote UI availability alone is not a reason to install;
3. use a compatible cloud Surface when installation is unnecessary, unavailable, too heavy, or less effective;
4. combine local and cloud steps when neither placement alone is sufficient;
5. never silently install, purchase, enable AI access, or move protected data to cloud.

### 1.3 Store search and task-driven discovery

Store search and Orchestrator discovery use one authoritative Surface index and record inclusion and exclusion reasons.

For a query or required capability, ordering is deterministic:

1. installed, enabled, compatible, healthy, matching Package Apps;
2. installed matching Package Apps that need enablement, update, or renewed consent;
3. ready cloud placements of matching Surfaces;
4. compatible Store Package Apps available for installation;
5. unavailable or excluded candidates, shown only when an explanation helps the user.

An unrelated installed app does not outrank a relevant result merely because it is installed. Security, privacy, compatibility, hard budget, and explicit user constraints are filters, not ranking suggestions.

The AI does not hard-code “app creation means IDE.” It first decomposes the goal into required capabilities, searches the Surface index, compares eligible candidates, and explains the selected local, cloud, install, or hybrid plan.

## 2. What counts as MVP

### 2.1 Core plus Store candidate

A clean desktop installation proves all of the following at one revision:

1. **Account-first entry:** first launch requires browser OAuth/OIDC Authorization Code + PKCE sign-in; Main/OS holds session material, renderer has no bearer token, expiry/revocation fail closed, and the only offline allowance is a tested protected-session local grace mode.
2. **Usable Store:** search, installed-first ranking, product detail, install, update, disable, enable, rollback, revoke, uninstall, and restart recovery work through the Package Supervisor.
3. **Integrated UI:** an installed Package App registers exactly one Surface in Hub navigation; opening it renders its declared UI; update and uninstall change the UI registry without rebuilding the base or leaving residue.
4. **Publisher lifecycle:** a verified Publisher Profile and enrolled signing key let a developer submit a Package App, receive deterministic automated-review evidence, correct rejection findings, publish an approved signed version, stage an update, delist it, and issue a security revocation.
5. **Review boundary:** manifest, identity, signature, provenance, dependency graph, compatibility, archive/path/size, runtime, permission, secret, network, data-retention, UI, and AI-access declarations are checked before publication. High-risk or privileged submissions require human review.
6. **Store commerce:** one paid first-party Package App completes ordinary-money order, payment capture, entitlement, opaque AcquisitionGrant, activation, refund, revocation, and durable receipt exactly once. A fixture proves the standard 15/85 third-party split without opening public payout.
7. **Governed Hub:** one Foundation Run owns plan, progress, artifacts, delegation, cancellation, recovery, evidence, resources, and one terminal receipt.
8. **Three measured cores:** Security, causal User Intelligence, and Orchestration each have a versioned corpus, deterministic benchmark, baseline, regression threshold, and traceable change record.
9. **Causal User Intelligence:** `context -> origin/evidence -> reason -> scope -> proposal -> outcome` is preserved. The user can inspect, explain, confirm, reject, correct, forget, export, delete, or pause learning. Sensitive traits never become authorization or advertising data.
10. **Provider neutrality:** API-key models, supported OAuth/router paths, compliant CLIs, one local loopback model, and one MCP tool use the same Hub, Trust, resource, cancellation, and receipt contracts.
11. **Task-driven Surface journey:** the user requests “create app ABC”; the Orchestrator derives required capabilities, searches installed and Store Surfaces, proposes a suitable IDE or alternative only when justified, installs after consent if needed, separately obtains AI-access consent, and uses the Surface to create, build, test, and return the app with evidence.
12. **Local/cloud/hybrid routing:** a representative task proves installed-local priority, cloud use without local installation, and one hybrid plan, with no silent local-to-cloud fallback.
13. **Clean base:** every optional Surface implementation is absent from the base graph and artifact. Default Browser and IDE surfaces remain available; Terminal is an IDE capability. Store, Hub, settings, recovery, and ordinary conversation work with no optional Package App installed.

### 2.2 Full managed-usage MVP

After Core plus Store passes, the full managed-usage checkpoint adds:

1. one Tomni-managed AI call with versioned quote, atomic Credit reservation, normalized metering, exactly-once settlement, release/refund, and reconciliation;
2. one on-demand managed cloud Surface task with reservation before provider creation, isolated execution, progress, metering, and verified cleanup of compute, disk, secret, process, socket, and leases;
3. zero managed compute-resource charge during the defined idle test;
4. no duplicate mint, negative Credit balance, double spend, charge above the accepted maximum, or unreconciled provider usage.

Managed switches may remain disabled for the Core plus Store candidate. A disabled switch is not evidence for Full managed usage.

## 3. Scope guard

The fastest acceptable MVP contains:

- one Store and Package Supervisor lifecycle;
- one tiny sandboxed pilot and one extracted IDE Package App;
- one published first-party paid product and one third-party accounting fixture;
- one ordinary Hub task that chooses and uses a Surface;
- one API-key cloud model, one supported OAuth/router path, one CLI, one local loopback target, and one MCP path;
- one local, one cloud, and one hybrid Surface execution proof;
- one private workflow or Super Package replay fixture;
- one managed-AI rate card and one managed-cloud provider/resource class only in Full managed usage;
- Windows desktop evidence first.

Post-MVP items include broad optional-app packaging, public seller payout, drag-and-drop Super Package authoring, sophisticated learned ranking, warm VM pools, reserved cloud capacity, and platform parity.

## 4. Non-negotiable invariants

- Store delivery precedes production AI-to-Surface connection.
- A verified Tomni Account session is required before Hub, Store, package, model, cloud, consent, or publisher actions; only the named protected-session offline grace path may run without current network revalidation.
- One Package App creates one Surface identity; package version changes do not create a second Surface.
- Every Surface always has user UI. AI access is optional, least-privileged, independently consented, and revocable.
- Foundation Run Kernel is the only run-lifecycle owner.
- The Orchestrator decomposes goals and plans; Store/Resolver finds Surfaces; TrustBroker authorizes; Package Supervisor installs and activates; ResourceCoordinator leases; Billing settles.
- Installed-first is a ranking rule after hard eligibility filters, not a bypass around capability, security, privacy, health, compatibility, or budget.
- Secrets remain in Main or an approved isolated runtime and reach a Surface only through an opaque handle scoped to an approved operation and destination.
- User Intelligence may influence a proposal, explanation, and presentation order only among already eligible and execution-equivalent candidates. An explicit user pin is a deterministic constraint. Learned context never changes execution routing, placement, permissions, Trust, consent, egress, budget, or advertising eligibility through Core plus Store.
- Entitlement proves commercial admission only. It cannot change signature, trust, permission, isolation, review, or AI-access policy.
- State, policy, search, accounting, and lifecycle transitions are deterministic services. An LLM is called only where reasoning is required.
- Every governed action produces identity, origin, capability, policy, cancellation, resource, evidence, and terminal receipt records.

## 5. Continuous training and benchmark discipline

Security, User Intelligence, and API LLM Orchestration develop alongside Store. Local modeling standardizes on the Laya Decision Engine (~322M/421M non-autoregressive encoder) for security, user-understanding, and semantic-analysis. Orchestration corpora are evaluation inputs, not local-model training data. Training does not mean uncontrolled live self-modification.

Every core maintains:

1. a versioned schema and corpus;
2. synthetic, licensed, or explicitly consented data with provenance and deletion policy;
3. fixed training/validation/test separation when model fitting begins;
4. deterministic baseline metrics and safety floors;
5. before/after benchmark evidence for every policy or model change;
6. an offline, versioned candidate artifact;
7. rollback to the last passing artifact;
8. no production promotion when a critical safety or outcome metric regresses;
9. a candidate report containing dataset schema, version and hash, source class, consent-policy version, deletion-ledger version, held-out corpus version, metric IDs, denominators, scores, floors, comparator revision, and rollback target, with no raw personal text.

Private or user runtime traces may enter a corpus only through a separate, revocable evaluation or training program with active purpose-specific consent at training and export time, redaction, causal scope validation, retention assignment, and deduplication. Runtime learning, cloud projection, analytics, and cross-user training consents are distinct; absence or withdrawal fails closed.

Personality, psychology, taste, and aesthetics data may be evaluated only with explicit category, purpose, scope, and retention consent. Without it, only synthetic or aggregate licensed data is allowed. Cloud projection requires a separate destination-bound approval, and the benchmark must prove that non-consented sensitive records never leave the device.

Deletion or consent withdrawal propagates through corpus manifests, derived candidate datasets, embeddings, indexes, caches, queued jobs, evaluation artifacts, and backups within declared retention. Only non-reidentifying tombstone and audit evidence may remain. Candidate artifacts trained before withdrawal are quarantined until retrained or explicitly marked as prohibited from future use. Secret values, raw credentials, and private workflows never enter a corpus.

Core measurements:

- **Security:** denial precision/recall for unauthorized capability, origin, host, secret egress, prompt-injected side effect, package abuse, cancellation, and final egress; the scorer proves the forbidden action did not occur; zero critical bypass and the frozen red-team false-allow threshold are release floors.
- **User Intelligence:** causal-chain validity, reason/scope preservation, clarification rate for reasonless repetition, scoped-conflict cohorts such as full-time versus part-time CV use, harmless-choice unnecessary-question rate, correction and deletion propagation, projection precision, and authorization independence; false generalization, authorization drift, and non-consented sensitive or cloud leakage have a zero release floor.
- **Orchestration:** capability coverage, installed-local preference, correct cloud fallback, justified install proposal, hybrid-plan success, verified outcome, latency, model/tool use, resource use, and estimated cost under hard policy constraints.

### 5.1 Candidate training execution protocol

Before fitting a core, freeze one research record containing the candidate ID/version, immutable base-model revision and hash, recipe hash, corpus manifest hash, held-out test manifest hash, comparator revision, benchmark seed, metric IDs and pass/fail floors. Run the unadapted base model on the same held-out clean, paraphrase, noisy, and adversarial cohorts first; a lower validation loss alone is never a readiness claim.

Fit exactly one core candidate at a time, offline and candidate-only. The queue must record preflight hardware/resource evidence, evaluate and save on the same fixed cadence, retain optimizer/scheduler/RNG checkpoint state for deterministic resume, and bind every checkpoint evaluation to a verification report and its adapter/base/corpus hashes. A user cancellation is a first-class `cancelled` terminal state: it terminates only that candidate's trainer, preserves the last verified checkpoint, starts no later core, and never changes promotion eligibility.

Evaluate a stopped or completed candidate against the frozen base comparator on the full held-out cohort, including schema validity, task accuracy/F1, critical/catastrophic cases, perturbation robustness, calibration, bilingual gap, latency, throughput, and peak memory. The candidate must meet every applicable safety floor and must not regress a critical baseline result. A passing automated candidate then requires an independent red-team/replay pass and a rollback drill before it may enter a signed pilot; production promotion remains a separate C3 and release decision. Checkpoint-only evaluation and all cancelled/failed runs are evidence-only and cannot be promoted.

## 6. Multi-agent operating model

Four total slots are used continuously:

- **Integrator:** owns shared contracts, Store shared runtime, bootstrap, preload/IPC, schemas/migrations, canonical plan/status, convergence, and release decisions.
- **Security lane:** corpus, red-team cases, Trust/egress conformance, and security benchmark.
- **User Intelligence lane:** causal dataset, controls, projection evaluation, correction/deletion evidence, and benchmark.
- **Orchestration lane:** task/capability corpus, Surface discovery/routing evaluation, plan replay, and benchmark.

When Store work does not require an Integrator-owned shared file, one core lane rotates temporarily to a bounded Store atom. Store never loses an active owner before its release gate passes.

Every subagent task states exact allowlist, forbidden shared files, acceptance evidence, migration/rollback/kill behavior, and no commit unless delegated. Handoffs include files, commands and exit codes, remaining risks, observed conflicts, and unrelated dirty paths.

### 6.1 Terra High UI/UX design lane

Terra High receives the canonical `UX-01` through `UX-09` flows from [product vision](../product/vision.md) and the acceptance atom IDs in Section 8. It produces design specifications and prototypes only until implementation is separately authorized. Design output does not change a runtime status or checkpoint percentage.

| Checkpoint | Required design output                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C0         | Audit every current route and state; identify false progress, unconditional ready/healthy copy, stale launch entries, missing owner, and missing empty/error/recovery state.                                             |
| C1         | Specify account gate, desktop shell, Package App/Surface identity presentation, installation consent, exact AI-access consent, lifecycle confirmation, and commerce authority boundaries.                                |
| C2         | Complete Store browse/search/detail, library/lifecycle, publisher upload/findings/review, checkout/refund, quarantine, restart recovery, and installed-first explanation designs.                                        |
| C3         | Complete goal composer, capability plan, target comparison, structured side-effect approval, User Intelligence proposal/provenance/control, evaluation status, and no-silent-fallback designs.                           |
| C4         | Complete separate install-versus-AI consent, operation scope, destination/data/secret/limit/expiry review, live progress, artifacts, cancellation, revoke, receipt, and restart recovery designs.                        |
| C5         | Complete local/cloud/hybrid comparison, remote session facts/control, artifact transfer approval, installed Surface launcher, package-disabled/uninstalled behavior, and clean-base empty states.                        |
| C6         | Produce one linked end-to-end prototype for every required journey, accessibility and keyboard annotations, responsive behavior, i18n expansion cases, visual-state inventory, and a design-to-atom traceability review. |

Each screen handoff includes: flow and atom IDs; state inventory; authoritative data/action owner; layout hierarchy; interaction and keyboard behavior; copy/i18n keys; accessibility names and focus order; trust, privacy, money, and destructive-action disclosures; loading/empty/offline/stale/limited/blocked/denied/cancelled/recovery behavior; telemetry consent; receipt/evidence destination; rollback; and kill-switch presentation.

The design lane is complete only when every required C0-C6 screen and transition has this handoff. Runtime completion still requires the production checkbox in Section 8.

## Active focused execution plan: Model Core Security MVP (2026-09-09)

This is the only active plan for the current implementation run. It deliberately excludes Store, MTUI, managed usage, Codex configuration and unrelated release work.

### Detailed execution plan: Provider Relay, usage and issuance

1. Inventory: map provider store, broker, gateway, consumer vault, Settings model, detection and config writer; record owner, contract, tests and gap before each edit.
2. Provider path: preserve API key plus URL persistence and validation; prove Main-only secret custody and broker-only upstream calls; keep renderer metadata-only.
3. Request usage: normalize provider input, output, cache and reasoning counts; mark missing values unavailable; use labeled estimates only when needed; persist by provider/model/consumer/session/request.
4. Provider quota and credit: add provider-specific quota adapter contracts where official endpoints exist; retrieve remaining quota/credit, limit, reset and observed time; cache with stale status; show unknown when unsupported; never infer credit from local token counts.
5. Consumer issuance: issue per-consumer Main-owned credentials with digest/encryption, account binding, model allowlist, expiry, rotation and revocation; reject old or unauthorized credentials before input/config access.
6. Gateway relay: enforce loopback ingress, scoped credential, origin/path policy, bounded requests, normalized non-stream responses, cancellation and durable terminal receipts; never expose upstream secrets.
7. Third-party distribution: reuse existing detection and connector plans; generate preview, loopback URL and consumer credential; apply CAS-safe backup/merge/recovery; verify Claude, Codex and other existing targets.
8. End-to-end proof: use an in-repo provider transport stub to prove provider API key plus URL -> broker -> gateway -> consumer config -> response, including both usage classes, quota unknown/known behavior, isolation and revoke-before-write.
9. 9Router gate: classify compatibility-only code versus runtime/build dependency; run bounded clean build and artifact scan; perform start/stop and rollback; remove runtime/build pieces only after all proofs pass.
10. Final verification: focused contract/integration tests, TypeScript, Oxlint, scoped format, diff review and canonical evidence update. Completion is the relay plus usage/issuance proof; 9Router removal is a separate gate.

| Step | Acceptance atom | Evidence |

**Reuse gate:** Before implementing any step, run an intent/folder inventory and record the existing implementation, public contract, tests, owner and exact gap. Prefer wiring or extending the existing path; a new file is justified only when no existing owner can safely host the missing behavior. Do not create a second gateway, orchestrator, vault, provider store, connector applier or Settings surface.
| --- | --- | --- |
| 1 | Freeze the existing API-key plus URL path as a compatibility baseline. | Existing provider connection tests remain green; no upstream secret leaves Main-owned storage. |
| 2 | Keep provider OAuth optional. | PKCE/state, refresh/expiry, disconnect/revoke remain covered by component tests; live provider registration is deferred and does not block local-first MVP. |
| 3 | Complete normalized token accounting. | Provider-reported input/output/cache/reasoning usage is stored; unavailable values remain explicit; local estimates are labeled. |
| 4 | Complete per-consumer gateway issuance. | Main-only encrypted records, digest binding, model allowlist, expiry, rotation, revocation and account/sender checks. |
| 5 | Prove the security seam. | Auth, egress, secret-boundary, cancellation, terminal receipt and config preview/backup/restore tests pass. |
| 6 | Remove 9Router only after replacement proof. | Clean runtime/build inventory, rollback rehearsal and focused replacement tests pass; otherwise retain 9Router unchanged. |

**Short-run target:** steps 1, 3, 4 and 5 are the local-first coding target. OAuth is optional and deferred until a provider client is officially available. Step 6 is a separate removal gate, not assumed complete from local unit tests.

**Run evidence (2026-09-09):** Inventory-first review found existing owners in `tomnyProviderStore`, `ProviderExecutionBroker`, `TomniGatewayModelService`, `ModelConsumerVault` and `ModelConsumerPanel`. The new account-bound `providerOAuthVault` reuses the existing `ProviderOAuthVault` contract. Focused model/security verification passed: 11 files, 65 tests, exit 0; scoped Oxlint and format checks passed; `bunx tsc --noEmit --pretty false --incremental false` passed with exit 0. A full-repository Vitest run reached 734 passing files and 6,071 passing tests but retained 12 unrelated failures in the pre-existing dirty workspace. The provider OAuth client and vault remain component-level evidence until one officially verified provider descriptor is selected and wired.
Local-first ingress evidence (2026-09-09): startTomniGateway fails closed when model routes are configured on a non-loopback host. Gateway unit/integration coverage passes 16/16 tests, including rejection of 0.0.0.0. Scoped Oxlint, file format, TypeScript and git diff check pass. Full repository format remains blocked by unrelated pre-existing dirty files.
Usage/credit evidence (2026-09-09): ModelConsumerPanel now summarizes request count and reported/estimated token totals, and displays provider quota/credit remaining, limit and unit when an official quota adapter supplies them. Unsupported provider balances remain explicitly unavailable; local token usage is never treated as credit. Focused model/quota/consumer/gateway tests pass 35/35; i18n type generation and scoped UI format pass.
Provider Relay integration evidence (2026-09-09): tests/integration/providerRelayMvp.test.ts proves a Main-stored API key and URL flow through ProviderExecutionBroker to a local provider transport stub, then through scoped Tomni gateway consumer ingress and Codex config generation. The provider receives its secret, while gateway responses and generated client config contain only the consumer credential; reported usage and the terminal receipt are persisted. Combined broker, connector, gateway, quota, consumer and isolation coverage passes 77/77; TypeScript passes.
Quota adapter evidence (2026-09-09): modelService now has a verified credit-unit quota path that accepts provider-reported remaining/limit/reset metadata and persists snapshots; a focused test covers reported credit quota. Provider-specific adapters remain gated on official provider billing/quota endpoints, with unsupported balances returning explicit unknown/unavailable rather than inferred credit.
Usage detail verification update (2026-09-10): Provider responses now preserve reported cache and reasoning token counts from flat and nested OpenAI-compatible usage details (cached_tokens, reasoning_tokens, prompt_tokens_details, completion_tokens_details) through the Main broker, durable request history, Responses envelope and Settings telemetry. Missing fields remain omitted rather than coerced to zero. Focused relay/security coverage passes 7 files and 55 tests after the regression additions; TypeScript, scoped Oxlint/Oxfmt and i18n type generation pass.
Quota scope verification update (2026-09-10): Quota reads now enforce the consumer model allowlist and discard adapter snapshots whose consumer/model identity does not match the requested scope; history requests accept model filtering. Focused relay coverage remains green at 9 files and 64 tests, with TypeScript, Oxlint, Oxfmt and i18n checks passing.
**Focused relay verification update (2026-09-10):** The consumer telemetry panel separates reported, estimated and unavailable request counts and never presents unavailable usage as zero. Quota reads re-check active consumer binding before adapter/cache access, so revoked consumers cannot inspect quota telemetry. The focused relay/security suite passes 12 files and 77 tests; unx tsc --noEmit --pretty false --incremental false, scoped Oxlint, scoped Oxfmt and i18n type generation pass. Clean-build compilation completes, but the packaging process does not terminate and the artifact scan still finds the legacy undled-model-gateway; 9Router remains retained for rollback.
Direct packaged verification update (2026-09-10): `bunx electron-builder --config packages/desktop/electron-builder.yml --win --x64 --dir --publish=never` completed successfully after native-module rebuild; `scripts/release/verify-windows-desktop-lifecycle.mjs` passed against `out/win-unpacked/Tomny.exe` with profile `.tmp/p7-current-followup-20260910`. The artifact still contains `bundled-model-gateway`, and source/build references remain, so the 9Router removal gate is still open.
9Router removal gate update (2026-09-10): Removed the legacy managed gateway preparation script from `prepare:dev` and `scripts/build-with-builder.js`, removed its electron-builder resource entry, removed the obsolete runtime bridge registration, and rebuilt the Windows unpacked artifact. The clean artifact has no `bundled-model-gateway`, build-config references are absent, focused relay/security tests pass 17 files / 75 tests, and the Windows lifecycle verifier passes with exit 0. Compatibility-only connector/config helpers remain for third-party configuration distribution and rollback.
Provider attribution evidence (2026-09-09): Model request terminal records persist a redacted provider catalog ID with backward-compatible unknown fallback, and history/API queries accept provider filtering via provider_id; broker success propagates the selected provider identity without secrets.

## Deferred broad model gateway proposal (2026-09-08)

**PARTIAL (implementation evidence current 2026-09-09).** The bounded Tomni model routes and Main-owned broker seam are implemented and focused contract tests pass; MTUI integration and benchmark evidence are current. Consumer apply now accepts only the approved Tomni loopback gateway origin and rejects revoked or model-denied credentials before config writes. Provider OAuth, provider quota adapters, native connection/history UI, CLI/app cutover, clean-machine 9Router absence proof and final release gates remain incomplete.

**C0 incident gate (2026-09-08):** A live Codex subagent launch through the configured independent 9Router listener returned HTTP 404 `No active credentials for provider: openai` from `/v1/responses`. The same listener's unauthenticated model catalog was reachable, so C0 must record provider credential health separately from listener availability. This does not authorize fallback, retries, or a secret import. The Codex Responses -> OpenAI compatibility cell remains BLOCKED until it has a Tomni-owned credential health/refresh/revoke contract and the C1-C3 ingress, egress, stream, usage, and receipt evidence.

**C1 status (2026-09-09): PARTIAL.**
**C1 efficiency evidence (2026-09-09):** The benchmark harness now records a paired uncompacted baseline and one fresh-process ablation per named reduction stage. On the same 11-log corpus, integrated MTUI reduced complete wire JSON by 54.976% versus the uncompacted baseline; all 32/32 diagnostic signals were retained and the integrated run was deterministic. Disabling `important-lines` reduced signal recall to 71.875%, while disabling `head-tail` reduced it to 81.25%. This closes the ablation instrumentation atom only; task success/retries, provider response-token accounting, retrieval follow-ups, peak memory and clean-revision comparison remain open. Evidence: `.tmp/mtui-benchmark-ablation-20260909-final/latest.json`. Route isolation, separate consumer credentials, bounded Chat Completions and Responses parsing, explicit streaming denial, client-disconnect cancellation, normalized response shapes, broker revocation/allowlist recheck, lifecycle injection, consumer-scoped history, quota snapshots, encrypted opt-in replay controls and terminal receipts are implemented with focused tests. Main now exposes account-bound issue/list/revoke IPC for gateway consumer credentials with redacted summaries; native Settings consumer issuance/list/revoke plus consumer-scoped history/quota/replay status panel is integrated; model consumer distribution is callback-injected from Main and remains disabled when no approved writer is supplied; the legacy runtime/build resource removal now has a clean Windows artifact-absence and lifecycle proof in the focused evidence above. This is not yet an admitted provider cell: provider quota adapters, provider OAuth and broad native history/replay browsing/export controls remain separately gated.
**C1 credential status (2026-09-09): PARTIAL.** Protected consumer records persist digests, account binding, expiry, allowlists and revocation; issue/resolve/revoke tests prove plaintext tokens are not stored or cross-account usable. Main injects the service and exposes account-bound issue/list/revoke IPC with redacted summaries. Vault mutations are serialized to prevent concurrent load-then-write loss, covered by a concurrent issuance test. Request usage/history, terminal receipts, actor-bound quota snapshots and encrypted opt-in replay storage persist through bounded durable stores. Authorized renderer/CLI distribution, provider quota adapters, provider OAuth and connector migration remain missing. **Provider OAuth core (2026-09-09): PARTIAL component.**

**Inventory evidence (2026-09-09):** Before the OAuth vault change, existing owners were inspected: `tomnyProviderStore` remains the API-key provider owner; `ProviderExecutionBroker` remains the provider egress owner; `TomniGatewayModelService` remains the usage/receipt owner; `ModelConsumerVault` and `ModelConsumerPanel` remain the gateway credential owners. The OAuth addition reuses the existing `ProviderOAuthVault` contract and does not create a second provider store, gateway, orchestrator or Settings surface. A Main-only provider OAuth client and four focused contract tests now cover PKCE/state, refresh serialization, invalid-grant cleanup and disconnect. Typed Main OAuth IPC and broker resolver wiring are now available behind an injected, explicitly verified client map. OpenAI OAuth is the selected implementation candidate based on the configured Responses/Codex-compatible flow, but remains BLOCKED until Tomny registers/supplies its own Desktop OAuth client and provider authorization policy; no provider is admitted until that evidence and Settings wiring pass.

| Order / checkpoint | Acceptance-sized work                                                                                                         | Required evidence and dependency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 / C0             | Freeze provider/auth/protocol/consumer matrix, existing gateway owners, upstream overlay changes and current bundle footprint | Record exact revisions, client versions, OAuth integration eligibility, startup/RAM/disk baseline and existing tests. Initial target: one API provider, one eligible OAuth provider, one CLI and one generic app. An unverified provider stays BLOCKED.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2 / C1             | Lock model ingress authority, model/stream descriptors, per-consumer credential scope, usage/quota/replay schemas             | Contract fixtures reject forged actor/session, upstream-secret exposure, unsupported protocol, oversized request and invalid quota. Integrator owns HTTP registration, shared contracts and any additive migration. Provider OAuth is separate from app-login/MCP OAuth.                                                                                                                                                                                                                                                                                                                                                                                       |
| 3 / C2-C3          | Reuse Main broker for one API cell, then one OAuth cell; add isolated model routes to the existing host                       | Prove permission and final egress on both paths, login/cancel/refresh/revoke, bounded streaming/backpressure, timeout, disconnect and durable terminal receipt. OAuth endpoint/client registration evidence precedes implementation. Do not relax existing child-credential containment.                                                                                                                                                                                                                                                                                                                                                                       |
| 4 / C4             | Connect one CLI and one app using existing config plan/application helpers                                                    | Freeze actual client versions; preview/merge/backup/atomic-write and concurrent-edit-safe restoration tests; deny a revoked credential even with modified config. Internal Hub and external consumers share policy enforcement.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5 / C3-C4          | Add native connection/quota and request-history views, metadata retention and opt-in replay export                            | Show remaining/reset/source/freshness or unknown; no inferred account balance. Prove attempt deduplication, interrupted streams, estimated versus reported usage, redaction, retention/deletion and export preview. No new benchmark studio in base.                                                                                                                                                                                                                                                                                                                                                                                                           |
| 6 / C4             | Integrate selected missing RTK techniques into the existing MTUI engine                                                       | PARTIAL -> fresh 2026-09-09 run (2 warmups + 15 repeats, 11 compact + 10 Compass + 10 bounded-read cases): 100% critical-signal/anchor recall, 50.855% compact wire reduction, 70.513% Compass wire reduction, 84.788% bounded-read wire reduction, deterministic output (11/11 compact, 10/10 Compass and bounded-read), and maximum case p95 21.966 ms (Compass). Evidence is local and source-dirty; paired baseline plus five stage ablations now exist in `.tmp/mtui-benchmark-ablation-20260909-final/latest.json`, while task success/retries, provider response-token accounting, memory, retrieval follow-ups and broader clean-revision runs remain. |
| 7 / C5             | Compare selected cells against the pinned runtime using fixtures and consented replay                                         | Record output/tool ordering, usage, errors, cancellation, crash/restart, config recovery, socket/process cleanup and footprint. Do not mirror real traffic or trigger tools twice. Validate one supervised CLI and generic app end to end.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8 / C6A            | Review cutover, then remove 9Router build preparation and unused assets                                                       | Current-revision clean build, install/start/uninstall and dependency/artifact absence proof; retain readable receipts and safe rollback. Core plus Store only; managed-AI accounting remains separately gated under C6B.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Work assignment and ownership

Implementation uses the existing Integrator-plus-three-lane protocol only after review. Integrator owns shared contracts, HTTP/IPC registration, DB migration, final integration and this status. Assign three bounded lanes to provider adapters, connector/usage verification, and Store/package absence or independent release verification. Keep the Store lane active until its gate passes; use ready verification atoms when production dependencies are not ready.

Before dispatching each atom, record exact starting revision, file allowlist, forbidden shared files, acceptance command, owner, migration/rollback/kill behavior and commit ownership. Do not preassign the same production file to two lanes. Subagents do not commit without explicit delegation.

### Verification and rollback contract

Reuse router9 connectorEngine, managedRouter9, modelGatewayOverlay and bootstrap tests as baseline evidence; their current names do not establish replacement correctness. Add integration fixtures at the shared ingress/broker seam, including negative egress and revocation paths. Run focused checks first, then lint, format, TypeScript and test gates from AGENTS.md; native UI text changes also require i18n generation/checks. No passing test is claimed by this proposal.

Use additive, versioned receipt/config changes with forward/backward-read fixtures before migration. A failed cell is disabled without losing audit history or restoring stale secrets/configs. Rollback to the old bundle is allowed only through the same current security contract. A secret leak, unauthorized provider request, double accounting, missing terminal receipt, destructive config restoration or orphan process stops cutover.

Tomni **Settings > Model** (`/settings/model`) is the existing LLM connection and distribution surface. Preserve this location for API-key connections, eligible provider OAuth, model selection and granting connections to CLI/app consumers through reviewed configuration changes. OAuth/provider replacement remains TARGET until its acceptance tests pass. This location is not a Token Saver placement decision; no Token Saver UI relocation is included. Primary efficiency acceptance compares frozen current MTUI against MTUI with selected RTK-derived filters, including filter ablations, full-envelope tokens, retained signals, retrieval costs, latency and memory. Research deterministic Headroom JSON techniques inside MTUI; AST work follows fidelity evidence. Exclude Caveman/Ponytail, external compression services, ML and image conversion from this scope.

### Decisions for design review

- Select the first OAuth provider and CLI/app versions after eligibility inventory; the current Codex connector requires Responses and Claude requires Messages.
- Confirm proposed replay retention (7 days/100 MB), metadata retention (30 days), per-consumer budget defaults and UI warning threshold; provider account limits are displayed in their own units.
- Freeze the first benchmark corpus and evaluation budget before paid calls; approve or revise the proposed token-saving gate in the design.
- Approve implementation scope only after this design/plan review. Until then retain the existing 9Router clone, bundle, settings and runtime.

## 7. C0-C6 execution plan

### C0 - Truth, inventory, and baseline

**Purpose:** establish same-revision evidence before further convergence.

Integrator:

- inventory enabled executors, IPC/preload methods, egresses, package actions, Store mutations, money paths, Surface contributions, optional imports, and release artifact inputs;
- identify the single owner and kill switch for each path;
- freeze the representative goal set and resource/outcome budgets;
- freeze each `benchmarkVersion`, corpus seed/hash, metric ID, denominator, threshold value, and comparator revision;
- record CURRENT, PARTIAL, TARGET, and BLOCKED honestly.

Core lanes freeze v1 benchmark corpora and baseline scores. Store inventory includes search, catalog, lifecycle, publication, review, commerce, UI registry, and recovery.

Exit gate:

- inventories and corpora are deterministic at one revision;
- unknown IPC, egress, money path, Surface owner, or optional base import fails C0;
- baseline failures are reproducible and named.

Rollback: inventories are additive evidence. Replace faulty rules only with equal or stronger coverage.
Kill criteria: stale artifact evidence, nondeterministic corpus, or unowned enabled action stops C0.

### C1 - Store contract and identity lock

**Purpose:** freeze the minimum Store and Surface contracts before completing lifecycle behavior.

Integrator owns short serialized batches for:

- Package App identity, one-to-one Surface identity, version, publisher, contribution, runtime, and lifecycle state;
- user UI contribution and optional AI-access declaration;
- AI-access consent bound to exact account, Surface identity and version, placement, operation schema and capability, data classes and destinations, secret use, limits, and expiry;
- local/cloud placement descriptors without creating different Surface identities;
- signed catalog, review finding, review decision, publication, staged rollout, delist, and revocation records;
- install/update/disable/enable/rollback/uninstall request, consent, idempotency, state, and receipt;
- integer MoneyMinor, Order, PaymentEvent, Refund, Entitlement, AcquisitionGrant, CommissionEntry, and PublisherPayable.

Exit gate:

- strict parsing rejects unknown fields, malformed identities, unsafe runtime, floats in authoritative money, duplicate IDs, invalid transitions, and oversized payloads;
- one Package App cannot register two Surface identities;
- installation cannot imply AI access;
- policy may deny or narrow AI access but cannot substitute for the user's grant; version, capability, or destination changes require re-consent, and durable revocation cancels active work and leases;
- payment cannot raise trust or weaken review;
- Core contracts import no optional implementation.

Migration: legacy DTOs coexist only behind explicit version adapters. A legacy multi-module app chooses one canonical UI Surface; non-UI modules become contributions of that Surface or separate Package Apps and cannot expose extra Surface identities through the adapter.
Rollback: disable the new adapter while retaining durable readable records.
Kill criteria: ambiguous Surface identity, secret serialization, renderer-authoritative grant, payment-derived trust, or invalid replay stops C1.

### C2 - Complete Store before AI Surface wiring

**Purpose:** make Store usable by a person and safe for developers before AI can operate Package Apps.

#### C2A - User lifecycle and UI integration

- signed, expiring, rollback-resistant catalog;
- search with matching installed Package Apps first;
- product detail with publisher, version, trust, compatibility, permissions, runtime, data behavior, local/cloud availability, size, and update facts;
- consented install, update, disable, enable, rollback, revoke, and uninstall through Package Supervisor;
- atomic files/state/contribution transaction and restart reconciliation;
- exactly one Hub Surface appears after install/enable and disappears after disable/uninstall;
- UI navigation, route, assets, translations, settings, background work, processes, leases, secrets, and declared data follow lifecycle state;
- clean install/update/remove receipts and visible failure recovery.

#### C2B - Submission, automated review, and publication

- publisher identity and signing-key enrollment;
- package upload with bounded size, rate, and staging lifetime;
- deterministic manifest, signature, integrity, provenance, dependency, compatibility, archive, path, symlink, decompression, runtime, permission, network, secret, retention, UI, and AI-access checks;
- isolated dynamic smoke test for accepted runtimes;
- structured findings with stable codes, severity, evidence, and remediation;
- automatic approval only for an isolated non-native package with no AI operation, secret, network, mutation, broad filesystem, background execution, or persisted sensitive-data class;
- mandatory human review for any AI declaration with mutation or egress, privileged runtime, native helper, filesystem, account, payment, secret, persisted data, broad network, first-party namespace, or uncertain classification;
- any manifest, runtime, dependency, permission, AI-operation, or destination diff invalidates the prior review and requires a new decision;
- no plaintext secret may enter a manifest, catalog record, upload, review evidence, benchmark corpus, cloud UI, or downloadable artifact;
- catalog signing only after approval; staged rollout, update review, delist, emergency revoke, and publisher appeal;
- malicious or revoked artifacts never become activatable catalog entries.

#### C2C - Store commerce kernel

- durable idempotent Order and PaymentEvent repository;
- Entitlement and opaque AcquisitionGrant issued only after authoritative capture;
- paid activation still passes the identical signature, compatibility, permission, review, Trust, and isolation gates as free installation;
- full refund revokes entitlement, grant, active processes, and leases exactly once while preserving accounting history;
- first-party checkout path and 15/85 third-party accounting fixture;
- organic, featured, and sponsored lanes remain separate and sensitive context never affects ads.

C2 exit gate:

- clean-base user can search, install, open, update, disable, enable, roll back, and remove the signed pilot without rebuilding base;
- a submitted low-risk sandbox Package App passes review and publication; malicious, malformed, privileged-unreviewed, and revoked fixtures fail closed;
- installed matching results are deterministically first;
- restart at every mutation boundary produces one correct state and no orphan;
- paid purchase-through-refund occurs exactly once;
- until C4 passes, production AI-to-Surface invocation is disabled for every placement by one owned fail-closed switch; test harnesses cannot reach a real model, package broker, or user data, and inventory proves no legacy or direct bypass.

Migration: enable catalog, free lifecycle, publication, and paid switches independently after their atoms pass.
Rollback: disable the affected switch while preserving valid installed state, entitlements, evidence, and user-declared retained data.
Kill criteria: silent install, unsigned publication, review bypass, duplicate commercial state, UI residue, or package outside Supervisor stops C2.

### C3 - Three cores converge in parallel

**Purpose:** make the three foundations measurable and production-safe while Store C2 completes. Corpus and replay work uses a frozen signed Surface-index fixture during C2; production-index conformance runs after C2 passes, and C4 waits for both results.

#### C3A - Security

- route every release-candidate egress and side effect through TrustBroker;
- enforce origin, identity, capability, approval, secret-handle use, destination, resource, timeout, cancellation, final egress, and durable audit;
- run versioned adversarial corpus and red-team fixtures continuously;
- prove for every denial and cancellation that the prohibited external action did not occur, and fail promotion when any frozen security denominator or false-allow floor is absent or changed;
- keep deterministic policy authoritative; a classifier or local security model may add evidence but cannot grant permission.

#### C3B - Causal User Intelligence

- support controlled observation/explicit input, proposal, explanation, confirmation/rejection, application, outcome, correction, forgetting, export, deletion, retention, and learning pause;
- preserve reason and scope; reasonless repetition becomes a question or bounded hypothesis, never an `always` rule;
- benchmark personality, psychology, taste, aesthetics, and preference handling only under the category, purpose, scope, retention, deletion, and projection controls in Section 5, without turning context into authorization;
- train only offline from approved versioned data and promote only after causal and privacy gates pass.

#### C3C - Orchestration

- decompose a goal into required capabilities before naming a Surface;
- search the authoritative Store/Surface index;
- rank eligible installed matching Surfaces first, then cloud placements, then installable candidates;
- produce local, cloud, install-proposal, or hybrid plans with recorded reasons;
- make user pin, privacy, health, resource availability, hard budget, and required UI/offline constraints deterministic;
- allow learned context to shape advisory proposals and explanations only, plus presentation order among execution-equivalent candidates; it cannot change the deterministic route or admission decision;
- benchmark verified outcome, wrong-Surface selection, unnecessary install, silent fallback, latency, resource, and cost.

C3 exit gate:

- every enabled target and side effect uses one Run Kernel and TrustBroker;
- no raw secret reaches renderer, prompt, log, snapshot, receipt, or dataset;
- correction, deletion, or consent withdrawal removes affected data from the next projection, search, package-accessible context, derived datasets, indexes, caches, queued jobs, evaluation artifacts, and backups within declared retention, without permission drift;
- pre-withdrawal candidate artifacts follow the declared quarantine, retrain, or no-future-use policy;
- Security, User Intelligence, and Orchestration emit the complete candidate report from Section 5 and meet frozen versioned safety floors with no missing denominator or unexplained regression;
- local never silently falls back to cloud;
- Orchestrator does not treat Store search, installation, purchase, or AI access as the same action.

Migration: promote each core policy/model artifact independently only after its benchmark and rollback drill pass.
Rollback: return to the last passing version; retain explicit user context and readable receipts.
Kill criteria: security bypass, causal record without scope, undeletable context, training-data violation, unexplained routing regression, or orphan resource keeps the affected core disabled.

### C4 - Connect AI to reviewed Surfaces

**Purpose:** enable AI operation only after Store and the three cores satisfy their gates. C4 proves one production local AI-to-Surface journey. Cloud and hybrid calls remain fail-closed until C5B reuses this path and passes its additional remote controls.

The shared AI-to-Surface path requires:

1. active signed Package App and exact Surface identity/version;
2. approved publication/review status and non-revoked artifact;
3. active local placement for C4; cloud and hybrid admission remain disabled until C5B passes;
4. AI-access declaration for the requested operation;
5. active user consent bound to exact account, Surface identity and version, local placement, operation schema and capability, data classes and destinations, secret use, limits, and expiry, plus a policy-narrowed CapabilityGrant that cannot substitute for consent;
6. secret/destination, context, resource, budget, timeout, and cancellation policy;
7. invocation through package broker and Run child lineage;
8. progress, artifacts, evidence, usage, cleanup, and terminal receipt.

User-only Surfaces remain fully usable by the person and expose no AI operations.

Secrets are supplied only through a broker-created opaque per-operation lease. A Surface cannot resolve or replay the handle; destination, package, consent, or review changes invalidate it and cancel active work. Protected storage unavailable fails closed.

#### Required “create app ABC” journey

1. User submits “create app ABC.”
2. Orchestrator derives capabilities such as workspace editing, build, test, preview, research, assets, and deployment.
3. Resolver searches installed and Store Surfaces without hard-coding IDE.
4. A matching installed eligible Surface ranks first. If none exists, cloud and installable candidates are compared.
5. For every proposed step, Hub builds a purpose- and destination-bound context projection from consented in-scope records, records included and withheld identifiers with reasons, and lets Trust perform final egress. The projection is advisory only: it cannot authorize install, purchase, AI access, or operation, and raw context is never passed to a Surface or model without target-specific projection consent.
6. When local IDE or another builder is justified, the Hub shows package identity, reason, permissions, size, local/cloud alternatives, and future/offline value.
7. User approves installation; Store verifies a valid current approval record, downloads, verifies, installs, registers, and displays the Surface.
8. User can open and use the Surface manually before granting AI access.
9. Hub requests separate AI-access consent for the exact operations.
10. Selected LLM uses only those operations through Core to create, build, test, and preview the app.
11. User sees live progress and artifacts and receives the completed app plus one Run receipt.

C4 exit gate:

- installed matching Surface wins when eligible;
- alternative Surface wins when IDE is not the best capability match;
- denied install leaves no artifact or registry state;
- denied AI access leaves the installed app usable by the user but inaccessible to AI;
- revoked consent stops new operations and cancels active leases;
- version, operation, placement, capability, secret use, data-class, destination, or expiry change forces re-consent;
- no direct model-to-renderer, model-to-package, or package-to-package implementation import exists;
- the entire journey restarts without duplicate install, effect, or receipt.

Rollback: disable AI access without uninstalling the user's app; disable a Surface placement independently.
Kill criteria: install implies AI access, AI calls undeclared operation, confused deputy, consent replay, or residue rejects C4.

### C5 - Local/cloud hybrid, default IDE surface, and clean base

**Purpose:** prove Surface placement and physical package separation at product scale.

#### C5A - Default IDE surface

- keep IDE as a default, always-on Core surface; do not add it to Store or package lifecycle;
- keep only the IDE-independent package contracts in Core and preserve the existing preload/main security seams;
- build and test IDE as part of the base surface, with no `com.tomni.ide` install/disable/uninstall operation;
- prove base start, navigation, terminal capability containment, and restart recovery without a Store IDE artifact.

#### C5B - Cloud and hybrid Surface execution

- use a predefined user-provisioned or partner-hosted placement for C5 proof; it does not mint Credit, provision Tomni-managed compute, or depend on C6;
- run one complete cloud Surface without downloading its executable Package App locally;
- authenticate Surface and transport identity and bind messages to Run lineage;
- reuse the identical C4 AI-access declaration, per-operation user consent, Trust, Run, secret-lease, cancellation, evidence, and receipt path; remote UI availability never implies AI access;
- expose only schema-bounded remote presentation and control: no arbitrary remote script, preload, native bridge, host filesystem, cross-Surface access, or fallback to an arbitrary URL;
- show user-visible remote placement, session, tenant, retention, region, destination, and data-class facts; isolate each run/session/tenant;
- authenticate, authorize, inspect, and explicitly approve artifact download; support progress, cancellation, metering facts, cleanup, and session revocation;
- invalidate secret leases and cancel the remote session when package, review, consent, operation, or destination state changes; no secret plaintext enters the remote UI or artifact;
- execute one hybrid task using at least one installed local Surface and one cloud Surface;
- execute the cloud branch of “create app ABC” without local installation after showing remote presentation, data, retention, region, and price facts and obtaining the same exact AI-access consent;
- installation is proposed only when device-local or offline control, local-data placement, repeated use, or device-fit policy justifies it.

#### C5C - Clean base

- remove optional implementation imports, routes, bridges, assets, translations, workers, binaries, databases, and build inputs from base;
- generate ownership, graph, chunk, ASAR/resource, source-map, translation, binary, and database evidence;
- run Hub, Store, context, settings, update, and recovery with no optional Package App installed.

#### C5C migration slices

The C5C work is serialized by artifact boundary, not by source-file count. Each slice runs the exact base graph gate before the next slice begins:

1. **Design VIU Main boundary:** move the fixed Design VIU MCP/native implementation and its session/asset/transaction helpers out of Core into the reviewed `com.tomni.design-studio` contribution boundary. Core retains only schema-validated contribution admission, lifecycle supervision, sender verification, and opaque broker contracts. The slice fails if any Core module imports `@process/ide/*` for Design behavior.
2. **IDE MCP and Omni Gateway boundary:** keep the IDE-only MCP host/server, wiki, agent-surface, and tool implementations behind the always-on IDE surface; capabilities required by the neutral Hub remain narrow Core contracts, and no Store package may import them directly.
3. **Renderer workspace boundary:** keep the IDE workspace closure in the base IDE surface while preserving explicit Core/package contracts for optional apps; Store package routes must not preload optional implementations before admission.
4. **Artifact replacement boundary:** build the extracted package in a disposable environment, verify its source closure, then have the isolated release signer issue the matching production artifact. The catalog version, signature, integrity, source closure, and clean-machine lifecycle receipts must all name the same immutable revision. A locally generated development artifact cannot close this slice.

#### C5C implementation design contract

The current bridge eagerly initializes and registers Design VIU-specific runtime code from `packageBridge.ts`; its Design MCP/native bridge direct imports in turn reach IDE implementations. That is a confirmed **BLOCKED** boundary, not a valid “package implementation”. The extraction is therefore an ordered contract migration:

1. **Admit, then activate:** Package Manager verifies signature, review status, compatibility, entitlement where applicable, and declared process contribution _before_ activation. With no installed/eligible contribution, no Design process, host, IPC channel, or session is initialized or registered.
2. **Generic Core seam only:** Core owns the stable contribution manifest schema, Package Supervisor, lifecycle state machine, account and sender authentication, bounded IPC transport, cancellation, resource limits, audit records, and opaque capability/secret handles. Core must not contain `Design`, `VIU`, or IDE-specific transaction/session/tool behavior.
3. **Package-owned implementation:** `com.tomni.design-studio` owns its MCP host, tools, sessions, assets, transactions, and Design-native channel handlers. IDE owns its default-surface MCP, wiki, workspace, and renderer closure. A package declares only a schema-bounded operation contract and starts under supervisor control after admission.
4. **No compatibility preload:** a disabled, absent, revoked, incompatible, or crashed package removes its routes and operation availability. The Hub shows the corresponding availability state and recovery action; it must never silently preload an optional implementation as a fallback.
5. **Evidence sequence:** after each migration slice, verify (a) no Core-to-optional import by source graph, (b) no optional module/chunk/ASAR/resource/translation/database input in the base build, (c) absent/install/open/AI-consent/revoke/uninstall/restart journeys, and (d) signed package artifact closure at the same immutable revision. A green unit test alone cannot check the atom.

The only permitted rollback is to disable the affected contribution or restore the prior signed package version. Restoring an optional implementation to Core is explicitly forbidden.

C5 exit gate:

- zero core-to-optional implementation imports and zero optional implementation in base artifact;
- base starts no optional route, service, process, scheduled job, host, or database;
- IDE base-surface navigation and AI-access journey pass without a Store package lifecycle;
- cloud Surface produces the required product without local executable installation;
- hybrid task has one parent receipt and linked child evidence;
- uninstall/revoke leaves no route, process, lease, secret, or undeclared data.

Rollback: disable the offending Surface, placement, or registry source; never restore optional implementation to base.
Kill criteria: optional artifact in base, preinstall activation, direct implementation import, stale graph evidence, or lifecycle residue rejects C5.

### C6 - Managed usage and release decision

#### C6A - Core plus Store release

Independent verification covers:

- malicious catalog/package, signature rollback, IPC spoof, prompt-injected side effect, secret canary, SSRF/redirect, archive abuse, grant replay, context misuse, and duplicate effects;
- long Run, rapid cancel, crash/restart at each Store and Surface boundary, provider/local-model outage, offline mode, resource pressure, update, refund, rollback, and kill switches;
- clean-machine Store lifecycle, publication/review, paid first-party, installed-first search, create-app journey, local/cloud/hybrid Surface use, IDE extraction, and exact base artifact.

Release gate:

- every Core plus Store acceptance journey passes at one revision;
- applicable lint, format, type, unit, contract, integration, and end-to-end commands exit zero;
- 100 percent of enabled preload/IPC, egress, Store mutation, and AI-Surface operations are inventoried and enforced;
- one Run owner, one Trust seam, one Context source, one Store ledger, one Package Supervisor, and one ResourceCoordinator are authoritative;
- all three core benchmarks meet safety and outcome floors;
- no known P0 security, privacy, data-loss, duplicate-effect, Store, payment, package-isolation, or Surface-control issue remains;
- canonical documentation matches the signed candidate.

#### C6B - Full managed usage

- freeze Credit, rate card, quote, expiry, maximum charge, reservation, settlement, release/refund, and reconciliation contracts;
- connect one payment mint and one managed-AI usage meter;
- add one General on-demand cloud resource class, task sandbox, metering, cleanup, and orphan recovery;
- reserve before billable model call or provider resource creation;
- reconcile provider invoice, ledger, usage, and Run receipt within the frozen tolerance.

Migration: release only from a clean signed candidate and test update from the previous supported build.
Rollback: restore the previous signed base and compatible package set while preserving readable Run, review, entitlement, accounting, and Credit evidence.
Kill criteria: any P0 failure rejects the relevant candidate. There are no security, privacy, review, or accounting waivers.

## 8. Evidence and progress accounting

Progress is passing current-revision acceptance atoms, not files, commits, test count, or log volume.

Report these tracks separately:

- Store lifecycle and UI integration;
- submission, automated review, and publication;
- Store commerce;
- Security core and benchmark;
- causal User Intelligence core and benchmark;
- Orchestrator core and benchmark;
- AI-to-Surface journey;
- local/cloud/hybrid placement;
- IDE extraction and clean base;
- managed usage;
- release evidence.

For each track report:

- required atoms;
- passing atoms at the exact current revision;
- failing or blocked atoms and named cause;
- enabled and disabled switches;
- latest command, exit code, evidence artifact, and owner.

Track completion is `passing required atoms / total required atoms`. Core plus Store readiness is the lowest completion among its critical tracks, not their average. Full managed-usage readiness is reported separately. Only the Integrator changes canonical status to CURRENT.

### 8.1 Canonical tick and percentage rules

The exit-gate bullets in Sections 7 and 8 are the frozen denominator. Each required outcome has one stable atom ID below.

- `[x]` means the required production-reachable outcome passed appropriate tests at the stated evidence snapshot. It contributes one passing atom.
- `[ ]` means the checkpoint requirement is not yet complete. LOCAL, DEV, test-only, disabled, PARTIAL, TARGET, and BLOCKED evidence stays visible but contributes zero.
- A checkpoint percentage is `checked required atoms / total required atoms * 100`, rounded to one decimal place.
- A checkpoint reaches 100 percent only when every required atom is checked at one compatible revision and no required blocker remains.
- Core plus Store readiness is the lowest percentage among C0, C1, C2, C3, C4, C5, and C6A. It is never their average.
- Full managed-usage readiness requires the Core plus Store candidate plus C6B; it is always reported separately.
- A model-training step percentage, test count, file count, commit count, or UI mockup is never a checkpoint percentage.
- If the denominator, revision, command, exit code, or evidence is missing, the UI reports `—`, not an estimate.

Earlier narrative estimates such as 45, 65, 98, or a training value such as 500/600 are superseded by this ledger and must not be reused as product completion.

### 8.2 Acceptance atom registry

Evidence snapshot: source revision `df9468b5eaf0902a563bf808e7aab01b821e8f69`, dirty working tree, 2026-08-22. This is an implementation assessment, not a signed release candidate. The checked component atoms below were reconfirmed by:

- `bunx vitest run tests/unit/package-manager/HubWorkspacePage.storeSearch.test.ts tests/unit/package-manager/surfacePlanningService.test.ts tests/unit/package-manager/publisherSubmissionStore.test.ts tests/integration/c4LocalSurfaceAiJourney.test.ts` - exit 0, 4 files and 13 tests passed;
- `bunx vitest run tests/integration/c3CoreConformance.test.ts` - exit 0, 1 file and 3 tests passed; its results remain LOCAL evidence and therefore do not close production atoms.
- `bun run test:c0:evidence` - exit 0, 3 files and 17 tests passed. It confirms that the inventory/corpus/ownership detectors reproduce their findings, not that the candidate is clean.
- `bunx vitest run tests/unit/foundation/ipcInventory.test.ts` - exit 0, 1 file and 3 tests passed. The static source inventory now compares Main `webContents.send` channels with preload `ipcRenderer.on` listeners, including a local literal-array listener loop; a missing literal listener fails closed in the fixture while imported or runtime-dynamic channels remain explicitly unresolved. Egress, money, Surface-owner, optional-base, and immutable-candidate coverage remain open.
- `bunx vitest run tests/unit/package-manager/manifest.test.ts tests/unit/extension/contributionRegistry.test.ts tests/unit/package-manager/service.test.ts tests/unit/foundation/surfaceAiAccessBroker.test.ts` - exit 0, 4 files and 155 tests passed; this remains local contract evidence.
- `bunx tsc --noEmit --pretty false` - exit 0. The current dirty implementation snapshot type-checks; this does not replace the clean candidate, full test, or release gates.
- `bun run test` - exit 1, 691 files and 6,044 tests passed, 2 files and 12 tests skipped, with exactly one failure: the signed `com.tomni.design-studio` artifact still contains `pages/studio/ide` inputs. The development build closure is clean, but the production signing key is unavailable in this environment, so the stale signed artifact cannot be replaced here.
- `bun run test:release:base-artifact` rebuilt the production base artifact. The subsequent `bunx vitest run tests/regression/wave0/optionalOwnership.test.ts` - exit 0, 11/11 tests passed. The exact emitted graph moved from 14 C5 ownership violations to 10 after the neutral loopback-host slice, 6 after removing ungranted Design assets, 3 after the signed child-runtime migration, and 0 after moving the full bounded Design transaction parser to the shared package contract. This was the earlier graph-only C5-01 assessment; the 2026-09-06 source review below narrows it to component evidence because legacy optional consumers remain. It it does not replace the clean-machine signed-package or lifecycle evidence required by the other C5 atoms.
- `TOMNI_PACKAGE_DEV_SIGNING=1` with an isolated temporary `TOMNI_PACKAGE_OUTPUT_ROOT`, followed by inspection of the generated `com.tomni.design-studio-1.0.0.dev.tomni-package.json`, completed with `legacyIdeInputCount = 0` and entry `packages/desktop/src/renderer/package-apps/design/index.tsx`. This is CURRENT development source-closure evidence only; the production-signed artifact remains stale and cannot be replaced without the isolated release signer.
- `bunx vitest run tests/unit/package-manager/designViuMcpRuntime.test.ts tests/unit/package-manager/service.test.ts` - exit 0, 78 tests passed. Package mutations quiesce a persistent Main-owned endpoint before waiting for its verified artifact-read lease, and a failed mutation reconciles the exact still-admitted endpoint. This is a focused C5-06 cleanup slice; the complete optional-package matrix remains required.
- `bunx vitest run tests/unit/package-manager/designViuMcpRuntime.test.ts tests/unit/package-manager/designViuNativeBridge.test.ts tests/unit/package-manager/packageArtifactProcessEndpoint.test.ts` - exit 0, 12 tests passed. Design manager, native IPC, session service, and child process stay unconstructed until the exact signed package is installed and enabled. This is focused C5-02 evidence only; clean-machine base-start evidence is still required.
- `bunx vitest run tests/unit/foundation/runKernel.test.ts` - exit 0, 34 tests passed. The governed Run Kernel emits a child receipt with the parent run ID and adds the child-receipt reference to the one parent receipt. This is C5-05 component evidence only; a real local-plus-remote journey is still required.
- `bunx vitest run tests/unit/package-manager/manifest.test.ts` - exit 0, 35 tests passed. The strict parser matrix rejects each named C1-01 case: unknown root/nested fields, malformed identity, unsafe runtime, duplicate ID, invalid transition, oversized payload, and fractional/scientific/unsafe authoritative money at seven public Store boundaries. This is CURRENT component evidence for C1-01.
- `bunx vitest run tests/integration/package-manager/packageMutationRestartRecovery.test.ts` - exit 0, 1 test passed. It proves durable install, disable, enable, and uninstall recovery with real JSON state and no package/staging/trash/download leftovers; C2-04 remains PARTIAL pending update, rollback, revoke, runtime, and clean-machine boundaries.
- `bunx vitest run tests/integration/package-manager/packageMutationRestartRecovery.test.ts tests/integration/package-manager/rollbackRestartRecovery.test.ts tests/integration/package-manager/revocationRestartRecovery.test.ts tests/integration/package-manager/updateFailureRecovery.test.ts` - exit 0, 4 files and 10 tests passed. Restart recovery now removes a promoted-but-uncommitted downloaded update version while retaining the exact durable version and its Surface; the focused suite also covers rollback, exact catalog revocation, and interrupted downloader updates. C2-04 remains PARTIAL because the complete clean-machine lifecycle and every runtime boundary are still absent.
- `bunx vitest run tests/unit/package-manager/firstPartyAppArtifacts.test.ts` with the default-package filter - exit 0, 1 test passed. Fresh temporary-root evidence covers Company, Knowledge, and Pet signed development artifacts through install, asset read, manager restart/reconcile, disable, enable, uninstall, and package-directory cleanup; this is LOCAL/DEV evidence and does not close production signing or clean-machine release gates.
- `bunx vitest run tests/regression/wave0/c2SurfaceAiReleaseGate.test.ts tests/unit/package-manager/HubWorkspacePage.release.test.ts tests/unit/foundation/surfaceAiAccessBroker.test.ts` - exit 0, 36 tests passed. Exact source inventory, Main registration, packaged UI, and broker behavior prove the one release-owned C2 fail-closed AI-to-Surface switch; the broker also rejects stale material consent before runtime invocation.
- `bunx vitest run tests/regression/wave0/cleanMachineReleaseHarness.test.ts tests/regression/wave0/c2C5CleanMachineHarnessInventory.test.ts tests/regression/wave0/c4DeniedInstallCleanupInventory.test.ts` - exit 0, 3 files and 6 tests passed. The release-owned harness accepts only an explicit artifact plan with immutable revision and SHA-256, runs an external signature verifier before the lifecycle verifier, requires the lifecycle command to consume a unique isolated profile, and atomically preserves terminal receipts. Fixture proof only: no production-signed artifact, platform signature verification, or independent clean-machine lifecycle evidence was available.
- `bunx vitest run tests/regression/userUnderstanding/causalWithdrawalPropagation.test.ts tests/unit/userUnderstanding/causalEvaluationDataset.test.ts tests/integration/c3CoreConformance.test.ts` - exit 0, 3 files and 9 tests passed. Successive synthetic causal snapshots with correction, deletion, and consent withdrawal remove affected records from the next projection; production propagation through every named store remains unproven.
- `bunx vitest run tests/integration/c5HybridReceiptJourney.test.ts tests/unit/foundation/runKernel.test.ts` - exit 0, 26 tests passed. A local-plus-remote deterministic planning fixture persists one parent receipt linked to a verified child after restart and rejects a mismatched parent lineage before execution; it is not a reachable remote product path.
- `bunx vitest run tests/unit/foundation/surfaceAiAccessBroker.test.ts` - exit 0, 34 tests passed. Package version, operation, capability, secret use, data class, destination, and expiry divergence reject durable consent before runtime invocation; placement remains local-only and no full production consent journey exists.
- `bunx vitest run tests/integration/catalog/publisherSubmissionBoundary.test.ts tests/unit/package-manager/remoteCatalog.test.ts` - exit 0, 72 tests passed. An auto-approved staged artifact revoked before install remains non-activatable and contributes no Surface; deployed authority and catalog delivery remain open.
- `bunx vitest run tests/regression/security/secretFirewallBenchmark.test.ts` - exit 0, 5 tests passed. A terminal-control/ANSI-obfuscated credential has both encoded and raw forms removed from returned firewall text; this remains firewall-only, not whole-platform secret proof.
- `bunx vitest run tests/unit/foundation/runKernel.test.ts tests/regression/security/secretFirewallBenchmark.test.ts` - exit 0, 2 files and 31 tests passed. The Foundation Main-to-renderer boundary redacts ANSI-obfuscated and serialized credentials from Core result/error text and logs only static rejection labels; this is a focused C3-02 boundary slice, while scanner coverage and other routes remain open.
- `bunx vitest run tests/unit/foundation/runKernel.test.ts tests/regression/security/secretFirewallBenchmark.test.ts` - exit 0, 2 files and 30 tests passed. A detected ANSI-obfuscated credential or serialized client secret in a governed goal now terminalizes before context projection or target execution, and the events/journal contain no prohibited representation; scanner coverage and non-Foundation routes remain open.
- `bunx vitest run tests/integration/package-manager/installDoesNotGrantAiAccess.test.ts tests/unit/foundation/surfaceAiAccessBroker.test.ts` - exit 0, 35 tests passed. A real signed/reviewed Store install begins with no durable AI consent, rejects broker dispatch without a separate Main confirmation, then records consent only after the exact challenge; universal route coverage remains open.
- `bunx vitest run tests/unit/foundation/surfaceAiAccessBroker.test.ts tests/integration/package-manager/installDoesNotGrantAiAccess.test.ts tests/integration/package-manager/revocationCancelsSurfaceAi.test.ts tests/integration/package-manager/deniedAiAccessKeepsSurfaceUsable.test.ts` - exit 0, 4 files and 38 tests passed. Consent revoked during asynchronous Trust preflight is re-read before child dispatch and blocks Surface invocation; universal production/package journey proof remains open.
- `bunx vitest run tests/unit/foundation/surfaceAiAccessBroker.test.ts tests/integration/package-manager/revocationCancelsSurfaceAi.test.ts` - exit 0, 2 files and 40 tests passed. Consent revocation or a material declaration change while durable parent/child receipt recovery is pending is re-read before any new child effect, so the Surface runtime is never invoked; universal production/package journey proof remains open.
- `bunx vitest run tests/unit/foundation/surfaceAiAccessBroker.test.ts tests/integration/package-manager/revocationCancelsSurfaceAi.test.ts tests/integration/package-manager/installDoesNotGrantAiAccess.test.ts` - exit 0, 3 files and 42 tests passed. If revocation arrives after the queued child receives its resource lease but before its callback starts, the broker rechecks durable authorization at the final Main dispatch seam, invokes no Surface callback, terminalizes both receipts as cancelled, and releases leases; this remains one local route.
- `bunx vitest run tests/unit/foundation/surfaceAiAccessBroker.test.ts tests/integration/package-manager/revocationCancelsSurfaceAi.test.ts tests/integration/package-manager/installDoesNotGrantAiAccess.test.ts tests/integration/package-manager/deniedAiAccessKeepsSurfaceUsable.test.ts tests/integration/c4LocalSurfaceAiJourney.test.ts tests/regression/wave0/c1ReconsentRevocationInventory.test.ts` - exit 0, 6 files and 50 tests passed. A local Surface consent now binds a Main-owned policy revision; policy drift at initial admission or during receipt recovery rejects cached consent before the package callback, a fresh matching consent succeeds, and later revocation still blocks it. Legacy durable envelopes remain readable and revocable but cannot be reconfirmed or dispatched without a policy binding. This is one local consent seam; catalog and other consent routes remain unbound.
- `bunx vitest run tests/integration/c3CoreConformance.test.ts` - exit 0, 4 tests passed. An unavailable explicitly selected local target returns unavailable before model lookup, remote host resolution, or execution even when a remote target is available; release coverage remains incomplete.
- `bunx vitest run tests/regression/wave0/c4DirectInvocationBoundary.test.ts tests/regression/wave0/c2SurfaceAiReleaseGate.test.ts tests/integration/c4LocalSurfaceAiJourney.test.ts` - exit 0, 3 files and 6 tests passed. The known Main-owned C4 model/MCP chain has no renderer or optional implementation imports and package-to-package execution remains callback-injected; universal graph/candidate proof remains open.
- `bunx vitest run tests/integration/package-manager/revocationCancelsSurfaceAi.test.ts tests/unit/foundation/surfaceAiAccessBroker.test.ts` - exit 0, 35 tests passed. Revoking durable consent aborts a live signed Package Surface invocation, terminalizes both parent/child receipts, releases the child lease, and blocks the next transport invocation; this is one local route only.
- `bunx vitest run tests/unit/automation/automationExecutionGuard.test.ts tests/regression/wave0/c3RunKernelOwnership.test.ts` - exit 0, 2 files and 7 tests passed. Automation now requires the Main TrustRuntime, synchronously preflights actor/origin/policy, records a verified Foundation receipt, and aborts active workflow runs through the shared RunKernel; News and native-file mutations remain explicit migration holes.
- `bunx vitest run tests/unit/automation/automationChatAccountGate.test.ts tests/integration/catalog/tomniProviderDesktopCutover.test.ts tests/unit/automation/automationEgressAuthority.test.ts tests/unit/agentChat/providerExecutionBroker.test.ts` - exit 0, 4 files and 23 tests passed. Automation `action.ai` and Automation Chat no longer read provider credentials or perform direct fetch; both call the shared Main ProviderExecutionBroker, which binds authenticated actor, destination admission, final egress inspection, and opaque credential handling. Other Automation external leaves remain separately governed and incomplete.
- `bunx vitest run tests/integration/catalog/tomniProviderDesktopCutover.test.ts tests/unit/agentChat/providerExecutionBroker.test.ts` - exit 0, 2 files and 17 tests passed. Studio Chat now sends provider completions through the shared Main ProviderExecutionBroker and retains its local watermark normalization only after brokered content returns; direct provider credential and fetch paths are absent from the bridge.
- `bunx vitest run tests/unit/monitor/monitorPipeline.test.ts tests/integration/catalog/tomniProviderDesktopCutover.test.ts tests/unit/agentChat/providerExecutionBroker.test.ts` - exit 0, 3 files and 42 tests passed. Monitor Analyzer retains catalog-based model selection but delegates completion to the shared Main ProviderExecutionBroker; it no longer reads API keys or fetches provider destinations directly.
- `bunx vitest run tests/unit/testing/scenarioGenerator.test.ts tests/integration/catalog/tomniProviderDesktopCutover.test.ts tests/unit/agentChat/providerExecutionBroker.test.ts` - exit 0, 3 files and 28 tests passed. Testing Scenario Generator retains CLI routing, model selection, timeout, and progress states while delegating provider completion to the shared Main ProviderExecutionBroker; direct provider credential and fetch paths are absent.
- `bunx vitest run tests/unit/testing/appDetectorCache.test.ts tests/integration/catalog/tomniProviderDesktopCutover.test.ts tests/unit/agentChat/providerExecutionBroker.test.ts` - exit 0, 3 files and 25 tests passed. Testing App Detector retains catalog model selection, 45-second cancellation, cache/progress phases, and CLI read-only workspace routing while the provider completion is delegated to the shared Main ProviderExecutionBroker; the detector has no direct provider credential or fetch path.

- `bunx vitest run tests/unit/makevideo/makeVideoImageContainment.test.ts tests/unit/makevideo/makeVideoScript.test.ts tests/unit/makevideo/retry.test.ts` - exit 0, 3 files and 22 tests passed. MakeVideo remote image generation now fails closed before provider lookup, credential handoff, workspace creation, or network transport; script generation, project editing, and local persistence remain available. A future Main-owned image egress authority must prove actor/origin/run binding, final serialized-payload and destination inspection, opaque secret lease, cancellation, limits, and durable receipts before remote image generation can be enabled.
- `bunx vitest run tests/unit/makevideo/voiceGen.test.ts` - exit 0, 1 file and 6 tests passed. MakeVideo remote TTS now fails closed before transport or artifact write unless a future Main-only VoiceEgressAuthority owns actor/origin/run binding, final serialized-payload and destination admission, opaque secret lease, DNS/redirect-bounded transport, cancellation, timeout, and durable receipt. The legacy route no longer forwards API keys or provider URLs; this is containment, not an enabled C3 egress path.
- `bunx vitest run tests/regression/wave0/providerExecutionMigrationInventory.test.ts tests/regression/wave0/c3SecretBoundaryInventory.test.ts tests/unit/agentChat/providerExecutionBroker.test.ts tests/unit/makevideo/makeVideoImageContainment.test.ts tests/unit/makevideo/voiceEgressAuthority.test.ts tests/unit/knowledge/rtkEmbedder.test.ts tests/unit/contentExtract/speechTranscription.test.ts` - exit 0, 7 files and 29 tests passed. The bounded provider inventory has no active direct credential/fetch executor: MakeVideo image/voice/clip, RTK remote embedding, speech transcription, provider discovery, Company MCP, and Image MCP are explicit Main fail-closed containments, while supported text completion goes only through ProviderExecutionBroker. This narrows the C3 secret/egress boundary but does not close its universal production inventory or benchmark atom.
- `bunx vitest run tests/integration/makevideoVoiceEgressAuthorityContract.test.ts tests/unit/makevideo/voiceEgressAuthority.test.ts tests/unit/makevideo/voiceGen.test.ts tests/regression/wave0/providerExecutionMigrationInventory.test.ts` - exit 0, 4 files and 14 tests passed. The binary TTS contract is separate from text-only `ProviderExecutionBroker`: it admits only the Main-owned saved OpenAI MP3 destination class through an opaque lease; it rejects ElevenLabs, wrong media destinations, expired/invalid leases, and raw-key/base-URL-shaped input before transport. The integration proves a raw MakeVideo config cannot pass its secret or URL to either adapter and no audio is persisted until binary transport returns. The currently unimplemented admission/transport must still bind the account/run, inspect final payload, resolve the secret and exact destination internally, reject redirects, honor cancellation, and persist a durable receipt before this disabled path can be enabled.

- `bunx vitest run tests/integration/makevideoVoiceEgressComposition.test.ts tests/integration/makevideoVoiceEgressAuthorityContract.test.ts tests/unit/makevideo/voiceEgressAuthority.test.ts tests/unit/makevideo/voiceGen.test.ts` - exit 0, 4 files and 12 tests passed. The active MakeVideo bridge supplies only a local output directory and no VoiceEgressAuthority; the shared ProviderExecutionBroker is text/chat-only, so it cannot supply binary MP3 admission, opaque transport, or a durable transport receipt. TTS remains fail-closed until Main composes the full account/run-bound binary contract.
- `bunx vitest run tests/unit/makevideo/videoClipGen.test.ts` - exit 0, 1 file and 6 tests passed. MakeVideo image-to-video now fails closed before source read, authority invocation, network transport, or artifact write unless a future Main-only `VideoClipEgressAuthority` owns actor/origin/run binding, final serialized-payload and destination admission, opaque secret lease, DNS/redirect-bounded transport, cancellation, timeout, output-size limits, and durable receipt. The legacy direct fal.ai API-key/fetch transport was removed; this is containment, not an enabled C3 egress path.

- `bunx vitest run tests/unit/mcp/imageGenServerContainment.test.ts tests/unit/mcp/nativeMcpBootstrap.test.ts` - exit 0, 2 files and 8 tests passed. The legacy built-in Image MCP child now fails closed before provider configuration, credential, prompt, image input, workspace, or network transport; legacy bootstrap still scrubs and disables its descriptor. Tool metadata remains available, but a future Main-owned image egress authority must prove actor/origin/run binding, final payload and destination inspection, opaque secret lease, cancellation, limits, and durable receipts before remote image generation can be enabled.
- `bunx vitest run tests/unit/agentChat/cliAgentDriver.test.ts tests/regression/wave0/c3RunKernelOwnership.test.ts tests/unit/foundation/foundationBridge.test.ts` - exit 0, 3 files and 47 tests passed. Direct CLI requires the configured Main TrustRuntime, derives actor/policy from it, and rejects before adapter invocation when it is missing.
- `bunx vitest run tests/unit/agentChat/cliAgentDriver.test.ts` - exit 0, 1 file and 20 tests passed. Direct CLI normalizes a user-facing Surface label to one bounded workspace segment (including traversal-like and overlong labels) before composing the workspace path; no raw label becomes a filesystem path component.
- `bunx vitest run tests/unit/news/newsBridge.test.ts tests/regression/wave0/c3RunKernelOwnership.test.ts` - exit 0, 2 files and 8 tests passed. Manual News remote operations require both the existing Main egress authority and the shared TrustRuntime, produce a verified Foundation receipt, and deny before fetch when the runtime is absent; native-file mutation remains the separate C3 migration hole.
- `bunx vitest run tests/unit/news/newsScheduler.test.ts tests/unit/news/newsBridge.test.ts` - exit 0, 2 files and 8 tests passed. RSS background refresh now denies before store/fetch when TrustRuntime is absent, preserves existing egress admission, and records a verified Foundation receipt; native-file mutation remains the C3 migration hole.
- `bunx vitest run tests/unit/news/realtimeConnector.test.ts tests/unit/news/newsScheduler.test.ts tests/unit/news/newsBridge.test.ts` - exit 0, 3 files and 19 tests passed. Realtime connection and reconnect attempts deny before store/DID/socket work when TrustRuntime is absent, preserve existing egress admission, and record verified Foundation receipts; native-file mutation remains the C3 migration hole.
- `bunx vitest run tests/regression/wave0/c3RunKernelOwnership.test.ts tests/unit/news/bots/botEngine.test.ts tests/unit/news/realtimeConnector.test.ts tests/unit/news/newsScheduler.test.ts tests/unit/news/newsBridge.test.ts` - exit 0, 5 files and 25 tests passed. Bot market/history/live/backtest operations now deny before external work without TrustRuntime and record verified Foundation receipts; the bounded C3 inventory now leaves only native-file mutation as a migration hole.
- `bunx vitest run tests/unit/browser/browserControlWiringContainment.test.ts tests/regression/wave0/nativeFileGovernanceInventory.test.ts tests/regression/wave0/c3NativeFileExecutorBypassInventory.test.ts` - exit 0, 3 files and 6 tests passed. The bounded inventory keeps the renderer gateway, ZIP, IDE, Studio, Browser-Control editor, and Browser-Control screenshot persistence entrypoints in explicit fail-closed containment. No route is silently treated as governed.
- `bunx vitest run tests/unit/resource/governedWorkspaceMutation.test.ts tests/unit/foundation/trustBrokerFilesystemEffect.test.ts tests/unit/foundation/trustBroker.test.ts tests/unit/foundation/runKernel.test.ts tests/unit/foundation/resourceAdapter.test.ts` - exit 0, 5 files and 46 tests passed. A Main-only workspace-write contract derives actor/policy from the composed TrustRuntime, rechecks the exact live actor/run/task/target/path grant at the final effect seam, revokes it after the effect, rejects control/traversal paths, records only bounded digest/transaction evidence, and preserves a verified receipt for a proven atomic commit racing cancellation. It has no JavaScript filesystem fallback: production remains fail-closed until a Windows-native reparse-safe atomic driver and consent-bound bootstrap composition exist.
- `bunx vitest run tests/unit/foundation/coreWorkspaceServer.test.ts tests/regression/wave0/nativeFileGovernanceInventory.test.ts tests/regression/wave0/c3NativeFileExecutorBypassInventory.test.ts tests/regression/wave0/c3RunKernelOwnership.test.ts` - exit 0, 4 files and 9 tests passed. Core Workspace keeps read/search/glob available while `tomny_write`, `tomny_edit`, and `tomny_command` return stable governance-required errors before path resolution, filesystem mutation, or shell spawn. The C3 inventories prohibit the removed raw Node write/rename/shell markers and classify this as fail-closed containment, not a governed capability.
- `bunx vitest run tests/unit/resource/governedWorkspaceMutation.test.ts tests/unit/foundation/trustBrokerFilesystemEffect.test.ts tests/unit/foundation/trustBroker.test.ts tests/unit/foundation/runKernel.test.ts tests/unit/foundation/resourceAdapter.test.ts tests/regression/wave0/c3RunKernelOwnership.test.ts tests/regression/wave0/c3NativeFileExecutorBypassInventory.test.ts tests/regression/wave0/nativeFileGovernanceInventory.test.ts tests/unit/foundation/coreWorkspaceServer.test.ts tests/unit/agentChat/tomnyCoreAdapter.test.ts` - exit 0, 10 files and 104 tests passed; `bunx tsc --noEmit --pretty false` - exit 0. This confirms the current C3 contract and bounded route inventory compile together, but does not activate the still-unmigrated Core Workspace effects.
- `cargo test --manifest-path packages/tomny-runtime/Cargo.toml workspace_writer` and `cargo test --manifest-path packages/tomny-runtime/Cargo.toml refuses_workspace_writes` - exit 0, 3 Rust tests passed. The bundled Main-owned Rust sidecar now accepts only a strict future `workspace.write_atomic` request shape and rejects traversal, ADS, DOS-device, control-character, and digest-limit violations before any effect. It neither advertises nor implements the native write capability yet, returning `NATIVE_NO_REPARSE_WRITE_UNAVAILABLE` rather than falling back to path-string or JavaScript writes.
- `bunx vitest run tests/unit/mcp/nativeFileGatewayBridge.test.ts tests/unit/mcp/nativeFileGateway.test.ts tests/regression/wave0/nativeFileGovernanceInventory.test.ts` - exit 0, 3 files and 14 tests passed. The bootstrapped renderer `native-fs` gateway now rejects temp, write, copy, remove, and rename before `NativeFileGateway` can touch disk; safe reads and existing remote-image admission remain available. This is C3-01 containment only: Browser-Control writers remain migration holes, while Core Workspace, the ZIP endpoint, and legacy renderer mutations are separately fail-closed; any future enabled local mutation route requires the complete actor/path capability, consent, limits, Trust admission, and durable receipt seam.
- `bunx vitest run tests/unit/resource/nativeZipBridgeContainment.test.ts tests/unit/resource/nativePlatform.test.ts` - exit 0, 2 files and 12 tests passed. The bootstrapped legacy `native-fs.zip` endpoint now rejects before it can invoke `NativeZipService`, read a source entry, or create an output archive; its typed request metadata and cancellation channel remain compatible (`false` when no governed request exists). This is C3-01 containment, not a governed write path: a future enablement still requires actor/path capability, consent, limits, TrustBroker admission, and a durable RunKernel receipt.
- `bunx vitest run tests/unit/studio/studioDocxBridgeContainment.test.ts tests/unit/studio/studioFsBridgeContainment.test.ts tests/regression/wave0/c3NativeFileExecutorBypassInventory.test.ts` - exit 0, 3 files and 6 tests passed. Studio binary and DOCX write channels, together with the IDE arbitrary-path mutation channels, now remain registered only for stable compatibility errors and reject before path/content processing or filesystem effects. Read/parse operations remain available. This is containment, not C3-01 completion: future writes require an actor-bound path capability, explicit consent, limits, Trust admission, and a durable RunKernel receipt.
- `bunx vitest run tests/unit/package-manager/persistentContributionSupervisor.test.ts tests/unit/package-manager/designViuMcpRuntime.test.ts` - exit 0, 12 tests passed. Revocation waits for the active persistent endpoint to stop, rejects queued reacquisition after binding inactivity, and records stopped/rejected evidence; the full C5-06 matrix remains open.
- `bunx vitest run tests/integration/c4AlternativeSurfaceSelection.test.ts tests/unit/foundation/storeSurfaceCandidateProvider.test.ts tests/integration/c4LocalSurfaceAiJourney.test.ts` - exit 0, 3 files and 7 tests passed. A disabled IDE loses deterministically to an enabled reviewed non-IDE Builder with the disqualification evidence retained; this is planner-only evidence.
- `bunx vitest run tests/unit/package-manager/service.test.ts tests/integration/package-manager/rollbackRestartRecovery.test.ts tests/integration/package-manager/packageMutationRestartRecovery.test.ts` - exit 0, 3 files and 76 tests passed. Signed 1.0→1.1 update, rollback, and restart restore the expected version, previous version, artifact, contribution, persisted state, and empty transaction folders; failure/revoke/runtime/clean-machine boundaries remain open.
- `bunx vitest run tests/unit/diagnostics/coreEvaluationCandidateReport.test.ts tests/unit/diagnostics/coreEvaluationRunner.test.ts` - exit 0, 2 files and 11 tests passed. Candidate evidence now fails closed for a missing provenance object or undefined/non-string source ID, while remaining candidate-only and promotion-disabled; promotion-quality reports remain incomplete.
- `bunx vitest run tests/unit/diagnostics/coreEvaluationCandidateReport.test.ts tests/unit/diagnostics/coreEvaluationRunner.test.ts` - exit 0, 2 files and 12 tests passed. Candidate reports now reject a malformed comparator rather than interpreting it as a passing lower-bound floor; cross-revision frozen baselines and promotion-quality evidence remain open.

- `bunx vitest run tests/unit/diagnostics/coreEvaluation/candidateProvenanceReceipt.test.ts tests/unit/diagnostics/coreEvaluationRunner.test.ts tests/unit/diagnostics/coreEvaluationCandidateReport.test.ts tests/regression/wave0/c0CandidateCorpusProvenanceInventory.test.ts` - exit 0, 4 files and 22 tests passed. The Main-owned candidate evaluation-publication boundary now fails closed with stable non-promotable reasons for a missing, malformed, unverifiable, or rejected provenance receipt/report pair; a verified Ed25519 receipt is retained as aggregate evidence while `promotionAllowed` remains false. This is local contract evidence only: no production release key, clean committed candidate, or external release attestation is available.
- `bunx vitest run tests/integration/package-manager/updateFailureRecovery.test.ts tests/integration/package-manager/rollbackRestartRecovery.test.ts tests/integration/package-manager/packageMutationRestartRecovery.test.ts` - exit 0, 3 files and 3 tests passed. A corrupt signed update payload fails integrity while restart retains one enabled v1 record, contribution, asset, and no mutation orphan; network/crash/clean-machine cases remain open.
- `bunx vitest run tests/integration/package-manager/packageMutationRestartRecovery.test.ts tests/integration/package-manager/rollbackRestartRecovery.test.ts tests/integration/package-manager/updateFailureRecovery.test.ts tests/integration/package-manager/revocationRestartRecovery.test.ts` - exit 0, 4 files and 7 tests passed. Restart recovery discards stale trash for bundled legacy packages while retaining their durable record, so it cannot manufacture a downloaded package payload orphan; physical crash/runtime/clean-machine recovery remains open.
- `bunx vitest run tests/integration/package-manager/packageMutationRestartRecovery.test.ts tests/integration/package-manager/rollbackRestartRecovery.test.ts tests/integration/package-manager/updateFailureRecovery.test.ts tests/integration/package-manager/revocationRestartRecovery.test.ts tests/integration/package-manager/deniedInstallCleanup.test.ts` - exit 0, 5 files and 10 tests passed. A child process is force-terminated immediately after PackageManagerService transfers a verified payload and before its first durable state save; restart removes that unregistered payload with no ghost Surface, contribution, staging, trash, or download state. Remaining physical crash/runtime/clean-machine matrix cases are open.
- `bunx vitest run tests/integration/package-manager/packageMutationRestartRecovery.test.ts tests/integration/package-manager/rollbackRestartRecovery.test.ts tests/integration/package-manager/updateFailureRecovery.test.ts tests/integration/package-manager/revocationRestartRecovery.test.ts` - exit 0, 4 files and 8 tests passed. Enabling a downloaded package with a missing payload now fails closed, durably quarantines it, and registers no contribution; a clean-machine production lifecycle journey remains open.
- `bunx vitest run tests/integration/c4LocalSurfaceAiJourney.test.ts` - exit 0, 1 test passed. A restarted kernel rehydrates exactly one verified parent/child receipt pair after the completed local effect and does not reinvoke the runtime; mid-effect and whole-journey idempotency remain open.
- `bunx vitest run tests/regression/userUnderstanding/contextCannotAuthorize.test.ts tests/regression/userUnderstanding/causalWithdrawalPropagation.test.ts tests/unit/foundation/trustBroker.test.ts` - exit 0, 3 files and 9 tests passed. Positive learned context remains advisory and cannot turn an ungranted filesystem capability into Trust authorization; production-wide propagation remains open.
- `bunx vitest run tests/unit/diagnostics/candidateArtifactWithdrawalPolicy.test.ts tests/unit/diagnostics/coreEvaluation/promotionGate.test.ts` - exit 0, 2 files and 7 tests passed. Main verifies data-minimised signed withdrawal receipts and blocks future promotion of quarantined/retrain/no-future-use candidates; durable ledger, release key, and offline retrain proof remain open.
- `bunx vitest run tests/unit/diagnostics/candidateArtifactWithdrawalPolicy.test.ts tests/unit/diagnostics/coreEvaluation/promotionGate.test.ts` - exit 0, 2 files and 8 tests passed. A later trusted retrain/no-future-use receipt monotonically escalates a prior quarantine to no-future-use rather than retaining weaker policy state; durable ledger, restart, release-key, and offline retrain proof remain open.

- `bunx vitest run tests/integration/catalog/paidArtifactPublicationReviewAdmission.test.ts tests/integration/catalog/packagePublishLifecycle.test.ts tests/unit/package-manager/remoteCatalog.test.ts tests/unit/package-manager/service.test.ts` - exit 0, 4 files and 144 tests passed. Captured lifecycle cannot smuggle trust; paid admission rejects missing, malformed, and copied review records. Review v2 carries an exact artifact integrity, and both the signed catalog parser and activation bind it to the manifest. Authoritative reviewer/catalog and checkout proof remain open.
- `bunx vitest run tests/unit/package-manager/StoreProductDetail.dom.test.tsx` - exit 0, 13 tests passed; `bun run i18n:types` and `node scripts/check-i18n.js` exit 0. Consent displays all supplied identity, package/version, operation, capability, secret, data, destination, and expiry facts before approval without changing Main authorization; a packaged/release journey remains required.
- `bunx vitest run tests/regression/wave0/c5CleanBaseStartInventory.test.ts tests/unit/package-manager/designViuMcpRuntime.test.ts tests/unit/package-manager/designViuNativeBridge.test.ts` - exit 0, 3 files and 11 tests passed. Known Design constructors are confined to the package bridge after installed-and-enabled guards; available and installed-disabled status never crosses that activation boundary, and disposal rejects subsequent activation events. A clean-machine packaged-binary base-start proof remains required.

- `bunx vitest run tests/integration/package-manager/revocationRestartRecovery.test.ts tests/integration/package-manager/packageMutationRestartRecovery.test.ts tests/integration/package-manager/rollbackRestartRecovery.test.ts tests/integration/package-manager/updateFailureRecovery.test.ts` - exit 0, 4 files and 4 tests passed. Signed reviewed revoke stops runtime, persists quarantined disabled state, and after restart blocks asset/read/install/enable with no contribution or staging/trash/download orphan; the exact signed payload is intentionally retained as quarantine evidence, so retention/erasure design remains open.
- `bunx vitest run tests/integration/package-manager/deniedAiAccessKeepsSurfaceUsable.test.ts tests/unit/foundation/surfaceAiAccessBroker.test.ts` - exit 0, 2 files and 35 tests passed. Missing consent blocks before transport while the signed reviewed package stays installed/enabled with its opened runtime and no child Run or consent residue; renderer and packaged evidence remain open.

- `bunx vitest run tests/unit/package-manager/StoreProductDetail.dom.test.tsx tests/unit/package-manager/PackageAppHost.dom.test.tsx` - exit 0, 2 files and 33 tests passed. A person opens an installed enabled Surface with zero AI consents and the UI makes no automatic AI challenge, confirmation, activation, invoke, or cancel call; packaged end-to-end proof remains open.
- `bunx vitest run tests/unit/foundation/runKernel.test.ts tests/regression/security/secretFirewallBenchmark.test.ts` - exit 0, 2 files and 30 tests passed. Terminal-control and serialized credentials are removed from returned, durable, and recovered RunKernel receipts before evidence events or journal projection; provider/CLI paths outside RunKernel remain open.

- `bunx vitest run tests/integration/catalog/publisherSubmissionBoundary.test.ts tests/integration/catalog/packagePublishLifecycle.test.ts tests/unit/package-manager/remoteCatalog.test.ts` - exit 0, 3 files and 76 tests passed. Signed AI-plus-egress submission requires human review and never auto-publishes, catalogs, or activates; a low-risk signed submission auto-approves. Authoritative reviewer/catalog delivery remains required.

- `bunx vitest run tests/integration/package-manager/packageMutationRestartRecovery.test.ts tests/unit/package-manager/StoreProductDetail.dom.test.tsx` - exit 0, 2 files and 18 tests passed. Restart quarantine cannot re-enable from a stale catalog entry and leaves no contribution or transaction orphan; declined AI consent leaves the installed enabled Surface visibly openable. Physical crash/runtime/clean-machine and packaged end-to-end proof remain open.
- `bunx vitest run tests/unit/package-manager/StoreProductDetail.dom.test.tsx` - exit 0, 16 tests passed. A visible grant revokes its exact consent ID, refreshes to the grant state, performs no package mutation or AI invocation, and a declined challenge keeps the Surface Open action visible; Main cancellation and restart proof remain separately incomplete.
- `bunx vitest run tests/unit/package-manager/storeCommerceLedger.test.ts tests/integration/catalog/paymentDoesNotRaiseTrust.test.ts tests/integration/catalog/paidArtifactPublicationReviewAdmission.test.ts` - exit 0, 3 files and 6 tests passed. Main-local CommerceLedger retains one order, payment evidence, entitlement, opaque acquisition grant, and compensating refund across restart; duplicate/tampered evidence fails closed and a captured payment cannot elevate package trust. Checkout, authenticated provider webhook, and remote reconciliation remain absent.
- `bunx tsc --noEmit` and `bun run lint` - both exit 0 on the current dirty worktree; lint still reports 1,216 pre-existing warnings. Focused C4 boundary/access regressions are 4 files and 7 tests passed. This is a technical baseline only, not a clean candidate, inventory, package artifact, or release receipt.
- `bunx electron-builder --config packages/desktop/electron-builder.yml --win --x64 --dir --publish=never` - exit 0 after the Windows packaging fix. `app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib` contains `sharp-win32-x64.node`, `libvips-42.dll`, and `libvips-cpp-8.17.3.dll`; `afterPack.js` now fails closed when any is absent. This closes the observed packaged `sharp` native-module error, but does not close the clean-machine lifecycle or Authenticode release gates.
- Earlier full-suite snapshot: `bun run test` exited 1 with one stale Design artifact-closure assertion. The stale Design/Document artifacts were subsequently rebuilt with the configured production signing key and the focused package artifact suite now passes 14/14; a fresh full-suite run remains separate release evidence.
- `bunx vitest run tests/unit/package-manager/firstPartyAppArtifacts.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism` - exit 0: 14 tests passed after rebuilding and replacing the production Design/Document artifacts with the current extracted source closures and refreshing their catalog manifests. `bunx vitest run tests/integration/catalog/publisherSubmissionBoundary.test.ts tests/integration/catalog/packagePublishLifecycle.test.ts tests/unit/package-manager/remoteCatalog.test.ts tests/unit/package-manager/service.test.ts --pool=forks --maxWorkers=1 --no-file-parallelism` - exit 0: 151 tests passed. This closes the stale-artifact component failure; clean-machine packaged desktop evidence and external Store authorities remain required.

Integration gate evidence: bun run test:integration exited 0 with 30 files passed and 1 skipped (105 tests passed, 3 skipped) after aligning the provider-cutover inventory to the current Main-owned Browser provider-chat path. This remains integration evidence only; deployed Store, payment, publisher, and clean-machine release authorities remain absent.

- `bunx vitest run tests/unit/package-manager --pool=forks --maxWorkers=1 --no-file-parallelism` - exit 0, 35 files and 355 tests passed. Store/package-manager unit coverage remains green; the full repository suite still has unrelated stale optional/UI/training failures.
- Fresh P7 artifact checkpoint (2026-09-09): package build produced main/preload/renderer; electron-builder Windows x64 directory packaging completed after native-module verification; verify-windows-desktop-lifecycle.mjs exited 0 with clean-machine-ready.json under .tmp/p7-startup-2026-09-09/fresh. Local packaging evidence is current; production Authenticode and independent host attestation remain unavailable.
- P7 final clean-profile revalidation (2026-09-09): verify-windows-desktop-lifecycle.mjs against out/win-unpacked/Tomny.exe exited 0 and produced clean-machine-ready.json with isPackaged=true, isolated userDataPath, runId, and rendererLoadedAt. Production signing/independent attestation remain BLOCKED.
- P7 current artifact rerun (2026-09-10): verify-windows-desktop-lifecycle.mjs against out/win-unpacked/Tomny.exe exited 0 and produced .tmp/p7-current-rerun-20260910/clean-machine-ready.json with isPackaged=true, isolated userDataPath, runId, and rendererLoadedAt. Production Authenticode and independent attestation remain BLOCKED.
- Local WebUI Store-route smoke (2026-09-09): authenticated POST /login returned 200 for the local admin session; GET /api/packages returned 200 with 4 catalog entries and GET /api/packages/contributions succeeded. The artifact route correctly returned 404 for the selected local entries because they carry no artifactUrl; immutable remote artifact storage is not provisioned. This is local route evidence, not production Store authority.
- P7 revalidation (2026-09-09): lifecycle verifier on out/win-unpacked/Tomny.exe exited 0 and produced clean-machine-ready.json; this is local artifact evidence only, while production Authenticode signing and independent host attestation remain BLOCKED.
- P8 component revalidation (2026-09-09): catalog publication, publisher boundary, commerce ledger, and publisher authority tests passed 4 files / 21 tests / exit 0; deployed account, reviewer, immutable storage, payment, payout, and reconciliation authorities remain BLOCKED.
- P7 startup revalidation (2026-09-09): `bun start` reached Electron main/preload, native MCP bootstrap (`defaults=ready`, `failed=0`), created the main window, and loaded the renderer at `http://localhost:5173`; this is development startup evidence, not clean-machine release evidence.
- P7 follow-up lifecycle verifier (2026-09-09): `node scripts/release/verify-windows-desktop-lifecycle.mjs --artifact=out/win-unpacked/Tomny.exe --profile=.tmp/p7-followup-20260909` exited 0 and wrote `clean-machine-ready.json` with `isPackaged=true`, isolated profile, `runId`, and `rendererLoadedAt`. Authenticode certificate/key and independent host attestation remain BLOCKED.
- P8 focused revalidation (2026-09-09): package-manager integration, billing, commerce ledger, publisher staging/submission suites exited 0: 14 files and 54 tests passed. This confirms local contracts/recovery only; deployed Store authorities, payment/refund provider, payout/reconciliation, and production entitlement remain BLOCKED.
- Typecheck recovery (2026-09-09): `bunx tsc --noEmit --pretty false --incremental false` exited 0 after tightening the Main model-consumer `ttlMs` parser; focused model gateway tests exited 0 with 3 files / 15 tests. This is a technical gate only and does not change production Store/payment/signing status.
- `bunx vitest run tests/unit/tomni-gateway/modelConsumerBridge.test.ts tests/unit/tomni-gateway/modelConsumerVault.test.ts` - exit 0, 2 files and 6 tests passed. Main consumer IPC validates bounded issue/revoke payloads, rejects empty model allowlists, enforces the account guard before registry access, account-scoped listing/revocation, and serialized concurrent vault writes; plaintext credentials remain absent from persisted records.
- Native Settings > Model consumer panel revalidation (2026-09-09): common model-consumer IPC channels are shared by Main and renderer; the panel supports account-bound issue/list/revoke with one-time credential copy and no upstream provider secret fields. `bunx vitest run tests/unit/tomni-gateway` exited 0 with 13 files / 54 tests; `bunx tsc --noEmit --pretty false --incremental false` exited 0 after repairing telemetry handlers and adding dynamic gateway endpoint IPC (lint remains previously green with existing warnings).
- Consumer apply guard slice (2026-09-09): Main validates consumer id + credential digest through the active registry and model allowlist before invoking the existing atomic/backup connector applier; revoked or model-denied credentials fail closed. This is component evidence only; renderer apply controls and full concurrent-edit recovery journey remain pending.
  Dynamic gateway endpoint guard (2026-09-09): consumer apply now accepts an ephemeral loopback port only when it matches the Main-owned gateway endpoint resolver; mismatched loopback endpoints fail before credential registry access. The Settings panel retrieves that endpoint through an authenticated IPC channel. Focused bridge tests passed 8/8, Router9 config/apply/lifecycle tests passed 35/35, and TypeScript passed after wiring the resolver in Main. This closes a local endpoint-safety gap but does not complete config distribution or release acceptance.
  Replay control slice (2026-09-09): authenticated IPC now exposes replay export and delete operations backed by the encrypted, actor-scoped replay store; unknown delete payload keys fail closed, and Settings adds export/delete controls. Bridge, replay-store, and model-service tests passed 16/16; the full Tomni gateway unit set passed 13 files / 56 tests; TypeScript, i18n types, i18n validation, and relevant Prettier checks passed (repository warnings remain). Retention, opt-in configuration UI, and full export/redaction journey remain pending.

- P8 gate revalidation (2026-09-09): `bun run test:contract` exited 0 with 1 file / 4 tests; Store/catalog/package-manager/billing focused suite exited 0 with 20 files / 83 tests; full TypeScript check exited 0. Evidence is local/component scope and does not prove deployed payment, entitlement, payout, storage, reviewer, or signing authority.
- Full gate audit (2026-09-09): `bun run format:check` exited 1 because 131 files in the dirty snapshot require formatting; no wholesale formatter rewrite was applied. `bun run test` exited 1 after 737 files / 6,037 tests (723 passed files, 2 skipped, 12 failed); failures include missing optional Company/Knowledge modules, stale inventory assertions, and training fixture KeyErrors. Focused P7/P8 gates remain green; full-suite release cleanliness is not proven.
- P7 post-fix packaged revalidation (2026-09-09): `bun run package` generated updated main/preload/renderer bundles; `bunx electron-builder --config packages/desktop/electron-builder.yml --win --x64 --dir --publish=never` exited 0, afterPack rebuilt and verified Windows native modules, and `verify-windows-desktop-lifecycle.mjs` against the rebuilt `out/win-unpacked/Tomny.exe` exited 0 with `.tmp/p7-post-package-20260909/clean-machine-ready.json`. This is current local artifact evidence; production certificate/key and independent host attestation remain BLOCKED.
- WebUI startup compatibility (2026-09-09): `scripts/webui.ts` now accepts both `TOMNY_NO_BUILD=1` and the legacy/mistyped `TOMNI_NO_BUILD=1` opt-out names; esbuild exited 0 and WebUI/package API plus local catalog/artifact endpoint tests exited 0 with 7 files / 64 tests. This does not alter production Store authority.
- WebUI no-build runtime verification (2026-09-09): isolated `bun run webui -- --no-open --port 25811` with `TOMNY_NO_BUILD=1` started without invoking `bun run package`; `/api/auth/status` returned HTTP 200, and the isolated WebUI/core shut down gracefully after verification. This is local runtime evidence only.

#### C0 - Truth, inventory, and baseline

- Store API functional slice (2026-09-09): packages/store-api/src/index.ts exposes local/staging publisher enrollment, submission, review, catalog publication/read, checkout, Paddle webhook signature intake, entitlement read, refund/reconciliation/recovery fail-closed bindings, and health routes. Authenticated domain routes now resolve identities and persist through PostgreSQL repositories; payment/refund worker completion remains PARTIAL pending provider bindings.
- Store API functional slice (2026-09-09): packages/store-api/src/index.ts exposes local/staging publisher enrollment, submission, review, catalog publication/read, checkout, Paddle webhook, entitlement read, refund request, reconciliation, and recovery routes with auth boundary and bounded raw-body handling. It uses in-process state for local route exercise and is not production persistence or live payment evidence.
- Store API durable repository wiring (2026-09-09): added PostgreSQL repository methods for account resolution, publisher enrollment, submission idempotency, reviewer RBAC and digest checks, catalog publication/read, order creation, and entitlement reads; added migration 002_store_domain.sql, outbox lease primitive, and Docker runtime. SQL integration requires a real DATABASE_URL; HTTP handlers no longer use process-memory authority.

Store recovery worker extension (2026-09-10): packages/store-api/src/recoveryWorker.ts now durably leases, executes, retries with backoff, and dead-letters recovery_jobs; enabled runtime schedules periodic recovery with graceful shutdown. Scoped Store API suite: 36 files / 84 tests passed; local/staging evidence only.

- P7 packaged rebuild revalidation (2026-09-10): electron-builder Windows x64 directory packaging completed after native-module verification; rebuilt out/win-unpacked/Tomny.exe (204,521,984 bytes) passed scripts/release/verify-windows-desktop-lifecycle.mjs exit 0 and produced .tmp/p7-rebuild-check-20260910/clean-machine-ready.json. Production Authenticode and independent attestation remain BLOCKED.
- P7 final rerun after packaging completion (2026-09-10): scripts/release/verify-windows-desktop-lifecycle.mjs against rebuilt out/win-unpacked/Tomny.exe exited 0 and produced .tmp/p7-final-rerun-20260910/clean-machine-ready.json. Production Authenticode OV/KeyLocker and independent attestation remain BLOCKED.
- P7 current-followup lifecycle verification (2026-09-10): verify-windows-desktop-lifecycle.mjs exited 0 against out/win-unpacked/Tomny.exe and wrote .tmp/p7-current-followup-20260910/clean-machine-ready.json; Store API suite 43 files / 94 tests, TypeScript and formatting pass. Production Authenticode/attestation remain unavailable.
- P7 final-check lifecycle verification (2026-09-10): Windows artifact verifier exited 0 and wrote .tmp/p7-final-check-20260910/clean-machine-ready.json; Store API bundle build succeeded and 45 files / 97 tests remain green. Production certificate/attestation are still unavailable.
- Store API integrity follow-up (2026-09-10): appended migration 021_ledger_integrity.sql with positive ledger amount and ISO currency constraints, transaction/currency index, and explicit runtime/backup/migration grants. Scoped TypeScript, formatting, migration-safety, and pending-payment recovery tests pass; PostgreSQL restart/privilege evidence remains unavailable while Docker daemon is stopped.
- Ledger balance enforcement (2026-09-10): added packages/store-api/src/ledger.ts with per-currency double-entry validation and integrated it before payment-capture/refund ledger writes; dedicated ledger tests pass. This is local/staging evidence and does not replace PostgreSQL privilege/restart or production commerce evidence.
- Ledger authority verification (2026-09-10): Store API now bundles successfully and its full Bun suite passes 46 files / 99 tests / 177 assertions; typecheck, formatting, and lint (0 errors) pass. Production database restart/privilege and external authority evidence remain unavailable.
- Restore invariant correction (2026-09-10): restore verifier now checks ledger balance per currency, matching the runtime ledger invariant instead of incorrectly rejecting valid multi-currency transactions. Added regression coverage; Store API suite passes 47 files / 100 tests / 179 assertions.
- Store API test runner hardening (2026-09-10): package test script and Store API CI now use Bun's sequential test runner; full suite passes 47 files / 100 tests / 179 assertions without the prior Vitest worker heap crash. This improves local verification only and does not change production status.
- Publisher enrollment race hardening (2026-09-10): appended migration 022_publisher_owner_uniqueness.sql with a unique owner-account index and explicit grants, preventing concurrent duplicate publisher authorities. Store API suite remains green at 47 files / 100 tests / 179 assertions.
- Publisher identity hardening (2026-09-10): appended migration 023_publisher_identity_immutable.sql with a database trigger preventing runtime mutation of publisher_id, owner_account_id, or namespace while preserving lifecycle updates. Migration safety test passes with 19 assertions.
- Main-owned Store API session binding evidence (2026-09-10): added tests proving Store API requests obtain bearer tokens only from AccountSessionService and make no network request when Main session validation fails. Desktop session client tests pass 2/2; renderer receives no privileged credential.
- Desktop Store endpoint binding (2026-09-10): added Main-only readStoreApiBaseUrl validation for TOMNI_STORE_API_URL, allowing localhost development and HTTPS deployment endpoints while rejecting insecure remote HTTP. Endpoint and session-binding tests pass 4/4; no renderer credential exposure introduced.
- Store recovery evidence migration (2026-09-10): added append-only-compatible recovery_jobs.last_error migration 019 with explicit runtime/backup/migration grants; Store API suite remains 36 files / 84 tests passed. Production database application still requires the configured migration runner and real Supabase/PostgreSQL authority.
- Recovery error evidence (2026-09-10): recovery worker now persists bounded failure reason in recovery_jobs.last_error before retry/dead-letter, preserving post-restart diagnosis without secrets; Store API tests 36 files / 84 tests pass.
- Durable out-of-order payment evidence (2026-09-10): pending provider payloads are persisted and queued for recovery; migration 020 and focused test pass. Local/staging only.
- Recovery replay wiring (2026-09-10): payment-webhook-prerequisite invokes pending payload replay through the commerce recovery path; Store API suite reached 38 files / 86 tests, TypeScript and formatting pass. Durable PostgreSQL restart evidence remains unavailable without a live database.
- Encrypted backup bundle evidence (2026-09-10): AES-256-GCM backup envelope with key ID, authentication tag, plaintext SHA-256, manifest verification, and tamper rejection added; Store API suite reached 39 files / 88 tests. KMS/GCS production storage remains blocked by credentials.
- Runnable critical backup runner (2026-09-10): backupJob.ts exports critical append-only state, encrypts the bundle, assigns a content-addressed backup key, and emits a SHA-256 artifact digest; Store API suite reached 40 files / 89 tests. Production locked-bucket upload remains credential-blocked.
- Backup storage adapter (2026-09-10): added local/test idempotent store and GCS create-only backup adapter using ifGenerationMatch=0, HTTPS validation, digest metadata, and conflict rejection; Store API suite reached 41 files / 91 tests, TypeScript pass.
- GCS idempotent-existing verification (2026-09-10): adapter handles create-only 412 by reading existing object metadata; matching digest+size is idempotent success, mismatch fails closed. Store API suite reached 45 files / 97 tests.
- Runnable backup command (2026-09-10): runBackup.ts reads the encryption key from environment, runs export+encrypt, uses local storage outside production, and requires explicit GCS bucket/token in production; missing key/storage fails closed. Store API suite reached 42 files / 92 tests.
- GCS backup adapter verification (2026-09-10): HTTP-level tests prove ifGenerationMatch=0, digest metadata, and 412 immutable-conflict mapping; Store API suite reached 43 files / 94 tests, TypeScript and formatting pass.
- Backup restore artifact verifier (2026-09-10): backupRestore.ts parses downloaded encrypted artifacts, decrypts them, verifies AES-GCM authentication and manifest/digests, and rejects malformed bytes; Store API suite reached 44 files / 96 tests.
- Migration gate hardening (2026-09-10): migration safety requires all 20 ordered migrations, and Store API CI explicitly checks migration 020 pending webhook schema.
- P8 local Store lifecycle revalidation (2026-09-09): fresh isolated WebUI profile completed login, consent, and Calculator install with HTTP 200 for each step; final listing was state=installed and enabled=true, with signed manifest/integrity verification passing. This closes the local install integration atom only; production storage, account/entitlement, payment, publisher/reviewer, payout/reconciliation, signing, and independent attestation remain BLOCKED.
  P8 local Store lifecycle revalidation (2026-09-09): isolated WebUI with TOMNI_STORE_LOCAL_ARTIFACTS=1 completed login, consent, and calculator install over HTTP; login/consent/install returned 200, signed artifact integrity and signature verification passed, and listing transitioned to installed/enabled. This is local development evidence only; Main-owned local artifact transport avoids the prior downloader 401 without weakening HTTP auth. Production checkout, entitlement authority, remote storage, and publisher/reviewer services remain BLOCKED.
- P8 verification gates (2026-09-09): bun run test:contract exited 0 with 1 file / 4 tests; bun run test:integration exited 0 with 30 files passed and 1 skipped, 105 tests passed and 3 skipped; package-manager integration suite exited 0 with 9 files / 15 tests. Prettier check remains non-zero on the dirty canonical WebUI/plan files and is not promoted as release-clean formatting evidence.
- P8 package lifecycle recovery gate (2026-09-09): targeted package-manager restart/update/rollback/revocation recovery plus catalog publication/review/payment-admission integration tests passed 12 files / 27 tests, exit 0. Evidence remains local/component scope and does not prove deployed Store, payment, payout, or signing authorities.
- P8 commerce safety inventory (2026-09-09): money-path regression, local commerce ledger, and payment-trust separation tests passed 3 files / 8 tests, exit 0. Current code intentionally keeps paid offers display-only without checkout/webhook authority; this preserves fail-closed behavior while production payment/refund remains BLOCKED.

| Done | Atom  | Required outcome                                                                    | Current evidence state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ----- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ ]  | C0-01 | Inventories and corpora are deterministic at one revision.                          | PARTIAL - a strict candidate receipt claim deterministically binds source revision, candidate artifact/rollback identity, all three held-out corpus digests, and report digest. The Main-owned candidate evaluation-publication boundary rejects missing, malformed, unverifiable, or rejected receipt/report pairs with stable non-promotable codes and carries a verified receipt as evidence without enabling promotion. No clean committed candidate, production release-key receipt, or external release attestation exists. |
| [ ]  | C0-02 | No unknown IPC, egress, money path, Surface owner, or optional base import remains. | PARTIAL - static Main-to-preload IPC sends are matched to listeners; egress, money, Surface-owner, optional-base, and candidate coverage remain incomplete.                                                                                                                                                                                                                                                                                                                                                                       |
| [ ]  | C0-03 | Baseline failures are reproducible and named.                                       | PARTIAL - malformed metrics now produce a stable named failure and same-revision output; baseline is not frozen against a clean candidate.                                                                                                                                                                                                                                                                                                                                                                                        |

C0 completion: **0/3 = 0.0%**.

#### C1 - Store contract and identity lock

| Done | Atom  | Required outcome                                                                                       | Current evidence state                                                                                                                                                                                                                |
| ---- | ----- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [x]  | C1-01 | Strict parsing rejects every named malformed, unsafe, duplicate, oversized, and floating-money case.   | CURRENT component - 35-test strict parser matrix covers every named C1-01 rejection.                                                                                                                                                  |
| [x]  | C1-02 | One Package App cannot register two Surface identities.                                                | CURRENT component - exact-one-Surface submission validation reconfirmed by the snapshot command.                                                                                                                                      |
| [ ]  | C1-03 | Installation cannot imply AI access.                                                                   | LOCAL/PARTIAL - separate declarations/consent paths exist and dispatch rechecks consent after async Trust preflight; universal production proof is incomplete.                                                                        |
| [ ]  | C1-04 | Policy only narrows consent; material changes force re-consent and revocation cancels work and leases. | PARTIAL - local Surface consent binds a Main-owned policy revision and rechecks it after async waits before callback dispatch; legacy records fail closed, while catalog, other routes, and packaged/release proof remain incomplete. |
| [ ]  | C1-05 | Payment cannot raise trust or weaken review.                                                           | PARTIAL - paid downloads require review evidence bound to the exact artifact and commercial admission; authoritative reviewer/catalog and checkout proof are absent.                                                                  |
| [ ]  | C1-06 | Core contracts import no optional implementation.                                                      | PARTIAL - dirty-snapshot release graph audit is clean (11/11); immutable candidate and clean-machine proof required.                                                                                                                  |

C1 completion: **2/6 = 33.3%**.

#### C2 - Complete Store before AI Surface wiring

| Done | Atom  | Required outcome                                                                                                                       | Current evidence state                                                                                                                                                                                                                                                                                                |
| ---- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ ]  | C2-01 | A clean-base user completes signed pilot search, install, open, update, disable, enable, rollback, and remove without rebuilding base. | PARTIAL - lifecycle rejects a missing downloaded payload and quarantines it. A release-owned harness now requires an immutable plan, exact SHA-256, external signature verifier, isolated profile, lifecycle verifier, and durable receipt; no signed pilot or independent clean-machine execution has been supplied. |
| [ ]  | C2-02 | Low-risk submission passes review/publication while malicious, malformed, privileged-unreviewed, and revoked fixtures fail closed.     | LOCAL/PARTIAL - deterministic intake recomputes/rejects forged reviewer dispositions; deployed reviewer/publication authority is missing.                                                                                                                                                                             |
| [x]  | C2-03 | Installed matching results are deterministically first.                                                                                | CURRENT - production resolver/display behavior and stable ordering tests passed.                                                                                                                                                                                                                                      |
| [ ]  | C2-04 | Restart at every mutation boundary produces one correct state and no orphan.                                                           | PARTIAL - selected mutation recovery includes a force-terminated child process after verified payload transfer and before durable commit; stale staged, trashed, downloaded, and unregistered payloads are removed. The remaining physical crash/runtime/clean-machine matrix is open.                                |
| [ ]  | C2-05 | Paid purchase through refund occurs exactly once.                                                                                      | BLOCKED - price is display-only and no production checkout/provider webhook exists.                                                                                                                                                                                                                                   |
| [x]  | C2-06 | Until C4 passes, one owned switch disables every production AI-to-Surface path with no bypass.                                         | CURRENT component - one Main-owned unpackaged-dev switch, exact source inventory, packaged UI, and broker checks pass.                                                                                                                                                                                                |

C2 completion: **2/6 = 33.3%**.

#### C3 - Three cores converge

| Done | Atom  | Required outcome                                                                                                                                               | Current evidence state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ ]  | C3-01 | Every enabled target and side effect uses one Run Kernel and TrustBroker.                                                                                      | PARTIAL - Foundation, C4, Direct CLI, Automation, Goal Capability derivation, and News manual/background operations use the shared Main runtime. The new Main-only workspace-write contract has final exact-grant inspection, bounded commit evidence, and cancellation-safe receipt semantics; its Rust sidecar endpoint currently rejects all writes without advertising a capability until a Windows handle-relative reparse-safe atomic writer is composed. The renderer gateway, ZIP, IDE, Studio, Browser-Control, and Core Workspace write/edit/command effects remain fail-closed. RTK/ExpBase embedding remains deterministic local hashing pending a shared Trust transport and receipt seam. |
| [ ]  | C3-02 | No raw secret reaches renderer, prompt, log, snapshot, receipt, or dataset.                                                                                    | PARTIAL - RunKernel blocks detected secret-bearing governed goals before context projection or target execution, strips executor evidence, and the Foundation bridge redacts Core text/errors before renderer; scanner coverage and other routes remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [ ]  | C3-03 | Correction, deletion, or consent withdrawal propagates through every named projection, index, cache, job, artifact, and backup without permission drift.       | LOCAL/PARTIAL - causal controls pass focused tests; production-wide propagation is incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [ ]  | C3-04 | Pre-withdrawal candidate artifacts follow quarantine, retrain, or no-future-use policy.                                                                        | PARTIAL - Main withdrawal authority blocks future promotion and monotonically escalates to no-future-use; durable ledger, restart, release-key, and offline retrain proof are missing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [ ]  | C3-05 | Security, User Intelligence, and Orchestration emit complete candidate reports and pass frozen floors without missing denominators or unexplained regressions. | PARTIAL - aggregate reports reject malformed comparators and missing provenance; frozen cross-revision baselines and promotion-quality reports are incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [ ]  | C3-06 | Local execution never silently falls back to cloud.                                                                                                            | LOCAL CURRENT - conformance fixture passes; release-target coverage is not complete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [ ]  | C3-07 | Orchestrator keeps Store search, installation, purchase, and AI access as distinct actions.                                                                    | LOCAL CURRENT - resolver/planner contracts pass; production journey remains incomplete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

C3 completion: **0/7 = 0.0%**.

#### C4 - Connect AI to reviewed Surfaces

| Done | Atom  | Required outcome                                                                                                          | Current evidence state                                                                                                                                        |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [x]  | C4-01 | An eligible installed matching Surface wins.                                                                              | CURRENT component - production planner and ordering tests passed.                                                                                             |
| [ ]  | C4-02 | An alternative Surface wins when IDE is not the best capability match.                                                    | PARTIAL - planner can compare candidates; complete production journey is disabled.                                                                            |
| [ ]  | C4-03 | Denied installation leaves no artifact or registry state.                                                                 | PARTIAL - post-staging transfer failures now clean package, registry, staging, trash, and download residue; full journey and clean-machine proof are missing. |
| [ ]  | C4-04 | Denied AI access leaves the installed app usable by the person but inaccessible to AI.                                    | PARTIAL - Main broker and renderer component paths pass; packaged end-to-end journey proof is incomplete.                                                     |
| [ ]  | C4-05 | Revoked consent stops new operations and cancels active leases.                                                           | LOCAL CURRENT - integration journey and receipt-recovery revocation race tests pass; no production-signed pilot candidate.                                    |
| [ ]  | C4-06 | Every material identity, operation, placement, capability, secret, data, destination, or expiry change forces re-consent. | PARTIAL - broker rechecks material operation and Store admission after async preflight and receipt recovery; packaged/release journey proof is missing.       |
| [ ]  | C4-07 | No direct model-to-renderer, model-to-package, or package-to-package implementation import exists.                        | BLOCKED - optional ownership residue and production-bypass inventory remain.                                                                                  |
| [ ]  | C4-08 | The entire journey restarts without duplicate install, effect, or receipt.                                                | LOCAL/PARTIAL - durable local broker replay returns matching terminal receipt pairs without a second package invocation; production journey is disabled.      |

C4 completion: **1/8 = 12.5%**.

#### C5 - Local/cloud hybrid, default IDE surface, and clean base

| Done | Atom  | Required outcome                                                                                    | Current evidence state                                                                                                                                                                                                                                                                          |
| ---- | ----- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ ]  | C5-01 | Zero core-to-optional implementation imports and zero optional implementation in the base artifact. | PARTIAL - the 2026-09-06 dirty snapshot builds without IDE, Design or Document implementation in the base graphs; relocated roots are audited. Legacy optional consumers remain outside that closure, so this is not a universal source-boundary claim.                                         |
| [ ]  | C5-02 | Base starts no optional route, service, process, scheduled job, host, or database.                  | PARTIAL - lazy Design activation passes. The release verifier requires `Tomny.exe`, valid Authenticode, an isolated profile, and a Main renderer-loaded receipt; no externally signed base artifact or executed clean-machine run is available.                                                 |
| [ ]  | C5-03 | IDE base-surface navigation and AI-access journey pass without a Store lifecycle.                   | PARTIAL local / BLOCKED release - IDE is a default Core surface. Its base navigation, native runtime, and AI journey require clean-machine release proof; current Design and Document artifacts are refreshed and signed, but external publication and packaged lifecycle evidence remain open. |
| [ ]  | C5-04 | A cloud Surface produces the required product without local executable installation.                | PARTIAL - descriptor and planning seams exist; no reachable remote session/presentation path.                                                                                                                                                                                                   |
| [ ]  | C5-05 | A hybrid task has one parent receipt and linked child evidence.                                     | PARTIAL - RunKernel restart replay now returns a validated durable parent/child pair without a second child execution; no reachable hybrid journey.                                                                                                                                             |
| [ ]  | C5-06 | Uninstall or revoke leaves no route, process, lease, secret, or undeclared data.                    | PARTIAL - revocation waits for a registered persistent runtime/artifact lease to quiesce before quarantine; full optional matrix is incomplete.                                                                                                                                                 |

C5 completion: **0/6 = 0%**. The earlier graph-only check is retained as component evidence, not proof of universal source ownership.

#### C6A - Core plus Store release

| Done | Atom   | Required outcome                                                                                                                 | Current evidence state                                    |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [ ]  | C6A-01 | Every Core plus Store acceptance journey passes at one revision.                                                                 | BLOCKED - C0-C5 are incomplete.                           |
| [ ]  | C6A-02 | Applicable lint, format, type, unit, contract, integration, and end-to-end commands exit zero.                                   | BLOCKED - no clean full gate at this snapshot.            |
| [ ]  | C6A-03 | Every enabled preload/IPC, egress, Store mutation, and AI-Surface operation is inventoried and enforced.                         | BLOCKED - universal inventory is incomplete.              |
| [ ]  | C6A-04 | One authoritative owner exists for Run, Trust, Context, Store ledger, Package Supervisor, and resources.                         | PARTIAL - duplicate/legacy paths remain.                  |
| [ ]  | C6A-05 | All three core benchmarks meet frozen safety and outcome floors.                                                                 | BLOCKED - complete promotion-quality reports are missing. |
| [ ]  | C6A-06 | No known P0 security, privacy, data-loss, duplicate-effect, Store, payment, package-isolation, or Surface-control issue remains. | BLOCKED - named P0 gaps remain.                           |
| [ ]  | C6A-07 | Canonical documentation matches the signed candidate.                                                                            | BLOCKED - there is no signed candidate.                   |

C6A completion: **0/7 = 0.0%**.

#### C6B - Full managed usage

| Done | Atom   | Required outcome                                                                                                                    | Current evidence state                                                           |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [ ]  | C6B-01 | Credit, rate-card, quote, expiry, maximum-charge, reservation, settlement, refund/release, and reconciliation contracts are frozen. | PARTIAL - local contract seams exist; authoritative production freeze is absent. |
| [ ]  | C6B-02 | One payment mint and one managed-AI usage meter are connected.                                                                      | BLOCKED - production services are absent.                                        |
| [ ]  | C6B-03 | One General on-demand cloud class proves sandbox, metering, cleanup, and orphan recovery.                                           | TARGET - no production provisioner.                                              |
| [ ]  | C6B-04 | Reservation occurs before every billable model call or provider resource creation.                                                  | PARTIAL - fail-closed design exists; no full managed journey.                    |
| [ ]  | C6B-05 | Provider invoice, ledger, usage, and Run receipt reconcile within frozen tolerance.                                                 | TARGET - no authoritative production reconciliation.                             |

C6B completion: **0/5 = 0.0%**.

At this snapshot, **Core plus Store readiness is 0.0%** because at least one critical checkpoint is 0.0%; the individual checkpoint values above, not an average, explain where implementation evidence exists. **Full managed-usage readiness is 0.0%** and its switches remain disabled. Completion of the complete C0-C6 master plan means C0-C6A and C6B all reach 100 percent at one compatible release evidence set.

### 8.3 Product progress source contract

The product progress UI must consume one Integrator-produced, read-only acceptance snapshot. It must not infer progress from tasks, test count, training steps, process activity, or hard-coded presentation values.

| Field                            | Meaning                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Snapshot revision and dirty flag | Exact source identity; a dirty snapshot cannot be presented as a signed candidate. |
| Generated and evidence times     | When the snapshot and latest evidence were produced.                               |
| Checkpoint and atom ID           | Stable `C0-01` through `C6B-05` identity.                                          |
| Required and checked             | Denominator and production-passing numerator.                                      |
| Status and reachability          | CURRENT, PARTIAL, TARGET, or BLOCKED plus PROD, LOCAL, DEV, DISABLED, or NONE.     |
| Command and exit code            | Latest applicable verification, or explicitly missing.                             |
| Evidence artifact                | Current-revision receipt, report, signed artifact, or named test evidence.         |
| Switch and owner                 | Enabled/disabled state and the single responsible owner.                           |
| Blocker and next atom            | Named cause and the next acceptance-sized outcome; never a vague percent forecast. |

The Hub design displays a checkpoint summary and expandable atom checklist. LOCAL or DEV evidence may be shown as useful progress, but it remains unchecked in the production column. When no compatible snapshot exists, the correct UI is “Progress evidence unavailable,” not a fabricated percentage.

### 8.4 Release-artifact and signing handoff

**Purpose:** close the C0 stale-artifact stop condition and the C5 physical package-boundary proof without weakening production signing. A current source closure is not evidence for an older signed artifact, and a development signature is not an acceptable substitute for a production signature.

The release owner creates one candidate handoff record before requesting a production signature. It contains the immutable source revision, clean-worktree result, release version, generated inventory and corpus hashes, full package and base build inputs, expected artifact names and SHA-256 values, required atom IDs, exact verification commands, exit codes, machine/OS identity, timestamps, and the named builder, signer, and independent verifier. The record references opaque key identifiers only; it never contains private-key material, access tokens, or secrets.

- **Builder:** has candidate source and a non-production build environment. The builder produces reproducible unsigned or development artifacts and closure reports, but cannot check a production atom or access production signing material.
- **Release signer:** works in an isolated production-signing environment. The signer may sign only the reviewed immutable hash manifest with the anchored key, and cannot alter source, build inputs, catalog facts, or verification results.
- **Independent verifier:** uses a fresh verification environment and public trust anchors. The verifier independently rebuilds or checks artifact, graph, lifecycle, and receipt evidence, and cannot reuse builder output as proof without validation.

The required handoff sequence is:

1. Freeze a clean, committed candidate revision and record the exact base/package/catalog inputs. A dirty worktree, uncommitted artifact, or floating dependency version is a failed handoff, not a candidate.
2. Build every required Package App in a disposable non-production location. Verify deterministic source closures, including that the Design artifact has no `pages/studio/ide` input and the base graph has no optional implementation input.
3. Run the C0 inventory/corpus gate and the complete clean-base artifact gate against that exact revision. Any unowned IPC, egress, money path, Surface owner, optional import, stale artifact, or failing baseline stops the handoff.
4. The release signer validates the submitted immutable hash manifest, key identifier, release version, and approved catalog facts, then produces only the designated production artifacts in the isolated signing environment. The signer returns signed artifact hashes and public verification metadata, never key material.
5. The independent verifier checks catalog-to-manifest equality, signature chain, integrity, package source closure, base graph/chunk/ASAR/resource/source-map/translation/binary/database absence, and the expected release version from freshly acquired artifacts.
6. A clean supported machine performs search, install, open, update, disable, enable, rollback, revoke, uninstall, restart recovery, and AI-access lifecycle checks. It also starts the base with no optional Package App installed and records the absence of optional routes, services, processes, leases, secrets, and undeclared data.
7. Attach the signed artifact inventory, verification logs, clean-machine receipts, and immutable source revision to the acceptance snapshot. Only then may C0-01/C0-03, C1-06, C5-01/C5-02/C5-03/C5-06, and dependent C6A atoms be reassessed.

The handoff is rejected if a production artifact is older than the candidate source closure, any artifact hash differs from the signed manifest, a development key signs a production catalog, the key anchor differs, the source closure or base artifact includes optional implementation, or the evidence is from a different revision. Rejection keeps the relevant atom **BLOCKED**; it never changes an atom to CURRENT merely because a local build or test passed.

## 9. Post-MVP expansion

After the relevant C6 gate passes:

1. package Browser, Office, Studio-related, Music, MakeVideo, Terminal, Testing, Monitor, media/design, and other optional apps as independent Package App/Surface identities;
2. publish Package App, Surface AI-access, workflow, Super Package, theme, and provider SDKs with conformance suites;
3. add the drag-and-drop workflow/Super Package builder and private optimization tooling;
4. open public seller checkout/payout only after Merchant-of-Record, tax, KYC/sanctions, refund, chargeback, reserve, and negative-balance gates;
5. activate shared warm cloud hosts or committed capacity only after measured economics and cross-tenant isolation proof;
6. add opt-in learned quality/cost/latency routing only after causal controls and versioned evaluations prove improvement;
7. claim additional platforms only after platform-specific isolation, secret storage, updater, Store, package, and clean-machine evidence passes.
