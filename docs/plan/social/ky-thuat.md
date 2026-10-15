# Social Hub — Hợp đồng kỹ thuật bàn giao

## 1. Nguồn và phạm vi

Đối chiếu worktree ngày 2026-10-15 tại HEAD `4cf2b27113654ad10869297669d19e32ce8afdce`.
Đây là tài liệu phụ thuộc `docs/superpowers/specs/2026-10-09-social-hub-design.md` và các canonical được `docs/README.md` chỉ định.
Không triển khai production trong thay đổi này; không chạy test. CURRENT là hành vi nhìn thấy trong mã đã đọc, không phải release certification.
Prefix `SRC` dưới đây là `packages/desktop/src`; prefix `SOC` là `SRC/process/services/social`.

## 2. Đường thực thi đã đọc

```text
Router /social -> renderer/pages/social
  -> common/adapter/ipcBridge.ts (social facade)
  -> common/types/social/socialChannels.ts
  -> SOC/socialBridge.ts (bridge.buildProvider)
  -> createSocialBridgeService
     -> socialDb / SqliteSocialStore
     -> SocialSessionVault / Electron BrowserWindow
     -> IPlatformAdapter / BasePlatformAdapter (từ chối transport)
```

- `SRC/process/bridge/index.ts` có lời gọi `registerSocialBridge`; đây là file chung do Integrator sở hữu.
- Service tạo một adapter cho mỗi platform trong Map; adapter cần nhận account rõ ràng trên từng thao tác.
- Chưa có chứng cứ caller identity ở từng handler Social: `buildProvider` có generic TypeScript không đồng nghĩa runtime schema hoặc sender validation.
- Không khẳng định generic bridge bên ngoài không có bảo vệ; phải kiểm toán wrapper/preload/thực thi trước khi nâng trạng thái.
- Không dùng route guard làm quyền gọi IPC.

## 3. Hợp đồng account

CURRENT `addAccount({platform, username?, displayName?, permissions?})`:

1. Platform được lowercase và kiểm tra tập `x/facebook/threads/reddit/tiktok/youtube`.
2. Username trim, bỏ `@` đầu, tối đa 100 ký tự; duplicate cùng platform bị từ chối không phân biệt hoa thường.
3. ID `acc_<platform>_<uuid>`; `accountId` ban đầu cũng là ID nội bộ, chưa phải ID provider.
4. `status = expired`, `lastSyncedAt = 0`; không tự chứng thực.
5. Nhánh legacy có username lấy `defaultConsent = Boolean(username)`; quyền mặc định có thể true.
6. `connectAccount({platform})` luôn override cả bốn quyền thành false và không cần username.

TARGET: thống nhất explicit consent cho cả ADD và CONNECT, không bỏ nhánh legacy khỏi audit chỉ vì UI mới dùng CONNECT.
TARGET: tách trạng thái Web-profile/API-verified thay vì suy diễn mọi `expired` là token hết hạn.
TARGET OAuth: app registration, callback cố định, state chống CSRF, PKCE theo provider, đổi code ở Main, token mã hóa/vault và handle opaque.
Renderer chỉ nhận metadata; không nhận access token, refresh token, cookie hay header xác thực.
Web session không phải API credential; không đọc DOM hoặc request nội bộ để giả token.

## 4. Bảng IPC thực tế

| Kênh | Request | Response | Kiểm tra hiện tại / phần còn thiếu |
| --- | --- | --- | --- |
| `social:account:list` | void | `SocialAccount[]` | Trả metadata store; bounded list/sender còn cần audit |
| `social:account:add` | platform, username?, displayName?, permissions? | account | Platform, duplicate, username; runtime shape đầy đủ TARGET |
| `social:account:connect` | platform | account | Quyền false, mở Web, rollback lỗi |
| `social:account:openLogin` | accountId | success | Account tồn tại; mở lại partition |
| `social:account:updatePermissions` | accountId, bốn boolean | account | Kiểm tra boolean; cancellation/recheck đang chạy TARGET |
| `social:account:remove` | accountId | success | Dọn session trước xóa DB; retry phục hồi TARGET |
| `social:feed:getQueue` | accountId?, limit?, offset? | posts | Lọc quyền trước phân trang SQL |
| `social:feed:refresh` | accountId? | count | Feed platform + quyền + connected + ownership |
| `social:feed:markViewed` | postId | success | Update theo ID; kiểm tra ownership tại service chưa thấy |
| `social:reels:getQueue` | accountId?, limit?, offset? | reels | Lọc quyền trước phân trang SQL |
| `social:reels:refresh` | accountId? | count | facebook/tiktok/youtube + quyền + connected |
| `social:reels:markViewed` | reelId | success | Update theo ID; kiểm tra ownership TARGET |
| `social:messages:getConversations` | accountId? | conversations | Lọc quyền đọc sau truy vấn |
| `social:messages:refreshConversations` | accountId? | count | facebook/x/reddit + quyền + connected |
| `social:messages:getThread` | conversationId | messages | Tìm owner rồi kiểm tra quyền đọc |
| `social:messages:refreshThread` | conversationId | count | Kiểm tra owner/quyền/connected và conversationId đầu ra |
| `social:messages:send` | conversationId, content | message | Đọc+gửi, connected, nội dung và receipt |
| `social:storage:getStats` | void | stats | Chỉ payload post/reel, không đo filesystem |
| `social:storage:clearCache` | void | freedBytes | Xóa mọi post/reel; số trả về là byte payload trước xóa |

Nguồn: `SRC/common/types/social/socialChannels.ts`, `SOC/socialBridge.ts`.
TARGET mọi request phải parse từ unknown, từ chối field lạ nếu hợp đồng yêu cầu, giới hạn chuỗi/mảng và trả lỗi ổn định.
TARGET contract version + request correlation + bounded response; không thêm generic method/URL/partition do renderer tự cấp.

## 5. Adapter và side effect

- CURRENT default factory dùng `BasePlatformAdapter` trong `adapters/mockPlatformAdapters.ts`.
- Tên file có chữ mock nhưng implementation không tạo dữ liệu demo: fetch ném `SOCIAL_CONNECTOR_UNAVAILABLE`.
- Send ném `SOCIAL_SEND_MESSAGE_TRANSPORT_UNAVAILABLE`, khác mã lỗi fetch; UI phải phân biệt.
- Feed/Reels/inbox refresh tuần tự theo account, trả tổng count, lưu từng account ngay sau fetch.
- Nếu account sau lỗi, account trước có thể đã persist: đây không phải transaction toàn đợt refresh.
- Validate hiện chỉ kiểm tra array và ownership/platform tương ứng; chưa đủ schema toàn bộ nested author/media/stats.
- `sendMessage` kiểm tra content sau truy cập `.trim()`; TypeScript không bảo vệ payload sai kiểu ở runtime.
- Receipt hợp lệ phải cùng conversation, `isFromMe = true`, status thuộc sent/delivered/read.
- TARGET: providerMessageId + idempotencyKey + requestId/runId + timestamps để phục hồi gửi không rõ kết quả.
- TARGET: trước side effect và trước persist phải recheck quyền, account lifecycle, cancellation và credential validity.
- TARGET: per-provider egress allowlist, redirect/DNS/size limit, timeout tổng, retry có backoff và Retry-After.
- TARGET: audit chỉ lưu metadata/redaction, không sao chép nội dung DM/token vào log phổ thông.

## 6. SQLite và migration

CURRENT `SOC/socialSqliteStore.ts` tạo bảng bằng `CREATE TABLE IF NOT EXISTS`:

| Bảng | Khóa / cột phục vụ query | Nội dung |
| --- | --- | --- |
| social_accounts | id PK, connected_at | payload JSON account |
| social_posts | id PK, account_id, created_at, fetched_at, viewed | payload JSON post |
| social_reels | id PK, account_id, created_at, fetched_at, viewed | payload JSON reel |
| social_conversations | id PK, account_id, last_message_at | payload JSON thread |
| social_messages | id PK, conversation_id, sent_at | payload JSON message |

- Index queue trên viewed/account_id/created_at; message index trên conversation_id/sent_at.
- Queue unseen sort `created_at DESC, id DESC`; post default 50, reel default 30; limit tối đa 100, offset tối đa 100000.
- `page()` chấp nhận safe integer, clamp số âm về 0, dùng fallback khi không hợp lệ.
- Allowed IDs rỗng trả []; filter account trước LIMIT tránh trang rỗng do dữ liệu account bị cấm.
- Upsert giữ `MAX(viewed, excluded.viewed)` và không đổi owner khi collision ID.
- `markViewed` đổi cột viewed, không viết lại payload; không dùng payload cũ làm nguồn authoritative về viewed.
- Xóa account trong transaction: messages qua conversations, conversations, posts, reels, account.
- Eviction SQL dùng `fetched_at`, không phải thời điểm xem; resync thay fetched_at có thể kéo dài retention.
- Parse payload hiện ép kiểu sau JSON.parse; malformed JSON/schema cũ cần migration/error handling.
- Chưa thấy migration version trong constructor; CREATE IF NOT EXISTS không nâng schema đã tồn tại.

TARGET quy trình migration: kiểm tra version -> backup nhất quán -> transaction schema/data -> validate counts/ownership -> commit version -> reopen.
Khi lỗi, rollback transaction và giữ backup, không xóa DB để app khởi động được.
Migration phải phân biệt ID nội bộ và ID provider; không tự đổi partitionKey làm mất phiên.
Down-version không đọc schema mới không tương thích: chặn mở ghi, hướng dẫn restore bản backup đã xác minh.
Mỗi bảng và migration chỉ một owner tại một checkpoint; thay đổi được Integrator khóa trước triển khai.

## 7. Session, resource và kill

CURRENT BrowserWindow: 900×720, partition của account, sandbox true, contextIsolation true, nodeIntegration false.
Cửa sổ đã tồn tại được show/focus; đóng sẽ flushStorageData.
Remove đóng cửa sổ rồi clearStorageData và clearCache; nếu cleanup ném lỗi, account chưa bị xóa.
TARGET: kiểm tra navigation/window-open/permission request của login, vòng đời callback, không để trang provider có preload đặc quyền.
CURRENT register tạo interval eviction 15 phút và unref; không thấy disposer trả về hoặc clearInterval trong hàm này.
TARGET kill switch runtime chưa được chứng minh: cần dừng lịch, hủy network, đóng player/window, gỡ handlers và đóng DB theo owner lifecycle.
Tắt route đơn thuần không dừng service đang chạy.
Biện pháp rollback phát triển: Integrator gỡ registration và entry đã sở hữu, restart app; giữ DB/backup, không reset worktree chung.
Kill connector phải fail closed trước fetch/send; không fallback sang scraping hoặc mock success.

## 8. Renderer và khoảng trống

`useSocialFeed` có requestVersion, seenIds, markedIds, khóa fetching và PAGE_SIZE 20.
Đổi account/reset xóa state; response version cũ bị bỏ; markViewed thành công giảm offset một lần.
Lọc platform diễn ra sau query; `UnifiedFeedView` chỉ tạo sentinel khi posts.length > 0.
TARGET regression: dữ liệu page 1 đều platform khác nhưng page 2 có platform chọn vẫn phải truy cập được.
TARGET: permission revoke trong cùng account phải invalidation cache và request generation, không chỉ khi selectedAccountId thay đổi.
`UnifiedFeedView` còn CSS module, inline style và chuỗi tiếng Việt trực tiếp; khác yêu cầu global stylesheet/i18n trong AGENTS.
Không sửa khác biệt đó trong đợt docs; chuyển thành atom kỹ thuật và giao global CSS/locales cho Integrator.
Canonical quy tắc Reels/view timing chưa được coi hoàn tất chỉ từ đoạn mô tả; cần đọc và test player riêng.

## 9. Ownership và package

- Owner Social UI: `SRC/renderer/pages/social/**`, không sửa Router/Sider/HubRail/global CSS/locales trực tiếp.
- Owner Social service: `SOC/**`, trừ table/migration phải có chủ được đăng ký riêng.
- Integrator: `SRC/common/types/social/**`, `SRC/common/adapter/ipcBridge.ts`, `SRC/preload/main.ts`, `SRC/process/bridge/index.ts`, routing, locales, CSS và canonical status.
- Owner test đi cùng implementation hoặc independent verifier, không đồng thời sửa cùng production file.
- TARGET quyết định package ID/contribution/runtime chưa được chốt ở đây; không bịa manifest đã tồn tại.
- Nếu Social là optional app, chuyển implementation/assets/translations/service ra package và gọi qua versioned broker; route ẩn không đủ clean base.
- Browser session sharing là TARGET có consent/lease, không truyền raw partition/cookie giữa package.

## 10. Bằng chứng và kiểm thử tiếp theo

Đã đọc `tests/unit/social/socialBridge.test.ts`: login giả, adapter tiêm, quyền, ownership, rollback và receipt; không xác thực OAuth thật.
Đã đọc `tests/unit/social/socialDb.test.ts`: reopen bằng driver `node:sqlite`, owner collision, permission-before-pagination, viewed retention.
Các test DOM khác được tìm thấy; chỉ nâng kết luận sau khi đọc assertion hoặc chạy test tương ứng.
Lệnh thực có từ script `test = vitest run`: `bun run test tests/unit/social/socialBridge.test.ts tests/unit/social/socialDb.test.ts`.
Lệnh toàn feature: `bun run test tests/unit/social`.
Chưa chạy các lệnh này. Contract/integration mới phải kiểm tra Electron sender + preload + SQLite native + provider thật trong môi trường phù hợp.
Chi tiết acceptance, thứ tự, rollback và mẫu handoff nằm trong `tasks.md`.
