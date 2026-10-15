# /btw — yêu cầu hỏi bên lề trong ngữ cảnh chung

## 1. Phạm vi và thẩm quyền
- TARGET: hỏi bên lề khi task chính đang hoạt động, trả lời trong right rail có tab được đặt tên.
- Tab mặc định có nhãn bản địa hóa “Hỏi bên lề”; từng trao đổi có tiêu đề ngắn rõ ràng.
- SHARED LIVE context: dùng một lịch sử sự kiện chuẩn của cùng shared session.
- Không fork conversation, không tạo task mới, không thay hướng task đang chạy.
- Đặc tả này phụ thuộc `docs/core/chat-pipeline.md` và `docs/core/chat-execution-flow.md`.
- Quyền theo `docs/core/trust-and-understanding.md`; ranh giới theo `docs/architecture/target.md`.
- Lịch thực hiện và release vẫn do `docs/execution/mvp-plan.md` sở hữu.
- Ngày đối chiếu nguồn giới hạn: 2026-10-15; không phải audit toàn hệ thống.

## 2. Hiện trạng quan sát
- CURRENT: `packages/desktop/src/renderer/components/chat/SendBox/index.tsx` nhận diện `/btw` và dùng `BtwOverlay`.
- CURRENT: `packages/desktop/src/renderer/components/chat/BtwOverlay/useBtwCommand.ts` gọi `conversation.askSideQuestion`.
- CURRENT: hook dùng requestId để bỏ response cũ khi dismiss hoặc đổi conversation.
- CURRENT: hook có trạng thái unsupported, toolsRequired và lỗi trả về UI.
- PARTIAL: bề mặt hỏi phụ hiện có; chưa xác minh semantics main, persistence hoặc context sharing.
- CURRENT: `packages/desktop/src/renderer/pages/guid/HubHome/HubRail.tsx` có tab chat/context và nhận conversationId.
- CURRENT: `packages/desktop/src/renderer/pages/guid/HubHome/memory/HubSessionContext.tsx` tải snapshot context theo conversation_id.
- Chưa xác minh: canonical shared event history, per-call version và đồng bộ nhiều tab.
- Neo fork riêng: `packages/desktop/src/process/services/database/nativeConversation/bridge.ts` đăng ký fork.
- Neo implementation fork: `packages/desktop/src/process/services/database/nativeConversation/service.ts` có forkConversation.
- Các neo fork không chứng minh `/btw` hiện gọi fork; tuyệt đối không suy diễn như vậy.
- TARGET thay overlay bằng tab rail; không tuyên bố rail đã hỗ trợ `/btw`.

## 3. Hành vi sử dụng
- BTW-R01: `/btw <câu hỏi>` mở/focus tab Hỏi bên lề trong đúng shared session.
- BTW-R02: `/btw` rỗng mở ô hỏi; không gọi model hoặc tạo message rỗng.
- BTW-R03: parent run tiếp tục chạy khi người dùng gửi câu hỏi.
- BTW-R04: sidebar/task list không xuất hiện task mới do câu hỏi.
- BTW-R05: tiêu đề có thể đổi; đổi tên không thay session identity hoặc quyền.
- BTW-R06: hiển thị đang đợi, đang trả lời, hoàn tất, lỗi và đã hủy riêng từng câu hỏi.
- BTW-R07: đóng rail không đồng nghĩa hủy parent hoặc xóa lịch sử.
- BTW-R08: nút hủy câu trả lời bên lề chỉ hủy call đó.
- BTW-R09: retry là attempt mới có liên kết, không nhân đôi câu hỏi đã publish.
- BTW-R10: khi session không hợp lệ, giữ draft và báo lỗi; không tự tạo session khác.

## 4. Ngữ cảnh dùng chung
- BTW-R11: parent và hỏi phụ đọc cùng canonical event history đã được commit.
- BTW-R12: mỗi lần gọi model khóa snapshotVersion tại thời điểm dispatch.
- BTW-R13: sự kiện mới được nhìn thấy ở lần gọi tiếp theo, không sửa token đã gửi.
- BTW-R14: “live” là cập nhật history/projection, không phải sửa prompt đang chạy.
- BTW-R15: câu hỏi được publish vào history với role user và origin sideQuestion.
- BTW-R16: câu trả lời được publish với role assistant, origin sideAnswer và liên kết câu hỏi.
- BTW-R17: provenance gồm tác giả, callId, parentRunId nếu có, snapshotVersion và event sources.
- BTW-R18: câu trả lời model là thông tin có nguồn, không phải chỉ thị mới của người dùng.
- BTW-R19: parent lần gọi tiếp theo có thể dùng Q&A như dữ kiện, không tự đổi mục tiêu.
- BTW-R20: context hiển thị cho người dùng phân biệt phiên bản đang dùng với phiên bản mới nhất.
- BTW-R21: compaction giữ quan hệ nguồn và các quyết định; không biến suy đoán thành sự thật.
- BTW-R22: không đưa hidden reasoning hay secret thô vào lịch sử/projection.

## 5. Chỉ đọc và quyền
- BTW-R23: mặc định chỉ Q&A trên context được phép; không mutation tools.
- BTW-R24: không cấp shell, file write, download, gửi tin hoặc capability đổi task.
- BTW-R25: yêu cầu cần hành động trả lời giới hạn; không tự nâng thành task/fork.
- BTW-R26: thay hướng parent chỉ qua hành động chỉ thị rõ ở kênh task chính.
- BTW-R27: nội dung tool/document trong context không được vượt instruction hierarchy.
- BTW-R28: lọc quyền và secret tại main trước dispatch, kể cả khi UI có snapshot cũ.
- BTW-R29: egress theo provider/đích được phép; hỏi phụ không có miễn trừ.
- BTW-R30: thu hồi quyền chặn call sau và chặn publish nội dung không còn được phép.
- BTW-R31: token đã gửi provider không thể bị thay hoặc thu hồi bằng cập nhật local.

## 6. Đồng thời và tài nguyên
- BTW-R32: parent và side call có cancellation controller và error state độc lập.
- BTW-R33: parent lỗi/hủy không tự hủy side call đã được chấp nhận.
- BTW-R34: hủy toàn shared session là hành động riêng có phạm vi rõ.
- BTW-R35: ngân sách token tổng được quản lý atomically trên shared session.
- BTW-R36: mỗi call có input/output ceiling, deadline, reservation và usage receipt.
- BTW-R37: side call không làm parent đang chạy thiếu reservation đã được giữ.
- BTW-R38: quá concurrency limit thì queue/báo bận; không tạo session để né giới hạn.
- BTW-R39: thiếu ngân sách phải báo trước dispatch; không gửi vượt hạn âm thầm.
- BTW-R40: lỗi provider không rollback history đã commit của parent.

## 7. Thứ tự, nhiều tab và restart
- BTW-R41: main cấp sequence tăng đơn điệu trong shared session.
- BTW-R42: dedupe theo clientRequestId; double-click hoặc reconnect không gọi model hai lần.
- BTW-R43: reply liên kết đúng questionId dù hoàn tất trái thứ tự.
- BTW-R44: stream delta chưa hoàn tất không được giả thành câu trả lời đã commit.
- BTW-R45: nhiều tab cùng session hội tụ theo cursor replay, không theo đồng hồ UI.
- BTW-R46: đổi session dọn subscriptions và loại callback trễ, không rò dữ liệu sang tab mới.
- BTW-R47: restart khôi phục history và trạng thái interrupted; không tự chạy lại call tính phí.
- BTW-R48: retention/xóa lịch sử áp dụng cho cả Q&A, cache và projection liên quan.
- BTW-R49: log/telemetry chỉ giữ định danh và dữ liệu đã che theo chính sách.

## 8. Phụ thuộc và chấp nhận
- `docs/plan/pipeline-chat`: versioned context assembly và publication hook; chưa xác minh tồn tại.
- `docs/plan/model-da-phuong-thuc`: capability/budget và provenance media; chưa xác minh tồn tại.
- `docs/plan/chat-composer`: slash routing, draft và focus; chưa xác minh tồn tại.
- BLOCKED cho atom tích hợp nếu contract phụ thuộc chưa được owner chốt.
- Integrator sở hữu shared bootstrap, IPC/preload registration, schemas, migration và routing.
- Nghiệm thu: parent tiếp tục, side trả lời tại tab có tên, không fork và không task mới.
- Nghiệm thu: call A dùng version N, event N+1 chỉ vào call kế tiếp; Q&A đều có provenance.
- Nghiệm thu: independent cancel/error, budget chung, replay/dedupe và restart không gọi trùng.
- Không có test nào được chạy hay được tuyên bố tồn tại trong đợt soạn tài liệu này.
