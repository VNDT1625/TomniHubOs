# TomniHubOS — Visual Design System

> **Trạng thái:** Canonical visual baseline, đã đối chiếu với UI/UX Brief 2026-07-26  
> **Ngày chuẩn hóa:** 2026-07-23; đối chiếu quyết định mới 2026-07-26  
> **Nguồn sự thật triển khai:** `C:\NDT\PJ\TomniHubOS\packages\desktop\src\renderer\pages\guid\HubHome` và các style dùng chung trong `packages/desktop/src/renderer/styles/`  
> **Phạm vi:** Hub shell, Home, các trang Hub, Store, app opt-in, popup và package UI

Tài liệu này thay thế mọi quy tắc visual trùng hoặc mâu thuẫn trong các PRD cùng thư mục. PRD
chức năng vẫn quyết định nội dung và luồng nghiệp vụ; tài liệu này quyết định cách trình bày.
Mock ASCII trong PRD chỉ mô tả information architecture, không phải pixel spec.

## 1. Thứ tự ưu tiên

1. Quyết định product owner và `docs/guides/tomnihubos-ui-ux-design-brief.md`.
2. Bố cục Home đã được product owner duyệt.
3. HubHome đang chạy và shared tokens trong TomniHubOS.
4. Tài liệu này.
5. Mockup ảnh đã cung cấp.
6. Mock ASCII và mô tả visual cũ trong các PRD khác.

Không tự đổi vị trí, thứ tự vùng, số cột hoặc information architecture của Home. Muốn đổi bố
cục phải hỏi product owner. Có thể tinh chỉnh typography, token, khoảng cách, radius, blur,
shadow, icon và motion nếu không làm đổi bố cục.

## 2. Tên sản phẩm

| Tên | Vai trò | Tên cũ không được dùng trong UI mới |
| --- | --- | --- |
| **TomniHubOS** | tên sản phẩm đầy đủ | Aion, AionUi, Omni, Tomny Hub OS |
| **Tomni** | tên ngắn trong giao diện | Tomny |
| **Tomni Agentic** | trải nghiệm điều phối agent trong app | tên toàn bộ app |
| **Tomni CLI** | bề mặt dòng lệnh và CLI gateway | Tomny CLI |
| **Hub Agent OS** | loại sản phẩm/kiến trúc của TomniHubOS | thương hiệu đứng một mình |
| **Tomni Core** | runtime và dịch vụ lõi | AionCore, aioncore, Tomny Core |
| **`.tomny`** | phần mở rộng artifact | không đổi thành `.tomni` chỉ vì tên sản phẩm là Tomni |

Tên file và ID tương thích cũ được giữ khi cần để không làm hỏng dữ liệu/liên kết; nội dung và UI mới chỉ
dùng tên chuẩn phía trên.

## 3. Hướng thẩm mỹ

Tomni dùng phong cách **desktop productivity glass tinh gọn**: mật độ có kiểm soát, đường viền
mảnh, bề mặt trong suốt cao có blur, màu accent dùng có chủ đích và hierarchy rõ. Glass phải
cho thấy chiều sâu phía sau nhưng text/control vẫn đọc được. Không biến Hub thành landing page,
dashboard tài chính hoặc cửa sổ chat cũ được phóng lớn.

### 3.1 Ngữ pháp nhận diện riêng — Calm Cosmic Intelligence

Tỷ lệ bắt buộc: **85–90% công cụ desktop sạch và 10–15% bản sắc cosmic tinh tế**. Bản sắc không đến từ nền sao hay neon, mà từ năm motif có nghĩa:

- **Sealed core:** viền phân lớp, inset highlight và trust chrome tạo cảm giác năng lực được chứa trong một lõi kiểm soát.
- **Docking:** tab, package và AppGroup căn/ghép như mô-đun cập bến; motion chỉ xuất hiện một lần khi cài, ghim hoặc kích hoạt.
- **Orbit line:** đường quan hệ rất mảnh chỉ dùng trong Company Map, dependency/resource graph và empty state có quan hệ thật.
- **Capability unfold:** năng lực mới mở ra theo một trục rõ trong 180–280 ms; không animation trang trí lặp.
- **Sandbox chamber:** vùng preview có chrome/nhãn hệ thống riêng, dễ nhận ra nhưng không giống cảnh báo đỏ liên tục.

Không dùng bố cục SaaS chung gồm hero + hàng KPI + card lặp; không card hóa mọi nội dung; không gradient tím marketing; không biến Chat thành toàn bộ sản phẩm. Mỗi màn chỉ có một chi tiết nhận diện Tomni đáng nhớ và một hành động chính.

Không dùng:

- hero lớn, tiêu đề trên 32 px hoặc khoảng trống kiểu marketing;
- card đặc màu của giao diện cũ khi surface đó thuộc shared glass contract;
- glow neon, shadow đen dày hoặc gradient tím phủ toàn canvas;
- emoji hay nhiều bộ icon trộn lẫn;
- CSS riêng tạo palette, control height hoặc popup language thứ hai;
- dữ liệu giả hiển thị như dữ liệu thật.

Gradient chỉ được dùng như lớp highlight rất nhẹ trên popup/raised surface, không thay semantic
background và không làm giảm độ tương phản.

## 4. Stack và token bắt buộc

- Component tương tác: `@arco-design/web-react`.
- Icon: `@icon-park/react`.
- Styling: UnoCSS semantic utilities trước; CSS Modules cho cấu trúc phức tạp.
- Không hardcode màu trong component; dùng semantic CSS variables hoặc token từ `uno.config.ts`.
- Text hiển thị qua i18n.
- Renderer không truy cập Node/Electron trực tiếp.

| Nhóm | Token chuẩn |
| --- | --- |
| Surface | `--surface-glass`, `--surface-glass-raised`, `--surface-glass-subtle` |
| Border | `--surface-glass-border`, `--surface-glass-border-strong` |
| Shadow | `--surface-glass-shadow-soft`, `--surface-glass-shadow-raised` |
| Blur | `--surface-glass-filter`, `--surface-glass-filter-compact` |
| Radius | `--surface-radius: 14px`, `--popup-radius: 16px` |
| Control | `--control-height: 32px`, `--control-height-compact: 30px` |
| Rhythm | `--control-icon-gap: 8px`, `--control-inline-gap: 6px`, `--control-section-gap: 12px` |
| Content | `--popup-content-padding: 14px`, `--page-section-gap: 16px` |
| Motion | fast 120 ms, standard 180 ms, slow 280 ms |

App/package không định nghĩa lại các token trên trong scope cục bộ chỉ để sửa một màn hình. Nếu
cần biến thể phải thêm semantic token dùng chung hoặc contribution có namespace.

## 5. Typography

```text
UI:      "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif
Display: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif
Mono:    "Cascadia Mono", "SFMono-Regular", Consolas, monospace
```

| Vai trò | Size / line-height | Weight |
| --- | --- | --- |
| Home display | 25 / 32 px | 700 |
| Page heading | 24 / 32 px | 700 |
| Section heading | 15 / 22 px | 650 |
| Card heading | 12–13 / 18 px | 600–650 |
| Body | 12.5–13 / 18–19 px | 400 |
| Control | 11–12 / 16–18 px | 500 |
| Meta | 11 / 16 px | 400 |

Home shell dùng base 11 px để giữ mật độ desktop, nhưng nội dung hữu ích không nhỏ hơn 11 px.
Không co chữ để nhồi nội dung. Tiêu đề trang có letter-spacing tối đa `-0.3px`; text khác giữ
spacing mặc định.

## 6. Glass, border, radius và shadow

- Card/app row: surface glass thường, border 1 px, radius theo `--surface-radius` hoặc biến thể
  8–11 px của HubHome, soft shadow.
- Modal/drawer/popover/dropdown/select/picker/message: raised glass, radius
  `--popup-radius`, raised shadow và full glass filter.
- Input/select/secondary button: glass thường, compact filter, border rõ ở idle và mạnh hơn
  khi hover/focus.
- Hover có thể nâng tối đa 2 px; không đổi kích thước border hoặc gây layout shift.
- Popup portal dùng token ở `:root`/global scope, không phụ thuộc biến chỉ tồn tại trong
  `.hubShell`.
- `prefers-reduced-transparency: reduce` tắt blur nhưng giữ surface đủ tương phản.
- `prefers-reduced-motion: reduce` giảm animation/transition về gần 0.

Glassmorphism hợp lệ phải có đủ translucent surface, blur, border highlight nhẹ, shadow phân
lớp và nội dung tương phản. Nền xám bán trong suốt nhưng không blur không phải glassmorphism.

## 7. Control rhythm và icon

- Icon + label: gap 8 px; icon + affordance phụ: gap 6 px.
- Control thường cao 32 px; compact 30 px; icon-only là hình vuông cùng chiều cao.
- Icon, label và suffix phải căn giữa; không bù lệch bằng margin âm theo từng màn hình.
- Menu/select option tối thiểu 32 px; padding popup list 6 px.
- Nav/app/toolbar icon 16–18 px; logo 22 px; icon tile app 28 × 28 px.
- Icon-only cần tooltip và accessible name.
- Trạng thái dùng màu kèm text/icon, không chỉ dùng màu.

## 8. Hub shell và Home — bố cục đã khóa

```text
┌──── sidebar 220 ────┬──────── fluid main ────────┬── rail 256 ─┐
│ logo/navigation     │ topbar 48                  │ topbar      │
│ pinned apps         ├────────────────────────────┼─────────────┤
│ workspaces          │ Home content               │ status rail │
│ Store + account     │                            │             │
├─────────────────────┴────────────────────────────┴─────────────┤
│ footer 30                                                   │
└──────────────────────────────────────────────────────────────┘
```

- Sidebar 220 px, thu gọn 64 px; có nút đóng/mở nhanh.
- Topbar 48 px; footer 30 px.
- Body là main fluid + status rail 256 px, gap 16 px.
- Main padding desktop: trên 15 px, phải 32 px, dưới 8 px, trái 28 px.
- Search cao 30 px, tối đa 662 px.
- Composer tối thiểu 98 px; send tròn 34 px.
- Quick action 30 px, một hàng có cuộn ngang khi thiếu chỗ.
- App grid ba cột, gap 14 px; category card hiện hành khoảng 214 px.
- Account ở cuối sidebar, dưới Store. Header chỉ giữ icon hành động nhanh.

Thứ tự Home không đổi:

```text
Sidebar: Logo → điều hướng chính → Ứng dụng ghim → Workspaces → Store → Account
Main: Intro → Composer → Quick actions → Ứng dụng → Tiếp tục
Rail: Công việc → Thông báo → Model → Hệ thống
```

Model trong composer là nơi chọn agent/CLI/model cho lượt chat. Card Model ở rail chỉ là tóm
tắt tình trạng và shortcut quản lý; không tạo selector trùng chức năng.

## 9. Responsive đã khóa

| Viewport | Hành vi |
| --- | --- |
| `>= 1180px` | sidebar đầy đủ/thu gọn, main và status rail cùng hiển thị |
| `840–1179px` | ẩn status rail; dữ liệu rail vẫn mở qua popup/shortcut, main chiếm toàn bộ |
| `760–839px` | app grid hai cột; card cuối có thể span toàn hàng; main cuộn dọc |
| `< 760px` | sidebar thành drawer/overlay, app và recent một cột, launcher hai cột |

Responsive không xóa chức năng hoặc đổi information architecture. Khi một vùng bị ẩn, phải có
affordance mở popup/drawer tương đương. Không dùng font nhỏ hơn để giải quyết tràn; ưu tiên
truncate, wrap có kiểm soát, scroll ngang hoặc đổi số cột.

## 10. Popup, modal và quick view

Có hai dạng:

1. **Quick-only popup:** thao tác ngắn, không cần route riêng.
2. **Quick view + Open in tab:** xem/chỉnh nhanh; có nút mở trang đầy đủ.

Quy tắc:

- dùng shared raised-glass contract, không tự tạo nền xám đặc;
- padding 14 px, section gap 12 px, item cao tối thiểu 32 px;
- title, close button, body và footer thẳng hàng theo cùng inset;
- icon và chữ cách 8 px; close/icon-only có vùng bấm tối thiểu 30–32 px;
- giới hạn chiều cao theo viewport và cho body cuộn, không cắt nội dung;
- tooltip không thay label của hành động nguy hiểm;
- popup settings nhanh chỉ chứa theme/language và link mở Settings; account popup mở từ
  account ở sidebar.

## 11. Các trang Hub và Store

- Mọi trang dùng cùng shell, typography, control rhythm và surface contract với Home.
- Page content có padding responsive 20–40 px; mobile 14 px dọc/16 px ngang.
- Khoảng cách section mặc định 16 px.
- Page Search nằm dưới heading khi trang cần search ngữ cảnh; Global Search ở topbar.
- Filter/tab dùng control 30–32 px và không tạo toolbar quá cao.
- Right rail giữ vai trò status toàn cục, không biến thành filter của từng trang.
- Store card, product card, task board, history row và settings section dùng shared glass.
- Empty/loading/error giữ đúng footprint cuối để tránh layout shift.

## 12. App và UI Package compatibility

App được gắn cờ hỗ trợ Tomni UI phải:

- nhận typography, color, spacing, radius, motion và glass tokens của Hub;
- dùng Arco + Icon Park cho chrome tích hợp;
- không hardcode palette hoặc ghi đè global selector;
- khai báo mức tương thích UI Package: `system`, `app` hoặc `universal`;
- có preview, apply và rollback khi UI Package thay đổi token;
- giữ contrast, focus và reduced-transparency sau khi áp package.

UI Package được đổi token và asset đã công bố, nhưng không inject script, sửa DOM tùy ý hoặc
thay information architecture của Hub/app. App không opt-in chỉ nhận shell/chrome chung, không
bị UI Package sửa nội dung bên trong.

## 13. Motion và accessibility

- Ưu tiên một chuyển cảnh rõ thay vì nhiều animation rời rạc.
- Focus ring nhìn thấy rõ, không chỉ đổi màu chữ.
- Text đạt WCAG AA; trạng thái không truyền nghĩa chỉ bằng màu/chuyển động.
- Keyboard navigation, tooltip, accessible name và logical tab order là bắt buộc.
- Skeleton có kích thước cuối; không layout shift khi dữ liệu thật xuất hiện.
- Cùng layout/hierarchy ở light và dark; chỉ semantic token thay đổi.

## 14. Acceptance checklist

- [ ] Không còn tên Aion/AionUi/Omni/Tomny trong UI mới; dùng TomniHubOS/Tomni/`.tomny` đúng vai trò.
- [ ] Không raw interactive HTML, icon ngoài Icon Park hoặc màu hardcode trong component.
- [ ] Home giữ đúng bố cục và thứ tự đã khóa.
- [ ] Card/popup/page dùng shared glass và shared control rhythm.
- [ ] Icon-label gap 8 px, inline gap 6 px, control 30/32 px đồng đều.
- [ ] Popup portal không phụ thuộc biến scoped dưới `.hubShell`.
- [ ] Light/dark và reduced-transparency đọc rõ ở cùng viewport.
- [ ] 1208 × 680 không có scroll dọc ngoài vùng chủ động cuộn.
- [ ] 1440 × 900 mở rộng sạch; 840/760 breakpoint không mất chức năng.
- [ ] Dữ liệu rail/model/system là thật hoặc ghi `unavailable`, không giả production.
- [ ] UI Package chỉ ảnh hưởng app opt-in và có preview/rollback.

## 15. Discrepancy register đã xử lý

| Bản thảo cũ | Quyết định chuẩn hóa |
| --- | --- |
| Sidebar 208 px | dùng 220 px, collapsed 64 px theo HubHome hiện hành |
| Rail 248–264 px và biến thành drawer ở 960 px | dùng 256 px; ẩn dưới 1180 px và mở qua popup/shortcut |
| “Không gradient/card glass” | dùng shared glass; gradient chỉ là highlight nhẹ trên raised surface |
| Radius popup 10 px | dùng global popup radius 16 px; Hub local popover có thể 12 px |
| Transition 120–160 ms | dùng token 120/180/280 ms theo mức độ |
| Capability Package | đổi thành Agent Capsule |
| Account ở header | account đầy đủ ở cuối sidebar; header chỉ có quick actions |
| Panel trái/phải đều pin/auto-hide | sidebar collapse/drawer; rail responsive hide + popup |
| Trang legacy giữ style cũ vô thời hạn | mọi page/app mới hoặc đang chuyển hóa dùng shared contract |

## 16. Quyết định đã khóa ngày 2026-07-26

1. Rail khi `<1180px`: một nút Trạng thái chung ở topbar mở right drawer dùng cùng state stream; không shortcut/icon riêng theo card.
2. UI Package `system`: được đổi semantic token, font và icon chức năng công bố; không thay logo/wordmark Tomni hoặc security/trust chrome.
3. Company Map Focus Mode: ẩn sidebar, StatusRail và toolbar phụ; giữ GlobalHeader/topbar làm lối thoát và vùng chỉ báo hệ thống.
4. Raised glass trên nền nhiều chi tiết: alpha tối thiểu 0.92 light / 0.90 dark; nếu contrast không đạt AA hoặc bật giảm transparency thì dùng surface gần/hoàn toàn opaque.

Các quyết định này được phản chiếu trong `docs/guides/tomnihubos-ui-ux-design-brief.md`; brief thắng nếu bản sao cũ mâu thuẫn.

## 17. Tài liệu liên quan

- [Home Hub PRD](tomni-home-hub.md)
- [Hub Pages PRD](tomni-hub-pages.md)
- [Agentic Store PRD](tomni-agentic-store.md)
- [Package Platform Design](tomni-package-platform-design.md)
- [Hub OS Migration Design](tomni-hub-agent-os-migration-design.md)
