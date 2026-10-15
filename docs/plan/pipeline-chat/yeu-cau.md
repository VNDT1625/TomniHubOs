# Yêu cầu bàn giao Pipeline Chat
## Vai trò tài liệu
- Đây là đặc tả bàn giao phụ thuộc tài liệu canonical, không phải kiến trúc quy phạm mới.
- Nguồn ưu tiên: `docs/README.md` và `docs/core/chat-pipeline.md`.
- Vòng đời thực thi tuân theo `docs/core/chat-execution-flow.md`.
- Ranh giới bảo mật tuân theo `docs/core/trust-and-understanding.md`.
- Runtime tuân theo `docs/core/ai-runtime.md`; release theo `docs/engineering/testing-and-release.md`.
- C0–C6 và quyết định phát hành vẫn thuộc `docs/execution/mvp-plan.md`.
## Cơ sở tiến độ
- CURRENT phạm vi mã nguồn bàn giao: executor đã có hướng input/output.
- Lịch sử: 25 tests executor direction input/output từng đạt; không chạy lại revision hiện tại.
- CURRENT phạm vi mã nguồn bàn giao: service có output hook, bridge và snapshot.
- CURRENT: `post_model` không mang vai trò guard chạy trên completed assistant text.
- CURRENT: completed assistant text được persist trước thao tác replace.
- PARTIAL: thứ tự persist này không chứng minh output đã được kiểm duyệt trước lưu hoặc hiển thị.
- BLOCKED: output guard trả `CHAT_OUTPUT_GUARD_BUFFERING_UNSUPPORTED`.
- Chưa có streaming buffered; không được quảng bá cơ chế giữ token để duyệt.
- TARGET: bổ sung cancellation ở preflight, hiện còn thiếu.
- TARGET: áp dụng auto-model advisor vào lựa chọn thực thi, hiện chưa áp dụng.
- Lịch sử: nativeOutput cùng executor/simulation từng đạt 28 tests; không chạy lại revision hiện tại.
## Phạm vi sản phẩm
- Cho phép cấu hình pipeline mặc định và pipeline của hội thoại theo hợp đồng hiện hữu.
- Cho phép hiểu thứ tự stage input, lời gọi model và stage output.
- Hiển thị stage thuộc guard, stage thường và trạng thái capability một cách phân biệt.
- Cung cấp snapshot giải thích quyết định nhưng không đưa bí mật vào renderer.
- Giữ policy tại Hub; adapter chỉ sở hữu chi tiết provider hoặc transport.
- Không đưa triển khai ứng dụng tùy chọn vào base để phục vụ pipeline.
- Không coi tắt stage UI là quyền bỏ qua outbound inspection chung.
- Không cam kết guard output hoạt động khi còn mã lỗi unsupported.
## Yêu cầu Settings
- PARTIAL: source `PipelineChatSettings` đã có màn hình compact và summary; chưa xác minh integration/visual.
- PARTIAL: native `<details>/<summary>` đã thu gọn phần planned chỉ đọc; dummy controls đã được loại bỏ.
- PARTIAL: source đã nhóm input (khác `post_model`) và output (`post_model`), giữ số thứ tự gốc của stages.
- PARTIAL: nút tải lại khi load lỗi đã dùng `common.retry` và gọi `load()`; đây không phải retry policy của runtime.
- Test cũ còn mong đợi switches là bằng chứng stale cần đối chiếu, không là yêu cầu UI mới.
- Văn bản hiển thị phải qua i18n hiện hữu.
- Styling thuộc `packages/desktop/src/renderer/styles/tomni-ui.css`.
- Thay đổi diện mạo phải đồng bộ chuẩn UI và `mockup/home-wireframe-v3.html`.
## Yêu cầu runtime
- Main xác thực definition trước khi nhận chạy; renderer không là nguồn quyền.
- Capability phải được resolve tại runtime theo provider, model, account và trạng thái hiện tại.
- Advisor chỉ cung cấp đề xuất; không tự cấp capability hoặc tự thay consent.
- Model thiếu capability phải bị từ chối bằng lỗi ổn định trước side effect.
- Pipeline đã bắt đầu cần snapshot cấu hình xác định để tránh sửa giữa lượt.
- Mỗi stage có timeout và giới hạn kích thước đầu vào/đầu ra.
- Retry phải nằm trong ngân sách toàn run, có giới hạn lần và lý do retry.
- Không retry lỗi quyền, guard block hoặc cancellation như lỗi mạng tạm thời.
- Hủy phải truyền từ preflight qua executor, transport và output hook.
- Sau terminal cancellation không cho kết quả đến muộn ghi đè nội dung mới.
- Mỗi run phải có terminal receipt bền vững theo hợp đồng canonical.
- Receipt ghi stage outcome, usage, thời gian và lỗi đã redaction.
## Ranh giới dữ liệu
- Renderer chỉ nhận provider/model metadata, opaque handles và snapshot đã che dữ liệu.
- API keys, tokens và credential leases thuộc Main hoặc runtime cách ly được chấp thuận.
- Stage package không được tự khai báo mình là authorized guard.
- Dữ liệu model, package và context retrieval phải được xem là không tin cậy.
- Quyền egress được kiểm tra tại seam dùng chung ngay trước gửi.
- Snapshot phải có giới hạn dung lượng và không sao chép nguyên bí mật để debug.
- Persistence trước replace phải được thể hiện đúng trong mô tả riêng tư.
## Tiêu chí chấp nhận
- AC-P01: input stage không vô tình chạy lại ở nhánh output.
- AC-P02: non-guard `post_model` nhận completed text đúng lượt hội thoại.
- AC-P03: test chứng minh persist trước replace và xử lý replace lỗi.
- AC-P04: output guard unsupported không được đổi thành skip hay success giả.
- AC-P05: cancel preflight ngăn model call và stage side effect mới.
- AC-P06: cancel trong output ngăn late replace và tạo terminal nhất quán.
- AC-P07: advisor chỉ được áp dụng sau resolve capability và kiểm tra policy.
- AC-P08: kiểm chứng compact summary, native details planned, retry tải cấu hình, nhóm stage và không còn dummy controls bằng test hành vi/visual mới.
- AC-P09: snapshot và lỗi không chứa secret trong renderer, log hoặc receipt.
- AC-P10: retry không vượt budget và không tạo nhiều terminal cho cùng run.
- AC-P11: kiểm thử tích hợp bao phủ service–bridge–executor, không chỉ mock executor.
## Owner và phụ thuộc
- Owner hợp đồng: `packages/desktop/src/common/types/pipeline.ts`.
- Owner UI: `packages/desktop/src/renderer/pages/settings/PipelineChatSettings.tsx`.
- Owner service: `packages/desktop/src/process/services/database/nativeConversation/service.ts`.
- Owner kiểm thử output: `tests/unit/chatPipeline/nativeOutput.test.ts`.
- Owner executor/bridge/snapshot: các file hiện hữu trong subsystem chatPipeline; xác định file chính xác trước sửa.
- Phụ thuộc media: `../model-da-phuong-thuc/yeu-cau.md` cho model refs và capability theo modality.
- Pipeline không suy ra video/audio/TTS sẵn sàng chỉ vì đã chọn default media.
## Migration, rollback và bằng chứng
- Migration definition cũ phải bảo toàn thứ tự và trạng thái bật/tắt, không tự thêm guard unsupported.
- Rollback phải khôi phục definition tương thích và tắt nhánh mới bằng cơ chế hiện hữu.
- Không xóa lịch sử hội thoại hoặc receipts khi rollback UI/runtime.
- Lệnh focused: `bunx vitest run tests/unit/chatPipeline/pipelineExecutor.test.ts tests/unit/chatPipeline/pipelineSimulation.test.ts tests/unit/chatPipeline/nativeOutput.test.ts`.
- Owner tests direction/simulation: `tests/unit/chatPipeline/pipelineExecutor.test.ts` và `tests/unit/chatPipeline/pipelineSimulation.test.ts`.
- Gates triển khai: `bun run lint`, `bun run format:check`, `bunx tsc --noEmit`, `bun run test`.
- Khi sửa text: `bun run i18n:types` và `node scripts/check-i18n.js`.
- Bàn giao này chỉ viết tài liệu; không có kết quả test current-revision mới.
