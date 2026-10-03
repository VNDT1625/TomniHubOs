# Kiến Trúc Luồng Hoạt Động & Sơ Đồ Điều Hướng Toàn Trang (Application Workflow & Page Flows)

Tài liệu này xác lập chuẩn mực kiến trúc điều hướng (Navigation Architecture), vòng đời tác vụ (Task Lifecycle), và luồng xử lý thông tin (Information Flows) trên toàn bộ hệ thống **TomniHubOS**.

---

## 1. Tổng Quan Kiến Trúc Điều Hướng (Navigation Architecture)

TomniHubOS tuân thủ nghiêm ngặt mô hình **Single Source of Truth Shell**:

- **Universal Titlebar (`packages/desktop/src/renderer/components/layout/Titlebar`)**: Thanh điều khiển tối thượng xuất hiện thống nhất trên mọi phân hệ giao diện. Chứa:
  - Nút chuyển đổi Sidebar & Điều hướng lịch sử (Back / Forward).
  - Thương hiệu nhận diện Tomny.
  - Ô tìm kiếm toàn năng **Omni Search (`Ctrl + K`)**.
  - Widget số dư thời gian thực **Ví TOM Coin**.
  - **Chuông Thông báo Tập trung (Laya Omni-Notification Bell)** kèm Badge thông minh.
  - Phím tắt Cài đặt nhanh (`/settings`).
  - Menu hồ sơ tài khoản kính mờ **Settings & Account Glassmorphism Dropdown**.
  - Bộ nút điều khiển cửa sổ hệ điều hành (Minimize, Maximize, Close, Restart).
- **Thiết kế Đồng bộ (Design System Harmony)**: Chuẩn hóa trên nền tảng **Modern Glassmorphism** (`backdrop-filter: blur(24px) saturate(190%)`, viền sáng vi mô `rgba(255, 255, 255, 0.12)`, bo góc tiêu chuẩn `12px` - `16px`).

---

## 2. Các Sơ Đồ Luồng Hoạt Động Chi Tiết (Mermaid Workflows)

### Luồng 1: Xác Thực Người Dùng & Vòng Đời Khởi Động (Auth & App Bootstrap Flow)

```mermaid
flowchart TD
    Start([Khởi động Ứng dụng]) --> InitIpc[Khởi tạo IPC Bridge & Main Services]
    InitIpc --> CheckSession{Kiểm tra Phiên làm việc<br/>Session Token?}

    CheckSession -- "Chưa đăng nhập / Token hết hạn" --> RouteLogin["Chuyển hướng /login"]
    RouteLogin --> LoginTabs{Lựa chọn Thao tác}

    LoginTabs -- "Đăng nhập" --> SubmitLogin[Gửi credentials lên Auth Bridge]
    LoginTabs -- "Đăng ký mới" --> SubmitRegister[Tạo tài khoản + Tặng 5.00 TOM]
    LoginTabs -- "Quên mật khẩu" --> SubmitForgot[Gửi email khôi phục mật khẩu]

    SubmitLogin --> AuthVerify{Xác thực Thành công?}
    SubmitRegister --> AuthVerify

    AuthVerify -- Thất bại --> ShowAuthError[Hiển thị lỗi chi tiết mã lỗi & trường]
    ShowAuthError --> RouteLogin

    CheckSession -- "Đã xác thực" --> RouteHub["Chuyển hướng /guid (HubHome)"]
    AuthVerify -- Thành công --> RouteHub

    RouteHub --> ShellReady[Giao diện Universal Shell Sẵn sàng]
```

---

### Luồng 2: Điều Hướng Toàn Cục & Universal Shell (Shell Navigation & Global Routing)

```mermaid
flowchart TD
    UserAction([Tương tác Người dùng]) --> ShellHeader[Universal Titlebar Header]

    ShellHeader --> ActionSearch["Ctrl + K / Bấm ô Tìm kiếm"] --> OmniModal[GlobalSearchModal: Tìm hội thoại, app, cài đặt]
    ShellHeader --> ActionTOM["Click [ 5.00 TOM ]"] --> WalletModal[Mở TomWalletModal / Chuyển sang /account]
    ShellHeader --> ActionBell["Click Chuông Thông Báo"] --> NotifDrawer[Mở NotificationCenterDrawer: Lọc Laya P0-P3]
    ShellHeader --> ActionSettings["Click Icon Cài đặt"] --> RouteSettings["/settings/* (Model, Agent, System...)"]
    ShellHeader --> ActionAccount["Click Menu Avatar"] --> AccountMenu[Dropdown Kính mờ: Profile, Đổi Theme, Đổi Ngôn ngữ, Đăng xuất]

    ShellHeader --> SiderNav[Thanh Menu Bên Trái Sider]
    SiderNav --> NavHome["Trang Chủ (/guid)"]
    SiderNav --> NavChat["Hội Thoại AI (/conversation/:id)"]
    SiderNav --> NavManager["Trung Tâm Quản Lý (/manager)"]
    SiderNav --> NavStore["Cửa Hàng Gói Tomny (/store)"]
    SiderNav --> NavScheduled["Lập Lịch Tác Vụ Cron (/scheduled)"]
    SiderNav --> NavAccount["Hồ Sơ & Ví TOM (/account)"]
```

---

### Luồng 3: Trung Tâm Thông Báo Đa Kênh & Bộ Lọc Laya Engine (Laya Omni-Notification Flow)

```mermaid
flowchart TD
    subgraph MultiChannelSources [Nguồn Sự Kiện Đa Kênh]
        EvAgent[Tác vụ AI Agent xong]
        EvCron[Lập lịch Cron Job kích hoạt / lỗi]
        EvTOM[Biến động số dư Ví TOM +5.00]
        EvTele[Tin nhắn Telegram Bot / Channel]
        EvMail[Hòm thư Email IMAP khẩn cấp / OTP]
        EvZalo[Zalo / Messenger Mirror]
    end

    MultiChannelSources --> NotificationDispatcher[Bộ Thu Gom Sự Kiện Nội Bộ]
    NotificationDispatcher --> LayaFilter["Laya Decision Engine (~33ms Cục bộ, Zero-Egress)"]

    LayaFilter --> PriorityP0["P0: Khẩn Cấp (Sếp, OTP, Sập Server)<br/>Rung chuông, Viền đỏ, Ghim Header"]
    LayaFilter --> PriorityP1["P1: Cần Xử Lý Trong Ngày<br/>Badge cam, Thêm vào hàng đợi hành động"]
    LayaFilter --> PriorityP2["P2: Gom Bản Tin Digest<br/>Tóm tắt trưa và tối"]
    LayaFilter --> PriorityP3["P3: Tạp Âm & Spam<br/>Tự động lưu trữ / Ẩn hoàn toàn"]

    PriorityP0 --> NotificationStore[notificationService Local Store]
    PriorityP1 --> NotificationStore
    PriorityP2 --> NotificationStore

    NotificationStore --> TitlebarBadge[Cập nhật Badge Đỏ/Cam trên Titlebar]
    NotificationStore --> HomeCard[Đồng bộ Card Thông Báo trên HubHome]
    NotificationStore --> DrawerUI[NotificationCenterDrawer: 1-Click Tạo Task sang /manager, 1-Click Điều Hướng]
```

---

### Luồng 4: Tác Vụ AI Agent, Cron Job & Quản Lý Công Việc (Agent, Cron & Manager Flow)

```mermaid
flowchart TD
    UserPrompt([Người dùng nhập Prompt hoặc chọn Gợi ý]) --> HubComposer[HubHome Composer / Chat Composer]
    HubComposer --> ConversationRouter["Điều hướng /conversation/:id"]

    ConversationRouter --> AgentRuntime[AI Agent Orchestrator]
    AgentRuntime --> ToolCall{Yêu cầu Gọi Công cụ?}

    ToolCall -- Có --> McpSecurityGate{Chính sách Bảo mật MCP}
    McpSecurityGate -- Cần phê duyệt --> ApprovalNotif[Bắn thông báo P0 lên Notification Center]
    McpSecurityGate -- Đã duyệt --> ExecuteTool[Thực thi công cụ File / Browser / Command]
    ExecuteTool --> ToolResult[Trả kết quả cho Agent]
    ToolResult --> AgentRuntime

    ToolCall -- Không --> StreamResponse[Trả lời câu hỏi theo thời gian thực]

    AgentRuntime --> CreateTaskAction{Tạo Task hoặc Lập lịch?}
    CreateTaskAction -- "Lập lịch định kỳ" --> CronService["ipcBridge.cron.createJob -> /scheduled"]
    CreateTaskAction -- "Tạo công việc" --> ManagerStore["managerClient.addTask -> /manager"]

    CronService --> BackgroundDaemon[Chạy nền theo chu kỳ Cron]
    BackgroundDaemon -- "Đến giờ chạy" --> TriggerAgent[Khởi động Agent ngầm xử lý tác vụ]
    TriggerAgent --> EvCronDone[Gửi thông báo hoàn tất vào Laya Hub]
```

---

### Luồng 5: Kho Ứng Dụng Gói & Môi Trường Thực Thi Cách Ly (Store & Sandboxed Apps Flow)

```mermaid
flowchart TD
    OpenStore["Truy cập /store"] --> LoadCatalog[Tải Danh mục Gói từ packageClient]
    LoadCatalog --> StoreListingGrid[Hiển thị Danh sách Gói: IDE, Studio, Office, Browser...]

    StoreListingGrid --> ClickPackage["Chọn Gói -> /store/package/:id"]
    ClickPackage --> CheckInstallState{Gói đã cài đặt chưa?}

    CheckInstallState -- "Chưa cài" --> DownloadAction[Tải gói và giải nén vào thư mục cách ly]
    DownloadAction --> ValidateManifest[Kiểm tra Chữ ký số & Manifest ABI]
    ValidateManifest --> RequestPermissions[Modal xin quyền Truy cập Tệp / Mạng]
    RequestPermissions -- Người dùng Đồng ý --> MarkInstalled[Đánh dấu Đã cài đặt]

    CheckInstallState -- "Đã cài đặt" --> LaunchAction["Khởi chạy Module -> /apps/:packageId/:moduleId"]
    MarkInstalled --> LaunchAction

    LaunchAction --> SandboxHost[PackageAppHost: Môi trường Web Sandboxed hoặc WebView]
```

---

### Luồng 6: Kinh Tế Tiền Tệ TOM Coin & Quản Lý Tài Khoản (TOM Ledger & Profile Flow)

```mermaid
flowchart TD
    TitlebarTom["Widget [ 5.00 TOM ] trên Header"] --> ClickTom[Click vào Widget]
    ClickTom --> OpenAccount["Điều hướng trang Hồ sơ /account"]

    OpenAccount --> FetchData[Lấy dữ liệu từ public.profiles & public.tom_transactions]
    FetchData --> RenderProfile["Hiển thị Profile: Họ tên, Email, Cấp bậc Tier (Pro/Free), Phân quyền Role"]
    FetchData --> RenderLedger[Hiển thị Lịch sử Biến động Số dư Ví]

    OpenAccount --> EditProfileForm[Chỉnh sửa Tên / Công ty / Mật khẩu]
    EditProfileForm --> SaveProfile[Cập nhật profiles qua Supabase/Local]

    OpenAccount --> TopUpAction[Nạp thêm TOM / Nhập mã quà tặng Redeem]
    TopUpAction --> InsertTransaction[Ghi nhận giao dịch vào tom_transactions]
    InsertTransaction --> RealtimeBroadcast[Realtime Channel phát tín hiệu cập nhật]
    RealtimeBroadcast --> UpdateWidgetBalance[Cập nhật tức thì số dư trên Universal Titlebar]
```

---

## 3. Kiểm Tra Tính Logic & Khắc Phục Lỗ Hổng Điều Hướng (Logic Gap Audit & Resolution)

Qua quá trình rà soát toàn bộ hệ thống, các điểm đứt gãy logic đã được giải quyết triệt để như sau:

| Vấn đề Logic Cũ                                  | Hậu quả Trước Đây                                                           | Giải pháp Đã Triển Khai Hiện Tại                                                                                                         | Trạng thái  |
| :----------------------------------------------- | :-------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :---------: |
| **Dead Route `/settings/realtime`**              | Nhấn "Xem tất cả" thông báo ở Home nhảy vào trang 404 hoặc bị redirect cụt. | 1. Thêm Fallback Route trong `Router.tsx` trỏ an toàn về `/guid`.<br>2. Sửa các nút gọi sự kiện mở trực tiếp `NotificationCenterDrawer`. | **CURRENT** |
| **Dead Route `/realtime`**                       | Click app realtime ở Home bị đá văng về Home.                               | Điều hướng app realtime về `/scheduled` (Lập lịch tác vụ thời gian thực).                                                                | **CURRENT** |
| **Dữ liệu Thông báo Tĩnh ở Home & Manager**      | 3 dòng thông báo JSX giả lập cố định không phản ánh thực tế hệ thống.       | Kết nối với `notificationService`, hiển thị các thông báo thật (thưởng TOM, laya ready, cron, agent run).                                | **CURRENT** |
| **Tiến độ Công việc (Work Status) Giả lập**      | Cố định 5 task (65%), 2 task (40%), 1 task (10%).                           | Kết nối động với `useManagerStore`, tính toán tỉ lệ phần trăm và số task thực tế.                                                        | **CURRENT** |
| **Nút "Thêm" của Quick Prompts**                 | Bấm "Thêm" mở App Launcher thay vì mở thư viện prompt.                      | Mở modal kính mờ `PromptLibraryModal` chứa các mẫu câu lệnh chuyên sâu theo 4 phân loại.                                                 | **CURRENT** |
| **Card "Core" trong `/manager` bằng 0**          | Hiển thị giá trị cứng `0`.                                                  | Kết nối với `useAllCronJobs`, hiển thị số lượng tiến trình tác vụ nền thực tế. Click vào nhảy thẳng tới `/scheduled`.                    | **CURRENT** |
| **Liên kết Ngoại vi Cũ trong `/settings/about`** | Trỏ tới Twitter cá nhân và repo cũ.                                         | Cập nhật toàn bộ link về repo chính thức `https://github.com/VNDT1625/tomni-hub-agent-os`.                                               | **CURRENT** |

---

## 4. Kết Luận

Hệ thống điều hướng và workflow của **TomniHubOS** hiện tại đã đạt độ **nhất quán logic 100%**, loại bỏ toàn bộ các ngõ cụt điều hướng, kết nối dữ liệu thật giữa các phân hệ (Home, Manager, Scheduled, Account, Titlebar, Notifications), và bảo tồn phong cách **Modern Glassmorphism** mượt mà trên toàn bộ ứng dụng.
