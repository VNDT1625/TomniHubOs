# Engineering conventions

These conventions support the product and architecture rules in [AGENTS.md](../../AGENTS.md). They do not override them.

## Repository operations

Map code before loading broad areas:

```sh
mtui --json map intent "<task>"
mtui --json map folder <path>
```

Use MTUI for every repository write and inspect its diff before handoff. Keep unrelated dirty files untouched.

Do not add duplicate guides, plans, session logs, memory notes, or subsystem READMEs. Update the owner listed in [the documentation index](../README.md).

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
- CSS Modules: ComponentName.module.css or an established kebab-case stylesheet.
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

## Renderer and design system

Use:

- Arco Design for interactive controls;
- Icon Park for icons;
- UnoCSS semantic tokens for layout and standard styling;
- CSS Modules for complex component-local styling;
- CSS variables and existing semantic theme tokens for color.

Do not use raw interactive HTML when an Arco control exists. Do not introduce Tailwind, shadcn, another component system, hardcoded theme colors, or component-scoped global CSS.

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
