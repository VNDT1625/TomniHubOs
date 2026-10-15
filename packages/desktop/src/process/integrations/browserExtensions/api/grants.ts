/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What each loaded extension is allowed to do (docs/platform/repotopackage-design.md sections 12.3 and 15.1).
 *
 * - Approved at enable: the `permissions` and `host_permissions` of the manifest. The connection approval hash
 *   covers `manifest.json`, so a changed manifest needs a new approval before it can be loaded again.
 * - Granted later: an `optional_permissions` / `optional_host_permissions` entry, only after the person said yes to
 *   the prompt of `chrome.permissions.request`. The registry keeps these through an {@link OptionalGrantStore}; a
 *   stored grant that the new manifest no longer declares as optional is dropped when the extension is registered.
 * - Everything else is denied. The registry is keyed by extension id, so one extension's grant never reaches another.
 *
 * Pure: no Electron, no file system. Persistence is a port.
 */

import { inspectManifest } from '@process/integrations/browserExtensions/manifest';
import { originCoveredBy, parseMatchPattern } from '@process/integrations/browserExtensions/api/matchPattern';

const PERMISSION_NAME = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const MAX_STATIC_RULESETS = 50;
const MAX_RULESET_ID = 128;

export const isPermissionName = (value: unknown): value is string =>
  typeof value === 'string' && PERMISSION_NAME.test(value);

export type PermissionSet = Readonly<{ permissions: readonly string[]; origins: readonly string[] }>;

export type StaticRuleset = Readonly<{ id: string; enabled: boolean }>;

/** A platform key of a manifest `suggested_key` object. */
export type CommandPlatform = 'default' | 'windows' | 'mac' | 'linux' | 'chromeos';

/** A manifest command and the shortcuts its `suggested_key` declares. Malformed shortcuts are not kept. */
export type CommandSpec = Readonly<{
  name: string;
  description: string;
  shortcuts: Readonly<Partial<Record<CommandPlatform, string>>>;
}>;

/** What the registry learns from an extension's manifest when it is attached. */
export type ExtensionGrantSeed = Readonly<{
  extensionId: string;
  packageId: string;
  connectionId: string;
  name: string;
  permissions: readonly string[];
  hostPermissions: readonly string[];
  optionalPermissions: readonly string[];
  optionalHostPermissions: readonly string[];
  /** `declarative_net_request.rule_resources`, in manifest order. */
  staticRulesets: readonly StaticRuleset[];
  /** The manifest `commands`. Absent means none. */
  commands?: readonly CommandSpec[];
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseStaticRulesets = (manifest: unknown): StaticRuleset[] => {
  if (!isRecord(manifest) || !isRecord(manifest.declarative_net_request)) return [];
  const resources = manifest.declarative_net_request.rule_resources;
  if (!Array.isArray(resources)) return [];
  const seen = new Set<string>();
  const result: StaticRuleset[] = [];
  for (const resource of resources.slice(0, MAX_STATIC_RULESETS)) {
    if (!isRecord(resource)) continue;
    const { id, enabled } = resource;
    if (typeof id !== 'string' || id === '' || id.length > MAX_RULESET_ID || id.startsWith('_') || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push({ id, enabled: enabled === true });
  }
  return result;
};

const COMMAND_PLATFORMS: readonly CommandPlatform[] = ['default', 'windows', 'mac', 'linux', 'chromeos'];
const COMMAND_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const RESERVED_COMMANDS: ReadonlySet<string> = new Set(['_execute_action', '_execute_browser_action']);
/** Chrome's accelerator grammar without the media keys: one to three modifiers, then one key. */
const ACCELERATOR =
  /^(?:(?:Ctrl|Alt|Shift|Command|MacCtrl)\+){1,3}(?:[A-Z0-9]|F(?:1[0-2]|[1-9])|Comma|Period|Home|End|PageUp|PageDown|Space|Insert|Delete|Up|Down|Left|Right)$/;
const MAX_COMMANDS = 32;
/** Chrome allows four suggested shortcuts per extension. */
const MAX_SHORTCUTS = 4;

/**
 * The commands of a manifest. A name that is not a plain command name is dropped; a shortcut that does not match the
 * accelerator grammar is dropped and its command is kept without it. Only the first four shortcuts count.
 */
const parseCommandSpecs = (manifest: unknown): CommandSpec[] => {
  if (!isRecord(manifest) || !isRecord(manifest.commands)) return [];
  const result: CommandSpec[] = [];
  let shortcuts = 0;
  for (const [name, value] of Object.entries(manifest.commands).slice(0, MAX_COMMANDS)) {
    if (!RESERVED_COMMANDS.has(name) && !COMMAND_NAME.test(name)) continue;
    if (!isRecord(value)) continue;
    const suggested: Record<string, unknown> = isRecord(value.suggested_key) ? value.suggested_key : {};
    const found: Partial<Record<CommandPlatform, string>> = {};
    for (const platform of COMMAND_PLATFORMS) {
      const text = suggested[platform];
      if (typeof text === 'string' && ACCELERATOR.test(text) && shortcuts < MAX_SHORTCUTS) {
        found[platform] = text;
        shortcuts += 1;
      }
    }
    const description = typeof value.description === 'string' ? value.description.slice(0, 256) : '';
    result.push({ name, description, shortcuts: found });
  }
  return result;
};

const unique = (items: readonly string[]): string[] => [...new Set(items)];

/**
 * Reads the grant seed from a manifest the host already loaded. Returns undefined when the manifest is not one the
 * host can run. Permission names and match patterns that are malformed are dropped, never repaired.
 */
export const grantSeedFromManifest = (
  identity: Readonly<{ extensionId: string; packageId: string; connectionId: string }>,
  manifest: unknown
): ExtensionGrantSeed | undefined => {
  const verdict = inspectManifest(manifest);
  if (verdict.ok === false) return undefined;
  const { summary } = verdict;
  const names = (items: readonly string[]) => unique(items.filter(isPermissionName));
  const hosts = (items: readonly string[]) => unique(items.filter((item) => parseMatchPattern(item) !== undefined));
  return {
    ...identity,
    name: summary.name,
    permissions: names(summary.permissions),
    hostPermissions: hosts(summary.hostPermissions),
    optionalPermissions: names(summary.optionalPermissions),
    optionalHostPermissions: hosts(summary.optionalHostPermissions),
    staticRulesets: parseStaticRulesets(manifest),
    commands: parseCommandSpecs(manifest),
  };
};

export type RevokeOutcome =
  | Readonly<{ kind: 'removed'; removed: PermissionSet }>
  /** At least one item is required by the manifest; nothing was changed. */
  | Readonly<{ kind: 'required' }>
  /** At least one item is not held; nothing was changed. */
  | Readonly<{ kind: 'not-held' }>;

/** One extension's view of its own grants. Every method answers for this extension only. */
export type ExtensionGrants = Readonly<{
  extensionId: string;
  packageId: string;
  connectionId: string;
  name: string;
  staticRulesets: readonly StaticRuleset[];
  /** The manifest commands with their shortcuts; empty when the extension declares none. */
  commands: readonly CommandSpec[];
  /** True when the manifest approved it, or the person granted it later. */
  hasPermission: (name: string) => boolean;
  /** Everything currently granted, required and optional, sorted. */
  granted: () => PermissionSet;
  /** True when every item in the request is currently granted. */
  contains: (request: PermissionSet) => boolean;
  /** True when every item is declared in the manifest (required or optional), so a request for it makes sense. */
  isDeclared: (request: PermissionSet) => boolean;
  /** The items of the request that are not granted yet. */
  missing: (request: PermissionSet) => PermissionSet;
  /** Grants the declared-optional items of the request that are missing, and returns what was added. */
  grantOptional: (request: PermissionSet) => PermissionSet;
  revokeOptional: (request: PermissionSet) => RevokeOutcome;
}>;

/** Keeps optional grants across restarts. A failing store only means the grants are asked for again. */
export type OptionalGrantStore = Readonly<{
  read: (extensionId: string) => PermissionSet | undefined;
  write: (extensionId: string, grant: PermissionSet) => void;
}>;

export const createMemoryOptionalGrantStore = (): OptionalGrantStore => {
  const grants = new Map<string, PermissionSet>();
  return {
    read: (extensionId) => grants.get(extensionId),
    write: (extensionId, grant) => {
      grants.set(extensionId, grant);
    },
  };
};

export type GrantRegistry = Readonly<{
  /** Replaces any earlier entry for the same extension id. */
  register: (seed: ExtensionGrantSeed) => void;
  unregister: (extensionId: string) => void;
  has: (extensionId: string) => boolean;
  get: (extensionId: string) => ExtensionGrants | undefined;
  ids: () => readonly string[];
}>;

const sorted = (items: Iterable<string>): string[] => [...items].toSorted();

const buildGrants = (seed: ExtensionGrantSeed, store: OptionalGrantStore, log: (message: string) => void) => {
  const requiredPermissions = new Set(seed.permissions);
  const optionalPermissions = new Set(seed.optionalPermissions);
  const grantedPermissions = new Set<string>();
  const grantedOrigins = new Set<string>();

  try {
    const saved = store.read(seed.extensionId);
    for (const name of saved?.permissions ?? []) {
      if (optionalPermissions.has(name) && !requiredPermissions.has(name)) grantedPermissions.add(name);
    }
    for (const origin of saved?.origins ?? []) {
      if (originCoveredBy(seed.optionalHostPermissions, origin)) grantedOrigins.add(origin);
    }
  } catch {
    log(`Could not read optional permissions of ${seed.extensionId}.`);
  }

  const persist = (): void => {
    try {
      store.write(seed.extensionId, { permissions: sorted(grantedPermissions), origins: sorted(grantedOrigins) });
    } catch {
      log(`Could not save optional permissions of ${seed.extensionId}.`);
    }
  };

  const originGranted = (origin: string): boolean =>
    originCoveredBy([...seed.hostPermissions, ...grantedOrigins], origin);
  const permissionGranted = (name: string): boolean => requiredPermissions.has(name) || grantedPermissions.has(name);
  const originRequired = (origin: string): boolean => originCoveredBy(seed.hostPermissions, origin);

  const missing = (request: PermissionSet): PermissionSet => ({
    permissions: request.permissions.filter((name) => !permissionGranted(name)),
    origins: request.origins.filter((origin) => !originGranted(origin)),
  });

  const grants: ExtensionGrants = {
    extensionId: seed.extensionId,
    packageId: seed.packageId,
    connectionId: seed.connectionId,
    name: seed.name,
    staticRulesets: seed.staticRulesets,
    commands: seed.commands ?? [],
    hasPermission: permissionGranted,
    granted: () => ({
      permissions: sorted([...requiredPermissions, ...grantedPermissions]),
      origins: sorted([...seed.hostPermissions, ...grantedOrigins]),
    }),
    contains: (request) => {
      const absent = missing(request);
      return absent.permissions.length === 0 && absent.origins.length === 0;
    },
    isDeclared: (request) =>
      request.permissions.every((name) => requiredPermissions.has(name) || optionalPermissions.has(name)) &&
      request.origins.every((origin) =>
        originCoveredBy([...seed.hostPermissions, ...seed.optionalHostPermissions], origin)
      ),
    missing,
    grantOptional: (request) => {
      const added = missing(request);
      const permissions = added.permissions.filter((name) => optionalPermissions.has(name));
      const origins = added.origins.filter((origin) => originCoveredBy(seed.optionalHostPermissions, origin));
      if (permissions.length === 0 && origins.length === 0) return { permissions: [], origins: [] };
      for (const name of permissions) grantedPermissions.add(name);
      for (const origin of origins) grantedOrigins.add(origin);
      persist();
      return { permissions, origins };
    },
    revokeOptional: (request) => {
      if (request.permissions.some((name) => requiredPermissions.has(name))) return { kind: 'required' };
      if (request.origins.some(originRequired)) return { kind: 'required' };
      const everythingHeld =
        request.permissions.every((name) => grantedPermissions.has(name)) &&
        request.origins.every((origin) => grantedOrigins.has(origin));
      if (!everythingHeld) return { kind: 'not-held' };
      for (const name of request.permissions) grantedPermissions.delete(name);
      for (const origin of request.origins) grantedOrigins.delete(origin);
      persist();
      return { kind: 'removed', removed: { permissions: [...request.permissions], origins: [...request.origins] } };
    },
  };
  return grants;
};

export const createGrantRegistry = (
  options: Readonly<{ store?: OptionalGrantStore; log?: (message: string) => void }> = {}
): GrantRegistry => {
  const store = options.store ?? createMemoryOptionalGrantStore();
  const log = options.log ?? ((message: string) => console.error(`[BrowserExtensions] ${message}`));
  const entries = new Map<string, ExtensionGrants>();
  return {
    register: (seed) => {
      entries.set(seed.extensionId, buildGrants(seed, store, log));
    },
    unregister: (extensionId) => {
      entries.delete(extensionId);
    },
    has: (extensionId) => entries.has(extensionId),
    get: (extensionId) => entries.get(extensionId),
    ids: () => [...entries.keys()],
  };
};
