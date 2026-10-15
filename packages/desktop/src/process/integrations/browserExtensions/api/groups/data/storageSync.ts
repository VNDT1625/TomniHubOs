/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.storage.sync` (docs/platform/repotopackage-design.md sections 12.3 and 12.8). Electron 37 has the object, but
 * every call on it fails ("sync is not available in this instance of Chrome"), so the shim replaces `get`, `getKeys`,
 * `set`, `remove`, `clear` and `getBytesInUse` with this implementation.
 *
 * - "Sync" here means local: the items live on this device, in one file per extension ({@link SyncStoragePort}).
 *   Nothing is sent anywhere, and nothing is shared between devices.
 * - The Chrome quotas apply: 102400 bytes in all, 8192 bytes per item and 512 items. A write over a quota is refused
 *   with Chrome's message, and none of that write is stored.
 * - Values must be JSON. The key `__proto__` is refused. Calls are serialized per extension.
 * - Every call needs the manifest `storage` permission, as in Chrome.
 * - `onChanged` for the sync area is not replaced; Electron's event is left as it is.
 */

import { z } from 'zod';
import {
  ApiError,
  defineApiMethod,
  type ApiGroup,
  type GroupContext,
} from '@process/integrations/browserExtensions/api/types';

export type SyncItems = Readonly<Record<string, unknown>>;

export type SyncStoragePort = Readonly<{
  /** The stored items of one extension, or undefined when it has none. Rejects when the stored data is damaged. */
  read: (extensionId: string) => Promise<SyncItems | undefined>;
  /** Replaces everything stored for the extension. */
  write: (extensionId: string, items: SyncItems) => Promise<void>;
}>;

export const SYNC_QUOTA_BYTES = 102_400;
export const SYNC_QUOTA_BYTES_PER_ITEM = 8_192;
export const SYNC_MAX_ITEMS = 512;

const STORAGE = ['storage'] as const;
const MAX_KEY = 512;
const encoder = new TextEncoder();

const keySchema = z
  .string()
  .min(1)
  .max(MAX_KEY)
  .refine((key) => key !== '__proto__', 'reserved key');
const keysSchema = z.union([z.string().max(MAX_KEY), z.array(z.string().max(MAX_KEY)).max(SYNC_MAX_ITEMS)]);
const itemsSchema = z.record(keySchema, z.unknown());

/** The JSON text of a value, or undefined when it is not JSON (a function, an undefined, a cycle). */
const serialize = (value: unknown): string | undefined => {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

const bytes = (text: string): number => encoder.encode(text).length;
/** Chrome counts the key and the JSON text of the value. */
const itemSize = (key: string, value: unknown): number => bytes(key) + bytes(serialize(value) ?? '');

const checkQuota = (items: ReadonlyMap<string, unknown>, written: readonly string[]): void => {
  if (items.size > SYNC_MAX_ITEMS) throw new ApiError('REJECTED', 'MAX_ITEMS quota exceeded');
  let total = 0;
  for (const [key, value] of items) {
    const size = itemSize(key, value);
    total += size;
    if (written.includes(key) && size > SYNC_QUOTA_BYTES_PER_ITEM) {
      throw new ApiError('REJECTED', 'QUOTA_BYTES_PER_ITEM quota exceeded');
    }
  }
  if (total > SYNC_QUOTA_BYTES) throw new ApiError('REJECTED', 'QUOTA_BYTES quota exceeded');
};

export const createStorageSyncApi = (context: GroupContext, port: SyncStoragePort | undefined): ApiGroup => {
  const both = ['service-worker', 'frame'] as const;
  const cache = new Map<string, Map<string, unknown>>();
  const queues = new Map<string, Promise<unknown>>();

  const need = (): SyncStoragePort => {
    if (port === undefined) {
      throw new ApiError('UNSUPPORTED', 'chrome.storage.sync is not available: the sync storage is not wired.');
    }
    return port;
  };
  const load = async (extensionId: string): Promise<Map<string, unknown>> => {
    const known = cache.get(extensionId);
    if (known !== undefined) return known;
    const stored = await need().read(extensionId);
    const items = new Map<string, unknown>(Object.entries(stored ?? {}));
    cache.set(extensionId, items);
    return items;
  };
  const commit = async (extensionId: string, next: Map<string, unknown>): Promise<void> => {
    await need().write(extensionId, Object.fromEntries(next));
    cache.set(extensionId, next);
  };
  /** One operation of an extension at a time, so two writes never interleave with a read. */
  const exclusive = (extensionId: string, task: () => Promise<unknown>): Promise<unknown> => {
    const run = (queues.get(extensionId) ?? Promise.resolve()).then(task);
    // A failed operation must not block the next one of the same extension.
    queues.set(
      extensionId,
      run.catch((): undefined => undefined)
    );
    return run;
  };

  const methods = [
    defineApiMethod({
      name: 'storage.sync.get',
      callers: both,
      requires: STORAGE,
      args: z.union([z.tuple([]), z.tuple([z.null()]), z.tuple([keysSchema]), z.tuple([itemsSchema])]),
      handle: (call, args) =>
        exclusive(call.extensionId, async () => {
          const items = await load(call.extensionId);
          const request = (args as readonly unknown[])[0];
          if (request === undefined || request === null) return Object.fromEntries(items);
          if (typeof request === 'string') {
            return items.has(request) ? Object.fromEntries([[request, items.get(request)]]) : {};
          }
          if (Array.isArray(request)) {
            return Object.fromEntries(
              (request as readonly string[]).filter((key) => items.has(key)).map((key) => [key, items.get(key)])
            );
          }
          // An object gives the default for each key that is not stored.
          return Object.fromEntries(
            Object.entries(request as SyncItems).map(([key, fallback]) => [
              key,
              items.has(key) ? items.get(key) : fallback,
            ])
          );
        }),
    }),
    defineApiMethod({
      name: 'storage.sync.getKeys',
      callers: both,
      requires: STORAGE,
      args: z.tuple([]),
      handle: (call) => exclusive(call.extensionId, async () => [...(await load(call.extensionId)).keys()]),
    }),
    defineApiMethod({
      name: 'storage.sync.set',
      callers: both,
      requires: STORAGE,
      args: z.tuple([itemsSchema]),
      handle: (call, [changes]) =>
        exclusive(call.extensionId, async () => {
          for (const [key, value] of Object.entries(changes)) {
            if (serialize(value) === undefined) {
              throw new ApiError('INVALID_ARGUMENTS', `The value of "${key}" is not JSON.`);
            }
          }
          const next = new Map(await load(call.extensionId));
          for (const [key, value] of Object.entries(changes)) next.set(key, value);
          checkQuota(next, Object.keys(changes));
          await commit(call.extensionId, next);
          return null;
        }),
    }),
    defineApiMethod({
      name: 'storage.sync.remove',
      callers: both,
      requires: STORAGE,
      args: z.tuple([keysSchema]),
      handle: (call, [keys]) =>
        exclusive(call.extensionId, async () => {
          const next = new Map(await load(call.extensionId));
          for (const key of typeof keys === 'string' ? [keys] : keys) next.delete(key);
          await commit(call.extensionId, next);
          return null;
        }),
    }),
    defineApiMethod({
      name: 'storage.sync.clear',
      callers: both,
      requires: STORAGE,
      args: z.tuple([]),
      handle: (call) =>
        exclusive(call.extensionId, async () => {
          await commit(call.extensionId, new Map());
          return null;
        }),
    }),
    defineApiMethod({
      name: 'storage.sync.getBytesInUse',
      callers: both,
      requires: STORAGE,
      args: z.union([z.tuple([]), z.tuple([z.union([z.null(), keysSchema])])]),
      handle: (call, args) =>
        exclusive(call.extensionId, async () => {
          const items = await load(call.extensionId);
          const request = (args as readonly unknown[])[0];
          const keys: readonly string[] =
            request === undefined || request === null
              ? [...items.keys()]
              : typeof request === 'string'
                ? [request]
                : (request as readonly string[]);
          let total = 0;
          for (const key of keys) {
            if (items.has(key)) total += itemSize(key, items.get(key));
          }
          return total;
        }),
    }),
  ];

  return { methods };
};
