# Kỹ thuật bàn giao Model đa phương thức
## Nguồn và giới hạn
- Đặc tả này phục vụ bàn giao dưới `docs/core/ai-runtime.md`, không thay canonical.
- Tuân theo Trust, package boundary và release gates được dẫn trong `docs/README.md`.
- Chỉ mô tả CURRENT ở phạm vi mã nguồn đã xác nhận; các wiring chưa có đều TARGET.
- Không mở thêm gateway, orchestrator hoặc config store song song.
## Baseline mã nguồn
- CURRENT: `packages/desktop/src/renderer/pages/settings/components/media/MediaModelDefaults.tsx` tồn tại.
- CURRENT: `packages/desktop/src/renderer/pages/settings/components/media/mediaDefaultsContract.ts` tồn tại.
- CURRENT: config `ai.mediaModelDefaults` có refs providerId/modelId cho năm modality.
- Năm key chính xác: `image`, `video`, `audioGeneration`, `tts`, `stt`.
- Lịch sử: 4 tests pass trước đây; không rerun trên revision hiện tại.
- TARGET: mount Settings chưa thực hiện.
- TARGET: translations chưa tích hợp.
- PARTIAL: image/STT transport ở trạng thái contained, không mặc định coi là production-ready.
- BLOCKED: video/audioGeneration/TTS thiếu transport thực thi.
## Ownership
- Component owner chịu rendering, event và trạng thái lựa chọn, không giữ credentials.
- Helper owner chịu representation/validation UI theo contract hiện hữu.
- Config schema/storage owner chịu validation bền vững và compatibility.
- Settings host owner chịu mount, route và lifecycle tải config.
- Main broker owner chịu identity, admission, capability, egress và receipt.
- Adapter owner chịu protocol provider, mapping lỗi và normalized usage.
- Integrator sở hữu shared IPC/schema/bootstrap khi triển khai wiring.
- Trước sửa, xác nhận tên file host/config/adapter hiện hữu; không tạo file thay thế vì chưa biết owner.
## Representation và validation
- Giữ `providerId` và `modelId` như định danh opaque của lựa chọn.
- Không thêm endpoint, API key, credential token hoặc secret lease vào ref renderer.
- Kiểm tra shape, độ dài ID và key modality theo schema hiện hữu.
- Không chấp nhận dữ liệu ngoài schema bằng cast TypeScript không kiểm chứng.
- Phân biệt ref chưa chọn với ref đã chọn nhưng không resolve được.
- Đọc config cũ thiếu object phải trả trạng thái chưa cấu hình tương thích.
- Ghi partial update phải bảo toàn modality không được sửa.
- Chọn model trùng tên khác provider không được làm mất providerId.
- Lỗi validation gửi renderer phải được redaction và dùng semantics ổn định.
## Mount Settings
- Dùng host Settings hiện hữu để đọc config và truyền event cập nhật.
- Mount component một lần đúng lifecycle, tránh reset lựa chọn khi tab đổi.
- Tải provider/model metadata qua preload đã kiểm soát, không gọi Node từ renderer.
- Hiển thị loading, empty, error và unavailable tách biệt.
- Tích hợp namespace i18n hiện hữu cho nhãn, trợ giúp và lỗi.
- Không coi component tồn tại là route đã truy cập được.
- Styling dùng `packages/desktop/src/renderer/styles/tomni-ui.css`.
- Nếu đổi diện mạo, đồng bộ `docs/product/tomni-design-system.md` và `mockup/home-wireframe-v3.html`.
## Resolve capability tại runtime
- Nhận modality yêu cầu cùng identity/account và ref đã chọn.
- Main đọc provider metadata và kiểm tra provider còn enabled, thuộc account hợp lệ.
- Resolve adapter thực tế và capability được công bố theo runtime contract.
- Kiểm tra modality, input format, giới hạn output và policy trước credential access.
- Từ chối ref stale hoặc model không hỗ trợ bằng lỗi xác định.
- Không dùng catalog listing như giấy phép chạy network transport.
- Không fallback cloud im lặng khi local/default không khả dụng.
- Advisor pipeline chỉ được đề xuất trong tập capability đã resolve và policy cho phép.
- Việc thay default giữa run chỉ áp dụng run sau, trừ hành vi explicit được định nghĩa.
## Transport và containment
- Image/STT giữ containment hiện tại cho tới khi đủ contract/integration acceptance.
- Không gỡ containment chỉ để chứng minh UI selection hoạt động.
- Video/audioGeneration/TTS cần adapter contract trước khi thêm nút chạy thực tế.
- Adapter mới định nghĩa sync response hoặc async job, polling và terminal states.
- Job async cần idempotency phù hợp provider để retry không tạo phí trùng.
- Output URL là input không tin cậy, phải qua destination policy trước tải.
- Kiểm tra MIME thực tế, bytes và duration, không chỉ tin metadata provider.
- Artifact delivery dùng handle có scope, không đưa filesystem path tùy ý sang renderer.
## Cancellation, budgets và receipts
- Cancel trước preflight phải ngăn upload và credential lease mới.
- Abort trong request phải truyền tới transport và dọn tài nguyên có giới hạn.
- Cancel polling phải dừng lịch poll và yêu cầu cancel provider nếu API hỗ trợ.
- Nếu provider không hỗ trợ cancel, ghi rõ giới hạn và chặn publication muộn.
- Budget tổng bao gồm thời gian, bytes, số retry/poll và usage theo contract.
- Deadline của lần retry không được vượt thời gian còn lại của run.
- Receipt ghi modality, resolved provider/model, outcome và normalized usage.
- Không ghi media nhạy cảm hoặc credentials vào receipt để giải thích lựa chọn.
- Terminal phải bền vững và chống double-settlement sau timeout/completion race.
## Migration và rollback
- Dùng config owner hiện hữu cho migration, không tạo database defaults riêng.
- Missing defaults không được migrate thành provider online bất kỳ.
- Ref không còn resolve phải giữ dữ liệu để người dùng chọn lại hoặc xóa explicit.
- Rollback component mount không xóa object `ai.mediaModelDefaults`.
- Kill adapter mới phải giữ deny rõ ràng, không route qua client legacy thiếu bảo vệ.
- Migration thất bại phải giữ bản gốc và có đường khôi phục được kiểm thử.
## Verification và phụ thuộc
- Xác định file tests của helper/component hiện hữu, rồi chạy `bun run test -- <đường-dẫn-test>`.
- Test round-trip đủ năm modality và partial update không mất dữ liệu.
- Test Settings route thực tế để chứng minh mount và i18n đã wiring.
- Integration test Main resolve capability, policy denial và không fetch khi unsupported.
- Integration test cancellation trước upload, trong request và khi completion đến muộn.
- Integration test budget, receipt recovery và credential không qua bridge.
- Gates: `bun run lint`; `bun run format:check`; `bunx tsc --noEmit`; `bun run test`.
- I18n: `bun run i18n:types`; `node scripts/check-i18n.js`.
- Phối hợp `../pipeline-chat/ky-thuat.md` để dùng cùng cancellation và model selection seam.
- Pipeline output guard vẫn unsupported; non-guard completed-text hook không bảo vệ stream media.
- Các lệnh trên là yêu cầu triển khai sau, không phải kết quả đã chạy ở lần viết tài liệu này.
