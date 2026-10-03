# Target core boundaries

**Status:** TARGET. Migration evidence is tracked in [current architecture](current.md).

## Architectural objective

TomniHubOS ships a small trusted base that owns governance and an open package platform that supplies optional capabilities. All execution targets use one run protocol. All privileges are mediated by capability contracts.

The target is not a rewrite of every subsystem. It is a consolidation of the strongest existing components behind one boundary, followed by physical removal of optional application code from the base artifact.

## MVP release boundaries

The architecture supports two separately reported checkpoints:

- **Core plus Store candidate:** the Hub, Trust/User Intelligence, provider-neutral targets, capability resolver, signed package lifecycle, first-party Store commerce, default Browser/IDE surfaces, and clean base pass while managed switches may remain disabled.
- **Full managed-usage MVP:** the same candidate additionally passes managed-AI Credit settlement and scale-to-zero managed-cloud provisioning, cleanup, and reconciliation.

The [MVP master plan](../execution/mvp-plan.md) owns execution order: C0 locks evidence; C1 freezes Store, Package App, Surface, identity, lifecycle, AI-consent, and commerce contracts; C2 completes the person-operated Store, publication/review, and commerce while production AI-to-Surface access remains off; C3 converges Security, causal User Intelligence, and Orchestration; C4 proves one production local AI-to-reviewed-Surface journey; C5 proves local/cloud/hybrid placement, default Browser/IDE behavior, and a clean base; and C6 decides the C6A Core plus Store release and the independent C6B Full managed-usage extension. Store advances continuously from S0 through S6 and never depends on managed cloud.

Paid activation is the Store/package convergence point: authoritative entitlement is necessary but never sufficient. Package identity, signature, compatibility, Trust decision, permission, ABI, isolation, and lifecycle checks remain mandatory and cannot be raised by payment or sponsorship.

## MVP architectural scope and non-goals

The Core plus Store candidate needs one ordinary Hub surface; one local loopback, cloud-model, CLI, and MCP target; one signed pilot; default Browser and IDE surfaces; one remote descriptor; one package-to-package call; one private workflow or Super Package fixture; and one paid first-party product with a third-party accounting fixture. Windows desktop is the first evidence platform.

Public third-party payout, broad provider coverage, warm or committed cloud capacity, learned routing, autonomous background learning, the drag-and-drop workflow builder, remaining optional-app polish, and cross-platform parity are not architectural completion requirements for this candidate. Full managed usage remains an independent extension gate, not a reason to distort the Core or Store boundaries.

## Trusted base allowlist

A module belongs in the base only when it is required to operate, govern, secure, update, or extend the base, or when every governed run or installed package universally needs it.

The base may contain:

- desktop shell, onboarding, account, settings, Hub, chat, Store, package-management, and server-authoritative managed-usage surfaces;
- Run Kernel, planner/orchestrator, durable event store, evidence, receipts, retry, recovery, and cancellation;
- identity, permission broker, secret vault, egress broker, audit, privacy, and policy;
- private context store, projection, provenance, preferences, and user controls;
- resource coordination, target selection, budgets, usage, and health;
- Tomni Credit ledger, rate-card, quote, reservation, settlement, refund, reconciliation, and spending-limit contracts;
- local/cloud/CLI/remote adapter contracts and the minimal first-party adapters selected for MVP;
- provider-neutral cloud-compute request, queue, provisioning, isolation, metering, cleanup, and orphan-recovery contracts;
- package catalog, downloader, verifier, installer, registry, contribution broker, sandbox supervisor, update, rollback, and uninstall;
- IPC/preload contracts, database foundation, logging, telemetry consent, updater, crash recovery, and platform integration;
- shared design tokens, accessibility primitives, and i18n infrastructure used by the base.

Base inclusion is denied when the only reason is convenience, shared ownership history, or a static import from an optional feature.

## Package-only denylist

The following are not base modules:

- optional code editor, terminal workspace, debugger, and source-control UI; the default IDE surface and its integrated Terminal capability are base surfaces;
- web automation studios, downloads UI, and browser-specific data services; the default Browser surface is a base surface;
- Office, documents, spreadsheets, slides, PDF editors, and email/calendar surfaces;
- Studio pages, Music, MakeVideo, media/design editors, optional Terminal workspaces, Testing, Monitor, visual labs, dashboards, and specialized developer tools;
- provider-specific configuration UI beyond a generic adapter form;
- package-owned routes, translations, icons, workers, databases, preload methods, and binaries.

Studio is a Store category and compatibility redirect. Each optional application is independently installable, updateable, disableable, and uninstallable. Browser and IDE are default, always-on base surfaces; Terminal is an IDE capability.

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

### Core plus Store contracts

C1 freezes only the contracts needed for parallel Core, package, and Store work:

- RunRequest, RunReceipt, parent-child lineage, CancellationToken, and terminal error taxonomy;
- ContextProjection with provenance and redaction metadata;
- TargetDescriptor, TargetHealth, SelectionDecision, UsageRecord, and ResourceLease;
- CapabilityQuery, CapabilityCandidate, CapabilityResolution, ActivationProposal, CapabilityRequest, CapabilityGrant, and PermissionDecision;
- ExecutionEvent, EvidenceItem, VerificationResult, SideEffectProposal, and SideEffectCommit;
- PackageIdentity, ContributionIdentity, syscall envelope, and lifecycle states;
- integer MoneyMinor, ProductOffer, Order, PaymentEvent, Refund, Entitlement, AcquisitionGrant, CommissionEntry, PublisherPayable fixture, and ranking lane.

### Managed-usage contracts

C6B separately freezes RateCard, UsageQuote, CreditReservation, UsageSettlement, RefundDecision, and ReconciliationRecord. Store ordinary payment and entitlement do not reuse Tomni Credit.

Contract versions are explicit. External data is validated at the boundary. Errors are stable codes plus safe details, not leaked provider, payment, or secret payloads. Detailed lifecycle rules remain owned by the linked package, Store, billing, and cloud documents.

## Core service ownership

### Run Kernel

Owns state transitions, ordering, idempotency, terminal-state rules, and receipts. It calls services through contracts; it does not implement provider, UI, context database, or resource policy itself.

### Model topology decision (Standardized on Laya, 2026-09-21)

The target topology standardizes on the **Laya Decision Engine** (~322M/421M non-autoregressive encoder, ~33ms) for local security, user-understanding, and semantic-analysis. Autoregressive Qwen models are excluded from local tasks to avoid token generation overhead and multi-agent queue congestion. Orchestration uses an eligible API LLM and remains subordinate to deterministic Hub policy and the Run Kernel.

### Orchestrator

Turns a goal into steps, asks the capability resolver how each step can be fulfilled, assigns agents or adapters, observes evidence, requests verification, and replans within policy. Its reasoning target is an eligible API LLM; no local orchestration adapter is part of the target. It cannot mint capabilities, install a package, or activate a remote service by itself.

### Trust broker

Resolves identity, permissions, approvals, destination policy, secret handles, and package trust. It is authoritative for side effects.

### User intelligence service

Stores explicit and inferred context with provenance, confidence, scope, retention, and user controls. It emits bounded projections and outcome signals. It is not an authorization service.

### Capability resolver

Owns the comparable discovery view across base capabilities, installed packages, signed remote zero-install capabilities, and installable Store entries. It returns `ready-local`, `ready-remote`, `installable`, or `unavailable` candidates plus package identity, version, trust, permissions, data location, price, latency, offline/UI support, health, and compatibility. It cannot grant permission, spend Credit, install code, or suppress consent. Resolution and selection reasons become Run evidence.

### Target router

For MVP, deterministically filters and selects by required capability, privacy, an allowed user pin, health, ResourceCoordinator availability, and hard budget. It records candidates and reasons. Learned quality, predictive latency, and cost optimization are P1. A user pin applies only when policy and health allow it.

### Resource coordinator

Owns CPU, memory, GPU, NPU, process, concurrency, and lifecycle leases. Other systems consume it; they do not implement parallel lease pools.

### Store commerce service

Owns first-party ProductOffer, Order, PaymentEvent, Refund, Entitlement, opaque AcquisitionGrant, commission/payable fixtures, and organic, featured, and sponsored lanes. It uses ordinary payment rather than Tomni Credit at MVP. It can attest commercial ownership but cannot install code, grant capability, change package trust, or weaken Package Supervisor admission. Detailed policy is owned by [Store commerce](../platform/store-commerce.md).

### Billing and Credit ledger

Owns integer balances, immutable entries, rate-card versions, quotes, reservations, settlement, refunds, and reconciliation. Adapters, packages, provisioners, and renderers can report normalized usage but cannot mint, price, reserve, or debit Credit. The lifecycle is defined in [credits and billing](../platform/credits-and-billing.md).

### Managed cloud scheduler

Owns provider-neutral resource requests, queue admission, provisioning, placement, metering, cleanup, and orphan recovery for prepaid remote compute. The launch path scales to zero and has no warm pool. Shared hosts and committed capacity remain gated by measured economics and isolation evidence in [managed cloud execution](../platform/cloud-execution.md).

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
- Managed cloud sandboxes bind account, Run, package, reservation, resource, secret, and network identities; terminal state, cancellation, timeout, or orphan recovery terminates and cleans the provider resource.

## Data boundaries

Data is separated by owner and purpose:

- core identity, policy, run events, and receipts;
- private context and provenance;
- encrypted secret material;
- provider credentials and adapter configuration;
- package manifests, state, grants, and per-package data;
- Store offers, orders, payment events, refunds, entitlements, commission, and payable records;
- Tomni Credit entries, reservations, settlements, and reconciliation, separate from Store ordinary payment;
- managed-cloud task, provider-resource, metering, and cleanup records;
- generated artifacts and user workspace files.

Packages receive dedicated storage namespaces and cannot query another package or core private context directly. Context projection is purpose-bound and records which fields left which boundary.

## C0-C6 migration strategy

1. **C0:** lock current-revision surfaces, owners, bypasses, money paths, and artifact inputs before behavior changes.
2. **C1:** freeze the minimal Store, Package App, Surface, identity, lifecycle, AI-consent, and commerce contracts in short Integrator-owned batches; defer Credit contracts to C6B.
3. **C2:** complete signed catalog and person-operated package lifecycle, submission/review/publication, and ordinary Store commerce while one owned switch keeps production AI-to-Surface invocation disabled.
4. **C3:** migrate release executors through the shared Run and Trust seams, complete causal controls and deterministic Surface orchestration, and pass the three frozen core evaluations.
5. **C4:** enable and prove one production local AI-to-reviewed-Surface journey with exact, separate installation and AI-access consent.
6. **C5:** prove cloud and hybrid Surface placement, neutralize IDE-owned primitives, extract IDE, remove every optional owner from base inputs, and regenerate exact artifacts.
7. **C6:** reconcile adversarial, reliability, migration, clean-machine, Store, economics, and fixed-evaluation evidence for C6A, then evaluate the separately switched C6B managed-usage extension.
8. Delete compatibility paths only after their replacement passes migration and rollback evidence; post-MVP packages and providers reuse these boundaries rather than reopening them.

Do not begin by moving directories. First establish a dependency rule and runnable verticals; then move ownership without creating another parallel runtime. Store work continues through S0-S6 while independent Core or managed dependencies are pending.

## Architecture progress and status

Implementation truth remains in [current architecture](current.md); dependency and subagent order remain in the [MVP master plan](../execution/mvp-plan.md). Reports use only CURRENT, PARTIAL, TARGET, or BLOCKED and bind every completion claim to a reachable path, current-revision command/exit code, artifact, owner, and switch state.

Hub, Trust/User Intelligence, Store/Package, Managed Usage, and Release are measured as passing required acceptance atoms over total atoms. Core plus Store and Full managed usage are reported separately, and release readiness is the lowest required critical-track completion rather than the average.

## Boundary completion criteria

The Core plus Store candidate is complete when:

- every enabled release-candidate execution target enters one durable run lifecycle; unmigrated targets are disabled;
- one multi-step Hub goal creates durable parent/child lineage with narrowed grants and budgets, cascading cancellation, and verified evidence aggregation;
- every privileged operation has identity, capability, policy, audit, cancellation, and recovery evidence;
- one local, one cloud-model, one CLI, and one MCP adapter pass the same contract suite and deterministic router;
- one missing capability resolves deterministically to a signed remote candidate without local installation, while a request for local UI or offline use produces a consented install proposal;
- private context is user-inspectable and its projection is recorded;
- one controlled user-intelligence proposal, consent, outcome, correction, forgetting, export, and deletion loop works without changing authorization;
- ResourceCoordinator is the single resource owner and the MVP router deterministically uses capability, privacy, allowed pin, health, resources, and hard budget;
- a community package cannot execute in the trusted renderer path;
- one paid first-party Store package completes order, entitlement, activation, refund, and revocation without payment changing technical trust; a third-party fixture proves 15/85 accounting without public payout;
- one remote capability, one brokered package-to-package call, and one private workflow or Super Package fixture pass the same Run, Trust, resource, and evidence boundaries;
- a generated ownership denylist proves zero core-to-optional imports and no optional implementation in the base artifact; the signed pilot and IDE are independently installable, while Browser, Office, Studio-related, and all remaining optional owners are absent and inactive until independently packaged;
- a clean restart can resume or safely terminate an interrupted run without duplicating an effect, order, entitlement, debit, or refund;
- denial and uninstall leave no orphan process, grant, route, or package data outside declared retention policy.

### Full managed-usage completion

The full managed-usage checkpoint additionally requires one managed-AI settlement and one prepaid scale-to-zero managed-cloud task to prove quote, reservation, authorization, provision where applicable, normalized metering, exactly-once settlement or refund, reconciliation, receipt, and provider-resource termination without a warm pool. Until this gate passes, managed switches remain disabled and the Core plus Store candidate is reported separately.
