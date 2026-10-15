import { webEmbedAppId } from '@/common/integrations/webEmbed/webEmbed';
import type { PackageListing } from '@/common/packages';
import type { PackageConnectionView } from '@/common/types/platform/packageConnections';

/**
 * Single source of truth for "is this package installed" across the Store and
 * the shell's All Apps launcher. A package counts as installed only when the
 * service reports the `installed` state AND carries the durable installed
 * manifest the launcher needs to open it.
 */
export const isPackageListingInstalled = (listing: PackageListing): boolean =>
  listing.delivery === 'downloaded-package' && listing.state === 'installed' && listing.installedManifest !== undefined;

/** Only signed, non-revoked and host-compatible Store apps can be offered for installation. */
export const isAvailableSignedAppPackage = (listing: PackageListing | undefined): boolean =>
    !!listing && listing.delivery === 'downloaded-package' && listing.manifest.type === 'app' &&
    // Failed installs have no runnable payload but the user may retry a verified download.
  (listing.state === 'available' || listing.state === 'installed' || listing.state === 'failed') &&
  listing.compatible && !listing.revoked &&
  (listing.trust === 'signed-first-party' || listing.trust === 'signed-store');

export type LauncherBuiltInApp = {
  id: string;
  packageId?: string;
  moduleId?: string;
};

export type LauncherPackageApp = {
  id: string;
  packageId: string;
  moduleId: string;
  title: string;
};

export type RunnableModuleRef = { id: string; title: string; pinnable?: boolean };

/** One card for each installed package, including local Repo-to-Package apps without a runnable UI.
 * An installed package is distinct from a web-embed connection or a Hub navigation shortcut. */
export type InstalledPackageCard = Readonly<{
  packageId: string;
  title: string;
  moduleId?: string;
  pinnable: boolean;
    localBuilt: boolean;
  enabled: boolean;
  revoked: boolean;
}>;

/** The launcher shows five default app choices even before downloads; their install state remains explicit. */
export type LauncherAppCard = InstalledPackageCard & Readonly<{ installed: boolean }>;

export const buildAllAppCards = (
  defaults: readonly { packageId: string; moduleId: string; title: string }[],
  installed: readonly InstalledPackageCard[]
): LauncherAppCard[] => {
  const installedById = new Map(installed.map((card) => [card.packageId, card]));
  const seen = new Set<string>();
  const defaultCards = defaults.map((app): LauncherAppCard => {
    seen.add(app.packageId);
    const actual = installedById.get(app.packageId);
    return actual
      ? { ...actual, installed: true }
      : { packageId: app.packageId, moduleId: app.moduleId, title: app.title, pinnable: true,
        localBuilt: false, enabled: false, revoked: false, installed: false };
  });
    const additional: LauncherAppCard[] = [];
  for (const card of installed) {
    if (!seen.has(card.packageId)) additional.push({ ...card, installed: true });
  }
  return [...defaultCards, ...additional];
};

export const buildInstalledPackageCards = (
  listings: readonly PackageListing[],
  runnableModulesOf: (listing: PackageListing) => readonly RunnableModuleRef[]
): InstalledPackageCard[] => {
  const seen = new Set<string>();
  return listings.flatMap((listing): InstalledPackageCard[] => {
    if (!isPackageListingInstalled(listing) || !listing.installedManifest) return [];
    const manifest = listing.installedManifest;
    const localBuilt = listing.installedTrust === 'local-built' || listing.trust === 'local-built';
    if (manifest.type !== 'app' && !localBuilt) return [];
    if (seen.has(manifest.id)) return [];
    seen.add(manifest.id);
    const module = runnableModulesOf(listing)[0];
    return [{
      packageId: manifest.id,
      title: manifest.name,
      ...(module ? { moduleId: module.id } : {}),
            pinnable: module?.pinnable === true,
      localBuilt,
      enabled: listing.enabled && !listing.revoked && listing.installedTrust !== 'unsigned-revoked',
      revoked: Boolean(listing.revoked || listing.installedTrust === 'unsigned-revoked'),
    }];
  });
};

/** A `web-embed` connection that is turned on, listed as an app. Opened by id only (`webEmbedClient.openApp`). */
export type LauncherWebEmbedApp = {
  id: string;
  packageId: string;
  connectionId: string;
  title: string;
};

/**
 * The apps one installed package offers through `web-embed` connections: only those switched on and healthy. The ids
 * are what the renderer sends back to Main; no address or session ever comes from here.
 */
export const webEmbedAppsOf = (
  packageId: string,
  connections: readonly Pick<PackageConnectionView, 'key' | 'kind' | 'title' | 'enabled' | 'status'>[]
): LauncherWebEmbedApp[] =>
  connections.flatMap((connection): LauncherWebEmbedApp[] => {
    if (connection.kind !== 'web-embed' || !connection.enabled || connection.status !== 'on') return [];
    const connectionId = connection.key.slice('web-embed:'.length);
    if (!connection.key.startsWith('web-embed:') || connectionId === '') return [];
    return [{ id: webEmbedAppId(packageId, connectionId), packageId, connectionId, title: connection.title }];
  });

export type LauncherModel<TBuiltIn extends LauncherBuiltInApp> = {
  builtInApps: readonly TBuiltIn[];
  /** Every pinnable installed package module, for the sidebar. */
  pinnedPackageApps: readonly LauncherPackageApp[];
  /** Pinnable package modules not already represented by a built-in entry, for the launcher. */
  packageApps: readonly LauncherPackageApp[];
  /** Switched-on `web-embed` apps of installed packages (S13), counted in `total`. */
  webEmbedApps: readonly LauncherWebEmbedApp[];
  /** Every entry shown by the launcher, counted exactly once. */
  total: number;
};

/**
 * Derives the All Apps launcher from one installed-package snapshot. Built-in
 * entries that are backed by a package (for example Studio) appear only while
 * that package is installed, and a package module already represented by a
 * built-in entry is not listed or counted a second time.
 */
export const buildLauncherModel = <TBuiltIn extends LauncherBuiltInApp>(
  builtIns: readonly TBuiltIn[],
  installedListings: readonly PackageListing[],
  runnableModulesOf: (listing: PackageListing) => readonly RunnableModuleRef[],
  webEmbedApps: readonly LauncherWebEmbedApp[] = []
): LauncherModel<TBuiltIn> => {
  const installed = installedListings.filter(isPackageListingInstalled);
  const installedIds = new Set(installed.flatMap((item) => (item.installedManifest ? [item.installedManifest.id] : [])));
  const builtInApps = builtIns.filter((app) => !app.packageId || installedIds.has(app.packageId));
  const represented = new Set(
    builtInApps.flatMap((app) => (app.packageId ? [`${app.packageId}:${app.moduleId ?? ''}`] : []))
  );
  const seen = new Set<string>();
  const pinnedPackageApps = installed.flatMap((listing): LauncherPackageApp[] => {
    const manifest = listing.installedManifest;
    if (!manifest) return [];
    return runnableModulesOf(listing)
      .filter((module) => module.pinnable)
      .flatMap((module) => {
        const id = `${manifest.id}:${module.id}`;
        if (seen.has(id)) return [];
        seen.add(id);
        return [{ id, packageId: manifest.id, moduleId: module.id, title: module.title }];
      });
  });
  const packageApps = pinnedPackageApps.filter((app) => !represented.has(app.id));
  // An app of a package that is no longer installed is not listed, even if a stale connection list still has it.
  const embedded = webEmbedApps.filter((app) => installedIds.has(app.packageId));
  return {
    builtInApps,
    pinnedPackageApps,
    packageApps,
    webEmbedApps: embedded,
    total: builtInApps.length + packageApps.length + embedded.length,
  };
};
