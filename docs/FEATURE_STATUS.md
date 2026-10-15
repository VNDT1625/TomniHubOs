# Feature Status — TomniHubOS

> Cập nhật: 2026-09-30 | Dựa trên code thực tế, không phải thiết kế mục tiêu.
> Nhãn: **WORKING** = đã chạy được; **PARTIAL** = chạy được một phần; **STUB** = code có nhưng không làm gì thật; **BLOCKED** = cần điều kiện ngoài.

---

## 1. Laya Decision Engine

**Mô tả:** Laya là "bộ não phán quyết" — một mô hình AI nhỏ chạy local (ONNX INT8, ~308MB), thay thế LLM generative để đưa ra quyết định nhanh, không tốn token. Thay vì hỏi GPT-4 "tin nhắn này có nguy hiểm không?", Laya tự làm trong ~33ms sau khi khởi động.

**Vai trò thực tế trong code:**

| Vai trò                                   | File                                       | Trạng thái                                                             |
| ----------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| Phát hiện credential/PII trong tin nhắn   | `layaSecurityStage.ts`                     | **WORKING** (với fallback regex nếu Laya chưa sẵn sàng)                |
| Phát hiện prompt injection tấn công       | `layaSecurityStage.ts`                     | **WORKING** (regex hardcoded + Laya xác nhận)                          |
| Phân loại intent: mở URL, file, GitHub    | `directActionStage.ts`                     | **WORKING** (Laya xác nhận + regex fallback)                           |
| Hiểu ý định, chọn nhóm tool cho lượt chat | `understandStage.ts`, `toolSchemaStage.ts` | **WORKING** (một lần chạy Laya dùng chung với bảo mật; regex fallback) |
| Phân loại model nào phù hợp nhất          | `modelRoutingStage.ts`                     | **STUB** (stage tắt mặc định, chưa dùng)                               |
| Kiểm tra bảo mật egress outbound          | `layaSemanticEgressModel.ts`               | **PARTIAL** (logic đầy đủ, chưa gắn vào chat flow chính)               |

**Vấn đề hiện tại — đã fix:**

- Sidecar Python mất ~26 giây để khởi động (load ONNX model + tokenizer)
- Trước đây: code gửi request xuống sidecar TRONG KHI nó vẫn đang load → timeout 1-5s → luôn fallback về regex
- **Fix đã áp dụng:** `predict()` nay `await` quá trình khởi động; bridge.ts khởi động sidecar sớm (warm-up) khi app mở

**Kết luận Laya:** Cơ sở hạ tầng **hoàn chỉnh**. Sau fix, Laya sẽ thực sự chạy neural thay vì chỉ chạy regex. Cần ~26s warm-up lần đầu sau khi mở app.

---

## 2. Chat Pipeline

**Mô tả:** Chat Pipeline là hệ thống "cổng tùy biến" — trước khi tin nhắn của user đến LLM, nó chạy qua một chuỗi các "stage" xử lý tuần tự. Mỗi stage có thể: chặn tin nhắn, viết lại nội dung, bổ sung context, hoặc xử lý ngay không cần LLM. User hoặc conversation có thể bật/tắt từng stage, tạo pipeline riêng.

**Luồng thực tế:**

```
User gõ tin nhắn
       ↓
[pre_query phase]
  LayaSecurityStage   → Kiểm tra credential/PII (cả query lẫn context) → rewrite hoặc block
  UnderstandStage     → Hiểu người dùng muốn gì → grounding.intent
       ↓
[pre_model phase]
  DirectActionStage   → Mở URL/file/repo? → direct_action (không gọi LLM)
  ToolSchemaStage     → Chọn nhóm tool (capability) cần nạp → grounding.toolSchema
  ModelRoutingStage   → (TẮT mặc định) Gợi ý model phù hợp
       ↓
[retrieve phase]
  RtkKnowledgeStage   → (TẮT mặc định) Inject real-time knowledge
       ↓
Gửi finalQuery + context đã kiểm tra → LLM API → stream response về UI

Bảo mật, hiểu ý định và chọn tool dùng chung MỘT lần chạy Laya (decisionSession.ts).
```

**Trạng thái từng stage:**

| Stage                   | Phase     | Bật mặc định | Trạng thái                                                         |
| ----------------------- | --------- | ------------ | ------------------------------------------------------------------ |
| `builtin:laya-security` | pre_query | ✅           | **WORKING** — phát hiện credential, rewrite query                  |
| `builtin:direct-action` | pre_model | ✅           | **WORKING** — mở URL/GitHub/file + /repotopackage                  |
| `builtin:understand`    | pre_query | ✅           | **WORKING** — ghi `grounding.intent` cho các chặng sau             |
| `builtin:tool-schema`   | pre_model | ✅           | **WORKING** — chọn nhóm tool; runtime chỉ thu hẹp nhóm `core.*`    |
| `builtin:model-router`  | pre_model | ❌           | **STUB** — tắt mặc định, chưa kết nối model switching              |
| `builtin:rtk-knowledge` | retrieve  | ❌           | **STUB** — chỉ check keyword "hôm nay/latest", không lấy data thật |

**Cơ chế Pipeline Definition:**

- Mỗi conversation có thể có `ChatPipelineDefinition` riêng; lưu trong `userData/.../chat-pipelines.json` (`nativeConversation/pipelineDefinitionStore.ts`, tối đa 200 cuộc trò chuyện, giữ sau khi khởi động lại, xoá cùng cuộc trò chuyện)
- User/app có thể gọi IPC `updatePipelineDefinition` để bật/tắt stage, set timeout, config; định nghĩa được kiểm tra chặt (sai một phần là bỏ cả định nghĩa). Không có `conversation_id` = lưu làm mặc định cho cả app
- Thứ tự chọn: của cuộc trò chuyện → mặc định đã lưu (Cài đặt → Pipeline Chat → Sửa dây chuyền mặc định) → `getChatStageRegistry().createDefaultDefinition()`
- **WORKING** — cơ chế registry, executor, timeout, abort signal đều hoạt động

**Kết luận Chat Pipeline:** Cơ sở hạ tầng **hoàn chỉnh và hoạt động**. Các stage mặc định (security, understand, direct-action, tool-schema) chạy thật. Các stage opt-in (rtk, model-router) là stub cần triển khai thật; Context7 giả đã bị xoá (sẽ là package Store thật).

---

## 3. RepoToPackage (`/repotopackage`)

**Mô tả:** Biến một thư mục hoặc repository Git (https) thành gói `.tomny` có ký số, không gọi LLM. Cài đặt: `packages/desktop/src/process/extensions/package-manager/repoPackaging/`. Bộ phân loại: `packages/desktop/src/common/packages/repoClassifier.ts`. Dòng lệnh: `bun scripts/repo-to-package.ts`. Test: `tests/unit/package-manager/repoPackaging/`.

**Dùng trong chat:** `/repotopackage [nguồn] [--ref <nhánh>] [--path <thư mục>] [--name ..] [--id ..] [--version ..] [--publisher ..]`. Bỏ trống nguồn là workspace của cuộc trò chuyện. Nguồn cục bộ phải nằm trong workspace; nguồn mạng phải là `https` trên github.com, gitlab.com, bitbucket.org hoặc codeberg.org.

**Luồng thật, mỗi bước chỉ hiện "xong" sau khi bước đó chạy xong:**

```
resolve   → nạp khoá ký
fetch     → xác định nguồn (clone nông, chỉ giao thức https) hoặc thư mục trong workspace
scan      → liệt kê tệp (dùng git khi là repo, nếu không thì duyệt thư mục), loại bí mật/công cụ/symlink
classify  → phân loại archetype, kiểm tra host có chạy được không
screen    → chọn phần đóng gói (dist/build/docs thành gốc site), quét nội dung tìm khoá/token
build     → dựng manifest (theme mang CSS thật, không có module giả)
sign      → Ed25519
write     → ghi nguyên tử vào userData/tomny-packages
verify    → đọc lại gói: manifest, chữ ký, đường dẫn an toàn, toàn vẹn khớp cách bộ cài tính
```

**Trạng thái:**

| Hạng mục                        | Trạng thái | Ghi chú                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phân loại archetype             | CURRENT    | Heuristic theo tên tệp và nội dung vài tệp chính; không dùng LLM.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Gói chạy được trong host        | CURRENT    | Chỉ `web-surface-app` (trang tĩnh có sẵn hoặc bản build đã commit), `ui-theme`, `ide-viewer`. Repo cần build, Python, Rust… bị từ chối kèm lý do thay vì tạo trang giả.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| MCP tool server                 | PARTIAL    | Đóng gói thành **công thức khởi động** (`npx -y <package>@<version>` hoặc `uvx <package>==<version>`) lấy từ package.json/pyproject của repo; gói không chứa mã chạy. Ngay khi `/repotopackage` tạo xong, server được thêm vào **Cài đặt → MCP** ở trạng thái **tắt** (không cần cài gói); gói đã cài qua Store cũng được đồng bộ vào đó theo cách tương tự. Server chỉ chạy khi người dùng bật. Chỉ nhận launcher `npx`/`uvx`, tham số bị kiểm tra chặt (không `-c`, không khoảng trắng hay ký tự shell). Repo không có package đã xuất bản (private, thiếu bin) bị từ chối; monorepo nhiều package cần `--path`. |
| Chat stage, workflow, service   | TARGET     | Được nhận diện nhưng bị từ chối: manifest chưa có runtime cho chúng, và các chuỗi quyền `chat.stage`… không có thành phần nào dùng.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Loại bí mật                     | CURRENT    | Theo tên (`.env`, khoá, `credentials*`…) và theo nội dung (khoá riêng, AWS, GitHub, Slack, Stripe, npm, OpenAI/Anthropic). Báo cáo chỉ nêu tên tệp và loại, không in giá trị.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Kiểm tra tĩnh khác              | CURRENT    | Cảnh báo script vòng đời npm, mã giải mã rồi chạy, tệp thực thi. **Không** quét mã độc và **không** kiểm tra tên thư viện với registry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Ký                              | CURRENT    | Khoá Ed25519 cục bộ bền vững (mã hoá bằng keystore hệ điều hành nếu có); khoá nhà phát hành truyền bằng `--key`/`--key-id`. Cài hoặc nộp lên Store cần khoá đã đăng ký; gói ký cục bộ không cài được qua Store.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Tải repository qua mạng         | PARTIAL    | Đường clone được kiểm thử bằng kho cục bộ được chuyển hướng; chưa có test chạy mạng thật.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Tự cài gói vừa tạo vào ứng dụng | TARGET     | Chưa có luồng này; gói nằm trong `userData/tomny-packages`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Giới hạn mặc định:** tối đa 10.000 tệp, 100 MB nội dung, 20 MB mỗi tệp, 180 giây để clone, CSS theme tối đa 256 KB. Nhánh chứa dấu `/` trong URL `/tree/` phải truyền bằng `--ref`.

**Kết luận RepoToPackage:** tạo được gói `.tomny` hợp lệ và tự xác minh lại cho thư mục web tĩnh, theme, IDE viewer và MCP server (dạng công thức khởi động); từ chối rõ ràng phần còn lại. Chat stage, workflow và service cần mở rộng manifest và host, không thuộc chức năng đóng gói.

---

## 4. Trải nghiệm chat mở rộng (từ `docs/future`)

**Mô tả:** các phần của tài liệu thiết kế giao diện chat và 5 ý tưởng kiến trúc, đối chiếu với mã nguồn ngày 2026-10-05.

| Hạng mục                                    | Trạng thái | Ghi chú                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Menu gợi ý `/` `#` `*` `@`                  | PARTIAL    | Trang chủ và trong chat dùng chung danh mục (`utils/chat/commandPalette.ts`) và cùng kiểu menu. `#` và `*` là danh sách tĩnh, chọn chỉ chèn chữ. Không có tiền tố `!`.                                                                                                                                                                                                      |
| Chế độ `/boost`, `/mermaid`, ...            | WORKING    | `common/chat/slash/modes.ts`: đầu tin nhắn có từ chế độ thì main process thêm chỉ dẫn vào văn bản gửi model, bong bóng chat giữ nguyên chữ người dùng gõ. Gồm boost, deep, fast, grill-me, architect, review, fix, refactor, test, teamwork, terminal, explain, vietnamese, mermaid, chart, table, artifact, guide-me.                                                                          |
| Lệnh `/schedule`                            | WORKING    | `/schedule [khi nào] [giờ] <việc cần làm>` (ví dụ `/schedule hằng ngày 7h30 tóm tắt email`, `/schedule thứ 6 5h chiều báo cáo tuần`, `/schedule weekdays 6pm ...`) mở trang Lịch với form tạo việc điền sẵn. Không tạo gì cho tới khi người dùng chọn agent và bấm xác nhận. Bộ đọc: `common/chat/slash/scheduleCommand.ts`; test `scheduleCommand`, `scheduleDraft.dom`. |
| Lệnh `/remember`, `/forget`                 | WORKING    | Sửa thẳng Personal Context lâu dài (cùng chỗ với Cài đặt → Cá nhân), không gửi gì cho model. `/remember <điều cần nhớ>` thêm một fact do người dùng nhập, khoá, phạm vi toàn cục, tối đa 500 ký tự, không lưu trùng; mọi cuộc trò chuyện mới nhận được. `/forget <từ khoá>` xoá fact/sở thích/thói quen khớp và đánh dấu bản ghi học được là đã quên. Mã: `common/chat/slash/memoryCommand.ts`, `renderer/services/personalMemoryCommand.ts`. |
| Lệnh `/teamwork`, `/terminal`               | WORKING    | Chế độ chỉ dẫn: `/teamwork` chia tối đa 3 luồng việc, giao sub-agent nếu runtime có, rồi gộp và kiểm. `/terminal` giải bằng lệnh shell, hiện lệnh trước khi chạy, chỉ chạy qua công cụ lệnh có duyệt sẵn của agent. |
| Lệnh đã gỡ                                  | —          | `/diff`, `/compact`, `/status`, `/browser` từng có trong menu mà không làm gì, đã được gỡ. |
| Chỉ dẫn trên giao diện (Spotlight)          | WORKING    | `/guide <mô tả>` hoặc khối ` ```spotlight ` trong tin nhắn của assistant: làm tối màn hình trừ một điều khiển có trong danh mục (`common/ui/spotlightTargets.ts`), kèm bong bóng. Không tự thay đổi gì: người dùng tự bấm hoặc bấm "Kích hoạt hộ tôi".                                                                                                                      |
| Biểu đồ trong chat                          | WORKING    | Khối ` ```chart ` (JSON): cột, đường, vùng, tròn, vẽ SVG, phóng to/kéo, tải SVG, bảng số liệu. Chưa có Vega-Lite, Excalidraw, kéo thả node hay bấm node để ra lệnh.                                                                                                                                                                                                         |
| Mermaid                                     | PARTIAL    | Có nút "Phóng to / kéo" (zoom, pan, tải SVG). Chưa có sửa node trực tiếp.                                                                                                                                                                                                                                                                                                   |
| Khối mã thành artifact | PARTIAL | Khối mã nhiều dòng có nút “Xem trong bảng xem trước”: HTML/SVG hiển thị thật, Markdown dựng sẵn, `diff`/`patch` mở trong trình xem diff hai cột (tự thêm dòng tên tệp và dòng `@@` khi model chỉ viết đoạn thay đổi), ngôn ngữ khác mở dạng mã; trong bảng có sửa, tải về, toàn màn hình. Hàng rào ` ```html:index.html ` đặt tên tệp. HTML trong WebUI chạy trong iframe không cùng origin với app (đã bỏ `allow-same-origin`). Chưa có ghi thẳng vào workspace, console mini, phiên bản. |
| Chuột phải trên chữ bôi đen                 | PARTIAL    | Menu hai tầng: sao chép, tìm Google/GitHub/X, dịch, hỏi về đoạn này, ghi nhớ lâu dài (giống `/remember`), làm bằng lệnh terminal (điền sẵn `/terminal …`, người dùng tự gửi). Nhãn đã có đủ 9 ngôn ngữ. Chưa có task cho subagent, đánh dấu bí mật.                                                                                                                                                                                                                              |
| `==highlight==`, GitHub Alerts              | WORKING    | `components/Markdown/remarkRichText.ts`. Thẻ màu chưa có.                                                                                                                                                                                                                                                                                                                   |
| Telegram: tin nhắn thoại                    | PARTIAL    | Nhận `voice`/`audio`, kiểm tra độ dài (60 giây), dung lượng (5 MB) và định dạng, tải qua Bot API, chuyển thành chữ bằng model do bạn chọn trong Cài đặt → Kênh → Telegram → Voice model (nhà cung cấp tương thích OpenAI, ví dụ Whisper). Chữ hiện kèm nút ✅/❌, chỉ chạy khi người nói bấm xác nhận. Có thể thay bằng Whisper cục bộ INT8 (mặc định cỡ base; đã đo sơ bộ độ trễ, chưa chốt cỡ vì chưa đo tiếng Việt thật, xem docs/future/kien-truc-telegram-remote-va-voice-agent-control.md) (faster-whisper, CPU, âm thanh không rời máy; cần chạy `python scripts/setup-local-whisper.py` một lần để tải model, chưa kiểm chứng với model thật trên máy này). Chưa có công cụ điều khiển máy và gửi ảnh chụp màn hình. |
| Telegram: ảnh và tệp gửi vào | WORKING | `services/telegram/attachments.ts`: ảnh (lấy cỡ lớn nhất ≤ 10 MB) và tài liệu ảnh/PDF/văn bản/Office được lưu vào `<workspace>/telegram-uploads/` rồi gửi cho agent làm tệp đính kèm, chú thích ảnh là yêu cầu. Chương trình, tệp nén, sticker bị từ chối không tải; video được trả lời là agent chưa xem được. Tomny chỉ lưu tệp, không mở hay chạy. |
| Telegram: câu trả lời dài | WORKING | Chia theo dòng thành tối đa 5 tin 4096 ký tự, báo “còn tiếp” nếu dài hơn (trước đây bị cắt ở 4096). |
| Telegram: gửi ảnh/tệp kết quả về điện thoại | TARGET | Cần danh sách tệp do lượt chạy tạo ra trong workspace; không gửi theo đường dẫn model nêu để tránh lộ tệp. |
| Thành phần đã viết nhưng chưa dùng          | STUB       | `InteractiveDataTable`, `InteractiveChecklist`, `InChatSecretForm` chưa được nối vào đâu. `CodeDiffViewer` trùng việc với trình xem diff của bảng xem trước (đã nối cho khối `diff`), nên không cần nối thêm. Markdown render trong shadow DOM nên thành phần Arco bên trong mất style; nối cần kiểm tra bằng mắt.                                                                                                                                                            |
| `@tomni/package-sdk`, `recall_visual_asset` | TARGET     | Chưa có mã nguồn.                                                                                                                                                                                                                                                                                                                                                           |

## 5. Home (`/guid`) — lưới việc đang chạy

**Mô tả:** Home hiển thị mọi agent, lịch, team và phiên Terminal đang chạy trên mọi workspace để quản lý nhanh. Đặc tả: `docs/product/tomni-hub-home-workflow.md`.

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Hub activity registry | WORKING | `process/system/hubActivity/`: gom hội thoại (nội dung, tool, permission, kết thúc), lượt chạy lịch, slot Team, phiên Terminal; IPC `hub-activity.*` có kiểm tra sender và tài khoản. |
| Tile, bước, preview, chân tile | WORKING | `HubHome/HubAgents.tsx`; dữ liệu thật, không còn đọc task Manager. |
| Trả lời permission / dừng / gỡ từ tile | WORKING | Nút trong tile và menu chuột phải. Dừng: hội thoại, lượt chạy lịch, phiên Terminal. |
| Follow / ping / kéo đổi chỗ / escalation | WORKING | `HubHome/liveGrid.ts`, lưu theo máy; ngưỡng ping theo CPU/RAM thật. |
| Phục hồi lưới sau restart | WORKING | `hubActivityStore.ts` + `restoreHubActivityGrid()`: lưu `runs/hub-activity.json` (ghi ngay lần đầu, debounce 1 s cho update sau), hydrate lúc bridge khởi động; mục đang chạy về `stopped`, quá hạn TTL bỏ, prompt permission không khôi phục. |
| Tile cho app package khác | TARGET | App package không chạy nền sau khi rời trang nên chưa có nguồn hoạt động. |

---

## 6. Trung tâm thông báo (chuông trên Header)

**Mô tả:** Gom thông báo của Tomny và các nguồn người dùng bật (hộp thư nhiều tài khoản, trang web/AI, ứng dụng Windows, YouTube, feed, ứng dụng gói) về một schema; Laya + quy tắc xếp mức P0–P3 và quyết định **báo ngay / vào bảng tin / ẩn**; chỉ mục “báo ngay” mới ra ngoài ngăn kéo. Agent hỏi lại được “tôi đã bỏ lỡ gì”. Đề xuất gốc: `docs/future/laya-omni-notification-hub-and-ui-audit.md`.

**Chi phí:** gần 0. Quy tắc, danh sách VIP/chặn, uy tín người gửi (học từ mở/bỏ qua) và Laya cục bộ chạy trước, không gọi mạng. LLM chỉ là tùy chọn, **mặc định tắt**: cần bật + chỉ định model, chỉ gửi mục quy tắc không xếp chắc chắn, theo lô ≤ 8, tối đa `dailyLimit` mục/ngày (tính ngay khi gửi nên lỗi nhà cung cấp không vượt ngân sách), nội dung đã che mã/số/link/email (chỉ còn tên miền người gửi + tiêu đề, xem trước chỉ khi người dùng bật).

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Schema chuẩn + kho cục bộ | WORKING | `common/types/platform/notificationHub.ts`: id, source, account, title, snippet, sender, url/route, createdAt/receivedAt, rawRef, dedupeKey, read, level/category/delivery/confidence/classifiedBy. File `userData/notification-hub/notification-hub.json` (≤ 1000 mục, giữ `retentionDays` ngày, mặc định 30); chống trùng theo id và theo nội dung giữa nhiều nguồn trong 15 phút. |
| Interface adapter nguồn | WORKING | `hubActivity/notificationSources/sourceAdapter.ts`: mỗi nguồn khai báo validate/sync/cursor; bật-tắt, cấu hình theo tài khoản, trạng thái, lần đồng bộ cuối. |
| Hộp thư IMAP, nhiều tài khoản (Gmail, Outlook, Yahoo, iCloud, khác) | WORKING (cần người dùng nhập mật khẩu ứng dụng) | Chỉ đọc (`EXAMINE` + `BODY.PEEK`); mặc định chỉ header và chỉ thư chưa đọc; Gmail dùng thêm nhãn Important và tab Promotions/Social/Updates (miễn phí). Mật khẩu ở kho mã hoá OS (`credentialStore`), không về renderer, không log. Chưa kiểm với tài khoản thật. |
| Feed RSS/Atom | WORKING | Chỉ http(s), ≤ 2 MB. |
| YouTube video mới | WORKING | Feed công khai `feeds/videos.xml`, nhận link kênh/@handle/mã kênh; không API key. Bình luận/đăng ký cần API có hạn mức: **adapter-ready**. |
| Thông báo Windows của ứng dụng khác (Zalo, Telegram, Discord, Outlook…) | WORKING trên Windows (kiểm đọc được schema DB trên máy dev; chưa kiểm đầu-cuối trong app) | Đọc chỉ-đọc `%LOCALAPPDATA%/Microsoft/Windows/Notifications/wpndatabase.db`, chỉ lấy dòng chữ hiển thị của toast, bỏ qua Tomny, lọc theo ứng dụng người dùng chọn. Nền tảng khác: báo `unsupported`. Phụ thuộc định dạng DB của Windows. |
| Trang web/AI trong trình duyệt tích hợp (ChatGPT, Claude, Gemini, Facebook, Messenger, Zalo Web, Discord…) | WORKING theo phiên (cần đăng nhập trong trình duyệt tích hợp) | Số chưa đọc trên tiêu đề tab + (tuỳ chọn) bắt `Notification` của trang qua shim chỉ chèn vào origin đã cho phép; dòng console có tiền tố cố định, giới hạn kích thước và 20/phút. Push do service worker khi không mở trang: không thấy. |
| Ứng dụng gói Tomny | WORKING | Capability `notifications.post` (cần quyền `notifications.show`, lease 60 s, biên nhận); gói chỉ đề xuất “quan trọng”, không tự đặt khẩn; https-only, 30 bài/giờ/gói. |
| Facebook Page/follower, Telegram Bot, Gmail API OAuth, bình luận YouTube | ADAPTER-READY / TARGET | Hợp đồng adapter có sẵn, chưa có tích hợp nhà cung cấp (cần app OAuth/bot token/API trả phí). Hiện hiển thị trong danh mục nguồn là “mới có adapter”. |
| Triage | WORKING | `hubActivity/notificationTriage/`: quy tắc (OTP/bảo mật/VIP/từ khóa) → Laya (nếu sidecar đang chạy) → tắt tiếng nguồn → uy tín người gửi (±1 bậc, không bao giờ lên P0) → ngưỡng ngắt (`interruptLevel`, mặc định P0). Leo thang LLM tuỳ chọn như trên. |
| Giờ yên lặng, cảnh báo | WORKING | `alertPolicy.ts`: chỉ mục `delivery = interrupt` mới có biểu ngữ HĐH; giờ yên lặng, âm thanh, đưa cửa sổ lên, cảnh báo RAM > 85% như trước. |
| UI | WORKING | `Titlebar/NotificationHub/`: chuông + ngăn kéo (Focus/Tổng hợp/Đã lọc/Nguồn), thẻ “Bạn đã bỏ lỡ gì”, lọc theo nguồn/chưa đọc/tìm kiếm, nhóm theo mức/nguồn/tài khoản, mở link, tạo việc, tắt tiếng nguồn, ưu tiên/chặn người gửi, đánh dấu đã đọc; trang Cài đặt → Thông báo có nguồn, ngưỡng, giờ yên lặng, ngân sách LLM, lưu giữ. i18n 9 ngôn ngữ (`common.notificationHub.*`). Chưa kiểm bằng trình duyệt/Electron thật. |
| Agent | WORKING | MCP chỉ đọc `tomny-notification-hub` (`notifications_recent`, `notifications_summary`) trong capability lõi `core.notification-hub`; đầu ra đã che mã/token/số, không có cài đặt kết nối hay bí mật, không đánh dấu đã đọc. |
| Sửa mức “luôn như vậy” | WORKING | Ghi vào danh sách VIP/chặn; thao tác mở/bỏ qua huấn luyện uy tín người gửi. |

**Kiểm chứng:** `tests/unit/system/notificationHub/*`, `notificationHub*.test.ts`, `alertPolicy.test.ts`, `tests/unit/renderer/components/notificationCenter.dom.test.tsx`, `packageCapabilityBroker` và các test registry/IPC liên quan.

---

## 7. Lịch (Schedule)

**Mô tả:** Tác vụ theo lịch (cron, khoảng thời gian, một lần) chạy prompt bằng agent đã chọn. Mã: `process/cron/scheduledTasks/`.

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Mỗi lượt chạy là một hội thoại thật | WORKING | `conversationRunner.ts`: mở hội thoại gắn `extra.cron_job_id` (hoặc tiếp tục hội thoại đã liên kết), lưu câu trả lời, tool và permission như chat thường; lần thử lại dùng lại hội thoại của lượt đó. Permission khi không có người: theo chính sách của tác vụ (`allow-granted` + phạm vi quyền), còn lại từ chối. |
| Lịch sử lượt chạy | WORKING | IPC `cron.list-run-conversations` (thay route HTTP không tồn tại). |
| Chạy ngay | WORKING | Trả về ngay khi hội thoại được tạo rồi mở hội thoại đó, không chờ hết lượt chạy và các lần thử lại. |
| Skill đã lưu | WORKING | Gửi kèm cho model cùng prompt (không hiện trong bong bóng chat). |
| Sau khi máy ngủ dậy | WORKING | `service.resume()` đặt lại hẹn giờ và chạy bù theo `missedRunPolicy`. |
| Automation `action.cron` | WORKING | Tạo tác vụ qua adapter trong tiến trình (thay route `/api/cron` không tồn tại). |

---

## 8. Company và Artifacts (gói Store `com.tomni.company`)

**Mô tả:** `/company`, `/artifacts`, `/settings/company` mở trang gói Store `com.tomni.company` (mã ở `packages/package-apps/company`). Main xử lý qua IPC `company.*` (`process/company/companyBridge.ts`).

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Tạo công ty từ mô tả, sửa cơ cấu/quy tắc/phân công, chạy hội thoại, permission | WORKING | Test `tests/unit/company/*` (sửa import sau khi mã chuyển sang `packages/package-apps/company`; thêm alias `@package-apps/company/`). |
| Danh sách artifact của lượt chạy | WORKING | Bản ghi kết quả, báo cáo test, thay đổi mã; nút “Mở thư mục chứa” chỉ hiện khi có đường dẫn thật và chỉ mở thư mục, không chạy tệp do model trả về. |
| Build gói Store | WORKING | Runtime Design, Document Studio và runtime dùng chung trỏ sang `tomni-ui.css` (file theme cũ đã bị xoá). |
| Bản dev đã ký trong `store-artifacts/` | CHỜ BUILD | Bản ngày 2026-10-03 chưa có nút mới; chạy `bun run store:build` rồi mở với `TOMNI_STORE_LOCAL_ARTIFACTS=1`. |

---

## 9. Cài đặt (`/settings/*`) — rà soát 2026-10-05

**Mô tả:** Từng trang cài đặt được kiểm xem có gì thật sự chạy phía sau. Trang chưa nối thì hiện thông báo “chưa hoạt động” (`NotActiveNotice`), các nút bị tắt, không có số liệu bịa.

| Trang | Trạng thái | Ghi chú |
| --- | --- | --- |
| Model / Agent / 9Router, Công cụ & Skills & MCP, Tài nguyên, Hiển thị, Hệ thống & Giới thiệu, WebUI, Extension | WORKING | Đọc và ghi cấu hình thật qua IPC và `ConfigStorage`. |
| Thông báo | WORKING | Nguồn IMAP, feed và web, quy tắc, lọc Laya (§6). |
| Pipeline Chat | WORKING | Bật/tắt stage, lưu cấu hình (§2). |
| Hồ sơ | PARTIAL | Tài khoản đang đăng nhập và nút đăng xuất là thật. Đồng bộ, từ chối dùng dữ liệu để huấn luyện, xuất dữ liệu, xoá lịch sử: tắt. Đã bỏ mã máy giả, email giả và các thông báo “thành công” giả. Test `profileBillingSettings.dom`. |
| Thanh toán & mức dùng | NOT ACTIVE | Tomny chưa đếm token và chi phí. Không còn hiện gói hay số liệu bịa; giới hạn chi tiêu bị tắt. |
| Cấu hình AI (nhiệt độ, top-p, …) | NOT ACTIVE | Chưa đưa vào broker gọi model. Việc nối cần duyệt bảo mật, **chờ người dùng quyết**. |
| Quyền riêng tư & bảo mật | NOT ACTIVE | Chưa có chính sách thực thi phía main. |

---

## Tóm tắt 1 dòng mỗi tính năng

| Tính năng         | Chạy thật chưa?                     | Thiếu gì?                                              |
| ----------------- | ----------------------------------- | ------------------------------------------------------ |
| **Laya**          | ✅ Có — sau fix warm-up             | Warm-up 26s lần đầu; egress model chưa gắn vào chat    |
| **Chat Pipeline** | ✅ Có — 3 stage mặc định hoạt động  | RTK, Context7, ModelRouter còn là stub                 |
| **RepoToPackage** | ✅ Có — web tĩnh, theme, IDE viewer | MCP/stage/workflow/service bị từ chối; chưa tự cài gói |
| **Home (`/guid`)** | ✅ Có — lưới việc đang chạy thật | Tile cho app package chạy nền |
| **Thông báo** | ✅ Có — IMAP, feed, trang web, sự kiện nội bộ; Laya/quy tắc | OAuth Gmail/Outlook, Telegram |
| **Lịch** | ✅ Có — lượt chạy là hội thoại thật, lịch sử, chạy ngay, chạy bù sau khi ngủ | — |
| **Company / Artifacts** | ✅ Có — gói Store, test chạy lại được | Build lại bản dev đã ký |
| **Cài đặt** | ✅ Phần lớn — trang chưa nối ghi rõ “chưa hoạt động” | Hồ sơ (đồng bộ/xuất), Thanh toán, Cấu hình AI, Quyền riêng tư |
