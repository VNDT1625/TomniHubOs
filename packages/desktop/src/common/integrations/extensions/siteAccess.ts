/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Site access for browser extensions (docs/platform/repotopackage-design.md sections 12.5 and 14 S5). Pure: it decides
 * which sites an extension may use now, which it may ask for, and how the header popup splits its entries. It grants
 * nothing; the person's choice is stored by Main (`userState.ts`) and applied by the Chrome API shim.
 *
 * Rules:
 * - A manifest host permission that matches every site (`<all_urls>`, or a scheme with host `*` and any path) is broad. A broad
 *   permission is withheld until the person picks a mode: `on-click` (default), `on-site` (only sites in the list) or
 *   `all-sites`. A narrow permission (`https://github.com/*`) is always active, as in Chrome.
 * - A grant is an exact web origin (`https://example.com`). It is accepted only when the manifest declares a host
 *   pattern that covers it, required or optional. A grant never widens the manifest.
 */

import { filterForSurface, type StripEntry } from './surface';

const PATTERN = /^(\*|https?|wss?|ftp|file):\/\/(\*|\*\.[^/*]+|[^/*]+)\/.*$/u;
const ORIGIN = /^(https?|wss?|ftp|file):\/\/([^/?#]+)$/u;
const WEB_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'ws', 'wss']);
const WEB_ORIGIN = /^https?:\/\/(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/iu;
const BROAD_HOST = /^(\*|https?|wss?|ftp|file):\/\/(\*|\*\.[^./*]+)\//u;
const MAX_SITES = 200;

/**
 * True when a Chrome-style match pattern (`https://*.example.com/*`, `<all_urls>`) covers the origin
 * (`https://app.example.com`). The path part of the pattern is not compared: the popup works per site. A `*` scheme
 * covers web schemes only, as in Chrome.
 */
export const originMatchesPattern = (pattern: string, origin: string): boolean => {
  const target = ORIGIN.exec(origin);
  if (!target) return false;
  const [, scheme, host] = target;
  if (pattern === '<all_urls>') return WEB_SCHEMES.has(scheme ?? '');
  const match = PATTERN.exec(pattern);
  if (!match) return false;
  const [, patternScheme, patternHost] = match;
  if (patternScheme === '*' ? !WEB_SCHEMES.has(scheme ?? '') : patternScheme !== scheme) return false;
  const actual = (host ?? '').toLowerCase();
  const wanted = (patternHost ?? '').toLowerCase();
  if (wanted === '*') return true;
  if (wanted.startsWith('*.')) {
    const base = wanted.slice(2);
    return actual === base || actual.endsWith(`.${base}`);
  }
  return actual === wanted;
};

/** True when any pattern in the list covers the origin. */
export const originCoveredBy = (patterns: readonly string[], origin: string): boolean =>
  patterns.some((pattern) => originMatchesPattern(pattern, origin));

/** The three levels of site access the person can choose (Chrome's words: on click, on specific sites, all sites). */
export const SITE_ACCESS_MODES = ['on-click', 'on-site', 'all-sites'] as const;
export type SiteAccessMode = (typeof SITE_ACCESS_MODES)[number];

export const isSiteAccessMode = (value: unknown): value is SiteAccessMode =>
  typeof value === 'string' && (SITE_ACCESS_MODES as readonly string[]).includes(value);

/** True for a pattern that matches every site: `<all_urls>`, a host `*`, or a wildcard subdomain of one label (`*.com`). */
export const isBroadPattern = (pattern: string): boolean => pattern === '<all_urls>' || BROAD_HOST.test(pattern);

/** The default mode: `on-click` when the manifest has a broad host permission, otherwise `all-sites` (nothing to pick). */
export const defaultSiteAccessMode = (declared: readonly string[]): SiteAccessMode =>
  declared.some(isBroadPattern) ? 'on-click' : 'all-sites';

/** What the person chose for one extension. `sites` are exact origins used in `on-site`; `sessionSites` last one run. */
export type SiteAccessConfig = Readonly<{
  mode: SiteAccessMode;
  sites: readonly string[];
  sessionSites: readonly string[];
}>;

/** The configuration of an extension nobody has changed yet. */
export const defaultSiteAccessConfig = (declared: readonly string[]): SiteAccessConfig => ({
  mode: defaultSiteAccessMode(declared),
  sites: [],
  sessionSites: [],
});

/** A plain web origin (`https://host` or `https://host:port`): no path, query, fragment or credentials. */
export const isWebOrigin = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 300 && WEB_ORIGIN.test(value);

/** The origin of an http(s) URL as `scheme://host[:port]`, or undefined for any other URL (file, chrome, about...). */
export const webOriginOf = (url: string): string | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  return `${parsed.protocol}//${parsed.host}`;
};

/** The Chrome match pattern that covers exactly one origin. */
export const originPattern = (origin: string): string => `${origin}/*`;

/** True when the origin may be granted: a declared (required or optional) host pattern covers it. */
export const isGrantableOrigin = (origin: string, declared: readonly string[], optional: readonly string[]): boolean =>
  isWebOrigin(origin) && originCoveredBy([...declared, ...optional], origin);

/** Keeps the valid origins of a stored list, in order, without duplicates, and caps the list. */
export const sanitizeSites = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (isWebOrigin(item)) seen.add(item);
    if (seen.size >= MAX_SITES) break;
  }
  return [...seen];
};

export type EffectiveSiteAccess = Readonly<{
  /** Patterns the extension may use now. */
  active: string[];
  /** Patterns the extension may ask for and the person can allow from the popup (optional and broad host permissions). */
  requestable: string[];
}>;

/**
 * Splits the manifest's host permissions into what is active under the person's choice and what can be requested.
 * A grant that the manifest does not cover is dropped here as well, so a stored value can never widen the manifest.
 */
export const effectiveSiteAccess = (
  input: Readonly<{
    declared: readonly string[];
    optional: readonly string[];
    config: SiteAccessConfig;
  }>
): EffectiveSiteAccess => {
  const { declared, optional, config } = input;
  const narrow = declared.filter((pattern) => !isBroadPattern(pattern));
  const broad = declared.filter(isBroadPattern);
  const savedSites = config.mode === 'on-site' ? config.sites : [];
  const grants = [...savedSites, ...config.sessionSites].filter((origin) =>
    isGrantableOrigin(origin, declared, optional)
  );
  const active = [
    ...narrow,
    ...(config.mode === 'all-sites' ? broad : []),
    ...grants.map((origin) => originPattern(origin)),
  ];
  return {
    active: [...new Set(active)],
    requestable: [...new Set([...optional, ...broad])],
  };
};

/** Minimal shape `needsSiteAccess` reads from an extension's site access. */
export type SiteAccessInput = Readonly<{
  /** Origin of the active tab (`https://example.com`), or undefined when there is no web tab. */
  activeOrigin: string | undefined;
  /** Site access the extension has now (from `effectiveSiteAccess().active`). */
  siteAccess: readonly string[];
  /** Site access the extension may ask for later (from `effectiveSiteAccess().requestable`). */
  optionalSiteAccess: readonly string[];
  /** Site access granted in this view but not yet applied to `siteAccess`. */
  grantedOrigins: readonly string[];
}>;

/**
 * "Access requested for this site": the active tab's origin is one the extension may ask for and does not have yet.
 * Judged per active tab, so it is false without a web tab.
 */
export const needsSiteAccess = (input: SiteAccessInput): boolean => {
  const { activeOrigin } = input;
  if (activeOrigin === undefined) return false;
  if (originCoveredBy([...input.siteAccess, ...input.grantedOrigins], activeOrigin)) return false;
  return originCoveredBy(input.optionalSiteAccess, activeOrigin);
};

export type PopupEntry = StripEntry & Readonly<{ name: string; needsAccess: boolean }>;

const byName = <T extends Readonly<{ name: string }>>(left: T, right: T): number => left.name.localeCompare(right.name);

export type PopupSections<T extends PopupEntry> = Readonly<{
  /** Extensions that need no request for the active site. Sorted by name. */
  fullAccess: T[];
  /** Extensions asking for access to the active site. Sorted by name. */
  accessRequested: T[];
}>;

/**
 * Builds the popup's two sections for a surface (rules 3 and 4 apply first). Entries are sorted by name so the order
 * does not depend on the order the host lists them in.
 */
export const buildPopupSections = <T extends PopupEntry>(entries: readonly T[], surface: string): PopupSections<T> => {
  const visible = filterForSurface(entries, surface);
  return {
    fullAccess: visible.filter((entry) => !entry.needsAccess).toSorted(byName),
    accessRequested: visible.filter((entry) => entry.needsAccess).toSorted(byName),
  };
};
