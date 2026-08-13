# Tomny Hub Agent OS — Evolutionary Migration Design

> **Design conformance:** [Tomny Hub OS Visual Design System](tomni-hub-visual-design.md) là nguồn
> sự thật cho typography, glass, spacing, control, popup và responsive. Mock ASCII bên dưới
> chỉ mô tả information architecture; không được dùng để tạo một visual system khác.


> **Trạng thái:** Design đề xuất  
> **Mục tiêu:** chuyển app Tomny hiện tại thành Hub Agent OS mà không big-bang rewrite
> **Chiến lược:** compatibility-first, strangler migration, package activation theo từng lát dọc

## 1. Quyết định điều hành

Tomny không được xây lại từ đầu. Hệ thống hiện tại đã có các năng lực mạnh về agent runtime, IDE, Studio, automation, browser, context, model/CLI adapter, MCP và secret firewall. Migration phải **đóng gói, chuẩn hóa contract và thay đổi cách kích hoạt**, không viết lại logic đã hoạt động tốt.

Trình tự đúng:

```text
Giữ nguyên hành vi hiện tại
→ đo và đóng băng contract
→ bọc module bằng adapter
→ đăng ký như virtual package
→ chuyển sang activation lifecycle
→ tách artifact khi đã đạt parity
→ gỡ legacy wiring cuối cùng
```

Package hóa và refactor nội bộ là hai việc khác nhau. Không thực hiện đồng thời nếu chưa có parity test và rollback.

## 2. Mục tiêu

- Home trở thành shell điều hành trung tâm.
- Store quản lý vòng đời App Package, UI Package và Agent Capsule.
- App hiện có tiếp tục hoạt động trong suốt migration.
- Base OS dần nhẹ hơn mà không làm mất tính năng hoặc dữ liệu.
- Studio trở thành một Suite App Package tải một lần, chứa nhiều module.
- App đang phát triển trong IDE xuất hiện trên Home với trạng thái Development.
- Package first-party và third-party cùng dùng một public contract sau giai đoạn chuyển tiếp.
- Secret, permission và dữ liệu người dùng không bị hạ cấp bảo mật khi package hóa.

## 3. Phi mục tiêu

- Không đổi toàn bộ framework UI hoặc kiến trúc Electron.
- Không thay toàn bộ Tomny Core và agent runtime trong cùng dự án migration package.
- Không di chuyển hàng loạt file chỉ để tạo cảm giác module hóa.
- Không tách mọi route thành package riêng.
- Không public marketplace third-party trước khi sandbox và permission contract đạt yêu cầu.
- Không giữ Testing/Benchmark như app hoặc package sản phẩm.

## 4. Invariant bắt buộc

Trong mọi phase:

1. Conversation, workspace và user data cũ vẫn đọc được.
2. Route hiện có không bị phá trước khi có redirect/compatibility mapping.
3. Electron renderer không được truy cập Node/Electron trực tiếp.
4. Secret Vault không được truyền vào renderer, prompt, checkpoint hoặc package.
5. Package không được tự sửa Router, sidebar hoặc registry bằng global side effect.
6. Activation/deactivation phải idempotent và quan sát được.
7. Mọi thay đổi có feature flag, rollback và đường quay lại legacy wiring.
8. Một phase chỉ được coi là hoàn tất khi behavior parity và failure-path đều được kiểm chứng.
9. App first-party không được nhận public capability mà app cộng đồng không thể xin, trừ capability hệ thống được ghi rõ và giới hạn.
10. Base OS phải khởi động được khi package tùy chọn bị thiếu, hỏng hoặc không tương thích.

## 5. Những năng lực phải giữ và tái sử dụng

### 5.1 Agent và orchestration

Giữ lại và chuẩn hóa quanh contract mới:

- Agent Mesh và orchestration;
- context composer/store;
- surface registry;
- evidence/event tracking;
- ResourceCoordinator và lease;
- Team/Company orchestration đang hoạt động;
- adapter cho ACP, Codex, CLI, remote core và model provider.

Outcome Engine về sau phải gọi các năng lực này qua contract, không tạo một agent runtime song song.

### 5.2 Security và credential

Giữ nguyên nền móng hiện có:

- OS-encrypted Secret Vault;
- opaque secret handle;
- Secret Context/Secret Firewall;
- trusted Main-process sink;
- scope theo surface, purpose và target;
- receipt/audit không chứa secret;
- revoke và expiry.

Package chỉ nhận capability handle. Giá trị credential không được xuất hiện trong model context, log hay output tool.

### 5.3 Model, CLI và integration

Tái sử dụng:

- Router9/model gateway;
- provider adapters;
- CLI configuration và connector engine;
- MCP registry;
- native platform capability bridge;
- channel và OAuth driver.

Package manifest chỉ khai báo dependency/capability; package không tự chỉnh global config của provider hoặc CLI.

### 5.4 Product modules

Không viết lại logic của:

- Browser;
- Studio, Universal Editor và IDE;
- VIU/UI Designer;
- Automation;
- Video và Music;
- Manager, Team/Company và workspace;
- conversation/chat surfaces.

Mỗi module được bọc bằng activation adapter trước khi cân nhắc tách artifact.

## 6. Kiến trúc chuyển tiếp

```text
┌──────────────────────── Base OS ─────────────────────────┐
│ Home · Store · Chat Core · Account · Settings            │
│ App Registry · Package Manager · Permission Broker       │
│ Outcome/Context services · Model Gateway · Secret Vault  │
└───────────────────────────┬───────────────────────────────┘
                            │ contribution contract
              ┌─────────────┴─────────────┐
              │ Activation Manager        │
              │ route/bridge/MCP/settings │
              │ app/capsule/UI registries │
              └─────────────┬─────────────┘
                            │
        ┌───────────────────┼────────────────────┐
        │                   │                    │
 Bundled legacy       Downloaded first-    Sandboxed community
 adapters             party packages       packages
```

Ba chế độ có thể cùng tồn tại trong migration:

- `bundled-legacy`: code vẫn nằm trong installer và được bọc bằng virtual manifest;
- `bundled-package`: đã dùng activation contract nhưng artifact vẫn bundle cùng app;
- `downloaded-package`: artifact cài độc lập và kích hoạt theo manifest.

Registry phải che giấu khác biệt này với Home/Store. UI chỉ nhìn thấy app/package status, không phụ thuộc vị trí code.

## 7. Contract cần thêm, không thay logic nghiệp vụ

### 7.1 Package manifest

Manifest định nghĩa:

- identity, version và compatibility;
- package type;
- module/surface contributions;
- route, command, settings, MCP, agent và capsule contributions;
- permissions và resource budget;
- dependencies;
- activation policy;
- integrity, signature và publisher.

Chi tiết taxonomy nằm trong [Package Platform Design](tomni-package-platform-design.md).

### 7.2 Activation lifecycle

Một package có lifecycle logic:

```text
discovered → verified → installed → inactive
           → activating → active
           → deactivating → inactive
           → updating | failed | quarantined | uninstalled
```

Activation adapter chịu trách nhiệm đăng ký route/bridge/service/MCP bằng registry API và trả về disposer. Adapter không được phụ thuộc vào thao tác import side-effect không thể hoàn tác.

### 7.3 Contribution registries

Tạo các registry có version và ownership rõ:

- App/Surface Registry;
- Command Registry;
- Settings Registry;
- Agent/Capsule Registry;
- MCP/Tool Registry;
- UI Token/Theme Registry;
- Notification contribution;
- Background job contribution.

Mỗi registration mang `packageId`, version, permission scope và disposer để rollback sạch.

### 7.4 Compatibility adapters

Trong giai đoạn đầu, adapter được phép gọi code hiện có. Ví dụ:

```text
virtual manifest → activate adapter → gọi register hiện tại
                                → ghi contribution ownership
                                → giữ nguyên repository/data path
```

Adapter là cầu tạm thời, không phải nơi viết lại business logic.

## 8. Phân lớp Base và package trong migration

### 8.1 Giữ trong Base

- Home shell và app host;
- Store shell;
- Account/Auth và Settings lõi;
- Chat/agent control tối thiểu;
- Package Manager và registries;
- Agent Runtime/Outcome orchestration lõi;
- Model/CLI gateway;
- Permission Broker, Secret Vault và sandbox supervisor;
- context/event/workspace primitives;
- updater, recovery và diagnostics.

Manager hoặc Team/Company có thể tạm ở Base nếu đang gắn chặt với runtime. Chúng chỉ được tách sau khi boundary thực tế ổn định; route có vẻ độc lập không phải là lý do đủ để tách package.

### 8.2 Studio Suite

Studio là một install unit duy nhất, không chia thành nhiều lượt tải:

```text
Studio Suite
├── IDE & App Builder
├── Universal Editor/Documents
├── VIU/UI Designer
├── Automation Builder
├── Video Studio
├── Music Studio
└── shared assets, collaboration và agent workspace
```

Module được code-split/lazy-load bên trong artifact Studio. Home có một app Studio; shortcut module chỉ là deep link vào cùng package.

### 8.3 Các package first-party khác

Ứng viên sau khi contract ổn định:

- Browser;
- app chuyên ngành độc lập;
- Manager/Operations nếu boundary cho phép;
- Team/Company extension nếu không còn là dependency lõi.

### 8.4 Testing/Benchmark

Không xuất hiện trong Home hoặc Store. Migration không xóa vội code đang được module khác dùng:

1. ẩn khỏi product navigation bằng feature decision;
2. xác định preview/validation nào IDE và publish pipeline vẫn cần;
3. chuyển phần tái sử dụng vào Studio development tooling hoặc CI;
4. xóa legacy route/service chỉ sau khi dependency bằng 0.

## 9. Data và storage migration

- Giai đoạn virtual package giữ nguyên data path và schema hiện có.
- Registry bổ sung ownership metadata mà không di chuyển dữ liệu ngay.
- Package mới dùng namespace theo `packageId` và versioned schema.
- Update schema phải transactional và có backward/rollback policy.
- Uninstall cho phép giữ hoặc xóa user data; mặc định không xóa dữ liệu không thể phục hồi.
- Work Graph tham chiếu artifact bằng stable ID, không bằng đường dẫn nội bộ package.
- Secret chỉ lưu opaque reference trong context; payload ở vault riêng.

## 10. Security boundary cho package

### First-party trong thời kỳ chuyển tiếp

Bundled adapter có thể chạy trong Main vì code đã là một phần app hiện tại, nhưng phải được đánh dấu `trusted-first-party` và thu hẹp dần API.

### Community package

Không được load code tùy ý vào Electron Main. Community package phải chạy trong:

- isolated renderer cho UI;
- utility/worker sandbox cho background logic;
- declarative Capsule runtime cho prompt/workflow;
- capability bridge được whitelist cho file, network, model, secret và notification.

Signature chỉ chứng minh nguồn gốc; permission và sandbox mới giới hạn hành vi.

## 11. Các phase migration

### Phase 0 — Baseline và contract freeze

- inventory route, bridge, MCP, service, storage và binary dependency;
- ghi behavioral baseline cho app hiện tại;
- chốt manifest v1 và contribution contract;
- đánh dấu Base candidate, package candidate và unresolved boundary;
- không di chuyển code.

**Gate:** có mapping đầy đủ và baseline đủ phát hiện regression quan trọng.

### Phase 1 — Virtual Package Registry

- đăng ký module hiện tại bằng virtual manifest;
- Home/Store đọc App Registry thay vì danh sách hardcode;
- giữ static import/wiring phía sau adapter;
- package state phản ánh đúng installed/available/failed.

**Gate:** UX mới hoạt động nhưng behavior module không đổi.

### Phase 2 — Activation adapters

- chuyển đăng ký route, bridge, MCP và settings sang owner-aware registry;
- activation/deactivation idempotent;
- thêm feature flag và legacy fallback;
- đo thời gian activation và lỗi.

**Gate:** một module có thể disable/re-enable mà không restart hoặc rò registration.

### Phase 3 — Installer và package artifact pilot

- download, integrity, signature, atomic install và rollback;
- dùng sample app nhỏ hoặc asset-heavy boundary rõ làm pilot;
- chứng minh offline launch và update failure recovery;
- chưa dùng Studio làm pilot đầu tiên.

**Gate:** install/open/update/rollback/uninstall chạy end-to-end.

### Phase 4 — Studio Suite packaging

- giữ nguyên module logic;
- build một artifact Studio Suite;
- chuyển static bridge/MCP wiring thành Studio activation;
- lazy-load module bên trong package;
- giữ route redirect và user data hiện tại.

**Gate:** một lần tải cung cấp toàn bộ Studio; deep link và dữ liệu cũ không hỏng.

### Phase 5 — Creator Mode

- Tomny SDK và templates;
- development app record xuất hiện trên Home;
- local sandbox và hot reload;
- build/validate/sign local artifact;
- publish pipeline ở chế độ private alpha.

**Gate:** một creator bên ngoài team tạo app mà không cần sửa source Base OS.

### Phase 6 — Community Runtime và de-bundle

- sandbox third-party hoàn chỉnh;
- permission review, revocation và quarantine;
- tách dần first-party artifact khỏi installer;
- gỡ legacy wiring chỉ khi telemetry và parity cho phép.

**Gate:** Base khởi động độc lập; package lỗi không làm crash Hub.

## 12. Chiến lược rollout

Mỗi package candidate đi qua cùng một strangler slice:

```text
Inventory
→ Virtual manifest
→ Activation adapter
→ Parity validation
→ Artifact split
→ Canary
→ Default package path
→ Remove legacy path
```

Canary theo cohort; không migrate toàn bộ user cùng lúc. Crash hoặc activation failure vượt ngưỡng sẽ tự quay lại phiên bản/legacy path an toàn.

## 13. Metrics kỹ thuật

- startup time của Base;
- installer và installed footprint;
- activation success rate;
- package-caused crash rate;
- rollback success rate;
- route/behavior parity;
- orphan registration/resource count;
- permission denial và secret exposure incident;
- thời gian mở module đã cài;
- tỷ lệ user data migration thành công.

## 14. Rủi ro và giảm thiểu

| Rủi ro                                 | Giảm thiểu                                                            |
| -------------------------------------- | --------------------------------------------------------------------- |
| Rewrite trá hình trong lúc package hóa | khóa scope, adapter trước, refactor sau parity                        |
| Bridge đăng ký tĩnh khó tháo           | owner-aware registry và disposer                                      |
| Studio dependency graph quá rộng       | package dạng suite, không tách từng module                            |
| Package làm crash Main                 | sandbox và process isolation; trusted adapter chỉ là bước chuyển tiếp |
| Dữ liệu bị chia cắt                    | stable ID, giữ storage path trước, migration versioned sau            |
| First-party dùng đặc quyền bí mật      | capability contract chung và audit ngoại lệ                           |
| Hai runtime cùng tồn tại quá lâu       | đặt removal gate và owner cho từng legacy path                        |
| Store mở trước security                | community publishing bị khóa đến khi sandbox/revoke đạt gate          |

## 15. Tiêu chí hoàn tất migration

- Base OS chạy được khi không có package tùy chọn.
- Home và Store hoàn toàn dựa trên registry.
- App hiện tại giữ hành vi và dữ liệu qua compatibility adapter.
- Studio là một Suite App Package tải một lần.
- App development xuất hiện trên Home và chạy trong sandbox.
- Package third-party không thể truy cập trực tiếp Electron/Node/secret.
- First-party và community package dùng cùng public contribution contract.
- Legacy wiring đã được gỡ theo bằng chứng, không theo deadline cảm tính.
- Testing/Benchmark không còn là surface sản phẩm.

## 16. Tài liệu liên quan

- [Package Platform Design](tomni-package-platform-design.md)
- [Home Hub PRD](tomni-home-hub.md)
- [Agentic Store PRD](tomni-agentic-store.md)
- [Hybrid Runtime Architecture](../../hybrid-runtime-architecture.md)
- [Core research](../../../core.md)
