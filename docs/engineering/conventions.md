# Engineering conventions

These conventions support the product and architecture rules in [AGENTS.md](../../AGENTS.md). They do not override them.

## Repository operations

Map code before loading broad areas:

```sh
mtui --json map intent "<task>"
mtui --json map folder <path>
```

`map`, `context`, `summary`, and `info` read the Understand cache. **CURRENT:** `mtui understand build` creates it offline without the IDE (`packages/mtui/src/understand/build.rs`; tests in `packages/mtui/tests/understand_build.rs`); `mtui understand status` reports whether a rebuild is needed. It preserves semantic summaries of unchanged files written by another builder. The IDE tool wiring runs the build automatically when the cache is missing (`packages/desktop/src/process/resources/nativeFile/mtuiUnderstand.ts`). **PARTIAL:** import edges are resolved for TypeScript/JavaScript (relative paths and `tsconfig.json` aliases), Rust modules, and Python; other languages get symbols and layers but no edges. **CURRENT:** the build classifies the folder as `code` or `docs` (documents and tables are at least 60% of indexed files; recorded as `kind` in the cache). Document folders also index `.txt`, `.csv`/`.tsv`, `.rst`, and `.adoc`, summarize each file from its title, first paragraph, headings, and word count (tables from their header and row count), expose headings and columns as searchable symbols, and turn local Markdown links and `[[wikilinks]]` into graph edges (`packages/mtui/src/understand/docs.rs`, tests in `packages/mtui/tests/understand_docs.rs`). In code projects those extra extensions stay unindexed. **TARGET:** `.docx`/`.pdf` text extraction and optional model-written summaries; binary documents are skipped today.

Use MTUI for every repository write and inspect its diff before handoff. Keep unrelated dirty files untouched.

Do not add duplicate guides, plans, session logs, memory notes, or subsystem READMEs. Update the owner listed in [the documentation index](../README.md).

## Execution ownership

Broad MVP work follows the [C0-C6 master plan](../execution/mvp-plan.md). With four total slots, the Integrator retains shared contracts and integration while three subagents receive bounded, non-overlapping acceptance atoms; one subagent advances or independently verifies the Store/package track until its gate passes. A waiting lane takes another approved ready or verification atom instead of editing shared files.

Each assignment records an exact allowlist, forbidden shared files, starting revision, acceptance command, migration/rollback/kill behavior when applicable, and handoff evidence. App bootstrap, preload and IPC registration, shared schemas and migrations, generated registries, base routing, and canonical status remain Integrator-owned.

Do not reproduce the checkpoint schedule in subsystem documentation. Link the master plan and report current-revision evidence for the affected checkpoint and candidate gate.

## File and module structure

- A new source directory must not exceed ten direct children.
- Split by responsibility before the limit; do not create generic misc, helpers, common, or utils dumping grounds.
- One module should have one reason to change.
- Keep public contracts near their owning core and implementations behind adapters.
- Prefer an index file only for a deliberate public surface, not automatic barrel exports.
- Do not perform unrelated tree restructuring to repair legacy layout during a focused change.

### Process ownership

| Area                     | Path                          | Allowed dependencies                                           |
| ------------------------ | ----------------------------- | -------------------------------------------------------------- |
| Electron main            | packages/desktop/src/process  | Node.js, Electron main APIs, core services; no DOM             |
| Preload                  | packages/desktop/src/preload  | schema-validated narrow bridge only                            |
| Renderer                 | packages/desktop/src/renderer | browser APIs and exposed preload contract; no Node.js          |
| Shared desktop contracts | packages/desktop/src/common   | platform-neutral types and validation; no Electron runtime     |
| Optional application     | package-owned source/artifact | core contracts and package SDK; no private core implementation |

A renderer type import from a main-process implementation path is a coupling smell even when erased at build time. Move shared contract types into the common contract surface.

## TypeScript

- Strict mode remains enabled.
- Do not add any, unchecked casts at trust boundaries, implicit returns, or non-null assertions without a demonstrated invariant.
- Prefer type aliases. Use interface only for declaration merging or a documented extensibility reason.
- Parse external input with runtime schemas before using it as a domain type.
- Model finite state with discriminated unions.
- Represent identifiers and versions explicitly; avoid unstructured string bags in public contracts.
- Public functions and security-sensitive behavior receive concise English JSDoc.
- Prefix intentionally unused parameters with an underscore.

Naming:

- React components: PascalCase.
- Hooks: camelCase beginning with use.
- Utilities, type modules, and constants modules: camelCase filenames.
- Constant values: UPPER_SNAKE_CASE.
- Tests: colocated or in the owning test area with a descriptive test suffix.

Use configured aliases such as @, @process, and @renderer rather than deep relative traversal.

## Errors and async lifecycle

Public boundaries return stable error codes and safe metadata. Provider messages, CLI output, paths, secrets, and raw payloads are not safe error text.

Every asynchronous operation defines:

- ownership;
- timeout;
- cancellation;
- terminal states;
- cleanup;
- resource and capability leases;
- retry and idempotency behavior;
- restart behavior where state is durable.

Do not leave background promises, child processes, event listeners, sockets, timers, or leases without a disposal owner.

## IPC and external input

Each IPC method defines:

- request and response schema;
- allowed sender, frame, and origin;
- payload and result size;
- timeout and cancellation;
- capability requirement;
- stable errors;
- audit behavior.

Avoid generic invoke wrappers that lose native sender metadata. Never trust renderer-provided package identity, filesystem ownership, or approval state.

The same validation standard applies to HTTP, WebSocket, remote relay, MCP, package messages, manifests, provider data, CLI protocol, archives, and database migrations.

## Persistence

- Main process owns private databases and secret material.
- Schema changes include forward migration, rollback or compatibility behavior, corrupted-data handling, and fixtures.
- Durable run events are append-only or tamper-evident enough for replay.
- Persisted timestamps, IDs, enum values, and versions have stable formats.
- Do not couple base context or recovery to an optional package database.
- Tests use isolated temporary data and prove restart behavior for critical state.
- Workspace metadata migrations use `.tomni` as the active root. Legacy-root migration validates paths without following symlinks, preserves conflict/recovery evidence, and must run before an owner reads or writes canonical workspace metadata; it must not become a runtime fallback.
- Renderer workspace references are untrusted relative descriptors. Main resolves containment and actual kind before persistence; projected file content or Understanding summaries are bounded and delimited as untrusted prompt data.

## Renderer

Renderer styling follows [docs/product/tomni-design-system.md](../product/tomni-design-system.md): the single global stylesheet `packages/desktop/src/renderer/styles/tomni-ui.css`, derived from `mockup/home-wireframe-v3.html`. Layout and page markup carry no CSS of their own.

Keep accessibility semantics, keyboard operation, focus, reduced motion, loading, empty, denied, offline, error, and recovery states.

## Internationalization

Every user-visible string uses an i18n key. Languages and modules are defined by packages/desktop/src/common/config/i18n-config.json.

When changing user-visible text or i18n configuration:

```sh
bun run i18n:types
node scripts/check-i18n.js
```

Package-owned translations ship with the package and register through the package contribution contract. Base translations must not contain an optional application's full locale payload.

## Security and privacy

- Treat model output, web content, provider data, package code, CLI output, and renderer input as untrusted.
- Raw secrets stay out of renderer state, prompts, logs, evidence, tests, and telemetry.
- Use opaque handles and resolve them at the final trusted seam.
- Do not bypass signature, path, archive, origin, destination, sandbox, permission, or egress checks.
- Learned user context does not grant permission.
- Store only the data necessary for a declared purpose and provide correction, export, retention, and deletion behavior.

## Tests and generated artifacts

Behavioral changes include tests. Bug fixes include a regression test that fails for the original cause.

Generated code, reports, catalogs, fixtures, and artifacts identify their generator and source revision. Do not hand-edit generated output unless its generator workflow explicitly requires it. Generated reports are evidence, never contributor rules.

See [testing and release](testing-and-release.md) for the complete gate.
