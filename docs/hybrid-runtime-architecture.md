# ADR: Hybrid TypeScript and Rust Tomny Core

Status: accepted, 2026-07-17.

## Decision

Tomny Core uses TypeScript as the policy/orchestration kernel and a separately packaged Rust sidecar for bounded, durable, CPU-sensitive and process-supervision work. The sidecar is not an Electron native addon: Electron Main owns it as a child process so crashes and upgrades remain isolated.

The transport is newline-delimited JSON with the versioned protocol `tomny.runtime.v1`. Every connection must complete `core.initialize`. Unknown versions fail closed. Requests are correlated by ID and support timeout, cancellation and bounded frames.

## Ownership

TypeScript owns adapters, Team/Company orchestration, surfaces, permissions, context, plugins, UI projection and the authoritative event store.

Rust v1 owns health/lifecycle, SHA-256 hashing, bounded child-process supervision and a durable mirrored event journal. Rust journal failure never blocks the authoritative TypeScript journal. TypeScript fallback is explicit and configurable; it never hides a Rust business error.

## Packaging and security

The binary is built from `packages/tomny-runtime` for Windows, macOS and Linux on x64/ARM64, staged under `bundled-tomny-runtime/<platform>-<arch>`, and verified against its SHA-256 manifest after packaging. `TOMNY_RUST_SIDECAR_PATH` is a fail-closed development/operations override.

The sidecar accepts no network listener in v1. Electron Main remains the trust and permission boundary. Process count, arguments, environment size, runtime and journal frames are bounded.

## Migration rule

Move a workload to Rust only when measurement or reliability requirements justify it and a versioned contract plus failure-path tests exist. Keep frequently changing product policy in TypeScript. Prefer adding Rust services behind the sidecar protocol over N-API; use N-API only for proven latency-critical leaf functions.

## Acceptance

A change is complete only when Rust unit tests and Clippy pass, the real binary passes malformed-input and crash-isolation E2E tests, Electron packaging verifies the manifest, and the full TypeScript typecheck remains clean.
