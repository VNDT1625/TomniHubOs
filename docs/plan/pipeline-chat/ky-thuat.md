# Kỹ thuật bàn giao Pipeline Chat
## Thẩm quyền và trạng thái
- Tài liệu này phân rã công việc dưới `docs/core/chat-pipeline.md`, không thay hợp đồng canonical.
- Luồng chat theo `docs/core/chat-execution-flow.md`; provider theo `docs/core/ai-runtime.md`.
- Trust theo `docs/core/trust-and-understanding.md`; release theo `docs/engineering/testing-and-release.md`.
- CURRENT chỉ dùng cho phần mã nguồn đã được xác nhận trong thông tin bàn giao.
- PARTIAL dùng khi seam đã tồn tại nhưng vòng đời chưa được chứng minh đầy đủ.
- TARGET chỉ công việc cần làm; BLOCKED phải có dependency cụ thể.
## Baseline kỹ thuật
- CURRENT: executor phân biệt direction input/output.
- Lịch sử 25 tests direction từng pass, không phải bằng chứng revision hiện tại.
- CURRENT: output hook đi qua service, bridge và snapshot hiện hữu.
- CURRENT: non-guard `post_model` dùng completed assistant text, không xử lý từng token như guard.
- CURRENT: assistant text hoàn thành được lưu trước replace.
- PARTIAL: hook có thể biến đổi nội dung sau lưu; chưa đảm bảo nội dung gốc không lộ.
- BLOCKED: output guard bị từ chối bằng `CHAT_OUTPUT_GUARD_BUFFERING_UNSUPPORTED`.
- Chưa triển khai streaming buffering; không được mô tả rejection là buffered mode.
- TARGET: cancellation preflight cần được nối; chưa có guarantee end-to-end.
- TARGET: auto-model advisor cần đường áp dụng; hiện vẫn chưa áp dụng.
- Lịch sử 28 tests nativeOutput/executor/simulation từng pass; chưa rerun hiện tại.
## Ownership và đường đi
- Contract owner: `packages/desktop/src/common/types/pipeline.ts`.
- Native service owner: `packages/desktop/src/process/services/database/nativeConversation/service.ts`.
- Settings owner: `packages/desktop/src/renderer/pages/settings/PipelineChatSettings.tsx`.
- Test owner: `tests/unit/chatPipeline/nativeOutput.test.ts`.
- Definition persistence tham chiếu `nativeConversation/pipelineDefinitionStore.ts` được canonical mô tả.
- Bridge/executor/snapshot dùng owner hiện hữu; không tạo orchestrator thứ ba.
- Integrator sở hữu thay đổi hợp đồng, IPC registration, schemas và wiring dùng chung.
- Mỗi file production chỉ có một owner trong checkpoint triển khai.
## Đường thực thi mục tiêu
- Nhận request cùng identity, conversation, run và nguồn caller đã xác thực.
- Kiểm tra cancellation trước resolve definition và trước side effect preflight.
- Chọn definition theo precedence canonical, không tự thêm tầng workspace mới.
- Chốt snapshot cấu hình cho run và giới hạn số stage/payload theo hợp đồng.
- Resolve stage registry, trạng thái package và quyền guard tại Main.
- Chạy input stages theo order, truyền outcome có schema kiểm tra.
- Resolve model capability theo trạng thái runtime thay vì tin nhãn UI.
- Chỉ áp dụng advisor khi đề xuất hợp lệ trong allowlist và policy.
- Thực hiện final outbound inspection tại shared execution seam.
- Gọi model qua transport được admission, với deadline và cancellation.
- Hoàn tất assistant text theo persistence hiện có trước output replace.
- Chạy non-guard output stages trên completed text đúng message/run.
- Ghi outcome, usage và terminal receipt theo lifecycle canonical.
## Guard output và thay đổi tương lai
- Nhánh guard output tiếp tục fail closed khi chưa có buffering được duyệt.
- Không biến `CHAT_OUTPUT_GUARD_BUFFERING_UNSUPPORTED` thành warning rồi stream.
- Muốn hỗ trợ guard phải có thiết kế giữ nội dung trước publication và persistence phù hợp.
- Thiết kế đó cần xác định giới hạn bytes, thời gian chờ và hành vi overflow.
- Cần xác định nơi giữ buffer cách ly và quyền đọc trước verdict.
- Cần kiểm thử block không phát token hoặc lưu nội dung vào nơi chưa được phép.
- Chưa đạt các điều kiện trên thì acceptance guard vẫn BLOCKED.
## Cancellation và chống race
- Dùng cancellation contract hiện hữu xuyên các lớp; không dùng cờ UI riêng làm nguồn thật.
- Kiểm tra aborted trước mỗi stage và trước model dispatch.
- Hủy transport phải giải phóng request/lease trong thời hạn giới hạn.
- Output hook phải kiểm tra terminal trước persist/replace tiếp theo.
- Kết quả muộn cần đối chiếu run/message identity trước khi áp dụng.
- Cancellation không được retry và không được chuyển terminal cancelled thành completed.
- Kiểm thử race cancel với model completion và replace đồng thời.
## Budgets, retry và receipts
- Deadline toàn run là trần cho deadline stage và lời gọi model.
- Retry phải dùng budget còn lại, không reset deadline toàn run.
- Phân loại retryable transport error riêng với policy denial và schema failure.
- Không lặp side effect thiếu idempotency khi retry stage.
- Receipt cần outcome từng stage, số lần thử và lý do bỏ qua đã redaction.
- Usage phân biệt provider-reported, estimated và unavailable theo contract runtime.
- Terminal receipt cần chống ghi lặp và có bằng chứng recovery sau crash.
## UI, i18n và snapshot
- PARTIAL source: compact Settings đã có summary và native `<details>/<summary>` cho nội dung planned chỉ đọc, đã bỏ dummy controls; integration/visual chưa xác minh.
- PARTIAL source: chain đã nhóm input (khác `post_model`)/output (`post_model`) và giữ thứ tự gốc; nút lỗi `common.retry` gọi `load()` để tải lại cấu hình, không chứng minh runtime retry.
- Test cũ expects switches phải sửa theo hành vi được chốt, không sửa production để chiều test stale.
- Snapshot chỉ chứa dữ liệu cần giải thích; mask trước bridge sang renderer.
- Không đưa secret value vào state React, tooltip, clipboard hoặc thông báo lỗi.
- Styling dùng `packages/desktop/src/renderer/styles/tomni-ui.css` và i18n hiện hữu.
- Khi diện mạo đổi, cập nhật `docs/product/tomni-design-system.md` và mockup chuẩn cùng change.
## Migration và rollback
- Đọc definition cũ bằng validation hiện hữu trước khi chuẩn hóa representation mới.
- Không tự kích hoạt post_model guard khi migrate definition không có hướng rõ ràng.
- Dữ liệu không hợp lệ cần lỗi giải thích được và giữ bản gốc để phục hồi.
- Rollback UI không làm mất definition hay snapshot đã lưu hợp lệ.
- Kill nhánh advisor/output mới phải trả về behavior được kiểm chứng, không bỏ security floor.
- Receipt cũ tiếp tục đọc được hoặc được projection có version rõ ràng.
## Verification và liên kết
- Focused: `bunx vitest run tests/unit/chatPipeline/pipelineExecutor.test.ts tests/unit/chatPipeline/pipelineSimulation.test.ts tests/unit/chatPipeline/nativeOutput.test.ts`.
- Owner executor/simulation tests: `tests/unit/chatPipeline/pipelineExecutor.test.ts` và `tests/unit/chatPipeline/pipelineSimulation.test.ts`; kết quả trước đây vẫn chỉ là lịch sử.
- Bổ sung integration service–bridge–transport cho cancellation, denial và receipt.
- Gates: `bun run lint`; `bun run format:check`; `bunx tsc --noEmit`; `bun run test`.
- Text/i18n: `bun run i18n:types`; `node scripts/check-i18n.js`.
- Ghi revision, command, exit code và phạm vi assertion khi thực thi thật.
- Media refs/capability phụ thuộc `../model-da-phuong-thuc/ky-thuat.md`.
- Video, audioGeneration và TTS chưa có transport, không được advisor chọn để dispatch giả.
- Không có test runtime mới được chạy trong lần bàn giao tài liệu này.
