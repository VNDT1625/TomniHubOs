import { describe, expect, it } from 'vitest';
import {
  defaultSiteAccessMode,
  effectiveSiteAccess,
  isBroadPattern,
  isGrantableOrigin,
  isWebOrigin,
  needsSiteAccess,
  sanitizeSites,
  webOriginOf,
  type SiteAccessConfig,
} from '@/common/integrations/extensions/siteAccess';

const config = (partial: Partial<SiteAccessConfig>): SiteAccessConfig => ({
  mode: 'on-click',
  sites: [],
  sessionSites: [],
  ...partial,
});

describe('broad host permissions', () => {
  it('treats every-site patterns as broad and named sites as narrow', () => {
    expect(isBroadPattern('<all_urls>')).toBe(true);
    expect(isBroadPattern('*://*/*')).toBe(true);
    expect(isBroadPattern('https://*/*')).toBe(true);
    expect(isBroadPattern('https://*.example.com/*')).toBe(false);
    expect(isBroadPattern('https://github.com/*')).toBe(false);
  });

  it('defaults broad access to on click and anything narrower to all sites', () => {
    expect(defaultSiteAccessMode(['<all_urls>'])).toBe('on-click');
    expect(defaultSiteAccessMode(['https://github.com/*'])).toBe('all-sites');
    expect(defaultSiteAccessMode([])).toBe('all-sites');
  });
});

describe('origins', () => {
  it('reads the origin of a web URL and refuses every other scheme', () => {
    expect(webOriginOf('https://a.test:8443/x?y#z')).toBe('https://a.test:8443');
    expect(webOriginOf('https://user:pw@a.test/path')).toBe('https://a.test');
    expect(webOriginOf('file:///C:/secret.txt')).toBeUndefined();
    expect(webOriginOf('chrome://settings')).toBeUndefined();
    expect(webOriginOf('javascript:alert(1)')).toBeUndefined();
    expect(webOriginOf('not a url')).toBeUndefined();
  });

  it('accepts only plain web origins, never wildcards, paths or credentials', () => {
    expect(isWebOrigin('https://a.test')).toBe(true);
    expect(isWebOrigin('http://[::1]:8080')).toBe(true);
    expect(isWebOrigin('https://a.test/path')).toBe(false);
    expect(isWebOrigin('https://a.test?x=1')).toBe(false);
    expect(isWebOrigin('https://a.test@evil.test')).toBe(false);
    expect(isWebOrigin('https://*')).toBe(false);
    expect(isWebOrigin('https://*.test')).toBe(false);
    expect(isWebOrigin('wss://a.test')).toBe(false);
  });

  it('grants an origin only when the manifest declares a pattern that covers it', () => {
    // Pattern wider than the manifest: a narrow declaration does not cover another site.
    expect(isGrantableOrigin('https://evil.test', ['https://news.test/*'], [])).toBe(false);
    expect(isGrantableOrigin('https://news.test', ['https://news.test/*'], [])).toBe(true);
    expect(isGrantableOrigin('https://x.example.com', [], ['https://*.example.com/*'])).toBe(true);
    expect(isGrantableOrigin('https://example.org', [], ['https://*.example.com/*'])).toBe(false);
    expect(isGrantableOrigin('https://a.test', ['<all_urls>'], [])).toBe(true);
    expect(isGrantableOrigin('https://*', ['<all_urls>'], [])).toBe(false);
  });

  it('keeps only valid, unique origins of a stored list', () => {
    expect(sanitizeSites(['https://a.test', 'https://a.test', 'https://*', 'javascript:x', 7])).toEqual([
      'https://a.test',
    ]);
    expect(sanitizeSites('not a list')).toEqual([]);
  });
});

describe('effective site access', () => {
  it('withholds a broad host permission under on click and offers it to request', () => {
    const view = effectiveSiteAccess({
      declared: ['<all_urls>', 'https://github.com/*'],
      optional: [],
      config: config({ mode: 'on-click' }),
    });
    expect(view.active).toEqual(['https://github.com/*']);
    expect(view.requestable).toEqual(['<all_urls>']);
  });

  it('activates a broad host permission only under all sites', () => {
    const view = effectiveSiteAccess({
      declared: ['<all_urls>'],
      optional: [],
      config: config({ mode: 'all-sites' }),
    });
    expect(view.active).toEqual(['<all_urls>']);
  });

  it('activates only the saved sites under on site, and drops those the manifest does not cover', () => {
    const view = effectiveSiteAccess({
      declared: ['<all_urls>'],
      optional: [],
      config: config({ mode: 'on-site', sites: ['https://a.test', 'https://evil-but-broad.test'] }),
    });
    expect(view.active).toEqual(['https://a.test/*', 'https://evil-but-broad.test/*']);
    // A saved site that the manifest does not cover at all is never active.
    const narrow = effectiveSiteAccess({
      declared: ['https://news.test/*'],
      optional: [],
      config: config({ mode: 'on-site', sites: ['https://evil.test'] }),
    });
    expect(narrow.active).toEqual(['https://news.test/*']);
  });

  it('ignores saved sites outside on site mode, and keeps the run grants of on click', () => {
    const view = effectiveSiteAccess({
      declared: ['<all_urls>'],
      optional: [],
      config: config({ mode: 'on-click', sites: ['https://a.test'], sessionSites: ['https://b.test'] }),
    });
    expect(view.active).toEqual(['https://b.test/*']);
  });
});

describe('needsSiteAccess with the effective view', () => {
  it('asks for the active site under on click and stops asking once it is allowed', () => {
    const declared = ['<all_urls>'];
    const asked = effectiveSiteAccess({ declared, optional: [], config: config({ mode: 'on-click' }) });
    const base = { activeOrigin: 'https://news.test', optionalSiteAccess: asked.requestable, grantedOrigins: [] };
    expect(needsSiteAccess({ ...base, siteAccess: asked.active })).toBe(true);

    const allowed = effectiveSiteAccess({
      declared,
      optional: [],
      config: config({ mode: 'on-click', sessionSites: ['https://news.test'] }),
    });
    expect(needsSiteAccess({ ...base, siteAccess: allowed.active })).toBe(false);
  });
});
