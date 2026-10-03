import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sessionMemoryClient, getContext, updateContext } = vi.hoisted(() => ({
  sessionMemoryClient: {
    repoSecretList: vi.fn(),
    repoSecretComboList: vi.fn(),
    repoSecretScopes: vi.fn(),
    repoSecretSave: vi.fn(),
    repoSecretComboSave: vi.fn(),
    repoSecretRemove: vi.fn(),
    repoSecretComboRemove: vi.fn(),
    repoSecretReveal: vi.fn(),
  },
  getContext: vi.fn(),
  updateContext: vi.fn(),
}));

vi.mock('@/renderer/services/sessionMemoryClient', () => ({ sessionMemoryClient }));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getTomnyAgenticContext: { invoke: getContext },
      updateTomnyAgenticContext: { invoke: updateContext },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; workspaces?: number; workspace?: string; defaultValue?: string }) => {
      if (options?.defaultValue) return options.defaultValue;
      if (key === 'ide.memory.secret.currentWorkspace') return 'Current workspace';
      if (key === 'ide.memory.secret.otherWorkspaceNotice') {
        return `${options?.count ?? 0} secrets remain in ${options?.workspaces ?? 0} other workspaces.`;
      }
      if (key === 'ide.memory.secret.scopeSummary') return `${options?.workspace}: ${options?.count}`;
      return options?.count === undefined ? key : key + ':' + options.count;
    },
  }),
}));

import { AgentSecretPanel } from '@/renderer/components/agent/AgentSessionDrawer/AgentSecretPanel';
import { AgentContextPanel } from '@/renderer/components/agent/AgentSessionDrawer/AgentContextPanel';

const snapshot = {
  model: 'tomny-pro-dev',
  system: 'You are Tomny Ai, a platform engineer.',
  messages: [],
  tools: [],
  max_tokens: 8192,
  thinking: null,
  reasoning_effort: 'medium',
  custom_context: 'Always provide concise solutions.',
  context_branches: [],
  active_context_branch_ids: [],
  working_memory: {},
  full_message_count: 10,
  tool_cache: {},
  session_experience: {},
  core_context: {
    agent: 'Name: Tomny',
    personal: 'Preferred language: Vietnamese',
    control_tools: [],
    history: [],
  },
  token_estimate: { system: 100, messages: 200, tools: 50, core: 30, total: 380 },
};

describe('AgentSessionDrawer Panels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMemoryClient.repoSecretList.mockResolvedValue({ ok: true, data: [] });
    sessionMemoryClient.repoSecretScopes.mockResolvedValue({ ok: true, data: [] });
    sessionMemoryClient.repoSecretComboList.mockResolvedValue({
      ok: true,
      data: [
        {
          comboId: 'database-credentials',
          comboLabel: 'Database Credentials',
          description: 'Production DB account with host URL, username and password',
          keys: [
            {
              key: 'DB_HOST_URL',
              alias: 'DATABASE_CREDENTIALS_DB_HOST_URL',
              status: 'set',
              updatedAt: 1,
            },
            {
              key: 'USERNAME',
              alias: 'DATABASE_CREDENTIALS_USERNAME',
              status: 'set',
              updatedAt: 1,
            },
            {
              key: 'PASSWORD',
              alias: 'DATABASE_CREDENTIALS_PASSWORD',
              status: 'set',
              updatedAt: 1,
            },
          ],
          updatedAt: 1,
        },
      ],
    });
    getContext.mockResolvedValue({ ok: true, data: snapshot });
    updateContext.mockResolvedValue({ ok: true, data: snapshot });
  });

  describe('AgentSecretPanel', () => {
    it('renders multi-field Secret Combo (URL, username, password) and allows editing', async () => {
      render(<AgentSecretPanel repository='C/repo' active />);

      expect(await screen.findByText('Database Credentials')).toBeInTheDocument();
      expect(screen.getByText('DATABASE_CREDENTIALS_DB_HOST_URL')).toBeInTheDocument();
      expect(screen.getByText('DATABASE_CREDENTIALS_USERNAME')).toBeInTheDocument();
      expect(screen.getByText('DATABASE_CREDENTIALS_PASSWORD')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'ide.memory.secret.editCombo' }));

      expect(await screen.findByText('ide.memory.secret.editCombo')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Database Credentials')).toBeInTheDocument();
    });

    it('reveals secret value locally when clicking reveal', async () => {
      sessionMemoryClient.repoSecretReveal.mockResolvedValueOnce({
        ok: true,
        data: 'postgres://admin:secret@db.internal:5432/main',
      });

      render(<AgentSecretPanel repository='C/repo' active />);

      expect(await screen.findByText('Database Credentials')).toBeInTheDocument();
      const revealBtns = screen.getAllByRole('button', { name: 'ide.memory.secret.reveal' });
      expect(revealBtns.length).toBeGreaterThan(0);

      fireEvent.click(revealBtns[0]);
      expect(await screen.findByDisplayValue('postgres://admin:secret@db.internal:5432/main')).toBeInTheDocument();
    });

    it('shows no workspace bound view when repository is not provided', () => {
      render(<AgentSecretPanel repository={null} active />);
      expect(screen.getByText('No Workspace Bound')).toBeInTheDocument();
    });
  });

  describe('AgentContextPanel', () => {
    it('renders exact Context inspector with model, tokens, custom context, and core branches', async () => {
      render(<AgentContextPanel conversationId='conv-1' active />);

      expect(await screen.findByText('tomny-pro-dev')).toBeInTheDocument();
      expect(screen.getByText('ide.memory.context.exactTitle')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Always provide concise solutions.')).toBeInTheDocument();
      expect(screen.getByText('ide.memory.context.coreContext')).toBeInTheDocument();
    });

    it('shows pre-session preview data when no conversationId is present', () => {
      render(
        <AgentContextPanel
          conversationId={null}
          active
          previewData={{
            agentName: 'Custom Research Agent',
            agentDescription: 'Agent designed for research and analysis',
            model: 'gpt-4',
          }}
        />
      );

      expect(screen.getByText('Custom Research Agent')).toBeInTheDocument();
      expect(screen.getByText('Agent designed for research and analysis')).toBeInTheDocument();
    });
  });
});
