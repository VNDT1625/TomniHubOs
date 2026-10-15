/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The port behind the agent tool `tomny_library_search` (docs/platform/repotopackage-design.md section 10.7, task T6.3).
 *
 * Read-only: it only searches the Library index. The tool takes a query and a count and nothing that names a file; the
 * paths in the answer come from the index, and the text behind them was read by the index's guarded reader, so a model
 * can neither choose nor traverse a path. The answer is capped to {@link MAX_RESULT_CHARS} and passed through the
 * outbound text inspection (a secret is masked; a blocked answer is withheld) because document text is untrusted data
 * on its way to a model.
 */

import { randomUUID } from 'node:crypto';
import type { CoreLibrarySearchPort } from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';
import { inspectOutboundText } from '@process/services/security/outboundTextInspection';
import type {
  OutboundInspectionRequest,
  OutboundInspectionResult,
  OutboundPolicyContext,
} from '@process/services/security/types';
import type { KnowledgeIndexPort, KnowledgeSearchHit } from './knowledgeIndex';

/** Largest answer the tool returns. */
export const MAX_RESULT_CHARS = 12_000;

export type KnowledgeSearchPortOptions = Readonly<{
  /** The outbound text check. Defaults to the application's. */
  inspect?: (request: OutboundInspectionRequest, context: OutboundPolicyContext) => Promise<OutboundInspectionResult>;
}>;

const renderHit = (hit: KnowledgeSearchHit, index: number): string =>
  [
    `${index + 1}. ${hit.title} (${hit.collectionTitle}, package ${hit.packageId})`,
    `   path: ${hit.path}`,
    ...(hit.snippet === '' ? [] : [`   ${hit.snippet}`]),
  ].join('\n');

export const createCoreLibrarySearchPort = (
  library: KnowledgeIndexPort,
  options: KnowledgeSearchPortOptions = {}
): CoreLibrarySearchPort => {
  const inspect = options.inspect ?? inspectOutboundText;
  return {
    search: async (input) => {
      const result = await library.search({
        query: input.query,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (result.hits.length === 0) {
        return {
          ok: true,
          message:
            'No document in the Library matches. The Library holds only documents of packages the person turned on.',
        };
      }
      const header = `Library results for "${input.query.replace(/\s+/gu, ' ').slice(0, 120)}" (${result.hits.length} shown${result.truncated ? ', more matched or the scan limit was reached' : ''}):`;
      const text = [header, ...result.hits.map(renderHit)].join('\n');
      const capped = text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n...[truncated]` : text;
      const inspection = await inspect(
        {
          schemaVersion: 1,
          requestId: randomUUID(),
          actorId: 'local-user',
          surface: 'tool',
          target: { kind: 'tool-result', id: 'tomny_library_search' },
          parts: [{ id: 'library-results', text: capped, source: 'file' }],
          sensitivity: 'normal',
        },
        { allowSanitize: true, requireApprovalForFindings: false, policyVersion: 'library-search-v1' }
      );
      const safe = inspection.safeParts[0]?.text;
      if ((inspection.decision !== 'allow' && inspection.decision !== 'sanitize') || safe === undefined) {
        return { ok: false, message: 'The results were withheld by the outbound text check.' };
      }
      return { ok: true, message: safe };
    },
  };
};
