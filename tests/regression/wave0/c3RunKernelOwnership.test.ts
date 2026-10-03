import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type SourceFile = Readonly<{
  path: string;
  content: string;
}>;

type C3EntryPoint = Readonly<{
  id: string;
  kind: 'governed' | 'migration-hole';
  sources: readonly string[];
  requiredMarkers: readonly string[];
}>;

const PROJECT_ROOT = process.cwd();
const PROCESS_ROOT = 'packages/desktop/src/process';

/**
 * This is a deliberately bounded static inventory of Main-owned entry points
 * demonstrated by the current bootstrap. It is not evidence that C3-01 is
 * complete: `migration-hole` entries are asserted so they cannot disappear
 * from release discussion merely because a focused Foundation path passes.
 */
const C3_KNOWN_ENTRY_POINTS: readonly C3EntryPoint[] = [
  {
    id: 'foundation-renderer-hub-run',
    kind: 'governed',
    sources: [`${PROCESS_ROOT}/bridge/index.ts`, `${PROCESS_ROOT}/bridge/foundationBridge.ts`],
    requiredMarkers: [
      'registerFoundationBridge({',
      'trustRuntime: foundationTrustRuntime',
      'executeFoundationHubRun(',
      'new HubExecutionAdapter(kernel, targets, { trustBroker, origin }).execute(intent, signal)',
    ],
  },
  {
    id: 'experimental-core-ipc-start',
    kind: 'governed',
    sources: [
      `${PROCESS_ROOT}/bridge/index.ts`,
      `${PROCESS_ROOT}/experimentalCore/experimentalCoreBridge.ts`,
      `${PROCESS_ROOT}/bridge/foundationBridge.ts`,
    ],
    requiredMarkers: [
      'registerExperimentalCoreBridge(meshService, {',
      'const experimentalFoundationLifecycle = createFoundationRunLifecycle(runtime, {',
      "origin: 'tomny://experimental-core'",
      'return experimentalFoundationLifecycle.start({',
      'executeFoundationHubRun(',
      'options.kernel ?? getFoundationKernel(options.trustRuntime ?? globalTrustRuntime)',
      'FoundationTrustRuntime',
    ],
  },
  {
    id: 'experimental-core-scheduled-run',
    kind: 'governed',
    sources: [
      `${PROCESS_ROOT}/experimentalCore/experimentalCoreBridge.ts`,
      `${PROCESS_ROOT}/bridge/foundationBridge.ts`,
    ],
    requiredMarkers: [
      'const scheduledFoundationLifecycle = createFoundationRunLifecycle(runtime, {',
      "origin: 'tomny://scheduler'",
      'options.requireAuthenticatedAccount?.();',
      'return scheduledFoundationLifecycle.start({',
      'executeFoundationHubRun(',
      'options.kernel ?? getFoundationKernel(options.trustRuntime ?? globalTrustRuntime)',
      'FoundationTrustRuntime',
    ],
  },
  {
    id: 'surface-ai-operation-parent-child-run',
    kind: 'governed',
    sources: [`${PROCESS_ROOT}/resources/packageCapability/goalCapability/surfaceAiOperationRun.ts`],
    requiredMarkers: [
      'kernel: RunKernel',
      'trustRuntime?: FoundationTrustRuntime',
      'executeFoundationHubRun(',
      "'tomny://surface-ai-operation'",
    ],
  },
  {
    id: 'goal-capability-derivation',
    kind: 'governed',
    sources: [
      `${PROCESS_ROOT}/bridge/index.ts`,
      `${PROCESS_ROOT}/resources/packageCapability/goalCapability/governedGoalCapabilityDerivationService.ts`,
    ],
    requiredMarkers: [
      'createGovernedGoalCapabilityDerivationService(',
      'kernel: getFoundationKernel(foundationTrustRuntime),',
      'kernel: RunKernel',
      'executeFoundationHubRun(',
      'GOAL_CAPABILITY_DERIVATION_ORIGIN',
      'trustRuntime: deps.trustRuntime',
    ],
  },
  {
    id: 'direct-cli-chat',
    kind: 'governed',
    sources: [`${PROCESS_ROOT}/services/agentChat/directCliAgent.ts`],
    requiredMarkers: [
      'getConfiguredFoundationTrustRuntime()',
      'deps.kernel ?? getFoundationKernel(trustRuntime)',
      'policyVersion: trustRuntime.policyVersion',
      'trustRuntime,',
    ],
  },
  {
    id: 'automation-workflow-run',
    kind: 'governed',
    sources: [`${PROCESS_ROOT}/bridge/index.ts`, `${PROCESS_ROOT}/automation/automationBridge.ts`],
    requiredMarkers: [
      'AUTOMATION_TRUST_RUNTIME_REQUIRED',
      'mainKernel ?? getFoundationKernel(trustRuntime)',
      'executeFoundationHubRun(',
      'trustRuntime,',
    ],
  },
  {
    id: 'news-manual-remote-operation',
    kind: 'governed',
    sources: [`${PROCESS_ROOT}/news/newsBridge.ts`],
    requiredMarkers: [
      'NEWS_TRUST_RUNTIME_REQUIRED',
      'executeFoundationHubRun(',
      'requireNewsEgressAdmission(options.egressAuthority, operation)',
      'trustRuntime,',
    ],
  },
  {
    id: 'news-background-rss-scheduler',
    kind: 'governed',
    sources: [`${PROCESS_ROOT}/news/newsScheduler.ts`],
    requiredMarkers: [
      'NEWS_SCHEDULER_TRUST_RUNTIME_REQUIRED',
      'getFoundationKernel(trustRuntime)',
      'executeFoundationHubRun(',
      'trustRuntime,',
    ],
  },
  {
    id: 'news-background-realtime',
    kind: 'governed',
    sources: [`${PROCESS_ROOT}/news/realtimeConnector.ts`],
    requiredMarkers: [
      'NEWS_REALTIME_TRUST_RUNTIME_REQUIRED',
      'getFoundationKernel(trustRuntime)',
      'executeFoundationHubRun(',
      'trustRuntime,',
    ],
  },
  {
    id: 'news-background-bots',
    kind: 'governed',
    sources: [`${PROCESS_ROOT}/news/bots/botEngine.ts`],
    requiredMarkers: [
      'NEWS_BOT_TRUST_RUNTIME_REQUIRED',
      'getFoundationKernel(trustRuntime)',
      'executeFoundationHubRun(',
      'trustRuntime,',
    ],
  },
  {
    id: 'native-file-gateway-mutation',
    kind: 'migration-hole',
    sources: [`${PROCESS_ROOT}/bridge/index.ts`, `${PROCESS_ROOT}/resources/nativeFileGatewayBridge.ts`],
    requiredMarkers: [
      'registerFileGatewayBridge()',
      'fileGatewayChannels.write.provider',
      'fileGatewayChannels.remove.provider',
    ],
  },
] as const;

const readSource = (path: string): SourceFile => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error(`C3 inventory source missing: ${path}`);
  return Object.freeze({ path, content: readFileSync(absolutePath, 'utf8') });
};

const sourceContents = (entry: C3EntryPoint): string =>
  entry.sources.map((path) => readSource(path).content).join('\n');

const hasRunKernelMarker = (content: string): boolean =>
  /\b(?:executeFoundationHubRun|getFoundationKernel|new RunKernel|RunKernel)\b/.test(content);

const hasDirectTrustBrokerMarker = (content: string): boolean =>
  /\b(?:TrustBroker|FoundationTrustRuntime)\b/.test(content);

describe('C3 RunKernel and TrustBroker ownership inventory', () => {
  it('keeps the bounded, bootstrap-grounded inventory explicit and separates governed paths from migration holes', () => {
    expect(C3_KNOWN_ENTRY_POINTS.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
      'governed:foundation-renderer-hub-run',
      'governed:experimental-core-ipc-start',
      'governed:experimental-core-scheduled-run',
      'governed:surface-ai-operation-parent-child-run',
      'governed:goal-capability-derivation',
      'governed:direct-cli-chat',
      'governed:automation-workflow-run',
      'governed:news-manual-remote-operation',
      'governed:news-background-rss-scheduler',
      'governed:news-background-realtime',
      'governed:news-background-bots',
      'migration-hole:native-file-gateway-mutation',
    ]);
    expect(C3_KNOWN_ENTRY_POINTS.filter((entry) => entry.kind === 'migration-hole')).toHaveLength(1);
  });

  it('keeps the known governed execution paths bound to the shared Foundation RunKernel and TrustBroker seam', () => {
    const governed = C3_KNOWN_ENTRY_POINTS.filter((entry) => entry.kind === 'governed');

    for (const entry of governed) {
      const content = sourceContents(entry);
      for (const marker of entry.requiredMarkers) expect(content, `${entry.id}: ${marker}`).toContain(marker);
      expect(hasRunKernelMarker(content), `${entry.id}: RunKernel seam`).toBe(true);
      expect(hasDirectTrustBrokerMarker(content), `${entry.id}: TrustBroker seam`).toBe(true);
    }
  });

  it('keeps known un-migrated domain executors visible until each gains one governed RunKernel and TrustBroker path', () => {
    const holes = C3_KNOWN_ENTRY_POINTS.filter((entry) => entry.kind === 'migration-hole');

    for (const entry of holes) {
      const content = sourceContents(entry);
      for (const marker of entry.requiredMarkers) expect(content, `${entry.id}: ${marker}`).toContain(marker);
    }

    const nativeFileGateway = readSource('packages/desktop/src/process/resources/nativeFileGatewayBridge.ts').content;
    expect(hasRunKernelMarker(nativeFileGateway)).toBe(false);
    expect(hasDirectTrustBrokerMarker(nativeFileGateway)).toBe(false);

    const coreWorkspaceServer = readSource(
      'packages/desktop/src/process/agentRuntime/agentMesh/mcp/coreWorkspaceServer.ts'
    ).content;
    expect(coreWorkspaceServer).toContain('CORE_WORKSPACE_MUTATION_GOVERNANCE_REQUIRED');
    expect(coreWorkspaceServer).toContain('CORE_WORKSPACE_COMMAND_GOVERNANCE_REQUIRED');
    for (const marker of [
      "await writeFile(temporary, content, 'utf8');",
      'await rename(temporary, target);',
      'execFileAsync(invocation.executable, invocation.args, {',
    ]) {
      expect(coreWorkspaceServer, marker).not.toContain(marker);
    }
    expect(hasRunKernelMarker(coreWorkspaceServer)).toBe(false);
    expect(hasDirectTrustBrokerMarker(coreWorkspaceServer)).toBe(false);
  });
});
