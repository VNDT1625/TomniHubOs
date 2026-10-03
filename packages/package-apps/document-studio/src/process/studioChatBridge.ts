/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Studio chat IPC bridge — powers the document AI side-panel in the Studio
 * editor (the "ask the assistant to edit this file" panel).
 *
 * The renderer cannot call model providers directly (CORS / `webSecurity`), so —
 * exactly like the web-agent (`process/browser/providerChat.ts`) and the company
 * generator — the request is issued from the Main process against the user's
 * configured provider over the OpenAI-compatible `/chat/completions` endpoint.
 *
 * One channel: `studio.chat` — a single, non-streaming completion. The renderer
 * sends the picked model id, the conversation messages, and (optionally) the
 * current document so the assistant can answer about / rewrite it. Returns a
 * {@link StudioResult} envelope so a failure is observable instead of hanging
 * the renderer (the platform bridge swallows rejected promises).
 *
 * The global bootstrap (Task 15.x) calls {@link registerStudioChatBridge} once;
 * this module does not wire itself in (mirrors `companyBridge.ts`).
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { bridge } from '@office-ai/platform';
import { stripTokenWatermarkNotice } from '@/common/chat/chatLib';
import { createProviderChat, runAgentChatMessages } from '@process/services/agentChat';

/** IPC channel names for the Studio surface (renderer-safe contract). */
export const STUDIO_CHANNELS = {
  chat: 'studio.chat',
} as const;

/** One chat message exchanged with the document assistant. */
export type StudioChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** Request for {@link STUDIO_CHANNELS.chat}. */
export type StudioChatRequest = {
  /** Model id the user picked in the panel. */
  model: string;
  /** The running conversation (user/assistant turns). */
  messages: StudioChatMessage[];
  /** Absolute workspace selected by the user for document creation. */
  workspace?: string;
};

/**
 * Result envelope — always resolves (never rejects), so the renderer can branch
 * on `ok`. `code: 'no-model'` flags the "no usable model configured" case.
 */
export type StudioResult<T> = { ok: true; data: T } | { ok: false; error: string; code: 'no-model' | 'error' };

/** Typed Studio channels. Exported for bootstrap registration wiring. */
export const studioChannels = {
  chat: bridge.buildProvider<StudioResult<string>, StudioChatRequest>(STUDIO_CHANNELS.chat),
};

/** Detect the "no usable model" case so the UI can show a targeted hint. */
const classify = (error: unknown): 'no-model' | 'error' => {
  const message = error instanceof Error ? error.message : String(error);
  return /no usable model|no model|requires a generator/i.test(message) ? 'no-model' : 'error';
};

/** Provider egress, credentials, actor binding, and destination policy stay in Main's shared broker. */
const brokeredProviderChat = createProviderChat();

const runProviderChat = async (
  model: string,
  messages: StudioChatRequest['messages'],
  signal?: AbortSignal
): Promise<string> => stripTokenWatermarkNotice(await brokeredProviderChat({ model, messages, signal })).trim();

/**
 * Run one completion, routing a `cli:<agentId>` model id to a CLI agent (Claude
 * Code, Codex, Gemini CLI…) and any other model id to the provider path above.
 */
const runChat = async (req: StudioChatRequest): Promise<string> => {
  return runAgentChatMessages(
    (model, messages, signal) => runProviderChat(model, messages as StudioChatRequest['messages'], signal),
    req.model,
    req.messages,
    undefined,
    { workspace: req.workspace, surface: 'office', permissionMode: 'read-only' }
  );
};

/**
 * Register the Studio chat IPC handler. Idempotent (re-registration replaces the
 * bound handler). Intended to be called once during Main-process bootstrap.
 */
export function registerStudioChatBridge(): void {
  studioChannels.chat.provider(async (req): Promise<StudioResult<string>> => {
    try {
      return { ok: true, data: await runChat(req) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[StudioChatBridge] chat failed:', error);
      return { ok: false, error: message, code: classify(error) };
    }
  });
}
