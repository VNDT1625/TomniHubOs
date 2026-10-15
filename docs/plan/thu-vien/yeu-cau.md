# Thư viện — yêu cầu

## 1. Phạm vi và thẩm quyền
- Trạng thái đặc tả: TARGET; ngày đối chiếu nguồn: 2026-10-15.
- Đây là đặc tả triển khai phụ thuộc tài liệu canonical, không thay master plan.
- Nguồn thẩm quyền: `docs/README.md`, `docs/architecture/target.md`.
- Quyền và dữ liệu riêng theo `docs/core/trust-and-understanding.md`.
- Package theo `docs/platform/packages.md`; phát hành theo `docs/engineering/testing-and-release.md`.
- Lịch và checkpoint thuộc `docs/execution/mvp-plan.md`.
- Mục tiêu: tìm, tổ chức và dùng lại tài liệu có nguồn gốc rõ ràng.
- Không đưa download manager hay editor chuyên biệt vào base.
- Chỉ đặc tả; tài liệu này không chứng minh tính năng đã hoàn tất.

## 2. Bằng chứng hiện trạng giới hạn
- CURRENT: `packages/desktop/src/renderer/pages/integrations/library/LibraryPage.tsx` có UI danh sách.
- CURRENT: trang gọi `window.electronAPI.library.list()` để lấy danh sách.
- CURRENT: bộ lọc UI so khớp từ truy vấn với `entry.name` và `entry.path`.
- CURRENT: nút thêm gọi `library.add()`; chưa kiểm chứng đường đi main.
- CURRENT: mục bị thiếu có hành động `library.repick({ entryId })`.
- CURRENT: mở mục điều hướng qua `fileViewerPath({ kind: 'library', id })`.
- CURRENT: trang có trạng thái tải, lỗi, rỗng và không có kết quả.
- PARTIAL: bề mặt quản lý thư viện đã có nhưng chưa chứng minh lưu bền và toàn bộ quyền.
- Chưa xác minh: index persistent, tìm nội dung, tags, ingest và xóa nội dung.
- Chưa xác minh không có nghĩa là không tồn tại; không đánh dấu CURRENT từ tên file.
- Chú thích trang nói lưu theo vị trí, không copy; đây chưa phải bằng chứng hành vi main.
- Không suy từ việc có nút mở sang kết luận preview an toàn hoặc hỗ trợ mọi định dạng.

## 3. Danh mục và metadata
- TV-R01: mỗi mục có ID ổn định không phụ thuộc tên file.
- TV-R02: lưu metadata bền qua đóng ứng dụng và khởi động lại.
- TV-R03: phân biệt tham chiếu file ngoài, nội dung được quản lý và kết quả package.
- TV-R04: hiển thị tên, loại, kích thước nếu biết, thời gian và nguồn tạo.
- TV-R05: trạng thái thiếu file khác trạng thái bị từ chối quyền.
- TV-R06: phiên bản nội dung và phiên bản metadata độc lập.
- TV-R07: tài liệu trùng có chính sách rõ, không âm thầm ghi đè.
- TV-R08: đổi vị trí phải kiểm tra lại quyền và định danh nội dung.
- TV-R09: metadata nhạy cảm cũng phải được bảo vệ, kể cả đường dẫn.

## 4. Tìm kiếm và tags
- TV-R10: index persistent phục vụ tìm metadata sau restart.
- TV-R11: tìm tên, tags và loại; tìm nội dung chỉ khi người dùng cho phép ingest.
- TV-R12: phân trang ổn định và sắp xếp có khóa phụ ID.
- TV-R13: chuẩn hóa tiếng Việt được công bố; không làm mất bản gốc.
- TV-R14: tags có thể tạo, gắn, bỏ gắn, đổi tên và hợp nhất có kiểm soát.
- TV-R15: xóa tag không xóa tài liệu.
- TV-R16: kết quả không được tiết lộ mục ngoài phạm vi được phép.
- TV-R17: kết quả cũ phải báo index đang cập nhật thay vì giả vờ mới nhất.
- TV-R18: hủy truy vấn cũ không được ghi đè kết quả truy vấn mới.

## 5. Preview và sử dụng trong chat
- TV-R19: preview chỉ đọc mặc định, không tự chạy script, macro hoặc executable.
- TV-R20: định dạng không hỗ trợ có thông báo và lựa chọn cài package phù hợp.
- TV-R21: không tự gửi tài liệu lên dịch vụ cloud để tạo preview.
- TV-R22: mở ngoài ứng dụng phải là hành động riêng có kiểm tra quyền.
- TV-R23: đính kèm chat dùng reference có phiên bản và provenance.
- TV-R24: token/byte budget giới hạn phần trích; giao diện cho biết phần bị cắt.
- TV-R25: thu hồi quyền ngăn lần đọc sau; không hứa thu hồi token đã gửi provider.
- TV-R26: preview stale được hủy khi đổi mục hoặc đổi workspace.

## 6. Ingest và download
- TV-R27: chọn file chỉ cấp đúng phạm vi được chọn, không cấp toàn ổ đĩa.
- TV-R28: ingest có queued, running, ready, failed, cancelled và receipt.
- TV-R29: kiểm tra loại thực, giới hạn kích thước, timeout và tài nguyên giải nén.
- TV-R30: parser cô lập; lỗi một tài liệu không phá hàng đợi còn lại.
- TV-R31: nội dung tài liệu là dữ liệu không tin cậy, không phải lệnh agent.
- TV-R32: OCR, chuyển đổi và tải xuống chuyên biệt thuộc optional packages.
- TV-R33: base chỉ nhận kết quả qua contract, không import implementation package.
- TV-R34: tải mạng phải qua egress policy, kiểm tra redirect và địa chỉ đích.
- TV-R35: gỡ package không xóa dữ liệu người dùng đã giữ trong thư viện.
- TV-R36: package vắng mặt phải có đường đọc metadata và phục hồi an toàn.

## 7. Xóa và clear
- TV-R37: “Bỏ khỏi thư viện” xóa liên kết/metadata phạm vi mục, giữ file nguồn ngoài.
- TV-R38: “Xóa nội dung được quản lý” là thao tác riêng, nêu phạm vi và xác nhận.
- TV-R39: không cung cấp xóa file nguồn ngoài bằng hành động bỏ mục thông thường.
- TV-R40: “Xóa index/cache” giữ mục, tags, nội dung và cho phép xây lại.
- TV-R41: “Làm trống thư viện” nêu rõ bỏ toàn bộ mục; mặc định giữ nguồn ngoài.
- TV-R42: content dùng chung chỉ được thu gom khi không còn reference hợp lệ.
- TV-R43: xóa phải vô hiệu hóa preview, search hit và reference truy cập mới.
- TV-R44: tác vụ đang ingest không được làm sống lại mục đã xóa.
- TV-R45: audit giữ bằng chứng tối thiểu đã che, không giữ bản sao nội dung đã yêu cầu xóa.

## 8. Phụ thuộc và nghiệm thu
- `docs/plan/pipeline-chat`: contract chọn tài liệu và dựng context; chưa xác minh bộ tài liệu này tồn tại.
- `docs/plan/model-da-phuong-thuc`: năng lực parser/model và fallback; chưa xác minh tồn tại.
- `docs/plan/chat-composer`: attachment, tiến độ và lỗi; chưa xác minh tồn tại.
- BLOCKED cho tích hợp tương ứng nếu chủ sở hữu chưa chốt contract; không tự đoán API.
- Integrator sở hữu bootstrap, đăng ký IPC/preload, shared schemas và migration.
- Lane Library chỉ sửa allowlist riêng được giao; package download có owner riêng.
- Nghiệm thu cần restart vẫn tìm metadata/tags và không đọc được mục bị thu hồi quyền.
- Nghiệm thu cần bỏ mục giữ nguồn ngoài; clear index giữ nội dung; xóa managed tôn trọng reference.
- Nghiệm thu cần package absence/install/uninstall và ingest lỗi/hủy không để dữ liệu nửa chừng.
- Không có test nào được tuyên bố đã chạy trong đợt soạn tài liệu này.
