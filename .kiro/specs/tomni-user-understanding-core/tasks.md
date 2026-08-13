# Implementation Plan:

## Overview

Triển khai theo từng capability hoàn chỉnh; lát cắt đầu tiên là preference được người dùng xác nhận, sử dụng đúng lúc và quản lý toàn bộ vòng đời trong UI.

## Tasks

## Phase 0 — Chốt nền và ownership

- [ ] 0.1 Xác nhận chỉ làm việc trong `C:\NDT\PJ\TomniHubOS` và ghi baseline git/worktree.
- [ ] 0.2 Đối chiếu `ContextStore`, `ContextComposer`, workspace, chat, Manager, knowledge, settings và các spec liên quan; lập file allowlist cho Tab này.
- [ ] 0.3 Chốt với owner Tab 1 các seam được phép dùng; không sửa shared/core-owned files.
- [ ] 0.4 Đọc `i18n-config.json`, xác định ngôn ngữ/module hiện hành và vị trí test theo Vitest config.

## Phase 1 — Contract và policy dùng chung của feature

- [ ] 1.1 Tạo types cho `PreferenceView`, scope/project reference, `UsageExplanation`, lookup result, mutation result và feedback receipt trong module mới.
- [ ] 1.2 Tạo policy validate/redact dữ liệu; từ chối credential/secret và không ghi raw value vào log/error.
- [ ] 1.3 Tạo adapter interface cho ContextStore/ContextComposer/workspace; adapter không có persistence riêng.
- [ ] 1.4 Xác định extension contract cho delete/disable/reset nếu API ContextStore hiện có chưa đủ, có test ownership và migration safety.

## Phase 2 — Lát cắt đầu tiên: xác nhận và sử dụng preference

- [ ] 2.1 Implement `confirmPreference` bằng `learnPersonalFact('preferences')`, provenance user, user lock và timestamp.
- [ ] 2.2 Implement read projection/list/get với explainability, scope và redaction.
- [ ] 2.3 Implement `lookupForWork` dùng ContextComposer, lọc theo surface/project và trả explanation/context preview.
- [ ] 2.4 Implement update, delete, disable và reset với hành vi idempotent, confirm policy và data-changed event.
- [ ] 2.5 Implement typed always-resolving Main bridge và preload client theo owner-approved allowlist.

## Phase 3 — Giao diện người dùng kiểm soát dữ liệu

- [ ] 3.1 Tạo `renderer/pages/user-understanding/` với page-private client/hook/view, không gọi Node API.
- [ ] 3.2 Hiển thị danh sách preference: giá trị, scope, source, last confirmed, status và lý do sử dụng.
- [ ] 3.3 Thêm form xác nhận/sửa, dialog xóa/reset, toggle disable và trạng thái lỗi/rỗng/loading.
- [ ] 3.4 Dùng Arco Design, `@icon-park/react`, UnoCSS semantic tokens; không raw interactive HTML/hardcoded colors.
- [ ] 3.5 Thêm i18n keys cho toàn bộ text theo mọi language/module trong `i18n-config.json`; không sửa config shared nếu chưa được owner cho phép.

## Phase 4 — Kiểm thử lát cắt đầu tiên

- [ ] 4.1 Unit test validation/redaction, source/user lock, duplicate same key+scope và merge precedence.
- [ ] 4.2 Unit test scope filtering, explanation và context projection không chứa sensitive data.
- [ ] 4.3 Integration test service/bridge dùng ContextStore hiện có, mutation failure và no second persistence store.
- [ ] 4.4 DOM test list, confirm, edit, delete, disable, reset, explanation, empty/error states và i18n rendering.
- [ ] 4.5 Chạy `bun run i18n:types`, `node scripts/check-i18n.js`, `bunx tsc --noEmit` và test liên quan; ghi nhận lỗi có sẵn không thuộc Tab này.

## Phase 5 — Mở rộng theo từng chức năng hoàn chỉnh

- [ ] 5.1 Implement project/work-style facts bằng workspace adapter, quản trị theo project và kiểm thử cross-project isolation.
- [ ] 5.2 Implement lookup đa nguồn qua adapter chat/knowledge/Manager, chỉ giữ reference/provenance, không sao chép kho dữ liệu.
- [ ] 5.3 Implement đề xuất theo công việc, preview explanation và luồng accept/reject/edit rõ ràng.
- [ ] 5.4 Implement feedback receipt tối thiểu và policy học; bảo vệ user-locked facts khỏi ghi đè.
- [ ] 5.5 Bổ sung UI xem/xóa/tắt/reset feedback và các test failure/privacy/i18n tương ứng.
- [ ] 5.6 Nghiệm thu từng capability trước khi chuyển sang capability kế tiếp; không gom nhiều engine vào một thay đổi.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 0, "tasks": ["0.1", "0.2", "0.3", "0.4"] },
    { "wave": 1, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "wave": 2, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "wave": 3, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"] },
    { "wave": 4, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "wave": 5, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6"] }
  ]
}
```

## Notes

Mọi task implementation phải tuân file allowlist và không sửa tệp shared/core-owned của Tab 1.

## Definition of Done

- [ ] Mọi dữ liệu đi qua hệ thống lưu trữ hiện có, không có kho nhớ trùng lặp.
- [ ] Người dùng xem/sửa/xóa/tắt/reset và hiểu được lý do sử dụng dữ liệu.
- [ ] Preference đã xác nhận được dùng đúng scope/surface trong công việc tiếp theo.
- [ ] Không lưu password, access key hoặc nội dung nhạy cảm không cần thiết.
- [ ] Main/Renderer/IPC đúng boundary; shared Tab 1 files không bị sửa.
- [ ] Tests, typecheck và i18n checks đạt hoặc có ghi chú lỗi pre-existing rõ ràng.
