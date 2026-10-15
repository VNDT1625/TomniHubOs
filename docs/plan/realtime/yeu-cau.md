# Realtime Hub — Yêu cầu bàn giao

## 1. Quyền sở hữu tài liệu và mốc kiểm toán

- Snapshot worktree: 2026-10-15; HEAD `4cf2b27113654ad10869297669d19e32ce8afdce`.
- Tài liệu bàn giao này phụ thuộc `docs/README.md`, `docs/platform/realtime-hub-design.md`, `docs/platform/realtime-hub-plan.md`.
- Ranh giới nền tảng tiếp tục theo `docs/architecture/target.md`, `docs/platform/packages.md`, `docs/engineering/testing-and-release.md`.
- Người dùng cho phép hierarchy mới; đây không phải master plan hoặc chính sách thay thế canonical.
- MTUI context/map báo stale; kết luận dưới đây được đối chiếu file hiện tại thay vì tin cache index.
- Không chạy test/build/mạng thật trong phiên này. Những kết quả pass ghi ở canonical là lịch sử do tài liệu đó báo cáo, không phải kết quả kiểm toán này.
- CURRENT dùng cho nhánh mã đã đọc; PARTIAL dùng khi chưa có toàn hành trình/release proof; TARGET chưa xây; BLOCKED cần quyết định/phụ thuộc được nêu.

## 2. Giá trị sử dụng và giới hạn

Realtime là nơi xem tin RSS và chỉ số công khai trong shell, đi sâu vào nguồn và đưa câu hỏi có ngữ cảnh sang Hub Agent.
Trung tâm dành cho news/focus/reader; widget nằm tại tab Realtime của HubRail dùng chung, không dựng sidebar thứ hai.
Không gọi dữ liệu polling là server push hoặc thời gian thực tuyệt đối.
Không gọi GitHub search theo sao là official Trending hoặc stars gained today.
Không gọi giá chỉ số Yahoo là futures; không vẽ lịch sử chưa có dữ liệu.
Không gọi RSS excerpt là bài tổng hợp đa nguồn đã kiểm chứng.
Không gọi draft chuyển sang `/guid` là câu trả lời AI đã chạy.

## 3. Hiện trạng có bằng chứng

| ID | Trạng thái | Bằng chứng | Giới hạn |
| --- | --- | --- | --- |
| R-R01 | CURRENT | `packages/desktop/src/renderer/components/layout/Router.tsx` và `Sider/index.tsx` đăng ký `/realtime` | Chưa desktop smoke |
| R-R02 | CURRENT | `renderer/pages/realtime/index.tsx` gọi `useRealtimeSource('news')`, tạo article từ response Main, `isDemo:false` | Body rỗng; chỉ excerpt nguồn RSS |
| R-R03 | CURRENT | `process/services/realtime/realtimeContentBridge.ts` có sender check, source/city validation, egress admission, cache | Chưa proof packaged live |
| R-R04 | CURRENT | `common/types/platform/realtimeContent.ts` là IPC chỉ đọc, không nhận URL tùy ý | Không phải hợp đồng package widget SDK |
| R-R05 | CURRENT | `widgets/widgetRegistry.ts` có catalog, parse settings, reorder, persistence v1 | LocalStorage có thể thất bại im lặng |
| R-R06 | CURRENT | `services/realtimeClient.ts` chia sẻ cache rail/center, polling 5 phút, giữ item cũ khi lỗi | Không hủy transport khi unmount |
| R-R07 | PARTIAL | `index.tsx` gửi bounded draft 6000 ký tự sang `/guid` | Không có embedded agent answer |
| R-R08 | PARTIAL | `tests/unit/realtime/realtimePage.dom.test.tsx` và `realtimeContentBridge.test.ts` có assertions về flow/transport | Fake IPC, fixture Response và stub electronAPI, chưa chạy ở đây |
| R-R09 | TARGET | Synthesis, chart history, official trending, auto-location, package widgets | Không có chứng cứ hoàn tất |
| R-R10 | BLOCKED | Account-bound consent và package contribution boundary | Cần Integrator/Trust/Store khóa hợp đồng và ownership |

Prefix rút gọn trong bảng đều nằm dưới `packages/desktop/src/`, trừ `tests/...`.

## 4. Nguồn dữ liệu được phép mô tả là đã tích hợp mã

| Nguồn | Hiện tại | Không được suy diễn |
| --- | --- | --- |
| News | `https://hnrss.org/frontpage`, tối đa 24 item sau parse | Không bao phủ mọi tin nóng, không corroboration đa nguồn |
| GitHub | Repo tạo trong 14 ngày, search API sort stars | Không official Trending, không tăng sao hôm nay |
| Hugging Face | Models sort downloads, tối đa 24 | Không tự tải/chạy model hoặc chứng nhận chất lượng |
| Weather | Open-Meteo, Hà Nội/TP.HCM/Đà Nẵng | Không định vị tự động, không forecast năm khoảng đã hoàn thiện |
| Market | Yahoo Finance S&P 500/NASDAQ/Bitcoin/VIX snapshots | Không futures, không realtime trading feed, không chart history |

Đây là mã gọi provider thật, không phải xác nhận API hiện có thể truy cập trong môi trường người dùng.
Test đặt tên “live” vẫn đang dùng response fixture; tên test không thay đổi cấp bằng chứng.

## 5. Hành trình và trạng thái bắt buộc

### R-J01 — News feed

1. Vào `/realtime`, đọc qua Main; lần đầu loading không được biến thành bài mẫu.
2. Ready: nhóm một hero rồi tối đa ba sub-card, lặp lại; phần dư không bị bỏ.
3. Không có item hợp lệ: hiện unavailable/empty rõ nghĩa, không nói chắc nguồn ngoài thực sự không có tin.
4. Refresh: giữ dữ liệu trước nếu phù hợp, có timestamp; người dùng biết dữ liệu có thể cũ.
5. Offline/rate limit/deny phải phân biệt và có thao tác thích hợp; deny không retry vô hạn.
6. TARGET: chính sách stale-age tối đa, timezone, malformed timestamp và bộ đếm item được thống nhất.
7. Nghiệm thu: 0/1/2/3/4/5/8 item, lỗi ảnh/nội dung dài và thay đổi chiều rộng không làm mất thẻ.

### R-J02 — Tùy chỉnh HubRail

1. Người dùng chuyển Explorer/Realtime trong rail dùng chung.
2. Thêm/xóa/di chuyển/thu gọn weather, market, github, huggingface.
3. Mặc định weather/market/github; Hugging Face có thể thêm từ catalog built-in.
4. Thay city cập nhật focus weather qua event settings; giới hạn ba thành phố công khai.
5. TARGET: localStorage quota/deny phải có UX rõ nếu cấu hình không được lưu lâu dài.
6. TARGET: widget bị gỡ/ẩn phải có quy ước ngừng polling; không coi việc collapse tự động hủy network nếu chưa chứng minh.
7. Empty rail khác lỗi của một widget; một nguồn lỗi không làm toàn rail trắng.
8. Package bên ngoài không được deserialize component code từ settings.

### R-J03 — Drilldown

- Header/item điều hướng `/realtime?view=<source>&item=<id>`.
- Source hợp lệ: github/huggingface/market/weather; news vẫn là feed/reader.
- TARGET: item không tồn tại, item cũ sau refresh, view lạ và URL encode phải có fallback rõ.
- Ready: hiển thị metadata thật, không chế chart hoặc số liệu thiếu.
- Loading/error: giữ khả năng quay lại và retry, không đổi nhầm thành phố.
- Nghiệm thu TARGET: refresh URL và back/forward giữ ngữ cảnh hợp lý; không chỉ test click trong MemoryRouter.

### R-J04 — Reader và nguồn gốc

- Click bài mở reader với title/excerpt/source; hiện trạng không có full article body từ fetch.
- Nguồn HTTPS đi qua helper route `/browser`, không renderer fetch trực tiếp.
- Không suy ra một link HTTPS là nguồn tin đáng tin cậy hoặc nội dung đã được fact-check.
- Quay lại feed lưu scrollTop trong component; cần thử refresh/reorder/route unmount để biết phạm vi bảo toàn.
- TARGET: full extraction phải có egress, giới hạn bytes, sanitizer, quyền sử dụng và provenance riêng.
- TARGET: citation phải trỏ đoạn nguồn có thực; source count phản ánh nguồn đã lấy, không con số trang trí.

### R-J05 — Hỏi tiếp với Agent

1. Nhập câu hỏi; Enter gửi, Shift+Enter xuống dòng.
2. Chuyển sang màn reference/câu hỏi, chưa có câu trả lời AI tự tạo.
3. Chọn tiếp tục trong Hub: draft chứa title, excerpt, source URLs và câu hỏi; giới hạn 6000 ký tự.
4. TARGET: draft giữ đủ citation và câu hỏi quan trọng khi truncation; báo rõ phần bị cắt nếu cần.
5. Nguồn bài là dữ liệu không tin cậy, không được trở thành lệnh hệ thống/authorization.
6. TARGET embedded chat: run ID, consent, stream, cancel, timeout, usage, audit và terminal receipt theo runtime chung.
7. Lỗi model/thiếu provider/hết budget không được chuyển thành đáp án mẫu.

## 6. Bảo mật và nguồn lực

CURRENT request chỉ source/city; Main không nhận URL, method, header hay credential từ renderer.
CURRENT default authority cho phép tập public read operations cố định, không phải consent theo account.
CURRENT transport chia sẻ DNS-pinned fetch; socket timeout 12 giây và response 1 MiB theo helper đã đọc.
TARGET: tổng deadline gồm DNS, queue và fan-out; số 12 giây không tự chứng minh end-to-end deadline.
TARGET: revoke/kill phải có hiệu lực cả cache hit, request đang chạy và cập nhật renderer muộn.
TARGET: giới hạn concurrency/rate toàn feature và audit metadata; không log nội dung nhạy cảm từ prompt.
TARGET: package widget chỉ đi qua contribution/permission broker, không nhập implementation vào core.

## 7. Khác biệt với tài liệu lịch sử

- Phần checkpoint mới của canonical ưu tiên HubRail dùng chung; sơ đồ `RealtimeStickySidebar` cũ là TARGET đã bị thay thế ở layout.
- Ví dụ mock provider và AI “Researched 3s” trong plan cũ không phải yêu cầu dựng phản hồi giả.
- Canonical báo test 14/14 ở vòng trước; không sao chép thành pass của revision/worktree kiểm toán hiện tại.
- Việc app đã có route trực tiếp không chứng minh optional package boundary đã hoàn tất.
- Nếu cần đổi canonical, giao Integrator cập nhật cùng implementation tương lai; lần này chỉ có sáu file bàn giao được phép sửa.

## 8. Cổng nghiệm thu

| Cổng | Điều kiện | Trạng thái |
| --- | --- | --- |
| Giao diện | Feed, rail, focus, reader, keyboard, responsive, i18n có đủ empty/loading/error | PARTIAL |
| Mạng thật | Packaged Electron gọi từng provider, ghi thời gian/status/độ mới, không fixture | TARGET |
| Trust | Sender/schema/egress và revocation chạy qua preload thật, không chỉ helper | PARTIAL |
| AI | Draft handoff được chứng minh; embedded run cần lifecycle/receipt riêng | PARTIAL |
| Package | Quyết định contribution SDK, clean base và uninstall proof | BLOCKED chờ hợp đồng Integrator/Store |
| Rollback | Disable ngừng polling/fetch, giữ settings, không hồi sinh request sau dispose | TARGET |

Chi tiết kỹ thuật ở `ky-thuat.md`, cây atom và mẫu bàn giao ở `tasks.md`.
Chỉ đóng cổng khi có bằng chứng theo đúng cấp kiểm thử, không dựa số lượng file hoặc số dòng tài liệu.
