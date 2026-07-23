# VIU — thiết kế sản phẩm đạt 9+ trên mọi tiêu chí cốt lõi so với Figma

Trạng thái: **Design baseline v9+ — chưa cấp quyền implementation**  
Ngày đánh giá: 2026-07-22  
Chuẩn so sánh: Figma Design + Prototype + Dev Mode cho thiết kế UI, website và ứng dụng hoàn chỉnh.  
Phạm vi loại trừ: FigJam, Slides, Buzz, cloud marketplace và illustration chuyên sâu ngang Illustrator. Các phần này không được dùng để hạ chuẩn của những năng lực nằm trong phạm vi.

Quyết định triển khai: chưa viết thêm code cho lộ trình 9+ cho tới khi Design Gate D0 ở mục 7 được duyệt. Mọi con số mục tiêu trong tài liệu này là tiêu chí nghiệm thu, không phải tuyên bố chức năng hiện đã tồn tại.

## 1. Định nghĩa chuẩn 9+

VIU đạt 9+ khi một người dùng không chuyên có thể dựng, tái sử dụng, chạy thử, kiểm tra và bàn giao một website/app thương mại phức tạp mà không sửa JSON hoặc code; agent làm được cùng phạm vi thông qua cùng document engine và kết quả luôn tiếp tục chỉnh trực quan được.

**9+ là điểm sàn, không phải điểm trung bình.** Mỗi trụ cột và từng chiều chất lượng bên trong trụ cột phải đạt ít nhất 9,0/10. Một trụ cột đạt 10 không được bù cho trụ cột đạt 8,9.

Mỗi trụ cột được chấm độc lập trên năm chiều:

1. **Coverage:** đủ các thao tác cốt lõi của workflow trong phạm vi.
2. **Workflow depth:** thao tác nối được thành quy trình hoàn chỉnh, không dừng ở các control rời rạc.
3. **Fidelity:** Design, Present, export và codegen có cùng kết quả nhìn thấy và cùng hành vi.
4. **Reliability:** undo/redo, autosave, recovery, validation và performance đạt budget.
5. **Human–agent parity:** người dùng và agent tạo ra cùng document digest từ cùng intent có cấu trúc.

Quy tắc khóa điểm:

- Chỉ có schema nhưng chưa có UI và runtime: tối đa 2,0.
- Có inspector nhưng chưa direct manipulation hoặc không render đúng trong Present: tối đa 4,0.
- Không có agent command/query parity: tối đa 7,9.
- Không có inverse command, recovery và automated test: tối đa 8,4.
- Không vượt benchmark artifact tương ứng: tối đa 8,9.
- Có screen unreachable, dangling interaction, silent asset loss, destructive instance update hoặc Design/Present drift: toàn bộ bản phát hành không được chứng nhận 9+.

Mốc ý nghĩa:

- **9,0:** hoàn thành workflow chuyên nghiệp, không có lỗ hổng nghiêm trọng.
- **9,5:** workflow nhanh, tinh tế, có diagnostics và phục hồi tốt hơn Figma ở lợi thế local-first/agent-native.
- **10:** không có khác biệt đáng kể trong phạm vi đã khóa và đã vượt toàn bộ stress benchmark.

## 2. Nguồn chuẩn đối chiếu

Các năng lực được khóa theo tài liệu chính thức và không được tự hạ chuẩn trong lúc triển khai:

- [Selection](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects) và [Smart selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection): nested selection, marquee, spacing, reorder và reflow.
- [Auto layout](https://help.figma.com/hc/en-us/articles/360040451373-Explore-auto-layout-properties) và [Grid auto layout](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow): direction, grid, wrap, padding, gap, fixed/fill/hug và min/max.
- [Text properties](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties): font face, OpenType, variable axes, paragraph và range-level typography.
- [Fills](https://help.figma.com/hc/en-us/articles/360041003694-Guide-to-fills), [strokes](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties), [effects](https://help.figma.com/hc/en-us/articles/360041488473-Apply-effects-to-layers), [masks](https://help.figma.com/hc/en-us/articles/360040450253-Masks), [boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations) và [vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks).
- [Components và variants](https://help.figma.com/hc/en-us/articles/360056440594-Create-and-use-variants), [component properties](https://help.figma.com/hc/en-us/articles/5579474826519-Explore-component-properties) và [interactive components](https://help.figma.com/hc/en-us/articles/360061175334-Create-interactive-components-with-variants).
- [Variables, collections và modes](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes), gồm alias, scope, inheritance và prototype binding.
- [Prototype interactions](https://help.figma.com/hc/en-us/articles/360040315773-Create-interactions), [multiple actions và conditionals](https://help.figma.com/hc/en-us/articles/15253220891799-Multiple-actions-and-conditionals), scroll, overlays và smart animation.
- [Dev Mode](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode) và [Code Connect](https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect): inspect, annotations, ready-for-development, component-to-code mapping và handoff.
- [Comments](https://help.figma.com/hc/en-us/articles/360039825314), [version history](https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history) và [branching](https://help.figma.com/hc/en-us/articles/360063144053-Guide-to-branching).
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) AA cho editor và output được tạo.

## 3. Scorecard 9+ không bù điểm

Điểm hiện tại chỉ là đánh giá bằng chứng đang có. Điểm mục tiêu là hợp đồng release. Không làm tròn 8,95 thành 9,0.

| Trụ cột                                     | Hiện tại ước tính | Mục tiêu khóa | Điều kiện cốt lõi để đạt 9+                                                                                 |
| ------------------------------------------- | ----------------: | ------------: | ----------------------------------------------------------------------------------------------------------- |
| Canvas và direct manipulation               |               6,0 |           9,2 | nested selection, smart guides, rulers, transform, vector handles, keyboard và 10.000-node canvas           |
| Layout và responsive                        |               5,3 |           9,3 | auto layout/grid đầy đủ, sparse breakpoint override, computed layout explanation và Design/Present parity   |
| Typography và structured content            |               5,6 |           9,2 | rich text theo range, OpenType/variable axes, text style, locale mode, IME và deterministic font fallback   |
| Visual styling và vector                    |               4,0 |           9,2 | stacked paint/stroke/effect, gradient handles, masks, boolean/vector network, blend và non-destructive edit |
| Components, variables và design system      |               0,7 |           9,3 | instance/variant/property/slot, override preservation, aliases/modes/scopes, library update và migration    |
| Prototype, data, forms và motion            |               5,3 |           9,4 | ordered actions, conditions, routes, overlays, real input state, collections, timeline và scroll story      |
| Assets, media và 3D                         |               6,3 |           9,2 | local link, image/SVG/video/audio/font/GLTF, crop, replace, dependency graph, recovery và portable bundle   |
| History, review và controlled collaboration |               2,9 |           9,2 | durable log, checkpoint, branch/proposal, comments, semantic/visual diff, merge và crash recovery           |
| Agent, Dev handoff và code generation       |               5,0 |           9,5 | full query/command parity, inspect/measure, Code Connect-like mapping, multi-target codegen và traceability |
| Accessibility, performance và reliability   |               4,5 |           9,2 | WCAG AA guard, reduced motion, budgets, deterministic render, autosave, diagnostics và corruption recovery  |

Trạng thái chứng nhận hiện tại là **0,7/10 theo điểm sàn**, không phải trung bình 4–5 điểm. Nền transaction/runtime đã có giá trị, nhưng component system đang là blocker thấp nhất và chưa trụ cột nào vượt đủ năm chiều chất lượng để được công nhận 9+.

### 3.1 Hợp đồng hoàn thành cho mọi capability

Một capability chỉ được ghi “done” khi cùng có đủ bảy mặt sau:

1. Schema/IR có version và migration.
2. Resolver/compiler thuần, deterministic và có diagnostics.
3. Direct manipulation hoặc inspector workflow cho người dùng.
4. Agent query + typed command cùng authority boundary.
5. Design renderer, Present runtime và exporter/codegen cùng semantics.
6. Atomic transaction, exact inverse, autosave và recovery.
7. Unit, DOM, scenario, parity, visual và performance test tương ứng.

Thiếu bất kỳ mặt nào thì capability vẫn là “partial”, dù nút hoặc field đã xuất hiện trong giao diện.

## 4. Hướng thiết kế giao diện

### 4.1 Nguyên tắc

VIU là editor local-first có agent cùng làm việc, không phải bản sao hình thức của Figma.

- Canvas chiếm ưu thế; panel chỉ hiển thị thuộc tính liên quan tới selection.
- Không selection: hiển thị document/page settings, không hiển thị placeholder “mixed values”.
- Một selection: hiện giá trị thực và nguồn giá trị (raw, token, variable, component override).
- Multi-selection: chỉ hiện mixed khi các node thực sự khác nhau.
- Mỗi thay đổi phải preview trên canvas trong cùng frame và commit bằng một transaction.
- Thuộc tính nâng cao dùng progressive disclosure; không dồn hàng chục input cùng cấp.
- Mọi thao tác pointer quan trọng phải có keyboard equivalent và agent command equivalent.

### 4.2 Cấu trúc editor mục tiêu

```text
Command bar
├─ Tool / insert / transform
├─ Design · Prototype · Present · Dev
├─ Zoom / viewport / breakpoint
└─ History / proposal / agent status

Left panel
├─ Pages and routes
├─ Layers and sections
├─ Components and variants
├─ Assets and fonts
└─ Variables and tokens

Canvas
├─ Infinite spatial canvas
├─ Artboards and breakpoint siblings
├─ Guides / ruler / snapping / measurement
├─ Prototype connections
└─ Inline text/vector/component editing

Right inspector
├─ Selection summary
├─ Layout and sizing
├─ Typography
├─ Fill / stroke / effects
├─ Component / variable bindings
├─ Prototype interactions
├─ Accessibility
└─ Export / Dev handoff

Agent dock
├─ Proposal with visual diff
├─ Structured change list
├─ Accept / reject by transaction group
└─ Explanation and validation findings
```

### 4.3 Inspector không được là “form dài”

Mỗi section có ba tầng:

1. Header: trạng thái, token/variable binding, reset.
2. Primary controls: các giá trị dùng thường xuyên.
3. Advanced drawer: per-side, per-corner, multiple layers, expression hoặc breakpoint override.

Layout section phải hiển thị sơ đồ 3×3 cho alignment, padding diagram có thể kéo, và sizing badge Fixed/Fill/Hug thay vì chỉ dropdown chữ.

### 4.4 Hình học workspace và mật độ thông tin

VIU dùng ngôn ngữ **precision studio**: công cụ chính xác, yên tĩnh, có chiều sâu; canvas và sản phẩm của người dùng luôn nổi bật hơn chrome của editor.

```text
44 px project bar
├─ 48 px tool rail
├─ 220–420 px left workspace (resizable)
├─ elastic canvas (không dưới 640 px ở desktop)
├─ 280–480 px contextual inspector (resizable)
└─ 0 / 40 / 240–420 px context dock theo collapsed/peek/open
```

Các con số trên là design tokens mục tiêu, không phải inline constants. Người dùng có thể lưu workspace preset: Design, Prototype, Motion, Review và Dev. Khi cửa sổ hẹp, left workspace và inspector chuyển thành drawer độc lập; canvas không bị ép thành một viewport không dùng được.

Editor có ba mức mật độ:

- **Comfortable:** mặc định cho người mới, label đầy đủ và hit target ít nhất 32 px.
- **Compact:** dành cho designer chuyên nghiệp, không loại bỏ tooltip hoặc keyboard focus.
- **Presentation focus:** ẩn toàn bộ chrome bằng một thao tác nhưng vẫn hiện prototype debugger khi có lỗi.

### 4.5 Ngôn ngữ thị giác

- Ba lớp chiều sâu rõ ràng: app chrome, working surface và authored product; không dùng nhiều card lồng nhau vô nghĩa.
- Nền canvas trung tính có grid thích ứng zoom; artboard có viền quang học và shadow tokenized, không cạnh tranh với nội dung.
- Màu trạng thái có ngữ nghĩa cố định: selection, prototype connection, variable binding, agent proposal, warning và destructive; không tái sử dụng một màu accent cho mọi thứ.
- Typography editor dùng UI font có đầy đủ glyph tiếng Việt; số đo, token path và code dùng mono face. Font của document chỉ xuất hiện trong canvas và font preview, không làm biến dạng chrome.
- Light, dark và high-contrast được thiết kế song song. Không phát hành theme nếu focus ring, mixed state, disabled state hoặc canvas boundary không đạt contrast.
- Motion của editor tập trung vào continuity: panel morph, selection transition, zoom-to-node và proposal diff. Mọi motion có reduced-motion equivalent tức thời.

### 4.6 Direct manipulation là đường chính

Inspector là công cụ chính xác, không phải cách duy nhất để thiết kế:

- Double-click text để sửa với caret, selection range, IME và rich-text toolbar tại chỗ.
- Kéo resize có preview kích thước computed, constraint và breakpoint impact ngay trên canvas.
- Auto layout có gap/padding handles; giữ modifier để chỉnh đối xứng hoặc từng cạnh.
- Gradient, corner, vector point, Bézier handle, crop/focal point và transform origin chỉnh trực tiếp.
- Component instance hiện property affordance và override source; reset/swap không làm mất dữ liệu im lặng.
- Prototype connection kéo từ hotspot tới screen/state/action; connection label hiển thị trigger + condition + action đầu tiên.
- Timeline cho scrub, keyframe, easing curve, scroll range và reduced-motion track mà không yêu cầu nhập JSON.

Mọi thao tác pointer chính phải có command-search entry, shortcut và accessible keyboard sequence. Shortcut chỉ tăng tốc, không được là con đường duy nhất.

### 4.7 Trải nghiệm agent: cùng canvas, khác quyền

Agent không có editor bí mật và không sửa document ngoài tầm nhìn người dùng. Khác biệt nằm ở modality và authority:

```text
Agent dock
├─ Scope chip: project / page / frame / selection / component
├─ Read set: selection, computed layout, variables, prototype graph, diagnostics
├─ Proposed transactions: grouped by intent, cancellable
├─ Before/after visual + semantic diff
├─ Validation impact: route, responsive, a11y, asset, performance
└─ User decision: accept group / reject group / edit request
```

Agent được phép query spatial relations, component usage, variable dependencies, route reachability, runtime traces và rendered snapshots. Agent chỉ được đề xuất typed transactions trong scope; không tự approve revision, không tự bỏ validation và không ghi code trong Design/Prototype mode.

**Bằng chứng parity bắt buộc:** mỗi capability có một manifest chứa `capabilityId`, user gesture/inspector path, agent query, agent command, permission, inverse command và conformance test. Test chạy cùng fixture qua đường người dùng và đường agent, sau đó yêu cầu exact document digest, diagnostics và Present trace giống nhau. Không có manifest/test thì UI agent chỉ là chat trang trí và trụ cột Agent không thể vượt 7,9.

### 4.8 Trạng thái giao diện phải được thiết kế đầy đủ

Mọi tool/panel cần mockup và behavior spec cho ít nhất: empty, hover, focus, active, mixed, loading, success, warning, error, missing dependency, read-only, agent-proposed và conflict. Các trạng thái quan trọng không được chỉ phân biệt bằng màu.

### 4.9 Blueprint theo chế độ

| Chế độ    | Left workspace                                      | Canvas chính                                    | Right inspector                                       | Context dock                              |
| --------- | --------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| Design    | Pages, layers, assets, components, variables        | Authoring + direct manipulation                 | Layout, type, appearance, binding, a11y               | Agent proposal hoặc collapsed             |
| Prototype | Flows, screens, states, scenarios                   | Connection graph trên artboard                  | Trigger, ordered actions, condition, transition       | Runtime debugger + state/variable trace   |
| Present   | Ẩn mặc định; mở navigator khi cần                   | Isolated runnable viewport                      | Không có authoring inspector                          | Optional debugger, console không lộ code  |
| Review    | Revisions, branches, proposals, unresolved comments | Before/after, onion skin hoặc side-by-side diff | Change rationale, affected dependency, validation     | Comment thread + accept/reject group      |
| Dev       | Ready-for-dev tree, component/library map           | Measurement, annotation và inspect overlays     | Box model, token, component mapping, export/code view | Virtual file graph + generation diagnosis |

Mode switch giữ selection, viewport và focus context khi hợp lệ. Nếu selection không hợp lệ ở mode mới, VIU giải thích thay vì silently deselect. Present chạy trong isolated interaction surface để click không vô tình chọn layer.

### 4.10 Empty project và first-ten-minutes journey

Blank repo không mở bằng prompt form. VIU mở canvas ngay với một command strip nhỏ:

1. Chọn frame preset hoặc custom viewport.
2. Chọn blank, smart section hoặc premium starter document.
3. Kéo local asset/path vào canvas; VIU link tại chỗ và tạo asset card có trạng thái.
4. Chỉnh trực tiếp; agent suggestion nằm ở context dock và luôn có scope.
5. Kết nối primary CTA; logic guardian lập tức báo destination chưa có hoặc flow unreachable.
6. Preview desktop/tablet/mobile; mọi breakpoint issue có thể click để zoom tới node.
7. Approve revision chỉ khi asset, route, responsive, accessibility và runtime checks pass hoặc waiver có lý do.

Starter phải xuất hiện dưới 800 ms ở warm start, nhưng agent refinement có thể tiếp tục bất đồng bộ. Người dùng luôn có một sản phẩm chỉnh được ngay; không phải chờ prompt sinh code.

### 4.11 Inspector blueprint theo selection

- **No selection:** page/frame preset, canvas background, grid, active modes, route metadata và document diagnostics.
- **Single node:** selection breadcrumb + computed size/source; chỉ section áp dụng cho node type được mở.
- **Multi-select đồng loại:** common values, mixed values có provenance và bulk-operation preview.
- **Multi-select khác loại:** geometry/common appearance trước; type-specific controls chuyển sang scoped selection action.
- **Component instance:** property/variant/binding/override ở trên styling; main-component update impact xem trước được.
- **Breakpoint override:** base value và override value cùng hiện; reset override không xóa base.
- **Agent proposal:** current/proposed value song song, transaction group và validation impact; inspector read-only cho vùng chưa accept.

Mọi computed value có nút giải thích chuỗi nguồn: raw → style/token → variable mode → component override → breakpoint override → runtime state. Đây là nền cho cả người dùng học hệ thống và agent tự kiểm tra quyết định.

## 5. Kiến trúc document mục tiêu

### 5.1 Paint và effect stack

```ts
type ViuPaint =
  | { id: string; type: 'solid'; color: string; opacity: number; visible: boolean }
  | {
      id: string;
      type: 'linear-gradient' | 'radial-gradient' | 'angular-gradient';
      stops: ViuGradientStop[];
      transform: ViuMatrix2D;
      visible: boolean;
    }
  | {
      id: string;
      type: 'image';
      assetId: string;
      fit: 'fill' | 'fit' | 'crop' | 'tile';
      focalPoint?: ViuPoint;
      visible: boolean;
    };

type ViuStroke = {
  id: string;
  paint: ViuPaint;
  width: number | [number, number, number, number];
  align: 'inside' | 'center' | 'outside';
  dash?: number[];
};

type ViuEffect =
  | {
      id: string;
      type: 'drop-shadow' | 'inner-shadow';
      x: number;
      y: number;
      blur: number;
      spread: number;
      color: string;
    }
  | { id: string; type: 'layer-blur' | 'background-blur'; radius: number };
```

Không tiếp tục mở rộng một chuỗi CSS `shadow`; effect phải có cấu trúc để canvas, Present và codegen dùng chung.

### 5.2 Component và variant

```ts
type ViuComponentDefinition = {
  id: string;
  name: string;
  rootNodeId: string;
  propertyDefinitions: Record<string, ViuComponentPropertyDefinition>;
  variantAxes: Record<string, readonly string[]>;
};

type ViuComponentInstanceState = {
  componentId: string;
  variantSelection: Record<string, string>;
  propertyValues: Record<string, unknown>;
  overrides: Record<string, ViuOverride>;
};
```

Yêu cầu bắt buộc:

- Update component chính không xóa text/asset override của instance.
- Detach instance tạo subtree độc lập trong một transaction.
- Swap component giữ property cùng tên và kiểu.
- Variant có thể được điều khiển bằng interaction hoặc variable.

### 5.3 Variable collection và mode

```ts
type ViuVariableCollection = {
  id: string;
  name: string;
  modes: Array<{ id: string; name: string }>;
  variables: Record<
    string,
    {
      id: string;
      name: string;
      type: 'color' | 'number' | 'string' | 'boolean';
      valuesByMode: Record<string, unknown>;
      scopes: string[];
    }
  >;
};
```

Binding phải lưu variable ID, không sao chép value. Resolver dùng page mode → ancestor explicit mode → local fallback.

### 5.4 Prototype action graph

Một interaction chứa ordered actions và condition, không chỉ một action:

```ts
type ViuPrototypeAction =
  | { type: 'navigate'; screenId: string; transition?: ViuTransition }
  | { type: 'overlay'; nodeId: string; placement: string; modal: boolean }
  | { type: 'scroll-to'; nodeId: string; behavior: 'instant' | 'smooth' }
  | { type: 'set-variable'; variableId: string; expression: ViuExpression }
  | { type: 'change-variant'; instanceId: string; selection: Record<string, string> }
  | { type: 'play-timeline'; timelineId: string }
  | { type: 'back' };
```

Runtime trace phải giải thích trigger, condition, action, state trước/sau và node bị ảnh hưởng.

### 5.5 Unified semantic IR

VIU document không lưu DOM tree, widget tree Flutter hoặc chuỗi CSS làm nguồn sự thật. IR lưu intent có kiểu: semantic role, layout, paint/effect stack, component binding, variable binding, state, interaction, timeline, accessibility và export hints.

Các nguyên tắc bắt buộc:

- Stable ID cho node, range text, component, variable, asset, action, keyframe và revision.
- Reference bằng ID; rename không phá binding.
- Không chấp nhận `Record<string, unknown>` ở public contract nếu domain có thể định kiểu.
- Mọi expression dùng safe AST có type-check và dependency graph; không chạy JavaScript tùy ý.
- Resolver tạo computed document bất biến cho một revision + viewport + variable mode + runtime state.
- Design, Present, validation và codegen đọc cùng computed document; không tự diễn giải raw IR theo bốn cách khác nhau.

### 5.6 Kiến trúc module mục tiêu

Đây là ranh giới thiết kế, chưa phải lệnh tạo file:

```text
packages/desktop/src/common/viu/
├─ model/          # versioned document types + migrations
├─ commands/       # typed command, transaction, inverse, permission
├─ layout/         # deterministic layout and responsive resolver
├─ styling/        # paint, vector, text and effect model
├─ systems/        # component, variable, library and data binding
├─ prototype/      # action graph, runtime state and timeline compiler
├─ validation/     # logic, a11y, asset and export diagnostics
├─ generation/     # framework-neutral generation IR
└─ index.ts

packages/desktop/src/renderer/pages/studio/ide/Viu/
├─ canvas/         # viewport, overlays, direct manipulation, virtualization
├─ inspector/      # contextual sections and advanced editors
├─ workspace/      # panels, modes, command bar and layout presets
├─ prototype/      # flow authoring, debugger and timeline
├─ review/         # history, branch, proposal and visual diff
├─ dev/            # inspect, annotations and generation preview
├─ hooks/
├─ components/
├─ styles/
└─ index.tsx

packages/desktop/src/process/ide/viu/
├─ assets/         # local links, fingerprints, fonts and recovery
├─ persistence/    # event log, snapshot, branch and crash recovery
├─ generation/     # adapters, virtual file graph and integration plan
├─ rendering/      # deterministic snapshot/export jobs
├─ library/        # local design libraries and dependency updates
└─ index.ts
```

Renderer không đọc `fs/path` và process không render React/DOM. Local asset, persistence và generation đi qua preload/IPC có schema, cancellation, progress, path permission và audit record. Pure resolver/validator nằm trong `common` để user UI, agent tool, runtime và test dùng chung.

Khi triển khai, cấu trúc hiện tại được di chuyển theo migration ADR từng lát dọc; không tạo một “V3” song song với document model cũ rồi duy trì hai nguồn sự thật.

### 5.7 Render, persistence và generation contract

- Mutation log append-only; snapshot định kỳ; mỗi transaction có actor, origin, scope, reason, base revision và inverse.
- Asset binary không nhét vào document JSON; document lưu asset ID, locator có quyền, fingerprint, metadata và fallback.
- Canvas dùng virtualization/spatial index; inspector subscribe theo selection/computed dependency, không rerender toàn document.
- Snapshot renderer chạy từ immutable revision và locked font/asset environment để visual diff tái lập được.
- Generator tạo virtual file graph trước, kèm node-to-code map, diagnostics và estimated dependency impact; chỉ ghi repo sau khi revision được approve.
- React/web, Flutter và các adapter sau này cùng tiêu thụ generation IR; không generator nào được đọc trực tiếp UI state của inspector.

## 6. Command model

Các command cần bổ sung theo thứ tự:

### Mốc A — Layout foundation

- `setAutoLayout`
- `setPadding`
- `setSizingMode`
- `setMinMaxSize`
- `setConstraints`
- `setPositionMode`
- `setBreakpointOverride`

Trạng thái: đang triển khai; document batch và UI cơ bản đã có.

### Mốc B — Visual fidelity

- `addPaint`, `updatePaint`, `reorderPaint`, `removePaint`
- `addStroke`, `updateStroke`, `removeStroke`
- `addEffect`, `updateEffect`, `removeEffect`
- `setBlendMode`
- `setCornerRadii`
- `createMask`, `releaseMask`
- `booleanUnion`, `booleanSubtract`, `booleanIntersect`, `booleanExclude`
- `editVectorPath`

### Mốc C — Design system

- `createComponent`, `createComponentSet`
- `createInstance`, `detachInstance`, `swapInstance`
- `setVariantAxes`, `setVariantSelection`
- `setComponentProperty`, `resetOverride`
- `createVariableCollection`, `addVariableMode`, `bindVariable`, `unbindVariable`
- `publishLocalLibrary`, `applyLibraryUpdate`

### Mốc D — Prototype và review

- `addInteractionAction`, `reorderInteractionAction`, `setInteractionCondition`
- `createTimeline`, `addKeyframe`, `setEasing`
- `createCheckpoint`, `restoreCheckpoint`, `compareVersions`
- `createProposal`, `acceptProposalTransaction`, `rejectProposalTransaction`
- `markReadyForDevelopment`, `addAnnotation`

## 7. Design-first gate và thứ tự triển khai

### Gate D0 — khóa thiết kế trước khi viết code

Trạng thái hiện tại: **HOLD IMPLEMENTATION**.

D0 chỉ pass khi người dùng duyệt trọn bộ sáu artifact thiết kế sau:

1. **Capability map:** 10 trụ cột, từng capability ID, Figma reference, user workflow, agent workflow và score rubric.
2. **Workspace blueprints:** high-fidelity design cho Design, Prototype, Present, Review và Dev ở desktop rộng/hẹp, light/dark/high-contrast.
3. **Interaction specification:** pointer, keyboard, command search, IME, drag/drop, inline edit, mixed values, errors và recovery.
4. **Document/command ADR:** versioning, stable identity, migration, permission, inverse, resolver, persistence và generator boundary.
5. **Golden artifact pack:** dữ liệu, asset manifest, font pack, scenarios và expected renders cho 12 benchmark ở mục 8.
6. **Parity manifest schema:** cách chứng minh user/agent/Present/codegen cùng semantics và cùng digest.

D0 không pass nếu chỉ có danh sách chức năng. Mỗi blueprint phải có annotation, state matrix, keyboard flow, empty/error/recovery state và mapping tới capability ID. Sau khi D0 được duyệt, thay đổi lớn về IR hoặc workspace IA phải quay lại design review trước khi code tiếp.

#### Trạng thái artifact D0 sau vòng thiết kế này

| Artifact                  | Trạng thái thiết kế   | Còn thiếu trước khi xin duyệt code                                                  |
| ------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| Capability map            | Baseline hoàn thành   | Gắn capability ID chi tiết từ `capability-expansion.md` vào đủ 10 trụ cột           |
| Workspace blueprints      | Behavior hoàn thành   | High-fidelity annotated mockup cho 5 mode × desktop rộng/hẹp × light/dark           |
| Interaction specification | Khung hoàn thành      | Shortcut matrix, focus order, drag modifiers và state diagrams từng advanced editor |
| Document/command ADR      | Boundary hoàn thành   | ADR riêng cho versioning, expression AST, event log và generation IR                |
| Golden artifact pack      | Definition hoàn thành | Fixture files, licenses, expected renders, scenario seeds và reference hardware     |
| Parity manifest           | Contract hoàn thành   | Machine-readable schema và một mẫu manifest được review                             |

Vì vậy D0 hiện **chưa pass** và code 9+ vẫn bị khóa. Bước thiết kế kế tiếp là high-fidelity workspace mockup + capability-ID matrix, không phải bắt đầu Wave 1.

### Các lát triển khai sau D0

Không chấm điểm 9+ theo từng wave. Mỗi wave chỉ đóng một nhóm dependency; chứng nhận chỉ diễn ra ở Gate R9.

#### Wave 1 — Editor kernel

- Spatial canvas, snapping/guides/rulers, transform, rich text và complete auto-layout/responsive solver.
- Unified command registry, inverse/recovery và capability manifest harness.
- Inspector architecture, workspace presets và direct manipulation overlays.

#### Wave 2 — Fidelity engine

- Structured paint/stroke/effect, gradients, images, crop, masks, vector network, booleans và blend.
- Font inventory, rich typography, text style và deterministic fallback.
- Canvas/Present/export render conformance.

#### Wave 3 — Reusable systems

- Components, instances, slots, properties, variants, nested override và library lifecycle.
- Variables, aliases, scopes, modes, tokens, binding picker và dependency explorer.
- Data collection, repeater, expression và form state system.

#### Wave 4 — Executable experience

- Multi-action/conditional prototype graph, route, overlay, input, scroll và media.
- Timeline, easing, interactive variants, scroll-linked motion và reduced-motion alternatives.
- 3D product scene blocks, camera chapters, hotspots và fallback.

#### Wave 5 — Trust and delivery

- Durable history, checkpoint, branch/proposal, comments, conflict resolution và visual/semantic diff.
- Dev inspection, annotations, ready-for-development, component-to-code mapping và virtual generation plan.
- React/web + Flutter generation adapters với node-to-code trace và integration diagnostics.

#### Wave 6 — Agent parity and hardening

- Agent query/command coverage cho toàn capability manifest.
- Accessibility, performance, asset corruption, crash recovery và hostile-document stress suites.
- Migration of legacy VIU documents và removal của duplicate model sau evidence cutover.

### Gate R9 — chứng nhận phát hành 9+

R9 chỉ pass khi:

- Cả 10 trụ cột đều đạt ít nhất 9,0 trên cả năm chiều; mục tiêu khóa trong scorecard được đạt hoặc vượt.
- 12/12 benchmark pass ở user path, agent path, Present và generation path.
- Không còn P0/P1 correctness issue; không có silent data loss hoặc unbounded migration risk.
- Independent score audit không dùng người viết capability đó làm người duy nhất chấm.
- Evidence bundle gồm report, traces, render diff, performance profile và exact digest được lưu theo revision.

## 8. Bộ 12 benchmark bắt buộc

Mỗi artifact phải được dựng và sửa hoàn toàn trong VIU, không mở code/JSON:

1. **Responsive SaaS:** navbar, mega menu, pricing comparison, modal và desktop/tablet/mobile/custom breakpoint.
2. **Dense analytics:** 10.000 nodes, nested grid/auto layout, charts, filters, table states và reusable responsive cards.
3. **Mobile banking system:** component variants, nested instances, light/dark/high-contrast modes, localized text và interactive states.
4. **Commerce journey:** collection → search/filter → product detail → variant selector → cart overlay → checkout → success/error.
5. **CMS publication:** typed collection, repeater, binding, filter/sort/pagination, dynamic route và designed empty/missing states.
6. **Conditional form:** real inputs, validation, visibility rules, variable-driven progress, async loading/mock error/retry/success.
7. **Multilingual editorial:** mixed rich text, OpenType, variable font axes, CJK/Vietnamese/RTL fixture, crop, mask và print-like composition.
8. **Vector identity kit:** pen/vector network, boolean, outline stroke, compound mask, multi-fill gradient, icon component và SVG export.
9. **Cinematic scrollytelling:** pinned chapters, scroll-linked timeline, video, parallax, variable changes và reduced-motion alternative.
10. **Local 3D product story:** linked GLTF + texture pack, camera bookmarks, hotspots, scroll chapters, poster/video fallback và asset relink.
11. **Production design system:** tokens/aliases/modes, libraries, component properties/variants, update/migration, documentation, annotations và Dev handoff.
12. **Human–agent parity challenge:** cùng một approved brief được dựng qua user gestures và agent proposals; sau normalization phải có cùng semantic digest, runtime scenarios và generated behavior.

### 8.1 Điều kiện pass chung

- 100% screen/state có chủ đích reachable; không dangling reference hoặc dead primary CTA.
- 100% capability dùng trong artifact có manifest đủ bảy mặt ở mục 3.1.
- Design và Present có cùng computed layout, typography, variable mode, state và interaction semantics.
- Ba viewport chuẩn + hai viewport ngẫu nhiên không có unintended overflow, overlap hoặc clipped focus.
- Locked render environment đạt SSIM ≥ 0,99 giữa expected và actual; vùng dynamic phải được khai báo, không mask lỗi tùy ý.
- Undo toàn session rồi redo toàn session khôi phục exact revision digest và asset dependency graph.
- Missing/moved/corrupt asset luôn có diagnostic, fallback và relink path; không thay thế im lặng.
- Agent query giải thích được nguồn computed value, component/variable dependency, route và runtime trace; agent mutation không vượt scope.
- Generated React/web và Flutter fixture build được, vượt scenario contract và giữ node-to-code trace cho toàn authored semantic node.
- Accessibility scan không có critical/serious issue; keyboard-only hoàn thành primary journey; reduced-motion không mất nội dung.

### 8.2 Performance budget

Budget được đo trên một reference hardware profile khóa theo release; báo median và percentile xấu phù hợp với từng metric:

| Tình huống                                           | Budget bắt buộc                                   |
| ---------------------------------------------------- | ------------------------------------------------- |
| Warm open empty project                              | interactive ≤ 800 ms                              |
| Open 10.000-node benchmark                           | interactive ≤ 2,5 s, không block > 100 ms         |
| Pan/zoom 10.000 nodes                                | p5 ≥ 55 FPS                                       |
| Pointer drag → canvas visual response                | p95 ≤ 32 ms                                       |
| Inspector edit → computed canvas update              | p95 ≤ 50 ms                                       |
| Atomic transaction trên 100 selected nodes           | p95 ≤ 100 ms                                      |
| Undo/redo transaction                                | p95 ≤ 100 ms                                      |
| Present route/state transition không chủ ý animation | p95 ≤ 100 ms                                      |
| Autosave                                             | không block renderer > 16 ms                      |
| Agent proposal 1.000 primitive commands              | progressive preview, cancellable, không UI freeze |

### 8.3 Usability budget

- Ít nhất 90% người tham gia mục tiêu hoàn thành các primary tasks không cần mở tài liệu ngoài.
- Người mới tạo được một trang sáu section có navigation + responsive preview trong 10 phút từ starter.
- Designer quen Figma hoàn thành transform/layout/component/prototype benchmark không chậm hơn 1,25× baseline Figma sau thời gian làm quen đã khóa.
- Không quá 5% primary actions bị tìm qua chat vì UI không discoverable; agent là accelerator, không che sự thiếu sót của editor.
- Vietnamese IME, keyboard-only và 200% zoom là các cohort bắt buộc, không phải kiểm thử phụ.

## 9. Chiến lược đo và chứng nhận

### 9.1 Công thức không che điểm yếu

```text
capabilityScore = min(coverage, workflowDepth, fidelity, reliability, parity)
pillarScore     = min(requiredCapabilityScores) với audit định lượng cho toàn pillar
releaseScore    = min(10 pillarScores)
```

Điểm trung bình và percentile chỉ dùng phân tích xu hướng. Nhãn “VIU 9+” dựa trên `releaseScore`, vì vậy một component workflow 8,9 đủ để chặn phát hành dù prototype đạt 9,8.

### 9.2 Test pyramid

- Schema/migration property tests và fuzz tests cho document không tin cậy.
- Pure unit tests cho resolver, command inverse, expression, component override, variable inheritance và validation.
- DOM interaction tests cho pointer/keyboard/IME, inspector, direct manipulation và workspace states.
- Runtime scenario tests cho route, overlay, form, collection, condition, variable, media, timeline và 3D fallback.
- Golden document + visual regression cho 12 benchmark, ba theme và reduced motion.
- Parity conformance: simulated user command và agent tool command tạo exact digest/diagnostics/trace.
- Recovery tests: crash giữa transaction, partial snapshot, moved asset, missing font, migration rollback và corrupt cache.
- Generation contract tests: IR → virtual graph → build → runtime scenario → node-to-code reverse lookup.
- Performance profiles với fixed hardware/data seed, trace lưu cùng evidence bundle.
- Manual expert review cho visual craft, discoverability và destructive/conflict flows; review không thay automated evidence.

### 9.3 Chấm điểm minh bạch

Mỗi điểm phải dẫn tới fixture, test run, screenshot/diff hoặc moderated task record. Không dùng nhận xét “trông ổn”, số lượng field hay phần trăm code hoàn thành để tăng score. Scorecard được cập nhật sau evidence run, không cập nhật theo kế hoạch.

## 10. Trạng thái triển khai hiện tại

Đã có:

- Document transaction, preview/commit, inverse command và local history.
- Multi-select, duplicate/delete/group/align/distribute.
- Text, typography, local font catalog, appearance cơ bản.
- Auto-layout batch và inspector cho direction/grid/gap/padding/alignment/wrap.
- Fixed/fill/hug, min/max, flow/absolute và constraints.
- Design canvas và Present cùng render auto layout.
- Route, scroll section, overlay, variables và deterministic runtime trace.
- Local asset protocol và agent query/scenario tools.

Chưa được tính hoàn thành:

- Breakpoint override UI và resolver đầy đủ.
- Snap/guides/measurement.
- Paint/stroke/effect stack.
- Vector editing/mask/boolean.
- Component/variant/instance semantics.
- Variable collection/mode/binding.
- Timeline/keyframe editor.
- Durable version history, comments và proposal visual diff.
- Dev Mode/codegen parity.

Tài liệu này là nguồn quyết định ưu tiên. Mỗi capability chỉ chuyển sang “đạt” khi command, UI, renderer, Present, agent surface và test cùng hoàn tất.
