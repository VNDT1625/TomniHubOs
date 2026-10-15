/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OutboundTextPart } from '../security/types';
import { withPipelineContext } from './promptContext';
import { readToolSelection } from './stages/toolSchemaStage';
import type { PipelineExecutionResult } from './types';

type TurnInput = Readonly<{ input: string; model_input?: string; files?: readonly string[] }>;

/**
 * The text that leaves for the model after the pipeline ran, as inspectable parts. The visible message and
 * its hidden model input follow the pipeline's rewrite; context that retrieve stages gathered is its own part,
 * so it is inspected like everything else before it reaches the model.
 */
export const buildOutboundParts = (
  result: Pick<PipelineExecutionResult, 'finalQuery' | 'finalContext'>,
  params: TurnInput
): OutboundTextPart[] => {
  // When the pipeline rewrites the user input (for example credential redaction), the hidden model input
  // follows it, so a secret cannot reach the model through the copy.
  const modelInput =
    params.model_input === undefined
      ? undefined
      : result.finalQuery !== params.input
        ? params.model_input.replace(params.input, result.finalQuery)
        : params.model_input;
  const context = result.finalContext?.trim() || undefined;
  const attachmentSection = (params.files ?? []).map((file) => '[Attached file: ' + file + ']').join('\n');
  const inspectedModelInput = [modelInput ?? result.finalQuery, attachmentSection].filter(Boolean).join('\n');
  return [
    { id: 'input', text: result.finalQuery, role: 'user', source: 'user' },
    ...(modelInput === undefined && !attachmentSection
      ? []
      : [{ id: 'model-input', text: inspectedModelInput, role: 'user', source: 'generated' } as const]),
    ...(context === undefined
      ? []
      : [{ id: 'pipeline-context', text: context, role: 'metadata', source: 'tool' } as const]),
  ];
};

/**
 * Parameters for the conversation service built from the inspected parts. `toolSelection` is assigned after
 * the spread on purpose: whatever the renderer sent under that name is discarded, so only the pipeline can
 * choose tool groups.
 */
export const composeSendParams = <T extends TurnInput>(
  params: T,
  safeParts: readonly OutboundTextPart[],
  toolSelection: readonly string[] | undefined
): T & { toolSelection: readonly string[] | undefined } => {
  const safeInput = safeParts.find((part) => part.id === 'input')?.text;
  if (safeInput === undefined) throw new Error('Outbound inspection returned no safe user input.');
  const safeModelInput = safeParts.find((part) => part.id === 'model-input')?.text;
  const safeContext = safeParts.find((part) => part.id === 'pipeline-context')?.text;
  return {
    ...params,
    input: safeInput,
    model_input: withPipelineContext(safeModelInput, safeInput, safeContext),
    toolSelection,
  };
};

export type ToolSelectionMemory = Readonly<{
  /** The selection to apply to this turn: the pipeline's choice merged with every earlier turn of the conversation. */
  next: (conversationId: string, grounding: Record<string, unknown> | undefined) => string[] | undefined;
}>;

/**
 * Tool groups only ever grow within a conversation. The CLI process is keyed by its tool list, so a list that
 * shrinks and grows again would restart it every turn. Memory is bounded to the most recent conversations.
 */
export const createToolSelectionMemory = (maxConversations = 200): ToolSelectionMemory => {
  const byConversation = new Map<string, Set<string>>();
  return {
    next: (conversationId, grounding) => {
      const fresh = readToolSelection(grounding);
      if (!fresh) return undefined;
      const merged = new Set(byConversation.get(conversationId) ?? []);
      for (const capabilityId of fresh) merged.add(capabilityId);
      byConversation.delete(conversationId);
      byConversation.set(conversationId, merged);
      if (byConversation.size > maxConversations) {
        const oldest = byConversation.keys().next().value;
        if (oldest !== undefined) byConversation.delete(oldest);
      }
      return [...merged].toSorted();
    },
  };
};
