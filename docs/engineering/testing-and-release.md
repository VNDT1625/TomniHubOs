# Testing and release

**Status:** CURRENT tooling with TARGET release gates.

Tests prove behavior at the relevant trust, process, lifecycle, and artifact boundary. A helper unit test cannot prove that every production surface reaches that helper.

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
- provider credential store.

Contract suites cover success, deny, malformed input, timeout, cancellation, crash, cleanup, rollback, and stable errors.

### Integration

Use real main-process composition with isolated storage for:

- preload and IPC sender/schema boundaries;
- provider credentials and protected-storage failure;
- ordinary conversation through Run Kernel and TrustBroker;
- restart replay and idempotent side effects;
- local sidecar lifecycle;
- package install, activation, update, disable, rollback, revocation, and uninstall;
- database migration;
- remote and loopback authentication.

### End to end

Use end-to-end tests for real product journeys:

- Hub plus one cloud vertical slice;
- real local offline ordinary conversation;
- supervised CLI and MCP;
- approval and denial;
- explicit or specifically consented context, correction, export, and deletion;
- cancellation and restart recovery;
- clean base plus signed pilot and extracted application lifecycles;
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

The initial migration test is Hub plus one cloud adapter. Each later executor is enabled only after passing the same suite behind its compatibility flag.

## Agent effectiveness gate

Wave 0 freezes a versioned representative-goal set covering ordinary conversation, one delegated multi-step goal, tool use, recovery, and context-assisted follow-up. The checkpoint records verified task success, correct tool completion, unsafe or unapproved effects, retries, elapsed time, model and tool usage, monetary estimate, and peak resource use.

Later waves run the same cases through the enabled production path. The release budget requires zero unsafe or unapproved effects, meets the versioned minimum for verified task and tool success, and has no unexplained regression in completion time, usage, or resource cost. A reviewed dataset version may add cases but cannot remove a failing case or change its oracle to pass a gate.

Activity, token count, or a plausible response is not success. Each case has executable or independently inspectable evidence linked to its Run receipt.

## Deterministic target and ResourceCoordinator gate

The P0 router evaluates, in fixed order:

1. required capability;
2. privacy policy;
3. allowed user pin;
4. target health;
5. ResourceCoordinator availability;
6. hard budget.

Given the same candidate snapshot and inputs, the decision is byte-stable. Learned quality, predictive latency, and cost optimization are not MVP inputs.

One authoritative ResourceCoordinator owns all leases. Tests fail on a second lease pool or Foundation resource fallback.

Every MVP adapter covers configuration, health, capability discovery, stream ordering, timeout, cancellation, crash/disconnect, normalized usage, secret non-disclosure, policy-compatible fallback, disposal, and orphan detection.

The local adapter passes a real network-blocked clean-machine journey. The CLI proves process-tree cleanup. The cloud adapter proves renderer never receives a credential. MCP proves tool discovery does not grant execution.

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

Background autonomous learning, learned target ranking, and proactive habit inference are P1 and cannot be required for MVP.

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

For MVP, first prove the versioned syscall ABI with a tiny signed isolated pilot, then run the same matrix for the fully extracted IDE package. Browser and remaining optional owners use this matrix in P1 when their package migrations begin:

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

For MVP, Browser, Office, Studio-related, Music, MakeVideo, Terminal, Testing, Monitor, media/design, and other optional implementations must be absent and inactive in base, but do not need finished package artifacts. Their P1 migration order is Browser first, then independent Office/Studio and remaining domain packages. Legacy source may remain outside base ownership and build graphs, with zero base imports, until that migration.

## Clean-machine base proof

Before any Store download:

- generated optional denylist reports zero findings in graph and artifact;
- no optional route, process, host, service, database, scheduled job, or webview starts;
- Hub conversation, context, Store, settings, update, and restart recovery work;
- provider APIs return metadata only, never credentials;
- no normal conversation path imports IDE memory.

Then install, exercise, update, disable, uninstall, and roll back the signed pilot and IDE package independently and repeat the inventory. Browser and every other optional owner must remain absent and inactive.

## Migration, rollback, and kill drills

Every release wave supplies a fixture for the previous state, performs migration, restarts, exercises the new path, rolls back, and restarts again.

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

1. freeze revision, generated inventories, and dependency lock;
2. run lint, format, type, unit, contract, integration, and required end-to-end suites;
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
- nondeterministic P0 routing or a second resource owner;
- the frozen representative-goal set misses its verified task/tool-success budget or has an unexplained effectiveness regression;
- context recovery dependent on IDE;
- autonomous learning required instead of explicit/consented memory;
- community code executing in the trusted renderer;
- any generated optional owner in base graph/artifact;
- base webviewTag enabled or Browser host/route/service/database present before install;
- missing signed lifecycle proof for the pilot or fully extracted IDE package;
- failed rollback or kill drill;
- data loss, duplicated effect, sandbox escape, auth bypass, P0 secret leak, or orphan process;
- documentation presenting TARGET behavior as CURRENT.

Coverage is not a substitute for these gates. New core code should remain well covered; the repository goal is at least 80 percent when reporting is stable and enforced.
