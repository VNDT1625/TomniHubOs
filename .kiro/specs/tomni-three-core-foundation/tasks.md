# Implementation Plan: Tomni Three-Core Foundation

## Overview

Giai đoạn này chỉ chốt thiết kế, phạm vi tệp và thứ tự phụ thuộc. Không triển khai ba lõi thay mặt các tab lõi.

## Tasks

## Phase 0 — Baseline và ownership

- [ ] 0.1 Xác nhận branch/worktree chỉ là `C:\NDT\PJ\TomniHubOS`; không đọc/sửa repo AionUi.
- [ ] 0.2 Lưu baseline hiện trạng: `bun run lint:fix` không chạy auto-fix trong phase design; chạy read-only project checks phù hợp và ghi lỗi có sẵn.
- [ ] 0.3 Chốt danh sách owner file theo `design.md`; mọi PR/task mới phải ghi rõ tab owner và file allowlist.
- [ ] 0.4 Đối chiếu `.kiro/specs/agent-company-pipeline` và `personal-manager`; không tạo engine/run graph thứ hai.

## Phase 1 — Common contracts (Foundation tab)

- [x] 1.1 Tạo `packages/desktop/src/common/foundation/runTypes.ts` cho RunIntent, TaskRef, AttemptRef và identity invariants.
- [x] 1.2 Tạo `decisionTypes.ts` cho PolicyDecision, ContextProjection, WorkGraphProjection, SelectionDecision và ExecutionPlan.
- [x] 1.3 Tạo `receiptTypes.ts` và versioned event envelope; enforce safe metadata/no plaintext secret.
- [x] 1.4 Export qua `common/foundation/index.ts`; viết contract tests cho serialization, idempotency và unknown version rejection.
- [ ] 1.5 Chạy typecheck/lint/format và ghi baseline/result. (Chưa đạt: lệnh kết thúc với exit code -1 trong môi trường hiện tại.)

## Phase 2 — Security seam (Foundation adapter, Security implementation owned by Security tab)

- [ ] 2.1 Chốt interface preflight coarse và target-specific theo run/task/target/capabilities/expiry.
- [ ] 2.2 Adapter hóa Secret Firewall/opaque handle/trusted sink hiện có; không expose secret value.
- [ ] 2.3 Chốt approval/deny/revoke/expiry events và safe receipt.
- [ ] 2.4 Security tab cung cấp implementation và tests; Foundation chỉ tích hợp qua interface.
- [ ] 2.5 Chạy toàn bộ checks, ghi phần ghép và lỗi còn lại.

## Phase 3 — Understanding seam (Foundation adapter, Understanding implementation owned by Understanding tab)

- [ ] 3.1 Chốt input/output projection từ ContextStore/ContextComposer/IDE ContextBuilder.
- [ ] 3.2 Chốt Work Graph reference model cho goal/constraint/criteria/task/artifact/evidence/outcome.
- [ ] 3.3 Bảo đảm explicit request thắng inferred context; bounded output và provenance giữ nguyên.
- [ ] 3.4 Understanding tab cung cấp implementation và privacy/consent tests; không copy ContextStore.
- [ ] 3.5 Chạy toàn bộ checks, ghi phần ghép và lỗi còn lại.

## Phase 4 — Resource and choice seam (Foundation adapter, Resource/Choice implementation owned by Resource/Choice tab)

- [ ] 4.1 Chốt candidate eligibility/ranking/explanation contract dùng lại ToolSelector/SelectionLog.
- [ ] 4.2 Chốt ExecutionPlan -> ResourceCoordinator lease adapter; lease không thay policy.
- [ ] 4.3 Chốt retry/reselect, cancellation, timeout và starvation observability.
- [ ] 4.4 Resource/Choice tab cung cấp implementation và tests; không tạo scheduler/selector thứ hai.
- [ ] 4.5 Chạy toàn bộ checks, ghi phần ghép và lỗi còn lại.

## Phase 5 — Run Kernel integration (Foundation tab)

- [ ] 5.1 Implement orchestration seam theo thứ tự: intent -> policy -> context -> choice -> policy -> lease -> execution -> evidence -> receipt.
- [ ] 5.2 Tích hợp Agent Mesh/Company/Personal Manager qua adapters/graph projections hiện có; không thay engine của chúng.
- [ ] 5.3 Gắn event causation/correlation và idempotency; replay không gọi provider/tool.
- [ ] 5.4 Thêm failure isolation, cancellation và safe cleanup paths.
- [ ] 5.5 Chỉ sau khi Main contract ổn định mới thiết kế bridge/preload projection cho renderer.

## Phase 6 — Documentation and handoff

- [ ] 6.1 Cập nhật docs architecture/contract với diagram và ownership matrix.
- [ ] 6.2 Ghi compatibility/rollback path cho legacy Company, Manager, Agent Mesh và existing IPC.
- [ ] 6.3 Chạy project-wide validation; ghi rõ files changed, integrated pieces, remaining errors và next step.
- [ ] 6.4 Handoff từng tab theo allowlist; Foundation tab nhận lại shared wiring בלבד.

## Dependency gates

- Phase 1 trước mọi adapter.
- Phase 2 và Phase 3 có thể triển khai song song sau Phase 1.
- Phase 4 chỉ bắt đầu sau khi candidate contract của Phase 1 ổn định; Phase 2 policy interface phải có trước execution adapter.
- Phase 5 cần Phase 2, 3, 4 hoàn tất và có contract tests.
- Phase 6 chỉ hoàn tất sau project-wide checks và rollback review.

## Tab/file collision rules

- Security tab không sửa `common/foundation/*`, `runKernel.ts`, bridge/bootstrap/navigation.
- Understanding tab không sửa security/resource/choice adapters hoặc shared contract.
- Resource/Choice tab không sửa context/security adapters hoặc shared contract.
- Foundation tab không sửa core algorithms; chỉ thêm adapter/integration và shared wiring.
- Mọi ngoại lệ phải được ghi trong design decision trước khi sửa.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": "wave-0", "tasks": ["0.1", "0.2", "0.3", "0.4"] },
    { "id": "wave-1", "dependsOn": ["wave-0"], "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": "wave-2", "dependsOn": ["wave-1"], "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "id": "wave-3", "dependsOn": ["wave-2"], "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": "wave-4", "dependsOn": ["wave-3"], "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5"] },
    { "id": "wave-5", "dependsOn": ["wave-4"], "tasks": ["6.1", "6.2", "6.3", "6.4"] }
  ]
}
```

## Notes

Tasks are intentionally planning-only until the three core tabs accept the ownership matrix and contracts.