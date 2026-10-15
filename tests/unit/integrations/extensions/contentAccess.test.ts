import { describe, expect, it } from 'vitest';
import {
  applySiteAccessToManifest,
  declaredSiteAccessOf,
  isValidMatchPattern,
} from '@/common/integrations/extensions/contentAccess';
import {
  isBroadPattern,
  type SiteAccessConfig,
  type SiteAccessMode,
} from '@/common/integrations/extensions/siteAccess';

const config = (mode: SiteAccessMode, sites: string[] = [], sessionSites: string[] = []): SiteAccessConfig => ({
  mode,
  sites,
  sessionSites,
});

const BROAD_MV3 = {
  manifest_version: 3,
  name: 'Broad',
  version: '1.0.0',
  host_permissions: ['<all_urls>', 'https://github.com/*'],
  content_scripts: [
    { matches: ['<all_urls>'], js: ['all.js'] },
    { matches: ['https://news.example.org/*'], js: ['news.js'] },
  ],
};

describe('match pattern validation and broadness', () => {
  it('accepts Chrome match patterns and refuses the malformed ones', () => {
    for (const ok of ['<all_urls>', '*://*/*', 'https://*.example.com/*', 'https://github.com/x/*', 'ftp://h.io/*']) {
      expect(isValidMatchPattern(ok)).toBe(true);
    }
    for (const bad of ['https://*.example.*/*', 'http://localhost:8080/*', 'https://a.com', 'https://*', 'nope']) {
      expect(isValidMatchPattern(bad)).toBe(false);
    }
  });

  it('counts a wildcard top-level domain as broad, a two-label wildcard as narrow', () => {
    expect(isBroadPattern('*://*.com/*')).toBe(true);
    expect(isBroadPattern('https://*.example.com/*')).toBe(false);
  });

  it('lists declared sites from host permissions and content scripts without repeats', () => {
    expect(
      declaredSiteAccessOf({
        hostPermissions: ['https://a.test/*'],
        contentScriptMatches: ['<all_urls>', 'https://a.test/*'],
      })
    ).toEqual(['https://a.test/*', '<all_urls>']);
  });
});

describe('applySiteAccessToManifest', () => {
  it('on-click removes broad host and content script patterns and keeps the narrow ones', () => {
    const { manifest, notes } = applySiteAccessToManifest(BROAD_MV3, config('on-click'));
    expect(manifest.host_permissions).toEqual(['https://github.com/*']);
    expect(manifest.content_scripts).toEqual([{ matches: ['https://news.example.org/*'], js: ['news.js'] }]);
    expect(notes).toEqual([]);
  });

  it('all-sites keeps the manifest as declared', () => {
    const { manifest, notes } = applySiteAccessToManifest(BROAD_MV3, config('all-sites'));
    expect(manifest).toEqual(BROAD_MV3);
    expect(notes).toEqual([]);
  });

  it('on-site keeps only the granted origins from a broad pattern (intersection, not the whole web)', () => {
    const { manifest } = applySiteAccessToManifest(BROAD_MV3, config('on-site', ['https://a.example.com']));
    expect(manifest.host_permissions).toEqual(['https://github.com/*', 'https://a.example.com/*']);
    expect(manifest.content_scripts).toEqual([
      { matches: ['https://a.example.com/*'], js: ['all.js'] },
      { matches: ['https://news.example.org/*'], js: ['news.js'] },
    ]);
  });

  it('never widens: a granted origin no declared broad pattern covers is not added', () => {
    const narrow = {
      manifest_version: 3,
      name: 'Narrow',
      version: '1',
      host_permissions: ['https://*.example.com/*'],
      content_scripts: [{ matches: ['https://*.example.com/*'], js: ['a.js'] }],
    };
    const { manifest } = applySiteAccessToManifest(
      narrow,
      config('on-site', ['https://evil.test', 'https://a.example.com'])
    );
    expect(manifest.host_permissions).toEqual(['https://*.example.com/*']);
    expect(manifest.content_scripts).toEqual([{ matches: ['https://*.example.com/*'], js: ['a.js'] }]);
  });

  it('does not grant a path-restricted broad pattern as the whole origin', () => {
    const pathBound = {
      manifest_version: 3,
      name: 'Path',
      version: '1',
      content_scripts: [{ matches: ['https://*/foo/*'], js: ['a.js'] }],
    };
    const { manifest } = applySiteAccessToManifest(pathBound, config('on-site', ['https://a.example.com']));
    expect(manifest.content_scripts).toEqual([]);
  });

  it('a this-run grant under on-click activates only the granted origin', () => {
    const { manifest } = applySiteAccessToManifest(BROAD_MV3, config('on-click', [], ['https://b.example.org']));
    expect(manifest.host_permissions).toEqual(['https://github.com/*', 'https://b.example.org/*']);
    expect(manifest.content_scripts).toEqual([
      { matches: ['https://b.example.org/*'], js: ['all.js'] },
      { matches: ['https://news.example.org/*'], js: ['news.js'] },
    ]);
  });

  it('ignores saved sites while on-click, because they only count under on-site', () => {
    const { manifest } = applySiteAccessToManifest(BROAD_MV3, config('on-click', ['https://a.example.com']));
    expect(manifest.host_permissions).toEqual(['https://github.com/*']);
  });

  it('a port cannot be granted in a match pattern, so the grant is skipped without a note', () => {
    const { manifest, notes } = applySiteAccessToManifest(BROAD_MV3, config('on-site', ['http://localhost:8080']));
    expect(manifest.host_permissions).toEqual(['https://github.com/*']);
    expect(notes).toEqual([]);
  });

  it('skips a content script whose matches are malformed, and notes it; the others stay', () => {
    const source = {
      manifest_version: 3,
      name: 'Bad',
      version: '1',
      content_scripts: [
        { matches: ['https://*.example.*/*'], js: ['bad.js'] },
        { matches: ['https://news.example.org/*'], js: ['news.js'] },
      ],
    };
    const { manifest, notes } = applySiteAccessToManifest(source, config('all-sites'));
    expect(manifest.content_scripts).toEqual([{ matches: ['https://news.example.org/*'], js: ['news.js'] }]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('không hợp lệ');
  });

  it('drops a malformed host permission and notes it', () => {
    const source = {
      manifest_version: 3,
      name: 'H',
      version: '1',
      host_permissions: ['https://a.test/*', 'http://x:9/*'],
    };
    const { manifest, notes } = applySiteAccessToManifest(source, config('all-sites'));
    expect(manifest.host_permissions).toEqual(['https://a.test/*']);
    expect(notes).toHaveLength(1);
  });

  it('on-click removes broad MV2 host permissions and keeps the API names', () => {
    const v2 = {
      manifest_version: 2,
      name: 'Old',
      version: '1',
      permissions: ['tabs', '<all_urls>', 'https://a.test/*'],
    };
    const { manifest } = applySiteAccessToManifest(v2, config('on-click'));
    expect(manifest.permissions).toEqual(['tabs', 'https://a.test/*']);
  });

  it('does not change the source object it is given', () => {
    const before = JSON.stringify(BROAD_MV3);
    applySiteAccessToManifest(BROAD_MV3, config('on-click', ['https://a.example.com']));
    expect(JSON.stringify(BROAD_MV3)).toBe(before);
  });

  it('keeps the keys it does not touch (key, action, js files)', () => {
    const { manifest } = applySiteAccessToManifest(
      { ...BROAD_MV3, action: { default_popup: 'p.html' } },
      config('on-click')
    );
    expect(manifest.action).toEqual({ default_popup: 'p.html' });
    expect(manifest.name).toBe('Broad');
  });
});
