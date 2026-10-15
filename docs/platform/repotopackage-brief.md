# Bản giao việc: `/repotopackage` và hệ kết nối

**Dành cho:** agent nhận tiếp công việc. **Cập nhật:** 2026-10-09. **Trạng thái:** tổng hợp từ một chuỗi thảo luận dài với người dùng; mọi quyết định ở mục 2 đã được người dùng đồng ý. Mục 8 liệt kê những gì **chưa kiểm tra**: đừng coi chúng là sự thật.

> **Cập nhật 2026-10-09:** thiết kế đầy đủ và danh sách task cho agent con nằm ở [repotopackage-design.md](repotopackage-design.md). Mục 5 và mục 7 của brief này đã được thay bằng tài liệu đó; chỗ nào khác nhau thì tài liệu đó thắng.

## 0. Đọc trước khi làm gì

1. [AGENTS.md](../../AGENTS.md) là nguồn quy tắc duy nhất. Điểm cốt lõi: **mọi thao tác tạo, sửa, xóa tệp trong repo phải đi qua lệnh ghi của MTUI** (`packages/mtui/target/debug/mtui.exe`), không dùng chuyển hướng shell hay script tạm vào repo. Tệp tạm đặt dưới `.tmp/<tên-việc>/` (đã bị git bỏ qua).
2. Cây làm việc đang **bẩn** vì nhiều agent khác sửa song song. Không `git stash`, không sửa tệp ngoài phạm vi, chạy `git status` trước và sau khi làm. Các tệp của phiên khác đã thấy sửa dở trong vùng gần đó: `PackageManagerService.ts`, `packageBridge.ts`, `packageHttpApi.ts`, `capability.ts`, `browserHost*.ts`, `bridge/index.ts`.
3. Đọc các tài liệu theo thứ tự ở mục 10.

## 1. Mục đích và nguyên tắc

**Mục đích:** biến một repo hoặc website bất kỳ thành **một gói `.tomny` mà Tomny dùng được ngay**, không phải cài tay hay viết lại.

1. Nhận ra những gì **kết nối được** và dùng; phần không nhận ra thì bỏ qua (vẫn nằm trong `source/`). Không bao giờ từ chối cả repo chỉ vì một phần không chạy được.
2. **Backend làm hết sức bằng quy tắc, không tốn token.** Phần còn lại giao cho **agent hoặc người dùng** qua `openItems` (ví dụ điền giá trị `.env`).
3. Gói chỉ **khai báo**; không có gì tự chạy. Lệnh chạy đến từ **khuôn mẫu cố định theo framework**, không đọc từ README hay mã của repo (hook là ngoại lệ, xem mục 7).
4. **Mặc định tắt**, người dùng thấy đúng lệnh rồi mới bật. Kết nối mà Hub chưa chạy được vẫn nằm trong gói, ở trạng thái tắt, kèm lý do.
5. **Người ghi chặt, người đọc rộng:** thêm trường hoặc loại kết nối mới không làm hỏng gói cũ.

## 2. Quyết định đã chốt

- **Cấu trúc gói chuẩn:** `tomny-package.json` (manifest + chữ ký) · `adapter/adapter.json` · `source/` (nguyên repo, không sửa; vắng khi nguồn là URL). Chữ ký phủ cả `adapter/` lẫn `source/`. Mọi gói cuối cùng về cấu trúc này; gói cũ đọc qua bộ chuyển đổi.
- **`adapter.json`** là một tệp liệt kê `connections` với `kind`: `mcp`, `skill`, `tool`, `cli`, `web-embed` (`url` ngoài hoặc `process` cục bộ), `launcher`, `bridge`; cộng `openItems` (`env-value`, `unrecognized`, `needs-runtime`, `choose`).
- **Không đặt trần dung lượng** cho `source/` (vẫn lọc bí mật, symlink, đường dẫn xấu, `.git`).
- **`launcher.target`** có hai dạng: `installed` (mặc định: gói chỉ ghi tên tệp như `blender.exe` và link tải; người dùng gắn đường dẫn thật trên máy mình, Hub nên tự dò) và `source` (app nằm trong `source/`, cần runtime). Gói không bao giờ trỏ tới đường dẫn tùy ý.
- **Nhóm repo:** (1) app nặng/native/workflow/bot = _đại diện_ mở ở ngoài, trung tâm hiện trạng thái, nối MCP nếu có; (2) dữ liệu (skill, tài liệu, mẫu) = lưu đúng kho, kèm một **kho tri thức mới** (khác artifact); (3) web-embed qua gói Browser; (4) tool/CLI/SDK = gọi tool (`/`, `*`), terminal, hoặc lệnh nhanh; (5) mô hình AI = tính năng chọn thư mục model theo tác vụ, không phải gói; (6) tiện ích mở rộng = chức năng của app (mục 6).
- **Bỏ khỏi v1:** WASM/Pyodide, tự dựng form từ schema, chuyển mã giữa ngôn ngữ lập trình.

## 3. Luồng hoạt động

`/repotopackage <url|thư mục>` → lấy nguồn và lọc tệp nhạy cảm → đọc các tệp nhỏ quyết định (package.json, pyproject.toml, requirements.txt, `.env.example`, compose) và quét biến môi trường trong mã → **classifier** trả `archetype` + `connections` + `openItems` → **packager** ghi `source/` + `adapter/adapter.json`, ký, ghi, đọc lại và xác minh → **chatRunner / turn** cài những kết nối Hub chạy được (skill vào kho skill, MCP vào danh mục MCP ở trạng thái tắt) và in báo cáo.

## 4. Đã làm (chưa commit)

| Tệp                                                    | Vai trò                                                                                                                                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/desktop/src/common/packages/adapter.ts`      | Schema `adapter.json` (ghi chặt), `readAdapterDocument` (đọc rộng, không ném lỗi), `openItems`, `adapterFromManifest` cho gói cũ, danh sách kết nối cài được (`mcp`, `skill`)                                                                                |
| `.../common/packages/serviceDetector.ts`               | Nhận Next.js, Nuxt, Astro, SvelteKit, Vite, CRA, Angular, Vue CLI, Streamlit, Gradio, Flask, FastAPI từ nhiều thư mục; sinh lệnh cài/chạy từ khuôn mẫu; đoán cổng; biến môi trường từ `.env.example` và mã (`scanEnvironmentUsage`); `findUnclaimedProjects` |
| `.../common/packages/repoClassifier.ts`                | `connections`, loại `agent-skill` và `web-service-app`, `openItemsFor`, sửa lỗi gán nhầm `unsupported-native` cho repo có tệp C++ do Flutter sinh                                                                                                            |
| `.../repoPackaging/packager.ts`                        | Bố cục `source/` + `adapter/` cho `mcp-tool-server`, `agent-skill`, `web-service-app`; đọc tệp dịch vụ và quét biến môi trường; thêm `needs-runtime`                                                                                                         |
| `.../repoPackaging/skillInstall.ts`                    | Giải nén thư mục skill khỏi `.tomny`; `orderSkillRoots` (bản ngoài cùng thắng)                                                                                                                                                                               |
| `.../repoPackaging/{chatRunner,report,types,index}.ts` | Truyền kết nối, báo cáo (lệnh sẽ chạy, biến cần điền, việc còn mở)                                                                                                                                                                                           |
| `.../nativeConversation/repoPackagingTurn.ts`          | Cài skill (bỏ trùng tên), đề nghị MCP                                                                                                                                                                                                                        |
| Test                                                   | `tests/unit/package-manager/adapter.test.ts`, `adapter.compat.test.ts`, `repoPackaging/{skill,services,mcp}.test.ts`                                                                                                                                         |

**Kiểm tra (2026-10-09):** 226 test pass trong 11 tệp (adapter, adapter.compat, repoPackaging/\*, repoToPackageTurn), gồm test cho `openItems`. `tsc` và `oxlint` không báo lỗi mới ở các tệp này. Lần chạy toàn bộ `tests/unit/package-manager` và `tests/unit/chat` (886 test pass) diễn ra **trước** khi thêm `openItems`; chưa chạy lại toàn bộ sau đó.

**Chạy thật trên repo GitHub:** `diagram-design` (1 skill, 9 MB); `context7` (1 MCP + 10 skill, 7 bản trùng theo từng host, 20 MB); `MediSign_AI-legacy` (ra `web-service-app`: backend FastAPI cổng 8000 + web Next.js cổng 3000, 3 tệp `.bat` có khóa OpenAI bị loại). Lệnh: `bun scripts/repo-to-package.ts <url> --output <thư mục>`.

## 5. Chưa làm (theo thứ tự đề xuất)

> Đã thay bằng mục 5 (ma trận bao phủ) và mục 18 (task theo đợt) của [repotopackage-design.md](repotopackage-design.md). Danh sách dưới đây giữ để tham khảo.

1. Runtime chạy tiến trình có giám sát. Đây là thứ duy nhất đang chặn các kết nối `web-embed` (như MediSign) chạy thật.
2. `web-embed` từ URL (website thành app, cookie `partition` riêng, danh sách nguồn được phép), nút Terminal ở Home cho `cli`, lệnh `/` `*` cho `tool`, dò app cài sẵn cho `launcher`.
3. Chuyển gói web, theme, viewer sang bố cục chuẩn (hiện còn bố cục cũ vì sandbox mở `entrypoint` từ gốc gói). Nối `adapterFromManifest` và `readAdapterDocument` vào trình cài gói (`PackageManagerService`). Ghi gói theo luồng để bỏ trần dung lượng (hiện dựng cả gói trong bộ nhớ, còn `DEFAULT_LIMITS`: 10 000 tệp, 100 MB).
4. Hạn chế đã biết của phần nhận dịch vụ: pydantic `env_prefix` chưa được tính; `.env.example` ở gốc gắn cho mọi dịch vụ; `docker-compose.yml` chỉ ghi chú; chưa nhận `bin` thành `cli`; chưa có `tool`, `launcher`, `bridge`.
5. Kết nối `extension` (mục 6), `hook` (mục 7), kho tri thức (mục 9), plugin runtime.

## 6. Tiện ích mở rộng (đã có tài liệu)

Xem [extension-model.md](extension-model.md) (do subagent viết từ bản tóm tắt của tôi; **tôi mới kiểm tra cấu trúc, chưa đọc hết từng mục**). Ý chính: extension là một chức năng của Hub; tab "Tiện ích" dưới Store để import/quản lý; header ghim tối đa 3 tiện ích, bấm mở popup; mỗi tiện ích có trường đích (`none` = thử được trên mọi app, không tự bật); mỗi package app khai báo điểm kết nối và khả năng; **Tomny có cầu nối** nên tiện ích không bao giờ chạm trực tiếp package app. Repo GitHub chạy theo định dạng Chrome (Electron), tiện ích tự viết cho Tomny dùng định dạng riêng.

**Đã đo:** nạp được extension MV3 trong Electron 37.10.3 (Chromium 138) bằng `session.extensions.loadExtension` trong phiên riêng; chạy được content script, service worker, nhắn tin, `storage.local`, `alarms`, luật `declarativeNetRequest`, badge, `tabs.query`; **thiếu** `windows`, `cookies`, `contextMenus`, `webNavigation`, `webRequest`, `downloads`, `history`, `bookmarks`, `permissions`, `commands`, `notifications`, `offscreen`, `sidePanel`, `identity`, `storage.sync`, `tabs.create`. Giới hạn: extension tự viết, một tập con API, một lần chạy, không phải phiên mặc định của Hub.

**Trong code Hub:** mỗi tab Browser là `WebContentsView`; mặc định **không đặt `partition`**, dùng chung phiên đăng nhập thật; nên extension phải nạp vào `partition` riêng. Hệ "extension" hiện có của Hub (`ExtensionSettingsPage`) là thứ khác (thêm tab vào Cài đặt).

## 7. Hook (chưa có tài liệu; hướng đã bàn, **chưa chốt hết**)

> Đã thay bằng mục 11 (bộ chạy hook) của [repotopackage-design.md](repotopackage-design.md).

Hook kiểu Claude Code (lệnh chạy khi có sự kiện). Tomny đã có hệ stage gắn vào mốc (`packages/desktop/src/common/types/pipeline.ts`): mốc `pre_query`, `retrieve`, `pre_model`, `post_model`; quyết định `continue|rewrite|block|skip|direct_action`; vai trò `guard|standard`; metadata stage đã có `packageId`. Đề xuất: **"Command hook" là một stage tích hợp**, mỗi hook là một bản sao với `config` `{event, command, args, timeoutMs}`; `UserPromptSubmit` ≈ `pre_query`, `Stop` ≈ `post_model`. Chưa thấy mốc `PreToolUse`/`PostToolUse`/`SessionStart` trong pipeline.

Tomny không sở hữu vòng lặp công cụ của các CLI khác (ACP), nên có ba lớp chặn: (1) pipeline chat; (2) chỗ Tomny là người gác cổng: yêu cầu cấp quyền từ tác tử ACP (tiền lệ: `packages/desktop/src/common/chat/approval/ideToolGuard.ts`) và các công cụ `tomny_*`/MCP Tomny tự phục vụ; (3) chuyển tiếp hook sang cấu hình của chính CLI (ví dụ `.claude/settings.local.json` trong workspace, cần xin phép).

**Ràng buộc đã nêu:** hook là loại duy nhất mà lệnh chạy lấy thẳng từ repo, nên cần người dùng xem và duyệt từng hook, chỉ chạy tệp trong `source/` của gói, có timeout, không cấp mạng mặc định; **hook không bao giờ nhận vai trò `guard`** và chỉ được làm chặt hơn, không được nới lỏng quyết định của guard. **Còn chờ người dùng:** hook chỉ quan sát hay được can thiệp (tôi nghiêng về quan sát trước); thứ tự mốc công cụ. Tài liệu chính thức của Claude Code chưa đối chiếu được (công cụ tìm web và subagent đọc tài liệu đều lỗi quyền model).

## 8. Chưa kiểm tra (đừng coi là đã xác nhận)

- Bước cài skill trong chat trên app Electron thật (chỉ phần giải nén có test).
- Các lệnh sinh ra có chạy được trên máy thật (chưa có runtime để thử).
- Header có chỗ cho ba ô ghim chưa; cách render popup an toàn; Browser có phơi danh sách khả năng cho cầu nối không; hệ extension hiện có dùng chung được không.
- Home có chỗ cho nút Terminal và chế độ terminal thay thanh chat chưa.
- Gói Browser/IDE khai báo điểm mở rộng nào; Hub có chặn khi `dependencies`/`contributions` lệch không.
- Electron 37 có nạp Manifest V2 không; luật `declarativeNetRequest` có thực sự chặn không.
- Vòng lặp công cụ native của Tomny và việc ACP có gửi thông báo công cụ không.
- Understand (`mtui understand build`): thử trên MediSign và context7 cho `entryPoints` rỗng, `technologies` chỉ là ngôn ngữ; kết luận: chỉ dùng để chuẩn bị bản đồ gọn cho agent, **không** dùng để quyết định kết nối.

## 9. Kho tri thức và Explorer (ý đã bàn, chưa thiết kế)

Kho tri thức là **tính năng của Hub, không phải package app**, nằm ở sidebar dưới Store. Mặt 1: người dùng thêm tệp, kho chỉ ghi **đường dẫn** (không sao chép), bấm vào thì nội dung hiện ngay tại trang kho, nút Back về danh sách của kho (không về Home); tệp mất thì hiện "không còn ở đây" kèm chọn lại đường dẫn. Mặt 2: kiểu NotebookLM (nguồn, hỏi đáp có trích dẫn, tóm tắt). Khác với `tomny_wiki` (chỉ tóm tắt dự án qua Understand) và khác artifact. Điều kiện cần: **trình xem tệp ở trung tâm**. Hiện double-click tệp ở Explorer gọi `open` → `shell.openPath` (`explorerBootstrap.ts:110`), tức mở bằng ứng dụng mặc định của Windows, chưa có đường tới trung tâm Hub.

## 10. Tài liệu cần đọc, theo thứ tự

1. `AGENTS.md`, `docs/README.md`
2. `docs/platform/package-shell-layout.md` (thiết kế chính; mục 11 là trạng thái cài đặt, mục 12 quy tắc tương thích, mục 14 các nhóm repo)
3. `docs/platform/extension-model.md`
4. `docs/platform/package-taxonomy.md` (7 nhóm package, mục Agent Skill) và `docs/platform/packages.md` (manifest, sandbox)
5. `docs/core/chat-pipeline.md` (cho hook) và `docs/core/trust-and-understanding.md`
6. Mã: `common/packages/{adapter,serviceDetector,repoClassifier}.ts`, `process/extensions/package-manager/repoPackaging/{packager,chatRunner,report,skillInstall}.ts`, `process/services/database/nativeConversation/repoPackagingTurn.ts`, `common/types/pipeline.ts`, `process/browser/browserViewManager.ts`
7. Bộ nhớ dự án: `C:\Users\MyPC\.claude\projects\C--NDT-PJ-TomniHubOS\memory\project-repotopackage-shell-source-layout.md` và `project-laya-pipeline-mtui-repotopackage-state.md`

## 11. Kiểm tra và môi trường

- Test tập trung: `npx vitest run tests/unit/package-manager tests/unit/chat/repoToPackageTurn.test.ts`.
- Kiểu và lint: `npx tsc --noEmit -p packages/desktop`, `npx oxlint <tệp>`. Cảnh báo có từ trước, không phải của phần này: `mcp.test.ts` (consistent-function-scoping), `packager.ts` (no-map-spread ở chỗ theme), `build.test.ts`, `designViu.ts`. `repoClassifier.ts` chưa được Prettier định dạng từ trước (đừng định dạng lại cả tệp).
- Định dạng tệp mới: `npx prettier <tệp> > .tmp/x && mtui new <tệp> --content-file .tmp/x --overwrite`.
- Bẫy MTUI: `mtui edit ... replace` và `edit-many` **gộp `\\` thành `\`** và không khớp được chuỗi có dấu `\`; dùng `edit <tệp> line <số> replace "<nội dung>"` hoặc viết không dùng ký tự `\`. `mtui new --content-file` giữ nguyên dấu `\`.
- Ổ C: đầy 99% (còn khoảng 7 GB). WebSearch, WebFetch và subagent `claude-code-guide` lỗi quyền model; dùng `curl` tới GitHub API hoặc `raw.githubusercontent.com` để đọc repo.
