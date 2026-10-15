# Realtime Hub — Cây công việc và nghiệm thu bàn giao

## Quy ước và baseline

Snapshot: 2026-10-15; HEAD `4cf2b27113654ad10869297669d19e32ce8afdce`, worktree có sửa đồng thời.
Phụ thuộc canonical `docs/platform/realtime-hub-design.md`, `docs/platform/realtime-hub-plan.md`, registry `docs/README.md`.
Không thay master plan, chính sách Trust hoặc package ABI bằng cây task này.
`[x]` = atom implementation đã đọc; không có nghĩa test đã chạy hoặc production sẵn sàng.
Parent còn thiếu release/integration/acceptance vẫn `[ ]`; TARGET/BLOCKED luôn để mở.
Prefix `SRC` = `packages/desktop/src`; `RT` = `SRC/renderer/pages/realtime`.
Không chạy build/test trong đợt docs; không commit; chỉ có ba file bàn giao tại đây.

## Bản đồ bằng chứng và lệnh thực có

| Mã | Nguồn đã đọc | Cấp bằng chứng |
| --- | --- | --- |
| R-E1 | `SRC/common/types/platform/realtimeContent.ts` | Contract kênh/read/result |
| R-E2 | `SRC/process/services/realtime/realtimeContentBridge.ts` | Sender/parser/provider/cache/egress/dispose |
| R-E3 | `RT/services/realtimeClient.ts` | Renderer cache, TTL, retry, state |
| R-E4 | `RT/widgets/widgetRegistry.ts` | Catalog/settings parser/storage/reorder |
| R-E5 | `RT/index.tsx` | News mapping, reader state, focus route, draft |
| R-E6 | `tests/unit/realtime/realtimeContentBridge.test.ts` | Assertions fake IPC/fixture Response, chưa chạy |
| R-E7 | `tests/unit/realtime/realtimePage.dom.test.tsx` | Assertions stub electronAPI, chưa chạy |
| R-E8 | `SRC/process/services/security/providerDiscovery/providerDiscoveryBridge.ts` | Public IP/DNS pin, byte cap, socket timeout |

Lệnh dưới đây xác định từ `package.json` có `test: vitest run`; dành cho người nhận triển khai, **chưa chạy**:

```powershell
bun run test tests/unit/realtime/realtimeContentBridge.test.ts
bun run test tests/unit/realtime/realtimePage.dom.test.tsx
bun run test tests/unit/realtime
```

Không dùng tên test hypothetical như navigation.test.ts/realtimeProviders.test.ts trong plan cũ làm lệnh đã xác minh tồn tại.
Không lấy test `tests/unit/knowledge/realtime/` làm bằng chứng trang Hub này; đó là Realtime Knowledge subsystem.

## R-1 — Scope, nguồn chuẩn và ownership

- [ ] R-1 Khóa phạm vi release và trách nhiệm — PARTIAL; owner Integrator.
  - [x] R-1.1 Xác nhận route `/realtime` và navigation hiện tại — CURRENT tại Router/Sider.
  - [x] R-1.2 Xác nhận active page dùng realtimeClient, không import static provider trong index — CURRENT, R-E5.
  - [ ] R-1.3 Khóa wording sản phẩm: RSS một nguồn, GitHub recent-by-stars, market snapshots.
    - [ ] R-1.3.1 Không mô tả polling là push, quote là futures, draft là AI answer.
    - [ ] R-1.3.2 Thống nhất source timestamp với received updatedAt.
  - [ ] R-1.4 Quyết định shell capability và optional domain/package contribution — BLOCKED chờ Integrator/Store.
    - [ ] R-1.4.1 Ghi phần host rail trung lập và phần provider/widget implementation.
    - [ ] R-1.4.2 Chốt contribution identity/runtime/permissions trước SDK.
  - [ ] R-1.5 Khi triển khai đổi canonical, dùng checkpoint mới thay ví dụ sticky sidebar/mock AI cũ.

Nghiệm thu: decision scope được owner xác nhận, không tạo sidebar thứ hai và không thêm synthetic success.
Rollback: giữ decision chưa duyệt ở trạng thái TARGET, không đổi shared routes trong atom scope-only.

## R-2 — IPC và permission boundary

- [ ] R-2 Chứng minh read IPC xuyên preload an toàn — PARTIAL; owner Integrator + Security.
  - [x] R-2.1 Kênh `realtime-content.read`, request source/city và union lỗi tồn tại — CURRENT, R-E1.
  - [x] R-2.2 Sender bị kiểm tra trước parse/cache — CURRENT, R-E2.
  - [x] R-2.3 Field URL tùy ý/unknown source bị parser từ chối — CURRENT, R-E2/R-E6.
  - [ ] R-2.4 Thắt runtime city thành string hợp lệ, không dùng String coercion rồi cast.
    - [ ] R-2.4.1 Test array/object/number/null city và extra fields.
    - [ ] R-2.4.2 Request city với nguồn không-weather có normalization được chốt.
  - [ ] R-2.5 Integration Electron preload thật với trusted/untrusted frame.
    - [ ] R-2.5.1 Untrusted sender không chạm fetch/cache result.
    - [ ] R-2.5.2 Web-only thiếu API có UNAVAILABLE, không renderer fallback fetch.
  - [ ] R-2.6 Khóa account-bound network consent — BLOCKED chờ Trust contract.
    - [ ] R-2.6.1 Không gọi default public authority là consent của account.
    - [ ] R-2.6.2 Scope cache theo authority/account hoặc version để revoke có hiệu lực.

Allowlist R-2: transport file/tests; contract/preload/electron types/bootstrap do Integrator khóa và sửa.
Nghiệm thu: integration deny/schema/revoke có evidence, không chỉ injection `verifySender: () => true`.
Rollback: giữ read-only ABI cũ nếu tương thích; không thêm generic URL để né parser.

## R-3 — Provider, normalization và egress

- [ ] R-3 Hoàn tất public provider production path — PARTIAL; owner Transport.
  - [x] R-3.1 RSS endpoint hnrss.org/frontpage và giới hạn 24 item — CURRENT, R-E2.
  - [x] R-3.2 GitHub query 14 ngày/sort stars, không official Trending — CURRENT, R-E2.
  - [x] R-3.3 Hugging Face sort downloads và ID regex owner/name — CURRENT, R-E2.
  - [x] R-3.4 Weather ba city cố định và current/high/low — CURRENT, R-E2.
  - [x] R-3.5 Market bốn symbol với Promise.allSettled và finite values — CURRENT, R-E2.
  - [x] R-3.6 Egress admission trước network trên cache miss — CURRENT, R-E2.
  - [x] R-3.7 Shared helper public-IP/DNS pin, 1 MiB, socket timeout 12 giây — CURRENT, R-E8.
  - [ ] R-3.8 Test malicious RSS markup/entity/long text/invalid link không tạo executable DOM.
    - [ ] R-3.8.1 Test HTTP, credential URL, empty title và XML hỏng.
    - [ ] R-3.8.2 Phân biệt strip markup với sanitizer; full article extraction có contract riêng.
  - [ ] R-3.9 Test weather/market malformed fields, NaN, previous close zero và missing symbol.
    - [ ] R-3.9.1 Partial market result có nhãn thiếu nguồn thay vì ngụ ý đủ bốn quote.
    - [ ] R-3.9.2 Tất cả symbol 429 không bị mô tả nhầm thành nguồn rỗng bình thường.
  - [ ] R-3.10 Định nghĩa total deadline bao gồm DNS/queue/fan-out.
    - [ ] R-3.10.1 Cancel/timeout đóng request; late response không có tác dụng.
    - [ ] R-3.10.2 Rate/concurrency global và Retry-After/backoff không gây burst.
  - [ ] R-3.11 Thêm redacted audit operation/provider/status/bytes/duration/correlation.

Allowlist R-3: `SRC/process/services/realtime/**` và tests; shared egress helper/authority cần Security+Integrator phối hợp.
Nghiệm thu: malformed/deny/rate/timeout contract test và packaged live riêng; fixture parsing không chứng minh mạng thật.
Kill: deny provider operation trước outbound; rollback không hạ DNS/redirect/size guard để API chạy được.

## R-4 — Cache, refresh và cancellation

- [ ] R-4 Hoàn tất freshness/lifecycle — PARTIAL; owner Transport và UI client theo file riêng.
  - [x] R-4.1 Main TTL 300000 ms và singleflight Map — CURRENT, R-E2.
  - [x] R-4.2 Renderer TTL 5 phút, failure nextRefresh 60 giây — CURRENT, R-E3.
  - [x] R-4.3 Refresh lỗi giữ items/updatedAt trước, đổi status error — CURRENT, R-E3.
  - [ ] R-4.4 Test concurrent calls cùng key chỉ một fetch và khác city không trộn.
  - [ ] R-4.5 Test TTL sát biên, clock thay đổi và nguồn failure không cache Main.
  - [ ] R-4.6 Thống nhất force refresh: hiện chỉ bypass renderer, vẫn cache Main.
    - [ ] R-4.6.1 Nếu cần force network, thiết kế rate-limited contract trước thêm field.
    - [ ] R-4.6.2 UI không hứa dữ liệu mới khi chỉ nhận hit trong TTL.
  - [ ] R-4.7 Reauthorize cache hit/pending sau permission revoke.
    - [ ] R-4.7.1 Allowed -> fetch -> deny -> cache read không rò dữ liệu ngoài quyền mới.
    - [ ] R-4.7.2 Request pending hoàn thành sau revoke không phát update.
  - [ ] R-4.8 Dispose abort transport và generation fence, không chỉ clear Map.
    - [ ] R-4.8.1 Pending hoàn thành sau dispose không repopulate cache.
    - [ ] R-4.8.2 Dispose lặp lại an toàn, re-register không nhận response đời trước.
  - [ ] R-4.9 Chốt stale-age tối đa và hành vi offline kéo dài.
  - [ ] R-4.10 Chuẩn hóa key default city giữa client/Main; thử logout/account switch cache invalidation.

Nghiệm thu R-4: fake timers + race assertions + integration lifecycle, không hiểu nextRefresh 60s là interval 60s.
Rollback: giữ settings, xóa cache runtime theo lifecycle; không xóa localStorage toàn ứng dụng.

## R-5 — HubRail và cấu hình widget

- [ ] R-5 Hoàn tất rail dùng chung — PARTIAL; owner UI widgets; HubRail shared do Integrator.
  - [x] R-5.1 Catalog bốn built-in, default weather/market/github — CURRENT, R-E4.
  - [x] R-5.2 Parser bỏ unknown/duplicate, cap input 12, city fallback — CURRENT, R-E4.
  - [x] R-5.3 Key `tomni.realtime.widgets.v1`, event settings changed và move ±1 — CURRENT, R-E4.
  - [ ] R-5.4 Chạy DOM add/remove/reorder/collapse và restart settings.
    - [ ] R-5.4.1 Empty widgets hợp lệ khác corrupted settings; không tự thêm lại widget người dùng đã xóa.
    - [ ] R-5.4.2 Storage quota/blocked write cho biết cấu hình chỉ tồn tại phiên hiện tại nếu chọn UX đó.
  - [ ] R-5.5 Test đổi city khi focus weather đang mở, không response city cũ ghi đè.
  - [ ] R-5.6 Chốt polling khi rail hidden/collapsed/route khác; đo request và cleanup.
  - [ ] R-5.7 Giữ Explorer hoạt động, không nhân đôi sidebar hoặc fetch theo mỗi render.
  - [ ] R-5.8 Nếu đổi settings v2, migration pure/validated, backup v1 và rollback.
    - [ ] R-5.8.1 Không deserialize component code/module path từ localStorage.
    - [ ] R-5.8.2 Cấu hình package contribution chỉ nhận ID được registry xác minh.

Allowlist R-5: `RT/widgets/**`, DOM tests; HubRail/HubShell/global CSS/locales chỉ sửa qua owner chung.
Nghiệm thu: thao tác có keyboard/accessible labels, state bền vững, source lỗi riêng không phá toàn rail.

## R-6 — Feed, focus và reader

- [ ] R-6 Hoàn tất hành trình nội dung — PARTIAL; owner UI center.
  - [x] R-6.1 Page map RSS thành article body rỗng, isDemo false — CURRENT, R-E5.
  - [x] R-6.2 Chọn article lưu scrollTop và back feed restore bằng ref — CURRENT, R-E5.
  - [x] R-6.3 Source focus parse từ tập github/huggingface/market/weather — CURRENT, R-E5.
  - [ ] R-6.4 Test nhịp 1–3 với 0/1/2/3/4/5/8 article và phần dư.
  - [ ] R-6.5 Test first loading, cached refreshing, OFFLINE, DENIED, UNAVAILABLE, RATE_LIMITED riêng.
    - [ ] R-6.5.1 Stale data hiển thị timestamp và cảnh báo, không thay bằng mock.
    - [ ] R-6.5.2 Empty thật khác toàn item bị parser lọc; wording không khẳng định sai nguồn.
  - [ ] R-6.6 Test view lạ/item không tồn tại/deep-link refresh/back-forward.
  - [ ] R-6.7 Test scroll khi article list đổi, route unmount, rail resize và app restart.
  - [ ] R-6.8 Reader ghi rõ excerpt một nguồn, không badge multi-source giả.
  - [ ] R-6.9 Browser navigation kiểm tra HTTPS ở helper và host boundary; không suy ra HTTPS là đáng tin.
  - [ ] R-6.10 Full extraction/synthesis — TARGET, cần provenance, sanitizer, egress và evidence nguồn.
    - [ ] R-6.10.1 Citation trỏ fragment thực, source count theo dữ liệu đã xác minh.
    - [ ] R-6.10.2 Nguồn lỗi/paywall/mâu thuẫn có trạng thái rõ, không bổ sung facts bịa.

Allowlist R-6: `RT/RealtimeNewsFeed.tsx`, `RT/components/**`, `RT/focus/**`, `RT/article/RealtimeArticleView.tsx`, tests.
Nghiệm thu: UI thật đọc được trên desktop 1280–2560, keyboard/theme và nội dung không mất khi lỗi.

## R-7 — Draft handoff và Agent

- [ ] R-7 Hoàn tất agentic follow-up — PARTIAL; owner UI + Integrator runtime.
  - [x] R-7.1 Draft có title/excerpt/source URLs/questions, cap 6000 ký tự — CURRENT, R-E5.
  - [x] R-7.2 Navigate `/guid` với `state.realtimeDraft`, không gọi model tại page — CURRENT, R-E5.
  - [ ] R-7.3 Chạy DOM Enter/Shift+Enter và chuyển reference/câu hỏi sang Hub.
  - [ ] R-7.4 Xác minh Hub nhận draft editable, không tự submit/authorize khi chỉ mở route.
  - [ ] R-7.5 Bounded context không cắt mất câu hỏi/citation quan trọng; có policy truncation.
  - [ ] R-7.6 Nguồn bài untrusted không trở thành system instruction hoặc quyền thực thi.
  - [ ] R-7.7 Embedded chat stream — TARGET, phụ thuộc runtime contract.
    - [ ] R-7.7.1 Identity/origin/runId/context projection/consent trước model call.
    - [ ] R-7.7.2 Stream ordering, cancel, timeout, error và terminal receipt duy nhất.
    - [ ] R-7.7.3 Usage/budget/retry idempotency theo runtime, không billing logic riêng.
    - [ ] R-7.7.4 Câu trả lời có citations có thật; latency badge đo thực, không “3s” cố định.

Allowlist R-7: `RT/article/ArticleChatThread.tsx`, input/page theo ownership đã khóa; shared Hub/runtime do Integrator.
Kill/rollback: tắt entry model mới, vẫn cho đọc nguồn và draft; không sinh response giả để giữ giao diện.

## R-8 — Package, migration và release

- [ ] R-8 Hoàn tất clean integration — TARGET; owner Integrator + Store + verifier.
  - [ ] R-8.1 Chốt contribution boundary trước mở third-party widgets — BLOCKED theo R-1.4.
  - [ ] R-8.2 Package identity, signature, capability và disable/uninstall hủy polling/fetch.
  - [ ] R-8.3 Nếu extraction: emitted graph không còn domain implementation trong base.
    - [ ] R-8.3.1 Clean-machine absence/install/restart/disable/enable/uninstall evidence.
    - [ ] R-8.3.2 Không dùng trusted-react mặc định cho third-party code.
  - [ ] R-8.4 Migration settings backup/version/rollback có test và không mất thứ tự widget.
  - [ ] R-8.5 Global kill bao phủ HubRail ở mọi route, không chỉ `/realtime` center.
  - [ ] R-8.6 Lint/format/types/i18n/accessibility do owner chung chạy ở revision tích hợp.
  - [ ] R-8.7 Packaged Electron live từng provider, ghi rate-limit/offline chứ không dùng fixture.
    - [ ] R-8.7.1 Ghi OS/app version/time/endpoint/status/updatedAt/output redacted.
    - [ ] R-8.7.2 Kiểm tra network denied không socket; timeout/dispose không orphan request.

## R-9 — Đóng bằng chứng và bàn giao

- [ ] R-9 Hoàn tất nghiệm thu Realtime — TARGET; không đóng bằng số file hoặc test lịch sử.
  - [ ] R-9.1 Chạy ba lệnh test mục đầu và ghi exit code độc lập.
  - [ ] R-9.2 Chạy `bun run lint`, `bun run format:check`, `bunx tsc --noEmit`, `bun run test` khi được giao implementation verification.
  - [ ] R-9.3 Nếu đổi text/i18n, chạy `bun run i18n:types` và `node scripts/check-i18n.js` ở change triển khai.
  - [ ] R-9.4 Test mới phải có path owner xác nhận trước khi ghi lệnh exact, không dùng passWithNoTests làm proof.
  - [ ] R-9.5 Giao canonical status cho Integrator cùng evidence revision và unresolved blockers.
  - [ ] R-9.6 Review MTUI diff/status, không sửa docs/plan của agent khác.

## Mẫu bàn giao atom

```text
Atom ID / parent / owner / người nhận:
Starting HEAD + dirty scope / ending revision:
Allowlist / forbidden shared files / yêu cầu Integrator:
Trạng thái CURRENT | PARTIAL | TARGET | BLOCKED và lý do:
Hành trình và acceptance có thể quan sát:
File/symbol thay đổi:
Bằng chứng đọc mã / fixture / Electron IPC / packaged live:
Lệnh đã chạy + exit code + thời điểm + output redacted:
Provider/source timestamp vs Main updatedAt:
Migration settings version / backup / restore proof:
Kill admission + scheduler + inflight + late response:
Rollback chỉ file sở hữu, dữ liệu giữ lại:
Blocker và dependency owner:
Rủi ro còn lại / conflict / unrelated dirty paths:
Commit ownership: không commit khi chưa có ủy quyền:
```

Đợt tạo tài liệu này chỉ kiểm toán đọc mã/test; mọi gate thực thi ở R-9 còn mở và chưa có live network proof mới.
