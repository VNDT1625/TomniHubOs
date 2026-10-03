# Local and cloud AI runtime

**Status:** TARGET contract with PARTIAL adapters and local-runtime components.

## Active focused objective: Model Core Security MVP (2026-09-09)

**ACTIVE SCOPE:** For the current implementation run, work only on the local-first model connection and model-security seam. This focused objective supersedes the broader Core plus Store and MTUI proposal until explicitly reopened.

The completion target is:

0. Inventory the existing provider, gateway, vault, broker, Settings and connector contracts/tests before each change; reuse their owners and add only missing seams.
1. Preserve the existing API-key plus URL provider connection path.
2. Keep the provider OAuth adapter optional: when a Tomny-owned client is configured it provides PKCE/state, refresh, expiry, disconnect and revoke; external registration is not required for the local-first MVP.
3. Normalize provider-reported token usage and use an explicitly marked local estimate when provider usage is unavailable.
4. Issue a separate Main-owned gateway credential per consumer with model allowlist, expiry, rotation and revocation.
5. Enforce Main-process secret custody, destination allowlist, sender/account binding, cancellation and durable security/usage receipts.
6. Remove the 9Router runtime/build dependency only after the focused replacement path passes its contract and rollback checks.

**OUT OF SCOPE:** Codex subagent configuration, MTUI benchmarks, Store/package work, managed billing, cloud compute, browser/subagent features and unrelated C0-C6 release atoms.

**EXIT CONDITION:** The local-first API-key model path passes focused auth, secret-boundary, egress, usage, cancellation, credential-revocation and rollback tests. OAuth remains an optional provider adapter and does not block this MVP; only after the local-first replacement path is proven may the 9Router clone/bundle/runtime be removed.

The AI runtime makes provider choice replaceable while keeping execution policy consistent. Local model, cloud-model API, provider CLI, remote agent, MCP, and package-contributed targets look like execution targets to the Hub, not separate product paths. API key, supported OAuth or router authentication, and compliant CLI login are transport choices governed by the same adapter and Trust contracts.

## Security semantic contract V2 (CURRENT/PARTIAL, 2026-09-12)

Laya Decision Engine produces semantic evidence directly via typed classification: canonical
iskType,
easonCode,
equiresBackendValidation: true, and validated
edactions. Main owns the final action (llow, sk, local_only, or lock) from destination, capability, scope, confirmation, and policy state. Model evidence cannot grant permission or authorization. The historical V1 model output remains readable for old artifacts through a compatibility projection, but its action field is never trusted for egress. The canonical ontology is packages/desktop/src/process/services/security/security-ontology-v1.json; runtime membership and reason-code/risk-type relationships are enforced before policy derivation. This contract is implemented in the shared security seam but remains PARTIAL until a fresh semantic candidate passes its frozen evaluation gates.

## Release checkpoint boundary

The **Core plus Store candidate** proves one BYOK cloud-model target, one user-provisioned local loopback target, one supervised CLI, and one MCP path without requiring Tomni Credit or Tomni-managed compute. These targets remain useful when every managed-usage switch is disabled.

Tomni-managed model resale belongs to the separate **Full managed-usage MVP** evidence. Managed AI purchase, managed cloud provisioning, and Store checkout have independent admission, accounting, rollback, and kill switches. A cloud VM or container is not a model adapter; its execution contract is owned by [managed cloud execution](../platform/cloud-execution.md).

## Current evidence

**BLOCKED incident evidence (2026-09-08):** The active Codex subagent request used the configured 9Router provider at `http://127.0.0.1:20128/v1/responses` and received HTTP 404 `No active credentials for provider: openai`. A direct unauthenticated `GET http://127.0.0.1:20128/v1/models` currently returns HTTP 200 with a model catalog, so the listener and catalog route are alive while the OpenAI credential route is unavailable. This is an upstream 9Router credential/configuration failure, not evidence that the Tomni gateway or `ProviderExecutionBroker` handled the request: Tomni's managed bundle uses port `20129`, and the Codex path is still outside its governed model-route contract. Keep the Codex Responses -> OpenAI cell disabled until credential health, refresh/revocation, final egress, streaming/cancellation, usage, and terminal-receipt acceptance are demonstrated.

**CURRENT:** ExperimentalCoreRuntime is used by production code despite its name. The repository has ACP, Codex app-server, Tomny core, remote, and sidecar adapter implementations under packages/desktop/src/process/experimentalCore.

**CURRENT:** The production bridge detects a user-run OpenAI-compatible engine only on explicit loopback and registers `LoopbackOpenAiAdapter` as a local target. Its output goes through ExperimentalCoreRuntime and Foundation; it cannot fall back to a cloud endpoint. A deterministic ordinary-prompt test rejects every non-loopback host and observes only local model discovery and completion requests.

**PARTIAL:** LocalInferenceBroker, sidecar lifecycle, model catalogs, signature verification, and registry components exist. Local model download, activation, Model Manager, and managed model lifecycle are not one production-wired offline path.

**CURRENT (Laya Migration):** LocalInferenceBroker and the legacy Qwen 0.8B pool are superseded by LayaDecisionEngine (layaSemanticEgressModel.ts and layaSecurityStage.ts). Laya runs non-autoregressively (~33ms) via single forward pass classification, eliminating token-by-token latency and multi-agent queue congestion. omny.semantic-analysis.output.v1 validates exact nested security.output.v1 and user-understanding.output.v2 results or explicit abstentions. Main uses LayaSecurityStage within the composable chat pipeline for pre-query egress inspection.

**PARTIAL:** Native conversation and other feature-specific provider clients exist outside ExperimentalCoreRuntime.

**PARTIAL:** Tomny Core uses a neutral, per-run workspace MCP server for bounded file read/search/glob/write/edit and user-approved shell commands. It resolves every operation under the granted workspace and does not import the IDE MCP server. IDE-specific navigation, memory, browser, and secret-context capabilities require their own activated package path.

**PARTIAL:** Foundation Run Kernel and ExperimentalCoreRuntime overlap. Foundation now delegates Hub runs through the existing runtime and verifies canonical ContextStore provenance without journaling model-visible personal text, but the production runtime still needs one named, consolidated ownership boundary rather than a third orchestrator.

**CURRENT:** Provider secrets are encrypted only through OS secure storage and renderer-facing bridge responses reduce providers to metadata. The store fails closed when secure storage is unavailable.

**CURRENT containment:** `services/tomnyModelDiscovery.ts` no longer performs remote credentialed model refresh or protocol verification. Before it reads a credential or endpoint or calls a transport, it returns already configured saved-provider model identifiers when present; otherwise it returns the stable `PROVIDER_MODEL_DISCOVERY_REMOTE_DISABLED` denial. The native Main bridge remains sender- and account-bound and can serve the saved model list, but it is not a governed discovery executor. Remote refresh stays disabled until a shared Main contract binds authenticated actor and sender/origin, run identity, destination, opaque secret lease, final-egress inspection, cancellation, durable receipt, and a focused acceptance test. `tests/unit/agentChat/tomnyModelDiscovery.test.ts` proves both no-access/no-fetch denials and saved-model fallback.

**CURRENT containment:** An `app-provider:*` model is rejected with the stable redacted `APP_PROVIDER_CHILD_CREDENTIAL_ENVIRONMENT_UNSUPPORTED` error before Main reads its saved-provider record, resolves a credential, prepares child environment, or spawns the Tomny CLI. No `API_KEY` or `BASE_URL` reaches that child and no direct-fetch fallback is introduced. Explicit local loopback and supported CLI targets retain their own paths. **BLOCKED:** BYOK app-provider execution through Tomny Core requires a verified sealed child protocol in which the child requests a provider operation and Main owns the destination-bound credential transport, final-egress enforcement, and receipt; the existing environment-variable CLI protocol cannot meet that boundary.

## SECURITY TRAINING PREFLIGHT — BLOCKED

**Current v8 Phase-0 findings:**

- train: 60 rows / 30 reasonCodes
- validation: 20 rows / 10 reasonCodes
- validation unseen vs train: 10/10
- LOCAL_SECRET absent from train
- closed-ontology split invariant: FAIL

**Consequences:**

- v8 is diagnostic only
- v8 confirmed limitations of generative CausalLM for egress classification (prompting migration to Laya Decision Engine)
- candidate remains inactive
- GPU_ALLOWED=false

**Before next paid run:**

- [ ] validation.reasonCodes ⊆ train.reasonCodes
- [ ] test.reasonCodes ⊆ train.reasonCodes
- [ ] scenario-family leakage = 0
- [ ] exact duplicate leakage = 0
- [ ] fresh acceptance holdout created
- [ ] assistant supervised labels decoded and verified
- [ ] target truncation = 0
- [ ] exact LoRA last-block targets documented
- [ ] evaluator contract verified
- [ ] hashes/config/revision frozen

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

## Deferred broad model gateway design (TARGET, 2026-09-08)

**Review state:** the broad design below remains proposal material. The focused Provider Relay replacement, connector configuration mutation and 9Router runtime/build removal are implemented and evidenced above; OAuth live-provider eligibility and the broad MTUI proposal remain separately gated.

### Research evidence and reuse boundaries

The inspected upstream is decolua/9router version 0.5.40 at commit 79918c7830695bbca4a45c9fea4a42c3e9fd73d1. Paths beginning with open-sse/ or src/lib/oauth/ below refer to that pinned upstream, previously checked out in a temporary reference workspace that was removed after the focused replacement gate passed. Claims describe inspected code, not measured production quality.

| Area                        | Evidence                                                                                                                                                                                                   | Assessment                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Upstream build              | the legacy preparation script is retained only as historical compatibility source and is no longer invoked by development or packaging                                                                     | CURRENT source only; no development or packaging dependency after Provider Relay replacement acceptance                           |
| Existing Tomni HTTP gateway | packages/desktop/src/process/tomnigateway/server.ts serves auth, collections, WebUI and MCP routes                                                                                                         | CURRENT host infrastructure; a compatible model inference API is not demonstrated by those routes                                 |
| Provider execution          | shared Main ProviderExecutionBroker and the containment evidence in this document                                                                                                                          | PARTIAL reusable transport/security seam; external CLI admission and streaming parity still need proof                            |
| Client distribution         | common/router9/connectorEngine.ts emits Claude JSON, Codex Responses TOML, OpenClaw JSON and environment/manual fields; process/router9/router9Applier.ts and router9Lifecycle.ts own application/recovery | CURRENT config-building code; detecting or writing config does not prove protocol compatibility or permission                     |
| Managed runtime             | legacy process/router9/managedRouter9.ts remains as unregistered compatibility source; the production bootstrap no longer starts it or packages its resource                                               | CURRENT lifecycle, distinct from the source checkout                                                                              |
| OAuth                       | upstream src/lib/oauth/utils/pkce.js and open-sse/services/oauthCredentialManager.js provide PKCE/state and refresh coordination                                                                           | CURRENT upstream code; provider eligibility, client registration and Tomni integration remain BLOCKED per provider until verified |
| Usage and quota             | upstream open-sse/services/usage/, src/lib/db/repos/usageRepo.js and the former Tomni overlay (removed with the legacy build dependency)                                                                   | CURRENT separate quota polling and request/session usage mechanisms; upstream estimates are not an account balance                |
| Efficiency                  | upstream open-sse/rtk/index.js, filters/, headroom.js, pxpipe.js and chatCore.js                                                                                                                           | CURRENT implementations; benefit on Tomni tasks is TARGET evidence                                                                |

Desktop-relative paths in the table are under packages/desktop/src/. Reuse contracts and proven helpers, not an entire subsystem by name. Provider-facing OAuth is distinct from Tomni login and inbound MCP OAuth; sharing a gateway port does not share credentials or grants.

### Architecture and minimum product scope

TARGET: reuse the existing Node HTTP host and Main lifecycle after a route/auth isolation test. Add a bounded model route group backed by the shared provider broker; do not start another orchestrator or ship Next.js, the 9Router dashboard or its complete provider catalog. A remote-enabled WebUI/MCP listener must not automatically expose model routes; require loopback binding/isolation and a separate model-consumer credential.
**PARTIAL (C1, 2026-09-08):** TomniGateway dispatches bounded non-stream POST /v1/chat/completions and /v1/responses plus GET /v1/model-requests before its normal gateway-session check and requires a separate model-consumer credential. It bounds and validates JSON, rejects streaming explicitly, propagates client cancellation, returns an OpenAI-compatible non-stream response, and exposes consumer-scoped request history filters. The production lifecycle accepts only an injected Main-owned model service; without it model routes remain disabled. createBrokerBackedTomniModelService adapts ProviderExecutionBroker, rechecks revocation/model allowlists, and records hash-chained request terminals with reported/estimated/unavailable usage. Durable quota snapshots and the opt-in encrypted, actor-bound replay store are PARTIAL; provider quota adapters and connector distribution remain TARGET, while provider OAuth is PARTIAL pending live provider authorization and revocation evidence.
**PARTIAL (C1 credential boundary, 2026-09-08):** modelConsumerVault now stores only encrypted consumer records containing credential digests, binds resolution/revocation to the active Main account, enforces expiry and model allowlists, supports explicit credential rotation that invalidates the prior digest, and returns plaintext gateway credentials only from explicit issue/rotation calls. Production bridge composition creates this registry and injects the broker-backed service; no consumer is provisioned implicitly.
**CURRENT local-first ingress guard (2026-09-09):** When model routes are enabled, startTomniGateway rejects non-loopback hosts before binding. The modelRoutes test covers rejection of 0.0.0.0. The gateway remains loopback-only for model consumers.
**CURRENT scope correction (2026-09-09):** The local-first MVP uses an upstream provider API configured by URL and API key (or optional OAuth) behind the Main-owned broker. A separate Ollama, LM Studio or other local inference engine is not required. The loopback requirement applies only to Tomni's consumer gateway ingress, which distributes scoped credentials/configuration to third-party clients.
**PARTIAL (C1 distribution boundary, 2026-09-09):** Main-owned consumer apply revalidates the account, credential digest, expiry/revocation and model allowlist immediately before invoking the injected configuration writer; the model bridge has no direct 9Router lifecycle dependency. It accepts only the HTTP loopback Tomni gateway origin (`127.0.0.1`, `localhost` or `::1` on port `20129`, `/v1`) and routes writes through the existing CAS-protected `Router9ConfigSession`; upstream provider secrets are never distributed. Remote origins, mismatched credentials and revoked/model-denied consumers fail closed before filesystem effects.
**CURRENT focused replacement evidence (2026-09-10):** The Main bootstrap no longer registers the legacy managed 9Router bridge or starts/stops a bundled 9Router process. `prepare:dev`, the package build wrapper and electron-builder no longer prepare or copy `bundled-model-gateway`. A fresh Windows unpacked build has no such resource; the packaged lifecycle verifier passes. The retained connector/config helpers are compatibility-only distribution code used by the Tomni gateway consumer path, not a 9Router runtime or upstream-secret path.

**PARTIAL (C1 history/quota boundary, 2026-09-08):** Model requests append private, hash-chained started/terminal events through `JsonlDurableEventStore`, expose consumer-scoped `GET /v1/model-requests`, and classify usage as reported, estimated, or unavailable. Main also persists actor-bound quota snapshots, rejects older observations, and marks stale cache data explicitly. Actor-scoped replay preview/export/delete controls are exposed through `/v1/model-replay`; capture remains opt-in and encrypted. Settings > Model now presents consumer-scoped request count/status, quota status and replay-sample state through authenticated Main IPC; values remain unknown when no source exists. `GET /v1/model-quota` still returns explicit unknown/unsupported quota until a provider quota adapter is verified; no local request total is treated as account balance.

Request flow: authenticated consumer -> scoped model route -> governed run admission and budget reservation -> provider broker -> optional approved tool-output reduction -> final egress validation -> selected API/OAuth transport -> normalized stream, usage and terminal receipt. Provider auth is resolved only at final transport. Cancellation and revocation propagate through every stage.
**CURRENT usage detail evidence (2026-09-10):** The provider broker accepts OpenAI-compatible flat and nested cache/reasoning usage details and carries them through durable model history and the Responses-compatible gateway envelope. Missing detail fields remain absent; they are not represented as zero or inferred.

| Product area | Minimum useful behavior                                                                                                               | Beyond initial acceptance                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Connections  | Retain API-key providers; add one verified provider OAuth flow, connection health, explicit model/capability selection and disconnect | Additional OAuth providers as independent adapters                  |
| Distribution | Configure one CLI and one generic app; per-consumer gateway credential, model allowlist, revoke/rotate, preview and restoration       | Additional versioned client formats                                 |
| Usage        | Native Tomni connection/quota view and request history filtered by consumer, session, model, status and time                          | Advanced reports                                                    |
| Benchmark    | Request metadata plus opt-in redacted replay samples, export preview, retention and deletion                                          | Automated quality-based routing                                     |
| Efficiency   | Disabled-by-default local filter pilot with per-consumer opt-in and measured benefit                                                  | External compression, image conversion and broad semantic rewriting |

Keep UI in the existing native provider/settings area with Arco controls, existing i18n and opaque metadata. Quota visibility and request history are required, not removed to make the gateway smaller. Optional benchmark studios remain Store packages; core exposes only the bounded receipt/export contract.

### Provider and model contract

API and OAuth are authentication choices over explicit provider adapters, not interchangeable endpoint protocols. Each descriptor includes provider/account identity, auth method, allowed destinations, model IDs, input modalities, tool/structured-output/reasoning support, context/output limits, supported wire protocols and usage/quota capabilities. Unknown capability is explicit; reject unsupported translation rather than silently dropping content.

For each OAuth provider, verify official authorization/token endpoints, client registration, scopes, permitted API access and quota endpoint. Support PKCE S256/state/one-use callback or documented device flow, cancellation, expiry, refresh serialization, rotated refresh-token persistence, disconnect and revoked/invalid-grant behavior. Use OS secure storage and redact callback/token errors. A provider without the necessary integration contract stays BLOCKED; do not reuse another application's client identity or import private CLI credentials as a substitute.
**PARTIAL component evidence (2026-09-09):** `providerOAuthClient.ts` adds a Main-only OAuth authorization-code client with PKCE S256/state binding, strict HTTPS provider endpoints and loopback redirect checks, bounded token parsing, redirect refusal, serialized refresh, rotated-token persistence, invalid-grant credential removal, and local-first disconnect. Focused tests pass and Settings > Model integration is wired; live provider authorization, official eligibility, and quota adapters remain BLOCKED/TARGET. The descriptor requires TOMNY_OPENAI_OAUTH_CLIENT_ID and does not reuse the 9Router client identity by default.

**CURRENT component evidence (2026-09-09):** `providerOAuthVault.ts` now provides an account-bound, Main-only, OS-encrypted durable vault implementing the existing `ProviderOAuthVault` contract. It serializes mutations, fails closed when secure storage is unavailable, rejects malformed/oversized records, and removes only the active account's provider record. Two focused vault tests pass. Main OAuth controls are now exposed through typed provider IPC when an explicitly verified client map is injected. Official-provider review confirms OpenAI supports ChatGPT sign-in and API-key sign-in for local Codex clients, but it does not publish a third-party client registration contract for this desktop integration. Tomny must supply and approve its own client identity and provider policy before admission; no 9Router or private Codex client identity is reused.

**CURRENT provider compatibility component (2026-09-09):** Existing `IProvider` and provider API contracts now carry optional `auth_type: 'api-key' | 'oauth'`, defaulting to `api-key`; protocol selection continues to infer from the platform for these transport modes. `ProviderExecutionBroker` accepts an optional Main-only credential resolver for OAuth bearer tokens while preserving the existing API-key fallback, and fails closed before socket creation when an OAuth resolver is absent or returns no credential. OAuth providers without an admitted resolver remain unavailable by design.

Target protocol matrix: OpenAI Chat Completions for generic apps, OpenAI Responses for the existing Codex connector, and Anthropic Messages for Claude clients. Ship only passing cells. Preserve tool IDs, ordering, reasoning metadata, finish reasons, multimodal blocks and structured-output semantics; explicitly reject unsupported cells. Do not blindly retry after streaming output or an ambiguous accepted provider request.

### CLI/app distribution and authorization

Reuse connector discovery, plan generation and recovery after contract tests; configuration detection only proposes an edit. Preview affected keys, merge without overwriting unrelated settings, back up before atomic replacement, detect concurrent edits, and restore only values still owned by Tomni. Disable/revoke the connector credential immediately even if restoration encounters a conflict.

A CLI/app receives a scoped gateway credential, never an upstream API key or OAuth token. Persistent independent clients need a revocable installation credential; supervised runs may use a shorter lease. Bind authority and attribution to the credential record, not client-supplied consumer/session headers. Apply model/provider allowlists, request/concurrency/budget limits, expiry, host/origin rules and request-size caps. The gateway must enforce policy even if a user edits the client config.

External clients require a trusted ingress mapping to actor, origin, run and permission; do not treat localhost or a valid provider login as authorization. This is a new acceptance boundary. The existing APP_PROVIDER_CHILD_CREDENTIAL_ENVIRONMENT_UNSUPPORTED containment remains until the sealed child/brokered transport contract is proven.

### Usage, quota and retained requests

Keep three concepts separate:

- Credential state: API/OAuth/gateway credential expiry, validity and revocation.
- Provider quota: account/model window, unit (tokens, requests, percentage or credits), observed remaining/used, limit, reset time, source and observedAt/staleAfter.
- Request usage: provider-reported input/output/cache/reasoning counts, local estimates and cost estimate, associated with request/run/attempt/consumer/session.

Unknown quota is unknown, never zero or unlimited. Local request totals cannot infer account quota when other tools use the same account. Near-limit indicators use the reported unit and freshness; show stale/unsupported explicitly. Refresh uses bounded polling, backoff and allowed destinations; never spend quota-reset credits automatically.

Use existing receipt/storage infrastructure before adding a schema. Proposed records are request/attempt usage, quota snapshots and an optional replay-sample reference. Include schema version, provider/model and consumer IDs, timestamps, latency, stream termination, cancellation/error code, measurement source, tokenizer/pricing revision and filter version. Deduplicate completion/stream usage and retries; cached and reasoning counts may be subsets, so avoid adding them twice. Disconnect mid-stream records unknown final usage and later reconciliation where supported. Usage reporting does not mutate the credit ledger.

Default history stores metadata only, not raw prompts, outputs, auth headers or payload hashes presented as replay data. Opt-in capture saves redacted input/output/tool context in encrypted local storage with a configurable TTL/size cap (proposed defaults: 7 days/100 MB); metadata retention is proposed at 30 days. Allow preview, export, deletion and capture-off. Deleting replay content preserves the minimal durable receipt required by audit/billing policy. Hashing alone cannot support replay or guarantee anonymity.

Benchmark export requires an independently reviewable, redacted sample plus model/settings, tokenizer, schema, filter versions and expected checks. No automatic training use or live provider replay. Raw account secrets and private context must not enter exported fixtures.

### Current UI location

**CURRENT:** Tomni's **Settings > Model** screen at `/settings/model` is the connection and distribution surface. Its native host is `packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx`, with the existing 9Router distribution panel at `packages/desktop/src/renderer/pages/settings/router9/Router9ConnectorPanel.tsx`. This screen is for adding and selecting LLM providers through API credentials or eligible OAuth, checking model capabilities, and generating/recovering CLI/app configuration. It is not the Token Saver screen.

**CURRENT:** The embedded upstream Token Saver page is separately located inside the 9Router dashboard at `/dashboard/token-saver`, previously implemented by the inspected 9Router reference dashboard. Its controls cover RTK, Headroom and other upstream features. The replacement plan studies the useful deterministic parts for MTUI, but does not move Token Saver controls into the provider connection panel.

**TARGET:** Preserve Settings > Model for the replacement API/OAuth connection and CLI/app distribution flow. OAuth and replacement protocol support remain subject to their acceptance gates. MTUI token-efficiency work is a separate engine concern; this design does not assign or relocate its UI.

### Unified MTUI efficiency engine (TARGET)

MTUI is the single owner of tool-output reduction. Integrate selected RTK techniques into its existing Rust compact engine; do not ship a second RTK service or run two independent compression pipelines. Gateway and external-client adapters may invoke this same bounded engine for eligible tool results. Existing MTUI-produced results carry trusted version/provenance metadata and are not compressed again. Client-provided metadata cannot bypass validation, size limits or egress policy.

Implementation scope: first map RTK filters to MTUI profiles and reuse existing equivalents. Add only missing, useful handling for git status/log, search/list/tree output and repeated build/test diagnostics. Retain original-output retrieval, error/result identifiers, occurrence counts and explicit omission markers. Unknown formats pass unchanged; code, diffs, structured tool arguments and exact-output data require preservation contracts before any reduction.

Headroom is a source of techniques to research, not a required proxy dependency. Evaluate deterministic JSON-aware reduction within MTUI, then AST-aware source selection if existing parsers suffice and query-anchor retention passes. A screenshot or the name SmartCrusher does not establish that its implementation is small, deterministic or safe to port: inspect pinned implementation, dependencies and licensing first. No Headroom server, Python/ML runtime or image conversion is added to the minimum product. Caveman/Ponytail prompt injection is removed from product and benchmark scope.

Use a bounded profile-selection pass, followed by the selected reduction stages inside MTUI. Avoid repeated parsing and tokenization; measure before optimizing. Preserve a validated copy and commit only a useful result. Filter failure retains the original subject to hard limits; security failures always deny. Retain retrieval under the original run authority, and validate final egress after transformation. Do not add a new lifecycle owner or unrequested plugin/filter framework.

### Research evidence and performance acceptance

The local 9Router reference is 0.5.40 at 79918c7830695bbca4a45c9fea4a42c3e9fd73d1. On 2026-09-08 upstream master and npm reported 0.5.69 at eb712ca821f0ba6bc41043fbd14494c5af5daba5. Source: https://github.com/decolua/9router/tree/eb712ca821f0ba6bc41043fbd14494c5af5daba5 . The screenshot's v0.37.0 identifies Headroom extras and its Stopped state does not prove active compression.

Inspected RTK index.js uses JavaScript string.length for fields named bytesBefore/bytesAfter, not real model-token counts; dedup and truncation can omit meaningful content. Its index.js and Caveman/Ponytail injector files were unchanged between those revisions, while headroom.js differed; this is not a full dependency comparison. No advertised savings percentage is acceptance evidence.

Current-revision MTUI evidence (2026-09-09) uses o200k_base with 2 warmups and 15 timed runs per case. On the frozen 11-log corpus, weighted full-JSON wire reduction is 50.855% with 32/32 critical signals retained; the 10 Compass source-slice cases reduce wire tokens by 70.513% and retain 29/29 requested anchors; bounded reads reduce wire tokens by 84.788%. All 31 cases are deterministic; latest maximum case p95 values are 16.68 ms for compact, 21.966 ms for Compass and 14.615 ms for bounded read. This is local-corpus evidence, not a universal claim.

**CURRENT benchmark extension (2026-09-09):** A paired run on the same 11-log corpus now records an uncompacted baseline and five one-stage ablations in `.tmp/mtui-benchmark-ablation-20260909-final/latest.json`. Integrated MTUI reduced complete wire JSON by 54.976% versus the uncompacted baseline while retaining 32/32 diagnostic signals and remaining deterministic. Disabling `important-lines` reduced weighted signal recall to 71.875%; disabling `head-tail` reduced it to 81.25%. This is diagnostic local evidence only: task success/retries, response-token accounting across real provider calls, retrieval follow-ups, peak memory, and clean-revision comparison remain open.

Primary benchmark: frozen current MTUI baseline versus MTUI with selected integrated filters, then candidate ablations with each new filter disabled. Compare identical inputs, limits, tokenizer, hardware and runtime settings. RTK-only fixtures are optional references for matching filter behavior, not a whole-product competition or a requirement to maintain a separate runtime.

Measure full-envelope input tokens, requested-anchor/diagnostic retention, exact-output correctness, retrieval follow-ups, task completion/retries, total provider input/output/cache/reasoning cost where available, p50/p95 latency, peak memory and binary/dependency footprint. Include short logs, Vietnamese/English Unicode, large JSON, repeated failures, source queries, already-compacted results and hostile tool output. Label estimates and record source/binary hashes, fixture versions and tokenizer revisions.

Proposed gate: all security/exact-output fixtures pass; all explicitly requested anchors survive or trigger a declared uncompressed/bounded-retrieval fallback. Achieve at least 10% median incremental token reduction on the predeclared subset targeted by new filters relative to current MTUI, without regressions on unaffected profiles or observed task success. Count metadata and retrieval costs; reject candidates that merely hide useful text. Target p95 local filter processing <=20 ms for inputs <=256 KiB on a recorded reference machine, with peak-memory and startup budgets frozen from the baseline before implementation. Report whole-task and eligible-subset results separately.

The goal is MTUI exceeding the useful RTK capabilities in coverage, fidelity and efficiency. This remains TARGET until measured; more features alone do not establish superiority. When baseline already saturates compression, accept equivalent token counts only for a predeclared fidelity or latency improvement. Keep unsuccessful filters disabled or remove them. Do not inject live paid replay, train on request history, or expand implementation scope before design review.

### Rollback and retirement

Keep the pinned source clone and bundle unchanged during design. Compare offline fixtures and synthetic replay first; do not duplicate live paid requests in a silent shadow mode. Cut over one protocol/provider/consumer cell at a time with a kill switch; disable an affected cell when permission, stream, quota or receipt evidence fails.

Rollback can select the old runtime only if it satisfies current permission/egress/credential contracts; otherwise disable that cell and retain working API/CLI paths. Never restore revoked tokens or blindly revert user configs. Retain readable usage receipts and backward-compatible data migration until recovery is proven.

Remove 9Router preparation, clone, bundle, dependency references and overlays only after every selected cell passes clean-build/offline-start/install/uninstall and footprint acceptance. If any upstream code is copied, record its pinned provenance and applicable license/NOTICE; independence from the runtime is not independence from attribution obligations.

## Immutable semantic model decision (Standardized on Laya, 2026-09-21)

**CURRENT decision:** Generative autoregressive Qwen models (both Qwen 2B and Qwen 0.8B LoRA) are superseded by the **Laya Decision Engine** (322M mmBERT-base / 421M ModernBERT-large). Laya runs non-autoregressively (~33ms) via single forward pass classification, eliminating token-by-token latency, multi-agent queue congestion, and JSON syntax tearing. Laya exclusively serves local security, user-understanding, and semantic-analysis decisions. Orchestration and generic reasoning use an eligible API LLM; local decision heads never plan, authorize, choose destinations, or execute side effects.

The Orchestrator uses an eligible API LLM as its reasoning target. No local orchestration adapter is trained or bundled; the local Laya Decision Engine is reserved for deterministic classification and security decisions. The selected target proposes structured steps only; Run Kernel, Capability Resolver, TrustBroker, Package Supervisor, and ResourceCoordinator retain their respective deterministic authority.

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

### Managed model lifecycle target

The signed catalog, download, and managed model-store lifecycle below is the long-term platform target. It is not required to hold the Core plus Store candidate behind a model manager: that checkpoint uses an explicitly configured, previously installed loopback engine and model and fails closed when they are unavailable.

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

A mocked broker or test-only ModelPack path does not satisfy this gate. Until the managed model path is wired, the user-owned loopback engine and model must be provisioned explicitly before this clean-machine journey can pass.

## Cloud model APIs

This section describes remote model inference, not cloud VM or container execution. Managed compute provisioning is owned by [managed cloud execution](../platform/cloud-execution.md).

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

Local AI, BYOK, and compliant user-authenticated CLIs are free platform paths. A Tomni-managed model call additionally uses the authoritative lifecycle in [credits and billing](../platform/credits-and-billing.md): versioned quote, atomic Credit reservation, execution, normalized metering, exactly-once settlement, release or refund, and reconciliation. A model adapter never changes the wallet directly. Failure of this managed-AI gate disables only managed purchase; it does not disable Store checkout, managed cloud as a separately gated target, or the free target paths.

Enterprise, volume, embedded-use, or resale discounts remain BLOCKED assumptions until a signed provider agreement grants them. Until then, the managed rate card covers the actual public or contracted provider cost and the complete transaction reserve.

## MVP adapter set

The first contract suite must cover:

- one local-only OpenAI-compatible target on an explicit loopback engine (for example Ollama or LM Studio), with no Hub egress or cloud fallback;
- one cloud API adapter using write-only credentials;
- one supervised provider or coding CLI;
- one MCP tool path.

A package target joins Core plus Store evidence only after the versioned syscall ABI and tiny signed pilot pass. That dependency does not block the four base target fixtures.

Every target is invoked from the same ordinary Hub surface and the same Run Kernel. Feature-specific UI cannot call an adapter directly.

## Acceptance evidence

### Core plus Store target evidence

- ExperimentalCoreRuntime is renamed or absorbed; only one production Run Kernel owns lifecycle.
- Every enabled release-candidate surface reaches that kernel; unmigrated executors are feature-flagged off.
- Provider metadata APIs never serialize API keys to renderer code.
- Reversible Base64 secret fallback is removed; credential rollback never restores it.
- Offline end-to-end execution passes on a clean supported machine through `bun run test:release:local`; the user provisions an explicit loopback endpoint and installed engine/model, and a mock or cloud fallback cannot pass the gate.
- The loopback adapter covers health, stream ordering, cancellation, engine disconnect or crash, restart, cleanup, and fail-closed unavailability. App-managed model download, update, and uninstall remain separate target evidence.
- Cloud, CLI, local, and MCP adapters pass the same contract tests; the signed pilot joins after package ABI completion.
- Target selection is deterministic over capability, privacy, allowed pin, health, ResourceCoordinator availability, and hard budget. Learned quality, predictive latency, and cost optimization remain P1.
- A failed target falls back only to a policy-compatible target and records the reason.
- No cancelled run leaves an adapter process, model lease, socket, or pending terminal state.

### Full managed-usage evidence

- A managed-AI call accepts a versioned maximum quote, reserves Credit before the provider call, meters normalized actual usage, settles exactly once, releases the remainder or refunds under policy, and reconciles provider invoice, ledger, usage, and Run receipt.
- Missing or stale price, failed reservation, duplicate payment event, or reconciliation mismatch prevents further managed spending without disabling BYOK, local, CLI, MCP, Store checkout, or already valid entitlements.
- The model adapter reports usage but cannot mint, reserve, settle, refund, or otherwise mutate Credit.

## Rollback and kill behavior

Rollback disables one target adapter or the managed-AI purchase switch while preserving readable Run and billing receipts and every policy-compatible free path. It never restores raw credentials, cloud fallback for a local-only request, an uninspected egress path, or a peer lifecycle owner.

A renderer secret, direct feature-to-adapter bypass, policy-incompatible fallback, duplicate terminal event, charge before reservation, settlement above the accepted maximum, unreconciled provider usage, or orphan process, socket, or model lease keeps the affected gate red and stops that target.
