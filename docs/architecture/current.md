# Current architecture and evidence

**Evidence snapshot:** 2026-08-13, checkpoint revision 3b8e19d92 plus the documentation reset.
**Purpose:** record what the repository demonstrates, not what earlier plans promised.

## Runtime shape

**CURRENT:** The primary product is an Electron desktop application under packages/desktop. It uses distinct main-process, preload, and renderer areas. Supporting workspace packages include the runtime compatibility layer, cloud relay, web host and CLI, account kit, shared scripts, and MTUI.

**CURRENT:** The desktop codebase is large and feature-rich. The renderer includes Hub, conversation, settings, Browser, IDE, Studio, and other surfaces. Their presence in source is not proof that they belong in the target base.

**PARTIAL:** The repository has web and remote support, but desktop is the only product shape assessed here. Cross-platform behavior must be proven per operating system.

## Evidence table

| Area                                   | Status                 | Evidence                                                                      | Assessment                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron process separation            | CURRENT                | packages/desktop/src/process, src/preload, src/renderer                       | Structural separation exists. Individual bridges still require sender, schema, and privilege audit.                                                                                                                                                                                                           |
| Generic IPC validation                 | PARTIAL                | process/bridge and feature bridge registrations                               | Sender, frame, schema, payload, timeout, and stable-error validation are not uniform across generic routes.                                                                                                                                                                                                   |
| Foundation Run Kernel                  | PARTIAL                | process/foundation/runKernel.ts and adjacent adapters                         | Defines a clear security, context, choice, resource, executor, evidence sequence. It is not yet the single production run path.                                                                                                                                                                               |
| Production runtime ownership           | PARTIAL                | process/experimentalCore/experimentalCoreRuntime.ts and production callers    | ExperimentalCoreRuntime is production-reachable despite its name, while Foundation owns a parallel lifecycle. They must be renamed or merged into one Run Kernel.                                                                                                                                             |
| Foundation event store                 | PARTIAL                | process/foundation/eventStore.ts                                              | Current implementation is in-memory and cannot provide restart recovery.                                                                                                                                                                                                                                      |
| Foundation target preflight and choice | PARTIAL                | process/foundation/choiceAdapter.ts and runKernel.ts                          | Selection is a simple score and target preflight behavior is not a complete capability policy.                                                                                                                                                                                                                |
| User context store                     | PARTIAL                | process/agentRuntime/contextStore.ts, contextComposer.ts, contextTypes.ts     | Durable scoped facts, preferences, habits, provenance, and bounded projection exist. They are not the universal context source for all runs.                                                                                                                                                                  |
| Secret vault                           | PARTIAL                | process/agentRuntime/secretVault.ts and electronContext.ts                    | Opaque handles and platform protection exist. Coverage across every adapter and side effect is not proven.                                                                                                                                                                                                    |
| Provider credential store              | BLOCKED                | process/services/tomnyProviderStore.ts and provider bridge                    | Protected storage has a reversible Base64 fallback, and usable API keys can be reconstructed into renderer-facing provider objects.                                                                                                                                                                           |
| Preference manager                     | PARTIAL                | process/userUnderstanding/preferenceManager.ts                                | It is an in-memory map and duplicates part of the richer context store.                                                                                                                                                                                                                                       |
| Personal learning caller               | BLOCKED                | process/agentRuntime/contextStore.ts                                          | learnPersonalFact is implemented but has no production caller, so automatic personal learning is not active.                                                                                                                                                                                                  |
| Conversation recovery independence     | PARTIAL                | experimentalCore bridge and context controls                                  | The Hub/ExperimentalCore recovery path no longer imports IDE memory. Ordinary conversation restart with com.tomni.ide absent still needs an end-to-end proof.                                                                                                                                                 |
| Secret firewall                        | PARTIAL                | process/agentRuntime/agentMesh/security                                       | Output inspection and sensitive-file controls exist for agent-mesh paths. They are not a universal egress broker.                                                                                                                                                                                             |
| Outbound text inspection               | PARTIAL                | process/services/security/outboundTextInspection.ts                           | Production use is visible in selected native-conversation and Foundation paths. All providers, CLIs, packages, and remote transports are not proven covered.                                                                                                                                                  |
| Resource coordination                  | CURRENT                | process/resource/resourceCoordinator.ts and resource bridge                   | A substantial coordinator with leases, pressure, lifecycle, and policy is used across several systems. Foundation still has a separate resource adapter path.                                                                                                                                                 |
| Tool selection                         | PARTIAL                | experimental and agent runtime selection services                             | Mature selection and logging components exist, but Foundation choice remains separate.                                                                                                                                                                                                                        |
| AI adapter contract                    | PARTIAL                | process/experimentalCore/adapters                                             | ACP, Codex app server, Tomny core, remote, and sidecar/local paths exist behind adapter concepts. The area is named experimental and is not the only runtime.                                                                                                                                                 |
| Core workspace capability              | PARTIAL                | process/agentRuntime/agentMesh/mcp/coreWorkspaceServer.ts                     | Tomny Core now uses a workspace-scoped neutral MCP server for bounded read/search/glob/write/edit/command operations instead of IDE MCP wiring. External MCP/package tool activation and clean-install evidence remain incomplete.                                                                            |
| Local model catalog/runtime            | PARTIAL                | process/experimentalCore/catalog, adapters/sidecar, and loopbackOpenAiAdapter | The production bridge registers a loopback-only OpenAI-compatible local target and Hub routes it through Foundation without cloud fallback. Catalog, registry, and sidecar components remain separate; clean-machine evidence with a real offline engine/model and managed model lifecycle is still required. |
| Package manifest                       | CURRENT                | common/packages/types.ts and manifest.ts                                      | Typed manifests, module runtimes, contributions, and validation exist.                                                                                                                                                                                                                                        |
| Native package capability ABI          | PARTIAL                | common/packages/capability.ts, package bridge, and package host               | Versioned capability leases, manifest permission checks, cancellation/revocation, expiry, and deterministic syscall receipts now run through an authenticated runtime bridge and sandbox iframe host. No signed artifact declares pilot `host.ipc`, so release lifecycle evidence is still missing.           |
| Package installation                   | PARTIAL                | process/extensions/package-manager                                            | Download, artifact security, transaction, restore, catalog, and quarantine mechanisms are substantial. End-to-end third-party isolation and all revocation paths need release evidence.                                                                                                                       |
| Sandboxed web package host             | PARTIAL                | package manager and renderer package host paths                               | A sandboxed-web type exists. It is not yet proven as the enabled default for community packages.                                                                                                                                                                                                              |
| Trusted React package host             | CURRENT but privileged | common package runtime types and package app host                             | Blob-imported React modules execute with renderer privilege. This is suitable only for tightly trusted first-party code.                                                                                                                                                                                      |
| Optional app extraction                | PARTIAL                | store artifacts, package catalog, package-app groups                          | Package artifacts and ownership metadata exist. Static renderer imports/routes and base-bundle absence are not fully eliminated or proven.                                                                                                                                                                    |
| Base package activation                | BLOCKED                | main bootstrap, central bridge index, renderer router                         | Optional package implementations or package-owned bridges are still eagerly or statically imported instead of discovered through a lazy registry.                                                                                                                                                             |
| IDE extraction                         | PARTIAL                | package artifact metadata and current IDE source                              | An IDE package path exists, while large IDE implementation remains in the desktop tree and package entrypoints can reference source.                                                                                                                                                                          |
| Browser extraction                     | PARTIAL                | Browser pages, services, routes, and package metadata                         | Browser remains connected to base renderer code in multiple places.                                                                                                                                                                                                                                           |
| Studio/Office separation               | PARTIAL                | renderer Studio modules and package metadata                                  | Historical concepts conflict. Canonical target is independent packages; current physical separation is incomplete.                                                                                                                                                                                            |
| Tests                                  | CURRENT but uneven     | Vitest, contract, integration, Bun, and Playwright suites                     | Broad test infrastructure exists. Passing status must be measured at the working revision; historical reports are not proof.                                                                                                                                                                                  |

## Current production seams

Several execution systems coexist:

- native conversation database and provider bridges;
- agentRuntime and agent mesh orchestration;
- company runner and multi-agent services;
- experimentalCore adapters and sessions;
- Foundation Run Kernel;
- package-contributed capabilities;
- browser, automation, and other domain-specific executors.

**PARTIAL:** These systems share some security, resource, and persistence components, but they do not all enter through one durable run state machine. This is the main architectural risk: a new adapter can appear functional while bypassing permission, egress, cancellation, evidence, or recovery policy.

## Strong foundations worth retaining

The rebuild should consolidate, not discard, these implemented assets:

- durable context records with provenance and bounded composition;
- safe-storage-backed secret handles;
- outbound secret inspection primitives;
- a mature ResourceCoordinator;
- adapter contracts for several local, cloud, CLI, and remote execution styles;
- package manifest validation and transactional install/restore mechanics;
- artifact defenses for signatures, traversal, oversized archives, and unsafe downloads;
- agent mesh evidence and orchestration components;
- typed IPC and preload patterns where already present;
- contract, integration, end-to-end, and benchmark infrastructure.

## Critical gaps

### P0: one governed run path

There is no single production entry point that every enabled release-candidate surface must use. Foundation duplicates weaker context, choice, resource, and event behavior while ExperimentalCoreRuntime is production-reachable under an experimental name. The first migration slice is Hub plus one cloud adapter; every other executor must migrate through a compatibility flag or remain disabled for the release candidate.

### P0: deny-by-default trust and IPC boundary

The base needs one TrustBroker contract for origin, capability, secret handle, approval, and final egress. Every base preload method must have a schema and sender policy; unrestricted string dispatch is not an acceptable bridge. Selected inspection call sites and partially typed IPC do not establish universal coverage.

### P0: durable recovery and idempotency

An in-memory event store cannot support safe restart. External side effects need idempotency keys, proposal/commit records, and recovery or compensation rules.

### P0: explicit and consented user context

The richer ContextStore, the placeholder preference map, and IDE-owned recovery paths must converge. MVP requires explicit save or specifically consented inference, provenance, bounded projection, correction, export, deletion, and restart recovery without IDE. Autonomous background learning is not required.

### P0: local, cloud, and CLI product paths

One offline local model, one write-only-credential cloud adapter, and one supervised CLI must pass the same Run Kernel lifecycle in ordinary Hub conversation. The user-run loopback local target is production-wired; selected cloud provider credentials remain main-process-only and enter the supervised Tomny child environment. LocalInferenceBroker and ModelPack components are not yet the managed local-model production path, and final cloud egress inspection still needs a Hub-owned proof.

### P0: deterministic routing and one resource owner

MVP routing must deterministically use capability, privacy, an allowed pin, health, the existing ResourceCoordinator, and a hard budget. Foundation's duplicate choice and lease adapters must be removed or delegate completely to those authoritative services.

### P0: isolated package ABI and physical extraction

The versioned `host.runtime.info` package syscall, main-process capability lease, isolated sandbox runtime, and a buildable tiny signed pilot now exist. A production pilot release remains blocked on the committed production signing key. IDE is the P0 real extraction proof. Every other optional owner must be absent and inactive in the base graph and artifact; complete Browser and remaining package lifecycles are P1.

### P1: advanced learning and learned routing

Background inference, proactive habit learning, learned quality ranking, predictive latency, and cost optimization follow the explicit-memory and deterministic-router MVP.

### P1: provider breadth and orchestration sophistication

Additional providers, complex multi-agent strategies, and richer package capabilities follow the single local/cloud/CLI proof and stable contracts.

### P1: cross-platform parity

Desktop-first MVP evidence can target an explicitly named platform. Other operating systems become CURRENT only after equivalent security, package-isolation, local-runtime, and release evidence.

## Evidence rules for future updates

A row becomes CURRENT only when:

1. a reachable production path exists;
2. the path uses the intended shared boundary;
3. contract or integration tests cover success and denial/failure behavior;
4. restart, cancellation, and cleanup behavior are tested where applicable;
5. packaging claims are verified against an actual artifact;
6. the document cites the evidence path or command.

Source presence alone supports PARTIAL, not CURRENT.
