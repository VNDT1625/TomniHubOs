/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.downloads` (docs/platform/repotopackage-design.md sections 12.3, 12.8 and 15.1): `search`, `cancel` and the
 * `onCreated` and `onChanged` events, over the downloads of the Browser profile through {@link DownloadsPort}. Every
 * method needs the manifest `downloads` permission.
 *
 * - `download` is refused. Tomny has no confirmation for a download an extension starts, and a file must never be
 *   saved on an extension's say-so. The refusal is a REJECTED with that reason, not a silent no-op.
 * - `filename` is the name of the file, never its full path: the folder stays in the Hub.
 * - Without the port, `search` lists nothing and `cancel` refuses every id.
 */

import { z } from 'zod';
import { broadcast } from '@process/integrations/browserExtensions/api/groups/shared/emit';
import {
  ApiError,
  defineApiMethod,
  type ApiGroup,
  type GroupContext,
} from '@process/integrations/browserExtensions/api/types';

export type DownloadState = 'in_progress' | 'interrupted' | 'complete';

export type DownloadRecord = Readonly<{
  id: number;
  url: string;
  finalUrl: string;
  filename: string;
  mime: string;
  state: DownloadState;
  paused: boolean;
  bytesReceived: number;
  totalBytes: number;
  startTime: string;
  endTime?: string;
  error?: string;
  exists: boolean;
}>;

/** The fields that changed, each with its new value and the old one when known (Chrome's `onChanged` delta). */
export type DownloadDelta = Readonly<Record<string, Readonly<{ current?: unknown; previous?: unknown }>>>;

export type DownloadsPortEvent =
  | Readonly<{ type: 'created'; record: DownloadRecord }>
  | Readonly<{ type: 'changed'; id: number; delta: DownloadDelta }>;

export type DownloadsPort = Readonly<{
  list: () => readonly DownloadRecord[];
  /** False when the id is unknown or that download is no longer in progress. */
  cancel: (id: number) => boolean;
  /** Returns the unsubscribe function. */
  subscribe: (listener: (event: DownloadsPortEvent) => void) => () => void;
}>;

const DOWNLOADS = ['downloads'] as const;
const MAX_RESULTS = 1000;

const searchSchema = z.object({
  id: z.number().int().min(0).optional(),
  url: z.string().max(2048).optional(),
  filename: z.string().max(1024).optional(),
  state: z.enum(['in_progress', 'interrupted', 'complete']).optional(),
  paused: z.boolean().optional(),
  exists: z.boolean().optional(),
  query: z.array(z.string().max(256)).max(10).optional(),
  limit: z.number().int().min(1).max(MAX_RESULTS).optional(),
});

const downloadSchema = z.object({ url: z.string().min(1).max(2048) });

/** Every term of the query must appear in the URL or the file name, as in Chrome. */
const matches = (record: DownloadRecord, query: z.output<typeof searchSchema>): boolean => {
  if (query.id !== undefined && record.id !== query.id) return false;
  if (query.url !== undefined && record.url !== query.url && record.finalUrl !== query.url) return false;
  if (query.filename !== undefined && record.filename !== query.filename) return false;
  if (query.state !== undefined && record.state !== query.state) return false;
  if (query.paused !== undefined && record.paused !== query.paused) return false;
  if (query.exists !== undefined && record.exists !== query.exists) return false;
  const haystack = `${record.url} ${record.filename}`.toLowerCase();
  return (query.query ?? []).every((term) => haystack.includes(term.toLowerCase()));
};

export const createDownloadsApi = (context: GroupContext, port: DownloadsPort | undefined): ApiGroup => {
  const both = ['service-worker', 'frame'] as const;

  const methods = [
    defineApiMethod({
      name: 'downloads.download',
      callers: both,
      requires: DOWNLOADS,
      audit: true,
      args: z.tuple([downloadSchema]),
      handle: () => {
        throw new ApiError(
          'REJECTED',
          'Tomny does not start downloads for extensions: there is no confirmation for them yet.'
        );
      },
    }),
    defineApiMethod({
      name: 'downloads.search',
      callers: both,
      requires: DOWNLOADS,
      audit: true,
      args: z.tuple([searchSchema]),
      handle: (_call, [query]) =>
        (port?.list() ?? []).filter((record) => matches(record, query)).slice(0, query.limit ?? MAX_RESULTS),
    }),
    defineApiMethod({
      name: 'downloads.cancel',
      callers: both,
      requires: DOWNLOADS,
      audit: true,
      args: z.tuple([z.number().int().min(0)]),
      handle: (_call, [id]) => {
        if (port === undefined || !port.cancel(id)) {
          throw new ApiError('REJECTED', `No download in progress with id: ${id}.`);
        }
        return null;
      },
    }),
  ];

  const unsubscribe = port?.subscribe((event) => {
    if (event.type === 'created') {
      broadcast(context, 'downloads.onCreated', [event.record], (grants) => grants.hasPermission('downloads'));
    } else {
      broadcast(context, 'downloads.onChanged', [{ id: event.id, ...event.delta }], (grants) =>
        grants.hasPermission('downloads')
      );
    }
  });

  return { methods, ...(unsubscribe === undefined ? {} : { dispose: unsubscribe }) };
};
