import { describe, expect, it } from 'vitest';
import {
  originCoveredBy,
  parseMatchPattern,
  urlCoveredBy,
} from '@process/integrations/browserExtensions/api/matchPattern';

describe('parseMatchPattern', () => {
  it.each([
    '<all_urls>',
    '*://*/*',
    'https://*.example.com/*',
    'https://example.com/a/*',
    'http://localhost:8080/*',
    'http://localhost:*/*',
    'file:///*',
    'https://[::1]/*',
  ])('accepts %s', (pattern) => {
    expect(parseMatchPattern(pattern)).toBeDefined();
  });

  it.each([
    '',
    'example.com',
    'https://example.com',
    'javascript://x/*',
    'https:///*',
    'file://host/*',
    'https://exa mple.com/*',
  ])('refuses %j', (pattern) => {
    expect(parseMatchPattern(pattern)).toBeUndefined();
  });

  it('refuses a pattern that is too long', () => {
    expect(parseMatchPattern(`https://example.com/${'a'.repeat(600)}`)).toBeUndefined();
  });
});

describe('originCoveredBy', () => {
  it('lets a wildcard host cover its subdomains and itself', () => {
    expect(originCoveredBy(['https://*.example.com/*'], 'https://example.com/*')).toBe(true);
    expect(originCoveredBy(['https://*.example.com/*'], 'https://a.b.example.com/*')).toBe(true);
    expect(originCoveredBy(['https://*.example.com/*'], 'https://*.a.example.com/*')).toBe(true);
    expect(originCoveredBy(['https://*.example.com/*'], 'https://badexample.com/*')).toBe(false);
    expect(originCoveredBy(['https://*.example.com/*'], 'https://example.com.evil.test/*')).toBe(false);
  });

  it('does not let an exact host cover a wildcard or another scheme', () => {
    expect(originCoveredBy(['https://example.com/*'], 'https://*.example.com/*')).toBe(false);
    expect(originCoveredBy(['https://example.com/*'], 'http://example.com/*')).toBe(false);
    expect(originCoveredBy(['https://example.com/*'], '*://example.com/*')).toBe(false);
  });

  it('treats the * scheme as http and https only, and <all_urls> as everything', () => {
    expect(originCoveredBy(['*://*/*'], 'https://a.test/*')).toBe(true);
    expect(originCoveredBy(['*://*/*'], 'file:///*')).toBe(false);
    expect(originCoveredBy(['*://*/*'], '<all_urls>')).toBe(false);
    expect(originCoveredBy(['<all_urls>'], 'file:///*')).toBe(true);
    expect(originCoveredBy(['<all_urls>'], '<all_urls>')).toBe(true);
    expect(originCoveredBy(['https://*/*'], '<all_urls>')).toBe(false);
  });

  it('matches paths, and a wildcard in the request needs a granted /*', () => {
    expect(originCoveredBy(['https://example.com/a/*'], 'https://example.com/a/b')).toBe(true);
    expect(originCoveredBy(['https://example.com/a/*'], 'https://example.com/b')).toBe(false);
    expect(originCoveredBy(['https://example.com/a/*'], 'https://example.com/*')).toBe(false);
    expect(originCoveredBy(['https://example.com/*'], 'https://example.com/*')).toBe(true);
  });

  it('respects ports', () => {
    expect(originCoveredBy(['http://localhost:8080/*'], 'http://localhost:8080/*')).toBe(true);
    expect(originCoveredBy(['http://localhost:8080/*'], 'http://localhost:9090/*')).toBe(false);
    expect(originCoveredBy(['http://localhost/*'], 'http://localhost:9090/*')).toBe(true);
  });

  it('never covers an unparsable request or uses an unparsable grant', () => {
    expect(originCoveredBy(['<all_urls>'], 'nonsense')).toBe(false);
    expect(originCoveredBy(['nonsense'], 'https://example.com/*')).toBe(false);
    expect(originCoveredBy([], 'https://example.com/*')).toBe(false);
  });

  it('matches long paths without blowing up', () => {
    const grant = `https://example.com/${'*a'.repeat(200)}`;
    const request = `https://example.com/${'a'.repeat(300)}b`;
    const started = Date.now();
    expect(originCoveredBy([grant], request)).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('urlCoveredBy', () => {
  const granted = ['https://*.example.com/*', 'http://localhost:3000/app/*'];

  it('covers concrete urls the pattern matches, after normalizing them', () => {
    expect(urlCoveredBy(granted, 'https://a.example.com/x?y=1#frag')).toBe(true);
    expect(urlCoveredBy(granted, 'HTTPS://A.EXAMPLE.COM:443/')).toBe(true);
    expect(urlCoveredBy(granted, 'http://localhost:3000/app/page')).toBe(true);
    expect(urlCoveredBy(['<all_urls>'], 'https://anything.test/')).toBe(true);
  });

  it('does not cover other hosts, schemes, ports or paths', () => {
    expect(urlCoveredBy(granted, 'https://example.org/')).toBe(false);
    expect(urlCoveredBy(granted, 'https://evil-example.com/')).toBe(false);
    expect(urlCoveredBy(granted, 'http://a.example.com/')).toBe(false);
    expect(urlCoveredBy(granted, 'http://localhost:3001/app/page')).toBe(false);
    expect(urlCoveredBy(granted, 'http://localhost:3000/other')).toBe(false);
  });

  it('never covers what is not a plain web or file url', () => {
    for (const url of [
      '',
      'nonsense',
      'javascript:alert(1)',
      'chrome://settings',
      'data:text/html,x',
      'https://u:p@a.example.com/',
    ]) {
      expect(urlCoveredBy(['<all_urls>'], url), url).toBe(false);
    }
    expect(urlCoveredBy([], 'https://a.example.com/')).toBe(false);
  });
});
