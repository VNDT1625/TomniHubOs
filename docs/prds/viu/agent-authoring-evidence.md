# VIU authoring paths and runtime evidence

Status: implementation evidence for VIU V2, not a parity claim.

## One document, two authoring paths

VIU uses one shared design document rather than separate user and agent documents. Both paths address the same `ViuProjectState`, use the same normalized `ViuCommand` union, and converge on the same authoritative `ViuV2SessionService` keyed by an opaque workspace key.

| Concern             | User path                                                               | Agent path                                                     | Shared guarantee                                         |
| ------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| Entry               | Pointer/keyboard gestures and Inspector controls in `ViuNextCanvas.tsx` | MCP tools registered in `agentTools.ts`                        | Both emit `ViuTransaction` commands                      |
| Identity            | `actor.kind: 'user'`, origin `canvas` or `inspector`                    | Schema requires `actor.kind: 'agent'`, origin `agent-tool`     | Provenance is explicit and machine-readable              |
| Read                | Renderer calls `ide.viu.v2.inspect` through `viuClient`                 | `viu_inspect` and bounded `viu_query`                          | Same process-wide session service                        |
| Dry run             | UI currently performs local gesture preview before commit               | `viu_preview_transaction` is required for safe proposal review | Preview never advances authoritative revision            |
| Write               | UI queues `ide.viu.v2.commit` after optimistic local rendering          | `viu_commit_transaction`                                       | Revision/precondition checks and atomic rejection        |
| Quality gate        | Canvas receives diagnostics in transaction result                       | `viu_validate`                                                 | Same structural and reachability validator               |
| Undo evidence       | UI receives `inverseCommands` in every accepted result                  | Agent receives the same result payload                         | Inverse commands are produced by the shared engine       |
| Permission boundary | Renderer reaches a fixed IPC channel set                                | MCP calls pass through the IDE native tool guard               | No arbitrary renderer filesystem or agent code execution |

## Concrete evidence in the repository

1. `packages/desktop/src/common/viu/commands.ts:234` is the only transaction interpreter. It clones a candidate, checks `baseRevision` and node preconditions, applies the complete command list atomically, generates inverse commands, and only increments revision for a commit.
2. `packages/desktop/src/renderer/pages/studio/ide/Viu/next/ViuNextCanvas.tsx:126` converts user gestures into transactions. The actor is `user`; canvas additions/moves and Inspector edits remain distinguishable at this layer.
3. `packages/desktop/src/renderer/pages/studio/ide/Viu/index.tsx` loads the authoritative session over IPC and serializes optimistic UI commits through a promise queue. A rejected commit replaces optimistic state with the authoritative state.
4. `packages/desktop/src/process/ide/viu/agentTools.ts` exposes thirteen bounded tools: inspect, semantic query, preview/commit transaction, validation, deterministic runtime scenario, capabilities, and the create/get/claim/submit/review/commit frame-plan workflow. Its Zod schemas reject unknown fields, oversized lists, empty patches, non-agent actors, wrong origins, and a preview/commit mode mismatch.
5. `packages/desktop/src/process/ide/viu/v2SessionService.ts` is injected into both the IPC bridge and IDE MCP server. It previews on a clone and stores state only after an accepted commit.
6. `packages/desktop/src/process/ide/mcp/ideServer.ts:1424` wraps MCP tools with the native tool guard before VIU tools are registered at line 1452.
7. `tests/unit/ide/viu-v2/commands.test.ts` proves preview immutability, atomic commit, stale-revision rejection, precondition rejection, subtree restoration, and interaction undo.
8. `tests/unit/ide/viu-v2/sessionTools.test.ts` and `agentSurface.test.ts` prove all seven MCP tools exist, query/scenario are read-only, traces are deterministic, bounds and redaction hold, user/agent commands converge on identical state, preview is read-only, and commit advances once.

This is substantive equivalence: user and agent have different affordances, but neither bypasses the document engine. The agent is not driving the visual UI with synthetic clicks; it authors the same structured model through a smaller, auditable API.

## Present/runtime pipeline

The preview implementation is a compiler plus deterministic interpreter, not exported application code:

```text
ViuProjectState + ViuRuntimeContract
        -> compileViuSite(...)
        -> routes / ordered scroll sections / resolved interactions / diagnostics
        -> createViuRuntimeState(...)
        -> reduceViuRuntime(..., event)
        -> route, scroll, overlay, variables, timeline effect, history, trace
        -> ViuPresentRuntime
```

Implemented evidence:

- `packages/desktop/src/common/viu/runtime/compiler.ts` groups every screen with the same normalized route into ordered scroll sections according to `screenOrder`.
- Button navigation resolves to a target route and exact section anchor. `scrollTo`, overlay, variable, timeline and contract-level `back` actions are validated before execution.
- Missing screens/nodes/variables/timelines become diagnostics; an invalid interaction is not guessed or executed.
- `packages/desktop/src/common/viu/runtime/machine.ts` is a pure state transition function. Every activation appends an applied/ignored trace entry with route-before, route-after, interaction and action IDs.
- `packages/desktop/src/renderer/pages/studio/ide/Viu/next/runtime/ViuPresentRuntime.tsx` renders all sections for the active route, executes navigation and scrolling, maintains back history and overlays, and selects mobile/tablet/desktop overrides from the live viewport.
- Motion uses declarative presets and bounded numeric fields. `prefers-reduced-motion` and the explicit runtime flag disable duration and smooth scrolling.
- No `eval`, `Function`, injected script, raw HTML string, or arbitrary CSS object spread is used by the runtime.

Targeted tests live in `tests/unit/ide/viu-runtime/` and cover route grouping, click navigation, invalid targets, deterministic trace/back, responsive breakpoint selection, reduced motion, and DOM-level route presentation.

## Serializable runtime contract

The base VIU schema stays normalized and code-generation friendly. Website-only layout, effects, responsive overrides and motion live in a separate versioned JSON contract:

```json
{
  "schemaVersion": 1,
  "defaultScreenId": "screen-home",
  "breakpoints": { "mobileMax": 767, "tabletMax": 1199 },
  "sections": {
    "screen-story": {
      "anchorId": "material-story",
      "minHeight": 1400,
      "scrollSnap": "start",
      "sticky": false
    }
  },
  "nodes": {
    "node-hero-title": {
      "layout": { "position": "sticky", "inset": { "top": 80 }, "zIndex": 3 },
      "effects": { "backdropBlur": 14, "perspective": 900, "rotateY": -6 },
      "motion": {
        "preset": "rise",
        "trigger": "in-view",
        "durationMs": 560,
        "easing": "spring-soft"
      },
      "responsive": {
        "mobile": {
          "layout": { "position": "relative", "width": "100%", "minHeight": 180 },
          "effects": { "rotateY": 0 }
        }
      }
    }
  },
  "interactions": {
    "interaction-modal-close": { "action": { "type": "closeOverlay" } },
    "interaction-back": { "action": { "type": "back" } }
  },
  "routeTransition": {
    "preset": "blur-in",
    "trigger": "click",
    "durationMs": 320,
    "easing": "ease-out"
  }
}
```

The contract deliberately exposes a bounded CSS-like vocabulary: flex/grid layout, spacing, sizing, inset/z-index/overflow, filters, blend modes, perspective/3D transforms, responsive variants, and named motion presets. It does not accept JavaScript, event handler strings, stylesheet text, URLs, selectors, or arbitrary property names.

## Agent-native semantic and scenario evidence

The shipped agent path is intentionally different from synthetic UI automation, but it now has three deeper, inspectable capabilities:

- `viu_query` filters by node IDs, node types, name, provenance source and ancestry. It returns document revision, stable entity IDs, parent-composed absolute geometry, inherited typography/computed node style, screen ownership, semantics, interaction IDs and validation/query diagnostics.
- Query results are capped at 200 nodes; requested IDs are capped at 100. Successful payloads redact the opaque workspace key, Windows/UNC paths, `file:///` URLs and conventional local POSIX paths. It never returns local asset grants or filesystem handles.
- `viu_run_runtime_scenario` compiles the exact current project through `compileViuSite`, creates state through `createViuRuntimeState`, and applies at most 64 strict serializable events through `reduceViuRuntime`. The result contains routes, sections, final route/screen/overlay/variable/effect state, an auditable trace and a canonical SHA-256 digest.
- Scenario execution uses a cloned inspected project. It has no DOM, browser, network, local-file or `eval` capability and never advances the authoritative revision.
- `viu_get_capabilities` reports the exact user path (`viuClient.commitV2` -> `ide.viu.v2.commit` -> `viuV2SessionService`), agent path (`viu_commit_transaction` -> the same service), limits and known visual gaps at the active revision.
- `tests/unit/ide/viu-v2/agentSurface.test.ts` proves read-only query/scenario behavior, absolute descendant geometry, filesystem redaction, strict bounds, deterministic trace digests and exact state equality when user/canvas and agent transactions contain the same commands. Actor/origin metadata differs at the transaction boundary; it does not fork document state.

## Remaining boundaries — evidence against overstating parity

The locked V1 authoring/runtime/Team Preview scope has passed its release gate, including timeline/keyframe editing, scroll bindings, ordered actions and frame-plan tools. The following remain separate product claims:

1. **No full Figma-equivalent collaboration surface.** Team Preview supports immutable packages, authenticated feedback and remote runs, but not multiplayer cursors, comments directly on every canvas node, branching or merge UI.
2. **Agent parity is contract-oriented, not synthetic UI parity.** The agent can inspect, query, preview, commit and coordinate frame plans against the shared model; not every transient editor-only gesture has a dedicated public tool.
3. **No certified generated-code equivalence.** Present mode interprets the design document. React/Flutter export still needs route, interaction, accessibility, DOM and screenshot comparison gates against the approved snapshot.
4. **3D depth remains bounded.** Local model assets and runtime surfaces can participate in a composition, but a full WebGL material, lighting, camera, rigging and GPU-profiler workspace is not certified here.
5. **Arbitrary website import is not pixel-parity proof.** Closed shadow DOM, protected media, custom shaders, canvas/WebGL internals and browser-specific layout behavior still require runtime adapters or raster evidence.
6. **Responsive behavior is a bounded document model.** Breakpoint overrides, sizing and long-page sections are implemented; complete CSS layout compatibility, container queries and browser text measurement are separate work.

## Next acceptance gates beyond V1

- Add live revision invalidation so an external agent commit appears on an already-open canvas without remounting and preserves selection when safe.
- Make the user/agent parity matrix executable for every persistent visual operation, with a visual before/after proposal review.
- Certify generated code only after route, interaction, accessibility and screenshot comparisons pass against Present mode.
- Benchmark advanced 3D adapters and arbitrary imported experiences under explicit GPU, memory and sandbox limits.
- Run the twelve reference-artifact comparator before making a numerical Figma-parity claim.
