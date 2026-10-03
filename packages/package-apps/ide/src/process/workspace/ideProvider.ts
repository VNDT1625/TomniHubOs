/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared provider-chat plumbing for the IDE repo-intelligence bridges
 * (`ideExplainBridge.ts` + `ideWikiBridge.ts`).
 *
 * The renderer cannot call model providers directly (CORS / `webSecurity`), so
 * IDE completions cross the shared Main provider-execution broker. The broker
 * owns provider selection, Trust authorization, opaque secret resolution, final
 * egress inspection, pinned transport, cancellation, and redacted evidence.
 * IDE never receives a provider record, endpoint, or credential and has no raw
 * network fallback.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { createProviderChat, runAgentChatMessages, type DirectCliExecutionContext } from '@process/services/agentChat';

/** One chat message exchanged with the model provider. */
export type IdeChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** Detect the "no usable model" case so the UI can show a targeted hint. */
export const classifyModelError = (error: unknown): 'no-model' | 'error' => {
  const message = error instanceof Error ? error.message : String(error);
  return /no usable model|no model|requires a generator|provider_execution_unavailable/i.test(message)
    ? 'no-model'
    : 'error';
};

/**
 * Issue one non-streaming completion through the bootstrap-configured broker.
 * A missing broker fails closed before provider discovery; the caller cannot
 * pass a destination or a secret to this boundary.
 */
const brokeredProviderChat = createProviderChat();

/**
 * Run one IDE completion, routing a `cli:<agentId>` model id to a CLI agent
 * (Claude Code, Codex, Gemini CLI…) and any other model id to the governed
 * provider-execution broker.
 */
export const runIdeChat = async (
  model: string,
  messages: IdeChatMessage[],
  signal?: AbortSignal,
  context?: Omit<DirectCliExecutionContext, 'surface'>
): Promise<string> => {
  return runAgentChatMessages(
    (providerModel, providerMessages, providerSignal) =>
      brokeredProviderChat({ model: providerModel, messages: providerMessages, signal: providerSignal }),
    model,
    messages,
    signal,
    { ...context, surface: 'ide' }
  );
};
