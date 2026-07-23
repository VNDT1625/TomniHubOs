# Viu — Visual UI workspace

Status: VIU V1 authoring and Team Preview release gate passed on 2026-07-23; complete Figma parity is not claimed.

Viu (pronounced like “view”) is an additional UI/UX workspace inside Studio and IDE Studio. It does not replace the editor, terminal, browser preview, or agent chat. It gives people and agents a shared visual contract before implementation begins.

## Product direction

The implemented V1 surface is canvas-first and agent-native: user and agent edit the same semantic, runnable visual document; local assets are linked without upload; prototype behavior, timelines, scroll bindings and long-page presentation run before production code exists. The current release evidence is recorded in [VIU V1 release evidence](./release-evidence-2026-07-23.md).

The longer-term product specification remains in the [VIU master product and engineering plan](./master-plan.md). Target-only sections in that document are not release claims.

The measurable Figma comparison now uses a strict 9+ quality floor: every core pillar must independently reach at least 9/10, with no weighted compensation. The target workspace, command architecture, 12 benchmark artifacts, design-first gate, and release certification live in [VIU — 9+ Figma-core parity design](./figma-8-design.md).

## Entry points

- IDE Studio activity rail: **Viu · Visual UI**.
- Viu can open standalone or against the current repository workspace.
- Design, Prototype and Present operate on the same revisioned VIU document. Team Preview publishes an immutable local package for user or agent testing; it does not generate application code automatically.

## Core workflow

```text
User or agent intent
        ↓
Shared revisioned VIU document
        ↓
Design canvas + typed Inspector
        ↓
Prototype graph + timeline + scroll bindings
        ↓
Deterministic Present runtime and diagnostics
        ↓
Immutable Team Preview package for user/agent testing
        ↓
Approved document can be handed to an implementation agent
```

The primary modes are:

- **Design**: author structure, layout, typography, vectors, effects, components, tokens and local assets.
- **Prototype**: connect screens and scroll sections, order actions and conditions, and author timeline/keyframe motion.
- **Present**: run the connected site-like experience before production code exists.
- **Team Preview**: publish an immutable test package and collect feedback with authenticated user/agent identity.

## Implemented V1 scope

- Native Electron renderer/process separation with typed IPC; no Prewise/FastAPI runtime dependency.
- Revisioned document engine with atomic commands, inverse commands, validation, diagnostics and deterministic runtime traces.
- Canvas, layers, rich Inspector, vectors/boolean operations/masks, responsive variants, components, tokens and local assets.
- Ordered prototype actions and conditions, long-page routes, overlays, variables, timelines, keyframes, smart animate and scroll-linked motion.
- Bounded agent MCP surface over the same session/command engine used by the visual editor.
- Persistent immutable Team Preview packages, feedback and remote-run surfaces with bearer authentication and capability checks.
- Nine-locale VIU UI keys, focused performance/security gates and the release checks linked above.

## Fidelity contract

Every layer records:

- reconstruction strategy: `native`, `preserved`, `runtime`, or `raster`;
- confidence from `0` to `1`;
- editable depth: full, properties, or surface;
- source URL/selector/image path and original geometry where observed;
- explicit notes when geometry, behavior, or hidden depth cannot be proven.

Viu treats browser measurements and visual evidence as the source of truth. A model may improve semantics and design direction, but it must not invent measured geometry. See [fidelity.md](./fidelity.md) for acceptance rules and [roadmap.md](./roadmap.md) for the work required beyond the current foundation.

The former Prewise M0–M12 implementation, API/codegen/MCP tools, reports, and benchmark outputs were removed from Prewise during this migration. Their evidence does not certify the native AIonUI implementation; AIonUI needs its own comparator and benchmark gates.
