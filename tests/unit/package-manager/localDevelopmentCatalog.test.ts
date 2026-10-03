import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: {},
  dialog: {},
  ipcMain: {},
  MessageChannelMain: {},
}));

import { excludeDefaultSurfaceCatalogEntries, type PackageCatalogEntry } from '@/common/packages';
import { loadLocalDevelopmentPackageCatalog } from '@/process/extensions/package-manager/packageBridge';

afterEach(() => vi.unstubAllEnvs());

describe('local development Store catalog', () => {
  it('excludes default IDE from every catalog source', () => {
    const entry = (id: string): PackageCatalogEntry => ({ manifest: { id } }) as unknown as PackageCatalogEntry;

    expect(
      excludeDefaultSurfaceCatalogEntries([
        entry('com.tomni.browser'),
        entry('com.tomni.company'),
        entry('com.tomni.ide'),
      ]).map((entry) => entry.manifest.id)
    ).toEqual(['com.tomni.browser', 'com.tomni.company']);
  });

  it('admits only Store-managed default packages and excludes default Browser and IDE surfaces', () => {
    vi.stubEnv('TOMNI_STORE_LOCAL_ARTIFACTS', '1');

    const catalog = loadLocalDevelopmentPackageCatalog();

    expect(catalog?.catalog.map((entry) => entry.manifest.id)).toEqual([
      'com.tomni.company',
      'com.tomni.knowledge',
      'com.tomni.pet',
    ]);
  });
});
