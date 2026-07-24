# Design Document

## Overview

Thiết kế này tạo một outbound security core trong Main process, dùng lại Secret Firewall, file security, image OCR, permission/auth và ResourceCoordinator hiện có. Lõi này không tạo password manager, permission system, HTTP client, OCR engine hay scheduler mới.

Mục tiêu đầu tiên là một text inspection gate thuần, có thể chạy đồng bộ/asynchronous tùy boundary, trả safe projection và quyết định fail-closed trước mọi side effect mạng/tool/browser/upload.

## Architecture

## 1. Kiến trúc và ownership

### Security tab được sửa

- `packages/desktop/src/process/services/security/` — pure outbound inspection/policy service và types nội bộ nếu thư mục còn chỗ.
- `packages/desktop/src/process/bridge/` — Main bridge adapter chỉ khi Tab 1 cấp seam/allowlist.
- `packages/desktop/src/process/agentRuntime/agentMesh/security/` — chỉ sửa nếu cần mở public API tối thiểu hoặc test; không thay thuật toán Secret Firewall.
- `packages/desktop/src/process/visualArtifact/` — chỉ sửa integration của image scan khi owner cho phép; không thay OCR.
- `packages/desktop/src/renderer/` — UI chỉ sau khi bridge contract ổn định, cùng i18n/frontend owner approval.
- `packages/desktop/tests/unit/` hoặc thư mục test theo convention hiện có — tests của Security tab.

### Không được sửa trong tab này

- `common/adapter/ipcBridge.ts`, `preload/main.ts`, bridge/bootstrap registration, shared navigation và shared outbound request helper thuộc Tab 1.
- Conversation send boxes, Agent Mesh execution, browser manager, command executor, FileService/upload client, provider clients và ResourceCoordinator implementation.
- Password/auth/session token storage và permission implementation.

Mọi thay đổi vào nhóm trên là handoff, không phải silent edit.

## Components and Interfaces

## 2. Contract đề xuất

```ts
type OutboundSurface =
  | 'chat'
  | 'agent'
  | 'tool'
  | 'browser'
  | 'command'
  | 'file'
  | 'image'
  | 'provider';

type InspectionDecision = 'allow' | 'sanitize' | 'block' | 'approval_required' | 'failed_closed';

type OutboundTextPart = {
  id: string;
  text: string;
  role?: 'system' | 'user' | 'assistant' | 'tool' | 'metadata';
  source?: 'user' | 'agent' | 'file' | 'browser' | 'command' | 'tool' | 'generated';
};

type OutboundInspectionRequest = {
  schemaVersion: 1;
  requestId: string;
  runId?: string;
  taskId?: string;
  actorId: string;
  surface: OutboundSurface;
  target: { kind: string; id: string };
  parts: readonly OutboundTextPart[];
  requestedCapability?: string;
  sensitivity: 'normal' | 'restricted' | 'secret-bearing';
};

type SafeFinding = {
  type: string;
  name: string;
  confidence: 'low' | 'medium' | 'high';
};

type OutboundInspectionResult = {
  schemaVersion: 1;
  requestId: string;
  decision: InspectionDecision;
  safeParts: readonly OutboundTextPart[];
  findings: readonly SafeFinding[];
  reasonCode: string;
  requiresUserDecision: boolean;
  approvalId?: string;
  expiresAt?: number;
};
```

`safeParts` is the only payload allowed to move to renderer, receipt, or later outbound adapter. Original input is processed in memory and is not returned in errors or metadata. For non-text binary content, the phase-1 contract carries only a reference and delegates to the later file/image gate.

## Data Models

## 3. Processing pipeline

```text
candidate text
  -> normalize/bound size
  -> Secret Firewall existing primitive
  -> merge safe findings
  -> existing permission/capability preflight
  -> target/surface policy
  -> allow | sanitized | approval | block
  -> safe projection to bridge/UI
  -> only approved adapter emits network/tool/browser/upload side effect
  -> bounded safe receipt
```

The processing service is pure except for policy/permission dependency injection. It must not log input. It must not call a provider. It must not access password values. It must not infer approval from a missing user response.

### Initial policy behavior

- No finding + valid capability + known target: `allow`.
- Finding and policy permits redaction: `sanitize`; send only `safeParts`.
- Finding cannot be safely represented, target is untrusted, capability is missing, or policy is unavailable: `block` or `failed_closed`.
- User may override only where existing permission policy explicitly allows approval; otherwise `block`.
- Any detector/policy/bridge exception: `failed_closed`.

Reason codes are stable identifiers (`secret_detected`, `sanitized_secret`, `approval_required`, `policy_unavailable`, `unknown_schema`, `inspection_error`, `target_not_allowed`) and are translated by i18n in renderer.

## 4. Integration seam for Tab 1

Tab 1 must add one shared Main-owned `inspectOutbound` seam used by all send adapters. It should wrap the existing HTTP/WS/send helpers rather than patching every React send box. The seam must accept a callback or typed side-effect descriptor so inspection completes before invocation.

Required integration points to route through that seam:

- `ipcBridge.conversation.sendMessage` and ACP/OpenClaw variants.
- Agent Mesh/MCP/IDE tool dispatch and tool results.
- Browser navigation/page extraction/media transcription.
- Command execution arguments, cwd, stdout and stderr when crossing an external boundary.
- File reads/context/attachments and `uploadFileViaHttp` quarantine/commit path.
- Image attachment/screenshot/OCR/multimodal provider payload.
- `RotatingApiClient`, provider REST, streaming WebSocket and gateway-facing requests.
- Direct renderer `fetch` paths such as pipeline/provider calls must be eliminated or wrapped by the shared owner seam.

For each integration, the adapter must pass an explicit `target` and `surface`, await a decision, then perform exactly one side effect with `safeParts`. Cancellation before commit is safe deny; cancellation after a committed side effect is recorded as outcome, never hidden.

## 5. Bridge and UI projection

Main exposes only `OutboundInspectionResult` and bounded status events. Preload adds typed bridge methods under existing adapter conventions. Renderer owns a small status/approval projection and never imports Main security modules.

The UI must show:

- current status and target;
- localized reason and finding category;
- whether text was blocked or sanitized;
- preview of safe text only;
- approval/deny actions if `requiresUserDecision`.

Approval action includes `approvalId`, request correlation and explicit decision, not the candidate text or credential. Bridge errors return `failed_closed`. No UI timeout auto-approves.

## 6. File/image and AI phases

### File/image

Reuse `redactSecretFileText` for text files and `scanImageForSensitiveText` for image OCR. Upload should first use a temporary/quarantine destination or pre-upload text extraction, then commit only after policy. Original binary must not cross a provider boundary before the decision. OCR-required failure blocks.

Heavy OCR or local 0.8B inference must request a ResourceCoordinator lease through an adapter owned by Tab 1; Security does not create a second lease manager.

### AI 0.8B

The 0.8B model is an optional classifier after deterministic processing. Its input is sanitized/minimized. It can suggest a category or confidence only; policy remains authoritative. Model unavailable, timeout, malformed response or low confidence yields the configured fail-closed result.

## 7. Safe receipt

```ts
type OutboundSecurityReceipt = {
  schemaVersion: 1;
  receiptId: string;
  requestId: string;
  runId?: string;
  actorId: string;
  surface: OutboundSurface;
  targetKind: string;
  decision: InspectionDecision;
  reasonCode: string;
  findingTypes: readonly string[];
  policyVersion: string;
  createdAt: number;
};
```

Receipts are bounded and contain no input, safe text, token prefix, regex capture, file content or password. Persisting receipts uses the existing audit/event owner and must not create a parallel store.

## Error Handling

## 8. Failure handling

- Unknown schema, missing actor/target, missing capability or policy error: `failed_closed`/`block`.
- Detector error: no outbound call; safe UI error with localized reason.
- Bridge disconnect: no outbound call; pending approval expires to deny.
- Resource lease unavailable: block or queued state according to existing coordinator policy; never bypass lease.
- Partial multi-part inspection failure: reject the whole request; no mixed safe/unsafe send.
- Retry is permitted only for pure inspection or idempotent policy lookup. Side effects are not retried by this design.

## Correctness Properties

### Property 1: Inspection precedes side effects

No request side effect occurs before a non-failing inspection and policy decision.

**Validates: Requirements 1.1, 1.3, 3.1**

### Property 2: Results contain no plaintext

A blocked or failed-closed result never exposes plaintext in its result, receipt, error, or UI projection.

**Validates: Requirements 2.4, 3.5, 7.5**

### Property 3: Sanitization is authoritative

Sanitized outbound payloads contain only the safe text returned by the existing firewall.

**Validates: Requirements 2.1, 2.3, 2.5**

### Property 4: Failure never becomes allow

Approval timeout, bridge loss, policy error and AI failure never produce an allow decision.

**Validates: Requirements 3.2, 4.5, 6.4**

## Testing Strategy

## 9. Test strategy

- Unit tests for deterministic text inspection and finding metadata.
- Property tests for no plaintext in result/receipt/error and bounded output.
- Contract tests for callback not invoked on block/failure and invoked once on allow/sanitize.
- Integration tests for HTTP/WS/tool/browser/command/file/image adapters, ordered before side effect.
- Bridge tests for serialization, unknown schema, disconnect and explicit approval.
- DOM/i18n tests for all status states and safe preview; no raw secret assertion in snapshots.
- Existing security, auth and resource tests remain unchanged except for adapter contracts.
