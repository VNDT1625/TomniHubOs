# VIU authoring capability expansion

Status: **Research complete; Package A alpha approved and integrated into the VIU canvas and inspector.**

This document converts the "Figma-core" goal into an executable backlog. It evaluates the current VIU Next slice, lists concrete authoring capabilities, and defines schema, command, UI, and acceptance-test impact. It does not claim full parity and does not authorize implementation by itself.

## 1. Current evidence and decision

The current slice is a useful transaction/canvas proof, but it is not yet a general visual authoring tool:

- `ViuNextCanvas.tsx` stores exactly one `selectedNodeId`; there is no selection set, marquee model, or mixed-value inspector.
- The inspector exposes only name, X/Y, width/height, visibility, and lock. Text content and typography properties exist in `ViuNodeStyle`/`ViuNodeContent`, but have no authoring controls.
- `ViuCommand` has only insert, update, delete, reparent, reorder, connect-interaction, and disconnect-interaction. Higher-level operations such as group, align, auto-layout, component creation, token edits, motion, and screen edits have no typed commands.
- The agent surface is real but narrow: `viu_inspect`, `viu_preview_transaction`, `viu_commit_transaction`, and `viu_validate` accept the same seven-command union. The agent can submit generic patches, but cannot inspect computed layout, query selections, render a snapshot, author components/timelines/data, or prove runtime equivalence.
- Present mode resolves a simple screen navigation action. It is not yet a website runtime with long pages, nested scrolling, overlays, routes, form states, variables, ordered actions, conditions, or deterministic motion.

Decision: deliver P0 as three end-to-end authoring slices (text/selection, layout/visual, website prototype), while extending user and agent capability through the same command engine. Avoid a large cosmetic-only rewrite.

## 2. Primary-source benchmark

The backlog is grounded in current official product documentation:

- Figma supports multi-selection and marquee selection, including nested layers and bulk property changes: [Select layers and objects](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects). Smart selection adds uniform spacing, grid rearrangement, reordering, duplication, and reflow: [Arrange layers with Smart selection](https://help.figma.com/hc/en-us/articles/360040450233-Arrange-layers-with-Smart-selection).
- A baseline typography inspector includes font family/style, size, line height, letter spacing, horizontal and vertical alignment, with additional OpenType settings: [Explore text properties](https://help.figma.com/hc/en-us/articles/360039956634-Explore-text-properties). Reusable typography requires range-level text styles: [Create and apply text styles](https://help.figma.com/hc/en-us/articles/360039957034-Create-and-apply-text-styles).
- Responsive layout requires horizontal, vertical, and grid flow; gap, padding, alignment; fixed/hug/fill and min/max resizing; wrap and flow exceptions: [Guide to auto layout](https://help.figma.com/hc/en-us/articles/360040451373-Explore-auto-layout-properties).
- Components need explicit properties and variants rather than copied subtrees: [Component property fundamentals](https://help.figma.com/hc/en-us/articles/39636407507735-Components-collection-Component-property-fundamentals) and [Variants fundamentals](https://help.figma.com/hc/en-us/articles/39636737843735-Components-collection-Variants-and-component-set-fundamentals). Variables need typed values, aliases, collections, and modes for themes, devices, and localization: [Variables, collections, and modes](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes).
- Visual authoring needs stacked fills, gradients/images/video, strokes, masks, non-destructive booleans, effects, and blend modes: [Guide to fills](https://help.figma.com/hc/en-us/articles/360041003694-Guide-to-fills), [Stroke properties](https://help.figma.com/hc/en-us/articles/360049283914-Apply-and-adjust-stroke-properties), [Masks](https://help.figma.com/hc/en-us/articles/360040450253-Masks), [Boolean operations](https://help.figma.com/hc/en-us/articles/360039957534-Boolean-operations), [Layer effects](https://help.figma.com/hc/en-us/articles/360041488473-Apply-effects-to-layers), and [Blend modes](https://help.figma.com/hc/en-us/articles/360040667874-Use-blend-modes-to-create-unique-effects).
- A credible prototype supports hotspot-to-destination connections, several triggers, ordered actions, conditions, navigation, overlays, back, scroll-to, variable changes, transitions, easing/springs, and matching-layer animation: [Connect your prototype](https://help.figma.com/hc/en-us/articles/360040315773-Create-interactions), [Prototype actions](https://help.figma.com/hc/en-us/articles/360040035874-Prototype-actions), [Multiple actions and conditionals](https://help.figma.com/hc/en-us/articles/15253220891799-Multiple-actions-and-conditionals), [Scroll and overflow](https://help.figma.com/hc/en-us/articles/360039818734-Prototype-scroll-and-overflow-behavior), and [Smart animate](https://help.figma.com/hc/en-us/articles/360039818874-Smart-animate-layers-between-frames).
- Structured website content requires collections, field binding, repeaters, empty states, filters, sorting, pagination, and conditional visibility: [Webflow Collection list](https://help.webflow.com/hc/en-us/articles/33961294051347-Collection-list). Forms need editable normal/loading/success/error behavior: [Webflow Forms](https://help.webflow.com/hc/en-us/articles/33961347548563-How-do-I-add-forms-in-Webflow).
- Review and delivery need non-destructive version history, branch review, comments, inspect/code context, and explicit asset export: [Version history](https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history), [Branching](https://help.figma.com/hc/en-us/articles/360063144053-Guide-to-branching), [Comments](https://help.figma.com/hc/en-us/articles/360039825314), [Dev Mode](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode), and [Export formats](https://help.figma.com/hc/en-us/articles/13402894554519-Export-formats-and-settings).
- Editor and generated output should target [WCAG 2.2](https://www.w3.org/TR/WCAG22/) AA, including keyboard operation, focus visibility, labels, contrast, target size, and reduced motion.

## 3. Priority and acceptance conventions

- **P0:** required for a credible editable website authoring alpha; blocks approval/generation when relevant.
- **P1:** Figma-core depth needed for reusable responsive products.
- **P2:** advanced production, team, or illustration depth that may follow the first usable release.
- Every mutation below must be one typed, atomic, undoable transaction. Composite commands may normalize to primitive commands, but their intent must remain visible in history and agent diff.
- An acceptance test means an automated unit/component/integration test unless explicitly marked as visual or Electron E2E.

## 4. Selection and canvas

| ID    | Capability                                      | Current gap                                               | Priority | Schema / command / UI impact                                                                                                             | Acceptance test                                                                                              |
| ----- | ----------------------------------------------- | --------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| SC-01 | Shift-click multi-select with toggle            | Single `selectedNodeId` only                              | P0       | Schema: ephemeral `SelectionSet`; Command: bulk patch targets; UI: multiple outlines and mixed inspector values                          | Select 3 nodes, deselect the middle, move remaining 2 once; undo restores both                               |
| SC-02 | Marquee select, including nested-layer modifier | No marquee or containment/intersection policy             | P0       | Schema: ephemeral marquee policy; Command: none until gesture commit; UI: drag rectangle and modifier hint                               | Left-to-right contains, right-to-left intersects, locked nodes excluded; test nested modifier                |
| SC-03 | Duplicate in place and drag-duplicate           | No visible duplicate action                               | P0       | Schema: stable cloned IDs and remapped internal bindings; Command: `duplicateNodes`; UI: shortcut/menu and Alt-drag                      | Duplicate a group with children and internal interaction; no ID collision and one undo removes clone         |
| SC-04 | Delete selection with safe cascade              | Reducer supports one node only; no UI/confirmation policy | P0       | Schema: cascade report; Command: `deleteNodes`; UI: Delete/Backspace and review for screen/component removal                             | Delete 20 selected nodes atomically; broken external bindings become diagnostics; undo restores exact digest |
| SC-05 | Group, ungroup, and frame selection             | Group node exists but no authoring workflow               | P0       | Schema: group/frame bounds and child transforms; Commands: `groupNodes`, `ungroupNodes`, `frameSelection`; UI: context/toolbar shortcuts | Group preserves world geometry and z-order; ungroup returns original world geometry within 0.01 px           |
| SC-06 | Align left/center/right/top/middle/bottom       | Missing                                                   | P0       | Schema: no persistent field; Command: `alignNodes(axis, mode, anchor)`; UI: contextual alignment bar                                     | Align mixed sizes to key object or selection bounds; locked node unchanged; one undo                         |
| SC-07 | Distribute and tidy spacing                     | Missing                                                   | P0       | Schema: optional smart-selection metadata; Commands: `distributeNodes`, `tidySelection`; UI: gap handle and numeric input                | Five nodes distribute equally; editing the shared gap reflows deterministically                              |

## 5. Text and typography

| ID    | Capability                                                               | Current gap                                           | Priority | Schema / command / UI impact                                                                                                   | Acceptance test                                                                                         |
| ----- | ------------------------------------------------------------------------ | ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| TX-01 | Double-click inline text editing with Vietnamese/IME composition         | Text is rendered but content cannot be edited         | P0       | Schema: rich-text document with initial plain paragraph; Command: `setTextContent`/range edits; UI: IME-safe overlay and caret | Enter `Tiếng Việt hoàn chỉnh`, compose without premature commits, undo as one edit session              |
| TX-02 | Text content field in inspector                                          | `content.text` exists but inspector omits it          | P0       | Schema: preserve plain/rich content compatibility; Command: `setTextContent`; UI: multiline Arco text area with auto-grow      | Inspector edit updates canvas and Present immediately; empty string remains valid and selectable        |
| TX-03 | Font-family picker with search, recents, local/link status, and fallback | `fontFamily` exists but no picker or font inventory   | P0       | Schema: `FontRef`, fallback stack, missing state; Commands: `setTypography`, `linkFontAsset`; UI: searchable preview menu      | Select a local font, reopen project, then simulate missing font and show deterministic fallback warning |
| TX-04 | Font size with presets, direct input, scrub, and mixed-value state       | `fontSize` exists but no control                      | P0       | Schema: numeric/token binding; Command: `setTypography`; UI: bounded input and token picker                                    | Apply 48 px to 4 text nodes atomically; reject NaN/negative; mixed state is displayed                   |
| TX-05 | Weight/style, italic, and variable-font axes                             | Only numeric `fontWeight` field, no UI/style metadata | P0       | Schema: weight/style/axes map; Command: `setTypography`; UI: available-face picker and axes popover                            | Choosing 700 maps to an available face; unavailable face yields diagnostic, not silent substitution     |
| TX-06 | Line height in px, percent, auto                                         | Field exists as untyped number only                   | P0       | Schema: typed length `{unit,value}` or `auto`; Command: `setTypography`; UI: unit switch and token binding                     | Switch 24 px to 150%; computed result is stable at two font sizes and matches Present                   |
| TX-07 | Letter spacing in px/em and paragraph spacing                            | Letter spacing exists; no unit or paragraph model     | P0       | Schema: typed tracking plus paragraph spacing/indent; Command: `setTypography`; UI: unit-aware fields                          | Apply -0.02em and paragraph gap; rendered metrics match snapshot tolerance                              |
| TX-08 | Horizontal and vertical text alignment                                   | Missing from node style and UI                        | P0       | Schema: `textAlign` and `verticalAlign`; Command: `setTypography`; UI: segmented icon controls                                 | All 3 horizontal and 3 vertical modes render correctly in a fixed text box                              |

## 6. Layout and responsive authoring

| ID    | Capability                                              | Current gap                                              | Priority | Schema / command / UI impact                                                                                                                   | Acceptance test                                                                               |
| ----- | ------------------------------------------------------- | -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| LY-01 | Add/remove auto-layout around a selection               | Layout fields exist but no control or solver integration | P0       | Schema: deterministic layout container; Commands: `wrapAutoLayout`, `removeAutoLayout`; UI: Shift+A and inspector                              | Wrap 4 nodes, infer direction, preserve order; removing layout preserves world geometry       |
| LY-02 | Direction, gap, four-side padding, align, justify       | Fields exist but inspector omits them                    | P0       | Schema: extend justify/gap modes; Command: `setLayout`; UI: visual alignment grid and linked padding inputs                                    | Changing gap/padding reflows children and computed geometry equals Present output             |
| LY-03 | Fixed, hug, fill, min/max sizing per axis               | Partial schema, no controls or computed explanation      | P0       | Schema: typed sizing and computed reason; Command: `setSizing`; UI: per-axis menu and computed-size tooltip                                    | Button hugs changed label; fill child consumes remainder; invalid hug/fill cycle is rejected  |
| LY-04 | Wrap and per-child absolute escape                      | `wrap`/`positionMode` exist but not authored             | P0       | Schema: wrap gap and absolute anchors; Commands: `setLayout`, `setPositionMode`; UI: wrap toggle and flow badge                                | Narrow parent wraps children deterministically; absolute badge preserves independent position |
| LY-05 | Responsive breakpoints and sparse overrides             | One viewport per screen only                             | P0       | Schema: breakpoint registry and property override maps; Commands: `upsertBreakpoint`, `setBreakpointOverride`; UI: desktop/tablet/mobile strip | Resize at 1440/768/390; only declared overrides differ and base edit propagates elsewhere     |
| LY-06 | Constraints and computed anchoring                      | Constraint enum exists, no authoring or resize solver    | P1       | Schema: anchors/scale plus constraint diagnostics; Command: `setConstraints`; UI: constraint diagram                                           | Parent resize preserves left/right margins or scales child according to selected rule         |
| LY-07 | CSS-like grid tracks, spans, auto-flow, and named areas | Only integer `columns`                                   | P1       | Schema: typed tracks, rows, span, area, auto-flow; Command: `setGridLayout`; UI: track editor and canvas lines                                 | A responsive 12-column fixture reproduces declared spans at three breakpoints                 |

## 7. Styles and effects

| ID    | Capability                                                                 | Current gap                        | Priority | Schema / command / UI impact                                                                      | Acceptance test                                                                                 |
| ----- | -------------------------------------------------------------------------- | ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ST-01 | Ordered multi-fill stack: solid, linear/radial/conic gradient, image/video | Single background string           | P0       | Schema: `paints[]`; Commands: add/update/reorder/remove paint; UI: fill stack with live picker    | Three fills reorder without loss; editor and Present compositing snapshots match                |
| ST-02 | Strokes per side, position, dash, cap, join, multiple paints               | Single border color/width          | P0       | Schema: `strokes[]`; Command family for strokes; UI: compact stroke editor                        | Inside/outside/center and dashed strokes preserve outer geometry correctly                      |
| ST-03 | Independent corner radii and smoothing                                     | One radius number                  | P0       | Schema: four radii plus smoothing; Command: `setCorners`; UI: linked/unlinked corner control      | Toggle linked mode, edit top-left only, resize node without corrupting radii                    |
| ST-04 | Ordered shadows and layer/background blur                                  | One CSS shadow string              | P1       | Schema: typed `effects[]`; commands for effect stack; UI: effect rows and canvas handles          | Two shadows plus blur serialize deterministically and export with explicit fallback diagnostics |
| ST-05 | Layer opacity and blend modes                                              | Opacity exists; blend mode missing | P1       | Schema: node/paint/effect blend modes; Command: `setAppearance`; UI: blend menu with live preview | Multiply and screen match reference pixels within threshold; unsupported export is reported     |

## 8. Vector and image authoring

| ID    | Capability                                       | Current gap                                   | Priority | Schema / command / UI impact                                                                             | Acceptance test                                                                           |
| ----- | ------------------------------------------------ | --------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| VI-01 | Image fit/fill/crop/tile with focal point        | Asset can render but has no crop model        | P0       | Schema: image transform, fit mode, focal point; Command: `setImageFit`; UI: crop mode and handles        | Crop remains stable after node resize and at all breakpoints                              |
| VI-02 | Non-destructive masks and clip content           | Overflow string is not a mask graph           | P1       | Schema: mask node/reference and mode; Commands: `createMask`, `releaseMask`; UI: mask action/layer badge | Mask image with vector, edit mask, release and recover both original nodes                |
| VI-03 | Vector pen/path editing with nodes and handles   | Vector type exists without geometry authoring | P1       | Schema: vector network/paths/winding; commands for point/segment edits; UI: vector edit mode             | Draw open/closed paths, edit Bezier handle, undo each atomic edit without path corruption |
| VI-04 | Non-destructive union/subtract/intersect/exclude | Missing                                       | P1       | Schema: boolean group and operation; Command: `booleanCombine`; UI: boolean menu                         | All four operations match golden SVG geometry and retain editable source children         |

## 9. Components and variants

| ID    | Capability                                                     | Current gap                                      | Priority | Schema / command / UI impact                                                                                                      | Acceptance test                                                                              |
| ----- | -------------------------------------------------------------- | ------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| CO-01 | Create component and instance from selection                   | Component record is root ID only; no commands/UI | P1       | Schema: definition, instance binding, stable slots; Commands: `createComponent`, `createInstance`; UI: component badge/assets tab | Edit definition once and update 20 instances without subtree duplication                     |
| CO-02 | Sparse instance overrides and reset                            | Missing                                          | P1       | Schema: override map by stable descendant/property ID; Commands: set/reset override; UI: override indicators                      | Override one label and image; definition layout update preserves both; reset restores source |
| CO-03 | Text, boolean, instance-swap, and slot properties              | Missing                                          | P1       | Schema: typed component property definitions/bindings; commands to expose/bind/set; UI: generated instance controls               | Card instance toggles badge, edits title, swaps icon, and fills slot without detaching       |
| CO-04 | Variant sets with orthogonal properties and interactive states | Missing                                          | P1       | Schema: component set, property axes, unique combinations; Commands: create/add/change variant; UI: variant matrix                | Button has size x intent x state; duplicate combination is rejected with clear diagnostic    |
| CO-05 | Variables, collections, aliases, and modes                     | Only flat value records                          | P1       | Schema: typed collections/modes/aliases; Commands: CRUD/bind/set mode; UI: variable table and mode switch                         | Light/dark and EN/VI modes update bound colors/text; alias cycle is rejected                 |

## 10. Data and content

| ID    | Capability                                                     | Current gap                                    | Priority | Schema / command / UI impact                                                                               | Acceptance test                                                                                   |
| ----- | -------------------------------------------------------------- | ---------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| DA-01 | Typed mock collections with fields and rows                    | `rows: unknown[]` only                         | P1       | Schema: collection/field types, row IDs, validation; Commands: CRUD schema/rows/import CSV; UI: data table | Import 1,000 rows, reject wrong field type, preserve stable row IDs on reorder                    |
| DA-02 | Bind text/image/link/style/visibility to fields                | Missing                                        | P1       | Schema: typed property expressions; Command: `bindProperty`; UI: data-dot picker and binding badge         | Bind card title/image/link; row switch updates all three and missing value uses explicit fallback |
| DA-03 | Repeater with filter, sort, limit, pagination, and empty state | `repeater` node exists without semantics       | P1       | Schema: query, item template, states; Command: `configureRepeater`; UI: query builder/state switch         | Filter featured rows, sort newest, show 12/page, and display designed empty state at zero results |
| DA-04 | Conditional visibility and simple expressions                  | Missing                                        | P1       | Schema: safe declarative expression AST; Command: `setCondition`; UI: rule builder                         | Boolean/string/number conditions evaluate identically in editor, Present, and generated fixture   |
| DA-05 | Form controls, validation, loading, error, success, retry      | Control types are shallow; no form-state graph | P0       | Schema: field rules and form states; Commands: configure form/field/state; UI: state switcher              | Required email shows error, submit shows loading then success; failed mock can retry              |

## 11. Collaboration and history

| ID    | Capability                                                    | Current gap                                              | Priority | Schema / command / UI impact                                                                                            | Acceptance test                                                                                   |
| ----- | ------------------------------------------------------------- | -------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| CH-01 | Visible undo/redo stack with actor and transaction summary    | Inverse commands exist but no complete editor history UX | P0       | Schema: durable transaction journal; Commands: undo/redo transaction; UI: buttons/history list                          | Undo a 100-operation agent change once; redo restores identical project digest                    |
| CH-02 | Autosave, crash recovery, and named checkpoints               | Session memory only                                      | P0       | Schema: snapshot/journal/checkpoint records; service commands; UI: save status/checkpoint panel                         | Kill renderer after commit, reopen within 5 s, lose no committed transaction                      |
| CH-03 | Agent visual diff with accept/reject/narrow and one-step undo | Preview returns data but no complete visual review       | P0       | Schema: proposal branch and scope grant; Commands: accept/reject proposal; UI: ghost/before-after and changed-node list | Reject leaves digest unchanged; accept 50 edits creates one history item; scope breach is blocked |
| CH-04 | Anchored comments and review status                           | Missing                                                  | P2       | Schema: comment threads anchored to stable entity/revision; commands CRUD/resolve; UI: canvas pins/review panel         | Comment survives node move and old-version view; resolving does not mutate design digest          |

## 12. Prototype and motion

| ID    | Capability                                                                               | Current gap                                                                  | Priority | Schema / command / UI impact                                                                                               | Acceptance test                                                                                    |
| ----- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| PR-01 | Screen as route plus ordered scroll sections in one long page                            | Screen owns one root frame; no section/page-flow model                       | P0       | Schema: semantic sections, document height, nested scroll containers; Commands: add/reorder section; UI: section navigator | Home has 7 ordered sections, scrolls as one page, sticky nav remains visible                       |
| PR-02 | Visual hotspot connections with destination noodles                                      | Simple interactions exist but no complete authoring surface                  | P0       | Schema: typed trigger/action/transition; Commands: connect/update/disconnect; UI: drag handle and graph                    | Drag CTA to Pricing screen; Present click navigates; deleting target raises blocking diagnostic    |
| PR-03 | Navigate/back/open/close/swap overlay and route history                                  | Only navigate/open-overlay/scroll-to fields; runtime handles simple navigate | P0       | Schema: navigation stack and overlay policy; actions/commands; UI: action editor                                           | Open modal, swap confirmation, close, then Back returns to correct route deterministically         |
| PR-04 | Scroll-to, nested overflow, preserve/reset position, fixed/sticky                        | Partial overflow string only                                                 | P0       | Schema: scroll container/position policy; actions and layout commands; UI: scroll behavior panel                           | Scroll CTA targets section; route transition preserves or resets according to declared policy      |
| PR-05 | Full trigger set: click, hover, press, focus/blur, key, drag, timer, media/scroll events | Six shallow trigger strings                                                  | P1       | Schema: typed trigger payload/guards; Commands: set trigger; UI: searchable trigger menu                                   | Keyboard and pointer trigger same semantic button action; timer cancels on screen exit             |
| PR-06 | Ordered multi-actions, conditions, variables, delay, sequence/parallel                   | One action per interaction                                                   | P0       | Schema: declarative action tree and expression AST; Command: update behavior tree; UI: reorderable action builder          | Set variable then conditionally navigate; reversing action order produces expected different trace |
| PR-07 | Present as a complete multi-route website runtime                                        | Present switches one screen only                                             | P0       | Schema: runtime session state; Commands: start/reset scenario; UI: fullscreen viewport/device/location controls            | Traverse Home -> Product -> modal -> Checkout -> Success without returning to editor               |
| PR-08 | Transitions and smart matching-layer animation                                           | Timeline is name/duration only                                               | P1       | Schema: transition, easing/spring, matching identity; Commands: set transition; UI: animation preview                      | Matching hero layer animates geometry/color; reduced-motion mode uses declared fallback            |
| PR-09 | Timeline/keyframes and scroll-linked chapters                                            | No tracks/keyframes/runtime                                                  | P1       | Schema: typed tracks, keyframes, bindings, markers; commands CRUD; UI: timeline and scroll scrubber                        | Scrub at 0/25/50/100% matches Present screenshots and replay trace deterministically               |

## 13. Accessibility, export, and code generation

| ID    | Capability                                                                          | Current gap                                 | Priority | Schema / command / UI impact                                                                                     | Acceptance test                                                                                |
| ----- | ----------------------------------------------------------------------------------- | ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| AX-01 | Semantic roles, heading order, labels, alt text, landmark and focus-order inspector | Basic role/label only; no quality tooling   | P0       | Schema: richer semantics/focus order; Command: `setSemantics`; UI: Accessibility panel                           | Missing button label/alt and skipped heading are detected; fixes clear diagnostics             |
| AX-02 | Keyboard-complete editor and prototype with visible focus and announcements         | Canvas gestures dominate                    | P0       | Schema: optional shortcut map; Commands unchanged; UI: accessible layer tree, focus ring, live announcements     | Complete select/move/resize/connect/undo flow without mouse at 200% zoom                       |
| AX-03 | Contrast, touch-target, overflow, and reduced-motion validation                     | Only four flow diagnostics                  | P0       | Schema: exception/fallback records; validator commands; UI: Quality panel with jump-to-fix                       | Fixture catches low contrast, 32 px target, clipped CTA, and motion with no fallback           |
| AX-04 | Explicit asset export: PNG/JPG/SVG/PDF settings and deterministic filenames         | Missing                                     | P1       | Schema: export hints/scales/formats; Command: `setExport`, `exportAssets`; UI: export rows/preview               | Export selected icon at SVG and 1x/2x PNG; same revision produces identical manifest/hash      |
| AX-05 | Approved immutable revision -> ViuIR -> virtual web file graph                      | No production adapter path in current slice | P1       | Schema: approval, IR capability report, virtual files; Commands: approve/generate; UI: readiness and file review | Unapproved revision cannot generate; approved golden site emits deterministic React/Vite graph |
| AX-06 | Node-to-code trace, runtime locator, visual/behavior comparison, bounded repair     | Missing                                     | P1       | Schema: trace map and verification report; Commands: verify/repair proposal; UI: design-code inspect mode        | Click VIU node to locate emitted symbol; changed generated region is not overwritten silently  |

Total: **60 concrete capabilities**.

## 14. Recommended approval package

### Package A — P0 direct authoring foundation

Approve first: SC-01 through SC-07, TX-01 through TX-08, and CH-01. This fixes the immediate product failure: users can select, duplicate/delete/group/align/distribute, edit Vietnamese text inline, and control family/size/weight/line-height/letter-spacing/alignment. Exit gate: rebuild the current premium hero from a blank frame without editing JSON or code.

### Package B — P0 layout and visual website foundation

Approve next: LY-01 through LY-05, ST-01 through ST-03, VI-01, DA-05, CH-02, and CH-03. Exit gate: a six-section responsive landing page survives text/content changes at desktop/tablet/mobile, reopens after a forced crash, and accepts/rejects an agent visual proposal.

### Package C — P0 executable website prototype

Approve next: PR-01 through PR-04, PR-06, PR-07, and AX-01 through AX-03. Exit gate: one long scrolling Home route connects to Product and Checkout routes, opens/closes an overlay, submits a stateful form, supports Back and scroll-to, and passes reachability/accessibility/responsive validation.

P1 then adds reusable systems (grid, vector, components/variants, variables/modes, data repeaters, transitions/timelines, export/codegen). P2 comments and broader collaboration must not delay the local-first core.

## 15. User and agent parity contract

The agent should not receive a second hidden design model. The difference is interaction modality and authority, not capability:

| Concern  | Human user                                 | Agent                                                                   | Required evidence                                                    |
| -------- | ------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Read     | Canvas, layers, inspector, Present         | Structured inspect/query, computed layout, diagnostics, render snapshot | Same revision and entity IDs in both views                           |
| Mutate   | Gestures and inspector emit typed commands | Tool submits the same typed commands                                    | Command conformance tests execute each capability from both adapters |
| Preview  | Optimistic gesture and visual result       | Non-mutating proposal branch and visual diff                            | Preview digest leaves authoritative state unchanged                  |
| Commit   | Pointer-up/form confirmation               | Explicit scope plus base revision/preconditions                         | One sequencer, atomic transaction, actor recorded                    |
| Review   | Undo/history and before/after              | Receives diagnostics and changed IDs                                    | One accepted proposal equals one undoable history entry              |
| Runtime  | Present mode                               | Deterministic scenario tool and trace inspection                        | Human run and agent replay produce the same state/trace digest       |
| Generate | Approves immutable revision                | May request virtual generation/integration plan                         | Agent cannot approve its own material changes or bypass validation   |

Current proof: the project already routes agent work through preview/commit transactions and records `origin: 'agent-tool'`; it does **not** yet prove parity because advanced typed commands, computed-layout queries, render snapshots, runtime scenario tools, and capability conformance tests do not exist. Parity is accepted only when every shipped capability has: (1) a user gesture/inspector path, (2) an agent command/tool path, and (3) a test showing identical project digest and runtime behavior.

## 16. Non-negotiable implementation rules

1. Do not implement individual inspector controls as renderer-only state; commit typed commands.
2. Do not expose raw CSS/JSON editing as the primary UX. Preserve semantic, validated fields and lower them to CSS/runtime IR.
3. Text editing must be IME-safe and must preserve Unicode end to end; add Vietnamese, Japanese, Korean, and CJK composition fixtures.
4. Bulk/composite actions are atomic and inverse-tested; partial selection mutation is a failure.
5. Present and generated output consume the same behavior/layout semantics; screenshot similarity alone is insufficient.
6. Every new P0 capability adds user-path, agent-path, failure-path, undo, persistence, and Present-equivalence tests.
7. No implementation starts from this document until the lead selects an approval package and locks the owning schema/command contracts.

## 17. Package A alpha implementation evidence

Lead approval was received for SC-01 through SC-07, TX-01 through TX-08, CH-01, plus the existing-schema appearance subset.

Implemented pure APIs under `packages/desktop/src/common/viu/authoring/`:

- selection: `normalizeViuSelection`, `toggleViuSelectionNode`, `createViuMarqueeSelection`, `getTopLevelViuSelection`;
- structural batches: `createDuplicateViuBatch`, `createDeleteViuBatch`, `createGroupViuBatch`, `createUngroupViuBatch`, `createAlignViuBatch`, `createDistributeViuBatch`;
- content/style batches: `createTextContentViuBatch`, `createTypographyViuBatch`, `createAppearanceViuBatch`;
- history: `createViuHistoryJournal`, `recordViuHistory`, `undoViuHistory`, `redoViuHistory`;
- IME: `createViuImeDraftController`.

Renderer integration is exported from `packages/desktop/src/renderer/pages/studio/ide/Viu/next/authoring/` as `AuthoringInspector` and `useViuImeTextDraft`. The component receives all labels, font choices, selection, project state, and an `onCommit(batch)` callback through props. It contains no renderer-only document mutation and emits only existing `ViuCommand[]` batches.

Integration contract:

```ts
const batch = createGroupViuBatch(project, selection, {
  groupId: nextId('group'),
  groupName: labels.groupName,
});

const result = applyViuTransaction(project, {
  // normal document/revision/actor fields
  commands: [...batch.commands],
  mode: 'commit',
});
```

The canvas now applies `batch.nextSelection` after each accepted commit, exposes visible structural-authoring and history controls, and records all accepted user edits in the local journal. `textAlign` and `verticalAlign` are promoted to the shared node style and rendered consistently in both the design canvas and Present runtime.

Automated evidence: 21 focused tests pass across selection, marquee, deep duplication plus interaction remap, delete/inverse, group/ungroup geometry, align/distribute, Unicode content, typography retention, undo/redo, Vietnamese/CJK IME composition, locked controls, and Arco Inspector DOM behavior.
