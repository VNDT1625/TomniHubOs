# Tomny Store và Package Runtime MVP — Current-State Audit & Implementation Design

> **Trạng thái:** Thiết kế triển khai sau kiểm kê mã nguồn  
> **Ngày cập nhật:** 2026-07-26  
> **Phạm vi:** đồng nhất WebUI/Desktop, xóa shell UI cũ, Store hoàn chỉnh và package vật lý tải theo nhu cầu  
> **Nguyên tắc:** không rewrite business logic đang hoạt động; Base không được chứa code của app tùy chọn sau khi app đó đã được de-bundle

## 1. Kết luận điều hành

MVP hiện tại mới chứng minh được một phần nhỏ của Package Manager:

- có schema ba loại `app`, `ui`, `agent-capsule`;
- có IPC `list/search/status/install/uninstall` trên Electron;
- có state store atomic trong `userData/tomny-packages`;
- có kiểm tra manifest, compatibility, dependency, integrity và Ed25519;
- có staging/trash recovery và test filesystem.

MVP hiện tại **chưa** đạt trải nghiệm sản phẩm người dùng yêu cầu:

- `/products` chưa phải Store; nó đang hiển thị file Studio gần đây;
- nút Store vẫn mở Agent extensions ở `/settings/agent?market=1&scope=all`;
- Home và sidebar vẫn đọc danh sách app hardcode;
- WebUI không có Package Platform API tương ứng với IPC Desktop;
- chưa có download URL, downloader, pause/resume, update, rollback, enable/disable hoặc activation runtime;
- `com.tomni.studio` là `bundled-legacy`, nên bấm Install/Uninstall chỉ đổi registry state; code IDE/Studio vẫn nằm trong installer;
- Router vẫn static-import các app tùy chọn, vì vậy app chưa cài vẫn có code và route trong Base.

Do đó không được gọi slice hiện tại là “app tải về thật”. Bước kế tiếp phải là một vertical slice vật lý:

```text
Store → tải artifact → verify → atomic install → register app
      → app xuất hiện Home → mở sandbox → deactivate → uninstall
      → route và code app không còn khả dụng
```

## 1A. Decision ledger 2026-07-26 — IDE extension host và tách Studio

> **Quyết định mới này supersede** câu “Studio là một Suite App Package” ở mục 2 và mọi kế hoạch dùng `com.tomni.studio` làm đơn vị cài vật lý duy nhất. Phần còn lại của tài liệu vẫn có hiệu lực khi không xung đột với ledger này.

### 1A.1 Evidence baseline

Đây là kiểm kê source closure tĩnh bằng TypeScript AST, không phải kích thước bundle. Bằng chứng hoàn tất cuối cùng bắt buộc dùng Rollup metafile, artifact đã ký và clean-machine install.

| Entry                     | Source closure | Source bytes | Kết luận                                                              |
| ------------------------- | -------------: | -----------: | --------------------------------------------------------------------- |
| `package-apps/ide.tsx`    |       891 file |    7,976,216 | IDE package hiện vẫn kéo gần như toàn renderer                        |
| `package-apps/studio.tsx` |       799 file |    6,688,980 | Studio package vẫn kéo conversation/editor/IDE code                   |
| IDE Chat                  |       743 file |    6,255,743 | Không được nằm trong core; đang tái dùng toàn bộ conversation surface |
| IDE VIU                   |        67 file |      818,846 | Phải chuyển thành Design Studio độc lập                               |
| IDE Understand            |       102 file |      700,818 | Extension `codebase`, không static-import từ core                     |
| IDE Wiki                  |        91 file |      558,390 | Extension `codebase`, không static-import từ core                     |

Các runtime import Renderer → Main đang vi phạm boundary và phải được gỡ trước extraction: `IdeWorkspace` → `testCommand`, `DatabasePanel` → `dbExport`, `DbConnectionModal` → `dbUrl/dbProviders`, `dbClient` → `dbBridge`, `QuickTestPanel` → `elementInspectorLocator`, `UnderstandPanel`/Studio → `cliModelId`, `useIdeChat` → `workspacePrimer`. DTO, channel name và hàm thuần dùng chung phải chuyển vào `packages/desktop/src/common/`; IPC implementation ở Main, client facade ở Renderer.

### 1A.2 Ownership và extraction matrix

`com.tomni.ide` giữ ID package và module `ide` để không phá deep-link, nhưng chỉ là host/core. Core không được import bất kỳ entrypoint tùy chọn nào.

| Năng lực hiện tại                                                         | Owner đích                    | Contribution group | Activation         | Ghi chú migration                                       |
| ------------------------------------------------------------------------- | ----------------------------- | ------------------ | ------------------ | ------------------------------------------------------- |
| IDE shell, workspace lifecycle, command palette, extension error boundary | `com.tomni.ide`               | —                  | eager khi mở IDE   | Core host contract                                      |
| Files, file tree, editor adapter                                          | `com.tomni.ide`               | built-in           | eager/lazy editor  | Giữ route cũ                                            |
| Search, Git, terminal panel                                               | `com.tomni.ide`               | built-in           | on-demand          | Core tối thiểu có ích khi offline                       |
| Understand, Wiki, code graph, LSP                                         | `com.tomni.ide.codebase`      | `codebase`         | khi cài + mở item  | Một UI Package có nhiều contribution                    |
| Database/schema workspace                                                 | `com.tomni.ide.database`      | `codebase`         | khi mở item        | Tách permission DB khỏi codebase chung                  |
| Chat, Team/Cloud collaboration                                            | `com.tomni.ide.agent-ops`     | `agent-ops`        | khi mở item        | Không tái dùng nguyên conversation page; dùng host SDK  |
| Hooks, Spec, ExpBase                                                      | `com.tomni.ide.agent-ops`     | `agent-ops`        | khi mở item        | Sự kiện phải owner-scoped                               |
| QuickTest/inspect/run/fix                                                 | `com.tomni.ide.quality`       | `agent-ops`        | khi mở item        | Permission process/terminal riêng                       |
| VIU/UI designer                                                           | `com.tomni.design-studio`     | —                  | app độc lập        | Xóa khỏi IDE rail sau migration                         |
| Studio file/editor/dashboard/peer                                         | `com.tomni.document-studio`   | —                  | app độc lập        | Owner dữ liệu tài liệu và collab                        |
| Studio Automation                                                         | `com.tomni.automation-studio` | —                  | app độc lập        | Không còn module metadata giả                           |
| Studio Make Video                                                         | `com.tomni.video-studio`      | —                  | app độc lập        | Artifact riêng                                          |
| Studio Music                                                              | `com.tomni.music-studio`      | —                  | app độc lập        | Có thể map sang package music hiện hữu nếu ID đã public |
| Studio suite cũ                                                           | `com.tomni.studio`            | —                  | compatibility-only | Store collection/redirect, không chứa runtime code      |

Hai group ID là ABI ổn định:

- `codebase`: hiểu, điều hướng và thao tác trên code/data của workspace;
- `agent-ops`: tác vụ agent, collaboration, test, automation và vận hành.

Contribution key toàn cục phải là `<ownerPackageId>/<contributionId>`. Registry từ chối duplicate key, group ngoài allowlist, owner giả mạo và package chưa active. Thứ tự deterministic theo `groupOrder`, `itemOrder`, rồi ID; dispose theo owner khi disable/update/uninstall.

### 1A.3 Shared-runtime allowlist

Host chỉ cung cấp ABI nhỏ, versioned và permission-checked:

- React 19 và `react-dom/client`;
- tập Arco component được công bố;
- icon bridge/tập icon được công bố;
- translator `react-i18next` đã bind namespace của package;
- Tomni Host SDK: workspace, navigation, terminal, contribution registry và typed events;
- semantic CSS tokens, theme state và Uno reset contract.

Source contract được phép dùng chung: `packages/desktop/src/common/packages/**`, contract contribution mới dưới `packages/desktop/src/common/`, và package-runtime primitives không chứa business page. Cấm import `@renderer/pages/**`, layout toàn cục, conversation page/component, `@process/**`, barrel `@/common`, Node/Electron/ambient `window` API và global CSS injection.

Blob import hiện tại không đủ để externalize bare import một cách an toàn. P0 phải chọn và test một cơ chế duy nhất: import map/module federation có integrity, hoặc truyền SDK object versioned vào `mount(hostSdk)`. Không được coi externalization là hoàn tất chỉ vì Rollup đánh dấu `external`.

### 1A.4 Migration compatibility

- Giữ `com.tomni.ide/ide`; deep-link cũ vào mode tùy chọn đi qua Package Gate với CTA cài package owner.
- `/studio` và `com.tomni.studio/studio` dùng resolver một release: `file/editor/dashboard/peer` → Document Studio, `viu` → Design Studio, `automation` → Automation Studio, `makeVideo` → Video Studio, `music` → Music Studio, `ide` → IDE core.
- `com.tomni.studio` trở thành “Studio Collection” hoặc migration alias ẩn; không âm thầm cài toàn bộ app.
- Migrate `studioStorage` bằng schema version, receipt và rollback. Uninstall alias cũ không được xóa dữ liệu đã chuyển owner.
- Sau cửa sổ tương thích, shell/Store không được import `studioStorage`, `HUB_APPS` hoặc business component của app.

### 1A.5 Store/extension UI gap ledger

Detail page hiện đã có hero, version, size, compatibility, screenshot fallback, module, permission và dependency. Tuy nhiên Store chưa đạt vision production:

| P0 gap                                                                        | Acceptance evidence                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| IA Store còn gắn trong `HubWorkspacePage`, chỉ list `downloaded-package`      | Routes/tabs Apps, Packages, Installed, Updates dùng cùng service contract Web/Desktop       |
| Manifest v1 thiếu host slot/group/order/activation/SDK ABI/localized metadata | Schema + validator + fixture signed package có contribution hợp lệ và fixture bị reject     |
| Compatibility chỉ là `engines.tomni >=0.0.0`                                  | Hiện OS/runtime/host SDK ABI; không hiện raw range vô nghĩa                                 |
| Screenshot catalog đang trống, release note là boilerplate                    | Artifact/catalog signed chứa screenshot và changelog theo version, có fallback đúng         |
| Permission/type/tag/surface hiển thị raw ID                                   | Tất cả qua i18n label; update có permission diff + consent                                  |
| Không có rollback/quarantine/recovery/pause-resume                            | Installed/Updates hiển thị state và action thật, có test lỗi mạng/tamper/restart            |
| Host chỉ mở full app route, không có host-slot                                | Cài extension làm rail item xuất hiện bằng event; uninstall dispose ngay, không poll 2 giây |
| `trusted-react` chạy cùng renderer với ambient API                            | SDK/capability boundary, signature policy và crash isolation có test                        |

### 1A.6 P0 vertical-slice acceptance tests

Slice được coi là xong chỉ khi toàn bộ tiêu chí dưới đây chạy trên artifact thật, không dùng registry giả:

1. **Physical absence:** clean Base và `com.tomni.ide` core không chứa module/hash/string entrypoint độc quyền của Codebase, Agent Ops, Quality, Database hoặc Studio apps; Rollup metafile và unpacked installer là evidence.
2. **Core-only boot:** trên package root rỗng, Store mở được; cài IDE core từ remote catalog thật; Files/Search/Git/Terminal hoạt động; rail không có optional contribution.
3. **Install contribution:** cài `com.tomni.ide.codebase`; verify signature/integrity/dependency/SDK ABI; item xuất hiện dưới `codebase` không cần restart; mở được; restart vẫn khôi phục deterministic order.
4. **Uninstall active extension:** khi đang mở view extension, host fallback về Files, dispose event/command/panel theo owner, xóa artifact, deep-link chuyển Package Gate; IDE core không crash.
5. **Registry isolation:** reject group lạ, duplicate key, cross-owner overwrite, unregistered command và package chưa active; một extension crash không làm sập host.
6. **Update safety:** update có permission diff và explicit consent; staging atomic; failure/tamper bị quarantine; rollback quay lại version trước và contribution registry nhất quán.
7. **Transport parity:** cùng test contract chạy qua Electron IPC và Web API; pause/resume/retry có progress; restart giữa download/install recovery đúng.
8. **Boundary:** CI fail nếu Renderer runtime-import `@process/**`; DTO/channel/utility dùng chung chỉ ở Common; preload expose allowlist tối thiểu.
9. **i18n/a11y/theme:** 9 locale có key host/group/action/error; package namespace lazy load/unload; không lộ raw ID; keyboard/focus, light/dark, reduced-motion và safe-theme fallback qua DOM tests.
10. **Studio migration:** mỗi deep-link cũ resolve đúng app; dữ liệu giữ nguyên với migration receipt; rollback được; gỡ alias không xóa dữ liệu owner mới.
11. **Clean-machine proof:** remote catalog → download → verify → install → open → update → rollback → uninstall chạy trên profile sạch; sau uninstall route và executable code không còn khả dụng.

Test placement ưu tiên: `tests/unit/package-manager/` cho schema/service/registry/host DOM, `tests/unit/ide/` cho contribution host và fallback, `tests/unit/studio/` cho migration resolver, thêm integration artifact test dùng catalog HTTP thật trong test temp root.

### 1A.7 Implementation order và vùng xung đột

Thứ tự P0: (1) schema/SDK ABI + contribution registry; (2) gỡ Renderer→Main imports; (3) IDE core shell không static-import; (4) một Codebase extension artifact; (5) install/update/uninstall/quarantine end-to-end; (6) Studio resolver và một app độc lập; (7) mở rộng các package còn lại.

Các lane phải tránh chỉnh đồng thời hoặc phải rebase có chủ đích tại:

- `packages/desktop/src/renderer/pages/studio/ide/IdeWorkspace.tsx` (hiện tại);
- `packages/desktop/src/renderer/pages/hub/HubWorkspacePage.tsx`;
- `packages/desktop/src/renderer/package-apps/`;
- `packages/desktop/src/common/packages/`;
- `packages/desktop/src/process/extensions/package-manager/` (hiện tại);
- `packages/desktop/src/renderer/pages/hub/PackageAppHost.tsx` (host hiện tại);
- `packages/desktop/src/renderer/services/packageRuntime/` (target nếu runtime được tách khỏi page);
- `packages/desktop/src/preload/` và IPC package contract;
- `scripts/package-apps/build.ts`;
- `tests/unit/package-manager/`, `tests/unit/ide/`, `tests/unit/studio/`;
- `locales/*/{ide,studio,guid}.json` và i18n generated types.

Owner đề xuất: Backend sở hữu schema/download/install/registry persistence/transport; Runtime UI sở hữu host SDK, IDE rail và Store; Data/train lane chỉ đọc runtime, cập nhật readiness evidence và cross-review, không sửa các vùng owner trên nếu chưa handoff.

### 1A.8 Cross-lane review snapshot

Trạng thái 2026-07-26, chưa phải sign-off:

- Backend Phase 1 đã qua cross-review: taxonomy giữ đúng ba loại, IDE extension dùng `ui`, group khóa `codebase|agent-ops`, key owner-scoped, mọi `contributions.ide` phụ thuộc IDE, có host API/activation và startup-safe restore diagnostics. Gate: oxlint sạch, 36/36 registry/manifest/service tests; runtime/Store/quarantine persistence vẫn là P0 kế tiếp.
- Lifecycle ResourceCoordinator primitive đã qua cross-review: activation failure cleanup, pressure isolation, suspend→evict, async disposal drain và no-repeat eviction đều đạt; gate 19/19 behavioral tests và oxlint sạch. Wiring package/tab owner thật vào pool vẫn là P0 kế tiếp.
- Trainer scripts qua Python compile và focused Vitest, nhưng test hiện chủ yếu kiểm tra source string. Cần subprocess behavior tests cho lock, atomic status, GPU gate, resume và trainer failure. Queue tiếp tục bị giữ ở candidate-only; bộ synthetic test hiện 12 semantic groups chưa đạt gate 100/30 nên chưa được launch/promotion.

### 1A.9 Phase 2 cross-review gate

Trạng thái hiện tại: Studio compatibility resolver, PackageManager transaction core và lifecycle capability IPC đã được sign-off. Store production vẫn chưa đạt gate tách package thật vì catalog/artifact Studio cũ; HTTP contribution parity đã đạt bằng bounded long-poll.

- **Studio resolver đạt:** mapping `/studio` và `com.tomni.studio/studio` tới package/module độc lập, install gate khi thiếu target, fallback mode tương lai về Document dashboard, receipt/rollback/uninstall plan không có data deletion. Gate 30/30 resolver tests; cùng storage 38/38, lint/format/strict source typecheck sạch.
- **PackageManager core đạt:** transaction được serialize theo validate → artifact → durable state → atomic contribution publish → revision event → finalize; rollback artifact/state chạy độc lập bằng `allSettled`; listener lỗi không phá transaction; Json state store phục hồi in-memory state khi flush lỗi; public listing/event/HTTP chỉ lộ stable code. Gate độc lập 46/46 tests (gồm pre-publish concurrency và failed-flush rollback save/remove), full typecheck, lint/format sạch. HTTP parity đạt qua endpoint long-poll được xác thực `/api/packages/contributions/wait`: immediate-if-newer, wake install/uninstall, timeout tối đa 30 giây, stable redacted errors và cleanup listener/timer khi socket đóng. Gate HTTP 10/10; combined package gates 52/52.
- **Lifecycle IPC đạt:** Main cố định owner/kind/task/cost/hooks và chỉ cấp crypto handle opaque; Renderer chỉ được activate/deactivate/get-one, không có register/suspend/evict/unregister/snapshot-owner. Global lifecycle broadcast đã bị gỡ; hiện dùng capability polling cho tới khi có targeted MessagePort/Host SDK. Duplicate activation bị chặn, deadline/cancel lỗi được sanitize, disposal giữ identity để retry và không rò lease. Gate độc lập 25/25 tests, lint/format sạch.

- **Store production còn chặn:** catalog.ts vẫn phát hành artifact suite com.tomni.studio 25.541.523 byte với engines.tomni: >=0.0.0; test còn yêu cầu bundle IDE/Studio lớn hơn 10 MiB. Phải thay bằng artifact độc lập cho document/design/automation/video/music, đặt version floor thật, và chỉ giữ route Studio cũ làm compatibility alias không tải suite.

### 1A.10 Phase 3.1 independent cross-review

Trạng thái 2026-07-26: IDE Extensions UI được sign-off độc lập cho metadata host; artifact signing/portability được sign-off, nhưng chưa được dùng để tuyên bố Base đã nhẹ hoặc bundle đã mở thật.

- **IDE Extensions UI đạt:** đúng hai group ABI `codebase|agent-ops`; panel chỉ đọc contribution metadata và không static-import/execute module tùy chọn. Desktop nhận revision push; Web dùng bounded long-poll tuần tự, không overlap, tiếp tục sau timeout, exponential backoff chỉ sau lỗi transport, abort khi unmount và bỏ late response. Install/uninstall cập nhật không remount; installed count đếm package ID duy nhất; title key có fallback; activation qua i18n. Focus fallback, `aria-pressed`, `aria-current`, loading/status, error/alert, empty state và diagnostics redaction có DOM test. Chín locale có cùng key set và không clone giá trị tiếng Anh. Gate độc lập: 38/38 IDE/Web tests, full `tsc --noEmit`, scoped oxlint 0 warning/0 error, oxfmt và i18n check sạch cho key mới; BOM đã gỡ.
- **Artifact security/portability đạt:** production signing fail-closed, từ chối Ed25519 key không khớp trust anchor; dev signing opt-in dùng key ID riêng. Metafile Document có 449 input, Design có 457 input; cả hai có 0 absolute path, 0 NUL ID và 0 `node_modules` path. Signature, integrity, install/read/remove và generic host tests đạt 30/30.
- **Chưa được tuyên bố hoàn tất:** test tên “opens” hiện chỉ đọc `app.js`, chưa import/mount Document/Design bundle thật; chưa có production Base renderer metafile và before/after size delta chứng minh code tùy chọn vắng khỏi Base; closure exclusion còn dựa blacklist/marker thay vì allowlist ownership chính thức; `trusted-react` permissions mới là khai báo, chưa phải capability enforcement; Document runtime còn cố định Arco `enUS`. Các mục này vẫn là release blockers cho clean-machine/open/base-weight/security claim.

### 1A.11 Phase 4-5 production evidence và training checkpoint

Trạng thái 2026-07-26: artifact Document/Design đã được mở thật; trust escalation và IDE execution đã fail-closed; production renderer graph đã có. Các bằng chứng này supersede blocker tương ứng ở mục 1A.10, nhưng không đồng nghĩa toàn bộ Store/IDE extraction đã hoàn tất.

- **Artifact lifecycle đạt trong phạm vi Document/Design:** test dùng HTTP/PackageManager thật để install và verify artifact production, Node ESM import `app.js`, gọi `mount(vi-VN)`, quan sát DOM, gọi `unmount`, kiểm tra DOM rỗng và không tăng handle/request so với baseline sau import; sau đó uninstall, read bị từ chối và thư mục package không còn. Process child thoát tự nhiên, không dùng `process.exit` để che leak. Gate package cuối: 40/40.
- **Trust P0 đạt:** catalog không còn quyết định trust bằng field tự khai. `signed-first-party` chỉ được suy ra khi key material, key ID, publisher và policy cùng khớp; Store key thông thường không thể giả `com.tomni` để chạy `trusted-react`.
- **IDE execution fail-closed:** IDE chỉ mount package installed+enabled, non-legacy, đúng `com.tomni`, `signed-first-party`, `trusted-react` và entry `.js`. `sandboxed-web` mặc định bị chặn ở host boundary; toàn repo không có caller bật lại. Test host/panel 22/22; suite extension 33/33, coverage statements 91.58%.
- **Production graph có bằng chứng:** renderer baseline phát ra 26.087.691 byte, gồm JS 23.370.830, CSS 1.085.030 và asset khác 1.631.831; 11.135 module/648 output. Owner arrays của package runtime, Design, Document và VIU đều rỗng. Vẫn còn 5 helper Studio (`codeRelations`, `ideClient`, `lspClient`, `planningGuard`, `studioStorage`), nên chưa được tuyên bố Base nhẹ hoàn toàn hoặc IDE đã tách hết.
- **Locale runtime đạt:** host truyền locale đã resolve; Document/Design chọn động 8 Arco locale và bù trường thiếu từ `en-US`. Artifact production đã rebuild, ký lại và catalog đã đồng bộ.
- **User Understanding 2B candidate đạt verifier, chưa promote:** checkpoint-800 được safe-finalize bằng `safetensors` + `trainer_state.json`, không đọc pickle và không chạy thêm optimizer step. Eval loss 0,047744497656822205; best 0,047743719071149826; observed delta 7,7858567e-7 nằm trong numeric tolerance 1e-5. Recipe, dataset, base, checkpoint và artifact hash đều bind; 14 tensor finite. Immutable post-training benchmark và human review vẫn là gate bắt buộc trước promotion. Orchestrator 2B và Assistant 2B vẫn phải train tuần tự.

### 1A.12 Base renderer shared-client split (đang chờ production byte delta)

Static-closure audit sau Phase 5 phân biệt rõ code tùy chọn với hạ tầng Base bắt buộc; không dùng đổi tên/move file để làm đẹp metric:

- **Full IDE client đã rời Base closure ở mức source import:** bốn consumer Base (ACP context, secret-marker render và Text/Code editor) dùng `renderer/services/coreIdeClient.ts`, chỉ khai báo 9 channel thật sự cần. Client IDE đầy đủ 1.330 dòng/61.267 byte vẫn thuộc artifact `com.tomni.ide`; Base client mới 6.536 byte. `planningGuard` là policy chung của chat nên chuyển sang `renderer/services/` và chỉ phụ thuộc core client. Source scan không còn import `pages/studio/ide/ideClient` hoặc `pages/studio/ide/planningGuard` từ ngoài package-owned Studio tree.
- **Ba helper được giữ trung thực trong Base:** `codeRelations` là thuật toán thuần cho Universal Editor; `lspClient` cấp completion/hover/definition/reference/rename/format/diagnostic cho Text/Code adapter; `studioStorage` giữ lịch sử file cho Hub History và bảo toàn nguyên khóa `studio.recentFiles`, `studio.starredFiles`, `studio.lastView`. Di chuyển chúng chỉ để owner array rỗng nhưng không giảm byte sẽ là gaming metric, nên chưa thực hiện.
- **Evidence schema đã tách ownership:** lần build production kế tiếp sẽ ghi đồng thời `remainingStudioModules`, `sharedBaseInfrastructureModules` và `optionalStudioModules`. Gate thành công yêu cầu `optionalStudioModules=[]`; shared Base infrastructure được báo riêng, không bị tính nhầm là optional package code.
- **Lazy-split audit của ba helper còn lại:** baseline cũ cho thấy `codeRelations` (2.469 rendered byte) và `lspClient` (6.255 byte) đã nằm trong dynamic entry `TextCodeAdapter` 20.898 byte; chúng không nằm trên startup path nhưng vẫn thuộc Base disk vì Universal Editor của chat/workspace cần Text/Code. `studioStorage` chỉ đóng góp 812 rendered byte trong chunk HubWorkspacePage 31.841 byte và giữ dữ liệu History. Tách History thành route con có thể giảm thời điểm tải Store/Management nhưng không giảm tổng Base disk. Vì chưa có contract thay thế cho Universal Editor/Hub History, audit không thực hiện thêm move hoặc lazy wrapper giả tạo; LSP list/install/stop chỉ nên split sau khi có client contract test chứng minh phần Base và phần package độc lập.
- **Verification nhẹ đã đạt:** regression gate mới quét toàn bộ renderer ngoài `pages/studio/` và fail nếu import ngược full `ideClient`/`planningGuard`; focused Vitest mới nhất 20/20 trên core client, planning guard, MessageText và UniversalEditor. Scoped Oxfmt sạch; Oxlint 0 warning/0 error. Full `tsc --noEmit` đã sạch ở lượt trước; lượt xác minh hiện tại được chủ động dừng sau 64 giây khi phát hiện một typecheck song song khác và training Orchestrator đang giữ tài nguyên, nên không dùng lượt này để tạo claim mới.
- **Chưa có after production bytes:** baseline hợp lệ gần nhất vẫn là 26.087.691 byte tại mục 1A.11. Build đo lại đã dừng trước `closeBundle` theo resource coordinator khi training Orchestrator 2B bắt đầu; peak build quan sát khoảng 1.980 MiB RAM. Hai evidence JSON cũ được giữ nguyên và không được dùng để tuyên bố delta. Trong baseline cũ, riêng `ideClient.ts` đóng góp 37.718 rendered byte; đây chỉ là upper-bound tham khảo, không phải số tiết kiệm sau build.

- **Benchmark oracle drift đã sửa, chưa rerun GPU:** immutable User Understanding giữ nguyên; reviewed benchmark definition hiện deep-copy expected và materialize `confidence: 0.9` theo schema. Behavioral gate xác nhận 192/192 case đúng schema và 48/48 immutable row khớp oracle; 16/16 training-script tests đạt. Benchmark GPU chờ queue training giải phóng tài nguyên.
- **Orchestrator 2B đang chạy candidate-only:** queue execution slice bắt đầu tại Orchestrator, ghi Security/User Understanding là `skipped-before-start`, không mutate candidate cũ; Assistant chờ tuần tự và `promotionAllowed=false`.

### 1A.13 Store publisher fail-closed gate

Trạng thái 2026-07-26: publish flow không còn fallback sang catalog bundled/stale khi catalog production lỗi.
Publish thường phải fetch, JSON-parse và verify chữ ký/trust policy của catalog hiện tại trước mọi upload;
network error, malformed/untrusted content và mọi HTTP error đều abort. Redirect được xử lý thủ công tối đa 5 hop;
mọi hop phải là HTTPS không chứa credential. `--bootstrap` là opt-in và chỉ khởi tạo danh sách rỗng khi chính URL
catalog gốc trả HTTP 404, không chấp nhận redirected 404. Merge giữ nguyên entry không liên quan; chặn downgrade,
đổi publisher của package ID đã tồn tại, mutation cùng SemVer precedence (kể cả build metadata), URL artifact tương
đương/trùng giữa package và việc version mới tái sử dụng cùng artifact URL trước khi `--clobber` có thể ghi đè bytes.
Concurrency gate dùng Release asset cố định không `--clobber` làm remote mutex thật giữa các process. Publisher chỉ
đọc/merge catalog khi đã giữ lock, sau khi upload artifact sẽ re-fetch và so expected catalog identity ngay trước
catalog upload; nếu có stale/external writer thì fail conflict, không retry mù. Lock được release ở cả success/error;
stale lock do process bị kill chỉ được xoá thủ công sau khi operator xác nhận không còn publisher đang chạy.
Focused gate `packageProject.test.ts`: 13/13 (2 builder + 11 publish/adversarial/concurrency). Integration lifecycle
build → catalog → download/install → readAsset → uninstall đạt 2/2.

## 2. Quyết định taxonomy

Tài liệu mới nhất là nguồn chuẩn. Ba loại package chính thức:

1. **App Package**
2. **UI Package**
3. **Agent Capsule**

Các tài liệu cũ dùng `Capability Package` được coi là superseded. Trên Store:

```text
Apps
Packages
```

Tab Packages có bộ lọc:

```text
Tất cả · UI · Agent Capsule
```

Nhãn card/detail:

```text
APP
PACKAGE · UI
PACKAGE · AGENT CAPSULE
```

Studio là một **Suite App Package**. IDE, Editor, UI Designer, Automation và Media là module/deep-link của Studio, không phải năm lượt tải.

## 3. Vì sao WebUI và Desktop đang lệch

Hai runtime dùng chung React renderer nhưng chưa dùng chung toàn bộ product shell và service contract.

### 3.1 UI shell bị nhân đôi

Hiện tồn tại đồng thời:

- `Layout.tsx` + `Sider` + `Titlebar` cho các route cũ;
- shell riêng trong `HubHome`;
- shell riêng thứ hai trong `HubWorkspacePage`;
- Settings và các app cũ tiếp tục dùng layout/style cũ.

`Layout.tsx` còn có danh sách route đặc biệt để ẩn shell toàn cục. Một route bị thiếu hoặc được mở bằng alias sẽ nhận một shell khác. Đây là nguyên nhân cấu trúc khiến page có kích thước, header, sidebar và responsive khác nhau.

### 3.2 Runtime branching làm DOM khác nhau

Nhiều component dùng `isElectronDesktop()` để ẩn/hiện control, native surface hoặc action. Runtime capability là cần thiết, nhưng không nên chọn một layout khác.

Quy tắc mới:

- WebUI và Desktop render cùng `HubShell`;
- chỉ action không được hỗ trợ mới disabled/hidden theo capability;
- vị trí và kích thước shell không thay đổi;
- window controls là slot Desktop-only trong cùng header contract.

### 3.3 Transport Package Platform chưa parity

Desktop có `packagePlatform` qua Electron IPC. WebUI chưa có `/api/packages/*` và không khởi tạo cùng Package Manager service. Vì vậy cùng một Store component sẽ hoạt động ở Desktop nhưng fail hoặc treo trên WebUI.

### 3.4 Theme/custom CSS chưa có một nguồn hiển thị ổn định

Shell cũ, page-private CSS và custom CSS được áp theo nhiều lớp. WebUI/Desktop còn có thể đọc config ở thời điểm khác nhau. UI Package sau này sẽ làm vấn đề nặng hơn nếu chưa có token contract và safe-theme fallback.

## 4. Kiến trúc UI thống nhất

Chỉ giữ một shell:

```text
App
└── HubShell
    ├── GlobalHeader
    ├── HubSidebar
    ├── PageOutlet
    ├── StatusRail
    ├── OverlayHost
    └── GlobalFooter
```

Các page Home, Store, Manage, History, Company và Settings chỉ render content. Chúng không tự dựng lại sidebar/header/footer.

### 4.1 Những UI cũ phải loại bỏ

Sau khi parity:

- xóa shell markup và shell CSS khỏi `HubHome`;
- xóa shell markup và shell CSS khỏi `HubWorkspacePage`;
- bỏ route allowlist `isHubHomeRoute`;
- bỏ Store redirect sang Agent extensions;
- bỏ hardcoded app catalog trong Home/sidebar;
- bỏ CSS global/page override trùng nhau;
- giữ compatibility redirect cho URL cũ trong một release window.

Không xóa business component của app trong bước này.

### 4.2 Store route chính thức

```text
/store
/store/apps
/store/packages
/store/installed
/store/updates
/store/item/:packageId
```

Redirect tương thích:

```text
/products → /store
/settings/agent?market=1 → /store
```

### 4.3 Store screens MVP

- Discover: featured, category, recent update;
- Apps: App Package only;
- Packages: UI Package và Agent Capsule;
- Installed: enabled state, version, size, permission, configure, uninstall;
- Updates: changelog, size và permission diff;
- Detail: preview, publisher, signature/trust, compatibility, permission, dependency, data policy;
- Install drawer/modal: download progress, verify, permission approval và error recovery.

## 5. Base OS sau de-bundle

### 5.1 Luôn có trong Base

- HubShell, Home và Store;
- Account/Auth, onboarding và Settings lõi;
- Chat/agent-control tối thiểu;
- App Registry và Contribution Registry;
- Package Manager, downloader, verifier và recovery;
- Package Host và Sandbox Supervisor;
- Permission Broker và Secret Vault;
- Model/CLI Gateway;
- workspace/file primitives;
- context/event/notification primitives;
- updater và diagnostics.

### 5.2 Không nằm trong Base sau khi tách vật lý

- Studio Suite: IDE, Editor, UI Designer, Automation, Media;
- Browser và browser automation assets;
- các app chuyên ngành;
- Manager/Operations và Company extension khi boundary đã đủ ổn định.

Testing/Benchmark không là app/package sản phẩm. Validation thuộc Studio/CI/publish gate.

### 5.3 Ý nghĩa “chưa tải thì không có chức năng”

Với app tùy chọn đã de-bundle:

- Base không import source app;
- Base không đăng ký route/command/bridge của app;
- Home chỉ hiển thị app trong Store, không hiển thị như installed app;
- truy cập deep link sẽ mở `PackageGate`, không mở code cũ;
- artifact app chỉ tồn tại dưới package directory sau khi install;
- uninstall phải deactivate và unregister trước khi bỏ artifact;
- sau uninstall, route app không thể chạy offline từ cache cũ.

`bundled-legacy` chỉ là cầu migration và không đáp ứng định nghĩa này.

## 6. Một service, hai transport

Không xây Package Manager riêng cho WebUI.

```text
                         ┌─ Electron IPC adapter ─ Desktop renderer
PackagePlatformService ──┤
                         └─ Authenticated HTTP/WS ─ WebUI renderer
```

Business rules, state, lock, integrity, signature và transaction chỉ tồn tại một lần trong Main/backend service.

### 6.1 API WebUI cần thêm

```text
GET    /api/packages
GET    /api/packages/search?q=
GET    /api/packages/:id
POST   /api/packages/:id/install
POST   /api/packages/:id/pause
POST   /api/packages/:id/resume
POST   /api/packages/:id/enable
POST   /api/packages/:id/disable
POST   /api/packages/:id/update
POST   /api/packages/:id/rollback
DELETE /api/packages/:id
GET    /api/packages/:id/assets/*
WS     package state/progress events
```

Mọi mutation cần auth, CSRF/origin policy, permission check và operation id để idempotent.

### 6.2 Renderer client

Store/Home chỉ gọi một typed `PackagePlatformClient`. Adapter tự chọn IPC hoặc HTTP. React page không gọi filesystem và không có nhánh UI riêng cho Desktop/WebUI.

## 7. Manifest v1 cần mở rộng

Schema hiện tại thiếu dữ liệu để tải và chạy app thật. Manifest v1 hoàn chỉnh cần:

```ts
type PackageManifestV1 = {
  schemaVersion: 1;
  id: string;
  publisherId: string;
  type: 'app' | 'ui' | 'agent-capsule';
  bundleKind: 'single' | 'suite';
  version: string;
  engines: { tomni: string; sdk: string };
  artifact: {
    urls: string[];
    sizeBytes: number;
    integrity: string;
    signature: Ed25519Signature;
  };
  store: {
    name: string;
    summary: string;
    description: string;
    icon: string;
    previews: string[];
    category: string;
    tags: string[];
  };
  entrypoints: {
    ui?: string;
    worker?: string;
    capsule?: string;
  };
  contributions: {
    apps?: AppContribution[];
    commands?: CommandContribution[];
    settings?: SettingsContribution[];
    themes?: ThemeContribution[];
    capsules?: CapsuleContribution[];
  };
  permissions: PermissionDeclaration[];
  networkAllowlist: string[];
  dependencies: PackageDependency[];
  dataPolicy: {
    namespace: string;
    uninstallDefault: 'retain';
    schemaVersion: number;
  };
};
```

Catalog/listing metadata phải tách khỏi executable artifact nhưng cùng được ký hoặc liên kết integrity.

## 8. Artifact và runtime

### 8.1 Artifact đề xuất

```text
com.example.sample-app-1.0.0.tomny
├── manifest.json
├── ui/
│   ├── index.html
│   └── assets/*
├── worker/
│   └── worker.js
├── locales/*
└── static/*
```

Không đưa source TypeScript hoặc `node_modules` tùy ý vào runtime artifact.

### 8.2 UI host

Package UI chạy trong isolated iframe/renderer sandbox, không import trực tiếp vào Hub renderer. Cùng một `PackageSurfaceHost` được dùng trên Desktop và WebUI.

Capability giao tiếp qua typed message channel:

- navigation;
- workspace read/write;
- model invoke;
- notifications;
- secret alias request;
- package storage;
- theme/design tokens.

Package không nhận `window.electronAPI`, Node, filesystem path hoặc secret plaintext.

### 8.3 Worker host

Background logic chạy utility process/worker sandbox có:

- CPU/RAM/time quota;
- capability allowlist;
- network allowlist;
- cancellation;
- audit event;
- kill/quarantine.

Community package không chạy code trong Electron Main.

## 9. Download, install và uninstall transaction

### 9.1 Install

```text
resolve catalog
→ compatibility/dependency check
→ reserve operation
→ download .partial có resume
→ sha256/integrity
→ Ed25519 verify với embedded trusted keyring
→ extract chống traversal/symlink
→ permission approval
→ stage
→ atomic rename
→ register contributions
→ sandbox smoke check
→ mark installed/active
```

### 9.2 Update

- tải version mới song song;
- hiển thị changelog và permission diff;
- migrate data transactional;
- smoke check;
- atomic active-version swap;
- giữ previous version đến khi health window qua;
- lỗi activation/crash lặp lại thì rollback.

### 9.3 Uninstall

```text
dependency check
→ user chọn giữ/xóa data
→ deactivate
→ dispose toàn bộ contribution theo package owner
→ chuyển artifact sang trash transaction
→ update registry
→ xóa trash
```

Nếu persistence fail, artifact và registry được restore. User data mặc định giữ lại.

## 10. App Registry và contribution ownership

Home, sidebar, Store và Router không dùng mảng app hardcode.

Mỗi contribution có:

- `packageId`;
- package version;
- stable app/module ID;
- permission scope;
- activation state;
- disposer;
- health/error state.

Router chỉ giữ route generic:

```text
/apps/:appId/*
```

App Registry resolve `appId → installed package contribution`. Nếu chưa cài, trả `PackageGate`; nếu failed/quarantined, trả recovery surface.

## 11. Vertical slice đầu tiên

Không dùng Studio làm physical-download pilot vì dependency graph quá lớn.

Tạo App Package mẫu nhỏ:

```text
com.tomni.sample.notes
```

Chức năng đủ chứng minh runtime:

- một app surface sandboxed;
- package-local storage;
- một command;
- notification permission;
- light/dark design-token support;
- version 1.0.0 và 1.1.0 để test update/rollback.

Acceptance flow:

1. Base khởi động khi package directory trống.
2. Store tìm thấy Sample Notes.
3. Cài đặt tải artifact thật và verify chữ ký.
4. App xuất hiện Home nhưng không tự ghim.
5. Mở app ở Desktop và WebUI có cùng DOM/layout.
6. Restart/offline vẫn mở được.
7. Update 1.1.0 không mất data.
8. Package lỗi tự rollback 1.0.0.
9. Uninstall làm app biến mất khỏi Home và route không chạy.
10. Base/Chat/Store vẫn hoạt động khi artifact bị xóa/hỏng.

Sau khi slice này qua 100 vòng lifecycle mới bắt đầu activation adapter cho app first-party.

## 12. Thứ tự triển khai

### Phase A — Parity foundation

- tạo `HubShell` dùng chung;
- chuyển Home/Store/page sang content-only;
- tạo `PackagePlatformClient`;
- thêm HTTP/WS API dùng chung service;
- Store đọc Package Platform, không đọc Agent Hub.

### Phase B — Store MVP

- Store routes, tabs, search, detail và Installed;
- progress/error/retry;
- permission approval;
- package state event;
- offline catalog cache.

### Phase C — Physical sample package

- catalog registry;
- downloader/resume;
- asset server;
- sandbox host và capability bridge;
- Sample Notes install/open/update/rollback/uninstall.

### Phase D — Legacy app adapters

- owner-aware contribution registries;
- bọc app hiện tại thành virtual package;
- Home/sidebar chuyển hoàn toàn sang App Registry;
- parity test trước khi de-bundle.

### Phase E — First-party de-bundle

- chọn app boundary nhỏ;
- Browser;
- Studio Suite;
- Manager/Company sau khi dependency graph cho phép;
- xóa static import/wiring chỉ sau canary và rollback gate.

## 13. Test và production gates

### Contract

- cùng contract test chạy qua IPC và HTTP;
- schema/compatibility/dependency/permission tests;
- Desktop/WebUI trả listing và state giống nhau.

### Security

- signature/integrity/key rotation;
- zip-slip, symlink và path escape;
- CSP/origin/message validation;
- permission revoke;
- secret không xuất hiện trong renderer, log hoặc package output.

### Lifecycle

- concurrent install idempotent;
- install và uninstall đối nghịch bị serialize;
- network interruption resume;
- crash giữa staging/swap/trash được recover;
- dependency uninstall bị chặn;
- rollback giữ data.

### UI

- Store light/dark và responsive;
- install progress, error, retry;
- permission diff;
- disabled/offline/quarantined states;
- cùng screenshot/DOM contract cho WebUI và Desktop, trừ window-control slot.

### Release gate

- 100 vòng install/update/rollback/uninstall không mất data;
- Base chạy khi package root trống, read-only hoặc chứa artifact hỏng;
- package fail không crash Hub;
- optional app code không còn trong Base bundle sau de-bundle;
- không còn route Store trỏ sang Agent extensions.

## 14. Việc không làm trong slice đầu

- chưa public marketplace;
- chưa billing/payout;
- chưa cho community upload;
- chưa tách Studio vật lý;
- chưa cho UI Package inject CSS/DOM tùy ý;
- chưa xóa business logic app cũ trước parity;
- chưa hứa Agent Capsule đạt kết quả AI 100%.

## 15. Definition of Done cho MVP

MVP chỉ hoàn thành khi:

- WebUI và Desktop dùng cùng Store UI và cùng Package Platform state;
- Base installer không chứa code của Sample Notes;
- Sample Notes chỉ dùng được sau download/install thật;
- uninstall loại bỏ contribution và code runtime của Sample Notes;
- Home/sidebar đọc App Registry;
- Store hỗ trợ search, detail, install, progress, open, disable và uninstall;
- update/rollback có test failure-path;
- package sai signature/compatibility/permission bị từ chối;
- Base vẫn ổn định khi không có package tùy chọn.
