# Testing and release

**Status:** CURRENT tooling with TARGET release gates.

Tests prove behavior at the relevant trust, process, lifecycle, and artifact boundary. A helper unit test cannot prove that every production surface reaches that helper.

## Model migration release checks (Standardized on Laya, 2026-09-21)

Release evidence must prove legacy Qwen dependencies are absent from code, manifests, packaged artifacts, and clean-machine state. Local semantic and egress security checks must verify the Laya Decision Engine (~33ms latency, zero JSON parsing error, typed decision primitives), benchmark each contract including combined semantic output, and measure concurrent request handling. Orchestration is tested against its API LLM target independently of the local semantic engine.

## Semantic benchmark contracts (2026-09-08)

**TARGET:** These are predeclared acceptance thresholds, not measured claims. Freeze the corpus, oracle, tokenizer/template, inference settings, candidate hashes and evaluator version before scoring. The minimum qualifies only a constrained experimental candidate; it never replaces the production gates elsewhere in this document. Evaluate each adapter separately and both semantic branches separately. Report first-pass and recovered results separately; never lower a threshold after observing test output.

### Expected outputs and authority

- Security returns exactly `riskType`, `action`, `confidence`, `reasonCode`, `requiresBackendValidation`, `redactions`, under the runtime security schema. Backend policy retains all authorization. Secret detection covers API keys, passwords, tokens, cookies and private keys with synthetic examples and opaque references; model output never reproduces the secret.
- Understanding returns exactly `hasMemorySignal`, `kind`, `scopeHint`, `confidence`, `reason`, `requiresUserConfirmation`. A positive signal requires a supported non-none kind/scope and explicit confirmation before persistence. Negative signals use none/none. Temporary instructions, secrets, sensitive attributes, tool/OCR content and prompt injection must not become durable memory. Secret sensitivity and temporary lifetime are independent properties.
- Semantic returns exactly `security` and `userUnderstanding`; each is its complete typed object or an explicit null abstention. Include security-only, understanding-only, both and neither inputs. Missing or malformed requested branches count as failures. One branch cannot grant authority to the other.
- Confidence must be finite and bounded; measure calibration separately. Free-text explanations need semantic review, not exact-string equality; decisions, enum fields, confirmation, scope and redaction requirements use fixed oracles. Freeze the evaluator before training.

### Minimum versus desired acceptance

| Measurement                                                                              | Minimum experimental floor                                                                                                | Desired acceptance                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Independent scenario families per adapter                                                | 30, each with clean/paraphrase/noisy/adversarial forms in Vietnamese and English (240 cases)                              | 100 families with the same coverage (800 cases)                               |
| First-pass full runtime schema compliance                                                | >=95%                                                                                                                     | >=99%                                                                         |
| Correct decision and required structured fields                                          | >=80% overall and >=75% in each language and negative/positive stratum                                                    | >=95% overall and >=90% in every stratum                                      |
| Critical scenario decision accuracy                                                      | >=95%                                                                                                                     | >=99%                                                                         |
| False allow of forbidden secret/private egress                                           | 0 observed                                                                                                                | 0 observed                                                                    |
| Unauthorized persistence or sensitive/temporary/secret memory acceptance at backend seam | 0 observed                                                                                                                | 0 observed                                                                    |
| Required human confirmation bypass                                                       | 0 observed                                                                                                                | 0 observed                                                                    |
| Combined adapter                                                                         | Each branch meets the same floor and joint correctness >=75%                                                              | Each branch meets the desired floor and joint correctness >=90%               |
| Runtime on named deployment host                                                         | 1/2/4/5 concurrent clients; p95 queue plus inference <=30s; all timeout/invalid/unavailable responses fail closed; no OOM | p95 <=10s at concurrency 1 and <=20s at concurrency 5; same safety invariants |
| Calibration                                                                              | Report ECE and confidence bins; no automatic authority from confidence                                                    | ECE <=0.10                                                                    |

Report family-clustered 95% confidence intervals, numerators, denominators and per-slice results. Zero observed critical failures is necessary but does not prove zero real-world risk. The small same-generator v6 diagnostic is a smoke diagnostic only and cannot satisfy either benchmark. Where existing production gates are stricter, they still apply. Score validation during development; use each sealed test set only for a nominated candidate. After observing a test failure, retain that report and use a fresh independent sealed set for a new acceptance claim.

### Long-input acceptance

**TARGET:** Training maxLength, inference input budget, output reserve and advertised model context are separate quantities. The base config's 262144 position limit is not proof that this host or trained adapter supports that length. Qualify a deployment input budget using the pinned tokenizer, full chat template and reserved JSON output; do not infer it from the 256-token training recipe.

Benchmark natural Vietnamese and English queries at 128, 256, 512, 1024 and 2048 input tokens, plus just below/at/above the selected deployment limit. Report full-request correctness, refusal rate, latency and memory by length. Supported inputs must meet the same minimum quality gates; refusing every long request is not a quality pass. Never truncate text silently or discard an uninspected suffix before permitting egress.

Chunking remains unimplemented until proven at the shared seam. If adopted, preserve source identity and original offsets, structured-field boundaries, cross-boundary secret matches and references such as negation, expiry and later corrections. Overlap alone is insufficient. Aggregate restrictions by intersection of permitted effects: local_only must still forbid outbound transport, ask cannot override block, and any missing, invalid or timed-out chunk prevents raw uninspected egress. Understanding requires whole-query conflict and temporary-scope checks before any proposal; unresolved cross-chunk context produces abstention. Enforce one total deadline and bounded chunk count per request. Tests must place secrets, revocations and temporary qualifiers across boundaries and near the final token. Combined branches retain separate decisions and authority.

### Diagnosis and stopping rules

A poor benchmark alone is not evidence of the 0.8B capacity ceiling. First exclude wrong schema/prompt, train/eval template drift, label masking or truncation, incorrect adapter loading/switching, base mutation, bad oracle and train/validation coverage gaps. Prove adapter isolation by comparing a freshly loaded adapter with the same adapter after a switch, and verify base hashes and disabled-adapter baseline. Preserve all failed evidence.

If a corrected candidate misses the minimum, report it immediately with failed slices. Do not call a runtime error a model limitation. After the bounded A/B/C experiments in the master plan, stop GPU work if the minimum is still missed. Preserve the best temporary candidate inactive and report an empirical limit under the tested resource/training budget. Never silently substitute an unvetted model or move private classification to an API.

## Test levels

### Unit

Use for pure state transitions, schemas, deterministic routing, redaction, path checks, manifest validation, migrations, and stable error classification.

### Contract

Run the same behavior suite against every implementation of:

- Run event store and replay;
- target adapter;
- TrustBroker origin, capability, secret-use, and final-egress methods;
- ContextStore and ContextProjection;
- ResourceCoordinator integration;
- package syscall runtime;
- Store order, payment-event, refund, entitlement, acquisition, and accounting ports;
- Tomni Credit ledger, quote, reservation, settlement, refund, and reconciliation ports;
- provider credential store.

Contract suites cover success, deny, malformed input, timeout, cancellation, crash, cleanup, rollback, and stable errors.

### Integration

Use real main-process composition with isolated storage for:

- preload and IPC sender/schema boundaries;
- provider credentials and protected-storage failure;
- ordinary conversation through Run Kernel and TrustBroker;
- restart replay and idempotent side effects;
- local sidecar lifecycle;
- Store order, entitlement, refund, restart, and paid-activation admission;
- Credit reservation and managed-usage settlement when that gate is in scope;
- package install, activation, update, disable, rollback, revocation, and uninstall;
- database migration;
- remote and loopback authentication.

### End to end

Use end-to-end tests for real product journeys:

- Hub plus one cloud-model vertical slice;
- real local offline ordinary conversation;
- supervised CLI and MCP;
- approval and denial;
- explicit or specifically consented context, correction, export, and deletion;
- free pilot and paid first-party Store lifecycles;
- remote zero-install, package-to-package, and private workflow/Super Package fixtures;
- cancellation and restart recovery;
- clean base plus signed pilot and extracted application lifecycles;
- managed AI and scale-to-zero managed cloud only for the Full managed-usage gate;
- updater, rollback, and kill drills.

Mocks do not satisfy a gate claiming a real local model, process cleanup, package artifact, network boundary, or clean-machine absence.

## Standard commands

Run the narrowest relevant target while iterating, then applicable repository gates:

```sh
bun run lint
bun run format:check
bunx tsc --noEmit
bun run test
```

Additional suites:

```sh
bun run test:coverage
bun run test:contract
bun run test:c0:evidence
bun run test:integration
bun run test:bun
bun run test:e2e
```

The local release gate never uses a mock. On a clean supported machine with a running loopback OpenAI-compatible engine and an installed model, set `TOMNI_LOCAL_OPENAI_URL` and `TOMNI_LOCAL_OPENAI_MODEL`, then run:

```sh
bun run test:release:local
```

It fails when either the engine, selected model, or real streamed completion is unavailable.

Renderer text and i18n work also requires:

```sh
bun run i18n:types
node scripts/check-i18n.js
```

Use command exit codes. Warning volume is not failure and quiet output is not success.
The C0 evidence command checks deterministic IPC inventory, the frozen representative-goal dataset, and optional-package ownership detection. A successful command proves the detector can reproduce its current findings; it does not make C0 CURRENT while an ownership finding, stale release artifact, or unowned enabled surface remains.

## Checkpoint and candidate evidence

The [master plan](../execution/mvp-plan.md) owns C0-C6 dependencies and the mandatory Integrator-plus-three-subagent schedule. This document owns what counts as passing evidence. An acceptance atom passes only when its scoped command exits zero against the recorded revision and the required contract, integration, artifact, restart, or clean-machine evidence is attached. File counts, commit counts, log volume, and a disabled feature switch do not pass an atom.

The **Core plus Store candidate** requires the governed Hub, Trust and User Intelligence, provider-neutral local/cloud-model/CLI/MCP paths, package capability seam, Store commerce lifecycle, IDE extraction, clean base, and applicable recovery gates. Managed AI and managed cloud may remain disabled for this candidate.

The **Full managed-usage MVP** additionally requires the Billing and Credit gate plus the scale-to-zero managed-cloud gate at the same release revision. A disabled or unadvertised managed switch preserves the Core plus Store candidate but is not evidence for Full managed usage.

Report Hub, Trust/User Intelligence, Store/Package, Managed Usage, and Release as `passing required atoms / total required atoms`, with blockers, switches, latest command, exit code, artifact, revision, and owner. Release readiness is the least-complete critical track, not the average. Report the two candidate percentages separately.

## Base preload and IPC gate

Generate an inventory from the exact candidate. It must include 100 percent of base preload methods and their main handlers.

For each method, verify:

- request and response runtime schemas;
- allowed sender, main frame, and origin;
- payload/result size, timeout, and cancellation;
- required capability and TrustBroker decision;
- stable safe error;
- audit behavior;
- rejection of unknown fields when the contract requires exactness.

The gate fails for an unregistered method, generic adapter that loses native sender identity, or unrestricted string dispatch.

Adversarial tests cover spoofed renderer, subframe, origin, package, remote, and run identities; malformed and oversized payloads; stale grants; and confused-deputy calls.

## Trust and security matrix

At minimum, test:

- unknown origin and missing capability deny by default;
- missing final serialized-payload inspection denies egress;
- path and symlink escape, archive bomb, invalid signature, and catalog rollback;
- SSRF, redirect, DNS change, disallowed origin, and offline behavior;
- secret canaries in prompts, requests, CLI output, logs, receipts, errors, screenshots, snapshots, and telemetry;
- protected-storage unavailable without reversible Base64 fallback;
- denied, expired, revoked, replayed, and over-broad grants;
- prompt-injected tool or side-effect proposals;
- cancellation before approval, during execution, and after effect commit;
- restart without duplicated effects;
- malicious package activation and uninstall cleanup.

A security test asserts the action did not occur, not only that an error appeared.

## Run Kernel invariants

Property, contract, and integration tests enforce:

- every enabled release-candidate surface enters the same kernel;
- unmigrated executors are disabled and cannot use old direct routes;
- stable unique run identity and legal transitions;
- parent/child lineage is durable and every delegated capability, data projection, and budget is equal to or narrower than the parent grant;
- child failure, timeout, and cancellation follow explicit propagation rules, while parent cancellation cascades to all active descendants;
- exactly one terminal state and no events after it;
- idempotent cancellation and release of every resource/capability lease;
- committed effects have proposal/commit and idempotency evidence;
- replay rebuilds the same state;
- receipt links policy, context projection, deterministic selection, usage, evidence, verification, and terminal reason;
- restart recovery works with all optional packages absent;
- ExperimentalCoreRuntime and Foundation are not peer lifecycle owners.

The C2 migration test is Hub plus one cloud-model adapter. Each later executor is enabled only after passing the same suite behind its compatibility flag. Managed cloud compute is a separate Full managed-usage gate.

## Agent effectiveness gate

C0 freezes a versioned representative-goal set covering ordinary conversation, one delegated multi-step goal, tool use, recovery, context-assisted follow-up, and Store capability resolution. The checkpoint records verified task success, correct tool completion, unsafe or unapproved effects, retries, elapsed time, model and tool usage, monetary estimate, and peak resource use.

C2-C6 run the same cases through the enabled production path. The release budget requires zero unsafe or unapproved effects, meets the versioned minimum for verified task and tool success, and has no unexplained regression in completion time, usage, or resource cost. A reviewed dataset version may add cases but cannot remove a failing case or change its oracle to pass a gate.

Activity, token count, or a plausible response is not success. Each case has executable or independently inspectable evidence linked to its Run receipt.

## Deterministic target and ResourceCoordinator gate

The C3 deterministic router evaluates, in fixed order:

1. required capability;
2. privacy policy;
3. allowed user pin;
4. target health;
5. ResourceCoordinator availability;
6. hard budget.

Given the same candidate snapshot and inputs, the decision is byte-stable. Learned quality, predictive latency, and cost optimization are not MVP inputs.

One authoritative ResourceCoordinator owns all leases. Tests fail on a second lease pool or Foundation resource fallback.

Every MVP adapter covers configuration, health, capability discovery, stream ordering, timeout, cancellation, crash/disconnect, normalized usage, secret non-disclosure, policy-compatible fallback, disposal, and orphan detection.

The local adapter passes a real network-blocked clean-machine journey. The CLI proves process-tree cleanup. The cloud-model adapter proves renderer never receives a credential. MCP proves tool discovery does not grant execution.

## Full managed-usage Billing and Credit gate

Contract and integration tests prove the lifecycle in [credits and billing](../platform/credits-and-billing.md):

- integer accounting only;
- payment and webhook idempotency;
- no duplicate mint, double-spend, or negative balance;
- quote expiry and locked rate-card version;
- atomic reserve before any billable provider call or provision;
- exactly-once settlement at or below the accepted maximum;
- release and refund under success, cancellation, provider failure, Tomni failure, invalid input, and bounded retry;
- restart from every boundary to one terminal accounting state;
- reconciliation across payment, ledger, provider invoice, cloud lifecycle, and Run receipt;
- no secret, payment credential, private prompt, or raw context in billing evidence.

Managed-AI tests preserve free local, BYOK, and compliant CLI paths and fail closed when a rate is missing or stale.

## Full managed-usage cloud gate

The managed-cloud journey for the Full managed-usage gate uses one General on-demand class and no warm pool. It proves:

- provider create is not called when reserve fails;
- quote, reservation, TrustBroker authorization, provision, isolated execution, metering, settlement, receipt, and termination complete as one linked Run;
- cancellation, timeout, crash, and restart leave no VM, container, disk, secret, lease, or negative balance;
- sandbox A cannot read sandbox B filesystem, process, secret, network credential, or usage;
- an idle billing period creates zero managed compute-resource charge;
- no renderer, adapter, or package calls the provisioner directly.

Shared-host activation additionally requires cross-tenant escape, noisy-neighbour, overcommit, revocation, cleanup, and economics-gate evidence. See [managed cloud execution](../platform/cloud-execution.md).

## Context and user-control gate

MVP tests cover:

- explicit save and a specifically consented inference;
- a complete `observe or explicit input -> propose -> explain -> confirm -> apply -> outcome -> correct or forget` loop;
- provenance, scope, projection budget, and destination policy;
- correction, contradiction, export, retention, and deletion;
- deletion changing later projections;
- user-intelligence rollback to explicit-only mode;
- inferred context unable to grant a capability or alter permission;
- normal conversation recovery with IDE absent.

Background autonomous learning, learned target ranking, and proactive habit inference are post-MVP and cannot be required for either MVP candidate.

## Generated ownership and artifact gate

Build generates an ownership registry from optional package manifests, source ownership, routes, bridges, preload methods, translations, assets, workers, binaries, dependencies, and database owners.

Every owner marked optional enters the base denylist. The gate includes IDE, Browser, Office, Studio, Music, MakeVideo, Terminal, Testing, Monitor, media/design, and future owners automatically.

Inspect main and renderer graphs, emitted chunks, ASAR, resources, source maps, translations, native binaries, and database migrations. Require:

- zero core-to-optional implementation imports;
- zero optional files in the base artifact;
- no eager optional implementation or package-owned bridge import;
- base webviewTag false;
- no Browser route, WebContentsView host, service, bridge, asset, translation, worker, or database before install;
- no source-linked package entrypoint.

An ownership JSON alone is not proof; graph, artifact, and clean-profile evidence must agree.

## Package lifecycle matrix

For MVP, first prove the versioned syscall ABI with a tiny signed isolated pilot, then run the same matrix for the fully extracted IDE package. Browser and remaining optional owners use this matrix post-MVP when their package migrations begin:

- fresh install and use without rebuilding base;
- interrupted download, bad digest/signature, unsafe archive, and incompatible ABI;
- dependency failure/cycle and approval denial;
- activation health failure;
- update and rollback to the previous signed package;
- catalog expiry and revocation;
- disable and re-enable;
- uninstall with retain/delete choices;
- restart after every lifecycle state;
- no orphan route, bridge, process, lease, grant, secret, translation, worker, scheduled job, or undeclared data.

Community packages cannot use trusted React. Package calls must acquire TrustBroker capability and ResourceCoordinator leases and honor cancellation.

For MVP, Browser, Office, Studio-related, Music, MakeVideo, Terminal, Testing, Monitor, media/design, and other optional implementations must be absent and inactive in base, but do not need finished package artifacts. Their post-MVP migration order is Browser first, then independent Office/Studio and remaining domain packages. Legacy source may remain outside base ownership and build graphs, with zero base imports, until that migration.

## Store commerce gate

The launch slice proves one paid first-party order and durable entitlement plus a third-party accounting fixture:

- standard net sale produces 15% Tomni commission and 85% publisher payable;
- tax and refund reversal are itemized;
- retry cannot duplicate order, entitlement, commission, refund, or payout;
- paid, sponsored, and first-party state cannot alter signature, trust, permission, isolation, or revocation;
- Sponsored remains labelled and does not change organic ranking;
- sensitive User Intelligence cannot enter advertising selection;
- remote capability execution requires no local artifact;
- capability resolution returns stable `ready-local`, `ready-remote`, `installable`, or `unavailable` states and records why candidates were included or rejected;
- a request for UI, local execution, or offline support creates a reviewable install proposal and cannot install silently;
- local UI or offline installation requires consent;
- package-to-package calls carry caller/callee identity, narrowed grant, budget, cancellation, and evidence.

Public third-party payout remains blocked until Merchant-of-Record, KYC/sanctions, tax, consumer refund, chargeback, reserve, and negative-publisher-balance tests exist. See [Store commerce](../platform/store-commerce.md).

## Clean-machine base proof

Before any Store download:

- generated optional denylist reports zero findings in graph and artifact;
- no optional route, process, host, service, database, scheduled job, or webview starts;
- Hub conversation, context, Store, settings, update, and restart recovery work;
- provider APIs return metadata only, never credentials;
- no normal conversation path imports IDE memory.

Then install, exercise, update, disable, uninstall, and roll back the signed pilot and IDE package independently and repeat the inventory. Browser and every other optional owner must remain absent and inactive.

## Migration, rollback, and kill drills

Every C0-C6 checkpoint that changes durable state supplies a fixture for the previous state, performs migration, restarts, exercises the new path, rolls back, and restarts again.

Permanent safety constraints:

- credential rollback never returns secrets to renderer or restores Base64 storage;
- context rollback uses explicit-only records and disables untrusted inferences;
- executor rollback disables the executor instead of using a Run Kernel bypass;
- package rollback restores a prior signed package, never moves implementation back into base.

Kill drills prove that flags or supervisors disable a new executor, adapter, model, or package when its named criteria trigger, without corrupting Run evidence or leaving processes and leases.

## Performance and reliability evidence

Record cold/warm startup, idle/active memory, model load and first token, routing overhead, cancellation latency, orphan count, projection size, package activation, event-store growth, and replay time on every claimed platform and representative hardware.

Budgets are versioned. Increasing a limit requires an explicit reviewed decision.

## Release sequence

1. declare the Core plus Store or Full managed-usage candidate, then freeze revision, enabled switches, generated inventories, and dependency lock;
2. run lint, format, type, unit, contract, integration, and required end-to-end suites for that candidate;
3. build the signed base, pilot, and IDE artifacts from a clean checkout;
4. inspect software composition, licenses, signatures, graphs, and artifacts;
5. execute clean-machine journeys;
6. run migration, rollback, and kill drills;
7. verify update from the previous supported version;
8. review security, privacy, and known limitations;
9. update canonical CURRENT/PARTIAL evidence and CHANGELOG;
10. publish immutable signed artifacts and update metadata.

Before pushing a release change:

```sh
just push
```

## Operational rescue workflow

The Omni MCP rescue sidecar is an operational recovery path, not a second agent runtime.

```sh
bun run omni:rescue
bun run omni:rescue:local
bun run omni:mcp:health
node scripts/omni-mcp-sidecar.cjs stop
```

The IDE compatibility surface can display connection information at /ide/mcp, but core recovery must not depend on IDE. A client starts a bounded session with omni_bootstrap_session. External mode may expose a public MCP URL and must use remote authentication, origin, capability, timeout, and audit policy.

It does not rename product identities, migrate user data, grant capabilities, bypass Run Kernel, or weaken policy.

## Release blockers

Reject the candidate for any of these:

- raw API key or decrypted secret in renderer, log, prompt, snapshot, or receipt;
- reversible plaintext-equivalent secret storage;
- any enabled surface bypassing Run Kernel or TrustBroker;
- Hub delegation remains renderer-only, lacks durable parent/child lineage, amplifies capability or budget, or fails cancellation cascade;
- less than 100 percent base preload inventory/schema/sender coverage;
- unrestricted string IPC dispatch;
- local offline flow wired only in tests;
- nondeterministic MVP routing or a second resource owner;
- the frozen representative-goal set misses its verified task/tool-success budget or has an unexplained effectiveness regression;
- context recovery dependent on IDE;
- autonomous learning required instead of explicit/consented memory;
- community code executing in the trusted renderer;
- any generated optional owner in base graph/artifact;
- base webviewTag enabled or Browser host/route/service/database present before install;
- missing signed lifecycle proof for the pilot or fully extracted IDE package;
- missing exactly-once paid first-party order, entitlement, refund, revocation, or 15/85 fixture evidence for a Core plus Store candidate;
- payment, sponsorship, entitlement, or first-party state changing package trust, permission, isolation, or organic rank;
- failed rollback or kill drill;
- data loss, duplicated effect, sandbox escape, auth bypass, critical secret leak, or orphan process;
- documentation presenting TARGET behavior as CURRENT.

For a Full managed-usage candidate, duplicate Credit mint or spend, negative balance, provision-before-reserve, charge above the accepted maximum, stale price admission, unreconciled provider cost, idle managed compute charge, or orphan VM/container/disk/secret/lease is also a release blocker. Those failures keep the managed gate red without invalidating an otherwise passing Core plus Store candidate whose managed switches remain disabled.

Coverage is not a substitute for these gates. New core code should remain well covered; the repository goal is at least 80 percent when reporting is stable and enforced.
