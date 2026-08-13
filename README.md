# TomniHubOS

TomniHubOS is a desktop-first Agent OS for running useful AI work across local models, cloud providers, command-line agents, tools, and downloadable capability packages.

The product is being rebuilt around two cores:

1. **Hub Agent OS** - one governed run lifecycle that can plan, delegate, execute, verify, and recover across provider APIs, local runtimes, CLIs, MCP tools, and package capabilities.
2. **Trust and User Intelligence** - security, permissions, secrets, audit, private user context, preferences, and outcome learning that remain under user control.

IDE, Browser, Studio, Office, media, and other domain applications are not target base features. Their extraction into independently installable packages is PARTIAL: package infrastructure exists, but current source and artifacts are not yet proven physically separated. Studio is a grouping and compatibility concept, not a required monolithic package.

## Project status

TomniHubOS is pre-MVP. The repository contains substantial desktop, runtime, package, resource, and security implementations, but several paths are parallel or only partially integrated. In particular, the current Foundation Run Kernel is not yet the single production run path, outbound security is not universal, user understanding is split between a durable context store and a placeholder preference map, and optional applications are not yet proven absent from the base bundle.

Canonical documents distinguish **CURRENT**, **PARTIAL**, **TARGET**, and **BLOCKED** statements. A target design must never be presented as implemented.

## Repository map

- [packages/desktop](packages/desktop) - Electron main, preload, renderer, desktop services, and current product surfaces
- [packages/tomny-runtime](packages/tomny-runtime) - runtime compatibility package
- [packages/cloud-relay](packages/cloud-relay) - remote relay service
- [packages/web-host](packages/web-host) and [packages/web-cli](packages/web-cli) - web host and CLI support
- [packages/mtui](packages/mtui) - repository-aware tooling used for safe file operations
- [docs](docs/README.md) - canonical product, architecture, platform, and execution documentation

## Start locally

Requirements: Node.js 22 through 24, Bun, Git, and platform build prerequisites for Electron native modules.

```sh
bun install
bun run start
```

Useful verification commands:

```sh
bun run lint
bun run format:check
bunx tsc --noEmit
bun run test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before changing the repository.

## Canonical design

- [Product vision](docs/product/vision.md)
- [Current architecture and evidence](docs/architecture/current.md)
- [Target core boundaries](docs/architecture/target.md)
- [Trust and user understanding](docs/core/trust-and-understanding.md)
- [Local and cloud AI runtime](docs/core/ai-runtime.md)
- [Package and Store contract](docs/platform/packages.md)
- [Autonomous multi-agent master plan](docs/execution/mvp-plan.md)
- [Engineering conventions](docs/engineering/conventions.md)
- [Testing and release](docs/engineering/testing-and-release.md)

## License

See [LICENSE](LICENSE). Third-party licenses and notices distributed with dependencies and bundled components remain authoritative for those components.
