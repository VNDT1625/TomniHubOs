# Tomni Agentic Store — UX/UI đã chốt

> Trạng thái: Đã chốt định hướng UX cơ bản  
> Ngày cập nhật: 2026-07-20

## 1. Mục tiêu

Agentic Store là nơi người dùng khám phá, tìm kiếm, cài đặt, cập nhật và quản lý các thành phần mở rộng của Tomni.

Store không chỉ chứa ứng dụng. Store có hai nhóm nội dung cấp cao:

1. **Apps** — ứng dụng hoàn chỉnh có giao diện và không gian làm việc riêng.
2. **Packages** — gói mở rộng có thể được app, agent hoặc hệ thống sử dụng.

Tên hiển thị trên giao diện phải là **Packages**, không dùng **Capability Packages** làm tên tab chung vì Store còn có **UI Packages**.

## 2. Thuật ngữ Store

### 2.1 Apps

App là một sản phẩm có trải nghiệm sử dụng riêng trong Tomni, ví dụ:

- Chat;
- IDE;
- Browser;
- Studio;
- Automation;
- Manager;
- Data Analyst;
- Social Inbox.

App sau khi cài có thể:

- xuất hiện trong thư viện Apps ở Home;
- được người dùng ghim vào sidebar trái;
- mở thành workspace hoặc surface riêng;
- dùng các dịch vụ dùng chung của Tomni như model, file, context, notification, permissions và secrets.

### 2.2 Packages

**Packages** là tên nhóm chung trên Store.

Packages hiện có ít nhất hai loại:

#### Capability Package

Gói năng lực có thể cung cấp:

- goal hoặc loại nhiệm vụ;
- guide và context;
- workflow động;
- surface cần dùng;
- tool hoặc capability;
- quyền hệ thống;
- cấu hình môi trường;
- automation;
- secret alias hoặc tích hợp API an toàn.

Capability Package có thể được cài để tăng năng lực cho agent, app hoặc workspace mà không nhất thiết tạo thêm một app độc lập ở sidebar.

Ví dụ:

- Full-stack Builder;
- Security Audit;
- Research Workflow;
- Social Publishing;
- Browser Account Operator.

#### UI Package

Gói giao diện có thể cung cấp:

- theme;
- layout;
- widget;
- dashboard block;
- icon set;
- design token;
- component preset;
- workspace template;
- giao diện chuyên biệt cho một app hoặc loại công việc.

Ví dụ:

- Developer Dark Workspace;
- Minimal Dashboard Widgets;
- Data Analysis Layout;
- Presentation Theme Pack;
- Accessibility UI Pack.

### 2.3 Nhãn hiển thị

Trên tab và điều hướng chính chỉ dùng:

```text
Apps
Packages
```

Trong thẻ hoặc trang chi tiết mới hiển thị loại cụ thể:

```text
APP
PACKAGE · CAPABILITY
PACKAGE · UI
```

Cách này cho phép bổ sung loại package mới trong tương lai mà không cần đổi cấu trúc Store.

## 3. Mock UI tổng thể

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◈ TOMNI                     🔍 Tìm ứng dụng, workspace, prompt, model...                         🔔 3        │
├──────────────────────┬─────────────────────────────────────────────────────────────┬─────────────────────────┤
│                  📌  │                                                             │ Trạng thái          📌 │
│ ◉  Home              │  Agentic Store                                              │                         │
│ ◎  Quản lý           │                                                             │ ┌─────────────────────┐ │
│ ◫  Runs              │  ┌───────────────────────────────────────────────────────┐  │ │ Công việc          │ │
│ ◈  Sản phẩm          │  │ 🔍 Tìm app, package, workflow, UI, nhà phát triển... │  │ │ 3 đang thực hiện   │ │
│ ◷  Lịch sử           │  └───────────────────────────────────────────────────────┘  │ │ 1 chờ duyệt · 54% →│ │
│ ⚙  Cài đặt           │                                                             │ └─────────────────────┘ │
│ TEAM / COMPANY     ＋ │  Khám phá     Apps     Packages     Đã cài     Cập nhật 2  │                         │
│ ▾ Tomni Company      │  ─────────                                                  │ ┌─────────────────────┐ │
│   Product Team       │                                                             │ │ Thông báo          │ │
│   Security Team      │  ┌─────────────────────────────────────────────────────────┐│ │ 4 chưa đọc         │ │
│                      │  │ NỔI BẬT                                                ││ │ Browser · Chat    →│ │
│ WORKSPACES         ＋ │  │                                                         ││ └─────────────────────┘ │
│ ▾ AionUi             │  │ ◉ Browser Agent                                         ││                         │
│   AI Security        │  │ Duyệt web, đăng nhập an toàn và thực hiện tác vụ đa bước││ ┌─────────────────────┐ │
│   Tomni Design       │  │                                                         ││ │ Models             │ │
│                      │  │ Tomni Labs · APP · 28 MB       [Xem chi tiết]   [Cài] ││ │ ● OpenAI           │ │
│ APPS               ＋ │  └─────────────────────────────────────────────────────────┘│ │ ● Anthropic        │ │
│ ◇ Chat               │                                                             │ │ ◐ OpenRouter       │ │
│ ◇ IDE                │  Danh mục                                                   │ │ 7 model khả dụng → │ │
│ ◇ Browser            │                                                             │ └─────────────────────┘ │
│ ◇ Studio             │  [ Năng suất ] [ Phát triển ] [ Sáng tạo ] [ Tự động hóa ]│                         │
│ ◇ Automation         │  [ Dữ liệu   ] [ Giao tiếp  ] [ Bảo mật  ] [ Giao diện   ]│ ┌─────────────────────┐ │
│                      │                                                             │ │ Hệ thống          │ │
│                      │  Đề xuất cho bạn                              Xem tất cả → │ │ CPU 32% · RAM 56% │ │
│ ◆ Store              │                                                             │ │ GPU 18% · Queue 3 │ │
│                      │  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────┐│ │ Core ổn định     →│ │
│                      │  │ ◇ Full-stack     │ │ ◫ Presentation  │ │ ◇ Minimal UI   ││ └─────────────────────┘ │
│                      │  │   Builder        │ │   Studio         │ │   Dashboard    ││                         │
│                      │  │                  │ │                  │ │                ││                         │
│                      │  │ PACKAGE          │ │ APP              │ │ PACKAGE        ││                         │
│                      │  │ CAPABILITY       │ │                  │ │ UI             ││                         │
│                      │  │                  │ │                  │ │                ││                         │
│                      │  │ ★ 4.9 · 36 MB    │ │ ★ 4.8 · 42 MB    │ │ ★ 4.7 · 12 MB  ││                         │
│                      │  │ Tomni Labs       │ │ Tomni Labs       │ │ Interface Lab  ││                         │
│                      │  │           [Cài]  │ │            [Mở]  │ │         [Cài]  ││                         │
│                      │  └──────────────────┘ └──────────────────┘ └────────────────┘│                         │
│                      │                                                             │                         │
│                      │  Phổ biến                                      Xem tất cả → │                         │
│                      │                                                             │                         │
│                      │  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────┐│                         │
│                      │  │ ◇ Research Agent │ │ ◇ Social Inbox   │ │ ◇ Data Layout  ││                         │
│                      │  │ APP              │ │ PACKAGE          │ │ PACKAGE · UI   ││                         │
│                      │  │ ★ 4.8      [Cài] │ │ CAPABILITY [Cài] │ │ ★ 4.9    [Cài] ││                         │
│                      │  └──────────────────┘ └──────────────────┘ └────────────────┘│                         │
│ ┌──────────────────┐ │                                                             │                         │
│ │ TD  Thuận Nguyễn │ │                                                             │                         │
│ │     Duy          │ │                                                             │                         │
│ │     Plus       ⋯ │ │                                                             │                         │
│ └──────────────────┘ │                                                             │                         │
└──────────────────────┴─────────────────────────────────────────────────────────────┴─────────────────────────┘
```

## 4. Hai lớp tìm kiếm

### 4.1 Global Search ở header

Global Search tìm trên toàn bộ Tomni:

- app đã cài;
- app và package trong Store;
- workspace;
- team/company;
- prompt;
- model;
- cài đặt;
- theme và giao diện;
- file, artifact, lịch sử và command.

### 4.2 Store Search

Store Search nằm bên trong content của trang Store và chỉ tìm nội dung trong Store.

Placeholder đã chốt:

```text
Tìm app, package, workflow, UI, nhà phát triển...
```

Store Search tìm theo:

- tên app;
- tên package;
- loại package;
- workflow;
- capability;
- UI, theme, widget hoặc layout;
- category;
- tag;
- mô tả;
- nhà phát triển;
- compatibility;
- tên app hoặc workspace được package hỗ trợ.

Khi người dùng nhập tìm kiếm, phần nổi bật và các khối đề xuất được thay bằng kết quả tìm kiếm.

## 5. Điều hướng trong Store

Thứ tự tab đã chốt:

1. **Khám phá**
2. **Apps**
3. **Packages**
4. **Đã cài**
5. **Cập nhật**

Không dùng tab tên **Capability Packages**.

### Khám phá

Hiển thị nội dung được biên tập và đề xuất:

- nổi bật;
- category;
- đề xuất cho người dùng;
- phổ biến;
- mới cập nhật;
- phù hợp với workspace đang chọn;
- do team/company đề xuất.

### Apps

Chỉ hiển thị app hoàn chỉnh.

Bộ lọc có thể gồm:

- category;
- nhà phát triển;
- miễn phí/trả phí;
- đã cài/chưa cài;
- tương thích hệ thống;
- yêu cầu model;
- yêu cầu app phụ thuộc.

### Packages

Hiển thị tất cả package và cho phép lọc theo loại:

```text
Tất cả
Capability
UI
```

Có thể bổ sung loại package mới sau này mà không thay tên tab chính.

### Đã cài

Hiển thị:

- app đã cài;
- package đã cài;
- phiên bản;
- dung lượng;
- trạng thái bật/tắt;
- app hoặc workspace đang sử dụng package;
- quyền đã cấp;
- nút mở, cấu hình, ghim, gỡ hoặc vô hiệu hóa.

### Cập nhật

Hiển thị:

- bản cập nhật app;
- bản cập nhật package;
- kích thước tải;
- changelog;
- thay đổi quyền;
- compatibility;
- cập nhật riêng lẻ hoặc cập nhật tất cả.

Badge số lượng chỉ hiển thị khi có cập nhật:

```text
Cập nhật 2
```

## 6. Danh mục

Category dùng chung cho cả Apps và Packages:

- Năng suất;
- Phát triển;
- Sáng tạo;
- Tự động hóa;
- Dữ liệu;
- Giao tiếp;
- Bảo mật;
- Giao diện;
- Tiện ích;
- Team/Company.

Category **Giao diện** ưu tiên UI Packages nhưng vẫn có thể chứa app chuyên thiết kế giao diện.

## 7. Thẻ nội dung

Mỗi thẻ cần hiển thị tối thiểu:

- icon;
- tên;
- loại nội dung;
- loại package nếu có;
- mô tả ngắn;
- nhà phát triển;
- đánh giá;
- dung lượng;
- trạng thái cài đặt;
- hành động chính.

Ví dụ App:

```text
┌────────────────────────────┐
│ ◫ Presentation Studio      │
│ APP                        │
│ Tạo slide và tài liệu      │
│                            │
│ ★ 4.8 · 42 MB              │
│ Tomni Labs          [Cài]  │
└────────────────────────────┘
```

Ví dụ Capability Package:

```text
┌────────────────────────────┐
│ ◇ Full-stack Builder       │
│ PACKAGE · CAPABILITY       │
│ Workflow xây ứng dụng      │
│                            │
│ ★ 4.9 · 36 MB              │
│ Tomni Labs          [Cài]  │
└────────────────────────────┘
```

Ví dụ UI Package:

```text
┌────────────────────────────┐
│ ◇ Minimal Dashboard        │
│ PACKAGE · UI               │
│ Layout và widget tối giản  │
│                            │
│ ★ 4.7 · 12 MB              │
│ Interface Lab       [Cài]  │
└────────────────────────────┘
```

## 8. Trang chi tiết

### 8.1 Trang chi tiết App

Cần có:

- ảnh hoặc video preview;
- mô tả;
- chức năng chính;
- nhà phát triển;
- phiên bản và changelog;
- dung lượng;
- quyền yêu cầu;
- model hoặc dịch vụ dùng chung;
- package đi kèm;
- app phụ thuộc;
- compatibility;
- đánh giá;
- nút Cài/Mở/Cập nhật/Gỡ;
- tùy chọn ghim vào sidebar sau khi cài.

### 8.2 Trang chi tiết Capability Package

Cần có:

- mục tiêu package giải quyết;
- workflow tổng quan;
- app, agent hoặc workspace hỗ trợ;
- tool và surface cần dùng;
- quyền cần cấp;
- secret/API alias cần kết nối;
- model đề xuất;
- automation đi kèm;
- dữ liệu package có thể truy cập;
- hành động Cài và Cấu hình.

### 8.3 Trang chi tiết UI Package

Cần có:

- preview giao diện;
- theme, layout, widget hoặc component được cung cấp;
- app và surface hỗ trợ;
- chế độ sáng/tối;
- design token hoặc font compatibility;
- ảnh trước/sau;
- tùy chọn Áp dụng thử;
- hành động Cài, Áp dụng, Hoàn tác và Gỡ.

## 9. Cài đặt và quyền

### App

Sau khi cài app:

- app xuất hiện trong thư viện Apps ở Home;
- không tự động ghim vào sidebar nếu người dùng chưa chọn;
- hiển thị tùy chọn **Ghim vào sidebar**;
- app dùng được các dịch vụ chung theo manifest và quyền đã cấp.

### Capability Package

Sau khi cài:

- package được đăng ký vào hệ thống capability;
- có thể bật cho toàn hệ thống, workspace, team hoặc app cụ thể;
- không mặc định tạo mục riêng trong sidebar;
- khi cần quyền hoặc secret, người dùng phải xác nhận trước khi kích hoạt.

### UI Package

Sau khi cài:

- package xuất hiện trong phần giao diện hoặc tùy chỉnh của app tương thích;
- người dùng có thể preview trước khi áp dụng;
- phải có khả năng hoàn tác về giao diện trước đó;
- không tự thay đổi toàn bộ hệ thống khi chưa được xác nhận.

## 10. Panel trái và phải

Trang Store dùng chung hành vi panel với Home Hub.

### Panel được ghim

- luôn hiển thị;
- chiếm không gian layout;
- nút ghim luôn nhìn thấy.

### Panel bỏ ghim

- tự ẩn;
- content Store mở rộng;
- panel xuất hiện dạng overlay khi chuột tới gần mép trái hoặc phải;
- không làm co hoặc đẩy nội dung Store;
- nút ghim xuất hiện khi panel được mở hoặc khi chuột tới gần.

Trạng thái ghim của panel trái và panel phải được lưu độc lập.

## 11. Hành vi UX quan trọng

- Store Search phải luôn dễ nhìn và nằm phía trên tabs hoặc ngay dưới tiêu đề Store.
- Global Search và Store Search phải khác placeholder, phạm vi và trạng thái focus.
- Store không được gọi mọi nội dung mở rộng là capability.
- **Packages** là nhóm chung; **Capability** và **UI** là loại package.
- Thẻ phải cho người dùng nhận ra ngay đây là App hay Package.
- Với Package, phải nhận ra ngay là Capability hay UI.
- Không tự động ghim app mới cài vào sidebar.
- Không tự kích hoạt Capability Package có quyền nhạy cảm.
- Không tự áp dụng UI Package lên toàn hệ thống.
- Quyền mới trong bản cập nhật phải được nêu rõ trước khi cập nhật.
- Store phải hoạt động tốt khi panel trái hoặc phải đang tự ẩn.
- Nội dung chính ưu tiên vừa màn hình desktop nhưng danh sách Store được phép cuộn dọc.

## 12. Quan hệ với Home Hub

- Sidebar trái của Home và Store chỉ hiển thị các app đã ghim.
- Khu Apps ở Home là thư viện app theo category, không thay thế Store.
- Store là nơi khám phá, cài đặt, cập nhật và quản lý App/Package.
- App sau khi cài có thể xuất hiện ở Home.
- Package sau khi cài chủ yếu xuất hiện trong app, workspace, capability manager hoặc phần giao diện phù hợp.

Tài liệu liên quan:

```text
docs/prds/feature-packs/tomni-home-hub.md
docs/prds/feature-packs/tomni-hub-pages.md
```
