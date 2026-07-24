# Implementation Plan: Tomni Security Core

## Overview

Triển khai tuần tự, mỗi task phải hoàn chỉnh processing, bridge, UI/status nếu thuộc phase, test, i18n và tài liệu. Tab Security chỉ sửa file trong allowlist; thay đổi shared thuộc Tab 1 được ghi ở handoff, không tự sửa.

## Tasks

## Phase 0 — Baseline, ownership và data-flow inventory

- [x] 0.1 Xác nhận mọi thao tác chỉ ở `C:\NDT\PJ\TomniHubOS`; không đọc/sửa repo khác.
- [x] 0.2 Đọc và lập inventory các primitive hiện có: Secret Firewall, sensitive files, image OCR, auth/password, permissions, IPC/preload, ResourceCoordinator, provider clients, upload và audit.
- [x] 0.3 Lập bảng `source -> boundary -> target -> side effect` cho chat, agent, tool, browser, command, file, image, HTTP, WS, multipart và direct renderer fetch.
- [x] 0.4 Chốt file ownership với Tab 1; ghi mọi shared file cần ghép vào handoff section/design decision.
- [x] 0.5 Ghi baseline: worktree có hàng nghìn thay đổi từ tab khác; test Security mới pass, lint phạm vi mới sạch; project-wide typecheck bị harness kết thúc trước khi có kết quả.

## Phase 1 — Text inspection processing (chức năng đầu tiên)

- [x] 1.1 Tạo contract/versioned types cho request, safe parts, decision, finding metadata và safe receipt trong `process/services/security`.
- [x] 1.2 Implement pure text inspection bằng `redactSecretText`/`redactSensitiveText`; giới hạn số phần/kích thước/tổng, không giữ plaintext và xử lý already-redacted qua primitive hiện có.
- [x] 1.3 Implement policy mapping `allow/sanitize/block/approval_required/failed_closed`, hỗ trợ permission/capability hiện có qua callback `authorize`.
- [x] 1.4 Implement stable reason codes và safe receipt; tests xác nhận secret plaintext không xuất hiện trong result metadata.
- [x] 1.5 Viết unit/contract tests cho allow, sanitize, approval, malformed request, permission deny, block và exactly-once side effect.
- [x] 1.6 Tài liệu module, invariants, ownership và rollback được phản ánh trong `design.md`; public exports có JSDoc tại processing boundary.
- [x] 1.7 `vitest` 6/6 pass, `oxlint` 0 warning/error và diagnostics sạch; project-wide typecheck chưa trả kết quả do harness kết thúc tiến trình.

## Phase 2 — Shared outbound control seam (handoff Tab 1)

- [ ] 2.1 Tab 1 thêm Main-owned wrapper trước side effect, có target/surface/correlation và callback exactly-once.
- [ ] 2.2 Tab 1 nối conversation/ACP/OpenClaw/agent/tool/provider HTTP+WS paths; không patch từng send box như giải pháp cuối.
- [ ] 2.3 Tab 1 nối direct renderer fetch, pipeline calls và gateway/provider requests.
- [ ] 2.4 Security cung cấp adapter contract và contract tests; không sửa shared bridge nếu chưa được ownership chuyển.
- [ ] 2.5 Tests chứng minh block/failure không tạo request, sanitize chỉ gửi safe text, allow gửi đúng một lần.
- [ ] 2.6 Cập nhật data-flow matrix và handoff receipt.

## Phase 3 — IPC bridge và giao diện trạng thái/quyền

- [ ] 3.1 Tab 1 thêm preload/bridge registration theo existing IPC conventions; payload chỉ là safe projection.
- [ ] 3.2 Tạo renderer status projection với các trạng thái checking/sanitized/blocked/approval/allowed/failed_closed.
- [ ] 3.3 Thêm reason/finding/target/action UI bằng Arco + `@icon-park/react` + UnoCSS semantic tokens.
- [ ] 3.4 Dùng i18n keys cho toàn bộ user-facing text; thêm locale/types/check-i18n theo workflow.
- [ ] 3.5 Approval deny/allow phải là hành động tường minh; close/timeout/disconnect là deny.
- [ ] 3.6 DOM/bridge tests chứng minh không render plaintext và không auto-allow.
- [ ] 3.7 Cập nhật tài liệu vận hành và quyền user.

## Phase 4 — Surface-by-surface integration

- [ ] 4.1 Chat/conversation: text trước send, model input và generated prompt; test REST/WS ordering.
- [ ] 4.2 Agent: Agent Mesh, ACP, remote/openclaw/nanobot/tomnyagentic; test tool arguments/results.
- [ ] 4.3 Tool/command: MCP/IDE tool input, cwd, args, stdout/stderr; test no leakage in errors/logs.
- [ ] 4.4 Browser: navigation, extracted text, page perception, media/transcript; test target policy.
- [ ] 4.5 Provider/gateway: rotating clients, REST, streaming and WebSocket; test sanitized payload only.
- [ ] 4.6 Mỗi task phải có processing + bridge seam + UI state + tests + i18n + docs hoặc ghi rõ không có UI/bridge ở boundary đó.

## Phase 5 — File and image gate

- [ ] 5.1 File reads/context/attachments dùng `redactSecretFileText`; không tạo detector mới.
- [ ] 5.2 Upload chuyển sang quarantine/preflight/commit contract; raw multipart không bypass gate.
- [ ] 5.3 Ảnh dùng `scanImageForSensitiveText`, OCR failure block, original binary không gửi trước decision.
- [ ] 5.4 Dùng ResourceCoordinator cho OCR/heavy work; release lease ở success/failure/cancel/timeout.
- [ ] 5.5 Tests file/image/temp cleanup và safe receipt.
- [ ] 5.6 Cập nhật tài liệu data-flow và user-facing warnings.

## Phase 6 — AI 0.8B hỗ trợ fail-closed

- [ ] 6.1 Chỉ bắt đầu sau khi Phase 1–5 pass và có approval của owner.
- [ ] 6.2 Định nghĩa sanitized/minimized classifier input; không truyền password/token.
- [ ] 6.3 Model chỉ trả suggestion/confidence; policy hiện có quyết định cuối.
- [ ] 6.4 Timeout/crash/invalid/low-confidence block hoặc approval theo policy, không allow.
- [ ] 6.5 ResourceCoordinator lease, cancellation, teardown và memory budget tests.
- [ ] 6.6 Tài liệu threat model, rollback flag và observability không plaintext.

## Phase 7 — Handover, validation và rollback

- [ ] 7.1 Tab 1 nhận danh sách shared changes: boundary wrapper, bridge/preload, bootstrap, shared types, i18n registration, direct-fetch removal và navigation wiring.
- [ ] 7.2 Security tab xác nhận allowlist, tests và receipts; không sửa file Tab 1 giữ.
- [ ] 7.3 Chạy `bun run i18n:types`, `node scripts/check-i18n.js` khi có renderer/i18n thay đổi; chạy typecheck/lint/format/test theo project workflow.
- [ ] 7.4 Review failure matrix: detector/policy/bridge/permission/resource/AI unavailable đều block-safe.
- [ ] 7.5 Ghi changed files, integrated surfaces, remaining gaps, rollback instructions và known limitations.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": "phase-0", "tasks": ["0.1", "0.2", "0.3", "0.4", "0.5"] },
    { "id": "phase-1", "dependsOn": ["phase-0"], "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7"] },
    { "id": "phase-2", "dependsOn": ["phase-1"], "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": "phase-3", "dependsOn": ["phase-2"], "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7"] },
    { "id": "phase-4", "dependsOn": ["phase-3"], "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6"] },
    { "id": "phase-5", "dependsOn": ["phase-4"], "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6"] },
    { "id": "phase-6", "dependsOn": ["phase-5"], "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6"] },
    { "id": "phase-7", "dependsOn": ["phase-6"], "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5"] }
  ]
}
```

## Dependency gates

- Phase 1 phải hoàn thành trước mọi outbound integration.
- Phase 2 phải có shared seam trước Phase 4.
- Phase 3 chỉ bắt đầu khi bridge contract được Tab 1 chấp thuận; UI có thể chạy song song với từng integration nhưng không thay thế gate.
- Phase 5 chỉ bắt đầu sau khi text gate và upload ownership được xác nhận.
- Phase 6 chỉ bắt đầu sau khi deterministic processing, policy, bridge, UI and tests ổn định.
- Phase 7 chỉ hoàn tất khi project-wide validation pass hoặc baseline failures được ghi rõ.

## Notes

Mọi task có thay đổi shared file phải dừng ở handoff cho Tab 1, trừ khi owner chuyển quyền bằng văn bản.

## Tab 1 shared handoff checklist

- [ ] Shared outbound wrapper trước HTTP/WS/multipart/tool/browser/command side effect.
- [ ] Preload + Main bridge registration và safe status event.
- [ ] Conversation/agent/provider/direct-fetch adapters dùng wrapper.
- [ ] Bootstrap wiring và rollback flag fail-closed.
- [ ] Shared i18n key/type registration và navigation/UI ownership.
- [ ] Existing permission/auth/resource managers được gọi lại, không tạo bản sao.
- [ ] Architecture/data-flow docs cập nhật.

## Definition of Done cho chức năng đầu tiên

- [ ] Text inspection processing hoạt động và không giữ plaintext.
- [ ] Chặn/làm sạch có lý do ổn định, safe receipt và fail-closed.
- [ ] Shared outbound seam chứng minh side effect xảy ra sau inspection.
- [ ] Bridge/UI hiển thị trạng thái và quyền quyết định, không lộ secret.
- [ ] Unit/property/contract/DOM/i18n tests đầy đủ cho phạm vi đầu tiên.
- [ ] Tài liệu và handoff Tab 1 hoàn tất.
