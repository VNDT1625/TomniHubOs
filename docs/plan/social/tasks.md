# Social Hub — Cây công việc và nghiệm thu bàn giao

## Quy ước sử dụng

Snapshot: 2026-10-15, dirty worktree tại HEAD `4cf2b27113654ad10869297669d19e32ce8afdce`.
Phụ thuộc canonical `docs/superpowers/specs/2026-10-09-social-hub-design.md` và `docs/README.md`; không thay master plan C0–C6.
`[x]` chỉ xác nhận atom đã đọc thấy trong implementation; không có nghĩa test pass hoặc release hoàn tất.
`[ ]` giữ nguyên cho parent chưa đủ acceptance, test chưa chạy, thiết kế TARGET và blocker bên ngoài.
Các nhiệm vụ tương lai phải nhận allowlist riêng; danh sách dưới đây không cấp quyền sửa file shared tự động.
Lần bàn giao này chỉ viết ba file trong thư mục này và ba file Realtime; không production edit, commit hay build/test.
Prefix `SRC` = `packages/desktop/src`; `SOC` = `SRC/process/services/social`; `UI` = `SRC/renderer/pages/social`.

## Evidence và lệnh đã xác định

| Mã | File đã đọc | Bằng chứng dùng được |
| --- | --- | --- |
| S-E1 | `SOC/socialBridge.ts` | Account lifecycle, permission, ownership, send receipt, registration |
| S-E2 | `SOC/socialSqliteStore.ts` | Schema, pagination, upsert, deletion, stats |
| S-E3 | `SOC/adapters/mockPlatformAdapters.ts` | Connector mặc định từ chối; không fixture success |
| S-E4 | `UI/hooks/useSocialFeed.ts` | Request version, dedup, offset, client platform filter |
| S-E5 | `UI/feed/UnifiedFeedView.tsx` | Web fallback, empty, sentinel, permalink interaction |
| S-E6 | `tests/unit/social/socialBridge.test.ts` | Assertions với login/adapter giả, chưa chạy |
| S-E7 | `tests/unit/social/socialDb.test.ts` | Assertions persistence bằng node:sqlite, chưa chạy |
| S-E8 | `SRC/common/types/social/socialChannels.ts` | Các tên kênh thực tế |

Các lệnh sau có thể chạy từ root repo khi được giao bước verification; **chưa chạy trong phiên này**:

```powershell
bun run test tests/unit/social/socialBridge.test.ts tests/unit/social/socialDb.test.ts
bun run test tests/unit/social/socialHooks.dom.test.tsx
bun run test tests/unit/social/socialFeedWebFallback.dom.test.tsx
bun run test tests/unit/social/socialRoute.dom.test.tsx tests/unit/social/socialSettings.dom.test.tsx
bun run test tests/unit/social
```

Các path DOM đã được tìm thấy, nhưng chỉ assertion S-E6/S-E7 đã đọc đầy đủ phần liên quan; không gắn nhãn pass cho path tồn tại.

## S-1 — Khóa phạm vi và ownership

- [ ] S-1 Hoàn tất baseline triển khai được chấp nhận — PARTIAL; owner Integrator, phụ thuộc canonical/package decision.
  - [x] S-1.1 Xác nhận route `/social` trong `SRC/renderer/components/layout/Router.tsx` — CURRENT qua tìm vị trí registration.
  - [x] S-1.2 Xác nhận sidebar entries trong `Sider/index.tsx` và `pages/guid/HubHome/HubSidebar.tsx` — CURRENT.
  - [ ] S-1.3 Khóa release scope: Web-only hay provider API pilot; không gọi toàn bộ Social production-ready.
    - [ ] S-1.3.1 Ghi provider pilot, capability và dữ liệu hợp lệ được phép lấy — TARGET.
    - [ ] S-1.3.2 Ghi phần Feed/Reels/DM ngoài pilot là unavailable rõ ràng — TARGET.
  - [ ] S-1.4 Quyết định app package/contribution ownership — BLOCKED chờ Integrator/Store.
    - [ ] S-1.4.1 Phân định host session broker với implementation Social optional.
    - [ ] S-1.4.2 Khóa manifest ID/runtime/permission contract trước di chuyển file.
  - [ ] S-1.5 Đối chiếu mâu thuẫn global CSS/i18n với CSS modules và chuỗi cứng hiện có.
    - [ ] S-1.5.1 Giao thay đổi canonical nếu cần cho Integrator, không sửa ngoài allowlist docs hiện tại.

Nghiệm thu S-1: một decision có owner, dependency, revision và scope; không đổi chính sách bằng tài liệu phụ này.
Rollback S-1: chưa có migration; hủy proposal chưa duyệt, giữ nguyên baseline và worktree người khác.

## S-2 — IPC và ranh giới quyền

- [ ] S-2 Chứng minh IPC Social an toàn end-to-end — PARTIAL; owner Integrator + Security.
  - [x] S-2.1 Kiểm tra channel constants account/feed/reels/messages/storage — CURRENT, S-E8.
  - [x] S-2.2 Kiểm tra quyền đọc cache Feed/Reels và thread — CURRENT, S-E1.
  - [ ] S-2.3 Audit generic bridge/preload để chứng minh sender validation trên mọi kênh.
    - [ ] S-2.3.1 Test iframe/untrusted origin/đã đóng webContents không gọi được provider.
    - [ ] S-2.3.2 Test trusted route nhưng account/capability không hợp lệ vẫn bị deny.
  - [ ] S-2.4 Thêm runtime schema từ unknown cho từng payload, không dựa generic TypeScript.
        - [x] S-2.4.1 Từ chối null/array/wrong type/field lạ và chuỗi quá dài trước truy cập trim (runtime service unit).
        - [x] S-2.4.2 Giới hạn tối đa 32 accounts, bulk sync 8 accounts, 200 conversations/messages; unit test, chưa có Electron IPC sender proof.
  - [ ] S-2.5 Bảo vệ markPostViewed/markReelViewed theo ownership và permission.
    - [ ] S-2.5.1 Gửi ID của account khác không thay đổi viewed trong DB.
    - [ ] S-2.5.2 ID không tồn tại có lỗi/no-op được quy định rõ và ổn định.
  - [ ] S-2.6 Recheck quyền sau await trước persist/return.
    - [ ] S-2.6.1 Thu hồi quyền giữa fetch và save phải bỏ response.
    - [ ] S-2.6.2 Xóa account trong lúc sync không tạo orphan rows.

Allowlist đề nghị S-2: `SOC/socialBridge.ts`, test Social; contract/preload/ipcBridge chỉ Integrator sửa sau khóa schema.
Nghiệm thu: integration qua Electron IPC thật có deny/schema/permission race; service unit không đóng parent.
Kill: admission fail closed; rollback schema phải tương thích caller cũ hoặc version-gate, không nới validation.

## S-3 — Account Web và OAuth

- [ ] S-3 Hoàn tất lifecycle tài khoản thật — PARTIAL; owner session/service, provider owner giải blocker.
  - [x] S-3.1 CONNECT tạo account không username, bốn quyền false, status expired — CURRENT, S-E1.
  - [x] S-3.2 Mở login lỗi rollback account và thử clear partition — CURRENT, S-E1/S-E6.
  - [x] S-3.3 Mở lại account dùng partition đã lưu; cửa sổ tồn tại được focus — CURRENT, S-E1.
  - [ ] S-3.4 Chạy Electron smoke hai account cùng platform, restart và logout một account.
    - [ ] S-3.4.1 Cookie account A không thấy trong B; báo metadata không ghi cookie raw.
    - [ ] S-3.4.2 Đóng login flush storage và mở lại giữ đúng phiên nếu provider cho phép.
    - [x] S-3.5 Legacy ADD username không tự cấp quyền API; mặc định false, test.
  - [ ] S-3.6 Khóa OAuth provider pilot — BLOCKED: app ID, redirect URI, scope approval, test account.
    - [ ] S-3.6.1 State/PKCE/callback validation, exchange code chỉ Main.
    - [ ] S-3.6.2 Token vault mã hóa; renderer chỉ handle/status đã redacted.
    - [ ] S-3.6.3 API identity xác minh trước connected; token expiry/revoke cập nhật state.
    - [ ] S-3.6.4 Retry auth không tạo account/partition trùng hoặc để callback cũ ghi đè.
  - [ ] S-3.7 Kiểm tra popup/navigation/permission request của login window.
  - [ ] S-3.8 Định nghĩa Browser session sharing bằng consent/lease — TARGET, không sao chép cookie.

Allowlist S-3: `SOC/sessionVault.ts`, login phần đã phân ownership trong `socialBridge.ts`; OAuth file mới cần khóa path trước.
Nghiệm thu: provider thật chứng thực identity, deny/revoke và restart; không dùng test ép `status:'connected'` làm proof.
Rollback: disable connector, revoke credential của pilot theo consent; giữ profile/backup trừ khi người dùng yêu cầu unlink.

## S-4 — Adapter và đồng bộ

- [ ] S-4 Có ít nhất một connector được cấp quyền hoạt động — BLOCKED theo S-3.6.
  - [x] S-4.1 Default fetch từ chối SOCIAL_CONNECTOR_UNAVAILABLE — CURRENT, S-E3.
  - [x] S-4.2 Default send từ chối SOCIAL_SEND_MESSAGE_TRANSPORT_UNAVAILABLE — CURRENT, S-E3.
  - [x] S-4.3 Refresh kiểm tra account/platform ownership của kết quả — CURRENT, S-E1.
  - [ ] S-4.4 Viết normalizer parse toàn nested schema của provider từ unknown.
    - [ ] S-4.4.1 Reject media URL/protocol không hợp lệ, số NaN, timestamp không hợp lệ và field quá dài.
    - [ ] S-4.4.2 Giữ origin ID/account ID riêng để tránh collision cross-account.
  - [ ] S-4.5 Dùng shared egress seam cho từng destination và mọi redirect.
    - [ ] S-4.5.1 Giới hạn bytes, deadline, concurrency và cancel xuyên suốt.
    - [ ] S-4.5.2 401/403/429/5xx có taxonomy và backoff riêng; không retry side effect mù.
  - [ ] S-4.6 Trả kết quả sync partial theo account, vì hiện lưu từng account trước khi account sau lỗi.
  - [ ] S-4.7 Thiết kế lịch manual/5/15/30 phút có jitter và durable last-success.
    - [ ] S-4.7.1 Disabled/revoked/uninstalled dừng lịch và bỏ late response.
    - [ ] S-4.7.2 App wake không bắn tất cả account cùng lúc.

Allowlist S-4: `SOC/adapters/**`; không sửa service cùng lúc S-2/S-3, handoff contract trước khi đổi caller.
Nghiệm thu: fixture contract + live pilot receipt, payload redacted; không claim live bằng adapter tiêm trong unit.
Rollback/kill: provider gate off trước fetch/send, không fallback scraping/mock; metadata cũ có nhãn stale.

## S-5 — Database, retention và media

- [ ] S-5 Hoàn tất storage production — PARTIAL; owner Storage, một người sở hữu schema năm bảng.
  - [x] S-5.1 Năm bảng + index queue/thread tồn tại — CURRENT, S-E2.
  - [x] S-5.2 Upsert giữ viewed và từ chối đổi owner khi ID collision — CURRENT, S-E2/S-E7.
  - [x] S-5.3 Allowed account filter đứng trước LIMIT/OFFSET — CURRENT, S-E2.
  - [x] S-5.4 Remove account xóa graph dữ liệu trong transaction — CURRENT, S-E2.
  - [x] S-5.5 Stats chỉ đo post/reel payload và media count 0 — CURRENT, S-E2.
  - [ ] S-5.6 Version migration và validate payload JSON cũ/hỏng.
        - [x] S-5.6.1 Backup legacy nhất quán bằng SQLite VACUUM INTO, transaction commit user_version=1 (node:sqlite test, native Electron vẫn cần kiểm tra).
    - [ ] S-5.6.2 Inject failure giữa migration, reopen không mất account/unseen/DM.
    - [ ] S-5.6.3 Down-version gate và restore backup được kiểm chứng.
  - [ ] S-5.7 Chạy restart test với native better-sqlite3 của Electron đóng gói.
  - [ ] S-5.8 Chốt retention: fetchedAt hiện tại hay viewedAt; hòa giải lựa chọn 48h và 7/14/30 ngày.
  - [ ] S-5.9 Xây media cache thực có quota 500 MB theo canonical TARGET.
    - [ ] S-5.9.1 Path containment, download size, ownership, dedup và eviction không xóa file ngoài cache.
    - [ ] S-5.9.2 Không xóa media đang phát hoặc unseen trái chính sách đã chốt.
    - [ ] S-5.9.3 Stats phân biệt logical payload/file size và byte thực thu hồi.
    - [x] S-5.10 Clear cache có xác nhận xóa cả unseen post/reel — DOM test.

Nghiệm thu S-5: restart/migration/crash/permission isolation trên native runtime; test node:sqlite chỉ chứng minh logic storage.
Rollback: phục hồi backup, không drop database; kill media downloader không xóa dữ liệu metadata đang đọc.

## S-6 — Feed

- [ ] S-6 Feed đủ hành trình thành công/rỗng/lỗi — PARTIAL; owner UI Feed.
  - [x] S-6.1 Request version chống response account cũ và dedup ID — CURRENT, S-E4.
  - [x] S-6.2 Mark viewed giảm offset sau thành công và phục hồi marker khi lỗi — CURRENT, S-E4.
  - [x] S-6.3 Web-only empty có mở đúng account, no-account có Settings — CURRENT, S-E5.
  - [x] S-6.4 Like/comment chuyển permalink thay vì sửa count giả — CURRENT, S-E5.
    - [x] S-6.5 Test platform filter khi page 1 không có item matching nhưng page 2 có.
        - [x] S-6.5.1 Account/platform filter được áp dụng trước SQL pagination.
  - [ ] S-6.6 Test 60%/2 giây viewed với fake timer, visibility và unmount.
  - [ ] S-6.7 Phân biệt loading ban đầu/refresh lỗi/cache lỗi/empty/revoked.
  - [ ] S-6.8 Invalidate UI khi quyền đổi trên cùng account và khi account bị unlink.
  - [ ] S-6.9 Double-click refresh/scroll giữ cache khi connector lỗi và không chạy request trùng.

Allowlist S-6: `UI/feed/**`, `UI/hooks/useSocialFeed.ts`, DOM tests; global CSS/locales phối hợp Integrator.
Nghiệm thu: assertion người dùng nhìn thấy đúng trạng thái, không lộ dữ liệu account trước, không kẹt pagination.

## S-7 — Reels và Messenger

- [ ] S-7 Hoàn tất hai hành trình media/DM — PARTIAL; owner UI theo file không chồng lấn.
  - [ ] S-7.1 Đọc trực tiếp Reels player/hook và cập nhật evidence trước đánh dấu done.
    - [ ] S-7.1.1 Đo không quá ba player quanh active index, chạy chuỗi 100 video.
    - [ ] S-7.1.2 Test ↑/↓/Space/M, không bắt phím khi nhập comment.
    - [ ] S-7.1.3 Video lỗi, hết hạn URL, offline và hết queue có retry/skip hữu hạn.
    - [ ] S-7.1.4 Route leave/tray/uninstall dừng âm thanh và giải phóng player.
  - [ ] S-7.2 Test inbox empty, chưa chọn thread, loading thread và permission denied riêng.
  - [ ] S-7.3 Chuyển account/thread khi response đảo thứ tự không lộ tin cũ.
  - [x] S-7.4 Service send yêu cầu read+send, connected và receipt hợp lệ — CURRENT, S-E1/S-E6.
  - [ ] S-7.5 Thêm pending/failed/retry draft theo receipt, không optimistic success giả.
    - [ ] S-7.5.1 Idempotency/reconcile khi timeout sau provider đã nhận.
    - [ ] S-7.5.2 Enter gửi/Shift+Enter newline và chặn submit trùng.
    - [ ] S-7.5.3 Audit/redaction/cancellation/terminal receipt nối runtime chung.

Allowlist S-7: `UI/reels/**`, `UI/hooks/useReelsQueue.ts`, `UI/messages/**`; contract send giao Integrator.
Nghiệm thu: fixture edge cases và live DM pilot riêng; rollback giữ draft, kill chặn send mới và reconcile tác vụ đã phát.

## S-8 — UI chuẩn, package và lifecycle

- [ ] S-8 Đạt chuẩn tích hợp shell/package — TARGET; owner Integrator + UI + Store.
  - [ ] S-8.1 Chuyển chuỗi cứng qua i18n, không thay bằng key giả không có locale.
  - [ ] S-8.2 Chuyển styling về `SRC/renderer/styles/tomni-ui.css` qua owner shared file.
  - [ ] S-8.3 Nếu look đổi, cập nhật canonical design system và `mockup/home-wireframe-v3.html` cùng change tương lai.
  - [ ] S-8.4 Keyboard focus, screen reader status/alert, dark/light và resize được kiểm tra.
  - [ ] S-8.5 Implement disposer cho interval, handlers, DB, login windows và network.
    - [ ] S-8.5.1 Dispose hai lần an toàn, không timer/handler còn sống.
    - [ ] S-8.5.2 Pending response sau disable không ghi dữ liệu.
  - [ ] S-8.6 Nếu optional: artifact tách source/assets/locales/services, không chỉ ẩn route.
    - [ ] S-8.6.1 Clean-machine absence/install/disable/enable/uninstall proof.
    - [ ] S-8.6.2 Package identity/capability không nhận raw secret hoặc generic main bridge.

## S-9 — Verification và handoff

- [ ] S-9 Đóng acceptance Social — TARGET, không đóng chỉ vì atom code CURRENT.
        - [x] S-9.1 Social suite 75/75 tests (24 files), exit 0; Electron startup smoke 3/3, full release gates khác chưa xác nhận.
  - [ ] S-9.2 Chạy `bun run lint`, `bun run format:check`, `bunx tsc --noEmit`, `bun run test` khi implementation được phép verify.
  - [ ] S-9.3 Nếu thay text/i18n, chạy `bun run i18n:types` và `node scripts/check-i18n.js` trong change triển khai.
  - [ ] S-9.4 Tạo contract/integration test thực cho IPC/session/migration; chốt path trước khi ghi lệnh mới.
  - [ ] S-9.5 Ghi provider live proof tách khỏi fixture, không công khai token/DM.
  - [ ] S-9.6 Review MTUI diff và status, handoff chỉ file được sở hữu.
  - [ ] S-9.7 Integrator cập nhật canonical status khi bằng chứng implementation thay đổi.

## Mẫu bàn giao một atom

```text
Atom ID / parent:
Owner / người nhận / allowlist / shared-file request:
Starting HEAD / dirty paths liên quan / ending revision:
Trạng thái CURRENT | PARTIAL | TARGET | BLOCKED:
Hành trình + input + account/capability + expected output:
File thay đổi và symbols:
Bằng chứng đọc mã / fixture test / integration / live (tách riêng):
Lệnh thực chạy, exit code, thời điểm, output redacted:
Acceptance đã đạt / chưa đạt:
Migration version + backup + restore evidence:
Kill switch + cancellation + xử lý pending side effect:
Rollback chính xác các file sở hữu, không reset worktree chung:
Blocker, dependency owner, quyết định cần nhận:
Conflict / unrelated dirty paths / rủi ro còn lại:
Commit ownership: không commit nếu chưa được ủy quyền:
```

Đợt kiểm toán tài liệu hiện tại: đọc mã/test, không thực thi các gate ở S-9; không có live provider proof mới.

## Bổ sung bằng chứng triển khai sau snapshot (2026-10-15)

- **CURRENT (code + fixture/unit/DOM):** Runtime payload validation, cap 32 Social account và 8 account cho bulk sync, giới hạn tối đa 200 conversations/messages trong IPC. `socialIpcBounds.test.ts` thử vượt quota và trả về danh sách giới hạn.
- **CURRENT (SQLite node:sqlite):** Legacy schema được sao lưu nhất quán qua `VACUUM INTO` trước transaction đặt `user_version=1`, từ chối database future version và JSON cache hỏng. `socialSqliteMigration.test.ts` chứng minh rollback khi inject lỗi và có thể mở lại sau khi xử lý backup. Chưa xác nhận native better-sqlite3 trong Electron. Khóa một request gửi mỗi thread và giải phóng đúng khi thành công/lỗi, kiểm chứng bằng `socialSendConcurrency.test.ts`; idempotency qua provider khi timeout vẫn TARGET.
- **PARTIAL (Social Web):** Top-level navigation chỉ chấp nhận HTTPS và domain identity do từng provider sở hữu; popups và quyền thiết bị được từ chối. `socialWebLoginNavigation.test.ts` kiểm tra URL và `socialWebLoginWindow.dom.test.ts` kiểm tra wiring bằng Electron mock; chưa có Electron smoke trên provider thật.
- **Verification:** `bunx vitest run tests/unit/social --reporter=dot` exit 0 (75/75 trên 24 file); lint service exit 0; `bunx tsc --noEmit --pretty false` exit 0; `git diff --check` scoped Social exit 0. Các gate release/format/native Electron vẫn chưa xác nhận.
- **BLOCKED:** OAuth đã phê duyệt cho từng platform, Meta App/scopes/callback/test account; không có API công khai tương đương personalized Facebook News Feed hay hộp thư Messenger cá nhân. Không dùng cookie/request nội bộ để giả access token.

- **CURRENT (2026-10-16, Facebook Web):** Social có tab Facebook Web dựa trên Main-owned WebContentsView, dùng partition persist:social_* của account từ SQLite. Người dùng chọn Feed/Reels/Messages, reload, hide khi đổi account hoặc rời tab. Kênh IPC social:web:show/hide/reload chỉ nhận accountId, section và bounds được kiểm tra. Main chặn URL ngoài HTTPS/host cho phép, popup và quyền thiết bị. Không đọc DOM, cookies, request headers, token để nhập vào Social queue.
- **Tests (2026-10-16):** socialWebViewController.test.ts và socialWebView.dom.test.tsx kiểm tra account isolation, chuyển section, lỗi, view lifecycle và late-create cancel; socialRouteAccounts.dom.test.tsx kiểm tra mở tab Web tự động. 75/75 unit/DOM Social đạt trên 24 file. Playwright Electron startup 3/3 đạt. Whole-project tsc --noEmit đạt. i18n checker đạt với warnings ngoài phạm vi.
- **PARTIAL/BLOCKED:** Chưa kiểm chứng đăng nhập Facebook thực trong view, cookie qua restart, packaged Electron ABI, hoặc approved Meta OAuth/Graph API connector. Web view cho phép xem website Facebook thật, KHÔNG tự gom News Feed/DM cá nhân thành dữ liệu SQLite; các provider APIs/scope chỉ có thể triển khai với giấy phép và quyền hợp lệ.
