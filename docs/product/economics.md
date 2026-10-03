# Product economics and operating stages

**Status:** TARGET policy. Financial values and user-count scenarios are ILLUSTRATIVE planning assumptions, not CURRENT evidence, price commitments, or forecasts.

## Free-core policy

TomniHubOS does not charge a platform licence for the Hub Agent OS, local Trust and User Intelligence, local orchestration control with API LLM reasoning, workflow and Super Package authoring, BYOK, supported CLIs, local AI, local package execution, or Store browsing.

"Free" means no Tomni platform fee. It does not mean Tomni subsidizes third-party model usage, VM or GPU time, storage, network transfer, paid packages, or another externally metered resource.

A free registration creates no revenue. Every external resource with variable cost must be prepaid, supplied by the user, funded by a package provider, or explicitly sponsored from realized company contribution.

## Two commerce rails

Tomni exposes two commercial surfaces:

1. **Managed Usage:** one prepaid Tomni Credit system funds both managed AI and managed cloud. AI and cloud remain separate meters and margins, not separate currencies.
2. **Store:** package, Super Package, developer service, and sponsored-placement commerce.

Managed Usage therefore contains two transaction economies:

- **Managed AI:** Tomni earns the difference between the customer rate and complete model-service cost.
- **Managed cloud:** Tomni earns the difference between the customer rate and complete compute-service cost.

BYOK, supported subscription CLIs, local AI, and bring-your-own-cloud remain free platform paths. Tomni does not scrape subscription credentials or emulate provider APIs contrary to provider terms.

## Product and resource matrix

| Action                                 |     Platform price | Resource payer            | Tomni revenue             |
| -------------------------------------- | -----------------: | ------------------------- | ------------------------- |
| Local, BYOK, supported CLI, or MCP run |               Free | User or provider account  | None                      |
| User-owned cloud run                   | Free orchestration | User cloud account        | None                      |
| Tomni-managed AI                       |            Metered | Prepaid by user           | Managed-AI margin         |
| Tomni-managed cloud                    |            Metered | Prepaid by user           | Managed-cloud margin      |
| Free package install                   |               Free | Local device or publisher | None                      |
| Third-party package purchase           |        Store price | Buyer                     | Store commission          |
| First-party package purchase           |        Store price | Buyer                     | First-party Store revenue |

## MVP checkpoint economics

The [MVP master plan](../execution/mvp-plan.md) separates two release checkpoints:

- **Core plus Store candidate:** must remain operable with managed AI and managed cloud switches disabled. Free local/BYOK paths create no provider liability, while first-party Store checkout uses ordinary payment and authoritative entitlement.
- **Full managed-usage MVP:** additionally enables prepaid managed AI and scale-to-zero managed cloud only after the independent C6B evidence gate pass.

Store advances continuously from S0 evidence through S6 release and never waits for managed usage. C2 Store commerce and C6B Full managed usage have separate accounting, reconciliation, rollout, and kill switches; failure in one cannot be hidden by revenue or progress in the other.

C0-C6 progress reports identify the current checkpoint, Store slice, enabled commercial switches, and passing or blocked economic acceptance atoms. Core plus Store readiness and Full managed-usage readiness are reported separately.

## Unit-economics invariant

Every paid transaction must be contribution-positive under its admitted worst-case cost envelope:

```text
sale value
>= provider or infrastructure cost
 + payment allocation
 + tax and currency reserve
 + bounded retry reserve
 + refund, fraud, and chargeback reserve
 + configured minimum contribution
```

If cost cannot be bounded, the paid action must not start. Managed usage additionally requires sufficient Credit reservation; Store activation requires authoritative payment, order, and entitlement state through its separate commerce rail.

Transaction-positive does not mean company-profitable. Company cash flow becomes positive only when aggregate realized contribution exceeds fixed operating cost. Unused purchased Credit and publisher proceeds are liabilities, not company profit.

## Survival-mode assumptions

The following scenarios assume a local-first desktop product, 35-45% MAU, scale-to-zero control services, no payroll, no marketing, no human support SLA, no warm VM pool, no free managed compute, efficient update distribution, and prepaid AI/cloud usage.

| Registered users |     Assumed MAU | Illustrative control-plane cost/month |
| ---------------: | --------------: | ------------------------------------: |
|             1-10 |            1-10 |                                 $0-25 |
|              100 |           30-50 |                                $10-50 |
|            1,000 |         300-500 |                               $20-100 |
|           10,000 |     3,500-5,000 |                               $50-300 |
|          100,000 |   35,000-50,000 |                            $400-1,500 |
|        1,000,000 | 350,000-450,000 |                         $3,000-12,000 |

These ranges exclude payroll, legal, tax, insurance, compliance, marketing, package subsidies, and human support. Vendor prices, region, update size, abuse, retention, and support load can move actual cost outside the ranges.

A free user remains cheap only while local execution is the default, private context stays local, synchronization is bounded, support is self-service, and managed resources require payment.

## Twenty-payer scenario

The following is an example, not a guaranteed minimum.

| Input                                        | Illustrative value |
| -------------------------------------------- | -----------------: |
| Retained payers                              |                 20 |
| Monthly managed/Store spend per payer        |                $20 |
| Transaction volume                           |               $400 |
| Realized contribution at 25%                 |               $100 |
| Control-plane cost                           |             $10-50 |
| Remainder before founder pay, tax, and legal |             $50-90 |

"Payer" must always be reported with spend and realized contribution. A user who spends $1 and a user who spends $100 are not economically equivalent.

## Operating stages

### Survival mode

Applies while there are fewer than approximately 10 retained payers or the economic gates below are not met.

- scale-to-zero control plane and a Core plus Store path that remains usable with managed switches disabled;
- curated first-party and free Store packages plus, after C2C passes, at most one first-party paid path;
- only after C6B passes, one managed-AI payment path and one ephemeral cloud provider/resource class;
- no warm VM, reserved capacity, or permanent cluster;
- founder-operated, community, or automated support;
- hard provider, account, task, and daily spending caps.

### Validation mode

A planning signal is 10-30 payers retained for two billing cycles and at least 30 completed paid runs. Entry additionally requires durable receipts proving positive unit contribution, bounded failure cost, correct refunds, and no negative Credit balance.

### Serious operations

User count alone never activates higher fixed cost. Serious operations begin only after:

- approximately 30-50 retained payers;
- at least $1,000 monthly realized contribution for three consecutive months;
- realized contribution covers at least 1.5 times the next-stage fixed monthly cost for those three months;
- cash reserves cover at least six months of that new fixed cost;
- security, recovery, billing reconciliation, incident, and package-release gates pass;
- refund, fraud, utilization, and support load are measured.

The payer and dollar values are planning signals, not automatic entitlements to spend. The evidence conditions are authoritative.

### Pooled cloud capacity

A warm shared host or pool is permitted only when measured demand proves it improves cost or latency and the previous period's cloud contribution covers at least 1.5 times the forecast pool cost. Multi-tenant isolation, resource exhaustion, noisy-neighbour, cleanup, and incident tests must pass first.

### Committed capacity

Savings plans, reserved capacity, or another fixed commitment requires a stable measured load floor. Registration forecasts, wait-list size, or unused purchased Credit do not justify a commitment.

### Hiring

A recurring role is added only when realized contribution and cash reserves can fund its fully loaded cost for the approved runway. Annual prepayments and unused Credit remain service obligations.

## Growth reporting

Every economic report separates:

- registration, MAU, retained payer, and transaction counts;
- AI, cloud, third-party Store, and first-party Store GMV;
- provider cost, infrastructure cost, payment cost, reserve, and realized contribution;
- fixed control-plane cost, payroll, support, compliance, marketing, and sponsorship;
- cash collected, revenue recognized, liabilities, and company profit.

No report may label payment volume, unused Credit, publisher proceeds, or an unconsumed annual prepayment as profit.

Release reporting also separates Core plus Store from Full managed usage. It lists acceptance-atom totals and passes for each track, C0-C6 checkpoint, S0-S6 Store slice, enabled or disabled switches, latest evidence revision, and named blockers. A high GMV or Store completion percentage cannot mask a Run, Trust, package-isolation, Credit, or reconciliation failure.

## Economic non-goals for MVP

MVP economics do not assume public third-party payout, provider volume discounts without a signed agreement, free managed compute, warm capacity, recurring subscription revenue, or a user-count threshold that automatically authorizes fixed spending. Those decisions remain gated by measured contribution, legal authority, isolation, and runway evidence.

## Related documents

- [Product vision](vision.md)
- [Billing, Tomni Credit, and settlement](../platform/credits-and-billing.md)
- [Managed cloud execution](../platform/cloud-execution.md)
- [Store commerce](../platform/store-commerce.md)
- [Local and cloud AI runtime](../core/ai-runtime.md)
