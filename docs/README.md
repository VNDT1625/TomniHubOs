# Canonical documentation

This directory is the single design and execution source for TomniHubOS. Do not add parallel plans, session memory, subsystem READMEs, or tool-specific rule sets.

The model topology is defined in [AI runtime](core/ai-runtime.md): Generative autoregressive Qwen models are replaced by the Laya Decision Engine (~33ms non-autoregressive encoder) for local security, user-understanding, and semantic classification. Orchestration uses an API LLM.

## Status language

Every material architecture claim uses one of these meanings:

- **CURRENT** - reachable code or a passing test demonstrates the behavior.
- **PARTIAL** - some implementation exists, but coverage, integration, or release proof is incomplete.
- **TARGET** - intended design only.
- **BLOCKED** - a named dependency or decision prevents progress.

A document can describe current and target behavior together only when it labels the boundary clearly.

## Document ownership

| Topic                                                            | Canonical document                                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Product purpose, differentiation, MVP outcomes, IA, UI/UX        | [Product vision](product/vision.md)                                                                                                     |
| Free-core economics, unit contribution, operating stages         | [Product economics](product/economics.md)                                                                                               |
| Implemented code and verified gaps                               | [Current architecture](architecture/current.md)                                                                                         |
| Trusted base and package boundaries                              | [Target architecture](architecture/target.md), [Application Workflow & Page Flows](architecture/application-workflow-and-page-flows.md) |
| Security, private context, preferences, user control             | [Trust and user understanding](core/trust-and-understanding.md)                                                                         |
| Provider APIs, CLIs, local models, cloud models, routing         | [AI runtime](core/ai-runtime.md)                                                                                                        |
| Chat pipeline, realtime pre-query stages, package workflow hooks | [Chat pipeline](core/chat-pipeline.md)                                                                                                  |
| Chat execution flow, code traces, tool dispatch lifecycle        | [Chat execution flow](core/chat-execution-flow.md)                                                                                      |
| Credit, rate cards, reservations, settlement, refunds            | [Credits and billing](platform/credits-and-billing.md)                                                                                  |
| Cloud compute, provisioning, queue, isolation, pools             | [Cloud execution](platform/cloud-execution.md)                                                                                          |
| Manifest, ABI, sandbox, package extraction                       | [Packages](platform/packages.md)                                                                                                        |

| Package taxonomy, archetypes, and permissions matrix | [Package taxonomy](platform/package-taxonomy.md) |
| Store fees, payouts, developer programs, sponsorship | [Store commerce](platform/store-commerce.md) |

| Strategic architectural breakthroughs and next-gen proposals | [5 Breakthrough Ideas](future/5-y-tuong-kien-truc-dot-pha.md), [Laya Engine](future/kien-truc-laya-decision-engine.md), [Chat Artifacts & Mermaid](future/thiet-ke-chat-ui-artifacts-va-mermaid.md), [Laya Omni Notification Hub & UI Audit](future/laya-omni-notification-hub-and-ui-audit.md) |
| Strategic architectural breakthroughs and next-gen proposals | [5 Breakthrough Ideas](future/5-y-tuong-kien-truc-dot-pha.md), [Laya Engine](future/kien-truc-laya-decision-engine.md), [Chat Artifacts & Mermaid](future/thiet-ke-chat-ui-artifacts-va-mermaid.md), [Laya Omni Notification Hub & UI Audit](future/laya-omni-notification-hub-and-ui-audit.md), [Package SDK & Composable Apps](future/kien-truc-package-sdk-va-composable-apps.md), [Telegram Remote & Voice Agent Control](future/kien-truc-telegram-remote-va-voice-agent-control.md) |
| Source layout, naming, UI, i18n | [Engineering conventions](engineering/conventions.md) |
| Test levels, evidence, release gates | [Testing and release](engineering/testing-and-release.md) |

Repository-wide contributor requirements live only in [AGENTS.md](../AGENTS.md). The contribution workflow lives in [CONTRIBUTING.md](../CONTRIBUTING.md).

Execution dependencies, the mandatory Integrator-plus-three-subagent schedule, and C0-C6 checkpoint status belong only to the [master plan](execution/mvp-plan.md). Implemented evidence belongs in [current architecture](architecture/current.md), while candidate proof belongs in [testing and release](engineering/testing-and-release.md). Report the Core plus Store candidate separately from the Full managed-usage MVP.

## Updating documentation

Update a canonical document in the same change when:

- a target becomes implemented;
- an implementation is removed or bypassed;
- a public contract, trust boundary, or package boundary changes;
- new evidence changes a CURRENT or PARTIAL assessment;
- a release gate or MVP acceptance criterion changes.

Cite source paths and tests for CURRENT claims. Record a revision or date for architecture evidence. Keep generated reports out of this directory unless the report itself is the maintained contract.
