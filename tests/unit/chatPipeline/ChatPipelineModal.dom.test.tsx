/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * DOM tests for the chat pipeline pop-up: the ordered stage list, the inspector with the exact input and
 * output of the shared model calls, reordering, duplicating, per-stage settings, and saving.
 */

import { ConfigProvider, Message } from '@arco-design/web-react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ChatPipelineDefinition,
  ChatStageMetadata,
  PipelineModelCallTrace,
  PipelineRunTrace,
  PipelineSimulationResult,
} from '@/common/types/pipeline';
import { ChatPipelineModal } from '@/renderer/pages/conversation/components/pipeline';

const ipc = vi.hoisted(() => ({
  available: vi.fn(),
  definition: vi.fn(),
  lastRun: vi.fn(),
  simulate: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getPipelineAvailableStages: { invoke: ipc.available },
      getPipelineDefinition: { invoke: ipc.definition },
      getPipelineLastRun: { invoke: ipc.lastRun },
      simulatePipeline: { invoke: ipc.simulate },
      updatePipelineDefinition: { invoke: ipc.update },
    },
  },
}));

// Identity translator: assertions use the raw keys, with interpolation values appended.
const translate = (key: string, options?: Record<string, unknown>): string =>
  options && Object.keys(options).length > 0 ? `${key}:${Object.values(options).join(',')}` : key;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
}));

const stage = (overrides: Partial<ChatStageMetadata> & { id: string }): ChatStageMetadata => ({
  displayName: overrides.id,
  description: '',
  phase: 'pre_query',
  defaultEnabled: true,
  isBuiltin: true,
  ...overrides,
});

const AVAILABLE: ChatStageMetadata[] = [
  stage({
    id: 'builtin:laya-security',
    icon: 'Shield',
    role: 'guard',
    authorizedGuard: true,
    decisionTasks: ['security'],
  }),
  stage({ id: 'builtin:understand', icon: 'Brain', role: 'standard', decisionTasks: ['understand'] }),
  stage({
    id: 'builtin:tool-schema',
    icon: 'Wrench',
    phase: 'pre_model',
    role: 'standard',
    decisionTasks: ['toolSchema'],
  }),
  stage({
    id: 'test:retriever',
    displayName: 'Docs retriever',
    phase: 'retrieve',
    isBuiltin: false,
    defaultEnabled: false,
  }),
];

const definition = (): ChatPipelineDefinition => ({
  schemaVersion: 1,
  id: 'p',
  name: 'p',
  enabled: true,
  stages: [
    { id: 's-security', stageRegistryId: 'builtin:laya-security', phase: 'pre_query', enabled: true },
    { id: 's-understand', stageRegistryId: 'builtin:understand', phase: 'pre_query', enabled: true },
    { id: 's-tools', stageRegistryId: 'builtin:tool-schema', phase: 'pre_model', enabled: true },
  ],
});

const sharedCall: PipelineModelCallTrace = {
  id: 'call-1',
  bindingId: 'laya',
  stageId: 's-security',
  taskIds: ['security', 'understand', 'toolSchema'],
  questionKeys: ['riskType', 'isCredentialLeak', 'intent', 'needsProjectTools'],
  input: 'fix the bug, password is [REDACTED]',
  answers: {
    riskType: { choice: 'none', confidence: 0.9 },
    isCredentialLeak: { noul: 0.12 },
    intent: { choice: 'code', confidence: 0.88 },
    needsProjectTools: { noul: 0.91 },
  },
  latencyMs: 33,
  cacheHit: false,
};

const hitCall: PipelineModelCallTrace = {
  id: 'call-2',
  bindingId: 'laya',
  stageId: 's-understand',
  taskIds: ['understand'],
  questionKeys: ['intent'],
  input: 'fix the bug, password is [REDACTED]',
  answers: { intent: { choice: 'code', confidence: 0.88 } },
  latencyMs: 0,
  cacheHit: true,
  sourceCallId: 'call-1',
};

const SIMULATION: PipelineSimulationResult = {
  success: true,
  totalDurationMs: 41,
  initialContextBytes: 0,
  finalContextBytes: 0,
  addedContextBytes: 0,
  finalQuery: 'probe',
  stageMetrics: [
    {
      stageId: 's-security',
      stageRegistryId: 'builtin:laya-security',
      durationMs: 33,
      addedContextBytes: 0,
      decision: 'continue',
      status: 'ok',
    },
    {
      stageId: 's-understand',
      stageRegistryId: 'builtin:understand',
      durationMs: 1,
      addedContextBytes: 0,
      decision: 'continue',
      status: 'ok',
    },
  ],
  modelCalls: [sharedCall, hitCall],
};

const LAST_RUN: PipelineRunTrace = {
  runId: 'r',
  at: 1,
  status: 'completed',
  finalQuery: 'real message',
  totalDurationMs: 40,
  stages: [
    {
      stageId: 's-security',
      stageRegistryId: 'builtin:laya-security',
      decision: 'rewrite',
      durationMs: 31,
      modelCallIds: ['call-9'],
    },
  ],
  modelCalls: [{ ...sharedCall, id: 'call-9', input: 'real message with [REDACTED]' }],
};

const renderModal = (props: Partial<React.ComponentProps<typeof ChatPipelineModal>> = {}) =>
  render(
    <ConfigProvider>
      <ChatPipelineModal visible onClose={props.onClose ?? vi.fn()} conversationId='c1' {...props} />
    </ConfigProvider>
  );

const rows = (): HTMLElement[] => screen.getAllByRole('listitem');

beforeEach(() => {
  // Arco's static Message needs the React 19 adapter only the app entry loads; the tests observe it instead.
  for (const method of ['success', 'error', 'info'] as const) {
    vi.spyOn(Message, method).mockReturnValue({ close: vi.fn() });
  }
  ipc.available.mockResolvedValue(AVAILABLE);
  ipc.definition.mockResolvedValue(definition());
  ipc.lastRun.mockResolvedValue(null);
  ipc.simulate.mockResolvedValue(SIMULATION);
  ipc.update.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatPipelineModal', () => {
  it('lists the stages in order with their phase and guard status', async () => {
    renderModal();
    await waitFor(() => expect(rows()).toHaveLength(3));

    const [first, second, third] = rows();
    expect(within(first).getByText('conversation.pipeline.stageName.security')).toBeTruthy();
    expect(within(first).getByText(/conversation\.pipeline\.role\.authorized/)).toBeTruthy();
    expect(within(second).getByText('conversation.pipeline.stageName.understand')).toBeTruthy();
    expect(within(third).getByText(/conversation\.pipeline\.phase\.pre_model/)).toBeTruthy();
    expect(screen.getByText('conversation.pipeline.stageCount:3')).toBeTruthy();
  });

  it('shows the model input and answers of the selected stage, and where a shared answer came from', async () => {
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(rows()).toHaveLength(3));
    await waitFor(() => expect(screen.getByText('conversation.pipeline.health.ok', { exact: false })).toBeTruthy());

    // The first stage is selected by default: it ran the shared pass.
    expect(screen.getByText('fix the bug, password is [REDACTED]')).toBeTruthy();
    expect(screen.getByText('riskType')).toBeTruthy();
    expect(screen.getByText('none (90%)')).toBeTruthy();
    expect(screen.getByText('0.91')).toBeTruthy();
    expect(screen.getAllByText('conversation.pipeline.inspector.latency:33').length).toBeGreaterThan(0);

    await user.click(within(rows()[1]).getByText('conversation.pipeline.stageName.understand'));
    await waitFor(() =>
      expect(
        screen.getByText('conversation.pipeline.inspector.sharedWith:conversation.pipeline.stageName.security')
      ).toBeTruthy()
    );
    expect(screen.getByText('code (88%)')).toBeTruthy();
  });

  it('prefers the last real message over the dry run when there is one', async () => {
    ipc.lastRun.mockResolvedValue(LAST_RUN);
    renderModal();
    await waitFor(() => expect(screen.getByText('real message with [REDACTED]')).toBeTruthy());
    expect(screen.getByText(/conversation\.pipeline\.decision\.rewrite/)).toBeTruthy();
  });

  it('reorders, duplicates, toggles, and saves the edited chain', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ onClose });
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(within(rows()[0]).getByLabelText('conversation.pipeline.moveDown'));
    await waitFor(() => expect(within(rows()[0]).getByText('conversation.pipeline.stageName.understand')).toBeTruthy());

    await user.click(within(rows()[2]).getByLabelText('conversation.pipeline.duplicate'));
    await waitFor(() => expect(rows()).toHaveLength(4));

    await user.click(within(rows()[0]).getByRole('switch'));
    await user.click(screen.getByText('conversation.pipeline.actions.save'));

    await waitFor(() => expect(ipc.update).toHaveBeenCalledTimes(1));
    const saved = ipc.update.mock.calls[0][0] as { conversation_id: string; definition: ChatPipelineDefinition };
    expect(saved.conversation_id).toBe('c1');
    expect(saved.definition.stages.map((s) => s.stageRegistryId)).toEqual([
      'builtin:understand',
      'builtin:laya-security',
      'builtin:tool-schema',
      'builtin:tool-schema',
    ]);
    expect(saved.definition.stages[0].enabled).toBe(false);
    expect(new Set(saved.definition.stages.map((s) => s.id)).size).toBe(4);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('saves the security mode and the tool-schema switch as stage config', async () => {
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(screen.getByLabelText('conversation.pipeline.inspector.modeBlock'));
    await user.click(within(rows()[2]).getByText('conversation.pipeline.stageName.toolSchema'));
    await user.click(await screen.findByLabelText('conversation.pipeline.inspector.apply'));
    await user.click(screen.getByText('conversation.pipeline.actions.save'));

    await waitFor(() => expect(ipc.update).toHaveBeenCalled());
    const saved = (ipc.update.mock.calls[0][0] as { definition: ChatPipelineDefinition }).definition;
    expect(saved.stages[0].config).toMatchObject({ mode: 'block' });
    expect(saved.stages[2].config).toMatchObject({ apply: false });
  });

  it('warns when retrieved context has no security stage after it', async () => {
    ipc.definition.mockResolvedValue({
      ...definition(),
      stages: [
        { id: 's-security', stageRegistryId: 'builtin:laya-security', phase: 'pre_query', enabled: true },
        { id: 's-docs', stageRegistryId: 'test:retriever', phase: 'retrieve', enabled: true },
      ],
    });
    renderModal();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByText('conversation.pipeline.warnings.unguardedRetrieve:Docs retriever')).toBeTruthy();
  });

  it('keeps the dialog usable when loading fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ipc.available.mockRejectedValue(new Error('offline'));
    renderModal();
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByText('conversation.pipeline.title')).toBeTruthy();
    error.mockRestore();
  });
});
