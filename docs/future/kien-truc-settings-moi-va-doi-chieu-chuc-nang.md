# Kiến trúc Settings Mới & Bảng Đối chiếu Chi tiết Chức năng

**Trạng thái:** TARGET  
**Mục tiêu:** Tái cấu trúc toàn diện phân hệ Cài đặt (Settings) của TomniHubOS thành 4 Cụm lớn (L1) chuẩn mực cho AI Agent OS. Đảm bảo kế thừa 100% các tính năng cũ đang chạy, không làm mất bất kỳ mã nguồn nào, đồng thời tích hợp mượt mà các module mới (Pipeline Chat, Dual-Identity, Privacy & Security, Notification, MCP Connectors, Skills).

---

## 1. Sơ đồ Cấu trúc Tổng thể (4 Cụm Lớn & 14 Tab Con)

```text
SETTINGS
│
├── 1. [CỤM LỚN] ACCOUNT (Tài khoản & Cá nhân)
│   ├── 1.1. Profile (Hồ sơ, Danh tính Cục bộ / Đám mây & Quyền riêng tư cá nhân)
│   ├── 1.2. Billing & Usage (Gói cước, Hạn mức chi tiêu & Token tiêu thụ)
│   └── 1.3. Personal (Cá nhân hóa: Trí nhớ AI User Understanding + Kho khóa bí mật Secret Keyring)
│
├── 2. [CỤM LỚN] AI (Trí tuệ nhân tạo & Vận hành Agent)
│   ├── 2.1. AI Core (Gộp Agent Mesh/CLI Runtime + Model Provider / 9Router)
│   ├── 2.2. Customize (Gộp Assistant + Capability + MCP Connectors + Skills)
│   ├── 2.3. Pipeline Chat (Quản lý luồng kiểm duyệt & thực thi: Static AST, Sandbox Red-to-Green, Diff cap)
│   └── 2.4. Cấu hình AI (Thiết lập chuyên sâu: Context Window, Temperature, Model Fallback)
│
├── 3. [CỤM LỚN] GENERAL (Hệ thống & Ứng dụng)
│   ├── 3.1. Giao diện (Display: Theme, UI Package, Font, Bo góc, Bố cục)
│   ├── 3.2. Thông báo (Notification: Desktop Banner, Sound, Cảnh báo RAM/Token)
│   ├── 3.3. Remote (Kết nối từ xa, Tunnel, WebUI & External MCP Gateway)
│   ├── 3.4. Resource (Tài nguyên máy: CPU, RAM, Process Priority, Budget)
│   ├── 3.5. Privacy & Security (Bảo mật hệ thống: Sandbox, Egress Whitelist, Audit Log, Secret Masking)
│   └── 3.6. Cấu hình chung (Application: Ngôn ngữ, Thu phóng, Thư mục Workspace & Cache)
│
└── 4. [CỤM LỚN] OTHER (Thông tin & Giới thiệu)
    └── 4.1. About (Phiên bản app, Check Update, Electron runtime, Changelog & Giấy phép)
```

---

## 2. Chi tiết Từng Tab: Thành phần bên trong & Nguồn Mã nguồn

### CỤM 1: ACCOUNT (Tài khoản & Cá nhân)

#### 1.1. Tab `Profile`

- **Thành phần giao diện:**
  - **Hồ sơ định danh:** Avatar, Tên người dùng, Unique Machine ID (load tức thì 0ms từ local storage/SQLite).
  - **Trạng thái kết nối Đám mây:** Liên kết Supabase/OIDC. Nếu offline sẽ tự chuyển sang `Local Operator` mà không quăng lỗi hay timeout.
  - **Section Privacy & Data Cá nhân:**
    - Công tắc _Model Training Opt-out_ (chặn thu thập dữ liệu chat để huấn luyện AI).
    - Lựa chọn chế độ lưu trữ: _Thuần máy cục bộ (Local Only)_ vs _Đồng bộ hóa đám mây (Cloud Sync)_.
    - Nút _Xuất dữ liệu cá nhân (.zip)_.
    - _Danger Zone:_ Xóa sạch lịch sử chat cá nhân hoặc Đăng xuất khỏi mọi thiết bị.
- **Mã nguồn liên quan:** `packages/desktop/src/renderer/pages/settings/PersonalSettings.tsx`, `packages/desktop/src/process/services/security/accountSession/`.

#### 1.2. Tab `Billing & Usage`

- **Thành phần giao diện:**
  - Thông tin gói đăng ký (Free / Community / Pro Developer).
  - Thanh đo hạn mức Token đã dùng trong tháng (Prompt tokens vs Completion tokens).
  - Đặt trần ngân sách chi tiêu an toàn (Spending Cap per month) để chống lặp vô tận.
  - Bảng kê chi tiết lượng token tiêu thụ theo từng Agent/Model.
- **Mã nguồn liên quan:** `packages/desktop/src/renderer/pages/settings/ModelConsumerPanel.tsx` (phần quota, replay, token tracking).

#### 1.3. Tab `Personal`

- **Thành phần giao diện:**
  - **Trí nhớ AI (User Understanding / Causal Context):** Hiển thị danh sách các sự thật và thói quen AI đã học được về bạn. Có nút [Sửa], [Xóa], [Ghim].
  - **Kho Khóa Bí mật (Secret Keyring):** Quản lý các API Keys cá nhân (OpenAI, Anthropic, Gemini, Groq, n8n webhook token) được mã hóa AES-256 trên máy.
- **Mã nguồn liên quan:** `PersonalSettings.tsx` (tab Memory/Understanding) + `packages/desktop/src/process/automation/credentialStore.ts`.

---

### CỤM 2: AI (Trí tuệ nhân tạo & Vận hành Agent)

#### 2.1. Tab `AI Core`

- **Thành phần giao diện:**
  - **Phần trên (Model Providers):** Quản lý kết nối model (9Router, Ollama, LM Studio, vLLM, OpenAI, Claude). Nút _Quét nhanh Model (Auto-detect)_.
  - **Phần dưới (Agent Mesh & CLI Detection):** Hiển thị trạng thái các CLI Agent cục bộ (Claude Code, OpenClaw, Nanobot, ACP adapter), trạng thái socket IPC.
- **Mã nguồn liên quan:** `packages/desktop/src/renderer/pages/settings/router9/Router9ConnectorPanel.tsx`, `AgentSettings/LocalAgents.tsx`, `ModelSettings`.

#### 2.2. Tab `Customize` (Gộp Assistant + Capability + MCP Connectors + Skills)

- **Thành phần giao diện:** Chia thành 4 section dọc hoặc sub-tabs:
  1. **Assistants:** Danh sách trợ lý chuyên biệt, chỉnh sửa system prompt, avatar, model mặc định.
  2. **Capabilities:** Cấp quyền cho AI (duyệt web browser, đọc/ghi filesystem, chạy lệnh terminal).
  3. **MCP Connectors:** Quản lý kết nối MCP (GitHub, SQLite, Postgres, Notion, Filesystem).
  4. **Skills Hub:** Thư viện kỹ năng mẫu (TDD testing, refactor, code review, taste-skill).
- **Mã nguồn liên quan:** `AssistantSettings/`, `CapabilitiesSettings.tsx`, `ToolsSettings/ExternalMcpGatewaySettings.tsx`, `SkillsHubSettings.tsx`.

#### 2.3. Tab `Pipeline Chat`

- **Thành phần giao diện:** Quản lý luồng bảo vệ code nhiều tầng cho Agent:
  - **Tầng 1 (Static Guardrail):** Bật/tắt kiểm tra cú pháp AST, chặn ảo giác thư viện (slopsquatting), ép type-check nghiêm ngặt.
  - **Tầng 2 (Sandboxed Testing):** Bật/tắt quy trình Red-to-Green bắt buộc trong môi trường container/sandbox.
  - **Tầng 3 (Diff & Regression):** Giới hạn số dòng thay đổi trên mỗi lần sửa (<= 60 dòng), khóa tính bất biến của test case.
  - **Tầng 4 (Dual-Model Verifier):** Agent thẩm định độc lập review git diff trước khi apply patch, tự rollback tối đa 3 lần.
- **Mã nguồn liên quan:** Tích hợp pipeline guardrail kiến trúc mới vào luồng chat execution.

#### 2.4. Tab `Cấu hình AI`

- **Thành phần giao diện:**
  - Độ dài ngữ cảnh (Context Window limit), Ngưỡng sáng tạo (Temperature, Top-P).
  - Thời gian chờ phản hồi luồng (Stream timeout).
  - Model dự phòng (Fallback Model) khi mất kết nối mạng.
- **Mã nguồn liên quan:** `packages/desktop/src/renderer/pages/settings/ModeSettings.tsx`.

---

### CỤM 3: GENERAL (Hệ thống & Ứng dụng)

#### 3.1. Tab `Giao diện` (Display)

- **Thành phần giao diện:**
  - Chọn UI Package: _Editorial Workspace (Minimalist)_ hoặc _Cyber Telemetry (Brutalist)_.
  - Chọn Mode: _Dark / Light Warm Paper / Retro Monochrome_.
  - Visual Customizer: Chỉnh phông chữ (Font Sans/Mono), bo góc Radius, màu nhấn Accent.
  - Bố cục Slots trang chủ: Đảo vị trí SendBox, ẩn/hiện Tasks Monitor và System Telemetry.
- **Mã nguồn liên quan:** `DisplaySettings/CssThemeSettings.tsx`.

#### 3.2. Tab `Thông báo` (Notification)

- **Thành phần giao diện:**
  - Công tắc bật/tắt thông báo màn hình (Desktop OS Banner) và âm thanh khi Agent hoàn thành tác vụ.
  - Popup cảnh báo khẩn cấp: Yêu cầu cấp quyền thực thi (Permission Prompt).
  - Cảnh báo tài nguyên: Báo động khi RAM > 85% hoặc token sắp hết.
  - Chế độ Không làm phiền (Quiet Hours).
- **Mã nguồn liên quan:** `packages/desktop/src/process/bridge/notificationBridge.ts`.

#### 3.3. Tab `Remote`

- **Thành phần giao diện:**
  - Cấu hình WebUI Bridge cho truy cập trình duyệt từ xa.
  - Quản lý Secure Tunnel (ngrok, cloudflare tunnel, telegram remote bot).
  - Danh sách cổng loopback listener.
- **Mã nguồn liên quan:** `WebuiSettings.tsx`, `packages/desktop/src/process/bridge/webuiBridge.ts`.

#### 3.4. Tab `Resource`

- **Thành phần giao diện:**
  - Đồ thị thời gian thực CPU và RAM (Live Sparklines & Gauges).
  - Bảng danh sách tiến trình nền (Process Table) và gán mức ưu tiên (Process Priority Level).
  - Giới hạn tài nguyên phần cứng cho các background agents.
- **Mã nguồn liên quan:** `ResourceSettings/system/SystemInsightPanel.tsx`, `ResourceDashboard.tsx`.

#### 3.5. Tab `Privacy & Security`

- **Thành phần giao diện:**
  - **Chế độ Hộp cát (Execution Sandbox):** Tùy chọn YOLO Mode (tự động chạy) vs Giám sát nghiêm ngặt (hỏi trước khi chạy lệnh shell).
  - **Giám sát Mạng Egress (Whitelist):** Danh sách các domain và IP được phép gọi ra internet từ Agent, Browser và n8n.
  - **Che giấu Dữ liệu Nhạy cảm (Secret Masking):** Regex tự động che mờ chuỗi khóa bí mật trước khi gửi tới API.
  - **Nhật ký Kiểm toán (Audit Trail):** Tra cứu lịch sử các file bị Agent đọc/sửa trên máy.
- **Mã nguồn liên quan:** `packages/desktop/src/process/services/security/semanticEgressGuard.ts`.

#### 3.6. Tab `Cấu hình chung` (Application)

- **Thành phần giao diện:**
  - Cài đặt ngôn ngữ (Tiếng Việt, English, v.v.).
  - Tỷ lệ thu phóng giao diện (Zoom factor: 80% - 150%).
  - Đường dẫn thư mục lưu trữ: Workspace mặc định, Log directory, Cache directory.
  - Khởi động cùng hệ điều hành & Quản lý phím tắt toàn cục.
- **Mã nguồn liên quan:** `SystemSettings.tsx`, `SystemModalContent`.

---

### CỤM 4: OTHER (Thông tin & Giới thiệu)

#### 4.1. Tab `About`

- **Thành phần giao diện:**
  - Logo TomniHubOS, phiên bản hiện tại (App Version).
  - Nút _Kiểm tra Cập nhật (Check for Updates)_.
  - Thông tin môi trường: Electron version, Chromium, Node.js, V8 engine.
  - Nhật ký thay đổi (Release Notes / Changelog) & Giấy phép mã nguồn mở (Open Source Licenses).
- **Mã nguồn liên quan:** `packages/desktop/src/renderer/pages/settings/SystemSettings.tsx` (About section).

---

## 3. Bảng Đối chiếu Chi tiết (Mapping Setting Cũ vs Setting Mới)

| Chức năng ở Setting Cũ                    | Vị trí Cũ                 | Vị trí Mới                                    | Tình trạng               | Tính năng Mới được Bổ sung Thêm                                                          |
| :---------------------------------------- | :------------------------ | :-------------------------------------------- | :----------------------- | :--------------------------------------------------------------------------------------- |
| **Hồ sơ tài khoản & Đăng nhập**           | `personal` (chung chung)  | `ACCOUNT -> Profile`                          | **Kế thừa & Nâng cấp**   | Phân định Local Identity (0ms) vs Cloud Sync, không còn timeout khi offline.             |
| **Quyền riêng tư cá nhân**                | Nằm lẫn trong personal    | `ACCOUNT -> Profile` (Section Privacy & Data) | **Kế thừa & Nâng cấp**   | Thêm công tắc Opt-out Model Training, Xuất bản sao lưu dữ liệu cá nhân (.zip).           |
| **Token, Model Quota, Billing**           | `ModelConsumerPanel`      | `ACCOUNT -> Billing & Usage`                  | **Kế thừa & Nâng cấp**   | Thêm trần chi tiêu an toàn (Spending Cap per month), thống kê burn rate trực quan.       |
| **AI Memory (User Understanding)**        | `personal`                | `ACCOUNT -> Personal` (Tab con Trí nhớ)       | **Kế thừa**              | Minh bạch hóa danh sách trí nhớ, cho phép ghim, sửa, xóa từng mẩu dữ liệu đã học.        |
| **API Keys, Secret Keyring**              | Nằm lẫn trong setting API | `ACCOUNT -> Personal` (Tab con Kho khóa)      | **Kế thừa & Gom cụm**    | Gom toàn bộ API key cá nhân và token n8n về một kho bảo mật duy nhất.                    |
| **Model Provider (9Router, API)**         | `model`                   | `AI -> AI Core` (Section trên)                | **Kế thừa & Nâng cấp**   | Nút quét tự động phát hiện model 9Router tức thì (<100ms), không làm treo trang.         |
| **Agent CLI (Claude, OpenClaw)**          | `agent`                   | `AI -> AI Core` (Section dưới)                | **Kế thừa & Gom cụm**    | Gộp Model + Agent vào 1 màn hình để thấy ngay Agent đang chạy trên Model nào.            |
| **Assistant Presets (Tính cách, Prompt)** | `assistants`              | `AI -> Customize` (Tab Assistants)            | **Kế thừa**              | Tải ngay lập tức từ SQLite local, không phụ thuộc vào kết nối 9Router.                   |
| **Năng lực hệ thống (Filesystem, Web)**   | `capabilities`            | `AI -> Customize` (Tab Capabilities)          | **Kế thừa**              | Phân quyền chi tiết cho từng tác vụ (Đọc, Ghi, Bash, Computer-Use).                      |
| **MCP Connectors (Tools bên ngoài)**      | `tools` / `capabilities`  | `AI -> Customize` (Tab MCP Connectors)        | **Kế thừa & Chuẩn hóa**  | Quản lý kết nối MCP Servers theo chuẩn giao thức mới, thêm nút Add MCP nhanh.            |
| **Skills Hub (Kịch bản kỹ năng)**         | `skills-hub`              | `AI -> Customize` (Tab Skills)                | **Kế thừa**              | Tích hợp Taste-skill và thư viện prompt kỹ thuật chuyên sâu.                             |
| **Pipeline Guardrail (Kiểm duyệt code)**  | _Chưa có chỗ đặt_         | `AI -> Pipeline Chat`                         | **MỚI 100%**             | Bổ sung đầy đủ 4 tầng: AST check, Sandbox Red-to-Green, Diff limit, Dual-Model Verifier. |
| **Cấu hình tham số AI (Temp, Context)**   | `mode`                    | `AI -> Cấu hình AI`                           | **Kế thừa**              | Bổ sung cấu hình Fallback Model khi mất mạng.                                            |
| **Theme, CSS, Giao diện**                 | `display`                 | `GENERAL -> Giao diện`                        | **Kế thừa & Nâng cấp**   | Tích hợp 2 UI Package (Editorial / Cyber) + Visual Customizer + Bố cục Slots.            |
| **Trung tâm Thông báo**                   | Nằm rải rác               | `GENERAL -> Thông báo`                        | **MỚI & Gom cụm**        | Quản lý âm thanh, banner, popup hỏi quyền và cảnh báo tràn RAM (>85%).                   |
| **Remote WebUI & Tunnel**                 | `webui`                   | `GENERAL -> Remote`                           | **Kế thừa**              | Đổi tên trực quan thành Remote, quản lý tunnel và truy cập từ xa.                        |
| **System Insight (CPU, RAM, Priority)**   | `resource`                | `GENERAL -> Resource`                         | **Kế thừa**              | Giữ nguyên toàn bộ đồ thị Sparkline, Gauge và bảng Process Table.                        |
| **Bảo mật Sandbox, Egress Network**       | Nằm trong code backend    | `GENERAL -> Privacy & Security`               | **MỚI 100% trên UI**     | Đưa cấu hình Sandbox (YOLO mode), Egress Whitelist, Audit log lên giao diện người dùng.  |
| **Ngôn ngữ, Zoom, Thư mục App**           | `system`                  | `GENERAL -> Cấu hình chung`                   | **Kế thừa**              | Giữ nguyên bộ chọn i18n, thanh trượt zoom và đường dẫn thư mục log/cache.                |
| **About, Update, License**                | Nằm trong system          | `OTHER -> About`                              | **Kế thừa & Tách riêng** | Tách riêng thành cụm Other chuẩn desktop app, có nút Check Update và thông số runtime.   |

---

## 4. Kết luận Đảm bảo

- **Không mất bất kỳ chức năng cũ nào:** Tất cả các view cũ (`PersonalSettings`, `ModelConsumerPanel`, `AssistantSettings`, `CapabilitiesSettings`, `CssThemeSettings`, `ResourceSettings`, `SystemSettings`, `WebuiSettings`) đều được kế thừa nguyên vẹn hoặc tái cấu trúc thành các sub-components gọn gàng hơn.
- **Giải quyết triệt để 3 bug cũ:**
  1. _Hết thời gian tải Profile (Timeout):_ Tách biệt Local Operator load 0ms khỏi Cloud Auth.
  2. _9Router không thấy model:_ Luồng quét model chạy độc lập, không block UI khi tải setting.
  3. _Thiếu chỗ đặt Pipeline Chat:_ Có hẳn một tab riêng `AI -> Pipeline Chat` kiểm soát 4 tầng guardrail.
