# Kiến trúc Remote Telegram & Thiết kế Điều khiển Laptop bằng Giọng nói (Voice-to-Agent)

> **Tài liệu Tham chiếu Kỹ thuật TomniHubOS**  
> **Trạng thái:** CURRENT (Telegram Remote Text Channel) / TARGET (Voice STT & Laptop OS Control)  
> **Chủ đề:** Điều khiển từ xa an toàn qua Telegram Bot, chuyển đổi Voice-to-Text (STT) và thực thi lệnh Agent trên hệ điều hành cục bộ.

---

## 1. Hiện trạng Kiến trúc Remote Telegram (CURRENT)

Hệ thống Remote Telegram của TomniHubOS hiện tại được xây dựng hoàn toàn ở **Electron Main Process**, tuân thủ nguyên tắc Least Privilege, mã hóa kho khóa bí mật và kiểm soát luồng xuất dữ liệu (Egress Authority).

### 1.1. Các tệp tin cấu thành cốt lõi

| Tệp tin                                                                                                    | Trách nhiệm kiến trúc                                                                                                                                                                                          |
| :--------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/src/process/services/telegram/service.ts`                                                | **Core Service**: Quản lý vòng đời bot, long polling (`getUpdates`), bắt tay xác thực người dùng (Pairing OTP), quản lý phiên làm việc (`IChannelSession`), forward tin nhắn hai chiều giữa Telegram và Agent. |
| `packages/desktop/src/process/services/telegram/bridge.ts`                                                 | **IPC Bridge**: Đăng ký các kênh IPC (`telegramChannel.*`) kết nối an toàn giữa Electron Main và Renderer UI Settings.                                                                                         |
| `packages/desktop/src/process/startup/telegramRemoteStartup.ts`                                            | **Startup Lifecycle**: Khởi động nền bot service khi app chạy, lắng nghe thay đổi ngôn ngữ i18n, quản lý tunnel/egress network.                                                                                |
| `packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/TelegramConfigForm.tsx` | **UI Configuration**: Form nhập Bot Token, giao diện duyệt/từ chối mã ghép nối (Pairing Code), danh sách người dùng được cấp phép, cấu hình Model và Agent chỉ định cho Telegram.                              |

---

### 1.2. Cơ chế Bảo mật Đa tầng Hiện tại

1. **Kho khóa bí mật (Secret Vault):**
   - Telegram Bot Token **không bao giờ** lưu dưới dạng plaintext trong database hay file cấu hình thông thường.
   - Token được mã hóa và lưu trữ thông qua `deps.vault.put`:
     ```ts
     const secret = await this.deps.vault.put(
       {
         label: 'Telegram Bot Token',
         kind: 'token',
         fields: ['token'],
         binding: { surfaces: ['telegram'], purposes: ['telegram-bot'], targets: ['telegram'] },
       },
       { token: normalizedToken }
     );
     ```
   - Renderer chỉ nhận một opaque handle (`hasToken: boolean`), không thể đọc lén token qua console hay DevTools.

2. **Chốt chặn Egress mạng cục bộ (`isExternalAuthorityGranted`):**
   - Mọi kết nối ra máy chủ Telegram (`api.telegram.org`) đều phải đi qua hàm kiểm tra `requireExternalAuthority()`.
   - Nếu người dùng chưa cấp quyền kết nối internet bên ngoài, hoặc người dùng ngắt kết nối (Revoke), polling ngắt ngay lập tức bằng `AbortController`.

3. **Quy trình ghép nối Human-in-the-Loop (Pairing Code Handshake):**
   - Người dùng lạ gửi tin nhắn tới Telegram Bot sẽ **không được phản hồi trực tiếp**.
   - Hệ thống tự sinh mã OTP ngẫu nhiên 6 chữ số (`randomInt(100_000, 1_000_000)`) có hạn 10 phút.
   - Bot gửi mã về Telegram: _"Pairing code: XXXXXX. Approve it in Tomny settings."_
   - Đồng thời, Main process bắn sự kiện IPC `pairingRequested` lên giao diện Desktop. Chỉ khi chủ sở hữu máy tính ấn **Chấp thuận (Approve)** trên màn hình laptop, người dùng Telegram đó mới được lưu vào danh sách trắng (`state.users`).

4. **Cô lập ngữ cảnh Workspace & Session:**
   - Mỗi người dùng Telegram được ánh xạ tới một cuộc trò chuyện (`conversation`) độc lập trên máy tính.
   - Phiên làm việc được ràng buộc với workspace thư mục đang hoạt động của người dùng, kế thừa toàn bộ cấu hình Agent (Codex / ACP / TomnyAgentic) và model đã cấu hình.

---

### 1.3. Luồng xử lý tin nhắn hiện tại (Text Flow)

```
[Telegram User]
       │ (Gửi văn bản qua chat Telegram)
       ▼
[Telegram Servers: api.telegram.org]
       │
       ▼ (Long polling: getUpdates)
[TelegramChannelService.poll]
       │
       ├── Chưa ghép nối? ──► Tạo Pairing Code 6 số ──► Gửi code cho User & Bắn IPC lên Desktop
       │
       └── Đã cấp quyền (Authorized)
              │
              ▼
       [Tìm hoặc Khởi tạo Session gắn với Workspace]
              │
              ▼
       [deps.conversations.send({ conversation_id, input: text })]
              │
              ▼
       [Laya Security Pipeline & AST Guardrails]
              │
              ▼
       [Agent Core / Tools thực thi lệnh]
              │
              ▼ (turnCompleted Event)
       [Lấy câu trả lời cuối cùng từ repository]
              │
              ▼ (sendMessage API)
       [Telegram Bot gửi kết quả phản hồi về điện thoại người dùng]
```

> **Điểm nghẽn hiện tại trong mã nguồn:**  
> Trong `TelegramChannelService.handleUpdate`:
>
> ```ts
> const message = update.message;
> const user = message?.from;
> const text = message?.text?.trim();
> if (!message || !user || !text) return; // <-- Bỏ qua nếu tin nhắn là Voice/Audio
> ```
>
> Do đó, hiện tại bot chỉ nhận tin nhắn text thuần túy. Mọi voice note (`message.voice`) đều bị bỏ qua.

---

## 2. Tính khả thi của tính năng: Gửi Voice -> Dịch thành Chữ -> Điều khiển Laptop

### **Kết luận: HOÀN TOÀN KHẢ THI VÀ RẤT PHÙ HỢP**

Hệ thống TomniHubOS đã có đầy đủ nền tảng để hiện thực hóa tính năng này chỉ với 3 mắt xích cần bổ sung:

1. Tiếp nhận payload âm thanh từ Telegram API (`message.voice`).
2. Bộ giải mã âm thanh & Chuyển đổi giọng nói thành văn bản (Speech-to-Text - STT).
3. Đưa văn bản nhận dạng được vào pipeline Agent với bộ công cụ điều khiển hệ điều hành (Laptop Control MCP/OS tools).

---

## 3. Kiến trúc Kỹ thuật Đề xuất (TARGET Design)

### 3.1. Luồng xử lý End-to-End

```
[Người dùng giữ mic nói trên Telegram]
           │
           ▼
[Telegram gửi Update chứa message.voice]
           │
           ▼
[TelegramChannelService.handleUpdate]
           │
           ├── Phát hiện message.voice hoặc message.audio
           │
           ▼
[Tải tệp âm thanh qua Telegram Bot API]
   1. Gọi getFile(file_id) -> Lấy file_path (định dạng .oga / opus)
   2. Download stream nhị phân từ https://api.telegram.org/file/bot<token>/<file_path>
           │
           ▼
[Bộ chuyển đổi Speech-to-Text (STT Module)]
   ├── Hướng Cục bộ (Local Zero-Egress): Whisper.cpp / Sherpa-ONNX nhúng trong App
   └── Hướng API (Cloud Provider): OpenAI Whisper / Groq Whisper API (~300ms)
           │
           ▼
[Nhận chuỗi văn bản (Transcript): "Mở Chrome kiểm tra email công việc"]
           │
           ├── (Tùy chọn) Gửi tin nhắn phản hồi Telegram: "🎙️ Đã nhận lệnh: Mở Chrome..."
           │
           ▼
[NativeConversationService.send]
           │
           ▼
[Laya Decision Engine & Intent Classifier]
   ├── Phân loại: Tác vụ điều khiển hệ thống (System Action)
   └── Kiểm tra danh sách đen / Lệnh rủi ro cao (Egress & Destruction Safety Check)
           │
           ▼
[Agent Thực thi công cụ điều khiển Laptop]
   ├── Desktop MCP Tools (Quản lý cửa sổ, bàn phím, chuột, mở ứng dụng)
   ├── Terminal/Process Execution (Chạy PowerShell/Bash trong sandbox an toàn)
   └── System Metrics (Đọc tình trạng RAM, CPU, pin, nhiệt độ máy)
           │
           ▼
[Gửi thông báo kết quả & Ảnh chụp màn hình (Screenshot) về Telegram]
```

---

### 3.2. Chi tiết 2 phương án công nghệ Speech-to-Text (STT)

#### Phương án A: Cloud STT (Khuyến nghị cho giai đoạn 1 - Nhanh, chuẩn tiếng Việt, không tốn tài nguyên máy)

- **Cơ chế:** Sử dụng Groq Whisper API (`whisper-large-v3`) hoặc OpenAI Whisper API.
- **Tốc độ:** Groq xử lý 1 đoạn voice 10 giây chỉ mất khoảng **200ms - 400ms**.
- **Độ chính xác tiếng Việt:** Đạt trên 98%, xử lý tốt tiếng Việt có dấu, tiếng lóng kỹ thuật, câu lệnh mixed Anh-Việt.
- **Tích hợp:** Khóa API Key được lưu trực tiếp trong `SecretVault` có sẵn của Tomny.
- **Chi phí:** Groq cung cấp hạn mức miễn phí rất lớn; OpenAI có chi phí cực rẻ ($0.006 / phút âm thanh).

#### Phương án B: Local Offline STT (Khuyến nghị cho chế độ Bảo mật cao - 100% Cục bộ)

- **Cơ chế:** Nhúng thư viện `node-whisper` hoặc binary `whisper.cpp` / ONNX model nhỏ gọn (`whisper-base` hoặc `whisper-small`).
- **Ưu điểm:** Không cần kết nối internet ra ngoài cho việc dịch voice, bảo mật âm thanh riêng tư tuyệt đối của chủ nhân.
- **Tài nguyên:** Chiếm khoảng 200MB - 400MB RAM khi load model; CPU máy tính i5/Ryzen hoặc GPU RTX 3050 xử lý mất khoảng 1 - 2 giây.

---

### 3.3. Bộ công cụ Điều khiển Laptop từ xa (Laptop / OS Control Tools)

Khi Agent nhận được câu lệnh chữ sau khi dịch giọng nói, Agent sử dụng các công cụ sau để thao tác với laptop:

1. **Quản lý ứng dụng & Cửa sổ:**
   - Mở ứng dụng chỉ định: `openApp(appName: "chrome" | "vscode" | "spotify" | ...)`.
   - Đóng ứng dụng / Kill process treo.
   - Thu nhỏ, phóng to cửa sổ màn hình.

2. **Truy vấn trạng thái máy tính (System Telemetry):**
   - Báo cáo % pin, nhiệt độ CPU, dung lượng RAM còn trống.
   - Báo cáo tiến độ download tệp hoặc tiến độ build code đang chạy dở trên máy.

3. **Chụp ảnh màn hình từ xa (Remote Screenshot Verification):**
   - Agent gọi tool chụp ảnh màn hình Desktop (`desktopCapturer` của Electron).
   - Gửi ảnh chụp màn hình trực tiếp về chat Telegram để người dùng nhìn thấy laptop đang hiển thị gì mà không cần ngồi trước màn hình.

4. **Tương tác tệp tin & Git:**
   - Đọc nội dung tệp, tìm kiếm tệp theo tên.
   - Commit & push code lên GitHub từ xa.

---

## 4. Chốt chặn An toàn Cần thiết (Safety Guardrails)

Việc điều khiển máy tính qua giọng nói từ xa tiềm ẩn rủi ro nếu nhận diện sai chữ (mishearing) hoặc bị kẻ xấu lợi dụng. Cần áp dụng nghiêm ngặt các nguyên tắc sau:

1. **Chặn lệnh hủy diệt (Destructive Command Firewall):**
   - Các câu lệnh như: `rm -rf *`, `Format-Volume`, xóa ổ đĩa, tắt nguồn máy (`shutdown`), đổi mật khẩu hệ điều hành... **tuyệt đối không được tự động chạy** từ kênh voice remote.
   - Laya Decision Engine sẽ gắn cờ `HIGH_RISK_ACTION` và từ chối thực thi nếu không có xác nhận vật lý.

2. **Xác nhận 2 bước qua Telegram Inline Buttons (Two-Factor Confirmation):**
   - Với các hành động nhạy cảm (ví dụ: _"Gửi email cho sếp"_, _"Xóa thư mục dự án cũ"_, _"Chạy script cập nhật database"_):
   - Agent không chạy ngay mà gửi tin nhắn Telegram kèm nút bấm:
     ```
     ⚠️ [Cảnh báo an toàn]
     Bạn có chắc muốn thực hiện: "Xóa thư mục C:/Project/OldBuild"?
     [✅ Xác nhận thực hiện]   [❌ Hủy bỏ]
     ```
   - Chỉ khi người dùng bấm nút `[Xác nhận thực hiện]` trên Telegram thì Agent mới tiến hành gọi Tool.

3. **Độ dài và định dạng tệp âm thanh (Rate Limit & File Sanitation):**
   - Giới hạn thời lượng voice tối đa: **60 giây/lần**.
   - Kiểm tra định dạng tệp trước khi gửi sang STT để tránh các tấn công chèn mã khai thác buffer overflow.

---

## 5. Lộ trình Triển khai Đề xuất (Roadmap)

- **Bước 1 (Mở rộng Update Handler):**
  - Cập nhật `TelegramChannelService.handleUpdate` để nhận diện `update.message.voice` và `update.message.audio`.
  - Triển khai hàm `downloadTelegramFile(file_id: string): Promise<Buffer>`.
- **Bước 2 (Tích hợp STT Engine):**
  - Xây dựng module `processAudioToText(audioBuffer: Buffer): Promise<string>`.
  - Cấu hình tùy chọn: Ưu tiên Cloud STT (Groq/OpenAI) với fallback Local Whisper.
- **Bước 3 (Tích hợp Laptop Control Tools):**
  - Cung cấp gói Tool MCP cơ bản cho Agent: `system.get_metrics`, `system.take_screenshot`, `app.launch`, `shell.execute_safe`.
- **Bước 4 (Phản hồi Ảnh & Inline Buttons trên Telegram):**
  - Mở rộng `sendTelegram` để hỗ trợ gửi ảnh (`sendPhoto`) và nút bấm xác nhận (`InlineKeyboardMarkup`).
