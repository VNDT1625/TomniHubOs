# Store commerce

**Status:** TARGET commercial policy with PARTIAL C1 contract parsing. Package trust, ABI, extraction, lifecycle, and commercial runtime implementation status remains owned by [packages](packages.md).

## Role of the Store

The Store distributes optional applications, UI packages, capabilities, agents, skills, workflows, Super Packages, themes, provider integrations, and remote services without placing their implementation in the trusted base.

Commerce never changes technical trust. Free, paid, first-party, sponsored, included, promoted, and enterprise packages pass the same signature, provenance, permission, sandbox, update, revocation, and lifecycle gates.

## Checkpoint and accounting boundary

Store is part of the **Core plus Store candidate** and progresses independently of the **Full managed-usage MVP**. Catalog, search, free publishing/install, ordinary-money order and entitlement, paid first-party activation, refund, and ranking separation do not require Tomni Credit or Tomni-managed cloud. A managed AI or cloud service selected from a package remains a separately quoted usage target.

## Account and publisher authority

TomniHubOS is account-first: Store access begins only after an online browser OAuth/OIDC Authorization Code + PKCE sign-in, with session material protected in Main/OS storage and renderer exposure limited to session state. A cached protected session may support only a declared offline-local grace mode after previous verification; first sign-in, expiry/revocation, purchase, publishing, synchronization, cloud use, and any account-sensitive mutation require online revalidation.

Every account owns its own Store entitlements and consent/audit receipts. A Publisher Profile is a separate, server-verified relation from account subject to publisher namespace, role/status, and enrolled active signing public key. Upload Main code stages an opaque artifact only after it derives the authenticated principal from the verified session; the Store verifies its signature against the enrolled key and records the principal/key snapshot with review evidence. The renderer never supplies authoritative account, publisher, role, or signing-key identifiers.

**PARTIAL:** Common contracts define strict Store-root-signed third-party publisher-key certificates and distinct signed key-revocation records. Remote catalog v2 now signs and verifies both against pinned Store roots, replaces the Main-only third-party key set only after complete catalog verification, and therefore rechecks downloaded artifacts/recovery against an ephemeral `signed-store` key only for a valid, non-revoked exact publisher identity. Collisions and protected `com.tomni` namespaces fail closed. This desktop-side verification is not publisher enrollment or publication: no deployed authority, reviewer queue, catalog signer, or promoted third-party artifact exists yet.

Store ordinary payment uses versioned integer `MoneyMinor`, ProductOffer, Order, PaymentEvent, Refund, Entitlement, AcquisitionGrant, CommissionEntry, and PublisherPayable records. Store events have their own idempotency namespace, repository, liabilities, and reconciliation; a payment event cannot also mint Credit. Commercial price, sponsorship, ownership, and entitlement metadata remain separate from the signed technical manifest and never alter package trust.
**PARTIAL:** C1 now provides strict, versioned common parsers for these records, including no-float `MoneyMinor`, a reconciled 15/85 commission fixture, explicit order transitions, and opaque AcquisitionGrant shape. The bounded CommerceOrderLifecycle parser validates one ordinary-payment snapshot from ordered authorization/capture through entitlement and optional active grant, then a full refund and entitlement revocation; duplicate provider/idempotency identifiers, premature entitlement, retained grant after refund, mismatched identity, currency, or amount fail closed. A Main-process SQLite StoreCommerceLedger now persists order and immutable payment/refund evidence rows across restart, issues the entitlement and opaque grant only after capture, compensates full refund exactly once, and fails closed when stored lifecycle/evidence disagree. It is not a payment provider: authenticated provider/webhook ingestion, checkout UI, online account revalidation, remote reconciliation, refund-provider execution, and payout runtime remain absent.

## Standard commission

For a standard third-party sale:

All authoritative amounts use integer minor units with explicit currency, tax treatment, and version. Floating-point offer or catalog fields are display inputs only and cannot create an Order, refund, commission, or payable.

```text
net sale = customer product price - tax - refunded amount
publisher payable = 85% of net sale
Tomni commission = 15% of net sale
```

Tomni pays ordinary checkout processing from its share. Fraud, chargeback, policy violation, or extraordinary payout cost attributable to a publisher may be recovered only under published terms.

AI, cloud, storage, network, and another pass-through resource cost are itemized separately from developer value. Tomni does not apply Store commission and a second hidden commission to the same underlying resource.

Low-price products can require a minimum transaction value or aggregated checkout so fixed payment cost cannot make a sale contribution-negative.

## Product classes

- **Free third-party:** the publisher charges no product price.
- **Paid third-party:** the publisher owns the price and receives the published revenue share.
- **First-party:** Tomni publishes the package and retains revenue after direct cost.
- **Tomni Sponsored:** Tomni or a named partner funds a bounded entitlement.
- **Included:** access is tied to a clearly described bundle, eligibility rule, or event.
- **Enterprise/private:** distribution and commercial terms use a separate agreement.
- **Remote capability:** execution is provided remotely and may require no local executable download.
- **Super Package:** a versioned operating graph that can combine packages, capabilities, backend steps, checkpoints, user input, and failure lessons.

A "free app" offer states one of:

- keep forever after a valid claim;
- included while eligibility remains active;
- free for a defined event period;
- sponsored usage with a defined allowance.

## Authoritative purchase and activation lifecycle

```text
validated ProductOffer
  -> create idempotent Order
  -> accept authoritative PaymentEvent
  -> issue Entitlement
  -> issue opaque AcquisitionGrant
  -> verify package identity, signature, compatibility, permission, Trust, and isolation
  -> install or activate through Package Supervisor
  -> record receipt
```

The AcquisitionGrant binds account, product, offer, package identity, entitlement, policy version, and expiry or disclosed offline rule. It is resolved in the main process or an approved isolated service and is never renderer-authoritative. It proves commercial admission only; it is not a signature, trust tier, CapabilityGrant, permission decision, or reason to weaken isolation.

Refund is a compensating transition tied to the original Order and PaymentEvent. It reverses entitlement and accounting exactly once, revokes paid activation, cancels active package leases and processes, and preserves append-only commercial evidence. Package code or user-owned data is removed only under the declared uninstall and retention policy.

The MVP production path sells one paid first-party product. The third-party 15/85 path is an accounting fixture only and cannot enable seller onboarding or payout.

## Package interoperability

Packages cooperate through the capability broker, never direct implementation imports.

A package-to-package call carries:

- caller and callee package identity;
- parent and child Run lineage;
- narrowed capability grant;
- purpose and data classification;
- resource budget and Credit budget only when the invoked capability uses separately approved managed usage;
- timeout, cancellation, evidence, and stable errors.

Package A can use a Browser or web capability supplied by package B without owning B's implementation. A compatible theme or UI package contributes semantic tokens and component contracts; it never receives another package's renderer privilege.

A remote capability can be discovered and invoked without installing local executable code. Local installation occurs only when the user requests package UI, direct interaction, local execution, or offline availability. Installing a dependency or UI package always requires explicit consent.

Capability resolution remains technically owned by the package platform. A Store-backed query returns `ready-local`, `ready-remote`, `installable`, or `unavailable` with identity, trust, policy, data-location, price, health, compatibility, UI, local, and offline facts plus inclusion or exclusion reasons. An installable candidate creates a reviewable proposal, never a purchase or silent installation.

## Super Packages and workflows

A workflow is a reusable operating graph. A Super Package is a signed, versioned distributable workflow product that can bundle:

- a versioned workflow graph;
- package and capability dependencies;
- backend steps that do not need model reasoning;
- user-input checkpoints;
- local, remote, AI, and cloud execution choices;
- permissions, secrets, budgets, and data-location rules;
- retry, rollback, and recovery behavior;
- verified lessons about prior failures;
- acceptance tests and receipt schema.

The Hub can propose saving a repeated successful run as a private workflow or Super Package. It preserves explicit instructions, checkpoints, deterministic backend steps, prior failure lessons, and causal context rather than asking a model to rediscover every step or blindly copying behavior. A remembered rule records when, why, and in which scope it applies so a full-time-job document rule does not silently contaminate a part-time-job task. Replay still uses Run, TrustBroker, package, and applicable billing policy.

Private user workflows, causal context, personality, psychology, taste, aesthetics, and secrets remain user-owned and are not published without explicit, reviewable consent.

## Developer programs

Free community publishing does not require a paid tier for basic security or distribution. The standard 15% commission applies when public paid third-party commerce is later enabled; seller onboarding and payout remain blocked for MVP.

Dev Pro or Dev VIP can provide:

- analytics and release tooling;
- staged rollout and compatibility testing;
- publisher support;
- promotional credit;
- a bounded commission reduction in the current price schedule.

A paid program cannot buy:

- security certification;
- review bypass;
- a higher trust class;
- expanded permissions;
- access to private user context;
- organic ranking;
- immunity from suspension, quarantine, or revocation.

Commission reductions are capped by time, GMV, quality qualification, or another published boundary. They cannot reduce Tomni's share below direct processing, support, fraud, and reserve cost. Exact membership prices and discounts belong in a versioned commercial schedule, not this architecture policy.

## Ranking and sponsored placement

The Store separates:

1. **Recommended:** organic capability, compatibility, quality, trust, outcome, and user-controlled relevance.
2. **Featured by Tomni:** editorial selection.
3. **Sponsored:** paid placement with a persistent visible label.

Sponsored placement cannot modify organic rank, trust state, permission prompts, security warnings, revocation, or approval decisions. It never appears inside a security, permission, secret, or high-impact confirmation dialog.

Sensitive psychology, personality, health, security state, secrets, private context, or inferred vulnerability is not used for advertising targeting. User Intelligence is not a marketplace asset.

## Sponsored-free and acquisition programs

A package can be cheaper or free on Tomni while paid elsewhere only when the licence grants the required distribution, bundle, update, cloud-execution, support, and offline rights.

Prefer, in order:

1. time- or claim-bounded sponsored entitlement;
2. minimum guarantee plus active-use payment;
3. distribution or bundle licence;
4. source escrow and maintenance rights;
5. acquisition only after strategic and economic evidence.

Sponsorship:

- uses realized company contribution or named external funding;
- never uses unused Credit liabilities or publisher escrow;
- has a fixed maximum commitment;
- states whether entitlement is permanent, time-limited, eligibility-bound, or usage-bound;
- measures acquisition, activation, retention, outcome, and payback.

Package acquisition additionally defines source ownership, maintainer obligations, update and security SLA, key-person risk, fork rights, and long-term support.

## Payout and consumer protection

Public paid third-party publishing is BLOCKED until Tomni defines and tests:

- seller identity, KYC, and sanctions obligations where applicable;
- tax and currency treatment;
- Merchant-of-Record responsibility;
- payout timing and reserve;
- refund and consumer rights;
- chargeback and negative publisher balance handling;
- package removal and entitlement continuity.

When public paid third-party commerce is eventually enabled, publisher funds remain segregated until payable and the durable lifecycle includes Order, Entitlement, package identity, CommissionEntry, PublisherPayable, refund reversal, payout, and audit records. The MVP third-party fixture stops at accounting and cannot move publisher funds. The paid first-party launch product has no third-party payable.

Tomni Credit does not buy the MVP paid first-party Store product or third-party packages. Ordinary Store payment owns product entitlement; Credit remains a closed-loop unit for separately disclosed Tomni-managed usage. This avoids coupling Store release to AI/cloud infrastructure or silently creating transferable stored value.

## Acceptance evidence

Store commerce is not complete until tests prove:

- one paid first-party product completes authoritative checkout, Entitlement, opaque AcquisitionGrant, install, activation, refund, entitlement reversal, lease/process revocation, and receipt exactly once;
- a standard third-party fixture records 15% commission, 85% publisher payable, tax treatment, and correct refund reversal without enabling seller payout;
- payment retry, duplicate or out-of-order webhook, and restart cannot duplicate Order, Entitlement, AcquisitionGrant, refund, commission, or payable;
- the renderer cannot forge an AcquisitionGrant, and paid activation still fails when identity, signature, compatibility, permission, Trust, or isolation fails;
- ordinary Store order and entitlement remain functional when managed AI and managed cloud are disabled, and neither Store event can mint or debit Credit;
- Sponsored and organic ranking remain independent;
- sensitive User Intelligence fields cannot enter advertising selection;
- the same query returns stable `ready-local`, `ready-remote`, `installable`, or `unavailable` states with recorded inclusion and exclusion reasons;
- a remote capability can run without a local executable, while local UI, local execution, or offline installation requires a reviewable proposal and consent;
- package A cannot call package B without caller/callee identity, Run lineage, a narrowed grant, applicable budget, cancellation, and evidence;
- one private workflow or Super Package replays deterministic steps, checkpoints, and prior failure lessons without bypassing Run, Trust, package, or applicable billing policy;
- revoke or uninstall removes activation, processes, leases, secrets, and undeclared data under the retention policy.

## Rollback and kill behavior

Catalog browsing, free installation, checkout, paid activation, remote capability, and sponsored placement have independent kill switches. Rollback disables only the affected surface while preserving valid entitlements, append-only orders and accounting, signed installed state, user-owned data under retention policy, and unrelated free/local paths. It never rolls back to unsigned catalog data, deletes commercial history, restores a refunded activation, or spends Credit to conceal a Store mismatch.

A duplicate commercial transition, floating-point authoritative money, wrong 15/85 split, forged AcquisitionGrant, payment changing trust, refund without entitlement and accounting reversal, sensitive-context advertising input, sponsored influence on organic rank, silent install or purchase, public payout before its blocked gates, or lifecycle residue stops the affected Store surface and keeps the Core plus Store candidate red.
