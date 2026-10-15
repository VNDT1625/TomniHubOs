# Checklist triển khai Chat Composer

## Quy ước bàn giao
- Đây là checklist cấp dưới [MVP canonical](../../execution/mvp-plan.md), không thay lịch hoặc release gate.
- Ngày đọc nguồn: 2026-10-15; chưa sửa composer và chưa chạy test ứng dụng cho yêu cầu này.
- `[x]` chỉ ghi việc audit nguồn đã thực hiện; không chứng nhận tính năng hoàn tất.
- `[ ]` là TARGET; BLOCKED được ghi tên dependency cần giải quyết.
- Owner là vai trò được giao trong checkpoint, không phải tuyên bố đã chạy subagent.
- UI: composer renderer; Catalog: catalog/Settings; Runtime: executor; QA: kiểm chứng; Integrator: contract và tích hợp.
- Mỗi production file chỉ một owner mỗi checkpoint; Integrator duyệt allowlist trước sửa.
- Đường dẫn chưa truy vết phải được chốt trước triển khai, không phải giấy phép sửa toàn thư mục.
- Đọc [yêu cầu](yeu-cau.md) và [kỹ thuật](ky-thuat.md) trước nhận việc.

## 0. Bằng chứng đã đọc
- [x] Đối chiếu GuidActionRow với hành vi toolbar hiện có.
  - [x] Xác nhận hub inventory count > 0 nhưng nằm sau More tại dòng 477-507.
  - [x] Xác nhận agent menu gọi onAgentSwitch tại dòng 183-215.
  - [x] Xác nhận People/Cube/Code gọi callback, chưa phải bằng chứng route đã chạy.
  - [x] Xác nhận Shield dùng cho mode và MCP ở các ngữ cảnh khác nhau.
- [x] Đọc GuidModelSelector và phân biệt model/provider với assistant.
  - [x] Xác nhận Brain là provider fallback; có Auto và reasoning gateway trong nguồn.
- [x] Đọc GuidInputCard về IME, palette package và attachment preview request guard.
- [x] Đọc AssistantSettings/index.tsx và useAssistantList.ts.
  - [x] Xác nhận catalog lấy qua ipcBridge.assistants.list.invoke().
- [x] Đọc common/types/agent/assistantTypes.ts về ID, enabled và bốn source.
- [x] Ghi Rabbit là chưa xác minh; không có bằng chứng cho kết luận speed trong nguồn hẹp đã đọc.

## 1. Khóa phạm vi và dependency
- [ ] P1 — Chốt acceptance atom; owner Integrator; deps: audit 0.
  - [ ] Ghi starting revision và danh sách dirty paths trước sửa.
  - [ ] Chốt allowlist GuidActionRow.tsx, GuidInputCard.tsx, GuidModelSelector.tsx theo từng owner.
  - [ ] Chốt owner duy nhất cho useAssistantList.ts và mọi file shared phát hiện sau.
  - [ ] Cấm lane UI sửa preload, schema, migrations, IPC registration và bootstrap.
  - [ ] Truy vết parent submit, state conversation và runtime resolver; ghi đường dẫn chính xác trong handoff canonical.
  - [ ] Acceptance: mỗi callback có owner và đường tới dispatch được mô tả bằng source evidence.
  - [ ] Test: kiểm tra source/call graph trước thay đổi; không tính là test runtime.
  - [ ] Rollback: hủy atom chưa đủ dependency; không động vào thay đổi người khác.
  - [ ] Migration: xác nhận chưa cần schema ở atom UI.

## 2. Audit biểu tượng còn thiếu
- [ ] P2 — Truy nguyên Rabbit; owner UI; deps P1; file đầu vào GuidActionRow/GuidModelSelector/AgentModeSelector.
  - [ ] Xác định màn hình, variant và asset của icon người dùng gọi là thỏ.
  - [ ] Kiểm tra logo động từ agentSwitcherItems trước khi kết luận icon cố định.
  - [ ] Ghi callback, config key và runtime effect nếu tìm được; nếu không, giữ BLOCKED với thiếu evidence cụ thể.
  - [ ] Không đặt tên speed/fast nếu không có action/config chứng minh.
  - [ ] Lập quyết định từng control: giữ, có nhãn trong More, ẩn khi unavailable.
  - [ ] Acceptance: không xóa nhầm provider logo, permission mode hoặc catalog assistant.
  - [ ] Test: snapshot toolbar trước/sau và kiểm tra control ẩn không còn tab stop.
  - [ ] Rollback: khôi phục presentation của đúng control, giữ backend nguyên trạng.
  - [ ] Migration: không xóa preference hoặc config của control bị ẩn.

## 3. Dùng catalog Settings thật
- [ ] P3 — Tích hợp catalog; owner Catalog; deps P1; files useAssistantList.ts, AssistantSettings/index.tsx theo allowlist.
  - [ ] Xác nhận backend list hiện có trả builtin/user/extension/package thực tế.
  - [ ] Tái dùng catalog endpoint; không thêm danh sách assistant hardcode.
  - [ ] Tách selection của Settings editor khỏi selection của composer.
  - [ ] Map stable ID, locale name, source, enabled và trạng thái khả dụng.
  - [ ] Áp sort Settings; xử lý hai assistant trùng tên bằng ID/source.
  - [ ] Thêm loading/error/empty/retry rõ ràng qua cơ chế query hiện có.
  - [ ] Refresh sau create/edit/enable/disable/delete và quay về từ Settings.
  - [ ] Loại stale response sau switch conversation hoặc refresh đồng thời.
  - [ ] Acceptance: assistant tạo trong Settings xuất hiện mà không sửa mã nguồn.
  - [ ] Test: catalog trống, lỗi IPC, disabled, tên dài, locale fallback và response đảo thứ tự.
  - [ ] Rollback: revert adapter/cache mới, không xóa assistant người dùng.
  - [ ] Migration: không tạo bản sao catalog hoặc ID mới.

## 4. Personal và contract selection
- [ ] P4 — Chốt selection contract; owner Integrator; deps P3; file assistantTypes.ts chỉ sửa nếu cần.
  - [ ] Xác định baseline Personal từ cấu hình thực đang có; BLOCKED đến khi owner runtime xác nhận.
  - [ ] Dùng discriminated union nội bộ để Personal không trùng assistant ID.
  - [ ] Quy định reset context/skills override khi đổi từ assistant về Personal.
  - [ ] Chốt precedence assistant, model override, mode và conversation context.
  - [ ] Xác định engine compatibility và flow cần conversation mới.
  - [ ] Chốt persistence theo conversation; không dùng activeAssistantId Settings như runtime state.
  - [ ] Nếu sửa public type, đồng bộ mirror Rust theo comment trong assistantTypes.ts.
  - [ ] Acceptance: tài liệu contract giải thích được A → Personal → B không rò cấu hình A.
  - [ ] Test: reducer và resolver với missing/disabled ID, Personal và incompatible engine.
  - [ ] Rollback: ngừng ghi field mới, tiếp tục đọc legacy an toàn.
  - [ ] Migration: additive optional metadata nếu cần; không backfill lịch sử từ nhãn UI.

## 5. Selector có nghĩa và thao tác thật
- [ ] P5 — Xây selector; owner UI; deps P2-P4; file GuidActionRow.tsx và component mới chỉ sau duyệt vị trí.
  - [ ] Hiển thị chữ Assistant và tên Personal/assistant đang chọn.
  - [ ] Render danh sách từ catalog adapter, dùng ID làm key.
  - [ ] Có selected state và thông tin nguồn khi cần phân biệt.
  - [ ] Thêm đường mở Settings, giữ draft khi đi/về.
  - [ ] Thay icon khó hiểu bằng control có nhãn; không thêm icon-only mới để thay Rabbit.
  - [ ] Đưa model/mode/reasoning vào cấu hình có tên; không xóa callback backend.
  - [ ] Giữ giá trị lựa chọn khi đóng popup; không fallback âm thầm sang item đầu.
  - [ ] Acceptance: chọn B cập nhật draft selection ID và được submit đọc ở P6.
  - [ ] Test: click, keyboard, empty/error, chọn lại cùng item, disabled assistant.
  - [ ] Rollback: khôi phục toolbar cũ qua presentation gate đã được duyệt.
  - [ ] Migration: không sửa bản ghi assistant từ thao tác chọn.

## 6. Áp dụng vào lượt kế tiếp
- [ ] P6 — Nối transaction gửi; owner Runtime + Integrator phân file riêng; deps P4-P5.
  - [ ] Chốt exact files submit/resolver/evidence từ P1 trước khi sửa.
  - [ ] Snapshot text, attachments, selection, model và mode một lần khi submit.
  - [ ] Resolve ID ở main; reject unknown/disabled/revoked trước admission.
  - [ ] Áp context, skills và engine theo contract; không nhận provenance renderer tự khai.
  - [ ] Chống stale closure để lượt sau dùng B thay vì A.
  - [ ] Đóng băng snapshot sau admission; đổi dropdown không mutate run đang stream.
  - [ ] Chặn duplicate submit khi click và Enter đồng thời.
  - [ ] Ghi assistant thực thi vào evidence/receipt theo schema đã duyệt.
  - [ ] Acceptance: hai turn liên tiếp A/B có payload/context thực khác đúng cấu hình.
  - [ ] Test integration: kiểm tra resolver output, dispatch và receipt, không chỉ label UI.
  - [ ] Test âm tính: forged package provenance, revoked capability, deleted assistant.
  - [ ] Rollback: disable đường chọn mới; giữ lifecycle và audit, không nới admission.
  - [ ] Migration: schema mới chỉ Integrator sở hữu và có backward-read proof.

## 7. Inventory đứng trước dấu ba chấm
- [ ] P7 — Sửa bố cục inventory; owner UI; deps P1; files GuidActionRow.tsx, GuidInputCard.tsx.
  - [ ] Đưa inventory trước More trong DOM của hub.
  - [ ] Xác định các composer/variant reachable và áp quy tắc tương đương cho default.
  - [ ] Không render control khi count = 0, không để spacer hoặc tab stop thừa.
  - [ ] Dedupe count theo attachment ID; cùng file được mention nhiều lần vẫn count một.
  - [ ] Xóa tệp cuối đóng rail/preview và trả focus về trigger còn tồn tại.
  - [ ] Tạo aria-controls riêng cho từng composer nếu nhiều instance đồng thời.
  - [ ] Giữ pending/failed trạng thái nhìn thấy và không gửi attachment chưa ready.
  - [ ] Acceptance: thứ tự đọc/Tab/hình ảnh đều inventory → More với 1 và nhiều tệp.
  - [ ] Test component: 0 → 1 → n → 0; count lớn; callback thiếu; responsive wrap.
  - [ ] Rollback: revert riêng bố cục; không xóa attachment registry hay tệp.
  - [ ] Migration: không thay storage hoặc format semantic references.

## 8. Toàn bộ luồng attachment và nhập liệu
- [ ] P8 — Regression nhập liệu; owner QA/UI phân file; deps P5-P7; GuidInputCard.tsx và tests được duyệt.
  - [ ] Kiểm tra picker desktop, picker WebUI và input thiết bị riêng.
  - [ ] Kiểm tra cancel picker giữ draft/count không đổi.
  - [ ] Kiểm tra paste/drop nhiều file, duplicate, upload error và retry.
  - [ ] Kiểm tra remove reference khác remove attachment khỏi inventory.
  - [ ] Kiểm tra preview inline/inventory loại trừ nhau và response cũ bị bỏ.
  - [ ] Kiểm tra đổi conversation khi preview/upload đang pending.
  - [ ] Kiểm tra IME tiếng Việt, Enter/Shift+Enter và caret sau chọn slash.
  - [ ] Kiểm tra mở selector không reset văn bản, mention, workspace hoặc attachment.
  - [ ] Acceptance: không mất draft và không gửi path/handle trái quyền.
  - [ ] Test: component + integration attachment; E2E picker thực theo nền tảng hỗ trợ.
  - [ ] Rollback: tắt interaction mới, giữ dữ liệu và bằng chứng lỗi để xử lý.
  - [ ] Migration: không xóa dữ liệu upload đang dùng bởi lịch sử.

## 9. Full chat lifecycle
- [ ] P9 — Kiểm chứng vòng đời; owner Runtime/QA; deps P6-P8; exact test files do P1 chốt.
  - [ ] New chat với Personal và assistant cấu hình riêng.
  - [ ] Follow-up sau chuyển A → B và B → Personal.
  - [ ] Chuyển selector lúc streaming, kiểm tra run cũ giữ A và lượt mới dùng B.
  - [ ] Stop/cancel trong text streaming và tool pending, kiểm tra terminal receipt.
  - [ ] Provider error/timeout: giữ draft phù hợp và retry không nhân đôi run.
  - [ ] Retry dùng snapshot cũ; gửi lại với assistant mới được phân biệt rõ.
  - [ ] Edit/resend tạo turn mới, giữ lineage của message gốc.
  - [ ] Branch/reopen/reload giữ assistant identity lịch sử, không đọc nhãn draft để ghi đè.
  - [ ] Switch conversation nhanh không dùng selection hoặc attachment của conversation trước.
  - [ ] Reconnect WebUI không tạo hai send khi event được phát lại.
  - [ ] Tool approval allow/deny, tool result, artifact và final answer gắn đúng run.
  - [ ] Acceptance: mỗi governed run có durable transitions, usage và terminal receipt.
  - [ ] Test integration lifecycle + E2E đường chính; ghi revision và exit codes.
  - [ ] Rollback: dùng kill switch admission mới, không xóa run đang lưu.
  - [ ] Migration: đọc conversation legacy thiếu metadata mà không bịa assistant quá khứ.

## 10. Extension và Store/package
- [ ] P10 — Kiểm chứng package track; owner Package/QA; deps P3,P6,P9; shared files do Integrator giữ.
  - [ ] Assistant source extension/package xuất hiện đúng catalog và có provenance main-owned.
  - [ ] Package chưa cài không tạo lựa chọn giả hoặc import implementation vào core.
  - [ ] Disable/uninstall trước submit chặn selection cũ và giữ draft.
  - [ ] Uninstall khi run đang hoạt động tuân lifecycle canonical, không tùy tiện đổi assistant.
  - [ ] Reinstall không tái sử dụng quyền đã thu hồi; refresh catalog đúng ID thực.
  - [ ] Slash contribution vẫn hoạt động khi selector mở/đóng, không nuốt Enter sai menu.
  - [ ] Skills/MCP toggle không bị reset ngoài precedence đã công bố.
  - [ ] Super/browser tools vẫn yêu cầu approval, secret boundary và egress policy.
  - [ ] Workspace đổi/clear revalidate phạm vi file và quyền tool.
  - [ ] Hook lỗi/timeout/cancel không bypass safety envelope hoặc chặn UI vô hạn.
  - [ ] Acceptance: core chạy khi package vắng mặt và hành vi unavailable giải thích rõ.
  - [ ] Test integration package/permission; clean absence/install/uninstall proof nếu có extraction.
  - [ ] Rollback: ẩn contribution mới, giữ package records và audit; không hạ kiểm tra chữ ký.
  - [ ] Migration: không xóa registry hoặc quyền của ứng dụng khác.

## 11. A11y, i18n, theme và responsive
- [ ] P11 — Hoàn thiện khả năng dùng; owner UI/QA; deps P5,P7; files tomni-ui.css và locale files được xác định.
  - [ ] Mọi icon action có accessible name; icon trang trí aria-hidden.
  - [ ] Tooltip hover/focus, menu click/Enter/Space; không hover-only.
  - [ ] Arrow/Home/End điều hướng, Escape đóng và trả focus; Tab không bị mắc kẹt.
  - [ ] Selected/expanded/disabled được screen reader đọc đúng.
  - [ ] Thông báo lỗi selection và upload qua live region phù hợp, không spam từng token.
  - [ ] Chuỗi Assistant/Personal, count, tooltip, empty/loading/error đi qua i18n.
  - [ ] Xử lý pluralization và locale fallback; không hardcode File(n).
  - [ ] CSS chỉ ở stylesheet toàn cục; dùng token, không tạo CSS module mới.
  - [ ] Cập nhật design-system canonical và mockup cùng thay đổi look.
  - [ ] Kiểm tra dark/light, focus, selected và disabled không phụ thuộc màu đơn lẻ.
  - [ ] Kiểm tra 320/375/768/1280 px, zoom 200%, tên dài và bàn phím ảo.
  - [ ] Acceptance: send luôn truy cập được và inventory luôn trước More.
  - [ ] Test keyboard/screen-reader manual + component/E2E; lưu evidence đúng revision.
  - [ ] Rollback: revert token/class mới theo phạm vi, không reset theme người dùng.
  - [ ] Migration: i18n keys additive; không xóa key còn được caller khác dùng.

## 12. Gates và bàn giao implementation
- [ ] P12 — Tích hợp; owner Integrator; deps P1-P11.
  - [ ] Review MTUI diff và git status, tách rõ dirty paths không thuộc task.
  - [ ] Chạy test nhỏ theo atom trước; không đánh dấu pass nếu chưa chạy.
  - [ ] Chạy `bun run lint` và ghi exit code.
  - [ ] Chạy `bun run format:check` và ghi exit code.
  - [ ] Chạy `bunx tsc --noEmit` và ghi exit code.
  - [ ] Chạy `bun run test` và ghi exit code.
  - [ ] Chạy `bun run i18n:types` và `node scripts/check-i18n.js` khi sửa UI text/i18n.
  - [ ] Nếu gate fail do baseline, ghi bằng chứng và owner; không tuyên bố candidate pass.
  - [ ] Cập nhật status CURRENT/PARTIAL trong canonical owner khi có evidence runtime mới.
  - [ ] Bàn giao changed files, commands, exit codes, migration, rollback, risks và conflicts.
  - [ ] Không commit/push nếu chưa có yêu cầu rõ ràng.
  - [ ] Acceptance: A/B runtime proof, inventory order proof, package/security proof và UI matrix đủ.
  - [ ] Rollback rehearsal: khôi phục UI cũ mà không mất draft/history hoặc bypass quyền.
  - [ ] Migration rehearsal: legacy read và additive rollback được chứng minh nếu có schema mới.

## 13. Trạng thái kết thúc đặc tả
- Các mục P1-P12 chưa triển khai trong yêu cầu tạo tài liệu này.
- Không có tuyên bố lint/typecheck/unit/integration/E2E hiện tại đã pass.
- Rabbit owner, Personal runtime mapping và exact submit/resolver files là dependency còn phải xác minh.
- Chỉ ba tệp yeu-cau.md, ky-thuat.md, tasks.md thuộc phạm vi bàn giao này; không tạo README.
