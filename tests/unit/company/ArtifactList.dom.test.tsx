/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '@package-apps/company/renderer/company/pipeline/pipelineTypes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mocks = vi.hoisted(() => ({ showItemInFolder: vi.fn(), error: vi.fn() }));

vi.mock('@/common/adapter/ipcBridge', () => ({
  shell: { showItemInFolder: { invoke: mocks.showItemInFolder } },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, error: mocks.error } };
});

import ArtifactList from '@package-apps/company/renderer/company/manager/ArtifactList';

const artifact = (patch: Partial<Artifact>): Artifact => ({
  id: 'a1',
  nodeId: 'n1',
  kind: 'test-report',
  title: 'Test: login',
  at: 0,
  ...patch,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('company artifact list', () => {
  it('reveals a real file in its folder without opening it', () => {
    mocks.showItemInFolder.mockResolvedValue(undefined);
    render(<ArtifactList artifacts={[artifact({ path: '/work/report.html' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'company.pipeline.showInFolder' }));
    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/work/report.html');
  });

  it('offers nothing to reveal for simulated or path-less output', () => {
    render(
      <ArtifactList
        artifacts={[
          artifact({ id: 'a1', path: '/work', simulated: true }),
          artifact({ id: 'a2', kind: 'doc', title: 'Plan' }),
        ]}
      />
    );
    expect(screen.queryByRole('button', { name: 'company.pipeline.showInFolder' })).toBeNull();
    expect(screen.getByText('company.pipeline.simulated')).toBeTruthy();
  });

  it('says so when the file cannot be shown', async () => {
    mocks.showItemInFolder.mockRejectedValue(new Error('gone'));
    render(<ArtifactList artifacts={[artifact({ path: '/work/missing.html' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'company.pipeline.showInFolder' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('company.pipeline.showInFolderFailed'));
  });
});
