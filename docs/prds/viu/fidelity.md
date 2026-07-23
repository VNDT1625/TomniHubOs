# Viu fidelity policy

## What “over 90% similar” means

A percentage is valid only for a declared benchmark profile, not for “every website in the world.” A profile fixes:

- browser engine and version;
- viewport, device scale factor, fonts, locale, timezone, and reduced-motion preference;
- page state, authenticated data fixture, and network fixture;
- scroll position and animation/timeline checkpoint;
- reference and reconstructed screenshots;
- metric weights and masks for nondeterministic regions.

Recommended score:

```text
overall = 0.45 × perceptual pixels
        + 0.25 × geometry
        + 0.15 × typography
        + 0.10 × effects and stacking
        + 0.05 × interaction checkpoint parity
```

The score must be reported per viewport and checkpoint together with median/p95 geometry error, changed-pixel ratio, runtime boundaries, and low-confidence regions. A raster overlay can look nearly exact while being structurally uneditable; therefore visual score and editable-depth score must remain separate.

## Expected ceilings by input

| Input                          | Current foundation                                                                                                                                                          | With complete comparator/correction/runtime roadmap                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Simple HTML/CSS page           | Bounded visible DOM/open-Shadow-DOM geometry and computed-style extraction at one viewport; no scored comparator or automatic pixel correction yet                          | A controlled `≥97%` target is reasonable for deterministic fixtures                                                                                         |
| Large multi-page site          | Bounded scan of up to five same-origin pages; one settled state per page                                                                                                    | `>90%` is feasible only for an explicit page/state/viewport corpus with authenticated and dynamic states supplied                                           |
| One complex landing-page image | Original raster shown in the editor plus coarse geometric regions and luminance-contrast z hints; there is no measured similarity score and hidden layers remain unknowable | `>90%` screenshot similarity is feasible, but native editability depends on additional images, assets, depth/motion metadata, or human/agent reconstruction |
| 3D/scrollytelling runtime      | A `canvas` element is recorded only as an `unknown` runtime boundary; 3D internals and scrollytelling behavior are not detected                                             | High checkpoint parity requires original assets/runtime preservation or dedicated GLTF/WebGL/scroll adapters and temporal comparison                        |

## Hard limits

No backend can recover information that is absent or deliberately inaccessible: hidden geometry behind a single raster, server-only logic, closed Shadow DOM, DRM/protected media, private assets, undisclosed breakpoints, or animation states never observed. Viu must preserve the source as a runtime/raster boundary or request more evidence; it must never convert uncertainty into a false “100% reconstructed” claim.

All percentages in this document are future release targets until the native AIonUI comparator produces reproducible reports. Historical Prewise benchmark output is not accepted as native AIonUI evidence.

## Release gates

The universal goal is pursued through expanding benchmark coverage, not through an unconditional marketing number. A release may claim a fidelity tier only when:

1. deterministic fixtures and real-world licensed fixtures pass the same reproducible harness;
2. desktop, tablet, and mobile profiles pass;
3. required state and timeline checkpoints pass;
4. every subtree exposes strategy, confidence, and editability;
5. regressions fail CI;
6. performance budgets and sandbox/security gates pass.
