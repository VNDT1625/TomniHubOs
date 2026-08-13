# Tomny Hub — Lịch sử, Sản phẩm, Quản lý và Cài đặt

> **Design conformance:** [Tomny Hub OS Visual Design System](tomni-hub-visual-design.md) là nguồn
> sự thật cho typography, glass, spacing, control, popup và responsive. Mock ASCII bên dưới
> chỉ mô tả information architecture; không được dùng để tạo một visual system khác.


> Trạng thái: Đã chốt mock UI nền tảng  
> Ngày cập nhật: 2026-07-20

## 1. Quyết định điều hướng chung

Thanh điều hướng cấp Hub dùng tên sau:

```text
Home
Quản lý
Sản phẩm
Lịch sử
Company
```

`Runs` không là top-level route; run/task nằm trong Quản lý hoặc app tương ứng. `Cài đặt`
được mở từ quick settings/account, không chiếm một primary nav row.

**Quản lý** thay cho **Tasks** vì trang Quản lý là trung tâm rộng hơn, bao gồm:

- tổng quan;
- công việc/tasks;
- lịch;
- ghi chú;
- dữ liệu;
- trạng thái Tomny Core liên quan tới quản lý công việc.

Không đặt một app **Manager** riêng trong nhóm app ghim mặc định vì sẽ trùng vai trò với trang cấp Hub **Quản lý**.

## 2. Khung giao diện dùng chung

Bốn trang dùng cùng shell với Home và Store:

- Header 48 px có Global Search và quick actions dùng chung.
- Sidebar 220 px, collapsed 64 px: điều hướng Hub, app ghim, Workspaces, Store và Account.
- Trục giữa là nội dung riêng của từng trang và dùng shared glass/control rhythm.
- Status rail 256 px là trạng thái toàn cục; ẩn dưới 1180 px và mở qua popup/shortcut.
- Dưới 760 px, sidebar mở bằng drawer/overlay; không dùng hover-edge auto-hide.
- Mỗi trang có Page Search riêng khi cần, không thay thế Global Search.

Phân biệt:

```text
Global Search
→ tìm trên toàn bộ Tomny.

Page Search
→ chỉ tìm trong trang hiện tại và dữ liệu thuộc phạm vi của trang đó.
```

---

## 3. Lịch sử

### 3.1 Mục tiêu

Lịch sử là nơi người dùng tìm lại và tiếp tục những gì đã làm trong Tomny, không phải trang log kỹ thuật thô.

Lịch sử có thể chứa:

- cuộc trò chuyện;
- công việc đã mở hoặc hoàn thành;
- lượt chạy agent;
- phiên app;
- workspace đã làm việc;
- sản phẩm đã mở hoặc chỉnh sửa;
- hoạt động automation;
- thao tác quan trọng có thể tiếp tục.

### 3.2 Mock UI

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◈ TOMNY                    🔍 Tìm app, workspace, prompt, model, cài đặt...                      🔔 4        │
├──────────────────────┬─────────────────────────────────────────────────────────────┬─────────────────────────┤
│                  📌  │                                                             │ Trạng thái          📌 │
│ ◉  Home              │  Lịch sử                                      [Xóa lịch sử] │                         │
│ ◎  Quản lý           │                                                             │ ┌─────────────────────┐ │
│ ◫  Company              │  ┌───────────────────────────────────────────────────────┐  │ │ Công việc          │ │
│ ◈  Sản phẩm          │  │ 🔍 Tìm cuộc trò chuyện, công việc, app, workspace... │  │ │ 5 đang thực hiện   │ │
│ ◷  Lịch sử           │  └───────────────────────────────────────────────────────┘  │ │ 2 chờ duyệt · 68% →│ │
│ ⚙  Cài đặt           │                                                             │ └─────────────────────┘ │
│                      │  Tất cả  Chat  Công việc  Runs  Apps  Sản phẩm              │                         │
│ TEAM / COMPANY     ＋ │  ───────                                                    │ ┌─────────────────────┐ │
│ ▾ Tomny Company      │                                                             │ │ Thông báo          │ │
│   Product Team       │  [Workspace: Tất cả⌄] [Thời gian: 30 ngày⌄] [Trạng thái⌄] │ │ 4 chưa đọc         │ │
│   Security Team      │                                                             │ │ Browser · Chat    →│ │
│                      │  Hôm nay                                                    │ └─────────────────────┘ │
│ WORKSPACES         ＋ │                                                             │                         │
│ ▾ Tomny Hub OS             │  ┌─────────────────────────────────────────────────────────┐│ ┌─────────────────────┐ │
│   AI Security        │  │ ◉ Chat  Phân tích AI Security                          ││ │ Models             │ │
│   Tomny Design       │  │ AI Security · 12:42 · GPT-5.6                          ││ │ ● OpenAI           │ │
│                      │  │ Đã trao đổi 28 tin nhắn                         [Mở lại]││ │ ● Anthropic        │ │
│ APPS               ＋ │  └─────────────────────────────────────────────────────────┘│ │ ◐ OpenRouter       │ │
│ ◇ Chat               │  ┌─────────────────────────────────────────────────────────┐│ │ 7 model khả dụng → │ │
│ ◇ IDE                │  │ ◇ IDE   Cải tổ frontend Tomny                          ││ └─────────────────────┘ │
│ ◇ Browser            │  │ Tomny Hub OS · 11:18 · 14 file đã thay đổi                   ││                         │
│ ◇ Studio             │  │ Phiên làm việc đã tạm dừng                    [Tiếp tục]││ ┌─────────────────────┐ │
│ ◇ Automation         │  └─────────────────────────────────────────────────────────┘│ │ Hệ thống          │ │
│                      │  ┌─────────────────────────────────────────────────────────┐│ │ CPU 34% · RAM 58% │ │
│ ◆ Store              │  │ ◎ Công việc  Tạo bản build desktop                    ││ │ Core ổn định     →│ │
│                      │  │ Product Team · Hoàn thành · 10:35                       ││ └─────────────────────┘ │
│                      │  │ 3 agent · 1 yêu cầu duyệt                       [Chi tiết]│                         │
│                      │  └─────────────────────────────────────────────────────────┘│                         │
│                      │                                                             │                         │
│                      │  Hôm qua                                                    │                         │
│                      │  ┌─────────────────────────────────────────────────────────┐│                         │
│                      │  │ ◫ Studio  Slide thuyết trình FVPL Summer Cup            ││                         │
│                      │  │ Tomny Design · chỉnh sửa lúc 22:14              [Mở lại]││                         │
│                      │  └─────────────────────────────────────────────────────────┘│                         │
│ ┌──────────────────┐ │                                                             │                         │
│ │ TD  Thuận Nguyễn │ │                                                             │                         │
│ │     Duy · Plus ⋯ │ │                                                             │                         │
│ └──────────────────┘ │                                                             │                         │
└──────────────────────┴─────────────────────────────────────────────────────────────┴─────────────────────────┘
```

### 3.3 Page Search

Placeholder:

```text
Tìm cuộc trò chuyện, công việc, app, workspace...
```

Tìm theo:

- tiêu đề;
- nội dung tóm tắt;
- app;
- workspace;
- team/company;
- agent hoặc model đã dùng;
- trạng thái;
- thời gian;
- sản phẩm liên quan.

### 3.4 Hành vi UX

- Kết quả nhóm theo ngày.
- Hành động chính là **Mở lại**, **Tiếp tục** hoặc **Chi tiết**.
- Có bộ lọc theo loại, workspace, thời gian và trạng thái.
- Không hiển thị log hệ thống cấp thấp; log kỹ thuật nằm trong trang hệ thống hoặc developer diagnostics.
- Cho phép xóa từng mục hoặc xóa lịch sử theo phạm vi, nhưng phải có xác nhận.
- Các mục bị xóa khỏi History không tự xóa sản phẩm, workspace hoặc dữ liệu nguồn.

---

## 4. Sản phẩm

### 4.1 Mục tiêu

Sản phẩm là nơi quản lý đầu ra đã được tạo hoặc đang được xây dựng trong Tomny.

Sản phẩm có thể là:

- tài liệu;
- slide;
- ứng dụng hoặc website;
- source/build;
- video, hình ảnh hoặc âm thanh;
- dataset;
- báo cáo;
- dashboard;
- workflow xuất bản;
- gói xuất hoặc bản chia sẻ.

Sản phẩm khác History:

```text
History
→ ghi lại nơi người dùng đã làm việc.

Sản phẩm
→ quản lý đầu ra có giá trị cần lưu, mở, chỉnh sửa, chia sẻ hoặc xuất bản.
```

### 4.2 Mock UI

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◈ TOMNY                    🔍 Tìm app, workspace, prompt, model, cài đặt...                      🔔 4        │
├──────────────────────┬─────────────────────────────────────────────────────────────┬─────────────────────────┤
│                  📌  │                                                             │ Trạng thái          📌 │
│ ◉  Home              │  Sản phẩm                                  [＋ Tạo sản phẩm] │                         │
│ ◎  Quản lý           │                                                             │ ┌─────────────────────┐ │
│ ◫  Company              │  ┌───────────────────────────────────────────────────────┐  │ │ Công việc          │ │
│ ◈  Sản phẩm          │  │ 🔍 Tìm tài liệu, app, slide, media, dataset...       │  │ │ 5 đang thực hiện   │ │
│ ◷  Lịch sử           │  └───────────────────────────────────────────────────────┘  │ │ 2 chờ duyệt · 68% →│ │
│ ⚙  Cài đặt           │                                                             │ └─────────────────────┘ │
│                      │  Tất cả  Tài liệu  App & Web  Media  Dữ liệu  Đã chia sẻ    │                         │
│ TEAM / COMPANY     ＋ │  ───────                                                    │ ┌─────────────────────┐ │
│ ▾ Tomny Company      │                                                             │ │ Thông báo          │ │
│   Product Team       │  [Workspace: Tất cả⌄] [Chủ sở hữu⌄] [Cập nhật gần đây⌄]  │ │ 4 chưa đọc         │ │
│   Security Team      │                                                   ▦  ☷     │ │ Browser · Chat    →│ │
│                      │                                                             │ └─────────────────────┘ │
│ WORKSPACES         ＋ │  Gần đây                                                    │                         │
│ ▾ Tomny Hub OS             │                                                             │ ┌─────────────────────┐ │
│   AI Security        │  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────┐│ │ Models             │ │
│   Tomny Design       │  │ ◇ APP            │ │ ◫ SLIDE          │ │ ▤ DOCUMENT     ││ │ ● OpenAI           │ │
│                      │  │ AI Security      │ │ FVPL Summer Cup  │ │ Báo cáo phát   ││ │ ● Anthropic        │ │
│ APPS               ＋ │  │ Dashboard       │ │ Presentation     │ │ hiện giả mạo   ││ │ ◐ OpenRouter       │ │
│ ◇ Chat               │  │                  │ │                  │ │                ││ │ 7 model khả dụng → │ │
│ ◇ IDE                │  │ Đang xây · 72%   │ │ Sẵn sàng         │ │ Bản nháp        ││ └─────────────────────┘ │
│ ◇ Browser            │  │ Tomny Hub OS · v12     │ │ Tomny Design     │ │ AI Security     ││                         │
│ ◇ Studio             │  │         [Mở]  ⋯  │ │         [Mở]  ⋯  │ │       [Mở]  ⋯  ││ ┌─────────────────────┐ │
│ ◇ Automation         │  └──────────────────┘ └──────────────────┘ └────────────────┘│ │ Hệ thống          │ │
│                      │                                                             │ │ CPU 34% · RAM 58% │ │
│ ◆ Store              │  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────┐│ │ Core ổn định     →│ │
│                      │  │ ◩ DATASET        │ │ ▶ VIDEO          │ │ ◈ WEBSITE      ││ └─────────────────────┘ │
│                      │  │ URL giả mạo      │ │ Demo sản phẩm    │ │ Landing page   ││                         │
│                      │  │ 18.240 bản ghi   │ │ 04:18            │ │ Tomny Store    ││                         │
│                      │  │ Đã chia sẻ       │ │ Đã xuất          │ │ Đang chỉnh sửa ││                         │
│                      │  │         [Mở]  ⋯  │ │         [Mở]  ⋯  │ │       [Mở]  ⋯  ││                         │
│                      │  └──────────────────┘ └──────────────────┘ └────────────────┘│                         │
│                      │                                                             │                         │
│                      │  Đang xử lý                                                   │                         │
│                      │  AI Security Dashboard · Build #128 · 72%          [Chi tiết]│                         │
│ ┌──────────────────┐ │                                                             │                         │
│ │ TD  Thuận Nguyễn │ │                                                             │                         │
│ │     Duy · Plus ⋯ │ │                                                             │                         │
│ └──────────────────┘ │                                                             │                         │
└──────────────────────┴─────────────────────────────────────────────────────────────┴─────────────────────────┘
```

### 4.3 Page Search

Placeholder:

```text
Tìm tài liệu, app, slide, media, dataset...
```

Tìm theo:

- tên sản phẩm;
- loại;
- nội dung hoặc metadata;
- workspace;
- chủ sở hữu;
- app đã tạo ra sản phẩm;
- trạng thái build/xuất bản;
- tag;
- phiên bản.

### 4.4 Hành vi UX

- Hỗ trợ grid và list view.
- Thẻ luôn hiển thị loại, tên, workspace, trạng thái và hành động mở.
- Menu `⋯` chứa đổi tên, chia sẻ, xuất, nhân bản, xem phiên bản, di chuyển và xóa.
- Sản phẩm đang build hiển thị tiến độ thật.
- Bản chia sẻ và bản xuất không được nhầm với file nguồn.
- Có version history cho sản phẩm phù hợp.
- Xóa sản phẩm đưa vào thùng rác trước khi xóa vĩnh viễn.

---

## 5. Quản lý

### 5.1 Mục tiêu

Quản lý là trung tâm tổ chức và điều phối công việc cá nhân, team và agent.

Trang này kế thừa phạm vi Manager hiện tại:

- Overview;
- Tasks;
- Daily notes;
- Learn notes;
- Data notes;
- Schedule;
- Core view.

Tên top-level là **Quản lý**, không dùng **Tasks** vì Tasks chỉ là một phần bên trong.

### 5.2 Mock UI

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◈ TOMNY                    🔍 Tìm app, workspace, prompt, model, cài đặt...                      🔔 4        │
├──────────────────────┬─────────────────────────────────────────────────────────────┬─────────────────────────┤
│                  📌  │                                                             │ Trạng thái          📌 │
│ ◉  Home              │  Quản lý                                           [＋ Tạo⌄]│                         │
│ ◎  Quản lý           │                                                             │ ┌─────────────────────┐ │
│ ◫  Company              │  ┌───────────────────────────────────────────────────────┐  │ │ Công việc          │ │
│ ◈  Sản phẩm          │  │ 🔍 Tìm công việc, ghi chú, lịch, dữ liệu...         │  │ │ 5 đang thực hiện   │ │
│ ◷  Lịch sử           │  └───────────────────────────────────────────────────────┘  │ │ 2 chờ duyệt · 68% →│ │
│ ⚙  Cài đặt           │                                                             │ └─────────────────────┘ │
│                      │  Tổng quan  Công việc  Lịch  Ghi chú  Dữ liệu  Core         │                         │
│ TEAM / COMPANY     ＋ │  ─────────                                                  │ ┌─────────────────────┐ │
│ ▾ Tomny Company      │                                                             │ │ Thông báo          │ │
│   Product Team       │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐│ │ 4 chưa đọc         │ │
│   Security Team      │  │ Hôm nay  5 │ │ Chờ duyệt 2│ │ Quá hạn  1 │ │ Sự kiện  3 ││ │ Browser · Chat    →│ │
│                      │  │ 3 agent    │ │ cần xử lý   │ │ cần chú ý  │ │ trong ngày ││ └─────────────────────┘ │
│ WORKSPACES         ＋ │  └────────────┘ └────────────┘ └────────────┘ └────────────┘│                         │
│ ▾ Tomny Hub OS             │                                                             │ ┌─────────────────────┐ │
│   AI Security        │  Ưu tiên hôm nay                                Xem tất cả →│ │ Models             │ │
│   Tomny Design       │                                                             │ │ ● OpenAI           │ │
│                      │  ┌─────────────────────────────────────────────────────────┐│ │ ● Anthropic        │ │
│ APPS               ＋ │  │ Cải tổ frontend Tomny                         68%      ││ │ ◐ OpenRouter       │ │
│ ◇ Chat               │  │ Codex Agent · Tomny Hub OS · Đang thực hiện        [Chi tiết]││ │ 7 model khả dụng → │ │
│ ◇ IDE                │  ├─────────────────────────────────────────────────────────┤│ └─────────────────────┘ │
│ ◇ Browser            │  │ Tạo bản build desktop                      Chờ duyệt   ││                         │
│ ◇ Studio             │  │ Build Agent cần quyền chạy lệnh      [Từ chối] [Duyệt]││ ┌─────────────────────┐ │
│ ◇ Automation         │  ├─────────────────────────────────────────────────────────┤│ │ Hệ thống          │ │
│                      │  │ Hoàn thiện slide thuyết trình                Hôm nay   ││ │ CPU 34% · RAM 58% │ │
│ ◆ Store              │  │ Thuận · Tomny Design · Chưa bắt đầu                   ││ │ Core ổn định     →│ │
│                      │  └─────────────────────────────────────────────────────────┘│ └─────────────────────┘ │
│                      │                                                             │                         │
│                      │  Lịch sắp tới                     Ghi chú gần đây            │                         │
│                      │  ┌──────────────────────────┐     ┌────────────────────────┐ │                         │
│                      │  │ 14:00 Product Review    │     │ Ý tưởng Capability     │ │                         │
│                      │  │ 16:30 Security Demo     │     │ Ghi chú họp frontend  │ │                         │
│                      │  │ Ngày mai Team Planning  │     │ Dataset cần làm sạch  │ │                         │
│                      │  └──────────────────────────┘     └────────────────────────┘ │                         │
│ ┌──────────────────┐ │                                                             │                         │
│ │ TD  Thuận Nguyễn │ │                                                             │                         │
│ │     Duy · Plus ⋯ │ │                                                             │                         │
│ └──────────────────┘ │                                                             │                         │
└──────────────────────┴─────────────────────────────────────────────────────────────┴─────────────────────────┘
```

### 5.3 Tabs chính

```text
Tổng quan
Công việc
Lịch
Ghi chú
Dữ liệu
Core
```

#### Tổng quan

- ưu tiên hôm nay;
- việc chờ duyệt;
- việc quá hạn;
- lịch sắp tới;
- ghi chú gần đây;
- trạng thái agent liên quan tới công việc.

#### Công việc

- list, board hoặc timeline;
- trạng thái;
- người/agent thực hiện;
- tiến độ;
- phụ thuộc;
- yêu cầu duyệt;
- workspace/team.

#### Lịch

- ngày, tuần và tháng;
- sự kiện thủ công;
- lịch automation;
- deadline công việc;
- nhắc lịch.

#### Ghi chú

- Daily;
- Learn;
- ghi chú cá nhân/team;
- liên kết tới công việc hoặc sản phẩm.

#### Dữ liệu

- ghi chú dữ liệu;
- bảng tham chiếu;
- nguồn dữ liệu;
- tài liệu hỗ trợ quản lý.

#### Core

- active runs liên quan tới Manager;
- queue;
- doctor/health;
- lỗi thực thi;
- trạng thái phục hồi.

### 5.4 Page Search

Placeholder:

```text
Tìm công việc, ghi chú, lịch, dữ liệu...
```

Kết quả nhóm theo loại và cho phép mở trực tiếp đúng tab.

### 5.5 Hành vi UX

- Nút **＋ Tạo** mở menu: Công việc, Ghi chú, Sự kiện, Mục dữ liệu.
- Công việc là đơn vị chính; agent là bên thực thi.
- Yêu cầu duyệt nằm trong công việc, không tạo một hệ thống duyệt tách rời.
- Right Status chỉ là tóm tắt nhanh; trang Quản lý là nơi chỉnh sửa và điều phối đầy đủ.
- Hỗ trợ `Ctrl/Cmd + K` cho command palette nội bộ của Quản lý.

---

## 6. Cài đặt

### 6.1 Mục tiêu và phạm vi

**Cài đặt** là nơi cấu hình phần lõi dùng chung của Tomny. Các thiết lập tại đây có thể ảnh hưởng tới nhiều app, agent, package, workspace hoặc thiết bị.

Cài đặt Tomny không chứa toàn bộ cấu hình riêng của từng app.

```text
Cài đặt Tomny
→ cấu hình mặc định, chính sách và dịch vụ dùng chung của toàn hệ thống.

Cài đặt App
→ cấu hình hành vi riêng của app đang mở.

Cài đặt Package
→ nằm trong trang chi tiết package hoặc app/workspace đang sử dụng package.

Store
→ khám phá, cài đặt và cập nhật Apps/Packages.
```

Ví dụ:

```text
Tomny › AI & Models
→ provider, API, model routing, agent, assistant và context mặc định.

Tomny › Quyền & bảo mật
→ xem và thu hồi quyền của mọi app, agent và package.

Browser › Cài đặt
→ profile, cookie, tải xuống, tab mới và hành vi riêng của Browser.

IDE › Cài đặt
→ editor, formatter, terminal và Git của IDE.
```

### 6.2 Mock UI tổng quan

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◈ TOMNY                    🔍 Tìm app, workspace, prompt, model, cài đặt...                      🔔 4        │
├──────────────────────┬─────────────────────────────────────────────────────────────┬─────────────────────────┤
│                  📌  │                                                             │ Trạng thái          📌 │
│ ◉  Home              │  Cài đặt Tomny                                              │                         │
│ ◎  Quản lý           │                                                             │ ┌─────────────────────┐ │
│ ◫  Company              │  ┌───────────────────────────────────────────────────────┐  │ │ Công việc          │ │
│ ◈  Sản phẩm          │  │ 🔍 Tìm AI, model, quyền, giao diện, bộ nhớ, kết nối...│  │ │ 5 đang thực hiện   │ │
│ ◷  Lịch sử           │  └───────────────────────────────────────────────────────┘  │ │ 2 chờ duyệt · 68% →│ │
│ ⚙  Cài đặt           │                                                             │ └─────────────────────┘ │
│                      │  Chỉ cấu hình phần dùng chung của Tomny                     │                         │
│ TEAM / COMPANY     ＋ │                                                             │ ┌─────────────────────┐ │
│ ▾ Tomny Company      │  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────┐│ │ Thông báo          │ │
│   Product Team       │  │ Tài khoản &      │ │ AI & Models      │ │ Capabilities   ││ │ 4 chưa đọc         │ │
│   Security Team      │  │ cá nhân          │ │                  │ │                ││ │ Browser · Chat    →│ │
│                      │  │ Thuận · Plus      │ │ 3 provider       │ │ 18 đã bật      ││ └─────────────────────┘ │
│ WORKSPACES         ＋ │  │ Ngôn ngữ · Sync  │ │ 7 model · 6 agent│ │ 2 cần xem lại  ││                         │
│ ▾ Tomny Hub OS             │  │           [Mở]   │ │           [Mở]   │ │         [Mở]   ││ ┌─────────────────────┐ │
│   AI Security        │  └──────────────────┘ └──────────────────┘ └────────────────┘│ │ Models             │ │
│   Tomny Design       │                                                             │ │ ● OpenAI           │ │
│                      │  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────┐│ │ ● Anthropic        │ │
│ APPS               ＋ │  │ Quyền &         │ │ Giao diện &      │ │ Dữ liệu &      ││ │ ◐ OpenRouter       │ │
│ ◇ Chat               │  │ bảo mật          │ │ trải nghiệm      │ │ bộ nhớ         ││ │ 7 model khả dụng → │ │
│ ◇ IDE                │  │ 2 cần xem lại    │ │ Dark · Compact   │ │ Memory · Cache ││ └─────────────────────┘ │
│ ◇ Browser            │  │ 1 cảnh báo       │ │ UI mặc định      │ │ Sync đang bật  ││                         │
│ ◇ Studio             │  │           [Mở]   │ │           [Mở]   │ │         [Mở]   ││ ┌─────────────────────┐ │
│ ◇ Automation         │  └──────────────────┘ └──────────────────┘ └────────────────┘│ │ Hệ thống          │ │
│                      │                                                             │ │ CPU 34% · RAM 58% │ │
│ ◆ Store              │  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────┐│ │ Core ổn định     →│ │
│                      │  │ Kết nối &        │ │ Tài nguyên &     │ │ Hệ thống       ││ └─────────────────────┘ │
│                      │  │ tích hợp         │ │ hiệu năng        │ │                ││                         │
│                      │  │ MCP 9/9 · API    │ │ CPU · GPU · Queue│ │ Update · Logs  ││                         │
│                      │  │ Remote · WebUI   │ │ Giới hạn · Cache │ │ Chẩn đoán      ││                         │
│                      │  │           [Mở]   │ │           [Mở]   │ │         [Mở]   ││                         │
│                      │  └──────────────────┘ └──────────────────┘ └────────────────┘│                         │
│ ┌──────────────────┐ │                                                             │                         │
│ │ TD  Thuận Nguyễn │ │                                                             │                         │
│ │     Duy · Plus ⋯ │ │                                                             │                         │
│ └──────────────────┘ │                                                             │                         │
└──────────────────────┴─────────────────────────────────────────────────────────────┴─────────────────────────┘
```

### 6.3 Nhóm cài đặt lõi

#### Tài khoản & cá nhân

- hồ sơ và gói tài khoản;
- ngôn ngữ, vùng và múi giờ;
- đồng bộ tài khoản và thiết bị;
- mặc định cá nhân dùng chung;
- quyền riêng tư và xuất/xóa dữ liệu cá nhân.

#### AI & Models

Gộp **Models**, **Agents** và **Assistants** thành một nhóm duy nhất vì chúng cùng thuộc lớp trí tuệ dùng chung của Tomny.

- nhà cung cấp model và API;
- trạng thái kết nối, độ trễ và quota;
- danh sách model khả dụng;
- model mặc định theo loại tác vụ;
- model routing và fallback;
- cấu hình agent;
- cấu hình assistant;
- hành vi hệ thống, prompt mặc định và personalization;
- context, memory và giới hạn sử dụng mặc định.

#### Capabilities

- capability dùng chung đã bật;
- tool và MCP capability;
- policy kích hoạt;
- phạm vi theo cá nhân, team, workspace hoặc toàn hệ thống;
- dependency và compatibility;
- liên kết tới Store để cài thêm package, nhưng không cài trực tiếp tại đây.

#### Quyền & bảo mật

Đây là nguồn quản lý quyền tập trung của Tomny.

- quyền của app, agent và package;
- phạm vi quyền: một lần, phiên hiện tại, workspace hoặc toàn hệ thống;
- chế độ hỏi mỗi lần, cho phép, tạm thời hoặc từ chối;
- secret alias và credential policy;
- đăng nhập, phiên thiết bị và xác thực;
- sandbox, command execution và quyền truy cập file;
- network, browser, camera, microphone, vị trí và notification;
- nhật ký cấp/thu hồi quyền và cảnh báo bảo mật.

Ví dụ bảng quyền:

```text
Ứng dụng / Package     Quyền                    Phạm vi           Trạng thái
Browser Agent          Điều khiển trình duyệt   Workspace A       Luôn cho phép
IDE                    Chạy terminal            Tomny Hub OS             Hỏi mỗi lần
Social Package         Đọc Facebook             Tài khoản cá nhân  Tạm thời
Automation             Gửi email                Toàn hệ thống      Đã từ chối
```

App vẫn có trang **Cài đặt › Quyền** riêng, nhưng chỉ hiển thị quyền liên quan tới app đó. Mọi thay đổi phải đồng bộ với trung tâm **Quyền & bảo mật** của Tomny.

#### Giao diện & trải nghiệm

- theme sáng/tối/hệ thống;
- accent color và density;
- font, cỡ chữ và accessibility;
- layout mặc định của Hub;
- trạng thái sidebar collapse/drawer và cách mở status rail khi responsive;
- notification experience dùng chung;
- UI Package đang áp dụng ở cấp toàn hệ thống, có preview và hoàn tác.

Thiết lập giao diện chỉ dành cho một app phải nằm trong cài đặt của app đó.

##### Dữ liệu & bộ nhớ

- memory dùng chung;
- context retention;
- lịch sử và thời gian lưu dữ liệu;
- cache;
- đồng bộ và backup;
- vị trí lưu trữ;
- xuất, nhập hoặc xóa dữ liệu;
- quy tắc dữ liệu cá nhân, team và workspace.

#### Kết nối & tích hợp

Chỉ chứa kết nối dùng chung hoặc được nhiều app sử dụng.

- MCP gateway và MCP server;
- API integrations dùng chung;
- WebUI và remote access;
- thiết bị đã kết nối;
- knowledge/realtime sources dùng chung;
- webhook và callback policy;
- trạng thái, độ trễ và lỗi kết nối.

Kết nối đặc thù như Git của IDE hoặc profile đăng nhập của Browser nằm trong chính app đó.

#### Tài nguyên & hiệu năng

- CPU, RAM và GPU limits;
- model runtime;
- queue và concurrency;
- storage và cache limits;
- network limits;
- background services;
- power/battery policy;
- ưu tiên tài nguyên giữa app, agent và automation.

#### Hệ thống

- phiên bản Tomny;
- cập nhật và kênh cập nhật;
- core health và diagnostics;
- logs hệ thống;
- backup/restore cấu hình;
- khởi động cùng hệ thống;
- testing/monitor cấp nền tảng;
- reset và about.

### 6.4 Phân quyền trách nhiệm

```text
Thiết lập ảnh hưởng nhiều app hoặc toàn Tomny
→ Cài đặt Tomny.

Thiết lập chỉ ảnh hưởng một app
→ Cài đặt bên trong app.

Thiết lập chỉ ảnh hưởng một package
→ Trang package hoặc nơi package đang được dùng.

Cài hoặc cập nhật app/package
→ Agentic Store.
```

Quy tắc:

- Không đưa danh sách app đã cài vào sidebar Cài đặt Tomny.
- App có thể liên kết nhanh tới **Quyền & bảo mật** đã lọc theo app.
- Package chỉ xuất hiện trong Cài đặt Tomny khi nó cung cấp hoặc thay đổi một dịch vụ dùng chung.
- Extension không được tự chèn một mục top-level vào Cài đặt Tomny nếu chỉ phục vụ một app.
- Cài đặt chung có thể cung cấp giá trị mặc định; app được phép override trong phạm vi riêng khi policy cho phép.

### 6.5 Page Search

Placeholder:

```text
Tìm AI, model, quyền, giao diện, bộ nhớ, kết nối...
```

Page Search chỉ tìm thiết lập lõi của Tomny và hiển thị đường dẫn đầy đủ:

```text
AI & Models › OpenAI › API
Quyền & bảo mật › IDE › Chạy terminal
Dữ liệu & bộ nhớ › Thời gian lưu lịch sử
Giao diện & trải nghiệm › Status rail › Responsive
```

Không đưa các thiết lập nội bộ như `Browser › Cookie` hoặc `IDE › Formatter` vào kết quả của Cài đặt Tomny. Global Search vẫn có thể tìm và dẫn người dùng tới cài đặt riêng của app.

### 6.6 Hành vi UX

- Dùng card tổng quan để người dùng nhận biết nhanh trạng thái của từng nhóm.
- Khi mở một nhóm, hiển thị sub-navigation trong trục giữa, không tạo thêm một sidebar toàn cục mới.
- Mỗi thay đổi phải ghi rõ phạm vi ảnh hưởng: cá nhân, team, workspace, thiết bị hoặc toàn hệ thống.
- Cài đặt nguy hiểm phải giải thích hậu quả và yêu cầu xác nhận.
- Quyền nhạy cảm phải cho phép thu hồi ngay và xem lịch sử thay đổi.
- Thay đổi giao diện có preview và hoàn tác.
- Thay đổi AI & Models phải hiển thị provider, model bị ảnh hưởng và fallback.
- Không trộn hành động cài package mới vào Cài đặt; hành động đó dẫn tới Store.
- Cài đặt riêng của app phải mở trong app, nhưng có thể được Global Search tìm thấy.

---

## 7. Quy tắc nhất quán giữa bốn trang

- Mỗi trang có Page Search riêng.
- Global Search luôn giữ ở header.
- Tabs hoặc nhóm điều hướng nội bộ nằm dưới Page Search.
- Hành động chính nằm bên phải tiêu đề trang.
- Filter nằm dưới tabs khi trang cần bộ lọc.
- Sidebar và status rail dùng đúng responsive contract của Home; không có cơ chế pin/auto-hide thứ hai.
- Right Status không thay đổi vai trò theo trang; nó luôn là trạng thái toàn cục.
- Tên điều hướng dùng tiếng Việt nhất quán: **Quản lý, Sản phẩm, Lịch sử, Company**.
- Không dùng **Tasks** làm top-level navigation.
- Không dùng **Artifacts** làm nhãn giao diện chính; dùng **Sản phẩm**.
- **AI & Models** là một nhóm cài đặt chung, bao gồm Models, Agents và Assistants.
- Cài đặt Tomny chỉ chứa thiết lập lõi dùng chung; cài đặt riêng nằm trong app hoặc package tương ứng.
- Quyền được quản lý tập trung ở Tomny nhưng mỗi app được hiển thị góc nhìn quyền đã lọc của chính nó.
- Trong code hoặc schema nội bộ vẫn có thể dùng `task`, `artifact`, `manager`, nhưng UI hiển thị theo thuật ngữ đã chốt.

## 8. Tài liệu liên quan

```text
docs/prds/feature-packs/tomni-home-hub.md
docs/prds/feature-packs/tomni-agentic-store.md
```
