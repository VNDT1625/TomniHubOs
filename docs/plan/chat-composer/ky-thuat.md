# Thiết kế kỹ thuật bàn giao Chat Composer

## 1. Trạng thái và ranh giới
- TARGET cho thiết kế; CURRENT chỉ áp dụng audit nguồn trong [yêu cầu](yeu-cau.md).
- Tài liệu cấp dưới [pipeline](../../core/chat-pipeline.md), [execution](../../core/chat-execution-flow.md), [trust](../../core/trust-and-understanding.md).
- Không mở thêm kiến trúc cạnh tranh với [target](../../architecture/target.md) hoặc lịch [MVP](../../execution/mvp-plan.md).
- Lần này chỉ tài liệu; không có migration, production edit hoặc test ứng dụng đã chạy.
- Source review ngày 2026-10-15 là working tree bẩn, MTUI map báo stale; nguồn đọc trực tiếp ưu tiên hơn map.

## 2. Owner và vùng mã dự kiến
- UI owner: `packages/desktop/src/renderer/pages/guid/components/GuidActionRow.tsx`.
- UI owner: `packages/desktop/src/renderer/pages/guid/components/GuidInputCard.tsx`.
- Model owner: `packages/desktop/src/renderer/pages/guid/components/GuidModelSelector.tsx`.
- Catalog owner: `packages/desktop/src/renderer/hooks/assistant/useAssistantList.ts`.
- Settings owner: `packages/desktop/src/renderer/pages/settings/AssistantSettings/index.tsx`.
- Integrator sở hữu `packages/desktop/src/common/types/agent/assistantTypes.ts` nếu thực sự cần thay contract.
- Style owner dùng duy nhất `packages/desktop/src/renderer/styles/tomni-ui.css`.
- Khi đổi look, cập nhật đồng thời `docs/product/tomni-design-system.md` và `mockup/home-wireframe-v3.html`.
- Đường dẫn parent submit, conversation store và executor phải truy vết trước khi cho phép sửa; chưa xác định ở audit hẹp.
- Các đường dẫn chưa xác định là dependency BLOCKED, không được tự coi đã audit hoặc tự tạo API mới.

## 3. Catalog và định danh
- CURRENT: Settings gọi `useAssistantList`; hook gọi `ipcBridge.assistants.list.invoke()`.
- CURRENT: hook giữ active selection cho màn hình quản lý, không chứng minh runtime selection.
- CURRENT: AssistantSource gồm builtin, user, extension, package.
- CURRENT: `Assistant` chứa enabled, preset_agent_type, context, skills, prompts, models.
- TARGET: tạo adapter view từ catalog này; không sao chép danh sách vào Guid constants.
- Sort và locale dùng quy tắc Settings; không dùng label làm khóa.
- Chỉ đưa metadata cần hiển thị vào selector; không chuyển secret vào renderer/model.
- Cache phải refresh sau thay đổi Settings và package lifecycle bằng cơ chế hiện có đã xác minh.
- Chặn response catalog cũ ghi đè response mới bằng request generation hoặc cancellation.
- Failed refresh giữ snapshot hiển thị có cảnh báo stale, nhưng không cho gửi với ID chưa được xác thực.
- Personal là discriminant UI, không tái sử dụng một chuỗi có thể trùng Assistant.id.
- Đề xuất type nội bộ: `ComposerAssistantSelection = { kind: 'personal' } | { kind: 'assistant'; assistantId: string }`.
- Đây là type TARGET, chưa phải public IPC contract đã tồn tại.
- Mapping Personal phải giữ baseline cá nhân và loại bỏ override assistant của draft trước đó.
- Không tự đồng nhất Personal với nguồn user hoặc với backend Gemini/ACP.

## 4. State và submit transaction
- Tách `draftSelection`, `effectiveTurnSelection` và nhãn lịch sử.
- Draft state được scope theo conversation/draft identity, không biến toàn ứng dụng dùng chung vô tình.
- Submit đọc một snapshot nguyên tử gồm text, attachment IDs, selection, model, mode và capability preferences.
- Resolve catalog và configuration theo ID ở shared execution seam thuộc main.
- Validate nguồn, enabled, package installation và backend compatibility trước khi tạo run.
- Không chấp nhận renderer tự khai packageId hoặc packageConnectionKey như provenance đáng tin.
- Áp assistant context/skills theo precedence đã được canonical owner duyệt; không concat tùy tiện.
- Prompt có thứ tự system/policy, assistant config, conversation context, user input theo contract hiện hành đã xác minh.
- User preferences hoặc assistant understanding không có quyền ghi đè policy.
- Model override phải được giữ nếu hợp lệ; nếu không hợp lệ, báo yêu cầu chọn lại thay vì silently reroute.
- Ghi định danh assistant đã resolve vào evidence của turn qua schema hiện có hoặc thay đổi được Integrator duyệt.
- Config revision/hash nếu cần là TARGET; không giả định Assistant type hiện có trường version.
- Khi submit pending, khóa transaction tránh double click/Enter tạo hai turn.
- Backend reject phải giữ draft và attachment hợp lệ; hiển thị lỗi có thể khắc phục.
- Khi admission thành công, đóng băng effective snapshot; lựa chọn mới chỉ dùng cho lượt sau.
- Cancel/timeout phải đi lifecycle hiện hữu và phát terminal receipt; không tạo đường chạy riêng từ UI.

## 5. Conversation và retry
- Conversation mới resolve selection trước admission đầu tiên.
- Follow-up đọc draft selection mới, không tái dùng closure assistant cũ.
- Conversation đang streaming tiếp tục với effective snapshot cũ khi người dùng đổi dropdown.
- Retry turn lỗi dùng snapshot đã lưu; nếu assistant/package không còn hợp lệ thì chặn và giải thích.
- Edit/resend là turn mới, ghi rõ selection mới và quan hệ với message gốc.
- Branch copy context được phép, không copy quyền hay secret handles quá hạn.
- Restore conversation cũ không có selection metadata phải đọc legacy behavior đã xác minh.
- Không backfill lịch sử bằng tên assistant hiện tại.
- Nếu switch backend cần session mới, tạo flow chuyển session có xác nhận thay vì đổi nhãn giả.
- Remote/WebUI phải dùng bridge và contract tương đương, không gọi Node từ renderer.

## 6. Thay đổi UI có giới hạn
- GuidActionRow cung cấp selector Assistant/Personal rõ tên thay cụm icon không rõ nghĩa.
- Không suy luận Rabbit = fast mode: audit hẹp chưa tìm được renderer/asset tạo biểu tượng đó.
- Trước khi ẩn Rabbit phải xác định instance và callback, tránh xóa mọi logo agent.
- Chuyển model, reasoning, agent mode, skills, MCP vào nhóm có nhãn trong More nếu phù hợp.
- Giữ engine/model khác khái niệm assistant; chọn assistant không phải đổi provider logo.
- People/Cube/Code thiếu handler hoặc package thì ẩn/disable có lý do, không dựng tương tác rỗng.
- Super chỉ hiện rõ ý nghĩa browser capability; toggle vẫn chịu approval và egress kiểm soát.
- Giữ backend, config, bridge và stored data của control bị ẩn.
- Feature switch rollback chỉ thay presentation; không nới permission hoặc phục hồi quyền đã thu hồi.

## 7. Attachment inventory
- CURRENT: hub render inventory khi attachmentCount > 0 và có callback, nhưng sau More.
- TARGET: đưa node inventory trước node More trong DOM; default branch cần cùng quy tắc nếu được dùng.
- Count lấy từ registry attachment của draft, dedupe ID; không đếm reference occurrences.
- Không suy ra semantic attachment chỉ từ đường dẫn local chưa được cấp quyền.
- Trạng thái attachment gồm pending, ready, failed, removed theo lifecycle owner hiện hành.
- Upload pending/failed không trở thành handle hợp lệ trong payload gửi.
- Xóa reference trong văn bản và xóa file khỏi inventory là hai thao tác phải định nghĩa riêng.
- Xóa tệp cuối đóng rail, reset expanded và trả focus an toàn.
- `aria-controls` phải trỏ rail của đúng composer; tránh ID trùng khi có nhiều composer.
- Preview async phải bỏ kết quả stale và cleanup khi unmount/switch conversation.
- CURRENT: GuidInputCard đã có request counter và event `tomni:attachment-preview-open`.
- TARGET: kiểm tra event không gây đóng preview sai conversation và không mở đồng thời hai preview.

## 8. Extension và trust
- Package slash commands từ hook hiện hữu phải giữ caret, IME và menu priority.
- Mention menu đang mở không bị Enter của assistant selector làm submit.
- Assistant package metadata không được cấp tool permission tự động.
- Skills/MCP selections là yêu cầu capability; Hub policy quyết định khả năng thực thi.
- Kiểm tra install/disable/uninstall ở admission và trước tool invocation theo canonical contract.
- Package hooks phải có timeout, cancellation, payload bounds, origin và audit.
- Không gọi implementation package từ core để hỗ trợ selector.
- Workspace đổi hoặc clear phải revalidate attachment scope và quyền liên quan.
- Speech input tiếp tục qua flow hiện hữu; trạng thái recording chưa xác minh phải được audit trước sửa.

## 9. A11y, i18n và style
- Selector dùng button + menu/listbox semantics nhất quán, không trộn role tùy tiện.
- Accessible name nói Assistant và tên đang chọn; selected/expanded được công bố.
- Keyboard: Tab, Enter, Space, Arrow, Home, End, Escape; focus quay về trigger.
- Tooltip hiện hover/focus; không để hover-only là cách mở menu duy nhất.
- Focus ring đủ thấy ở dark/light; disabled vẫn có giải thích truy cập được.
- Chuỗi mới dùng namespace i18n hiện có sau khi xác định owner; không hardcode File(n).
- Dùng pluralization cho count; nhãn dài và tên người dùng không bị dịch sai.
- CSS chỉ ở tomni-ui.css, không thêm module/inline layout mới.
- Responsive 320 đến 1280 px và zoom 200%; giữ inventory trước More khi wrap.

## 10. Kiểm chứng, migration và rollback
- Unit: selection reducer, catalog mapping, count dedupe, stale response, Personal reset.
- Component: danh sách đúng Settings, keyboard, count 0/1/n và DOM order.
- Integration: A gửi rồi B gửi; kiểm tra resolved context/skills/backend và receipt từng turn.
- Integration âm tính: disabled/deleted/package revoked, forged provenance, permission deny, stale handle.
- E2E: new/follow-up/retry/stop/reopen/branch, attachment, slash/mention và theme matrix.
- Chưa chạy các test này trong lần bàn giao; mọi dòng trên là kế hoạch.
- Migration mặc định không cần đổi DB cho presentation; persistence selection chỉ thêm sau duyệt schema.
- Nếu thêm metadata, dùng additive optional field, đọc legacy an toàn và không sửa lịch sử hàng loạt.
- Rollback UI giữ catalog/backend; rollback metadata giữ dữ liệu, không destructive downgrade.
- Chỉ rollback thay đổi thuộc task; giữ nguyên worktree không liên quan.
- Gate sau implementation: lint, format:check, tsc --noEmit, test, i18n:types và check-i18n theo AGENTS.
