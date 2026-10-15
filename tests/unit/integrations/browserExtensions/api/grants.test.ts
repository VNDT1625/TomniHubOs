import { describe, expect, it } from 'vitest';
import {
  createGrantRegistry,
  createMemoryOptionalGrantStore,
  grantSeedFromManifest,
  type ExtensionGrantSeed,
} from '@process/integrations/browserExtensions/api/grants';
import { ID_A, ID_B, manifestOf } from './shimFixture';

const seedOf = (manifest: unknown = manifestOf(), extensionId = ID_A): ExtensionGrantSeed => {
  const seed = grantSeedFromManifest({ extensionId, packageId: 'pkg', connectionId: 'conn' }, manifest);
  if (seed === undefined) throw new Error('manifest refused');
  return seed;
};

describe('grantSeedFromManifest', () => {
  it('reads required, optional and ruleset entries', () => {
    const seed = seedOf();
    expect(seed.permissions).toEqual(['storage']);
    expect(seed.hostPermissions).toEqual(['https://*.example.com/*']);
    expect(seed.optionalPermissions).toEqual(['cookies', 'downloads']);
    expect(seed.optionalHostPermissions).toEqual(['https://optional.test/*']);
    expect(seed.staticRulesets).toEqual([
      { id: 'ads', enabled: true },
      { id: 'extra', enabled: false },
    ]);
    expect(seed).not.toHaveProperty('manifest');
  });

  it('refuses a manifest the host cannot run', () => {
    expect(grantSeedFromManifest({ extensionId: ID_A, packageId: 'p', connectionId: 'c' }, 'nope')).toBeUndefined();
    expect(
      grantSeedFromManifest(
        { extensionId: ID_A, packageId: 'p', connectionId: 'c' },
        { manifest_version: 2, name: 'x', version: '1', background: { scripts: ['a.js'] } }
      )
    ).toBeUndefined();
  });

  it('drops malformed permission names, host patterns and ruleset entries instead of repairing them', () => {
    const seed = seedOf(
      manifestOf({
        permissions: ['storage', 'bad name!', 'storage'],
        host_permissions: ['https://ok.test/*', 'not a pattern'],
        declarative_net_request: {
          rule_resources: [
            { id: 'a', enabled: true },
            { id: 'a', enabled: true },
            { id: '_hidden', enabled: true },
            { id: '', enabled: true },
            'junk',
          ],
        },
      })
    );
    expect(seed.permissions).toEqual(['storage']);
    expect(seed.hostPermissions).toEqual(['https://ok.test/*']);
    expect(seed.staticRulesets).toEqual([{ id: 'a', enabled: true }]);
  });

  it('caps the number of rulesets', () => {
    const resources = Array.from({ length: 80 }, (_, index) => ({ id: `r${index}`, enabled: true }));
    expect(seedOf(manifestOf({ declarative_net_request: { rule_resources: resources } })).staticRulesets).toHaveLength(
      50
    );
  });
});

describe('grant registry', () => {
  it('answers only for the extension it is asked about', () => {
    const registry = createGrantRegistry({ log: () => undefined });
    registry.register(seedOf(manifestOf({ permissions: ['storage', 'tabs'] }), ID_A));
    registry.register(seedOf(manifestOf({ permissions: ['storage'] }), ID_B));
    expect(registry.get(ID_A)?.hasPermission('tabs')).toBe(true);
    expect(registry.get(ID_B)?.hasPermission('tabs')).toBe(false);
    expect(registry.get('c'.repeat(32))).toBeUndefined();
    expect(registry.ids().toSorted()).toEqual([ID_A, ID_B]);
  });

  it('grants and revokes only optional items, and never touches the required ones', () => {
    const registry = createGrantRegistry({ log: () => undefined });
    registry.register(seedOf());
    const grants = registry.get(ID_A);
    if (!grants) throw new Error('missing');

    expect(grants.contains({ permissions: ['cookies'], origins: [] })).toBe(false);
    expect(grants.grantOptional({ permissions: ['cookies'], origins: ['https://optional.test/*'] })).toEqual({
      permissions: ['cookies'],
      origins: ['https://optional.test/*'],
    });
    expect(grants.hasPermission('cookies')).toBe(true);
    expect(grants.contains({ permissions: ['cookies'], origins: ['https://optional.test/*'] })).toBe(true);

    expect(grants.revokeOptional({ permissions: ['storage'], origins: [] })).toEqual({ kind: 'required' });
    expect(grants.revokeOptional({ permissions: [], origins: ['https://a.example.com/*'] })).toEqual({
      kind: 'required',
    });
    expect(grants.revokeOptional({ permissions: ['downloads'], origins: [] })).toEqual({ kind: 'not-held' });
    expect(grants.revokeOptional({ permissions: ['cookies'], origins: [] }).kind).toBe('removed');
    expect(grants.hasPermission('cookies')).toBe(false);
    expect(grants.hasPermission('storage')).toBe(true);
  });

  it('does not grant what the manifest never declared', () => {
    const registry = createGrantRegistry({ log: () => undefined });
    registry.register(seedOf());
    const grants = registry.get(ID_A);
    if (!grants) throw new Error('missing');
    expect(grants.isDeclared({ permissions: ['history'], origins: [] })).toBe(false);
    expect(grants.isDeclared({ permissions: [], origins: ['https://elsewhere.test/*'] })).toBe(false);
    expect(grants.grantOptional({ permissions: ['history'], origins: ['https://elsewhere.test/*'] })).toEqual({
      permissions: [],
      origins: [],
    });
    expect(grants.hasPermission('history')).toBe(false);
  });

  it('restores stored grants on register, keeping only what the manifest still declares as optional', () => {
    const store = createMemoryOptionalGrantStore();
    store.write(ID_A, {
      permissions: ['cookies', 'history', 'storage'],
      origins: ['https://optional.test/*', 'https://gone.test/*'],
    });
    const registry = createGrantRegistry({ store, log: () => undefined });
    registry.register(seedOf());
    const granted = registry.get(ID_A)?.granted();
    expect(granted?.permissions).toEqual(['cookies', 'storage']);
    expect(granted?.origins).toEqual(['https://*.example.com/*', 'https://optional.test/*']);
  });

  it('survives a store that throws', () => {
    const logs: string[] = [];
    const registry = createGrantRegistry({
      store: {
        read: () => {
          throw new Error('disk');
        },
        write: () => {
          throw new Error('disk');
        },
      },
      log: (message) => logs.push(message),
    });
    registry.register(seedOf());
    expect(registry.get(ID_A)?.grantOptional({ permissions: ['cookies'], origins: [] }).permissions).toEqual([
      'cookies',
    ]);
    expect(logs).toHaveLength(2);
  });

  it('forgets an extension on unregister', () => {
    const registry = createGrantRegistry({ log: () => undefined });
    registry.register(seedOf());
    registry.unregister(ID_A);
    expect(registry.has(ID_A)).toBe(false);
  });
});
