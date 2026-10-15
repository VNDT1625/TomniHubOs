import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: {},
  dialog: {},
  ipcMain: {},
  MessageChannelMain: {},
}));

import { excludeDefaultSurfaceCatalogEntries, type PackageCatalogEntry } from '@/common/packages';
import {
  disposeConnectionRuntime,
  loadLocalDevelopmentPackageCatalog,
} from '@/process/extensions/package-manager/packageBridge';

afterEach(() => vi.unstubAllEnvs());

describe('local development Store catalog', () => {
    it('filters legacy IDE placeholders but allows a signed downloadable first-party IDE release', () => {
    const entry = (id: string): PackageCatalogEntry => ({ manifest: { id } }) as unknown as PackageCatalogEntry;

    expect(
      excludeDefaultSurfaceCatalogEntries([
        entry('com.tomni.browser'),
        entry('com.tomni.company'),
        entry('com.tomni.ide'),
      ]).map((item) => item.manifest.id)
        ).toEqual(['com.tomni.browser', 'com.tomni.company']);
    const signedIde = { ...entry('com.tomni.ide'), delivery: 'downloaded-package' as const,
      trust: 'signed-first-party' as const };
    const masqueradingIde = { ...entry('com.tomni.ide'), delivery: 'downloaded-package' as const,
      trust: 'signed-store' as const };
    expect(excludeDefaultSurfaceCatalogEntries([signedIde, masqueradingIde])).toEqual([signedIde]);
  });

  it('disposes a connection runtime before the package bridge is torn down', async () => {
    const dispose = vi.fn(async () => undefined);

    await disposeConnectionRuntime({ dispose } as never);

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('does nothing when no connection runtime has been created', async () => {
    await expect(disposeConnectionRuntime()).resolves.toBeUndefined();
  });

    it('loads only allowed signed local development fixtures in an unpackaged build', () => {
    vi.stubEnv('TOMNI_STORE_LOCAL_ARTIFACTS', '1');

    const catalog = loadLocalDevelopmentPackageCatalog();

            const ids = catalog?.catalog.map((item) => item.manifest.id);
    expect(ids).toEqual(expect.arrayContaining([
      'com.tomni.company', 'com.tomni.knowledge', 'com.tomni.pet',
    ]));
    const admitted = new Set([
      'com.tomni.automation-studio', 'com.tomni.browser', 'com.tomni.company',
      'com.tomni.document-studio', 'com.tomni.ide', 'com.tomni.knowledge', 'com.tomni.pet',
    ]);
    expect(ids?.every((id) => admitted.has(id))).toBe(true);
  });
});
