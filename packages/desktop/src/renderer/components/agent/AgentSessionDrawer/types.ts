/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type SessionDrawerTab = 'save' | 'context' | 'secret';

export type InitialContextPreviewData = {
  model?: string;
  provider?: string;
  agentName?: string;
  agentDescription?: string;
  mode?: string;
  skills?: Array<{ name: string; description?: string }>;
  mcpServers?: Array<{ id: string; name: string }>;
  systemPrompt?: string;
};

export type AgentSessionDrawerProps = {
  visible: boolean;
  onClose: () => void;
  initialTab?: SessionDrawerTab;
  conversationId?: string | null;
  conversationType?: string | null;
  repository?: string | null;
  previewData?: InitialContextPreviewData;
};
