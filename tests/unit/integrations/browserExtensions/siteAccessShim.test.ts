import { describe, expect, it } from 'vitest';
import { createExtensionShim } from '@process/integrations/browserExtensions/api/shim';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const manifest = (hosts: string[], optional: string[] = []) => ({
  manifest_version: 3,
  name: 'Reader',
  version: '1.0.0',
  host_permissions: hosts,
  optional_host_permissions: optional,
});

describe('site access in the Chrome API shim', () => {
  it('withholds a broad host permission under on click, and grants it for all sites', () => {
    const shim = createExtensionShim();
    shim.port.attach({
      extensionId: ID,
      packageId: 'pkg.one',
      connectionId: 'c',
      manifest: manifest(['<all_urls>']),
      siteAccess: { mode: 'on-click', sites: [], sessionSites: [] },
    });
    expect(shim.grants.get(ID)?.contains({ permissions: [], origins: ['https://news.test/*'] })).toBe(false);

    shim.port.setSiteAccess(ID, { mode: 'all-sites', sites: [], sessionSites: [] });
    expect(shim.grants.get(ID)?.contains({ permissions: [], origins: ['https://news.test/*'] })).toBe(true);
  });

  it('applies a saved site only when the manifest covers it, and never a site outside it', () => {
    const shim = createExtensionShim();
    shim.port.attach({
      extensionId: ID,
      packageId: 'pkg.one',
      connectionId: 'c',
      manifest: manifest(['https://news.test/*']),
      siteAccess: { mode: 'on-site', sites: ['https://evil.test'], sessionSites: ['https://evil.test'] },
    });
    // The narrow declaration is always active; a saved site outside it is never granted.
    expect(shim.grants.get(ID)?.contains({ permissions: [], origins: ['https://news.test/*'] })).toBe(true);
    expect(shim.grants.get(ID)?.contains({ permissions: [], origins: ['https://evil.test/*'] })).toBe(false);
  });

  it('keeps an optional site out of the active set until the person allows it', () => {
    const shim = createExtensionShim();
    shim.port.attach({
      extensionId: ID,
      packageId: 'pkg.one',
      connectionId: 'c',
      manifest: manifest([], ['https://*.example.com/*']),
      siteAccess: { mode: 'on-site', sites: [], sessionSites: [] },
    });
    expect(shim.grants.get(ID)?.contains({ permissions: [], origins: ['https://a.example.com/*'] })).toBe(false);
    shim.port.setSiteAccess(ID, { mode: 'on-site', sites: ['https://a.example.com'], sessionSites: [] });
    expect(shim.grants.get(ID)?.contains({ permissions: [], origins: ['https://a.example.com/*'] })).toBe(true);
  });

  it('ignores a choice for an extension that is not attached', () => {
    const shim = createExtensionShim();
    expect(() => shim.port.setSiteAccess(ID, { mode: 'all-sites', sites: [], sessionSites: [] })).not.toThrow();
    expect(shim.grants.has(ID)).toBe(false);
  });
});
