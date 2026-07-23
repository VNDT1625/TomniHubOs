# Tomni Home Hub — UI đã chốt

> Trạng thái: Đã chốt định hướng UX cơ bản  
> Ngày cập nhật: 2026-07-20

## 1. Mục tiêu

Trang Home là trung tâm điều hành của Tomni Agentic Hub, không phải giao diện chat-first.
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
│ ◈ TOMNI                    🔍 Tìm ứng dụng, workspace, prompt, model, cài đặt...                 🔔 4        │
├──────────────────────┬─────────────────────────────────────────────────────────────┬─────────────────────────┤
│                      │                                                             │ Trạng thái              │
│ ◉  Home              │                  Hôm nay bạn muốn làm gì?                  │                         │
│ ◎  Quản lý           │                                                             │ ┌──────────────────────┐│
│ ◫  Runs              │   ┌─────────────────────────────────────────────────────┐   │ │ Công việc           ││
│ ◈  Sản phẩm          │   │ 🤖 Tomni Agentic │ ● │ ◈ │ ◇ │ ◆ │ ＋             │   │ │ 5 đang thực hiện    ││
│ ◷  Lịch sử           │   ├─────────────────────────────────────────────────────┤   │ │ 2 chờ duyệt · 68%  →││
│ ⚙  Cài đặt           │   │ Tomni Agentic, gửi tin nhắn, tải tệp...            │   │ └──────────────────────┘│
│ TEAM / COMPANY     ＋ │   │                                                     │   │                         │
│ ▾ Tomni Company      │   │ ＋               ⚡ Super   cx/gpt-5.6 ▼       ➜  │   │ ┌──────────────────────┐│
│   Product Team       │   ├─────────────────────────────────────────────────────┤   │ │ Thông báo           ││
│   Security Team      │   │ □ Làm việc trong workspace ▼                       │   │ │ 4 chưa đọc          ││
│                      │   └─────────────────────────────────────────────────────┘   │ │ Browser · Chat     →││
│ WORKSPACES         ＋ │                                                             │ └──────────────────────┘│
│ ▾ AionUi             │   Apps                                             Show all ⌄│                         │
│   AI Security        │                                                             │ ┌──────────────────────┐│
│   Tomni Design       │   ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐│ │ Models              ││
│                      │   │ ◉ Chat  ◇ Mail  │ │ ◫ Studio ◇ Docs│ │ ◇ IDE    ◇ Git  ││ │ ● OpenAI            ││
│ APPS               ＋ │   │ ◇ Browser ◇ AI │ │ ◇ Video  ◇ Data│ │ ◇ Terminal ◇ Test││ │ ● Anthropic         ││
│ ◇ Chat               │   └─────────────────┘ └─────────────────┘ └─────────────────┘│ │ ◐ OpenRouter        ││
│ ◇ IDE                │     Communication        Creation          Developer Tools │ │ 7 model khả dụng  →││
│ ◇ Browser            │                                                             │ └──────────────────────┘│
│ ◇ Studio             │   Tiếp tục                                     Xem tất cả → │                         │
│ ◇ Automation         │   ┌────────────────────┐ ┌────────────────────┐ ┌───────────┐│ ┌──────────────────────┐│
│                      │   │ ◇ IDE              │ │ ◉ Chat             │ │ ◫ Studio  ││ │ Hệ thống           ││
│                      │   │ Cải tổ frontend    │ │ Phân tích Security │ │ Slide dự án││ │ CPU 34% · RAM 58%  ││
│ ＋ Store              │   │ AionUi · 18 phút  →│ │ 1 giờ trước      → │ │ Hôm qua  →││ │ GPU 21% · Queue 6  ││
│                      │   └────────────────────┘ └────────────────────┘ └───────────┘│ │ Core ổn định      →││
│ ┌──────────────────┐ │                                                             │ └──────────────────────┘│
│ │ TD  Thuận Nguyễn │ │                                                             │                         │
│ │     Duy          │ │                                                             │                         │
│ │     Plus       ⋯ │ │                                                             │                         │
│ └──────────────────┘ │                                                             │                         │
└──────────────────────┴─────────────────────────────────────────────────────────────┴─────────────────────────┘
```

## 3. Điều hướng bên trái

Thứ tự đã chốt:

1. Home
2. Quản lý
3. Runs
4. Sản phẩm
5. Lịch sử
6. Cài đặt
7. Team / Company
8. Workspaces
9. Apps
10. Store
11. Account

Không dùng nhóm “Gần đây” riêng trong sidebar. **Quản lý** thay cho **Tasks** vì Tasks chỉ là một phần của Manager hiện tại. **Sản phẩm** thay cho **Artifacts** ở lớp giao diện. Lịch sử nằm gần Sản phẩm để giữ đúng tầng thông tin của Hub.

### Team / Company

- nằm trên Workspaces;
- cho phép chuyển company hoặc team;
- có thể thu gọn;
- mỗi workspace có thể thuộc cá nhân, team hoặc company.

### Apps

- Nhóm **Apps** ở sidebar trái chỉ hiển thị các app người dùng đã ghim để truy cập nhanh.
- Ví dụ: Chat, IDE, Browser, Studio và Automation.
- **Quản lý** là trang cấp Hub nên không xuất hiện như một app Manager ghim mặc định.
- Người dùng có thể ghim, bỏ ghim và sắp xếp lại thứ tự app.
- **Store** nằm cuối nhóm app để tìm và cài thêm app hoặc package.

### Apps ở trục giữa

- Hiển thị thư viện app trực quan theo từng category, không lặp lại dạng danh sách ghim ở sidebar.
- Tiêu đề bên trái là **Apps**; bộ lọc bên phải là **Show all**.
- Mỗi category là một khung chứa nhiều biểu tượng app, ví dụ Communication, Creation và Developer Tools.
- Nhấn app để mở; nhấn category hoặc **Show all** để xem thư viện đầy đủ.
- Không dùng hàng **Ứng dụng đã ghim** riêng ở trục giữa vì app ghim đã nằm ở sidebar.

### Account

Hiển thị thu gọn giống ChatGPT:

```text
┌──────────────────┐
│ TD  Thuận Nguyễn │
│     Duy          │
│     Plus       ⋯ │
└──────────────────┘
```

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

- hàng chọn Tomni Agentic và agent nhanh;
- nhập tin nhắn hoặc tải tệp;
- nút thêm capability;
- chọn model;
- chọn workspace hoặc dự án;
- nút gửi;
- nút **Super** là hành động quan trọng và phải nổi bật.

### Apps ở trục giữa

- hiển thị thư viện app theo category bằng các khung biểu tượng trực quan;
- tiêu đề là **Apps** và bộ lọc bên phải là **Show all**;
- không lặp lại danh sách app đã ghim ở sidebar;
- nhấn app để mở, nhấn category hoặc **Show all** để xem thư viện đầy đủ.

### Tiếp tục

Chỉ hiển thị ba thẻ để giữ Home gọn trong một màn hình desktop.

```text
Tiếp tục                                                     Xem tất cả →

┌──────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────────┐
│ ◇ IDE                    │ │ ◉ Chat                   │ │ ◫ Studio                 │
│ Cải tổ frontend Tomni    │ │ Phân tích AI Security   │ │ Slide thuyết trình       │
│ AionUi · 18 phút trước  →│ │ 1 giờ trước            →│ │ Hôm qua                →│
└──────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘
```

Phần này chỉ chứa nơi người dùng có thể quay lại ngay:

- phiên IDE;
- cuộc trò chuyện;
- workspace;
- tài liệu hoặc studio session;
- công việc bị tạm dừng.

Không hiển thị agent, hàng đợi hoặc cảnh báo hệ thống tại đây.

## 6. Tab Trạng thái bên phải

Tab trạng thái gồm bốn ô chính:

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
│ Cải tổ frontend Tomni                       68%   │
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

## 8. Tài liệu liên quan

```text
docs/prds/feature-packs/tomni-agentic-store.md
docs/prds/feature-packs/tomni-hub-pages.md
```
