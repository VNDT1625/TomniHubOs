# Trust and user understanding

**Status:** TARGET architecture built from PARTIAL security, context, and secret components.

Trust and user understanding form one product core because useful autonomy requires both: the system needs enough private context to reduce repetition, and a strict boundary that prevents context from becoming uncontrolled authority or outbound data.

## Release checkpoint boundary

TrustBroker and causal User Intelligence are mandatory for both the **Core plus Store candidate** and the **Full managed-usage MVP**. Store checkout, managed AI, and managed cloud can be disabled independently, but an enabled path never receives a weaker identity, permission, secret, egress, context, recovery, or audit seam.

## Current evidence

**PARTIAL:** packages/desktop/src/process/agentRuntime/contextStore.ts stores scoped facts, preferences, and habits with provenance and a causal chain. `needs_reason` prevents unexplained repetition from changing a projection, and a legacy applied/corrected record without a reason is downgraded and excluded from model-visible context; only a reasoned correction can apply its scoped fact. A persisted, explicit learning pause is controlled through strict main-process IPC: while paused, new learning proposals fail closed while correction, forgetting, deletion, export, and explicit profile changes remain available. contextComposer.ts builds bounded projections. secretVault.ts provides opaque secret references and platform-backed protection.

**PARTIAL:** agent-mesh security and services/security/outboundTextInspection.ts provide secret and outbound-text inspection primitives. They are not proven on every provider, CLI, remote, package, browser, automation, and IPC path.

**PARTIAL:** services/security/semanticEgressGuard.ts deterministically scans the exact Main-owned serialized provider payload, redacts detectable secrets, caches only low-risk hash/version evidence, and fails closed for gray-zone/OCR-origin content when its injected local classifier is unavailable, malformed, non-allow, or past the 30-second queue-plus-inference deadline. ProviderExecutionBroker invokes it before final Trust inspection and transport, writes hash-only classification evidence before its socket opens, and denies when that audit write fails; the guard has no authority to bypass destination, permission, secret-lease, or Trust checks. Production wiring standardizes on the Laya Decision Engine (~33ms non-autoregressive encoder) within the Composable Chat Pipeline (layaSecurityStage.ts). tests/unit/security/semanticEgressGuard.test.ts, tests/unit/security/semanticEgressAuditSink.test.ts, and tests/unit/agentChat/providerExecutionBroker.test.ts prove redaction, gray-zone fail-closed behavior, cache invalidation, deadline denial, payload-free audit evidence, and audit-write failure denial.
**CURRENT CONTEXT (2026-09-21):** Generative autoregressive Qwen models are superseded by the **Laya Decision Engine** (~322M/421M non-autoregressive encoder). Laya executes via a single forward pass without token-by-token decoding overhead, returning typed decisions within ~30ms – 35ms. It serves three local decision axes: security (Semantic Egress Guard & Chat Pipeline pre-query filter), user-understanding (confirmed-only memory signals with mandatory \
eeds_reason\), and semantic-analysis (tool & skill routing). Orchestration uses an API LLM. A user request enters the Main process, where exact serialized payload inspection runs first: registered secrets are matched by keyed fingerprints and never passed to renderer, model, cache, audit, or provider. Only unresolved gray-zone content enters bounded local Laya decision inference. Laya returns typed decisions conforming to security-ontology-v1.json with zero risk of malformed JSON syntax. Understanding runs asynchronously and confirmed-only: it can propose a scoped preference/fact/decision/habit, but never grants authorization.

**CURRENT:** Main-only `services/security/systemEgressAuthority.ts` closes the pre-auth bootstrap classes at their call sites: configured-origin OIDC, the pinned signed desktop-update feed, signed Store catalog refresh and artifacts, and explicitly opted-in Sentry diagnostics. OIDC discovery, token, JWKS, and user-info fetches each reject redirects at the protocol client. It denies diagnostics by default and does not account-gate signed updates or signed catalog refresh. A Store artifact may fetch only with an opaque binding retained from the exact URL in a verified remote catalog; the downloader authorizes that exact public HTTPS URL immediately before fetch and rejects redirects. Local development loopback artifacts require their separate explicit development switch. The legacy renderer-controlled GitHub REST/manual-asset update fallback was removed: only the native signed updater may discover, download, and install an update. In packaged builds, the catalog loader admits only its pinned HTTPS release origin before fetch, disallows redirects, and retains only verified cache or bundled fallback when unavailable. Native updater IPC providers reject destroyed, subframe, wrong-origin, and wrong-file senders before dispatch; they remain available before account sign-in for security patches. The same trusted-renderer guard now protects the synchronous preload bootstrap state routes, returning only safe empty values to an untrusted caller. `tests/unit/security/systemEgressAuthority.test.ts`, `tests/unit/security/browserOidcClient.test.ts`, and the package-manager egress tests prove the closed allowlist.

**CURRENT:** generic Shell OS-handoff providers (open file/reveal, open external, tool probe, and open folder) reject destroyed, subframe, wrong-origin, and wrong-file senders before the generic adapter dispatches them. User-visible `shell.open-external` is an OS handoff rather than application network egress: it admits only credential-free HTTPS or literal-loopback HTTP, rejects fragments, `file:` and arbitrary custom schemes, and retains the fixed `vscode:` handoff solely in the folder operation. This does not substitute for governed application egress. `tests/unit/common-adapter/main.test.ts` and `tests/unit/bridge/applicationBridge.test.ts` prove the boundary.

**CURRENT:** generic `tomny-provider.*` discovery and mutation callbacks—and the catalog provider-health shortcut—are disabled. Saved-provider settings and Agent Catalog health use the typed native provider-discovery route, which accepts only a saved provider ID after trusted-sender and online-account checks. Main resolves its stored secret and performs bounded, no-redirect discovery only against HTTPS public destinations or literal loopback HTTP. URL credentials, fragments, private/DNS-rebound destinations, raw renderer keys, and oversized or timed-out responses fail closed. A stored credential is cryptographically bound to its canonical endpoint: endpoint change requires explicit key rotation and legacy unbound records fail closed.

**PARTIAL:** saved Telegram configuration no longer starts a polling, send, or public-tunnel transport merely after account admission. Absent Main external authority denies before token resolution, fetch, secret/gateway creation, or Cloudflared spawn; revocation aborts an active long poll and sign-out/expiry stops registered leases. It remains containment until Telegram operations receive run-bound capability, final-egress, and transport-receipt enforcement.

**PARTIAL:** shared Main `agentChat` execution—including Browser/Manager and Company Chat/Generator—has no direct-fetch fallback: a `ProviderExecutionBroker` resolves the stored provider by ID, creates a Main-owned run/task identity, requests a FoundationTrustRuntime grant and destination-bound opaque secret lease, inspects the exact serialized request, and uses DNS-pinned no-redirect bounded transport with redacted evidence. Bootstrap registers the Company generator only after composing this broker, so Company model calls share the final serialized-payload guard and audit seam. A `ProviderDestinationAuthority` admits only account-bound, saved canonical endpoint/version evidence for this exact `tomny://provider-execution` origin; it expires quickly and config change, account change, or revocation denies before secret lease or socket. Static policy remains unchanged for every other route. The supervised Core child now rejects every `app-provider:*` target before saved-provider lookup, secret resolution, child-environment construction, or spawn, using a stable redacted error; it makes no direct-fetch fallback. That is containment only. **BLOCKED:** a verified sealed Core child `provider_request` protocol and Main-owned destination-bound transport are still required before BYOK app-provider Core execution can be enabled.

**PARTIAL:** remote speech transcription is disabled: its Main boundary returns `STT_REMOTE_TRANSPORT_DISABLED` before authority invocation, provider configuration or API-key access, audio serialization, network I/O, or remote artifact effects. It retains only a secret-free, bounded metadata contract for a future Main Trust transport; that transport must prove account/run and destination binding, final-payload inspection, opaque credential lease, cancellation, and durable receipt before remote transcription can be enabled. `tests/unit/contentExtract/speechTranscription.test.ts` proves the fail-closed order. RTK/ExpBase remote embedding likewise defaults to deterministic local hashing without inspecting provider credentials or sending text; an admitted operation is bounded and no-redirect.

**PARTIAL:** `native-fs` remote-image fetch is deny-by-default before URL parse or network I/O. A Main-injected authority must admit the exact canonical HTTP(S) URL; credentials, fragments, redirects, and authority/transport details are rejected or redacted. Local file operations remain unchanged. This is containment pending a full governed egress transport.

**PARTIAL:** News remote feeds/realtime/bots, Manager weather/travel optimization, Remote Core, and Git remote operations are deny-by-default without their operation-specific Main authorities. Denial occurs before remote provider setup, credential resolution, fetch/WebSocket/timer, or Git child spawn; cached/local News and Manager/Git local operations remain available. These authorities are containment, not final run-bound Trust transports.

**PARTIAL:** Automation external leaf execution is contained at its shared workflow seam. HTTP, provider, cloud, email, social, and unknown future external nodes—and Automation Chat—default-deny before executor, credential, or provider work unless Main supplies a governed-egress authority. This containment is not the final TrustBroker migration: run-bound grants, destination-bound secret leases, redirect/presigned-URL revalidation, final serialized-payload inspection, and durable transport receipts are still required before Automation can be enabled for release.

**PARTIAL:** `common/foundation/trustTypes.ts` freezes the shared request, grant, final-egress, and opaque-secret-lease shapes. Main bootstraps one account-bound `FoundationTrustRuntime` (`foundation-v1`): its RunKernel preflight, Hub target/egress, reachable goal-capability derivation, and the dev-only C4 action pilot receive the same broker and reject actor, origin, policy, kernel-identity, or revocation drift before start. The Hub requires a live origin-bound grant with actor, run, task, target, expiry, and policy version for serialized cloud prompt/output inspection. The opaque lease contains no secret bytes. Other compatibility callers and enabled provider/package/browser/automation routes still need migration; this is not yet the universal seam.

**BLOCKED:** learnPersonalFact exists as a context-store method but has no production caller. Therefore automatic user learning is not CURRENT.

**CURRENT:** the unused in-memory PreferenceManager was removed. ContextStore is the sole personal-context source, and its Main lifecycle profile is now an opaque derivation of the live online account; renderer code cannot choose a personal ID, account A/B and restart are isolated, and legacy shared default records are quarantined rather than auto-merged. Personal Settings now exposes only Main-returned owner-scoped learning records and explicit Confirm, Reject, Correct, Forget, Delete, Export, and pause controls; it never submits an account or profile identity and does not create automatic proposals or Trust routes.

**CURRENT:** tomnyProviderStore fails closed when protected storage is unavailable, persists provider secrets only through OS-backed encryption, and renderer-facing provider responses reduce credentials to metadata. An pp-provider:\* selection is rejected before its credential is read or prepared for the supervised Core child; it cannot use that child as a secret or egress path. Other supported CLI authentication remains a separate adapter contract.

**PARTIAL:** generic IPC registrations are not uniformly proven to validate sender identity and payload schema. The 19 exact native-fs filesystem, image, archive, mutation, and watch providers, the 26 exact MCP-registry, native-MCP, and native-Skill capability providers, the seven exact assistant-resource rule/skill plus speech-transcription providers, the three exact WebUI status/lifecycle providers, the ten exact Cron schedule and skill-content providers, the 17 exact Team lifecycle, member, workspace-group, task, and session-mode providers, the 12 exact Company creation, structure, rules, assignment, draft, conversation, and permission providers, the nine exact package-platform catalog, lifecycle, contribution, and asset providers, the seven exact Resource state/budget/lifecycle providers, the six exact System Info snapshot, priority, and stream providers, and the fifteen exact Omni Gateway local/remote MCP lifecycle, bearer/debug token, OAuth-client, and durable access-policy providers now reject destroyed, subframe, wrong-origin, and wrong-file senders at the generic Main adapter before callback dispatch; their individual payload, path, permission, signature, and capability enforcement remains separately required. tests/unit/common-adapter/main.test.ts proves each guarded literal from a trusted main frame and the untrusted-sender matrix. The generic adapter remains PARTIAL until every registration has equivalent identity and schema proof.

**PARTIAL:** the Hub/ExperimentalCore context bridge no longer imports IDE memory and rejects a learning proposal/correction without bounded context, origin, proposal, and a valid reason state before persistence. An ordinary conversation restart with the IDE package absent still needs end-to-end evidence.

## Threat model

Protect against:

- a compromised renderer or web surface;
- prompt injection and untrusted model output;
- malicious or compromised packages;
- unsafe CLI or child-process output;
- untrusted provider responses and remote relays;
- path traversal, archive bombs, signature downgrade, SSRF, and catalog rollback;
- accidental secret inclusion in prompts, logs, evidence, clipboard, screenshots, or telemetry;
- confused-deputy IPC and package calls;
- stale approvals, replayed side effects, and duplicated actions after restart;
- over-collection, wrong inference, silent retention, and context sent to an unintended target;
- destructive database injections, malicious SQL scripts, DDL/DML tampering (e.g., DROP, TRUNCATE, ALTER), and Row-Level Security (RLS) bypass attempts when dispatching mutations to remote cloud databases (e.g., Supabase).

Local compromise by an administrator is not fully preventable, but the design still minimizes plaintext persistence and blast radius.

## Trust pipeline

Every privileged action follows the same sequence.

1. **Identify origin** - user, core service, package identity, agent, adapter, renderer frame, remote session, and run.
2. **Normalize request** - validate schema, size, path, destination, data class, and requested capability.
3. **Resolve policy** - combine system deny rules, package manifest, user grant, workspace scope, and run scope.
4. **Project context** - select only purpose-bound records and attach provenance; redact secret material.
5. **Acquire leases** - capability and resource leases have owner, scope, limits, expiry, and revocation.
6. **Propose side effect** - record destination, payload classification, idempotency key, and recovery rule before execution.
7. **Inspect egress** - scan the final outbound payload and destination at the last trusted seam. For outbound cloud database mutations (such as Supabase sync or RPC calls), execute Laya Database Egress Guard to block malicious SQL or destructive scripts before network dispatch; local-only data (notes, scratchpads, drafts) is strictly exempt from inspection to preserve zero latency and complete privacy.
8. **Approve or deny** - high-impact actions require an understandable preview and bounded consent.
9. **Execute** - use the approved adapter or package runtime without expanding scope.
10. **Record and recover** - persist safe evidence, result, usage, terminal state, and compensation status.

Denial is a successful security outcome. It must not silently fall back to a weaker path.

## TrustBroker contract

The P0 interface is intentionally small and deny-by-default:

```ts
type TrustBroker = {
  authorizeOrigin(request: OriginRequest): Promise<OriginDecision>;
  requestCapability(request: CapabilityRequest): Promise<CapabilityGrant>;
  resolveSecret(request: SecretUseRequest): Promise<OpaqueSecretLease>;
  inspectFinalEgress(request: FinalEgressRequest): Promise<EgressDecision>;
  revoke(grantId: string, reason: string): Promise<void>;
};
```

Every decision binds actor, sender or package origin, run, capability, scope, expiry, and policy version. Unknown origin, missing capability, invalid schema, expired grant, or absent final-egress inspection returns deny. There is no unrestricted string method dispatch or generic capability escape hatch.

The contract is frozen before parallel Hub, Store, adapter, and package work. The first safe vertical proves origin and capability denial plus final-egress inspection; every later enabled executor, remote capability, paid activation, managed target, and package call must converge on the same seam. Dependency order and subagent allocation remain owned by the [MVP master plan](../execution/mvp-plan.md).

## Capability model

A capability is a typed operation, not a role name or boolean flag. A request includes:

- capability identifier and version;
- actor and package identity;
- run and step identity;
- workspace, resource, path, or destination scope;
- data classification;
- requested duration and usage limit;
- reason shown to the user;
- idempotency and recovery metadata.

A grant narrows or matches the request; it never broadens it. Grants can be one-shot, run-scoped, workspace-scoped, or persistent only for low-risk operations. Revocation stops future calls and attempts to cancel active work.

Suggested risk classes:

- read-only local and non-sensitive;
- local mutation with bounded recovery;
- network egress;
- secret use;
- external communication or publication;
- financial, account, identity, security, or destructive action.

The last group is never silently approved from learned behavior.

## Capability resolution and commercial admission

The Capability Resolver returns factual candidates as `ready-local`, `ready-remote`, `installable`, or `unavailable`, including identity, trust, permissions, data location, compatibility, health, UI/offline support, and price or managed-usage facts when applicable. TrustBroker filters or denies candidates; it does not rewrite resolver evidence.

An `installable` result can create only a reviewable activation proposal. A `ready-remote` result can execute without a desktop artifact only after remote identity, transport, capability, egress, budget, cancellation, and evidence checks pass. Neither state authorizes silent installation or spending.

A Store Entitlement or opaque AcquisitionGrant proves commercial access to an exact account, product, offer, and package identity. It is not a CapabilityGrant and cannot raise package trust, suppress consent, expand a scope, or bypass signature, compatibility, isolation, or revocation.

## Secret boundary

- Secret plaintext is written and decrypted only in the main process or an approved isolated runtime.
- Renderer forms can submit a new secret but receive only presence, label, last-updated time, and an opaque handle.
- Provider list, get, update, and discovery APIs never return API keys to renderer code.
- Lack of platform protected storage fails closed for persistent secrets. Reversible Base64 is not encryption and cannot be a production fallback.
- Adapters request secret resolution just in time, for an exact destination and run scope.
- Prompts, context, logs, receipts, telemetry, screenshots, and exception strings receive redacted values.
- Copy or reveal is a separate high-risk capability with an explicit user action and audit event.

## Outbound boundary

Egress policy evaluates both data and destination. It covers HTTP, WebSocket, provider SDK, remote relay, CLI stdin/stdout protocol, package fetch, MCP transport, email, chat, browser automation, update, and telemetry.

The final egress broker receives:

- canonical destination and resolved origin;
- payload after serialization;
- declared data classes and secret handles;
- adapter and package identity;
- permission grant;
- timeout, byte, and rate limits.

Inspection results expose detection metadata, not recovered secret text. URL redirects and DNS resolution are revalidated to prevent SSRF or destination change.

## Production semantic backend design (2026-09-08)

**TARGET, authorized scope:** usable desktop chat with security enforced before external transport and confirmed-only understanding producing usable proposals. Optimize model invocation count and added latency subject to safety and quality, not by skipping unknown content. This design is a reviewed hypothesis, not a claim of global optimality or production readiness.

### Fast path and secret matching

Main owns the exact serialized outbound payload, origin spans, destination and live grants. Inspect every outbound byte, including retained history and tool content. Deterministic deny/redact and validated low-risk evidence avoid model inference; absence of a regex match alone does not establish low risk. Inspect again after any rewrite and before opening the transport. Authentication credentials are inserted only by the destination-bound transport under a secret lease, never placed in model-visible prompt content.

Offer explicit secret registration through the protected vault flow, not ordinary chat. Registration is optional; unknown keys still require detection. Maintain a Main-only keyed fingerprint index bound to vault identity and revision. Match exact candidate spans against keyed fingerprints without exposing values, fingerprints or membership to renderer/model/logs. Extract spans using bounded length/type indexes plus whole-payload known-secret scanning with cross-buffer overlap; lack of delimiters must not bypass a registered secret match. Rotation, deletion and lock invalidate indexes and verdict caches. Do not store unsalted hashes of low-entropy secrets.

Shape, provider prefix, character class and length select candidates, not identity or permission. +84 is a phone-number hint and must not classify every matching string as a credential. Only type-specific, semantics-preserving normalization is allowed: phone formatting may normalize with region evidence; arbitrary keys remain byte-sensitive and case-sensitive. Bounded URL/JSON escape decoding retains offsets and depth/size limits. Similarity is evidence of uncertainty, never a reason to allow or reconstruct a secret. Temporary lifetime is separate from sensitivity: OTPs are both temporary and secret. Matching a registered secret triggers deterministic protection with zero model calls; it never authorizes disclosure.

### Selective inference and scheduling

Cache evidence using a private keyed digest of exact content plus origin/provenance, destination class, policy, vault revision, base/adapter/tokenizer/schema versions and expiry. Recheck live grants and destination even on cache hits. Coalesce simultaneous identical eligible requests within the same account/workspace boundary; never reuse mutable payload identity. Bound cache bytes and TTL, and retain no raw secret/chat. A task produces no model invocation merely by reading locally.

Security inference receives only unresolved spans with sufficient surrounding context and explicit origin/destination evidence. Do not summarize away a suffix, negation or condition; coverage tracking accounts for every original span. Long inputs are processed whole within a measured host budget; chunking is an optional separately proven mode, not assumed implemented. If context cannot be retained within the budget, deny unsafe egress or offer a safe user-visible correction; consent alone cannot bypass a forbidden destination.

Understanding consumes the original user-authored turn asynchronously after admission, independent of response streaming. Cheap eligibility filters exclude temporary, secret, sensitive and non-user content; uncertain durable signals remain eligible. Coalesce superseded work within one conversation using a revision token, not across users. Before publishing a proposal, recheck deletion/correction/cancellation and conversation revision. Persist only after explicit confirmation; verify it is available on a later chat and removable. Never infer authorization from preferences.

One warm base worker owns adapter switching, a bounded fair queue and per-task quotas. Prioritize egress security with aging to avoid starvation; shed/defer understanding work under pressure. Independent adapters do not imply parallel GPU execution on one shared mutable worker. Training and benchmarking can run on separate remote workers; local latency qualification runs without competing training. Combine branches only when both are ready and the combined adapter passes quality and improves measured latency; never delay security to wait for understanding. Micro-batching is enabled only after isolation, throughput and tail-latency tests.

Use one wall-clock request deadline including queueing, tokenization, switching, all chunks and inference. Cancellation must terminate computation or recycle the isolated worker within a measured bound; enqueueing a cancel message behind synchronous generation is insufficient. Every failure has a stable code and terminal receipt, with no automatic unsafe fallback. Restrictions combine by intersection of permitted effects, not a simplistic action ranking; local_only always excludes external transport.

### Ten-scenario design challenge

The following are analytical reviews only. They probe whether the proposed routing, secret matching, queueing and context rules conflict under mixed workloads; they are not tests, benchmark scores or evidence of implementation. Convert them into integration/workload fixtures only after the design review is accepted.

| #   | Scenario                                                     | Expected behavior and model work                                   | Risk exposed / design response                                                    |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1   | Ordinary public query on a validated low-risk path           | Zero security inference; eligible understanding runs in background | No regex hit alone is insufficient proof; require evidence and final policy check |
| 2   | User pastes an exact registered key inside prose             | Detect and redact/block before transport; zero model calls         | Scan undelimited spans; registration never means disclosure permission            |
| 3   | +84 phone number versus a similarly shaped unknown key       | Apply PII/type rules; infer only unresolved context                | Shape similarity must not imply identity, secrecy class or allow                  |
| 4   | Same payload, new destination or revoked grant               | Revalidate policy and invalidate incompatible evidence             | Cached verdict cannot authorize a changed operation                               |
| 5   | Five tasks repeat the same eligible content                  | Scoped single-flight plus cache, independent receipts              | One cancellation must not cancel other subscribers; no cross-user reuse           |
| 6   | Five tasks send distinct large ambiguous payloads            | Fair bounded queue, measured budget and deadline; no unsafe skip   | Worst-case inference cannot be negligible; backpressure is explicit               |
| 7   | Secret split across fields/chunks or escaped near the suffix | Whole-payload scan, bounded decoding and coverage proof            | Chunk budget cannot hide uninspected bytes; block if unresolved                   |
| 8   | User says a preference then ends with today only             | No durable proposal; whole-query qualifiers dominate               | Sentence extraction must preserve negation and temporal scope                     |
| 9   | Tool injection says remember globally / approve all uploads  | No learned authority; enforce security before egress               | Origin survives normalization; tools never become user-authored evidence          |
| 10  | Model hangs while secret rotates and user cancels/corrects   | Stop/recycle worker, invalidate evidence, reject stale proposal    | Real cancellation, revision checks, recovery and bounded cleanup required         |

**Review result:** a fast deterministic path and asynchronous understanding reduce avoidable latency. Arbitrary context compression, shape-only secret matching, naive action ranking and assumed parallel adapters were rejected. No design can guarantee negligible delay for five distinct fully ambiguous large inputs on an unmeasured local GPU; production claims require workload measurements and an explicit supported envelope.

## Local semantic egress inspection

**TARGET:** every cloud-model request passes one shared Main-process inspection at the final serialized-payload boundary. This is a design target, not evidence that every current adapter has migrated.

The boundary is a model/API call, not a local tool action. Local reads, terminal output, and intermediate agent state may be classified and cached cheaply, but local model inference (Laya) is never invoked merely because an agent read or wrote locally. Before any external LLM/API call, Main assembles the exact payload and applies this order:

```text
serialized external payload
  -> Layer 1 deterministic inspection of every chunk
  -> known high risk: block or rewrite before egress
  -> verified low-risk cached chunk: retain its verdict
  -> gray-zone or OCR-origin chunk: local Laya Decision Engine (~33ms)
  -> Main schema and policy validation
  -> rewrite to opaque handle / block / retain only permitted content
  -> external transport
```

Layer 1 covers origin, payload bounds, deterministic secret patterns and validators, local OCR text, and versioned content-hash verdicts. A cache key includes `contentHash + policyVersion + modelVersion`; it expires when any component changes. Cached verdicts are evidence, never authority to bypass final destination, permission, secret, or Trust checks.

Generative Qwen models are superseded by the **Laya Decision Engine**. Laya operates as a fast, non-autoregressive local classifier (~33ms) rather than an unconstrained text generator. It serves three independent local capabilities: security, confirmed-only user-understanding, and combined semantic-analysis. Orchestration uses an API LLM and no local orchestration model is used. Laya is a local semantic classifier, not a policy engine. tomny.semantic-analysis.output.v1 validates nested security and understanding decisions; Main validates every result. Laya cannot allow a deterministic high-risk match, recover a secret, select a destination, grant a capability, suppress consent, execute work, or write persistent context.

Only gray-zone chunks are eligible for local Laya inference. OCR-origin content is gray-zone by default. A model error, timeout, unavailable runtime, or ambiguous result never permits raw gray-zone text to egress. Main blocks or replaces the affected chunk with a safe placeholder. The per-stage deadline is bounded (default 5 seconds per stage in Chat Pipeline; 30 seconds total external deadline); after that deadline Main denies raw egress. A verified low-risk chunk may proceed if it is independent of the denied chunk and the resulting payload remains meaningful under policy.

A single supervised local inference service owns the loaded model and bounded queue. It may micro-batch up to four independent gray-zone requests for a short bounded wait, but the correctness benchmark batch size is not proof of runtime throughput. Default deployment uses one worker; extra workers require measured host headroom and an explicit resource policy. The service records only hashes, classifications, policy/model versions, timings, and safe summaries in audit evidence.

**CURRENT deterministic backend evidence (2026-09-09):** Secret Firewall regression benchmark protected 61/61 secret fixtures with zero leaks and zero false positives; synchronous filter p95 was 0.0791 ms. TrustBroker security corpus tests passed 8/8, including the zero false-allow promotion floor. This evidence covers deterministic protection only and does not promote the inactive ML adapter.
**CURRENT token audit (2026-09-08):** Retokenizing all 1,188 v6 rows with the local pinned tokenizer and the actual trainer text/tokenization calls found zero rows over 256 tokens and zero prompt-prefix mismatches; the maximum was 196 tokens. Therefore target truncation does not explain the observed v6 quality failures. The new trainer guards prevent future truncated or misaligned targets, but are not evidence of a repaired v6 model. The earlier diagnostic reporting a maximum of two tokens counted the tokenizer return container incorrectly and is invalid.

**CURRENT audit (2026-09-08):** The legacy v6 generator reuses normalized prompts across train/validation and clones train/validation rows into heldout rows by changing wrappers and identifiers. Those rows are not independent benchmark families. The generator now rejects this leakage and incomplete split coverage before creating output; `fixtures/check_split_coverage.py` verifies both guards. No corrected v7 corpus or model-capacity conclusion exists yet.

**PARTIAL (2026-09-08):** Semantic candidate `0.6.0-modal-full.2` completed 300 steps on Modal and passed artifact verification (manifest SHA-256 `c822826eabfc4ae01bebb27ff4c7f5450e303a284cd79df2b14932737f0a66d6`, all weights finite). Downloaded manifest/config/weights match the remote verification hashes. This proves artifact integrity, not output quality or production admission. Evidence is in `.model-adapters/candidates/com.tomny.core.semantic-analysis/0.6.0-modal-full.2/verification-report.json`; source manifests retain remote path bindings.

The generated benchmark `.model-benchmarks/candidates/modal-security-understanding-v4-2/run/benchmark-report.json` is not v6 understanding acceptance evidence: its v4 oracle requests `hypothesis/action/evidenceBasis`, while the trained v6 contract returns `hasMemorySignal/kind/scopeHint/requiresUserConfirmation`. Its understanding `unsafe` label cannot establish v6 contract quality. Security also failed this benchmark (2/48 composite-correct, 7/48 schema-compliant); no adapter is approved for activation. Correct-contract quality, host concurrency and integration gates remain required. The first v6 diagnostic on 12 immutable synthetic test rows per domain produced: security adapter 12/12 schema-valid and 12/12 exact-correct (mean 2.585s); user-understanding adapter 0/12 schema-valid and 0/12 exact-correct (mean 3.326s); semantic-analysis adapter 2/12 schema-valid and 0/12 exact-correct (mean 0.999s). Base outputs were 0/12 schema-valid for all three. This is diagnostic evidence only: the corpus is synthetic and the run used batch size one without recovery or concurrency measurement. Corpus inspection also found validation coverage gaps: understanding validation has only abstentions and workspace decisions (no positive preference/habit examples), while semantic validation has only security-only and both-null outputs (no understanding object). Validation loss therefore does not establish understanding or combined-branch quality; repair split coverage and benchmark contracts before another training attempt. Keep candidates inactive; stop a Modal job by its exact app ID, retain its Volume artifacts, and preserve deterministic fail-closed egress and explicit user confirmation. Do not switch to a failed candidate as rollback.

Performance evidence is currently **PARTIAL**. The candidate benchmark measured a batch size of four with median 1.522s, p95 6.027s, and about 0.98 GB peak VRAM, but did not prove concurrent daemon throughput and failed its production quality gate. Production admission requires a host-profile benchmark for one, two, four, and five concurrent agents, queue/deadline behavior, cache-hit rate, and external-call overhead. The benchmark also requires deterministic-secret recall, semantic PII recall, Vietnamese/English separation, OCR/noisy inputs, malformed/unavailable-model failures, and no raw plaintext in cache or audit output.

### Supabase & remote database egress guard (TARGET / Laya Invariant)

**Selective Scope Boundary:**

- **Local-only content (Exempt):** Purely local storage operations—such as editing local notes, user drafts, internal scratchpads, or personal offline records—are strictly exempt from inspection. They do not invoke Laya inference and experience zero added latency, maintaining full local user privacy.
- **Outbound remote database mutations (Governed):** Any mutation payload, SQL snippet, or schema-altering statement directed outward to a cloud database (e.g., Supabase REST/PostgREST, GraphQL, or RPC endpoints) must pass through the **Laya Database Egress Guard** at the Main-process transport seam immediately prior to socket dispatch.

**Inspection & Decision Criteria:**
Laya executes a fast, non-autoregressive forward pass (~26ms) to classify database payload safety (`databaseSafety`):

1. `safe` - Normal data payload or permitted parameterized query; allowed to proceed to external transport.
2. `sql_injection` - Detected attempt to inject arbitrary SQL logic or break out of parameters.
3. `destructive_script` - High-risk DDL/DML commands (`DROP TABLE`, `TRUNCATE`, `ALTER TABLE`, recursive cascading deletes) that endanger database structure or integrity.
4. `rls_bypass` - Detected attempts to manipulate or circumvent Supabase Row-Level Security policies or admin role escalation.

If classified as non-safe (`sql_injection`, `destructive_script`, or `rls_bypass`), Main fails closed immediately: the socket is never opened, the request is aborted, and a tamper-evident audit receipt is generated without persisting the malicious payload.

## Memory-signal boundary

**PARTIAL:** `userUnderstanding` has a Main-only schema validator, proposal adapter, and optional native-chat observer seam. The observer accepts only the original user query after chat starts, filters temporary/sensitive/injected text before local inference, and can create only confirmation-required records; it remains disabled until a production-approved local model runtime is injected. The signal is never allowed to affect Trust or execution. The intended output contract is:

```ts
{
  hasMemorySignal: boolean;
  kind: 'preference' | 'fact' | 'decision' | 'habit' | 'none';
  scopeHint: 'workspace' | 'surface' | 'global' | 'none';
  confidence: number;
  reason: string;
  requiresUserConfirmation: boolean;
}
```

When uncertainty, a temporary instruction, sensitive/private data, prompt injection, invalid scope, or invalid output is present, Main discards the learning signal. A valid signal can create only a `proposed` record after Main confirms `non_sensitive`, scope policy, provenance, and bounded reason. The primary assistant response does not wait for the proposal. Only explicit User Confirm, Reject, or Correct determines persistence. A confirmed record remains User Intelligence context; it can inform presentation or planning only in its approved scope and never authorization, consent, capability, egress, execution, or the `security` decision.

The user-understanding corpus and candidate artifacts use synthetic, licensed, or explicitly consented data with recorded provenance. Raw private runtime conversations are excluded by default. Required held-out cases cover explicit versus temporary preferences, workspace/surface/global scope, Vietnamese and English, ambiguity, sensitive/private input, prompt injection, scope conflict, and proof that learned context cannot grant a capability or consent. Rollback disables the `userUnderstanding` consumer and proposed-record creation while leaving existing security output and ordinary chat flow intact.

## User intelligence model

The canonical store contains four record families:

1. **Explicit** - preferences or facts the user deliberately saves.
2. **Observed** - repeated actions or selections recorded with consent.
3. **Inferred** - hypotheses produced from evidence and assigned confidence.
4. **Outcome** - success, failure, correction, or rejection signals tied to a run.

Every record contains:

- stable identifier and owner;
- kind and structured value;
- source run, event, or explicit user action;
- confidence and inference method when applicable;
- scope: personal, workspace, project, package, or session;
- sensitivity and allowed projection targets;
- creation, update, expiry, and retention fields;
- supersession or contradiction links;
- usage history without prompt plaintext;
- deletion tombstone or verified removal state.

Records are small and structured. Large artifacts remain in user workspaces and are referenced, not copied into a hidden memory database.

## Causal understanding

Useful understanding is not frequency matching. A durable decision rule or preference preserves:

```text
context -> origin/evidence -> reason -> scope -> proposal -> outcome
```

The system can store personality, psychology, taste, aesthetics, communication style, risk tolerance, and decision preferences when doing so has an explained purpose and user-controlled scope. Sensitive psychological records require explicit consent before durable use or cloud projection.

A repeated action without a known reason is evidence for a question, not a reusable rule. The system can:

- ask why the choice mattered;
- keep a session-scoped caution;
- propose a bounded hypothesis for confirmation;
- proceed using only the explicit task instruction.

It cannot convert frequency alone into "always do this." Confidence describes evidence quality; it does not replace a causal explanation.

An explicit instruction remains authoritative inside its stated scope. Its storage records the task, object, time, and reason when known. It must not silently generalize across goals. For example, a full-time-job document location cannot become the default for a part-time-job application merely because it was used often.

Corrections record both the intended instruction and the cause of failure. A workflow can remember that a closed job caused wasted navigation and should be rejected earlier, while separately remembering the exact resume location only for the applicable context. Later proposals use both lessons and expose why each applies.

The system does not need to interrogate the user about every harmless choice. When the missing reason could materially change outcome, privacy, cost, external effect, or future reuse, it asks, abstains, or offers bounded alternatives instead of inventing the reason.

Causal records are inspectable, correctable, forgettable, exportable, and deletable. They can inform planning and presentation but cannot grant capability, suppress approval, weaken security, determine package trust, or target sensitive advertising.

## Context projection

A projection is created per run step. It has a token or byte budget, purpose, destination class, and list of record identifiers. Selection prefers explicit, recent, scoped, high-confidence, non-contradicted records.

Before leaving the device, projection policy removes records not allowed for the chosen target. The receipt records which identifiers were projected, which were withheld, and why, without persisting sensitive plaintext twice.

User intelligence can affect a plan, explanation, or presentation inside its consented scope. Learned target ranking is post-MVP and requires versioned evaluation evidence; it cannot alter deterministic MVP routing, create a grant, suppress approval, expand a filesystem root, change an egress destination, or select advertising from sensitive context.

## User controls

The base UI provides:

- inspect records and their provenance;
- accept, correct, pin, mute, or mark an inference wrong;
- define per-scope learning and cloud-projection policies;
- delete one record, one scope, or all learned context;
- export a portable, documented format;
- see where a record was used;
- pause learning without disabling ordinary runs.

Deletion tests must prove the record no longer appears in projections, search, backups past the declared retention window, or package-accessible data.

## Audit and privacy

Audit records are structured and tamper-evident enough to diagnose actions without becoming a secret archive. They store identifiers, policy versions, decisions, hashes, sizes, destinations, timings, and safe summaries.

Telemetry is opt-in, data-minimized, and separate from private context. User context is not a marketplace asset and is never sold or used for cross-user training without a separate explicit program and consent.

## MVP acceptance gates

- A generated inventory proves 100 percent of base preload methods validate request/response schema, sender, main frame, origin, size, timeout, and stable errors; no unrestricted string dispatch remains.
- No API key or decrypted secret appears in renderer responses, logs, serialized state, or snapshots.
- Persistent secret creation fails safely when protected storage is unavailable.
- Every enabled release-candidate outbound surface passes the same TrustBroker contract and final serialized-payload egress hook; unmigrated surfaces are disabled.
- One controlled `observe or explicit input -> propose -> explain -> confirm -> apply -> outcome -> correct or forget` loop has provenance, deduplication, rejection, correction, export, and deletion; background autonomous learning remains P1.
- A repeated action without an explained reason remains a question or bounded hypothesis; tests prove it cannot become a cross-context rule, while corrections preserve separate instruction and failure-cause lessons.
- The in-memory preference manager is removed or delegates entirely to the canonical context store.
- A normal conversation can restart, recover context, and complete with the IDE package absent.
- Context export and deletion are round-trip tested.
- A specifically consented inference may improve a later plan but cannot alter permission or deterministic P0 routing; rollback can switch to explicit-only records.
- Restart during an approved side effect does not duplicate the external action, and rollback never restores Base64 secret storage.

## Rollback and kill behavior

User-intelligence rollback disables observed or inferred projection and returns to explicit-only records while preserving provenance, corrections, consent history, deletion tombstones, and readable audit evidence. Trust rollback disables the affected origin, adapter, remote provider, package syscall, or paid/managed switch; it never restores raw-secret responses, reversible Base64 storage, generic IPC dispatch, or uninspected egress.

An unknown or spoofed origin, renderer secret, missing final-egress inspection, approval replay, undeletable causal record, causal rule without reason or scope, sensitive-context advertising input, entitlement-derived privilege, permission drift after correction, duplicated side effect, or orphan grant keeps the affected gate red. Denial remains available while the unsafe execution surface is disabled.
