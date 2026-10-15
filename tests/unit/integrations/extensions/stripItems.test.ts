import { describe, expect, it } from 'vitest';
import {
  buildExtensionStripItems,
  type StripBuildOptions,
  type StripRecord,
} from '@/common/integrations/extensions/stripItems';
import { defaultSiteAccessConfig, type SiteAccessConfig } from '@/common/integrations/extensions/siteAccess';

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const record = (extensionId: string, extra: Partial<StripRecord> = {}): StripRecord => ({
  extensionId,
  packageId: 'com.test.pkg',
  connectionId: `ext-${extensionId.slice(0, 2)}`,
  ...extra,
});

const options = (overrides: Partial<StripBuildOptions> = {}): StripBuildOptions => ({
  activeOrigin: undefined,
  configOf: () => defaultSiteAccessConfig([]),
  isPinned: () => false,
  ...overrides,
});

const withConfig =
  (config: SiteAccessConfig): StripBuildOptions['configOf'] =>
  () =>
    config;

describe('buildExtensionStripItems', () => {
  it('turns records into items sorted by name, with normalised surfaces and the package and connection', () => {
    const items = buildExtensionStripItems(
      [record(ID_A, { name: 'Zed', version: '2.0', surfaces: ['browser'] }), record(ID_B, { name: 'Alpha' })],
      options()
    );
    expect(items).toEqual([
      {
        id: ID_B,
        packageId: 'com.test.pkg',
        connectionId: 'ext-bb',
        name: 'Alpha',
        surfaces: ['none'],
        needsAccess: false,
        pinned: false,
        siteAccess: 'all-sites',
        canAllowSite: false,
      },
      {
        id: ID_A,
        packageId: 'com.test.pkg',
        connectionId: 'ext-aa',
        name: 'Zed',
        version: '2.0',
        surfaces: ['browser'],
        needsAccess: false,
        pinned: false,
        siteAccess: 'all-sites',
        canAllowSite: false,
      },
    ]);
  });

  it('falls back to the id when the name is missing or blank', () => {
    const items = buildExtensionStripItems([record(ID_A, { name: '   ' })], options());
    expect(items[0]?.name).toBe(ID_A);
  });

  it('asks for an optional site only while the active tab is on that site', () => {
    const base = record(ID_A, { name: 'Reader', siteAccess: [], optionalSiteAccess: ['https://news.test/*'] });
    const at = (origin: string | undefined): boolean | undefined =>
      buildExtensionStripItems([base], options({ activeOrigin: origin }))[0]?.needsAccess;
    expect(at('https://news.test')).toBe(true);
    expect(at('https://other.test')).toBe(false);
    expect(at(undefined)).toBe(false);
  });

  it('asks for a broad site under on click, offers "allow on this site", and stops asking under all sites', () => {
    const base = record(ID_A, { name: 'Ad blocker', siteAccess: ['<all_urls>'], optionalSiteAccess: [] });
    const onClick = buildExtensionStripItems(
      [base],
      options({
        activeOrigin: 'https://news.test',
        configOf: withConfig({ mode: 'on-click', sites: [], sessionSites: [] }),
      })
    )[0];
    expect(onClick).toMatchObject({ needsAccess: true, canAllowSite: true, siteAccess: 'on-click' });

    const allSites = buildExtensionStripItems(
      [base],
      options({
        activeOrigin: 'https://news.test',
        configOf: withConfig({ mode: 'all-sites', sites: [], sessionSites: [] }),
      })
    )[0];
    expect(allSites).toMatchObject({ needsAccess: false, canAllowSite: false, siteAccess: 'all-sites' });
  });

  it('does not ask for a site the person already allowed, and refuses a saved site outside the manifest', () => {
    const base = record(ID_A, { name: 'Ad blocker', siteAccess: ['<all_urls>'], optionalSiteAccess: [] });
    const saved = buildExtensionStripItems(
      [base],
      options({
        activeOrigin: 'https://news.test',
        configOf: withConfig({ mode: 'on-site', sites: ['https://news.test'], sessionSites: [] }),
      })
    )[0];
    expect(saved?.needsAccess).toBe(false);

    const narrow = record(ID_B, { name: 'GitHub only', siteAccess: ['https://github.com/*'], optionalSiteAccess: [] });
    const forged = buildExtensionStripItems(
      [narrow],
      options({
        activeOrigin: 'https://evil.test',
        configOf: withConfig({ mode: 'on-site', sites: ['https://evil.test'], sessionSites: ['https://evil.test'] }),
      })
    )[0];
    expect(forged).toMatchObject({ needsAccess: false, canAllowSite: false });
  });

  it('carries the pin state and the icon into the item', () => {
    const items = buildExtensionStripItems(
      [record(ID_A, { name: 'Pinned', iconDataUrl: 'data:image/png;base64,iVBORw0KGgo=' })],
      options({ isPinned: (id) => id === ID_A })
    );
    expect(items[0]).toMatchObject({ pinned: true, iconDataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
  });

  it('keeps the first record of a duplicated id', () => {
    const items = buildExtensionStripItems(
      [record(ID_A, { name: 'First' }), record(ID_A, { name: 'Second' })],
      options()
    );
    expect(items.map((item) => item.name)).toEqual(['First']);
  });

  it('returns an empty list for no records', () => {
    expect(buildExtensionStripItems([], options({ activeOrigin: 'https://x.test' }))).toEqual([]);
  });
});
