/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** DOM tests for the generic Hub Super policy control. */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider, Message } from '@arco-design/web-react';
import type { TChatConversation } from '@/common/config/storage';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const platformMock = vi.hoisted(() => ({ isElectronDesktop: vi.fn(() => true) }));
vi.mock('@/renderer/utils/platform', () => platformMock);

const convMock = vi.hoisted(() => ({
  get: vi.fn(() => Promise.resolve({ id: 'c1', extra: {} })),
  update: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { get: { invoke: convMock.get }, update: { invoke: convMock.update } } },
}));

import ConversationSurfaces from '@/renderer/pages/conversation/components/ConversationSurfaces';

const conversation = (extra?: Record<string, unknown>): TChatConversation => ({ id: 'c1', extra }) as TChatConversation;

const renderHeader = (conv: TChatConversation) =>
  render(
    <ConfigProvider>
      <ConversationSurfaces conversation={conv} />
    </ConfigProvider>
  );

describe('ConversationSurfaces (DOM)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    platformMock.isElectronDesktop.mockReturnValue(true);
    convMock.get.mockResolvedValue({ id: 'c1', extra: {} });
    convMock.update.mockResolvedValue(true);
  });

  afterEach(() => cleanup());

  it('shows the persisted generic Super policy state without assuming a Browser Surface', async () => {
    convMock.get.mockResolvedValue({ id: 'c1', extra: { super_mode: true } });
    renderHeader(conversation());

    const toggle = await screen.findByRole('switch');
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(screen.queryByText('workspace.watch')).toBeNull();
  });

  it('persists an explicit Super policy change and reports rejection', async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(Message, 'error').mockImplementation(() => undefined as never);
    const success = vi.spyOn(Message, 'success').mockImplementation(() => undefined as never);
    renderHeader(conversation());

    await user.click(await screen.findByRole('switch'));
    await waitFor(() =>
      expect(convMock.update).toHaveBeenCalledWith({ id: 'c1', updates: { super_mode: true }, merge_extra: true })
    );
    expect(success).toHaveBeenCalledWith('workspace.super.enabled');

    convMock.update.mockResolvedValue(false);
    await user.click(screen.getByRole('switch'));
    await waitFor(() => expect(error).toHaveBeenCalledWith('workspace.super.toggleError'));
  });

  it('keeps Browser implementation and watch UI out of the base conversation header', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'packages/desktop/src/renderer/pages/conversation/components/ConversationSurfaces.tsx'),
      'utf8'
    );

    expect(source).not.toContain('@renderer/pages/browser');
    expect(source).not.toContain('super.watch.');
    expect(source).not.toContain('workspace.watch');
  });
});
