/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PackageListing } from '@/common/packages';
import {
  buildLauncherModel,
  isPackageListingInstalled,
  type LauncherBuiltInApp,
  type RunnableModuleRef,
} from '@/renderer/pages/hub/installedPackageApps';
import type { SearchHit, SearchProvider } from '../engine/types';
import { matchScore, normaliseText, type LocalEntry } from './localProvider';

/** A built-in app as the launcher defines it, already resolved to display text. */
export type AppSearchBuiltIn = LauncherBuiltInApp & {
  path: string;
  category?: string;
  title: string;
  description: string;
};

export type AppSearchInput = {
  builtIns: readonly AppSearchBuiltIn[];
  /** Every package listing the Store knows about (installed or not). */
  listings: readonly PackageListing[];
  runnableModulesOf: (listing: PackageListing) => readonly RunnableModuleRef[];
};

const storeRoute = (packageId: string): string => `/store/package/${encodeURIComponent(packageId)}`;

const launchRoute = (packageId: string, moduleId: string): string =>
  `/apps/${encodeURIComponent(packageId)}/${encodeURIComponent(moduleId)}`;

/**
 * Searchable app entries derived from the same launcher model the All Apps window uses, so installed
 * apps launch through the same route; Store packages that are not installed open their Store page.
 */
export const buildAppEntries = ({ builtIns, listings, runnableModulesOf }: AppSearchInput): LocalEntry[] => {
  // Same predicate as the shell: installed AND at least one runnable module.
  const installed = listings.filter((item) => isPackageListingInstalled(item) && runnableModulesOf(item).length > 0);
  const model = buildLauncherModel(builtIns, installed, runnableModulesOf);
  const entries: LocalEntry[] = [];
  const represented = new Set<string>();

  for (const app of model.builtInApps) {
    if (app.packageId) represented.add(app.packageId);
    entries.push({
      id: `app:builtin:${app.id}`,
      title: app.title,
      subtitle: app.description,
      subtitleSearchable: true,
      keywords: [app.id, app.packageId, app.moduleId, app.category].filter(Boolean).join(' '),
      icon: 'app',
      action: { kind: 'route', path: app.path },
    });
  }

  const descriptionOf = new Map(
    installed.flatMap((item) => (item.installedManifest ? [[item.installedManifest.id, item.installedManifest]] : []))
  );
  for (const app of model.packageApps) {
    represented.add(app.packageId);
    const manifest = descriptionOf.get(app.packageId);
    entries.push({
      id: `app:package:${app.id}`,
      title: app.title,
      subtitle: manifest?.description || app.packageId,
      subtitleSearchable: true,
      keywords: `${app.packageId} ${app.moduleId} ${manifest?.name ?? ''} ${(manifest?.tags ?? []).join(' ')}`,
      icon: 'app',
      action: { kind: 'route', path: launchRoute(app.packageId, app.moduleId) },
    });
  }
  // Pinned modules already shown under a built-in entry still make their package "represented".
  for (const app of model.pinnedPackageApps) represented.add(app.packageId);

  const storeSeen = new Set<string>();
  for (const listing of listings) {
    const { manifest } = listing;
    if (listing.revoked || represented.has(manifest.id) || storeSeen.has(manifest.id)) continue;
    storeSeen.add(manifest.id);
    entries.push({
      id: `app:store:${manifest.id}`,
      title: manifest.name,
      subtitle: manifest.description,
      subtitleSearchable: true,
      keywords: `${manifest.id} ${manifest.tags.join(' ')}`,
      icon: 'app',
      action: { kind: 'route', path: storeRoute(manifest.id) },
    });
  }
  return entries;
};

/** True when every character of `needle` appears in `haystack` in order (typo-tolerant "fuzzy" fallback). */
const isSubsequence = (needle: string, haystack: string): boolean => {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return false;
};

const MIN_FUZZY_LENGTH = 3;
const FUZZY_SCORE = 0.2;

const scoreEntry = (query: string, entry: LocalEntry): number => {
  const exact = matchScore(query, {
    title: entry.title,
    keywords: entry.keywords,
    subtitle: entry.subtitleSearchable ? entry.subtitle : undefined,
  });
  if (exact > 0) return exact;
  const compact = normaliseText(query).replace(/\s+/g, '');
  if (compact.length < MIN_FUZZY_LENGTH) return 0;
  const title = normaliseText(entry.title).replace(/\s+/g, '');
  return isSubsequence(compact, title) ? FUZZY_SCORE : 0;
};

/** The Apps source: built-in apps, installed package apps and Store packages. Pure in-memory matching. */
export const createAppsProvider = (label: string, getEntries: () => readonly LocalEntry[]): SearchProvider => ({
  source: { id: 'apps', kind: 'local', label, defaultAlias: 'a', includeInAllByDefault: true },
  search: async ({ query, limit }) => {
    const hits: SearchHit[] = [];
    for (const entry of getEntries()) {
      const score = scoreEntry(query, entry);
      if (score > 0) {
        hits.push({
          id: entry.id,
          sourceId: 'apps',
          title: entry.title,
          subtitle: entry.subtitle,
          score,
          icon: entry.icon,
          action: entry.action,
        });
      }
    }
    return hits.toSorted((a, b) => b.score - a.score).slice(0, limit);
  },
});
