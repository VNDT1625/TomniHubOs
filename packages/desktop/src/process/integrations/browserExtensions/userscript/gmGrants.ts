/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which `GM_*` functions v1 provides, and which hosts `GM_xmlhttpRequest` may reach (docs/platform/repotopackage-design.md
 * section 12.4). Pure.
 *
 * - A grant outside the v1 subset (`GM.*`, `GM_openInTab`, `unsafeWindow`, ...) is not provided and is reported.
 * - `GM_xmlhttpRequest` needs at least one usable `@connect`. `*`, `self`, `localhost`, private and loopback
 *   addresses and local names are refused: the request leaves through the extension with the site access the person
 *   approves, so an open or internal target would turn the script into a proxy into the user's network (SSRF).
 *   Without a usable `@connect` the function is left out, not widened.
 */

import type { UserscriptNote } from '@process/integrations/browserExtensions/userscript/types';

export const SUPPORTED_GRANTS = [
  'GM_getValue',
  'GM_setValue',
  'GM_deleteValue',
  'GM_listValues',
  'GM_addStyle',
  'GM_log',
  'GM_setClipboard',
  'GM_xmlhttpRequest',
  'GM_info',
] as const;

export type SupportedGrant = (typeof SUPPORTED_GRANTS)[number];

/** The order the generated wrapper passes the functions in, and the names the script sees as locals. */
export const GM_PARAMETER_NAMES: readonly SupportedGrant[] = SUPPORTED_GRANTS;

const SUPPORTED: ReadonlySet<string> = new Set(SUPPORTED_GRANTS);
const VALUE_GRANTS: ReadonlySet<string> = new Set(['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues']);

export const needsStorage = (granted: readonly SupportedGrant[]): boolean =>
  granted.some((grant) => VALUE_GRANTS.has(grant));

export type GrantPlan = Readonly<{
  granted: readonly SupportedGrant[];
  notes: readonly UserscriptNote[];
}>;

/** Splits the declared `@grant` list into what v1 provides and what it does not. */
export const resolveGrants = (declared: readonly string[]): GrantPlan => {
  const wanted = new Set<string>();
  const notes: UserscriptNote[] = [];
  for (const grant of declared) {
    if (grant === 'none') continue;
    if (SUPPORTED.has(grant)) {
      wanted.add(grant);
    } else {
      notes.push({
        code: 'grant-unsupported',
        message: `@grant ${grant.slice(0, 100)} chưa được Tomny hỗ trợ ở bản v1 nên không được cung cấp.`,
      });
    }
  }
  return { granted: SUPPORTED_GRANTS.filter((grant) => wanted.has(grant)), notes };
};

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const LOCAL_SUFFIXES: readonly string[] = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet'];

const isPublicIpv4 = (parts: readonly number[]): boolean => {
  const [a = 0, b = 0] = parts;
  if (parts.some((part) => part > 255)) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  return true;
};

export type ConnectPlan = Readonly<{
  /** Lower-case host names the background worker may reach (a name also covers its subdomains; an IP is exact). */
  hosts: readonly string[];
  /** Manifest `host_permissions` for those hosts. */
  hostPermissions: readonly string[];
  notes: readonly UserscriptNote[];
}>;

/** Converts `@connect` values to hosts and `host_permissions`; unusable values are dropped with a note. */
export const resolveConnects = (declared: readonly string[]): ConnectPlan => {
  const hosts: string[] = [];
  const notes: UserscriptNote[] = [];
  const refuse = (value: string, why: string): void => {
    notes.push({ code: 'connect-unsupported', message: `@connect ${value.slice(0, 100)} bị bỏ qua: ${why}` });
  };
  for (const value of declared) {
    const host = value.trim().toLowerCase().replace(/\.$/, '');
    if (host === '*' || host === 'self') {
      refuse(value, 'v1 không cho phép kết nối mở hoặc tới chính trang đang chạy.');
    } else if (host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      refuse(value, 'không cho phép tên máy cục bộ.');
    } else if (host.includes(':') || host.includes('[')) {
      refuse(value, 'không cho phép địa chỉ IPv6 hoặc cổng.');
    } else if (IPV4.test(host)) {
      const parts = host.split('.').map(Number);
      if (isPublicIpv4(parts)) hosts.push(host);
      else refuse(value, 'không cho phép địa chỉ IP cục bộ hoặc nội bộ.');
    } else if (
      host.length <= 253 &&
      host.includes('.') &&
      host.split('.').every((label) => HOST_LABEL.test(label)) &&
      !/^[\d.]+$/.test(host)
    ) {
      hosts.push(host);
    } else {
      refuse(value, 'không phải tên miền hợp lệ.');
    }
  }
  const unique = [...new Set(hosts)];
  const hostPermissions = unique.flatMap((host) =>
    IPV4.test(host) ? [`*://${host}/*`] : [`*://${host}/*`, `*://*.${host}/*`]
  );
  return { hosts: unique, hostPermissions, notes };
};
