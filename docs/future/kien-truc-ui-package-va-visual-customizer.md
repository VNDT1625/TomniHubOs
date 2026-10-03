# Kiến trúc UI Package, Visual Customizer, Store & Package Ecosystem

**Trạng thái:** TARGET
**Mục tiêu:** Chuẩn hóa toàn bộ hệ thống giao diện TomniHubOS thành các Package UI độc lập, tối ưu bố cục Sidebar và Right Rail trực quan, xử lý triệt để lỗi Store Online fallback, và làm rõ cơ chế hoạt động của các Package App mặc định (Browser, Document Studio, Automation Studio & n8n).

---

## 1. Triết lý thiết kế & Nguyên tắc Anti-Slop (Taste-Skill)

1. **Không dùng template AI mặc định:** Loại bỏ gradient tím rực, glassmorphism bừa bãi, border quá dày hoặc các thẻ thông số rác không cần thiết.
2. **2 Package UI chuẩn mực trên Store:**
   - **Editorial Workspace (Minimalist):** Phong cách văn bản báo chí / Linear cao cấp, viền mỏng 1px, typography rõ ràng, tôn trọng không gian trắng và tập trung vào nội dung làm việc.
   - **Cyber Telemetry (Brutalist):** Phong cách trạm kỹ thuật / terminal quân sự, lưới cơ học, font monospace, hiển thị thông số telemetry chi tiết cho power user.
3. **Mỗi Package hỗ trợ 2-3 Mode:** Dark (tối), Light/Warm Paper (giấy kem sáng), và Retro/Monochrome.

---

## 2. Bố cục Giao diện Chuẩn (Layout Wireframe & Slots)

### 2.1. Cột trái (Left Sidebar)

- **Khu vực Apps (Pinned / Recent):**
  - Danh sách các ứng dụng được ghim hoặc dùng gần nhất (Browser, Document Studio, Automation Studio, Chat, Terminal).
  - Hỗ trợ nút mở rộng `(v)` cho các app có tiến trình/sub-tab đang chạy:
    - Ví dụ: Khi Browser đang mở YouTube và ChatGPT, click `(v)` sẽ xổ xuống 2 tab con để click chuyển nhanh; click trực tiếp vào Browser icon sẽ mở trang chủ Browser.
- **Khu vực Workspaces / Projects:**
  - Cấu trúc cây phân cấp: Tiêu đề thư mục Dự án / Workspace (icon thư mục).
  - Bên dưới là danh sách các cuộc trò chuyện (chat conversations) thuộc workspace đó.
  - Có nút "Show more (N)" thu gọn/mở rộng danh sách chat để không bị chiếm quá nhiều chiều dài.
  - Khi người dùng chọn vào chat nào sẽ điều hướng ngay đến phiên chat đó (`/conversation/:id`).
- **Phần đáy (Footer):**
  - Chỉ giữ lại 1 đích đến tinh gọn: **Account** (Hồ sơ, Cấp bậc & Gói sử dụng), loại bỏ hoàn toàn nút Setting thừa ở chân trang vì Setting đã có trong điều hướng chuẩn.

### 2.2. Khu vực trung tâm (Center Stage)

- Bố trí linh hoạt dưới dạng các slot cho phép cấu hình vị trí:
  - **Slot 1:** Thanh nhập chat chính (SendBox).
  - **Slot 2:** Thanh các app hành động nhanh (Quick Actions).
  - **Slot 3:** Dòng gợi ý tiếp tục (Continue Stream / Prompt Suggestions).
- Cho phép hoán đổi thứ tự hiển thị của các slot này thông qua Visual Customizer.

### 2.3. Cột phải (Right Rail / Status Rail)

Rút gọn tối ưu chỉ còn 2-3 thẻ (Card) quan trọng nhất, không gây rối mắt:

1. **Thẻ 1 - Tasks Monitor (Giám sát nhiệm vụ Agent):**
   - Tóm tắt các tác vụ mà Agent đang thực hiện trên các tab chat.
   - Hiển thị trạng thái (Running, Awaiting Approval, Finished).
   - Nút thao tác nhanh: Chấp thuận quyền (Approve Permission) hoặc Tiếp tục (Resume/Stop).
2. **Thẻ 2 - System Telemetry (Thông số hệ thống thời gian thực):**
   - Giám sát tải CPU, dung lượng RAM sử dụng / còn trống, và sức khỏe backend nội bộ.
   - Cảnh báo sớm khi RAM vượt ngưỡng để tránh tràn bộ nhớ khi chạy các agent nặng.
3. **Thẻ 3 - Usage & Environment (Token & Môi trường):**
   - Thống kê token đã tiêu thụ trong phiên hoặc widget đồng hồ/thời gian tùy chọn bởi người dùng.

---

## 3. Cơ chế Hoạt động của các Package App (Không mơ hồ)

### 3.1. Browser (`com.tomni.browser`)

- **Kiến trúc:** Chạy dựa trên WebContentsView và Webview cô lập trong Electron Main process (`packages/desktop/src/process/browser/`).
- **Tính năng:**
  - Duyệt web đa tab thực sự với lịch sử, bookmark và thanh địa chỉ URL.
  - Tích hợp AI Agent Computer-Use & Web Scraping: Cho phép Agent phân tích DOM, click, gõ văn bản theo hành vi người dùng (`humanLikeInput.ts`), chụp ảnh màn hình và trích xuất dữ liệu.

### 3.2. Document Studio / Office (`com.tomni.document-studio`)

- **Kiến trúc:** Hệ thống biên tập tài liệu văn phòng tích hợp bộ công cụ OnlyOffice connector và Markdown/RichText editor (`packages/package-apps/document-studio/`).
- **Tính năng:**
  - Chỉnh sửa trực quan các định dạng văn bản (.docx, .xlsx, .md).
  - Tích hợp AI Agent Document Tools (`docAgentTools.ts`): Hỗ trợ soạn thảo văn bản tự động, sửa lỗi ngữ pháp, tóm tắt tài liệu, và xuất PDF có cấu trúc.

### 3.3. Automation Studio (`com.tomni.automation-studio`)

- **Kiến trúc:** Workflow Engine dạng DAG (Directed Acyclic Graph) xử lý tự động hóa đa bước (`packages/desktop/src/process/automation/`).
- **Cơ chế n8n Connector (`connectors/n8n.ts`):**
  - Kết nối trực tiếp tới webhook endpoint của instance n8n (tự host hoặc cloud).
  - Hỗ trợ thay thế biến input động `{{input}}` vào payload webhook n8n, cấu hình Header Authorization, timeout tuỳ chọn và bắt lỗi HTTP trả về.
  - Khi một step trong TomniHubOS kích hoạt, nó gửi trigger sang n8n để chạy các kịch bản tự động hóa phức tạp (Google Sheets, Notion, Telegram, Slack...) rồi thu thập kết quả trả về cho workflow hoặc trả lại cho AI Agent.
- **Triggers & Executors:**
  - Triggers: Cron scheduler theo lịch trình, Webhook HTTP listener nội bộ, và Lệnh Chat trực tiếp từ người dùng.
  - Executors: Gửi Email, kết nối API REST, xử lý file/database, và gọi mô hình LLM để ra quyết định nhánh.
  - Bảo mật thông tin xác thực: Lưu trữ API Key và Token được mã hóa bằng AES-256 trong Credential Store nội bộ (`credentialStore.ts`).

---

## 4. Khắc phục Lỗi Store Online (Offline & Local Fallback)

- **Nguyên nhân gốc:** `registerPackageManagerBridge` yêu cầu `accountSession.requireOnlineSession()` khánh kiệt trên cả các hàm truy vấn cơ bản (`list`, `refresh`, `search`, `status`), dẫn đến khi chạy ở chế độ local/offline, gọi Store sẽ quăng ngoại lệ `ACCOUNT_SESSION_ONLINE_REQUIRED`.
- **Giải pháp:**
  - Cho phép tra cứu catalog và gói đã cài đặt ở chế độ local bằng cách bắt ngoại lệ unauthenticated/offline một cách an toàn.
  - Khi không kết nối được endpoint tải store từ xa hoặc mất mạng, loader tự động fallback sang `FIRST_PARTY_PACKAGE_CATALOG` chứa 3 ứng dụng cốt lõi (Browser, Document Studio, Automation Studio) không làm vỡ giao diện Store.
