import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({
  getSummary: vi.fn(),
  getPolicy: vi.fn(),
  previewCleanup: vi.fn(),
  updatePolicy: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    storageCenter: {
      getSummary: { invoke: mocks.getSummary },
      getPolicy: { invoke: mocks.getPolicy },
      previewCleanup: { invoke: mocks.previewCleanup },
      updatePolicy: { invoke: mocks.updatePolicy },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => `${key}${options?.bytes ? `:${options.bytes}` : ''}`,
  }),
}));

vi.mock('@/renderer/pages/settings/ResourceSettings/components/SectionCard', () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

import StorageCenter from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/StorageCenter';

describe('StorageCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSummary.mockResolvedValue({
      totalBytes: 1536,
      categories: [{ category: 'technicalCache', bytes: 1024, files: 2, state: 'ready' }],
    });
    mocks.getPolicy.mockResolvedValue({
      version: 1,
      automaticCleanup: true,
      lowDiskWatermarkBytes: 2_000_000_000,
      categories: {
        technicalCache: { management: 'ttl-managed', retentionDays: 14 },
        models: { management: 'lru-managed', quotaBytes: 20_000_000_000 },
        adapters: { management: 'lru-managed', quotaBytes: 5_000_000_000 },
        packageDownloads: { management: 'lru-managed', quotaBytes: 5_000_000_000 },
        logs: { management: 'ttl-managed', retentionDays: 30 },
        worktrees: { management: 'inspect-only' },
        userData: { management: 'protected' },
      },
    });
    mocks.previewCleanup.mockResolvedValue({ candidates: [], reclaimableBytes: 0 });
    mocks.updatePolicy.mockResolvedValue(undefined);
  });

  it('renders managed usage and an explicit protected-data guarantee', async () => {
    render(<StorageCenter isDesktop />);

    await waitFor(() => expect(screen.getByText('storage.title')).toBeInTheDocument());
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByText('storage.category.technicalCache')).toBeInTheDocument();
    expect(screen.getByText('storage.protectionNotice')).toBeInTheDocument();
    expect(mocks.previewCleanup).toHaveBeenCalled();
  });

  it('does not query Storage Center from a non-desktop surface', () => {
    render(<StorageCenter isDesktop={false} />);
    expect(mocks.getSummary).not.toHaveBeenCalled();
    expect(screen.queryByText('storage.title')).not.toBeInTheDocument();
  });
});
