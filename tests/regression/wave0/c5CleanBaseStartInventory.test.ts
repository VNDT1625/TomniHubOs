import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import type { PackageListing, PackageStateChangedEvent } from '@/common/packages';
import { createDesignViuPackageActivationLifecycle } from '@/process/resources/packageProcessRuntime/designViuMcpRuntime';

type ProcessSource = Readonly<{ path: string; content: string }>;

const PROJECT_ROOT = process.cwd();
const PROCESS_ROOT = resolve(PROJECT_ROOT, 'packages/desktop/src/process');
const PACKAGE_BRIDGE_PATH = 'packages/desktop/src/process/extensions/package-manager/packageBridge.ts';
const DESIGN_RUNTIME_PATH = 'packages/desktop/src/process/resources/packageProcessRuntime/designViuMcpRuntime.ts';

const readProcessSources = (directory = PROCESS_ROOT): readonly ProcessSource[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry): readonly ProcessSource[] => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return readProcessSources(absolutePath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [
      Object.freeze({
        path: relative(PROJECT_ROOT, absolutePath).replaceAll('\\', '/'),
        content: readFileSync(absolutePath, 'utf8'),
      }),
    ];
  });

const callSites = (sources: readonly ProcessSource[], needle: string): readonly string[] =>
  sources
    .filter((source) => source.content.includes(needle))
    .map((source) => source.path)
    .toSorted();

const sourceBetween = (source: string, start: string, end: string): string => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);

  expect(from, `Missing static bootstrap anchor: ${start}`).toBeGreaterThan(-1);
  expect(to, `Missing static bootstrap end anchor: ${end}`).toBeGreaterThan(from);

  return source.slice(from, to);
};

const flushLifecycle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('C5 clean base start inventory', () => {
  it('keeps every known Design host, process, native IPC, and session construction behind installed-and-enabled activation', () => {
    const sources = readProcessSources();
    const bridgeSource = readFileSync(resolve(PROJECT_ROOT, PACKAGE_BRIDGE_PATH), 'utf8');
    const runtimeSource = readFileSync(resolve(PROJECT_ROOT, DESIGN_RUNTIME_PATH), 'utf8');

    expect(callSites(sources, 'createDesignViuContributionManager({')).toEqual([PACKAGE_BRIDGE_PATH]);
    expect(callSites(sources, 'createDesignViuMcpRuntime({')).toEqual([PACKAGE_BRIDGE_PATH]);
    expect(callSites(sources, 'createDesignViuNativeIpcLifecycle<IpcMainInvokeEvent>({')).toEqual([
      PACKAGE_BRIDGE_PATH,
    ]);
    expect(callSites(sources, 'createDesignViuSessionService()')).toEqual([PACKAGE_BRIDGE_PATH]);
    expect(callSites(sources, 'registerProductionDesignViuNativeIpc()')).toEqual([PACKAGE_BRIDGE_PATH]);

    const activation = sourceBetween(
      bridgeSource,
      'const activateInstalledDesignViu = async',
      'const getSurfaceAiAccessConsentAuthority'
    );
    const guard = activation.indexOf("if (listing.state !== 'installed' || !listing.enabled) return;");

    expect(guard).toBeGreaterThan(-1);
    for (const construction of [
      'getDesignViuContributionManager().initialize();',
      'getDesignViuMcpRuntime().initialize();',
      'registerProductionDesignViuNativeIpc();',
    ]) {
      expect(activation.indexOf(construction)).toBeGreaterThan(guard);
    }

    const lifecycle = sourceBetween(
      runtimeSource,
      'export const createDesignViuPackageActivationLifecycle',
      'const matches ='
    );
    expect(lifecycle).toContain("const listing = await deps.packages.status('com.tomni.design-studio');");
    expect(lifecycle).toContain("if (listing.state === 'installed' && listing.enabled) await deps.activate();");
    expect(lifecycle).toContain("if (event.id !== 'com.tomni.design-studio') return;");

    expect(bridgeSource).toContain('designViuPackageActivationLifecycle = createDesignViuPackageActivationLifecycle({');
    expect(bridgeSource).toContain('await designViuPackageActivationLifecycle.initialize();');
  });

  it('does not cross the package-bridge activation boundary on a clean or disabled base', async () => {
    let listing = { state: 'available', enabled: false } as Pick<PackageListing, 'state' | 'enabled'>;
    const status = vi.fn(async () => listing as PackageListing);
    const listeners = new Set<(event: PackageStateChangedEvent) => void>();
    const activatePackageBridge = vi.fn(async () => undefined);
    const lifecycle = createDesignViuPackageActivationLifecycle({
      packages: {
        status,
        onStateChanged: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      activate: activatePackageBridge,
    });

    await lifecycle.initialize();
    expect(status).toHaveBeenCalledWith('com.tomni.design-studio');
    expect(activatePackageBridge).not.toHaveBeenCalled();

    listing = { state: 'installed', enabled: false };
    listeners.forEach((listener) => listener({ id: 'com.tomni.design-studio', state: 'installed' }));
    await flushLifecycle();
    expect(activatePackageBridge).not.toHaveBeenCalled();

    listing = { state: 'installed', enabled: true };
    listeners.forEach((listener) => listener({ id: 'com.tomni.design-studio', state: 'installed' }));
    await vi.waitFor(() => expect(activatePackageBridge).toHaveBeenCalledTimes(1));

    lifecycle.dispose();
    listeners.forEach((listener) => listener({ id: 'com.tomni.design-studio', state: 'installed' }));
    await flushLifecycle();
    expect(activatePackageBridge).toHaveBeenCalledTimes(1);
  });
});
