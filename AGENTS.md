# TomniHubOS Agent Rules

These rules apply to every human or AI contributor in this repository.

## 1. Product priority

Optimize work in this order:

1. Make the **Hub Agent OS** run lifecycle coherent and production-safe.
2. Complete **Trust and User Intelligence**: permissions, secret handling, egress control, audit, private context, preferences, and user control.
3. Make local and cloud AI adapters provider-neutral and governed by the same contracts.
4. Make the Store/package boundary real and remove optional applications from the base bundle.
5. Improve optional packages only when doing so advances one of the first four goals.

IDE, Browser, Studio, Office, media, monitoring, testing studios, and similar domain surfaces are downloadable packages. Do not add their implementation to the base application. Studio is a package group or compatibility redirect, not a required base module.

## 2. Sources of truth

Read [docs/README.md](docs/README.md) and the relevant canonical document before changing a subsystem.

Use these labels in design and status work:

- **CURRENT** - demonstrated by a reachable code path or test.
- **PARTIAL** - implemented in some paths but not universal or release-proven.
- **TARGET** - intended architecture, not yet proven.
- **BLOCKED** - cannot proceed until a named dependency or decision is resolved.

Code is evidence for current behavior. Canonical documents define intended boundaries. If they conflict, report the conflict and update the document or implementation in the same change; never silently choose one.

Do not create competing plans, session logs, memory files, duplicate READMEs, or new rule systems. Update the canonical document that owns the topic. Generated reports must live in an explicitly generated output directory and must not become normative documentation.

## 3. Required working method

Before reading large files:

```sh
mtui --json map intent "<task>"
mtui --json map folder <path>
```

Use MTUI context or compass operations to narrow the source set. Every repository file creation, edit, patch, rename, or deletion must go through an MTUI write command. Review the MTUI diff before handoff. Do not bypass MTUI with shell redirection or ad-hoc scripts.

Preserve unrelated work in a dirty worktree. Inspect git status before and after work. Never rewrite or delete user changes outside the assigned scope.

## 4. Architecture invariants

- Electron main code lives under packages/desktop/src/process and must not use DOM APIs.
- Renderer code lives under packages/desktop/src/renderer and must not use Node.js APIs.
- Preload is the only renderer-to-main bridge. IPC requires an explicit schema, sender validation, least privilege, bounded payloads, and stable error semantics.
- The Hub owns orchestration policy; adapters own provider or transport details.
- A package may depend on published core contracts. Core code must not import a package implementation.
- Security checks must sit on the shared execution seam. A check used by only one UI or adapter is not a platform guarantee.
- Secret values must remain in the main process or an approved isolated runtime. Renderer and model context receive opaque handles or redacted representations.
- User understanding is not authorization. Learned context can inform a proposal but cannot grant a capability or bypass consent.
- Every governed run must produce durable state transitions, evidence, resource usage, and a terminal receipt.

See [docs/architecture/target.md](docs/architecture/target.md).

## 5. Source conventions

- TypeScript remains strict. Do not add any, implicit returns, or unchecked external data.
- Prefer type aliases over interfaces unless declaration merging is required.
- Components use PascalCase; utilities and type files use camelCase; hooks start with use; constants use UPPER_SNAKE_CASE inside camelCase files.
- Prefix intentionally unused parameters with an underscore.
- Use existing path aliases instead of deep relative imports.
- Public contracts and non-obvious security behavior require concise English JSDoc or comments.
- Do not increase a source directory beyond ten direct children. Split new code by responsibility before that point; do not perform unrelated restructuring solely to repair legacy directories.

For renderer work:

- Use Arco Design components for interactive controls and Icon Park for icons.
- Use UnoCSS semantic tokens or CSS variables; do not hardcode theme colors.
- Put global styles only in the renderer styles area and isolate complex component styles in CSS Modules.
- Route every user-visible string through the configured i18n system.

See [docs/engineering/conventions.md](docs/engineering/conventions.md).

## 6. Security and package rules

Treat provider responses, CLI output, package manifests, archives, web content, model output, and IPC payloads as untrusted input.

A new execution path is incomplete until it defines:

- identity and origin;
- requested capabilities;
- permission and approval behavior;
- secret exposure boundary;
- outbound destination policy;
- cancellation, timeout, and resource limits;
- audit and recovery evidence.

Never weaken signature, path traversal, archive size, SSRF, sandbox, or permission checks to make an integration pass. Trusted-react package execution is privileged and must not be the default for third-party packages.

## 7. Verification

Run the smallest relevant tests while iterating, then the applicable repository gates:

```sh
bun run lint
bun run format:check
bunx tsc --noEmit
bun run test
```

Changes to renderer text or i18n configuration also require:

```sh
bun run i18n:types
node scripts/check-i18n.js
```

Security, IPC, package, database, and run-lifecycle changes require contract or integration tests, not only unit tests. Package extraction also requires a clean-machine absence/install/uninstall proof. See [docs/engineering/testing-and-release.md](docs/engineering/testing-and-release.md).

## 8. Multi-agent execution

For work spanning independent domains, follow the [autonomous multi-agent master plan](docs/execution/mvp-plan.md):

- one integrator owns shared contracts and final merge;
- each subagent receives an explicit file allowlist, acceptance evidence, and no-overlap rule;
- parallelize independent adapters, tests, and package migrations;
- serialize shared contract, bootstrap, IPC, and schema changes;
- subagents do not commit unless the integrator explicitly delegates commit ownership;
- handoffs include changed files, tests run, remaining risks, and observed conflicts.

## 9. Git and review

Use English Conventional Commits:

```text
<type>(<scope>): <subject>
```

Allowed common types are feat, fix, refactor, chore, docs, test, style, and perf. Never add AI attribution or generated-by signatures.

Before pushing, use just push so lint, formatting, type checking, tests, and the push run as one gated workflow. Do not claim completion from log volume; use command exit codes and concrete evidence.
