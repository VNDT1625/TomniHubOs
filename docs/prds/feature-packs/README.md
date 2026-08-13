# PRD index — Tomny Hub Agent OS packages

> **Design conformance:** [Tomny Hub OS Visual Design System](tomni-hub-visual-design.md) là nguồn
> sự thật cho typography, glass, spacing, control, popup và responsive. Mock ASCII trong các PRD
> chỉ mô tả information architecture; không được dùng để tạo một visual system khác.
> **Trạng thái:** Active design baseline
> **Ngày chuẩn hóa:** 2026-07-23

## 1. Mục tiêu

Tomny chuyển từ một app Electron chứa sẵn mọi tính năng thành Hub Agent OS có installer lõi
gọn và các package tải theo nhu cầu. Việc chuyển hóa phải giữ lại business logic, dữ liệu và
năng lực đang hoạt động tốt; không big-bang rewrite.

Kết quả sản phẩm tối thiểu:

- Base OS mở và chat được khi chưa cài package tùy chọn;
- Store tìm, cài, cập nhật, rollback và gỡ package;
- app đã cài xuất hiện trong Apps Library và có thể ghim;
- app đang phát triển xuất hiện ở Home với trạng thái Development;
- Studio là một Suite App Package tải một lần;
- package có manifest, signature, permission và sandbox;
- UI của Hub, popup, page và app opt-in dùng cùng design system.

## 2. Taxonomy chính thức

Store và Creator Platform chỉ có ba loại package cấp cao:

| Loại | Vai trò | Ví dụ |
| --- | --- | --- |
| **App Package** | ứng dụng hoàn chỉnh có surface/workspace riêng | Studio Suite, IDE, Browser |
| **UI Package** | token/theme/widget/layout cho Hub hoặc app opt-in | Developer Workspace, Accessibility UI |
| **Agent Capsule** | hành vi AI có prompt, workflow, automation, tool và policy | Research, Security Audit |

`Feature Pack`, `Capability Package` và `Code Pack` là thuật ngữ lịch sử, không dùng làm nhãn
sản phẩm mới. Asset/binary có thể là nội dung bên trong App Package, không phải loại package
cấp cao thứ tư.

## 3. Base OS

Base luôn cài và không thể gỡ:

- Hub shell, Home, Store, Account/Auth, Settings và onboarding;
- Chat/agent control tối thiểu;
- Package Manager, App Registry và contribution registries;
- Tomny Core, Model/CLI gateway, context/workspace primitives;
- Permission Broker, Secret Vault và sandbox supervisor;
- updater, recovery, entitlement và diagnostics.

Editor, browser automation, media engine và công cụ chuyên môn nặng phải tách khỏi Base khi
boundary thực tế cho phép.

## 4. Vòng đời package

```text
Discover → Inspect → Permission preview → Download → Verify → Stage
→ Activate → Use → Update/Rollback → Disable/Uninstall
```

Yêu cầu bắt buộc:

- manifest có `id`, `type`, `version`, compatibility, platform/arch, size, hash, signature,
  dependencies, contributions và permissions;
- tải HTTPS, pause/resume và retry;
- kiểm tra SHA-256 và chữ ký trước khi giải nén/kích hoạt;
- cài/update atomically, giữ bản trước để rollback;
- activation/deactivation idempotent và quan sát được;
- package lỗi không làm Base OS crash;
- gỡ package không xóa user data nếu chưa có xác nhận rõ;
- package đã cài vẫn chạy offline nếu không phụ thuộc dịch vụ mạng.

## 5. Lazy activation

- Main process chỉ expose Package Runtime và IPC bridge được kiểm soát; package không tự chèn
  global side effect vào Router, sidebar hoặc Electron main.
- Renderer route/surface được đăng ký qua contribution registry và lazy-load sau activation.
- Locale, command, settings, app surface, worker và capability đều là contribution khai báo.
- Feature chưa cài mở Store detail/quick install, không dẫn đến route chết.

## 6. Bảo mật

- First-party và community package cùng tuân public contract; mức trust/policy có thể khác.
- Package Store phải được ký; public key tin cậy nằm trong Base và hỗ trợ rotation/revoke.
- Secret chỉ được dùng qua alias/capability, không đi vào renderer, prompt, log hoặc checkpoint.
- Quyền nhạy cảm hiển thị trước khi cài, có thể thu hồi và có audit trail.
- Code không tin cậy không chạy trực tiếp trong Electron main process.
- UI Package không inject script hoặc sửa DOM tùy ý; chỉ dùng token/component contract.

## 7. UX cài đặt

- Store là nơi khám phá và cài; Settings chỉ quản lý package đã cài, update channel, storage
  và quyền.
- Quick install popup hiển thị publisher, version, dung lượng, permission và compatibility.
- Tiến trình tải là notification/dock không chặn toàn app.
- Sau khi cài thành công, nút đổi thành `Mở`; không yêu cầu restart nếu runtime hỗ trợ hot
  activation.
- Khi gỡ, giải thích app/surface nào biến mất và dữ liệu nào được giữ.
- Toàn bộ popup/card/page tuân [Visual Design System](tomni-hub-visual-design.md).

## 8. Migration

1. Đóng băng contract và baseline hành vi.
2. Đăng ký module hiện có thành virtual package, chưa di chuyển code/data.
3. Bọc activation adapter và contribution registry.
4. Pilot artifact tải thật với package boundary ít rủi ro.
5. Tách Studio thành một Suite App Package.
6. Mở Creator Mode và local development app.
7. Mở community Store sau khi sandbox, permission, signing và rollback đạt gate.

Testing/Benchmark không xuất hiện như app hoặc package sản phẩm. Phần preview/validation còn
hữu ích được chuyển vào Studio development tooling hoặc CI.

## 9. Yêu cầu phi chức năng

- Base khởi động không phụ thuộc package tùy chọn.
- Package đã cài lazy-activate với overhead mục tiêu dưới 200 ms, chưa tính tải asset nặng.
- Installer/Base budget phải được đo từ build thực tế; không ghi số MB giả định như cam kết.
- Mọi download có checksum, signature, retry, rollback và telemetry opt-in.
- Light/dark/reduced-motion/reduced-transparency đạt parity.
- UI mới dùng Arco, Icon Park, semantic tokens và i18n.

## 10. Quyết định đã chốt

- Không viết lại toàn bộ app để package hóa.
- Studio tải một lần, module bên trong code-split/lazy-load.
- Có marketplace community nhưng triển khai sau security gates.
- Có package miễn phí và trả phí; entitlement nằm ở Base.
- App Package, UI Package và Agent Capsule là taxonomy duy nhất ở cấp Store.
- Home là shell điều hành chính; Store là vòng đời phân phối.
- UI Package chỉ ảnh hưởng app đã opt-in.

## 11. Tài liệu trong bộ thiết kế

- [Visual Design System](tomni-hub-visual-design.md) — nguồn visual duy nhất.
- [Home Hub PRD](tomni-home-hub.md) — bố cục và hành vi Home.
- [Hub Pages PRD](tomni-hub-pages.md) — Lịch sử, Sản phẩm, Quản lý, Cài đặt.
- [Agentic Store PRD](tomni-agentic-store.md) — khám phá và vòng đời package.
- [Package Platform Design](tomni-package-platform-design.md) — taxonomy, manifest, runtime và Creator.
- [Migration Design](tomni-hub-agent-os-migration-design.md) — chuyển hóa không rewrite.
- [Company Map](tomni-company-map.md) — bề mặt tổ chức multi-agent.
- [Defensible + three product cores](tomni-defensible-core-design.md) — Outcome Intelligence Network, Security, User Understanding và Efficiency Orchestrator.
- [Local Core Model Runtime](tomni-local-core-model-runtime-design.md) — retention/first-use loop, local model 0.8B/2B, hardware profiling, degraded mode, inference broker, benchmark plan và headless MCP runtime.
- [Execution Roadmap](tomni-hub-agent-os-execution-roadmap.md) — stages và commercial gates.

## 12. Phân quyền quyết định

- PRD chức năng quyết định dữ liệu, hành vi và acceptance của feature.
- Package Platform quyết định loại package và runtime lifecycle.
- Visual Design System quyết định presentation và responsive.
- Khi tài liệu mâu thuẫn, dùng thứ tự ưu tiên ghi trong Visual Design System và cập nhật tài
  liệu thấp hơn; không tạo exception CSS/UX âm thầm.
