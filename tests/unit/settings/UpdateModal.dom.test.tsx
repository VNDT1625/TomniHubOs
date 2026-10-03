/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UpdateModal from '@/renderer/components/settings/UpdateModal';

const { Icon } = vi.hoisted(() => ({ Icon: () => <span data-testid='icon' /> }));

const mocks = vi.hoisted(() => ({
  ipcBridge: {
    autoUpdate: {
      check: { invoke: vi.fn() },
      download: { invoke: vi.fn() },
      quitAndInstall: { invoke: vi.fn() },
      status: { on: vi.fn(() => () => undefined) },
    },
    update: { open: { on: vi.fn(() => () => undefined) } },
  },
}));

vi.mock('@/common', () => ({ ipcBridge: mocks.ipcBridge }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/components/base/TomnyModal', () => ({
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <div data-testid='update-modal'>{children}</div> : null,
}));
vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Progress: ({ percent }: { percent: number }) => <div data-testid='progress'>{percent}</div>,
  Message: { error: vi.fn() },
}));
vi.mock('@icon-park/react', () => {
  return { CheckOne: Icon, CloseOne: Icon, Download: Icon, Install: Icon, Refresh: Icon };
});

const openUpdateModal = async () => {
  render(<UpdateModal />);
  await act(async () => {
    window.dispatchEvent(new Event('tomny-open-update-modal'));
  });
  await screen.findByTestId('update-modal');
};

describe('UpdateModal signed updater flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ipcBridge.update.open.on.mockReturnValue(() => undefined);
    mocks.ipcBridge.autoUpdate.status.on.mockReturnValue(() => undefined);
    mocks.ipcBridge.autoUpdate.download.invoke.mockResolvedValue({ success: true });
  });

  afterEach(cleanup);

  it('downloads only through electron-updater after a signed update is available', async () => {
    mocks.ipcBridge.autoUpdate.check.invoke.mockResolvedValue({
      success: true,
      data: { currentVersion: '2.1.10', updateInfo: { version: '2.1.12', releaseNotes: '' } },
    });
    await openUpdateModal();
    await act(async () => {
      fireEvent.click(await screen.findByText('update.downloadAndInstall'));
    });

    await waitFor(() => expect(mocks.ipcBridge.autoUpdate.download.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.ipcBridge.update).toEqual({ open: expect.any(Object) });
  });

  it('fails closed when native update checking fails and exposes retry only', async () => {
    mocks.ipcBridge.autoUpdate.check.invoke.mockResolvedValue({ success: false, msg: 'signed update unavailable' });
    await openUpdateModal();

    expect(await screen.findByText('update.errorTitle')).toBeTruthy();
    expect(screen.getByText('common.retry')).toBeTruthy();
    expect(screen.queryByText('update.downloadAndInstall')).toBeNull();
    expect(mocks.ipcBridge.autoUpdate.download.invoke).not.toHaveBeenCalled();
  });
});
