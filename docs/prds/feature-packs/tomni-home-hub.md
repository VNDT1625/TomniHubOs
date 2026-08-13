# Tomny Home Hub — UI đã chốt

> **Design conformance:** [Tomny Hub OS Visual Design System](tomni-hub-visual-design.md) là nguồn
> sự thật cho typography, glass, spacing, control, popup và responsive. Mock ASCII bên dưới
> chỉ mô tả information architecture; không được dùng để tạo một visual system khác.


> Trạng thái: Đã chốt định hướng UX cơ bản  
> Ngày cập nhật: 2026-07-20




## 1. Mục tiêu

Trang Home là trung tâm điều hành của Tomny Agentic Hub, không phải giao diện chat-first.
Người dùng có thể:

- bắt đầu yêu cầu nhanh qua thanh chat;
- dùng chế độ **Super**;
- mở app đã ghim;
- tiếp tục công việc đang dở;
- theo dõi công việc, thông báo ứng dụng, model và tài nguyên hệ thống;
- tìm gần như mọi thứ trong hệ thống từ thanh tìm kiếm toàn cục.

## 2. Mock UI tổng thể

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◈ TOMNY                    🔍 Tìm ứng dụng, workspace, prompt, model, cài đặt...                 🔔 4        │
├──────────────────────┬─────────────────────────────────────────────────────────────┬─────────────────────────┤
│                      │                                                             │ Trạng thái              │
│ ◉  Home              │                  Hôm nay bạn muốn làm gì?                  │                         │
│ ◎  Quản lý           │                                                             │ ┌──────────────────────┐│
│ ◫  Runs              │   ┌─────────────────────────────────────────────────────┐   │ │ Công việc           ││
│ ◈  Sản phẩm          │   │ 🤖 Tomny Agentic │ ● │ ◈ │ ◇ │ ◆ │ ＋             │   │ │ 5 đang thực hiện    ││
│ ◷  Lịch sử           │   ├─────────────────────────────────────────────────────┤   │ │ 2 chờ duyệt · 68%  →││
│ ⚙  Cài đặt           │   │ Tomny Agentic, gửi tin nhắn, tải tệp...            │   │ └──────────────────────┘│
│ TEAM / COMPANY     ＋ │   │                                                     │   │                         │
│ ▾ Tomny Company      │   │ ＋               ⚡ Super   cx/gpt-5.6 ▼       ➜  │   │ ┌──────────────────────┐│
│   Product Team       │   ├─────────────────────────────────────────────────────┤   │ │ Thông báo           ││
│   Security Team      │   │ □ Làm việc trong workspace ▼                       │   │ │ 4 chưa đọc          ││
│                      │   └─────────────────────────────────────────────────────┘   │ │ Browser · Chat     →││
│ WORKSPACES         ＋ │                                                             │ └──────────────────────┘│
│ ▾ Tomny Hub OS             │   Apps                                             Show all ⌄│                         │
│   AI Security        │                                                             │ ┌──────────────────────┐│
│   Tomny Design       │   ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐│ │ Models              ││
│                      │   │ ◉ Chat  ◇ Mail  │ │ ◫ Studio ◇ Docs│ │ ◇ IDE    ◇ Git  ││ │ ● OpenAI            ││
│ APPS               ＋ │   │ ◇ Browser ◇ AI │ │ ◇ Video  ◇ Data│ │ ◇ Terminal ◇ Test││ │ ● Anthropic         ││
│ ◇ Chat               │   └─────────────────┘ └─────────────────┘ └─────────────────┘│ │ ◐ OpenRouter        ││
│ ◇ IDE                │     Communication        Creation          Developer Tools │ │ 7 model khả dụng  →││
│ ◇ Browser            │                                                             │ └──────────────────────┘│
│ ◇ Studio             │   Tiếp tục                                     Xem tất cả → │                         │
│ ◇ Automation         │   ┌────────────────────┐ ┌────────────────────┐ ┌───────────┐│ ┌──────────────────────┐│
│                      │   │ ◇ IDE              │ │ ◉ Chat             │ │ ◫ Studio  ││ │ Hệ thống           ││
│                      │   │ Cải tổ frontend    │ │ Phân tích Security │ │ Slide dự án││ │ CPU 34% · RAM 58%  ││
│ ＋ Store              │   │ Tomny Hub OS · 18 phút  →│ │ 1 giờ trước      → │ │ Hôm qua  →││ │ GPU 21% · Queue 6  ││
│                      │   └────────────────────┘ └────────────────────┘ └───────────┘│ │ Core ổn định      →││
│ ┌──────────────────┐ │                                                             │ └──────────────────────┘│
│ │ TD  Thuận Nguyễn │ │                                                             │                         │
│ │     Duy          │ │                                                             │                         │
│ │     Plus       ⋯ │ │                                                             │                         │
│ └──────────────────┘ │                                                             │                         │
└──────────────────────┴─────────────────────────────────────────────────────────────┴─────────────────────────┘
```

## 3. Điều hướng bên trái

Thứ tự đã khóa theo HubHome hiện hành:

1. Logo + nút thu gọn/mở rộng;
2. Home;
3. Quản lý;
4. Sản phẩm;
5. Lịch sử;
6. Company;
7. Ứng dụng ghim;
8. Workspaces;
9. spacer;
10. Store;
11. Account.

Không có `Runs` hoặc `Cài đặt` như một primary nav row riêng. Cài đặt mở từ quick settings
hoặc account; run/task được quản lý trong Quản lý và các surface liên quan. Không dùng nhóm
“Gần đây” trong sidebar.

### Company và Workspaces

- Company là route cấp Hub, không phải app ghim mặc định.
- Workspaces là section riêng, có thể thu gọn và có child row.
- Mỗi workspace có thể thuộc cá nhân, team hoặc company.

### Ứng dụng ghim

- Chỉ hiển thị app người dùng đã ghim, ví dụ Chat, IDE, Studio, Terminal và Git.
- Người dùng có thể ghim, bỏ ghim và sắp xếp lại.
- Store là card riêng ở cuối sidebar, không nằm trong danh sách app ghim.

### Account

Account là control đầy đủ ở cuối sidebar, ngay dưới Store. Khi sidebar thu gọn chỉ hiển thị
avatar. Click mở quick account popup và có hành động mở Settings đầy đủ.

## 4. Header

### Global Search

Thanh tìm kiếm có thể tìm:

- app đã cài;
- app trong Store;
- workspace;
- team/company;
- prompt;
- model;
- cài đặt;
- theme, ánh sáng và giao diện;
- file, artifact và lịch sử;
- command hoặc chức năng nhanh.

### Chuông

Chuông chỉ dành cho báo cáo cấp hệ thống:

- lỗi core;
- API mất kết nối;
- cảnh báo bảo mật;
- cập nhật hệ thống;
- sự cố model hoặc capability;
- trạng thái dịch vụ nền.

Không dùng chuông cho tin nhắn từ app.

## 5. Khu vực trung tâm

### Thanh chat

Thanh chat giữ đúng tinh thần hiện tại:

- một selector gộp agent/CLI/model: phần trên chọn Tomny Agentic, Tomny CLI hoặc CLI tương thích;
  phần dưới chọn model của agent/CLI đang dùng;
- nhập tin nhắn hoặc tải tệp;
- nút thêm capability/package và tool nhanh;
- chọn workspace hoặc dự án;
- nút gửi;
- nút **Super** là hành động quan trọng và phải nổi bật.

### Apps ở trục giữa

- hiển thị thư viện app theo category bằng các khung biểu tượng trực quan;
- tiêu đề là **Apps** và bộ lọc bên phải là **Show all**;
- không lặp lại danh sách app đã ghim ở sidebar;
- nhấn app để mở, nhấn category hoặc **Show all** để xem thư viện đầy đủ.

### Tiếp tục

Hiển thị tối đa bốn thẻ ở desktop; giảm số cột theo viewport để Home vẫn gọn và không cắt nội dung.

```text
Tiếp tục                                                     Xem tất cả →

┌──────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────────┐
│ ◇ IDE                    │ │ ◉ Chat                   │ │ ◫ Studio                 │
│ Cải tổ frontend Tomny    │ │ Phân tích AI Security   │ │ Slide thuyết trình       │
│ Tomny Hub OS · 18 phút trước  →│ │ 1 giờ trước            →│ │ Hôm qua                →│
└──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘
```

Phần này chỉ chứa nơi người dùng có thể quay lại ngay:

- phiên IDE;
- cuộc trò chuyện;
- workspace;
- tài liệu hoặc studio session;
- công việc bị tạm dừng.

Không hiển thị agent, hàng đợi hoặc cảnh báo hệ thống tại đây.

## 6. Status rail bên phải

Status rail gồm bốn card tóm tắt:

1. Công việc
2. Thông báo
3. Models
4. Hệ thống

### 6.1 Công việc

Gộp agent, tiến độ và yêu cầu duyệt vào cùng một ô.

```text
┌──────────────────────┐
│ Công việc            │
│ 5 đang thực hiện     │
│ 2 chờ duyệt · 68%  → │
└──────────────────────┘
```

Khi bấm vào, mở popup chi tiết:

```text
┌──────────────────── Công việc ────────────────────┐
│                                                   │
│ Cải tổ frontend Tomny                       68%   │
│ Codex Agent · Đang chỉnh sửa GuidPage             │
│ ███████████████████░░░░░░                          │
│                                                   │
│ Phân tích AI Security                       47%   │
│ Security Agent · Đang kiểm tra backend             │
│ █████████████░░░░░░░░░░░                           │
│                                                   │
│ Tạo bản build desktop                     Chờ duyệt│
│ Build Agent cần quyền chạy lệnh                     │
│                              [Từ chối] [Phê duyệt] │
│                                                   │
│ 5 đang thực hiện · 2 chờ duyệt · 6 trong hàng đợi │
└───────────────────────────────────────────────────┘
```

### 6.2 Thông báo

Thông báo trong tab phải là tin từ ứng dụng:

- Browser có tin nhắn Facebook;
- Chat có người phản hồi;
- Automation hoàn thành báo cáo;
- app nền gửi cập nhật.

```text
┌──────────────────── Thông báo ────────────────────┐
│                                                   │
│ Browser                                           │
│ Facebook có 2 tin nhắn mới                 2 phút │
│                                                   │
│ Chat                                              │
│ Khang đã phản hồi trong nhóm               8 phút │
│                                                   │
│ Automation                                        │
│ Báo cáo email buổi sáng đã hoàn thành      20 phút│
│                                                   │
│                           Đánh dấu tất cả đã đọc  │
└───────────────────────────────────────────────────┘
```

### 6.3 Models

Dùng để kiểm tra kết nối API model và danh sách model khả dụng.

```text
┌─────────────────────────────────────────────┐
│ Models                              Quản lý │
│                                             │
│ ● OpenAI                 Đã kết nối         │
│   GPT-5.6 · GPT-5.6 Mini                   │
│                                             │
│ ● Anthropic              Đã kết nối         │
│   Claude Sonnet · Claude Opus              │
│                                             │
│ ◐ OpenRouter             Kết nối chậm       │
│   Gemini · DeepSeek · Qwen                 │
│                                             │
│ 3 nhà cung cấp · 7 model khả dụng          │
└─────────────────────────────────────────────┘
```

Cần thể hiện:

- nhà cung cấp;
- trạng thái kết nối;
- độ trễ hoặc lỗi;
- model khả dụng;
- truy cập nhanh vào trang quản lý model.

### 6.4 Hệ thống

Hiển thị dữ liệu thực của máy và runtime:

```text
┌─────────────────────────────────────────────┐
│ Hệ thống                           Chi tiết │
│                                             │
│ CPU    34%          RAM    58%              │
│ GPU    21%          Disk   126 GB trống     │
│ Mạng   12 MB/s      Queue  6 chờ            │
│                                             │
│ ● Core ổn định · MCP 9/9 kết nối           │
└─────────────────────────────────────────────┘
```

Bao gồm:

- CPU;
- RAM;
- GPU;
- dung lượng đĩa;
- mạng;
- hàng đợi;
- trạng thái Core;
- MCP/capability connection.

## 7. Nguyên tắc bố cục

- Home phải vừa trong một màn hình desktop phổ biến, hạn chế cuộn dọc.
- Sidebar trái ưu tiên cấu trúc Hub, không ưu tiên lịch sử chat.
- Tab phải là quan sát và quản lý nhanh, không thay thế trang chi tiết.
- Mỗi ô trạng thái bấm được và mở popup hoặc trang chi tiết.
- Chuông hệ thống và Thông báo ứng dụng là hai luồng riêng.
- Công việc là đơn vị chính; agent, tiến độ, duyệt và hàng đợi nằm bên trong công việc.
- Super phải luôn nổi bật trong thanh chat.

- Sidebar rộng 220 px, collapsed 64 px; rail 256 px và chỉ hiện từ 1180 px.
- Dưới 1180 px, dữ liệu rail vẫn mở qua popup/shortcut; dưới 760 px sidebar là drawer.
- Card, popup và control dùng shared glass/control rhythm; không tạo CSS visual riêng cho Home.

## 8. Tài liệu liên quan

```text
docs/prds/feature-packs/tomni-agentic-store.md
docs/prds/feature-packs/tomni-hub-pages.md
```
