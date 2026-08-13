# Target core boundaries

**Status:** TARGET. Migration evidence is tracked in [current architecture](current.md).

## Architectural objective

TomniHubOS ships a small trusted base that owns governance and an open package platform that supplies optional capabilities. All execution targets use one run protocol. All privileges are mediated by capability contracts.

The target is not a rewrite of every subsystem. It is a consolidation of the strongest existing components behind one boundary, followed by physical removal of optional application code from the base artifact.

## Trusted base allowlist

A module belongs in the base only when it is required to operate, govern, secure, update, or extend the base, or when every governed run or installed package universally needs it.

The base may contain:

- desktop shell, onboarding, account, settings, Hub, chat, Store, and package-management surfaces;
- Run Kernel, planner/orchestrator, durable event store, evidence, receipts, retry, recovery, and cancellation;
- identity, permission broker, secret vault, egress broker, audit, privacy, and policy;
- private context store, projection, provenance, preferences, and user controls;
- resource coordination, target selection, budgets, usage, and health;
- local/cloud/CLI/remote adapter contracts and the minimal first-party adapters selected for MVP;
- package catalog, downloader, verifier, installer, registry, contribution broker, sandbox supervisor, update, rollback, and uninstall;
- IPC/preload contracts, database foundation, logging, telemetry consent, updater, crash recovery, and platform integration;
- shared design tokens, accessibility primitives, and i18n infrastructure used by the base.

Base inclusion is denied when the only reason is convenience, shared ownership history, or a static import from an optional feature.

## Package-only denylist

The following are not base modules:

- IDE, code editor, terminal workspace, debugger, and source-control UI;
- Browser UI, web automation studios, downloads UI, and browser-specific data services;
- Office, documents, spreadsheets, slides, PDF editors, and email/calendar surfaces;
- Studio pages, Music, MakeVideo, media/design editors, optional Terminal workspaces, Testing, Monitor, visual labs, dashboards, and specialized developer tools;
- provider-specific configuration UI beyond a generic adapter form;
- package-owned routes, translations, icons, workers, databases, preload methods, and binaries.

Studio is a Store category and compatibility redirect. Each application is independently installable, updateable, disableable, and uninstallable.

## Dependency direction

The permitted direction is:

```text
base UI
  -> Hub application services
    -> core contracts
      <- provider, CLI, tool, and package adapters

package UI or worker
  -> package SDK and capability syscalls
    -> base capability broker
```

Core contracts never import provider or package implementations. Base routing never imports an optional page implementation. Packages cannot reach main-process services except through versioned capability syscalls.

Shared utility extraction is allowed only when the utility is domain-neutral, has an explicit owner, and does not drag an optional dependency into base.

## Governed run protocol

Every user or agent request becomes a Run with stable identity and exactly one terminal state.

### Required state families

- accepted and normalized;
- policy and context projection;
- target candidates and selection decision;
- plan and delegated steps;
- capability and resource leases;
- execution and streamed evidence;
- proposed external side effects;
- approval, denial, or policy decision;
- verification;
- completed, failed, cancelled, timed out, or compensated.

Events are append-only or tamper-evident enough for restart recovery. Materialized views can be rebuilt from durable events. External effects use idempotency keys and record proposal and commit phases.

### Required contracts

- RunRequest and RunReceipt;
- ContextProjection with provenance and redaction metadata;
- TargetDescriptor, TargetHealth, SelectionDecision, and UsageRecord;
- CapabilityRequest, CapabilityGrant, and PermissionDecision;
- ResourceLease;
- ExecutionEvent, EvidenceItem, and VerificationResult;
- SideEffectProposal and SideEffectCommit;
- PackageIdentity and ContributionIdentity;
- CancellationToken and terminal error taxonomy.

Contract versions are explicit. External data is validated at the boundary. Errors are stable codes plus safe details, not leaked provider or secret payloads.

## Core service ownership

### Run Kernel

Owns state transitions, ordering, idempotency, terminal-state rules, and receipts. It calls services through contracts; it does not implement provider, UI, context database, or resource policy itself.

### Orchestrator

Turns a goal into steps, assigns agents or adapters, observes evidence, requests verification, and replans within policy. It cannot mint capabilities.

### Trust broker

Resolves identity, permissions, approvals, destination policy, secret handles, and package trust. It is authoritative for side effects.

### User intelligence service

Stores explicit and inferred context with provenance, confidence, scope, retention, and user controls. It emits bounded projections and outcome signals. It is not an authorization service.

### Target router

For MVP, deterministically filters and selects by required capability, privacy, an allowed user pin, health, ResourceCoordinator availability, and hard budget. It records candidates and reasons. Learned quality, predictive latency, and cost optimization are P1. A user pin applies only when policy and health allow it.

### Resource coordinator

Owns CPU, memory, GPU, NPU, process, concurrency, and lifecycle leases. Other systems consume it; they do not implement parallel lease pools.

### Package supervisor

Owns install, trust, activation, syscall mediation, health, update, revocation, rollback, and uninstall for package contributions.

## Process and isolation model

- Main process hosts the trusted control plane and platform services.
- Preload exposes a narrow, schema-validated, sender-validated API.
- Renderer hosts the base UI without Node.js privileges.
- Local model and CLI adapters run in supervised child processes or sidecars with bounded environment, working directory, lifetime, and output.
- Community packages run in sandboxed web/process boundaries with capability-mediated messages.
- Trusted React is restricted to signed first-party packages under explicit high-trust policy.
- Remote relays authenticate each session, bind requests to origin and capability, and never become a generic unauthenticated execution proxy.

## Data boundaries

Data is separated by owner and purpose:

- core identity, policy, run events, and receipts;
- private context and provenance;
- encrypted secret material;
- provider credentials and adapter configuration;
- package manifests, state, grants, and per-package data;
- generated artifacts and user workspace files.

Packages receive dedicated storage namespaces and cannot query another package or core private context directly. Context projection is purpose-bound and records which fields left which boundary.

## Migration strategy

1. Freeze and version shared contracts.
2. Route existing executors through a compatibility adapter into the durable Run Kernel.
3. Replace Foundation placeholder adapters with the real context store, ResourceCoordinator, selection, and trust services.
4. Move security enforcement to shared IPC, adapter, egress, and side-effect seams.
5. Establish package syscalls and an isolated community runtime.
6. Remove optional routes, bridges, imports, assets, and translations from base.
7. Build optional applications only from package-owned source and artifacts.
8. Delete compatibility paths after telemetry-free verification and migration tests.

Do not begin by moving directories. First establish a dependency rule and a runnable vertical slice; then move ownership without creating another parallel runtime.

## Boundary completion criteria

The target core is complete for MVP when:

- every enabled release-candidate execution target enters one durable run lifecycle; unmigrated targets are disabled;
- one multi-step Hub goal creates durable parent/child lineage with narrowed grants and budgets, cascading cancellation, and verified evidence aggregation;
- every privileged operation has identity, capability, policy, audit, cancellation, and recovery evidence;
- one local, one cloud, one CLI, and one MCP adapter pass the same contract suite and deterministic router;
- private context is user-inspectable and its projection is recorded;
- one controlled user-intelligence proposal, consent, outcome, correction, forgetting, export, and deletion loop works without changing authorization;
- ResourceCoordinator is the single resource owner and the P0 router deterministically uses capability, privacy, allowed pin, health, resources, and hard budget;
- a community package cannot execute in the trusted renderer path;
- a generated ownership denylist proves zero core-to-optional imports and no optional implementation in the base artifact; for MVP, the signed pilot and IDE are independently installable, while Browser, Office, Studio-related, and all remaining optional owners are absent and inactive until independently packaged in P1;
- a clean restart can resume or safely terminate an interrupted run;
- denial and uninstall leave no orphan process, grant, route, or package data outside declared retention policy.
