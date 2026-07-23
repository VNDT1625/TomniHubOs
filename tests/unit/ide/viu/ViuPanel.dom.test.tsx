/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigProvider, Message } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPremiumStarterProject } from '@/common/viu';

const mocks = vi.hoisted(() => ({
  inspectV2: vi.fn(),
  listAssets: vi.fn(),
  grantAsset: vi.fn(),
  commitV2: vi.fn(),
  publishPreview: vi.fn(),
  copyText: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/common', () => ({
  ipcBridge: { dialog: { showOpen: { invoke: vi.fn(async () => undefined) } } },
}));

vi.mock('@/renderer/pages/studio/ide/Viu/viuClient', () => ({
  viuClient: {
    inspectV2: mocks.inspectV2,
    listAssets: mocks.listAssets,
    grantAsset: mocks.grantAsset,
    commitV2: mocks.commitV2,
  },
}));

vi.mock('@/renderer/pages/studio/ide/teamEdit/teamEditClient', () => ({
  teamEditClient: { publishPreview: mocks.publishPreview },
  createViuLocalTestReference: (packageId: string) => `viu-preview://team-test/${packageId}`,
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: mocks.copyText,
}));

import ViuPanel from '@/renderer/pages/studio/ide/Viu';

const ROOT = 'C:\\repo';
const PROJECT = createPremiumStarterProject('panel-preview');

const renderPanel = (rootPath: string | null = ROOT) => {
  const onRequestWorkspace = vi.fn();
  const onStartAgent = vi.fn();
  render(
    <ConfigProvider>
      <div style={{ width: 1600, height: 1000 }}>
        <ViuPanel rootPath={rootPath} onRequestWorkspace={onRequestWorkspace} onStartAgent={onStartAgent} />
      </div>
    </ConfigProvider>
  );
  return { onRequestWorkspace, onStartAgent };
};

beforeEach(() => {
  mocks.inspectV2.mockReset().mockResolvedValue({ ok: true, data: PROJECT });
  mocks.listAssets.mockReset().mockResolvedValue({ ok: true, data: [] });
  mocks.grantAsset.mockReset();
  mocks.commitV2.mockReset();
  mocks.publishPreview.mockReset().mockResolvedValue({
    ok: true,
    data: { packageId: 'viu-preview-id' },
  });
  mocks.copyText.mockReset().mockResolvedValue(undefined);
  vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
  vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);
  vi.spyOn(Message, 'info').mockImplementation(() => undefined as never);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  );
  vi.stubGlobal('crypto', { randomUUID: () => 'preview-id' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ViuPanel Team preview publishing', () => {
  it('publishes the current VIU project through the existing local Team contract', async () => {
    renderPanel();

    fireEvent.click(await screen.findByTestId('viu-team-preview-publish'));

    await waitFor(() =>
      expect(mocks.publishPreview).toHaveBeenCalledWith(
        ROOT,
        PROJECT,
        expect.objectContaining({
          snapshotId: 'snapshot-preview-id',
          startScreenId: PROJECT.screenOrder[0],
          metadata: expect.objectContaining({
            title: PROJECT.title,
            createdBy: 'viu-editor-user',
            teamWorkspaceKey: ROOT,
          }),
        }),
        expect.objectContaining({
          packageId: 'viu-preview-id',
          teamWorkspaceKey: ROOT,
        })
      )
    );
    expect(await screen.findByText('ide.viu.next.teamPreview.published')).toBeInTheDocument();
    expect(screen.getByTestId('viu-team-preview-copy')).toBeInTheDocument();
  });

  it('copies the opaque local reference surfaced after publication', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('viu-team-preview-publish'));
    fireEvent.click(await screen.findByTestId('viu-team-preview-copy'));

    expect(mocks.copyText).toHaveBeenCalledWith('viu-preview://team-test/viu-preview-id');
  });

  it('keeps publishing disabled when VIU has no repository workspace', async () => {
    renderPanel(null);
    const publish = await screen.findByTestId('viu-team-preview-publish');

    expect(publish).toBeDisabled();
    fireEvent.click(publish);
    expect(mocks.publishPreview).not.toHaveBeenCalled();
  });
});
