# Local and cloud AI runtime

**Status:** TARGET contract with PARTIAL adapters and local-runtime components.

The AI runtime makes provider choice replaceable while keeping execution policy consistent. Local model, cloud API, provider CLI, remote agent, MCP, and package-contributed targets must look like execution targets to the Hub, not separate product paths.

## Current evidence

**CURRENT:** ExperimentalCoreRuntime is used by production code despite its name. The repository has ACP, Codex app-server, Tomny core, remote, and sidecar adapter implementations under packages/desktop/src/process/experimentalCore.

**PARTIAL:** LocalInferenceBroker, sidecar lifecycle, model catalogs, signature verification, and registry components exist. Local model download, activation, Model Manager, routing, and ordinary conversation execution are not one production-wired offline path.

**PARTIAL:** Native conversation and other feature-specific provider clients exist outside ExperimentalCoreRuntime.

**BLOCKED:** Foundation Run Kernel and ExperimentalCoreRuntime overlap. The production runtime must be renamed and merged behind one Run Kernel rather than creating a third orchestrator.

**BLOCKED:** ProviderStore can return usable API keys through renderer-facing contracts and uses a reversible Base64 fallback. Credential handling must be fixed before calling cloud adapters trusted.

## Unified target contract

Each target advertises a versioned descriptor:

- stable target and adapter identity;
- execution kind: local, cloud API, CLI, remote, MCP, or package;
- provider and model identity where applicable;
- supported input, attachment, tool, reasoning, and structured-output capabilities;
- context and output limits;
- streaming and cancellation support;
- privacy class and allowed data locations;
- estimated latency, cost, energy, and resource footprint;
- health, authentication, install, and update state.

Each adapter implements:

- discover and validate configuration;
- health and capability probe;
- prepare a run without executing a side effect;
- start and stream typed events;
- request tool or capability calls through the Hub;
- cancel with bounded cleanup;
- report normalized usage;
- checkpoint or declare non-resumable state;
- classify stable errors;
- dispose processes, files, sockets, and leases.

Adapters do not directly read arbitrary user context, mint permissions, or make uninspected side effects.

## Selection policy

The Target Router receives a normalized task profile and ranks only healthy, policy-compatible candidates.

Post-MVP selection may consider:

- required modality, tools, context, and structured output;
- local-only, region, or provider constraints;
- secret and data sensitivity;
- user pin and provider preference;
- observed task quality from versioned evaluations and user outcomes;
- estimated latency and cost;
- context-window fit;
- CPU, memory, GPU, NPU, battery, and thermal pressure;
- current concurrency and model warm state;
- adapter reliability and recent failure class.

For MVP, routing is deterministic and considers only required capability, privacy policy, an allowed user pin, target health, ResourceCoordinator availability, and a hard budget ceiling, in that order. The decision records candidates, exclusions, policy version, and fallback order. Learned quality, predictive latency, and cost optimization are P1 inputs and cannot affect the MVP release decision. A user pin cannot bypass security or an unhealthy target.

## Local runtime

Local AI is a first-class target, not a development fallback.

### Lifecycle

1. fetch a signed catalog over a pinned, revocation-aware trust path;
2. show model size, license, hardware fit, source, and data behavior;
3. download with resume, hash, size, and signature verification;
4. install transactionally into a versioned model store;
5. probe CPU, GPU, NPU, memory, and runtime compatibility;
6. start a supervised sidecar with bounded environment and resource lease;
7. perform a deterministic health and inference check;
8. expose the target to routing;
9. update or roll back atomically;
10. stop, unload, and uninstall without orphan processes or weights.

Model weights are never required in the base installer. A catalog entry is not executable trust by itself; runtime binaries and weights have independent provenance.

### Offline guarantee

The offline MVP test starts from a machine with a previously installed local model, blocks network access, starts TomniHubOS, creates a normal Hub conversation, executes a tool-free task through the shared Run Kernel, streams output, cancels a second run, restarts, and reads both receipts. No IDE or Browser package may be installed.

A mocked broker or test-only ModelPack path does not satisfy this gate.

## Cloud APIs

Cloud adapters use generic configuration metadata plus write-only secret submission. The renderer can see provider name, endpoint, models, status, and credential presence, never the credential value.

The main process:

- validates and canonicalizes endpoints;
- blocks unsafe local or metadata-network destinations unless specifically allowed;
- resolves secret handles at the last moment;
- projects the minimum permitted context;
- applies timeout, byte, concurrency, and budget limits;
- inspects final outbound content;
- normalizes provider errors and usage;
- discards response headers or bodies that may contain secrets.

Custom endpoints are supported through the same SSRF and egress rules as Store downloads and remote adapters.

## Provider and coding CLIs

A CLI adapter declares executable identity, discovery method, version range, working-directory policy, environment allowlist, protocol, login state, supported cancellation, and cleanup strategy.

Subscription CLIs can be used when their terms and local authentication permit it. TomniHubOS does not scrape credentials or emulate a subscription API.

Processes run supervised with:

- explicit executable resolution;
- no shell interpolation by default;
- bounded environment and workspace;
- stdout/stderr limits and secret scanning;
- process-tree cancellation;
- resource and capability leases;
- versioned parser and error taxonomy;
- no inherited provider secrets unless the adapter declares and receives them.

## Remote and MCP targets

Remote targets authenticate both transport and target identity, bind messages to a run, and report capability and health. Reconnect does not replay committed side effects.

MCP tools are capabilities under the Run Kernel. Tool discovery does not grant execution. Each call receives schema validation, package or server identity, permission, destination policy, timeout, result size limits, and evidence.

## Streaming, cancellation, and recovery

All adapters emit normalized events for text, reasoning metadata, tool proposals, usage, warnings, checkpoints, and terminal status. Provider-specific chunks remain inside the adapter.

Cancellation is idempotent and has a deadline. The Hub stops accepting new events after terminal state, releases leases, and records orphan cleanup failures. A resumable adapter persists an opaque checkpoint; a non-resumable adapter restarts only when policy says the step is safe and idempotent.

## Cost and efficiency

Usage is normalized into input, cached input, output, tool, local compute time, energy estimate when available, and monetary estimate. Missing pricing is explicit rather than zero.

Efficiency optimization must not trade away privacy or outcome quality. For MVP, deterministic routing stops at capability, privacy, allowed pin, health, ResourceCoordinator availability, and hard budget. Warm-state preference, learned quality, predictive latency, and cost optimization are P1.

## MVP adapter set

The first contract suite must cover:

- one local-only OpenAI-compatible target on an explicit loopback engine (for example Ollama or LM Studio), with no Hub egress or cloud fallback;
- one cloud API adapter using write-only credentials;
- one supervised provider or coding CLI;
- one MCP tool path.

A package target joins only after the Wave 5A syscall ABI and tiny signed pilot pass.

Every target is invoked from the same ordinary Hub surface and the same Run Kernel. Feature-specific UI cannot call an adapter directly.

## MVP acceptance gates

- ExperimentalCoreRuntime is renamed or absorbed; only one production Run Kernel owns lifecycle.
- Every enabled release-candidate surface reaches that kernel; unmigrated executors are feature-flagged off.
- Provider metadata APIs never serialize API keys to renderer code.
- Reversible Base64 secret fallback is removed; credential rollback never restores it.
- Local model install and offline end-to-end execution pass on a clean supported machine.
- Local broker health, stream, cancellation, crash, restart, update, and uninstall are integration-tested.
- Cloud, CLI, local, and MCP adapters pass the same contract tests; the signed pilot joins after package ABI completion.
- Target selection is deterministic over capability, privacy, allowed pin, health, ResourceCoordinator availability, and hard budget. Learned quality, predictive latency, and cost optimization remain P1.
- A failed target falls back only to a policy-compatible target and records the reason.
- No cancelled run leaves an adapter process, model lease, socket, or pending terminal state.
