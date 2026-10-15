/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpPermission, IMessagePermission } from '@/common/chat/chatLib';
import MessagePermission from '@/renderer/pages/conversation/Messages/components/MessagePermission';
import MessageAcpPermission from '@/renderer/pages/conversation/Messages/acp/MessageAcpPermission';

const mocks = vi.hoisted(() => ({
  resolveNativePermission: vi.fn(async () => true),
  confirmationConfirm: vi.fn(async () => true),
  confirmMessage: vi.fn(async () => undefined),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      resolveNativePermission: { invoke: mocks.resolveNativePermission },
      confirmation: { confirm: { invoke: mocks.confirmationConfirm } },
    },
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: { confirmMessage: { invoke: mocks.confirmMessage } },
}));

function MockButton(props: PropsWithChildren<{ onClick?: () => void; disabled?: boolean; 'data-testid'?: string }>) {
  return (
    <button type='button' disabled={props.disabled} onClick={props.onClick} data-testid={props['data-testid']}>
      {props.children}
    </button>
  );
}
function MockCard(props: PropsWithChildren<{ 'data-testid'?: string }>) {
  return <div data-testid={props['data-testid']}>{props.children}</div>;
}
function MockRadio(props: PropsWithChildren) {
  return <div>{props.children}</div>;
}
function MockRadioGroup(props: PropsWithChildren) {
  return <div>{props.children}</div>;
}

vi.mock('@arco-design/web-react', () => ({
  Button: MockButton,
  Card: MockCard,
  Radio: Object.assign(MockRadio, { Group: MockRadioGroup }),
  Message: { error: () => undefined },
  Typography: { Text: (props: PropsWithChildren) => <span>{props.children}</span> },
}));

const nativePermissionMessage = {
  id: 'msg-1',
  msg_id: 'msg-1',
  conversation_id: 'conv-1',
  type: 'permission',
  content: {
    id: 'conf-1',
    call_id: 'call-1',
    description: 'Run a shell command',
    options: [
      { label: 'proceed_once', value: 'proceed_once' },
      { label: 'proceed_always', value: 'proceed_always' },
      { label: 'cancel', value: 'cancel' },
    ],
    native_core_permission_id: 'perm-1',
  },
} as unknown as IMessagePermission;

const nonNativePermissionMessage = {
  id: 'msg-2',
  msg_id: 'msg-2',
  conversation_id: 'conv-1',
  type: 'permission',
  content: {
    id: 'conf-2',
    call_id: 'call-2',
    description: 'Orchestration step',
    options: [
      { label: 'proceed_once', value: 'proceed_once' },
      { label: 'proceed_always', value: 'proceed_always' },
      { label: 'cancel', value: 'cancel' },
    ],
  },
} as unknown as IMessagePermission;

const acpPermissionMessage = {
  id: 'msg-3',
  conversation_id: 'conv-1',
  type: 'acp_permission',
  content: {
    session_id: 'session-1',
    options: [
      { option_id: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { option_id: 'allow-always', name: 'Allow always', kind: 'allow_always' },
      { option_id: 'reject-once', name: 'Reject', kind: 'reject_once' },
    ],
    tool_call: { tool_call_id: 'tc-1', title: 'Edit file', kind: 'edit' },
  },
} as unknown as IMessageAcpPermission;

const acpWithoutRejectMessage = {
  id: 'msg-4',
  conversation_id: 'conv-1',
  type: 'acp_permission',
  content: {
    session_id: 'session-1',
    options: [{ option_id: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    tool_call: { tool_call_id: 'tc-2', title: 'Read file', kind: 'read' },
  },
} as unknown as IMessageAcpPermission;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MessagePermission', () => {
  it('pre-selects proceed_always so Accept grants a persistent lifetime', async () => {
    render(<MessagePermission message={nativePermissionMessage} />);

    const accept = screen.getByTestId('message-permission-confirm');
    expect(accept).not.toBeDisabled();
    expect(accept).toHaveTextContent('messages.accept');
    expect(screen.getByTestId('message-permission-block')).toHaveTextContent('messages.block');

    fireEvent.click(accept);

    await waitFor(() =>
      expect(mocks.resolveNativePermission).toHaveBeenCalledWith({
        permission_id: 'perm-1',
        approved: true,
        lifetime: 'persistent',
      })
    );
  });

  it('blocks a native request without touching the radios', async () => {
    render(<MessagePermission message={nativePermissionMessage} />);

    fireEvent.click(screen.getByTestId('message-permission-block'));

    await waitFor(() =>
      expect(mocks.resolveNativePermission).toHaveBeenCalledWith({
        permission_id: 'perm-1',
        approved: false,
      })
    );
    expect(mocks.resolveNativePermission).toHaveBeenCalledTimes(1);
    expect(mocks.confirmationConfirm).not.toHaveBeenCalled();
  });

  it('confirms the pre-selected option through confirmation for non-native requests', async () => {
    render(<MessagePermission message={nonNativePermissionMessage} />);

    fireEvent.click(screen.getByTestId('message-permission-confirm'));

    await waitFor(() =>
      expect(mocks.confirmationConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: 'conv-1',
          call_id: 'call-2',
          data: { value: 'proceed_always' },
          always_allow: true,
        })
      )
    );
    expect(mocks.resolveNativePermission).not.toHaveBeenCalled();
  });

  it('blocks a non-native request with the cancel option and always_allow false', async () => {
    render(<MessagePermission message={nonNativePermissionMessage} />);

    fireEvent.click(screen.getByTestId('message-permission-block'));

    await waitFor(() =>
      expect(mocks.confirmationConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { value: 'cancel' },
          always_allow: false,
        })
      )
    );
    expect(mocks.resolveNativePermission).not.toHaveBeenCalled();
  });
});

describe('MessageAcpPermission', () => {
  it('pre-selects allow-always so Accept submits the persistent option', async () => {
    render(<MessageAcpPermission message={acpPermissionMessage} />);

    const accept = screen.getByTestId('message-acp-permission-confirm');
    expect(accept).not.toBeDisabled();

    fireEvent.click(accept);

    await waitFor(() =>
      expect(mocks.confirmMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          confirm_key: 'allow-always',
          conversation_id: 'conv-1',
          call_id: 'tc-1',
        })
      )
    );
  });

  it('submits the reject-once option when Block is clicked', async () => {
    render(<MessageAcpPermission message={acpPermissionMessage} />);

    fireEvent.click(screen.getByTestId('message-acp-permission-block'));

    await waitFor(() =>
      expect(mocks.confirmMessage).toHaveBeenCalledWith(expect.objectContaining({ confirm_key: 'reject-once' }))
    );
    expect(mocks.confirmMessage).toHaveBeenCalledTimes(1);
  });

  it('hides Block when the agent offers no reject option', () => {
    render(<MessageAcpPermission message={acpWithoutRejectMessage} />);

    expect(screen.queryByTestId('message-acp-permission-block')).toBeNull();
    expect(screen.getByTestId('message-acp-permission-confirm')).toBeInTheDocument();
  });
});
