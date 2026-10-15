/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstallApprovalRequest } from '@/common/types/platform/packageConnections';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String(opts?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/gu, (_m, name: string) => String(opts?.[name] ?? '')),
  }),
}));

import InstallApprovalHost from '@/renderer/pages/integrations/installApproval/InstallApprovalHost';

type Listener = (request: InstallApprovalRequest) => void;

const request: InstallApprovalRequest = {
  requestId: 'req-1',
  packageId: 'com.example.context',
  packageName: 'Context Mode',
  keys: ['mcp:context7', 'hook:post'],
  groups: [
    {
      kind: 'mcp',
      kindName: 'mcp',
      count: 1,
      shared: [],
      rows: [
        {
          title: 'context7',
          count: 1,
          fields: [{ id: 'command', label: 'Command', value: 'npx -y ctx@1.0.0' }],
        },
      ],
      risks: ['setup-install'],
    },
    {
      kind: 'hook',
      kindName: 'hook',
      count: 2,
      shared: [{ id: 'network', label: 'Network', value: 'not restricted' }],
      rows: [{ title: 'PostToolUse', count: 2, fields: [{ id: 'command', label: 'Command', value: 'node a.js' }] }],
      risks: ['network-open'],
    },
  ],
};

describe('InstallApprovalHost', () => {
  let listener: Listener | undefined;
  let respond: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listener = undefined;
    respond = vi.fn().mockResolvedValue(true);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      packageConnections: {
        onInstallApprovalRequest: (next: Listener) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
        respondInstallApproval: respond,
      },
    };
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  const open = (): void => {
    act(() => {
      listener?.(request);
    });
  };

  it('renders nothing until a request arrives', () => {
    render(<InstallApprovalHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the package, the summary, the warnings and the connection groups', () => {
    render(<InstallApprovalHost />);
    open();
    expect(screen.getByRole('dialog', { name: 'guid.hubHome.installApproval.title' })).toBeTruthy();
    expect(screen.getByTestId('install-approval-package').textContent).toBe('Context Mode');
    expect(screen.getAllByRole('note')).toHaveLength(2);
    expect(screen.getByText('guid.hubHome.installApproval.risk.setupInstall')).toBeTruthy();
    expect(screen.getByText('guid.hubHome.installApproval.risk.networkOpen')).toBeTruthy();
    expect(screen.getByText('guid.hubHome.installApproval.kind.mcp')).toBeTruthy();
    expect(screen.getByText('guid.hubHome.installApproval.kind.hook')).toBeTruthy();
  });

  it('puts the default focus on Cancel and cancels on Escape with the keys it was shown', () => {
    render(<InstallApprovalHost />);
    open();
    const cancel = screen.getByRole('button', { name: 'guid.hubHome.installApproval.cancel' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(respond).toHaveBeenCalledWith({
      requestId: 'req-1',
      decision: 'cancel',
      autoStart: false,
      keys: ['mcp:context7', 'hook:post'],
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('approves without auto-start unless the switch is turned on first', () => {
    render(<InstallApprovalHost />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.installApproval.approve' }));
    expect(respond).toHaveBeenLastCalledWith({
      requestId: 'req-1',
      decision: 'approve',
      autoStart: false,
      keys: ['mcp:context7', 'hook:post'],
    });
  });

  it('sends auto-start with the approval when the switch is on, and resets it for the next request', () => {
    render(<InstallApprovalHost />);
    open();
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.installApproval.approve' }));
    expect(respond).toHaveBeenLastCalledWith(expect.objectContaining({ decision: 'approve', autoStart: true }));
  });

  it('keeps a second request queued and shows it after the first is answered', () => {
    render(<InstallApprovalHost />);
    open();
    act(() => {
      listener?.({ ...request, requestId: 'req-2', packageName: 'Second package' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.installApproval.cancel' }));
    expect(screen.getByTestId('install-approval-package').textContent).toBe('Second package');
  });
});
