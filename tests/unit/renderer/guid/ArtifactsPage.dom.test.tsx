import { ipcBridge } from '@/common';
import type { IConversationArtifact } from '@/common/adapter/ipcBridge';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArtifactsPage from '@/renderer/pages/guid/shell/ArtifactsPage';
import { collectArtifactEntries } from '@/renderer/pages/guid/shell/artifactsModel';

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/renderer/pages/hub/packageClient', () => ({ packageClient: { list: vi.fn() } }));

const artifact = (id: string, createdAt: number, name: string): IConversationArtifact => ({
  id,
  conversation_id: 'c1',
  kind: 'skill_suggest',
  status: 'pending',
  payload: { cron_job_id: 'j', name, description: '' },
  created_at: createdAt,
  updated_at: createdAt,
});

describe('collectArtifactEntries', () => {
  it('merges per-conversation records newest first and skips failing conversations', async () => {
    const entries = await collectArtifactEntries(
      [{ id: 'a', name: 'A' }, { id: 'b' }, { id: 'c', name: 'C' }],
      async (id) => {
        if (id === 'a') return [artifact('1', 10, 'old')];
        if (id === 'b') throw new Error('boom');
        return [artifact('2', 20, 'new')];
      }
    );
    expect(entries.map((entry) => entry.artifact.id)).toEqual(['2', '1']);
    expect(entries[0].conversationName).toBe('C');
  });
});

describe('ArtifactsPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });
  afterEach(() => cleanup());

  it('shows an honest empty state and never navigates to the Store', async () => {
    vi.spyOn(ipcBridge.database.getUserConversations, 'invoke').mockResolvedValue({ items: [] } as never);
    render(<ArtifactsPage />);
    expect(await screen.findByTestId('hub-artifacts-empty')).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('lists real artifact records and opens their conversation', async () => {
    vi.spyOn(ipcBridge.database.getUserConversations, 'invoke').mockResolvedValue({
      items: [{ id: 'c1', name: 'Chat one' }],
    } as never);
    vi.spyOn(ipcBridge.conversation.listArtifacts, 'invoke').mockResolvedValue([artifact('1', 5, 'My skill')]);
    render(<ArtifactsPage />);
    const row = await screen.findByText('My skill');
    fireEvent.click(row);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/conversation/c1'));
  });
});
