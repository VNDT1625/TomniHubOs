# Báo cáo Khảo sát UI & Đề xuất Đột phá: Laya Omni-Channel Notification Hub

Tài liệu này gồm 2 phần chính:

1. **Báo cáo Kiểm tra Toàn diện UI (UI Functional Gaps Audit)**: Rà soát toàn bộ các trang, các icon, nút bấm và thành phần giao diện hiện đang là mockup, dữ liệu tĩnh (hardcoded), dead link hoặc chưa có chức năng thực tế trong codebase.
2. **Đề xuất Kiến trúc Đột phá: Laya Omni-Channel Notification Hub**: Phân tích chuyên sâu và thiết kế hệ thống gom cụm thông báo đa kênh (Zalo, Telegram, Facebook Messenger, ChatGPT, Email...) được lọc thông minh bằng **Laya Decision Engine** cục bộ.

---

## PHẦN 1: BÁO CÁO KHẢO SÁT TOÀN DIỆN UI & CÁC THÀNH PHẦN THIẾU CHỨC NĂNG

### Bảng tổng hợp trạng thái các trang chính (Status Table)

| Trang / Tuyến đường (Route)              | Trạng thái Chức năng | Thành phần Thiếu / Giả lập (Mockup / Dead Element)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| :--------------------------------------- | :------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trang chủ (`/guid` - HubHome)**        |     **PARTIAL**      | • Nút chuông thông báo & "Xem tất cả" trỏ về `/settings/realtime` (Route không tồn tại).<br>• Card Thông báo (Notification Card): 3 dòng thông báo mẫu cố định, không tương tác được.<br>• Card Tiến độ công việc (Work Status Card): Hardcoded 5 task, 65% cố định.<br>• App `realtime` trỏ `/realtime` (Dead route, bị redirect về `/guid`).<br>• App `music` trỏ `/music` (Bị cờ disable, redirect về `/guid`).<br>• Nút "Thêm" ở Quick Prompt: Mở All Apps thay vì mở thêm prompt templates. |
| **Universal Header (Titlebar)**          |     **CURRENT**      | • Đã hoàn thiện: Omni Search, TOM Balance, Nút Cài đặt, Menu Account Glassmorphism, Window Controls (Restart).<br>• **Khuyết điểm**: **Chưa có icon Chuông thông báo tập trung (Notification Bell)**.                                                                                                                                                                                                                                                                                            |
| **Trung tâm Quản lý (`/manager`)**       |     **PARTIAL**      | • Card "Core" trong ManagementContent: Giá trị cứng `0`.<br>• Status Rail bên phải: Card thông báo chỉ có 2 dòng text tĩnh không click được.                                                                                                                                                                                                                                                                                                                                                     |
| **Cửa hàng gói (`/store`)**              |     **CURRENT**      | • Cài đặt, gỡ bỏ, cập nhật gói Tomny: Hoạt động tốt.<br>• Gói Microsoft Store: Chỉ hỗ trợ mở link ngoài Store, chưa cài đặt tự động.                                                                                                                                                                                                                                                                                                                                                             |
| **Lịch sử (`/history`)**                 |     **CURRENT**      | • Danh sách ứng dụng gần đây: Mở ứng dụng bình thường.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Hồ sơ Người dùng (`/account`)**        |     **CURRENT**      | • Mới hoàn thành: Sửa full_name, company_name, đổi mật khẩu, hiển thị Tier/Role, Ví TOM.                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Hội thoại Chat (`/conversation/:id`)** |     **CURRENT**      | • Chat, composer, model switch, tools, MCP, PIPELINE: Hoạt động tốt.<br>• `SkillRuleGenerator` đang bị comment tạm thời trong mã nguồn.                                                                                                                                                                                                                                                                                                                                                          |
| **Lập lịch tác vụ (`/scheduled`)**       |     **CURRENT**      | • Đã hoàn thiện chức năng Cron Jobs, thêm/sửa/xóa/bật/tắt, nhưng ít liên kết điều hướng trực tiếp từ menu chính.                                                                                                                                                                                                                                                                                                                                                                                 |
| **Cài đặt Hệ thống (`/settings/*`)**     |     **PARTIAL**      | • `/settings/about`: Link "Liên hệ" còn trỏ tới Twitter của tác giả cũ (`x.com/WailiVery`) và link repo GitHub cũ (`VNDT1625/OmniAgent`).<br>• `/settings/realtime`: Không tồn tại nhưng đang được các nút thông báo cũ gọi tới.                                                                                                                                                                                                                                                                 |

---

### Chi tiết các thành phần chưa có chức năng (Deep-Dive)

#### 1. Trang Chủ (`HubHome` - `packages/desktop/src/renderer/pages/guid/HubHome/index.tsx`)

1. **Card "Thông báo" (Notifications Card ở thanh bên phải - dòng 627-657)**:
   - **Hiện trạng**: Hiển thị 3 dòng thông báo cố định:
     - _"IDE đã cập nhật (2 phút trước)"_
     - _"Hoạt động không gian làm việc (15 phút trước)"_
     - _"Yêu cầu phê duyệt quyền (28 phút trước)"_
   - **Vấn đề**: Toàn bộ là JSX tĩnh, click vào không có bất kỳ hành động nào.
   - **Nút "Xem tất cả" (`viewAll` - dòng 630)**: Gọi `onNavigate('/settings/realtime')`. Tuy nhiên, router hệ thống **hoàn toàn không có route `/settings/realtime`**, khiến người dùng bị rơi vào trang 404 hoặc bị redirect ngược lại `/guid`.
2. **Card "Tiến độ công việc" (Work Status Card - dòng 586-625)**:
   - **Hiện trạng**: Hiển thị 3 thanh tiến độ cố định:
     - Đang tiến hành: Cố định `5` công việc, thanh bar `65%`.
     - Chờ xử lý: Cố định `2` công việc, thanh bar `40%`.
     - Bị chặn: Cố định `1` công việc, thanh bar `10%`.
   - **Vấn đề**: Mockup tĩnh 100%, không đồng bộ với dữ liệu từ `managerStore` hay tác vụ Cron/Agent thực tế.
3. **Danh mục ứng dụng (`catalog.tsx`)**:
   - `realtime` (`path: '/realtime'`): Không có route khai báo trong `Router.tsx`, khi click vào bị redirect về Home.
   - `music` (`path: '/music'`): Phụ thuộc cờ `MUSIC_STUDIO_ENABLED` (hiện đang tắt), click vào bị redirect về Home.
4. **Nút "Thêm" trong Thanh gợi ý nhanh (Quick Prompts - dòng 420-427)**:
   - Label là "Thêm" (`guid.hubHome.shell.more`), nhưng khi bấm vào lại gọi `setLauncherScope('all')` (mở modal danh sách ứng dụng) thay vì mở danh sách các mẫu prompt/câu lệnh khác.

#### 2. Universal Header (Titlebar)

- **Thiếu sót trọng yếu**: Hiện tại Header đã có Tìm kiếm, Tiền TOM, Cài đặt và Menu tài khoản, nhưng **hoàn toàn thiếu Nút Thông báo (Notification Bell)**.
- Khi người dùng đang ở tab Code (`/ide`), Duyệt web (`/browser`), hay Hội thoại (`/conversation`), nếu có thông báo tác vụ Agent hoàn thành hoặc lỗi hệ thống thì không có cách nào nhận biết được.

#### 3. Trang Thông tin Ứng dụng (`/settings/about` - `AboutModalContent.tsx`)

- **Dòng 78**: Link "Liên hệ" (`settings.contactMe`) trỏ tới `https://x.com/WailiVery` (tài khoản cá nhân của tác giả mã nguồn mở upstream).
- **Dòng 63, 68, 83**: Link Wiki và Repository trỏ tới `github.com/VNDT1625/OmniAgent` cũ thay vì repo chính thức `TomniHubOS`.

---

## PHẦN 2: Ý TƯỞNG ĐỘT PHÁ - LAYA OMNI-CHANNEL NOTIFICATION HUB

### 1. Bối cảnh & Vấn đề Người dùng gặp phải (The Problem)

Người dùng thời đại 4.0 đang phải đối mặt với hội chứng **"Notification Fatigue" (Kiệt sức vì thông báo)**:

- **Quá nhiều ứng dụng độc lập**:
  - Nhắn tin công việc/cá nhân: **Zalo** (kênh số 1 tại VN), **Telegram** (nhóm công nghệ, channel cập nhật), **Facebook Messenger** (bạn bè, page khách hàng), **Discord / Slack** (team kỹ thuật).
  - Trợ lý AI: **ChatGPT**, **Claude**, **Gemini** (các tác vụ sinh văn bản dài, thông báo tạo ảnh/video, thông báo hết lượt/quota).
  - Hộp thư điện tử: **Gmail**, **Outlook** (hàng chục đến hàng trăm email tiếp thị, spam rác mỗi ngày làm trôi mất email quan trọng).
  - Nội bộ hệ thống: **TomniHubOS Agent Runs** (agent coding xong, build lỗi, cần duyệt quyền MCP, cron job chạy định kỳ).
- **Hậu quả**:
  - Liên tục bị ngắt quãng tư duy (Context Switching).
  - Nỗi sợ bỏ lỡ thông tin khẩn (FOMO) khiến người dùng phải mở từng app để kiểm tra thủ công.
  - Bỏ sót tin nhắn của người quan trọng (Sếp, khách hàng VIP, gia đình) trong một "biển" tin nhắn rác và thông báo đẩy.

---

### 2. Tầm nhìn: Laya Omni-Channel Notification Hub là gì?

**Laya Omni-Channel Notification Hub** là một trung tâm tiếp nhận, hợp nhất và tinh lọc thông báo đa kênh, được vận hành bởi mô hình AI cục bộ **Laya Decision Engine**.

```
[ Zalo ] ─────────┐
[ Telegram ] ─────┤
[ Messenger ] ────┼──► [ Local Ingestion Queue ] ──► [ Laya Decision Engine (~33ms) ]
[ ChatGPT / AI ] ─┤      (Bảo mật cục bộ trên RAM)     (Phân loại P0-P3 & Trích xuất)
[ Email / Work ] ─┤                                              │
[ Tomni Agent ] ──┘                                              ▼
                                                   [ Smart Actionable Notification Hub ]
                                                   ├── P0: Khẩn cấp / Rung chuông ngay
                                                   ├── P1: Đáng chú ý trong ngày
                                                   ├── P2: Gom bản tin (Digest)
                                                   └── P3: Tự động lọc / Ẩn tạp âm
```

### 3. Tại sao Laya Decision Engine là chìa khóa then chốt?

Nếu sử dụng các mô hình đám mây (Cloud LLM như GPT-4 hay Claude) để đọc toàn bộ tin nhắn Zalo, Email và Telegram thì sẽ gặp 2 rào cản chí mạng:

1. **Vi phạm nghiêm trọng Quyền riêng tư (Privacy & Leak Risk)**: Không người dùng nào chấp nhận gửi toàn bộ tin nhắn cá nhân, mật khẩu OTP, email ngân hàng lên máy chủ AI bên thứ ba.
2. **Chi phí và Độ trễ cực cao**: Nếu nhận 1.000 thông báo mỗi ngày, chi phí API LLM sẽ rất tốn kém và độ trễ 2-5 giây/thông báo là không thể chấp nhận được.

**Ưu thế độc bản của Laya Decision Engine trong TomniHubOS**:

- **Chạy 100% Cục bộ (Local-First)**: Xử lý trực tiếp trên CPU/GPU của máy người dùng, không một byte dữ liệu tin nhắn nào bị gửi ra ngoài (Zero Data Egress).
- **Tốc độ siêu tốc (~33ms)**: Kiến trúc non-autoregressive encoder phân loại tức thì ngay khi thông báo vừa đến.
- **Tiêu thụ tài nguyên siêu nhẹ**: Không làm nóng máy hay chậm trải nghiệm khi chạy ngầm.

---

### 4. Ma trận Phân loại 4 Cấp độ Thông minh (Laya Priority Matrix)

| Cấp độ | Tên gọi                                                | Định nghĩa & Tiêu chí Laya                                                                                                                                                                    | Hành động của Hệ thống                                                              | Ví dụ thực tế                                                                                                                                  |
| :----: | :----------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | **Khẩn cấp (Critical / Immediate)**                    | • Người gửi VIP (Sếp, Gia đình, Khách hàng lớn).<br>• Chứa từ khóa khẩn cấp: "gấp", "ngay bây giờ", "sập server", "mã OTP", "chuyển tiền".<br>• Yêu cầu phê duyệt quyền bảo mật MCP nhạy cảm. | **Đẩy thông báo âm thanh**, viền sáng nổi bật, ghim cố định trên Header.            | • Zalo: Sếp nhắn _"Gửi báo cáo tài chính gấp trước 14h"_.• Telegram: Bot báo _"Server Production CPU 99%"_.• Email: Mã xác thực ngân hàng OTP. |
| **P1** | **Cần xử lý trong ngày (Important / Action Required)** | • Yêu cầu công việc cần phản hồi trong 24h.<br>• Tác vụ Agent AI phức tạp đã chạy xong kèm kết quả.<br>• Cập nhật tiến độ dự án.                                                              | Hiển thị trong danh sách ưu tiên, **không phát chuông ngắt quãng**.                 | • Telegram: Đối tác hỏi _"Hôm nay rảnh không mình trao đổi hợp đồng"_.• Tomni: Agent hoàn thành phân tích mã nguồn 50 files.                   |
| **P2** | **Tham khảo / Cập nhật (Informational / Read Later)**  | • Tin nhắn nhóm đông người không tag trực tiếp.<br>• Bản tin công nghệ, thông báo hoàn thành cron job định kỳ.<br>• Tin mạng xã hội không gấp.                                                | **Gom lại thành Bản tin tóm tắt (Smart Digest)**, hiển thị 2 lần/ngày (Trưa & Tối). | • 15 tin nhắn từ nhóm bạn rủ đi ăn cuối tuần.• Thông báo ChatGPT vừa cập nhật tính năng mới.                                                   |
| **P3** | **Tạp âm / Spam (Noise / Auto-Filtered)**              | • Email quảng cáo, khuyến mại tiếp thị, tin nhắn rác, spam từ người lạ.                                                                                                                       | **Tự động ẩn hoàn toàn**, lưu vào hòm thư rác để kiểm tra lại khi cần.              | • Email: _"Giảm giá 50% khoá học tiếng Anh hôm nay"_.• Tin nhắn spam Zalo từ số lạ.                                                            |

---

### 5. Thiết kế Trải nghiệm Người dùng (UI/UX Concept)

#### A. Nút Chuông Thông báo trên Header (Universal Titlebar)

- Đặt tại góc phải Titlebar (cạnh ô số dư TOM).
- Có **Badge số đỏ** chỉ hiển thị số lượng tin **P0** (Khẩn cấp) và **Badge cam** cho tin **P1**. Tin rác P2/P3 không làm tăng số badge để người dùng không bị "ảo giác phân tâm".

#### B. Ngăn Kéo Kính Mờ (Glassmorphic Notification Drawer)

Khi click vào chuông, bảng điều khiển kính mờ trượt xuống với 3 tab:

1. **Tab "Tiêu điểm (Curated by Laya)"**:
   - Hiển thị bản tóm tắt 1 câu do Laya sinh ra: _"Hôm nay bạn có 2 việc gấp từ Sếp (Zalo), 1 cảnh báo server (Tele) và 1 tác vụ Agent hoàn thành. Đã tự động lọc 64 email rác."_
   - Danh sách các card thông báo P0 và P1 kèm icon xuất xứ (logo Zalo, Tele, Gmail...).
   - **Nút hành động nhanh (Quick Actions)**:
     - `[ ⚡ Trả lời nhanh ]`: Laya gợi ý 3 mẫu câu trả lời chuẩn xác, click là gửi ngay qua Zalo/Email.
     - `[ 📌 Tạo Task ]`: 1-click chuyển nội dung tin nhắn thành Task trong `/manager`.
     - `[ 👁️ Xem chi tiết ]`: Nhảy thẳng đến cuộc trò chuyện hoặc email tương ứng.
2. **Tab "Bản tin Gom cụm (Digest)"**:
   - Gom các nhóm Zalo/Telegram hàng trăm tin nhắn thành 3 gạch đầu dòng ngắn gọn.
3. **Tab "Bộ lọc & Nguồn tin (Connectors & Settings)"**:
   - Quản lý danh sách kết nối: Bật/tắt Zalo, Telegram, Email, ChatGPT.
   - Thêm người liên hệ VIP (người thân, đối tác quan trọng) để Laya luôn xếp vào P0.

---

### 6. Lộ trình Triển khai Kỹ thuật (Technical Roadmap)

#### Giai đoạn 1: Nền móng & Kênh Nội bộ + Email / Telegram (Ngay lập tức)

- **UI Header**: Thêm icon Chuông thông báo kính mờ trên `Titlebar/index.tsx`.
- **In-App Notification Center**:
  - Thu gom thông báo nội bộ: Agent Task completions, Cron Jobs triggers (`/scheduled`), Token balance alerts, MCP security approvals.
  - Xóa bỏ dead link `/settings/realtime` trên trang Home và thay bằng việc mở Notification Center thực thụ.
- **Telegram Connector**: Tích hợp Telegram Bot API webhook để nhận tin nhắn từ các channel/group được chọn.
- **Email Connector**: Tích hợp giao thức IMAP/OAuth2 (Gmail/Outlook) để đọc tiêu đề và tóm tắt email.

#### Giai đoạn 2: Laya Classifier & Smart Digest

- Tích hợp **Laya Decision Engine** để phân tích metadata và text của thông báo cục bộ.
- Xây dựng tính năng gom cụm (Clustering) và tạo bản tin tóm tắt hàng ngày.
- Bổ sung nút Quick Actions (1-click tạo task vào `/manager`, 1-click đánh dấu đã đọc).

#### Giai đoạn 3: Zalo & Mạng xã hội Đa kênh

- Xây dựng **Tomni Companion Extension** (Browser Extension) hoặc **Desktop OS Notification Mirror**:
  - Lắng nghe thông báo Zalo Web / Messenger Web mà không cần can thiệp sâu vào API riêng tư của Zalo.
  - Đồng bộ an toàn vào TomniHubOS qua local websocket an toàn (`localhost:port`).
- Hoàn thiện chế độ "Do Not Disturb thông minh" (chỉ những tin P0 được phép làm phiền khi đang code hoặc họp).

---

## Kết luận & Kiến nghị Thực thi

1. **Khắc phục ngay các lỗ hổng UI hiện tại**:
   - Gỡ bỏ mock data tĩnh trên `HubHome` (Tiến độ công việc và 3 thông báo giả).
   - Bổ sung icon Chuông thông báo trên Header và sửa các nút trỏ vào route chết `/settings/realtime`.
   - Cập nhật thông tin repo và liên hệ chính thức trong `/settings/about`.
2. **Ý tưởng Laya Omni-Channel Notification Hub**:
   - Đây là một bước đột phá lớn mang lại giá trị thực tế hàng ngày cho người dùng Việt Nam và quốc tế.
   - Việc tận dụng **Laya Engine chạy cục bộ** sẽ giải quyết triệt để bài toán bảo mật và chi phí mà các ứng dụng AI khác trên thị trường không làm được.
