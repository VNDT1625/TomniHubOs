import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type SourceInventory = Readonly<{
  path: string;
  markers: readonly string[];
}>;

const PROJECT_ROOT = process.cwd();
const readSource = (path: string): string => {
  const absolutePath = resolve(PROJECT_ROOT, path);
  if (!existsSync(absolutePath)) throw new Error('C5-06 inventory source missing: ' + path);
  return readFileSync(absolutePath, 'utf8');
};

const CURRENT_PERSISTENT_CLEANUP: readonly SourceInventory[] = [
  {
    path: 'packages/desktop/src/process/resources/packageProcessRuntime/persistentContributionSupervisor.ts',
    markers: [
      'if (!record.controller.signal.aborted) record.controller.abort(reason);',
      'await record.endpoint.stop();',
      "await evidence('stopped', record.binding, reason);",
      "await stop(record, 'PACKAGE_PERSISTENT_CONTRIBUTION_REVOKED');",
    ],
  },
  {
    path: 'packages/desktop/src/process/resources/packageProcessRuntime/designViuMcpRuntime.ts',
    markers: [
      'quiesce: async (packageId) => {',
      "if (packageId !== 'com.tomni.design-studio' || !lastBinding) return;",
      'await lifecycle.invalidate(binding.surface, binding.contributionId);',
    ],
  },
  {
    path: 'packages/desktop/src/process/extensions/package-manager/PackageManagerService.ts',
    markers: [
      'await deps.quiescePackageRuntime?.(record.id);',
      "state: 'quarantined',",
      'contributionRegistry.remove(record.id);',
      'await waitForAssetReadLeases(id);',
    ],
  },
  {
    path: 'packages/desktop/src/process/extensions/package-manager/packageBridge.ts',
    markers: [
      'quiescePackageRuntime: async (packageId) => {',
      'if (packageId !== DESIGN_VIU_PACKAGE_ID) return;',
      'await designViuMcpRuntimeSingleton?.quiesce(packageId);',
    ],
  },
];

const FULL_MATRIX_HOOKS_NOT_YET_WIRED = [
  'cancelPackageOwnedTasks',
  'revokePackageCapabilities',
  'releasePackageResourceLeases',
  'removePackageOwnedSecrets',
  'applyPackageDataRetention',
  'cancelPackageScheduledWork',
] as const;

/**
 * This is an inventory of the current C5-06 boundary, not lifecycle completion
 * proof. It deliberately distinguishes the demonstrated persistent Design
 * endpoint cleanup from the still-unwired optional-package cleanup matrix.
 */
describe('C5-06 uninstall/revoke residual inventory', () => {
  it('keeps the current persistent endpoint, artifact-lease, and quarantine proof explicit', () => {
    for (const route of CURRENT_PERSISTENT_CLEANUP) {
      const source = readSource(route.path);
      for (const marker of route.markers) expect(source, route.path + ': ' + marker).toContain(marker);
    }
  });

  it('records that the wired persistent-runtime cleanup remains Design-only, not a full optional-package residual matrix', () => {
    const bridge = readSource('packages/desktop/src/process/extensions/package-manager/packageBridge.ts');
    const service = readSource('packages/desktop/src/process/extensions/package-manager/PackageManagerService.ts');

    expect(bridge).toContain('if (packageId !== DESIGN_VIU_PACKAGE_ID) return;');
    for (const hook of FULL_MATRIX_HOOKS_NOT_YET_WIRED) expect(service, hook).not.toContain(hook);
  });
});
