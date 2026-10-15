# /btw — thiết kế kỹ thuật shared live context

## 1. Trạng thái và neo nguồn
- TARGET; tuân `docs/core/chat-pipeline.md`, `docs/core/chat-execution-flow.md` và `docs/architecture/target.md`.
- Trust tuân `docs/core/trust-and-understanding.md`; release tuân `docs/engineering/testing-and-release.md`.
- CURRENT: SendBox nhận `/btw`; hook `BtwOverlay/useBtwCommand.ts` gọi askSideQuestion và loại response cũ.
- CURRENT: HubRail có conversationId; HubSessionContext lấy snapshot theo conversation_id.
- Các đường dẫn đầy đủ và giới hạn bằng chứng ở `yeu-cau.md`; không có audit main trong phạm vi này.
- PARTIAL: UI hiện có chưa chứng minh shared history hay durable publication.
- Tên type/event bên dưới là thiết kế đề xuất, không khẳng định export đã tồn tại.

## 2. Một session, nhiều call
- `sharedSessionId` định danh cùng history; không sinh conversation fork cho side question.
- `parentRunId` chỉ tham chiếu task đang chạy, không quyết định đời sống side call.
- `questionId` định danh một trao đổi; `callId` định danh attempt model.
- Không tạo work item trong task registry cho câu hỏi Q&A.
- Call record vẫn có durable lifecycle/usage/receipt theo govern chung.
- Rail tab là projection gắn sharedSessionId, không là kho history riêng.
- Parent và side call có abort controller, timeout và terminal state độc lập.
- Hủy session tường minh có thể fan-out tới các call, khác nút cancel parent.

## 3. Canonical event history
- Main-owned store append-only theo sharedSessionId và sequence tăng đơn điệu.
- Envelope: eventId, sessionId, sequence, type, actor, timestamp và schemaVersion.
- Provenance: origin, questionId, callId, parentRunId, snapshotVersion, sourceEventIds.
- Nội dung có trust label và visibility scope; không nhận actor đáng tin từ renderer.
- Event đề xuất: side.question.published, side.answer.published, call.started và call.terminal.
- Parent messages/tool results cũng đi vào cùng canonical history theo contract chung.
- Một transaction append cấp sequence; đồng hồ client không quyết định thứ tự.
- Unique(sessionId, clientRequestId) chống gửi lặp câu hỏi.
- Unique(callId, terminalKind) hoặc invariant tương đương ngăn terminal receipt lặp.
- Reply-to questionId giữ liên hệ khi câu trả lời hoàn tất trái thứ tự.
- Stream delta là projection tạm có deltaIndex; không đưa partial thành answer canonical hoàn chỉnh.
- Khi hủy, partial nếu giữ phải gắn interrupted, không được coi là final answer.

## 4. Snapshot theo lần gọi
- Admission kiểm tra session/quyền và reserve budget trước khi dispatch.
- Publish câu hỏi rồi lấy committed high-watermark N làm snapshotVersion của side call.
- Context assembler đọc nhất quán các event được phép có sequence không vượt N.
- Snapshot chứa event range, projectionVersion, policyVersion và digest phần prompt đã che.
- Giữ source references của phần được chọn và phần tóm tắt để audit.
- Provider request nhận immutable snapshot; token đã gửi không thay đổi được.
- Parent đang ở snapshot M tiếp tục với M dù Q&A mới được publish ở N+1.
- Parent tại lần gọi tiếp theo đọc watermark mới theo cùng assembler.
- Nếu parent không còn lần gọi tiếp theo, không tuyên bố nó đã tiêu thụ Q&A mới.
- UI có latestHistoryVersion và activeCallSnapshotVersion để giải thích độ mới.
- Compaction tạo derived event có source range/digest, không viết lại provenance gốc.
- Semantic role sideAnswer là dữ kiện assistant, không phải lệnh thay mục tiêu.

## 5. Chính sách Q&A
- Runtime profile mặc định không khai báo tools; dispatcher vẫn deny mutation nếu model cố gọi.
- Không shell, file write, gửi tin, download hoặc thao tác task control.
- Cần hành động thì trả toolsRequired/giới hạn tương đương, không tự chuyển chế độ.
- Chỉ hành động tường minh ở luồng chính mới tạo chỉ thị task mới theo quy trình hiện hữu.
- Context projection lọc scope và secrets trước mọi provider call.
- Opaque handle không được resolve thành secret cho model.
- Egress kiểm tra provider, destination, quota và payload tại seam chung.
- Recheck permission trước publish answer; nếu revoked thì giữ receipt đã che, không lộ answer.
- Xóa local không được mô tả như thu hồi dữ liệu đã gửi provider.

## 6. IPC và UI
- Request đề xuất: sessionId, question, clientRequestId; parentRunId do main xác thực.
- Response: accepted questionId/callId hoặc structured denial có retryability.
- Subscribe nhận cursor; server replay từ cursor và phát event live không có khoảng hở.
- Schema giới hạn question bytes, title length, batch size và event payload.
- Sender validation gắn window/origin với session được phép; không tin sessionId tùy ý.
- SendBox route `/btw` sang side-question endpoint, không qua fork handler.
- Rail có tab ID ổn định cho session và nhãn i18n “Hỏi bên lề”.
- Tiêu đề trao đổi từ câu hỏi đã che, có thể sửa; không render HTML không tin cậy.
- Các thao tác rename/focus/close không thay canonical question hoặc parent run.
- Dọn subscriber bằng dispose khi unmount/session switch; callback có generation guard.
- Đóng rail mặc định detach view; cancel call là nút riêng và được main xác nhận.
- CSS chỉ ở `packages/desktop/src/renderer/styles/tomni-ui.css`; nhãn qua i18n.

## 7. Ngân sách và cạnh tranh
- Shared-session ledger giữ reservedInput, reservedOutput, consumed và ceiling.
- Admission compare-and-reserve atomically; không tính riêng mỗi tab để vượt tổng.
- Parent reservation đã cấp được bảo vệ; side call chỉ dùng phần khả dụng.
- Per-call max input/output và deadline không vượt hạn session.
- Token estimate không là usage thực; receipt settle theo provider report hoặc trạng thái unknown.
- Cancel/error giải phóng phần chưa dùng, không hoàn lại usage đã tiêu thụ.
- Unknown usage giữ khoản chờ đối soát; không giả định bằng zero.
- Giới hạn side concurrency và hàng đợi có fairness, timeout, cancel trước dispatch.
- Queue không giữ snapshot sớm: khóa snapshot khi thực sự dispatch để thấy history mới.
- Session budget exhausted không tạo session/task khác làm fallback.

## 8. Replay và restart
- Outbox dispatch/receipt gắn transaction để phục hồi admission sau crash.
- Nếu provider không hỗ trợ idempotency/resume, trạng thái dispatch không rõ trở thành interrupted/unknown.
- Không tự gửi lại call tính phí khi chưa biết provider đã nhận hay chưa.
- Retry tường minh tạo callId mới, liên kết questionId và attempt trước.
- Nhiều tab dedupe eventId/sequence, buffer khoảng hở rồi yêu cầu replay.
- Không dùng thứ tự delta tới mạng làm thứ tự history chuẩn.
- Terminal event thắng callback muộn; publication chỉ có một final answer mỗi attempt.
- Restart mở rail từ projection bền, không từ React state cũ.
- Retention purge đồng bộ history projections/cache; giữ audit tối thiểu theo chính sách canonical.
- Secrets bị che trong log, title, prompt digest metadata và lỗi provider trả UI.

## 9. Ownership và tích hợp
- Integrator sở hữu shared schemas, migration, bootstrap, preload/IPC registration và base routing.
- Lane rail chỉ sửa allowlist UI được giao; lane runtime chỉ sửa service riêng đã được giao.
- Fork bridge/service là neo đối chiếu; không được gọi hoặc sửa để giả lập `/btw`.
- `docs/plan/pipeline-chat`: cần hook snapshot/publication và role provenance trước nối runtime.
- `docs/plan/model-da-phuong-thuc`: cần token/media budget và provider capability trước media Q&A.
- `docs/plan/chat-composer`: cần slash/focus/draft contract trước thay overlay.
- Chưa xác minh ba bộ phụ thuộc tồn tại; thiếu contract là BLOCKED cho phần liên quan.
- Kill switch ngừng side admission, giữ history đọc được và parent run không bị ảnh hưởng.
- Migration additive; rollback không xóa event mới hoặc gán side answer thành user command.

## 10. Xác minh khi triển khai
- Tìm targeted tests/scripts có thật trước chạy; nếu thiếu thì tạo contract/integration tests tương ứng.
- Chứng minh snapshot immutability, order/dedupe, revoke, budget race, restart unknown dispatch.
- Gate: `bun run lint`, `bun run format:check`, `bunx tsc --noEmit`, `bun run test`.
- Nếu đổi text/i18n: `bun run i18n:types` và `node scripts/check-i18n.js`.
- Không ghi tên suite giả định như test hiện hữu; không tuyên bố gate đã chạy cho đợt docs này.
