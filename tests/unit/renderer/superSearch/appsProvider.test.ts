import { describe, expect, it } from 'vitest';
import type { PackageListing } from '@/common/packages';
import {
  buildAppEntries,
  createAppsProvider,
  type AppSearchBuiltIn,
} from '@/renderer/components/layout/SuperSearch/providers/appsProvider';

const listing = (
  id: string,
  name: string,
  description: string,
  installed: boolean,
  extra: Partial<PackageListing> = {}
): PackageListing => {
  const manifest = { id, name, description, tags: [], modules: [] } as unknown as PackageListing['manifest'];
  return {
    manifest,
    delivery: 'downloaded-package',
    state: installed ? 'installed' : 'available',
    installedManifest: installed ? manifest : undefined,
    enabled: true,
    ...extra,
  } as unknown as PackageListing;
};

const builtIns: AppSearchBuiltIn[] = [
  { id: 'git', path: '/git', title: 'Git', description: 'Repositories and commits', category: 'developer' },
  {
    id: 'studio',
    path: '/apps/com.tomni.studio/studio',
    packageId: 'com.tomni.studio',
    moduleId: 'studio',
    title: 'Studio',
    description: 'Create media',
    category: 'creative',
  },
];

const runnable = (item: PackageListing) =>
  item.installedManifest
    ? [
        {
          id: item.installedManifest.id === 'com.tomni.studio' ? 'studio' : 'main',
          title: `${item.installedManifest.name} Home`,
          pinnable: true,
        },
      ]
    : [];

const run = async (query: string, listings: PackageListing[]) => {
  const provider = createAppsProvider('Apps', () =>
    buildAppEntries({ builtIns, listings, runnableModulesOf: runnable })
  );
  return provider.search({ query, limit: 20, signal: new AbortController().signal });
};

describe('apps search provider', () => {
  const listings = [
    listing('com.tomni.studio', 'Studio', 'Create media', true),
    listing('com.acme.notes', 'Ghi chú nhanh', 'Sổ tay Việt Nam', true),
    listing('com.acme.calc', 'Calculator', 'Math helper', false),
    listing('com.acme.revoked', 'Revoked Calc', 'Math', false, { revoked: true }),
  ];

  it('lists a built-in app only while its backing package is installed', async () => {
    expect((await run('studio', [])).map((hit) => hit.id)).not.toContain('app:builtin:studio');
    const hits = await run('studio', listings);
    expect(hits.find((hit) => hit.id === 'app:builtin:studio')?.action).toEqual({
      kind: 'route',
      path: '/apps/com.tomni.studio/studio',
    });
    // The package module represented by the built-in entry is not listed a second time.
    expect(hits.filter((hit) => hit.title.startsWith('Studio'))).toHaveLength(1);
  });

  it('launches installed package apps through the same /apps route as the launcher', async () => {
    const [hit] = await run('notes', listings);
    expect(hit.action).toEqual({ kind: 'route', path: '/apps/com.acme.notes/main' });
  });

  it('routes store-available packages to their Store detail page and hides revoked ones', async () => {
    const hits = await run('calc', listings);
    expect(hits.map((hit) => hit.id)).toEqual(['app:store:com.acme.calc']);
    expect(hits[0].action).toEqual({ kind: 'route', path: '/store/package/com.acme.calc' });
  });

  it('matches name, id and description case- and diacritics-insensitively', async () => {
    expect((await run('GHI CHU', listings))[0].id).toBe('app:package:com.acme.notes:main');
    expect((await run('so tay viet', listings)).map((hit) => hit.id)).toContain('app:package:com.acme.notes:main');
    expect((await run('com.acme.calc', listings)).map((hit) => hit.id)).toContain('app:store:com.acme.calc');
    expect((await run('commits', listings)).map((hit) => hit.id)).toEqual(['app:builtin:git']);
  });

  it('falls back to in-order fuzzy matching on the title and ignores non-matches', async () => {
    expect((await run('clcltr', listings)).map((hit) => hit.id)).toEqual(['app:store:com.acme.calc']);
    expect(await run('zzzz', listings)).toEqual([]);
  });
});
