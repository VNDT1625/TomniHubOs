import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ideClient = vi.hoisted(() => ({
  repoSecretList: vi.fn(),
  repoSecretComboList: vi.fn(),
  repoSecretScopes: vi.fn(),
  repoSecretSave: vi.fn(),
  repoSecretComboSave: vi.fn(),
  repoSecretRemove: vi.fn(),
  repoSecretComboRemove: vi.fn(),
  repoSecretReveal: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; workspaces?: number; workspace?: string }) => {
      if (key === 'ide.memory.secret.currentWorkspace') return 'Current workspace';
      if (key === 'ide.memory.secret.otherWorkspaceNotice') {
        return `${options?.count ?? 0} secrets remain in ${options?.workspaces ?? 0} other workspaces.`;
      }
      if (key === 'ide.memory.secret.scopeSummary') return `${options?.workspace}: ${options?.count}`;
      return options?.count === undefined ? key : key + ':' + options.count;
    },
  }),
}));

vi.mock('@/renderer/pages/studio/ide/ideClient', () => ({ ideClient }));

import RepoSecretContextPanel from '@/renderer/pages/studio/ide/memory/RepoSecretContextPanel';

describe('RepoSecretContextPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ideClient.repoSecretList.mockResolvedValue({ ok: true, data: [] });
    ideClient.repoSecretScopes.mockResolvedValue({ ok: true, data: [] });
    ideClient.repoSecretComboList.mockResolvedValue({
      ok: true,
      data: [
        {
          comboId: 'github-account',
          comboLabel: 'GitHub account',
          description: 'Release credentials',
          keys: [
            {
              key: 'USERNAME',
              alias: 'GITHUB_ACCOUNT_USERNAME',
              status: 'set',
              updatedAt: 1,
            },
            {
              key: 'TOKEN',
              alias: 'GITHUB_ACCOUNT_TOKEN',
              status: 'set',
              updatedAt: 1,
            },
          ],
          updatedAt: 1,
        },
      ],
    });
  });

  it('renders one Combo entity with its complete key list and edit flow', async () => {
    render(<RepoSecretContextPanel repository='C:/repo' active />);

    expect(await screen.findByText('GitHub account')).toBeInTheDocument();
    expect(screen.getByText('GITHUB_ACCOUNT_USERNAME')).toBeInTheDocument();
    expect(screen.getByText('GITHUB_ACCOUNT_TOKEN')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ide.memory.secret.editCombo' }));

    expect(await screen.findByText('ide.memory.secret.editCombo')).toBeInTheDocument();
    expect(screen.getByDisplayValue('GitHub account')).toBeInTheDocument();
  });

  it('surfaces a Combo-list failure instead of rendering stale grouped metadata', async () => {
    ideClient.repoSecretComboList.mockResolvedValueOnce({ ok: false, error: 'vault unavailable' });

    render(<RepoSecretContextPanel repository='C:/repo' active />);

    expect(await screen.findByText('vault unavailable')).toBeInTheDocument();
    expect(screen.queryByText('GitHub account')).not.toBeInTheDocument();
  });

  it('explains that secrets remain attached to another workspace instead of looking deleted', async () => {
    ideClient.repoSecretComboList.mockResolvedValueOnce({ ok: true, data: [] });
    ideClient.repoSecretScopes.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          repository: 'c:/ndt/pj/ai_security-main',
          secretCount: 8,
          comboCount: 0,
          updatedAt: 2,
        },
      ],
    });

    render(<RepoSecretContextPanel repository='C:/NDT/PJ/AionUi' active />);

    expect(await screen.findByTestId('repo-secret-current-scope')).toHaveTextContent('Current workspaceAionUi');
    expect(await screen.findByTestId('repo-secret-other-scopes')).toHaveTextContent(
      '8 secrets remain in 1 other workspaces.'
    );
    expect(screen.getByText('ai_security-main: 8')).toBeInTheDocument();
  });
});
