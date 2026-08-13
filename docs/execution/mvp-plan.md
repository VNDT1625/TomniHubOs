# Autonomous multi-agent master plan

**Status:** TARGET master plan and execution order.
**Objective:** reach the smallest release candidate that proves the Hub Agent OS and Trust and User Intelligence cores. Local/cloud AI and package extraction are supporting platform slices; post-MVP expansion remains ordered but cannot delay the two-core release.

This is the only implementation plan. A wave completes only when its current-revision evidence passes. Later waves cannot redefine an earlier P0 contract without reopening that earlier gate.

## MVP definition

A clean base installation with no optional application package must let a user:

1. submit a goal through the Hub and receive a durable Run receipt;
2. complete one multi-step goal whose parent Run delegates at least one bounded child step, narrows its budget and capabilities, cascades cancellation, and aggregates verified evidence;
3. use one cloud adapter with a write-only credential and no secret in renderer memory;
4. install or select one local model and complete an ordinary conversation offline;
5. connect one supervised CLI and one MCP tool;
6. run local, cloud, CLI, and MCP through the same Run Kernel;
7. see deterministic target choice, context projection, permission decisions, resource use, evidence, verification, and terminal state;
8. cancel and restart without an orphan process or duplicated side effect;
9. complete one controlled user-intelligence loop from observation or explicit input through proposal, consent, use, outcome, correction or forgetting;
10. inspect provenance, projection use, export, and deletion for every saved or consented record;
11. install one tiny signed pilot package through an isolated capability ABI;
12. install, use, update, disable, uninstall, and roll back a fully extracted IDE package;
13. operate normal conversation and recover private context while every optional package is absent.

The base graph and artifact must contain no implementation owned by the generated optional-domain denylist. That list includes IDE, Browser, Office, Studio, Music, MakeVideo, Terminal, Testing, Monitor, media/design, and every future manifest marked optional; it is not a hardcoded four-app checklist.

## Critical path and parallel tracks

Wave numbers define gate families, not a requirement to leave independent agents idle. The dependency spine is:

```text
Wave 0 -> Wave 1 -> Wave 2A
                      |-> Wave 2B release-surface migrations --|
                      |-> Wave 3 Trust + User Intelligence -----|-> Wave 6
                      |-> Wave 4 local/cloud/CLI/MCP ------------|
                      |-> Wave 5A package ABI -> 5B -> 5C -> 5D-|
```

After Wave 2A passes, Waves 2B, 3, 4, and 5A may progress concurrently when the ownership matrix proves that they do not write the same contracts, bootstrap, IPC registry, or schema. Wave 5B additionally depends on the Wave 3 context/recovery boundary; 5C depends on 5A and 5B; 5D depends on the generated ownership inventory and 5C. Wave 6 starts only after every P0 branch converges at one revision.

The fastest-MVP scope guard is strict: one cloud adapter, one local-only loopback target backed by a user-run offline engine, one CLI, one MCP path, one signed pilot, and one extracted IDE are enough. The local target must fail closed when no loopback engine/model is available and must never fall back to cloud. Additional providers, legacy executors, autonomous learning, learned routing, Browser packaging, and optional-app polish are disabled or deferred instead of extending the critical path.

## Mandatory orchestration protocol

The lead agent is the **Integrator**. With four available slots, keep one slot for integration and use up to three subagents for non-overlapping work.

### Before every wave

The Integrator must:

1. map current code and tests with MTUI;
2. record failing acceptance checks;
3. identify shared contracts, bootstrap, preload/IPC, schemas, migrations, and generated files;
4. generate an ownership matrix with non-overlapping file or directory allowlists;
5. assign independent lanes to subagents;
6. retain shared files and final integration;
7. define migration, rollback, kill, and evidence criteria before implementation.

Each subagent task includes outcome, non-goals, file allowlist, forbidden shared files, required tests, expected handoff, and no commit unless explicitly delegated.

### Partition rules

Parallelize independent adapters, isolated security seams, contract test implementations, extraction inventories, package-owned modules, artifact scans, and migration fixtures.

Serialize Run, TrustBroker, capability, context, adapter, and package ABI changes; preload and bridge registration; app bootstrap; database schemas; generated types; base router; and package registry integration.

When two lanes need one shared file, subagents prepare isolated modules or evidence and the Integrator edits the shared file once.

### Automatic lane matrix

At the start of a wave, the Integrator instantiates these default lanes and may merge a lane when fewer slots are available. A lane is omitted only when its acceptance evidence is already CURRENT at the working revision.

| Gate        | Subagent A                     | Subagent B                  | Subagent C                                            | Integrator-only work                                            |
| ----------- | ------------------------------ | --------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| Wave 0      | runtime inventory              | trust/IPC inventory         | optional ownership and artifact inventory             | baselines, release-surface decision, generated-rule integration |
| Wave 1      | credential boundary            | IPC boundary                | durable Run store and replay fixtures                 | shared contracts, TrustBroker seam, bootstrap wiring            |
| Wave 2A     | real context/resource adapters | cloud adapter compatibility | recovery, cancellation, and characterization verifier | Run Kernel state machine and one-time integration               |
| Wave 2B     | first executor batch           | second executor batch       | delegation and bypass verifier                        | flags, shared registry, parent/child Run integration            |
| Wave 3      | TrustBroker policy breadth     | user-intelligence loop      | user controls and denial tests                        | receipt binding and shared context schema                       |
| Wave 4      | local offline target           | cloud plus supervised CLI   | MCP and common contract verifier                      | deterministic router and ResourceCoordinator integration        |
| Wave 5A     | syscall/runtime implementation | sandbox and lifecycle       | signed pilot and adversarial verifier                 | ABI version, package registry, bootstrap                        |
| Waves 5B-5C | neutral primitive extraction   | IDE-owned UI/artifact       | IDE services and lifecycle verifier                   | shared route/bridge/build integration                           |
| Wave 5D     | optional-owner removal batches | graph/artifact scanner      | clean-base journey verifier                           | shared router/bridge cleanup                                    |
| Wave 6      | adversarial security           | reliability and migration   | clean-machine journeys and fixed eval                 | release decision and evidence reconciliation                    |

For repeated executor or optional-owner batches, the Integrator assigns at most two implementation lanes and reserves the third lane for independent verification. A batch that requires a shared-contract change returns to serialized Integrator ownership before work continues.

### Handoff and failure

Each subagent returns changed files, behavior, tests and exit codes, acceptance evidence, unresolved risk, unrelated dirty files, and required integration work.

A failing gate keeps the wave open. After two attempts with the same hypothesis, remap the cause. Never weaken a signature, permission, secret, sandbox, schema, artifact-absence, or lifecycle test to pass.

## Gate discipline for every wave

Every wave records:

- **Migration:** old state, new state, compatibility flag or data transform, and the owner of each path.
- **Rollback:** exact safe return path and persisted-data compatibility.
- **Kill criteria:** measurable conditions that stop the rollout and disable the new path.
- **Evidence:** commands, revision, artifact, and test results.

Wave 0 also freezes the representative-goal evaluation set and baseline budgets for verified outcome success, tool success, latency, cost, and resource use. Later waves may version these inputs only through an explicit reviewed migration; they cannot replace failing cases to make a gate pass.
Rollback must never restore API keys to renderer responses or restore reversible Base64 secret persistence. User-intelligence rollback returns to explicit-only records; it never keeps partially trusted autonomous inferences active.

## Wave 0 - Freeze evidence and generated ownership

**Purpose:** make bypasses and optional ownership executable facts.

Parallel lanes:

- **Runtime inventory:** enumerate production entries into ExperimentalCoreRuntime, Foundation, native conversation, company, automation, remote, MCP, and package execution.
- **Trust inventory:** enumerate every base preload method, IPC registration, credential response, egress transport, secret resolution, and side-effect path.
- **Ownership inventory:** generate optional-domain owners and map their renderer/main modules, routes, bridges, preload methods, assets, translations, workers, binaries, databases, and dependencies.

Integrator work:

- define enabled release-candidate surfaces;
- add inventory drift tests;
- freeze a representative multi-step goal set and baseline verified outcome, tool, latency, cost, and resource metrics;
- record baseline failures in current architecture.

Exit gate:

- every enabled execution and egress surface has an owner;
- 100 percent of base preload methods appear in the IPC inventory;
- generated ownership denylist is versioned and fails on an unowned optional import;
- the versioned evaluation set and measurable release budgets are reproducible from the checkpoint revision;
- baseline graph and artifact scans cover all optional owners.

Migration: inventories are additive and do not move runtime behavior.
Rollback: remove only a faulty generated rule after replacing it with an equivalent explicit rule.
Kill criteria: stop if inventory generation is nondeterministic or omits an enabled surface.

## Wave 1 - Freeze contracts and close credential, IPC, and trust holes

**Purpose:** establish the minimum boundary used by the first vertical slice.

The Integrator owns versioned Run, adapter, TrustBroker, capability, ContextProjection, evidence, receipt, cancellation, stable error, and package identity/envelope primitives. The full syscall ABI is frozen only in Wave 5A after the Run and Trust seams are proven.

Parallel lanes:

1. **Credential boundary**
   - make provider secret submission write-only;
   - remove API keys from every renderer response and serialized provider object;
   - remove reversible Base64 secret fallback;
   - add renderer, log, snapshot, and protected-storage-failure tests.
2. **IPC boundary**
   - give every base preload method a request/response schema, sender/frame/origin policy, size, timeout, cancellation, and stable errors;
   - eliminate unrestricted string dispatch and generic adapters that discard native sender identity;
   - add malformed, subframe, spoofed-origin, and confused-deputy tests.
3. **Durable Run store**
   - implement append, replay, idempotency, one terminal state, and side-effect proposal/commit persistence.

Integrator work:

- define TrustBroker.authorizeOrigin, requestCapability, resolveSecret, inspectFinalEgress, and revoke;
- make unknown origin, missing capability, invalid schema, and missing final-egress inspection deny by default;
- place origin/capability and final-egress hooks on the coming Hub/cloud path.

Exit gate:

- no provider read API returns a raw credential;
- protected-storage failure is fail-closed;
- 100 percent of base preload methods are inventoried and schema/sender validated;
- no unrestricted string IPC dispatch remains in the base contract;
- TrustBroker denies unknown origin/capability and an uninspected final egress;
- replay proves one terminal state and no duplicate committed effect;
- zero core-contract imports point to optional implementations.

Migration: new bridge methods can coexist behind versioned adapters only while both pass the same deny tests.
Rollback: disable a new bridge method and retain write-only credential storage; never re-enable Base64 or key-returning APIs.
Kill criteria: any renderer secret, sender bypass, event corruption, or duplicate effect stops the wave.

## Wave 2 - Establish one production Run Kernel

**Purpose:** merge production runtime ownership without creating a third orchestrator.

ExperimentalCoreRuntime becomes adapter/session implementation behind the Run Kernel, or is renamed and absorbed. Foundation placeholder adapters are replaced or removed.

### Wave 2A - Hub plus one cloud vertical slice

Parallel lanes:

- replace Foundation context with ContextStore/ContextComposer;
- replace Foundation resource and choice adapters with the single ResourceCoordinator and deterministic selector;
- adapt one cloud provider to normalized events, TrustBroker hooks, durable Run state, cancellation, and receipts;
- implement restart and idempotent cancellation.

The Hub ordinary conversation is the only first enabled production slice.

2A exit gate:

- Hub plus one cloud target enters one kernel;
- origin, capability, secret, and final-egress hooks deny by default;
- no duplicate context, resource, or lifecycle owner is used by that slice;
- restart produces one terminal receipt and no duplicate effect.

### Wave 2B - Per-executor compatibility migration

Migrate only existing executors selected for the release candidate, one at a time behind explicit feature flags and the same contract suite. The local, CLI, and MCP targets selected for MVP may enter through Wave 4 instead of preserving a legacy path; package calls cannot enter before Wave 5A.

Move goal planning and delegation behind the Run Kernel. A parent Run creates bounded child steps with explicit lineage, narrowed capabilities and budgets, cascading cancellation, independent terminal states, and verified evidence aggregation. Prove the contract with one multi-step goal and at least one child step.

An executor that has not migrated is disabled for the release candidate. It may not silently use its old direct provider or side-effect route.

2B exit gate:

- every enabled release-candidate surface enters the same kernel;
- one multi-step Hub goal delegates a bounded child step without privilege amplification and produces one parent receipt with linked evidence;
- inventory shows no enabled bypass;
- ExperimentalCoreRuntime and Foundation are no longer peer lifecycle owners;
- recovery does not import IDE memory;
- cancellation leaves no process, socket, lease, or event source.

Migration: enable one executor only after contract, trust, recovery, and cleanup tests pass.
Rollback: disable that executor flag and preserve its durable records for inspection; do not fall back to the bypass path.
Kill criteria: any bypass, incompatible event replay, orphan resource, or two lifecycle owners stops rollout.

## Wave 3 - Complete Trust and User Intelligence

**Purpose:** complete policy breadth, approval UX, and useful private context.

Parallel lanes:

1. **Trust policy completion**
   - migrate every Wave 0 egress and side-effect surface to TrustBroker;
   - implement scoped approvals, destination validation, final serialized-payload inspection, audit, revocation, and denial evidence.
2. **Canonical user intelligence**
   - remove or delegate PreferenceManager to ContextStore;
   - implement the controlled loop `observe or explicit input -> propose -> explain -> confirm -> apply -> record outcome -> correct or forget`;
   - add provenance, confidence, contradiction, correction, export, deletion, retention, projection-use, and outcome evidence.
3. **Base control surface**
   - expose grants, approvals, audit receipts, context provenance, cloud-projection policy, correction, export, deletion, and learning pause.

Integrator work:

- ensure context can inform a proposal but cannot grant a capability;
- bind policy and projection evidence to Run receipts;
- keep normal context and restart independent of IDE.

Exit gate:

- every enabled egress surface uses TrustBroker;
- no secret plaintext reaches renderer, prompts, logs, or receipts;
- explicit and consented memory works end to end;
- one proposed inference is explained and confirmed, its outcome is recorded, and rejection or correction changes the next proposal without changing authorization;
- correction and deletion change subsequent projections;
- normal conversation restarts with IDE absent;
- inferred context cannot change permission outcomes.

Migration: import only records with valid provenance; quarantine ambiguous legacy memory.
Rollback: switch to explicit-only projection and retain an audit of disabled inferred records.
Kill criteria: secret leak, permission change from learning, undeletable record, or IDE dependency stops rollout.

Advanced autonomous learning, habit mining, learned target ranking, and proactive personalization remain P1.

## Wave 4 - Productize local, cloud, CLI, and MCP targets

**Purpose:** prove provider neutrality before package runtime work.

Parallel lanes:

1. **Local offline**
   - connect Model Manager, verified model store, LocalInferenceBroker, sidecar lifecycle, and Run Kernel;
   - implement install, hardware fit, health, stream, cancel, crash recovery, update, rollback, and uninstall;
   - run a real network-blocked ordinary conversation.
2. **Cloud and CLI**
   - harden the Wave 2 cloud adapter and migrate one supervised CLI;
   - normalize health, errors, usage, process limits, cancellation, and cleanup.
3. **MCP**
   - route one MCP tool through Run Kernel and TrustBroker with capability/resource leases and evidence.

The P0 Target Router is deterministic: required capability, privacy, allowed user pin, health, ResourceCoordinator availability, then hard budget. Learned quality, predictive latency, and cost optimization are P1.

Exit gate:

- one local, one cloud, one CLI, and one MCP target pass the same lifecycle suite;
- ordinary local conversation completes with network blocked;
- fallback never crosses privacy, capability, health, resource, or budget constraints;
- selection inputs and reasons appear in the receipt;
- no enabled feature surface calls a target directly.

Migration: register one target only after health and lifecycle contracts pass.
Rollback: unregister the target and keep receipts/config metadata; secret rules never regress.
Kill criteria: nondeterministic choice, policy-crossing fallback, orphan process/model lease, or offline network dependency stops rollout.

## Wave 5 - Build package ABI, neutralize core, and extract IDE

Wave 5 is sequential. A later subwave cannot begin until the preceding gate passes.

### Wave 5A - Capability ABI and tiny signed pilot

Implement versioned native syscalls, main-process capability/resource leases, isolated community runtime, activation, cancellation, evidence, revocation, update, rollback, and uninstall. Trusted React is first-party-only.

Prove the ABI with a tiny signed pilot package that contributes one governed capability. Package targets are not a Wave 4 prerequisite.

Gate: pilot installs without rebuilding base, runs only through syscalls and Run Kernel, and leaves no route/process/lease/grant/data after uninstall.

### Wave 5B - Neutralize IDE-owned primitives

Move context recovery, workspace/file primitives, generic terminal/process needs, and shared contracts required by base out of IDE ownership. Base conversation and restart must not import IDE code, database, or types.

Gate: zero core-to-IDE implementation imports and ordinary conversation restart with com.tomni.ide absent.

Progress: the Tomny Core execution path now uses a neutral, workspace-scoped MCP server instead of `buildIdeServer`; it does not dispatch IDE memory or navigation tools. The complete gate remains open until all base runtime imports, clean-install startup, and restart evidence pass.

### Wave 5C - Extract IDE

Move IDE routes, UI, services, preload calls, assets, translations, workers, dependencies, and package data into com.tomni.ide. Build base and IDE independently.

Gate: signed install/update/disable/uninstall/rollback passes; generated graph and artifact scans find no IDE owner in base.

### Wave 5D - Remove every remaining optional owner from MVP base

For Browser, Office, Studio-related, Music, MakeVideo, Terminal, Testing, Monitor, media/design, and every other optional owner, remove all base imports, routes, bridges, activation, assets, translations, workers, binaries, and databases. Legacy source may remain in the repository outside base ownership and build graphs, but base cannot import or emit it.

MVP gate:

- zero core-to-optional implementation imports;
- generated ownership denylist reports zero optional files in base graphs, chunks, ASAR, resources, source maps, translations, binaries, and databases;
- base webviewTag is false;
- no Browser host, route, service, bridge, asset, translation, worker, or database exists or starts before install;
- clean base starts no optional route, service, process, scheduled job, or database;
- Hub, context, Store, settings, update, and recovery work with all optional packages absent.

Migration: replace base static imports with disabled registry slots; do not build incomplete optional packages into the candidate.
Rollback: disable the offending base reference; never restore optional implementation to base.
Kill criteria: any core-to-optional import, undeclared optional artifact, preinstall Browser host/database, or base activation stops the MVP candidate.

## Wave 6 - MVP hardening and release candidate

Parallel lanes:

1. **Adversarial security:** malicious package, IPC spoofing, prompt-injected side effect, secret canaries, SSRF/redirect, archive abuse, grant replay, and restart duplication.
2. **Reliability:** long run, rapid cancellation, local-model crash, provider outage, offline mode, resource pressure, database migration, package update, and rollback.
3. **Clean-machine journeys:** execute every product-vision MVP journey on each claimed platform and collect artifact, receipt, and safe log evidence.

Release candidate gate:

- all MVP definition items pass at one revision;
- full lint, format, type, unit, contract, integration, and required end-to-end suites pass;
- 100 percent of base preload methods remain schema/sender covered;
- all enabled surfaces use Run Kernel and TrustBroker;
- deterministic P0 router and single ResourceCoordinator are authoritative;
- generated optional denylist and zero-import checks pass;
- base webviewTag is false and no Browser state exists before install;
- local offline, cloud, CLI, MCP, signed pilot, and fully extracted IDE lifecycle journeys pass; every other optional owner is absent and inactive in base;
- one multi-step delegated goal passes parent/child lineage, privilege narrowing, budget accounting, cancellation cascade, evidence aggregation, and terminal-state tests;
- the frozen representative-goal evaluation set meets its verified-outcome and tool-success budgets with no unexplained regression from the checkpoint baseline;
- rollback and kill drills pass;
- no known P0 security, data-loss, duplicated-effect, or package-isolation issue remains;
- documentation matches the artifact.

Migration: release from a clean signed candidate and test update from the previous supported build.
Rollback: restore the previous signed base and compatible package set while retaining readable Run evidence; never weaken credential or trust boundaries.
Kill criteria: any P0 failure rejects the candidate. There are no waivers.

## Post-MVP expansion tracks

These tracks start only after the Wave 6 candidate passes. They use the same Run, TrustBroker, ResourceCoordinator, context, and package contracts rather than reopening the base architecture.

1. **Optional applications:** package Browser first through the proven ABI, then independent Office, Studio-related, Music, MakeVideo, Terminal, Testing, Monitor, media/design, and other optional owners. Every package receives signed install, use, update, disable, uninstall, and rollback evidence before activation. Studio remains a Store group and compatibility resolver, not a monolith.
2. **Open AI and CLI ecosystem:** publish an adapter SDK and conformance suite so additional API providers, local runtimes, subscription CLIs, remote agents, and MCP servers can ship as governed packages without core changes. Compatibility means passing lifecycle, trust, usage, cancellation, and cleanup contracts; it never means executing arbitrary binaries without policy.
3. **Advanced intelligence and efficiency:** add opt-in autonomous observation, confidence decay, contradiction resolution, learned quality/cost/latency routing, and outcome-driven planning only after versioned evaluations prove improvement and user controls remain effective.
4. **Platform parity:** port package isolation, local-runtime supervision, secret storage, update, and clean-machine release evidence to each additional desktop platform before claiming support; web and remote surfaces remain clients of the same governed core.

## Progress reporting

Report gate, pass/fail/blocked state, command and revision, owner, linked failure, rollback state, kill status, and next smallest action. Only the Integrator changes canonical status to CURRENT.
