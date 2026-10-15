# Social Hub — Yêu cầu bàn giao

## 1. Vị trí và độ tin cậy của tài liệu

- Ngày đối chiếu: 2026-10-15; HEAD: `4cf2b27113654ad10869297669d19e32ce8afdce`.
- Đối tượng đối chiếu là worktree đang sửa, không phải nội dung thuần của commit hoặc bản phát hành.
- Đây là đặc tả bàn giao được người dùng cho phép đặt dưới `docs/plan/social/`, phụ thuộc tài liệu canonical, không thay thế chính sách hay master plan.
- Nguồn chuẩn: `docs/README.md`, `docs/superpowers/specs/2026-10-09-social-hub-design.md`, `docs/architecture/target.md`, `docs/platform/packages.md`, `docs/engineering/testing-and-release.md`.
- `ky-thuat.md` mô tả hợp đồng và rủi ro; `tasks.md` là cây công việc nghiệm thu của cùng phạm vi.
- CURRENT ở đây nghĩa là đã đọc đường mã cụ thể. Test được đọc là bằng chứng về ý định/assertion, không phải kết quả chạy.
- PARTIAL nghĩa là đã có một phần nhưng chưa đủ hành trình hoặc chứng cứ release; TARGET là phần cần xây; BLOCKED luôn kèm phụ thuộc cụ thể.
- Không chạy build, test, lint, sinh i18n hay đăng nhập provider trong đợt kiểm toán này.
- Chỉ ô nguyên tử có bằng chứng đọc mã được đánh dấu; mục tiêu tổng thể vẫn chưa hoàn tất.

## 2. Mục tiêu sản phẩm và ranh giới

Social cung cấp bốn hành trình: đọc Feed, xem Reels, xem/trả lời Messenger và quản lý tài khoản/quyền/cache.
Đích là nhiều tài khoản trên cùng nền tảng, dữ liệu cục bộ, giữ nội dung chưa xem và thao tác có quyền rõ ràng.
Không có cross-posting trong phạm vi này.
Không suy ra quyền API từ cookie, tên người dùng, việc cửa sổ đăng nhập mở thành công hoặc việc trang mạng xã hội hiển thị.
Không quảng bá sáu nền tảng có giao diện chọn là sáu connector đang hoạt động.
UI trực tiếp nằm trong desktop hiện là hiện trạng; ranh giới phân phối optional app phải được Integrator quyết định theo canonical package trước khi mở rộng.
Không dùng bàn giao này để cấp ngoại lệ đưa connector, worker, database riêng của optional app vào trusted base.

## 3. Ma trận hiện trạng có bằng chứng

| ID | Trạng thái | Hành vi và bằng chứng | Giới hạn của kết luận |
| --- | --- | --- | --- |
| S-R01 | CURRENT | `/social` được lazy-load trong `packages/desktop/src/renderer/components/layout/Router.tsx`; navigation trong `Sider/index.tsx` và `pages/guid/HubHome/HubSidebar.tsx` | Chưa smoke Electron |
| S-R02 | CURRENT | `process/services/social/socialBridge.ts::connectAccount` tạo profile, mở login, rollback khi mở thất bại | Profile `expired`, mọi quyền API false |
| S-R03 | CURRENT | `launchElectronLoginWindow` tái sử dụng partition và cửa sổ, sandbox/contextIsolation bật, Node integration tắt | Không xác minh OAuth hoặc identity provider |
| S-R04 | CURRENT | `socialSqliteStore.ts` có năm bảng, transaction xóa theo account, queue unseen và lọc quyền trước LIMIT | Không phải media cache hoàn chỉnh |
| S-R05 | PARTIAL | `hooks/useSocialFeed.ts` chống hồi đáp cũ, phân trang 20, deduplicate, giảm offset khi mark viewed | Lọc platform ở client có thể che toàn bộ trang đầu |
| S-R06 | CURRENT | `feed/UnifiedFeedView.tsx` phân biệt không account, Web-only và queue trống; mở lại Web đúng account | Nhánh này chỉ hiện khi không loading và không error |
| S-R07 | PARTIAL | Service refresh Feed/Reels/conversations/thread kiểm tra quyền, trạng thái và ownership kết quả | Adapter mặc định không có transport thật |
| S-R08 | CURRENT | `sendMessage` yêu cầu đọc+gửi, connected, nội dung 1–4096 ký tự và receipt đúng conversation/isFromMe/status | Test dùng adapter tiêm, không phải DM thật |
| S-R09 | BLOCKED | `adapters/mockPlatformAdapters.ts` từ chối fetch bằng `SOCIAL_CONNECTOR_UNAVAILABLE`, gửi bằng `SOCIAL_SEND_MESSAGE_TRANSPORT_UNAVAILABLE` | Cần app registration, API scope, credential flow từng provider |
| S-R10 | TARGET | Đồng bộ theo lịch 5/15/30 phút, media quota 500 MB, kiểm chứng 100 Reels | Không lấy thông số thiết kế làm số đo |
| S-R11 | PARTIAL | Có DOM/unit tests dưới `tests/unit/social/` | Chưa chạy trong bàn giao; SQLite restart dùng `node:sqlite` |

Các đường rút gọn `process/...`, `hooks/...`, `feed/...` trong bảng lần lượt thuộc `packages/desktop/src/process/`, `packages/desktop/src/renderer/pages/social/hooks/`, `packages/desktop/src/renderer/pages/social/feed/`.

## 4. Hành trình tài khoản và quyền

### S-J01 — Mở Social lần đầu

1. Người dùng vào `/social`; shell giữ navigation và header chung.
2. Không có tài khoản: hiển thị hướng dẫn tới Settings, không dựng bài hoặc hội thoại mẫu như dữ liệu thật.
3. Đọc account đang chờ: cần trạng thái loading có tên truy cập được; không hiển thị empty trước khi có kết quả.
4. Đọc thất bại: giữ thông báo lỗi có retry; không chuyển lỗi thành danh sách rỗng thành công.
5. Nghiệm thu TARGET: điều hướng bằng bàn phím và refresh route đều không gây màn hình trắng.

### S-J02 — Kết nối một phiên Web

1. Chọn platform, gọi `social:account:connect`; không buộc nhập username.
2. Tạo profile tạm với ID nội bộ và partition `persist:` riêng.
3. Mở trang đăng nhập chính thức; UI gọi đây là phiên Web chưa xác minh API.
4. Mở lại dùng partition đã lưu; tài khoản thứ hai cùng provider phải có partition khác.
5. Mở cửa sổ lỗi: xóa profile tạm, thử dọn partition, trả lỗi gốc; không để account giả thành công.
6. Nghiệm thu còn thiếu: đăng nhập thật, đóng/mở app, cookie tồn tại đúng tài khoản, logout không ảnh hưởng tài khoản khác.

### S-J03 — Cấp/thu hồi quyền

1. Bốn quyền độc lập: Feed, Reels, đọc DM, gửi DM; gửi còn phụ thuộc quyền đọc.
2. Thay đổi quyền không biến `expired` thành `connected`.
3. Cache đọc phải tôn trọng quyền ngay cả khi dữ liệu đã có trước đó.
4. TARGET: thu hồi trong lúc request đang chạy phải ngăn persist/hiển thị kết quả đến muộn.
5. TARGET: thông báo lỗi từng thao tác, không tự bật lại quyền vì refresh hoặc model đề xuất.
6. Ngắt liên kết phải đóng cửa sổ, xóa storage/cache partition rồi xóa dữ liệu account; lỗi dọn session phải được xử lý và cho thử lại.

## 5. Hành trình nội dung

### S-J04 — Feed

- Mở queue cục bộ trước; refresh live chỉ khi connector và quyền hợp lệ.
- Bài chưa xem vẫn còn sau restart; resync không làm bài đã xem trở lại unseen.
- Hiện nhãn tài khoản và nền tảng, giữ bộ lọc; khi đổi account không lộ dữ liệu account trước.
- CURRENT: sentinel tải tiếp dùng `rootMargin` 700px; nút tải thêm là đường dự phòng.
- TARGET: lọc platform không mắc kẹt nếu trang đầu chỉ chứa platform khác; cần server filter hoặc tiếp tục scan có giới hạn.
- TARGET: tiêu chí viewed 60%/2 giây phải kiểm tra timer, tab ẩn, unmount và lỗi IPC.
- Like/comment hiện mở permalink; không tăng số đếm hoặc tuyên bố đã gửi thành công.
- Empty phải phân biệt không account, không quyền, Web-only, queue hết và connector lỗi.
- Loading không được giấu bài cache còn dùng được; lỗi refresh cần phân biệt với lỗi đọc database.

### S-J05 — Reels

- TARGET trải nghiệm: 9:16, ↑/↓ chuyển, Space phát/dừng, M đổi âm lượng; không bắt phím khi đang nhập văn bản.
- Theo canonical, player quanh vị trí xem giới hạn ba; phải xác minh lại mã/đo runtime trước khi đánh dấu nghiệm thu.
- TARGET: viewed từ ba giây hoặc đổi video, chưa xem được giữ sau restart.
- TARGET: video lỗi codec/URL hết hạn/offline có lỗi riêng và nút bỏ qua, không vòng lặp retry vô hạn.
- TARGET: rời route, khóa máy, đóng xuống tray và uninstall phải dừng media theo lifecycle được cấp.
- Drawer bình luận không được giả lập đọc/gửi provider khi connector chưa hỗ trợ.

### S-J06 — Messenger

- Hai cột danh sách hội thoại và thread; chưa chọn thread phải có hướng dẫn riêng.
- Đổi account/thread trong khi tải phải vô hiệu hóa response cũ.
- Gửi tin phải có pending, thành công theo receipt, failed có draft và retry được kiểm soát.
- TARGET: timeout sau khi provider đã nhận cần reconcile/idempotency trước retry; không gửi trùng.
- TARGET: empty inbox khác lỗi sync, revoked permission khác disconnected account.
- Không có adapter thật thì hiển thị khả năng chưa sẵn sàng, không dựng tin nhắn phản hồi tự động.

### S-J07 — Storage và đồng bộ nền

- CURRENT stats là tổng byte JSON payload post/reel; `cachedMediaFilesCount = 0`.
- CURRENT clear cache xóa post/reel, gồm cả unseen; không được mô tả là chỉ xóa ảnh/video.
- TARGET: xác nhận rõ phạm vi mất dữ liệu cache trước clear; giữ account và DM theo chính sách đã duyệt.
- TARGET: thống kê metadata, file media, quota và số byte thực giải phóng phải tách biệt.
- TARGET: lịch sync có manual-only, backoff, jitter và hủy khi quyền bị thu hồi.
- Canonical có cả dọn viewed sau 48 giờ và lựa chọn tuổi 7/14/30 ngày; chưa hợp nhất thành chính sách hiện hành.

## 6. Điều kiện chặn phát hành

| Cổng | Trạng thái | Điều kiện mở |
| --- | --- | --- |
| Provider live | BLOCKED | Chủ provider cung cấp app ID, redirect, scope hợp lệ, tài khoản kiểm thử và bằng chứng xác minh identity |
| IPC end-to-end | PARTIAL | Kiểm tra sender, runtime schema, payload và quyền tại shared execution seam; unit service chưa đủ |
| Durable storage | PARTIAL | Chạy restart/migration với native `better-sqlite3` đúng Electron ABI |
| Package boundary | TARGET | Chốt chủ sở hữu app/contribution và kiểm chứng absence/install/disable/uninstall |
| UI hoàn chỉnh | PARTIAL | i18n, global stylesheet, empty/loading/error, keyboard/theme và real desktop smoke |
| DM side effect | TARGET | Idempotency, cancellation, terminal receipt, audit redacted và reconcile |

## 7. Nghiệm thu và bàn giao

Đơn vị nghiệm thu là một hành trình có dữ liệu vào, trạng thái quyền, thao tác, kết quả và bằng chứng lỗi/khôi phục.
Không thay unit fixture bằng tài khoản thật trong test mặc định; live test cần môi trường riêng và sự đồng ý cụ thể.
Mọi chứng cứ mới phải ghi revision + dirty scope + lệnh + exit code + đường output đã redacted.
Phân biệt rõ: đọc mã, đọc test, chạy test mô phỏng, chạy Electron và chạy API thật.
Không cộng phần trăm hoàn thành bằng số file hoặc số checkbox.
Mẫu bàn giao và lệnh test đã xác định nằm trong `tasks.md`; mọi cổng chưa chạy vẫn để mở.
