/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Chrome match patterns for `host_permissions` and `chrome.permissions` origins (pure, no Electron).
 *
 * The only question the shim asks is "does a granted pattern cover a requested pattern", and every doubt resolves to
 * "no": an unparsable pattern covers nothing, a path with a wildcard in the request is covered only by a granted
 * `/*`, and a `*` scheme in a request is covered only by a granted `*` scheme or `<all_urls>`.
 */

const SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'ftp', 'file', 'ws', 'wss']);
const MAX_PATTERN_LENGTH = 500;
const HOST = /^(?:\*|\*\.[a-z0-9.-]+|[a-z0-9.-]+|\[[0-9a-f:.]+\])$/;

export type MatchPattern = Readonly<{
  /** A concrete scheme, `*` (http and https), or `<all_urls>`. */
  scheme: string;
  host: string;
  /** `*` or a decimal port; `*` when the pattern names none. */
  port: string;
  path: string;
}>;

export const ALL_URLS = '<all_urls>';

/** Parses one pattern, or returns undefined when it is not a pattern Chrome would accept. */
export const parseMatchPattern = (value: string): MatchPattern | undefined => {
  if (value.length === 0 || value.length > MAX_PATTERN_LENGTH) return undefined;
  if (value === ALL_URLS) return { scheme: ALL_URLS, host: '*', port: '*', path: '/*' };
  const split = /^(\*|[a-z]+):\/\/([^/]*)(\/.*)$/.exec(value);
  if (split === null) return undefined;
  const [, scheme = '', authority = '', path = ''] = split;
  if (scheme !== '*' && !SCHEMES.has(scheme)) return undefined;
  if (scheme === 'file') return authority === '' ? { scheme, host: '', port: '*', path } : undefined;
  const portSplit = /^(.*?)(?::(\*|\d{1,5}))?$/.exec(authority);
  const host = portSplit?.[1] ?? '';
  const port = portSplit?.[2] ?? '*';
  if (host === '' || !HOST.test(host)) return undefined;
  return { scheme, host, port, path };
};

/** Standard wildcard match, `*` only, linear memory and no backtracking blow-up. */
const globMatch = (pattern: string, text: string): boolean => {
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p;
      resume = t;
      p += 1;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p += 1;
      t += 1;
    } else if (star !== -1) {
      p = star + 1;
      resume += 1;
      t = resume;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
};

const schemeCovers = (granted: string, requested: string): boolean => {
  if (granted === ALL_URLS) return true;
  if (requested === ALL_URLS) return false;
  if (granted === '*') return requested === '*' || requested === 'http' || requested === 'https';
  return granted === requested;
};

const hostCovers = (granted: string, requested: string): boolean => {
  if (granted === '*') return true;
  if (requested === '*') return false;
  if (granted.startsWith('*.')) {
    const suffix = granted.slice(2);
    const base = requested.startsWith('*.') ? requested.slice(2) : requested;
    return base === suffix || base.endsWith(`.${suffix}`);
  }
  return granted === requested;
};

/** True when everything the requested pattern matches is also matched by the granted one. */
export const patternCovers = (granted: MatchPattern, requested: MatchPattern): boolean => {
  if (!schemeCovers(granted.scheme, requested.scheme)) return false;
  if (requested.scheme === ALL_URLS) return granted.scheme === ALL_URLS;
  if (!hostCovers(granted.host, requested.host)) return false;
  if (granted.port !== '*' && granted.port !== requested.port) return false;
  if (granted.path === '/*') return true;
  return !requested.path.includes('*') && globMatch(granted.path, requested.path);
};

/** True when some granted pattern covers the requested one. Unparsable input is never covered. */
export const originCoveredBy = (grantedPatterns: readonly string[], requested: string): boolean => {
  const wanted = parseMatchPattern(requested);
  if (wanted === undefined) return false;
  return grantedPatterns.some((granted) => {
    const parsed = parseMatchPattern(granted);
    return parsed !== undefined && patternCovers(parsed, wanted);
  });
};

/**
 * True when some granted pattern matches this concrete URL. The URL is normalized first, so the scheme, host and
 * path that are compared are the ones the browser would use; a URL that does not parse, or has user info, is never
 * covered. Only the web schemes and `file` can be covered.
 */
export const urlCoveredBy = (grantedPatterns: readonly string[], url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username !== '' || parsed.password !== '') return false;
  const scheme = parsed.protocol.slice(0, -1);
  if (!SCHEMES.has(scheme)) return false;
  const host = parsed.hostname.toLowerCase();
  if (scheme !== 'file' && host === '') return false;
  const authority = scheme === 'file' ? '' : parsed.port === '' ? host : `${host}:${parsed.port}`;
  return originCoveredBy(grantedPatterns, `${scheme}://${authority}${parsed.pathname}${parsed.search}`);
};
