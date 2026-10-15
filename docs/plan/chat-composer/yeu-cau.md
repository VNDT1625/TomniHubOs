# Yêu cầu bàn giao Chat Composer

## 1. Phạm vi và thẩm quyền
- Ngày đối chiếu nguồn: 2026-10-15; bằng chứng là working tree đang có thay đổi, không phải bản release.
- Đây là đặc tả bàn giao cấp dưới, không thay thế tài liệu canonical hay lịch C0-C6.
- Nguồn chuẩn: [chỉ mục](../../README.md), [pipeline](../../core/chat-pipeline.md), [execution](../../core/chat-execution-flow.md).
- UI tuân theo [design system](../../product/tomni-design-system.md) và `mockup/home-wireframe-v3.html`.
- Quyền và package tuân theo [trust](../../core/trust-and-understanding.md), [packages](../../platform/packages.md).
- CURRENT chỉ biểu thị hành vi đọc được từ nguồn; PARTIAL là chưa chứng minh toàn tuyến.
- TARGET là yêu cầu phải triển khai; BLOCKED phải nêu dependency hoặc quyết định còn thiếu.
- Lần bàn giao này chỉ tạo ba tài liệu; chưa sửa implementation composer và chưa chạy test ứng dụng.
- Mọi tính năng bên dưới còn TARGET trừ mục audit ghi rõ CURRENT/PARTIAL.

## 2. Kết quả người dùng cần
- TARGET: bỏ biểu tượng thỏ và những nút khó hiểu khỏi hàng thao tác chính.
- Thay bằng selector có chữ `Assistant` và lựa chọn `Personal` có ý nghĩa rõ ràng.
- Selector hiển thị assistant thực được cấu hình trong Settings, không dùng danh sách mẫu.
- Chọn assistant phải thay đổi cấu hình thực của lượt gửi tiếp theo, không chỉ nhãn hoặc avatar.
- Danh sách tệp chỉ xuất hiện khi bản nháp có attachment và nút inventory phải đứng TRƯỚC dấu ba chấm.
- Giữ đường truy cập có tên cho thao tác hữu ích; ẩn UI không đồng nghĩa xóa backend.
- Không bổ sung implementation IDE, Browser hay ứng dụng tùy chọn vào core.

## 3. Audit icon và hành vi hiện tại
Các đường dẫn rút gọn dưới đây tính từ `packages/desktop/src/`.
| Icon / control | Bằng chứng nguồn | Điều đã biết | Điều chưa xác minh / xử lý TARGET |
| --- | --- | --- | --- |
| Rabbit / thỏ | Không thấy import/render Rabbit trong ba Guid component đã đọc | Chưa có bằng chứng đây là tốc độ | Chưa xác định asset động, màn hình hoặc phiên bản; không gán nghĩa speed; ẩn riêng UI sau khi truy vết đúng owner |
| Robot / logo agent + Down | `renderer/pages/guid/components/GuidActionRow.tsx:183-215,389-409` | Menu từ `agentSwitcherItems`, gọi `onAgentSwitch`; fallback lấy item đầu | Chưa chứng minh item là Settings assistant hay callback tới dispatch; thay bằng selector assistant có ID ổn định |
| Brain / logo provider | `renderer/pages/guid/components/GuidModelSelector.tsx:23-38` | Logo provider, Brain là fallback trang trí `aria-hidden` | Không phải tốc độ hay assistant; giữ model trong cấu hình nâng cao có nhãn |
| Auto / reasoning | `GuidModelSelector.tsx:77-98,124-235` | Có Auto, provider/model và reasoning gateway | Không suy luận auto hay reasoning tương đương Rabbit; hiệu lực runtime chưa được test |
| Shield ở mode | `GuidActionRow.tsx:415-427,578-585` | Truyền mode vào `AgentModeSelector` khi backend hỗ trợ | Đây là mode agent, không bằng chứng là tốc độ; chuyển vào menu có tên |
| Lightning / Super | `GuidActionRow.tsx:369-387,562-571` | Gọi toggle Super nếu có, nếu không gọi mở capabilities ở hub | Comment nói browser tools; quyền thực chưa truy vết; không biến selector assistant thành cấp quyền |
| People | `GuidActionRow.tsx:432-442` | Gọi `onOpenCollaboration` nếu được truyền | Route và kết quả chưa xác minh; đưa vào menu có chữ hoặc ẩn nếu thiếu handler |
| Cube | `GuidActionRow.tsx:444-453` | Gọi `onOpenCapabilities` | Đích thực chưa xác minh; giữ qua menu có nhãn sau kiểm tra |
| Code | `GuidActionRow.tsx:455-464` | Gọi `onOpenCodeApp` | Chưa chứng minh package cài đặt; không đóng gói IDE vào base |
| FolderOpen | `GuidActionRow.tsx:218-231,466-475` | Dialog chọn thư mục, nhớ workspace được duyệt, gọi callback | Không chứng minh mọi quyền downstream; giữ thao tác workspace có tên |
| More | `GuidActionRow.tsx:233-282,477-486` | Dropdown hover chứa thao tác file và nhóm skill/MCP | Chuyển hỗ trợ click/keyboard; inventory phải đứng trước control này |
| Plus / UploadOne | `GuidActionRow.tsx:152-169,233-282,529-549` | Chọn file desktop và WebUI khác nhánh; WebUI có input thiết bị | Chưa chạy picker thực; cần kiểm tra cancel, lỗi, upload trùng |
| Lightning trong Skills | `GuidActionRow.tsx:283-319` | Toggle skill theo `isAuto`, enabled/disabled lists | Không cùng ý nghĩa Super hoặc tốc độ; giữ nhãn Skills |
| Shield trong MCP | `GuidActionRow.tsx:321-360` | Toggle server ID, hiển thị số tool nếu có | Không phải bảo đảm bảo mật; menu phải nói rõ MCP |
| Kẹp giấy + số + chevron | `GuidActionRow.tsx:496-507` | Chỉ render khi count > 0 và có callback; hiện SAU More | PARTIAL: điều kiện tồn tại, thứ tự sai; branch default chỉ có File(n), chưa tương đương inventory |
| ArrowUp | `GuidActionRow.tsx:509-519,606-615` | Gọi `onSend`, có loading/disabled | Chưa xác minh send/stop lifecycle; nhánh default chưa thấy aria-label tại nút này |
| Voice | `GuidActionRow.tsx:508,605` | Chỉ render `speechInputNode` do cha cấp | Icon, permission, ghi âm và upload chưa đọc; không tuyên bố hoạt động |
| Inline attachment / slash | `GuidInputCard.tsx:79-107,139-180,221-238` | IME guard, palette package, preview có request guard | Không là chứng cứ toàn bộ chat flow đã pass; phải regression với selector |

## 4. Assistant và Personal
- Settings dùng `renderer/pages/settings/AssistantSettings/index.tsx` và `renderer/hooks/assistant/useAssistantList.ts`.
- CURRENT: hook gọi `ipcBridge.assistants.list.invoke()`, sort danh sách và giữ active ID cục bộ.
- Active ID của màn hình Settings không được coi là lựa chọn thực thi của conversation.
- CURRENT: `common/types/agent/assistantTypes.ts` có ID, enabled, source, preset_agent_type, skills, context, prompts và models.
- Source có builtin/user/extension/package; provenance package do main sở hữu.
- TARGET: dùng cùng catalog backend với Settings; lọc assistant disabled khỏi lựa chọn gửi mới.
- TARGET: tên theo locale rồi fallback name; trùng tên vẫn phân biệt bằng ID và nguồn.
- TARGET: Personal là lựa chọn trung tính dùng cấu hình cá nhân hiện có, không tạo assistant giả trong backend.
- Mapping Personal tới cấu hình runtime hiện có phải được xác nhận trước triển khai; nếu thiếu, BLOCKED ở contract.
- TARGET: loading, empty, error và retry hiển thị riêng; lỗi tải không biến thành danh sách rỗng hợp lệ.
- TARGET: có đường mở Settings để quản lý; quay lại phải refresh mà không mất draft.
- TARGET: xóa/disable/uninstall assistant đang chọn phải báo không khả dụng và yêu cầu chọn lại.
- Không âm thầm chọn phần tử đầu tiên hay đổi sang Personal khi gửi.

## 5. Hiệu lực lựa chọn và luồng chat
- TARGET: khi idle, lựa chọn được chụp cùng input, model và attachments lúc submit.
- Lượt đã được nhận dùng snapshot bất biến; đổi selector trong lúc streaming chỉ tác động lượt tiếp theo.
- Không áp context mới ngược vào lịch sử hoặc đổi danh tính run đang chạy.
- Backend phải resolve ID, kiểm tra enabled/package availability và quyền ngay trước admission.
- Nếu đổi engine không hỗ trợ trong conversation hiện tại, giải thích và đề nghị conversation mới; giữ draft.
- New chat, follow-up, reopen, switch conversation đều có state tách biệt.
- Retry cùng lượt dùng snapshot cũ; gửi lại với assistant mới là thao tác mới có xác nhận rõ.
- Edit/resend và branch phải ghi assistant của lượt mới, bảo toàn nguồn gốc lượt cũ.
- Stop, timeout, provider error, permission deny và reconnect không được nhân đôi send.
- Streaming text, tool approval, tool result, artifact và terminal receipt phải giữ đúng run identity.
- Lịch sử cần cho biết assistant thực đã thực thi, không lấy nhãn selector đang hiển thị để viết lại quá khứ.

## 6. Attachment và phần mở rộng
- Count là số attachment duy nhất trong draft, không phải số mention cùng một tệp.
- Count bằng 0: không mount nút inventory, không để tab stop hoặc khoảng trống dư.
- Count lớn hơn 0: nút inventory đứng trước More trong cả DOM và hình ảnh, không chỉ CSS order.
- Xóa tệp cuối: đóng inventory/preview và trả focus về control hợp lệ.
- Upload pending/error hiển thị trạng thái; không gửi handle chưa hợp lệ.
- Preview inline và inventory không chồng nhau; kết quả bất đồng bộ cũ không mở lại tệp đã xóa.
- Paste/drop/picker phải dùng pipeline attachment hiện có và bảo toàn semantic reference.
- Slash, mention, skills, MCP, Super và workspace không bị reset chỉ vì mở selector.
- Chọn assistant không tự cấp quyền tool, browser, filesystem hoặc egress.
- Package disable/uninstall phải loại contribution mới và xử lý snapshot đang chạy theo lifecycle canonical.

## 7. Trải nghiệm và nghiệm thu
- Tất cả control có accessible name; tooltip xuất hiện khi hover và focus, không thay thế tên truy cập.
- Tab theo thứ tự nhìn thấy; Enter/Space mở selector; Arrow/Home/End điều hướng; Escape đóng và trả focus.
- Enter khi đang IME hoặc palette xử lý không được submit chat ngoài ý muốn.
- Mọi chuỗi UI qua i18n, gồm Personal, lỗi, số tệp, trạng thái đang chọn và tooltip.
- Dark/light dùng token chuẩn; focus và selected không chỉ phân biệt bằng màu.
- Ở 320/375/768/1280 px và zoom 200%, không che send hoặc đảo inventory/More.
- Nhãn dài được rút gọn có cách đọc đầy đủ; popup không tràn viewport.
- Nghiệm thu phải có integration chứng minh assistant A rồi B thay đổi payload/context thật.
- Phải có kiểm thử quyền âm tính và package lifecycle, không chỉ screenshot hay state assertion.
- Chỉ đánh dấu hoàn tất khi có lệnh, exit code và evidence đúng revision trong hệ thống canonical.
- Hiện tại: chưa có kết quả test mới; các tiêu chí TARGET chưa được nghiệm thu.
