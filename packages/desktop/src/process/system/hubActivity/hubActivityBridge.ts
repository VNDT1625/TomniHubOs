/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { hubActivityChannels } from '@/common/types/agent/hubActivity';
import type { HubActivityRegistry } from './hubActivityRegistry';
import { projectHubOverviewActions } from './hubToolOverview';

const MAX_ID_LENGTH = 512;

const boundedId = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : undefined;

const field = (input: unknown, key: string): unknown =>
  input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>)[key] : undefined;

let registered = false;

/**
 * Exposes the registry to the desktop renderer. Sender trust is enforced in the
 * main adapter allowlist; here every payload is shape- and size-checked, and
 * control actions only reach the owning source's controller.
 */
export const registerHubActivityBridge = (
    registry: HubActivityRegistry,
  requireAuthenticatedAccount?: () => void,
  getConversation?: (id: string) => Promise<{ id: string; name: string; extra?: { workspace?: string } } | undefined>
): void => {
  if (registered) return;
  registered = true;
  const guard = (): boolean => {
    try {
      requireAuthenticatedAccount?.();
      return true;
    } catch {
      return false;
    }
  };

    hubActivityChannels.snapshot.provider(async () =>
    guard() ? registry.snapshot() : { generatedAt: Date.now(), items: [] }
  );
  hubActivityChannels.trace.provider(async (input) => {
    const id = boundedId(field(input, 'id'));
    if (!id || !guard() || !id.startsWith('agent:')) return [];
    return registry.toolTrace('agent', id.slice('agent:'.length));
  });
    hubActivityChannels.overview.provider(async (input) => {
    const id = boundedId(field(input, 'id'));
    if (!id || !guard() || !id.startsWith('agent:')) return [];
    return projectHubOverviewActions(registry.toolTrace('agent', id.slice('agent:'.length)));
  });
  hubActivityChannels.stop.provider(async (input) => {
    const id = boundedId(field(input, 'id'));
    return Boolean(id && guard()) && registry.stop(id as string);
  });
  hubActivityChannels.respond.provider(async (input) => {
    const id = boundedId(field(input, 'id'));
    const promptId = boundedId(field(input, 'prompt_id'));
    const value = boundedId(field(input, 'value'));
    if (!id || !promptId || !value || !guard()) return false;
    return registry.respond(id, promptId, value);
  });
  hubActivityChannels.dismiss.provider(async (input) => {
    const id = boundedId(field(input, 'id'));
    return Boolean(id && guard()) && registry.dismiss(id as string);
  });
    hubActivityChannels.showConversation.provider(async (input) => {
    const conversationId = boundedId(field(input, 'conversation_id'));
        if (!conversationId || !/^[A-Za-z0-9._:-]{1,200}$/.test(conversationId) || !guard() || !getConversation) return false;
    const conversation = await getConversation(conversationId);
    if (!conversation || conversation.id !== conversationId) return false;
    if (!registry.get('agent', conversationId)) {
      registry.upsert('agent', conversationId, {
        title: conversation.name,
        workspace: conversation.extra?.workspace,
        route: `/conversation/${conversationId}`,
        status: 'done',
        canStop: false,
      });
    }
    return true;
  });
  registry.subscribe((snapshot) => hubActivityChannels.changed.emit(snapshot));
};
