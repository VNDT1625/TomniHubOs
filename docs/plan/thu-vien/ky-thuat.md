# Thư viện — thiết kế kỹ thuật

## 1. Thẩm quyền và trạng thái
- TARGET: thiết kế dưới đây bổ sung chi tiết cho canonical, không thay đổi ranh giới của canonical.
- Theo `docs/architecture/target.md`, `docs/core/trust-and-understanding.md`, `docs/platform/packages.md`.
- Theo quy ước tại `docs/engineering/conventions.md` và gate tại `docs/engineering/testing-and-release.md`.
- CURRENT giới hạn: `packages/desktop/src/renderer/pages/integrations/library/LibraryPage.tsx` gọi list/add/repick và lọc tên/path tại renderer.
- PARTIAL: UI có nền tảng; chưa kiểm tra implementation main, index, ingest hoặc delete.
- Các type và operation bên dưới là đề xuất contract, không phải tên API hiện có.

## 2. Ranh giới thành phần
- Renderer chỉ giữ projection; không dùng Node.js để đọc file trực tiếp.
- Main là chủ sở hữu catalog, capability check và giao dịch metadata.
- Preload là cầu nối duy nhất, dùng payload schema có giới hạn.
- Core nhận output package qua published contract, không import downloader/parser chuyên biệt.
- Worker parser cô lập nhận handle được cấp hạn, không nhận quyền toàn filesystem.
- Egress broker kiểm soát mọi fetch của adapter được phép.
- Quyền được kiểm tra tại execution seam, không chỉ tại nút UI.
- CSS dùng `packages/desktop/src/renderer/styles/tomni-ui.css`; mọi nhãn qua i18n.

## 3. Mô hình dữ liệu đề xuất
- `LibraryEntry`: entryId, ownerScope, sourceKind, title, mediaType và lifecycleState.
- `SourceReference`: opaqueHandle, provider/package origin và availabilityState.
- `ManagedContent`: contentId, digest, byteSize, storageHandle và contentVersion.
- `EntryMetadata`: metadataVersion, createdAt, updatedAt và nguồn sửa.
- `Tag`: tagId, scope, displayName và normalizedName.
- `EntryTag`: entryId/tagId có ràng buộc duy nhất trong scope.
- `IndexRecord`: entryId, indexedContentVersion, indexedMetadataVersion và parserVersion.
- `IngestJob`: jobId, entryId, attemptId, state, limits và receiptRef.
- `Tombstone`: entryId, deletionVersion, actor và thời gian lưu tối thiểu.
- Đường dẫn thật và thông tin bí mật không được dùng làm public ID.
- Khóa ngoại và scope check ngăn gắn tag hoặc content xuyên người dùng.
- Content digest hỗ trợ dedupe nhưng không thay thế authorization.

## 4. Persistent index
- Chọn engine sau khi xác nhận database hiện hữu; không tạo kho cạnh tranh tự phát.
- Metadata và outbox index update được commit trong cùng giao dịch.
- Indexer tiêu thụ outbox idempotent theo entryId và version.
- Full-text content là opt-in; metadata index không đòi đọc toàn file.
- Chuẩn hóa Unicode, case và dấu có cấu hình/kiểm thử tiếng Việt.
- Query có giới hạn ký tự, số tag, page size và thời gian xử lý.
- Cursor gắn sort key, entryId và phạm vi query; không nhận SQL từ renderer.
- Filter quyền áp dụng trước trả title, snippet, count và facet.
- Rebuild index dùng generation mới rồi hoán đổi atomically.
- Clear index không xóa catalog; trạng thái rebuilding phải quan sát được.
- Version cũ không được overwrite index version mới hơn.

## 5. IPC đề xuất
- Operation nhóm catalog: list, query, registerReference, updateMetadata, relink.
- Operation nhóm tag: createTag, renameTag, attachTag, detachTag, removeTag.
- Operation nhóm ingest: requestIngest, cancelIngest, getIngestStatus.
- Operation nhóm xóa: removeEntry, deleteManagedContent, clearIndex, clearCatalog.
- Tên cuối cùng do Integrator chốt sau đối chiếu API hiện hữu.
- Request mang requestId, scope và expectedVersion khi có mutation.
- Sender validation đối chiếu origin/window/session và capability tại main.
- Response dùng discriminated result; không rò stack trace hay absolute secret path.
- Error đề xuất: denied, missing, staleVersion, unsupported, limitExceeded, cancelled.
- Event tiến độ có sequence và cursor replay; unsubscribe khi đổi scope.
- Retry mutation dùng idempotency key, không tạo hai mục vì gửi lại.

## 6. Ingest và preview
- Picker tạo handle hẹp; xác nhận file thật trước khi enqueue.
- Symlink, traversal và thay file giữa check/read phải được xử lý tại file broker.
- Sniff MIME và giới hạn nesting, expanded bytes, số entry archive.
- Parser nhận deadline, memory ceiling và abort signal riêng của job.
- Ghi output staging; chỉ publish content/index khi commit hợp lệ.
- Cancel dọn staging; giữ receipt tối thiểu và không publish output muộn.
- Preview dùng nội dung đã kiểm tra, sandbox và CSP phù hợp định dạng.
- Chặn script/macro và request mạng ngầm; link ngoài qua policy.
- Preview cache khóa theo contentVersion và permission epoch.
- Đổi tài liệu tăng request generation để loại response trễ.
- Attachment chat chứa entryId, contentVersion, provenance và đoạn trích được phép.
- Pipeline chọn snapshot nội dung tại lần gọi; file thay đổi sau đó không sửa token đã gửi.

## 7. Xóa, cạnh tranh và phục hồi
- RemoveEntry tạo tombstone trước khi dừng ingest hoặc dọn index.
- Worker phải kiểm tra tombstone/version trước final commit.
- DeleteManagedContent từ chối khi còn reference cần giữ hoặc yêu cầu giải quyết rõ.
- Không map removeEntry thành filesystem unlink cho nguồn ngoài.
- ClearCatalog là batch có phạm vi, checkpoint và receipt; retry không xóa sang scope khác.
- Garbage collector chỉ dọn managed blob không còn tham chiếu sau thời gian chính sách.
- Audit che nội dung/đường dẫn nhạy cảm; retention tuân theo quyền xóa của người dùng.
- Restart replay outbox, đối soát job running thành interrupted hoặc resume an toàn.
- Multi-tab dùng version conflict và event sequence; renderer không là writer quyết định.
- Đóng tab chỉ unsubscribe preview/query, không tự xóa dữ liệu hoặc hủy ingest bền.
- Gỡ package dừng worker theo contract và giữ metadata đọc được.

## 8. Ownership và phụ thuộc
- Integrator: shared schemas, bootstrap, preload/IPC registration, migrations và base routing.
- Library owner: UI/service riêng sau khi được giao exact allowlist; không sửa file chung tự ý.
- Package owner: downloader/parser optional và lifecycle absence/install/uninstall.
- `docs/plan/pipeline-chat`: chốt selection/provenance/token budget trước tích hợp context.
- `docs/plan/model-da-phuong-thuc`: chốt capability định dạng và fallback trước OCR/multimodal.
- `docs/plan/chat-composer`: chốt attachment reference và trạng thái ingest trước UI gửi.
- Ba bộ phụ thuộc chưa được xác minh tồn tại; thiếu contract là BLOCKED cho atom liên quan.
- Migration có backup/đối soát; rollback phải giữ dữ liệu mới không thể downgrade an toàn.
- Kill switch ngừng ingest/download mới nhưng vẫn cho đọc metadata và xuất dữ liệu hợp lệ.

## 9. Xác minh khi triển khai
- Tìm test/script thực tế trước khi chọn lệnh targeted; không suy đoán tên test hiện có.
- Nếu chưa có, thêm contract/integration tests cho quyền, IPC, restart và delete race.
- Chạy `bun run lint`, `bun run format:check`, `bunx tsc --noEmit`, `bun run test` theo gate repository.
- Nếu đổi renderer text/i18n: `bun run i18n:types` và `node scripts/check-i18n.js`.
- Nếu đổi package boundary: bổ sung clean-machine absence/install/uninstall proof.
- Chỉ ghi CURRENT cho đường đi hoặc test thực sự đã được kiểm chứng tại revision bàn giao.
