/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * The status popover of a failed MCP check shows the error the probe returned, and the generic hint only when there
 * is no error text to show.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from '@arco-design/web-react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

vi.mock('@/renderer/hooks/context/FeedbackContext', () => ({
  useFeedback: () => ({ openFeedback: vi.fn(() => Promise.resolve()) }),
}));

import McpServerHeader from '@/renderer/pages/settings/ToolsSettings/McpServerHeader';
import type { IMcpServer } from '@/common/config/storage';

const buildServer = (last_test_error?: string): IMcpServer =>
  ({
    id: 's2',
    name: 'Context Mode',
    enabled: true,
    transport: { type: 'stdio', command: 'npx', args: ['-y', 'context-mode@1.0.169'] },
    last_test_status: 'error',
    ...(last_test_error === undefined ? {} : { last_test_error }),
    created_at: 0,
    updated_at: 0,
    original_json: '',
  }) as IMcpServer;

const renderError = (last_test_error?: string) =>
  render(
    <ConfigProvider>
      <McpServerHeader
        server={buildServer(last_test_error)}
        isTestingConnection={false}
        onTestConnection={vi.fn()}
        onEditServer={vi.fn()}
        onDeleteServer={vi.fn()}
      />
    </ConfigProvider>
  );

describe('McpServerHeader — status popover of a failed check', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the error text the probe returned instead of the generic hint', async () => {
    const user = userEvent.setup();
    renderError('MCP error -32001: Request timed out Server output: npm warn exec');
    await user.hover(screen.getByText('settings.mcpCheckFailedSimple'));
    expect(
      await screen.findByText('MCP error -32001: Request timed out Server output: npm warn exec')
    ).toBeInTheDocument();
    expect(screen.queryByText('settings.mcpInlineConfigHint')).not.toBeInTheDocument();
  });

  it('keeps the generic hint when no error text was recorded', async () => {
    const user = userEvent.setup();
    renderError(undefined);
    await user.hover(screen.getByText('settings.mcpCheckFailedSimple'));
    expect(await screen.findByText('settings.mcpInlineConfigHint')).toBeInTheDocument();
  });
});
