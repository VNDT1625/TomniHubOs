# Implementation Plan: Tomni Efficiency Core

## Overview

Triển khai theo từng năng lực hoàn chỉnh trên các primitive hiện có. Không tạo ResourceCoordinator/Agent scheduler/ToolSelector thứ hai. Mọi task phải giữ allowlist và dừng nếu cần sửa file thuộc Tab 1.

## Tasks

## Phase 0 — Baseline, ownership và contract gate

- [ ] 0.1 Xác nhận worktree chỉ là `C:\NDT\PJ\TomniHubOS` và đọc `AGENTS.md`, architecture/performance/testing/i18n rules.
- [ ] 0.2 Lập file allowlist của Tab 4: `process/resource/*`, resource settings page-private, toolselect integration và agent adapter được owner chấp thuận.
- [ ] 0.3 Đánh dấu shared files không được sửa: foundation/common contracts, bootstrap/navigation, shared IPC/i18n config; ghi handoff nếu cần.
- [ ] 0.4 Đọc test hiện có và tạo baseline report cho typecheck/lint/target tests; không auto-fix baseline trong phase design.
- [ ] 0.5 Chốt reason-code, event, usage và explanation shape; nếu cần common contract thì yêu cầu Tab 1 cung cấp seam, không copy.

## Phase 1 — Đọc máy và effective resource policy

- [ ] 1.1 Chuẩn hóa pressure sample và phân loại `healthy | constrained | critical` trong module `resource` hiện có.
- [ ] 1.2 Bổ sung stale/error handling cho probe/sampler với conservative fallback.
- [ ] 1.3 Tính configured vs effective budget/limit; critical pressure phải giảm agent/heavy-task concurrency.
- [ ] 1.4 Ghi reason code và bounded sample/adjustment history; giữ persistence `resource-state.json` hiện có.
- [ ] 1.5 Viết unit tests cho weak/normal/critical machine, malformed sample, ceiling/reserve/clamp.
- [ ] 1.6 Mở rộng Resource Dashboard/System Insight page-private để hiển thị pressure, stale state, effective limit và lý do.
- [ ] 1.7 Thêm i18n keys cho en-US, vi-VN và các locale được project yêu cầu; chạy i18n validation.
- [ ] 1.8 Cập nhật tài liệu vận hành: ý nghĩa pressure, preset, safety floor và rollback flag.

## Phase 2 — Agent concurrency qua lease duy nhất

- [ ] 2.1 Xác định entry point executor của `AgentJobOrchestrator` và bọc mọi heavy agent run bằng shared `ResourceCoordinator.requestLease({ kind: 'agent' })`.
- [ ] 2.2 Tính effective concurrency = min(session/request/user/resource safety); không tạo semaphore/scheduler mới.
- [ ] 2.3 Bổ sung metadata run/task/attempt nếu seam hiện có cho phép; nếu thuộc shared Tab 1 thì chỉ map local correlation.
- [ ] 2.4 Đảm bảo release trong success, failure, abort, timeout và hibernate; thêm guard chống double release.
- [ ] 2.5 Xử lý queue state khi agent chờ lease; durable restore phải re-check resource trước khi chạy.
- [ ] 2.6 Viết contract tests cho concurrency cap, weak-machine reduction, executor throw, abort, timeout và hibernate.
- [ ] 2.7 Bổ sung UI configured/effective agent limit, queued agent reason và user controls trong resource/agent page-private surfaces.
- [ ] 2.8 Cập nhật agent/resource docs và reason-code table.

## Phase 3 — Queue chống quá tải

- [ ] 3.1 Mở rộng pending request metadata trong ResourceCoordinator, giữ priority/FIFO và thêm bounded aging.
- [ ] 3.2 Thêm cancellation/deadline cho pending lease; mọi waiter phải settle, không promise leak.
- [ ] 3.3 Bounded queue capacity và typed rejection khi đầy; không drop accepted jobs.
- [ ] 3.4 Emit snapshot/event đủ cho active, queued, wait age, estimated cost, blocked reason và state.
- [ ] 3.5 Tích hợp queue projection với ResourceDashboard/CommandQueuePanel mà không tạo queue runtime thứ hai.
- [ ] 3.6 Viết tests ordering, starvation prevention, cancel head/middle/tail, timeout, release drain và restart semantics.
- [ ] 3.7 Thêm i18n cho queue state, cancel, full, timeout, stale và estimated wait.
- [ ] 3.8 Viết tài liệu người dùng về hàng đợi và cách điều chỉnh giới hạn.

## Phase 4 — Rule-first AI/tool/package choice

- [ ] 4.1 Mở rộng catalog/selector result hiện có để trả factors, tier, rejected candidates và explanation reason.
- [ ] 4.2 Implement deterministic eligibility/ranking từ config, health, compatibility, cost, latency, resource estimate và historical signal.
- [ ] 4.3 Bảo đảm recall từ `SelectionLog` luôn revalidate health/policy/resource hiện tại.
- [ ] 4.4 Giữ keyword trước semantic; semantic index/query phải xin `semanticIndex` lease và top-k bounded.
- [ ] 4.5 Tạo advisor interface injectable; chỉ gọi khi rule/semantic không đạt threshold hoặc có evidence conflict.
- [ ] 4.6 Validate advisor output, timeout/token/cost budget, unknown ids và fallback deterministic.
- [ ] 4.7 Giữ retry/reselect bounded; log attempt/failure reason không chứa secret.
- [ ] 4.8 Viết tests chứng minh request dễ không gọi advisor, scoring/explanation ổn định, semantic lease, advisor fallback và no infinite retry.
- [ ] 4.9 Bổ sung UI choice explanation, candidate rejected và user-adjustable cost/priority knobs nếu không đụng shared UI.
- [ ] 4.10 Bổ sung i18n/docs cho selection tiers, factor labels và explanation templates.

## Phase 5 — Time, cost và usage accounting

- [ ] 5.1 Chốt execution usage record trong resource/choice allowlist; phân biệt estimate và actual.
- [ ] 5.2 Instrument lease wait, start, duration, tokens, money cost, memory estimate/peak và outcome status.
- [ ] 5.3 Enforce deadline/timeout ở queue và execution; abort + release + event trong mọi path.
- [ ] 5.4 Thêm budget validation cho time/cost/usage theo config seam hiện có; không sửa shared config owner nếu chưa được chấp thuận.
- [ ] 5.5 Persist bounded usage atomically; handle corrupt/read/write failure conservative.
- [ ] 5.6 Viết tests accounting, timeout, cancellation, budget remaining, persistence retention và redaction.
- [ ] 5.7 Mở rộng UI usage/budget/over-limit state và controls; thêm locale keys.
- [ ] 5.8 Cập nhật tài liệu đo lường và hướng dẫn đọc estimate/actual.

## Phase 6 — Learning từ outcome đã xác minh

- [ ] 6.1 Mở rộng `SelectionLog` hoặc adapter được owner duyệt để lưu outcome/conditions/usage/version.
- [ ] 6.2 Chỉ cập nhật positive signal cho `verified`; tách failed/cancelled/timed_out.
- [ ] 6.3 Implement decay, minimum sample/condition weighting và bounded retention.
- [ ] 6.4 Bảo đảm recall không bypass health/compatibility/policy/resource; learning failure không chặn execution.
- [ ] 6.5 Thêm reset/delete learning operation với quyền và confirmation phù hợp.
- [ ] 6.6 Viết tests verified gating, decay, outlier resistance, reset, corrupt log và atomic writes.
- [ ] 6.7 Hiển thị learning summary/reset trên page-private UI, toàn bộ text qua i18n.
- [ ] 6.8 Viết tài liệu learning policy, privacy/redaction và cách vô hiệu hóa advisor/learning.

## Phase 7 — Integration, validation và handoff

- [ ] 7.1 Chạy typecheck, lint/format và target tests sau từng slice; không sửa unrelated/pre-existing issues.
- [ ] 7.2 Nếu có renderer/i18n changes, chạy `bun run i18n:types` và `node scripts/check-i18n.js`.
- [ ] 7.3 Kiểm tra Main/Renderer boundary, directory child limit và coverage inclusion.
- [ ] 7.4 Verify no second coordinator/queue/selector exists bằng code search và dependency review.
- [ ] 7.5 Kiểm tra lease count về baseline sau success/failure/cancel/timeout/idle.
- [ ] 7.6 Kiểm tra weak machine: concurrency giảm, queue tăng bounded, app vẫn responsive; ghi before/after metrics theo performance skill.
- [ ] 7.7 Chạy relevant Vitest tests và project checks được phép; ghi residual failures rõ ràng.
- [ ] 7.8 Cập nhật design/ownership/rollback docs và handoff mọi thay đổi shared cho Tab 1.

## Dependency gates

- Phase 1 trước Phase 2/3.
- Phase 2 và Phase 3 có thể song song sau effective-limit contract.
- Phase 4 cần catalog/selector contract và resource gate ổn định.
- Phase 5 cần lease lifecycle và execution boundary của Phase 2/3.
- Phase 6 cần usage/outcome schema của Phase 4/5.
- Phase 7 chỉ hoàn tất khi tests, i18n, boundary và no-duplicate review đạt.

## File collision rules

- Chỉ sửa `packages/desktop/src/process/resource/*`, `packages/desktop/src/process/toolselect/*` và integration files được owner Tab 4 chấp thuận.
- Agent runtime chỉ sửa adapter/call-site cần thiết; không refactor Agent Mesh engine ngoài phạm vi.
- Renderer chỉ sửa page-private Resource/Agent/Tool explanation components; không sửa shared navigation/foundation.
- `packages/desktop/src/common/config/*`, shared `ipcBridge.ts`, preload/bootstrap và Tab 1 foundation là read-only cho Tab 4.
- Không tạo file mới nếu làm directory vượt 10 direct children; dùng subdirectory phù hợp architecture skill.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": "wave-0", "tasks": ["0.1", "0.2", "0.3", "0.4", "0.5"] },
    { "id": "wave-1", "dependsOn": ["wave-0"], "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] },
    { "id": "wave-2", "dependsOn": ["wave-1"], "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8"] },
    { "id": "wave-3", "dependsOn": ["wave-2"], "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10"] },
    { "id": "wave-4", "dependsOn": ["wave-3"], "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8"] },
    { "id": "wave-5", "dependsOn": ["wave-4"], "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8"] },
    { "id": "wave-6", "dependsOn": ["wave-5"], "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8"] }
  ]
}
```

## Notes

Tasks được sắp theo dependency gate; mỗi task phải giữ ownership và không sửa file Tab 1.

## Definition of done

- Sáu năng lực hoạt động trên primitive hiện có, không có manager/scheduler/selector thứ hai.
- Máy yếu giảm concurrency và queue thay vì làm treo ứng dụng.
- Mọi choice có explanation; advisor chỉ dùng hard cases.
- Mọi execution có timeout/cost/resource accounting và release lease đầy đủ.
- Verified outcomes mới học; learning có reset/retention/redaction.
- UI trạng thái/queue/limits/choice/usage có i18n, tests và docs.
- Không sửa file Tab 1 ngoài handoff được phê duyệt.
