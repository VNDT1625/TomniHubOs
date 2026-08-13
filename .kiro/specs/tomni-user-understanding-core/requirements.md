# Requirements Document

## Introduction

## Mục tiêu

Xây dựng một lớp hiểu người dùng dùng lại các hệ thống hiện có của TomniHubOS, ưu tiên lưu trữ cục bộ và đặt người dùng vào quyền kiểm soát hoàn toàn. Lớp này không tạo kho nhớ thứ hai, không thay thế ContextStore/ContextComposer, Manager, chat history, knowledge hoặc settings hiện có.

## Phạm vi sở hữu và giới hạn

- **Nguồn sự thật:** `agentRuntime/contextStore.ts` và `contextComposer.ts` là nguồn sự thật cho facts, preferences, habits, provenance, confidence, scope, user lock và projection vào prompt.
- **Lớp tích hợp:** tính năng mới chỉ thêm adapter/projection và UI quản lý, không sửa engine dùng chung do Tab 1 quản lý.
- **Dữ liệu:** lưu trên máy qua ContextStore hiện có; không upload, không ghi mật khẩu/API key/access token hoặc nội dung nhạy cảm không cần thiết.
- **Ranh giới:** Main xử lý dữ liệu và IPC; Renderer chỉ hiển thị/gọi bridge; chat, knowledge, workspace, Manager và settings được đọc qua API hiện có.
- **Quyền kiểm soát:** người dùng có thể xem, sửa, xóa, tắt hoặc đặt lại dữ liệu hiểu người dùng; mỗi mục hiển thị nguồn, thời điểm, phạm vi và lý do dùng.

## Glossary

- **Fact:** Một mẩu thông tin có key, value, scope, provenance và confidence.
- **Preference:** Fact thuộc nhóm sở thích được người dùng xác nhận.
- **Projection:** Context an toàn được chọn cho một công việc cụ thể.

## Requirements

### Yêu cầu chức năng

### 1. Lưu sở thích đã xác nhận — lát cắt đầu tiên

**User story:** Là người dùng, tôi muốn xác nhận một sở thích để Tomni nhớ và dùng đúng lúc.

**Tiêu chí chấp nhận:**

- KHI người dùng xác nhận một sở thích hợp lệ THÌ hệ thống PHẢI lưu nó qua `ContextStore.learnPersonalFact(..., 'preferences', ...)` với `source: 'user'`, `userLocked: true`, `lastConfirmedAt` và provenance tối thiểu.
- KHI sở thích đã tồn tại cùng key và scope THÌ hệ thống PHẢI cập nhật mục đó theo quy tắc ưu tiên của `mergeLearnedFact`, không tạo bản sao.
- KHI một công việc mới cần ngữ cảnh THÌ hệ thống PHẢI dùng projection của `ContextComposer`, chỉ đưa sở thích phù hợp với surface/scope và sensitivity vào context.
- KHI người dùng mở giao diện hiểu người dùng THÌ hệ thống PHẢI thấy giá trị, phạm vi, nguồn, thời điểm xác nhận và lý do hệ thống dùng mục đó.
- KHI người dùng sửa, xóa, tắt ghi nhớ hoặc đặt lại mục THÌ thay đổi PHẢI có hiệu lực cho lần sử dụng tiếp theo và không khôi phục âm thầm.
- KHI lưu thất bại THÌ UI PHẢI báo lỗi có thể hiểu được và không tuyên bố đã ghi nhớ.

### 2. Nhớ dự án và cách làm việc

- KHI người dùng xác nhận quy tắc theo dự án/surface THÌ hệ thống PHẢI lưu bằng scope phù hợp, liên kết với workspace/project hiện có và không chép dữ liệu dự án vào kho mới.
- KHI project hoặc workspace thay đổi THÌ projection PHẢI lọc đúng scope và không rò rỉ quy tắc giữa các dự án.
- Người dùng phải quản lý được từng mục và toàn bộ nhóm theo project.

### 3. Tìm lại đúng thông tin

- KHI công việc yêu cầu thông tin đã nhớ THÌ hệ thống PHẢI truy vấn qua adapter của ContextStore/knowledge/chat hiện có theo mức liên quan, scope và độ tin cậy.
- Kết quả PHẢI kèm provenance và mức phù hợp; không biến suy luận chưa xác nhận thành sự thật người dùng.
- Không được tạo index hoặc database nhớ trùng lặp nếu một API hiện có đáp ứng được.

### 4. Đề xuất phù hợp theo công việc

- KHI đủ ngữ cảnh và chính sách cho phép THÌ hệ thống MAY đề xuất cách áp dụng thông tin đã nhớ.
- Đề xuất PHẢI nêu thông tin nào được dùng và vì sao; người dùng có thể chấp nhận, từ chối hoặc sửa trước khi áp dụng.
- Đề xuất không được tự ghi sở thích mới nếu chưa có xác nhận rõ ràng.

### 5. Học từ phản hồi

- KHI người dùng chấp nhận, từ chối hoặc sửa đề xuất THÌ hệ thống PHẢI lưu một tín hiệu phản hồi an toàn, tối thiểu hóa nội dung và gắn với mục/đề xuất liên quan.
- Phản hồi chỉ được điều chỉnh confidence hoặc ưu tiên đề xuất; không được âm thầm ghi đè fact user-locked.
- Người dùng phải xem và xóa được lịch sử phản hồi, hoặc tắt việc học từ phản hồi.

## Yêu cầu phi chức năng

- Main không dùng DOM; Renderer không dùng Node.js; IPC đi qua preload/bridge.
- Tất cả UI text dùng i18n; ngôn ngữ và module lấy từ `packages/desktop/src/common/config/i18n-config.json`.
- UI dùng Arco Design, `@icon-park/react` và UnoCSS semantic tokens; không hardcode màu/chuỗi, không raw interactive HTML.
- Dữ liệu nhạy cảm phải được redaction trước projection; secret chỉ là opaque handle do hệ thống bảo mật hiện có quản lý.
- Mỗi thay đổi có unit/integration/DOM tests phù hợp, bao gồm đường lỗi, và giữ chuẩn coverage của dự án.
- Thư mục/tệp mới phải tuân architecture skill và giới hạn tối đa 10 direct children.

## Ngoài phạm vi

- Thay thế ContextStore, ContextComposer, ResourceCoordinator, chat history, knowledge store, Manager store hoặc ConfigStorage.
- Đồng bộ bộ nhớ lên server, huấn luyện model, lưu API keys/passwords, hoặc tự động suy luận danh tính nhạy cảm.
- Sửa các tệp shared/core do Tab 1 quản lý; implementer phải tuân allowlist trong design.
