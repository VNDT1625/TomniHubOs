import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type NativeFileMutationRoute = Readonly<{
  id: string;
  sources: readonly string[];
  markers: readonly string[];
  forbiddenMarkers?: readonly string[];
}>;

const PROJECT_ROOT = process.cwd();

/**
 * Bounded inventory of direct user-workspace mutation seams. It is deliberately
 * source-topology evidence: browser-control registration is not currently
 * bootstrap-reachable, but its editor and screenshot writers must remain visible
 * before that host can be promoted.
 *
 * A C3 migration must put every route behind one Main-owned contract that binds:
 * authenticated actor and origin, a workspace-root/path capability, explicit
 * consent, cancellation/limits, TrustRuntime admission, and a RunKernel receipt.
 */
const REQUIRED_NATIVE_FILE_GOVERNANCE_CONTRACT =
  'actor/origin + workspace-root/path capability + explicit consent + cancellation/limits + TrustRuntime admission + RunKernel receipt';

const NATIVE_FILE_MUTATION_ROUTES: readonly NativeFileMutationRoute[] = [] as const;

/**
 * Former Main-owned mutation entrypoints retained as containment evidence. They
 * remain registered only where compatibility needs a stable error and must not
 * silently regain a direct writer before a governed executor is available.
 */
const CONTAINED_NATIVE_FILE_MUTATION_ROUTES: readonly NativeFileMutationRoute[] = [
  {
    id: 'core-workspace-mcp-write-edit-command',
    sources: [
      'packages/desktop/src/process/experimentalCore/adapters/tomnyCoreAdapter.ts',
      'packages/desktop/src/process/agentRuntime/agentMesh/mcp/coreWorkspaceServer.ts',
    ],
    markers: [
      'createCoreWorkspaceServer({ workspace: cwd })',
      'CORE_WORKSPACE_MUTATION_GOVERNANCE_REQUIRED',
      'CORE_WORKSPACE_COMMAND_GOVERNANCE_REQUIRED',
    ],
    forbiddenMarkers: [
      "await writeFile(temporary, content, 'utf8');",
      'await rename(temporary, target);',
      'execFileAsync(invocation.executable, invocation.args, {',
    ],
  },
  {
    id: 'renderer-native-fs-gateway',
    sources: ['packages/desktop/src/process/resources/nativeFileGatewayBridge.ts'],
    markers: [
      'NATIVE_FILE_MUTATION_DISABLED',
      'fileGatewayChannels.write.provider(() => rejectUngovernedMutation())',
      'fileGatewayChannels.remove.provider(() => rejectUngovernedMutation())',
    ],
    forbiddenMarkers: ['fileGatewayChannels.write.provider(async', 'fileGatewayChannels.remove.provider(async'],
  },
  {
    id: 'renderer-native-fs-zip',
    sources: ['packages/desktop/src/process/resources/nativePlatform/fileBridge.ts'],
    markers: [
      'NATIVE_ZIP_GOVERNANCE_REQUIRED',
      'nativeFileOperationChannels.createZip.provider(() => Promise.reject(new Error(NATIVE_ZIP_GOVERNANCE_REQUIRED)))',
    ],
    forbiddenMarkers: ['nativeFileOperationChannels.createZip.provider(async'],
  },
  {
    id: 'browser-control-editor-write',
    sources: ['packages/package-apps/browser/src/process/browserControlWiring.ts'],
    markers: [
      'BROWSER_CONTROL_EDITOR_WRITE_GOVERNANCE_REQUIRED',
      'Promise.reject(new Error(BROWSER_CONTROL_EDITOR_WRITE_GOVERNANCE_REQUIRED))',
    ],
    forbiddenMarkers: ['await new NativeFileGateway().writeText(filePath, content);'],
  },
  {
    id: 'browser-control-screenshot-persistence',
    sources: ['packages/package-apps/browser/src/process/browserControlWiring.ts'],
    markers: ['export const getBrowserControlDeps'],
    forbiddenMarkers: [
      'persistScreenshot: async',
      "join(app.getPath('userData'), 'browser-captures')",
      "await writeFile(filePath, png, { flag: 'wx' });",
    ],
  },
] as const;

const readSource = (path: string): string => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error(`Native-file governance inventory source missing: ${path}`);
  return readFileSync(absolutePath, 'utf8');
};

const routeContent = (route: NativeFileMutationRoute): string => route.sources.map(readSource).join('\n');

describe('C3 native-file direct mutation governance inventory', () => {
  it('keeps every enabled direct writer explicit until it has the shared governance contract', () => {
    expect(REQUIRED_NATIVE_FILE_GOVERNANCE_CONTRACT).toContain('workspace-root/path capability');
    expect(NATIVE_FILE_MUTATION_ROUTES.map((route) => route.id)).toEqual([]);
    for (const route of NATIVE_FILE_MUTATION_ROUTES) {
      const content = routeContent(route);
      for (const marker of route.markers) expect(content, `${route.id}: ${marker}`).toContain(marker);
    }
  });

  it('keeps every contained native-file and browser-control writer explicit until a governed replacement exists', () => {
    expect(CONTAINED_NATIVE_FILE_MUTATION_ROUTES.map((route) => route.id)).toEqual([
      'core-workspace-mcp-write-edit-command',
      'renderer-native-fs-gateway',
      'renderer-native-fs-zip',
      'browser-control-editor-write',
      'browser-control-screenshot-persistence',
    ]);

    for (const route of CONTAINED_NATIVE_FILE_MUTATION_ROUTES) {
      const content = routeContent(route);
      for (const marker of route.markers) expect(content, `${route.id}: ${marker}`).toContain(marker);
      for (const marker of route.forbiddenMarkers ?? [])
        expect(content, `${route.id}: ${marker}`).not.toContain(marker);
    }
  });
});
