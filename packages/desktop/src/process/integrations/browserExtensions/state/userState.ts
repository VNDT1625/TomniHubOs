/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The person's choices for each browser extension, owned by Main (docs/platform/repotopackage-design.md sections 12.5
 * and 14 S2/S5): pinned to the header strip, the site access level, and the sites allowed.
 *
 * - Saved (in `<userData>/tomny-extension-prefs.json`): the pin, the mode, and the sites of `on-site`.
 * - This run only (memory): the sites allowed under `on-click`. A restart or a mode change clears them.
 * - Failing closed: a missing or corrupt file means nothing is pinned, the default mode applies and no site is saved.
 *   The renderer never reads or writes this file.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  defaultSiteAccessMode,
  isSiteAccessMode,
  isWebOrigin,
  sanitizeSites,
  type SiteAccessConfig,
  type SiteAccessMode,
} from '@/common/integrations/extensions/siteAccess';

/** Kept beside the extension state file, not inside the extension folder. */
export const EXTENSION_PREFS_FILE = 'tomny-extension-prefs.json';

const EXTENSION_ID = /^[a-p]{32}$/;
const MAX_RECORDS = 2_000;

const prefSchema = z
  .object({
    id: z.string().regex(EXTENSION_ID),
    pinned: z.boolean().optional(),
    mode: z.string().optional(),
    sites: z.array(z.unknown()).max(200).optional(),
  })
  .strict();

const fileSchema = z.object({ schemaVersion: z.literal(1), extensions: z.array(z.unknown()).max(MAX_RECORDS) });

type Pref = Readonly<{ pinned: boolean; mode?: SiteAccessMode; sites: readonly string[] }>;

export type ExtensionUserState = Readonly<{
  /** Reads the file once. Every other call works from memory after this resolves. */
  initialize: () => Promise<void>;
  isPinned: (extensionId: string) => boolean;
  setPinned: (extensionId: string, pinned: boolean) => Promise<void>;
  /** The configuration to apply now. `declared` is the manifest's host permissions, used when no mode is saved. */
  configOf: (extensionId: string, declared: readonly string[]) => SiteAccessConfig;
  /** Changes the level. Switching clears this run's grants; saved sites stay for `on-site`. */
  setMode: (extensionId: string, mode: SiteAccessMode) => Promise<void>;
  /**
   * Allows one origin for this extension: for this run under `on-click`, saved otherwise. The caller checks that the
   * manifest covers the origin (`isGrantableOrigin`) before it calls this.
   */
  allowOrigin: (extensionId: string, origin: string, declared: readonly string[]) => Promise<'saved' | 'run'>;
  /** Drops everything kept for an extension (used when its package is removed). */
  forget: (extensionId: string) => Promise<void>;
}>;

/** Reads a stored record; anything malformed is dropped. */
const readPref = (raw: unknown): [string, Pref] | undefined => {
  const parsed = prefSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const { id, pinned, mode, sites } = parsed.data;
  return [
    id,
    {
      pinned: pinned === true,
      ...(isSiteAccessMode(mode) ? { mode } : {}),
      sites: sanitizeSites(sites ?? []),
    },
  ];
};

export const createExtensionUserState = (filePath: string): ExtensionUserState => {
  const prefs = new Map<string, Pref>();
  const runGrants = new Map<string, Set<string>>();
  let writes: Promise<void> = Promise.resolve();
  let loaded: Promise<void> | undefined;

  const persist = (): Promise<void> => {
    const snapshot = JSON.stringify(
      {
        schemaVersion: 1,
        extensions: [...prefs.entries()].map(([id, pref]) => {
          const entry: Record<string, unknown> = { id };
          if (pref.pinned) entry.pinned = true;
          if (pref.mode !== undefined) entry.mode = pref.mode;
          if (pref.sites.length > 0) entry.sites = [...pref.sites];
          return entry;
        }),
      },
      null,
      2
    );
    const task = writes.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, filePath);
    });
    writes = task.catch((): undefined => undefined);
    return task;
  };

  const load = async (): Promise<void> => {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      return;
    }
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) return;
    for (const item of parsed.data.extensions) {
      const entry = readPref(item);
      if (entry) prefs.set(entry[0], entry[1]);
    }
  };

  const prefOf = (extensionId: string): Pref => prefs.get(extensionId) ?? { pinned: false, sites: [] };

  const savePref = async (extensionId: string, pref: Pref): Promise<void> => {
    if (!pref.pinned && pref.mode === undefined && pref.sites.length === 0) prefs.delete(extensionId);
    else prefs.set(extensionId, pref);
    await persist();
  };

  return {
    initialize: () => {
      loaded ??= load();
      return loaded;
    },
    isPinned: (extensionId) => prefOf(extensionId).pinned,
    setPinned: async (extensionId, pinned) => {
      await savePref(extensionId, { ...prefOf(extensionId), pinned });
    },
    configOf: (extensionId, declared) => ({
      mode: prefOf(extensionId).mode ?? defaultSiteAccessMode(declared),
      sites: [...prefOf(extensionId).sites],
      sessionSites: [...(runGrants.get(extensionId) ?? [])],
    }),
    setMode: async (extensionId, mode) => {
      runGrants.delete(extensionId);
      await savePref(extensionId, { ...prefOf(extensionId), mode });
    },
    allowOrigin: async (extensionId, origin, declared) => {
      if (!isWebOrigin(origin)) throw new Error('The origin is not a plain web origin.');
      const pref = prefOf(extensionId);
      if ((pref.mode ?? defaultSiteAccessMode(declared)) === 'on-click') {
        const granted = runGrants.get(extensionId) ?? new Set<string>();
        granted.add(origin);
        runGrants.set(extensionId, granted);
        return 'run';
      }
      await savePref(extensionId, { ...pref, sites: sanitizeSites([...pref.sites, origin]) });
      return 'saved';
    },
    forget: async (extensionId) => {
      runGrants.delete(extensionId);
      if (prefs.delete(extensionId)) await persist();
    },
  };
};

let shared: Promise<ExtensionUserState> | undefined;

/** The one user state of the app. The first caller's path is used; the file is read before the promise resolves. */
export const sharedExtensionUserState = (filePath: string): Promise<ExtensionUserState> => {
  shared ??= (async () => {
    const state = createExtensionUserState(filePath);
    await state.initialize();
    return state;
  })();
  return shared;
};
