# Trust and user understanding

**Status:** TARGET architecture built from PARTIAL security, context, and secret components.

Trust and user understanding form one product core because useful autonomy requires both: the system needs enough private context to reduce repetition, and a strict boundary that prevents context from becoming uncontrolled authority or outbound data.

## Current evidence

**PARTIAL:** packages/desktop/src/process/agentRuntime/contextStore.ts stores scoped facts, preferences, and habits with provenance. contextComposer.ts builds bounded projections. secretVault.ts provides opaque secret references and platform-backed protection.

**PARTIAL:** agent-mesh security and services/security/outboundTextInspection.ts provide secret and outbound-text inspection primitives. They are not proven on every provider, CLI, remote, package, browser, automation, and IPC path.

**BLOCKED:** learnPersonalFact exists as a context-store method but has no production caller. Therefore automatic user learning is not CURRENT.

**BLOCKED:** process/userUnderstanding/preferenceManager.ts is an in-memory map and must not become a second canonical store.

**BLOCKED:** tomnyProviderStore can fall back to reversible Base64 when protected storage is unavailable and reconstructs provider objects containing API keys for renderer-facing paths. The target guarantee is no raw provider credential in renderer memory.

**BLOCKED:** generic IPC registrations are not uniformly proven to validate sender identity and payload schema.

**BLOCKED:** normal conversation recovery depends on IDE memory paths in parts of the current system. Core context and restart recovery must work when the IDE package is absent.

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
- over-collection, wrong inference, silent retention, and context sent to an unintended target.

Local compromise by an administrator is not fully preventable, but the design still minimizes plaintext persistence and blast radius.

## Trust pipeline

Every privileged action follows the same sequence.

1. **Identify origin** - user, core service, package identity, agent, adapter, renderer frame, remote session, and run.
2. **Normalize request** - validate schema, size, path, destination, data class, and requested capability.
3. **Resolve policy** - combine system deny rules, package manifest, user grant, workspace scope, and run scope.
4. **Project context** - select only purpose-bound records and attach provenance; redact secret material.
5. **Acquire leases** - capability and resource leases have owner, scope, limits, expiry, and revocation.
6. **Propose side effect** - record destination, payload classification, idempotency key, and recovery rule before execution.
7. **Inspect egress** - scan the final outbound payload and destination at the last trusted seam.
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

Wave 1 freezes this interface and puts origin/capability denial plus the final-egress hook on the Hub and one cloud vertical slice. Wave 2 makes it mandatory for each migrated executor. Wave 3 completes policy breadth, approval UX, audit, context controls, and the remaining surface migration.

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

## Context projection

A projection is created per run step. It has a token or byte budget, purpose, destination class, and list of record identifiers. Selection prefers explicit, recent, scoped, high-confidence, non-contradicted records.

Before leaving the device, projection policy removes records not allowed for the chosen target. The receipt records which identifiers were projected, which were withheld, and why, without persisting sensitive plaintext twice.

User intelligence can affect planning or target ranking. It cannot create a grant, suppress approval, expand a filesystem root, or change an egress destination.

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
- The in-memory preference manager is removed or delegates entirely to the canonical context store.
- A normal conversation can restart, recover context, and complete with the IDE package absent.
- Context export and deletion are round-trip tested.
- A specifically consented inference may improve a later plan but cannot alter permission or deterministic P0 routing; rollback can switch to explicit-only records.
- Restart during an approved side effect does not duplicate the external action, and rollback never restores Base64 secret storage.
