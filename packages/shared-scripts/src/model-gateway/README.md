# Tomni model-gateway overlay

Tomni pins the MIT-licensed 9Router engine and applies this deterministic overlay before building it. The overlay owns Tomni-specific behavior that upstream does not provide: per-CLI/session usage attribution and token-measurement provenance.

Exact source matches intentionally make preparation fail after an incompatible upstream update. Update the pinned commit and overlay together, then rerun the focused gateway tests before publishing a bundle.
