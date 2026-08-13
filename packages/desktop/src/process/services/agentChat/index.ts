/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared "agent chat" service — lets background AI surfaces run on either an
 * API-key provider model OR a CLI agent (Claude Code, Codex, Gemini CLI…),
 * selected by an opaque `model` string (`cli:<agentId>` → CLI agent).
 *
 * Public surface:
 *  - {@link withCliAgent} — wrap an `AgentChat` (browser/editor runner style).
 *  - {@link runAgentChatMessages} — one-shot helper for the bridges that call a
 *    flat `(model, messages) => Promise<string>` (Studio, IDE, Make Video,
 *    Testing, Monitor, Company). Routes CLI ids to the driver and delegates
 *    provider ids to the injected provider runner.
 *  - {@link isCliModelId} / {@link makeCliModelId} / {@link parseCliModelId} —
 *    the model-id encoding helpers.
 *
 * Process boundary: Main-process (Node.js) modules. No DOM APIs.
 */

export { CLI_MODEL_PREFIX, isCliModelId, makeCliModelId, parseCliModelId } from './cliModelId';
export { withCliAgent, __resetSharedCliDriver } from './cliAgentChat';
export { createCliAgentDriver, flattenMessagesToPrompt } from './cliAgentDriver';
export { createDirectCliAgentDriver, resolveDirectCliWorkspace } from './directCliAgent';
export { normalizeChatMessagesForMarkdown } from './markdownMessageNormalizer';

export * from './durability';

export * from './attachments';
export * from './permission';
export type { CliAgentDriver, CliAgentDriverDeps, CliConversationHandle, TurnSignal } from './cliAgentDriver';
export type { DirectCliAgentDriver, DirectCliAgentDriverDeps, DirectCliExecutionContext } from './directCliAgent';
export type { MarkdownMessageNormalizerDeps } from './markdownMessageNormalizer';

import type { AgentChat, ChatMessageInput } from './types';
import { listReadyProviders } from '@process/services/tomnyProviderBridge';
import type { IProvider } from '@/common/config/storage';
import { withCliAgent } from './cliAgentChat';
import type { DirectCliExecutionContext } from './directCliAgent';

/** A flat completion call shared by the non-runner bridges. */
export type FlatChat = (model: string, messages: ChatMessageInput[], signal?: AbortSignal) => Promise<string>;
export type { AgentChat, ChatContent, ChatMessageInput } from './types';

const PROVIDER_CHAT_TIMEOUT_MS = 90_000;

const isProviderModelEnabled = (provider: IProvider, model: string): boolean =>
  provider.model_enabled?.[model] !== false;

const isUsableProvider = (provider: IProvider): boolean =>
  provider.enabled !== false &&
  Boolean(provider.api_key) &&
  Boolean(provider.base_url) &&
  Array.isArray(provider.models) &&
  provider.models.length > 0;

const resolveProviderChatUrl = (provider: IProvider): string => {
  const base = provider.base_url.replace(/\/+$/, '');
  return provider.is_full_url ? base : `${base}/chat/completions`;
};

const firstProviderApiKey = (apiKeys: string): string =>
  apiKeys
    .split(/[,\n]/)
    .map((key) => key.trim())
    .find(Boolean) ?? '';

const pickProviderForModel = (providers: IProvider[], model: string): { provider: IProvider; model: string } | null => {
  const usable = providers.filter(isUsableProvider);
  const owner = usable.find((provider) => provider.models.includes(model) && isProviderModelEnabled(provider, model));
  if (owner) return { provider: owner, model };
  for (const provider of usable) {
    const fallback =
      provider.models.find((candidate) => isProviderModelEnabled(provider, candidate)) ?? provider.models[0];
    if (fallback) return { provider, model: fallback };
  }
  return null;
};

/** Creates a Hub-owned provider chat target usable by core services and package adapters. */
export const createProviderChat =
  (): AgentChat =>
  async ({ model, messages, signal }) => {
    const providers = (await listReadyProviders().catch((): IProvider[] => [])) ?? [];
    const selected = pickProviderForModel(providers, model);
    if (!selected) {
      throw new Error('No usable model is configured. Open Settings → Model and add a provider/model, then try again.');
    }

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), PROVIDER_CHAT_TIMEOUT_MS);
    if (signal) {
      if (signal.aborted) timeout.abort();
      else signal.addEventListener('abort', () => timeout.abort(), { once: true });
    }

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(resolveProviderChatUrl(selected.provider), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${firstProviderApiKey(selected.provider.api_key)}`,
        },
        body: JSON.stringify({ model: selected.model, messages, stream: false }),
        signal: timeout.signal,
      });
    } catch (error) {
      if (timeout.signal.aborted && !signal?.aborted) {
        throw new Error(`The model did not respond within ${Math.round(PROVIDER_CHAT_TIMEOUT_MS / 1000)}s.`, {
          cause: error,
        });
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Model request failed (HTTP ${response.status}). ${detail.slice(0, 300)}`);
    }
    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('The model returned an empty response.');
    return content;
  };

/**
 * One-shot helper for bridges that expose a flat `(model, messages)` chat. It
 * adapts the flat provider runner into an {@link AgentChat}, wraps it with CLI
 * routing, and invokes it once. CLI model ids (`cli:<agentId>`) are driven via
 * a CLI agent; all other ids fall through to `providerRun` unchanged.
 *
 * @param providerRun The surface's existing provider-backed flat chat.
 * @param model       The selected model id (provider model name or `cli:<id>`).
 * @param messages    The conversation messages for this single turn.
 * @param signal      Optional cancellation signal.
 */
export const runAgentChatMessages = (
  providerRun: FlatChat,
  model: string,
  messages: ChatMessageInput[],
  signal?: AbortSignal,
  context?: DirectCliExecutionContext
): Promise<string> => {
  const adapted: AgentChat = ({ model: m, messages: msgs, signal: s }) => providerRun(m, msgs as ChatMessageInput[], s);
  return withCliAgent(adapted, undefined, context)({ model, messages, signal });
};
