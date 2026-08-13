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

Prefer changes that advance one of the two MVP cores:

- a governed Hub Agent OS run from request to receipt;
- trust and user intelligence with explicit user control.

Local/cloud adapters and package extraction are supporting platform work when they unlock those cores. Optional applications must be changed in their package boundary, not expanded inside the base.

For broad tasks, split work according to the multi-agent protocol in [docs/execution/mvp-plan.md](docs/execution/mvp-plan.md). Shared contracts, IPC registration, bootstrap wiring, and database migrations have one owner at a time.

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

## Commits and pull requests

Commit messages use English Conventional Commits:

```text
feat(agent-runtime): unify governed run lifecycle
fix(security): reject unregistered egress destination
docs(architecture): record package boundary evidence
```

Keep refactors separate from behavioral changes when practical. Do not include AI signatures.

A pull request must explain:

- user or platform outcome;
- affected trust and process boundaries;
- tests and evidence;
- migration or rollback implications;
- known gaps, using the canonical status labels.

Use just push instead of direct git push. The command runs the project gates before pushing.

## Documentation policy

Do not add standalone plans, session notes, duplicate guides, or subsystem READMEs. Update the owning canonical document listed in [docs/README.md](docs/README.md). Generated evidence belongs in generated output and must identify its source revision and command.
