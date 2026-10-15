# Thiết kế: `/repotopackage` v2 và các chức năng xung quanh

**Trạng thái:** `TARGET`. Thiết kế **đã được người dùng duyệt** ngày 2026-10-09, gồm cả các câu hỏi Q1–Q6 (mục 19); **chưa cài đặt**. Mọi nhận định về hiện trạng ở mục 3 đã được đối chiếu với mã ngày 2026-10-09.  
**Phạm vi:** biến bất kỳ repo GitHub (hoặc thư mục, hoặc website) thành thứ dùng được ngay trong Tomny, bằng giao diện hoặc qua agent. Gồm cả các chức năng xung quanh để gói có chỗ xuất hiện: Store, Tiện ích, bảng lệnh `/`, Agents, Hooks, Browser, Apps, Terminal, Thư viện.  
**Thay thế:** mục 5 ("Chưa làm") của [repotopackage-brief.md](repotopackage-brief.md). Bổ sung (không thay) [package-shell-layout.md](package-shell-layout.md) và [extension-model.md](extension-model.md); chỗ nào hai tài liệu đó khác tài liệu này thì tài liệu này thắng và đã ghi chú ở đó.

---

## 0. Cách dùng tài liệu này

Tài liệu dành cho agent con nhận task ở mục 18. Trước khi làm bất kỳ task nào:

1. Đọc [AGENTS.md](../../AGENTS.md). Mọi thao tác tạo, sửa, xóa tệp trong repo đi qua lệnh ghi của MTUI (`packages/mtui/target/debug/mtui.exe`). Tệp tạm đặt ngoài repo hoặc dưới `.tmp/<tên-task>/`.
2. Cây làm việc **bẩn**, nhiều phiên sửa song song. Không `git stash`, không sửa tệp ngoài danh sách được phép của task, chạy `git status --short` trước và sau. Không commit trừ khi Integrator giao quyền commit.
3. Đọc mục 1–4 của tài liệu này, rồi mục riêng của task, rồi các tệp mã mà task nêu.
4. Nhãn trạng thái: `CURRENT` (có mã hoặc test chứng minh), `PARTIAL`, `TARGET`, `BLOCKED`. Khi task xong, đề xuất nhãn mới (kèm đường dẫn mã và test) trong bàn giao; chỉ Integrator sửa tài liệu này (AGENTS.md mục 8 giao trạng thái chuẩn cho Integrator).
5. Gặp điều tài liệu chưa nói hoặc mâu thuẫn với mã: dừng task đó, ghi rõ vào báo cáo bàn giao. Không tự chọn một bên (AGENTS.md mục 2).

Ghi chú về quy tắc: AGENTS.md giao lịch thực thi (checkpoint C0–C6) cho [docs/execution/mvp-plan.md](../execution/mvp-plan.md). Danh sách task ở mục 18 là phân rã công việc của riêng tính năng này; Integrator chép trạng thái checkpoint sang mvp-plan.md khi xếp lịch.

---

## 1. Mục tiêu và tiêu chí thành công

**Mục tiêu:** dán một link GitHub, nhận về một gói mà Tomny dùng được ngay mọi phần dùng được, phần còn lại hiện rõ cần gì. Không cài tay, không viết lại, không tốn token cho phần làm được bằng quy tắc.

**Tiêu chí (đo trên bộ repo mẫu ở mục 17):**

| #   | Tiêu chí                                                                                                                     | Ngưỡng                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| C1  | Repo trong bộ mẫu có ít nhất một kết nối dùng được ngay sau khi bật                                                          | ≥ 90 % (trừ nhóm "chỉ mã native") |
| C2  | Tệp khai báo được nhận ra nhưng không thành kết nối và cũng không thành `openItem`                                           | 0                                 |
| C3  | Nhận diện, đóng gói, cài không gọi mô hình AI                                                                                | 0 token                           |
| C4  | Không có gì chạy khi cài; mọi kết nối chạy mã đều tắt cho tới khi người dùng thấy đúng lệnh và bật                           | 100 %                             |
| C5  | Gỡ gói để lại kho skill, MCP, lệnh, agent, hook, extension, tiến trình đúng như trước khi cài                                | 100 % (kiểm bằng test đối chiếu)  |
| C6  | Cập nhật từ GitHub giữ nguyên trạng thái bật của kết nối không đổi; kết nối chạy mã có nội dung đổi thì tự tắt chờ duyệt lại | 100 %                             |
| C7  | Mỗi loại kết nối có chỗ xuất hiện trong giao diện (mục 14) và, nếu hợp lý, đường cho agent dùng                              | mọi loại ở mục 10                 |

---

## 2. Quyết định đã chốt

| ID  | Quyết định                                                                                                                                                                               | Ngày, nguồn                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| D1  | Cấu trúc gói chuẩn: `tomny-package.json` + `adapter/adapter.json` + `source/` (nguyên repo). Chữ ký phủ cả hai. Gói cũ đọc qua bộ chuyển đổi                                             | 2026-10-08, người dùng                                             |
| D2  | Người ghi chặt, người đọc rộng. Thêm loại hoặc trường không đổi `schemaVersion`                                                                                                          | 2026-10-09, người dùng                                             |
| D3  | Backend làm hết sức bằng quy tắc, không tốn token; phần còn lại giao agent hoặc người dùng qua `openItems`                                                                               | 2026-10-09, người dùng                                             |
| D4  | Không đặt trần dung lượng cho `source/`; vẫn lọc bí mật, symlink, đường dẫn xấu, `.git`                                                                                                  | 2026-10-08, người dùng                                             |
| D5  | Lệnh chạy đến từ khuôn mẫu cố định theo framework, không đọc từ README. Hook là ngoại lệ duy nhất và có quy tắc riêng (mục 11)                                                           | 2026-10-09, người dùng                                             |
| D6  | Mặc định tắt. Người dùng thấy đúng lệnh hoặc đúng URL rồi mới bật                                                                                                                        | 2026-10-08, người dùng                                             |
| D7  | `/repotopackage` là chức năng sống còn: mục tiêu là dùng được **mọi** loại repo GitHub; tập trung vào toàn bộ chức năng chứ không riêng extension hay hook                               | 2026-10-09, người dùng                                             |
| D8  | Store có đủ mọi loại kết nối, mỗi loại vào được từ ba nguồn: tải từ Store, tự tạo, từ repo GitHub                                                                                        | 2026-10-09, người dùng                                             |
| D9  | Extension Chrome lấy Chrome làm chuẩn: chạy trên mọi tab người dùng duyệt, nhưng trong **hồ sơ duyệt web riêng** (phân vùng bền), không bao giờ trong phiên của giao diện Hub (mục 12.1) | 2026-10-09, người dùng giao quyết định cho agent; lý do ở mục 12.1 |
| D10 | Phần bù API Chrome do Tomny tự viết (Apache-2.0) vì sản phẩm sẽ kinh doanh. Không dùng `electron-chrome-extensions` (GPL-3 hoặc phải mua giấy phép). Thư viện MIT được phép dùng         | 2026-10-09, người dùng                                             |
| D11 | Hook theo định dạng của Claude Code; hook chỉ siết, không nới quyền (mục 11.6)                                                                                                           | 2026-10-09, đề xuất của agent, người dùng duyệt; xem D16           |
| D12 | Bỏ khỏi v1: WASM/Pyodide, tự dựng form từ schema, chuyển mã giữa ngôn ngữ                                                                                                                | 2026-10-08, người dùng                                             |
| D13 | Chưa viết mã cho tới khi người dùng duyệt tài liệu này                                                                                                                                   | 2026-10-09, người dùng                                             |
| D14 | Cài extension từ Chrome Web Store theo ID hoặc URL (mục 12.6). Người dùng chấp nhận rủi ro về điều khoản của Web Store; nguồn này có công tắc tắt riêng                                  | 2026-10-09, người dùng                                             |
| D15 | Chuyển Browser sang hồ sơ duyệt web riêng dù một số trang phải đăng nhập lại; ghi trong ghi chú phiên bản                                                                                | 2026-10-09, người dùng                                             |
| D16 | Không có chế độ cho hook nới quyền: `allow` của hook không bao giờ bỏ qua bước hỏi                                                                                                       | 2026-10-09, người dùng                                             |
| D17 | Skill trùng tên với skill người dùng đã có: hỏi, không ghi đè                                                                                                                            | 2026-10-09, người dùng                                             |
| D18 | Chỉ kiểm bản mới khi người dùng bấm; không có kiểm định kỳ ở v1                                                                                                                          | 2026-10-09, người dùng                                             |
| D19 | Tên bề mặt mới: "Thư viện" (kho tài liệu) và "Tiện ích" (extension)                                                                                                                      | 2026-10-09, người dùng                                             |

---

## 3. Hiện trạng (đối chiếu mã ngày 2026-10-09)

Đường dẫn tính từ `packages/desktop/src/` nếu không ghi khác.

### 3.1 Đã có và dùng lại được

| Thành phần                                                                                                                                                               | Bằng chứng                                                                                                                                    | Dùng cho                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Schema `adapter.json`: 7 loại kết nối, ghi chặt, đọc rộng (`readAdapterDocument` không ném lỗi), `openItems`                                                             | `common/packages/adapter.ts`; `tests/unit/package-manager/adapter.test.ts`, `adapter.compat.test.ts`                                          | Mở rộng ở T0.1                                                             |
| Nhận diện dịch vụ web (Next.js, Vite, Gradio, FastAPI…), lệnh từ khuôn mẫu, cổng, biến môi trường                                                                        | `common/packages/serviceDetector.ts`; `tests/unit/package-manager/repoPackaging/services.test.ts`                                             | Chuyển thành detector ở T1.8                                               |
| Nguồn: Git `https` trên github.com, gitlab.com, bitbucket.org, codeberg.org (clone nông); thư mục cục bộ phải nằm trong workspace                                        | `process/extensions/package-manager/repoPackaging/sourceResolver.ts`                                                                          | Giữ nguyên                                                                 |
| Lọc tệp: bí mật, symlink, đường dẫn xấu, giới hạn `DEFAULT_LIMITS` 10 000 tệp, 100 MB, 20 MB mỗi tệp                                                                     | `process/extensions/package-manager/repoPackaging/fileScreen.ts:31`                                                                           | Bỏ trần tổng ở T0.5                                                        |
| Khóa ký Ed25519 cục bộ của máy                                                                                                                                           | `process/extensions/package-manager/repoPackaging/signingKey.ts`                                                                              | Mức tin cậy `local-built` (T0.4)                                           |
| `/repotopackage` được nhận ở chỗ gửi tin chung, trước pipeline và trước mọi agent                                                                                        | `process/services/database/nativeConversation/bridge.ts:287`                                                                                  | Giữ; lệnh của gói cũng mở rộng ở đây (T2.3)                                |
| **Mọi giao diện chat** (ACP, OpenClaw, Nanobot, Remote, Tomny) gửi qua cùng `conversation.sendMessage`                                                                   | `common/adapter/ipcBridge.ts:283,846,919`                                                                                                     | Hook và lệnh gói đặt ở đây là phủ toàn bộ                                  |
| Mọi tác tử chạy qua `CoreAdapter.run({ emit, requestPermission })`                                                                                                       | `process/experimentalCore/adapters/coreAdapter.ts`; `experimentalCoreRuntime.ts:1217` (`requestPermission`), `:1386`, `:2077` (`adapter.run`) | Điểm gắn hook (mục 11)                                                     |
| Tác tử Tomny native hỏi Tomny trước **mỗi** công cụ (`tomnyToolAccessForPermission`)                                                                                     | `process/experimentalCore/adapters/tomnyCoreAdapter.ts` (khoảng dòng 1775)                                                                    | `PreToolUse` chặn được mọi công cụ native                                  |
| Danh mục MCP hỗ trợ `stdio`, `sse`, `http`, `streamable_http` và có trường nguồn gốc `extension`                                                                         | `common/config/storage.ts:661-686`                                                                                                            | MCP từ xa (T2.2)                                                           |
| Đồng bộ MCP của gói vào danh mục ở trạng thái tắt (chỉ `stdio`)                                                                                                          | `process/resources/mcpRegistry/packageMcpSync.ts`                                                                                             | Mở rộng ở T2.2                                                             |
| Kho skill (`NativeSkillCatalog.import`)                                                                                                                                  | `process/resources/nativePlatform/skillCatalog.ts`; `process/extensions/package-manager/repoPackaging/skillInstall.ts`                        | Host `skill` (T2.1)                                                        |
| Danh mục Assistant có `context` (prompt hệ thống), `enabled_skills`, `models`                                                                                            | `common/types/agent/assistantTypes.ts`; `process/resources/assistantCatalogStore.ts`                                                          | Host `agent` (T2.4)                                                        |
| Kiểu lệnh slash có `kind: 'template'`; nguồn chỉ có `acp` và `builtin`; danh sách lấy qua `conversation.getSlashCommands`                                                | `common/chat/slash/types.ts`; `renderer/hooks/chat/useSlashCommands.ts`                                                                       | Host `command` (T2.3)                                                      |
| Kho bí mật của gói (handle mờ, cấp quyền theo gói) và mục giao diện                                                                                                      | `process/resources/packageSecrets/`; `renderer/pages/hub/StoreProductDetail/PackageSecretsSection.tsx`                                        | Giá trị `.env` (T2.6)                                                      |
| Bộ giám sát đóng góp bền của gói: bật, hủy theo đúng danh tính, bằng chứng, đóng an toàn                                                                                 | `process/resources/packageProcessRuntime/persistentContributionSupervisor.ts`, `packageProcessRuntimeSupervisor.ts`                           | Runtime tiến trình (T5.1)                                                  |
| Chạy Node bằng chính Electron (`ELECTRON_RUN_AS_NODE`)                                                                                                                   | `process/router9/managedRouter9.ts:427`                                                                                                       | Script Node của hook, MCP và CLI từ mã nguồn không cần người dùng cài Node |
| Diệt cả cây tiến trình trên Windows (`taskkill /T /F`)                                                                                                                   | `process/router9/managedRouter9.ts:177`; `process/ideTerminal/ptyBackend.ts:110`                                                              | Bộ chạy hook, runtime tiến trình                                           |
| Terminal pty                                                                                                                                                             | `process/ideTerminal/`                                                                                                                        | Host `cli` (T5.5)                                                          |
| Nút Terminal ở thanh trạng thái của Hub: mở gói Terminal nếu đã cài, không thì sang Store                                                                                | `renderer/pages/guid/shell/HubShell.tsx:438`                                                                                                  | Menu CLI (T5.5)                                                            |
| Pipeline chat với stage, vai trò `guard`/`standard`, metadata có `packageId`                                                                                             | `common/types/pipeline.ts`; `process/services/chatPipeline/`                                                                                  | Stage `builtin:user-hooks` (T3.4)                                          |
| Hook theo tệp của IDE (chạy lệnh hoặc hỏi agent khi lưu tệp)                                                                                                             | `package-apps/ide/src/renderer/hooks/useIdeHooks.ts`; `package-apps/ide/src/process/coding/hooks/`                                            | Tách biệt; nối sau qua `FileChanged`                                       |
| Electron 37.10.3 có `ses.extensions.loadExtension`, `ses.registerPreloadScript({ type: 'service-worker' })`, `ServiceWorkerMain.ipc`, `contextBridge.executeInMainWorld` | `node_modules/electron/electron.d.ts`                                                                                                         | Host extension và phần bù API (mục 12)                                     |

### 3.2 Thiếu hoặc sai (gốc của thiết kế này)

| #   | Vấn đề                                                                                                                                                                  | Bằng chứng                                                                                                                          | Hệ quả                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| G1  | Classifier dừng ở loại khớp đầu tiên                                                                                                                                    | `common/packages/repoClassifier.ts:326` (`classifyRepository`, mỗi nhánh `return`)                                                  | Repo nhiều lát cắt mất gần hết                                                                 |
| G2  | Gói do `/repotopackage` tạo **không cài được** qua trình quản lý gói: `PackageTrust` chỉ có `trusted-first-party`, `signed-first-party`, `signed-store`                 | `common/packages/types.ts:12`; `PackageManagerService.ts:296`                                                                       | Gói từ GitHub không có trong danh sách đã cài, không tắt hay gỡ được theo gói                  |
| G3  | Kết nối `mcp` chỉ nhận `npx`/`uvx`                                                                                                                                      | `adapter.ts` (`command: z.enum(['npx','uvx'])`)                                                                                     | MCP từ xa (`"type":"http"`, như plugin context7) không đóng gói được                           |
| G4  | Không đọc plugin của nền tảng khác (`.claude-plugin`, `.codex-plugin`, `.github/plugin`, `gemini-extension.json`, marketplace)                                          | Không có mã                                                                                                                         | Lệnh, agent, hook, MCP trong plugin bị bỏ                                                      |
| G5  | Không có bộ chạy hook cho tác tử                                                                                                                                        | Không có mã                                                                                                                         | Hook của plugin không chạy được                                                                |
| G6  | Browser chưa nạp extension; tab dùng phiên mặc định, **chung với cửa sổ Hub** (Hub nạp bằng `loadFile`, tức `file://`)                                                  | `process/browser/browserViewManager.ts`; `index.ts:464-495`                                                                         | Nạp extension vào phiên mặc định thì content script `<all_urls>` có thể chạm vào giao diện Hub |
| G7  | Không có bộ xử lý quyền web (`setPermissionRequestHandler`) cho phiên của Browser                                                                                       | Tìm trong `process/` không có                                                                                                       | Lỗ hổng sẵn có, sửa khi chuyển hồ sơ (T4.1)                                                    |
| G8  | Renderer tự chọn `partition` khi mở tab                                                                                                                                 | `common/packages/browserHost.ts` (`OpenTabRequest.partition`)                                                                       | `web-embed` phải lấy phân vùng do Main quyết định                                              |
| G9  | Store chỉ có một danh sách từ catalog; không có "Đã cài" cho gói cục bộ, không có tab Tiện ích, không quản lý theo kết nối                                              | `renderer/pages/hub/HubWorkspacePage.tsx:183`                                                                                       | Gói từ repo không có chỗ xuất hiện                                                             |
| G10 | Sidebar chỉ có Home, Company, Artifacts, Schedule, Store, Notifications                                                                                                 | `renderer/pages/guid/HubHome/HubSidebar.tsx:57-62`                                                                                  | Chưa có chỗ cho Thư viện                                                                       |
| G11 | Explorer mở tệp bằng ứng dụng mặc định của Windows                                                                                                                      | `process/resources/explorer/explorerBootstrap.ts:110`                                                                               | Chưa có trình xem tệp ở trung tâm                                                              |
| G12 | Runtime tiến trình chỉ dành cho runtime cố định của first-party (Pet, Design VIU)                                                                                       | `process/resources/packageProcessRuntime/`                                                                                          | `web-embed` process, `cli`, `service` chưa chạy được                                           |
| G13 | Packager dựng cả gói trong bộ nhớ, còn trần 100 MB; ổ C của máy phát triển còn khoảng 7 GB                                                                              | `process/extensions/package-manager/repoPackaging/packager.ts`, `process/extensions/package-manager/repoPackaging/fileScreen.ts:31` | Repo lớn thất bại hoặc làm đầy đĩa                                                             |
| G14 | Gói web, theme, viewer vẫn dùng bố cục cũ (nội dung ở gốc gói)                                                                                                          | Mục 11 của package-shell-layout.md                                                                                                  | Hai bố cục song song                                                                           |
| G15 | Tên "Knowledge" đã dùng cho gói `com.tomni.knowledge` (Realtime Knowledge, kho dữ kiện)                                                                                 | `packages/package-apps/knowledge/`                                                                                                  | Kho tài liệu mới phải đặt tên khác: **Thư viện** (Library)                                     |
| G16 | `conversation.getSlashCommands` gọi HTTP `/api/conversations/:id/slash-commands`, nhưng không tìm thấy nơi phục vụ endpoint này trong repo (chưa xác minh khi app chạy) | `common/adapter/ipcBridge.ts:309`; `common/chat/slash/availability.ts`                                                              | Lệnh của gói đi qua IPC mới của Main, không dựa vào endpoint này                               |

---

## 4. Kiến trúc tổng thể

```text
 Nguồn: URL GitHub | thư mục | URL website | tệp .crx/.zip | Store | trình tạo của người dùng
   │
   ▼
 [1] Lấy nguồn       sourceResolver (đã có)            ──► thư mục tạm chỉ đọc
 [2] Lọc             fileScreen (đã có)                 ──► danh sách tệp an toàn
 [3] Bản kê          inventory (mới, T0.2)              ──► cây tệp + nội dung các tệp khai báo nhỏ
 [4] Nhận diện       detectors[] (mới, T1.*)            ──► kết nối + openItems + lý do, theo từng hệ sinh thái
 [5] Gộp             merge (mới, T0.2)                  ──► bỏ trùng, nhóm theo plugin, nhóm thay thế
 [6] Đóng gói        packager (sửa, T0.5)               ──► source/ + adapter/adapter.json + chữ ký + nguồn gốc
 [7] Cài             PackageManagerService (sửa, T0.4)  ──► gói `local-built`, trạng thái từng kết nối = tắt
 [8] Bật kết nối     ConnectionHost theo loại (mới)     ──► kho skill, MCP, lệnh, agent, hook, extension, tiến trình…
 [9] Xuất hiện       các bề mặt giao diện (mục 14)      ──► Store, Tiện ích, `/`, Agents, Hooks, Browser, Apps, Terminal, Thư viện
[10] Cập nhật        provenance + diff (T2.9)           ──► quay lại [1] với cùng nguồn, giữ trạng thái hợp lệ
```

Nguyên tắc ranh giới:

- [1]–[6] là thuần dữ liệu: không chạy mã của repo, không gọi mô hình, không gọi mạng ngoài bước clone (và bước tra Releases tùy chọn ở mục 7.4).
- [7] không bật gì. [8] là chỗ duy nhất làm thay đổi hành vi của Hub, và chỉ khi người dùng bật.
- Mỗi loại kết nối có đúng một `ConnectionHost` sở hữu việc bật, tắt, kiểm trạng thái, dọn dẹp. Host không biết về detector; detector không biết về host. Hai bên chỉ chung schema `adapter.json`.
- Mọi đường thực thi mới phải nêu đủ bảy điểm của AGENTS.md mục 6 (danh tính, quyền yêu cầu, duyệt, ranh giới bí mật, đích mạng, giới hạn, bằng chứng). Mục 15 tổng hợp cho từng host.

### 4.1 Vị trí mã

AGENTS.md cấm làm một thư mục nguồn vượt 10 mục con trực tiếp. Các thư mục liên quan đều đã vượt từ trước (ngày 2026-10-09: `common` 20, `common/packages` 16, `process` 40, `process/browser` 15, `process/extensions/package-manager` 12, `process/resources/packageProcessRuntime` 12, `renderer/pages` 18, `renderer/pages/hub` 12, `tests/unit` 76). Vì vậy mỗi phía chỉ thêm **một gốc mới**, mọi mã mới lồng bên dưới, mỗi thư mục con ≤ 10 mục:

```text
packages/desktop/src/common/integrations/          (gốc mới duy nhất ở common)
  detectors/        types.ts, inventory.ts, merge.ts, index.ts, agent/, apps/
    agent/          agentPlugins, mcpConfig, mcpPublished, gemini, commandsAgents, hooks, rules, skills
    apps/           browserExt, cliLauncher, services, knowledgeMisc, legacy (bọc web tĩnh, theme, chat-stage, workflow)
  hooks/            events, config, matcher, output, placeholders
  extensions/       chromeApiTable (bảng API có phần bù), userscriptHeader

packages/desktop/src/process/integrations/         (gốc mới duy nhất ở process)
  connections/
    core/           registry, types, state, approval, runtimeProbe, envValues
    hosts/data/     skillHost, commandHost, agentHost, rulesHost, knowledgeHost
    hosts/exec/     mcpHost, hookHost, extensionHost, webEmbedHost, cliHost, serviceHost, launcherHost
  hooks/            hookRunner, hookRegistry, hookAudit
  runtime/          repoProcessEndpoint, installedAppProbe
  browserExtensions/ profile, host, store, api/, preload/, userscript/
  library/          kho Thư viện
  repoSources/      update, releases, folder, crx

packages/desktop/src/renderer/pages/integrations/  (gốc mới duy nhất ở renderer/pages)
  store/            Đã cài, Thêm từ GitHub, tab Tiện ích
  hooks/            trang Hooks (Cài đặt liên kết tới đây)
  library/          Thư viện
  fileViewer/       trình xem tệp ở trung tâm

Thư mục còn chỗ, thêm trực tiếp:
  renderer/pages/hub/StoreProductDetail/connections/          (5 → 6)
  renderer/components/layout/Titlebar/ExtensionPins.tsx       (8 → 9)
  package-apps/browser/src/renderer/browser/components/extensions/   (7 → 8)
  process/services/chatPipeline/stages/userHooksStage.ts      (6 → 7)

tests/unit/integrations/{detectors,hooks,connections,browserExtensions}/   (gốc test mới duy nhất)
tests/fixtures/repotopackage/                                              (4 → 5)
```

`common/packages/adapter.ts` được sửa tại chỗ. Nếu tách, nó thành thư mục `common/packages/adapter/` thay cho tệp, số mục không đổi. Không di chuyển mã cũ chỉ để sửa thư mục quá đầy (AGENTS.md cấm tái cấu trúc không liên quan).

---

## 5. Ma trận bao phủ

Cột "Hiện tại" theo mã ngày 2026-10-09. Cột "Đợt" là đợt ở mục 18.

| #   | Loại repo                                                          | Dấu hiệu nhận                                                                                                                                                                                  | Kết nối                                                               | Hub dùng thế nào                              | Hiện tại                | Đợt                  |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------- | ----------------------- | -------------------- |
| 1   | MCP đã phát hành (npm, PyPI)                                       | `@modelcontextprotocol/sdk` + `bin`; `[project.scripts]`                                                                                                                                       | `mcp` stdio `npx`/`uvx`                                               | Danh mục MCP                                  | CURRENT                 | 1                    |
| 2   | MCP từ xa                                                          | `.mcp.json`/`mcp.json` có `type` `http`/`sse`/`streamable-http` + `url`                                                                                                                        | `mcp` `http`/`sse`                                                    | Danh mục MCP                                  | Thiếu (G3)              | 1–2                  |
| 3   | MCP chạy từ mã nguồn                                               | SDK MCP, chưa phát hành                                                                                                                                                                        | `mcp` stdio, `cwd` trong `source/`, có `setup`                        | Runtime tiến trình                            | Thiếu                   | 5                    |
| 4   | Gói MCP `.mcpb`/`.dxt`                                             | `manifest.json` có `server` và `dxt_version` hoặc `manifest_version` dạng chuỗi                                                                                                                | `mcp` từ bundle                                                       | Node chạy bằng Electron; Python cần `uv`      | Thiếu                   | 1, 5                 |
| 5   | MCP trong Docker                                                   | `docker run -i` trong cấu hình mẫu                                                                                                                                                             | `mcp` stdio `docker`                                                  | Cần Docker                                    | Thiếu                   | 5                    |
| 6   | Agent skill                                                        | `SKILL.md`                                                                                                                                                                                     | `skill`                                                               | Kho skill                                     | CURRENT                 | 2 (chuyển sang host) |
| 7   | Plugin agent: Claude Code, Codex, Copilot, chuẩn agent-plugins.org | `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.github/plugin/`, `plugin.json` có `$schema` của agent-plugins.org, ba vị trí `marketplace.json`                                   | Tách thành `skill`, `mcp`, `command`, `agent`, `hook`, `rules`, `cli` | Mỗi phần vào kho của nó, nhóm theo plugin     | Thiếu (G4)              | 1                    |
| 8   | Extension Gemini CLI                                               | `gemini-extension.json`                                                                                                                                                                        | `mcp`, `rules`, `command`                                             | Như trên                                      | Thiếu                   | 1                    |
| 9   | Lệnh slash, prompt                                                 | `commands/*.md`, `.claude/commands/`, `.github/prompts/*.prompt.md`, `.gemini/commands/*.toml`, `.opencode/command/`                                                                           | `command`                                                             | Bảng `/`                                      | Thiếu                   | 1–2                  |
| 10  | Subagent                                                           | `agents/*.md`, `.claude/agents/`, `.github/agents/*.agent.md`, `.opencode/agent/`                                                                                                              | `agent`                                                               | Agents (Assistant)                            | Thiếu                   | 1–2                  |
| 11  | Hook                                                               | `hooks/hooks.json`, `hooks` trong `plugin.json`, khối `hooks` của `.claude/settings.json`                                                                                                      | `hook`                                                                | Bộ chạy hook                                  | Thiếu (G5)              | 1, 3                 |
| 12  | Quy tắc, ngữ cảnh                                                  | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/*.mdc`, `.cursorrules`, `.github/copilot-instructions.md`, `.github/instructions/`, `.windsurf/rules/`, `.kiro/steering/`, `.clinerules` | `rules`                                                               | Thư viện, gắn vào workspace                   | Thiếu                   | 1, 6                 |
| 13  | Extension Chrome                                                   | `manifest.json` có `manifest_version` 3 (2: đo trước)                                                                                                                                          | `extension` `chrome-mv3`                                              | Browser                                       | Thiếu (G6)              | 1, 4                 |
| 14  | Userscript                                                         | `*.user.js` có `// ==UserScript==`                                                                                                                                                             | `extension` `userscript`                                              | Browser                                       | Thiếu                   | 1, 4                 |
| 15  | Web tĩnh, SPA đã build                                             | `index.html`, `dist/`, `build/`                                                                                                                                                                | (gói web cũ)                                                          | Workspace `#/apps/...`                        | CURRENT                 | —                    |
| 16  | Web full-stack, giao diện Python                                   | Framework (serviceDetector)                                                                                                                                                                    | `web-embed` `process`                                                 | Trung tâm qua Browser                         | PARTIAL                 | 5                    |
| 17  | Website                                                            | Nguồn là URL `https` không phải Git                                                                                                                                                            | `web-embed` `url`                                                     | Trung tâm, phân vùng riêng                    | Thiếu                   | 5                    |
| 18  | CLI                                                                | `bin` (npm), `[project.scripts]`, `[[bin]]` (Cargo), `package main` (Go), tệp chạy trong Releases                                                                                              | `cli`, `tool`                                                         | Terminal; agent qua công cụ của Tomny         | Thiếu                   | 1, 5                 |
| 19  | App desktop, game                                                  | Releases có `.exe`/`.msi`/`.dmg`/`.AppImage`; electron-builder, tauri, Godot                                                                                                                   | `launcher` `installed`                                                | Mở ngoài, trung tâm hiện trạng thái           | Thiếu                   | 1, 5                 |
| 20  | App tự host bằng Docker Compose                                    | `docker-compose.yml`, `compose.yaml`                                                                                                                                                           | `launcher` `compose` + `web-embed` `url` loopback                     | Cần Docker                                    | Thiếu                   | 5                    |
| 21  | Bot, dịch vụ nền                                                   | discord.js, telegraf, grammy, python-telegram-bot, discord.py, Slack Bolt; không có giao diện                                                                                                  | `service`                                                             | Runtime tiến trình, duyệt rõ                  | Thiếu                   | 1, 5                 |
| 22  | Thư viện, SDK                                                      | Có `main`/`exports`, không `bin`, không giao diện                                                                                                                                              | `knowledge` (+ `tool` nếu có CLI)                                     | Thư viện                                      | Thiếu                   | 1, 6                 |
| 23  | Tài liệu, awesome-list, bộ prompt, dataset                         | Chủ yếu `.md`, `.csv`, `.json`; tên `awesome-*`                                                                                                                                                | `knowledge`                                                           | Thư viện                                      | Thiếu                   | 1, 6                 |
| 24  | Theme                                                              | CSS token                                                                                                                                                                                      | (gói theme cũ)                                                        | Giao diện Hub                                 | PARTIAL                 | —                    |
| 25  | Extension VS Code                                                  | `engines.vscode` + `contributes`                                                                                                                                                               | `vscode` (chỉ theme, grammar, snippet, language)                      | IDE                                           | Thiếu                   | 7                    |
| 26  | Workflow (n8n, ComfyUI), notebook                                  | JSON workflow, `.ipynb`                                                                                                                                                                        | `knowledge`                                                           | Thư viện; engine riêng là việc sau            | Thiếu                   | 1, 6                 |
| 27  | Mô hình AI                                                         | `.gguf`, `.onnx`, `.safetensors`, link Hugging Face                                                                                                                                            | (không phải gói)                                                      | openItem chỉ tới tính năng chọn thư mục model | Ngoài phạm vi           | 1                    |
| 28  | Mã native thuần (thư viện C/C++, driver)                           | Chỉ C/C++                                                                                                                                                                                      | (không)                                                               | Giữ trong `source/`                           | CURRENT (`source-only`) | —                    |

---

## 6. Hợp đồng dữ liệu

### 6.1 Trường chung mới của mọi kết nối

Tất cả là tùy chọn, thêm vào mọi loại:

| Trường   | Kiểu          | Ý nghĩa                                                                                                                                                                                                                                                                                                   |
| -------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugin` | đường dẫn gói | Thư mục plugin chứa kết nối này (để giao diện nhóm lại)                                                                                                                                                                                                                                                   |
| `group`  | id            | Các kết nối cùng `group` là phương án thay thế nhau; bật một cái thì host tắt các cái còn lại                                                                                                                                                                                                             |
| `origin` | enum          | Detector đã sinh ra nó: `claude-plugin`, `codex-plugin`, `copilot`, `agent-plugins`, `gemini-extension`, `mcp-config`, `mcpb`, `chrome-extension`, `userscript`, `vscode`, `framework`, `package-json`, `pyproject`, `cargo`, `go`, `compose`, `skill-md`, `rules-file`, `releases`, `classifier`, `user` |

`id` giữ regex hiện có (`[a-z0-9][a-z0-9._-]*`). Tên gốc chứa ký tự khác được chuẩn hóa; tên hiển thị nằm ở `title`.

### 6.2 Loại kết nối: mở rộng và mới

**`mcp` (mở rộng).** Thêm `transport`: `stdio` (mặc định, giữ tương thích), `http`, `sse`.

- `stdio`: `command` thêm `docker`, `node`, `python`, `uv`, `bun` bên cạnh `npx`, `uvx`. Khi chạy từ mã nguồn thì có `cwd` (trong `source/`) và `setup` (lệnh cài, cùng ràng buộc với `processService.setup`). `node` luôn được Hub chạy bằng Electron (`ELECTRON_RUN_AS_NODE`).
- `http`/`sse`: `url` bắt buộc `https://`; `headers` là danh sách `{ name, fromEnv }`, giá trị luôn lấy từ kho bí mật của gói. Giá trị viết thẳng trong repo không bao giờ được chép vào gói; detector thay bằng openItem `env-value`.
- Bản Hub cũ gặp `mcp` `http` thì thấy thiếu `command`, bỏ riêng kết nối đó và ghi `invalid` (đúng quy tắc đọc rộng).

**`command` (mới):** `id`, `title`, `description?`, `path` (tệp `.md`, `.toml` hoặc `.prompt.md` trong `source/`), `format` (`markdown`, `gemini-toml`, `copilot-prompt`), `argumentHint?` (≤ 200 ký tự). Là mẫu prompt; không chạy mã. Trường `allowed-tools` trong frontmatter bị bỏ qua: lệnh không cấp quyền.

**`agent` (mới):** `id`, `title`, `description?`, `path`, `format` (`claude-md`, `copilot-agent`, `opencode-md`), `tools?` (danh sách gợi ý), `model?` (gợi ý ≤ 64 ký tự). Thành một Assistant; `tools` không cấp quyền.

**`hook` (mới):** xem mục 11.2.

**`rules` (mới):** `id`, `title`, `path`, `format` (`agents-md`, `claude-md`, `gemini-md`, `cursor-mdc`, `copilot`, `windsurf`, `kiro`, `plain`).

**`extension` (mới):** `id`, `title`, `format` (`chrome-mv3`, `chrome-mv2`, `userscript`), `root` (thư mục với Chrome, tệp với userscript), `version?`, `permissions`, `hostPermissions`, `matches?` (userscript), `unsupported` (API chưa có phần bù), `needsBuild?`, `publicKey?` (khóa công khai SPKI dạng base64 để giữ ID ổn định, mục 12.2).

**`knowledge` (mới):** `id`, `title`, `paths` (≤ 200 đường dẫn trong `source/`).

**`service` (mới):** `id`, `title`, `process.services` (cùng schema `processService` của `web-embed`), không có `embed`. Có `headless: true` cho chương trình không cửa sổ, không cổng (bot Discord/Telegram): khi đó không được khai `ready`, và tiến trình được coi là sẵn sàng khi còn sống sau một khoảng ổn định ngắn; không headless thì mỗi chương trình bắt buộc `ready.port`.

**`vscode` (mới, đợt 7):** `id`, `title`, `path` (`package.json` của extension), `contributes` (danh sách trong `themes`, `grammars`, `snippets`, `languages`, `iconThemes`).

**`cli` (mở rộng):** `source?` (`npm`, `pypi`, `cargo`, `go`, `binary`, `source`), `package?`, `cwd?`, `setup?`.

**`launcher` (mở rộng):** `target.installed.release?` `{ owner, repo, assetPattern }` (link tải lấy từ Releases, không tự tải); thêm `target.kind: 'compose'` với `file` (đường dẫn compose trong `source/`).

**`web-embed` `url`:** không có trường `partition`. Phân vùng luôn do Main đặt (mục 10.9). Ngoài https, chỉ nhận `http://127.0.0.1:<cổng>[/đường-dẫn]` hoặc `http://localhost:<cổng>[/đường-dẫn]` (có cổng rõ ràng, không userinfo, không query), và chỉ khi gói là `local-built` hoặc khai một `service` (headless hoặc có cổng) trong cùng gói; đọc `adapter.json` và lúc mở app đều kiểm lại (`adapter/loopback.ts`, `webEmbedUrlProblem`). `origins` không dùng với địa chỉ loopback.

### 6.3 Trường cấp tài liệu mới

- `provenance`: `{ kind: 'git' | 'local' | 'url' | 'store' | 'user' | 'chrome-web-store', url?, commit? (40 ký tự hex), ref?, subdirectory?, extensionId?, extensionVersion?, packagedAt }`. Dùng để cập nhật (mục 9.5).
- `detectors`: danh sách `"<id>@<phiên bản>"` đã chạy, để biết gói cũ được tạo bởi bộ nhận diện nào.

### 6.4 `openItems` mới

Thêm `needs-build` (cần build rồi trỏ vào thư mục kết quả) và `needs-consent` (quyền rộng như `<all_urls>`, dịch vụ chạy nền: cần đồng ý rõ trước khi bật). `choose` có thêm `connections` (danh sách id trong cùng `group`).

### 6.5 Trạng thái kết nối đã cài (Main sở hữu, không nằm trong gói)

```ts
type InstalledConnectionState = {
  packageId: string;
  packageVersion: string;
  connectionKey: string; // `${kind}:${id}`, hoặc `skill:${path}`
  enabled: boolean;
  status: 'off' | 'on' | 'needs-input' | 'unsupported' | 'error';
  reason?: string; // vì sao không chạy được, bằng lời người đọc được
  approvalHash?: string; // SHA-256 của những gì người dùng đã duyệt (mục 9.4)
  approvedAt?: number;
  lastError?: string; // đã che bí mật, ≤ 500 ký tự
  installed?: readonly string[]; // tên đã cài vào kho đích (skill, lệnh, agent…), để gỡ đúng
};
```

Lưu cùng bản ghi gói (`packageStore`). Renderer chỉ đọc qua IPC đã có schema; không bao giờ ghi trực tiếp.

---

## 7. Nhận diện

### 7.1 Bản kê

```ts
type RepoInventory = Readonly<{
  files: readonly string[]; // tương đối, dấu `/`, đã qua fileScreen
  sizes: ReadonlyMap<string, number>;
  text: (path: string) => string | undefined; // chỉ tệp trong DECLARATION_FILES, ≤ 256 KB mỗi tệp
}>;
```

- `DECLARATION_FILES` là danh sách mẫu tên cố định: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `requirements*.txt`, `.env.example`, `docker-compose.yml`, `compose.yaml`, `manifest.json`, `*.user.js` (chỉ 8 KB đầu), `plugin.json`, `marketplace.json`, `hooks.json`, `.mcp.json`, `mcp.json`, `mcp_config.json`, `gemini-extension.json`, `settings.json` dưới `.claude/`, các tệp `.md`/`.toml` dưới thư mục `commands`, `agents`, `prompts`, `rules`, `SKILL.md`, các tệp quy tắc ở mục 5 dòng 12. Không đọc tệp theo gợi ý trong README.
- Tổng nội dung đọc vào bản kê ≤ 32 MB; vượt thì detector nhận openItem `unrecognized` "repo quá nhiều tệp khai báo" cho phần thừa, không im lặng.

### 7.2 Hợp đồng detector

```ts
type DetectorResult = Readonly<{
  connections: readonly AdapterConnection[];
  openItems: readonly AdapterOpenItem[];
  reasons: readonly string[]; // câu ngắn cho báo cáo
  claimed: readonly string[]; // các tệp khai báo detector đã xử lý (để kiểm tiêu chí C2)
}>;
type Detector = Readonly<{ id: string; version: number; detect: (inventory: RepoInventory) => DetectorResult }>;
```

- Thuần: không I/O ngoài `inventory`, không ném lỗi (mọi lỗi phân tích thành openItem `unrecognized` kèm đường dẫn).
- Thứ tự chạy không đổi kết quả. Mỗi detector một tệp trong `common/integrations/detectors/agent/` hoặc `apps/` (mục 4.1) kèm test riêng.
- JSON và TOML của repo là dữ liệu chưa tin cậy: phân tích bằng Zod với giới hạn độ dài; khóa lạ bỏ qua.

### 7.3 Danh sách detector

| Detector                                                | Đọc                                                                                                                                                                                                                                                                                                                                                                                           | Sinh                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-plugins`                                         | `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `plugin.json` có `$schema` agent-plugins.org, thư mục plugin của Copilot; ba vị trí `marketplace.json` (`.claude-plugin/`, `.agents/plugins/`, `.github/plugin/`) với `source` là chuỗi `./...` hoặc `{ source: 'local', path }`                                                                                                   | Theo bố cục chuẩn của plugin: `skills/` → `skill`; `commands/` → `command`; `agents/` → `agent`; `hooks/hooks.json` và khóa `hooks` → `hook`; `.mcp.json` và khóa `mcpServers` → `mcp`; `bin/` → `cli`. `lspServers`, `monitors`, `outputStyles`, `themes`, `workflows` → openItem `needs-runtime`. Plugin ở repo khác (nguồn `github`/`url`) → openItem `unrecognized` kèm URL, không tự tải |
| `mcp-config`                                            | `.mcp.json`, `mcp.json`, `mcp_config.json`, `.vscode/mcp.json` (khóa `servers`), `.cursor/mcp.json`; manifest `.mcpb`/`.dxt`                                                                                                                                                                                                                                                                  | `mcp` theo transport. `${VAR}` trong `args`, `env`, `headers` thành biến người dùng điền. Lệnh ngoài danh sách cho phép → openItem `unrecognized`                                                                                                                                                                                                                                             |
| `mcp-published`                                         | Logic hiện có của nhánh MCP trong classifier và `mcpLaunch.ts`                                                                                                                                                                                                                                                                                                                                | `mcp` `npx`/`uvx`                                                                                                                                                                                                                                                                                                                                                                             |
| `gemini`                                                | `gemini-extension.json`, `commands/*.toml` cạnh nó                                                                                                                                                                                                                                                                                                                                            | `mcp`; `settings[].envVar` thành biến; `contextFileName` (mặc định `GEMINI.md`) thành `rules`; lệnh `.toml` (`prompt`, `description`) thành `command`                                                                                                                                                                                                                                         |
| `commands-agents`                                       | `.claude/commands/`, `.claude/agents/`, `.github/prompts/`, `.github/agents/`, `.gemini/commands/`, `.opencode/command/`, `.opencode/agent/` ngoài plugin                                                                                                                                                                                                                                     | `command`, `agent`. Frontmatter phân tích có giới hạn (≤ 8 KB)                                                                                                                                                                                                                                                                                                                                |
| `hooks`                                                 | Khối `hooks` trong `.claude/settings.json` (hook của chính repo)                                                                                                                                                                                                                                                                                                                              | `hook`. Loại khác `command` → openItem `needs-runtime`                                                                                                                                                                                                                                                                                                                                        |
| `rules`                                                 | Các tệp ở mục 5 dòng 12                                                                                                                                                                                                                                                                                                                                                                       | `rules`                                                                                                                                                                                                                                                                                                                                                                                       |
| `skills`                                                | `SKILL.md` (logic hiện có)                                                                                                                                                                                                                                                                                                                                                                    | `skill`                                                                                                                                                                                                                                                                                                                                                                                       |
| `browser-ext`                                           | `manifest.json` có `manifest_version` số và ít nhất một trong `background`, `content_scripts`, `action`, `browser_action`, `page_action`, `permissions`, `chrome_url_overrides`; loại trừ manifest có `server` (MCPB) và web manifest (`start_url`/`display` mà không có `manifest_version`). Công cụ build: `wxt.config.*`, `plasmo` trong `package.json`, `@crxjs/vite-plugin`; `*.user.js` | `extension`; không có manifest đã build → `needsBuild` + openItem `needs-build`; `unsupported` = permission chưa có phần bù theo bảng mục 12.3; quyền rộng → openItem `needs-consent`                                                                                                                                                                                                         |
| `cli-launcher`                                          | `bin` (npm), `[project.scripts]`, `[[bin]]`, `package main` (Go); electron-builder (`build` trong `package.json`, `electron-builder.yml`), `src-tauri/tauri.conf.json`, `project.godot`                                                                                                                                                                                                       | `cli` (`npx -y <pkg>` khi gói đã phát hành; từ mã nguồn khi chưa); `launcher` `installed` (tên tệp từ `productName`)                                                                                                                                                                                                                                                                          |
| `services`                                              | `serviceDetector` hiện có; compose; thư viện bot                                                                                                                                                                                                                                                                                                                                              | `web-embed` `process`, `launcher` `compose`, `service`                                                                                                                                                                                                                                                                                                                                        |
| `knowledge-misc`                                        | Thư mục `docs/`, awesome-list, thư viện không có `bin`, `.ipynb`, workflow JSON, tệp mô hình                                                                                                                                                                                                                                                                                                  | `knowledge`; mô hình → openItem `unrecognized` chỉ tới tính năng chọn thư mục model                                                                                                                                                                                                                                                                                                           |
| `web-static`, `theme`, `chat-stage`, `workflow-capsule` | Logic hiện có trong classifier                                                                                                                                                                                                                                                                                                                                                                | Giữ đầu ra cũ (gói web, theme) để không vỡ tương thích                                                                                                                                                                                                                                                                                                                                        |

### 7.4 Tra Releases (tùy chọn, ngoài detector)

Chỉ với nguồn `github.com`: bước `process/integrations/repoSources/releases.ts` gọi `https://api.github.com/repos/<owner>/<repo>/releases/latest`, không xác thực, timeout 10 giây, đáp ứng ≤ 1 MB. Kết quả chỉ dùng để điền `release.assetPattern` và link tải; **không tải tệp**. Host đích được phép đúng là `api.github.com`. Lỗi mạng hay giới hạn lượt gọi chỉ làm thiếu link, không làm hỏng gói.

### 7.5 Gộp

1. **Khóa trùng:** `skill` theo `name` trong frontmatter; `mcp` theo tên server; `command` và `agent` theo tên trong cùng `plugin`; `hook` theo SHA-256 của `event`, `matcher`, `command`, `args`; `rules` theo đường dẫn; `extension` theo `root`.
2. **Cùng nội dung, nhiều host:** nhiều bản cùng khóa thì giữ bản ở thư mục ngoài cùng (quy tắc hiện có của skill). Nếu các bản khác nhau (ví dụ cùng MCP `context7` nhưng một bản `http`, một bản `npx`) thì giữ tất cả, cùng một `group`, kèm openItem `choose`. Thứ tự mặc định trong nhóm: `http`/`sse` (không chạy gì trên máy) > `npx`/`uvx` > từ mã nguồn > `docker`.
3. **Plugin trùng giữa các host** (một plugin đóng cho Claude, Codex, Copilot…): chọn bản chính theo thứ tự Claude Code > agent-plugins.org > Codex > Copilot > Gemini > khác (bản Claude có nhiều loại thành phần nhất). Bản khác chỉ đóng góp những thành phần bản chính không có.
4. **Archetype nhãn:** loại có số kết nối dùng được nhiều nhất; hòa thì theo thứ tự cũ của classifier. Nhãn chỉ để hiển thị.
5. **Tiêu chí C2:** tệp nằm trong `DECLARATION_FILES` mà không có trong `claimed` của detector nào thì thành openItem `unrecognized`.

---

## 8. Đóng gói

1. **Một bố cục.** Mọi gói mới theo `source/` + `adapter/`. Gói web, theme, viewer chuyển sang bố cục chuẩn khi trình cài biết mở `entrypoint` dưới `source/` (T0.5); trước đó giữ bố cục cũ, ghi rõ trong báo cáo.
2. **Ghi theo luồng.** Viết lưu trữ theo luồng thay vì dựng trong bộ nhớ. Bỏ trần tổng 100 MB và trần số tệp. Giữ trần mỗi tệp 20 MB (tệp lớn hơn thành openItem `unrecognized`), giữ lọc bí mật, symlink, `.git`, đường dẫn xấu.
3. **Kiểm đĩa trước khi ghi.** Ước lượng kích thước từ `sizes`; nếu chỗ trống < 2 × ước lượng + 1 GB thì dừng với lỗi `DISK_SPACE_LOW` kèm con số. Máy phát triển hiện còn khoảng 7 GB trên ổ C.
4. **Nguồn gốc.** Ghi `provenance` (URL, commit lấy bằng `git rev-parse HEAD` trong bản clone, ref, thư mục con).
5. **Ký và tự kiểm.** Ký bằng khóa cục bộ (`signingKey.ts`), đọc lại lưu trữ, kiểm chữ ký và toàn vẹn như hiện nay (`verifyWrittenArchive`).

---

## 9. Tin cậy, cài đặt, cập nhật

### 9.1 Mức tin cậy `local-built`

Thêm vào `PackageTrust`. Điều kiện của gói `local-built`:

- Ký bằng khóa cục bộ của máy. Khóa công khai được Main ghim ở `userData` khi khóa được tạo; không bao giờ thêm vào danh sách khóa của Store và không bao giờ nhận từ renderer.
- Chỉ sinh ra bởi `/repotopackage` hoặc trình tạo của người dùng trên chính máy này. Đường dẫn tệp gói do Main chọn (thư mục đầu ra của packager) hoặc từ hộp chọn tệp của Main; renderer không truyền đường dẫn tùy ý.
- Không bao giờ dùng namespace `com.tomni.*`. Runtime giao diện chỉ `sandboxed-web`; `trusted-react` bị từ chối. Không có quyền chỉ dành cho admin.
- Mọi kết nối ở trạng thái `off` khi cài. Giao diện luôn hiện nhãn "Tạo trên máy này".
- Thu hồi khóa cục bộ (người dùng tạo lại khóa) làm mọi gói `local-built` cũ thành không hợp lệ: Hub tắt mọi kết nối của chúng và đề nghị đóng gói lại từ `provenance`.
  - **Đã cài (2026-10-15):** khóa bị thu hồi làm gói thành `unsigned-revoked` (vẫn cài, không còn được tin như gói đã ký); mọi kết nối chạy mã của nó tắt và không bật được; kết nối dữ liệu giữ lại kèm thông báo. Cài lại bằng khóa mới (đóng gói lại, hoặc cập nhật từ nguồn) gỡ bản cũ rồi cài mới, nên mọi kết nối phải duyệt lại. Thu hồi chạy qua IPC `packages.revokeLocalKey` (Main hỏi xác nhận, mặc định hủy).

### 9.2 Đường cài

`PackageManagerService.installLocalArtifact(artifactRef)`:

1. Kiểm chữ ký với khóa cục bộ đã ghim, kiểm toàn vẹn, kiểm namespace và runtime.
2. Đọc `adapter/adapter.json` bằng `readAdapterDocument`; gói không có adapter thì dùng `adapterFromManifest`. `issues` được lưu để hiện cho người dùng.
3. Giải nén vào thư mục gói (`userData/tomny-packages/<id>/<version>/`) không vượt đường dẫn, không theo symlink (dùng lại cơ chế giải nén hiện có).
4. Tạo `InstalledConnectionState` cho mọi kết nối, `enabled: false`, `status` = `off`, `unsupported` (không có host hoặc host báo chưa chạy được, kèm lý do) hoặc `needs-input` (còn openItem bắt buộc).
5. Ghi bản ghi gói theo giao dịch như cài gói Store. Lỗi ở bất kỳ bước nào thì không để lại gì.

Gói Store và gói `local-built` đi chung bước 2–5. Khác nhau chỉ ở bước 1.

### 9.3 Host kết nối

```ts
type ConnectionHost<K extends AdapterConnectionKind> = Readonly<{
  kind: K;
  /** Không có tác dụng phụ. Trả lý do bằng lời người đọc được khi máy này chưa chạy được. */
  check: (
    ctx: HostContext,
    connection: ConnectionOf<K>
  ) => Promise<{ ok: true } | { ok: false; reason: string; missing?: RuntimeId[] }>;
  /** Mô tả đúng những gì người dùng sẽ duyệt: lệnh, URL, quyền, sự kiện. Dùng cho hộp duyệt và approvalHash. */
  describe: (ctx: HostContext, connection: ConnectionOf<K>) => Promise<ApprovalSubject>;
  enable: (ctx: HostContext, connection: ConnectionOf<K>) => Promise<{ installed: string[] }>;
  disable: (ctx: HostContext, connection: ConnectionOf<K>, installed: readonly string[]) => Promise<void>;
  /** Lúc khởi động: gỡ những gì host đã cài cho gói không còn hoặc kết nối không còn bật. */
  reconcile: (ctx: HostReconcileContext) => Promise<void>;
}>;
```

- `HostContext` gồm danh tính gói (id, version, trust, thư mục đã giải nén), các hàm đọc tệp trong `source/` có kiểm đường dẫn, cổng đọc bí mật của gói, ghi bằng chứng.
- Host idempotent: bật hai lần không cài hai lần; tắt khi chưa bật không lỗi.
- Mọi thứ host cài vào kho đích phải mang nhãn nguồn gốc `package:<packageId>` để `reconcile` gỡ được (MCP đã có trường `extension`; kho skill, lệnh, agent, hook, extension phải có trường tương đương, xem các task đợt 2–4).
- Kiểm tra runtime có sẵn (`node` qua Electron, `python`, `uv`, `git`, Git Bash, `docker`, `cargo`, `go`) do một dịch vụ chung `runtimeProbe` trả, có cache 60 giây, không hỏi lại mỗi lần.

### 9.4 Duyệt và bật

- Bật một kết nối luôn đi qua hộp duyệt do Main dựng từ `describe`: loại, lệnh và đối số đầy đủ (hoặc URL, hoặc quyền extension, hoặc sự kiện và matcher của hook), thư mục chạy, biến môi trường cần (chỉ tên), đích mạng biết trước, nguồn (`provenance`).
- `approvalHash` = SHA-256 của `ApprovalSubject` chuẩn hóa, cộng nội dung các tệp mà kết nối sẽ thực thi (script của hook, tệp vào của tiến trình). Đổi bất cứ thứ gì trong đó thì phải duyệt lại.
- Kết nối dữ liệu (`skill`, `command`, `agent`, `rules`, `knowledge`) vẫn đi qua hộp duyệt, nhưng chỉ hiện nội dung sẽ thêm vào kho, không có lệnh.
- Bật một kết nối trong `group` thì host tắt các kết nối còn lại của nhóm, trong cùng giao dịch.

**Mô hình kích hoạt (quyết định của chủ dự án, 2026-10-15).** Quyết định này thay nguyên tắc "mọi kết nối tắt cho tới khi duyệt từng cái" ở hai điểm, và Main thực hiện cả hai:

1. **Tự bật khi cài từ máy này.** Khi gói cài xong qua `/repotopackage` hoặc "Thêm từ GitHub" (đường cài gói cục bộ, `installLocalBuiltPackage` với `activateConnections`), kết nối loại dữ liệu (`skill`, `command`, `agent`, `rules`, `knowledge`) bật ngay. Kết nối chạy mã được gom vào **một** hộp duyệt trong ứng dụng, mỗi kết nối kèm loại, tiêu đề, lệnh và đối số đúng như sẽ chạy, thư mục chạy, tên biến môi trường (không có giá trị), bước cài đặt và đích mạng; mặc định là Hủy. Duyệt thì bật tất cả kết nối được liệt kê, mỗi cái được kiểm lại bằng `approvalHash` tính từ nội dung thật trên đĩa; nội dung đổi sau hộp thoại thì kết nối đó tắt. Kết nối không chạy được ở máy này (thiếu runtime, loại chưa hỗ trợ, còn thiếu giá trị biến bắt buộc) không được đưa vào hộp và tắt kèm lý do. Hộp có ô "Tự bật khi mở lại ứng dụng" (mặc định bỏ chọn) áp dụng cho mọi kết nối được duyệt. Gói Store và cập nhật từ nguồn giữ hành vi cũ: kết nối mới của bản cập nhật vẫn tắt (§9.5).
 Hộp duyệt là hộp trong ứng dụng (`pages/integrations/installApproval/InstallApprovalHost.tsx`, cắm ở gốc renderer): Main gửi yêu cầu qua `core.package-connections.install-approval-request` chỉ tới cửa sổ chính (top frame) và chờ trả lời `core.package-connections.install-approval-respond` (`process/integrations/connections/ipc/installApprovalBroker.ts`). Mỗi gói chỉ có một yêu cầu chờ (yêu cầu thứ hai bị Hủy); trả lời phải đúng mã yêu cầu và đúng tập khóa Main đã gửi, nếu không bị bỏ qua; không trả lời trong 5 phút là Hủy; không có cửa sổ thì dùng hộp hệ điều hành cũ. Hộp là thẻ modal đặc, có tiêu đề kèm tên gói, cảnh báo ở đầu, nhóm có số đếm, và công tắc "Tự bật khi mở lại ứng dụng" (Switch có mô tả); màu lấy từ token theme trong phạm vi `.tomny-approval` nên không phụ thuộc `.hub-shell`. Kết nối được nhóm theo loại (MCP, Hook, CLI, khác), dòng giống nhau gộp thành một dòng ×N, dòng chung của nhóm chỉ hiện một lần, và lệnh cài đặt kiểu install hay mạng không giới hạn được cảnh báo. Báo cáo cài đặt nêu theo loại những gì đã bật (có ghi chú tự bật khi mở lại) và những gì còn tắt kèm lý do, cùng một nguồn với trạng thái kết nối (`process/integrations/connections/wiring/installReport.ts`). Kết nối MCP của gói là bản ghi duy nhất trong danh sách MCP (`pkgconn:`); gói có kết nối MCP không còn bản sao tắt kiểu `package:` hay `repo:`.

2. **Phạm vi phiên.** Kết nối chạy mã chỉ bật trong phiên hiện tại trừ khi người dùng đánh dấu "Tự bật khi mở lại ứng dụng" (trường `autoStart`, mặc định tắt). Khi thoát, Main dừng các tiến trình kết nối đang chạy (dịch vụ, web app, tiện ích trình duyệt). Khi mở lại, kết nối có `enabled` nhưng không có `autoStart` được ghi lại là tắt với lý do "Tắt khi thoát ứng dụng". Kết nối có `autoStart` được bật lại qua đúng các kiểm tra của bật thủ công (`approvalHash`, runtime, giá trị biến, trạng thái thu hồi khóa) và không hỏi lại; sai hash, nội dung đã đổi hoặc khóa đã thu hồi thì kết nối tắt và ghi lý do. Dịch vụ (`service`) và web app vẫn cần thao tác Bắt đầu/Mở: bật lại chỉ khôi phục trạng thái được duyệt, không tự khởi chạy tiến trình. Kết nối dữ liệu giữ trạng thái khi khởi động lại, vì không chạy gì.

Kết nối chạy mã có tự bật (autoStart) nhưng không còn approvalHash, tức bản ghi cũ, thì tắt với lý do “Cần duyệt lại trước khi tự bật khi mở ứng dụng.”. Khi mở ứng dụng, mỗi gói như vậy được hỏi một lần mỗi lần chạy ứng dụng, trong hộp “Bật plugin <tên> không?” (mặc định là Hủy; hết 5 phút tính là Hủy). Cho phép thì bật đúng các kết nối đó với nội dung vừa hiển thị và giữ tự bật. Hủy hoặc không trả lời thì không đổi gì và hỏi lại ở lần mở sau. “Không nhắc nữa” thì tắt tự bật của các kết nối đó. Không có gì chạy trước khi người dùng cho phép.
#### Giao diện theo cụm (2026-10-15)

Quyết định của chủ dự án: **gói là đơn vị**. Chi tiết gói hiển thị các kết nối của gói như một cụm, không như nhiều công tắc rời.

- **Công tắc tổng và dòng tóm tắt.** Đầu chi tiết gói có một công tắc "Bật hoặc tắt cả gói" và một dòng tóm tắt theo loại, ví dụ `1 MCP · 14 hook · 8 skill · 10 rules · 1 CLI`, kèm số kết nối đang bật và đang tắt. Công tắc tổng gọi `setPackageEnabled(packageId, enabled)` (kênh `core.package-connections.set-package-enabled`, payload nghiêm ngặt, chỉ khung chính gửi được).
- **Công tắc tổng là phím tắt, không phải cách duy nhất.** Mỗi kết nối trong gói vẫn bật hoặc tắt riêng được; điều khiển theo từng kết nối không bị bỏ đi.
- **Bật cả gói: một xác nhận.** Kết nối dữ liệu (`skill`, `command`, `agent`, `rules`, `knowledge`) bật ngay. Kết nối chạy mã được gom vào đúng một hộp duyệt trong ứng dụng, mặc định là Hủy, theo quy tắc của lúc cài (mục 1 của §9.4). Main vẫn tính lại `approvalHash` từ nội dung trên đĩa; nội dung đổi sau hộp thoại thì kết nối đó tắt. Kết nối đã thu hồi khóa, thiếu giá trị biến hoặc không chạy được ở máy này không được đưa vào hộp và tắt kèm lý do. Trong một `group`, chỉ một phương án được đưa vào hộp; các phương án còn lại tắt kèm lý do.
- **Tắt cả gói.** Mọi kết nối đang bật của gói tắt trong cùng một thao tác, không hỏi. Kết quả là báo cáo theo kết nối: `enabled[]` (vừa bật) và `stayedOff[{key, reason}]` (còn tắt, kèm lý do).
- **Kết nối dữ liệu không có công tắc riêng.** Skill, rules, knowledge (và command, agent) hiện thành danh sách phẳng. Nút "Xem" của skill chỉ hiện khi màn hình được cấp `onOpenSkill`.
- **Kết nối chạy mã là dòng nâng cao.** Mỗi dòng có công tắc nhỏ riêng, lựa chọn "tự bật khi mở lại" riêng và thao tác riêng (mở ứng dụng, nhập biến môi trường). Công tắc tổng có một lựa chọn "tự bật khi mở lại" áp dụng cho mọi kết nối chạy mã của gói.
- **Nhóm theo loại, ít cảnh báo.** Mỗi loại là một nhóm thu gọn được. Nhóm tự mở khi có kết nối đang tắt và nêu lý do; người dùng đã mở hoặc đóng nhóm thì giữ nguyên lựa chọn đó. Kết nối không chạy được (`unsupported`) gom thành một ghi chú cho mỗi lý do thay vì một cảnh báo cho từng dòng. Loại chạy mã hiện trước, loại dữ liệu sau.
- **Phạm vi.** Cụm chỉ áp dụng cho chi tiết gói. Kết nối độc lập (skill, hook, MCP do người dùng tự tạo hoặc thêm lẻ) không thuộc cụm nào: giữ công tắc và trang riêng như trước, không đổi hành vi hay giao diện.
- **Triển khai.** `wiring/packageSwitch.ts` (bật và tắt cả gói, dùng lại `activateInstalledConnections`); `ipc/connectionBridge.ts` và `ipc/connectionBootstrap.ts` (kênh, xác nhận dùng chung với lúc cài); `renderer/pages/hub/StoreProductDetail/connections/` (`PackageConnectionsSection.tsx`, `PackageConnectionGroup.tsx`, `packageConnectionGroups.ts`).
- **Kiểm chứng.** Test đơn vị và DOM: `tests/unit/integrations/connections/wiring/packageSwitch.test.ts`, `tests/unit/integrations/connections/ipc/connectionBridge.test.ts`, `tests/unit/renderer/hub/PackageConnectionsSection.dom.test.tsx`. Trạng thái: **PARTIAL**. Chưa có kiểm thử đầu cuối trên giao diện thật và chưa chạy trên máy sạch.
- **Giới hạn đã biết.** Đọc lại trạng thái (`view`) dựng lại bản ghi và có thể làm mất `lastError` mà lần tắt trước ghi lại. Báo cáo tắt cả gói vì vậy lấy lý do từ kết quả của từng lần tắt. Giữ lỗi qua lần đọc lại là việc của `sync` và chưa đổi ở bước này.


### 9.5 Cập nhật từ nguồn

- Người dùng bấm "Kiểm tra bản mới" (D18: không tự kiểm định kỳ). Với nguồn Git: `git ls-remote <url> <ref>` so với `provenance.commit`.
- Có bản mới thì chạy lại [1]–[6] với cùng nguồn, ra phiên bản mới (`version` tăng phần patch nếu repo không đổi version), rồi so `adapter.json` cũ và mới theo `connectionKey`:
  - Kết nối không đổi (`approvalHash` mới = cũ): giữ trạng thái bật.
  - Kết nối dữ liệu đổi nội dung: giữ trạng thái bật, liệt kê thay đổi trong báo cáo cập nhật.
  - Kết nối chạy mã (`mcp` stdio, `hook`, `extension`, `cli`, `tool`, `service`, `web-embed` process, `launcher` source) đổi nội dung: tự tắt, `status: 'needs-input'`, lý do "nội dung đã đổi, cần duyệt lại".
  - Kết nối mới: `off`. Kết nối bị xóa: host gỡ.
- Cập nhật dùng đường cập nhật có sẵn của trình quản lý gói (giữ bản cũ để quay lại).

---

## 10. Host theo loại kết nối

Mỗi dòng: bật nghĩa là gì; người dùng thấy ở đâu (chi tiết ở mục 14); agent dùng thế nào; lỗi thường gặp.

### 10.1 `skill`

Giải nén thư mục skill khỏi gói và `NativeSkillCatalog.import` (logic hiện có của `skillInstall.ts`). Kho skill cần ghi nguồn gốc `package:<id>` cho mỗi skill nhập từ gói. Skill trùng tên với skill người dùng tự có: không ghi đè; báo `needs-input` kèm lựa chọn "thay" hoặc "giữ bản của tôi". Đây là thay đổi so với hành vi hiện tại (hiện ghi đè), đã chốt ở D17, vì ghi đè âm thầm làm mất dữ liệu người dùng.

### 10.2 `mcp`

- `stdio` `npx`/`uvx`/`docker`: thêm vào danh mục MCP qua `packageMcpSync` (mở rộng), `enabled: false` trong danh mục; bật kết nối thì bật mục đó.
- `stdio` từ mã nguồn: chạy qua runtime tiến trình (mục 13). `setup` chạy một lần trong thư mục gói, có tiến độ và nhật ký.
- `http`/`sse`: thêm vào danh mục với transport tương ứng; header lấy giá trị từ kho bí mật của gói ngay trước khi kết nối, trong Main. Host đích hiện trong hộp duyệt.
- Agent dùng như mọi MCP. Lỗi kết nối hiện ở `last_test_error` (đã có).

### 10.3 `command`

- Bật thì lệnh xuất hiện trong bảng `/` (nguồn mới `package`, nhãn tên gói). Thêm `SlashCommandSource = 'package'`.
- Danh sách lệnh của gói lấy qua một IPC mới của Main (`conversation.native.packageCommands`, có schema), không qua endpoint HTTP `slash-commands` (G16). Renderer gộp với lệnh dựng sẵn (`renderer/utils/chat/commandPalette.ts`) và lệnh ACP (`renderer/hooks/chat/useSlashCommands.ts`). Lệnh của gói có tên `<lệnh>`, hoặc `<plugin>:<lệnh>` khi trùng.
- **Mở rộng mẫu ở Main**, trong `conversation.sendMessage`, ngay sau bước nhận `/repotopackage` và trước pipeline: thay `$ARGUMENTS` bằng toàn bộ phần sau tên lệnh, `$1`…`$9` bằng đối số theo khoảng trắng (có hỗ trợ ngoặc kép); `{{args}}` cho định dạng Gemini. Bong bóng chat vẫn hiện đúng dòng người dùng gõ; nội dung mẫu đi vào `model_input` (cùng cơ chế `applyModesToModelInput`).
- Mẫu có cú pháp chạy lệnh của Claude Code (`` !`cmd` ``) hoặc tham chiếu tệp (`@file`): **không thực thi**; giữ nguyên văn bản và ghi một dòng cảnh báo trong báo cáo đóng gói.
- Nội dung mẫu là dữ liệu chưa tin cậy: đi qua pipeline và kiểm tra đầu ra như tin nhắn thường.

### 10.4 `agent`

Bật thì tạo một Assistant: `name` = `title`, `description`, `context` = thân Markdown (sau frontmatter), `models` theo bảng ánh xạ gợi ý (`sonnet`, `opus`, `haiku`, `inherit` → trống), `source: 'package'` (thêm vào `AssistantSource`). Assistant từ gói chỉ đọc; người dùng "Nhân bản để sửa". Tắt thì xóa Assistant đó (không xóa bản nhân bản).

### 10.5 `hook`

Xem mục 11.

### 10.6 `rules`

Bật thì tệp quy tắc xuất hiện trong Thư viện (mục 14, S11) ở trạng thái "chưa gắn". Người dùng gắn vào một hoặc nhiều workspace. Khi chat trong workspace đã gắn, `contextComposer` thêm nội dung (tối đa 16 KB mỗi workspace, cắt kèm ghi chú) vào khối ngữ cảnh, đi qua cùng kiểm tra đầu ra như ngữ cảnh truy xuất. Không bao giờ tự gắn vào mọi cuộc trò chuyện.

### 10.7 `knowledge`

Bật thì các tệp vào Thư viện (chỉ ghi đường dẫn trong thư mục gói đã giải nén, không sao chép). Agent tra bằng công cụ `tomny_library_search` (chỉ mục cục bộ, đợt 6).

### 10.8 `extension`

Xem mục 12.

### 10.9 `web-embed`

- `url`: mở trong một tab Browser **do Main tạo** với phân vùng hồ sơ duyệt web dùng chung `persist:tomny-browser` (`WEB_EMBED_PARTITION`; không có phân vùng riêng theo app, các app chia sẻ cookie với Browser). Chỉ điều hướng trong `origins`; liên kết khác mở trong tab Browser thường. Quyền web (thông báo, camera, mic, vị trí) mặc định từ chối; chế độ agent của tab mặc định tắt. Xuất hiện như một app trong danh sách Apps.
- `process`: runtime tiến trình khởi động các dịch vụ theo thứ tự, chờ cổng loopback mở (`ready.port`), rồi mở tab như trên với địa chỉ `http://127.0.0.1:<cổng><path>`. Tab chỉ được điều hướng trong cổng loopback của chính gói. Trung tâm hiện trạng thái (đang khởi động, nhật ký, lỗi) cho tới khi sẵn sàng.
- Renderer không truyền `partition`; IPC mở app nhận `packageId` + `connectionId`, Main tự suy ra mọi thứ (sửa G8 cho đường này).

### 10.10 `cli` và `tool`

- Bật `cli` nghĩa là "sẵn sàng gọi", không chạy gì. Người dùng thấy CLI trong menu của nút Terminal ("Mở terminal với <tên>") và trong bảng `*`. Mở terminal: phiên pty mới trong workspace, **điền sẵn** lệnh vào dòng nhập nhưng không chạy.
- Agent dùng qua công cụ `tomny_package_cli` (`{ packageId, connectionId, args: string[] }`): kiểm từng đối số theo regex token của adapter, chạy dạng exec (không shell), thư mục làm việc là workspace, timeout 120 giây, đầu ra ≤ 64 KB, hỏi quyền mỗi lần trừ khi người dùng chọn "luôn cho phép CLI này trong workspace này" (qua kho quyền hiện có).
- `tool` là `cli` có mô tả đầu vào: hiện trong bảng `/` và `*` với tên và ô nhập; kết quả hiện trong chat.

### 10.11 `service`

Như `web-embed` process nhưng không có giao diện. Luôn có openItem `needs-consent`. Không tự khởi động cùng Hub ở v1. Đang chạy thì xuất hiện ở mục Active của sidebar (SDK phiên của sidebar đã có) với nút dừng và xem nhật ký.

### 10.12 `launcher`

- `installed`: dò app đã cài (lối tắt trong Start Menu, registry `App Paths` và `Uninstall`, `PATH`, thư mục cài thông dụng) theo tên tệp; tìm thấy thì người dùng xác nhận đường dẫn; không thấy thì trung tâm hiện "chưa tìm thấy" với nút chọn tệp (hộp chọn của Main) và link Releases. Đường dẫn đã gắn lưu ở Main, theo máy.
- `compose`: cần Docker; chạy `docker compose -f <file> up -d` trong thư mục gói sau khi duyệt; dừng bằng `down`.
- `source`: qua runtime tiến trình.
- Xuất hiện trong danh sách Apps; bấm vào thì mở app ngoài và trung tâm hiện trạng thái. App có MCP thì kèm nối MCP (như 10.2).

---

## 11. Bộ chạy hook (Tomny Hooks)

### 11.1 Mục đích và nguồn

Hook gắn hành vi vào vòng đời của agent: chạy lint sau khi sửa tệp, chặn lệnh nguy hiểm, nạp ngữ cảnh khi mở phiên, nhắc chạy test trước khi kết thúc. Định dạng theo Claude Code (tài liệu chính thức đã đối chiếu ngày 2026-10-09: <https://code.claude.com/docs/en/hooks>) để hook trong repo plugin chạy được mà không phải sửa.

| Nguồn                   | Cách vào                                                                                                       | Dạng lệnh được phép              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Gói (Store hoặc GitHub) | Kết nối `hook`                                                                                                 | Chỉ exec (mục 11.6)              |
| Tự tạo                  | Cài đặt → Hooks                                                                                                | Exec hoặc shell                  |
| Workspace               | Khối `hooks` của `.claude/settings.json` trong workspace; Tomny chỉ đọc khi người dùng đồng ý cho workspace đó | Exec hoặc shell, duyệt từng hook |

### 11.2 Cấu hình

Ba tầng như Claude Code: sự kiện → nhóm matcher → trình xử lý.

```jsonc
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|tomny_write|tomny_edit",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh", "args": [], "timeout": 30 },
        ],
      },
    ],
  },
}
```

- `matcher`: rỗng, `*` hoặc thiếu là khớp tất cả. Chỉ gồm chữ, số, `_`, `-`, khoảng trắng, `,`, `|` thì là danh sách tên khớp đúng. Còn lại là biểu thức chính quy JavaScript không neo. Biểu thức chạy có giới hạn (độ dài ≤ 300, chuỗi đem so ≤ 1 000 ký tự) để tránh treo.
- `type`: v1 chỉ `command`. `http` (cần danh sách đích của egress), `prompt`, `agent`, `mcp_tool` thành openItem `needs-runtime`.
- `command` + `args`: có `args` là dạng exec; thiếu `args` là dạng shell.
- `timeout` (giây): mặc định 60; `UserPromptSubmit` 30; `SessionEnd` dùng ngân sách chung 1,5 giây.
- Biến đường dẫn: `${CLAUDE_PLUGIN_ROOT}` = thư mục plugin trong `source/` của gói đã giải nén; `${CLAUDE_PLUGIN_DATA}` = thư mục dữ liệu bền của gói; `${CLAUDE_PROJECT_DIR}` = workspace của phiên. Có bản `TOMNY_*` cùng giá trị. Trên Windows giá trị dùng dấu `/`.

Kết nối `hook` trong `adapter.json` (một trình xử lý một kết nối):

```jsonc
{
  "kind": "hook",
  "id": "format-on-edit",
  "event": "PostToolUse",
  "matcher": "Write|Edit",
  "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format.sh",
  "args": [],
  "timeoutSec": 30,
  "plugin": "source/plugins/claude/formatter",
  "origin": "claude-plugin",
}
```

Ràng buộc schema: `event` thuộc danh sách sự kiện mục 11.3 (sự kiện khác vẫn được ghi nhận nhưng thành openItem `needs-runtime`); `command` ≤ 500 ký tự; `args` ≤ 32 phần tử, mỗi phần tử ≤ 500 ký tự; `timeoutSec` 1–600.

### 11.3 Sự kiện và chỗ gắn

| Sự kiện                              | Chỗ gắn (mã)                                                                                                                                                                                                                                          | Hook làm được gì                                                                                  | Phủ tác tử                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `SessionStart`                       | Hội thoại được tạo hoặc mở lại (`process/services/database/nativeConversation/service.ts`)                                                                                                                                                            | `additionalContext` vào lượt đầu                                                                  | Mọi tác tử                                                            |
| `UserPromptSubmit`                   | Stage dựng sẵn `builtin:user-hooks`, pha `pre_query`, mặc định đứng đầu pipeline                                                                                                                                                                      | Chặn prompt; `additionalContext`                                                                  | Mọi tác tử (mọi giao diện chat đều đi qua `conversation.sendMessage`) |
| `PreToolUse`                         | Native: ngay khi `tomnyCoreAdapter` nhận yêu cầu công cụ, **trước mọi nhánh xử lý** (preflight skill, `tomny_session_actions`, dịch công cụ native, `tomnyToolAccessForPermission`). Các tác tử khác: đầu `ExperimentalCoreRuntime.requestPermission` | `deny`; `ask` (buộc hỏi người dùng dù kho quyền đã cho phép)                                      | Native: mọi công cụ. ACP và khác: chỉ công cụ có xin quyền            |
| `PostToolUse` / `PostToolUseFailure` | `pushAdapterEvent` với sự kiện `tool-result` (`outcome` `success`/`error`)                                                                                                                                                                            | `additionalContext` (xem 11.5)                                                                    | Mọi tác tử (quan sát)                                                 |
| `Stop`                               | Lượt kết thúc trong runtime                                                                                                                                                                                                                           | `decision: "block"` + `reason` thì runtime gửi tiếp một lượt với lý do đó; tối đa 3 lần liên tiếp | Mọi tác tử (runtime điều khiển lượt)                                  |
| `Notification`                       | Hub phát yêu cầu cấp quyền hoặc thông báo của agent                                                                                                                                                                                                   | Quan sát                                                                                          | Mọi tác tử                                                            |
| `SessionEnd`                         | Hội thoại bị đóng hoặc xóa                                                                                                                                                                                                                            | Quan sát                                                                                          | Mọi tác tử                                                            |

Chưa làm ở v1: `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `PermissionRequest`, `PermissionDenied`, `PostToolBatch`, `FileChanged` (IDE đã có hook theo tệp riêng), `Setup`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, các sự kiện worktree và model switch. Hook cho các sự kiện này được giữ trong gói, tắt, kèm lý do "sự kiện chưa hỗ trợ".

#### Phủ theo tác tử (đã xác minh bằng spike S-1)

| Khả năng                                                 | Native (`tomny-json-stream`)  | ACP                                                                                                 | Codex app-server                | Loopback OpenAI  | Remote                            |
| -------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------- | --------------------------------- |
| `PreToolUse` chặn trước khi công cụ chạy                 | Có, mọi công cụ (`tool_deny`) | Chỉ khi chế độ quyền là hỏi (`read-only` tự từ chối, `full-access` tự cho phép, Hub không được hỏi) | Không (`approvalPolicy: never`) | Không có công cụ | Chỉ công cụ có khung `permission` |
| `PostToolUse` thấy kết quả                               | Có, đầu ra bị cắt             | Chỉ tên, `callId`, đầu vào, `outcome`                                                               | Như ACP                         | Không            | Tùy tải trọng từ xa               |
| Ngữ cảnh cho lượt kế tiếp                                | Có                            | Có                                                                                                  | Có                              | Có               | Có                                |
| `UserPromptSubmit`, `SessionStart`, `Stop`, `SessionEnd` | Có (phía Hub)                 | Có                                                                                                  | Có                              | Có               | Có                                |

Vì vậy trong `tool_input` và `tool_response` của hook, `tool_response` chỉ đầy đủ ở native và bị cắt; với ACP và Codex hook nhận `tool_name`, `tool_use_id`, `tool_input` và trạng thái thành công hay lỗi. Giao diện hook ghi rõ "chặn công cụ chỉ hoạt động với tác tử Tomny native và ACP ở chế độ hỏi quyền".

### 11.4 Giao thức

**Đầu vào** (JSON qua stdin, tên trường như Claude Code):

| Trường                                                    | Có ở                                              |
| --------------------------------------------------------- | ------------------------------------------------- |
| `session_id`, `cwd`, `hook_event_name`, `permission_mode` | Mọi sự kiện                                       |
| `prompt`                                                  | `UserPromptSubmit`                                |
| `tool_name`, `tool_input`, `tool_use_id`                  | `PreToolUse`, `PostToolUse`, `PostToolUseFailure` |
| `tool_response`                                           | `PostToolUse`                                     |
| `error`                                                   | `PostToolUseFailure`                              |
| `last_assistant_message`, `stop_hook_active`              | `Stop`                                            |
| `source` (`startup`, `resume`)                            | `SessionStart`                                    |
| `tomny` (`surface`, `agent`, `conversation_id`)           | Mọi sự kiện (trường riêng của Tomny)              |

`transcript_path` không có (Tomny không ghi transcript ra tệp). `permission_mode` ánh xạ từ chế độ quyền của Tomny sang giá trị gần nhất của Claude Code (`default`, `acceptEdits`, `bypassPermissions`, `plan`). `tool_input` và `tool_response` đi qua bộ che bí mật của nhật ký công cụ (`sanitizeTomnyToolInput` và tương đương) trước khi vào stdin; stdin ≤ 256 KB (cắt `tool_response` trước).

**Đầu ra:**

- Exit 0: thành công. Với `SessionStart` và `UserPromptSubmit`, stdout dạng văn bản thành ngữ cảnh. Stdout bắt đầu bằng `{` và kết thúc bằng `}` (bỏ khoảng trắng hai đầu) được đọc là JSON.
- Exit 2: chặn với `PreToolUse`, `UserPromptSubmit`, `Stop` (stderr là lý do). Với `PostToolUse`/`PostToolUseFailure`: stderr thành ngữ cảnh cho agent. Với các sự kiện còn lại: chỉ ghi nhật ký.
- Mã khác, hết giờ, không khởi động được: lỗi không chặn; lượt tiếp tục; Hub ghi một dòng cảnh báo có tên hook.
- Trường JSON được đọc: `continue`, `stopReason`, `systemMessage`, `decision`, `reason`, `hookSpecificOutput.{hookEventName, permissionDecision, permissionDecisionReason, additionalContext}`. Giá trị cũ `approve`/`block` của `PreToolUse` ánh xạ sang `allow`/`deny`.
- Mỗi chuỗi tối đa 10 000 ký tự (cắt kèm ghi chú). Stdout và stderr đọc tối đa 64 KB mỗi luồng; phần thừa bỏ.
- Nhiều hook khớp chạy song song. Ưu tiên quyết định: `deny` > `ask` > không quyết định. `continue: false` của bất kỳ hook nào dừng lượt với `stopReason`.

### 11.5 Chèn ngữ cảnh

Đã xác minh bằng spike S-1 (2026-10-09, đọc mã): sidecar `tomny-json-stream` **không** có lệnh chèn ghi chú vào kết quả của một công cụ đã chạy, và không có hàng đợi chèn tin nhắn trong lượt đang chạy. Sidecar chỉ nhận `message`, `stop`, `set_mode`, `set_config`, `add_mcp_server`, `context_snapshot`, `tool_approve`, `tool_deny`, `tool_result`. `tool_result` chỉ thay được đầu ra của công cụ mà Hub tự chạy (công cụ native đã dịch sang `tomny_*` và `tomny_session_actions`).

- `SessionStart`, `UserPromptSubmit`: thêm vào khối ngữ cảnh của lượt (cùng chỗ với ngữ cảnh do stage truy xuất, `contextComposer.composePrompt`), có nhãn "Hook <tên>".
- `PreToolUse` bị `deny`: lý do đi vào `reason` của `tool_deny`; mô hình thấy lý do này trong chính lượt đang chạy.
- `PreToolUse` và `PostToolUse` có `additionalContext`: **hàng đợi theo `sessionId`** do Hub giữ; ngữ cảnh được lấy ra và thêm vào khối ngữ cảnh của **lượt kế tiếp**. Mọi adapter đều dùng cách này (đều dựng lại ngữ cảnh mỗi lượt). Riêng với công cụ Hub tự chạy ở native, nối thêm ghi chú vào kết quả ngay trong lượt là tùy chọn (`TARGET`), không phải đường chính.
- `Stop`: runtime gửi một lượt mới với `reason` làm nội dung (kèm câu trả lời trước), hiện trong chat như "Hook <tên> yêu cầu tiếp tục: …". Runtime hiện không có vòng lặp lượt nào, nên T3.3 thêm vòng lặp (tối đa 3 lần liên tiếp) quanh `adapter.run` trong `ExperimentalCoreRuntime`.
- Mọi ngữ cảnh do hook thêm là dữ liệu chưa tin cậy và đi qua kiểm tra đầu ra (`executeAfterOutboundInspection`) như mọi phần khác của đầu vào mô hình.

### 11.6 An toàn

1. **Chỉ siết, không nới.** Hook không có vai trò `guard` và không cấp quyền. `permissionDecision: "allow"` được coi là không quyết định: không bỏ qua bước duyệt của người dùng hay kho quyền. `updatedInput` và `updatedToolOutput` bị bỏ qua và ghi nhật ký; `TARGET`: hiện input đã sửa trong hộp duyệt để người dùng chấp nhận. Không có chế độ cho hook nới quyền (D16).
2. **Duyệt từng hook, ghim theo nội dung** (mục 9.4). Hash gồm sự kiện, matcher, lệnh, đối số và nội dung tệp script được tham chiếu (tệp trong `source/` của gói).
3. **Hook của gói chạy dạng exec.** Phần tử chạy phải là: (a) một tệp trong thư mục plugin của gói; hoặc (b) một trình thông dịch trong danh sách cố định `node`, `python`, `python3`, `bash`, `sh`, `pwsh`, `powershell`, `bun`, `deno`, `uv` với phần tử script đầu tiên là tệp trong thư mục plugin. Hook dạng shell của gói không bật được; người dùng có thể "chuyển thành hook tự tạo" sau khi thấy đúng chuỗi lệnh.
4. **Ánh xạ trình thông dịch trên Windows:** `.js`/`.mjs`/`.cjs` → Node của Electron (`ELECTRON_RUN_AS_NODE=1`); `.sh` → Git Bash (không có thì `unsupported`, lý do "cần Git Bash"); `.ps1` → `pwsh`, không có thì `powershell`; `.py` → `python` hoặc `uv run`. Tệp không có đuôi và không có shebang → `unsupported`.
5. **Môi trường tối thiểu.** Tiến trình con chỉ nhận `PATH`, `SystemRoot`, `HOME`/`USERPROFILE`, `TEMP`/`TMP`, `LANG`, `ComSpec` (Windows) và các biến đường dẫn ở 11.2. Không nhận khóa API, token hay biến môi trường khác của app.
6. **Giới hạn.** Timeout theo 11.2; hết giờ thì diệt cả cây tiến trình (`taskkill /T /F` trên Windows, nhóm tiến trình trên POSIX). Tối đa 8 hook chạy đồng thời toàn app; hàng đợi thừa thì hook không chặn bị bỏ và ghi nhật ký. Thư mục chạy là workspace của phiên, hoặc thư mục gói khi phiên không có workspace.
7. **Mạng.** v1 không chặn được mạng của tiến trình con trên Windows khi chưa có driver sandbox; hộp duyệt nói rõ điều này. `TARGET`: chạy trong sandbox khi có.
8. **Nhật ký.** Mỗi lần chạy ghi sự kiện, id hook, nguồn, thời gian, mã thoát, quyết định, độ dài đầu ra (không ghi stdin, không ghi đầu ra thô).
9. **Công tắc.** Cài đặt có "Tắt mọi hook" và tắt theo từng nguồn. Tắt có hiệu lực ngay cho lần gọi kế tiếp.
10. **Hỏng thì mở.** Hook lỗi, hết giờ hay không chạy được không bao giờ làm hỏng lượt; chỉ quyết định hợp lệ mới chặn.

### 11.7 Tác tử ACP có hook riêng

Claude Code và các CLI tương tự tự chạy hook trong cấu hình của chúng. Tomny không sở hữu vòng lặp công cụ của chúng nên chỉ chặn được ở yêu cầu cấp quyền. Chuyển plugin vào cấu hình của chính CLI (ví dụ cài plugin cho Claude Code) là `TARGET` sau, cần người dùng đồng ý theo từng workspace, và không thuộc v1.

---

## 12. Extension trong Browser

### 12.1 Hồ sơ duyệt web (quyết định D9)

- Tab Browser chuyển từ phiên mặc định sang phân vùng bền `persist:tomny-browser`. Extension nạp vào đúng phân vùng này. Cửa sổ Hub (nạp bằng `file://` trong phiên mặc định) không bao giờ có extension.
- Lý do: (1) giống Chrome, extension chạy trên mọi tab người dùng duyệt nên chặn quảng cáo, quản lý mật khẩu… dùng được; (2) content script `<all_urls>` không chạm được vào giao diện Hub; (3) mỗi extension một phân vùng thì extension gần như vô dụng.
- Chuyển một lần: lần đầu khởi động bản mới, Main chép cookie từ phiên mặc định sang hồ sơ (`session.cookies.get({})` → `set`), giữ nguyên `secure`, `httpOnly`, `sameSite`, hạn dùng. Dữ liệu `localStorage`/`IndexedDB` không chép được: một số trang phải đăng nhập lại; ghi rõ trong ghi chú phiên bản (D15). Việc chép có cờ đã làm để không lặp lại.
- Chỗ đang đọc cookie từ phiên mặc định (`browserBridge.ts:315`, `contentExtract/youtubeCookies.ts`) chuyển sang hồ sơ.
- Tab nền của agent và tab người dùng dùng cùng hồ sơ (agent cần đăng nhập của người dùng như hiện nay). Tab của `web-embed` dùng phân vùng riêng của app (10.9), không có extension.
- Thêm `setPermissionRequestHandler` và `setPermissionCheckHandler` cho hồ sơ: quyền web (thông báo, camera, mic, vị trí, clipboard đọc) hỏi người dùng theo origin như Chrome, nhớ lựa chọn; mặc định từ chối khi không có người trả lời (sửa G7).

### 12.2 Host extension

- Nạp extension MV3 dạng thư mục bằng `ses.extensions.loadExtension(path, { allowFileAccess: false })` mỗi lần khởi động (Electron không nhớ). Danh sách extension đã bật lưu ở Main.
- **ID ổn định.** Electron tính ID của extension dạng thư mục từ trường `key` trong `manifest.json`, không có thì từ đường dẫn. Thư mục gói đổi theo phiên bản (`<id>/<version>/`), nên nạp thẳng thì mỗi lần cập nhật extension có ID mới và mất `storage`, cài đặt, quyền đã cấp. Vì vậy host nạp từ một **bản làm việc** trong thư mục dữ liệu của gói (`userData/tomny-extensions/<packageId>/<connectionId>/`), chép từ `root`, thêm trường `key` và viết lại `host_permissions`/`content_scripts` theo quyền truy cập trang (mục 12.5) vào `manifest.json` của bản làm việc; mỗi lần nạp đọc lại manifest gốc đã lưu nên không bao giờ thu hẹp chính nó. Giá trị `key`: khóa công khai trong CRX với nguồn Web Store (ID trùng ID trên Web Store); `key` sẵn có nếu manifest của repo đã có; còn lại là khóa RSA do Main sinh một lần cho cặp gói + kết nối và lưu lại. `source/` không bao giờ bị sửa. Main kiểm `manifest.json` của bản làm việc trước khi nạp.
- Lỗi nạp, cảnh báo API không hỗ trợ, service worker sập: ghi vào trạng thái kết nối (`lastError`) và hiện ở trang Tiện ích.
- Manifest V2: Electron 37 nạp được manifest nhưng không chạy background script, nên extension MV2 có `background` là `unsupported`, lý do "cần bản Manifest V3" (spike S-3, mục 12.8).
- Nguồn cài: (1) GitHub qua `/repotopackage`; (2) thư mục cục bộ (hộp chọn của Main); (3) tệp `.crx` hoặc `.zip`; (4) Chrome Web Store theo ID hoặc URL (mục 12.6). Mọi nguồn đều ra gói `local-built` có kết nối `extension`, rồi đi qua cùng đường cài và duyệt.

### 12.3 Phần bù API Chrome (D10)

Cơ chế (Electron 37 có sẵn):

- `ses.registerPreloadScript({ type: 'service-worker', filePath })` cho service worker của extension và `{ type: 'frame' }` cho trang của extension (popup, options). Preload `frame` chạy trong **mọi** frame của hồ sơ, kể cả trang web thường: việc đầu tiên nó làm là kiểm `location.protocol === 'chrome-extension:'` và id thuộc danh sách extension do host nạp; sai thì thoát ngay, không đăng ký hàm nào, không mở kênh IPC nào. Main vẫn kiểm lại người gửi độc lập (không tin preload).
- Preload thêm các hàm còn thiếu vào `chrome.*` (dùng `contextBridge.executeInMainWorld` cho trang, phạm vi toàn cục cho service worker), gọi về Main qua `ipcRenderer` (trang) hoặc `ServiceWorkerMain.ipc` (service worker).
- Router ở Main kiểm danh tính người gọi: id extension lấy từ origin của frame hoặc `scope` của service worker, **không bao giờ** từ tham số. Mỗi API đối chiếu với `permissions` đã khai và người dùng đã duyệt.

Phạm vi v1 (theo đo ngày 2026-10-09: `storage.local`, `alarms`, `declarativeNetRequest`, badge, `tabs.query`, `runtime`, `i18n`, `scripting` đã có sẵn):

| API                                                                                                                                    | Ánh xạ trong Hub                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `tabs.create`, `update`, `remove`, `get`, `query` (đầy đủ trường), `onCreated`, `onUpdated`, `onRemoved`, `onActivated`, `sendMessage` | `BrowserViewManager`, chỉ tab của hồ sơ duyệt web       |
| `windows.getCurrent`, `getAll`, `get`, `create` (tạo tab), `onFocusChanged`                                                            | Một "cửa sổ" ảo là cửa sổ Browser                       |
| `contextMenus.create`, `update`, `remove`, `removeAll`, `onClicked`                                                                    | Menu chuột phải của tab Browser                         |
| `notifications.create`, `clear`, `onClicked`                                                                                           | Thông báo của Hub (Notification Hub)                    |
| `cookies.get`, `getAll`, `set`, `remove`, `onChanged`                                                                                  | Cookie của hồ sơ duyệt web, lọc theo `host_permissions` |
| `webNavigation.onBeforeNavigate`, `onCommitted`, `onDOMContentLoaded`, `onCompleted`, `getFrame`, `getAllFrames`                       | Sự kiện `webContents` của tab                           |
| `downloads.download`, `onCreated`, `onChanged`, `search` (cơ bản)                                                                      | `will-download` của hồ sơ, thư mục tải của người dùng   |
| `permissions.contains`, `getAll`, `request` (hiện hộp hỏi), `remove`                                                                   | Trạng thái quyền đã duyệt                               |
| `storage.sync`                                                                                                                         | Bí danh của `storage.local` (ghi rõ)                    |
| `action.openPopup`, `setPopup`, `setIcon`, `setTitle`                                                                                  | Nút extension trên thanh Browser                        |
| `commands.getAll` (phím tắt: đợt sau)                                                                                                  | Danh sách lệnh                                          |

Chưa làm ở v1: `webRequest` chặn (dùng `declarativeNetRequest`), `history`, `bookmarks` (Browser chưa có), `identity`, `sidePanel`, `offscreen`, `debugger`, `nativeMessaging`. Extension cần các API này nhận `unsupported` và kết luận "dùng được một phần" hoặc "không phù hợp" (mục 7 của extension-model.md).

**Trạng thái T4.3b (2026-10-15, CURRENT, có test đơn vị, chưa có e2e Electron thật):** đã làm `tabs` (create, query, update, remove, get và bốn sự kiện; `sendMessage` giữ bản của Electron), `contextMenus`, `action` (tiêu đề, popup, badge giữ ở Main kèm sự kiện cho thanh công cụ T4.5; chưa có `setIcon`) và `cookies` (chỉ hồ sơ duyệt web, cần host permission). Chưa làm: `windows`, `notifications`, `webNavigation`, `downloads`, `storage.sync`, `commands`. Quy tắc tab chặt hơn Chrome: tab chỉ hiện với extension có quyền `tabs`, hoặc có host permission khớp URL của tab, hoặc đang mở trang của chính nó; tab khác coi như không tồn tại. `activeTab` chưa được tính (thuộc thanh công cụ T4.5). Mã tab là id `webContents`.

**Trạng thái T4.3 (2026-10-15, CURRENT ở mức đơn vị và router; PARTIAL vì chưa có e2e Electron):** đã làm `windows` (một cửa sổ Browser; `remove` bị từ chối; `create` mở tab, giới hạn tốc độ), `notifications` (Notification của Electron, chỉ `basic`, cần quyền `notifications`), `webNavigation` (chỉ khung chính; chỉ gửi cho extension có quyền và host khớp URL), `downloads` (`download` bị từ chối vì chưa có đường xác nhận; `search`, `cancel` và sự kiện chỉ phản ánh tải do Browser tự bắt đầu, qua `will-download` chỉ quan sát), `commands` (`getAll` từ manifest; `onCommand` khi nhấn phím trong tab Browser, phím khớp bị nuốt), `action.setIcon` (chỉ đường dẫn trong extension; `imageData` trả UNSUPPORTED) và `storage.sync`. `tabs.sendMessage` giữ bản của Electron: Electron 37 đã có hàm này (đo ngày 2026-10-15), và Main không có kênh tới content script để bù.

Đo native Electron 37.10.3 (ngày 2026-10-15): `storage.sync` có đối tượng nhưng mọi lệnh ném `"sync" is not available`; vì vậy shim **thay** `get`, `getKeys`, `set`, `remove`, `clear`, `getBytesInUse` (không chỉ bổ sung), và đây là thay đổi so với bảng trên: `storage.sync` không còn là bí danh của `storage.local`. Dữ liệu nằm trên máy, mỗi extension một tệp JSON trong `<userData>/tomny-extension-sync/` (không đồng bộ giữa các máy), theo hạn mức Chrome: 102400 byte, 8192 byte mỗi mục, 512 mục; ghi quá hạn mức bị từ chối và không lưu gì. `storage.sync.onChanged` không được thay và không phát. Mỗi lệnh gọi tối đa 64 KB (giới hạn envelope của router). Dữ liệu `storage.sync` còn lại khi gỡ extension (chưa xóa theo vòng đời).

Còn lại: spec e2e Playwright cho từng nhóm (chưa có); phím tắt không đổi được; `windows.onFocusChanged` theo cửa sổ Hub (cửa sổ được lấy lúc đăng ký). Mã nguồn: `api/groups/browser/{windows,webNavigation}.ts`, `api/groups/ui/{notifications,commands}.ts`, `api/groups/data/{downloads,storageSync}.ts`, `wiring/{tabEventsPort,downloadsPort,hubPorts,syncStoragePort}.ts`.

### 12.4 Userscript

Userscript được chuyển thành một extension MV3 sinh ra (không sửa script gốc): content script với `matches` từ `@match`/`@include`, `run_at` từ `@run-at`, chạy trong world `MAIN` hoặc `ISOLATED` theo `@grant`. Hàm `GM_*` v1: `GM_getValue`, `GM_setValue`, `GM_deleteValue`, `GM_listValues`, `GM_addStyle`, `GM_xmlhttpRequest` (chỉ tới host trong `@connect`, đi qua Main). `@require` và `@resource` trỏ ra mạng: không tải, kết nối `unsupported` với lý do; v1 chỉ nhận khi tệp đó nằm trong repo.

### 12.5 Giao diện

- **Quy tắc dải header** (hàm thuần `common/integrations/extensions/surface.ts`, có test): (1) số biểu tượng ghim hiển thị tính từ độ rộng còn lại, phần ghim thừa chỉ nằm trong popup; (2) độ rộng vùng này phụ thuộc khoảng cách giữa ô tìm kiếm và bảng phụ, bảng phụ mở thì vùng co lại và các biểu tượng dịch theo, tối thiểu luôn còn nút 🧩; (3) mỗi extension khai báo `surfaces` (ví dụ `browser`), biểu tượng và mục popup chỉ hiện khi surface hiện tại khớp, đổi surface thì biến mất nhường chỗ cho extension của surface khác; (4) extension không khai báo hoặc không suy ra được có `surface = none` và hiện ở mọi surface. Trạng thái ghim lưu theo máy, "yêu cầu truy cập" xét theo tab đang mở.
- Quyền truy cập trang theo kiểu Chrome: "khi bấm", "trên trang này", "mọi trang" (mặc định "khi bấm" với extension có quyền rộng).
- Header chung (một dải duy nhất cho mọi surface, không có thanh extension riêng trong Browser): `[biểu tượng ghim 1…n] [nút 🧩 Tiện ích] [chuông thông báo (N)]`. Bấm 🧩 mở popup dropdown (neo dưới header) gồm: Truy cập đầy đủ, Yêu cầu truy cập trang này, mỗi dòng có nút ghim và menu ba chấm, cuối popup là "Quản lý tiện ích" (mở Store → Tiện ích). Popup chạy trong hồ sơ duyệt web ở mọi surface.
- Store → tab Tiện ích (mục 14, S2).
- **Trạng thái T4.5/T4.6 (2026-10-15; CURRENT có test đơn vị và DOM, chưa có e2e Electron):** đã có: (1) dải header lấy danh sách qua Main; renderer không gửi origin, Main đọc URL của tab Browser vừa được chọn (`browserChannels.show`), và yêu cầu có trường lạ bị từ chối; (2) quyền truy cập trang ba mức (khi bấm, mặc định cho extension có quyền rộng; trên trang đã chọn; mọi trang) lưu theo extension trong `tomny-extension-prefs.json` ở userData, áp vào lớp shim qua `setSiteAccess`; quyền rộng khai báo trong manifest chỉ có hiệu lực theo mức đã chọn, và "cho phép trên trang này" chỉ cấp khi manifest (bắt buộc hoặc tùy chọn) bao phủ origin; (3) ghim lưu ở Main, `browser_extension_list` báo `pinned` thật; (4) gỡ qua hộp xác nhận native và `PackageManagerService.uninstall`, chỉ với gói có kết nối extension; (5) biểu tượng là ảnh raster đọc từ tệp của chính extension (tối đa 64 KB, đường dẫn không thoát thư mục, không SVG). (6) quyền trang cho script nội dung (2026-10-15, CURRENT ở mức đơn vị và host; chưa đo trong Electron thật): Electron tự chèn `content_scripts`, nên lớp shim không đủ. Bản làm việc được viết lại mỗi lần nạp theo lựa chọn (`common/integrations/extensions/contentAccess.ts`, `host.ts`): `on-click` bỏ mọi khuôn mẫu rộng (`<all_urls>`, `*://*/*`, `*.com`), chỉ giữ khuôn mẫu hẹp mà gói khai báo; `on-site` thay khuôn mẫu rộng bằng đúng các trang đã cho phép, và chỉ khi khuôn mẫu rộng khai báo bao phủ toàn bộ trang (không bao giờ mở rộng); `all-sites` giữ như khai báo. Khuôn mẫu sai dạng bị bỏ, content script sai bị bỏ cả mục, kèm ghi chú trong bản ghi. Bản gốc trong gói không bao giờ bị sửa (lưu ở `<userData>/tomny-extensions/.source/<gói>/<kết nối>.json`). Đổi chế độ hoặc cấp trang tải lại tiện ích ngay (cùng mã, cùng bộ nhớ); khởi động lại áp dụng lựa chọn đã lưu. Giới hạn: tab đang mở chỉ nhận script khi trang được tải lại (theo cơ chế của Chromium, chưa đo trong Electron); thu hồi từng trang riêng chưa có giao diện (đổi sang `on-click` thu hồi mọi trang trong phiên). Chưa làm: chưa xem và xóa từng trang đã cho phép; tab Tiện ích chưa có nút Thêm (GitHub, thư mục, `.crx`, Web Store); yêu cầu mở popup từ thanh công cụ Browser vẫn `unsupported`; huy hiệu chưa có; chưa kiểm trong Electron thật.

### 12.6 Cài từ Chrome Web Store (D14)

- **Đầu vào:** ID extension (32 ký tự `a`–`p`) hoặc URL `https://chromewebstore.google.com/detail/<tên>/<id>`. Main tách và kiểm ID; không nhận URL dạng khác.
- **Tải:** Main gọi `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=<phiên bản Chromium của Electron>&acceptformat=crx3&x=id%3D<id>%26uc`. Đã kiểm ngày 2026-10-09 (chỉ gửi yêu cầu HEAD): điểm này trả 302 sang `clients2.googleusercontent.com`. Chỉ theo chuyển hướng tới host trong danh sách cho phép (`clients2.google.com`, `clients2.googleusercontent.com`, `edgedl.me.gvt1.com`); host khác thì dừng với `CWS_DOWNLOAD_FAILED` và ghi tên host vào nhật ký để bổ sung danh sách. Timeout 60 giây, tối đa 100 MB, ghi vào thư mục tạm của Main, không gửi cookie hay thông tin đăng nhập.
- **Kiểm CRX3:** 4 byte `Cr24`, phiên bản 3 (uint32 little-endian), độ dài header (uint32 little-endian, ≤ 1 MB), header là protobuf `CrxFileHeader`: các bằng chứng `sha256_with_rsa` và `sha256_with_ecdsa` (mỗi cái gồm khóa công khai và chữ ký) và `signed_header_data` (chứa `crx_id`). Hợp lệ khi: `crx_id` bằng ID yêu cầu; có một bằng chứng mà 16 byte đầu của SHA-256 khóa công khai, đổi mỗi nửa byte sang `a`–`p`, ra đúng ID đó; và chữ ký của bằng chứng đó đúng trên chuỗi `"CRX3 SignedData\x00"` + độ dài `signed_header_data` (uint32 little-endian) + `signed_header_data` + toàn bộ phần ZIP. Sai bất kỳ điều nào thì dừng với `CRX_INVALID`. Bộ phân tích protobuf viết tay (chỉ các trường trên, có giới hạn), đối chiếu với `crx3.proto` của Chromium ở spike S-6. Tệp `.crx` người dùng tự chọn (T4.7) đi qua cùng bộ kiểm, với ID lấy từ `crx_id`.
- **Giải nén và đóng gói:** phần ZIP giải nén theo cùng quy tắc an toàn của gói (không `..`, không symlink, giới hạn kích thước) rồi thành gói `local-built` như mọi nguồn: `source/` là nội dung đã giải nén; kết nối `extension` có `publicKey` lấy từ bằng chứng ở trên (giữ đúng ID của Web Store); `provenance` là `{ kind: 'chrome-web-store', extensionId, extensionVersion }`.
- **Cập nhật** (D18, chỉ khi người dùng bấm): gọi cùng điểm với `response=updatecheck`, đọc `version` trong XML trả về, so với `extensionVersion`; mới hơn thì tải lại và đi đường cập nhật ở mục 9.5 (nội dung đổi thì kết nối tắt chờ duyệt lại).
- **Thư viện:** được tham khảo `electron-chrome-web-store` (MIT), nhưng không dùng phần tự cài vào phiên của nó: mọi extension phải đi qua đường cài và duyệt của Hub.
- **Công tắc:** cờ `chromeWebStoreSource` tắt riêng nguồn này, không ảnh hưởng extension đã cài. Giao diện ghi rõ "Từ Chrome Web Store" và có liên kết tới trang của extension.
- **Chi phí và pháp lý:** người dùng cài không mất phí; phí đăng ký một lần của Google chỉ áp dụng cho người đăng extension lên Web Store. Thỏa thuận dành cho nhà phát triển của Web Store mô tả việc phân phối cho người dùng Google Chrome; người dùng đã chấp nhận rủi ro này (D14).

### 12.7 Agent

Công cụ Browser của agent thêm `browser_extension_list` và `browser_extension_action` (bấm nút action hoặc một mục menu ngữ cảnh của extension trên tab hiện tại), đi qua quyền như mọi công cụ Browser. Không có đường cho agent cài hay bật extension.

---

### 12.8 Kết quả spike S-2 đến S-6 (đã đo ngày 2026-10-09 trên Electron 37.10.3; bắt buộc đọc trước T4.x)

Phần này **thắng** các mục 12.1 đến 12.6 ở chỗ nào khác nhau.

**Cơ chế phần bù API (S-2) khả thi, với các điều chỉnh:**

- `registerPreloadScript({ type: 'service-worker' })` chạy trong service worker của extension, nhưng trong một realm riêng: **không có `self` hay `chrome`**. Muốn thêm hoặc ghi đè `chrome.*` phải dùng `contextBridge.executeInMainWorld` (hoặc `exposeInMainWorld`), cả ở service worker lẫn trang. Đã kiểm: thêm namespace `chrome.windows`, thêm `chrome.tabs.<hàm mới>`, ghi đè `chrome.tabs.create` đều chạy. Không ghi đè các API Electron đã có sẵn (`storage`, `alarms`, `runtime`…).
- Handler `ServiceWorkerMain.ipc` (lấy bằng `ses.serviceWorkers.getWorkerFromVersionID`) phải được gắn **đồng bộ** khi service worker ở trạng thái `starting` (sự kiện `running-status-changed`), trước khi script chạy. `ipcMain` không nhận được tin từ service worker. Danh tính người gọi: `event.serviceWorker.scope` (service worker) và `event.senderFrame.url` (trang), không lấy từ tham số.
- Preload `type: 'frame'` chạy ở trang `chrome-extension://<id>/popup.html` nhưng **cũng chạy ở mọi trang http thường cùng session**. Dòng đầu tiên của nó phải thoát nếu `location.protocol !== 'chrome-extension:'` hoặc id không thuộc extension do host nạp.
- Lúc preload frame chạy, `chrome.runtime` còn `undefined`; hàm đã thêm vẫn có mặt sau khi trang nạp xong.

**Manifest V2 (S-3):** Electron 37 chấp nhận nạp manifest MV2 (chỉ cảnh báo deprecated) nhưng **background script không chạy**. Quy tắc: extension MV2 có `background` là `unsupported` với lý do "cần bản Manifest V3". Không có đường thay thế.

**declarativeNetRequest (S-3):** luật **động** (`updateDynamicRules`) chặn thật, không cần `host_permissions`. Luật **tĩnh** trong manifest **không tự bật** (`getEnabledRulesets()` rỗng). Host phải gọi `updateEnabledRulesets` cho từng extension, qua preload service worker, với danh sách lấy từ `declarative_net_request.rule_resources` của **chính extension đó** (lọc theo `scope`, nếu không ruleset bật nhầm sang extension khác). Luật `redirect` cần `host_permissions`; luật `block` không cần.

**Popup (S-5):** `WebContentsView` con nạp được `chrome-extension://<id>/popup.html`. Khởi tạo view nhỏ (ví dụ 30×30) để đo đúng nội dung, rồi theo dõi thay đổi bằng `ResizeObserver` trong trang popup (báo kích thước về Main qua preload) và `setBounds` theo đó, không đo một lần. Đóng khi `blur` của webContents hoặc `window.blur`; click ra ngoài vùng view cần lớp phủ bắt click (chưa đo được click thật). `window.close()` từ popup huỷ `webContents`: Hub phải xử lý sự kiện `destroyed` để gỡ view.

**Chép cookie (S-4), quy tắc chính xác cho mục 12.1:** với mỗi cookie lấy từ `session.defaultSession.cookies.get({})`:

1. Dựng `url` từ `domain` (bỏ dấu chấm đầu) cộng `path`; `https` nếu `secure`, ngược lại `http`.
2. **Chỉ truyền `domain` khi `hostOnly` là false.** Truyền `domain` cho cookie host-only làm cookie rộng hơn bản gốc (thành `.host`) và làm cookie `__Host-` bị từ chối.
3. Giữ nguyên `sameSite` Electron trả về (kể cả `unspecified`), `secure`, `httpOnly`, `expirationDate`.
4. Lỗi từng cookie được thu thập, không dừng cả đợt chép.
5. **Cookie phiên (không có `expirationDate`) không sống qua lần khởi động lại** trong phân vùng `persist:`, khác Chrome. Ghi vào ghi chú phiên bản D15. Chưa giải quyết (tùy chọn sau: gán hạn nhân tạo, đổi ngữ nghĩa phiên).

**CRX3 (S-6), xác nhận mục 12.6:**

- Điểm tải `clients2.google.com/service/update2/crx` trả 302 sang `clients2.googleusercontent.com/crx/blobs/...` rồi 200. Danh sách host cho phép đã đúng; `edgedl.me.gvt1.com` chưa thấy dùng, giữ cũng không hại.
- Header: `Cr24`, version 3, độ dài header little-endian đúng. Phạm vi dữ liệu ký đúng như mục 12.6 (đã thử bốn biến thể sai đều thất bại).
- **Header có nhiều bằng chứng** (ví dụ 2 RSA và 1 ECDSA). Chỉ **bằng chứng có ID tính ra khớp ID yêu cầu** được dùng làm `publicKey`; các bằng chứng khác là khóa của Google. Chromium yêu cầu mọi chữ ký có mặt đều hợp lệ, nên bộ kiểm xác minh **tất cả** chữ ký và từ chối nếu có cái sai.
- Manifest tải từ Web Store **không có `key`**: bước thêm `key` ở mục 12.2 là bắt buộc. Đã xác nhận: có `key` thì ID giữ nguyên dù đổi thư mục (và trùng ID Web Store); không có `key` thì ID đổi theo đường dẫn.
- Quan sát cần theo dõi ở T4.3: service worker của uBlock Origin Lite báo `Cannot read properties of undefined (reading 'onRemoved')` khi chạy trong Electron (API thiếu chưa xác định) và đăng ký service worker thất bại. Khi làm T4.3 phải chạy thử extension này để tìm API cần bù.

## 13. Runtime tiến trình

Dựng trên `PersistentContributionSupervisor` (đã có): bật, hủy theo đúng danh tính gói và kết nối, bằng chứng, đóng an toàn khi gói bị tắt, gỡ hoặc thu hồi.

- **Endpoint mới `RepoProcessEndpoint`:** chạy từng `processService` theo thứ tự khai báo; `setup` chạy một lần (đánh dấu theo `approvalHash`); `start` chạy dạng exec, thư mục làm việc phải nằm trong thư mục gói (kiểm bằng `realpath`); chương trình thuộc `ADAPTER_PROCESS_PROGRAMS`; `node` qua Electron.
- **Sẵn sàng:** chờ cổng loopback `ready.port` mở, tối đa 120 giây (có tiến độ); cổng đã bị chiếm trước khi chạy → lỗi `PORT_IN_USE` kèm tên tiến trình nếu đọc được.
- **Môi trường:** chỉ biến khai báo trong `env` (giá trị từ kho bí mật của gói, đọc trong Main) cộng biến hệ thống tối thiểu như hook; `PORT` đặt theo `ready.port`; `HOST=127.0.0.1`.
- **Nhật ký:** vòng đệm 1 000 dòng mỗi dịch vụ, che bí mật trước khi gửi renderer.
- **Dừng:** tắt kết nối, gỡ gói, thoát Hub → dừng mềm 5 giây rồi diệt cây tiến trình. Sập → khởi động lại tối đa 3 lần trong 5 phút, sau đó `error`.
- **Giới hạn:** tối đa 6 dịch vụ chạy đồng thời toàn app ở v1; vượt thì hỏi người dùng dừng bớt.
- **Mạng:** v1 không chặn mạng ra của tiến trình; hộp duyệt nói rõ. Trang nhúng chỉ được điều hướng trong loopback của chính gói.

---

## 14. Các chức năng xung quanh (chỗ xuất hiện)

| ID  | Bề mặt                                                        | Hiện có                                                                    | Cần thêm                                                                                                                                                                                                   | Phục vụ loại                        |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| S1  | Store → **Đã cài**                                            | Danh sách catalog có huy hiệu đã cài (`HubWorkspacePage.tsx`)              | Bộ lọc Tất cả / Đã cài / Cập nhật; gói `local-built` có nhãn "Tạo trên máy này"; nút "Kiểm tra bản mới từ GitHub"                                                                                          | Mọi loại                            |
| S2  | Store → tab **Tiện ích**                                      | Không                                                                      | Danh sách extension và userscript; thêm từ GitHub, thư mục, `.crx`/`.zip`, Chrome Web Store (ID hoặc URL); bật, quyền truy cập trang, ghim, gỡ, lỗi                                                        | `extension`                         |
| S3  | Store → **Thêm từ GitHub**                                    | Chỉ qua chat `/repotopackage`                                              | Ô nhập URL hoặc chọn thư mục, tiến độ thật, báo cáo, mở thẳng chi tiết gói                                                                                                                                 | Mọi loại                            |
| S4  | Chi tiết gói → **Kết nối**                                    | Chi tiết gói có quyền và bí mật (`renderer/pages/hub/StoreProductDetail/`) | Danh sách kết nối nhóm theo plugin; trạng thái; nút bật (hộp duyệt mục 9.4); openItem cần xử lý (điền biến qua `PackageSecretsSection`, chọn phương án, trỏ thư mục build); lý do `unsupported`; nguồn gốc | Mọi loại                            |
| S5  | Header chung: **dải tiện ích** `[ghim 1…n] [🧩] [chuông (N)]` | Thanh công cụ có chuông, cài đặt, số dư (`Titlebar/index.tsx`)             | Số biểu tượng ghim theo độ rộng còn lại; thu gọn thành `🧩 + chuông`; popup dropdown; lọc theo surface (mục 12.5)                                                                                          | `extension`                         |
| S6  | (đã gộp vào S5: Browser không có thanh extension riêng)       | Không                                                                      | Mục 12.5                                                                                                                                                                                                   | `extension`                         |
| S7  | Chat: **bảng `/`**                                            | Lệnh dựng sẵn và lệnh ACP                                                  | Nguồn `package`, nhãn gói, mở rộng mẫu ở Main                                                                                                                                                              | `command`, `tool`                   |
| S8  | **Agents**                                                    | Danh mục Assistant                                                         | Nguồn `package`, chỉ đọc, "Nhân bản để sửa"                                                                                                                                                                | `agent`                             |
| S9  | Cài đặt → **MCP**                                             | Có, nhận MCP của gói (stdio)                                               | Transport http/sse, nhãn gói, liên kết về chi tiết gói                                                                                                                                                     | `mcp`                               |
| S10 | Cài đặt → **Hooks**                                           | Không                                                                      | Danh sách theo nguồn, tạo hook, duyệt, nhật ký, công tắc tổng                                                                                                                                              | `hook`                              |
| S11 | Sidebar → **Thư viện** (dưới Store)                           | Không (sidebar: `HubSidebar.tsx:57-62`)                                    | Danh sách tài liệu (chỉ đường dẫn), quy tắc, gắn vào workspace; tệp mất hiện "không còn ở đây" và chọn lại; nút Back về danh sách Thư viện                                                                 | `rules`, `knowledge`                |
| S12 | **Trình xem tệp ở trung tâm**                                 | Explorer mở bằng app mặc định của Windows                                  | Trình xem văn bản, Markdown, mã, ảnh, PDF trong trung tâm; nút "Mở bằng ứng dụng khác"                                                                                                                     | Thư viện, Explorer                  |
| S13 | **Apps** (ghim ở sidebar, danh sách app)                      | Ghim app, danh sách app gói (`installedPackageApps.ts`)                    | Mục cho `web-embed` và `launcher`; trung tâm hiện trang nhúng hoặc trạng thái "đã mở ngoài"                                                                                                                | `web-embed`, `launcher`             |
| S14 | **Terminal** ở thanh trạng thái                               | Nút mở gói Terminal (`HubShell.tsx:438`)                                   | Menu "Mở terminal với <CLI>"                                                                                                                                                                               | `cli`                               |
| S15 | Bảng **`*`**                                                  | Có                                                                         | Mục CLI và tool của gói                                                                                                                                                                                    | `cli`, `tool`                       |
| S16 | **Notification Hub**                                          | Có                                                                         | Thông báo lỗi dịch vụ, cập nhật gói, extension                                                                                                                                                             | `service`, `web-embed`, `extension` |
| S17 | Sidebar → **Active**                                          | Có SDK phiên (`docs/platform/sidebar-sessions-sdk.md`)                     | Dịch vụ đang chạy, nút dừng, nhật ký                                                                                                                                                                       | `service`, `web-embed` process      |

Quy tắc giao diện chung (AGENTS.md mục 5): style chỉ trong `renderer/styles/tomni-ui.css`; mọi chuỗi qua i18n cho mọi locale; khi đổi diện mạo thì cập nhật cùng lúc `docs/product/tomni-design-system.md` và `mockup/home-wireframe-v3.html`.

---

## 15. Mô hình an toàn

### 15.1 Bảy điểm của AGENTS.md mục 6 cho từng đường thực thi mới

| Đường                                                                       | Danh tính                                                           | Quyền                                     | Duyệt                                | Bí mật                                      | Đích mạng                                 | Giới hạn                              | Bằng chứng                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------ | ------------------------------------------- | ----------------------------------------- | ------------------------------------- | --------------------------------------------- |
| Hook                                                                        | packageId + connectionId hoặc `user:<id>` / `workspace:<path>#<id>` | Không cấp quyền; chỉ siết                 | Từng hook, ghim nội dung             | Không nhận bí mật; stdin đã che             | Không chặn ở v1 (ghi rõ)                  | Timeout, 8 đồng thời, đầu ra 64 KB    | Nhật ký mỗi lần chạy                          |
| Tiến trình (`web-embed` process, `service`, `mcp` nguồn, `launcher` source) | packageId + connectionId + approvalHash                             | `ADAPTER_PROCESS_PROGRAMS`, cwd trong gói | Từng kết nối                         | Biến khai báo, giá trị từ kho bí mật ở Main | Không chặn ra; nhúng chỉ loopback của gói | 6 dịch vụ, restart 3 lần, dừng 5 giây | `PersistentContributionSupervisor` evidence   |
| CLI cho agent                                                               | packageId + connectionId                                            | Token đối số, không shell                 | Mỗi lần hoặc nhớ theo workspace      | Không                                       | Không chặn ở v1                           | 120 giây, 64 KB                       | Nhật ký công cụ hiện có                       |
| MCP http/sse                                                                | packageId + connectionId                                            | Như MCP                                   | Khi bật, thấy host                   | Header từ kho bí mật                        | Đúng host của `url`                       | Như MCP                               | Như MCP                                       |
| Extension                                                                   | id extension từ origin                                              | `permissions` đã duyệt                    | Khi bật; quyền rộng cần đồng ý riêng | Không truy cập kho bí mật                   | Theo `host_permissions`                   | Router từ chối API chưa duyệt         | Nhật ký gọi API nhạy cảm (cookies, downloads) |
| Lệnh `/`, agent, rules, knowledge                                           | packageId + connectionId                                            | Không cấp quyền                           | Khi bật (xem nội dung)               | Không                                       | Không                                     | Kích thước                            | Ghi khi bật/tắt                               |

### 15.2 Mối đe dọa và biện pháp

| Mối đe dọa                                         | Biện pháp                                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Repo độc chèn lệnh chạy khi cài                    | Không gì chạy khi cài; lệnh từ khuôn mẫu; hook phải duyệt từng cái           |
| Repo đổi nội dung sau khi được duyệt               | `approvalHash` gồm nội dung tệp; cập nhật đổi thì tự tắt                     |
| Lệnh slash hoặc agent chứa prompt injection        | Là dữ liệu chưa tin cậy; đi qua pipeline và kiểm tra đầu ra; không cấp quyền |
| Bí mật trong repo (`.env`, khóa trong `.mcp.json`) | `fileScreen` loại; detector không chép giá trị, chỉ tên biến                 |
| Tệp CRX bị tráo hoặc sai nguồn khi tải             | HTTPS, host cho phép, kiểm chữ ký CRX3 khớp ID yêu cầu                       |
| Gói giả danh `com.tomni.*`                         | `local-built` cấm namespace này                                              |
| Extension đọc phiên của giao diện Hub              | Hồ sơ duyệt web riêng; Hub ở phiên mặc định                                  |
| Extension gọi API ngoài quyền                      | Router lấy id từ origin, đối chiếu quyền đã duyệt                            |
| Renderer giả mạo đường dẫn gói hoặc phân vùng      | Main chọn đường dẫn và phân vùng; IPC chỉ nhận id                            |
| Biểu thức `matcher` gây treo                       | Giới hạn độ dài pattern và chuỗi đem so                                      |
| Tiến trình con mồ côi                              | Diệt cây tiến trình; `reconcile` khi khởi động                               |
| Đầy đĩa khi đóng gói repo lớn                      | Kiểm chỗ trống trước khi ghi                                                 |

---

## 16. Mô hình lỗi

- Mọi kết quả kết thúc ở một trong ba trạng thái: dùng được; cần bổ sung (openItem nói rõ cần gì); chưa có runtime (lý do nói rõ thiếu gì). Không có lỗi âm thầm.
- Lỗi của một detector không làm hỏng các detector khác; lỗi của một kết nối không làm hỏng gói.
- Mã lỗi ổn định cho người dùng và test: `SOURCE_INVALID`, `CLONE_FAILED`, `DISK_SPACE_LOW`, `SIGNATURE_INVALID`, `LOCAL_KEY_REVOKED`, `NAMESPACE_FORBIDDEN`, `RUNTIME_MISSING`, `PORT_IN_USE`, `APPROVAL_REQUIRED`, `HOOK_TIMEOUT`, `EXTENSION_LOAD_FAILED`, `API_NOT_GRANTED`, `CWS_DOWNLOAD_FAILED`, `CRX_INVALID`. Thông điệp cho người dùng qua i18n.
- Mỗi lỗi hiện ở đúng một chỗ: lỗi đóng gói trong tin nhắn `/repotopackage` và trang S3; lỗi kết nối ở S4 (và S2 với extension); lỗi tiến trình ở S17 và Notification Hub.

---

## 17. Kiểm thử và bằng chứng

### 17.1 Bộ fixture

`tests/fixtures/repotopackage/<tên>/`: cây tệp tối thiểu, **viết tay**, tái hiện đúng cấu trúc khai báo của repo thật (không chép mã của bên thứ ba). Mỗi fixture có `expected.adapter.json`. Tối thiểu:

| Fixture                             | Mô phỏng                                                                                                                                               | Kiểm                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `multi-host-plugin`                 | `upstash/context7` (marketplace ba vị trí, plugin Claude/Codex/Copilot/agent-plugins, `gemini-extension.json`, MCP http + npx, skill trùng nhiều host) | Gộp, `group`, skill trùng, biến từ `settings[].envVar` |
| `claude-plugin-full`                | Plugin có `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `bin/`, `.lsp.json`                                                                 | Đủ loại kết nối; LSP thành openItem                    |
| `chrome-mv3`                        | Extension đã build có `background`, `content_scripts`, `action`, `permissions` gồm `tabs`, `contextMenus`, `webRequest`                                | `unsupported` đúng; `needs-consent` cho `<all_urls>`   |
| `chrome-wxt-unbuilt`                | Dự án WXT chưa build                                                                                                                                   | `needsBuild`, openItem `needs-build`                   |
| `userscript`                        | `.user.js` có `@match`, `@grant GM_xmlhttpRequest`, `@connect`, `@require` từ mạng                                                                     | `extension` userscript, `@require` thành lý do         |
| `mcpb-node`                         | Bundle MCPB kiểu Node                                                                                                                                  | `mcp` từ bundle                                        |
| `web-service`                       | MediSign_AI-legacy (FastAPI + Next.js)                                                                                                                 | Giữ đúng kết quả hiện tại                              |
| `cli-npm`, `cli-python`, `cli-rust` | `bin`, `[project.scripts]`, `[[bin]]`                                                                                                                  | `cli`; Rust thành `needs-runtime`                      |
| `desktop-electron`                  | electron-builder + Releases                                                                                                                            | `launcher` installed                                   |
| `compose-app`                       | `docker-compose.yml` có cổng                                                                                                                           | `launcher` compose + `web-embed` url loopback          |
| `discord-bot`                       | discord.js, không giao diện                                                                                                                            | `service` + `needs-consent`                            |
| `rules-collection`                  | Nhiều `.cursor/rules/*.mdc` và `AGENTS.md`                                                                                                             | `rules`                                                |
| `awesome-list`                      | README nhiều liên kết                                                                                                                                  | `knowledge`                                            |
| `secret-leak`                       | `.mcp.json` có header khóa thật, `.env`                                                                                                                | Không giá trị nào vào gói; openItem `env-value`        |
| `hostile-paths`                     | Đường dẫn `..`, symlink, tên Windows cấm                                                                                                               | Bị loại, không lọt                                     |

### 17.2 Mức kiểm

- **Đơn vị:** mỗi detector với fixture của nó; merge; schema (ghi chặt, đọc rộng, tương thích ngược với bản đọc cũ); matcher và đọc đầu ra của hook; ánh xạ trình thông dịch; router API extension (frame và service worker giả).
- **Hợp đồng và tích hợp** (bắt buộc với gói, IPC, bảo mật theo AGENTS.md mục 7): cài, bật, tắt, gỡ, khởi động lại một gói `local-built` đủ mọi loại kết nối data; đối chiếu kho trước và sau gỡ (tiêu chí C5); cập nhật với kết nối đổi (C6); hook `PreToolUse` exit 2 chặn công cụ native; `UserPromptSubmit` chặn trước model; hook hết giờ không treo lượt; môi trường tiến trình con không có biến bí mật; renderer không mở được tab với phân vùng tùy ý cho `web-embed`.
- **E2E trong Electron thật:** dùng harness Playwright có sẵn (`tests/e2e/fixtures.ts`, lệnh `bun run test:e2e`). Bắt buộc với: phần bù API extension (một spec mỗi nhóm API, extension fixture đã build trong `tests/fixtures/repotopackage/`), chuyển hồ sơ duyệt web, popup extension, mở app `web-embed`.
- **Chạy thật trên repo GitHub (e2e có checklist):** mỗi đợt chạy `/repotopackage` trên danh sách URL thật: `upstash/context7`, `anthropics/claude-code` (thư mục plugin), một extension MV3 phổ biến đã build, một userscript từ GitHub, MediSign_AI-legacy, một CLI npm, một app Electron có Releases, một app compose. Ghi kết quả vào báo cáo bàn giao, không vào tài liệu này.
- **Cổng chung** trước khi bàn giao task: test của task, `npx tsc --noEmit -p packages/desktop`, `npx oxlint <tệp đã sửa>`, `npx prettier --check <tệp đã sửa>`; đổi chuỗi giao diện thì thêm `bun run i18n:types` và `node scripts/check-i18n.js`.

---

## 18. Task cho agent con

### 18.1 Quy ước

- **[I]** = việc của Integrator (đụng hợp đồng chung: preload, `ipcBridge.ts`, `bridge/index.ts`, đăng ký bootstrap, `i18n-config.json`, schema lưu trữ, `PackageManagerService.ts`, `common/packages/types.ts`, route gốc trong `renderer/components/layout/Router.tsx` và `hubRoutes.ts`, cấu hình build). **[S]** = agent con.
- Task [S] cần route mới, namespace i18n mới hoặc kênh IPC mới thì giao component, khóa i18n và schema đề xuất trong bàn giao; Integrator đăng ký. Task [S] không tự sửa các tệp [I].
- Mỗi task: Mục tiêu · Phụ thuộc · Được sửa · Không được sửa · Việc · Chấp nhận · Quay lại.
- "Không được sửa" luôn gồm các tệp [I] ở trên trừ khi task là [I], và mọi tệp ngoài "Được sửa".
- Chấp nhận luôn gồm cổng chung ở 17.2 và đề xuất nhãn trạng thái mới trong bàn giao; Integrator ghi vào tài liệu này.
- Mặc định "Quay lại" của task chỉ thêm tệp mới: xóa các tệp đó qua MTUI. Task sửa tệp có sẵn ghi rõ cách quay lại.
- Đường dẫn trong bảng task theo mục 4.1. Viết tắt: `connections/…`, `hooks/…`, `runtime/…`, `browserExtensions/…`, `library/…`, `repoSources/…` tính từ `packages/desktop/src/process/integrations/`; `detectors/…` tính từ `packages/desktop/src/common/integrations/`. Các đường dẫn khác tính từ `packages/desktop/src/` nếu không ghi rõ.

### 18.2 Spike (làm trước, mỗi cái ≤ nửa ngày, kết quả là báo cáo, mã thử bỏ đi)

| ID  | Câu hỏi                                                                                                                                                                                     | Cách thử                                              | Ảnh hưởng                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| S-1 | Giao thức sidecar `tomny-json-stream` có lệnh chèn ghi chú vào kết quả công cụ không?                                                                                                       | Đọc `tomnyCoreAdapter.ts` và mã sidecar; thử một lệnh | Mục 11.5                                          |
| S-2 | `registerPreloadScript({ type: 'service-worker' })` có chạy trong service worker của extension (`chrome-extension://`) trên Electron 37.10.3 không; `ServiceWorkerMain.ipc` nhận được không | App Electron tối thiểu trong `.tmp/`                  | Mục 12.3; nếu không được thì thiết kế lại phần bù |
| S-3 | Electron 37 có nạp MV2 không; `declarativeNetRequest` có chặn thật không                                                                                                                    | Như S-2                                               | Mục 12.2                                          |
| S-4 | Chép cookie từ phiên mặc định sang phân vùng bền giữ đăng nhập của 5 trang phổ biến không                                                                                                   | Như S-2 với hồ sơ thử                                 | Mục 12.1                                          |
| S-5 | Popup extension trong `WebContentsView` con có hoạt động (kích thước tự động, đóng khi mất focus)                                                                                           | Như S-2                                               | Mục 12.5                                          |
| S-6 | Cấu trúc CRX3 thật có khớp mục 12.6 không: tải một extension phổ biến, phân tích header, kiểm chữ ký, nạp với `key` và so ID                                                                | Script trong `.tmp/`                                  | Mục 12.6, T4.9                                    |

### 18.3 Đợt 0: nền

**T0.1 [S] Schema adapter mở rộng.**  
Phụ thuộc: không. Được sửa: `common/packages/adapter.ts` (nếu vượt khoảng 600 dòng thì tách thành thư mục `common/packages/adapter/` với `schema.ts`, `read.ts`, `connections/*.ts`, giữ `adapter.ts` làm điểm xuất), `tests/unit/package-manager/adapter.test.ts`, `adapter.compat.test.ts`.  
Việc: thêm mọi trường và loại ở mục 6.1–6.4; `mcp` có `transport`; `connectionKey` cho loại mới; `ADAPTER_INSTALLABLE_KINDS` chưa đổi (host đăng ký sau).  
Chấp nhận: test ghi chặt từ chối trường lạ; đọc rộng bỏ đúng kết nối sai; tài liệu cũ (7 loại) đọc ra y như trước; tài liệu mới đọc bằng bản đọc giả lập "chỉ biết 7 loại" vẫn giữ các kết nối cũ; `mcp` http không có `command` hợp lệ; header có giá trị thẳng bị từ chối.

**T0.2 [S] Bản kê, hợp đồng detector, gộp.**  
Phụ thuộc: T0.1. Được sửa: `detectors/{types,inventory,merge,index}.ts` (mới), `tests/unit/integrations/detectors/merge.test.ts` (mới).  
Việc: mục 7.1, 7.2, 7.5. `index.ts` xuất danh sách detector (rỗng lúc đầu) và hàm `detectAll(inventory)`.  
Chấp nhận: gộp theo khóa; nhóm thay thế với thứ tự mặc định; chọn plugin chính theo host; tiêu chí C2 sinh openItem cho tệp không ai nhận; kết quả không đổi khi đảo thứ tự detector (test hoán vị).

**T0.3 [S] Bộ fixture.**  
Phụ thuộc: T0.1. Được sửa: `tests/fixtures/repotopackage/**` (mới), `tests/unit/integrations/detectors/fixtures.ts` (trình nạp fixture thành `RepoInventory`).  
Việc: các fixture ở 17.1, viết tay; `expected.adapter.json` ban đầu là kỳ vọng thiết kế (task detector sẽ làm cho test khớp).  
Chấp nhận: trình nạp đọc được mọi fixture; fixture `hostile-paths` được dựng bằng mã lúc chạy test (không commit symlink).

**T0.4 [I] Mức tin cậy `local-built`, đường cài, trạng thái kết nối.**  
Phụ thuộc: T0.1. Được sửa: `common/packages/types.ts`, `process/extensions/package-manager/PackageManagerService.ts`, `process/extensions/package-manager/packageStore.ts`, `process/extensions/package-manager/repoPackaging/signingKey.ts` (ghim khóa công khai), `connections/core/state.ts` (mới), test tích hợp mới `tests/unit/integrations/connections/localBuilt.test.ts`.  
Việc: mục 9.1, 9.2 và lưu `InstalledConnectionState` (mục 6.5). Chưa có host nào: mọi kết nối cài xong ở `off` hoặc `unsupported`.  
Chấp nhận: cài, gỡ, khởi động lại gói `local-built`; từ chối `com.tomni.*`, `trusted-react`, lưu trữ bị sửa, khóa lạ, khóa đã thu hồi; giao dịch lỗi không để lại gì; đường dẫn gói chỉ đến từ thư mục đầu ra của packager hoặc hộp chọn của Main; gói Store hiện có cài và chạy y như trước (chạy lại `tests/unit/package-manager`).  
Quay lại: cờ `localBuiltPackages` mặc định tắt cho tới khi T2.7 xong; tắt cờ thì gói `local-built` bị bỏ qua khi nạp (không xóa).

**T0.7 [I] Sổ đăng ký host, duyệt, IPC kết nối.**  
Phụ thuộc: T0.4. Được sửa: `connections/core/{registry,types,approval}.ts` (mới), IPC đọc trạng thái, xem `describe`, bật, tắt kết nối (`common/adapter/ipcBridge.ts`, `preload/main.ts`, đăng ký trong `process/bridge/index.ts`), test `tests/unit/integrations/connections/registry.test.ts`.  
Việc: mục 9.3, 9.4 (gồm `group`), `reconcile` khi khởi động; IPC có schema, kiểm người gửi, giới hạn kích thước, mã lỗi ổn định (mục 16).  
Chấp nhận: với một host giả: bật cần `approvalHash` khớp hộp duyệt vừa hiện; bật lại sau khi nội dung đổi bị từ chối `APPROVAL_REQUIRED`; bật một kết nối trong `group` tắt các kết nối khác; `reconcile` gỡ thứ host đã cài cho gói không còn; renderer không gửi được `approvalHash` tự tạo (Main tính lại).

**T0.5 [S] Packager: luồng, đĩa, nguồn gốc.**  
Phụ thuộc: T0.1. Được sửa: `process/extensions/package-manager/repoPackaging/{packager,archive,fileScreen,types}.ts`, test trong `tests/unit/package-manager/repoPackaging/`.  
Việc: mục 8.  
Chấp nhận: đóng gói một cây giả 200 MB sinh trong thư mục tạm (dọn sau test, đánh dấu test chậm) mà bộ nhớ đỉnh tăng < 150 MB; `DISK_SPACE_LOW` khi giả lập chỗ trống thấp; `provenance.commit` có khi nguồn là Git; mọi test repoPackaging cũ vẫn pass.  
Quay lại: giữ đường cũ sau cờ `streamingPackager` cho tới khi e2e đợt 1 pass.

**T0.6 [S] Hợp đồng hook (thuần).**  
Phụ thuộc: không. Được sửa: `common/integrations/hooks/{events,config,matcher,output,placeholders}.ts` (mới), `tests/unit/integrations/hooks/*.test.ts` (mới).  
Việc: kiểu sự kiện, schema cấu hình 11.2 (đọc định dạng Claude Code), matcher 11.2, đọc đầu ra 11.4, thay biến đường dẫn, ánh xạ `permission_mode`.  
Chấp nhận: bảng test cho ba dạng matcher; exit 0/2/khác; JSON hợp lệ, hỏng, lẫn văn bản; cắt 10 000 ký tự; `approve`/`block` cũ; `allow` không bao giờ thành quyết định cho phép.

### 18.4 Đợt 1: detector (tất cả [S], song song, mỗi task một tệp detector + test)

Mỗi task: Phụ thuộc T0.2, T0.3 (và T0.6 với T1.1, T1.5). Được sửa: `detectors/agent/<tên>.ts` hoặc `detectors/apps/<tên>.ts` (theo mục 4.1), `tests/unit/integrations/detectors/<tên>.test.ts`, và chỉ fixture của mình trong `tests/fixtures/repotopackage/`. Chấp nhận: fixture của mình khớp `expected.adapter.json`; mọi tệp khai báo trong fixture nằm trong `claimed` hoặc thành openItem.

| ID   | Detector                                                                | Fixture chính                                    |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| T1.1 | `agent-plugins` (mục 7.3)                                               | `multi-host-plugin`, `claude-plugin-full`        |
| T1.2 | `mcp-config` + `mcp-published` (chuyển logic MCP cũ ra khỏi classifier) | `multi-host-plugin`, `mcpb-node`, `secret-leak`  |
| T1.3 | `gemini` + `commands-agents`                                            | `multi-host-plugin`, `claude-plugin-full`        |
| T1.4 | `rules`                                                                 | `rules-collection`                               |
| T1.5 | `hooks` (dùng parser của T0.6)                                          | `claude-plugin-full`                             |
| T1.6 | `browser-ext` (gồm userscript, bảng API mục 12.3 làm dữ liệu)           | `chrome-mv3`, `chrome-wxt-unbuilt`, `userscript` |
| T1.7 | `cli-launcher`                                                          | `cli-*`, `desktop-electron`                      |
| T1.8 | `services` (bọc `serviceDetector`, thêm compose và bot)                 | `web-service`, `compose-app`, `discord-bot`      |
| T1.9 | `knowledge-misc`                                                        | `awesome-list`                                   |

**T1.10 [S] Ghép classifier và báo cáo.**  
Phụ thuộc: T1.1–T1.9. Được sửa: `common/packages/repoClassifier.ts`, `process/extensions/package-manager/repoPackaging/{chatRunner,report,types}.ts`, `repoSources/releases.ts` (mới), `tests/unit/package-manager/repoPackaging/*.test.ts`, `tests/unit/chat/repoToPackageTurn.test.ts`.  
Việc: `classifyRepository` chạy `detectAll`, gộp, chọn nhãn archetype (mục 7.5), giữ đầu ra manifest cũ cho web/theme; báo cáo liệt kê kết nối theo plugin, openItem, số liệu tiêu chí C2; bước tra Releases (7.4) sau cờ.  
Chấp nhận: mọi test cũ pass (hoặc được cập nhật có lý do ghi trong bàn giao); e2e checklist trên danh sách URL thật cho thấy context7 có MCP (http + npx cùng nhóm), skill, CLI, rules.

### 18.5 Đợt 2: host dữ liệu và bề mặt chính

| ID       | Loại                                    | Phụ thuộc       | Được sửa (chính)                                                                                                                                                                                                                                                                                                                              | Chấp nhận                                                                                                                          |
| -------- | --------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| T2.1 [S] | Host `skill`                            | T0.7            | `connections/hosts/data/skillHost.ts` (mới), `process/resources/nativePlatform/skillCatalog.ts` (nguồn gốc gói), `process/extensions/package-manager/repoPackaging/skillInstall.ts`                                                                                                                                                           | Bật/tắt/gỡ đúng; skill trùng tên của người dùng không bị ghi đè (mục 10.1); `reconcile` gỡ skill mồ côi                            |
| T2.2 [S] | Host `mcp` (stdio + http/sse, `group`)  | T0.7            | `connections/hosts/exec/mcpHost.ts` (mới), `process/resources/mcpRegistry/packageMcpSync.ts`                                                                                                                                                                                                                                                  | Mục 10.2; header lấy từ kho bí mật trong Main (test không lộ giá trị ra renderer); bật một phương án tắt phương án khác            |
| T2.3 [I] | Host `command` + bảng `/` + mở rộng mẫu | T0.7            | `connections/hosts/data/commandHost.ts` (mới), `common/chat/slash/types.ts` (nguồn `package`), IPC `conversation.native.packageCommands` (`common/adapter/ipcBridge.ts`, preload), `process/services/database/nativeConversation/bridge.ts` (mở rộng mẫu), `renderer/utils/chat/commandPalette.ts`, `renderer/hooks/chat/useSlashCommands.ts` | `$ARGUMENTS`, `$1`…`$9`, `{{args}}`; bong bóng giữ nguyên dòng người gõ; `` !`cmd` `` không chạy; lệnh trùng tên có tiền tố plugin |
| T2.4 [S] | Host `agent`                            | T0.7            | `connections/hosts/data/agentHost.ts` (mới), `common/types/agent/assistantTypes.ts` (`source: 'package'`), `process/resources/assistantCatalogStore.ts`                                                                                                                                                                                       | Mục 10.4; chỉ đọc; nhân bản sửa được; gỡ không xóa bản nhân bản                                                                    |
| T2.5 [S] | Giá trị biến (openItem `env-value`)     | T0.7            | `connections/core/envValues.ts` (mới), `renderer/pages/hub/StoreProductDetail/PackageSecretsSection.tsx`                                                                                                                                                                                                                                      | Điền biến bằng kho bí mật của gói; trạng thái `needs-input` tự hết khi đủ biến bắt buộc                                            |
| T2.6 [S] | S4 chi tiết gói → Kết nối + hộp duyệt   | T0.7, T2.1–T2.5 | `renderer/pages/hub/StoreProductDetail/connections/` (mới), `renderer/styles/tomni-ui.css`, các tệp locale                                                                                                                                                                                                                                    | Hộp duyệt hiện đúng `describe`; mọi chuỗi qua i18n; test DOM                                                                       |
| T2.7 [S] | S1 Đã cài + S3 Thêm từ GitHub           | T0.7, T1.10     | `renderer/pages/integrations/store/` (mới), điểm gắn trong `renderer/pages/hub/HubWorkspacePage.tsx`; IPC đã có schema từ T0.7; IPC chạy `/repotopackage` ngoài chat do Integrator thêm                                                                                                                                                       | Bộ lọc; nhãn "Tạo trên máy này"; tiến độ thật; mở chi tiết gói sau khi xong                                                        |
| T2.8 [S] | Cập nhật từ nguồn (mục 9.5)             | T0.5, T0.7      | `repoSources/update.ts` (mới); gọi `PackageManagerService` qua API do T0.4 và T0.7 mở, không sửa tệp đó                                                                                                                                                                                                                                       | Test diff đủ bốn trường hợp; tiêu chí C6                                                                                           |

### 18.6 Đợt 3: hook

| ID       | Việc                                                                                                        | Phụ thuộc  | Được sửa (chính)                                                                                                                                                                                                                                                                            | Chấp nhận                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T3.1 [S] | `HookRunner`: exec/shell, ánh xạ trình thông dịch, môi trường tối thiểu, timeout, diệt cây, giới hạn đầu ra | T0.6       | `hooks/hookRunner.ts` (mới)                                                                                                                                                                                                                                                                 | Test với tiến trình con thật (script Node chạy bằng `process.execPath`): exit 0/2/khác, hết giờ diệt được cả cháu, môi trường không có biến bí mật đặt sẵn trong test                                                                                                                                                                                                                                                                                                                                                                                          |
| T3.2 [S] | `HookRegistry`: ba nguồn, duyệt và ghim, công tắc, nhật ký, giới hạn đồng thời                              | T0.6, T3.1 | `hooks/hookRegistry.ts`, `hooks/hookAudit.ts` (mới)                                                                                                                                                                                                                                         | Đổi nội dung script làm hook tự tắt; công tắc tổng có hiệu lực ngay                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| T3.3 [I] | Gắn sự kiện vào runtime                                                                                     | T3.2, S-1  | `process/experimentalCore/experimentalCoreRuntime.ts`, `process/experimentalCore/adapters/tomnyCoreAdapter.ts`, `process/services/database/nativeConversation/service.ts`, `process/services/chatPipeline/stages/userHooksStage.ts` (mới), `process/services/chatPipeline/stageRegistry.ts` | Test tích hợp ở 17.2 cho `PreToolUse`, `UserPromptSubmit`, `Stop` (tối đa 3 lần), `PostToolUse`. Vị trí chốt từ S-1: `PreToolUse` native chèn giữa `tool-call requested` (T:1735) và preflight skill (T:1736) của `tomnyCoreAdapter.ts`, chuyển nhánh sau thành hàm async có kiểm tra `runtime.pending !== pending`; `ask` truyền `forceFresh=true` vào `requestPermission`; adapter khác: đầu `ExperimentalCoreRuntime.requestPermission`; `PostToolUse` trong `pushAdapterEvent`; `Stop` bọc `adapter.run` trong vòng lặp, chỉ phát `completed` sau vòng lặp |
| T3.4 [S] | Host `hook`                                                                                                 | T0.7, T3.2 | `connections/hosts/exec/hookHost.ts` (mới)                                                                                                                                                                                                                                                  | Bật cần duyệt; dạng shell của gói không bật được; sự kiện chưa hỗ trợ thành `unsupported`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| T3.5 [S] | S10 Cài đặt → Hooks                                                                                         | T3.2       | `renderer/pages/integrations/hooks/` (mới), liên kết từ Cài đặt, `tomni-ui.css`, locale                                                                                                                                                                                                     | Tạo, duyệt, tắt, xem nhật ký; test DOM                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### 18.7 Đợt 4: extension Browser

| ID       | Việc                                                                                                                                       | Phụ thuộc  | Được sửa (chính)                                                                                                                                                                                                                                                                  | Chấp nhận                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| T4.1 [I] | Hồ sơ duyệt web, chép cookie một lần, bộ xử lý quyền web                                                                                   | S-4        | `process/browser/browserViewManager.ts`, `process/browser/browserBridge.ts`, `process/services/contentExtract/youtubeCookies.ts`, `browserExtensions/profile.ts` (mới); entry build rỗng cho preload của extension trong `packages/desktop/electron.vite.config.ts` (dùng ở T4.3) | Tab mới ở `persist:tomny-browser`; chép cookie chạy đúng một lần; quyền web hỏi theo origin; cửa sổ Hub vẫn ở phiên mặc định                                              |
| T4.2 [S] | Host extension: nạp, gỡ, nạp lại khi khởi động, lỗi                                                                                        | T4.1, T0.7 | `browserExtensions/{host,store,workingCopy}.ts` (mới), `connections/hosts/exec/extensionHost.ts` (mới)                                                                                                                                                                            | Nạp extension fixture đã build; tắt thì gỡ; khởi động lại thì nạp lại; lỗi hiện ở trạng thái kết nối; ID và `storage` giữ nguyên sau khi cập nhật phiên bản gói           |
| T4.3 [S] | Phần bù API (mục 12.3), từng nhóm API một lần bàn giao                                                                                     | S-2, T4.2  | `browserExtensions/api/*.ts`, `browserExtensions/preload/*.ts` (mới); entry build đã có từ T4.1                                                                                                                                                                                   | Mỗi API có test router (id lấy từ origin, quyền chưa duyệt bị từ chối) và một spec e2e Playwright với extension fixture gọi thử                                           |
| T4.4 [S] | Userscript thành extension sinh ra                                                                                                         | T4.2       | `browserExtensions/userscript/*.ts` (mới)                                                                                                                                                                                                                                         | `@match`, `@run-at`, `@grant`, `GM_*` v1; `@require` mạng bị từ chối                                                                                                      |
| T4.5 [S] | S5 dải tiện ích ở header chung (`ExtensionHeaderStrip`): biểu tượng ghim, nút 🧩, popup, quyền truy cập trang, lọc theo surface (mục 12.5) | S-5, T4.2  | `renderer/components/layout/Titlebar/extensions/` (mới), `common/integrations/extensions/surface.ts` (mới, thuần), schema adapter (`surface`), locale, CSS                                                                                                                        | Bốn quy tắc 12.5 có test; popup mở/đóng; badge cập nhật; ba mức truy cập trang                                                                                            |
| T4.6 [S] | S2 tab Tiện ích + S5 dải tiện ích ở header (T4.5 dựng dải, T4.6 dựng tab)                                                                  | T4.2, T2.6 | `renderer/pages/integrations/store/` (tab Tiện ích), `renderer/pages/integrations/extensions/`                                                                                                                                                                                    | Tab Tiện ích: danh sách, thêm từ GitHub/thư mục/`.crx`/Chrome Web Store, bật, quyền trang, ghim, gỡ, lỗi; mockup và design system cập nhật                                | Thêm, ghim, gỡ chạy được; "Quản lý tiện ích" từ popup mở đúng tab |
| T4.7 [S] | Nguồn cài: thư mục, `.crx`/`.zip` (gồm bộ kiểm CRX3 của mục 12.6)                                                                          | T4.2, T2.7 | `repoSources/{folder,crx}.ts` (mới)                                                                                                                                                                                                                                               | Mọi nguồn ra gói `local-built` và đi qua cùng đường cài; `.crx` sai chữ ký bị từ chối `CRX_INVALID`                                                                       |
| T4.8 [S] | Công cụ agent `browser_extension_list`, `browser_extension_action`                                                                         | T4.3       | `process/browser/browserControlServer.ts` (thêm công cụ)                                                                                                                                                                                                                          | Đi qua quyền như công cụ Browser khác                                                                                                                                     |
| T4.9 [S] | Nguồn Chrome Web Store (mục 12.6)                                                                                                          | T4.7, S-6  | `repoSources/chromeWebStore.ts` (mới), dùng bộ kiểm CRX3 của T4.7                                                                                                                                                                                                                 | Chỉ tải qua host cho phép; CRX3 sai ID hoặc sai chữ ký bị từ chối; ID sau khi nạp trùng ID trên Web Store; kiểm bản mới khi bấm; cờ `chromeWebStoreSource` tắt được nguồn |

### 18.8 Đợt 5: runtime tiến trình và app

| ID       | Việc                                                                             | Phụ thuộc  | Được sửa (chính)                                                                                                                                                                      | Chấp nhận                                                                                                              |
| -------- | -------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| T5.1 [S] | `RepoProcessEndpoint` trên `PersistentContributionSupervisor` (mục 13)           | T0.7       | `runtime/repoProcessEndpoint.ts` (mới), dùng `PersistentContributionSupervisor` có sẵn                                                                                                | Thứ tự dịch vụ, chờ cổng, `PORT_IN_USE`, khởi động lại có giới hạn, diệt cây khi tắt                                   |
| T5.2 [S] | `runtimeProbe` (Node qua Electron, Python, uv, Git, Git Bash, Docker, Cargo, Go) | T0.7       | `connections/core/runtimeProbe.ts` (mới)                                                                                                                                              | Kết quả có cache; lý do thiếu bằng lời người đọc được                                                                  |
| T5.3 [I] | Host `web-embed` (process và url) + S13 Apps + IPC mở app theo id                | T5.1, T4.1 | `connections/hosts/exec/webEmbedHost.ts` (mới), `process/browser/browserBridge.ts` (IPC mở app theo id), danh sách app (`renderer/pages/hub/installedPackageApps.ts`)                 | Renderer không chọn được phân vùng; điều hướng ngoài `origins` mở tab thường; MediSign chạy được từ đầu đến cuối (e2e) |
| T5.4 [S] | Host `cli` + `tool` + S14 menu Terminal + S15 + công cụ `tomny_package_cli`      | T5.2       | `connections/hosts/exec/cliHost.ts` (mới), `renderer/pages/guid/shell/HubShell.tsx` (menu), `process/agentRuntime/agentMesh/mcp/coreWorkspaceServer.ts` (công cụ `tomny_package_cli`) | Terminal điền sẵn lệnh không chạy; công cụ agent kiểm token đối số, timeout, hỏi quyền                                 |
| T5.5 [S] | Host `service` + S17 Active                                                      | T5.1       | `connections/hosts/exec/serviceHost.ts` (mới)                                                                                                                                         | Cần `needs-consent`; không tự chạy khi khởi động Hub                                                                   |
| T5.6 [S] | Host `launcher` (dò app đã cài, gắn đường dẫn, Releases, compose)                | T5.2       | `connections/hosts/exec/launcherHost.ts`, `runtime/installedAppProbe.ts` (mới)                                                                                                        | Dò thấy một app cài sẵn trên máy thử; không thấy thì hiện nút chọn tệp và link tải                                     |
| T5.7 [S] | `mcp` từ mã nguồn và `.mcpb` qua runtime                                         | T5.1, T2.2 | `connections/hosts/exec/mcpHost.ts`                                                                                                                                                   | MCP Node từ nguồn chạy được không cần Node cài sẵn                                                                     |

### 18.9 Đợt 6: Thư viện và trình xem tệp

| ID       | Việc                                                                         | Phụ thuộc  | Được sửa (chính)                                                                                                                                  | Chấp nhận                                                      |
| -------- | ---------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| T6.1 [S] | S12 trình xem tệp ở trung tâm; Explorer mở vào đây                           | không      | `renderer/pages/integrations/fileViewer/` (mới), route, `process/resources/explorer/explorerBootstrap.ts` (thêm "mở trong Hub" bên cạnh mở ngoài) | Văn bản, Markdown, mã, ảnh, PDF; đường dẫn do Main xác thực    |
| T6.2 [S] | S11 Thư viện: lưu đường dẫn, tệp mất, Back về Thư viện                       | T6.1       | `library/` (mới), `renderer/pages/integrations/library/` (mới), mục sidebar trong `renderer/pages/guid/HubHome/HubSidebar.tsx`                    | Không sao chép tệp; tệp mất hiện "không còn ở đây" và chọn lại |
| T6.3 [S] | Host `rules` và `knowledge`; gắn rules vào workspace; `tomny_library_search` | T6.2, T0.7 | `connections/hosts/data/{rulesHost,knowledgeHost}.ts` (mới), `process/agentRuntime/contextComposer.ts` (khối rules)                               | Rules chỉ vào workspace đã gắn, ≤ 16 KB, qua kiểm tra đầu ra   |

### 18.10 Đợt 7: sau v1

Extension VS Code dạng khai báo (`vscode`), engine workflow, hỏi đáp có trích dẫn trên Thư viện, `http`/`prompt`/`agent` hook, chuyển hook sang cấu hình của CLI, chạy hook và tiến trình trong sandbox, kiểm bản mới định kỳ.

### 18.11 Đồ thị phụ thuộc

```text
S-1..S-6 ─────────────────────────────────────────────┐
T0.1 ─┬─ T0.2 ─┬─ T1.1..T1.9 ─ T1.10 ─ T2.7            │
      │        │                                       │
      ├─ T0.3 ─┘                                       │
      ├─ T0.4 ─ T0.7 ─┬─ T2.1..T2.5 ─ T2.6             │
      │               ├─ T2.8 (cần T0.5)               │
      │               ├─ T3.4, T4.2, T5.1, T5.2        │
      ├─ T0.5                                          │
T0.6 ─┴─ T1.1, T1.5, T3.1 ─ T3.2 ─ T3.3 (cần S-1) ─ T3.5
T4.1 (cần S-4) ─ T4.2 ─ T4.3 (cần S-2) ─ T4.8
                 ├─ T4.4, T4.5 (cần S-5), T4.6, T4.7 ─ T4.9 (cần S-6)
T5.1 ─ T5.3 (cần T4.1), T5.5, T5.7 ; T5.2 ─ T5.4, T5.6
T6.1 ─ T6.2 ─ T6.3
```

Có thể chạy song song ngay sau đợt 0: các task detector (đợt 1), T3.1, T6.1, và các spike.

### 18.12 Định nghĩa xong của mỗi task

1. Chỉ sửa tệp trong "Được sửa"; `git status --short` trước và sau được dán vào bàn giao.
2. Test của task pass; cổng chung pass trên các tệp đã sửa (lệnh và mã thoát dán vào bàn giao).
3. Mọi đường thực thi mới nêu đủ bảy điểm ở mục 15.1.
4. Không còn chuỗi giao diện ngoài i18n; không còn CSS ngoài `tomni-ui.css`.
5. Bàn giao đề xuất nhãn trạng thái mới cho mục tương ứng, kèm đường dẫn mã và test; Integrator ghi vào tài liệu này.
6. Bàn giao nêu: tệp đã đổi, lệnh và mã thoát, rủi ro còn lại, cách quay lại, xung đột, các đường dẫn bẩn không liên quan.

### 18.13 Phân công mô hình (người dùng chốt 2026-10-09)

Người dùng dùng hai mô hình: **Sonnet 5.5** cho task khó, **ChatGPT 5.6 Tera** cho task phổ thông. Agent không phải Claude cũng theo đúng [AGENTS.md](../../AGENTS.md) (là nguồn quy tắc chung; `CLAUDE.md` chỉ trỏ tới đó) và tài liệu này.

Một task là **khó** khi có ít nhất một dấu hiệu sau. Còn lại là **phổ thông**.

1. Đụng ranh giới an toàn: tin cậy, chữ ký, bí mật, quyền, egress, phân vùng phiên, IPC.
2. Quản lý tiến trình hay hệ điều hành: spawn, timeout, diệt cây tiến trình, cổng, preload.
3. Phân tích định dạng nhị phân hoặc giao thức: CRX3, protobuf, giao thức sidecar.
4. Là hợp đồng chung mà nhiều task khác phụ thuộc, sai thì lan rộng.
5. Sửa chỗ nối chung mà phiên khác cũng sửa (task [I]).

| Mức       | Mô hình          | Task                                                                                                                                                                                         |
| --------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Khó       | Sonnet 5.5       | Spike S-1…S-6; T0.1, T0.2, T0.4 [I], T0.5, T0.6, T0.7 [I]; T1.1, T1.2, T1.10; T2.2, T2.3 [I], T2.8; T3.1, T3.2, T3.3 [I]; T4.1 [I], T4.2, T4.3, T4.4, T4.7, T4.9; T5.1, T5.3 [I], T5.4; T6.3 |
| Phổ thông | ChatGPT 5.6 Tera | T0.3; T1.3–T1.9; T2.1, T2.4, T2.5, T2.6, T2.7; T3.4, T3.5; T4.5, T4.6, T4.8; T5.2, T5.5, T5.6, T5.7; T6.1, T6.2                                                                              |

Quy tắc đi kèm:

- **Duyệt chéo trước khi nhận.** Task khó do Sonnet 5.5 làm thì ChatGPT 5.6 Tera đọc lại diff và bàn giao, và ngược lại. Người duyệt chỉ đối chiếu với tiêu chí "Chấp nhận" của task, mục 15 (an toàn) và mục 18.12; không viết lại mã. Mọi phát hiện ghi vào bàn giao.
- **Task phổ thông có đụng dữ liệu nhạy cảm** (T2.5 với kho bí mật, T5.7 với runtime tiến trình) thì người duyệt chéo bắt buộc là Sonnet 5.5.
- **Task [I]** do agent đang giữ vai Integrator làm, dùng Sonnet 5.5.
- **Task nào lớn hơn dự kiến** (đụng thêm một dấu hiệu "khó" ở trên khi đang làm) thì dừng, báo lại, và chuyển lên Sonnet 5.5. Không hạ mức giữa chừng.
- Bàn giao ghi rõ mô hình đã làm và mô hình đã duyệt.

### 18.14 Chạy song song: lane, số tab và prompt

**Số tab.** Tối đa **4 tab chạy cùng lúc** (AGENTS.md mục 8: 1 Integrator + 3 agent con; máy phát triển còn hạn chế RAM và ổ C). Lúc đầu **3 tab Claude Code + 1 tab Codex**, vì đợt 0 gần như toàn task khó. Khi lane K2 hết hàng đợi thì đóng nó và mở lane P2 (thành 2 + 2). Khi K1 hết hàng đợi thì đóng nó và mở K3 (vẫn 2 + 2).

| Lane           | Công cụ, mô hình        | Hàng đợi (theo thứ tự)                                                                                                                                        | Mở khi              |
| -------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| I (Integrator) | Claude Code, Sonnet 5.5 | T0.4 → T0.7 → T2.3 → T3.3 → T4.1 → T5.3; xuyên suốt: nhận bàn giao, chạy lại kiểm tra, đăng ký route, i18n, IPC mà task [S] đề xuất, cập nhật nhãn trạng thái | Ngay                |
| K1             | Claude Code, Sonnet 5.5 | T0.1 → T0.2 → T0.5 → T1.1 → T1.2 → T1.10 → T2.2 → T2.8                                                                                                        | Ngay                |
| K2             | Claude Code, Sonnet 5.5 | T0.6 → S-1 → S-2 → S-3 → S-4 → S-5 → S-6 → T3.1 → T3.2                                                                                                        | Ngay                |
| P1             | Codex, ChatGPT 5.6 Tera | T0.3 → T1.3 → T1.4 → T1.5 → T1.6 → T1.7 → T1.8 → T1.9 → T2.1 → T2.4 → T2.5 → T3.4 → T5.2 → T4.8 → T5.5 → T5.6 → T5.7                                          | Ngay                |
| P2             | Codex, ChatGPT 5.6 Tera | T6.1 → T2.6 → T2.7 → T3.5 → T4.5 → T4.6 → T6.2                                                                                                                | Khi K2 hết hàng đợi |
| K3             | Claude Code, Sonnet 5.5 | T4.2 → T4.3 → T4.4 → T4.7 → T4.9 → T5.1 → T5.4 → T6.3                                                                                                         | Khi K1 hết hàng đợi |

**Khởi động** (T0.4 và T0.3 đều cần T0.1): (1) mở K1 làm T0.1 và K2 làm T0.6; (2) mở tab Integrator, trong lúc chờ T0.1 thì chỉ đọc mã và lập kế hoạch cho T0.4, chưa sửa tệp; (3) khi Integrator nhận T0.1 thì bắt đầu T0.4, đồng thời mở tab Codex P1 làm T0.3.

**Quy tắc cho lane:**

1. Mỗi task một cuộc trò chuyện mới (Claude Code: `/clear`; Codex: chat mới). Không làm hai task trong một cuộc.
2. Task kế tiếp chưa đủ phụ thuộc (mục 18.11) thì lấy task kế tiếp trong hàng đợi của mình đã đủ điều kiện; không có thì chờ. Không làm task của lane khác.
3. Chỉ sửa tệp trong cột "Được sửa" của task. Hai lane không bao giờ sửa cùng một tệp; thấy tệp mình cần đang bị lane khác sửa (qua `git status` hoặc `mtui diff`) thì dừng và báo Integrator.
4. Không sửa tài liệu này; nhãn trạng thái do Integrator ghi từ bàn giao.
5. Chuỗi giao diện: mỗi task giao diện dùng một namespace i18n riêng (tên đề xuất trong bàn giao, Integrator đăng ký trong `i18n-config.json`). CSS: chỉ lane P2 sửa `renderer/styles/tomni-ui.css`, mỗi task một khối có chú thích mở và đóng ghi ID task.
6. Kiểm tra: test theo đường dẫn của task, `npx oxlint` và `npx oxfmt --check` trên tệp đã sửa; `npx tsc --noEmit -p packages/desktop` chạy **một lần ở cuối task** (nặng, không chạy liên tục).
7. Xong task thì dừng và trả bàn giao theo mục 18.12; không tự chuyển sang task sau.

**Luồng một task:** lane làm task → bàn giao được dán sang một cuộc trò chuyện ngắn của mô hình kia để duyệt chéo (prompt "Duyệt chéo" bên dưới; với lane Claude thì duyệt ở Codex và ngược lại; không tính là tab thêm) → dán bàn giao và kết quả duyệt vào tab Integrator → Integrator chạy lại kiểm tra, nhận hoặc trả lại, cập nhật nhãn trạng thái → lane mở cuộc trò chuyện mới cho task kế tiếp.

**Prompt cho tab Integrator** (dán một lần; tab này giữ suốt quá trình, mỗi task [I] vẫn nên `/clear` rồi dán lại):

```text
Bạn là Integrator của tính năng /repotopackage v2 trong repo C:\NDT\PJ\TomniHubOS (AGENTS.md mục 8).
Đọc AGENTS.md rồi docs/platform/repotopackage-design.md (đặc biệt mục 0, 3, 4, 9, 18).
Việc của bạn:
1. Làm các task [I] theo hàng đợi lane I ở mục 18.14. Task hiện tại: T0.4.
2. Khi tôi dán bàn giao (kèm kết quả duyệt chéo) của một lane: kiểm tệp đã sửa đúng cột "Được sửa", chạy lại test của task và tsc toàn dự án, xử lý phát hiện của người duyệt; nhận thì cập nhật nhãn trạng thái trong tài liệu thiết kế, không nhận thì nêu rõ cần sửa gì.
3. Đăng ký route, namespace i18n, kênh IPC mà task [S] đề xuất.
Quy tắc: mọi ghi tệp qua packages/mtui/target/debug/mtui.exe; cây làm việc bẩn, không git stash, không sửa ngoài phạm vi; không commit trừ khi tôi bảo.
```

**Prompt cho tab lane** (thay `<LANE>` và `<TASK>`; mỗi task một cuộc trò chuyện mới):

```text
Bạn là lane <LANE> của tính năng /repotopackage v2 trong repo C:\NDT\PJ\TomniHubOS.
Đọc AGENTS.md, rồi docs/platform/repotopackage-design.md mục 0, 4.1, 18.1, 18.12, 18.13, 18.14 và mục của task <TASK> (cùng các mục nó dẫn tới).
Làm đúng task <TASK>, theo "Quy tắc cho lane" ở mục 18.14.
Mọi ghi tệp trong repo qua packages/mtui/target/debug/mtui.exe; tệp tạm dưới .tmp/<TASK>/.
Xong thì dừng và trả bàn giao theo mục 18.12, ghi rõ mô hình đã làm. Không commit, không sửa tài liệu thiết kế, không tự chuyển sang task khác.
```

**Prompt duyệt chéo** (cuộc trò chuyện ngắn ở mô hình còn lại):

```text
Duyệt chéo task <TASK> của tính năng /repotopackage v2 trong repo C:\NDT\PJ\TomniHubOS.
Đọc AGENTS.md và docs/platform/repotopackage-design.md mục 15, 18.12, 18.13 và mục của task <TASK>.
Không sửa tệp nào. Đọc diff thật (git diff, mtui diff) chứ không chỉ tin bàn giao. Kiểm:
- chỉ sửa tệp trong cột "Được sửa";
- đủ mọi tiêu chí "Chấp nhận" của task, có lệnh và mã thoát làm bằng chứng;
- với đường thực thi mới: đủ bảy điểm ở mục 15.1;
- test kiểm cả trường hợp xấu, không chỉ đường thuận.
Trả danh sách phát hiện xếp theo mức nặng, mỗi phát hiện có tệp:dòng và tình huống lỗi cụ thể; không có thì ghi "không có phát hiện".
Bàn giao của lane:
<dán bàn giao>
```

## 18.15 Trạng thái thực hiện (cập nhật 2026-10-09)

Chỉ Integrator sửa mục này. Đã xong nghĩa là Integrator tự chạy lại test, lint, định dạng và kiểu. Thứ tự làm: **task khó trước, task phổ thông để lane khác** (người dùng chốt 2026-10-09 vì hạn chế token).

| Đơn vị                                   | Mức     | Trạng thái                                                | Bằng chứng                                                                                                                                                                                                                |
| ---------------------------------------- | ------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1                                      | Khó     | Xong                                                      | Kết quả đã ghi vào mục 11.3 và 11.5                                                                                                                                                                                       |
| T0.1 schema adapter                      | Khó     | Xong                                                      | `common/packages/adapter/`, `tests/unit/package-manager/adapter*.test.ts` (110 test cùng remoteCatalog)                                                                                                                   |
| T0.6 hợp đồng hook                       | Khó     | Xong                                                      | `common/integrations/hooks/`, `tests/unit/integrations/hooks/` (142 test)                                                                                                                                                 |
| T0.4 `local-built` và trạng thái kết nối | Khó [I] | Xong phần lõi                                             | `PackageManagerService.registerLocalPackage`, `connections/core/state.ts`, `tests/unit/integrations/connections/{localBuilt,state}.test.ts` (17 test); đấu nối vào `packageBridge` nằm ở T0.8                             |
| T0.7 sổ đăng ký host và duyệt            | Khó [I] | Xong phần lõi                                             | `connections/core/{types,approval,registry}.ts`, `registry.test.ts` (13 test); IPC nằm ở T0.8                                                                                                                             |
| T0.2, T0.5, T3.1, T1.1, T1.2, T3.2, T4.1 | Khó     | Xong (Integrator đã chạy lại test, lint, định dạng, kiểu) | `detectors/`, `hooks/hookRegistry*`, `browserExtensions/profile.ts`. Còn: khe TOCTOU trước spawn (T3.3), e2e cookie trên Electron thật (T4.1), đăng ký detector vào `index.ts` (T1.10), Docker MCP bị schema T0.1 từ chối |
| T0.8 đấu nối (mới)                       | Khó [I] | Chưa làm                                                  | Xem bên dưới                                                                                                                                                                                                              |

**T0.8 [I] Đấu nối IPC, dịch vụ và `/repotopackage`.** Phụ thuộc: T0.4, T0.7, T0.5. Được sửa: `process/extensions/package-manager/packageBridge.ts` (truyền `localTrustedKeys` lấy từ khóa ký cục bộ, ID khóa phải bắt đầu `local:`; tạo `ConnectionRegistry` singleton với `createJsonConnectionStateStore(<userData>/connections.json)`; sau cài, cập nhật và gỡ gói thì gọi `syncPackage` hoặc `removePackage`; gọi `reconcile()` lúc khởi động), `process/integrations/connections/ipc/connectionBridge.ts` (mới; theo mẫu `packageSecretAccessBridge.ts`: `ipcMain.handle`, `verifySender`, schema zod chặt, hộp xác nhận native cho loại chạy mã, mã lỗi ổn định), `preload/main.ts` và `common/types/platform/electron.ts` (khai báo `packageConnections`), `process/services/database/nativeConversation/repoPackagingTurn.ts` (sau khi đóng gói: giải nén vào thư mục tạm của Main, `registerLocalPackage`, `install`, `syncPackage`). Chấp nhận: `/repotopackage` trên một repo mẫu ra gói xuất hiện ở danh sách đã cài với trust `local-built`; bật một kết nối từ renderer cần `approvalHash` đúng; renderer không truyền được đường dẫn gói; khởi động lại giữ trạng thái; gỡ gói gỡ sạch kết nối. Các tệp này đang bị phiên khác sửa dở: chỉ chèn khối của mình, đọc `git diff` trước.

**Xong thêm sau lần ghi đầu (Integrator đã tự chạy lại):**

- T3.1 bộ chạy hook: `process/integrations/hooks/*`, `hookRunner.test.ts` (42 test; cả thư mục `tests/unit/integrations` 312 test pass). Cần T3.2 kiểm lại hash script lúc chạy (TOCTOU), và Integrator cần biết PowerShell chạy với `-ExecutionPolicy Bypass` chỉ trong tiến trình hook.
- T0.5 packager ghi theo luồng, kiểm đĩa, nguồn gốc: `repoPackaging/streaming/*`, `streaming.test.ts` (234 test cùng các test cũ pass). **Quyết định mở:** trần 200 MiB của `manifest.ts` (`MAX_ARTIFACT_BYTES`), 4 096 tệp của `packageDownloader.ts` và 20 000 tệp của `artifactSecurity.ts` vẫn chặn gói lớn. AGENTS.md mục 6 cấm nới kiểm tra kích thước lưu trữ để tích hợp qua, nên giữ nguyên; packager báo `PAYLOAD_TOO_LARGE` kèm gợi ý dùng thư mục con. Còn thiếu: ghi `result.provenance` vào `adapter.json` (đưa vào T0.8).
- Spike S-2 đến S-6: kết quả ở mục 12.8. Spike S-5 còn thiếu phép đo click thật ra ngoài popup.

**Thứ tự khó trước còn lại:** T0.8 → T1.10 → T2.2, T2.3, T2.8 → T3.3 → T4.2, T4.3, T4.4, T4.7, T4.9 → T5.1, T5.3, T5.4 → T6.3.

**Task phổ thông giao lane khác bất cứ lúc nào** (đã đủ phụ thuộc hoặc chỉ cần T0.1/T0.7 đã xong): T0.3 fixture; T1.3–T1.9 các bộ nhận diện (cần T0.2); T2.1 host skill; T2.4 host agent; T2.5; T3.4 (cần T3.2); T5.2 runtimeProbe. Dùng prompt ở mục 18.14.

### Kiểm chứng bổ sung (2026-10-15; không thay thế nhật ký 2026-10-09)

- **CURRENT — đóng gói nguồn không có runtime:** `repoPackaging/packager.ts` tạo gói không có module chạy hoặc quyền thực thi khi repo không runnable (Python, Rust, MCP chưa phát hành, web chưa build, hoặc không nhận diện được); `source/` vẫn giữ mã đã qua sàng lọc, `adapter/adapter.json` có `needs-runtime`. Bằng chứng: `tests/unit/package-manager/repoPackaging/{build,chat,detectorWiring,mcp}.test.ts`.
- **CURRENT — repo hỗn hợp:** giữ entrypoint web cũ ở gốc gói, đồng thời mang theo mã nguồn và kết nối từ detector dưới `source/` và `adapter/`. Bằng chứng: `tests/unit/package-manager/repoPackaging/detectorWiring.test.ts` (web ở gốc và `dist/`); `tests/unit/integrations/connections/wiring/localFlow.test.ts` (đóng gói → cài local-built → kết nối MCP vẫn tắt).
- **CURRENT — luồng cài máy cục bộ:** `process/integrations/connections/wiring/{localInstall,connectionRuntime}.ts` thực hiện xác minh, cài, đọc adapter và giữ trạng thái off/unsupported; `repoPackagingTurn.ts` gọi cài sau khi build. Bằng chứng: `tests/unit/integrations/connections/wiring/localFlow.test.ts`. Đường nhập skill của chat tránh tự ghi đè skill trùng tên (`repoPackagingTurn.ts`), nhưng chưa chứng minh dọn skill theo gói khi uninstall.
- **PARTIAL — host và bề mặt:** hiện có `mcp`, `extension`, `web-embed` trong `connectionRuntime.ts`; chưa có bằng chứng hoàn chỉnh cho các host còn lại, mọi bề mặt C7, khả năng rollback/gỡ toàn bộ C5, hoặc cập nhật Git C6 trên tất cả loại kết nối. C1 trên bộ fixture và clean-machine install/uninstall cũng chưa đạt đủ bằng chứng; không được công bố RepoToPackage là đã hoàn thành.
- **PARTIAL — kiểm tra release:** `bunx vitest run tests/unit/package-manager/repoPackaging tests/unit/integrations/connections --reporter=dot` đạt 365/365 test (20 file), gồm repo MCP + web chưa build; `bunx tsc --noEmit --pretty false` đã đạt trong cùng phiên làm việc; các tệp được chỉnh của RepoToPackage đã qua `oxfmt --check` và `git diff --check`. Toàn repo `bun run lint` và `bun run format:check` vẫn lỗi ở các vùng không thuộc RepoToPackage (gồm mockup HTML bị thiếu EOF). Chưa có e2e trên ứng dụng Electron thật và không được nâng trạng thái release.

### T2.1 / T2.4 / T2.5 (đợt 2; triển khai 2026-10-15)

- **T2.1 PARTIAL (host đã hoạt động; bước lựa chọn xung đột chờ UI T2.6) — Skill host:** `process/integrations/connections/hosts/data/skillHost.ts`, `resources/nativePlatform/skillCatalog.ts`. Chỉ import sau khi người dùng bật kết nối; lưu cách ly dưới `.tomny-packages/<packageId>/<connectionHash>`; không ghi đè skill người dùng/skill thuộc gói khác; tên xung đột sinh trạng thái `needs-input`; khi tắt/gỡ và `reconcile` chỉ xóa phần package sở hữu. `repoPackagingTurn.ts` không còn nhập skill trực tiếp ngay sau build (khớp C4). Bằng chứng: `tests/unit/integrations/connections/hosts/packageDataHosts.test.ts`.
- **T2.4 CURRENT — Agent host:** `process/integrations/connections/hosts/data/agentHost.ts`, `resources/assistantCatalogStore.ts`, `resources/agentCatalogBridge.ts`, `common/types/agent/assistantTypes.ts`. Agent Markdown trở thành Assistant `source: 'package'` có định danh chủ sở hữu; chỉ đọc, clone thành bản `user` sửa được; tắt/gỡ/reconcile không xóa bản clone. Tool/model chỉ là gợi ý, không cấp quyền công cụ. Bằng chứng: `packageDataHosts.test.ts` (lifecycle, restart, read-only, clone).
- **T2.5 CURRENT (đường Main + Store UI) — env-value:** `connections/core/envValues.ts`, `connections/core/registry.ts` chỉ kiểm tên biến và sự tồn tại của giá trị qua Package Secret Port trong Main; biến không gắn kết nối không chặn các kết nối dữ liệu thuần (Skill/Agent/Command/Rules/Knowledge); thiếu/thu hồi → `needs-input` và tắt kết nối, điền đủ → `off` và có thể duyệt bật lại. `connectionBridge.ts` chỉ trả tên biến, không trả handle hoặc plaintext; `StoreProductDetail/PackageSecretsSection.tsx` hiển thị tên biến thiếu và `SecretSetsPanel.tsx` tạo form bí mật đã điền sẵn tên trường, giá trị chỉ được gửi qua API kho bí mật. Bằng chứng: `packageDataHosts.test.ts`, `tests/unit/renderer/hub/PackageSecretsSection.dom.test.tsx`.
- **Kiểm chứng:** `bunx vitest run tests/unit/integrations/connections tests/unit/package-manager/adapter.test.ts tests/unit/package-manager/repoPackaging tests/unit/chat/repoToPackageTurn.test.ts --reporter=dot` đạt **601/601 test, 35 file** (bao gồm UI Secret Section), `bunx tsc --noEmit --pretty false` đạt; kiểm tra format theo phạm vi đạt. Chưa chứng minh e2e trên Electron thật cho cả 3 task, hoặc lựa chọn GUI _thay thế skill trùng tên_ — hệ thống chủ động giữ skill cũ và báo `needs-input` để không mất dữ liệu. RepoToPackage tổng thể vẫn `PARTIAL`.

### T2.6 / T2.7 (Store UI; triển khai 2026-10-15)

- **T2.6 CURRENT ở mức UI + IPC unit test:** `StoreProductDetail/connections/PackageConnectionsSection.tsx` nối vào trang chi tiết gói đã cài; danh sách theo plugin, trạng thái, nhóm phương án, lý do, tên biến thiếu; hộp duyệt hiển thị nguyên `describe` từ Main và gửi duy nhất `approvalHash` để bật, Main tính lại hash và yêu cầu xác nhận native với kết nối chạy mã. Kiểm thử DOM `tests/unit/renderer/hub/PackageConnectionsSection.dom.test.tsx`. Phần lựa chọn _thay thế skill đã trùng_ theo D17 chưa có chính sách ghi đè an toàn, hiện vẫn ở `needs-input`, không tự thay.
- **T2.7 CURRENT ở mức UI + IPC unit test:** `renderer/pages/integrations/store/StoreControls.tsx` trong Store chính có bộ lọc All / Installed / Updates, nhãn `local-built` ("Tạo trên máy này"), nhập URL GitHub và mở hộp chọn thư mục, tiến độ `onProgress`, báo cáo và nút mở chi tiết. `common/types/platform/repoStore.ts`, `preload/main.ts`, `connections/ipc/{repoStoreBridge,connectionBootstrap}.ts` cung cấp IPC Main kiểm người gửi, schema chặt, chỉ nhận nguồn GitHub HTTPS, đường dẫn folder phải từ native picker; Main tự ký và cài artifact từ kết quả packager, không auto-enable. Bằng chứng: `tests/unit/integrations/connections/ipc/repoStoreBridge.test.ts`, `tests/unit/renderer/hub/StoreControls.dom.test.tsx`.
- **Kiểm chứng:** 23/23 test đạt trong 5 file IPC và UI liên quan; `bunx tsc --noEmit --pretty false` đạt. Chưa chạy Electron E2E cho quy trình GitHub → đóng gói → cài trên máy sạch; cập nhật Git theo T2.8 không phải phần của T2.7. Không công bố release-ready chỉ từ test đơn vị.

### T5.6 / T5.7 (Launcher và MCP source/.mcpb; triển khai 2026-10-15)

- **T5.6 PARTIAL — Launcher host đã hoạt động cho app cài sẵn:** `process/integrations/connections/hosts/exec/launcherHost.ts`, `integrations/runtime/{installedAppProbe,launcherBindings}.ts`, `connections/ipc/{launcherBridge,connectionBootstrap}.ts`. Dò executable trên PATH, Windows App Paths, Start Menu shortcut và thư mục thường gặp; chỉ gợi ý, không tự chọn. Liên kết executable phải qua native picker của Main, xác minh tên và `realpath`, ghi theo máy vào `launcher-bindings.json`; khi tắt giữ liên kết, gỡ package hoặc xóa connection sẽ prune. Main chỉ `spawn` sau khi kết nối đã bật qua quyền duyệt riêng và người dùng bấm **Mở ứng dụng**; IPC chỉ nhận packageId/connectionId, không nhận path. UI chi tiết gói có Chọn tệp / Trang tải / Mở ứng dụng. Bằng chứng: `tests/unit/integrations/connections/{launcherHost,launcherBridge}.test.ts`, `tests/unit/renderer/hub/PackageConnectionsSection.dom.test.tsx`. **Còn thiếu:** host thực thi `launcher.source` và Compose; các kiểu này hiện trả `unsupported`, không âm thầm chạy Docker hoặc mã nguồn. Chưa có Electron E2E xác minh picker/app thật.
- **T5.7 PARTIAL → CURRENT đường stdio Node từ source và MCPB đã build:** `integrations/runtime/mcpSourceRuntime.ts` kiểm `cwd` và entry bằng `realpath` trong package; source `node` được ánh xạ sang Electron `process.execPath` với `ELECTRON_RUN_AS_NODE=1`; setup của gói chỉ chạy sau khi duyệt, không thừa kế secret từ tiến trình Hub, có timeout và marker theo version/recipe. `mcpHost.ts` đăng ký server đã bật vào MCP catalog với `cwd`/script tuyệt đối; `common/config/storage.ts`, `packageMcpLaunch.ts`, các core adapter nhận `cwd`; native MCP driver truyền môi trường hệ thống tối thiểu. Bằng chứng: `tests/unit/integrations/connections/{mcpSourceRuntime,mcpSourceHost}.test.ts`, `tests/unit/integrations/connections/hosts/mcpHost.test.ts`, `tests/unit/mcp/packageMcpLaunch.test.ts`. **Còn thiếu:** E2E Electron thật với MCPB tải từ nguồn và MCP qua nhiều adapter; setup bằng các shim Windows `.cmd` / cây tiến trình con chưa được chứng minh release-safe.
- **Kiểm chứng:** `bunx vitest run tests/unit/integrations/connections tests/unit/mcp/packageMcpLaunch.test.ts tests/unit/mcp/nativeMcpBootstrap.test.ts tests/unit/package-manager/adapter.test.ts tests/unit/renderer/hub/PackageConnectionsSection.dom.test.tsx --reporter=dot` đạt **394/394 test, 31 file**; `bunx tsc --noEmit --pretty false` đạt; kiểm tra `oxfmt --check` và `oxlint` cho các module mới đạt. Toàn bộ kiểm tra format/i18n ở một số tệp đã được agent khác sửa đồng thời chưa đạt (không mở rộng phạm vi để sửa các vùng không thuộc task). RepoToPackage **tổng thể vẫn PARTIAL**, không được công bố C5/C6 release-ready từ unit test.

### Kiểm chứng toàn diện theo codebase (2026-10-15, cuối ngày; không dựa vào các dòng trên)

Nguồn: tôi chạy lại trên cây làm việc hiện tại. `tsc --noEmit -p tsconfig.json` ở gốc repo: sạch. `oxfmt --check` trên `process/integrations`, `common/integrations`, `common/packages`, `renderer/pages/integrations`, `tests/unit/integrations` và tài liệu này: sạch. `oxlint` trên `process/integrations`, `common/integrations`: 0 lỗi (6 cảnh báo cũ). Test `tests/unit/{integrations,package-manager,renderer/hub,browser,nativeConversation}` và test dải extension: 2854/2857 pass; 3 test lỗi không thuộc repotopackage (`BrowserPage.dom` thiếu chuỗi `browser.openLinksInApp.description` do thay đổi Browser khác, `browserControlWiringContainment` đọc đường dẫn `packages/package-apps/browser/src/process/browserControlWiring.ts` không còn, `legacyPackageRoutes` do `Router.tsx` đang có tuyến `/realtime`).

| Nhóm                            | Trạng thái  | Ghi chú                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1…S-6, T0.1–T0.8              | CURRENT     | Gồm fixtures T0.3 (10 bộ, mỗi bộ có `expected.adapter.json`).                                                                                                                                                                                                                                                 |
| T1.1–T1.10                      | CURRENT     | Detector hooks, cli-launcher, services, knowledge-misc, gemini đã đăng ký. Hạn chế: awesome-list chỉ nhận `awesome*.md` ở gốc (quyết định giữ, README không được đọc); compose chỉ lấy cổng đầu.                                                                                                              |
| T2.1–T2.8                       | CURRENT     | Kèm `service` `headless` (bot) và `web-embed` loopback `http://127.0.0.1:<port>` chỉ cho `local-built` hoặc gói tự khai báo service (`common/packages/adapter/loopback.ts`).                                                                                                                                  |
| T3.1–T3.5                       | CURRENT     | Hook chỉ siết, hash nội dung được ghim.                                                                                                                                                                                                                                                                       |
| T4.1–T4.4, T4.7, T4.9           | CURRENT     | T4.3 đủ nhóm trừ `tabs.sendMessage` (giữ bản gốc Electron); `downloads.download` bị từ chối vì chưa có đường xác nhận trong API extension.                                                                                                                                                                    |
| T4.5, T4.6                      | CURRENT lõi | Dải extension ở header chung (mục 12.5, 4 quy tắc có test), quyền truy cập trang 3 mức áp cho cả `chrome.*` và `content_scripts`, ghim lưu ở Main, icon từ manifest, gỡ có xác nhận gốc, tab Tiện ích. Chưa có: danh sách trang đã cấp để xóa từng trang, popup/badge trong Browser, nút thêm ngay trong tab. |
| T4.8                            | CURRENT     | `browser_extension_list` (chỉ đọc) và `browser_extension_action`: bật/tắt trả `needs_human_approval`, không bao giờ tự duyệt; `tomny_package_cli` và `tomny_library_search` đã vào danh mục công cụ.                                                                                                          |
| T5.1–T5.7                       | CURRENT     | Launcher cho app cài sẵn; MCP từ source và `.mcpb` cho stdio Node.                                                                                                                                                                                                                                            |
| T6.1–T6.3                       | CURRENT     | Rules và knowledge host, `tomny_library_search`.                                                                                                                                                                                                                                                              |
| Chốt chặn tải xuống của Browser | CURRENT     | `process/integrations/profileDownloadGate.ts`: tạm dừng, hỏi bằng hộp thoại gốc, mặc định hủy, không nhớ. Chưa kiểm `pause()` trên Electron thật.                                                                                                                                                             |
| Thu hồi khóa `local-built`      | CURRENT     | `packages.revokeLocalKey` (chỉ cửa sổ chính, xác nhận gốc), trạng thái `unsigned-revoked` tắt mọi kết nối chạy mã và từ chối bật cho tới khi ký lại và duyệt lại.                                                                                                                                             |
| Nối cuối                        | CURRENT     | `dispose` khi thoát (giới hạn 6 giây), pipeline luôn có `builtin:user-hooks`, loại trùng MCP `package:`/`pkgconn:`, cờ `chromeWebStoreSource` bật mặc định (quyết định 2026-10-15, D14).                                                                                                                      |

**Chưa kiểm trên Electron thật (bắt buộc trước phát hành):** nạp extension và lớp bù `chrome.*`; content script thật sự bị bỏ hoặc nạp theo manifest đã thu hẹp; MediSign đầu–cuối; di chuyển cookie (D15); `redirect: 'manual'` của `net.fetch` ở nguồn Chrome Web Store; `pause()` của chốt tải xuống; PDF trong bản đóng gói; dừng cây tiến trình khi thoát với service thật. Chưa commit.

---

## 19. Câu hỏi đã chốt (2026-10-09)

| ID  | Câu hỏi                                                                       | Quyết định                                      |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| Q1  | Có cài extension từ Chrome Web Store không?                                   | Có, chấp nhận rủi ro điều khoản (D14, mục 12.6) |
| Q2  | Chuyển Browser sang hồ sơ duyệt web riêng dù một số trang phải đăng nhập lại? | Chấp nhận (D15)                                 |
| Q3  | Có chế độ cho hook `allow` thật (bỏ hỏi quyền) không?                         | Không (D16)                                     |
| Q4  | Skill trùng tên: ghi đè hay hỏi?                                              | Hỏi (D17)                                       |
| Q5  | Có kiểm bản mới định kỳ không?                                                | Không, chỉ khi người dùng bấm (D18)             |
| Q6  | Tên "Thư viện" và "Tiện ích"?                                                 | Đồng ý (D19)                                    |

Không còn câu hỏi mở. Câu hỏi mới phát sinh trong lúc làm được ghi vào đây trước khi quyết, kèm task bị ảnh hưởng.

---

## 20. Thuật ngữ

- **Kết nối (connection):** một mục trong `adapter.json`, mô tả một cách Tomny dùng một phần của repo.
- **Host kết nối:** thành phần của Hub cài, bật, tắt, dọn một loại kết nối.
- **Detector:** hàm thuần đọc bản kê và trả kết nối của một hệ sinh thái.
- **openItem:** việc backend không làm xong và giao cho agent hoặc người dùng.
- **`local-built`:** mức tin cậy của gói tạo trên chính máy này bằng khóa cục bộ.
- **Hồ sơ duyệt web:** phân vùng phiên bền `persist:tomny-browser` của Browser, nơi chạy extension.
- **Thư viện:** kho tài liệu của Hub (chỉ lưu đường dẫn); khác gói `com.tomni.knowledge` (Realtime Knowledge) và khác artifact.
