# Viu architecture

## Native Tomny boundaries

```text
StudioPage
├── StudioDashboard → Open Viu
└── IdeWorkspace
    ├── Viu activity item
    └── ViuPanel (renderer only)
        ├── source controls
        ├── flat z-ordered layer list
        ├── scaled visual artboard
        └── property inspector
                 │ typed providers
                 ▼
Process bridge: ide.viu.*
├── create          model-free layout template + unique snapshot identity
├── capture         isolated browser evidence
├── analyze-image   visual artifact + depth evidence
└── persist         immutable contract + agent handoff
```

The renderer never imports Node APIs at runtime. File decoding, hashing, filesystem persistence, browser capture, and image analysis stay in the Electron process.

## Contract model

`ViuProject` owns one or more `ViuDocument` values. A document contains:

- viewport and full-page dimensions;
- a flat, parent-addressable layer graph;
- per-layer rectangle, z-index, visible/locked state, visual style, content, source trace, and fidelity metadata;
- design tokens;
- interaction and motion bindings;
- limitations that follow the design into code handoff.

The persisted project excludes the in-memory screenshot data URL, is serialized with recursively sorted object keys, and is content-addressed by SHA-256. Existing contract files are never overwritten. This makes the agent handoff reproducible and reviewable.

## Capture path

URL capture creates one hidden, background browser tab in the `viu-capture` partition. Pages are navigated sequentially because they share the same isolated tab. The scanner:

1. validates HTTP/HTTPS input and removes embedded credentials/fragments;
2. waits for page load and fonts, then disables animation and transitions for a settled checkpoint;
3. walks visible DOM and open Shadow DOM nodes up to a bounded count;
4. extracts geometry, a safe computed-style subset, z-index, direct text, safe attributes, same-origin links, and runtime boundaries;
5. captures one bounded viewport screenshot per page, accepts the first navigation's final redirect origin, and queues up to five links on that final origin;
6. destroys the hidden tab in a `finally` block.

Cross-origin frames, protected media, closed Shadow DOM, shaders, and Canvas/WebGL internals remain runtime or raster boundaries until a dedicated runtime adapter can inspect them safely. Image/video asset URLs remain remote references; immutable asset download, sanitization, hashing, and packaging are future work.

## Image path

Tomny’s visual-artifact analyzer supplies dimensions, colors, coarse geometric regions, and provenance. It does not currently provide OCR or object detection. Viu adds a bounded 6×6 luminance-contrast analysis and exposes the sixteen highest-contrast tiles as editable z-order hints. This is not occlusion or hidden-depth recovery, so confidence is capped below `0.8` and the limitation is stored in the document.

## Agent handoff

**Start coding** is the current implicit approval action. It writes the snapshot inside the selected repository and emits `ide.hook.askAgent`; there is no separate accepted-revision state yet. Editor screenshots are intentionally stripped from this contract. The handoff tells the agent to:

- read and verify the exact contract digest;
- inspect the target repository before choosing integration points;
- preserve its architecture and design system where compatible;
- implement layout, z-order, states, motion, interactions, and runtime fallbacks;
- preserve a node trace map;
- run the target and compare required viewports;
- report evidence gaps rather than hiding them.
