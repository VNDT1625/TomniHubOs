# Tasks bàn giao Model đa phương thức
## Quy ước và phạm vi
- Đây là checklist bàn giao dưới `docs/core/ai-runtime.md`, không phải master plan mới.
- `[x]` ghi nhận source đã tồn tại theo tiến độ bàn giao; không khẳng định current-revision tests.
- Task cha giữ `[ ]` cho tới khi đủ wiring, tests và acceptance liên quan.
- Bốn tests đã pass là lịch sử; lần viết tài liệu này không chạy lại runtime tests.
- Release, C0–C6 và owner shared files theo `docs/execution/mvp-plan.md`.
## M01 — Baseline và allowlist
- [ ] Chốt atom triển khai Settings defaults từ trạng thái PARTIAL.
  - [x] Ghi nhận `components/media/MediaModelDefaults.tsx` đã tồn tại.
  - [x] Ghi nhận helper `mediaDefaultsContract.ts` đã tồn tại.
  - [x] Ghi nhận config `ai.mediaModelDefaults` có năm providerId/modelId refs.
  - [ ] Gắn revision xuất phát khi triển khai production.
  - [ ] Gán component owner tại `packages/desktop/src/renderer/pages/settings/components/media/MediaModelDefaults.tsx`.
  - [ ] Gán helper owner tại `packages/desktop/src/renderer/pages/settings/components/media/mediaDefaultsContract.ts`.
  - [ ] Xác định đúng file Settings host trước đưa vào allowlist.
  - [ ] Xác định đúng config schema/storage owner thay vì tạo store mới.
## M02 — Hợp đồng năm modality
- [ ] Nghiệm thu representation và validation đầy đủ.
  - [x] Ghi nhận key `image` có trong cấu hình refs bàn giao.
  - [x] Ghi nhận key `video` có trong cấu hình refs bàn giao.
  - [x] Ghi nhận key `audioGeneration` có trong cấu hình refs bàn giao.
  - [x] Ghi nhận key `tts` có trong cấu hình refs bàn giao.
  - [x] Ghi nhận key `stt` có trong cấu hình refs bàn giao.
  - [ ] Validate providerId/modelId theo schema hiện hữu tại boundary nhận dữ liệu.
  - [ ] Phân biệt chưa chọn với ref stale không resolve được.
  - [ ] Test input malformed, key không hỗ trợ và ID vượt giới hạn.
## M03 — Persistence và partial update
- [ ] Chứng minh lưu config không mất dữ liệu người dùng.
  - [ ] Dùng config storage owner hiện hữu của `ai.mediaModelDefaults`.
  - [ ] Test đổi image không làm mất video/audioGeneration/tts/stt.
  - [ ] Test đổi provider nhưng model trùng tên vẫn giữ đúng providerId.
  - [ ] Xác định semantics clear ref theo contract thay vì tự chọn null/undefined.
  - [ ] Test reload Settings giữ đủ năm lựa chọn.
  - [ ] Test write thất bại hiển thị lỗi và không báo saved giả.
  - [ ] Test concurrent update không ghi đè thay đổi ngoài modality đang sửa.
  - [ ] Không ghi credential hoặc endpoint bí mật vào config refs.
## M04 — Mount Settings còn thiếu
- [ ] Mount component vào Settings host thật.
  - [ ] Xác định route/tab owner đang quản lý model settings.
  - [ ] Nối read config, update callback và error state theo pattern hiện hữu.
  - [ ] Đảm bảo component không mount trùng tạo nhiều request metadata.
  - [ ] Kiểm tra chuyển tab không reset refs chưa lưu ngoài semantics đã chốt.
  - [ ] Bổ sung test truy cập route thật thay vì chỉ render component cô lập.
  - [ ] Test loading metadata rồi hiện lựa chọn đã lưu.
  - [ ] Test metadata lỗi vẫn giữ dữ liệu ref hiện có để sửa lại.
  - [ ] Chỉ đánh dấu mount hoàn tất sau kiểm thử reachable UI.
## M05 — I18n chưa tích hợp
- [ ] Tích hợp translations cho toàn bộ UI media defaults.
  - [ ] Chọn namespace hiện hữu theo cấu trúc Settings locale.
  - [ ] Thêm nhãn image, video, audioGeneration, tts và stt đúng nghĩa.
  - [ ] Dịch trạng thái chưa chọn, unavailable và ref không hợp lệ.
  - [ ] Dịch containment image/STT mà không hứa execution đã sẵn sàng.
  - [ ] Dịch lỗi load/save bằng reason code, không lộ raw exception.
  - [ ] Chạy `bun run i18n:types` sau thay đổi locale/config.
  - [ ] Chạy `node scripts/check-i18n.js` và giải quyết keys thiếu.
  - [ ] Test UI không hiển thị raw translation key khi đổi locale.
## M06 — UX và chuẩn giao diện
- [ ] Hoàn thiện selection có khả năng truy cập.
  - [ ] Hiển thị provider cùng model để phân biệt model trùng tên.
  - [ ] Cho phép thao tác clear lựa chọn explicit với mô tả đúng tác động.
  - [ ] Hiển thị unavailable cho modality chưa có transport.
  - [ ] Kiểm tra keyboard navigation và focus khi dropdown đóng/mở.
  - [ ] Bổ sung accessible label cho từng modality và thông báo lỗi.
  - [ ] Đặt CSS trong `packages/desktop/src/renderer/styles/tomni-ui.css`.
  - [ ] Đồng bộ `docs/product/tomni-design-system.md` nếu diện mạo thay đổi.
  - [ ] Đồng bộ `mockup/home-wireframe-v3.html` cùng UI change tương ứng.
## M07 — Runtime capability resolution
- [ ] Chặn mọi execution thiếu capability thực tế.
  - [ ] Main resolve provider/model theo account và policy tại lúc chạy.
  - [ ] Kiểm tra provider enabled và adapter transport khả dụng.
  - [ ] Kiểm tra modality và input/output format theo capability contract.
  - [ ] Không đoán capability qua tên model hoặc nhãn renderer.
  - [ ] Từ chối stale ref bằng lỗi ổn định trước credential access.
  - [ ] Không fallback sang cloud provider khác một cách im lặng.
  - [ ] Test catalog có model nhưng transport absent vẫn bị từ chối.
  - [ ] Ghi resolved provider/model trong evidence không chứa bí mật.
## M08 — Giữ containment image/STT
- [ ] Đánh giá acceptance riêng trước khi mở rộng image/STT.
  - [ ] Ghi trạng thái image/STT là contained, không phải full production proof.
  - [ ] Xác định owner transport hiện hữu và điều kiện containment trong source.
  - [ ] Test đường denied không đọc secret và không fetch ngoài policy.
  - [ ] Không thay containment để làm UI demo gửi request thành công.
  - [ ] Nếu mở execution, bổ sung identity, origin và requested capability rõ ràng.
  - [ ] Nếu mở execution, bổ sung egress, cancellation, budgets và receipts cùng atom.
  - [ ] Chạy integration cho cả success hợp lệ và deny an toàn.
  - [ ] Cập nhật canonical AI runtime khi evidence thật cho phép đổi trạng thái.
## M09 — Video/audioGeneration/TTS còn thiếu transport
- [ ] Giữ BLOCKED cho execution ba modality chưa có adapter.
  - [ ] UI phải phân biệt lưu lựa chọn với gọi transport thật.
  - [ ] Không dựng success giả hoặc lấy chat text làm kết quả media.
  - [ ] Chốt adapter protocol cho từng modality trước implementation.
  - [ ] Xác định sync response hay async job và states polling tương ứng.
  - [ ] Định nghĩa mapping provider errors sang lỗi ổn định đã redaction.
  - [ ] Định nghĩa idempotency để retry không tạo job trả phí trùng.
  - [ ] Định nghĩa cancel capability của provider và giới hạn khi không hỗ trợ.
  - [ ] Chỉ bật transport sau contract/integration acceptance riêng từng modality.
## M10 — Secret boundary và IPC
- [ ] Chứng minh không secret renderer trên đường Settings và execution.
  - [ ] Chỉ trả metadata provider/model qua preload.
  - [ ] Giữ credential values ở Main hoặc runtime cách ly được chấp thuận.
  - [ ] Validate sender, account binding và bounded payload tại IPC.
  - [ ] Không đưa token vào helper props, config refs hoặc React state.
  - [ ] Test canary secret không xuất hiện trong lỗi, log hoặc snapshot UI.
  - [ ] Không dùng lựa chọn defaults như grant microphone/filesystem/network.
  - [ ] Kiểm tra quyền lại trước dispatch nếu consent thay đổi giữa save và run.
  - [ ] Giữ broker policy dùng chung, không thêm direct fetch trong renderer.
## M11 — Media input/output và egress
- [ ] Ràng buộc tài nguyên media ở Main/transport seam.
  - [ ] Giới hạn upload bytes và duration trước gọi provider.
  - [ ] Validate MIME thực tế thay vì chỉ tin filename hoặc header.
  - [ ] Giới hạn output artifact count và kích thước tổng.
  - [ ] Xem URL output từ provider là input không tin cậy.
  - [ ] Kiểm tra SSRF, destination và redirect trước download artifact.
  - [ ] Không đưa đường dẫn filesystem tùy ý sang renderer.
  - [ ] Dùng scoped artifact handle theo contract hiện hữu.
  - [ ] Test oversized media và URL bị cấm không tạo network side effect tiếp.
## M12 — Cancellation xuyên vòng đời
- [ ] Nối hủy từ preflight tới terminal.
  - [ ] Check cancelled trước upload và credential lease mới.
  - [ ] Abort request đang chạy qua transport contract hiện hữu.
  - [ ] Dừng poll timer khi cancel async job.
  - [ ] Gọi cancel provider nếu adapter công bố hỗ trợ.
  - [ ] Nếu provider không hỗ trợ, ghi rõ và chặn publication kết quả muộn.
  - [ ] Test cancel trước dispatch không fetch hoặc upload.
  - [ ] Test completion đến sau cancel không đổi terminal sang success.
  - [ ] Test cleanup artifact tạm không xóa dữ liệu người dùng ngoài scope.
## M13 — Budgets và durable receipts
- [ ] Nghiệm thu resource accounting cho execution được bật.
  - [ ] Chốt deadline tổng bao gồm upload, request, polling và download.
  - [ ] Giới hạn retry/poll count trong budget còn lại.
  - [ ] Không reset trần thời gian khi provider trả transient error.
  - [ ] Ghi usage là reported, estimated hoặc unavailable theo contract.
  - [ ] Receipt ghi modality, resolved IDs và outcome đã redaction.
  - [ ] Test failed/cancelled/blocked đều có terminal receipt bền vững.
  - [ ] Test duplicate callback không double-settlement hoặc tạo terminal trùng.
  - [ ] Test recovery job sau crash không tự tạo job provider mới mất kiểm soát.
## M14 — Migration và rollback
- [ ] Bảo toàn config cũ và kill behavior an toàn.
  - [ ] Đọc config thiếu media defaults thành trạng thái chưa cấu hình.
  - [ ] Không tự migrate sang provider online bất kỳ.
  - [ ] Giữ stale refs để người dùng chọn lại hoặc xóa explicit.
  - [ ] Test round-trip migration đủ năm key không đổi IDs.
  - [ ] Giữ bản gốc khi validation/migration thất bại.
  - [ ] Rollback mount component vẫn giữ `ai.mediaModelDefaults` trong storage.
  - [ ] Kill adapter mới không fallback về client legacy thiếu security boundary.
  - [ ] Ghi rõ thao tác khôi phục và test receipt/config đọc được sau rollback.
## M15 — Cross-spec và gates
- [ ] Đóng handoff triển khai bằng evidence current revision.
  - [ ] Phối hợp `../pipeline-chat/tasks.md` về advisor apply và cancellation preflight.
  - [ ] Advisor phải resolve modality capability trước chọn media default để chạy.
  - [ ] Không dùng pipeline non-guard completed-text hook để tuyên bố media stream đã guarded.
  - [ ] Xác định file helper/component tests hiện hữu rồi chạy `bun run test -- <đường-dẫn-test>`.
  - [ ] Ghi báo cáo 4 tests trước đây là lịch sử, không thay kết quả chạy mới.
  - [ ] Chạy Settings integration để chứng minh mount/i18n reachable.
  - [ ] Chạy contract/integration cho capability, IPC, egress, cancel và receipts.
  - [ ] Chạy `bun run lint`, `bun run format:check`, `bunx tsc --noEmit`, `bun run test`.
  - [ ] Ghi command, revision, exit code và acceptance còn thiếu thay vì chỉ số test.
  - [ ] Review MTUI diff/git status và giữ nguyên dirty paths ngoài allowlist.
  - [ ] Cập nhật canonical khi behavior thực sự đổi; không dùng checklist này thay gate phát hành.
