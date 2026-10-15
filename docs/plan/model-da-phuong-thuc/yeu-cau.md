# Yêu cầu bàn giao Model đa phương thức
## Vị trí tài liệu
- Đây là đặc tả bàn giao phụ thuộc canonical, không tạo kiến trúc quy phạm mới.
- Thứ tự nguồn theo `docs/README.md`; provider/capability thuộc `docs/core/ai-runtime.md`.
- Trust thuộc `docs/core/trust-and-understanding.md`; packages thuộc `docs/platform/packages.md`.
- Pipeline phối hợp theo `docs/core/chat-pipeline.md`.
- Gate phát hành thuộc `docs/engineering/testing-and-release.md` và `docs/execution/mvp-plan.md`.
- CURRENT mô tả mã đã có; PARTIAL không được diễn giải thành tính năng sẵn sàng.
## Tiến độ được bàn giao
- CURRENT source: component `components/media/MediaModelDefaults.tsx` đã tồn tại.
- CURRENT source: helper `mediaDefaultsContract.ts` đã tồn tại cạnh component.
- CURRENT source: `ai.mediaModelDefaults` có năm loại refs providerId/modelId.
- Các loại là `image`, `video`, `audioGeneration`, `tts`, `stt`.
- Lịch sử: 4 tests từng pass; chưa chạy lại tại revision hiện tại.
- TARGET: component chưa được mount vào Settings; chưa có đường UI hoàn chỉnh.
- TARGET: translations chưa tích hợp; chưa đủ điều kiện nghiệm thu ngôn ngữ.
- PARTIAL: transport image và STT đang ở trạng thái contained.
- BLOCKED: video, audio generation và TTS chưa có transport.
- Cấu hình chọn model không phải bằng chứng tạo media thành công.
## Phạm vi chức năng
- Cho người dùng đặt model mặc định độc lập cho từng modality.
- Lưu tham chiếu provider/model thay vì endpoint và credential trong refs.
- Hiển thị lựa chọn chưa cấu hình, không hợp lệ, unavailable và sẵn sàng một cách phân biệt.
- Cho phép thay đổi một modality mà không làm mất bốn lựa chọn còn lại.
- Cho phép xóa lựa chọn một cách rõ ràng theo semantics hợp đồng hiện hữu.
- Không tự gửi request trả phí chỉ vì người dùng mở Settings hoặc chọn default.
- Không thêm studio/media application implementation vào base.
- Settings chỉ là quản lý lựa chọn; execution vẫn chịu Hub policy.
## Yêu cầu giao diện
- Mount component tại owner Settings hiện hữu sau khi xác nhận route phù hợp.
- Giữ nhãn năm modality rõ nghĩa, gồm phân biệt audioGeneration với tts.
- Mỗi lựa chọn phải trình bày provider và model để tránh trùng tên model.
- Model không còn tồn tại phải có trạng thái lỗi và thao tác chọn lại.
- Transport chưa có phải hiển thị unavailable, không giả lập success.
- Image/STT contained phải giải thích giới hạn hiện tại bằng văn bản đã dịch.
- Toàn bộ text, empty state và lỗi phải qua i18n.
- Thao tác bàn phím, focus và accessible label phải được kiểm thử.
- CSS chỉ dùng stylesheet toàn cục hiện hữu.
## Yêu cầu hợp đồng
- `ai.mediaModelDefaults` chứa refs cho image/video/audioGeneration/tts/stt.
- Một ref dùng `providerId` và `modelId`; không mang API key hoặc bearer token.
- Validation phải xử lý input không tin cậy và object không hợp lệ.
- Main phải kiểm tra provider/model còn hợp lệ khi lưu và khi thực thi theo contract.
- Không suy luận capability từ tên model, hậu tố hoặc thương hiệu provider.
- Runtime resolve capability theo modality, account, policy và adapter đang khả dụng.
- Model có trong catalog chưa đủ chứng minh transport được cấp quyền chạy.
- Nếu ref stale, không âm thầm chuyển sang cloud provider khác.
- Fallback nếu có phải là lựa chọn được policy và người dùng cho phép.
## Bảo mật và tài nguyên
- Không secret trong renderer, React state, config refs hay payload lỗi.
- Main hoặc runtime cách ly được duyệt giữ và resolve credential handles.
- Egress kiểm tra destination cuối cùng, không tin URL do model output cung cấp.
- Media input/output cần giới hạn bytes, duration, MIME và số lượng artifact.
- Download kết quả phải có policy SSRF và giới hạn redirect theo seam hiện hữu.
- Chọn default không tự cấp quyền microphone, filesystem hoặc network.
- Cancellation phải bao phủ preflight, upload, request, polling và download khi có.
- Retry nằm trong budget tổng, tránh tạo job trả phí trùng lặp.
- Mỗi execution được quản lý phải có usage và terminal receipt bền vững.
- Usage thiếu từ provider phải ghi unavailable/estimated rõ ràng.
## Tiêu chí nghiệm thu
- AC-M01: năm refs được đọc/ghi mà không mất các trường không đổi.
- AC-M02: component được mount và có kiểm thử đường Settings thực tế.
- AC-M03: translations tích hợp, không raw key trên giao diện.
- AC-M04: malformed ref và stale provider bị xử lý xác định.
- AC-M05: runtime từ chối modality không có capability dù UI lưu được ref.
- AC-M06: image/STT không vượt containment hiện tại trước khi đủ acceptance.
- AC-M07: video/audioGeneration/TTS không dispatch khi chưa có transport.
- AC-M08: cancel trước dispatch không phát network side effect mới.
- AC-M09: cancel job đang chạy không bị completion muộn ghi success.
- AC-M10: budget vượt trần kết thúc bằng lỗi ổn định và receipt.
- AC-M11: renderer/log/snapshot không nhận credential thực.
- AC-M12: rollback không xóa ref người dùng và không mở đường execution cũ thiếu kiểm soát.
## Owner và liên kết
- UI owner: `packages/desktop/src/renderer/pages/settings/components/media/MediaModelDefaults.tsx`.
- Helper owner: `packages/desktop/src/renderer/pages/settings/components/media/mediaDefaultsContract.ts`.
- Mount owner: file Settings host hiện hữu; xác định tên trước thay đổi production.
- Config owner: schema/storage hiện đang sở hữu `ai.mediaModelDefaults`, không tạo store song song.
- Runtime owner: broker/adapters Main hiện hữu theo AI runtime canonical.
- Phụ thuộc `../pipeline-chat/yeu-cau.md` về advisor, cancellation và receipts.
- Không dùng output hook non-guard của pipeline để tuyên bố media đã qua guard.
## Migration và bằng chứng
- Config cũ thiếu media defaults phải vẫn đọc được, không tự chọn provider.
- Migration giữ refs stale để người dùng sửa thay vì xóa dữ liệu âm thầm.
- Rollback mount/UI giữ storage tương thích và vô hiệu hóa execution chưa đạt gate.
- Focused helper/component tests: xác định đúng tên file hiện hữu trước chạy `bun run test -- <đường-dẫn-test>`.
- Gates triển khai: `bun run lint`, `bun run format:check`, `bunx tsc --noEmit`, `bun run test`.
- Text/i18n: `bun run i18n:types` và `node scripts/check-i18n.js`.
- Execution mới cần integration tests cho capability, cancellation, egress và receipts.
- Bốn tests lịch sử không thay bằng chứng current-revision hoặc end-to-end.
