# Design Document

## Overview

Đây là integration layer, không phải runtime nhớ mới. Thiết kế dùng lại ContextStore và ContextComposer hiện có, ưu tiên local-first và quyền kiểm soát dữ liệu của người dùng.

## Architecture

## 1. Nguyên tắc

Đây là integration layer, không phải runtime nhớ mới. `ContextStore` là authority cho dữ liệu cá nhân; `ContextComposer` là authority cho việc chọn và render context. Lớp mới cung cấp use-cases, explainability và UI projection qua các seam riêng, bảo toàn process boundary và quyền riêng tư.

Các tệp owner hiện có không được sửa trong phạm vi này: `process/agentRuntime/contextStore.ts`, `contextComposer.ts`, chat IPC/history/config storage, ResourceCoordinator, Manager, Company, IDE knowledge graph, global bootstrap/router/nav/i18n config và các tệp Tab 1 nêu trong `.kiro/specs/tomni-three-core-foundation/design.md`.

## Components and Interfaces

## 2. Kiến trúc logic

```text
Renderer: pages/user-understanding/
  UserUnderstandingPage -> PreferencesView -> Confirm/Edit/Delete controls
             |
             v preload client / typed bridge
Main: process/userUnderstanding/
  userUnderstandingBridge -> userUnderstandingService
                                  |-- ContextStore adapter
                                  |-- ContextComposer adapter
                                  |-- project/workspace/chat/manager read adapters
                                  |-- feedback policy + explanation builder
                                  |-- local feedback receipt store (only if no existing event store fits)
             |
             v existing ContextStore file (single memory authority)
```

### 2.1 Main service

`userUnderstandingService` nên là module mới trong `packages/desktop/src/process/userUnderstanding/`. Nó:

- chuẩn hóa request và giới hạn độ dài/key/value;
- tạo `ContextFact` với `source: 'user'`, `userLocked: true`, `lastConfirmedAt` cho xác nhận;
- gọi `learnPersonalFact` hoặc upsert qua interface hiện có, không ghi file ContextStore trực tiếp;
- đọc profile qua `getPersonal`, rồi trả projection an toàn, không trả secret;
- gọi `ContextComposer` để tạo context preview theo `surface`/project trước khi đề xuất sử dụng;
- tạo explanation có `factId`, scope, source, matched surface và policy reason;
- thực hiện edit/delete/disable/reset theo contract. Nếu ContextStore hiện tại chưa có delete/disable, service phải dùng extension contract được phê duyệt trong allowlist, không tạo file store song song;
- phân loại feedback thành accepted/rejected/edited, chỉ cập nhật policy/confidence khi không vi phạm user lock.

`ContextStore` hiện đang lưu atomic file, defensive normalization và không chứa raw secrets. Thiết kế phải giữ các đặc tính đó.

### 2.2 Scope và mô hình dữ liệu

Dùng `ContextFact` hiện có với các trường tương đương:

- `id`, `key`, `value`, `scope` (`global`, `surface` hoặc project adapter mapping);
- `source`, `confidence`, `userLocked`, `sensitivity`, `createdAt`, `updatedAt`, `lastConfirmedAt`, provenance.

Không thêm bản sao của `PersonalContext`. Project identity lấy từ workspace adapter; nếu workspace chưa có stable id thì không lưu fact theo project và phải yêu cầu người dùng chọn scope rõ ràng.

Phản hồi nên dùng event/receipt contract hiện có của Foundation nếu đã được Tab 1 cung cấp. Nếu chưa có, implementation đầu tiên chỉ giữ metadata tối thiểu trong ContextStore-compatible extension sau khi xác nhận ownership; tuyệt đối không tạo `memory.db`/`user-memory.json`.

### 2.3 Tìm và sử dụng

`lookupForWork({ surface, projectId, query })` kết hợp:

1. ContextStore profile và facts;
2. ContextComposer để lọc sensitivity, scope, confidence và giới hạn kích thước;
3. adapter đọc metadata từ workspace/chat/Manager/knowledge khi cần, chỉ tham chiếu ID/provenance thay vì sao chép nội dung.

Kết quả gồm `items`, `explanations`, `omittedReasons` và `contextPreview`. Context preview phải chạy redaction trước khi renderer hoặc model nhận được.

### 2.4 IPC và renderer

Tạo bridge riêng, typed và always-resolving envelope, theo pattern `managerBridge`/`realtimeKnowledgeBridge`. Các operation tối thiểu:

- `list` / `get`;
- `confirmPreference`;
- `update`, `delete`, `setEnabled`, `reset`;
- `explainUsage`;
- `lookupForWork`;
- `recordFeedback`;
- `dataChanged` emitter.

Renderer chỉ nhận projection không chứa secret. Trang nằm ở `renderer/pages/user-understanding/`, dùng Arco Table/Card/Modal/Form, icon Park, UnoCSS semantic tokens và i18n. Tích hợp navigation/route phải do owner của router/nav thực hiện hoặc được phê duyệt riêng; spec này không tự sửa tệp shared đó.

### 2.5 Lát cắt đầu tiên

Lát cắt đầu tiên chỉ bao gồm:

1. `confirmPreference` cho một preference dạng text, global hoặc project scope;
2. `list` projection;
3. `lookupForWork` áp dụng đúng lúc cho một surface;
4. edit/delete/disable/reset;
5. explanation;
6. bridge + renderer panel;
7. tests và locale keys.

Sau khi lát cắt này được nghiệm thu mới mở rộng project/workflow lookup, đề xuất và feedback learning.

## Data Models

Các mô hình dùng lại `ContextFact`, `PersonalContext` và các kiểu ContextStore hiện có; không tạo bản sao persistence.

## Correctness Properties

### Property 1: Confirmed preferences are unique by key and scope

For every confirmation sequence, the resulting ContextStore projection contains at most one preference for a given key and scope, and the latest valid user confirmation is the effective value.

**Validates: Requirements 1.1, 1.2**

### Property 2: User-locked facts resist lower-priority inference

For every user-locked fact, an inferred or lower-priority candidate cannot replace it through the integration layer.

**Validates: Requirements 1.1, 5.2**

### Property 3: Projections respect scope and sensitivity

For every lookup surface, returned facts are applicable to that scope and contain no secret or redacted sensitive value.

**Validates: Requirements 1.3, 3.2**

### Property 4: User controls take effect immediately

After disable, delete, or reset succeeds, the next lookup does not return the affected data unless the user explicitly confirms it again.

**Validates: Requirements 1.5, 5.3**

## Error Handling

Bridge luôn trả envelope thành công hoặc lỗi có mã; lỗi đọc/ghi, dữ liệu không hợp lệ và profile thiếu được xử lý degraded-safe.

## Testing Strategy

Unit test policy/merge/redaction; integration test service/bridge và ContextStore; DOM test quyền xem/sửa/xóa/tắt/reset, explanation và i18n.

## 3. Privacy và failure handling

- Mặc định local-only; không network call cho lưu/lookup local.
- Reject field trông giống password, token, private key hoặc credential; không log value.
- Khi profile/file hỏng, dùng behavior defensive của ContextStore và báo trạng thái degraded.
- Mọi mutation idempotent theo fact id/key+scope, serialize qua store hiện có.
- Bridge luôn resolve `{ ok: true, data }` hoặc `{ ok: false, code, error }`; không để UI spinner vô hạn.
- Tắt ghi nhớ phải chặn projection và learning ngay lập tức; reset phải có confirm dialog và kết quả rõ ràng.

## 4. File allowlist dự kiến cho implementation

Chỉ tạo/sửa sau khi design được duyệt:

- `packages/desktop/src/process/userUnderstanding/` — service, types, policy, bridge adapter mới;
- `packages/desktop/src/preload/` — chỉ phần đăng ký bridge được owner preload phê duyệt;
- `packages/desktop/src/renderer/pages/user-understanding/` — page-private UI/client/hooks;
- `packages/desktop/src/renderer/i18n/locales/<lang>/<module>.json` — theo i18n-config, nếu module đã được owner i18n cho phép;
- `tests/unit/userUnderstanding*`, `tests/integration/userUnderstanding*`, `tests/renderer/userUnderstanding*.dom.test.ts` hoặc vị trí test được repo quy định.

Không sửa shared files của Tab 1, core stores, global router/nav, ContextStore/Composer, Manager/chat/knowledge implementations trong task này.

## 5. Kiểm chứng

- Unit: mapping, redaction, scope, lock precedence, duplicate confirmation, reset/disable.
- Integration: service dùng cùng ContextStore, atomic/error envelope, lookup projection và no duplicate storage.
- DOM: render list, explanation, confirm/edit/delete/disable/reset, empty/error states, i18n keys.
- Chạy `bun run i18n:types`, `node scripts/check-i18n.js`, typecheck và test theo workflow khi implement; spec phase không chạy auto-fix.
