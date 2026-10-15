/**
 * User-owned cross-device app library.
 *
 * Only public Store packages with verified installed state can be synced.
 * Local-built (/repotopackage) and revoked artifacts are never uploaded.
 * No app files, permissions, app state, paths or package data leave this device.
 */
import type { PackageListing } from '@/common/packages';
import { getStoredSupabaseSession, getSupabaseConfig, fetchWithTimeout } from '@/renderer/services/supabaseAuth';
import { isPackageListingInstalled } from './installedPackageApps';

export type CloudPackage = Readonly<{ package_id: string; name: string }>;
export type CloudPackageSnapshot = Readonly<
  | { ok: true; items: readonly CloudPackage[] }
  | { ok: false; reason: 'not-signed-in' | 'service-unavailable' }
>;

const VALID_ID = /^[a-z0-9][a-z0-9._-]{0,159}$/i;
const API_PATH = '/rest/v1/user_package_library';
const REQUEST_TIMEOUT = 7000;

const sessionFor = (userId?: string) => {
  const config = getSupabaseConfig();
  const session = getStoredSupabaseSession();
  if (!config || !session || Date.now() >= session.expires_at || (userId && session.user.id !== userId)) return null;
  return { config, session };
};

const request = async (path: string, init: RequestInit = {}, userId?: string): Promise<Response> => {
  const auth = sessionFor(userId);
  if (!auth) throw new Error('CLOUD_PACKAGE_NOT_SIGNED_IN');
  const result = await fetchWithTimeout(`${auth.config.url}${API_PATH}${path}`, {
    ...init,
    headers: {
      apikey: auth.config.anonKey,
      Authorization: `Bearer ${auth.session.access_token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    timeoutMs: REQUEST_TIMEOUT,
  });
  if (!result.ok) throw new Error(`CLOUD_PACKAGE_HTTP_${result.status}`);
  return result;
};

export const isCloudRestorablePackage = (listing: PackageListing): boolean =>
  isPackageListingInstalled(listing) &&
  listing.manifest.type === 'app' &&
    VALID_ID.test(listing.manifest.id) &&
  !listing.revoked &&
  (listing.installedTrust ?? listing.trust) !== 'unsigned-revoked' &&
  (listing.installedTrust ?? listing.trust) !== 'local-built' &&
  ((listing.installedTrust ?? listing.trust) === 'signed-store' ||
    (listing.installedTrust ?? listing.trust) === 'signed-first-party');

/** Prevent untrusted/local-built packages from entering the remote reinstall catalog. */
export const cloudPackageOf = (listing: PackageListing): CloudPackage | null =>
  isCloudRestorablePackage(listing)
    ? { package_id: listing.manifest.id, name: listing.installedManifest?.name ?? listing.manifest.name }
    : null;

export const loadCloudPackageLibrary = async (userId: string): Promise<CloudPackageSnapshot> => {
  if (!sessionFor(userId)) return { ok: false, reason: 'not-signed-in' };
  try {
    const response = await request(`?select=package_id,name&user_id=eq.${encodeURIComponent(userId)}&order=package_id.asc`, {}, userId);
    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows)) return { ok: false, reason: 'service-unavailable' };
    const items = rows.filter((row): row is CloudPackage => {
      if (!row || typeof row !== 'object') return false;
      const value = row as Record<string, unknown>;
      return typeof value.package_id === 'string' && VALID_ID.test(value.package_id) && typeof value.name === 'string';
    });
    return { ok: true, items };
  } catch {
    // Never silently interpret an unavailable cloud table/network as a brand-new account.
    return { ok: false, reason: 'service-unavailable' };
  }
};

export const addCloudPackage = async (item: CloudPackage, userId?: string): Promise<void> => {
  const auth = sessionFor(userId);
  if (!auth) throw new Error('CLOUD_PACKAGE_ACCOUNT_UNAVAILABLE');
  if (!VALID_ID.test(item.package_id)) return;
  await request('?on_conflict=user_id,package_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{
      user_id: auth.session.user.id,
      package_id: item.package_id,
      name: item.name.slice(0, 160),
    }]),
  }, auth.session.user.id);
};

export const removeCloudPackage = async (packageId: string, userId?: string): Promise<void> => {
  const auth = sessionFor(userId);
  if (!auth) throw new Error('CLOUD_PACKAGE_ACCOUNT_UNAVAILABLE');
  if (!VALID_ID.test(packageId)) return;
  await request(`?user_id=eq.${encodeURIComponent(auth.session.user.id)}&package_id=eq.${encodeURIComponent(packageId)}`, {
    method: 'DELETE',
  }, auth.session.user.id);
};

/**
 * Account-scoped pending mutations. The only persisted data is package ID, name,
 * and desired install state; package payloads and auth tokens are never stored here.
 */
type PendingCloudMutation = CloudPackage & Readonly<{ action: 'install' | 'uninstall' }>;
const OUTBOX_PREFIX = 'tomni.hub.cloud-package-outbox.';
const OUTBOX_LIMIT = 100;
const flights = new Map<string, Promise<void>>();

const readOutbox = (userId: string): PendingCloudMutation[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OUTBOX_PREFIX + userId);
    if (!raw || raw.length > 32_000) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is PendingCloudMutation =>
      entry !== null && typeof entry === 'object' &&
      (entry.action === 'install' || entry.action === 'uninstall') &&
      typeof entry.package_id === 'string' && VALID_ID.test(entry.package_id) &&
      typeof entry.name === 'string' && entry.name.length <= 160
    ).slice(0, OUTBOX_LIMIT);
  } catch {
    return [];
  }
};

const writeOutbox = (userId: string, entries: readonly PendingCloudMutation[]): void => {
  if (typeof window === 'undefined') return;
  if (entries.length === 0) window.localStorage.removeItem(OUTBOX_PREFIX + userId);
  else window.localStorage.setItem(OUTBOX_PREFIX + userId, JSON.stringify(entries));
};

const enqueueCloudMutation = (userId: string, entry: PendingCloudMutation): void => {
  const remaining = readOutbox(userId).filter((item) => item.package_id !== entry.package_id);
  if (remaining.length >= OUTBOX_LIMIT) throw new Error('CLOUD_PACKAGE_OUTBOX_FULL');
  writeOutbox(userId, [...remaining, entry]);
};

const sendCloudMutation = async (entry: PendingCloudMutation, userId: string): Promise<void> => {
  if (entry.action === 'install') await addCloudPackage(entry, userId);
  else await removeCloudPackage(entry.package_id, userId);
};

/** Retry only the currently signed-in account's mutations, serially and in their latest order. */
export const flushCloudPackageOutbox = (userId: string): Promise<void> => {
  const active = flights.get(userId);
  if (active) return active;
  const operation = (async (): Promise<void> => {
    for (let processed = 0; processed < OUTBOX_LIMIT; processed++) {
      if (!sessionFor(userId)) return;
      const [next] = readOutbox(userId);
      if (!next) return;
            // eslint-disable-next-line no-await-in-loop -- Serialize account writes to preserve the latest desired package state.
      await sendCloudMutation(next, userId);
      // A concurrent newer install/uninstall of the same app always wins.
      const current = readOutbox(userId);
      if (current.some((entry) => entry.package_id === next.package_id &&
        (entry.action !== next.action || entry.name !== next.name))) continue;
      writeOutbox(userId, current.filter((entry) => entry.package_id !== next.package_id));
    }
  })();
  flights.set(userId, operation);
  void operation.finally(() => {
    if (flights.get(userId) === operation) flights.delete(userId);
    }).catch((): undefined => undefined);
  return operation;
};

/** Call only after Main reports success for a real package install/uninstall. */
export const syncCompletedPackageMutation = async (
  action: 'install' | 'uninstall',
  listing: PackageListing
): Promise<void> => {
    const session = getStoredSupabaseSession();
  if (!session?.user.id || !getSupabaseConfig()) return;
  const userId = session.user.id;
  const item = action === 'install'
    ? cloudPackageOf(listing)
    : listing.manifest.type === 'app' &&
      (listing.trust === 'signed-store' || listing.trust === 'signed-first-party')
      ? { package_id: listing.manifest.id, name: listing.manifest.name }
      : null;
  if (!item || !VALID_ID.test(item.package_id)) return;
  const entry: PendingCloudMutation = { ...item, action };
  if (typeof window === 'undefined') {
    // Server-side contract tests and Web CLI have no browser outbox.
    await sendCloudMutation(entry, userId);
    return;
  }
  // Write before network I/O: crashes, offline mode and token refresh are retryable.
  enqueueCloudMutation(userId, entry);
  await flushCloudPackageOutbox(userId);
};
