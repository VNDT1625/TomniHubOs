/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Message, Modal } from '@arco-design/web-react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const packageMocks = vi.hoisted(() => ({
  federatedSearch: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@/renderer/components/layout/Sider', () => ({ default: () => null }));
vi.mock('@/renderer/pages/company/CompanyPage', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({ default: () => null }));
vi.mock('@/renderer/pages/guid/HubHome/catalog', () => ({ HUB_APPS: [], parseRecentHubApps: () => [] }));
vi.mock('@/renderer/pages/hub/PackageAppHost', () => ({
  getFirstRunnablePackageModule: () => undefined,
  PackageAppHost: () => null,
}));
vi.mock('@/renderer/pages/hub/StoreProductDetail', () => ({ default: () => null }));
vi.mock('@/renderer/pages/hub/StoreProductDetail/permissionConsent', () => ({
  requestPackagePermissionUpdateConsent: () => Promise.resolve(undefined),
}));
vi.mock('@/renderer/pages/hub/packageClient', () => ({ packageClient: packageMocks }));
vi.mock('@/renderer/pages/manager/useManagerStore', () => ({
  useManagerStore: () => ({ data: { events: [], notes: [], tasks: [] } }),
}));
vi.mock('@/common/packages/studioCompatibility', () => ({
  createStudioCompatibilityLegacyFallbackDestination: () => '/',
  isStudioPackageGateNavigationState: () => false,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const goalText = 'Create a private app but never expose this goal to the C4 action transport.';
const selectedTarget = 'local-target-private';
const selectedModel = 'model-private';

const createPlan = () => ({
  schemaVersion: 1,
  requestId: 'opaque-plan-id-1',
  goalDigest: `sha256-${'a'.repeat(64)}`,
  requirementCount: 1,
  steps: [
    {
      kind: 'execute-local',
      query: {
        schemaVersion: 1,
        queryId: 'query-1',
        requester: { packageId: 'com.tomni.hub', packageVersion: '1.0.0', publisherId: 'com.tomni' },
        capability: 'workspace.write',
        purpose: 'create private app',
        dataLocation: 'local-only',
        requireUi: true,
        requireOffline: false,
        idempotencyKey: 'plan-request-1',
      },
      resolution: {
        schemaVersion: 1,
        queryId: 'query-1',
        candidates: [],
        selectedCandidateId: 'candidate-1',
        evaluatedAt: '2026-08-21T00:00:00.000Z',
      },
      candidate: {
        schemaVersion: 1,
        candidateId: 'candidate-1',
        package: { packageId: 'com.tomni.ide', packageVersion: '1.0.0', publisherId: 'com.tomni' },
        capability: 'workspace.write',
        state: 'ready-local',
        trusted: true,
        compatible: true,
        healthy: true,
        dataLocation: 'local-only',
        supportsUi: true,
        supportsOffline: true,
        reasonCodes: [],
      },
    },
  ],
});

const renderStore = async (): Promise<void> => {
  const { default: HubWorkspacePage } = await import('@/renderer/pages/hub/HubWorkspacePage');
  render(
    <MemoryRouter>
      <HubWorkspacePage kind='store' />
    </MemoryRouter>
  );
};

describe('HubWorkspacePage C4 Surface pilot', () => {
  beforeEach(() => {
    packageMocks.list.mockReset();
    packageMocks.federatedSearch.mockReset();
    packageMocks.list.mockResolvedValue([]);
    packageMocks.federatedSearch.mockResolvedValue({ items: [], sources: [] });
    vi.spyOn(Message, 'error').mockReturnValue({ close: vi.fn() });
    vi.spyOn(Message, 'success').mockReturnValue({ close: vi.fn() });
  });

  afterEach(() => {
    window.electronAPI = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses opaque IDs only for C4 action calls after planning', async () => {
    const plan = vi.fn().mockResolvedValue({ ok: true, plan: createPlan() });
    const prepare = vi.fn().mockResolvedValue({
      ok: true,
      actionId: 'opaque-action-id-1',
      consent: { packageId: 'com.tomni.ide', operationId: 'workspace.write' },
    });
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      receipt: {
        receiptId: 'receipt-1',
        runId: 'run-1',
        status: 'verified',
        createdAt: 1,
        evidenceRefs: [],
      },
    });
    const cancel = vi.fn().mockResolvedValue({ ok: true, cancelled: true });
    const requestChallenge = vi.fn().mockResolvedValue({
      ok: true,
      challenge: { challengeId: 'challenge-1', operationId: 'workspace.write', capability: 'workspace.write' },
    });
    const confirmChallenge = vi.fn().mockResolvedValue({ ok: true, approved: true, consentId: 'opaque-consent-id-1' });
    window.electronAPI = {
      hubModelSelection: {
        get: vi.fn().mockResolvedValue({ ok: true, selection: { targetId: selectedTarget, modelKey: selectedModel } }),
        list: vi
          .fn()
          .mockResolvedValue({ ok: true, targets: [{ targetId: selectedTarget, modelKeys: [selectedModel] }] }),
        set: vi.fn().mockResolvedValue({ ok: true, selection: { targetId: selectedTarget, modelKey: selectedModel } }),
      },
      hubGoalSurfacePlanning: { plan },
      hubGoalSurfaceAction: { prepare, execute, cancel },
      packageSurfaceAiAccess: { requestChallenge, confirmChallenge },
    } as never;
    let onOk: (() => Promise<void>) | undefined;
    vi.spyOn(Modal, 'confirm').mockImplementation((options) => {
      onOk = options.onOk as (() => Promise<void>) | undefined;
      return undefined as never;
    });

    await renderStore();
    const planner = await screen.findByTestId('store-goal-surface-planner');
    const goalField = planner.querySelector('textarea');
    if (goalField === null) throw new Error('Goal text input was not rendered.');
    fireEvent.change(goalField, { target: { value: goalText } });
    const planButton = screen.getByTestId('store-goal-surface-plan');
    await waitFor(() => expect(planButton).not.toBeDisabled());
    fireEvent.click(planButton);
    await waitFor(() => expect(plan).toHaveBeenCalledWith({ goal: goalText }));

    const runButton = await screen.findByTestId('store-goal-surface-run-local-0');
    fireEvent.click(runButton);
    await waitFor(() => expect(prepare).toHaveBeenCalledWith({ planId: 'opaque-plan-id-1', stepIndex: 0 }));
    await act(async () => {
      await onOk?.();
    });
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({ actionId: 'opaque-action-id-1', consentId: 'opaque-consent-id-1' })
    );

    const actionPayloads = [...prepare.mock.calls, ...execute.mock.calls, ...cancel.mock.calls].map(
      ([payload]) => payload
    );
    expect(actionPayloads).toEqual([
      { planId: 'opaque-plan-id-1', stepIndex: 0 },
      { actionId: 'opaque-action-id-1', consentId: 'opaque-consent-id-1' },
    ]);
    const serializedActionPayloads = JSON.stringify(actionPayloads);
    expect(serializedActionPayloads).not.toContain(goalText);
    expect(serializedActionPayloads).not.toContain(selectedTarget);
    expect(serializedActionPayloads).not.toContain(selectedModel);
    expect(serializedActionPayloads).not.toContain('com.tomni.ide');
    expect(requestChallenge).toHaveBeenCalledWith({ packageId: 'com.tomni.ide', operationId: 'workspace.write' });
    expect(confirmChallenge).toHaveBeenCalledWith({ challengeId: 'challenge-1', approved: true });
  });
});
