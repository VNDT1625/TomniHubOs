# Managed cloud execution

**Status:** TARGET. The repository does not currently contain a production payment-to-reservation-to-provision-to-settlement cloud-compute path. A cloud model API or workspace relay is not evidence of cloud VM execution.

## Objective

Tomni-managed cloud is an independently gated **Full managed-usage MVP** capability, not a prerequisite for the **Core plus Store candidate**. The earlier candidate can ship with provisioning disabled while local execution, BYOK, user-owned cloud, Store catalog and ordinary checkout, remote developer-hosted capabilities, and valid entitlements continue to work. When enabled, Tomni provisions a remote sandbox only after a user accepts a bounded quote and sufficient Tomni Credit is reserved.

```text
no accepted paid task
-> no running managed VM, container, or GPU
-> zero managed compute-resource charge
```

The small account, ledger, catalog, and receipt control plane is separate and governed by the cost cap in [product economics](../product/economics.md).

## Execution choices

- **Local:** the user's device supplies compute.
- **Bring your own cloud:** the user supplies a cloud account; Tomni provides free governed orchestration.
- **Developer-hosted capability:** a package publisher supplies the remote service under Store offer, entitlement, capability, data-location, and egress policy; this does not provision Tomni-managed compute or couple Store accounting to Credit.
- **Tomni-managed cloud:** Tomni supplies the account and provisions only against reserved Credit.

Every choice enters the same Run, TrustBroker, permission, egress, evidence, cancellation, and receipt lifecycle.

## Stable resource request

Core services request provider-neutral resources:

```ts
type CloudResourceRequest = {
  cpuMillis: number;
  memoryMiB: number;
  gpu?: {
    class: 'none' | 'shared' | 'dedicated';
    memoryMiB?: number;
  };
  diskMiB: number;
  networkClass: 'restricted' | 'standard' | 'high';
  expectedDurationMs: number;
  deadlineAt: string;
  isolation: 'sandbox' | 'dedicated';
  serviceLevel: 'economy' | 'standard' | 'priority' | 'dedicated';
  maxCreditMinor: CreditMinor;
};
```

The core does not encode AWS, Azure, Google Cloud, or another vendor SKU. A cloud adapter maps this request to a supported resource, reports the priced candidate, and remains replaceable.

`CreditMinor` is the versioned canonical non-negative integer amount owned by the Credit ledger contract. Its transport encoding is frozen with that contract; cloud adapters cannot substitute floating-point or provider-native money.

## Launch resource model

The Full managed-usage MVP deliberately minimizes operational logic:

- one provider;
- one General on-demand resource class;
- scale-to-zero provisioning;
- one sandbox per task;
- no warm pool;
- no reserved or savings commitment;
- hard task timeout, concurrency, and account-spend caps;
- no GPU unless the same lifecycle and margin gates pass separately.

The Full managed-usage MVP accepts only the versioned `standard` service intent and maps it to the General on-demand class. Other enum values remain reserved contract space and fail admission until their pricing, queue, isolation, capacity, and economic gates are separately proven. Users never select a provider SKU.

## Admission and provisioning

```text
normalize task
-> compute resource and package requirements
-> TrustBroker policy and data-location check
-> priced candidate and maximum quote
-> user acceptance when required
-> atomic Credit reservation
-> resource and capability leases
-> provision sandbox
-> execute and meter
-> verify outcome
-> terminate and clean
-> settle and release
-> durable receipt
```

The cloud adapter must not receive a provision request if reservation fails. Provisioning after quote expiry or against unresolved billing state is denied.

## Isolation contract

Each task receives:

- Run-, account-, and sandbox-bound identity;
- isolated filesystem and temporary artifact namespace;
- only opaque secret leases required for declared destinations;
- network destination policy and final-egress inspection;
- CPU, memory, GPU, disk, network, process, and output quotas;
- deadline, cancellation, process-tree cleanup, and resource revocation;
- package identities and exact capability grants;
- safe logs, evidence, usage, and terminal receipt.

A sandbox cannot inspect another sandbox's filesystem, process, secret, token, network credential, or usage record. A task whose policy requires dedicated isolation never shares a tenant boundary, even though a Dedicated service tier is outside the managed MVP.

Termination deletes ephemeral disk, revokes secrets and leases, removes network credentials, and releases provider resources. Declared output artifacts move to user-owned storage before cleanup; undeclared residue is destroyed.

## Queue and scheduler

The scheduler admits only tasks with valid policy, quote, reservation, capability, and resource envelopes.

It may:

- place a task on a currently safe eligible host;
- queue until safe capacity exists;
- provision another eligible resource;
- reject when deadline, budget, region, or isolation cannot be satisfied.

It may not overcommit blindly or improve utilization by weakening isolation, deadline, budget, or privacy.

Selection records candidates, exclusion reasons, predicted cost, actual usage, queue time, boot time, and cleanup state.

## Shared-host evolution

One host can later run multiple isolated tasks:

```text
shared host
  -> sandbox A / user A
  -> sandbox B / user B
  -> sandbox C / user C
```

This is post-MVP TARGET, not the Full managed-usage MVP default. Placement requires measured headroom after admission, including memory reserve, CPU pressure, GPU memory, disk IO, network, package conflict, task sensitivity, and cleanup capacity.

A new sandbox is queued or sent elsewhere if admission would cross a safe threshold. A noisy neighbour is throttled, checkpointed when safe, or terminated under the accepted policy.

A shared warm pool is allowed only when:

```text
measured cold-start plus on-demand cost > measured pool cost
and
previous-period cloud contribution >= 1.5 * forecast next-period pool cost
and
cross-tenant isolation and exhaustion suites pass
```

## Committed and interruptible resources

- On-demand is the Full managed-usage MVP default.
- Interruptible or Spot-like resources are post-MVP and eligible only after a checkpointable, retry-safe service intent and its price/failure policy pass.
- Reserved capacity or savings commitment requires a stable measured load floor over multiple periods.
- GPU capacity is its own economic and security gate.
- User registrations, wait-list interest, or purchased but unused Credit do not justify fixed capacity.

## Package and Super Package execution

A package can contribute a remote capability descriptor without downloading executable code to the desktop. The Hub can invoke it through its signed identity, schema, price, permission, data-location, and health contracts.

Local installation is required when the user wants a package UI, direct interaction, local execution, or offline use.

A Super Package can declare cloud steps, local steps, package dependencies, checkpoints, input requests, retry/failure lessons, and budgets. Every child step receives narrowed capability and resource limits, plus Credit limits only when it selects Tomni-managed usage. The Super Package cannot bypass the Run Kernel, TrustBroker, package policy, or applicable billing lifecycle.

## Failure and recovery

- Cancellation is idempotent and has a bounded shutdown deadline.
- Retry is bounded and uses the existing reserve or obtains new approval.
- Restart reconciles Run state, provider resource identity, leases, meter, and reservation.
- A provider resource with no live authorized Run is an orphan and is terminated.
- A committed side effect is never replayed merely because compute restarted.
- Provider or Tomni failure applies the settlement and refund policy in [credits and billing](credits-and-billing.md).

## Full managed-usage acceptance evidence

Full managed-usage acceptance requires integration evidence that:

- provider create is never called when Credit reservation fails;
- a failed or disabled managed-cloud gate does not disable Store catalog, ordinary Store order or entitlement state, developer-hosted remote capabilities, local execution, BYOK, CLI, MCP, or user-owned cloud;
- one paid task produces quote, hold, authorization, provision, usage, settlement, release, receipt, and verified termination;
- cancel, timeout, crash, and application restart leave no orphan VM, container, disk, secret, lease, or negative balance;
- one billing period with no accepted managed-cloud task produces zero managed compute-resource charge;
- a sandbox cannot read another sandbox's data or credential;
- usage and provider invoice reconcile within the billing tolerance;
- no package or renderer can call the provisioner directly.

Before shared-host activation, add adversarial cross-tenant, noisy-neighbour, overcommit, escape, revocation, and forensic-cleanup evidence.

## Rollback and kill behavior

Rollback disables managed-cloud admission or the affected provider adapter while preserving readable quote, reservation, usage, cleanup, settlement, and Run evidence. It does not roll back Store orders or entitlements and never restores a provision-before-reserve path. Local, BYOK, supported CLI, MCP, developer-hosted remote capability, and user-owned cloud remain governed alternatives.

Provision before reservation, stale price, charge above the accepted maximum, cross-tenant read, sandbox escape, secret or payment leak, package or renderer access to the provisioner, unbounded retry, unreconciled provider cost, or any VM, container, disk, credential, network identity, or lease left after terminal recovery stops managed-cloud admission and keeps its gate red.
