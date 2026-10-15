# Realtime Hub — Hợp đồng kỹ thuật bàn giao

## 1. Mốc và nguồn chuẩn

Snapshot dirty worktree ngày 2026-10-15; HEAD `4cf2b27113654ad10869297669d19e32ce8afdce`.
Tài liệu này phụ thuộc `docs/platform/realtime-hub-design.md`, `docs/platform/realtime-hub-plan.md` và registry `docs/README.md`.
Không chạy test; không sửa production. CURRENT chỉ mô tả mã đã kiểm toán.
`SRC` = `packages/desktop/src`; `RT` = `SRC/renderer/pages/realtime`.

## 2. Đường dữ liệu hiện tại

```text
Router /realtime + HubRail tab Realtime
 -> RT/services/realtimeClient.ts / useRealtimeSource
 -> window.electronAPI.realtimeContent.read
 -> SRC/preload/main.ts
 -> realtime-content.read
 -> SRC/process/services/realtime/realtimeContentBridge.ts
 -> sender -> request parser -> cache/singleflight -> egress admission
 -> createPinnedProviderDiscoveryFetch -> fixed public endpoints
 -> normalize -> bounded typed response -> cache -> rail/center
```

`SRC/process/bridge/index.ts` gọi `registerRealtimeContentBridge({ipcMain})`.
`SRC/common/types/platform/electron.ts` khai báo API optional; browser-only renderer không có bridge nhận UNAVAILABLE.
Realtime Knowledge/MCP trong `SRC/process/knowledge/` là subsystem khác; không dùng test của RTK để chứng minh trang `/realtime`.

## 3. Hợp đồng IPC CURRENT

Nguồn: `SRC/common/types/platform/realtimeContent.ts`.

```typescript
type RealtimeSource = 'news' | 'github' | 'huggingface' | 'weather' | 'market';
type RealtimeCity = 'hanoi' | 'hochiminh' | 'danang';
type RealtimeReadRequest = Readonly<{ source: RealtimeSource; city?: RealtimeCity }>;
```

- Kênh cố định: `realtime-content.read`.
- Thành công: `{ok:true, source, updatedAt: ISO string, items: readonly RealtimeEntry[]}`.
- Thất bại: `{ok:false, code:'DENIED'|'INVALID'|'OFFLINE'|'UNAVAILABLE'|'RATE_LIMITED'}`.
- Entry có id/title/description; optional url/language/publishedAt/value/changePercent/unit.
- `requestOf` từ chối non-object/array, source lạ, city lạ, field ngoài source/city.
- City mặc định hanoi kể cả request nguồn khác weather; key cache Main là source:city sau normalize.
- Parser city dùng `String(data.city)` rồi ép kiểu: TARGET cần kiểm tra string thật ở wire boundary, không dựa TypeScript cast.
- Không hỗ trợ custom URL, token, model invocation, arbitrary HTTP hay query do renderer chọn.
- TARGET response runtime validation phía renderer cần xem xét; hiện client tin typed bridge result.

## 4. Provider mapping và normalize

| Source | Endpoint / selector | Normalize hiện tại |
| --- | --- | --- |
| news | `https://hnrss.org/frontpage` | Regex item/tag, strip markup, decode vài entity, HTTPS link + title |
| github | `https://api.github.com/search/repositories?q=created%3A%3E<14-days>&sort=stars&order=desc&per_page=24` | full_name, html_url host github.com, description, language, finite stars |
| huggingface | `https://huggingface.co/api/models?sort=downloads&direction=-1&limit=24` | ID dạng owner/name, pipeline_tag, downloads, link dựng từ ID |
| weather | `https://api.open-meteo.com/v1/forecast` với coords cố định | current temperature và high/low ngày đầu |
| market | `https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?interval=1d&range=2d` | regularMarketPrice, previous close, changePercent |

- MAX_ITEMS = 24, MAX_TEXT = 900; repo name 160, language 60, model ID 200; link tối đa 2048.
- `clean` bỏ control characters, trim và slice; không phải HTML sanitizer tổng quát.
- Link phải HTTPS, không username/password; article host không cố định allowlist như provider fetch endpoint.
- RSS lấy 24 item trước khi lọc; dữ liệu không hợp lệ có thể làm kết quả ngắn hơn 24.
- Market fan-out bốn symbol: %5EGSPC, %5EIXIC, BTC-USD, %5EVIX.
- `Promise.allSettled` giữ nguồn market thành công và bỏ nguồn lỗi; thiếu một quote không tạo lỗi tổng khi còn item.
- Tất cả quote thất bại trả items rỗng -> UNAVAILABLE, có thể che RATE_LIMITED của từng symbol.
- TARGET bổ sung partial-result/provenance/error per symbol nếu UI cần giải thích thiếu dữ liệu.
- Không có OHLC/history trong RealtimeEntry; không thể suy ra chart từ response hiện tại.

## 5. Sender, egress và giới hạn transport

- Sender mặc định qua `foundationTrustedOrigin(event)`; injection verifySender chỉ là seam kiểm thử.
- `REALTIME_PUBLIC_READ_AUTHORITY` allow các operation cố định: rss-refresh, github-trending, huggingface-models, weather, market-data.
- Đây là public credential-free admission, không phải quyền theo người dùng/account hoặc package.
- Cache hit và pending return xảy ra trước `requireNewsEgressAdmission`.
- TARGET khi authority có thể revoke: reauthorize hoặc scope/version cache trước trả hit; phải kiểm tra kết quả pending sau revoke.
- `readPublicRealtimeSource` export có thể gọi độc lập không admission; hiện registered handler là seam cần bảo vệ cho mọi caller production tương lai.
- Fetch dùng GET, Accept xác định, User-Agent `TomniHubOS-Realtime/1.0`, redirect manual.
- HTTP 403/429 -> RATE_LIMITED; HTTP khác không ok -> OFFLINE.
- Helper ở `SRC/process/services/security/providerDiscovery/providerDiscoveryBridge.ts` resolve public IP, pin socket lookup, không follow redirect.
- Helper có MAX_RESPONSE_BYTES 1,048,576 và REQUEST_TIMEOUT_MS 12,000.
- Không hạ bảo vệ helper vì public endpoint trả redirect hoặc chặn User-Agent.
- TARGET cần deadline toàn request gồm DNS; socket timeout không đủ giới hạn chờ DNS/queue.
- TARGET hủy AbortSignal xuyên suốt; caller dispose hiện chưa chứng minh hủy socket.
- TARGET egress audit gồm operation/provider/status/bytes/duration/correlation, không prompt/token raw.

## 6. Hai lớp cache và lỗi

### Main

- TTL 300000 ms; Map cache theo source:city và Map pending singleflight.
- Chỉ response có item mới cache; failure không cache ở Main.
- `updatedAt` là lúc Main nhận/chuẩn hóa, không phải lúc provider quan sát từng số liệu.
- Dispose removeHandler, clear cache và pending; không có generation/abort trong phần đã đọc.
- TARGET request đang chạy sau dispose không được repopulate cache hoặc gửi response đã bị thu hồi.

### Renderer

- Cache module-level records; key `source:${city ?? ''}`; center và rail chia sẻ theo key.
- State idle/loading/ready/error, items, updatedAt, error.
- Thành công đợi 5 phút; failure đặt nextRefresh sau 60 giây.
- Interval useEffect vẫn 5 phút: nextRefresh 60 giây không có nghĩa retry tự động sau đúng 60 giây.
- Force bỏ TTL renderer nhưng không bỏ TTL Main vì request không có force.
- Có items cũ thì bắt đầu refresh vẫn ready; failure giữ items/updatedAt và đổi error.
- Unmount bỏ listener/interval, không hủy inflight IPC.
- TARGET thống nhất key default city, reset account/session, stale policy, background scheduling và resource lease.
- TARGET manual refresh cần semantics rõ: đọc cache hợp lệ hay ép network; không tăng API load vô điều kiện.

## 7. Widget settings và migration

Nguồn `RT/widgets/widgetRegistry.ts`:

- Key `tomni.realtime.widgets.v1`, event `tomni-realtime-widget-settings-changed`.
- Catalog chỉ weather/market/github/huggingface; settings chứa widgets[{id,collapsed}], city.
- Default ba widget weather/market/github và hanoi.
- Parse tối đa 12 item đầu, bỏ unknown/duplicate, collapsed chỉ true khi boolean true.
- Invalid toàn object -> default; object hợp lệ nhưng widgets không hợp lệ có thể ra [] thay vì default.
- LocalStorage read lỗi -> default; write lỗi bị catch và không báo UI.
- moveWidget chỉ ±1, out of bounds trả settings cũ.
- TARGET migration v2: validate v1 -> backup raw value -> pure transform -> validate v2 -> lưu key mới -> giữ v1 để rollback.
- Không xóa cấu hình người dùng khi feature bị disable; reset phải là thao tác riêng có xác nhận.
- Schema có package widget tương lai phải dùng opaque contribution ID đã xác minh, không JS/module path/URL tùy ý.

## 8. Page, reader và AI

- `RT/index.tsx` parse view trong tập bốn source; item từ search params.
- Feed/article/chat là local state, không persistent route entity.
- ScrollTop lưu ref khi chọn article và restore bằng useLayoutEffect; không chứng minh qua reload/unmount.
- News map body=[] và source label Hacker News RSS; isDemo=false vì đường active không dùng static fixtures.
- Draft 6000 ký tự gồm lời cảnh báo single source, title, excerpt, nguồn, câu hỏi, yêu cầu verify/citations.
- `navigate('/guid', {state:{realtimeDraft: prompt}})` chỉ chuyển draft; không gọi model ở đây.
- TARGET draft truncation phải giữ ranh giới source/câu hỏi; không nâng bài báo thành system instruction.
- TARGET inline run dùng runtime chung: identity/origin, approval, context projection, stream ordering, cancel, usage, receipt.
- TARGET reconnect/retry run không tạo hai phiên trả lời hoặc hai lần tính phí.
- Không sử dụng static demo provider để vá lỗi fetch; nếu cần demo phải chế độ riêng có nhãn rõ.

## 9. Package và quyền sửa file

- Owner UI: `RT/**`, tests DOM tương ứng; không tự sửa HubRail/global CSS/locales/routing.
- Owner transport: `SRC/process/services/realtime/**`, bridge tests; không tự sửa shared egress helper hoặc bootstrap.
- Integrator: preload, electron types, IPC contract, `process/bridge/index.ts`, Router/Sider/HubShell/HubRail, locales, global CSS, migration/contracts.
- Security owner đề xuất thay đổi `newsEgressAuthority.ts` và providerDiscovery helper qua Integrator, vì có consumer khác.
- Package widget SDK là TARGET; catalog built-in không phải package install lifecycle.
- Direct import RealtimeWidgetRail từ HubRail là CURRENT coupling; cần quyết định shell capability tối thiểu và phần domain optional theo canonical package.
- Không bịa package ID hiện hành; khóa quyết định và allowlist trước extraction.
- Clean-base phải dựa artifact graph + absence/install/disable/uninstall, không chỉ ẩn tab.

## 10. Rollback và kill-switch

CURRENT chỉ có disposer handler/cache; chưa có end-to-end runtime kill switch đã kiểm chứng.
TARGET kill: ngừng scheduling renderer, từ chối admission mới, abort inflight, invalidate generation, bỏ listener và không nhận late response.
TARGET fallback khi kill là unavailable/disabled có lý do, không fake reading.
Rollback triển khai do Integrator gỡ registration/contribution đã sở hữu, restart nếu chưa có hot-dispose; giữ settings v1 và chứng cứ lỗi.
Nếu migration đã đổi schema, rollback dùng bản backup được kiểm tra, không xóa localStorage toàn app.
Tắt route không dừng rail ở route khác; kill phải bao phủ cả HubRail global.

## 11. Kiểm thử và mức bằng chứng

Đã đọc `tests/unit/realtime/realtimeContentBridge.test.ts`: fixture GitHub/HF/RSS, fake IPC, sender deny, input lạ, egress deny và cache hit.
Đã đọc `tests/unit/realtime/realtimePage.dom.test.tsx`: stub electronAPI, feed-reader-draft, drilldown, widget persistence, city event, keyboard, Browser route và empty.
Những test này không chứng minh DNS thật, Electron preload thật hoặc provider hiện sẵn sàng.
Lệnh xác định từ package.json: `bun run test tests/unit/realtime/realtimeContentBridge.test.ts tests/unit/realtime/realtimePage.dom.test.tsx`.
Toàn feature: `bun run test tests/unit/realtime`; chưa chạy trong bàn giao.
TARGET bổ sung concurrent singleflight, TTL boundary, 403/429/timeout, malformed weather/market, dispose race, revoke cache và cross-account cache.
Chỉ chạy packaged/network verification khi có môi trường; ghi app version, endpoint, timestamp, status, redacted output và exit code riêng.
