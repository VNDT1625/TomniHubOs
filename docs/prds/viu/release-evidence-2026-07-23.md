# VIU V1 release evidence ? 2026-07-23

Status: **release gate passed for the agreed VIU V1 authoring and Team Preview scope.** This is implementation evidence, not a claim of complete Figma product parity or generated-code visual equivalence.

## Delivered scope

- Canvas-first visual authoring with pages, layer hierarchy, multi-selection, guides, layout controls, responsive variants, variables/tokens/modes, components/variants and local asset grants.
- Editable typography, fills, gradients, multiple strokes, shadows, blur/backdrop blur, image crop/focal point/rotation/flip and overflow controls.
- Direct vector anchors and Bezier handles, multi-contour geometry, union/subtract/intersect/exclude operations, clip masks and alpha masks.
- Prototype graph with ordered actions, conditions, navigation/overlay/back/scroll actions, variables, smart animate and authored easing.
- Timeline tracks and keyframes for position, opacity, scale, rotation and blur, including create/update/delete/undo and scroll bindings with start/end/pin/parallax.
- Present runtime that groups route sections into long pages, resolves button destinations, scroll targets, overlays, variables, timeline effects and deterministic traces.
- One shared semantic document for user and agent authoring. User transactions and bounded MCP commands converge on the same revisioned session service; agent tools do not need synthetic canvas clicks.
- Persistent immutable Team Preview packages, authenticated feedback, remote test execution and public participant IDs separated from bearer secrets.

## Release checks

| Gate                            | Result                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VIU renderer tests              | 39 files, 309 tests passed                                                                                                                              |
| Team Preview tests              | 10 files, 103 tests passed                                                                                                                              |
| Combined focused suite          | 49 files, 412 tests passed                                                                                                                              |
| VIU renderer line coverage      | 80.09% (1,493 / 1,864)                                                                                                                                  |
| Team Preview line coverage      | 86.16% (816 / 947)                                                                                                                                      |
| Team Preview statement coverage | 80.29% (880 / 1,096)                                                                                                                                    |
| TypeScript                      | `bunx tsc --noEmit --pretty false` passed                                                                                                               |
| i18n types                      | generated declarations are in sync                                                                                                                      |
| i18n validation                 | passed for the configured nine-locale structure; repository-wide warning-only translation debt remains outside VIU                                      |
| Scoped lint                     | 0 errors; warning-only optimization findings remain                                                                                                     |
| Security                        | bearer-only authenticated reads, query-token rejection, capability-bound peers, bounded payload/rate limits and opaque local preview references covered |
| Performance                     | 10,000-node validation + compilation remained below the 10-second release budget (observed about 645 ms); 4 benchmark gates passed                      |

Coverage reports are written locally under:

- `.aionrs/viu-renderer-coverage-release/`
- `.aionrs/team-preview-coverage-final/`

## User path versus agent path

| Concern   | User                                                    | Agent                                            | Evidence                                                              |
| --------- | ------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| Inspect   | Canvas/Inspector loads `ViuProjectState` over typed IPC | `viu_inspect` and semantic query                 | Same workspace-keyed V2 session                                       |
| Propose   | Immediate local visual transaction                      | bounded preview transaction                      | Preview does not advance authoritative revision                       |
| Commit    | serialized optimistic commit queue                      | commit MCP command                               | Same command interpreter and revision checks                          |
| Motion    | timeline/keyframe and prototype inspectors              | bounded motion/timeline tools                    | Same schema, compiler and deterministic runtime                       |
| Verify    | Present mode and diagnostics                            | validation/runtime scenario tools                | Same compiler, reachability validation and traces                     |
| Team test | publish/copy local test reference                       | open immutable package and append agent feedback | Same package/snapshot IDs; public identity never exposes bearer token |

The distinct agent surface is intentional and evidenced by the typed MCP/IPC contracts: it manipulates the same document model directly instead of imitating user clicks.

## Honest boundary

The release gate certifies the locked V1 editor/runtime/Team Preview contract. It does **not** certify every feature in Figma, pixel-perfect import of arbitrary websites, production code-export equivalence, multiplayer cursor presence, or a full WebGL material/camera editor. Those require separate benchmark artifacts and comparison gates; they must not be represented as already proven by these tests.
