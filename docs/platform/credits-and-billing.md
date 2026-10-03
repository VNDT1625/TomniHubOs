# Tomni Credit, billing, and usage settlement

**Status:** TARGET. No billing, wallet, managed resale, or refund behavior is CURRENT until a reachable production path and reconciliation, failure, and integration tests prove it.

**Implementation evidence (PARTIAL):** Main has a durable, append-only managed-usage ledger, quote reservation authorizer, and strict offline Ed25519/JWS verifier for accepted-quote, Credit-mint, and provider-meter authority evidence. The verifier uses an injected pinned authority-key directory and exact challenge (for quotes), account, Run, target, rate-card, policy, `kid`, purpose, expiry, environment, audience, event, and replay-identifier bindings; unknown or sensitive fields fail closed. Mint and meter verification return a read-only event only: durable replay consumption, payment ingress, Credit minting, provider transport, and settlement are not wired. Credit-mint and provider-meter authority records remain distinct from accepted quotes and Store PaymentEvent. These are local admission and accounting seams only: no deployed authority, checkout/payment ingress, provider-meter transport, managed provider call, cloud provisioner, or enabled managed-usage switch exists. Managed billing therefore remains TARGET for release.

## Release checkpoint boundary

Tomni Credit and managed usage belong to the **Full managed-usage MVP**. The **Core plus Store candidate** can ship with managed-AI purchase and managed-cloud provisioning disabled while local AI, BYOK, supported CLI, MCP, user-owned cloud, ordinary Store checkout, and valid entitlements remain available.

Store ProductOffer, Order, PaymentEvent, Refund, Entitlement, CommissionEntry, and PublisherPayable are a separate ordinary-money domain. They can share hardened payment-ingress infrastructure, but Store and Credit events use distinct schemas, idempotency namespaces, repositories, liabilities, and reconciliation. No event can both mint Credit and purchase a Store product.

## One Credit unit

TomniHubOS uses one closed-loop service unit named **Tomni Credit (TC)**. AI and cloud are separate meters, not separate currencies.

The launch reference is:

```text
100 TC = USD $1 of Tomni-managed service value before tax
```

Tomni Credit is not cash, cryptocurrency, transferable value, or redeemable currency. Regional checkout prices, taxes, and exchange treatment are published separately. Changing the reference requires a versioned ledger migration.

All balances and money values use integer minor units. Floating-point arithmetic is not allowed in ledger, quote, reservation, settlement, refund, or payout calculations.

## Balance sources

The user sees one eligible total, while the ledger preserves its sources:

- **purchased:** user-funded, not silently expiring;
- **promotional:** provider-, partner-, or Tomni-funded with visible scope and expiry;
- **refund or adjustment:** compensating entries tied to an original transaction.

There is no recurring plan-credit bucket while the core has no mandatory subscription. A future bundle can add a new versioned source without creating a second currency.

Restricted or expiring Credit is consumed before unrestricted purchased Credit when it is eligible for the same resource. Restrictions and expiry are visible before purchase or grant.

## Launch restrictions

- Tomni Credit buys only Tomni-managed AI, Tomni-managed cloud, and explicitly first-party managed capability usage.
- Credit does not buy the MVP paid first-party Store product or a third-party Store product. Ordinary Store checkout owns package purchase and entitlement.
- Credit cannot be transferred between users, cashed out, pledged, or converted into publisher payout.
- When public third-party Store sales are later enabled, they use ordinary payment and payout rails; MVP seller onboarding and payout remain blocked until stored-value, tax, refund, KYC, sanctions, and money-transmission obligations are resolved.
- Unused purchased Credit is a service liability. It does not fund payroll, sponsorship, package acquisition, or unrelated operating cost.
- Publisher proceeds are a separate segregated liability.

## Authoritative lifecycle

Every managed transaction follows:

```text
quote
  -> reserve Credit
  -> authorize Trust and resource grants
  -> execute
  -> meter normalized usage
  -> settle exactly once
  -> release unused reservation or refund
  -> reconcile
```

The provider adapter, cloud provisioner, package, and renderer cannot mint, price, reserve, or debit Credit. They report signed or trusted usage inputs to the billing owner.

### Quote

A quote includes:

- quote identity and expiry;
- account, Run, step, target, and resource identity;
- rate-card and policy versions;
- itemized unit prices;
- estimated range and maximum charge;
- permitted retries and failure reserve;
- tax and currency treatment;
- refund and cancellation policy.

An expired quote or unresolved price fails closed. Missing price is never interpreted as zero.

### Reservation

Reservation is atomic and precedes the first billable provider call or compute provision. Concurrent runs cannot reserve the same balance twice. A reservation cannot create a negative available balance.

A task that needs more than the approved maximum must pause or stop and request a new quote and reservation. It cannot silently extend the hold.

### Metering

A durable usage record itemizes, as applicable:

- AI model, input, cached input, output, tool, batch, realtime, and regional dimensions;
- cloud CPU, memory, GPU, disk, network, image transfer, storage, and runtime duration;
- package or first-party capability fee;
- discount, sponsorship, reservation, settlement, and refund;
- provider invoice reference and measurement confidence.

Usage belongs to the Run receipt and remains reconcilable without persisting secret or private prompt content.

### Settlement

Settlement is idempotent and terminal for a reservation. It cannot exceed the reserved maximum. The ledger records balanced debit, revenue, provider-cost, reserve, tax, and release entries rather than mutating an opaque balance.

- **Success:** debit actual eligible usage and release the remainder.
- **User cancellation:** debit only disclosed resources incurred through bounded shutdown.
- **Tomni or provider fault before useful work:** refund according to the published fault policy; internal reserve absorbs uncovered failure cost.
- **Invalid input or package-controlled failure:** debit only the disclosed resources actually consumed to the failure point.
- **Retry:** bounded, idempotent where required, and covered by the existing reservation or a new approval.
- **Budget exhausted:** pause or stop without a negative balance.

## Managed AI rate cards

Local AI, BYOK, and compliant user-authenticated CLIs incur no Tomni model markup.

Managed AI distinguishes provider, model, input, output, cache write, cache read, batch, realtime, tool, region, and other provider-specific billable dimensions.

Tomni does not assume an enterprise or volume discount before a signed agreement grants the required embedded-use or resale rights. Until then, the customer rate covers public or contracted provider cost, payment allocation, bounded retry, refund/fraud reserve, and minimum contribution.

Provider list-price changes create a new rate-card version. Existing accepted quotes retain their locked version until expiry.

## Managed cloud rate cards

Cloud price covers:

- upper-bound provider compute;
- boot, image, storage, and network cost;
- bounded retry and cleanup reserve;
- payment, tax, currency, fraud, and refund allocation;
- configured minimum contribution.

The managed-cloud MVP exposes one provider-neutral General on-demand resource class and one Standard service intent. Economy, Priority, Dedicated, interruptible, GPU, warm-pool, and committed-capacity choices require later pricing, isolation, and economic evidence rather than extending the launch rate card.

The technical execution contract is defined in [managed cloud execution](cloud-execution.md).

## Reconciliation

Automated reconciliation compares:

- payment processor events;
- Credit mint and refund entries;
- reservations and settlements;
- provider usage and invoices;
- cloud resource lifecycle records;
- Run receipts;
- ordinary Store processor events only for cross-system mismatch detection, without mutating Store orders, entitlements, commission, or publisher liabilities from the Credit ledger.

Duplicate payment webhooks cannot mint Credit twice. Restart between reservation and settlement must converge on exactly one terminal accounting state. An unresolved mismatch freezes affected managed spending and creates a safe incident record.

## Loss-prevention guardrails

- no negative balances;
- no provision before reservation;
- no unbounded retry;
- no unknown or stale rate card;
- no settlement above the approved maximum;
- no warm or committed capacity without measured economic coverage;
- hard account, provider, task, and daily spending caps;
- idempotency on payment, refund, reservation, settlement, and provider callback paths;
- provider invoice reconciliation within a versioned tolerance;
- fail closed on inconsistent ledger or billing state.

## Full managed-usage acceptance evidence

The contract is not complete until integration tests prove:

- two concurrent runs cannot double-spend one balance;
- a duplicate payment webhook cannot mint twice;
- managed-AI purchase and managed-cloud provisioning can be disabled independently without disabling ordinary Store commerce or free/local paths;
- cancellation before provision releases the full hold;
- provider and Tomni failures settle or refund according to policy;
- restart at every lifecycle boundary reaches one terminal accounting state;
- stale or missing price prevents managed execution;
- actual charge never exceeds the accepted maximum;
- receipt, ledger, and provider invoice reconcile within the approved tolerance;
- private context, raw secrets, and payment credentials never enter billing records.

## Rollback and kill behavior

Rollback disables managed-AI purchase, managed-cloud provisioning, or a compromised payment ingress independently. It preserves readable balances, reservations, settlements, refunds, provider references, Run receipts, Store records owned by the Store ledger, and every free/local path. It never converts prototype plan credit into authoritative money without a versioned migration or spends unused Credit liability on Store sponsorship or publisher payout.

A duplicate mint, double spend, negative balance, float in authoritative money, charge above an accepted maximum, stale price, provision before reservation, event that crosses the Store/Credit namespace, secret or payment credential in a billing record, unresolved provider mismatch, or orphan managed resource freezes affected spending and keeps the Full managed-usage gate red.
