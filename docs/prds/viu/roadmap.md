# Viu delivery roadmap

The native foundation is intentionally smaller than the full product ambition. The authoritative V2 direction and usable-first milestones are defined in the [VIU master product and engineering plan](./master-plan.md); this file remains a compact view of completed foundation work and major tracks.

## Completed — native foundation

- `V0.1`: Studio and IDE Studio entry points, rootless opening, activity mode.
- `V0.2`: typed project/document/layer/fidelity contract.
- `V0.3`: prompt, same-origin URL, and image ingestion.
- `V0.4`: visual artboard, layers, property inspector, drag editing, reference overlay.
- `V0.5`: prompt improvement with evidence and deterministic fallback.
- `V0.6`: immutable content-addressed coding-agent handoff.
- `V0.7`: nine-locale UI, type-check, lint, unit and dashboard DOM tests.

## Next task graph

| Track           | Tasks                                                                                                                                             | Gate                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Scene/editor    | resize handles, constraints, grouping, component variants, undo/redo operation log, responsive breakpoint editor                                  | deterministic edit/replay tests and 60 FPS common canvas budget             |
| Capture         | accessibility tree, pseudo-elements, CSS variables, fonts/assets, stacking-context graph, scroll/state checkpoints, authenticated fixture support | source trace coverage and bounded resource use                              |
| Fidelity        | render harness, pixel/perceptual/geometry/typography metrics, node-to-diff attribution, local correction loop                                     | reproducible score report per viewport/state                                |
| Motion/workflow | state graph, interaction graph, timeline, scroll pin/scrub/parallax authoring and replay                                                          | deterministic checkpoint playback                                           |
| Runtime/3D      | sandboxed runtime capsule, Canvas recordings, GLTF/GLB scene adapter, camera/light/material inspector, WebGL/WebGPU fallback policy               | temporal visual parity plus CPU/GPU budgets                                 |
| Code delivery   | framework adapters, asset export, node trace map, generated tests, post-code visual compare and bounded repair loop                               | implementation matches approved contract without overwriting unrelated code |
| Platform        | worker pool, cache by content hash, dirty-region rendering, virtualized layers/pages, cancellation and observability                              | cold-open, interaction, memory, and scan-time budgets                       |
| Security        | URL policy, private-network policy, asset sanitization, CSP, runtime capability grants, archive/model limits                                      | adversarial capture/runtime suite                                           |

## Suggested subagent ownership

- **Orchestrator/architect:** schema evolution, ADRs, integration gates, merge order.
- **Scene/editor agent:** canvas, constraints, inspector, responsive variants, operation log.
- **Capture/reconstruction agent:** browser evidence, segmentation, layout inference, source mapping.
- **Fidelity agent:** benchmark corpus, metrics, diff attribution, correction optimizer.
- **Motion/workflow agent:** states, events, timelines, scrollytelling replay.
- **Runtime/3D agent:** sandbox capsule, Canvas/WebGL/WebGPU, GLTF and shader adapters.
- **Performance/security agent:** profiling, caching/workers, budgets, isolation and abuse tests.

Each subagent should own a bounded module and its tests. Contract changes are serialized through the architect; independent adapters and benchmark fixtures can run in parallel. A subagent does not automatically share hidden state with another one: it receives the task context, works in the shared repository, and reports results to the orchestrator, which reviews and integrates the changes.

## Model allocation

Use the highest-reasoning GPT-5.6 Sol tier for schema/architecture decisions, reconstruction algorithms, security boundaries, difficult debugging, and final integration reviews. Use GPT-5.6 Sol high for capture, fidelity, runtime/3D, and complex editor tracks. Use the balanced GPT-5.6 tier for localized UI, fixtures, repetitive adapters, docs, and targeted tests. More subagents are useful only when ownership boundaries are independent; parallel edits to the same schema or central workspace component create more review cost than speed.
