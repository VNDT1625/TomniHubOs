import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type NativeFileBypass = Readonly<{
  id: string;
  exposure: 'bootstrap-reachable' | 'module-defined';
  sources: readonly string[];
  ownedMarkers: readonly string[];
}>;

type ContainedNativeFileRoute = Readonly<{
  id: string;
  sources: readonly string[];
  disabledMarkers: readonly string[];
  forbiddenMarkers?: readonly string[];
}>;

const PROJECT_ROOT = process.cwd();

/**
 * This is inventory evidence, not a C3-01 completion claim and not a claim that
 * every native writer has been discovered. It holds the known direct file
 * mutation seams visible while they bypass the shared Foundation RunKernel and
 * TrustBroker contract, so later release work must explicitly migrate or retire
 * each one rather than treating a passing Foundation path as universal coverage.
 */
const KNOWN_NATIVE_FILE_BYPASSES: readonly NativeFileBypass[] = [] as const;

/**
 * These formerly direct mutation entrypoints remain visible to C3 but reject
 * before their lower-level writer. They are containment evidence, not a shared
 * RunKernel/TrustBroker migration or a release-complete claim.
 */
const CONTAINED_NATIVE_FILE_ROUTES: readonly ContainedNativeFileRoute[] = [
  {
    id: 'core-workspace-mcp-write-edit-command',
    sources: [
      'packages/desktop/src/process/experimentalCore/adapters/tomnyCoreAdapter.ts',
      'packages/desktop/src/process/agentRuntime/agentMesh/mcp/coreWorkspaceServer.ts',
    ],
    disabledMarkers: [
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
    id: 'renderer-native-file-gateway',
    sources: ['packages/desktop/src/process/resources/nativeFileGatewayBridge.ts'],
    disabledMarkers: ['NATIVE_FILE_MUTATION_DISABLED'],
  },
  {
    id: 'renderer-native-zip-writer',
    sources: ['packages/desktop/src/process/resources/nativePlatform/fileBridge.ts'],
    disabledMarkers: ['NATIVE_ZIP_GOVERNANCE_REQUIRED'],
  },
  {
    id: 'ide-arbitrary-path-file-bridge',
    sources: ['packages/package-apps/ide/src/process/workspace/ideFileBridge.ts'],
    disabledMarkers: ['IDE_FILE_MUTATION_DISABLED'],
  },
  {
    id: 'studio-binary-file-bridge',
    sources: ['packages/package-apps/document-studio/src/process/studioFsBridge.ts'],
    disabledMarkers: ['STUDIO_BINARY_WRITE_GOVERNANCE_REQUIRED'],
  },
  {
    id: 'studio-docx-file-bridge',
    sources: ['packages/package-apps/document-studio/src/process/studioDocxBridge.ts'],
    disabledMarkers: ['STUDIO_DOCX_WRITE_GOVERNANCE_REQUIRED'],
  },
];

const readSource = (path: string): string => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error('C3 native-file bypass inventory source missing: ' + path);
  return readFileSync(absolutePath, 'utf8');
};

const contentsFor = (route: NativeFileBypass): string => route.sources.map(readSource).join('\n');

describe('C3 native-file executor bypass inventory', () => {
  it('names the known direct file mutation seams, their present owners, and their exposure without claiming universal coverage', () => {
    expect(KNOWN_NATIVE_FILE_BYPASSES.map((route) => `${route.exposure}:${route.id}`)).toEqual([]);

    for (const route of KNOWN_NATIVE_FILE_BYPASSES) {
      const content = contentsFor(route);
      for (const marker of route.ownedMarkers) expect(content, route.id + ': ' + marker).toContain(marker);
    }
  });

  it('keeps retired direct mutation entrypoints explicit and fail-closed until governed execution exists', () => {
    expect(CONTAINED_NATIVE_FILE_ROUTES.map((route) => route.id)).toEqual([
      'core-workspace-mcp-write-edit-command',
      'renderer-native-file-gateway',
      'renderer-native-zip-writer',
      'ide-arbitrary-path-file-bridge',
      'studio-binary-file-bridge',
      'studio-docx-file-bridge',
    ]);
    for (const route of CONTAINED_NATIVE_FILE_ROUTES) {
      const content = route.sources.map(readSource).join('\n');
      for (const marker of route.disabledMarkers) expect(content, route.id).toContain(marker);
      for (const marker of route.forbiddenMarkers ?? [])
        expect(content, `${route.id}: ${marker}`).not.toContain(marker);
    }
  });
});
