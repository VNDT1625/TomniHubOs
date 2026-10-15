/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationArtifact } from '@/common/adapter/ipcBridge';

export type ArtifactEntry = {
  artifact: IConversationArtifact;
  conversationId: string;
  conversationName: string;
};

type ConversationRef = { id: string; name?: string };

/** Never fan out more than this many per-conversation requests when the page opens. */
export const MAX_ARTIFACT_CONVERSATIONS = 60;

/**
 * Gathers the artifact records of the most recent conversations, newest first.
 * A conversation whose list fails is skipped; the page shows what could be read.
 */
export const collectArtifactEntries = async (
  conversations: readonly ConversationRef[],
  listArtifacts: (conversationId: string) => Promise<IConversationArtifact[]>
): Promise<ArtifactEntry[]> => {
  const recent = conversations.slice(0, MAX_ARTIFACT_CONVERSATIONS);
  const settled = await Promise.allSettled(recent.map((conversation) => listArtifacts(conversation.id)));
  const entries: ArtifactEntry[] = [];
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return;
    const conversation = recent[index];
    for (const artifact of result.value) {
      entries.push({
        artifact,
        conversationId: conversation.id,
        conversationName: conversation.name ?? conversation.id,
      });
    }
  });
  return entries.toSorted((a, b) => b.artifact.created_at - a.artifact.created_at);
};

/** Short human title for an artifact record; the payload is the only source, nothing is invented. */
export const artifactTitle = (artifact: IConversationArtifact): string =>
  artifact.kind === 'cron_trigger' ? artifact.payload.cron_job_name : artifact.payload.name;
