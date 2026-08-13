# Product vision

**Status:** TARGET, with current implementation evidence tracked in [current architecture](../architecture/current.md).

## Product thesis

TomniHubOS is a desktop-first, eventually cross-platform Agent OS. It is not another chat client and it is not a bundle of permanently installed productivity screens. It is a trusted hub where a person can connect the AI and automation systems they choose, give an outcome, and let governed agents complete the work with visible permissions, evidence, and recovery.

The operating-system idea is behavioral rather than kernel-level: TomniHubOS provides identity, capability, context, scheduling, resource, audit, package, and interaction primitives that many agents and applications can share.

The durable advantage is a **user-owned intelligence layer**. With consent, the system learns the person's explicit preferences, recurring work patterns, active projects, trusted tools, and successful outcomes. That context improves planning and routing without trapping the user in one model provider or exporting private history by default.

## Two MVP cores

### 1. Hub Agent OS

The Hub turns an intent into a governed run:

1. accept the goal and relevant workspace;
2. project only the permitted context;
3. select an MVP target deterministically from capability, privacy, an allowed user pin, health, resource availability, and hard budget;
4. plan and delegate work to one or more agents;
5. acquire resource and capability leases;
6. execute through a provider, CLI, local runtime, MCP tool, or installed package;
7. inspect side effects and request approval at policy boundaries;
8. verify the result;
9. persist evidence, usage, and a terminal receipt;
10. recover, resume, or compensate when execution fails.

A provider is an adapter, not the product. One governed run contract must apply to local models, cloud APIs, subscription CLIs, remote agents, and future runtimes.

### 2. Trust and User Intelligence

Trust is part of execution, not a settings page. The core owns:

- identity and origin;
- capability grants and time-bounded approvals;
- secret storage and opaque secret handles;
- outbound data and destination policy;
- package provenance, isolation, and revocation;
- immutable-enough audit evidence and recovery state;
- private context, preferences, habits, and project memory;
- provenance, confidence, scope, retention, export, correction, and deletion;
- clear separation between learned context and authorization.

User understanding exists to reduce repetition and improve outcomes. It must remain inspectable and reversible. Inferred data never silently grants permissions.

## Supporting platform layers

Two platform layers are necessary for the cores but are not separate product centers.

### Local and cloud AI

TomniHubOS exposes one runtime contract across:

- local inference on available CPU, GPU, NPU, or sidecar runtimes;
- cloud model APIs;
- provider and coding CLIs;
- remote agent transports;
- MCP servers and tools;
- package-contributed adapters.

Routing is policy-based and observable. Users can pin a target, use automatic selection, prohibit cloud execution, define budgets, and inspect fallback decisions. Local weights are optional downloads, not mandatory base payload.

### Store and capability packages

The base ships the trusted platform. Domain functionality is installed separately through signed packages with explicit contributions and permissions.

Independent packages include, but are not limited to:

- IDE and code workspaces;
- Browser and web automation surfaces;
- Office or document applications;
- media, design, testing, monitoring, and developer tools;
- provider adapters, agent capsules, workflows, and MCP integrations.

Studio is a user-facing group and a migration alias for related packages. It must not become a monolithic dependency or a hidden base bundle.

## Product principles

### User choice over provider lock-in

A user can connect any provider or CLI that has a compliant adapter. The claim means an open adapter contract, not an unsafe promise to execute arbitrary binaries without policy. Provider terms, local platform restrictions, and user permissions still apply.

### Small trusted base

Base functionality is allowed only when it is required to operate, govern, secure, update, or extend the base, or is universally required by governed runs and packages. Optional routes, assets, bridges, translations, workers, and source implementations must be absent from the base artifact until their package is installed.

### Security on the shared seam

Every execution target passes through the same permission, secret, egress, resource, evidence, and cancellation lifecycle. Per-feature checks are useful defense in depth but do not establish a platform guarantee.

### Private by default

Context stays local unless the user or an explicit policy permits a projection to leave the device. Models receive the minimum context required for the step. Raw secrets never enter prompts or renderer state.

### Outcome evidence over activity

Agent work is complete only when acceptance criteria are verified. Token usage, subprocess activity, or a plausible model response does not prove the requested outcome.

### Honest status

The product distinguishes implemented behavior from an aspiration. A feature is not CURRENT until a reachable production path and appropriate tests demonstrate it.

## MVP user journeys

The first release candidate must prove these journeys end to end.

1. **Provider-neutral run:** connect one local model, one cloud API, and one CLI adapter; submit the same goal; observe governed selection or an explicit pin; cancel safely; receive a durable receipt.
2. **Protected side effect:** an agent proposes an outbound or filesystem action; the Hub shows destination, data class, capability, and scope; denial stops the action; approval is time- and scope-bounded.
3. **Useful private memory:** explicitly save a preference or consent to a specific inference with provenance; use a bounded projection in a later plan; inspect, correct, export, and delete it; prove deletion affects subsequent projections.
4. **Downloadable capability:** start with a base artifact whose generated ownership denylist excludes every optional domain; install a tiny signed pilot and a fully extracted IDE package; use, update, disable, uninstall, and roll back both without rebuilding base. Browser and other optional packages follow after MVP.
5. **Failure recovery:** interrupt a run during execution; restart the application; resume or terminate from durable state without duplicating an external side effect.

## MVP success measures

Release evidence should report:

- percentage of production execution targets covered by the shared security seam;
- percentage of runs reaching exactly one valid terminal state;
- cancellation latency and orphan-process count;
- context projection size, provenance coverage, and user correction/deletion success;
- routing latency, cost estimate accuracy, and fallback reason coverage;
- base artifact size and forbidden optional-module count;
- signed pilot and IDE install, rollback, quarantine, uninstall, and clean-base optional-owner absence;
- task-level outcome success on a fixed, versioned evaluation set.

Growth, marketplace breadth, and polished optional applications follow these trust and reliability measures; they do not replace them.

## Non-goals for the first MVP

- shipping any IDE, Browser, Office, Studio, Music, MakeVideo, Terminal, Testing, Monitor, media/design, or other optional implementation in the base;
- supporting every model or provider before the adapter contract is stable;
- autonomous high-impact actions without a permission and recovery model;
- cloud synchronization of private context by default;
- training a general foundation model as a prerequisite for product validation;
- claiming cross-platform parity without platform-specific release evidence.
