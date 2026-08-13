# TomniHubOS — Production Security Architecture Review

**Vai trò:** Principal Security Architect độc lập
**Ngày:** 2026-07-26
**Phạm vi:** Toàn hệ thống — Tomni Core, package `.tomny`, Tomni Store, IDE contribution ABI, Permission Broker, MCP/remote agent/gateway, local AI, cloud core
**Giai đoạn:** Review và hoàn thiện kiến trúc. Tài liệu này **không viết code và không thiết kế giao diện**.

---

## 0. Cách đọc tài liệu này

### 0.1 Quy ước phân loại bằng chứng

Mọi khẳng định trong tài liệu này mang đúng một nhãn:

| Nhãn | Nghĩa | Nguồn bằng chứng |
| --- | --- | --- |
| **`[CÓ]`** | Đã tồn tại trong mã nguồn, đã đọc trực tiếp | Đường dẫn file (+ số dòng khi cần) |
| **`[ĐANG]`** | Đang triển khai, có phần đã xong và phần chưa xong | Checklist trong spec + mã nguồn một phần |
| **`[ĐÍCH]`** | Thiết kế mục tiêu, **chưa tồn tại** | Chỉ có trong tài liệu thiết kế |
| **`[KHÔNG]`** | Đã tìm và xác nhận không tồn tại | grep toàn repo trả về rỗng |

Khi tôi đề xuất một cơ chế mới, nó mặc định là `[ĐÍCH]` — tôi không mô tả nó bằng thì hiện tại.

### 0.2 Giới hạn của review này

- Đây là **desk review dựa trên mã nguồn và tài liệu**, không phải penetration test, không phải audit mật mã học có kiểm chứng thực nghiệm.
- Tôi đã đọc mã nguồn trong `packages/desktop`, `packages/web-host`, `packages/tomny-runtime` và các artifact trong `store-artifacts/`. **Tôi không đọc được mã nguồn Rust của `tomny-core`** — nó nằm ở repo khác (`github.com/VNDT1625/OmniAgent`). Mọi nhận định về hành vi backend đều dựa vào tài liệu `core.md` và tham số dòng lệnh mà Electron truyền vào, và cần được xác nhận lại ở repo core.
- Không có tài liệu nào trong repo là threat model. Tài liệu này là bản threat model đầu tiên.

### 0.3 Điều tôi không tuyên bố

Không có kiến trúc nào trong tài liệu này đạt "bảo mật tuyệt đối". Cụ thể, ba giới hạn sau là **không thể vượt qua bằng kỹ thuật** và mọi quyết định phía dưới đều giả định chúng đúng:

1. **Không chống được dịch ngược tuyệt đối.** Code chạy trên máy người dùng thì người dùng đọc được. Mọi biện pháp chỉ làm tăng chi phí, không tạo rào chắn.
2. **Không chống được người dùng tự nguyện làm hại chính mình.** Nếu người dùng bấm "cho phép" trên mọi prompt, không cơ chế nào cứu được.
3. **Máy đã bị chiếm quyền cục bộ thì mọi secret cục bộ đều mất.** DPAPI/Keychain chỉ bảo vệ trước kẻ tấn công *không* chạy dưới cùng tài khoản người dùng.

---

## 1. Trạng thái thực tế — sổ cái bằng chứng

Đây là phần quan trọng nhất của tài liệu. Nhiều tài liệu thiết kế trong repo mô tả cơ chế bảo mật bằng thì hiện tại, trong khi mã nguồn chưa có. Bảng dưới tách bạch hai thứ đó.

### 1.1 Cái đã tồn tại và có bằng chứng `[CÓ]`

| Cơ chế | Vị trí | Đánh giá |
| --- | --- | --- |
| Xác minh chữ ký Ed25519 cho package manifest | `packages/desktop/src/process/extensions/package-manager/artifactSecurity.ts` | **Tốt.** Kiểm tra hình dạng base64 chặt, ép độ dài 64 byte, `crypto.verify(null, ...)`, keyId **bắt buộc** có trong bảng trust anchor — không học khóa từ manifest |
| Payload ký chuẩn hóa (canonical serialization) | `packages/desktop/src/common/packages/manifest.ts:321-343` | **Tốt.** Sắp xếp khóa xác định, loại trường `signature.value` khỏi payload |
| Trust anchor cứng trong mã | `packages/desktop/src/common/packages/catalog.ts:19-36` | 2 khóa: `tomni-store-2026-01`, `tomni-store-2026-02`, publisher `com.tomni`. **Không có cơ chế rotation/revoke ngoài việc sửa hằng số và phát hành app mới** |
| Chống path traversal khi giải nén | `packageDownloader.ts:19` (`SAFE_ARCHIVE_PATH`), `:139-148` (`safeTarget`) | **Tốt.** Regex chặn `..` và đường dẫn tuyệt đối, cộng thêm `path.resolve` + `path.relative` escape check + kiểm tra NUL. Dùng `entry.unsafeOriginalName` (đúng — kiểm tra tên gốc, không phải tên đã chuẩn hóa), `createFolders: false` |
| Từ chối symlink | `packageDownloader.ts:258` (unix mode `0o120000`), `artifactSecurity.ts:39` (`lstat().isSymbolicLink()`) | **Tốt** |
| Giới hạn zip-bomb và kích thước | `packageDownloader.ts` | 200 MB tổng, 4096 file trong archive, 20 000 file artifact, 256 KB manifest; đối chiếu kích thước khai báo với byte đã giải nén thực tế |
| Chống SSRF trên URL artifact | `packageDownloader.ts:41-96` | **Tốt.** HTTPS-only, cấm credential trong URL, chặn dải IPv4 private/loopback/CGNAT/link-local/TEST-NET/multicast và IPv6 ULA/link-local/`::ffff:`, `redirect: 'manual'` tối đa 5 hop, **xác thực lại mọi hop** |
| Cài đặt giao dịch (transactional install) | `PackageManagerService.ts` | stage → verify integrity → rename vào chỗ → `finalize`/`rollback`; theo dõi `previousVersion`; **từ chối hạ cấp** (`:546`); hàng đợi mutation tuần tự |
| Phục hồi sau crash | `PackageManagerService.ts:246-332` (`recoverFilesystem`) | Xác minh lại chữ ký + integrity của package đã cài khi khởi động, **cách ly (quarantine) khi lệch** |
| Load catalog từ xa | `remoteCatalog.ts:147-188` | HTTPS bắt buộc, giới hạn 5 MB / 2000 entry, timeout 10 s, `cache: 'no-store'`, **xác minh chữ ký manifest của từng entry ngay lúc parse** (`:69`), từ chối trùng id, ghi cache atomic 0600, fallback ba tầng remote → cache đã ký → bundled |
| Chống hạ cấp trust khi merge catalog | `remoteCatalog.ts:109-126` (`derivePackageTrust`) | keyId + publicKey + publisherId phải khớp policy mới giữ `signed-first-party`; merge từ chối đổi publisher |
| Permission store | `packages/desktop/src/process/services/agentChat/permission/permissionStore.ts` (313 dòng) | Scope `{subjectId, sessionId, surfaceId, capabilityId, toolPattern}`; **deny thắng**, rồi tới độ cụ thể, rồi tới thời gian; hết hạn/thu hồi; audit log giới hạn 5000; hàng đợi tuần tự có rollback state |
| Lifetime của grant | `.../permission/types.ts:3` | `'allow-once' \| 'session' \| 'persistent'` — **chỉ ba mức, không có `workspace`** |
| Bền vững permission có kiểm tra toàn vẹn | `.../permission/repository.ts` | tmp→rename atomic, `mode 0o600`, phong bì checksum SHA-256, **fail-closed**: từ chối load khi checksum lệch |
| Secret Firewall | `packages/desktop/src/process/agentRuntime/agentMesh/security/secretFirewall.ts` (492 dòng) | ~15 regex token nhà cung cấp (JWT, AWS `AKIA/ASIA`, `gh[pousr]_`, `glpat-`, `xox[baprs]-`, `sk_live/test_`, `sk-`, `AIza`, `GOCSPX-`, `npm_`, Bearer). **Điểm mạnh thật sự:** dựng "scan view" đã chuẩn hóa, bóc ANSI escape và Unicode vô hình (`​-‏`, bidi override, `﻿`) nên không thể né bằng cách chèn ký tự ẩn vào giữa secret |
| Outbound text inspection (commit `154c72226`) | `packages/desktop/src/process/services/security/outboundTextInspection.ts` | Quyết định `allow \| sanitize \| block \| approval_required \| failed_closed`. Fail-closed **thật ở cấp hàm**: `try/catch` toàn thân trả `failed_closed` (`:123`); `executeAfterOutboundInspection` chỉ chạy side effect khi quyết định ∈ {allow, sanitize} (`:128-136`). Giới hạn đầu vào chặt: `MAX_PARTS=128`, `MAX_PART_LENGTH=200_000`, `MAX_TOTAL_LENGTH=1_000_000`, `schemaVersion !== 1 → failed_closed` |
| Sandbox iframe cho package `sandboxed-web` | `packages/desktop/src/renderer/pages/hub/PackageAppHost.tsx` | `sandbox='allow-scripts'` **không kèm `allow-same-origin`** (⇒ origin mờ), `referrerPolicy='no-referrer'`, `allow=` từ chối camera/mic/geo/clipboard/usb, `srcDoc` dựng qua `buildSandboxDocument()` có bóc `meta[http-equiv]`, `base/link/object/embed/frame/iframe/script[src]` và mọi thuộc tính chứa URL, rồi chèn CSP `default-src 'none'; connect-src 'none'` |
| Khóa cứng BrowserView của trình duyệt nhúng | `packages/desktop/src/process/browser/browserViewManager.ts:229-233` | `contextIsolation: true, nodeIntegration: false, sandbox: true`; `setWindowOpenHandler` từ chối popup |
| Rust sidecar `tomny-runtime` | `docs/hybrid-runtime-architecture.md`, `packages/tomny-runtime/README.md` | Protocol `tomny.runtime.v1` NDJSON, **version lạ thì fail closed**, xác minh SHA-256 manifest sau khi đóng gói, **không mở network listener ở v1**, giới hạn số process/độ dài arg/kích thước env/frame journal (1 MiB) |
| Omni Gateway auth | `packages/desktop/src/process/omni-gateway/omniGatewayHost.ts:128-133` | Bearer so sánh bằng **`timingSafeEqual`**; allowlist tool hai tầng (`OMNI_IDE_BASE_ALLOWLIST` chỉ đọc, `dangerousTools` cần bật riêng); `ideServerToolGuard.ts` bắt buộc `omni_bootstrap_session` trước |
| `safeStorage` cho credential | `tomnyProviderStore.ts`, `gitCredentialStore.ts`, `ide/db/dbConnectionStore.ts`, `ide/memory/repoSecretStore.ts` | Dùng DPAPI/Keychain/libsecret. `keytar` đã bị loại bỏ khỏi dependency — đúng hướng |
| Build pipeline có SBOM + ký artifact | `docs/tomny-core-parity.md` | CycloneDX SBOM, hash artifact, chữ ký Ed25519 tùy chọn, chính sách "bắt buộc chữ ký" fail-closed **có test**. Lưu ý: bật bằng cấu hình, không mặc định |

### 1.2 Cái đang được triển khai `[ĐANG]`

| Hạng mục | Đã xong | Chưa xong | Bằng chứng |
| --- | --- | --- | --- |
| Security Core (cổng egress) | Phase 0 + Phase 1: contract type, inspection văn bản thuần, ánh xạ policy, reason code ổn định, receipt an toàn | **Phase 2–7 toàn bộ chưa làm**: shared outbound seam, tích hợp IPC/UI, tích hợp từng surface, cổng file/image, classifier 0.8B, bàn giao | `.kiro/specs/tomni-security-core/tasks.md` |
| Độ phủ của outbound inspection | Đúng **2 call site production**: `nativeConversation/bridge.ts:90` (`conversation.sendMessage`) và `foundation/securityAdapter.ts:36` (RunKernel preflight) | `inspectOutboundFileText`, `inspectQuarantinedTextFile`, `inspectOutboundImage`, `verifySanitizedInspection` **không có call site production nào** — chỉ có test | grep toàn `packages/` |
| Tách Studio/IDE khỏi base installer | Package artifact riêng đã tồn tại trong `store-artifacts/` (IDE 35 MB, Studio 34 MB) | **Chưa chứng minh code đã vắng khỏi base installer.** `production-readiness-report.md` đánh dấu `missing` và nói rõ: chỉ module graph của base renderer + kiểm kê ASAR đã giải nén mới chứng minh được | `docs/prds/feature-packs/tomni-package-backend-mvp.md` §1A.11-1A.12 vs `store-artifacts/production-readiness-report.md` |
| Thay thế backend Rust bằng kernel TypeScript | Bỏ được `tomnicore.exe` tải về khỏi runtime selection | **231 tham chiếu helper HTTP/WS** trong `common/adapter/ipcBridge.ts` vẫn trỏ về backend tương thích; `startBackendOrExit` vẫn bắt buộc | `docs/tomny-core-parity.md` |
| Model adapter | Hạ tầng model pack (manifest, verifier, catalog client có allowlist origin) đã viết | **Toàn bộ là mã chết** — `LocalInferenceBroker`, `RustSidecarClient`, `createModelPackService`, `Ed25519ModelCatalogTrustVerifier` chỉ được tham chiếu từ `tests/`. Mọi adapter đang ở trạng thái `baseline/rejected`, không có cái nào `active` | grep import path + `tomni-local-core-model-runtime-design.md` §21 |

### 1.3 Thiết kế mục tiêu chưa tồn tại `[ĐÍCH]` / `[KHÔNG]`

Đây là danh sách những thứ **được nhiều tài liệu mô tả như đã có, nhưng grep toàn repo xác nhận không tồn tại**. Đây là nguồn rủi ro lớn nhất khi lập kế hoạch.

| Hạng mục | Tài liệu nói gì | Thực tế |
| --- | --- | --- |
| **Permission Broker thống nhất** | `feature-packs/README.md` §3 và `complete-product-design` §7.2 liệt kê như một dịch vụ Base OS ở thì hiện tại; `defensible-core-design` §6 gọi nó là primitive "hiện có" cần mở rộng | `[KHÔNG]` Không có thành phần nào tên như vậy. `.kiro/specs/tomni-three-core-foundation/requirements.md` §2.2 liệt kê "Capability/Permission Broker thống nhất theo `runId`, `taskId`, actor, target và expiry" ở mục **"còn thiếu"**. Cái đang có là permission store theo từng surface — hữu ích nhưng không phải broker |
| **Catalog có revision / expiresAt / chữ ký cấp catalog** | Yêu cầu bởi `feature-packs/README.md` §6 và `complete-product-design` §11.1 | `[KHÔNG]` Envelope thực tế là `{schemaVersion: 1, generatedAt: string, packages: []}` (`remoteCatalog.ts:23-27`). **Không có `revision`, không có `expiresAt`, không có chữ ký bao trùm toàn catalog.** Chỉ từng manifest được ký |
| **Kill switch / revocation list** | `package-platform-design` §10.1: "package có kill switch và revocation list" | `[KHÔNG]` Có `quarantine` cục bộ khi phát hiện integrity lệch, nhưng **không có kênh thu hồi từ xa**, không có CRL, không có kill switch |
| **Health check gate cho update** | Vòng đời `Update → health check → commit/rollback` xuất hiện trong nhiều PRD | `[KHÔNG]` `PackageManagerService` có rollback **khi cài lỗi**, không có rollback **sau khi cài thành công nhưng chạy hỏng**. `production-readiness-report.md` đánh dấu "Package rollback" là `missing` |
| **Permission diff khi cập nhật** | `tomni-agentic-store.md`: "Quyền mới trong bản cập nhật phải được nêu rõ trước khi cập nhật" | `[KHÔNG]` `production-readiness-report.md` đánh dấu `missing` |
| **Sandbox thật cho code cộng đồng** | `migration-design` §10: "Community package không được load code tùy ý vào Electron Main" | `[KHÔNG]` — và tệ hơn thế, xem §3.4 dưới đây |
| **Xác minh toàn vẹn binary `tomny-core`** | `core.md` đề xuất; `hybrid-runtime-architecture.md` có cho *sidecar* | `[KHÔNG]` cho `tomny-core`. `binaryResolver.ts:141-152` có fallback **`where`/`which` trên PATH hệ thống**. Không hash pin, không kiểm tra Authenticode |
| **Xác thực trên loopback giữa renderer và backend** | — | `[KHÔNG]` `common/adapter/httpBridge.ts` gọi `fetch('http://127.0.0.1:<port>/api/...')` **không có header Authorization** |
| **Threat model** | Ba tài liệu yêu cầu nó như deliverable Stage-0/Phase-6 | `[KHÔNG]` Không tồn tại. Tài liệu này là bản đầu tiên |
| **SBOM / provenance trong artifact `.tomny`** | `complete-product-design` §9.1 định nghĩa `sbom.json`, `provenance.json` trong cây `.tomny` | `[KHÔNG]` Không artifact nào trong `store-artifacts/` có. (SBOM CycloneDX tồn tại nhưng ở pipeline build *core*, khác pipeline) |
| **Quy trình review/publish vận hành được** | Sơ đồ luồng trong `complete-product-design` §10.6 | `[KHÔNG]` Không có checklist reviewer, không có chính sách quét tự động, không có thủ tục takedown/khiếu nại |
| **Runbook quản lý khóa ký** | Khái niệm được nhắc nhiều lần | `[KHÔNG]` Hai keyId tồn tại trong artifact, nhưng không có tài liệu custody, rotation, hay revocation |
| **Ký code cho binary desktop** (Authenticode/notarization) | Chỉ hai lần nhắc thoáng qua: `constitution.md` và `entitlements.plist` | `[KHÔNG]` Không có tài liệu quản lý khóa ký cấp ứng dụng. Đối chiếu: `core.md` ghi nhận `tomnicore 0.1.16` là **"Không ký (unsigned)"** |
| **Agent Capsule format** | Kiểu package được định nghĩa về mặt phân loại trong 4 tài liệu | `[KHÔNG]` Không có manifest schema, không có runtime spec, không có artifact ví dụ. `entrypoints.capsule` xuất hiện trong schema mà không có định nghĩa phía sau |
| **UI Package format** | Bị ràng buộc chi tiết ở 5 tài liệu (được phép làm gì, cấm làm gì) | `[KHÔNG]` Không có manifest, không có spec version cho token contract, không có artifact ví dụ |
| **Cloud core (Continuum / Nexus / Resource Exchange)** | `complete-product-design` §16, `revenue-moat` §8.7-8.9 | `[ĐÍCH]` Thành phần cloud duy nhất có thật là `packages/cloud-relay` — một Durable Object đồng bộ workspace, **không phải Continuum** |
| **Tomni Account** | `docs/prds/tomni-account.md` (1302 dòng) | `[ĐÍCH]` Chính tài liệu đó nói rõ: "chưa được nối vào renderer, router, sidebar, settings, core, database, telemetry, WebUI hoặc bất kỳ surface nào". `packages/tomni-account-kit/README.md` xác nhận không có import nào từ `packages/desktop` |
| **ChatGPT/Claude bridge như một thành phần** | `complete-product-design` §15 mô tả "Tomni Agent Bridge" | `[KHÔNG]` như một thành phần riêng. Cái tồn tại là Omni Gateway — một MCP server loopback mà ChatGPT/Claude Desktop/Cursor *tiêu thụ*. Hướng dữ liệu ngược lại với cách tài liệu mô tả |
| **Electron permission handler** | — | `[KHÔNG]` Không có `session.setPermissionRequestHandler` / `setPermissionCheckHandler` ở đâu cả — yêu cầu camera/mic/geolocation từ nội dung web nhúng đang chạy theo mặc định Electron |
| **CSP header / navigation allowlist** | — | `[KHÔNG]` Không có `onHeadersReceived` gắn CSP, không có `<meta http-equiv>` trong `renderer/index.html`, không có `will-navigate` handler, không có `setWindowOpenHandler` trên cửa sổ chính. CSP duy nhất trong app là cái nằm trong iframe package |
| **Egress allowlist toàn cục** | — | `[KHÔNG]` Không có proxy, không có fetch wrapper toàn cục, không có `session.setProxy` / `setCertificateVerifyProc` / `webRequest.onBeforeRequest`. Chỉ có allowlist theo từng tính năng (update download, package artifact, secret target của browser) |

---

## 2. Tài sản cần bảo vệ

Phân loại theo mức độ thiệt hại khi mất, không theo mức độ "quan trọng cảm tính". Cột **Khả năng bảo vệ thực tế** là phần quan trọng nhất — nó ngăn việc đầu tư vào thứ không bảo vệ được.

### 2.1 Bảng tài sản

| # | Tài sản | Vị trí thực tế | Mất thì sao | Khả năng bảo vệ thực tế |
| --- | --- | --- | --- | --- |
| A1 | **Khóa ký private của Tomni Store** | **Không nằm trong repo này.** Chỉ có public key `[CÓ]` `catalog.ts:19-36` | Kẻ tấn công ký được package tùy ý → chiếm quyền mọi máy cài đặt. **Đây là tài sản có bán kính thiệt hại lớn nhất trong toàn hệ thống** | **Cao** — nếu để trong HSM/KMS và không bao giờ rời khỏi đó |
| A2 | **Tomni Core (`tomny-core` binary)** | `bundled-tomny-core/<platform>-<arch>/`; nguồn ở repo riêng | Đối thủ có được logic backend | **Thấp.** Binary chạy trên máy người dùng ⇒ dịch ngược được. Chỉ tăng chi phí, không chặn |
| A3 | **Package `.tomny` của nhà phát triển** | `userData/tomny-packages/<packageId>/<version>/` `[CÓ]` | Code của nhà phát triển bị sao chép; nếu là package trả phí thì mất doanh thu | **Rất thấp** với JS. Xem §4.8 |
| A4 | **Trọng số model AI và adapter** | `[ĐÍCH]` — chưa có model pack nào active | Tài sản training bị sao chép | **Thấp** cục bộ; **Cao** nếu chỉ chạy trên cloud |
| A5 | **Credential người dùng: API key nhà cung cấp AI** | `userData/tomny-providers.json` qua `safeStorage` `[CÓ]` | Hóa đơn API của người dùng bị lạm dụng; đây là **thiệt hại tài chính trực tiếp cho người dùng** | **Trung bình.** Có lỗ hổng — xem §3.7 |
| A6 | **Credential người dùng: token OAuth, git, database** | `omni-gateway-security.json`, `gitCredentialStore`, `dbConnectionStore` `[CÓ]` | Truy cập repo và database của người dùng | **Trung bình đến thấp** — hai store dùng khóa tất định, xem §3.7 |
| A7 | **Workspace và mã nguồn của người dùng** | Thư mục repo do người dùng chọn | Rò rỉ IP của người dùng hoặc khách hàng họ. **Với người dùng doanh nghiệp đây là tài sản đắt nhất** | **Trung bình.** Bị giới hạn bởi việc agent có toàn quyền ghi trong workspace |
| A8 | **Dữ liệu cá nhân: task, note, lịch, hội thoại** | `userData/manager-data.json` (`0o600`) `[CÓ]`, SQLite của core, `userData/companies/<id>/` (`soul.md`, `memory.md`) `[CÓ]` | Rò rỉ đời tư | **Trung bình** |
| A9 | **Receipt, catalog, registry, lịch sử cài đặt** | `userData/tomny-packages/installed.json` `[CÓ]`; catalog từ GitHub Releases `[CÓ]` | Sửa được registry ⇒ vô hiệu hóa quarantine, giả trạng thái "đã xác minh" | **Trung bình.** Hiện chỉ có checksum ở permission store, **registry package không có checksum** |
| A10 | **Bản thân cây quyết định permission** | `userData/tomny-core/permissions.json` + checksum SHA-256 `[CÓ]` | Kẻ tấn công tự cấp quyền `always` cho chính mình | **Thấp hiện tại** — checksum ngăn hỏng dữ liệu, **không ngăn giả mạo có chủ đích** (kẻ ghi được file thì tính lại checksum được) |
| A11 | **Danh tiếng chữ ký của publisher** | `[ĐÍCH]` | Một package độc hại được ký lọt qua sẽ đầu độc niềm tin vào toàn bộ Store | **Cao** với quy trình review đúng |

### 2.2 Nhận định phải nói thẳng về A2/A3/A4

Nhiều tài liệu trong repo đặt kỳ vọng bảo vệ "công nghệ độc quyền" ở phía client. **Kỳ vọng đó không đạt được.** Một binary hoặc bundle JS chạy trên máy người dùng thì luôn có thể bị đọc, dump khỏi bộ nhớ, và phân tích. Obfuscation, mã hóa asset, packer chỉ làm chậm người phân tích từ vài giờ lên vài ngày.

Cách bảo vệ thật sự là **kiến trúc, không phải kỹ thuật che giấu**: giữ phần có giá trị nhất ở nơi khách hàng không chạy được (§4.9), và biến giá trị từ "code bí mật" thành "dữ liệu + hiệu ứng mạng + tính liên tục dịch vụ". Điều này phải là một quyết định sản phẩm, không phải một hạng mục kỹ thuật.

---

## 3. Ranh giới tin cậy và đường tấn công

### 3.1 Bản đồ ranh giới tin cậy

```
                     ┌─────────────────────────────────────────────┐
   INTERNET          │  T0 · KHÔNG TIN CẬY                         │
   ────────          │  GitHub Releases (catalog + artifact)       │
                     │  Nhà cung cấp AI · Open-Meteo               │
                     │  Trang web mà browser/web-agent mở          │
                     │  Cloudflare Quick Tunnel (khi bật)          │
                     └───────────────────┬─────────────────────────┘
                                         │ HTTPS + chữ ký Ed25519 [CÓ]
                                         │ ↑ nhưng KHÔNG có revision/expiry [KHÔNG]
   ══════════════════════════════════════╪══════════════════════════ TB-1
                     ┌───────────────────┴─────────────────────────┐
   MÁY NGƯỜI DÙNG    │  T1 · ELECTRON MAIN (tin cậy hoàn toàn)     │
                     │  Node đầy đủ · fs · child_process · secret  │
                     │  PackageManagerService · permissionStore    │
                     │  Secret Firewall · MCP host · Omni Gateway  │
                     └───┬──────────────┬───────────────┬──────────┘
                         │              │               │
        IPC 1 kênh gộp   │              │ spawn         │ loopback HTTP
        KHÔNG xác thực   │              │               │ KHÔNG auth
        sender [KHÔNG]   │              │               │ [KHÔNG]
   ══════════════════════╪══════════════╪═══════════════╪══════════ TB-2 (yếu)
                     ┌───┴────────┐ ┌───┴─────────┐ ┌───┴──────────┐
                     │ T2·RENDERER│ │ T2·tomny-   │ │ T2·tomny-    │
                     │ React + IDE│ │ core (Rust) │ │ runtime      │
                     │ +trusted-  │ │ chạy --local│ │ sidecar      │
                     │  react pkg │ │ [CÓ, xác    │ │ không network│
                     │            │ │  minh dòng  │ │ [CÓ]         │
                     │            │ │  460]       │ │              │
                     └───┬────────┘ └─────────────┘ └──────────────┘
                         │
        iframe sandbox   │ ← KHÔNG phải security boundary khi thiếu
        [CÓ nhưng tắt]   │   process isolation. Xem §3.4
   ══════════════════════╪══════════════════════════════════════ TB-3 (danh nghĩa)
                     ┌───┴─────────────────────────────────────────┐
                     │  T3 · PACKAGE CỘNG ĐỒNG (chưa tồn tại)      │
                     │  sandboxed-web bị chặn mặc định [CÓ]        │
                     └─────────────────────────────────────────────┘
```

### 3.2 Đường tấn công AP-1 — Rollback / freeze / replay qua catalog

**Nghiêm trọng: P0.**

`[CÓ]` Catalog envelope thực tế:

```ts
// remoteCatalog.ts:23-27
export type RemotePackageCatalogDocument = {
  schemaVersion: 1;
  generatedAt: string;
  packages: PackageCatalogEntry[];
};
```

Chuỗi tấn công:

1. Kẻ tấn công ở vị trí mạng (hoặc kiểm soát cache/CDN) giữ lại một bản catalog **cũ nhưng hợp lệ**, ký đúng.
2. Client tải catalog cũ đó. Mọi chữ ký manifest đều verify thành công vì chúng thật.
3. Người dùng ở lại phiên bản package có lỗ hổng đã biết, **vô thời hạn**.
4. `generatedAt` là một chuỗi tự khai báo, không được ký ở cấp catalog và không được so sánh với bất kỳ trạng thái nào trước đó ⇒ không phát hiện được.

Tình huống xấu hơn: client mất mạng dài hạn thì rơi vào cache. `production-readiness-report.md` ghi nhận cache fallback **không giới hạn tuổi** ⇒ freeze vô hạn.

Lưu ý: `PackageManagerService.ts:546` **có** từ chối hạ cấp phiên bản đã cài. Cái đó chặn rollback *sau khi đã cài*, không chặn việc **giữ người dùng ở lại** phiên bản cũ ngay từ đầu. Hai vấn đề khác nhau và tài liệu trong repo đang lẫn lộn chúng.

### 3.3 Đường tấn công AP-2 — IPC là ranh giới yếu nhất trong hệ thống

**Nghiêm trọng: P0.**

`[CÓ]` Toàn bộ traffic renderer → main đi qua **một kênh duy nhất**:

```ts
// common/adapter/main.ts:93
ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, (_event, info) => {
  const { name, data } = JSON.parse(info) as BridgeEventData;
  return Promise.resolve(emitter.emit(name, data));
});
```

Ba vấn đề đồng thời:

1. **`_event` bị vứt bỏ.** Không có `event.senderFrame` origin check, không có allowlist `webContents.id`. Bất kỳ frame nào chạm được preload đều điều khiển được **mọi** bridge.
2. **Không có allowlist kênh.** Một kênh gộp proxy mọi tên bridge — `conversation.*`, `native-fs.*`, `shell.open-external`, `personal-secrets.*`, `omni-gateway.rotate-token`. Preload không thể lọc thứ nó không liệt kê.
3. **Không có schema validation ở biên.** Kết quả `JSON.parse` được ép kiểu `BridgeEventData` mà không kiểm tra. Từng provider tự validate rời rạc: `shell.check-tool-installed` có regex tốt (`applicationBridge.ts:181`), còn `shell.openExternal` nhận URL tùy ý **không có allowlist scheme**.

Điều này trở nên nghiêm trọng vì `[CÓ]` cửa sổ chính bật `webviewTag: true` (`index.ts:357`) và `[CÓ]` `WebviewHost.tsx:478` đặt `webpreferences='contextIsolation=no, ...'`. Nội dung web bên ngoài render trong một webview đã tắt contextIsolation là con đường thẳng tới bề mặt IPC.

Chuỗi khai thác đầy đủ: trang web độc hại → webview không có contextIsolation → chạm preload → `shell.openExternal` với scheme tùy ý, hoặc `native-fs.*` để đọc workspace, hoặc lấy `__backendPort` rồi gọi thẳng API core.

### 3.4 Đường tấn công AP-3 — Sandbox package hiện đảo ngược so với thiết kế

**Nghiêm trọng: P0 khi mở Store cộng đồng. Hiện tại chưa khai thác được vì cộng đồng chưa mở.**

`[CÓ]` Sự thật trong mã:

- `PackageAppHost.tsx:216` — `allowSandboxedWeb = false` là mặc định.
- `IdeExtensionsPanel.tsx:218` — call site duy nhất truyền `allowSandboxedWeb={false}`.
- ⇒ **Package `sandboxed-web` — loại duy nhất thực sự bị cô lập — không chạy được.**
- `PackageAppHost.tsx:181-194` — `trusted-react` chạy qua `import(blobURL)` **trực tiếp trong renderer chính**, không cô lập gì cả.

Nghịch lý: package duy nhất chạy được là package **không** được sandbox. Package duy nhất được sandbox thì **không** chạy được. Artifact `com.tomni.calculator` (`sandboxed-web`, CSP `default-src 'none'`) nằm trong catalog nhưng không khởi động được.

Cổng tin cậy `[CÓ]` `isTrustedReactModule` có kiểm tra `listing.trust === 'signed-first-party' && publisherId === 'com.tomni'` — đúng hướng, và hiện tại là thứ duy nhất giữ hệ thống an toàn. Nhưng `tomni-package-backend-mvp.md` §1A.10 tự thừa nhận: **"`trusted-react` permissions mới là khai báo, chưa phải capability enforcement"**. Permission trong manifest hiện là chú thích, không phải cơ chế.

**Về iframe:** `tomnihubos-ui-ux-design-brief.md` đã ghi đúng — "không coi `iframe` tự thân là ranh giới bảo mật". Tôi xác nhận và nói rõ hơn: iframe `allow-scripts` không có `allow-same-origin` là một ranh giới **DOM/origin** tốt, nhưng nó **không phải ranh giới process**. Nó không chống Spectre-class side channel, không giới hạn CPU/RAM, và bug renderer nào cũng xuyên qua nó. Xem §4.5 cho ranh giới thật.

### 3.5 Đường tấn công AP-4 — Backend loopback không xác thực

**Nghiêm trọng: P0.**

`[CÓ]` Xác minh trực tiếp: `packages/web-host/src/backend-launcher.ts:460` truyền `local: true`, và `:169` biến nó thành cờ `--local` cho `tomny-core`. Đây là **cứng, không có nhánh nào khác** trong đường khởi động desktop.

`core.md` §8 rủi ro #1 mô tả ý nghĩa của `--local`: **"bỏ JWT và cho CORS mọi origin"**. Tôi không đọc được mã Rust nên đây là claim từ tài liệu, **cần xác nhận ở repo core trước khi hành động** — nhưng nếu đúng thì hệ quả là:

- `[CÓ]` `ipcMain.on('get-backend-port')` trả cổng **đồng bộ** cho renderer.
- `[CÓ]` `common/adapter/httpBridge.ts` gọi `fetch('http://127.0.0.1:<port>/api/...')` **không có Authorization**.
- ⇒ Bất kỳ process cục bộ nào (kể cả một script Node do người dùng vô tình chạy, hoặc phần mềm khác trên máy) quét cổng loopback là gọi được **toàn bộ API file / shell / secret / channel / agent** của core.
- ⇒ Với CORS `*`, một trang web bất kỳ trong trình duyệt hệ thống có thể thử tấn công DNS-rebinding hoặc gọi trực tiếp nếu đoán được cổng.

`core.md` §8 rủi ro #2 bổ sung: **"Một process có quyền file, shell, secret, channel và agent"** — không có phân tách đặc quyền bên trong core.

### 3.6 Đường tấn công AP-5 — Chuỗi cung ứng binary

**Nghiêm trọng: P0.**

`[CÓ]` `binaryResolver.ts:141-152` giải quyết `tomny-core` theo thứ tự: dev-local → bundled → **`where`/`which` trên PATH hệ thống**. Không có hash pin, không kiểm tra Authenticode, không xác minh chữ ký.

⇒ Một file `tomny-core.exe` nằm sớm hơn trên PATH sẽ được thực thi làm backend của ứng dụng, với toàn quyền của người dùng. Đây là một con đường leo thang đặc quyền cổ điển và đặc biệt nguy hiểm trên Windows.

Đối chiếu nội bộ đáng chú ý: `[CÓ]` sidecar `tomny-runtime` **có** xác minh SHA-256 manifest (`hybrid-runtime-architecture.md`). Hai binary trong cùng ứng dụng, hai tiêu chuẩn khác nhau. Cái được bảo vệ tốt hơn lại là cái ít đặc quyền hơn.

Thêm: `docs/tomny-core-parity.md` ghi nhận một lỗ hổng tái lập build — manifest `bundled-tomny-core` ghi một source repository, còn build recipe hiện dùng URL repo khác, và **kiểm tra cache-match xác thực version/commit/recipe nhưng không xác thực định danh repository**.

### 3.7 Đường tấn công AP-6 — Khóa mã hóa tất định cho credential

**Nghiêm trọng: P1.**

`[CÓ]` Hai store dùng AES-256-GCM với **khóa = `SHA-256(đường dẫn userData)`**:

- `process/omni-gateway/omniGatewaySecurityStore.ts` — bearer token, OAuth token
- `process/automation/credentialStore.ts` — credential automation

Đường dẫn userData không phải bí mật. Bất kỳ process cục bộ nào cũng suy ra được khóa. **Đây là obfuscation, không phải mã hóa** — và đáng lo hơn vì nó *trông giống* mã hóa nên dễ được coi là đã giải quyết.

`[CÓ]` Vấn đề thứ hai: `tomnyProviderStore.ts:50-56` dùng `safeStorage` nhưng **âm thầm fallback sang base64 thuần** khi `isEncryptionAvailable()` trả false, đánh dấu bằng cờ `osEncrypted`. Trên Linux thiếu libsecret, API key nhà cung cấp AI nằm ở dạng base64 — tức là plaintext.

`[CÓ]` Vấn đề thứ ba: config MCP server (kể cả `env` và `headers` chứa token) lưu **JSON thuần**, không qua `safeStorage`, trong `mcpRegistry.ts` + `initStorage.ts`.

### 3.8 Đường tấn công AP-7 — Data exfiltration qua kênh không được kiểm soát

**Nghiêm trọng: P1.**

`[CÓ]` Outbound inspection tồn tại và fail-closed đúng, nhưng chỉ ở **2 call site**. Các kênh egress sau **hoàn toàn không đi qua nó**:

| Kênh | Trạng thái |
| --- | --- |
| Kết quả tool MCP / Agent Mesh / IDE | `[KHÔNG]` không inspect |
| Điều hướng browser, trích xuất nội dung trang | `[KHÔNG]` không inspect |
| Prompt của web agent gửi lên model | `[KHÔNG]` — `pagePerception.ts` có `redactAgentVisibleText` cho chiều *vào*, chiều *ra* không có |
| Tham số lệnh, cwd, stdout, stderr | `[KHÔNG]` |
| File đọc / attachment / upload | `[KHÔNG]` — hàm `inspectOutboundFileText` đã viết nhưng không có call site |
| Ảnh / screenshot / OCR / multimodal | `[KHÔNG]` — `inspectOutboundImage` đã viết nhưng không có call site |
| `RotatingApiClient`, REST/WS nhà cung cấp | `[KHÔNG]` |
| **`fetch` trực tiếp từ renderer** | `[KHÔNG]` — `.kiro/specs/tomni-security-core/design.md` §4 nêu rõ đây là thứ phải loại bỏ |
| Sentry | `[CÓ]` gửi đi, `beforeSend` chỉ lọc nhiễu GPU crash, **không scrub PII**, kèm device id bền vững qua `Sentry.setUser({id})` |
| Open-Meteo (Personal Manager) | `[ĐÍCH]` theo thiết kế, có công tắc tắt; rò tên địa danh của người dùng khi bật |

Thêm một điểm cần nói rõ: cả 2 call site đang hoạt động đều truyền `allowSanitize: true, requireApprovalForFindings: false` và **không truyền callback `authorize`**, nên `authorize` mặc định `true`. Móc nối permission đã có nhưng chưa được dùng. `securityAdapter.targetPreflight` (`:51-61`) là stub trả `allow` cứng.

### 3.9 Đường tấn công AP-8 — Prompt injection điều khiển control plane của agent

**Nghiêm trọng: P1.**

`.kiro/specs/agent-company-pipeline/design.md` mô tả một control plane do model điều khiển: LLM trả về JSON trong fenced block với `{"mode": "delegate" | "execute" | "request_approval" | "request_test" | "finish"}`. `delegationPlanner` chỉ validate rằng `childId` là **con trực tiếp**. Không có validation nào khác được nêu.

Kết hợp với hai yếu tố:

- Requirement 9.2 giao cho **chính LLM** việc gán capability cho các role ("chỉ cấp đủ dùng; super-mode/full-access cấp dè").
- Agent thực thi là CLI agent thật, có quyền ghi file thật trong workspace.

⇒ Nội dung độc hại trong repo người dùng (một comment trong code, một file README, một issue được fetch về) có thể thao túng directive mà model phát ra. Ranh giới duy nhất là "workspace scoping của chính CLI agent" — theo `requirements.md` §8.3 — **đây là giả định, không phải cơ chế thực thi**.

Đối chiếu tích cực: spec `personal-manager` có tính chất **P4 "Đề xuất không tự ghi"** — mọi output AI là đề xuất, cần người dùng chấp nhận rõ ràng. Đây là biện pháp giảm thiểu prompt injection **thật, kiểm thử được**, và nên là khuôn mẫu cho toàn hệ thống chứ không chỉ cho Personal Manager.

### 3.10 Đường tấn công AP-9 — Bề mặt Omni Gateway khi bật tunnel

**Nghiêm trọng: P1 khi bật, P3 khi tắt.**

`[CÓ]` Gateway có auth tốt (`timingSafeEqual`, allowlist tool hai tầng, OAuth DCR). Nhưng `omniGatewayTunnel.ts` cho phép phơi server loopback ra Internet qua **Cloudflare Quick Tunnel**. Khi đó:

- Bề mặt chuyển từ loopback sang public.
- Token auth ở trạng thái nghỉ được bảo vệ bằng khóa tất định (§3.7).
- URL Quick Tunnel là ngẫu nhiên nhưng **không phải bí mật** — nó xuất hiện trong log Cloudflare và có thể lộ.

`docs/guides/deploy-server.md` còn tệ hơn ở kịch bản headless: công thức chính thức chạy `Tomny --webui --remote --no-sandbox` dưới `xvfb-run`, phơi trên `http://<host>:25808`. `--no-sandbox` **tắt sandbox Chromium**, và script khởi động trong tài liệu không nhắc TLS, reverse proxy hay xác thực ở bước đó.

### 3.11 Ma trận đường tấn công × tài sản

| Đường tấn công | A1 khóa ký | A2 Core | A3 package | A5/A6 credential | A7 workspace | A8 dữ liệu cá nhân | A9/A10 registry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AP-1 rollback catalog | — | — | ● | — | ● | — | ● |
| AP-2 IPC không xác thực | — | — | — | ●●● | ●●● | ●●● | ●● |
| AP-3 sandbox đảo ngược | — | — | ● | ●●● | ●●● | ●●● | ●● |
| AP-4 loopback không auth | — | ● | — | ●●● | ●●● | ●●● | ● |
| AP-5 chuỗi cung ứng binary | — | ●● | ● | ●●● | ●●● | ●●● | ●●● |
| AP-6 khóa tất định | — | — | — | ●●● | — | — | — |
| AP-7 exfiltration | — | — | — | ●● | ●●● | ●●● | — |
| AP-8 prompt injection | — | — | — | ● | ●●● | ●● | — |
| AP-9 gateway/tunnel | — | — | — | ●● | ●●● | ●● | — |
| **Rò rỉ khóa ký private** | ●●● | — | ●●● | ●●● | ●●● | ●●● | ●●● |

`●●●` thiệt hại trực tiếp · `●●` thiệt hại gián tiếp · `●` thiệt hại hạn chế

Đọc bảng theo cột: **hàng cuối cùng cho thấy rò rỉ A1 là sự kiện duy nhất làm sập mọi cột cùng lúc.** Đó là lý do §4.1 đứng đầu phần đề xuất.

---

## 4. Đề xuất kiến trúc

Mỗi đề xuất kèm **tác động hiệu năng** và **tác động UX** như yêu cầu. Không đề xuất nào giả định backend hay security gate đã tồn tại.

### 4.1 Root of trust và hệ thống khóa ký

**Trạng thái hiện tại `[CÓ]`:** 2 khóa Ed25519 cứng trong `catalog.ts`, không rotation, không revocation, không tài liệu custody.

**Đề xuất `[ĐÍCH]` — cấu trúc khóa ba tầng:**

```
Tầng 0 · ROOT KEY (offline)
  Ed25519, sinh và lưu trong HSM hoặc KMS có kiểm toán truy cập
  KHÔNG BAO GIỜ ký artifact. Chỉ ký Trust Bundle.
  Vòng đời 5 năm. Ngưỡng M-of-N để dùng.
       │ ký
       ▼
Tầng 1 · TRUST BUNDLE (nhúng trong app, cập nhật theo bản phát hành)
  { bundleVersion, notBefore, notAfter,
    keys: [{ keyId, publicKey, role, publisherId, notBefore, notAfter, status }],
    revoked: [{ keyId | packageId@version | artifactSha256, reason, since }] }
       │ ủy quyền cho
       ▼
Tầng 2 · SIGNING KEYS (online, trong KMS, tự động ký)
  role: 'catalog'  → chỉ ký Catalog Envelope
  role: 'artifact' → chỉ ký manifest package
  Vòng đời 12 tháng, chồng lấn 90 ngày khi xoay khóa
```

**Bốn quy tắc bắt buộc:**

1. **Phân tách vai trò.** Khóa ký catalog và khóa ký artifact phải khác nhau. Hiện tại `catalog.ts` không phân biệt vai trò — cả hai keyId đều là `signed-first-party` chung chung. Tách vai trò giới hạn thiệt hại khi một khóa rò rỉ.
2. **Trust anchor duy nhất là root public key.** Nó là thứ duy nhất được hardcode. Mọi khóa khác đến từ Trust Bundle đã ký.
3. **Trust Bundle có `notAfter`.** Client từ chối bundle hết hạn và rơi về bundle nhúng trong app. Điều này biến "khóa không rotation được" thành "khóa hết hạn tự động".
4. **Danh sách thu hồi nằm trong Trust Bundle**, không phải endpoint riêng — để nó thừa hưởng cùng cơ chế chống rollback (§4.2).

**Tác động hiệu năng:** Xác minh thêm một chữ ký Ed25519 cho Trust Bundle khi khởi động. Ed25519 verify ≈ 50 μs. Không đo được bằng mắt thường. Bundle < 32 KB.

**Tác động UX:** Không có ở đường bình thường. Khi khóa bị thu hồi, người dùng thấy package chuyển sang trạng thái "cần chú ý" — cần thiết kế UI (ngoài phạm vi tài liệu này). Rủi ro UX chính là **dương tính giả**: nếu logic hết hạn sai, người dùng đột ngột mất app. Vì vậy client phải rơi về bundle nhúng thay vì chặn cứng.

**Cần quyết định (xem §7):** Root key ở HSM vật lý hay cloud KMS. Ai giữ M-of-N.

### 4.2 Catalog envelope chống rollback

**Trạng thái hiện tại `[CÓ]`:** `{schemaVersion, generatedAt, packages[]}` — không revision, không expiry, không chữ ký cấp catalog.

**Đề xuất `[ĐÍCH]`:**

```jsonc
{
  "schemaVersion": 2,
  "envelope": {
    "revision": 1247,              // Đơn điệu tăng. Client TỪ CHỐI revision < đã thấy.
    "issuedAt": "2026-07-26T09:00:00Z",
    "expiresAt": "2026-07-29T09:00:00Z",   // TTL ngắn: 72 giờ
    "catalogId": "tomni-store-v1",
    "previousRevisionHash": "sha256-...",  // Chuỗi hash, phát hiện phân nhánh catalog
    "packagesHash": "sha256-..."           // Hash của mảng packages đã chuẩn hóa
  },
  "packages": [ /* … */ ],
  "signature": {                    // Chữ ký BAO TRÙM toàn bộ envelope + packagesHash
    "algorithm": "ed25519",
    "keyId": "tomni-catalog-2026-03",
    "value": "…"
  }
}
```

**Luật client `[ĐÍCH]`:**

| Điều kiện | Hành động |
| --- | --- |
| `revision` < revision cao nhất đã thấy | **Từ chối.** Ghi sự kiện `catalog.rollback_detected` |
| `expiresAt` đã qua | Dùng nhưng đánh dấu `stale`. Sau **7 ngày** stale, chặn cài mới nhưng **không** chặn app đang chạy |
| `previousRevisionHash` không khớp chuỗi đã biết | Cảnh báo, ghi `catalog.fork_detected`, vẫn cho dùng nếu chữ ký hợp lệ |
| Chữ ký sai hoặc keyId không có trong Trust Bundle | **Từ chối tuyệt đối.** Rơi về cache đã ký, rồi về bundled |
| Cache cục bộ quá **30 ngày** | Coi như không có. Hiển thị "không kết nối được Store" |

Revision cao nhất đã thấy lưu trong file có checksum, và **checksum đó phải là MAC** — xem §4.10 về vấn đề checksum-vs-MAC.

**Tác động hiệu năng:** Một Ed25519 verify nữa cho envelope (≈50 μs) + một SHA-256 trên mảng packages. Với catalog 2000 entry ≈ vài MB, hash mất ~10 ms. Không đáng kể so với round-trip mạng.

**Tác động UX:** TTL 72 giờ nghĩa là người dùng offline dài hạn sẽ thấy trạng thái "stale". Đây là đánh đổi có chủ đích: quá ngắn thì gây phiền cho người dùng offline, quá dài thì cửa sổ freeze rộng. **72 giờ / chặn cài sau 7 ngày / bỏ cache sau 30 ngày** là điểm cân bằng tôi đề xuất, nhưng nó là một tham số sản phẩm cần quyết định (§7).

**Lưu ý về tương thích:** `schemaVersion: 2` cho phép client mới đọc catalog cũ (v1) trong giai đoạn chuyển tiếp, đánh dấu nó `unverified-envelope` và ghi cảnh báo, nhưng vẫn hoạt động. Đây là điều kiện để lát cắt này không phá tương thích (§9).

### 4.3 Capability grant theo once / session / workspace / always

**Trạng thái hiện tại `[CÓ]`:** `permissionStore.ts` có scope `{subjectId, sessionId, surfaceId, capabilityId, toolPattern}`, lifetime `allow-once | session | persistent`, deny thắng, hết hạn, audit log. **Không có `workspace`.**

Đây là nền tảng tốt hơn nhiều tài liệu trong repo thừa nhận. Đề xuất là **mở rộng nó**, không thay thế — và tuyệt đối không tạo runtime bảo mật thứ hai (điều `tomni-security-core` cấm rõ ràng).

**Đề xuất `[ĐÍCH]` — bốn thay đổi:**

**(1) Thêm lifetime `workspace`**

```ts
type PermissionGrantLifetime =
  | 'allow-once'   // [CÓ] remainingUses = 1
  | 'session'      // [CÓ] gắn sessionId
  | 'workspace'    // [ĐÍCH] gắn workspaceId, tồn tại qua restart
  | 'persistent';  // [CÓ] "always"
```

`workspace` là mức thiếu quan trọng nhất về mặt UX. Người dùng muốn nói "agent này được đọc repo *này*" mà không phải nói "được đọc mọi repo mãi mãi". Không có nó, người dùng bị đẩy về `persistent` vì `session` quá phiền — đây là cách các permission model thường thất bại trong thực tế.

`workspaceId` phải là **hash của đường dẫn workspace đã chuẩn hóa** (`sha256(realpath)`), không phải bản thân đường dẫn — để đổi tên thư mục không âm thầm chuyển quyền, và để đường dẫn không nằm trong file grant.

**(2) Bổ sung `runId` và `taskId` vào scope**

`.kiro/specs/tomni-three-core-foundation/requirements.md` §2.2 đã xác định đúng thứ còn thiếu. Bổ sung:

```ts
type PermissionScope = {
  subjectId: string;      // [CÓ]
  sessionId?: string;     // [CÓ]
  surfaceId: string;      // [CÓ]
  capabilityId: string;   // [CÓ]
  toolPattern?: string;   // [CÓ]
  workspaceId?: string;   // [ĐÍCH]
  runId?: string;         // [ĐÍCH] một lần thực thi
  taskId?: string;        // [ĐÍCH] một nhánh trong cây agent
  packageId?: string;     // [ĐÍCH] package nào yêu cầu
};
```

**(3) Ba bất biến bắt buộc**

Hai cái đầu đã có trong `tomni-three-core-foundation`; tôi thêm cái thứ ba:

- **Lease không cấp capability.** ResourceCoordinator cấp phát tài nguyên, không cấp quyền. `[CÓ]` đã được nêu trong `tomni-efficiency-core/design.md`.
- **Context không cấp capability.** Việc dữ liệu nằm trong context không cho phép gửi nó đi.
- **`[ĐÍCH]` Capability không kế thừa xuống con.** Trong cây agent company, role con phải được cấp riêng. Hiện `delegationPlanner` chỉ validate quan hệ cha-con, không validate capability. Không có luật này, một leaf worker thừa hưởng quyền của root.

**(4) Broker cấp token ngắn hạn**

Thay vì để mỗi surface tự hỏi permission store, tất cả đi qua một broker cấp **capability token** có TTL:

```
requestCapability({ scope, capabilityId, target })
  → tra permissionStore [CÓ]
  → nếu chưa có grant: hỏi người dùng, ghi grant theo lifetime đã chọn
  → cấp token { capabilityId, target, scope, expiresAt: now + 300s, nonce }
  → adapter thực thi TỪ CHỐI làm việc nếu không có token hợp lệ
```

TTL 300 giây là đề xuất khởi điểm. Token phải gắn `target` cụ thể (đường dẫn file, host mạng), không phải capability chung chung — đây là khác biệt giữa "được đọc file" và "được đọc `/home/x/proj/src/a.ts`".

**Tác động hiệu năng:** Broker nằm trên đường nóng của mọi lời gọi tool. Cần cache quyết định trong bộ nhớ theo key scope; lookup dự kiến < 1 ms nếu là map trong RAM. Vấn đề thật là số lần **ghi**: mỗi grant mới là một atomic write. Với `allow-once` trong vòng lặp agent, đây có thể là hàng trăm lần ghi. **Bắt buộc gom ghi (batch) với debounce ~500 ms và ghi ngay khi thoát.**

**Tác động UX:** Đây là rủi ro UX lớn nhất trong toàn bộ đề xuất. Nếu làm sai, người dùng gặp bão prompt và sẽ tắt hết. Ba biện pháp giảm thiểu:

- Prompt phải hỏi ở **mức capability**, không ở mức từng lời gọi. "Agent này được đọc workspace" chứ không phải "được đọc file A", rồi B, rồi C.
- **Gom prompt theo lô** khi một run xin nhiều capability cùng lúc, hiển thị một hộp thoại có danh sách.
- Mặc định của nút phải là **lựa chọn hẹp nhất** (`allow-once`), không phải `always`. Đây là điều khác biệt giữa permission model có ý nghĩa và permission model chỉ là thủ tục.

### 4.4 Egress policy và bản xem trước dữ liệu

**Trạng thái hiện tại `[ĐANG]`:** cơ chế tốt, độ phủ ≈ 2/15 kênh (§3.8).

**Đề xuất `[ĐÍCH]` — không thiết kế lại, chỉ mở rộng độ phủ theo thứ tự rủi ro:**

| Đợt | Kênh cần đưa vào seam | Lý do xếp trước |
| --- | --- | --- |
| E1 | Kết quả tool MCP/Agent Mesh/IDE | Kênh mà prompt injection dùng để lấy dữ liệu ra |
| E2 | `fetch` trực tiếp từ renderer → thay bằng seam ở main | Đường vòng qua mọi kiểm soát; spec đã xác định phải loại bỏ |
| E3 | Tham số lệnh + stdout/stderr | Secret thường xuất hiện ở dòng lệnh |
| E4 | File đọc / attachment / upload | Hàm `inspectOutboundFileText` đã viết, chỉ cần nối dây |
| E5 | Ảnh / screenshot / OCR | `inspectOutboundImage` đã viết, chỉ cần nối dây |
| E6 | Browser navigation + trích xuất trang | Khối lượng lớn, cần tối ưu trước |

**Egress policy theo target `[ĐÍCH]`** — hiện không có allowlist toàn cục:

```
default: deny-with-prompt
allow-always:  endpoint nhà cung cấp AI đã cấu hình
               (chỉ hostname chính xác — mẫu đã đúng ở secretVault.ts:67 [CÓ])
               host update đã allowlist [CÓ, updateBridge.ts:190-233]
               host artifact package [CÓ, packageDownloader.ts]
prompt-once:   host mới do người dùng hoặc agent khởi xướng
deny:          dải IP private/loopback từ ngữ cảnh không tin cậy
               (mẫu đã đúng ở packageDownloader.ts:41-96 [CÓ])
```

Ba mẫu allowlist tốt đã tồn tại trong mã. Vấn đề là chúng rời rạc theo từng tính năng. Đề xuất là **rút ra một module dùng chung**, không phải viết mới.

**Bản xem trước dữ liệu `[ĐÍCH]`** — khi quyết định là `approval_required`, người dùng phải thấy **chính xác cái gì sẽ đi ra**:

- Chỉ hiển thị `safeParts`. `.kiro/specs/tomni-security-core/design.md` đã quy định đúng: "`safeParts` là payload duy nhất được phép chuyển sang renderer, receipt hoặc adapter outbound tiếp theo".
- Vị trí đã redact hiển thị dạng `[AWS_ACCESS_KEY tại dòng 42]` — **loại secret + vị trí, không bao giờ hiển thị tiền tố token**. Tiền tố token là một dạng rò rỉ.
- Với payload lớn, hiển thị tóm tắt có cấu trúc (`3 file, 1.2 MB, 2 phát hiện`) + nút xem chi tiết, không dump toàn bộ.
- **Không timeout nào được tự động chấp thuận.** Spec đã quy định — tôi nhấn mạnh vì đây là chỗ dễ bị "tối ưu UX" làm hỏng.

**Tác động hiệu năng:** Đây là mối lo chính đáng nhất trong toàn bộ tài liệu. `secretFirewall.ts` chạy ~15 regex trên scan view đã chuẩn hóa. Với `MAX_TOTAL_LENGTH = 1_000_000`, chi phí mỗi lần inspect có thể đạt hàng chục ms. Nếu đặt lên **mọi** kết quả tool trong vòng lặp agent, nó tích lũy thành độ trễ thấy được.

Ba biện pháp:
- Chạy inspection ở **worker/sidecar**, không chặn main process. `tomny-runtime` `[CÓ]` là nơi phù hợp — nó đã có protocol có version và fail-closed.
- **Bỏ qua theo hash**: cache kết quả theo `sha256(nội dung)` cho nội dung không đổi. Vòng lặp agent thường gửi lại cùng một khối context nhiều lần.
- Với E6 (browser), inspect **tăng dần** trên phần delta, không phải toàn trang mỗi lần.

**Tác động UX:** Rủi ro là "prompt approval mệt mỏi" giống §4.3. Áp dụng cùng nguyên tắc: hỏi ở mức target (host, package), không mức từng request. Một khi người dùng đã duyệt "gửi context tới nhà cung cấp AI đã cấu hình", không hỏi lại từng lượt.

### 4.5 Ranh giới sandbox thật

**Nguyên tắc dứt khoát: iframe không phải ranh giới bảo mật.** `tomnihubos-ui-ux-design-brief.md` đã ghi đúng điều này và tôi xác nhận. Iframe `allow-scripts` không `allow-same-origin` cho ranh giới origin, **không** cho ranh giới process, **không** giới hạn tài nguyên, **không** chống side channel.

**Đề xuất `[ĐÍCH]` — bốn tầng theo mức tin cậy:**

| Tầng | Dành cho | Cơ chế | Ranh giới thật? |
| --- | --- | --- | --- |
| **S0 · Main** | Chỉ code first-party đi kèm installer | Không cô lập | Không |
| **S1 · Renderer chính** | Chỉ `trusted-react` + `signed-first-party` + `publisherId === 'com.tomni'` `[CÓ]` | Cổng tin cậy trong `isTrustedReactModule` `[CÓ]` | Không — hiện là mức duy nhất chạy được |
| **S2 · `utilityProcess` + iframe** `[ĐÍCH]` | Package UI cộng đồng | `utilityProcess` riêng, `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, iframe origin mờ **bên trong** process đó, CSP `default-src 'none'`, không có preload chung với hub | **Có** — cô lập process ở tầng OS |
| **S3 · Sidecar `tomny-runtime`** `[CÓ hạ tầng]` | Logic nền cộng đồng, code do model sinh | Process riêng, protocol có version fail-closed, không network listener, giới hạn process/arg/env/frame `[CÓ]` | **Có** — mạnh nhất hiện có |

**Vấn đề cần giải quyết trước:** `[KHÔNG]` `utilityProcess` chưa được dùng ở đâu trong repo (đã grep). Đây là hạng mục kỹ thuật mới, không phải cấu hình lại thứ đã có.

**Đường đi tối thiểu để có ranh giới thật, không phá tương thích:**

1. Giữ nguyên S1 cho package first-party hiện tại — không đổi gì, không có regression.
2. Bật `allowSandboxedWeb` cho **một** package pilot (`com.tomni.calculator` đã tồn tại `[CÓ]`) trong bản dev, chạy trong iframe hiện có. Điều này chứng minh đường S2 hoạt động về mặt chức năng trước khi đầu tư vào `utilityProcess`.
3. Chỉ khi bước 2 xong mới chuyển host iframe vào `utilityProcess`.
4. **Không mở Store cộng đồng trước khi bước 3 xong.** Đây là điều kiện đã được ghi trong `execution-roadmap` và tôi tán thành hoàn toàn.

**Tác động hiệu năng:** Mỗi `utilityProcess` tốn ~30-50 MB RAM và ~100-200 ms khởi động. Với nhiều package chạy đồng thời, đây là chi phí thật. Giảm thiểu bằng: một `utilityProcess` dùng chung cho các package **cùng mức tin cậy** (không phải mỗi package một process), khởi động lười khi package được mở lần đầu, và tắt sau thời gian không dùng. ResourceCoordinator `[CÓ]` là nơi đúng để quản việc này — nó đã có lease theo `kind` và trần bộ nhớ.

**Tác động UX:** Package sandbox hóa sẽ **chậm hơn khi mở lần đầu** (~200 ms) và **không** truy cập được API hub trực tiếp — mọi thứ qua capability bridge. Điều này sẽ khiến một số tính năng của package first-party hiện tại không chuyển sang S2 được nếu không viết lại. Cần chấp nhận: **một số package sẽ mãi ở S1**, và điều đó phải được ghi rõ trong manifest chứ không âm thầm.

### 4.6 Revocation, quarantine, kill switch, recovery

**Trạng thái hiện tại `[CÓ]`:** quarantine cục bộ khi integrity lệch (`PackageManagerService.ts:303, 346`), phục hồi từ `previousVersion` (`:311-318`), xác minh lại khi khởi động (`recoverFilesystem`). **`[KHÔNG]`** không có kênh thu hồi từ xa, không có CRL, không có kill switch.

**Đề xuất `[ĐÍCH]` — bốn mức, tăng dần mức độ:**

| Mức | Kích hoạt bởi | Hành động | Có thể phục hồi? |
| --- | --- | --- | --- |
| **R1 · Disable** | Người dùng, hoặc health check thất bại | Package không load, dữ liệu giữ nguyên | Có, người dùng bật lại |
| **R2 · Quarantine** | Integrity/chữ ký lệch `[CÓ]`, hoặc `revoked[]` trong Trust Bundle `[ĐÍCH]` | Không load, artifact chuyển sang thư mục quarantine, dữ liệu giữ nguyên, thông báo cho người dùng | Có, sau khi cài lại bản sạch |
| **R3 · Force-uninstall** | Mục `revoked` có `severity: 'critical'` | Gỡ artifact. **Dữ liệu người dùng giữ lại theo mặc định** (`uninstallDefault: 'retain'`) | Một phần |
| **R4 · Kill switch** | Mục `revoked` có `severity: 'emergency'` | Chặn toàn bộ một publisherId hoặc capability class trên mọi máy | Có, bằng Trust Bundle mới |

**Ba quy tắc thiết kế bắt buộc:**

1. **Thu hồi đi qua Trust Bundle**, không qua endpoint riêng. Nếu có endpoint riêng, nó trở thành điểm dừng dịch vụ (kill switch bị chặn = không thu hồi được) và một bề mặt tấn công mới (giả endpoint thu hồi = DoS lên mọi package).
2. **Kill switch phải fail-open cho Base OS, fail-closed cho package.** Nếu client không lấy được Trust Bundle mới, ứng dụng **vẫn phải khởi động được**. `migration-design` §4 bất biến 10 đã ghi đúng: "Base OS phải khởi động được khi package tùy chọn bị thiếu, hỏng hoặc không tương thích". Điều ngược lại — app không khởi động vì không kiểm tra được thu hồi — biến một sự cố mạng thành sự cố ngừng dịch vụ toàn cầu.
3. **Thu hồi không được xóa dữ liệu người dùng.** Ngay cả ở R4. Package độc hại có thể đã tạo ra dữ liệu người dùng cần giữ. Xóa dữ liệu là quyết định của người dùng, không phải của nhà cung cấp Store.

**Recovery `[ĐÍCH]`** — cần một chế độ khôi phục hoạt động khi mọi thứ hỏng:

```
Safe Mode: khởi động chỉ Base OS
  → tắt mọi package, mọi MCP server, mọi agent
  → hiển thị danh sách package + trạng thái + nút gỡ từng cái
  → cho phép export dữ liệu người dùng ra ngoài
  → cho phép reset Trust Bundle về bản nhúng trong installer
```

Đây phải là **cờ dòng lệnh**, không phải nút trong UI, vì UI có thể là thứ đang hỏng.

**Tác động hiệu năng:** Kiểm tra revocation là một lần tra map trong RAM khi load package. Không đáng kể. `recoverFilesystem` `[CÓ]` xác minh lại chữ ký + integrity của **mọi** package khi khởi động — với package 35 MB (IDE) đây là SHA-256 trên 35 MB ≈ 100-150 ms mỗi package. Với 4 package first-party là ~500 ms cộng vào thời gian khởi động. **Đề xuất:** chỉ xác minh đầy đủ khi mtime/size của artifact thay đổi so với lần trước; nếu không đổi thì tin cache có MAC. Nếu không làm việc này, chi phí sẽ tăng tuyến tính theo số package cài đặt và trở thành vấn đề khởi động thật sự.

**Tác động UX:** Quarantine đột ngột làm app biến mất khỏi sidebar. Phải có thông báo giải thích, không được im lặng. Chuông hệ thống trong `tomni-home-hub.md` đã dành riêng cho "cảnh báo bảo mật" — đó là kênh đúng.

### 4.7 Củng cố các ranh giới đã yếu (IPC, loopback, Electron)

Đây là nhóm đề xuất có tỷ lệ giá trị/công sức cao nhất trong toàn bộ tài liệu, vì nó vá những chỗ đang hở mà không cần hạ tầng mới.

**(1) IPC — thêm ba lớp, không đổi giao thức `[ĐÍCH]`**

```ts
ipcMain.handle(ADAPTER_BRIDGE_EVENT_KEY, (event, info) => {
  // Lớp 1: xác thực sender  [ĐÍCH]
  if (!isTrustedSender(event.senderFrame)) return errorResult('untrusted_sender');
  // Lớp 2: allowlist kênh    [ĐÍCH]
  const { name, data } = parseBridgeEnvelope(info);   // parse có schema, không ép kiểu
  if (!CHANNEL_ALLOWLIST.has(name)) return errorResult('unknown_channel');
  // Lớp 3: validate tham số theo từng kênh  [ĐÍCH]
  const validated = CHANNEL_SCHEMAS[name].parse(data);
  return emitter.emit(name, validated);
});
```

`isTrustedSender` phải từ chối mọi frame đến từ webview và iframe, chỉ chấp nhận frame chính của cửa sổ đã đăng ký. Điều này một mình đã cắt đứt AP-2.

**(2) Loopback — thêm session token `[ĐÍCH]`**

Electron main sinh một token ngẫu nhiên mỗi lần khởi động, truyền cho `tomny-core` qua tham số dòng lệnh hoặc stdin (**không phải env var** — env var đọc được từ process khác trên nhiều hệ điều hành), và mọi request từ `httpBridge` kèm header. Core từ chối request không có token. Đây chính là điều `core.md` §9 đề xuất ("local session token, origin allowlist").

Cần phối hợp với repo core — đây là **phụ thuộc chéo repo**, phải đưa vào kế hoạch (§7, §9).

**(3) Electron hardening — danh sách kiểm tra `[ĐÍCH]`**

| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| Đặt tường minh `contextIsolation: true, nodeIntegration: false, sandbox: true` cho cửa sổ chính | `[KHÔNG]` — hiện chỉ dựa vào mặc định Electron | Mặc định đúng nhưng ngầm; một bản nâng cấp Electron đổi mặc định là sự cố im lặng |
| Sửa `WebviewHost.tsx:478` `contextIsolation=no` | `[KHÔNG]` | **Đây là lỗ hổng cụ thể, không phải rủi ro lý thuyết.** Cần xác định vì sao nó bị tắt trước khi bật lại |
| Sửa `HTMLRenderer.tsx:610` `allowRunningInsecureContent` | `[KHÔNG]` | Render HTML do model sinh — chính xác là nơi cần chặt nhất |
| Cân nhắc tắt `webviewTag` | `[CÓ]` đang bật | Nếu còn tính năng cần webview thì không tắt được; cần kiểm kê trước |
| Gắn CSP qua `onHeadersReceived` | `[KHÔNG]` | |
| `will-navigate` allowlist | `[KHÔNG]` | |
| `setWindowOpenHandler` trên cửa sổ chính | `[KHÔNG]` — đã có trên BrowserView `[CÓ]` | |
| Allowlist scheme cho `shell.openExternal` | `[KHÔNG]` — nhận URL tùy ý từ renderer | Chỉ cho `https:`, `http:`, `mailto:` và các scheme deep-link đã biết |
| `setPermissionRequestHandler` cho camera/mic/geo | `[KHÔNG]` | Nội dung web nhúng hiện chạy theo mặc định Electron |
| Xác minh binary `tomny-core` | `[KHÔNG]` | Bỏ fallback PATH, thêm hash pin. Mẫu đã đúng ở `tomny-runtime` `[CÓ]` |

**Tác động hiệu năng:** Gần như bằng không. Validation schema trên IPC thêm ~10-50 μs mỗi lời gọi. Với vài nghìn lời gọi mỗi phiên, tổng < 100 ms.

**Tác động UX:** Rủi ro thật là **hồi quy chức năng**. Bật lại `contextIsolation` trên `WebviewHost` sẽ làm hỏng bất cứ thứ gì đang dựa vào việc nó tắt. Bỏ fallback PATH của `tomny-core` sẽ phá vỡ luồng phát triển của người đang dựa vào nó. **Mỗi mục trong bảng này cần một PR riêng có test hồi quy**, không gộp — xem §9.

### 4.8 Bảo vệ package và công nghệ khi không thể chống dịch ngược tuyệt đối

**Nói thẳng trước:** không có gì trong mục này ngăn được kẻ tấn công có động cơ và thời gian. Mục tiêu là **tăng chi phí** và **tạo bằng chứng**, không phải tạo rào chắn.

**Bốn tầng, xếp theo hiệu quả thực tế giảm dần:**

**Tầng 1 — Kiến trúc (hiệu quả cao nhất, chi phí sản phẩm cao nhất)**

Giữ phần có giá trị nhất ở nơi khách hàng không chạy: mô hình đã fine-tune, dữ liệu outcome tổng hợp, thuật toán định tuyến. Đây là biện pháp *duy nhất* thực sự hiệu quả, và nó mâu thuẫn trực tiếp với cam kết local-first — xem §4.9 về cách dung hòa.

**Tầng 2 — Pháp lý và định danh**

- Manifest package mang định danh publisher đã ký `[CÓ]`.
- `[ĐÍCH]` License term nhúng trong manifest, hiển thị trước khi cài.
- `[ĐÍCH]` Watermark theo build: một định danh duy nhất cho mỗi bản phát hành, cho phép truy nguồn nếu artifact bị phát tán lại. Đây là biện pháp *phát hiện*, không phải *ngăn chặn*.

**Tầng 3 — Kỹ thuật tăng chi phí**

- Minify + mangle tên (chuẩn của build pipeline).
- **Không đề xuất obfuscation nặng.** Nó làm chậm ứng dụng, cản trở gỡ lỗi và báo cáo crash, chống dịch ngược được vài ngày, và làm cho stack trace từ Sentry trở nên vô dụng. Đánh đổi không đáng.
- `[ĐÍCH]` Với logic thật sự nhạy cảm và không cần chạy nhanh: chuyển sang sidecar Rust `tomny-runtime` `[CÓ]`. Binary Rust khó đọc hơn bundle JS đáng kể — không phải bất khả xâm phạm, nhưng chi phí phân tích cao hơn một bậc.

**Tầng 4 — Phát hiện**

- `[ĐÍCH]` Reputation graph theo publisher (mô tả trong `defensible-core-design` §10) để phát hiện package sao chép.
- `[ĐÍCH]` Quy trình takedown — hiện `[KHÔNG]` có tài liệu nào mô tả.

**Điều tuyệt đối không được làm:**

Không quảng cáo "không thể dịch ngược", "không thể rò dữ liệu", "an toàn 100%". `revenue-moat` §0.2 đã cấm rõ ràng và đó là quy tắc đúng. Tuyên bố như vậy vừa sai, vừa tạo rủi ro pháp lý, vừa hủy uy tín khi bị chứng minh ngược.

**Tác động hiệu năng:** Tầng 3 chuyển sang Rust có thể *cải thiện* hiệu năng cho tác vụ nặng CPU, nhưng thêm chi phí IPC (~1-5 ms mỗi lời gọi qua NDJSON). Chỉ hợp lý cho tác vụ chạy lâu, không hợp lý cho lời gọi nhỏ tần suất cao.

**Tác động UX:** Tầng 2 thêm một bước xem license khi cài. Chấp nhận được. Tầng 3 dùng Rust không ảnh hưởng UX.

### 4.9 Giữ local-first nhưng vẫn có cloud core cạnh tranh

Đây là căng thẳng kiến trúc trung tâm của sản phẩm, và cần được xử lý bằng phân loại rõ ràng chứ không bằng khẩu hiệu.

**Nguyên tắc phân chia `[ĐÍCH]` — theo bản chất dữ liệu, không theo tính năng:**

| Loại | Ở đâu | Vì sao |
| --- | --- | --- |
| **Nội dung người dùng** — mã nguồn, note, hội thoại, workspace | **Luôn cục bộ.** Chỉ lên cloud khi người dùng chọn rõ ràng, theo từng workspace | Đây là lời hứa local-first. Vi phạm nó là mất niềm tin không lấy lại được |
| **Credential** | **Luôn cục bộ.** Không đồng bộ, không backup lên cloud | Không có ngoại lệ |
| **Kết quả suy luận** | Cục bộ mặc định; cloud khi người dùng chọn nhà cung cấp cloud | Người dùng đã chọn nhà cung cấp thì đã chấp nhận |
| **Tín hiệu outcome ẩn danh** — "chiến lược X thành công N lần cho loại tác vụ Y" | Cloud, **opt-in**, đã tổng hợp, k-anonymity | Đây là thứ tạo hiệu ứng mạng |
| **Catalog, Trust Bundle, danh sách thu hồi** | Cloud, ký, công khai | Không chứa dữ liệu người dùng |
| **Trọng số model** | Cloud (tải về) hoặc chỉ chạy trên cloud | Đây là tài sản có thể bảo vệ thật |

**Hai bất biến `[ĐÍCH]` phải giữ:**

1. **Ứng dụng phải chạy đầy đủ khi offline** trừ các tính năng vốn cần mạng. Nếu cloud core trở thành điều kiện để dùng sản phẩm, đó không còn là local-first.
2. **Mọi luồng dữ liệu ra cloud phải đi qua egress seam §4.4** và xuất hiện trong bản xem trước. Không có kênh cloud ưu tiên.

**Điều cần trung thực trong tài liệu:** `[KHÔNG]` Cloud core (Continuum/Nexus/Resource Exchange) không tồn tại. Thành phần cloud duy nhất có thật là `packages/cloud-relay` — một Durable Object đồng bộ workspace. `packages/tomni-account-kit` tồn tại nhưng **không được import từ `packages/desktop`** — chính README của nó xác nhận. Không tài liệu nào nên mô tả cloud core ở thì hiện tại cho tới khi có mã.

**Tác động hiệu năng:** Tổng hợp outcome opt-in nên chạy theo lô lúc rảnh, không trên đường nóng. Chi phí ≈ 0 nếu làm đúng.

**Tác động UX:** Bật opt-in cần một màn hình giải thích rõ dữ liệu nào rời máy. Nếu diễn đạt mơ hồ, tỷ lệ opt-in sẽ thấp và hiệu ứng mạng không hình thành — đây là bài toán sản phẩm, không phải bài toán bảo mật, nhưng nó phụ thuộc vào việc phần bảo mật nói thật.

### 4.10 Ba lỗi cần sửa mà không thuộc nhóm nào ở trên

**(1) Checksum không phải MAC.** `[CÓ]` `permission/repository.ts` dùng SHA-256 checksum và fail-closed khi lệch. Điều này chống hỏng dữ liệu — **không chống giả mạo có chủ đích**, vì kẻ ghi được file thì tính lại checksum được. Với file quyết định quyền (A10) và file lưu revision cao nhất đã thấy (§4.2), cần HMAC với khóa từ `safeStorage`, hoặc mã hóa toàn file qua `safeStorage`. `[ĐÍCH]`

**(2) Registry package không có kiểm tra toàn vẹn.** `[CÓ]` `installed.json` là JSON thuần. Sửa được nó là vô hiệu hóa được quarantine. Cần cùng cơ chế MAC như (1). `[ĐÍCH]`

**(3) `engines.tomni: ">=0.0.0"` đang ở catalog production.** `[CÓ]` xác nhận trong `catalog.ts` (mục IDE) và `store-artifacts/com.tomni.calculator-1.0.0.tomni-package.json`. Hai tài liệu (`complete-product-design` §9.4, `ui-ux-brief` §8.2) gọi đây là **blocker phát hành**. Range này vô hiệu hóa toàn bộ cơ chế kiểm tra tương thích. Ngược lại, `design-studio`/`document-studio` khai `>=1.0.0` trong khi app đang ở `0.x` — một range **không thể thỏa mãn**. Cả hai đều phải sửa trước khi coi Store là production. `[ĐÍCH]`

---

## 5. State machine

Ký hiệu: `[CÓ]` trạng thái/chuyển tiếp đã tồn tại · `[ĐÍCH]` cần xây · `⚠` điểm cần kiểm soát bảo mật

### 5.1 Publish → review → sign → distribute

**Hiện trạng: `[KHÔNG]` toàn bộ quy trình này không tồn tại.** Package first-party hiện được ký thủ công ngoài repo và upload lên GitHub Releases. Đây là state machine mục tiêu.

```
      DRAFT
        │ submit
        ▼
   SUBMITTED ──────────────────────────────┐
        │ tự động                          │
        ▼                                  │
  ⚠ AUTOMATED_SCAN                         │
    • schema manifest hợp lệ               │
    • engines.tomni KHÔNG được ">=0.0.0"   │ fail
    • không native binary/script/pickle     ├──────► REJECTED
    • giới hạn kích thước, không symlink    │        (kèm lý do máy đọc được)
    • capability khai báo ⊇ capability      │
      thực tế dùng (phân tích tĩnh)        │
    • quét secret trong artifact           │
    • SBOM sinh được                       │
        │ pass                              │
        ▼                                  │
  ⚠ HUMAN_REVIEW (bắt buộc nếu:            │
     capability nhạy cảm ∨ publisher mới    │
     ∨ tăng capability so với bản trước)   │
        │ approve                           │ reject
        ▼                                  │
  ⚠ SIGNING (khóa role='artifact' trong KMS)
    • ký payload chuẩn hóa [CÓ manifest.ts:321-343]
    • ghi provenance: ai duyệt, commit nào, lúc nào
        │
        ▼
  ⚠ CATALOG_STAGING
    • revision = revision_hiện_tại + 1
    • previousRevisionHash = hash(catalog hiện tại)
    • ký envelope bằng khóa role='catalog'
        │
        ▼
   PUBLISHED ─────────────────► DEPRECATED ─────► REVOKED
        │ (bản mới ra)                              ▲
        └──────────── sự cố bảo mật ────────────────┘
```

**Bất biến:**
- Khóa `artifact` **không bao giờ** ký catalog và ngược lại.
- Không có chuyển tiếp nào từ `SUBMITTED` thẳng tới `SIGNING`. Không có ngoại lệ cho first-party — nếu có ngoại lệ, quy trình vô nghĩa.
- `REJECTED` phải kèm lý do máy đọc được để nhà phát triển tự sửa.

**Tác động UX (phía nhà phát triển):** Human review thêm độ trễ hàng giờ tới hàng ngày. Cần ngưỡng rõ ràng để đa số bản cập nhật nhỏ đi đường tự động. Nếu mọi bản vá đều chờ người duyệt, nhà phát triển sẽ không cập nhật và bug bảo mật tồn tại lâu hơn — **quy trình review quá chặt tạo ra rủi ro bảo mật riêng của nó**.

### 5.2 Download → verify → stage → request permission → activate

```
   AVAILABLE  (trong catalog đã ký [ĐÍCH §4.2])
        │ người dùng bấm cài
        ▼
  ⚠ PERMISSION_PREVIEW  [ĐÍCH]
    Hiển thị capability sẽ được cấp TRƯỚC khi tải byte nào
        │ người dùng chấp nhận         │ từ chối
        ▼                              └──► AVAILABLE
   DOWNLOADING  [CÓ packageDownloader.ts]
    ⚠ HTTPS-only, chặn IP private, redirect thủ công tối đa 5 hop
      xác thực lại mọi hop [CÓ :41-96]
        │ lỗi mạng
        │◄─── retry (tối đa 3, backoff mũ)
        ▼
  ⚠ VERIFYING  [CÓ artifactSecurity.ts]
    • chữ ký Ed25519, keyId ∈ Trust Bundle [CÓ]
    • keyId KHÔNG nằm trong revoked[]  [ĐÍCH]
    • SHA-256 integrity [CÓ]
    • kích thước khớp khai báo [CÓ]
        │ pass                    │ fail
        ▼                         └──► FAILED_VERIFICATION
   STAGING  [CÓ]                       (xóa artifact tạm, ghi lý do)
    ⚠ giải nén vào thư mục tạm với SAFE_ARCHIVE_PATH + safeTarget [CÓ]
    ⚠ từ chối symlink [CÓ], giới hạn zip-bomb [CÓ], mode 0o600 [CÓ]
        │
        ▼
  ⚠ AWAITING_PERMISSION  [ĐÍCH]
    Nếu capability khác PERMISSION_PREVIEW (manifest bị đổi):
    → HỦY, chuyển FAILED_VERIFICATION. Không hỏi lại.
        │ đã cấp
        ▼
   ACTIVATING  [CÓ - rename atomic]
    ⚠ rename vào chỗ, ghi state store, đăng ký contribution
        │ lỗi                     │ ok
        └──► ROLLBACK [CÓ] ──┐    ▼
             (khôi phục      │  INSTALLED
              previousVersion)│    │ người dùng tắt
                             │    ▼
                             │  DISABLED ──► (bật lại) ──► INSTALLED
                             └──► FAILED
```

**Điểm cần chú ý:** bước `AWAITING_PERMISSION` phải so sánh capability trong manifest **đã stage** với capability đã hiển thị ở `PERMISSION_PREVIEW`. Nếu khác — nghĩa là manifest thay đổi giữa lúc xem và lúc cài — đây là dấu hiệu tấn công, không phải tình huống cần hỏi lại người dùng. Hỏi lại sẽ huấn luyện người dùng bấm đồng ý.

**Tác động UX:** Thêm một màn hình trước khi tải. Đây là chi phí UX có chủ đích và không nên tối ưu đi.

### 5.3 Update → health check → commit hoặc rollback

**Hiện trạng: `[CÓ]` rollback khi cài lỗi. `[KHÔNG]` health check và rollback sau khi cài thành công.** Đây là khoảng trống được `production-readiness-report.md` đánh dấu `missing`.

```
   INSTALLED (v1)
        │ có bản v2 trong catalog
        ▼
  ⚠ UPDATE_AVAILABLE
    • v2 > v1 (chặn hạ cấp [CÓ :546])
    • revision catalog ≥ revision đã thấy [ĐÍCH §4.2]
        │
        ▼
  ⚠ PERMISSION_DIFF  [ĐÍCH — hiện KHÔNG có]
    Nếu v2 xin capability MỚI → bắt buộc người dùng đồng ý.
    Nếu chỉ giữ nguyên hoặc thu hẹp → tự động qua.
        │ ok
        ▼
   DOWNLOADING → VERIFYING → STAGING   (như §5.2)
        │
        ▼
   SWITCHING  [CÓ]
    ⚠ giữ nguyên artifact v1, chỉ đổi con trỏ active
    ⚠ previousVersion = v1  [CÓ :557-559]
        │
        ▼
  ⚠ HEALTH_WINDOW (120 giây)  [ĐÍCH]
    Đạt nếu TẤT CẢ:
      • package load không ném lỗi
      • đăng ký contribution thành công
      • không crash renderer/main quy được cho package
      • không vi phạm capability (xin quyền ngoài manifest)
        │ đạt                      │ không đạt / timeout
        ▼                          ▼
   COMMITTED                  AUTO_ROLLBACK  [ĐÍCH]
   • dọn artifact v1 sau      • đổi con trỏ về v1
     7 ngày (không xóa ngay)  • đánh dấu v2 'update_failed'
   • ghi receipt              • KHÔNG tự thử lại v2
        │                     • thông báo người dùng
        ▼                          │
   INSTALLED (v2)                  ▼
                              INSTALLED (v1, v2 bị chặn)
```

**Ba quyết định thiết kế:**

1. **Giữ artifact v1 trong 7 ngày sau commit**, không xóa ngay. Điều này cho phép rollback thủ công khi lỗi xuất hiện muộn hơn cửa sổ 120 giây. Chi phí: dung lượng đĩa gấp đôi cho mỗi package trong 7 ngày. Với IDE 35 MB, đây là chi phí thật cần cân nhắc — có thể giảm xuống 3 ngày hoặc chỉ giữ cho package lớn khi còn dư đĩa.
2. **Không tự thử lại phiên bản đã rollback.** Nếu không có luật này, một bản cập nhật hỏng tạo vòng lặp cập nhật-rollback vô hạn.
3. **Cửa sổ 120 giây là tham số cần đo.** Quá ngắn thì bỏ sót lỗi khởi động chậm; quá dài thì trì hoãn việc dọn dẹp. Cần dữ liệu thực tế (§7).

### 5.4 Revoke/quarantine → disable → recover hoặc uninstall

```
   INSTALLED
        │
        ├─── integrity lệch khi khởi động [CÓ recoverFilesystem]
        ├─── keyId hoặc packageId@version ∈ revoked[] [ĐÍCH]
        └─── vi phạm capability lúc chạy [ĐÍCH]
                    │
                    ▼
            ⚠ QUARANTINED  [CÓ trạng thái, :303/:346]
              • không load
              • artifact chuyển sang thư mục quarantine
              • DỮ LIỆU NGƯỜI DÙNG GIỮ NGUYÊN
              • thông báo qua chuông hệ thống
                    │
        ┌───────────┼───────────┬──────────────┐
        │           │           │              │
    có bản      người dùng   severity      người dùng
    sạch hơn    gỡ cài      = emergency    khôi phục thủ công
        │           │           │              │
        ▼           ▼           ▼              ▼
   REINSTALL   UNINSTALLING  KILL_SWITCH   RESTORE_PREVIOUS
   (§5.2)      [CÓ]          [ĐÍCH]        [CÓ :311-318]
        │           │           │              │
        │           ▼           ▼              │
        │      ⚠ DATA_DECISION  BLOCKED        │
        │        mặc định GIỮ   (chặn cả       │
        │        dữ liệu        publisherId)   │
        │           │                          │
        ▼           ▼                          ▼
    INSTALLED   REMOVED                    INSTALLED (bản trước)
```

**Bất biến:**
- **Không nhánh nào tự động xóa dữ liệu người dùng.** Kể cả `KILL_SWITCH`. `uninstallDefault: 'retain'` là mặc định đúng.
- `KILL_SWITCH` chặn ở tầng publisher, không chỉ package — vì một publisher bị chiếm quyền thì mọi package của họ đều đáng ngờ.
- Thoát khỏi `QUARANTINED` chỉ qua bốn nhánh trên. **Không có nhánh "tự động phục hồi khi kiểm tra lại thấy ổn"** — nếu có, một lỗi tạm thời sẽ khiến package độc hại tự phục hồi.

---

## 6. Bảng P0 / P1 / P2

Xếp hạng theo: (bán kính thiệt hại) × (khả năng khai thác) ÷ (công sức sửa).

### P0 — Chặn phát hành production

| # | Vấn đề | Bằng chứng | Việc phải làm | Hiệu năng | UX |
| --- | --- | --- | --- | --- | --- |
| P0-1 | IPC không xác thực sender, một kênh gộp, không schema | `common/adapter/main.ts:93` | Thêm `isTrustedSender` + allowlist kênh + schema validation | ~10-50 μs/lời gọi | Không, nếu allowlist đầy đủ. **Rủi ro hồi quy cao** — cần kiểm kê hết tên bridge trước |
| P0-2 | Catalog không có revision/expiresAt/chữ ký cấp catalog ⇒ rollback & freeze | `remoteCatalog.ts:23-27` | Envelope v2 §4.2 | +1 Ed25519 verify + 1 SHA-256 | Trạng thái "stale" khi offline lâu |
| P0-3 | `tomny-core` không xác minh toàn vẹn + fallback PATH | `binaryResolver.ts:141-152` | Bỏ fallback PATH ở bản đóng gói, thêm hash pin (mẫu: `tomny-runtime` `[CÓ]`) | 1 SHA-256 khi khởi động (~50 ms cho binary lớn) | Phá luồng dev đang dùng PATH — cần cờ dev tường minh |
| P0-4 | Backend loopback không xác thực + `--local` cứng | `backend-launcher.ts:460`, `httpBridge.ts` | Session token + origin allowlist. **Cần phối hợp repo core** | ~0 | Không |
| P0-5 | `contextIsolation=no` trên webview | `WebviewHost.tsx:478` | Xác định vì sao bị tắt, bật lại, sửa cái phụ thuộc | ~0 | Có thể phá tính năng đang dùng nó |
| P0-6 | `trusted-react` chạy trong renderer chính, permission chỉ là khai báo | `PackageAppHost.tsx:181-194` | **Chấp nhận cho first-party.** Chặn tuyệt đối Store cộng đồng cho tới khi có S2 (§4.5) | — | Không, nếu không mở cộng đồng |
| P0-7 | `engines.tomni: ">=0.0.0"` trong catalog production | `catalog.ts`, `com.tomni.calculator-*.json` | Đặt range thật; thêm kiểm tra trong automated scan (§5.1) | ~0 | Không |
| P0-8 | Không có kênh thu hồi/kill switch | `[KHÔNG]` | `revoked[]` trong Trust Bundle §4.6 | 1 lần tra map khi load | Package biến mất — cần thông báo rõ |

### P1 — Chặn mở Store cộng đồng

| # | Vấn đề | Bằng chứng | Việc phải làm | Hiệu năng | UX |
| --- | --- | --- | --- | --- | --- |
| P1-1 | Không có sandbox process thật | `[KHÔNG]` `utilityProcess` | S2 §4.5 | +30-50 MB, +100-200 ms mỗi process | Mở package lần đầu chậm hơn |
| P1-2 | Egress inspection phủ 2/15 kênh | grep call site | Đợt E1-E6 §4.4 | **Đáng kể** — cần worker + cache theo hash | Thêm approval prompt; cần gom lô |
| P1-3 | Khóa AES tất định = SHA-256(userData path) | `omniGatewaySecurityStore.ts`, `credentialStore.ts` | Chuyển sang `safeStorage` | ~0 | Cần migration; token cũ phải mã hóa lại |
| P1-4 | `safeStorage` âm thầm fallback base64 | `tomnyProviderStore.ts:50-56` | Cảnh báo rõ cho người dùng khi OS không có keystore | ~0 | Thông báo mới trên Linux thiếu libsecret |
| P1-5 | Không có health check gate cho update | `[KHÔNG]` | §5.3 | Đĩa gấp đôi trong 7 ngày | Cập nhật "đang xác minh" 120 s |
| P1-6 | Không có permission diff khi cập nhật | `[KHÔNG]` | §5.3 | ~0 | Prompt mới khi capability tăng |
| P1-7 | Thiếu lifetime `workspace` | `permission/types.ts:3` | §4.3 | ~0 | **Cải thiện UX** — giảm prompt |
| P1-8 | Không có Electron permission handler | `[KHÔNG]` | `setPermissionRequestHandler` | ~0 | Prompt mới cho camera/mic |
| P1-9 | `shell.openExternal` không allowlist scheme | `applicationBridge.ts:168` | Allowlist scheme | ~0 | Có thể chặn deep-link hợp lệ — cần kiểm kê |
| P1-10 | `allowRunningInsecureContent` khi render HTML do model sinh | `HTMLRenderer.tsx:610` | Bỏ cờ | ~0 | Một số preview hỏng |
| P1-11 | Registry và permission store dùng checksum, không phải MAC | `repository.ts`, `packageStore.ts` | HMAC với khóa từ `safeStorage` §4.10 | ~0 | Không |
| P1-12 | Control plane agent do model điều khiển, không validate | `agent-company-pipeline/design.md` | Áp dụng mẫu P4 của Personal Manager: đề xuất, không tự ghi | ~0 | Thêm bước duyệt trong luồng agent |

### P2 — Nợ kỹ thuật cần trả trước GA

| # | Vấn đề | Bằng chứng | Việc phải làm |
| --- | --- | --- | --- |
| P2-1 | Không có CSP header, `will-navigate`, `setWindowOpenHandler` trên cửa sổ chính | `[KHÔNG]` | Thêm dần, mỗi cái một PR |
| P2-2 | `webviewTag: true` | `index.ts:357` | Kiểm kê nơi dùng, tắt nếu bỏ được |
| P2-3 | `webPreferences` cửa sổ chính chỉ dựa vào mặc định | `index.ts:352-355` | Đặt tường minh |
| P2-4 | Config MCP server (env/header chứa token) lưu plaintext | `mcpRegistry.ts` | Chuyển sang `safeStorage` |
| P2-5 | Sentry không scrub PII, có device id bền vững | `sentry.ts` | Thêm `beforeSend` scrub + tùy chọn tắt |
| P2-6 | Không có SBOM/provenance trong artifact `.tomny` | `store-artifacts/` | Thêm vào pipeline publish |
| P2-7 | Lỗ hổng tái lập build: cache-match không xác thực định danh repo | `docs/tomny-core-parity.md` | Thêm repo identity vào khóa cache |
| P2-8 | `docs/guides/deploy-server.md` khuyến nghị `--no-sandbox` không kèm cảnh báo | Tài liệu | Thêm cảnh báo + hướng dẫn TLS/reverse proxy/auth |
| P2-9 | Không có Safe Mode | `[KHÔNG]` | §4.6 |
| P2-10 | `docs/architecture/overview.md` là link chết | `AGENTS.md:66` | Viết lại hoặc sửa link |
| P2-11 | Constitution mô tả sản phẩm không còn tồn tại | `.specify/memory/constitution.md` (2025-01-22) | Sửa hoặc đánh dấu superseded |
| P2-12 | `docs/contributing/file-structure.md` dùng đường dẫn `src/` cũ, không phải `packages/desktop/src/` | Tài liệu | Cập nhật |

---

## 7. Danh sách quyết định còn thiếu

Những câu hỏi này **chặn thiết kế**, không chỉ chặn triển khai. Mỗi câu cần một người quyết định.

### 7.1 Root of trust

| # | Câu hỏi | Vì sao chặn |
| --- | --- | --- |
| Q1 | Root key ở HSM vật lý hay cloud KMS (và KMS nào)? | Quyết định toàn bộ quy trình vận hành và chi phí |
| Q2 | Ngưỡng M-of-N để dùng root key là bao nhiêu, ai giữ? | Nếu một người giữ, đó là single point of failure; nếu quá nhiều người, phản ứng sự cố quá chậm |
| Q3 | Vòng đời khóa ký: 12 tháng có phù hợp nhịp phát hành không? | Ảnh hưởng thiết kế cửa sổ chồng lấn |
| Q4 | Khi root key rò rỉ thì làm gì? Không có đường phục hồi nào ngoài phát hành installer mới | Cần runbook trước, không phải lúc sự cố |
| Q5 | Nhà phát triển bên thứ ba tự ký, hay Tomni ký thay sau review? | Hai mô hình bảo mật hoàn toàn khác nhau. Ảnh hưởng §5.1 và toàn bộ thiết kế Trust Bundle |

### 7.2 Catalog và phân phối

| # | Câu hỏi |
| --- | --- |
| Q6 | TTL catalog: 72 giờ có đúng không? Cần dữ liệu về mẫu hình offline của người dùng |
| Q7 | Sau bao lâu stale thì chặn cài mới — 7 ngày? Cần cân giữa an toàn và người dùng offline |
| Q8 | Có mirror catalog không? GitHub Releases hiện là single point of failure |
| Q9 | Microsoft Store: MSIX thật, hay chỉ liên kết ra ngoài? `complete-product-design` §22.3-22.5 mô tả cả hai. **Chưa có tài liệu MSIX packaging nào, và `CHANGELOG.md` không có mục nào về Microsoft Store** |
| Q10 | Ký code cho binary desktop (Authenticode/notarization): ai quản chứng chỉ? Hiện `[KHÔNG]` có tài liệu. `core.md` ghi nhận `tomnicore 0.1.16` **unsigned** |

### 7.3 Permission và sandbox

| # | Câu hỏi |
| --- | --- |
| Q11 | Cửa sổ health check 120 giây — cần đo, không đoán |
| Q12 | Bao nhiêu prompt permission mỗi phiên là quá nhiều? Cần ngưỡng để thiết kế việc gom lô |
| Q13 | Package first-party nào **bắt buộc** ở S1 (renderer chính) và vì sao? Cần danh sách rõ ràng, có thời hạn, không phải ngoại lệ vĩnh viễn. `migration-design` §4 bất biến 9 nói first-party không được có capability mà cộng đồng không xin được — cần đối chiếu |
| Q14 | Một `utilityProcess` chung cho mọi package cùng mức tin cậy, hay mỗi package một process? Đánh đổi RAM vs cô lập |
| Q15 | Khi người dùng từ chối capability giữa chừng, agent đang chạy xử lý thế nào — hủy, tạm dừng, hay tiếp tục ở chế độ hạn chế? |

### 7.4 Egress và quyền riêng tư

| # | Câu hỏi |
| --- | --- |
| Q16 | Ngân sách hiệu năng cho egress inspection là bao nhiêu ms mỗi lời gọi tool? Không có con số này thì không biết khi nào cần tối ưu |
| Q17 | Sentry có được bật mặc định không? Nếu có, cần opt-out rõ ràng và scrub PII |
| Q18 | Tín hiệu outcome ẩn danh: ngưỡng k-anonymity là bao nhiêu? |
| Q19 | Khi người dùng ở EU, luồng dữ liệu nào cần cơ sở pháp lý? Chưa có tài liệu nào chạm tới GDPR |

### 7.5 Mâu thuẫn kiến trúc cần phân xử

| # | Câu hỏi |
| --- | --- |
| Q20 | Orchestrator của agent company nằm ở Main hay Renderer? `requirements.md` §8.1 nói Main, `design.md` §44-48 nói Renderer và giải thích lý do. **Hai tài liệu mâu thuẫn trực tiếp** — xem §8 |
| Q21 | IDE contribution ABI: `codebase|agent-ops` (2 group) hay 8 group? **Hai tài liệu cùng ký duyệt ở hai giá trị khác nhau** — xem §8 |
| Q22 | Studio là Suite Package hay đã giải thể? Ba PRD nói Suite, ba tài liệu mới nói giải thể, **và một tài liệu mâu thuẫn với chính nó** — xem §8 |
| Q23 | Ai là chủ sở hữu của security seam? `.kiro/specs/tomni-security-core` ghi rõ không được sửa `ipcBridge.ts`, `preload/main.ts`, đăng ký bridge — nghĩa là **cổng không thể lắp đặt nếu không có bàn giao từ tab khác, và việc bàn giao đó chưa xảy ra** |

---

## 8. Đăng ký mâu thuẫn giữa các tài liệu

Theo yêu cầu: ghi rõ mâu thuẫn thay vì tự chọn im lặng. Không mâu thuẫn nào dưới đây được tôi tự phân xử.

| # | Mâu thuẫn | Bên A | Bên B | Ảnh hưởng bảo mật |
| --- | --- | --- | --- | --- |
| C1 | **Permission Broker có tồn tại không** | `feature-packs/README.md` §3 và `complete-product-design` §7.2 liệt kê là dịch vụ Base OS ở thì hiện tại; `defensible-core-design` §6 gọi là primitive "hiện có" | `.kiro/specs/tomni-three-core-foundation/requirements.md` §2.2 liệt kê ở mục **"còn thiếu"** | **Cao.** Lập kế hoạch dựa trên bên A sẽ bỏ sót một hạng mục lớn. Cách đọc đúng: permission store theo surface **có**, broker thống nhất theo runId **không** |
| C2 | **Catalog signing có tồn tại không** | `production-readiness-report.md` đánh dấu "Catalog integrity / anti-freeze" là **`missing`** | Cùng tài liệu đó, phần review installer liệt kê "Signed catalog client: `tested`"; `tomni-package-backend-mvp.md` §1A.13 mô tả cổng verify chữ ký catalog | **Cao.** Mã nguồn phân xử: `remoteCatalog.ts` verify chữ ký **từng manifest**, không có chữ ký cấp catalog. Cả hai bên đúng một phần, và cách diễn đạt che mất khoảng trống thật |
| C3 | **Sandbox: thiết kế vs triển khai đảo ngược** | Thiết kế yêu cầu UI không tin cậy chạy trong renderer/web sandbox cô lập | Triển khai: `sandboxed-web` **bị chặn mặc định**, `trusted-react` chạy trong renderer chính là đường duy nhất | **Rất cao.** Xem §3.4 |
| C4 | **Orchestrator ở Main hay Renderer** | `agent-company-pipeline/requirements.md` §8.1: orchestration ở Main | `agent-company-pipeline/design.md` §44-48: orchestrator ở Renderer, có giải thích kỹ thuật | **Cao.** Quyết định renderer có được nói HTTP/WS thẳng với backend hay không |
| C5 | **IDE ABI: 2 group hay 8 group** | `tomni-package-backend-mvp.md` §1A.2 + §1A.10 ký duyệt `codebase\|agent-ops` | `ui-ux-design-brief` §9 + `complete-product-design` §7.3 khóa ABI v1 = 8 group, gọi cái kia là "legacy implementation" | **Trung bình.** ABI là ranh giới bảo mật cho contribution; hai định nghĩa nghĩa là không có ranh giới |
| C6 | **Studio: Suite Package hay đã giải thể** | `package-platform-design` §15, `migration-design` §8.2, `feature-packs/README.md` §10 — đều ghi "đã chốt" | `tomni-package-backend-mvp.md` §1A, `complete-product-design` §1, `revenue-moat` §0.1 | **Trung bình.** Tệ hơn: `tomni-package-backend-mvp.md` §1A supersede Suite nhưng §2 của **chính nó** vẫn viết "Studio là một Suite App Package" |
| C7 | **PackageManifestV1 có ba hình dạng khác nhau** | `backend-mvp` §7: `engines:{tomni,sdk}`, `artifact.urls[]`, `store{}`, `contributions{}`, `dataPolicy` | `complete-product-design` §9.3: `engines:{tomni,hostSdk}`, `platforms[]`, `resources`, `dataPolicy.remoteProcessing` | **Cao.** Artifact **thực tế** trong `store-artifacts/` không khớp cả hai — không có `platforms`, `dataPolicy`, `networkAllowlist`, `contributions`, `store`. Schema là bề mặt bảo mật; ba phiên bản nghĩa là không có schema |
| C8 | **Định dạng container `.tomny`** | `complete-product-design` §9.1 + `backend-mvp` §8.1: cây có `manifest.json`, `signatures/`, `sbom.json`, `provenance.json` | Thực tế: file `*-package.json` với `format: 'tomni-package-bundle-v1'` và `files{}` base64; đúng **một** file `.tomny` ZIP thật, entry đầu là `tomny-package.json` (không phải `manifest.json`) | **Trung bình.** Không artifact nào có `sbom.json` hay `provenance.json` |
| C9 | **Bằng chứng tách package khỏi base** | `backend-mvp` §1A.11 báo cáo module graph production 26.087.691 byte, "owner arrays đều rỗng" | `production-readiness-report.md` đánh dấu "Package code absent from base installer" là **`missing`**; `backend-mvp` §1A.12 tự nói "Chưa có after production bytes" | **Trung bình.** Ảnh hưởng tuyên bố "app tải về thật" |
| C10 | **Model manifest có hai schema trong cùng một tài liệu** | `tomni-local-core-model-runtime-design.md` §12.1: GGUF, `source: huggingface`, `hardwareProfiles` | Cùng tài liệu §21.4: `ModelAdapterPack`, `format: peft-lora-safetensors`, `runtime.engine: transformers-peft` | **Thấp hiện tại** (chưa có adapter nào active), **cao khi kích hoạt** |
| C11 | **Constitution vs toàn bộ phần còn lại** | `.specify/memory/constitution.md` tuyên bố tính tối thượng: "Constitutional principles supersede implementation preferences" | Nó mô tả một sản phẩm không có package platform, không Store, không sandbox, không `.tomny`; yêu cầu ESLint/Prettier trong khi repo dùng oxlint/oxfmt | **Thấp về kỹ thuật, cao về quản trị.** Một tài liệu tự nhận tối thượng nhưng đã chết là nguồn nhầm lẫn cho mọi người mới |
| C12 | **Đặt tên sản phẩm** | `complete-product-design` §26.1 + `ui-ux-brief` §0 khóa TomniHubOS / Tomni / `.tomny` | Mọi `feature-packs/*`, `readme.md` ("Tomny Agentic"), `CHANGELOG.md`, `packages/web-host/README.md` ("@omni/web-host"), namespace release (`VNDT1625/OmniAgent`) vẫn dùng Tomny/Omni/AionUi | **Thấp**, nhưng ảnh hưởng định danh publisher và chuỗi tin cậy — `publisherId` là `com.tomni` trong khi repo là `OmniAgent` |
| C13 | **`docs/architecture/overview.md`** | `AGENTS.md:66` trỏ tới nó; `docs/contributing/file-structure.md:12` bắt buộc tài liệu kiến trúc nằm ở `docs/architecture/` | File và thư mục **không tồn tại** (xóa ở commit `ff3a76edc`) | **Trung bình.** Không có phát biểu chính thức nào về ranh giới tin cậy để review |

---

## 9. Ma trận kiểm thử bảo mật và tiêu chí nghiệm thu

### 9.1 Ma trận kiểm thử

Cột "Loại": `U` unit · `I` integration · `E` end-to-end · `M` thủ công/red-team

| ID | Kiểm thử | Loại | Tiêu chí đạt | Hiện có? |
| --- | --- | --- | --- | --- |
| **T-SIG** | | | | |
| T-SIG-1 | Manifest có chữ ký hợp lệ, keyId đã tin cậy | U | Chấp nhận | `[CÓ]` |
| T-SIG-2 | Chữ ký bị sửa một bit | U | Từ chối | `[CÓ]` |
| T-SIG-3 | keyId không có trong Trust Bundle | U | Từ chối, **không** học khóa từ manifest | `[CÓ]` |
| T-SIG-4 | Chữ ký hợp lệ nhưng keyId nằm trong `revoked[]` | U | Từ chối | `[ĐÍCH]` |
| T-SIG-5 | Payload chuẩn hóa bất biến khi đảo thứ tự khóa JSON | U | Cùng chữ ký | `[CÓ]` |
| T-SIG-6 | Chữ ký ký bằng khóa `catalog` dùng cho artifact | U | Từ chối (phân tách vai trò) | `[ĐÍCH]` |
| **T-CAT** | | | | |
| T-CAT-1 | Catalog revision thấp hơn revision đã thấy | I | Từ chối + ghi `catalog.rollback_detected` | `[ĐÍCH]` |
| T-CAT-2 | Catalog hết hạn `expiresAt` | I | Dùng nhưng đánh dấu stale | `[ĐÍCH]` |
| T-CAT-3 | Cache cục bộ > 30 ngày | I | Coi như không có | `[ĐÍCH]` |
| T-CAT-4 | Chữ ký envelope sai | I | Rơi về cache đã ký, rồi bundled | `[ĐÍCH]` |
| T-CAT-5 | `previousRevisionHash` không khớp | I | Cảnh báo, vẫn dùng nếu chữ ký hợp lệ | `[ĐÍCH]` |
| T-CAT-6 | Catalog v1 (không có envelope) với client v2 | I | Hoạt động, đánh dấu `unverified-envelope` | `[ĐÍCH]` |
| **T-EXT** — giải nén | | | | |
| T-EXT-1 | Entry `../../etc/passwd` | U | Từ chối | `[CÓ]` |
| T-EXT-2 | Entry đường dẫn tuyệt đối | U | Từ chối | `[CÓ]` |
| T-EXT-3 | Symlink trỏ ra ngoài | U | Từ chối | `[CÓ]` |
| T-EXT-4 | Zip bomb (tỷ lệ nén cao) | U | Từ chối khi vượt ngưỡng | `[CÓ]` |
| T-EXT-5 | Tên có NUL byte | U | Từ chối | `[CÓ]` |
| T-EXT-6 | Tên Unicode chuẩn hóa thành `..` (Windows) | U | Từ chối | **Cần kiểm tra** |
| T-EXT-7 | Tên dành riêng Windows (`CON`, `PRN`, `NUL`, `AUX`) | U | Từ chối | **Cần kiểm tra** |
| T-EXT-8 | ADS Windows (`file.txt:stream`) | U | Từ chối | **Cần kiểm tra** |
| **T-SSRF** | | | | |
| T-SSRF-1 | URL artifact `http://` | U | Từ chối | `[CÓ]` |
| T-SSRF-2 | URL có credential | U | Từ chối | `[CÓ]` |
| T-SSRF-3 | URL trỏ `127.0.0.1`, `10.x`, `169.254.x`, `::1` | U | Từ chối | `[CÓ]` |
| T-SSRF-4 | Redirect từ host hợp lệ sang IP nội bộ | U | Từ chối tại hop | `[CÓ]` |
| T-SSRF-5 | Hostname phân giải DNS ra IP nội bộ | I | Từ chối | **`partial`** theo readiness report |
| T-SSRF-6 | DNS rebinding giữa verify và fetch | I | Từ chối | **Cần kiểm tra** |
| **T-IPC** | | | | |
| T-IPC-1 | Lời gọi bridge từ frame webview | I | Từ chối `untrusted_sender` | `[ĐÍCH]` |
| T-IPC-2 | Tên kênh không có trong allowlist | I | Từ chối `unknown_channel` | `[ĐÍCH]` |
| T-IPC-3 | Tham số sai schema | I | Từ chối, không crash | `[ĐÍCH]` |
| T-IPC-4 | Payload > 50 MB | I | Từ chối | `[CÓ]` |
| T-IPC-5 | `shell.openExternal` với `file://`, `javascript:` | I | Từ chối | `[ĐÍCH]` |
| **T-PERM** | | | | |
| T-PERM-1 | Deny thắng allow ở cùng độ cụ thể | U | Deny | `[CÓ]` |
| T-PERM-2 | `allow-once` giảm về 0 sau một lần dùng | U | Lần thứ hai hỏi lại | `[CÓ]` |
| T-PERM-3 | Grant `session` không sống qua restart | I | Hỏi lại | `[CÓ]` |
| T-PERM-4 | Grant `workspace` sống qua restart, không áp cho workspace khác | I | Đúng phạm vi | `[ĐÍCH]` |
| T-PERM-5 | File permission bị sửa, checksum tính lại đúng | I | **Hiện sẽ chấp nhận** — cần MAC để từ chối | `[ĐÍCH]` |
| T-PERM-6 | Capability không kế thừa xuống agent con | I | Con phải xin riêng | `[ĐÍCH]` |
| T-PERM-7 | Capability token hết hạn giữa chừng | I | Adapter từ chối | `[ĐÍCH]` |
| **T-EGR** | | | | |
| T-EGR-1 | Text chứa AWS key | U | `sanitize` hoặc `block` | `[CÓ]` |
| T-EGR-2 | Secret bị chèn ký tự vô hình vào giữa | U | Vẫn phát hiện | `[CÓ]` — điểm mạnh thật sự |
| T-EGR-3 | Detector ném lỗi | U | `failed_closed` | `[CÓ]` |
| T-EGR-4 | `schemaVersion` lạ | U | `failed_closed` | `[CÓ]` |
| T-EGR-5 | Không có phản hồi UI trong N giây | I | **Không** tự chấp thuận | `[ĐÍCH]` |
| T-EGR-6 | Receipt không chứa input, safe text, tiền tố token, nội dung file | U | Đạt | `[CÓ]` một phần |
| T-EGR-7 | Kết quả tool MCP chứa secret | I | Bị chặn | `[ĐÍCH]` — hiện không phủ |
| T-EGR-8 | `fetch` trực tiếp từ renderer | I | Không tồn tại đường này | `[ĐÍCH]` |
| **T-UPD** | | | | |
| T-UPD-1 | Package v2 crash khi load | E | Auto-rollback về v1 trong 120 s | `[ĐÍCH]` |
| T-UPD-2 | v2 xin capability mới | E | Bắt buộc người dùng đồng ý | `[ĐÍCH]` |
| T-UPD-3 | Đã rollback thì không tự thử lại v2 | E | v2 bị chặn | `[ĐÍCH]` |
| T-UPD-4 | Mất điện giữa lúc SWITCHING | E | Khởi động lại về trạng thái nhất quán | `[CÓ]` (`recoverFilesystem`) |
| T-UPD-5 | Cố cài phiên bản thấp hơn | I | Từ chối | `[CÓ]` |
| **T-REV** | | | | |
| T-REV-1 | Package bị thu hồi khi đang chạy | E | Quarantine, dữ liệu giữ nguyên | `[ĐÍCH]` |
| T-REV-2 | Kill switch cho publisherId | E | Mọi package của publisher bị chặn | `[ĐÍCH]` |
| T-REV-3 | Không lấy được Trust Bundle | E | **Base OS vẫn khởi động** | `[ĐÍCH]` |
| T-REV-4 | Quarantine không xóa dữ liệu | E | Dữ liệu còn nguyên | `[CÓ]` |
| T-REV-5 | Artifact bị sửa sau khi cài | E | Phát hiện khi khởi động, quarantine | `[CÓ]` |
| **T-SBX** | | | | |
| T-SBX-1 | Package sandbox gọi `window.electronAPI` | I | `undefined` | `[ĐÍCH]` |
| T-SBX-2 | Package sandbox `fetch` ra ngoài | I | Bị CSP chặn | `[CÓ]` với `sandboxed-web` |
| T-SBX-3 | Package sandbox thoát iframe | M | Thất bại | `[ĐÍCH]` |
| T-SBX-4 | Package sandbox ngốn CPU | I | Bị giới hạn, không đóng băng hub | `[ĐÍCH]` — cần S2 |
| **T-BIN** | | | | |
| T-BIN-1 | `tomny-core` giả trên PATH | E | **Hiện sẽ thực thi** — phải từ chối | `[ĐÍCH]` |
| T-BIN-2 | Binary bundled bị sửa | E | Từ chối khởi động | `[ĐÍCH]` |
| T-BIN-3 | Sidecar sai version protocol | I | Fail closed | `[CÓ]` |
| **T-RED** — red team thủ công | | | | |
| T-RED-1 | Package độc hại có manifest hợp lệ, cố đọc `userData` | M | Thất bại | `[ĐÍCH]` |
| T-RED-2 | Prompt injection trong repo → đổi directive agent | M | Không leo được capability | `[ĐÍCH]` |
| T-RED-3 | Trang web độc hại trong webview → chạm IPC | M | Thất bại | `[ĐÍCH]` |
| T-RED-4 | Process cục bộ quét cổng loopback → gọi API core | M | Từ chối thiếu token | `[ĐÍCH]` |

### 9.2 Tiêu chí nghiệm thu theo cổng

**Cổng G1 — Đóng P0** (điều kiện để gọi Store first-party là production)

- Toàn bộ T-SIG, T-CAT, T-EXT, T-SSRF, T-IPC, T-BIN đạt
- Không còn `engines.tomni: ">=0.0.0"` trong catalog production
- Backend loopback yêu cầu session token; xác nhận `--local` bằng mã nguồn core
- T-RED-3 và T-RED-4 do người ngoài đội thực hiện, thất bại
- Có runbook quản lý khóa ký (Q1-Q4 đã trả lời)

**Cổng G2 — Đóng P1** (điều kiện để mở Store cộng đồng)

- G1 đạt
- Toàn bộ T-SBX, T-PERM, T-UPD, T-REV đạt
- T-EGR phủ ≥ 80% kênh egress đã liệt kê ở §3.8
- Sandbox S2 hoạt động với ≥ 1 package pilot
- Quy trình review §5.1 chạy được với ≥ 1 package bên ngoài thật
- T-RED-1 và T-RED-2 do người ngoài đội thực hiện, thất bại
- Có thủ tục takedown và ứng phó sự cố dạng văn bản

**Cổng G3 — GA**

- G2 đạt
- P2 đóng hoặc có lý do chấp nhận rủi ro được ghi rõ
- Có SBOM cho mọi artifact phân phối
- Binary desktop được ký code trên mọi nền tảng
- Có Safe Mode
- Đã hoàn tất một đợt pentest bên ngoài

### 9.3 Tiêu chí không được thỏa hiệp

Bốn điều dưới đây là ranh giới cứng. Nếu vi phạm, hệ thống mất tính chất bảo mật cốt lõi chứ không chỉ "kém an toàn hơn":

1. **Không có timeout nào tự động chấp thuận.** Không có ngoại lệ.
2. **Base OS phải khởi động được khi mọi thành phần tùy chọn hỏng.** Kill switch fail-open cho Base, fail-closed cho package.
3. **Không có nhánh nào tự động xóa dữ liệu người dùng.**
4. **Chữ ký không bao giờ đủ để cấp quyền.** Chữ ký chứng minh nguồn gốc; permission và sandbox mới giới hạn hành vi. `migration-design` §10 đã ghi đúng câu này và nó cần được giữ.

---

## 10. Lộ trình triển khai theo lát cắt nhỏ

Nguyên tắc: mỗi lát cắt (1) tự đứng được, (2) không phá tương thích, (3) có test riêng, (4) rollback được độc lập.

### Đợt 0 — Sự thật (1-2 tuần, không đổi mã sản phẩm)

| Lát | Việc | Vì sao trước |
| --- | --- | --- |
| 0.1 | Phân xử C1-C13 ở §8; đánh dấu tài liệu bị superseded | Không thể lập kế hoạch trên nền mâu thuẫn |
| 0.2 | Trả lời Q1-Q5 (root of trust) | Chặn mọi việc về khóa ký |
| 0.3 | Viết `docs/architecture/overview.md` — sửa link chết ở `AGENTS.md:66` | Không có phát biểu chính thức nào về ranh giới tin cậy |
| 0.4 | Kiểm kê đầy đủ tên bridge IPC | Điều kiện tiên quyết của 1.1 |
| 0.5 | Kiểm kê nơi dùng `webviewTag` và lý do `contextIsolation=no` | Điều kiện tiên quyết của 1.4 |

### Đợt 1 — Vá lỗ hổng cụ thể (3-4 tuần, P0)

Xếp theo tỷ lệ giá trị/rủi ro hồi quy.

| Lát | Việc | Rủi ro hồi quy | Rollback |
| --- | --- | --- | --- |
| 1.1 | IPC: allowlist kênh + schema validation (**chưa** chặn sender) | Trung bình | Cờ tắt allowlist |
| 1.2 | IPC: xác thực sender | **Cao** — có thể phá webview | Cờ riêng |
| 1.3 | `tomny-core`: bỏ fallback PATH ở bản đóng gói, thêm hash pin | Trung bình — phá luồng dev | Biến môi trường dev tường minh |
| 1.4 | Sửa `contextIsolation=no` ở `WebviewHost` | **Cao** | Revert riêng |
| 1.5 | Bỏ `allowRunningInsecureContent` ở `HTMLRenderer` | Thấp | Revert riêng |
| 1.6 | Allowlist scheme cho `shell.openExternal` | Trung bình — có thể phá deep-link | Allowlist mở rộng được qua config |
| 1.7 | Sửa `engines.tomni` trong catalog; thêm kiểm tra ở publish | Thấp | — |
| 1.8 | Session token cho loopback backend | **Cao — phụ thuộc repo core** | Cờ tắt |

**Không gộp 1.2 và 1.4 vào cùng một PR.** Cả hai chạm cùng vùng và đều rủi ro cao; gộp lại thì không biết cái nào gây hồi quy.

### Đợt 2 — Catalog envelope v2 (2-3 tuần, P0)

| Lát | Việc | Tương thích |
| --- | --- | --- |
| 2.1 | Định nghĩa envelope v2, viết verifier, **chưa bật** | Không đổi hành vi |
| 2.2 | Sinh envelope v2 phía publish, phát hành song song v1 và v2 | Client cũ đọc v1, client mới đọc v2 |
| 2.3 | Client ưu tiên v2, rơi về v1 kèm cảnh báo | Không phá |
| 2.4 | Bật kiểm tra revision + expiry | Cần theo dõi tỷ lệ stale |
| 2.5 | Bỏ v1 sau khi ≥ 95% client đã lên bản có v2 | Cần telemetry |

### Đợt 3 — Trust Bundle và thu hồi (3-4 tuần, P0)

| Lát | Việc |
| --- | --- |
| 3.1 | Sinh root key trong HSM/KMS (theo Q1-Q2) |
| 3.2 | Định dạng Trust Bundle + verifier, nhúng bundle bootstrap vào installer |
| 3.3 | Đọc khóa từ bundle thay vì hằng số trong `catalog.ts` — **giữ hằng số làm fallback** |
| 3.4 | Thêm `revoked[]`, nối vào luồng verify |
| 3.5 | Kill switch cấp publisher + thông báo người dùng |
| 3.6 | Safe Mode qua cờ dòng lệnh |

### Đợt 4 — Permission broker (4-5 tuần, P1)

| Lát | Việc | Tương thích |
| --- | --- | --- |
| 4.1 | Thêm lifetime `workspace` vào `permissionStore` | Cộng thêm, không phá |
| 4.2 | Thêm `runId`/`taskId`/`packageId` vào scope (tùy chọn) | Cộng thêm |
| 4.3 | Chuyển checksum → HMAC cho permission store và registry | Cần migration đọc được cả hai |
| 4.4 | Broker cấp capability token, **chạy song song ở chế độ ghi log** | Không đổi hành vi |
| 4.5 | Adapter bắt đầu **yêu cầu** token, từng surface một | Từng bước, rollback được |
| 4.6 | Bất biến "capability không kế thừa" trong cây agent | Có thể phá luồng agent — cần test |

### Đợt 5 — Độ phủ egress (4-6 tuần, P1)

Theo thứ tự E1-E6 ở §4.4. Mỗi kênh là một lát riêng: nối dây → chạy ở chế độ chỉ ghi log → bật thực thi → đo hiệu năng → sang kênh tiếp theo.

**Bắt buộc trước khi bắt đầu:** trả lời Q16 (ngân sách hiệu năng). Không có con số thì không biết khi nào phải dừng lại tối ưu.

### Đợt 6 — Sandbox thật (6-8 tuần, P1)

| Lát | Việc |
| --- | --- |
| 6.1 | Bật `allowSandboxedWeb` cho `com.tomni.calculator` **chỉ ở bản dev** |
| 6.2 | Định nghĩa capability bridge cho package sandbox |
| 6.3 | Dựng host `utilityProcess` — **chưa dùng cho package thật** |
| 6.4 | Chuyển package pilot sang `utilityProcess`, đo RAM và thời gian khởi động |
| 6.5 | ResourceCoordinator quản lý vòng đời process package |
| 6.6 | Quyết định Q13: package first-party nào ở lại S1, có thời hạn |

### Đợt 7 — Quy trình publish (song song với 3-6, P1)

| Lát | Việc |
| --- | --- |
| 7.1 | Automated scan §5.1 chạy trên package first-party hiện có |
| 7.2 | Sinh SBOM cho artifact `.tomny` |
| 7.3 | Ghi provenance khi ký |
| 7.4 | Checklist human review dạng văn bản |
| 7.5 | Thủ tục takedown và ứng phó sự cố |

### Điều gì chặn điều gì

```
Đợt 0 ──┬──► Đợt 1 ──┬──────────────────► Cổng G1
        │            │
        ├──► Đợt 2 ──┤
        │            │
        └──► Đợt 3 ──┘
                     │
              Đợt 4 ─┼──► Đợt 6 ──┬──► Cổng G2
                     │            │
              Đợt 5 ─┘     Đợt 7 ─┘
```

**Đợt 6 (sandbox) và Đợt 7 (publish) cùng là điều kiện cần để mở Store cộng đồng.** Không được mở trước khi cả hai xong — điều này khớp với gate đã ghi trong `execution-roadmap` và `migration-design`, và tôi tán thành hoàn toàn.

---

## 11. Tóm tắt cho người ra quyết định

**Nền tảng tốt hơn nhiều tài liệu trong repo thừa nhận.** Pipeline package — ký Ed25519 với payload chuẩn hóa, chống path traversal có hai lớp, từ chối symlink, chống SSRF có xác thực lại từng hop redirect, cài đặt giao dịch có rollback và phục hồi sau crash — là công trình bảo mật chất lượng cao. Secret Firewall với scan view chuẩn hóa bóc Unicode vô hình là chi tiết mà nhiều sản phẩm thương mại bỏ sót. Cổng outbound inspection fail-closed đúng ở cấp hàm.

**Khoảng cách giữa tài liệu và mã là rủi ro lớn nhất, lớn hơn bất kỳ lỗ hổng kỹ thuật đơn lẻ nào.** Nhiều tài liệu mô tả Permission Broker, catalog đã ký, kill switch và sandbox bằng thì hiện tại trong khi mã chưa có. Một người lập kế hoạch đọc `feature-packs/README.md` sẽ tin rằng hệ thống đã có những thứ mà grep chứng minh là không. §8 liệt kê 13 mâu thuẫn cần phân xử, và §1 là sổ cái nên được coi là nguồn sự thật cho tới khi các mâu thuẫn đó được giải quyết.

**Bốn lỗ hổng cụ thể cần xử lý trước mọi thứ khác:** IPC không xác thực sender với một kênh gộp (`common/adapter/main.ts:93`); catalog không có chống rollback (`remoteCatalog.ts:23-27`); `tomny-core` không xác minh toàn vẹn và có fallback PATH (`binaryResolver.ts:141-152`); backend loopback chạy `--local` cứng mà không có xác thực (`backend-launcher.ts:460`). Ba trong bốn cái này có mẫu đúng đã tồn tại ở nơi khác trong cùng codebase — sidecar `tomny-runtime` xác minh SHA-256, `packageDownloader` chống SSRF, `browserViewManager` khóa cứng webPreferences. Việc cần làm phần lớn là áp dụng nhất quán chuẩn mà đội đã tự đặt ra, không phải phát minh cái mới.

**Sandbox package hiện đảo ngược so với thiết kế:** loại được sandbox (`sandboxed-web`) bị chặn mặc định, loại chạy được (`trusted-react`) chạy thẳng trong renderer chính. Điều này chấp nhận được **chỉ vì** cổng tin cậy giới hạn ở first-party `com.tomni`, và nó phải giữ nguyên như vậy cho tới khi có ranh giới process thật. Store cộng đồng không được mở trước đó — đây là gate đã có trong tài liệu của chính dự án.

**Không có gì trong tài liệu này tạo ra bảo mật tuyệt đối.** Code chạy trên máy người dùng thì dịch ngược được; người dùng bấm đồng ý mọi thứ thì không cơ chế nào cứu được; máy đã bị chiếm quyền thì secret cục bộ mất. Giá trị của kiến trúc này là ở chỗ nó **giới hạn bán kính thiệt hại**, **tạo bằng chứng kiểm toán được**, và **cho phép phản ứng khi sự cố xảy ra** — không phải ở chỗ nó hứa hẹn sự cố không bao giờ xảy ra.
