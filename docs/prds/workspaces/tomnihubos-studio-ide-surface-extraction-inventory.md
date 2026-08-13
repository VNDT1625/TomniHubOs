# Kiểm kê tách Studio, IDE và bề mặt làm việc thành package

> **Trạng thái:** kiểm kê hiện trạng để chuẩn bị migration; tài liệu này không thay đổi runtime.  
> **Ngày:** 2026-07-27  
> **Quyết định đang áp dụng:** `com.tomni.ide` là IDE lõi bắt buộc; Studio cũ chỉ là alias tương thích. Một chức năng chỉ được coi là đã tách khi artifact ký, catalog, activation, Package Gate, gỡ và rollback đều hoạt động.

## 1. Kết luận kiểm chứng được

- `com.tomni.ide` và `com.tomni.studio` hiện là package tải về có chữ ký, nhưng entrypoint của chúng vẫn import thẳng `IdeWorkspace` và `StudioPage` từ renderer. Vì vậy package đã có vỏ phân phối, **chưa có ranh giới mã nguồn thực sự**.
- `com.tomni.document-studio` và `com.tomni.design-studio` đã có artifact, catalog và entrypoint độc lập. Đây là hai lát tách có thật nhất hiện nay.
- `com.tomni.automation-studio`, `com.tomni.video-studio`, `com.tomni.music-studio` đang được Document Studio điều hướng tới, nhưng không có artifact hoặc catalog tương ứng trong `store-artifacts/` hay `common/packages/catalog.ts`. Chúng chưa thể được xem là app tải/cài được.
- `studioCompatibility.ts` đã mô tả redirect, Package Gate, receipt và rollback không phá dữ liệu, nhưng chưa có consumer production: tìm kiếm chỉ thấy chính module và test. Router vẫn chuyển `/studio` sang `com.tomni.studio/studio`.
- Schema contribution/registry đã có group ổn định `codebase` và `agent-ops`, nhưng rail của IDE vẫn là danh sách mode hard-code. Vì vậy cài/gỡ extension chưa thể tạo/xóa item trên IDE thật.

## 2. Bằng chứng hiện trạng

| Bề mặt | Entry/module hiện tại | Dữ liệu, quyền hoặc bridge thấy được | Trạng thái package |
| --- | --- | --- | --- |
| IDE | `package-apps/ide.tsx` → `pages/studio/ide/IdeWorkspace.tsx` | workspace, model, terminal và cloud/team; manifest hiện xin `workspace.read`, `workspace.write`, `model.invoke`, `terminal.execute` | `com.tomni.ide`, artifact ký, nhưng monolith |
| Studio cũ | `package-apps/studio.tsx` → `pages/studio/StudioPage.tsx` | file/editor, collaboration, automation, video, music; manifest xin workspace + model | `com.tomni.studio`, suite cũ vẫn chạy |
| Document Studio | `package-apps/documentStudio.tsx` → `DocumentStudioPage.tsx` | `studioStorage`, file/editor/peer collaboration, mở package khác | `com.tomni.document-studio`, artifact + catalog thật |
| Design Studio | `package-apps/design/index.tsx` | VIU project/asset qua `viuClient`, chọn file qua `ipcBridge.dialog` | `com.tomni.design-studio`, artifact + catalog thật |
| Automation | `package-apps/automation/index.tsx` → `AutomationView` | workflow, credential, automation chat/client | có entrypoint nguồn nhưng thiếu manifest/artifact/catalog |
| Video | `pages/studio/makevideo/*` | cấu hình video và agent harness | chỉ nằm trong Studio cũ |
| Music | `pages/music` | feature flag và Studio route state | chỉ nằm trong Studio cũ |
| Workspace surfaces | `pages/workspace/WorkspaceSurfaces.tsx` | bridge riêng, nhiều tác nhân trong cuộc hội thoại | embedded surface; chưa là app/package |

Nguồn chính: `packages/desktop/src/renderer/package-apps/`, `packages/desktop/src/renderer/pages/studio/`, `store-artifacts/`, `packages/desktop/src/common/packages/catalog.ts`.

## 3. Bản đồ IDE: owner đích và dependency

| Mode hiện tại | Module hiện tại | Owner đích | Dependency/permission cần kiểm chứng trước khi tách | Rủi ro migration |
| --- | --- | --- | --- | --- |
| Files, editor, search, Git, terminal, command palette | `IdeWorkspace`, `UniversalEditor`, `SearchPanel`, `GitPage`, `IdeTerminalPanel` | `com.tomni.ide` | workspace read/write, terminal theo từng capability | giữ deep-link `com.tomni.ide/ide`; không nạp app tùy chọn |
| Understand, Wiki, LSP | `UnderstandPanel`, `WikiPanel`, `LspServersPanel` | `com.tomni.ide.codebase` | đọc workspace, cache/index; xác định rõ LSP process capability | hiện bị static-import từ host; làm rail core lớn |
| Database | `db/DatabasePanel.tsx` | `com.tomni.ide.database` | credential/connection/database capability phải được chuẩn hóa, không dùng permission text tùy ý | tránh cho Codebase extension thấy credential DB |
| Chat, Team, Cloud | `IdeChatPanel`, `teamEdit/*` | `com.tomni.ide.agent-ops` | model invoke, workspace scope, collaboration/network | đang tái dùng conversation surface, closure rất lớn |
| Hooks, Spec, ExpBase | `IdeHooksPanel`, `SpecManagerPanel`, `ExpBasePanel` | `com.tomni.ide.agent-ops` | event owner-scoped, model/workspace scope | hook hiện được khởi tạo ở IDE host và có thể đổi mode sang Chat |
| Quick Test | `QuickTestPanel`, `useQuickRun` | `com.tomni.ide.quality` | terminal/process, workspace write, agent invocation | trace đang gọi Chat bằng emitter nội bộ; phải qua host SDK/event versioned |
| VIU | `Viu/*` | `com.tomni.design-studio` | workspace/asset grant | đã có app riêng, còn xuất hiện trong IDE rail |
| Extensions | `hooks/extensions/IdeExtensionsPanel` | vẫn là capability của IDE lõi | package registry, dependency và activation | cần là UI quản trị extension, không tự trở thành extension |

`IdeWorkspace` có 15 mode hard-code tại dòng 160–175 và render rail/panel trực tiếp tại dòng 764–1021. Nó còn runtime-import `@process/ide/testrun/testCommand` ở dòng 96, trái boundary Renderer/Main; phải chuyển DTO/hàm thuần sang Common và dùng bridge trước extraction.

## 4. Bản đồ Studio và surface khác

| Luồng cũ | Package đích | Tình trạng hiện tại | Điều kiện được đánh dấu hoàn tất |
| --- | --- | --- | --- |
| Dashboard, file, editor, peer | `com.tomni.document-studio` | artifact/catalog/entrypoint đã có | dữ liệu owner riêng, Package Gate, clean install/uninstall |
| VIU designer | `com.tomni.design-studio` | artifact/catalog/entrypoint đã có | không còn import từ IDE core; asset grant đúng capability |
| Automation Builder | `com.tomni.automation-studio` | nguồn entrypoint có, nhưng package phát hành chưa có | manifest, artifact ký, catalog, activation, disable/update/uninstall |
| Make Video | `com.tomni.video-studio` | chỉ còn trong Studio cũ | cùng điều kiện Automation, thêm resource/background policy |
| Music | `com.tomni.music-studio` hoặc ID đã public | chỉ còn trong Studio cũ | chủ sản phẩm chốt package ID; artifact/catalog thật |
| Parallel agent surfaces | app/extension sau quyết định sản phẩm | đang nhúng trong Conversation | không tách chỉ vì tái dùng React; cần contract host và ownership rõ |

## 5. Ranh giới runtime phải được giữ

1. `PackageAppHost` chỉ chạy `trusted-react` khi artifact là first-party đã ký, còn package web không tin cậy chạy iframe CSP/sandbox. Các extension IDE không được lấy quyền từ ambient renderer.
2. Manifest đã có `contributions.ide`, dependency bắt buộc vào `com.tomni.ide`, allowlist group và key owner-scoped. Runtime cần tiêu thụ snapshot đó thay vì hard-code rail.
3. Host SDK phải là ABI versioned, permission-checked: workspace, navigation, terminal, event, locale/theme. Cấm extension import `@renderer/pages/**`, `@process/**`, page Conversation hoặc global CSS của host.
4. `studioCompatibility` chỉ là hợp đồng thuần. Migration thực phải lưu receipt, copy có kiểm soát và rollback `copy-if-missing`; tuyệt đối không xóa data owner cũ/mới khi bỏ alias.

## 6. Lát dọc nên code tiếp theo

**Lát nhỏ nhất:** kích hoạt redirect tương thích Studio cũ sang Document Studio, không refactor toàn Studio.

Phạm vi:

1. Tại route `/studio` và deep-link `com.tomni.studio/studio`, gọi `resolveStudioCompatibility` với danh sách package đã cài.
2. Với `dashboard/file/editor/peer`, điều hướng đến `com.tomni.document-studio/document`; nếu thiếu package, hiện Package Gate và chỉ cài sau khi người dùng chấp thuận.
3. Không tự cài Design/Automation/Video/Music. Mode tương ứng chỉ redirect khi target artifact tồn tại và đã cài; nếu chưa, Package Gate phải nói đúng package còn thiếu.
4. Giữ Studio legacy như fallback có cờ migration trong một release; rollback chỉ đổi resolver về alias, không gỡ hay ghi đè dữ liệu.

Lý do chọn lát này: contract resolver, artifact Document Studio và test unit đã có; nó chứng minh UX tách app, install gate và rollback mà không sửa rail 2.149 dòng của IDE hay giả vờ rằng Automation/Video/Music đã được phát hành.

## 7. Evidence bắt buộc cho lát dọc và các lát sau

- Unit: route/package-module input, installed/missing target, mode không hợp lệ, data receipt/rollback, no-delete alias plan (`tests/unit/studio/studioCompatibility.test.ts`).
- DOM/integration: legacy deep-link → target installed; missing target → Gate; người dùng từ chối → không download; target disable/uninstall khi mở → quay về state an toàn, không chạy alias song song.
- Artifact: catalog URL, manifest, integrity và chữ ký của Document Studio phải xác minh trong temp profile, không fixture registry giả.
- Persistence: update/rollback target giữ receipt owner-scoped; gỡ `com.tomni.studio` không xóa dữ liệu Document/Design.
- Sau đó mới làm IDE Codebase extension: base metafile không chứa entrypoint/string độc quyền, install làm rail item xuất hiện không restart, uninstall active item fallback Files và dispose owner events.

## 8. Quyết định còn chờ chủ sản phẩm

1. Có giữ một app “Studio Collection” hiển thị các app đã cài, hay bỏ hẳn `com.tomni.studio` sau cửa sổ tương thích?
2. ID chính thức cho Music: giữ `com.tomni.music-studio` hay map vào package music đã public?
3. Automation/Video có được phát hành sau khi có artifact ký thật, hay bị ẩn khỏi dashboard cho đến lúc đó? Khuyến nghị: ẩn/Package Gate, không để nút dẫn tới package không tồn tại.
4. Quyền chính thức cho Database, Automation, Video và collaboration là gì? Schema hiện chỉ kiểm tra cú pháp permission string, chưa là allowlist product policy.
5. WorkspaceSurfaces có phải một app cài riêng hay tiếp tục là surface của Conversation? Không nên package hóa trước khi owner dữ liệu và model/agent capability được chốt.

