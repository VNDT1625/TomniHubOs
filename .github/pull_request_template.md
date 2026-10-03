## Outcome

Describe the user or platform outcome and link the owning canonical document. Name the C0-C6 checkpoint and track.

## Candidate impact

- [ ] Core plus Store candidate
- [ ] Full managed-usage MVP
- [ ] Neither release gate

List affected feature switches and explain why a disabled switch is or is not valid for the declared candidate.

## Boundaries and ownership

List process, security, data, provider, package, commerce, and billing boundaries. State whether each relevant claim is CURRENT, PARTIAL, TARGET, or BLOCKED.

For multi-agent work, confirm exact allowlists, no overlap, Integrator-owned shared files, independent verification, and handoff at an acceptance-sized atom.

## Evidence

- [ ] Targeted tests pass at the recorded revision
- [ ] Commands, exit codes, artifacts, and owner are attached
- [ ] Passing/total acceptance atoms and named blockers are reported by track
- [ ] Lint passes
- [ ] Format check passes
- [ ] Type check passes
- [ ] Applicable unit, contract, integration, Store/package, and clean-machine checks pass
- [ ] Documentation is updated when a public contract or status changed
- [ ] Migration, rollback, kill-switch, and recovery evidence is attached where relevant

## Risk and recovery

Describe permissions, secrets, outbound data, persisted data, cancellation, commercial state, rollback, kill criteria, and known gaps.

See [CONTRIBUTING.md](../CONTRIBUTING.md), the [master plan](../docs/execution/mvp-plan.md), and [testing and release](../docs/engineering/testing-and-release.md).
