# Contributing to TomniHubOS

TomniHubOS is converging on a small trusted base and independently installable capability packages. Contributions should reduce ambiguity, duplicate execution paths, or base coupling.

## Before starting

1. Read [AGENTS.md](AGENTS.md).
2. Read the relevant entry in [docs/README.md](docs/README.md).
3. Map the affected code with MTUI and verify current behavior in source and tests.
4. Check git status and preserve unrelated changes.
5. Define the smallest vertical outcome and its acceptance evidence.

Requirements are Node.js 22 through 24, Bun, Git, and the native build prerequisites for your platform.

```sh
bun install
bun run start
```

## Choosing scope

Prefer acceptance-sized work that advances the active C0-C6 checkpoint in one of three parallel MVP tracks:

- a governed Hub Agent OS run from request to receipt;
- Trust and User Intelligence with causal, explicit user control;
- the Store/package ecosystem, including a clean base and independently installable capabilities.

Managed AI and managed cloud are independently gated usage capabilities. They must not block safe local, BYOK, supported CLI, MCP, user-owned cloud, or Store work. Optional applications must change within their package boundary, not expand inside the base.

For broad tasks, follow the [multi-agent master plan](docs/execution/mvp-plan.md). With four total slots, the Integrator owns shared contracts and final integration while three subagents receive exact non-overlapping allowlists; at least one subagent advances or verifies Store/package work until that gate passes. Bootstrap, preload/IPC registration, shared schemas and migrations, generated registries, and canonical status have one Integrator owner at a time.

## Making changes

All repository writes go through MTUI. Keep changes focused and preserve existing public contracts unless the task explicitly migrates them.

A change is expected to include:

- implementation and tests in the same scope;
- validation at every trust boundary;
- documentation updates when status, architecture, or a public contract changes;
- migration and rollback behavior for persisted data;
- cancellation and terminal-state behavior for asynchronous work;
- no new imports from base core into an optional package implementation.

User-visible text must use i18n. Renderer controls use Arco Design, Icon Park, and semantic UnoCSS or CSS-variable tokens.

## Verification

Run targeted tests first, then the gates relevant to the change.

```sh
bun run lint
bun run format:check
bunx tsc --noEmit
bun run test
```

For i18n-sensitive changes:

```sh
bun run i18n:types
node scripts/check-i18n.js
```

Use contract and integration tests for security, IPC, adapters, packages, persistence, or the run lifecycle. Follow [docs/engineering/testing-and-release.md](docs/engineering/testing-and-release.md) for release evidence.

Evidence reports name the C0-C6 checkpoint, track, current revision, commands and exit codes, passing/total acceptance atoms, blockers, and feature-switch state. Report Core plus Store readiness separately from Full managed-usage readiness; an average percentage cannot hide the least-complete critical track.

## Commits and pull requests

Commit messages use English Conventional Commits:

```text
feat(agent-runtime): unify governed run lifecycle
fix(security): reject unregistered egress destination
docs(architecture): record package boundary evidence
```

Keep refactors separate from behavioral changes when practical. Do not include AI signatures.

A pull request must explain:

- user or platform outcome and owning canonical document;
- C0-C6 checkpoint, track, and whether it affects the Core plus Store or Full managed-usage gate;
- affected trust, process, package, commerce, and billing boundaries;
- tests, commands, exit codes, and current-revision evidence;
- migration, rollback, kill-switch, and recovery implications;
- known gaps, using the canonical status labels.

Use just push instead of direct git push. The command runs the project gates before pushing.

## Documentation policy

Do not add standalone plans, session notes, duplicate guides, or subsystem READMEs. Update the owning canonical document listed in [docs/README.md](docs/README.md). Generated evidence belongs in generated output and must identify its source revision and command.
