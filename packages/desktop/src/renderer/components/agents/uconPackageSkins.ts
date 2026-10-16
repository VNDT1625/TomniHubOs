/**
 * Installed UI package avatar skins, interpreted as data only. The host's
 * verified package listing is authoritative; catalog/uninstalled/disabled
 * manifests never make a skin usable. UCON Core is a permanent fallback.
 */
import { avatarSkinSchema, type PackageAvatarSkinContribution } from '@/common/packages/avatarSkinContract';
import type { PackageListing } from '@/common/packages';
import { packageClient } from '@/renderer/pages/hub/packageClient';
import { useCallback, useSyncExternalStore } from 'react';
import {
  resolveUconAppearance,
  UCON_SLOT_OPTIONS,
  type UconAppearance,
  type UconAppearanceOverride,
} from './uconBotConfig';

export type AvailableAvatarSkin = PackageAvatarSkinContribution & {
  packageId: string;
  packageVersion: string;
};

const SAFE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SAFE_PACKAGE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const PREFIX = 'uconpkg:';

export type PackageAvatarSelection = {
  packageId: string;
  skinId: string;
  overrides: UconAppearanceOverride;
};

/** Keep the user's choice even if the package is later uninstalled. */
export function parsePackageAvatar(value?: string): PackageAvatarSelection | null {
  if (!value?.startsWith(PREFIX) || value.length > 300) return null;
  const [target, ...rest] = value.slice(PREFIX.length).split(';');
  const sep = target.lastIndexOf(':');
  if (sep < 1) return null;
  const packageId = target.slice(0, sep);
  const skinId = target.slice(sep + 1);
  if (!SAFE_PACKAGE.test(packageId) || !SAFE_ID.test(skinId) || packageId.length > 200 || skinId.length > 100) {
    return null;
  }
  const overrides: UconAppearanceOverride = {};
  for (const item of rest) {
    const at = item.indexOf('=');
    if (at < 1) return null;
    const slot = item.slice(0, at) as keyof UconAppearance;
    const entry = item.slice(at + 1);
    if (
      !Object.prototype.hasOwnProperty.call(UCON_SLOT_OPTIONS, slot) ||
      !(UCON_SLOT_OPTIONS[slot] as readonly string[]).includes(entry)
    )
      return null;
    Object.assign(overrides, { [slot]: entry });
  }
  return { packageId, skinId, overrides };
}
export function encodePackageAvatar(selection: PackageAvatarSelection): string {
  const { packageId, skinId } = selection;
  const root = PREFIX + packageId + ':' + skinId;
  if (!SAFE_PACKAGE.test(packageId) || !SAFE_ID.test(skinId)) return 'ucon:core';
  const parts = (Object.keys(UCON_SLOT_OPTIONS) as (keyof UconAppearance)[])
    .filter(
      (k) =>
        selection.overrides[k] !== undefined &&
        (UCON_SLOT_OPTIONS[k] as readonly string[]).includes(selection.overrides[k] as string)
    )
    .map((k) => k + '=' + selection.overrides[k]);
  const encoded = root + (parts.length ? ';' + parts.join(';') : '');
  return encoded.length <= 300 ? encoded : root;
}

/** Ignore not-installed and unhealthy package manifests, including catalog previews. */
export function installedAvatarSkins(packages: readonly PackageListing[]): readonly AvailableAvatarSkin[] {
  const found: AvailableAvatarSkin[] = [];
  for (const listing of packages) {
    if (
      listing.state !== 'installed' ||
      !listing.enabled ||
      !listing.compatible ||
      listing.revoked ||
      listing.lastError ||
      listing.installedManifest?.type !== 'ui' ||
      listing.manifest.id !== listing.installedManifest.id ||
      !listing.installedVersion ||
      listing.installedVersion !== listing.installedManifest.version
    )
      continue;
    const installed = listing.installedManifest;
    for (const candidate of installed.contributions?.avatarSkins ?? []) {
      const parsed = avatarSkinSchema.safeParse(candidate);
      if (!parsed.success) continue;
      found.push({ ...parsed.data, packageId: installed.id, packageVersion: installed.version });
    }
  }
  return found.toSorted((a, b) => (a.packageId + ':' + a.id).localeCompare(b.packageId + ':' + b.id));
}
export function resolvePackagedAvatar(
  selection: PackageAvatarSelection,
  available: readonly AvailableAvatarSkin[]
): { appearance: UconAppearance; fromPackage: boolean } {
  const skin = available.find((s) => s.packageId === selection.packageId && s.id === selection.skinId);
  if (!skin) {
    return { appearance: resolveUconAppearance('core', selection.overrides), fromPackage: false };
  }
  return {
    appearance: resolveUconAppearance(skin.archetype, { ...skin.appearance, ...selection.overrides }),
    fromPackage: true,
  };
}

// One observer/query per renderer window, not per avatar in the Live grid.
const observers = new Set<() => void>();
let cached: readonly AvailableAvatarSkin[] = [];
let pending = false;
let active = false;
let generation = 0;
let stopWatching: (() => void) | undefined;
function notify(): void {
  for (const observer of observers) observer();
}
async function refresh(): Promise<void> {
  if (!active || pending) return;
  pending = true;
  const revision = generation;
  try {
    const items = await packageClient.list({ type: 'ui', installedOnly: true });
    if (!active || revision !== generation) return;
    cached = installedAvatarSkins(items);
    notify();
  } catch {
    // Permission/service errors do not retain skins from an unverified old snapshot.
    if (active && revision === generation) {
      cached = [];
      notify();
    }
  } finally {
    pending = false;
  }
}
function subscribe(observer: () => void): () => void {
  observers.add(observer);
  if (!active) {
    active = true;
    generation += 1;
    try {
      stopWatching = packageClient.onContributionsChanged(() => {
        void refresh();
      });
    } catch {
      // Old/missing preload bridges must never break the Core avatar fallback.
      stopWatching = undefined;
    }
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
    void refresh();
  }
  return () => {
    observers.delete(observer);
    if (observers.size === 0) {
      active = false;
      generation += 1;
      stopWatching?.();
      stopWatching = undefined;
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
      cached = [];
      pending = false;
    }
  };
}
function onFocus(): void {
  void refresh();
}
const subscribeDisabled = (): (() => void) => () => undefined;
function snapshot(): readonly AvailableAvatarSkin[] {
  return cached;
}
const EMPTY: readonly AvailableAvatarSkin[] = [];
function empty(): readonly AvailableAvatarSkin[] {
  return EMPTY;
}

/** Pass false for ordinary UCON Core avatars to avoid package-service traffic. */
export function useUconPackageSkins(enabled: boolean): readonly AvailableAvatarSkin[] {
  const connect = useCallback(
    (listener: () => void) => (enabled ? subscribe(listener) : subscribeDisabled()),
    [enabled]
  );
  return useSyncExternalStore(connect, enabled ? snapshot : subscribeDisabledSnapshot, empty);
}
function subscribeDisabledSnapshot(): readonly AvailableAvatarSkin[] {
  return EMPTY;
}
