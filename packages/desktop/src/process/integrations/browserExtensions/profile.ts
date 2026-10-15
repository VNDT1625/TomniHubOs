/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Browser profile: the dedicated persistent session used by every Browser tab
 * (design repotopackage-design.md 12.1, decision D9).
 *
 * The Hub window (loaded from `file://`) stays in Electron's default session;
 * Browser tabs and, later, browser extensions live in {@link BROWSER_PROFILE_PARTITION}
 * so a `<all_urls>` content script can never reach the Hub UI.
 *
 * This module owns three things:
 * 1. the partition constant and its session accessor;
 * 2. a one-time cookie copy from the default session (rule set from spike S-4,
 *    design 12.8);
 * 3. a default-deny web permission policy for the profile session (gap G7).
 *
 * Main-process module. No DOM APIs. Pure helpers take injected dependencies so
 * they run under Node without Electron.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app, session } from 'electron';
import type { Session } from 'electron';
import {
  createNativeDownloadConfirm,
  installDownloadGate,
  type DownloadGate,
  type DownloadGateSession,
} from '@process/integrations/profileDownloadGate';

/** Persistent partition shared by all Browser tabs (user and agent). */
export const BROWSER_PROFILE_PARTITION = 'persist:tomny-browser';

/** File name of the "cookies already copied" flag stored in `userData`. */
export const BROWSER_PROFILE_MIGRATION_FLAG_FILE = 'browser-profile-migrated.json';

/** Returns the Electron session backing the Browser profile. */
export const getBrowserProfileSession = (): Session => session.fromPartition(BROWSER_PROFILE_PARTITION);

// ---------------------------------------------------------------------------
// One-time cookie migration (design 12.8, spike S-4)
// ---------------------------------------------------------------------------

/** Cookie as returned by `session.cookies.get` (the fields the copy uses). */
export type ProfileCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  hostOnly?: boolean;
  expirationDate?: number;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
};

/** Details accepted by `session.cookies.set` that the copy produces. */
export type ProfileCookieSetDetails = {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite?: ProfileCookie['sameSite'];
};

/** Read side of a cookie jar. */
export type CookieSource = {
  cookies: { get: (filter: Record<string, never>) => Promise<ProfileCookie[]> };
};

/** Write side of a cookie jar. `flushStore` persists to disk when available. */
export type CookieTarget = {
  cookies: {
    set: (details: ProfileCookieSetDetails) => Promise<void>;
    flushStore?: () => Promise<void>;
  };
};

/** Outcome of {@link migrateCookies}. Counts only: cookie values are never reported. */
export type CookieMigrationResult = {
  status: 'migrated' | 'already-done' | 'disabled';
  copied: number;
  failed: number;
  skipped: number;
};

/** Injected dependencies of {@link migrateCookies}. */
export type MigrateCookiesOptions = {
  source: CookieSource;
  target: CookieTarget;
  /** True when the one-time copy already completed. */
  readFlag: () => Promise<boolean>;
  /** Persists the "done" flag. Called only after the whole batch was attempted. */
  writeFlag: () => Promise<void>;
  /** Set to `false` to skip the copy (user accepts losing logins, D15). Defaults to `true`. */
  enabled?: boolean;
  /** Log sink; receives counts only. Defaults to `console.log`. */
  log?: (message: string) => void;
};

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Strip the leading dot of a cookie domain. */
const hostOfDomain = (domain: string): string => (domain.startsWith('.') ? domain.slice(1) : domain);

/**
 * Cookies of `file://` pages (empty domain) and of the app itself (loopback
 * hosts such as the dev server) are not user-site cookies and are not copied.
 */
const isUserSiteCookie = (cookie: ProfileCookie): boolean => {
  const host = hostOfDomain(cookie.domain ?? '').toLowerCase();
  if (host === '') return false;
  if (LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost')) return false;
  return true;
};

/**
 * Build `cookies.set` details following the spike S-4 rules: the URL comes from
 * the domain (leading dot removed) plus path, `https` when `secure`; `domain`
 * is passed only for non-host-only cookies; `sameSite`, `secure`, `httpOnly`
 * and `expirationDate` are preserved as returned.
 */
export const buildCookieSetDetails = (cookie: ProfileCookie): ProfileCookieSetDetails => {
  const domain = cookie.domain ?? '';
  const path = cookie.path && cookie.path !== '' ? cookie.path : '/';
  const secure = cookie.secure === true;
  const details: ProfileCookieSetDetails = {
    url: `${secure ? 'https' : 'http'}://${hostOfDomain(domain)}${path}`,
    name: cookie.name,
    value: cookie.value,
    path,
    secure,
    httpOnly: cookie.httpOnly === true,
  };
  if (cookie.hostOnly === false) details.domain = domain;
  if (cookie.expirationDate !== undefined) details.expirationDate = cookie.expirationDate;
  if (cookie.sameSite !== undefined) details.sameSite = cookie.sameSite;
  return details;
};

/**
 * Copy the user's cookies from `source` to `target` exactly once.
 *
 * Per-cookie failures are counted and never stop the batch. The flag is written
 * only after the whole batch ran (errors included), so a crash mid-copy retries
 * next launch while a completed copy never repeats.
 */
export const migrateCookies = async (options: MigrateCookiesOptions): Promise<CookieMigrationResult> => {
  const log = options.log ?? ((message: string) => console.log(message));
  if (options.enabled === false) {
    log('[BrowserProfile] cookie migration disabled; nothing copied');
    return { status: 'disabled', copied: 0, failed: 0, skipped: 0 };
  }
  if (await options.readFlag()) {
    return { status: 'already-done', copied: 0, failed: 0, skipped: 0 };
  }

  const cookies = await options.source.cookies.get({});
  let copied = 0;
  let failed = 0;
  let skipped = 0;
  for (const cookie of cookies) {
    if (!isUserSiteCookie(cookie)) {
      skipped += 1;
      continue;
    }
    try {
      // Sequential on purpose: keeps cookie order and avoids flooding the cookie store.
      // eslint-disable-next-line no-await-in-loop
      await options.target.cookies.set(buildCookieSetDetails(cookie));
      copied += 1;
    } catch {
      failed += 1;
    }
  }
  try {
    await options.target.cookies.flushStore?.();
  } catch {
    // Best-effort: Chromium also flushes on its own schedule.
  }
  await options.writeFlag();
  log(`[BrowserProfile] cookie migration done: copied=${copied} failed=${failed} skipped=${skipped}`);
  return { status: 'migrated', copied, failed, skipped };
};

/** Flag store backed by a small JSON file; reads fail closed to "not done". */
export const createFileMigrationFlag = (
  filePath: string
): { readFlag: () => Promise<boolean>; writeFlag: () => Promise<void> } => ({
  readFlag: async () => {
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, 'utf-8'));
      return typeof parsed === 'object' && parsed !== null && (parsed as { migrated?: unknown }).migrated === true;
    } catch {
      return false;
    }
  },
  writeFlag: async () => {
    await mkdir(dirname(filePath), { recursive: true });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ migrated: true, at: new Date().toISOString() }), 'utf-8');
    await rename(temp, filePath);
  },
});

// ---------------------------------------------------------------------------
// Web permission policy (gap G7)
// ---------------------------------------------------------------------------

/** Verdict of {@link decideWebPermission}. */
export type WebPermissionDecision = { allow: boolean; reason: 'safe-allowlist' | 'default-deny' };

/**
 * Permissions that cannot expose user data or devices. Everything else
 * (notifications, media, geolocation, clipboard-read, midi, hid, usb, serial,
 * openExternal, sensors, storage-access, ...) is denied. A per-origin prompt is
 * TARGET, not part of v1.
 */
const SAFE_WEB_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

/** Details Electron passes alongside a permission request or check (only what is read here). */
export type WebPermissionDetails = { requestingUrl?: string; mediaTypes?: readonly string[] };

/** Pure policy: safe permissions are allowed, all others (and unknown ones) are denied. */
export const decideWebPermission = (
  permission: string,
  _origin: string,
  _details?: WebPermissionDetails
): WebPermissionDecision =>
  SAFE_WEB_PERMISSIONS.has(permission)
    ? { allow: true, reason: 'safe-allowlist' }
    : { allow: false, reason: 'default-deny' };

const MAX_DENIAL_KEYS = 200;
const deniedCounts = new Map<string, number>();

/** Count one denial per `origin|permission`, bounded so a hostile page cannot grow memory. */
const recordDenial = (origin: string, permission: string): void => {
  const key = `${origin}|${permission}`;
  const current = deniedCounts.get(key);
  if (current === undefined && deniedCounts.size >= MAX_DENIAL_KEYS) return;
  deniedCounts.set(key, (current ?? 0) + 1);
};

/** Snapshot of denied permissions by `origin|permission` (counts only, for diagnostics/tests). */
export const getDeniedPermissionCounts = (): ReadonlyMap<string, number> => new Map(deniedCounts);

/** Clears the denial counters (tests). */
export const resetDeniedPermissionCounts = (): void => deniedCounts.clear();

const originOf = (url: string | undefined): string => {
  if (url === undefined) return 'unknown';
  try {
    return new URL(url).origin;
  } catch {
    return 'unknown';
  }
};

/** Minimal session surface used by {@link configureProfilePermissions}. */
export type PermissionConfigurable = Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>;

/**
 * Install the default-deny permission handlers on `ses`. The user is not asked
 * in v1: unsafe permissions are refused and counted per origin.
 */
export const configureProfilePermissions = (ses: PermissionConfigurable): void => {
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const origin = originOf(details.requestingUrl);
    const decision = decideWebPermission(permission, origin, details);
    if (!decision.allow) recordDenial(origin, permission);
    callback(decision.allow);
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const origin = requestingOrigin !== '' ? requestingOrigin : originOf(details.requestingUrl);
    const decision = decideWebPermission(permission, origin, details);
    if (!decision.allow) recordDenial(origin, permission);
    return decision.allow;
  });
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let downloadGate: DownloadGate | undefined;

/**
 * Hold every Browser download until the person confirms it in a native dialog (profileDownloadGate.ts). If the gate
 * cannot be installed, every download is cancelled instead, so the policy fails closed.
 */
const installProfileDownloadGate = (profile: Session, getWindow: () => unknown): void => {
  try {
    downloadGate = installDownloadGate(profile as unknown as DownloadGateSession, {
      confirm: createNativeDownloadConfirm(getWindow),
      log: (message) => console.error('[BrowserDownloads] ' + message),
    });
  } catch (error) {
    console.error(
      '[BrowserDownloads] gate not installed; downloads are cancelled:',
      error instanceof Error ? error.message : 'unknown error'
    );
    profile.on('will-download', (_event, item) => item.cancel());
  }
};

/** Stops the download gate. Downloads still waiting for an answer are cancelled. Call once, when the app quits. */
export const disposeProfileDownloadGate = (): void => {
  downloadGate?.dispose();
  downloadGate = undefined;
};

let preparing: Promise<CookieMigrationResult | undefined> | undefined;

/**
 * Prepare the Browser profile once per process: install the permission policy,
 * then run the one-time cookie copy. Never throws; on failure the flag stays
 * unset so the copy retries next launch. Must run after `app` is ready.
 *
 * @param options.migrateCookies Set `false` to skip the copy (default `true`).
 */
export const prepareBrowserProfile = (
  options: { migrateCookies?: boolean; getWindow?: () => unknown } = {}
): Promise<CookieMigrationResult | undefined> => {
  preparing ??= (async () => {
    try {
      const profile = getBrowserProfileSession();
      configureProfilePermissions(profile);
      installProfileDownloadGate(profile, options.getWindow ?? (() => undefined));
      const flag = createFileMigrationFlag(join(app.getPath('userData'), BROWSER_PROFILE_MIGRATION_FLAG_FILE));
      return await migrateCookies({
        source: session.defaultSession,
        target: profile,
        enabled: options.migrateCookies,
        ...flag,
      });
    } catch (error) {
      console.error('[BrowserProfile] preparation failed:', error instanceof Error ? error.message : 'unknown error');
      return undefined;
    }
  })();
  return preparing;
};
