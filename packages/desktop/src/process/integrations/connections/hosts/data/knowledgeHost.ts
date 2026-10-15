/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connection host for `knowledge` (docs/platform/repotopackage-design.md sections 9.3, 10.7, 14 S11, 15.1): documents a
 * package brings, listed in the Library and searchable by the agent with `tomny_library_search`.
 *
 * - Turning the connection on writes the document paths into the Library (`KnowledgeIndexPort`); no file is copied and nothing
 *   is read here beyond a small existence check. The text is read later, only while a search runs.
 * - The approval lists the documents (as many as fit) and says the access is read-only. Contents are not part of the
 *   approval: a data kind follows an updated package by itself, and a document that vanished is shown in the Library as
 *   no longer there.
 * - `disable` removes the collection. `reconcile` removes collections of connections that are no longer on and puts the
 *   ones that are back, so a restart restores the Library from the registry state.
 * - Not enforced here, and by design: nothing about a document grants a permission. The text is untrusted data; whoever
 *   hands it to a model inspects it first (`librarySearchPort.ts`).
 */

import type { EnabledConnection } from '@process/integrations/connections/core/registry';
import type { KnowledgeDocument, KnowledgeIndexPort } from '@process/integrations/packageContext/knowledgeIndex';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ApprovalSubject,
  type ConnectionOf,
  type HostCheck,
  type HostContext,
} from '../../core/types';

type KnowledgeConnection = ConnectionOf<'knowledge'>;

const SOURCE_PREFIX = 'source/';
const PROBE_FILES = 5;
const LISTED_IN_APPROVAL = 50;

export type KnowledgeHostDeps = Readonly<{
  library: KnowledgeIndexPort;
  /** Every knowledge connection that is on, to put the Library back after a restart. Bound late (the registry is built after its hosts). */
  enabledKnowledge?: () => Promise<readonly EnabledConnection[]>;
}>;

const titleOf = (documentPath: string): string => {
  const name = documentPath.slice(documentPath.lastIndexOf('/') + 1).replace(/\.[^.]+$/u, '');
  const words = name.replace(/[-_]+/gu, ' ').trim();
  return words === '' ? documentPath : words;
};

const documentsOf = (connection: KnowledgeConnection): KnowledgeDocument[] =>
  [...new Set(connection.paths)].map((documentPath) => ({ path: documentPath, title: titleOf(documentPath) }));

const subjectOf = (connection: KnowledgeConnection): ApprovalSubject => {
  const documents = documentsOf(connection);
  const shown = documents.slice(0, LISTED_IN_APPROVAL).map((document) => document.path);
  return {
    kind: 'knowledge',
    title: connection.title,
    lines: [
      {
        label: 'Type',
        value: 'Documents added to your Library. Files are not copied; the agent can search them, read-only.',
      },
      { label: 'Documents', value: String(documents.length) },
      {
        label: 'Paths',
        value: `${shown.join(', ')}${documents.length > shown.length ? `, and ${documents.length - shown.length} more` : ''}`,
      },
    ],
    files: [],
  };
};

export const createKnowledgeHost = (deps: KnowledgeHostDeps): AnyConnectionHost => {
  const check = async (context: HostContext, connection: KnowledgeConnection): Promise<HostCheck> => {
    if (connection.paths.some((documentPath) => !documentPath.startsWith(SOURCE_PREFIX))) {
      return { ok: false, reason: 'Every document must be inside the package source folder.' };
    }
    // Existence of a few is enough to say the package has its documents; the Library shows any that vanish later.
    for (const documentPath of connection.paths.slice(0, PROBE_FILES)) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- a handful of reads, stopping at the first that works
        await context.readPackageFile(documentPath);
        return { ok: true };
      } catch {
        // Try the next one.
      }
    }
    return { ok: false, reason: 'None of the documents is in the package.' };
  };

  const publish = (packageId: string, connection: KnowledgeConnection): Promise<void> =>
    deps.library.replaceCollection(
      { packageId, collectionId: connection.id },
      { title: connection.title, documents: documentsOf(connection) }
    );

  return defineConnectionHost({
    kind: 'knowledge',
    check,
    describe: async (_context, connection: KnowledgeConnection) => subjectOf(connection),
    enable: async (context, connection: KnowledgeConnection) => {
      const checked = await check(context, connection);
      if (checked.ok === false) throw new Error(checked.reason);
      await publish(context.packageId, connection);
      return { installed: [`library:${connection.id}`] };
    },
    disable: async (context, connection: KnowledgeConnection, _installed) => {
      await deps.library.removeCollection({ packageId: context.packageId, collectionId: connection.id });
    },
    reconcile: async ({ keep }) => {
      const wanted = new Map<string, { packageId: string; connection: KnowledgeConnection }>();
      for (const item of (await deps.enabledKnowledge?.()) ?? []) {
        if (item.connection.kind !== 'knowledge' || !keep.has(`${item.packageId}\u0000${item.key}`)) continue;
        wanted.set(`${item.packageId}\u0000${item.key}`, {
          packageId: item.packageId,
          connection: item.connection as KnowledgeConnection,
        });
      }
      for (const collection of await deps.library.collections()) {
        if (!keep.has(`${collection.packageId}\u0000knowledge:${collection.collectionId}`)) {
          // oxlint-disable-next-line no-await-in-loop -- one collection at a time
          await deps.library.removeCollection(collection);
        }
      }
      for (const { packageId, connection } of wanted.values()) {
        // oxlint-disable-next-line no-await-in-loop -- one collection at a time
        await publish(packageId, connection);
      }
    },
  });
};
