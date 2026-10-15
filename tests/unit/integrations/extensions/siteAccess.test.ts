import { describe, expect, it } from 'vitest';
import {
  buildPopupSections,
  needsSiteAccess,
  originCoveredBy,
  originMatchesPattern,
} from '@/common/integrations/extensions/siteAccess';

describe('originMatchesPattern', () => {
  it('matches an exact host and scheme', () => {
    expect(originMatchesPattern('https://example.com/*', 'https://example.com')).toBe(true);
    expect(originMatchesPattern('https://example.com/*', 'http://example.com')).toBe(false);
    expect(originMatchesPattern('https://example.com/*', 'https://sub.example.com')).toBe(false);
  });

  it('matches subdomains and the bare domain for *.host patterns', () => {
    expect(originMatchesPattern('https://*.example.com/*', 'https://a.example.com')).toBe(true);
    expect(originMatchesPattern('https://*.example.com/*', 'https://example.com')).toBe(true);
    expect(originMatchesPattern('https://*.example.com/*', 'https://notexample.com')).toBe(false);
  });

  it('matches any host for * and any web scheme for a * scheme', () => {
    expect(originMatchesPattern('https://*/*', 'https://anything.test')).toBe(true);
    expect(originMatchesPattern('*://*.example.com/*', 'http://example.com')).toBe(true);
    expect(originMatchesPattern('*://*.example.com/*', 'file://example.com')).toBe(false);
  });

  it('covers every web origin for <all_urls> and nothing else', () => {
    expect(originMatchesPattern('<all_urls>', 'https://x.test')).toBe(true);
    expect(originMatchesPattern('<all_urls>', 'file://local')).toBe(false);
  });

  it('compares hosts case-insensitively and keeps ports', () => {
    expect(originMatchesPattern('http://localhost:3000/*', 'http://LOCALHOST:3000')).toBe(true);
    expect(originMatchesPattern('http://localhost:3000/*', 'http://localhost:4000')).toBe(false);
  });

  it('refuses malformed patterns and origins', () => {
    expect(originMatchesPattern('example.com', 'https://example.com')).toBe(false);
    expect(originMatchesPattern('https://example.com/*', 'example.com')).toBe(false);
    expect(originMatchesPattern('https://example.com/*', 'https://example.com/path')).toBe(false);
  });

  it('is true when any pattern in the list covers the origin', () => {
    expect(originCoveredBy(['https://a.test/*', 'https://b.test/*'], 'https://b.test')).toBe(true);
    expect(originCoveredBy([], 'https://b.test')).toBe(false);
  });
});

describe('needsSiteAccess (rule: access requested per active tab)', () => {
  const base = {
    activeOrigin: 'https://news.test',
    siteAccess: [] as string[],
    optionalSiteAccess: ['https://news.test/*'],
    grantedOrigins: [] as string[],
  };

  it('is true when the active site is optional and not granted', () => {
    expect(needsSiteAccess(base)).toBe(true);
  });

  it('is false without a web tab', () => {
    expect(needsSiteAccess({ ...base, activeOrigin: undefined })).toBe(false);
  });

  it('is false when the manifest already gives access to the site', () => {
    expect(needsSiteAccess({ ...base, siteAccess: ['<all_urls>'] })).toBe(false);
  });

  it('is false once the person granted the site', () => {
    expect(needsSiteAccess({ ...base, grantedOrigins: ['https://news.test/*'] })).toBe(false);
  });

  it('is false when the site is not among the optional ones', () => {
    expect(needsSiteAccess({ ...base, activeOrigin: 'https://other.test' })).toBe(false);
  });
});

describe('buildPopupSections', () => {
  const entries = [
    { id: 'z', name: 'Zeta', surfaces: ['browser'], needsAccess: false },
    { id: 'a', name: 'Alpha', surfaces: ['none'], needsAccess: true },
    { id: 'h', name: 'Hub only', surfaces: ['hub'], needsAccess: false },
    { id: 'b', name: 'Beta', surfaces: ['browser'], needsAccess: true },
    { id: 'c', name: 'Gamma', surfaces: ['browser'], needsAccess: false },
  ];

  it('splits visible entries into full access and access requested, sorted by name', () => {
    const sections = buildPopupSections(entries, 'browser');
    expect(sections.fullAccess.map((entry) => entry.name)).toEqual(['Gamma', 'Zeta']);
    expect(sections.accessRequested.map((entry) => entry.name)).toEqual(['Alpha', 'Beta']);
  });

  it('drops entries that do not show on the surface', () => {
    const sections = buildPopupSections(entries, 'hub');
    expect(sections.fullAccess.map((entry) => entry.name)).toEqual(['Hub only']);
    expect(sections.accessRequested.map((entry) => entry.name)).toEqual(['Alpha']);
  });

  it('returns empty sections for an empty list', () => {
    expect(buildPopupSections([], 'browser')).toEqual({ fullAccess: [], accessRequested: [] });
  });
});
