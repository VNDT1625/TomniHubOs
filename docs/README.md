# Canonical documentation

This directory is the single design and execution source for TomniHubOS. Do not add parallel plans, session memory, subsystem READMEs, or tool-specific rule sets.

## Status language

Every material architecture claim uses one of these meanings:

- **CURRENT** - reachable code or a passing test demonstrates the behavior.
- **PARTIAL** - some implementation exists, but coverage, integration, or release proof is incomplete.
- **TARGET** - intended design only.
- **BLOCKED** - a named dependency or decision prevents progress.

A document can describe current and target behavior together only when it labels the boundary clearly.

## Document ownership

| Topic                                                    | Canonical document                                              |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| Product purpose, differentiation, MVP outcomes           | [Product vision](product/vision.md)                             |
| Implemented code and verified gaps                       | [Current architecture](architecture/current.md)                 |
| Trusted base and package boundaries                      | [Target architecture](architecture/target.md)                   |
| Security, private context, preferences, user control     | [Trust and user understanding](core/trust-and-understanding.md) |
| Provider APIs, CLIs, local models, cloud models, routing | [AI runtime](core/ai-runtime.md)                                |
| Store, manifest, ABI, sandbox, package extraction        | [Packages](platform/packages.md)                                |
| Ordered waves and autonomous subagent protocol           | [MVP plan](execution/mvp-plan.md)                               |
| Source layout, naming, UI, i18n                          | [Engineering conventions](engineering/conventions.md)           |
| Test levels, evidence, release gates                     | [Testing and release](engineering/testing-and-release.md)       |

Repository-wide contributor requirements live only in [AGENTS.md](../AGENTS.md). The contribution workflow lives in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Updating documentation

Update a canonical document in the same change when:

- a target becomes implemented;
- an implementation is removed or bypassed;
- a public contract, trust boundary, or package boundary changes;
- new evidence changes a CURRENT or PARTIAL assessment;
- a release gate or MVP acceptance criterion changes.

Cite source paths and tests for CURRENT claims. Record a revision or date for architecture evidence. Keep generated reports out of this directory unless the report itself is the maintained contract.
