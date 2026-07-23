# Tomni Hub Agent OS — Package Platform Design

> **Trạng thái:** Design đề xuất  
> **Phạm vi:** Base OS, package model, Studio Suite, creator workflow và marketplace  
> **Quyết định thay thế:** mô hình Feature Pack chỉ dành cho first-party và taxonomy `Capability Package` trong các bản thảo cũ

## 1. Tầm nhìn

Tomni chuyển từ một ứng dụng Electron chứa sẵn mọi tính năng thành một **Hub Agent OS** có thể mở rộng:

- bản cài gốc chỉ chứa shell và dịch vụ hệ thống cần thiết;
- app và năng lực chuyên môn được tải theo nhu cầu;
- người dùng có thể tạo app ngay trong Studio, chạy thử trực tiếp trên Home và public lên Store;
- Store hỗ trợ nội dung miễn phí hoặc trả phí;
- mọi nội dung cài thêm phải tuân theo manifest, permission, sandbox và quy trình kiểm duyệt của Tomni.

Vòng lặp sản phẩm chính:

```text
Home → Store → Cài/Mở → Studio tạo nội dung → Chạy ở Home → Public → Store
```

## 2. Nguyên tắc thiết kế

1. **Base chỉ chứa thứ cần để OS hoạt động.** Công cụ chuyên môn phải có thể tách khỏi installer.
2. **Một package là một đơn vị cài đặt.** Một package có thể đóng góp nhiều module và surface.
3. **App không có quyền trực tiếp với hệ điều hành.** Mọi quyền đi qua Tomni Capability Bridge.
4. **Local development là trạng thái hạng nhất.** App đang làm xuất hiện trong Home mà chưa cần publish.
5. **Không thực thi code Store không tin cậy trong Electron main process.** UI và worker phải chạy trong sandbox phù hợp.
6. **Mọi package đều có vòng đời đầy đủ:** cài, bật/tắt, cập nhật, rollback và gỡ.
7. **UI Package không được tự ý sửa app.** App phải chủ động hỗ trợ design-token contract.

## 3. Phạm vi Base OS

Base OS luôn được cài và không thể gỡ:

### 3.1 Product shell

- Home Hub;
- Store;
- Account/Auth;
- Settings;
- onboarding;
- navigation, global search và notification center;
- Chat lõi để điều khiển Agent OS;
- workspace và file access cơ bản.

### 3.2 System services

- Package Manager;
- App Registry;
- Package Runtime và Sandbox Supervisor;
- Permission Broker;
- Secret Vault;
- Model Gateway;
- Context/Memory service lõi;
- License và entitlement service;
- updater, recovery và diagnostics hệ thống.

Base không chứa các editor, browser automation, media engine hoặc công cụ chuyên môn nặng nếu chúng có thể được phân phối bằng package.

## 4. Taxonomy chính thức

Store và Creator Platform hỗ trợ đúng ba loại package cấp cao.

### 4.1 App Package

Một sản phẩm hoàn chỉnh có trải nghiệm và workspace riêng. App Package có thể đóng góp:

- một hoặc nhiều app surface;
- route và command;
- agent, skill hoặc MCP đi kèm;
- settings;
- background worker;
- asset và locale;
- shortcut có thể ghim vào sidebar.

Sau khi cài, app xuất hiện trong Apps Library ở Home nhưng không tự động được ghim.

### 4.2 UI Package

Gói giao diện không phải app độc lập. UI Package có ba scope:

- `system`: theme, font, icon và layout token của Hub;
- `app`: giao diện dành cho danh sách app tương thích;
- `universal`: áp dụng cho Hub và các app đã opt-in vào cùng design-token contract.

UI Package chỉ được phép dùng API token/component do Tomni cung cấp. Không được inject script hoặc sửa DOM tùy ý của Hub hay app khác. Mọi thay đổi phải có preview, apply, rollback và compatibility range.

### 4.3 Agent Capsule

Agent Capsule là gói hành vi AI có cấu trúc, tái sử dụng được; không chỉ là một prompt. Capsule có thể chứa:

- system/task prompt;
- skill và knowledge instructions;
- dynamic workflow;
- automation graph;
- agent roles và handoff rules;
- tool/MCP bindings;
- context và memory policy;
- model profile và fallback;
- permission requirements;
- input/output schema;
- evaluation fixtures và quality threshold.

Capsule có thể được bật cho toàn hệ thống, workspace, team hoặc một app cụ thể. Capsule không mặc định tạo app hoặc shortcut riêng.

Không cam kết kết quả AI đúng 100%. Store phải mô tả rõ phạm vi, phiên bản model tương thích và kết quả đánh giá của Capsule.

## 5. Mô hình App Package dạng Suite

Một **Suite App Package** là App Package có nhiều module, nhưng vẫn là **một install unit**:

- một lần tải;
- một version;
- một chữ ký;
- một lần cập nhật hoặc rollback;
- dependency dùng chung chỉ lưu một lần;
- module bên trong được lazy-load khi mở.

Module không phải package con độc lập. Module chỉ là contribution của package cha.

### 5.1 Studio Suite

Studio được phân phối dưới dạng `com.tomni.studio` và tải một lần. Package dự kiến chứa:

- **IDE & App Builder** — viết code, tạo Tomni app/package và quản lý project;
- **Universal Editor** — mở và chỉnh sửa tài liệu được hỗ trợ;
- **UI Designer** — VIU, canvas, prototype và app surface design;
- **Media Studio** — tạo/chỉnh sửa video và media;
- **Automation Builder** — xây workflow và automation graph;
- **Agent Workspace** — chat, agent tools và context phục vụ nội dung đang mở.

Store chỉ hiển thị một sản phẩm **Studio**. Home mặc định hiển thị một Studio app. Người dùng có thể ghim shortcut như “IDE” hoặc “UI Designer”, nhưng các shortcut cùng trỏ vào package Studio đã cài và không tạo thêm lượt tải.

```text
Studio Suite Package (một install unit)
├── IDE & App Builder
├── Universal Editor
├── UI Designer
├── Media Studio
├── Automation Builder
└── shared runtime/assets/locales
```

Manifest rút gọn:

```json
{
  schemaVersion: 1,
  id: com.tomni.studio,
  type: app,
  bundleKind: suite,
  version: 1.0.0,
  engines: { tomni: >=1.0.0 },
  modules: [
    { id: ide, surface: studio/ide, pinnable: true },
    { id: editor, surface: studio/editor, pinnable: true },
    { id: ui-designer, surface: studio/design, pinnable: true },
    { id: media, surface: studio/media, pinnable: true },
    { id: automation, surface: studio/automation, pinnable: true }
  ],
  permissions: [workspace.read, workspace.write, model.invoke]
}
```

### 5.2 Các App Package first-party khác

- Browser;
- Manager/Operations;
- Team/Company;
- các app chuyên ngành phát sinh sau này.

Không có App Package hoặc mục Store tên **Testing** hay **Benchmark**. Việc kiểm tra package là hạ tầng nội bộ của IDE, CI và publish gate, không phải sản phẩm độc lập. IDE vẫn được phép có preview, validation và sửa lỗi trong luồng phát triển app.

## 6. App đang phát triển trong Home

Home Apps Library hợp nhất hai nguồn:

1. app đã cài từ Store;
2. app local đang được Studio quản lý.

Khi người dùng tạo app trong IDE:

- Studio đăng ký một `development app record` vào App Registry;
- app xuất hiện ngay trong Apps Library với badge **Development**;
- app không xuất hiện trong Store và không được người dùng khác nhìn thấy;
- click app sẽ mở sandbox development với hot reload;
- shortcut có thể ghim nhưng luôn mang badge Development;
- xóa hoặc đóng project sẽ làm record mất hiệu lực, không để shortcut hỏng âm thầm.

Trạng thái đề xuất:

```text
draft → development → validation_failed | ready_to_publish
      → in_review → published | rejected | suspended
```

Home không dùng khu vực Testing riêng. Trạng thái phát triển nằm ngay trên card app để người dùng luôn biết app đó chưa phải bản Store.

## 7. Creator workflow

### 7.1 Tạo project

Studio cung cấp template chính thức cho:

- App Package;
- UI Package;
- Agent Capsule;
- Suite App Package dành cho use case nâng cao.

Project chứa manifest, source, asset, locale, permission declaration và publish metadata.

### 7.2 Preview và validation

IDE thực hiện:

- schema validation;
- compatibility check;
- permission diff;
- dependency audit;
- package size/budget check;
- static security scan;
- sandbox smoke run;
- locale và accessibility check;
- build artifact và integrity hash.

Validation là publish gate bắt buộc nhưng không phải một app Testing/Benchmark.

### 7.3 Public lên Store

Luồng publish:

```text
Build → Validate → Chọn Free/Paid → Khai báo quyền và dữ liệu
      → Ký artifact → Upload → Automated review → Human review khi cần
      → Publish
```

Người tạo chọn:

- miễn phí;
- trả phí một lần;
- subscription nếu Store hỗ trợ ở giai đoạn sau.

Giá, khu vực bán, thuế, chia sẻ doanh thu, payout và refund được quản lý bởi Marketplace service, không nằm trong package runtime.

## 8. Package manifest và contribution contract

Mọi package cần tối thiểu:

- ID toàn cục và publisher ID;
- type;
- version và Tomni compatibility range;
- artifact URL, size, integrity và signature;
- entrypoints/module contributions;
- permissions;
- network domain allowlist nếu có;
- dependencies;
- data retention/uninstall policy;
- pricing entitlement requirement;
- locales, icon và Store metadata.

Package chỉ gọi API từ Tomni SDK. Các contribution được App Registry đăng ký theo manifest; package không tự sửa Router, sidebar hay system settings.

## 9. Cài đặt và runtime

```text
Store/Local Project
  → resolve manifest
  → compatibility check
  → download/build artifact
  → verify integrity + signature
  → permission approval
  → atomic install
  → register contributions
  → launch in sandbox
```

Yêu cầu vòng đời:

- cài đặt có progress, pause/resume và retry;
- update phải nêu rõ quyền mới;
- version mới được cài song song rồi atomic swap;
- crash lặp lại phải tự rollback;
- app đã cài dùng được offline nếu không phụ thuộc dịch vụ online;
- uninstall phải cảnh báo dependency và cho phép giữ/xóa user data;
- entitlement của app trả phí được kiểm tra nhưng không làm mất dữ liệu khi tạm offline.

## 10. Security và Store policy

### 10.1 Runtime controls

- UI chạy trong isolated renderer/web sandbox;
- worker chạy trong utility process hoặc worker sandbox có quota;
- cấm import Node/Electron trực tiếp từ package UI;
- file, network, model, secret và notification đi qua capability bridge;
- permission có scope theo app/workspace và có thể thu hồi;
- secret chỉ được truy cập bằng alias, không trả plaintext cho package khi không cần;
- CPU, RAM, storage và background activity có quota;
- package có kill switch và revocation list.

### 10.2 Nội dung bị cấm

Không cho public package:

- chứa malware, miner, spyware hoặc cơ chế persistence ngoài Tomni;
- đánh cắp credential, secret hoặc dữ liệu người dùng;
- né permission/sandbox;
- vi phạm bản quyền hoặc giả mạo publisher;
- tự động thực hiện hành vi nguy hiểm mà không có xác nhận;
- che giấu network destination hoặc thay đổi hành vi sau review;
- quảng cáo sai khả năng hoặc cam kết kết quả AI tuyệt đối.

Store cần cơ chế report, takedown, suspension, appeal, refund và emergency revoke.

## 11. UI Package compatibility

Tomni cung cấp `Tomni Design Tokens` theo version. App chọn một trong ba mức:

- `none`: giữ nguyên UI app;
- `tokens`: nhận màu, typography, spacing và radius tương thích;
- `components`: dùng Tomni component contract nên nhận theme sâu hơn.

UI Package khai báo token version và danh sách app hỗ trợ. Khi app không tương thích, Store không cho apply vào app đó. System UI luôn có preview và nút hoàn tác về theme an toàn mặc định.

## 12. Ranh giới kiến trúc Electron

Khi triển khai, module mục tiêu được chia như sau:

- `packages/desktop/src/common/`: manifest schema, package types, permission contracts và IPC DTO;
- `packages/desktop/src/process/extensions/`: resolver, loader, lifecycle và contribution registry;
- `packages/desktop/src/process/services/`: installer, marketplace, license, signing client và persistence;
- `packages/desktop/src/process/bridge/`: IPC handlers cho Store, Home, Creator và package runtime;
- `packages/desktop/src/preload/`: capability bridge được whitelist;
- `packages/desktop/src/renderer/pages/`: Home, Store, Studio host và sandbox surfaces.

Renderer không được đọc filesystem/package trực tiếp. Main process không được render UI. Mọi giao tiếp phải qua bridge có type và permission check.

## 13. Lộ trình đề xuất

### Phase 1 — Contract và runtime foundation

- chốt manifest schema cho ba loại package;
- xây App Registry, installer, signature và permission broker;
- dùng một sample app nhỏ để chứng minh install/open/update/uninstall/rollback.

### Phase 2 — Home và first-party modularization

- Home đọc app từ App Registry;
- tách một app nhỏ làm pilot;
- đóng gói Studio thành một Suite App Package duy nhất;
- giữ shortcut module nhưng không tách lượt tải.

### Phase 3 — Creator Mode

- template và Tomni SDK;
- development app record trên Home;
- sandbox hot reload;
- build, validation và local signing.

### Phase 4 — Community Store

- publisher account;
- automated/human review;
- free và paid listing;
- entitlement, payout, report và takedown.

### Phase 5 — UI Package ecosystem

- versioned design-token contract;
- preview/apply/rollback;
- compatibility certification cho app third-party.

## 14. Tiêu chí nghiệm thu cấp sản phẩm

Thiết kế được xem là hiện thực hóa khi:

- Tomni khởi động và dùng được Home/Store khi chưa cài package tùy chọn;
- app tải từ Store tự xuất hiện trên Home sau khi cài;
- Studio được tải một lần và cung cấp nhiều module;
- app đang làm trong IDE xuất hiện trên Home với badge Development;
- người tạo có thể public miễn phí hoặc trả phí qua review gate;
- UI Package không thể sửa app chưa opt-in;
- Agent Capsule đăng ký được workflow/tool/context mà không cần tạo app;
- package sai chữ ký, sai compatibility hoặc vượt quyền bị từ chối;
- update, rollback và uninstall không làm hỏng Base OS;
- không tồn tại Testing/Benchmark như app hoặc package sản phẩm.

## 15. Quyết định đã chốt

- Ba loại chính: **App Package, UI Package, Agent Capsule**.
- Studio là **Suite App Package**, một lần tải cho toàn bộ module.
- App local đang phát triển hiển thị trực tiếp trong Home Apps Library.
- Store hỗ trợ hệ sinh thái cộng đồng, nội dung free và paid.
- UI Package chỉ tác động app thông qua design-token compatibility và opt-in.
- Testing/Benchmark bị loại khỏi product/package map; validation chỉ tồn tại như hạ tầng phát triển và publish.