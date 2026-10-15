# TomniHubOS — Home (`/guid`): Logic & Workflow giao diện

Tài liệu mô tả **luồng hoạt động và logic tương tác** của trang Home theo mockup
`mockup/home-wireframe-v3.html`. Đây là bản đặc tả để team implement logic;
phần visual (màu, glass, bố cục) thuộc `tomni-design-system.md`.

Trạng thái: **PARTIAL** — lưới activity và Session Memory có đường chạy Core cùng test; Diff, preview và pop-out còn TARGET. Mục (mock) không phải tính năng production đã có.

## 1. Tổng quan bố cục

```
┌──────────────────────────────────────────────────────────────────────┐
│ Titlebar: ← → | ⌘K search | ◖ thông báo | [N] avatar | ─ □ ✕        │  44px, glass
├──────────┬──────────────────────────────────────────┬────────────────┤
│ Sidebar  │  Center                                   │  Rail (tabbed) │  glass 3 cột
│ 232px    │  - Lưới quan sát agent (tiles)            │  [Tệp|＋]       │
│          │  - Composer (sticky) + quick chips        │  panel/tab     │
├──────────┴──────────────────────────────────────────┴────────────────┤
│ Statusbar: agent • ping • model | Hỗ trợ • Report • version • Terminal • Core │ 28px
└──────────────────────────────────────────────────────────────────────┘
```

- Cửa sổ **transparent** (win/linux): desktop hiện qua các lớp glass; route khác
  `/guid` tự sơn nền đục (`bg-base`).
- Composer **CURRENT** giữ nguyên khi Home đổi welcome/lưới activity. Composer xuyên các package surface là **TARGET**; package đang thay vùng center.

## 2. Titlebar

- Bỏ: nút hamburger, chữ "Tomny", nút 3 chấm, nút chuyển sáng/tối riêng.
- Giữ: ← → (history), ô search trung tâm (⌘K mở command palette), ◖ notification,
  avatar **[N]**.
- **Click avatar [N]** mở menu: credit/số dư, thông tin tài khoản, mục
  **Settings** ở dưới cùng; toggle sáng/tối nằm trong menu này (không phải nút riêng).
- Nút ─ □ ✕ là window controls tự vẽ (frameless).

## 3. Sidebar (trái)

Thứ tự các section, từ trên xuống:

1. **Brand** TOMNY + nút thu gọn (`<`).
2. **Nav chính** (5 mục): Home `/guid` · Company `/company` · Artifacts `/artifacts`
   (tạm redirect sang package Company cho tới khi có trang riêng) · Schedule
   `/scheduled` · Store `/store`. Item active nền sáng chữ đen (monochrome).
   `/company` (CURRENT) render trong vùng giữa của Hub, không có tab: danh sách công ty + "Thêm
   công ty"; vào một công ty là chat nhóm, bánh răng góc phải mở cài đặt riêng của công ty.
   Nút ở chân sidebar (đối diện số agent đang chạy) chuyển danh sách Workspace ⇄ Company. Mỗi
   công ty là một thư mục: bấm thư mục để vào chat nhóm, bấm agent con để chat riêng 1-1.
   Chat nhóm (CURRENT, renderer, engine `company/group/groupEngine.ts`):
   - Mỗi tin của user được Laya chấm mức liên quan cho từng thành viên; chỉ ai ≥ 60% hoặc được
     `@tên` mới được gọi đọc (không ai đạt thì leader đọc). Dòng dưới tin hiển thị ai được gọi/bỏ qua.
     Laya chưa sẵn sàng → so khớp từ khoá; IPC lỗi → mọi thành viên đọc.
   - Agent có thể `@tên` để chuyển việc cho agent khác (tối đa 2 lượt chuyển mỗi tin); thành viên
     không có gì để nói trả `PASS` và không đăng gì. Người bị bỏ qua đọc bù tối đa 40 dòng sau.
   - Mục tiêu chung của nhóm được đưa vào mọi prompt. Câu trả lời stream trực tiếp; agent chờ duyệt
     quyền hiện nút "Mở chat để duyệt" (duyệt trong chat riêng, không duyệt hộ).
   - Engine sống ở cấp module: rời trang company vẫn chạy tiếp khi app còn mở.
   - **Lịch nhóm**: sự kiện một lần / hằng ngày / thứ 2–6 / hằng tuần, gọi người tham gia đã chọn
     (hoặc để Laya chọn) hoặc chạy một workflow. Chỉ chạy khi app mở; lịch lỡ lúc tắt app chạy bù
     khi mở lại (đánh dấu trễ), lịch lặp chỉ chạy lần gần nhất.
   - **Workflow nhóm**: chuỗi bước (≤ 12), mỗi bước giao một agent kèm chỉ dẫn, kết quả bước trước
     chuyển sang bước sau và đăng vào chat; dừng ở bước đầu tiên lỗi.
   - Lưu trữ: transcript và mục tiêu/lịch/workflow nằm trong localStorage của renderer (chưa đồng bộ
     sang main process hay MCP company). Mỗi agent vẫn chạy với chế độ quyền của chính nó.
3. **Ứng dụng ghim (PARTIAL, 2026-10-15)**: mặc định 5 vị trí Browser, IDE, Document, Automation, Calculator; cho ghim/bỏ ghim nhưng không dưới 3 vị trí. Trạng thái package đến từ bộ cài Main, lối tắt không chứng minh app đã cài. **"Xem tất cả (N)"** mở popup riêng, không chuyển vào Store; `N` đếm package đã cài (không phải shortcut hoặc web-embed), mỗi package một card kèm nút Quản lý. Repo-to-Package local-built đã cài có thể xuất hiện kể cả không có UI riêng, nhưng không đồng bộ lên cloud. Browser và IDE còn code trong base; việc đóng gói/gỡ sạch là TARGET, không được suy từ icon sidebar.
4. **Section "Active" (CURRENT)**: nhóm các phiên Chat và phiên package đang có. Chat lấy từ lịch sử hội thoại (tối đa 30 dòng gần đây); trạng thái live tô dot, thư mục workspace dùng làm nhóm.
   - Mỗi dòng: **dot trạng thái** + tên task.
   - Dot: 🟢 `in_progress` · 🟡 `todo` (chờ/xếp hàng) · ⚪ `done` (xám, đã xong).
     _(Trong tương lai: 🔴 lỗi, 🟡 chờ user phản hồi — theo mockup.)_
   - Click dòng → mở trang Quản lý (`/manager`) tại task đó.
   - Tối đa 5 dòng, dư ra gom vào **"Show more (N)"**.
   - Trống: hiển thị dòng nhạt "Chưa có agent nào".

> **PARTIAL (2026-10-15), Sidebar Chức năng:** giữ giao diện cũ, không nút ghim và không tiêu đề "Điều hướng chính". Năm chức năng đầu là Home · Artifact · Schedule · Company · Store, các mục còn lại xem bằng scroll; kéo–thả hoặc Alt+↑/↓ để đổi thứ tự, lưu trên từng tài khoản. Chiều cao Chức năng giới hạn bởi tối thiểu 3 dòng và tối đa toàn bộ số mục; khung Apps không dài hơn số lối tắt ghim; min Active giữ nguyên.

> **CURRENT (2026-10-14):** Chat trong sidebar Active có menu `⋯` khi hover và click trái: xóa (xác nhận), hiển thị/khôi phục ô Agent trên Hub, đổi tên, fork cuộc trò chuyện cùng lịch sử và export JSON ra thư mục người dùng chọn. Click trực tiếp tên chat vẫn mở hội thoại; select/batch delete vẫn hoạt động. Đây là thay đổi so với mockup sidebar cũ.

## 4. Center — lưới quan sát agent

### 4.1 Lưới tiles

**Nguồn dữ liệu (CURRENT).** Lưới đọc từ Hub activity registry ở Main
(`process/system/hubActivity/`), không đọc task Manager. Registry gom mọi việc
đang chạy trên mọi workspace, cập nhật đẩy qua `hub-activity.changed` (gộp 200 ms):

| Loại       | Nguồn                                                                                | Dừng          | Trả lời                                              |
| ---------- | ------------------------------------------------------------------------------------ | ------------- | ---------------------------------------------------- |
| `agent`    | sự kiện hội thoại (`subscribeTomniRemoteEvents`): nội dung, tool, permission, finish | hủy hội thoại | quyết định permission (allow once / always / cancel) |
| `schedule` | audit của scheduled-task service (started/retrying/completed/failed)                 | hủy lượt chạy | —                                                    |
| `team`     | trạng thái slot agent trong Team (`task-status`)                                     | —             | —                                                    |
| `app`      | phiên Terminal (tiến trình thật)                                                     | kill phiên    | —                                                    |

**Agent tile đã hoàn thành/không hoạt động được giữ đến khi người dùng chọn Gỡ khỏi Home**, không áp dụng TTL 30 phút hay giới hạn 60 mục để tự xóa agent. Các loại hoạt động khác vẫn áp dụng giới hạn 60 mục, TTL 30 phút; 8 bước mỗi mục. App package
khác không chạy nền sau khi rời trang nên chưa có tile riêng.

Lưới được lưu xuống `runs/hub-activity.json` (ghi ngay lần đầu, debounce 1 giây cho update sau) và phục hồi khi app
khởi động lại: việc đang chạy quay về `stopped`, prompt permission và bước đang
chạy không được khôi phục, chỉ mục không phải Agent quá hạn TTL mới bị loại. Mục còn sống trên máy luôn
thắng dữ liệu cũ (`live-wins`).

- Mặc định **2×2 = 4 ô**; nút **4 ô / 6 ô** trên thanh lưới (lưu theo máy, không phải Settings).
- Mỗi tile = 1 agent/task đang hoạt động:
  - Header: dot trạng thái + tên agent + badge trạng thái (`follow` khi đang theo).
  - Chân tile: loại việc · workspace · trạng thái.
  - Thân: **bước công việc đang chạy** (checklist trực quan: ✓ đã xong, ▶ đang
    làm, kèm text), progress bar, mô tả ngắn.
  - Nếu agent **cần xác nhận**: hiện câu hỏi + nút lựa chọn ngay trong tile
    (VD "Chạy migration trên prod? [Chạy] [Không] [Hỏi lại]") — click nút hoặc
    click tile để trả lờI qua chat.
- **Ô trống**: tile dashed "Bắt đầu agent mới" → focus composer.
- Tương tác:
  - **Double-click** tile → mở rộng thành view chat đầy đủ của agent đó.
  - **Click** tile → chọn (rail Tệp theo workspace của tile).
  - **Chuột phải** tile → menu ngữ cảnh: `follow [v]` (mặc định bật; bật/tắt),
    `ping` (đưa tile vào danh sách được render realtime), Mở, Dừng (khi còn chạy),
    Gỡ khỏi Home (khi đã xong).
    - **Follow tắt** chỉ thay đổi theo dõi/cách cập nhật; **không** tự gỡ Agent sau khi hoàn thành. Agent chỉ rời lưới khi người dùng chọn Gỡ khỏi Home hoặc xóa hội thoại.
  - **Drag** tile để đổi vị trí trong lưới. Thứ tự, ping, follow và số ô lưu ở
    `localStorage` (`tomni.hub.liveGrid`), id cũ tự dọn.
- **Vòng chạy (CURRENT, 2026-10-14):** không có activity hiển thị welcome; push/snapshot chuyển sang tiles. Agent finished/idle/error/stopped đều giữ nguyên đến khi user gỡ. Unfollow không tự gỡ. Gỡ tile cuối quay lại welcome. Snapshot cũ không ghi đè push mới; permission response cũ không hồi sinh tác vụ đã xong. Chỉ activity khác Agent vẫn dùng TTL 30 phút.
- **CURRENT:** Activity được lưu tại `runs/hub-activity.json` và phục hồi sau restart; lượt chạy bị gián đoạn được hiển thị là stopped, không tiếp tục chạy tự động.
- **Ping & tải máy**: hệ thống khuyến nghị số ô tối đa nên ping; ping vượt ngưỡng
  → cảnh báo kèm lý do (CPU/RAM thật). Ô không được ping vẫn hiển thị nhưng chỉ
  cập nhật chat đơn giản, tiết kiệm tài nguyên.
- **Escalation tự động (CURRENT)**: agent không được ping mà hỏi xác nhận hoặc lỗi tự được ưu tiên lên ô trống phía đầu. Bố cục tạm không lưu; hết cần chú ý thì tile trở về thứ tự người dùng. Tile đã hoàn thành vẫn tồn tại nhưng không liên tục chiếm ưu tiên.
- Ngưỡng ping khuyến nghị theo CPU/RAM thật: ≥85% → 2 ô, ≥70% → 3 ô, còn lại 6.

### 4.2 Empty state (chưa có agent nào)

Thay vì lưới tiles, center hiển thị:

1. **Welcome head**: "Hôm nay bạn muốn làm gì?" + subtitle.
2. **App grid**: 5 app chính (Chat, Browser, Company, Tự động hóa, IDE) — dữ liệu thật.
3. **Promo panel** (glass): tiêu đề + mô tả + 3 điểm nổi bật (đa agent song song,
   artifacts & tệp, tự động hóa & lịch) + CTA "Khám phá Store".
   → Mục đích: quảng bá/lấp đầy không gian trống khi không có agent chạy.

## 5. Composer (ô nhập chat)

- Vị trí **CURRENT**: dưới cùng center của Home, luôn giữ cùng composer khi chuyển welcome ↔ lưới agent. Lưới cuộn độc lập trong phần chiều cao còn lại; composer và quick chips có hàng riêng, không bị tile đẩy khỏi viewport. Đổi sang package surface hiện thay toàn bộ center (**PARTIAL** so với composer shell-level xuyên trang).
- Nội dung đang gõ, focus và lựa chọn agent/model không reset khi activity bắt đầu, kết thúc hoặc bị gỡ. Test DOM kiểm tra giữ cùng node qua các trạng thái.
- Nội dung: placeholder "Nhập tin nhắn… (/ lệnh · @ tham chiếu file)", chọn
  agent (chip "Tomny Agentic"), model; nút đính kèm, gửi.
- **Quick chips (CURRENT)**: chỉ hiện khi Home chưa chọn workspace và chưa ghi nhận activity. Gõ bản nháp không tự ẩn gợi ý. Khi chọn workspace hoặc activity xuất hiện, hàng này chuyển thành dải ngữ cảnh bên dưới composer và không tự trở lại trong cùng lần mở Home khi xóa lựa chọn hoặc gỡ tile cuối.
- **Dải ngữ cảnh (CURRENT)**: workspace của tác vụ tiếp theo, model đã chọn, số tệp đính kèm khi có và số agent đang chạy khi lớn hơn 0. Tên dài rút gọn, đường dẫn đầy đủ có tooltip; metadata xuống dòng khi center hẹp để không tràn qua rail. Bấm thư mục mở picker native; lựa chọn được ghi nhớ cục bộ, có thể xem/gỡ tại Settings → Privacy & Security. Bản ghi này chỉ là lựa chọn workspace của người dùng, không tự cấp capability cho agent. Nút x bỏ workspace chọn và dùng workspace riêng mặc định do Main provision khi gửi. Chọn tile chỉ đổi rail, không tự ghi đè workspace composer hoặc quyền run đang chạy. Composer/draft/focus không remount khi thay hàng gợi ý bằng dải ngữ cảnh.
- **Gửi thường từ Home (CURRENT)**: tạo phiên và gọi `conversation.native.send` ngay, không điều hướng sang chat hoặc chờ chat mount. Activity push tự chuyển welcome thành tiles. Cùng native bridge giữ account/pipeline/outbound/runtime checks. Nút gửi và Enter dùng cùng khóa; lỗi tạo/gửi không xóa bản nháp; thành công chỉ xóa nội dung/tệp đã gửi, giữ nội dung mới và thư mục cho việc tiếp theo. Preset và lệnh Tomny bắt đầu `/` vẫn mở trang hội thoại để giữ bộ điều khiển Goal/command (**PARTIAL** cho luồng Home xuyên mọi lệnh).

## 6. Rail phải (tabbed)

- Lần mở app đầu tiên, rail chỉ có **[Tệp | ＋]**. Các tab đã mở và tab đang chọn được lưu cục bộ và phục hồi sau khi mở lại app; tab đang mở nền sáng chữ đen.
- **Explorer (CURRENT)**: thư mục/tệp thật, chọn thư mục mặc định từ Main hoặc workspace của agent; breadcrumb, tìm/làm mới, sort/cột thích ứng, menu chuột phải tạo/đổi tên/sao chép/di chuyển/xóa và focus cho tác vụ tiếp theo. Contract/renderer/filesystem tests là bằng chứng; bản đóng gói hiện hành chưa được xác nhận.
- **TARGET**: preview tệp ngay trong Home và tự đính tham chiếu vào composer; hiện mở tệp bằng ứng dụng desktop, không có preview đè lưới.
- **Diff**: hiển thị diff code của agent đang chọn (khi agent sửa file). `(mock)`
- **[＋] (CURRENT)**: khi chưa chọn agent chỉ mở lại Explorer; Diff đã lưu tạm ẩn. Khi click tile agent có conversation, Diff hiện lại và menu gợi ý Explorer/Diff/**Session Memory** cho agent đó. Đây là điểm mở rộng theo surface/package contract, không để Hub import implementation của package. Lưới vẫn dùng metrics để khuyến nghị ping.
- **Session Memory (CURRENT)**: chọn tile agent để xem bộ nhớ tương ứng; app/team/schedule hoặc chưa chọn thì không đọc nhầm phiên. Main giải mã conversation id thành private memory id.
  - Xem ghi chú/tóm tắt, tìm kiếm, lọc loại/ghim, mở chi tiết, tự cập nhật khi tab hiển thị.
  - Thêm ghi chú có loại/ghim và xóa phiên qua xác nhận native; không xóa khi agent đang chạy. Xóa phiên cũng xóa bí mật phiên.
  - Không trả tên khóa/giá trị secret, không lưu nháp trước khi có phiên, response cũ không ghi đè agent mới.
  - Kênh Core trong preload không cần IDE. Note là ngữ cảnh, không cấp quyền chạy tool.
- Tab panel **có thể bứt ra**: kéo tab thành panel nổi bên cạnh cửa sổ, hoặc dock
  xuống dưới. `(mock)`

## 7. Statusbar

- Số agent đang chạy nằm dưới đường phân cách đáy sidebar; footer chỉ giữ số việc cần chú ý khi có. **CURRENT**
- Phải: Báo cáo (i18n) · version · Terminal (mở app terminal/package) ·
  Core health (dot xanh "Hoạt động tốt").

## 8. Workflow ngườI dùng chính

1. Mở app → empty state: welcome + app grid + promo.
2. Gõ yêu cầu vào composer (hoặc click quick chip / app card) → gửi.
3. Tile agent xuất hiện ở ô đầu tiên, dot xanh, chạy từng bước hiển thị trực tiếp.
4. Giao thêm việc → tile thứ hai, thứ ba… (2 ô lớn → từ 3–4 ô thành lưới vuông,
   nhiều hơn thì cuộn).
5. Agent cần xác nhận → tile nhấp nháy/escalate, click tile → trả lờI trong panel
   chat của tile.
6. Agent làm việc với browser/file → có thể bật xem trực tiếp (view tương tác)
   thay vì xem chat.
7. Hoàn thành → dot đổi xám; artifact lưu vào Workspace (rail Tệp) và Artifacts.
8. Cần lịch lặp lại → Schedule; cần đội nhóm → Company.

## 9. Theme & nền

- Monochrome đen/trắng làm chủ đạo, không accent màu (xem `tomni-design-system.md`).
- Glass có kỷ luật: titlebar/sidebar/rail/statusbar `rgba(14,15,18,.52)` blur 16px;
  center đậm hơn một bậc `rgba(11,12,15,.64)→.52`; composer `rgba(8,9,12,.34)`
  blur 28px. Light mode tương ứng bản trắng.
- NgườI dùng có thể đặt `--app-wallpaper` riêng (ảnh/gradient); mặc định = trong
  suốt thấy desktop.

## 10. Phân việc implement

| Phần                                      | Loại      | Ghi chú                                                        |
| ----------------------------------------- | --------- | -------------------------------------------------------------- |
| Transparent window + shell glass          | done (UI) | `index.ts`, `tomni-ui.css`                                     |
| Sidebar nav + section Agent               | done (UI) | dữ liệu task thật                                              |
| Empty state + promo panel                 | done (UI) | i18n đủ 9 locale                                               |
| Tile follow/ping/drag/escalation          | done      | Hub activity registry + `HubHome/liveGrid.ts`                  |
| Trả lời permission / dừng việc từ tile    | done      | `hub-activity.respond` / `.stop`                               |
| Panel preview file + context              | logic     | cần nối file service                                           |
| Rail tab ＋ + Session Memory              | done      | Core IPC, native approvals, scoped polling; pop-out còn TARGET |
| Header gộp credit/notification vào avatar | UI        | còn lại trong Titlebar                                         |
| Trang Artifacts riêng                     | logic     | hiện tạm redirect sang Company                                 |
