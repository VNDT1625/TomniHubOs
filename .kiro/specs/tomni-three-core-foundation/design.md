# Design Document

## Overview

This design defines the shared integration foundation for Security, User Understanding, and Resource/Choice without implementing those cores.

## Architecture

## 1. Architectural decision

Tạo một **integration contract layer**, không tạo runtime thứ hai. Main process là authority cho security, resource và execution; renderer chỉ nhận projection qua preload/bridge. Existing primitives remain owners:

- Security: `packages/desktop/src/process/agentRuntime/agentMesh/security/`, Secret Vault/omni gateway hiện có.
- Understanding: `packages/desktop/src/process/agentRuntime/` context store/composer và `packages/desktop/src/process/ide/` context builder.
- Resource/Choice: `packages/desktop/src/process/resource/` và `packages/desktop/src/process/toolselect/`.

Foundation chỉ nối chúng bằng common types, event/receipt schemas và adapters.

## 2. Proposed file ownership

### Tab Foundation — chỉ tab được sửa

Các tệp dự kiến, tạo trong giai đoạn implement sau khi design được duyệt:

- `packages/desktop/src/common/foundation/runTypes.ts` — run/task/attempt/event identity.
- `packages/desktop/src/common/foundation/decisionTypes.ts` — policy, context, selection, lease và outcome contracts.
- `packages/desktop/src/common/foundation/receiptTypes.ts` — safe audit/outcome receipt schema.
- `packages/desktop/src/common/foundation/index.ts` — public exports.
- `packages/desktop/src/process/foundation/runKernel.ts` — orchestration seam, không chứa domain policy.
- `packages/desktop/src/process/foundation/eventStore.ts` — interface/adapter boundary; persistence implementation phải được quyết riêng.
- `packages/desktop/src/process/foundation/securityAdapter.ts` — gọi primitive security hiện có.
- `packages/desktop/src/process/foundation/contextAdapter.ts` — gọi ContextStore/Composer/ContextBuilder hiện có.
- `packages/desktop/src/process/foundation/choiceAdapter.ts` — gọi ToolSelector/SelectionLog hiện có.
- `packages/desktop/src/process/foundation/resourceAdapter.ts` — gọi ResourceCoordinator hiện có.
- `packages/desktop/src/process/bridge/foundationBridge.ts` và preload registration — chỉ khi UI projection được phê duyệt.

Tab Foundation được phép sửa registration, bootstrap, navigation, shared types và integration seam; không được sửa thuật toán private trong các lõi.

### Tab Security/Trust — không sửa trong foundation phase

Sở hữu các module hiện có dưới `packages/desktop/src/process/agentRuntime/agentMesh/security/`, Secret Vault, trusted sink và policy implementation. Chỉ cung cấp adapter/contract implementation qua API đã chốt.

### Tab User Understanding — không sửa trong foundation phase

Sở hữu ContextStore/ContextComposer, IDE ContextBuilder, Work Graph projection và privacy/consent behavior. Foundation chỉ gọi public API.

### Tab Resource/Choice — không sửa trong foundation phase

Sở hữu ResourceCoordinator, ToolSelector, catalog, semantic filter và SelectionLog. Foundation chỉ truyền plan/metadata và nhận lease/decision.

## Components and Interfaces

The integration components and public contract sketches are defined below; existing core implementations remain the owners of their algorithms.

## Data Models

The shared data models are the versioned run, policy, projection, selection, plan, event, and receipt types described below.

## 3. Data flow

```text
User goal + explicit constraints
  -> RunIntent (Foundation)
  -> Security preflight: PolicyDecision / allowed scopes
  -> Understanding: bounded ContextProjection + WorkGraphProjection
  -> Choice: filtered candidates + SelectionDecision + explanation
  -> Security execution preflight (candidate-specific)
  -> ResourceCoordinator: Lease
  -> trusted execution adapter
  -> Evidence + verification
  -> OutcomeReceipt / append-only event
  -> Work Graph update and opt-in SelectionLog/reputation signal
```

Security runs before choice for coarse eligibility and again after choice for target-specific capability. A lease never grants capability. Context never grants capability. Selection cannot bypass policy.

## 4. Contract sketches

```ts
type RunIntent = {
  runId: string;
  rootTaskId: string;
  surface: string;
  goal: string;
  constraints: readonly string[];
  successCriteria: readonly string[];
  workspaceScope: string;
  userId: string;
  correlationId: string;
  policyVersion: string;
};

type PolicyDecision = {
  decision: 'allow' | 'deny' | 'approval_required';
  runId: string;
  taskId: string;
  targetId?: string;
  capabilities: readonly string[];
  expiresAt?: number;
  reasonCode: string;
  receiptId: string;
};

type ContextProjection = {
  runId: string;
  surface: string;
  text: string;
  sourceRefs: readonly string[];
  maxChars: number;
  sensitivity: 'normal' | 'restricted';
};

type SelectionDecision = {
  selectedId?: string;
  candidates: readonly { id: string; factors: Readonly<Record<string, number>> }[];
  filtered: readonly { id: string; reasonCode: string }[];
  explanation: string;
  retryable: boolean;
};

type ExecutionPlan = {
  runId: string;
  taskId: string;
  candidateId: string;
  resourceKind: string;
  estimatedCostMB: number;
  priority: number;
};

type OutcomeReceipt = {
  receiptId: string;
  runId: string;
  taskId: string;
  selectionReceiptId: string;
  leaseId?: string;
  status: 'verified' | 'failed' | 'cancelled' | 'timed_out';
  evidenceRefs: readonly string[];
  createdAt: number;
};
```

Exact names and serialization rules are implementation-task decisions; these sketches establish ownership and invariants.

## 5. Event model

Use versioned envelope: `eventId`, `eventType`, `aggregateId`, `runId`, `taskId`, `sequence`, `causationId`, `correlationId`, `occurredAt`, `schemaVersion`, `payload`. Events are safe metadata only; payloads must pass secret redaction and size limits. State transitions write before publish. Replay must not invoke external execution.

Minimum event types: `run.created`, `policy.decided`, `context.projected`, `selection.decided`, `lease.requested`, `lease.granted`, `lease.released`, `execution.started`, `evidence.recorded`, `outcome.verified`, `run.failed`, `run.cancelled`.

## Correctness Properties

### Property 1: Policy precedes execution

- Policy decisions precede target selection and execution.

**Validates: Requirements 3.1, 3.2**

### Property 2: Context cannot grant capability

- Context projections are bounded and cannot grant capability.

**Validates: Requirements 2.2, 2.3, 6.2**

### Property 3: Leases are released

- Every granted lease has a release path.

**Validates: Requirements 5.1, 5.2**

### Property 4: Outcomes are traceable

- Every outcome is linked to its run, task, selection, and evidence.

**Validates: Requirements 1.1, 1.2, 6.5**

## Error Handling

## 6. Failure and safety behavior

- Policy deny stops before candidate execution and emits a safe receipt.
- Approval-required pauses with an opaque request id; no implicit allow.
- Context failure degrades to explicit request and empty bounded projection.
- Selector failure may retry/reselect only within configured bounds.
- Lease timeout/cancel always releases through ResourceCoordinator.
- Adapter errors become task-scoped failure events; unrelated branches continue.
- Unknown schema/version is rejected closed.

## Testing Strategy

## 7. Verification strategy

After each implementation slice: typecheck, lint/format, relevant unit/contract tests, i18n checks if bridge/UI changes, and a project-wide check. This phase only defines tests; it does not add tests or implementation yet.
