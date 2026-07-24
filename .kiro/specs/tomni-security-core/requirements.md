# Requirements Document

## Introduction

Tài liệu này định nghĩa lõi Security/Trust cho TomniHubOS. Phạm vi của tab này là thiết kế và triển khai các cổng kiểm soát dữ liệu trước khi dữ liệu rời máy; không thay thế password store, permission system, IPC bridge, ResourceCoordinator, Secret Firewall, file security hay image OCR hiện có.

Giai đoạn triển khai bắt đầu bằng **kiểm tra văn bản trước khi gửi ra ngoài**. Mọi chức năng phải fail-closed: nếu bộ kiểm tra, quyền, cầu nối hoặc AI hỗ trợ bị lỗi thì không được tự động cho phép gửi.

## Glossary

- **Outbound boundary:** điểm ngay trước khi nội dung được gửi tới provider, agent, tool, browser, remote gateway, command runner hoặc upload.
- **Text inspection:** nhận diện dữ liệu nhạy cảm, trả quyết định và bản làm sạch; không giữ plaintext trong receipt/log.
- **Decision:** `allow`, `sanitize`, `block` hoặc `approval_required`.
- **Sensitive finding:** metadata về loại, mẫu và độ tin cậy; không chứa giá trị bí mật, vị trí nguyên văn hay đoạn trích.
- **User decision:** lựa chọn rõ ràng của người dùng khi chính sách yêu cầu phê duyệt; không được suy ra từ timeout hay lỗi UI.
- **Safe failure:** lỗi xử lý được chuyển thành deny/block hoặc approval_required, không thành allow.
- **Tab 1 handoff:** yêu cầu ghép chung mà Tab 1 phải thực hiện trong các file shared/bridge/bootstrap mà Tab Security không sửa.

## 1. Hiện trạng và nguyên tắc tái sử dụng

1. Secret Firewall hiện có ở `packages/desktop/src/process/agentRuntime/agentMesh/security/` phải là primitive nhận diện/redact chính.
2. `redactSecretFileText` và `sensitiveFiles.ts` tiếp tục là nền cho nội dung đọc từ file; không tạo detector thứ hai.
3. `scanImageForSensitiveText` và đường OCR local hiện có được gọi lại ở phase kiểm tra file/ảnh; ảnh không được gửi nếu OCR bắt buộc nhưng không chạy được.
4. Auth/password và session/bearer auth hiện có chỉ xác thực người dùng hoặc gateway; chúng không được dùng làm quyết định nội dung.
5. IPC phải đi qua preload và bridge hiện có. Renderer không được đọc password, token, file hệ thống hoặc tự cấp quyền.
6. ResourceCoordinator vẫn là nguồn sự thật cho tác vụ nặng như OCR/model 0.8B; không tạo semaphore riêng.

## Requirements

### Requirement 1: Kiểm tra mọi văn bản trước khi rời máy

**User Story:** Là người dùng, tôi muốn hệ thống kiểm tra nội dung trước khi gửi đến bất kỳ đích bên ngoài nào.

#### Acceptance Criteria

1. Tất cả đường gửi văn bản của chat/conversation, agent, tool, browser, command line, file-derived text và provider/API request phải đi qua một outbound inspection contract dùng chung.
2. Contract nhận `surface`, `target`, `conversationId`/`runId` nếu có, content parts, sensitivity context và requested capability; không nhận password/token plaintext từ renderer.
3. Inspection chạy trước khi request body, WebSocket event, multipart metadata hoặc tool argument chứa văn bản được phát ra.
4. Không đường tắt trực tiếp từ renderer được coi là an toàn chỉ vì đích là localhost; localhost backend có thể tiếp tục gửi ra ngoài.
5. Nếu không xác định được boundary hoặc contract version thì từ chối an toàn.

### Requirement 2: Nhận diện và làm sạch dữ liệu nhạy cảm

**User Story:** Là người dùng, tôi muốn dữ liệu nhạy cảm được che hoặc bị chặn thay vì bị gửi nguyên văn.

#### Acceptance Criteria

1. Tái sử dụng `redactSecretText`, `redactSensitiveText`, `redactSecretFileText` và metadata types hiện có.
2. Kết quả phải phân biệt ít nhất: không phát hiện, đã làm sạch, cần chặn, cần phê duyệt.
3. Bản làm sạch dùng marker ổn định như `[REDACTED]`; findings chỉ chứa metadata an toàn.
4. Không ghi plaintext vào log, receipt, telemetry, error, UI state dài hạn, cache hoặc prompt của AI kiểm tra.
5. Việc đã che một phần không mặc nhiên cho phép gửi; policy quyết định dựa trên loại finding, đích và quyền.
6. Nội dung đã được che sẵn không bị che lặp vô hạn hoặc tạo leakage qua metadata.

### Requirement 3: Chính sách và quyền gửi đi

**User Story:** Là người dùng, tôi muốn biết vì sao dữ liệu bị chặn và tự quyết định khi chính sách yêu cầu.

#### Acceptance Criteria

1. Policy preflight chạy sau inspection và trước network/tool/browser/file send.
2. Policy có thể trả `allow`, `sanitize`, `block`, `approval_required`; không có implicit allow khi timeout, thiếu policy hoặc lỗi bridge.
3. Quyết định gắn với actor, target, surface, scope, capability, thời hạn và correlation id.
4. Permission hiện có được gọi lại; không tạo password vault hoặc permission broker thứ hai trong tab này.
5. Approval request không chứa secret plaintext; user chỉ được xem lý do, loại dữ liệu, đích, tác động và bản preview đã làm sạch.
6. Quyết định hết hạn, revoke hoặc mismatch target phải trở thành deny.

### Requirement 4: Trạng thái và giao diện quyết định

**User Story:** Là người dùng, tôi muốn thấy trạng thái kiểm tra, lý do chặn/làm sạch và quyền quyết định ngay trên giao diện.

#### Acceptance Criteria

1. Renderer nhận projection an toàn qua preload/IPC bridge; không tự chạy detector Main hoặc Node API.
2. UI hiển thị trạng thái `checking`, `sanitized`, `blocked`, `approval_required`, `allowed`, `failed_closed` và trạng thái gửi.
3. UI hiển thị reason code, loại finding ở mức khái quát, đích gửi, hành động đã thực hiện và nút lựa chọn khi có approval.
4. UI không hiển thị giá trị bí mật, regex capture, token prefix, đường dẫn nhạy cảm đầy đủ hoặc nội dung file nguyên văn không cần thiết.
5. Đóng UI, hết thời gian chờ hoặc mất kết nối không được biến approval thành allow.
6. Chuỗi hiển thị phải dùng i18n; không hardcode text mới trong component.

### Requirement 5: File và ảnh

**User Story:** Là hệ thống, tôi muốn file và ảnh không trở thành đường vòng để gửi dữ liệu chưa kiểm tra.

#### Acceptance Criteria

1. File text được phân loại theo tên/path và nội dung bằng security primitive hiện có trước khi được đưa vào context/tool/provider.
2. Upload raw bytes phải có contract quyết định rõ: nội dung được kiểm tra trước upload, hoặc upload vào quarantine trước khi commit/gửi ngoài.
3. Ảnh phải qua local OCR bắt buộc khi target/provider có thể đọc ảnh; OCR failure là block.
4. Ảnh chứa finding bị block hoặc đưa vào approval theo policy; không gửi bản gốc khi chưa có quyết định.
5. File/ảnh tạm được dọn trong success, failure, cancellation và timeout; không ghi credential vào tên file/log.

### Requirement 6: AI 0.8B chỉ là lớp hỗ trợ sau cùng

**User Story:** Là hệ thống, tôi muốn AI nhỏ hỗ trợ phân loại nhưng không có quyền gửi hoặc giữ bí mật.

#### Acceptance Criteria

1. AI 0.8B chỉ được nối sau khi detector thông thường, policy, bridge, UI và tests ổn định.
2. Input cho AI là dữ liệu tối thiểu đã được che/biến đổi; password/token không được đưa trực tiếp.
3. AI không được giữ secret, gọi network, chọn target, cấp permission hoặc tự quyết định allow.
4. AI timeout, crash, output không hợp lệ hoặc confidence thấp phải chuyển sang block/approval theo fail-closed policy.
5. Quyết định cuối cùng luôn do policy + quyền + user decision hiện có.

### Requirement 7: Kiểm thử, audit và đa ngôn ngữ

**User Story:** Là nhóm phát triển, tôi muốn mỗi lớp đều có bằng chứng kiểm thử và tài liệu.

#### Acceptance Criteria

1. Pure detector/policy tests bao phủ secret formats, false positives, nested content, already-redacted content và Unicode/size bounds.
2. Contract tests chứng minh deny/sanitize/approval xảy ra trước HTTP, WebSocket, tool, browser, command và upload side effect.
3. IPC tests chứng minh renderer chỉ nhận safe projection và unknown/error path fail-closed.
4. UI/DOM tests kiểm tra trạng thái, lý do, nút approval, i18n key và không hiển thị plaintext.
5. Audit receipt chỉ chứa metadata bounded, schema version, decision, reason, target, actor, timestamps và correlation; không chứa secret.
6. Tài liệu phải ghi allowlist file, owner, đường ghép với Tab 1 và cách rollback.

## 2. Ngoài phạm vi

- Không thay password hashing, session token, gateway auth, existing permission implementation hoặc Secret Vault.
- Không thay ResourceCoordinator, Agent Mesh, browser runtime, tool executor, upload backend hay OCR algorithm; chỉ thêm adapter/gate ở boundary được owner chấp thuận.
- Không đưa AI 0.8B vào phase đầu.
- Không sửa file shared thuộc Tab 1; các thay đổi cần thiết phải ghi thành handoff.

## 3. Thứ tự triển khai bắt buộc

1. Text inspection pure processing.
2. Outbound policy/control gate.
3. Main/preload/renderer bridge và UI status/approval.
4. Integration vào từng outbound surface, từng surface hoàn chỉnh có test.
5. File và ảnh quarantine/OCR gate.
6. AI 0.8B hỗ trợ, fail-closed.

## 4. Yêu cầu ghép chung cho Tab 1

Tab 1 phải thực hiện các thay đổi shared sau khi contract được chốt:

- Cung cấp hoặc mở rộng outbound boundary chung cho `conversation.sendMessage`, agent/tool dispatch, browser/command/file/image send và provider requests; không để Security patch từng UI send box riêng lẻ.
- Thêm registration/bootstrap cho Main security inspection service và preload bridge theo đúng ownership của Tab 1.
- Giữ nguyên các primitive Security hiện có; chỉ expose adapter contract, safe projection và event channel.
- Cập nhật shared types/i18n registration nếu chúng thuộc allowlist Tab 1.
- Không đưa credential plaintext vào IPC payload, logs, receipts hoặc renderer store.
- Bổ sung rollback flag/config để tắt integration mới theo fail-closed (tắt nghĩa là chặn outbound, không allow).
- Cập nhật docs architecture và ownership matrix; mọi file giao thoa phải có owner rõ ràng trước khi sửa.

## 5. Đường dữ liệu cần lập bản đồ và xác nhận

- Chat: mọi conversation send box và skill-generated prompt.
- Agent: Agent Mesh, ACP, remote/openclaw/nanobot/tomnyagentic dispatch.
- Tool: MCP/IDE tools, command output/arguments, tool results.
- Browser: navigation, page perception, browser automation, extracted page text/media.
- Command line: cwd, command, args, stdout, stderr, generated scripts.
- File: reads, previews, attachments, uploads, file-derived context.
- Image: clipboard/attachment, OCR text, multimodal payload, screenshots/artifacts.
- Provider/gateway: REST, WebSocket, streaming and multipart paths, including direct renderer `fetch` paths.

Mỗi đường phải ghi `source -> inspection -> policy -> user decision (nếu có) -> side effect -> receipt` và có test chứng minh thứ tự.
