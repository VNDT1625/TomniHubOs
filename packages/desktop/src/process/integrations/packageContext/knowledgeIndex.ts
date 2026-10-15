/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The index of package knowledge and its default implementation (docs/platform/repotopackage-design.md sections 10.7,
 * 14 S11, task T6.3).
 *
 * The Library of files the person picked (storage, UI, file viewer: T6.2, `integrations/library/`) is another lane and
 * has its own read-only port. This is the smallest contract the `knowledge` host and the agent tool need for documents
 * that packages bring, with a default that keeps the index in memory and, when given a file, in a small JSON file next
 * to the other connection state. A later Library can implement this port over its own storage.
 *
 * - The index holds paths and titles only. It never copies a file: a document stays in the extracted package folder and is
 *   read lazily, through the reader the caller injected, only while a search runs. The reader is where Main validates
 *   the path (the connection registry's guarded reader: no traversal, no symlink out of the package); the index only
 *   ever asks for paths it holds.
 * - Search is read-only and bounded: at most {@link MAX_SCANNED_DOCUMENTS} documents per search, at most
 *   {@link MAX_READ_CHARS} characters read per document, text-like files only, and at most {@link MAX_LIMIT} hits.
 *   Document text is untrusted data. The index returns it as-is; the caller that hands it to a model inspects it.
 * - A collection is one `knowledge` connection of one package: `replaceCollection` swaps all of its documents at once
 *   and `removeCollection` / `removePackage` drop them, so turning a connection off leaves nothing behind.
 */

import { createJsonFile, type JsonFile } from './jsonFile';

export const MAX_SCANNED_DOCUMENTS = 1_000;
export const MAX_READ_CHARS = 200_000;
export const MAX_LIMIT = 20;
export const DEFAULT_LIMIT = 5;
export const MAX_SNIPPET_CHARS = 280;
const MAX_QUERY_TOKENS = 8;
const MAX_QUERY_CHARS = 512;
const MAX_COLLECTIONS = 2_000;
const MAX_DOCUMENTS_PER_COLLECTION = 200;
const READ_CONCURRENCY = 8;
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const COLLECTION_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Files whose text is read and searched; any other listed file matches by title and path only. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'md',
  'mdx',
  'markdown',
  'txt',
  'rst',
  'adoc',
  'json',
  'yaml',
  'yml',
  'toml',
  'csv',
]);

/** One `knowledge` connection of one package. */
export type KnowledgeOwner = Readonly<{ packageId: string; collectionId: string }>;

/** A document of a collection: a path inside the extracted package (`source/...`) and a title for display. */
export type KnowledgeDocument = Readonly<{ path: string; title: string }>;

export type KnowledgeCollection = KnowledgeOwner & Readonly<{ title: string; documents: readonly KnowledgeDocument[] }>;

export type KnowledgeSearchRequest = Readonly<{
  query: string;
  /** 1 to {@link MAX_LIMIT}; defaults to {@link DEFAULT_LIMIT}. */
  limit?: number;
  /** Search one package only. */
  packageId?: string;
  signal?: AbortSignal;
}>;

export type KnowledgeSearchHit = KnowledgeOwner &
  Readonly<{
    collectionTitle: string;
    path: string;
    title: string;
    /** A short passage around the first match, or empty when only the title or path matched. */
    snippet: string;
    score: number;
  }>;

export type KnowledgeSearchResult = Readonly<{
  hits: readonly KnowledgeSearchHit[];
  /** Documents that were looked at. */
  scanned: number;
  /** True when more documents matched than `hits` holds, or the scan limit cut the search short. */
  truncated: boolean;
}>;

export type KnowledgeIndexPort = Readonly<{
  /** Replaces every document of one collection. Paths are stored, nothing is copied. */
  replaceCollection: (
    owner: KnowledgeOwner,
    collection: Readonly<{ title: string; documents: readonly KnowledgeDocument[] }>
  ) => Promise<void>;
  /** Idempotent. */
  removeCollection: (owner: KnowledgeOwner) => Promise<void>;
  /** Idempotent. */
  removePackage: (packageId: string) => Promise<void>;
  collections: () => Promise<readonly KnowledgeCollection[]>;
  search: (request: KnowledgeSearchRequest) => Promise<KnowledgeSearchResult>;
}>;

/** Reads the text of one indexed document (Main-validated; `undefined` when it is missing or not readable). */
export type KnowledgeTextReader = (owner: KnowledgeOwner, documentPath: string) => Promise<string | undefined>;

export type KnowledgeIndexOptions = Readonly<{
  readText: KnowledgeTextReader;
  /** JSON file for the index. Omit for an index that lives in memory only. */
  file?: string;
  /** Test seam for the file. */
  jsonFile?: JsonFile;
}>;

const ownerKey = (owner: KnowledgeOwner): string => `${owner.packageId}\u0000${owner.collectionId}`;

const isString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

const isDocumentPath = (value: unknown): value is string =>
  isString(value, 240) &&
  !value.includes('\\') &&
  !value.startsWith('/') &&
  value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

const parseDocuments = (value: unknown): KnowledgeDocument[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const documents: KnowledgeDocument[] = [];
  for (const item of value.slice(0, MAX_DOCUMENTS_PER_COLLECTION)) {
    const record = item as { path?: unknown; title?: unknown } | null;
    if (record === null || typeof record !== 'object' || !isDocumentPath(record.path) || seen.has(record.path))
      continue;
    seen.add(record.path);
    documents.push({ path: record.path, title: isString(record.title, 200) ? record.title : record.path });
  }
  return documents;
};

const parseCollections = (raw: unknown): KnowledgeCollection[] => {
  const file = raw as { schemaVersion?: unknown; collections?: unknown } | null | undefined;
  if (file === null || file === undefined || typeof file !== 'object' || file.schemaVersion !== 1) return [];
  if (!Array.isArray(file.collections)) return [];
  const collections: KnowledgeCollection[] = [];
  for (const item of file.collections.slice(0, MAX_COLLECTIONS)) {
    const record = item as Record<string, unknown> | null;
    if (record === null || typeof record !== 'object') continue;
    const { packageId, collectionId, title } = record;
    if (typeof packageId !== 'string' || !PACKAGE_ID.test(packageId)) continue;
    if (typeof collectionId !== 'string' || !COLLECTION_ID.test(collectionId)) continue;
    collections.push({
      packageId,
      collectionId,
      title: isString(title, 200) ? title : collectionId,
      documents: parseDocuments(record['documents']),
    });
  }
  return collections;
};

const extensionOf = (documentPath: string): string => {
  const name = documentPath.slice(documentPath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/** Lower-case words of the query: letters and digits of any script, at most {@link MAX_QUERY_TOKENS}. */
export const tokenizeQuery = (query: string): string[] =>
  [
    ...new Set(
      query
        .slice(0, MAX_QUERY_CHARS)
        .toLowerCase()
        .match(/[\p{L}\p{N}]{2,}/gu) ?? []
    ),
  ].slice(0, MAX_QUERY_TOKENS);

const countOccurrences = (haystack: string, needle: string, cap: number): number => {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0 && count < cap) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
};

const snippetAround = (text: string, tokens: readonly string[]): string => {
  const lower = text.toLowerCase();
  let first = -1;
  for (const token of tokens) {
    const at = lower.indexOf(token);
    if (at >= 0 && (first < 0 || at < first)) first = at;
  }
  if (first < 0) return '';
  const start = Math.max(0, first - Math.floor(MAX_SNIPPET_CHARS / 3));
  const piece = text
    .slice(start, start + MAX_SNIPPET_CHARS)
    .replace(/\s+/gu, ' ')
    .trim();
  return `${start > 0 ? '…' : ''}${piece}${start + MAX_SNIPPET_CHARS < text.length ? '…' : ''}`;
};

export const createKnowledgeIndex = (options: KnowledgeIndexOptions): KnowledgeIndexPort => {
  const file = options.jsonFile ?? (options.file === undefined ? undefined : createJsonFile(options.file));
  const collections = new Map<string, KnowledgeCollection>();
  const ready: Promise<void> = (async () => {
    if (file === undefined) return;
    for (const collection of parseCollections(await file.read())) collections.set(ownerKey(collection), collection);
  })();

  const persist = async (): Promise<void> => {
    await file?.write({ schemaVersion: 1, collections: [...collections.values()] });
  };

  /** Applies a change and writes it; a failed write puts the previous state back and rethrows. */
  const mutate = async (change: () => boolean): Promise<void> => {
    await ready;
    const before = new Map(collections);
    if (!change()) return;
    try {
      await persist();
    } catch (error) {
      collections.clear();
      for (const [key, value] of before) collections.set(key, value);
      throw error;
    }
  };

  return {
    replaceCollection: (owner, collection) =>
      mutate(() => {
        if (!PACKAGE_ID.test(owner.packageId) || !COLLECTION_ID.test(owner.collectionId)) {
          throw new RangeError('Invalid Library collection.');
        }
        collections.set(ownerKey(owner), {
          packageId: owner.packageId,
          collectionId: owner.collectionId,
          title: collection.title.slice(0, 200),
          documents: parseDocuments(collection.documents),
        });
        return true;
      }),
    removeCollection: (owner) => mutate(() => collections.delete(ownerKey(owner))),
    removePackage: (packageId) =>
      mutate(() => {
        let removed = false;
        for (const [key, collection] of collections) {
          if (collection.packageId === packageId) removed = collections.delete(key) || removed;
        }
        return removed;
      }),
    collections: async () => {
      await ready;
      return [...collections.values()].map((collection) => structuredClone(collection));
    },
    search: async (request) => {
      await ready;
      const tokens = tokenizeQuery(request.query);
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(request.limit ?? DEFAULT_LIMIT)));
      if (tokens.length === 0) return { hits: [], scanned: 0, truncated: false };

      const candidates: { owner: KnowledgeOwner; collectionTitle: string; document: KnowledgeDocument }[] = [];
      for (const collection of collections.values()) {
        if (request.packageId !== undefined && collection.packageId !== request.packageId) continue;
        for (const document of collection.documents) {
          candidates.push({ owner: collection, collectionTitle: collection.title, document });
        }
      }
      const cut = candidates.length > MAX_SCANNED_DOCUMENTS;
      const scanned = cut ? candidates.slice(0, MAX_SCANNED_DOCUMENTS) : candidates;

      const hits: KnowledgeSearchHit[] = [];
      for (let from = 0; from < scanned.length; from += READ_CONCURRENCY) {
        if (request.signal?.aborted === true) break;
        // oxlint-disable-next-line no-await-in-loop -- a few reads at a time keep the load bounded
        const batch = await Promise.all(
          scanned.slice(from, from + READ_CONCURRENCY).map(async ({ owner, collectionTitle, document }) => {
            const label = `${document.title}\n${document.path}`.toLowerCase();
            const labelScore = tokens.filter((token) => label.includes(token)).length * 3;
            let text: string | undefined;
            if (TEXT_EXTENSIONS.has(extensionOf(document.path))) {
              try {
                text = (
                  await options.readText(
                    { packageId: owner.packageId, collectionId: owner.collectionId },
                    document.path
                  )
                )?.slice(0, MAX_READ_CHARS);
              } catch {
                text = undefined;
              }
            }
            const lower = text?.toLowerCase() ?? '';
            const contentScore = tokens.reduce((sum, token) => sum + countOccurrences(lower, token, 5), 0);
            const score = labelScore + contentScore;
            if (score === 0) return undefined;
            const hit: KnowledgeSearchHit = {
              packageId: owner.packageId,
              collectionId: owner.collectionId,
              collectionTitle,
              path: document.path,
              title: document.title,
              snippet: text === undefined ? '' : snippetAround(text, tokens),
              score,
            };
            return hit;
          })
        );
        for (const hit of batch) if (hit !== undefined) hits.push(hit);
      }
      hits.sort(
        (left, right) =>
          right.score - left.score ||
          left.packageId.localeCompare(right.packageId) ||
          left.path.localeCompare(right.path)
      );
      return { hits: hits.slice(0, limit), scanned: scanned.length, truncated: cut || hits.length > limit };
    },
  };
};
