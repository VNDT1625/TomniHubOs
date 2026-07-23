/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', () => {
  // Keep component mocks factory-local because `vi.mock` is hoisted.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const Collapse = ({ children }: React.PropsWithChildren) => <div>{children}</div>;
  Collapse.Item = ({ children }: React.PropsWithChildren) => <div>{children}</div>;

  // eslint-disable-next-line unicorn/consistent-function-scoping
  const Input = ({ value }: { value?: string }) => <input value={value ?? ''} readOnly />;
  Input.Password = Input;

  return {
    Button: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => (
      <button type='button' onClick={onClick}>
        {children}
      </button>
    ),
    Collapse,
    Input,
    Message: { error: vi.fn(), success: vi.fn() },
    Switch: ({ checked, onChange }: { checked?: boolean; onChange?: (value: boolean) => void }) => (
      <button type='button' aria-pressed={checked} onClick={() => onChange?.(!checked)}>
        switch
      </button>
    ),
    Tag: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
    Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  };
});

vi.mock('@/renderer/components/base/AionSelect', () => {
  // Keep this mock factory-local for the same hoisting reason.
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const AionSelect = ({
    children,
    value,
    onChange,
    allowClear,
    ...rest
  }: React.PropsWithChildren<{
    value?: string;
    onChange?: (value: string) => void;
    allowClear?: boolean;
    'aria-label'?: string;
    'data-testid'?: string;
  }>) => (
    <select
      aria-label={rest['aria-label'] ?? 'model'}
      data-testid={rest['data-testid']}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    >
      {allowClear && <option value='' />}
      {children}
    </select>
  );
  AionSelect.Option = ({ children, value }: React.PropsWithChildren<{ value?: string }>) => (
    <option value={value}>{children}</option>
  );
  return { default: AionSelect };
});

const router9ClientMocks = vi.hoisted(() => ({
  // Keep the mount-only status request pending so it cannot race assertions
  // with an unrelated asynchronous state update.
  status: vi.fn(() => new Promise(() => undefined)),
  start: vi.fn(),
  ensureClient: vi.fn(),
  listProviders: vi.fn(),
  listUsageLogs: vi.fn(),
  usageStats: vi.fn(),
  usageBreakdown: vi.fn(),
  setAutoStart: vi.fn(),
  listModels: vi.fn(),
  syncTomniProvider: vi.fn(),
  openDashboard: vi.fn(),
  applyPlan: vi.fn(),
}));

const savePreferredModelIdMock = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/pages/settings/router9/router9BridgeClient', () => ({
  router9Client: router9ClientMocks,
}));

vi.mock('@/renderer/pages/guid/hooks/agentSelectionUtils', () => ({
  savePreferredModelId: savePreferredModelIdMock,
}));

import { CONNECTOR_TARGETS } from '@/common/router9';
import Router9ConnectorPanel from '@/renderer/pages/settings/router9/Router9ConnectorPanel';

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  for (const mock of Object.values(router9ClientMocks)) mock.mockReset();
  router9ClientMocks.status.mockImplementation(() => new Promise(() => undefined));
  router9ClientMocks.syncTomniProvider.mockResolvedValue({
    ok: true,
    data: { providerId: 'tomni-model-gateway', models: ['cx/gpt-5.6-luna'] },
  });
  router9ClientMocks.setAutoStart.mockResolvedValue({
    ok: true,
    data: { state: 'stopped', baseUrl: 'http://127.0.0.1:20129/v1', runtimeReady: true, autoStart: true },
  });
  router9ClientMocks.usageBreakdown.mockResolvedValue({ ok: true, data: { sessions: [] } });
  savePreferredModelIdMock.mockReset();
  savePreferredModelIdMock.mockResolvedValue(undefined);
});

describe('Router9ConnectorPanel CLI selector', () => {
  it('restores the selected CLI credential and model catalog when the gateway is already running', async () => {
    router9ClientMocks.status.mockResolvedValue({
      ok: true,
      data: { state: 'running', baseUrl: 'http://127.0.0.1:20129/v1', runtimeReady: true },
    });
    router9ClientMocks.ensureClient.mockResolvedValue({
      ok: true,
      data: { id: 'client-1', key: 'sk-restored', name: 'Tomni · Claude Code' },
    });
    router9ClientMocks.listProviders.mockResolvedValue({ ok: true, data: { connections: [] } });
    router9ClientMocks.listUsageLogs.mockResolvedValue({ ok: true, data: [] });
    router9ClientMocks.usageStats.mockResolvedValue({
      ok: true,
      data: { totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0 },
    });
    router9ClientMocks.listModels.mockResolvedValue({
      ok: true,
      data: [{ id: 'cx/gpt-5.6-luna', object: 'model' }],
    });

    render(<Router9ConnectorPanel />);

    await waitFor(() => {
      expect(router9ClientMocks.ensureClient).toHaveBeenCalledWith('Tomni · Claude Code');
      expect(router9ClientMocks.listModels).toHaveBeenCalledWith('sk-restored');
      expect(screen.getByRole('option', { name: 'cx/gpt-5.6-luna' })).toBeTruthy();
    });
    expect(router9ClientMocks.start).not.toHaveBeenCalled();
  });

  it('lists every connector target and switches from Claude Code to Codex CLI', () => {
    render(<Router9ConnectorPanel />);

    const selector = screen.getByTestId('router9-target-select') as HTMLSelectElement;
    expect(selector.value).toBe('claude-code');
    expect(Array.from(selector.options, (option) => [option.value, option.text])).toEqual(
      CONNECTOR_TARGETS.map((target) => [target.id, target.label])
    );

    fireEvent.change(selector, { target: { value: 'codex' } });

    expect(selector.value).toBe('codex');
    expect(localStorage.getItem('tomni.modelGateway.target')).toBe('codex');
    expect(screen.getByText('settings.router9.target.codex')).toBeTruthy();
  });

  it('starts and configures the selected standalone CLI in one action', async () => {
    router9ClientMocks.start.mockResolvedValue({
      ok: true,
      data: { state: 'running', baseUrl: 'http://127.0.0.1:20129/v1', runtimeReady: true },
    });
    router9ClientMocks.ensureClient.mockResolvedValue({ ok: true, data: { id: 'client-1', key: 'sk-test' } });
    router9ClientMocks.listProviders.mockResolvedValue({ ok: true, data: { connections: [] } });
    router9ClientMocks.listUsageLogs.mockResolvedValue({ ok: true, data: [] });
    router9ClientMocks.usageStats.mockResolvedValue({
      ok: true,
      data: { totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0 },
    });
    router9ClientMocks.listModels.mockResolvedValue({ ok: true, data: [] });
    router9ClientMocks.applyPlan.mockResolvedValue({
      ok: true,
      data: { targetId: 'codex', files: [], notes: [] },
    });

    render(<Router9ConnectorPanel />);
    fireEvent.change(screen.getByTestId('router9-target-select'), { target: { value: 'codex' } });
    fireEvent.click(screen.getByText('settings.router9.useGateway'));

    await waitFor(() => {
      expect(router9ClientMocks.applyPlan).toHaveBeenCalledWith('codex', {
        baseUrl: 'http://127.0.0.1:20129/v1',
        apiKey: 'sk-test',
      });
    });
  });

  it('applies reasoning independently from the model for a standalone CLI', async () => {
    router9ClientMocks.start.mockResolvedValue({
      ok: true,
      data: { state: 'running', baseUrl: 'http://127.0.0.1:20129/v1', runtimeReady: true },
    });
    router9ClientMocks.ensureClient.mockResolvedValue({ ok: true, data: { id: 'client-1', key: 'sk-test' } });
    router9ClientMocks.listProviders.mockResolvedValue({ ok: true, data: { connections: [] } });
    router9ClientMocks.listUsageLogs.mockResolvedValue({ ok: true, data: [] });
    router9ClientMocks.usageStats.mockResolvedValue({
      ok: true,
      data: { totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0 },
    });
    router9ClientMocks.listModels.mockResolvedValue({ ok: true, data: [] });
    router9ClientMocks.applyPlan.mockResolvedValue({
      ok: true,
      data: { targetId: 'codex', files: [], notes: [] },
    });

    render(<Router9ConnectorPanel />);
    fireEvent.change(screen.getByTestId('router9-target-select'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByTestId('router9-reasoning-select'), { target: { value: 'high' } });
    fireEvent.click(screen.getByText('settings.router9.useGateway'));

    await waitFor(() => {
      expect(router9ClientMocks.applyPlan).toHaveBeenCalledWith('codex', {
        baseUrl: 'http://127.0.0.1:20129/v1',
        apiKey: 'sk-test',
        reasoningEffort: 'high',
      });
    });
    expect(localStorage.getItem('tomni.modelGateway.reasoning.codex')).toBe('high');
  });
  it.each([
    ['claude-code', 'claude'],
    ['codex', 'codex'],
    ['openclaw', 'openclaw-gateway'],
  ])('persists the selected 9Router model for the matching %s Tomni chat agent', async (targetId, agentKey) => {
    router9ClientMocks.start.mockResolvedValue({
      ok: true,
      data: { state: 'running', baseUrl: 'http://127.0.0.1:20129/v1', runtimeReady: true },
    });
    router9ClientMocks.ensureClient.mockResolvedValue({ ok: true, data: { id: 'client-1', key: 'sk-test' } });
    router9ClientMocks.listProviders.mockResolvedValue({ ok: true, data: { connections: [{ id: 'p1' }] } });
    router9ClientMocks.listUsageLogs.mockResolvedValue({ ok: true, data: [] });
    router9ClientMocks.usageStats.mockResolvedValue({
      ok: true,
      data: { totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0 },
    });
    router9ClientMocks.listModels.mockResolvedValue({
      ok: true,
      data: [{ id: 'cx/gpt-5.6-luna', object: 'model' }],
    });
    router9ClientMocks.applyPlan.mockResolvedValue({
      ok: true,
      data: { targetId, files: [], notes: [] },
    });

    render(<Router9ConnectorPanel />);
    if (targetId !== 'claude-code') {
      fireEvent.change(screen.getByTestId('router9-target-select'), { target: { value: targetId } });
    }
    fireEvent.click(screen.getByText('settings.router9.useGateway'));

    await waitFor(() => expect(screen.getByRole('option', { name: 'cx/gpt-5.6-luna' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('settings.router9.modelLabel'), { target: { value: 'cx/gpt-5.6-luna' } });
    fireEvent.click(screen.getByText('settings.router9.apply'));

    await waitFor(() => {
      expect(router9ClientMocks.applyPlan).toHaveBeenCalledWith(targetId, {
        baseUrl: 'http://127.0.0.1:20129/v1',
        apiKey: 'sk-test',
        model: 'cx/gpt-5.6-luna',
      });
      expect(savePreferredModelIdMock).toHaveBeenCalledWith(agentKey, 'cx/gpt-5.6-luna');
    });
  });

  it.each([
    ['kiro', 'kiro'],
    ['antigravity', 'antigravity'],
    ['cursor', 'cursor'],
  ])(
    'syncs manual %s model selection to Tomni without claiming the external CLI was configured',
    async (targetId, agentKey) => {
      router9ClientMocks.start.mockResolvedValue({
        ok: true,
        data: { state: 'running', baseUrl: 'http://127.0.0.1:20129/v1', runtimeReady: true },
      });
      router9ClientMocks.ensureClient.mockResolvedValue({ ok: true, data: { id: 'client-1', key: 'sk-test' } });
      router9ClientMocks.listProviders.mockResolvedValue({ ok: true, data: { connections: [{ id: 'p1' }] } });
      router9ClientMocks.listUsageLogs.mockResolvedValue({ ok: true, data: [] });
      router9ClientMocks.usageStats.mockResolvedValue({
        ok: true,
        data: { totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0 },
      });
      router9ClientMocks.listModels.mockResolvedValue({
        ok: true,
        data: [{ id: 'cx/gpt-5.6-luna', object: 'model' }],
      });

      render(<Router9ConnectorPanel />);
      fireEvent.change(screen.getByTestId('router9-target-select'), { target: { value: targetId } });
      fireEvent.click(screen.getByText('settings.router9.useGateway'));

      await waitFor(() => expect(screen.getByRole('option', { name: 'cx/gpt-5.6-luna' })).toBeTruthy());
      fireEvent.change(screen.getByLabelText('settings.router9.modelLabel'), { target: { value: 'cx/gpt-5.6-luna' } });
      fireEvent.click(screen.getByText('settings.router9.useInTomniChat'));

      await waitFor(() => expect(savePreferredModelIdMock).toHaveBeenCalledWith(agentKey, 'cx/gpt-5.6-luna'));
      expect(router9ClientMocks.applyPlan).not.toHaveBeenCalled();
    }
  );
});
