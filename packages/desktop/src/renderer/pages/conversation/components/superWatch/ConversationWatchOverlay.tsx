/**
 * Chat surface host for Hub-owned docked feature clips. Optional package surfaces
 * register themselves after installation rather than being activated by core.
 */
import React from 'react';
import { ChatDockHost } from '../ChatDock';
import AgentMeshInlineCard from './AgentMeshInlineCard';

export type ConversationWatchOverlayProps = {
  conversationId?: string;
};

const ConversationWatchOverlay: React.FC<ConversationWatchOverlayProps> = ({ conversationId }) => {
  if (!conversationId) return null;

  return (
    <ChatDockHost>
      <AgentMeshInlineCard conversationId={conversationId} />
    </ChatDockHost>
  );
};

export default ConversationWatchOverlay;
