import { JSDOM } from 'jsdom';
import React from 'react';
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

const createExecutableLocalPlan = () => ({
  schemaVersion: 1,
  requestId: 'release-plan-id-1',
  goalDigest: `sha256-${'a'.repeat(64)}`,
  requirementCount: 1,
  steps: [
    {
      kind: 'execute-local',
      query: {
        schemaVersion: 1,
        queryId: 'release-query-1',
        requester: { packageId: 'com.tomni.hub', packageVersion: '1.0.0', publisherId: 'com.tomni' },
        capability: 'workspace.write',
        purpose: 'release test',
        dataLocation: 'local-only',
        requireUi: true,
        requireOffline: false,
        idempotencyKey: 'release-plan-request-1',
      },
      resolution: {
        schemaVersion: 1,
        queryId: 'release-query-1',
        candidates: [],
        selectedCandidateId: 'release-candidate-1',
        evaluatedAt: '2026-08-21T00:00:00.000Z',
      },
      candidate: {
        schemaVersion: 1,
        candidateId: 'release-candidate-1',
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

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
};

let releaseDom: JSDOM | undefined;
let cleanupReleaseRender: (() => void) | undefined;

const installReleaseFileRealm = (): void => {
  releaseDom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'file:///C:/NDT/PJ/TomniHubOS/index.html',
  });
  const releaseWindow = releaseDom.window;
  const storage = createStorage();
  Object.defineProperty(releaseWindow, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(releaseWindow, 'sessionStorage', { configurable: true, value: storage });
  Object.defineProperty(releaseWindow, 'matchMedia', {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: '',
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
  vi.stubGlobal('window', releaseWindow);
  vi.stubGlobal('document', releaseWindow.document);
  vi.stubGlobal('navigator', releaseWindow.navigator);
  vi.stubGlobal('HTMLElement', releaseWindow.HTMLElement);
  vi.stubGlobal('Element', releaseWindow.Element);
  vi.stubGlobal('Node', releaseWindow.Node);
  vi.stubGlobal('SVGElement', releaseWindow.SVGElement);
  vi.stubGlobal('MutationObserver', releaseWindow.MutationObserver);
  vi.stubGlobal('DOMParser', releaseWindow.DOMParser);
  vi.stubGlobal('getComputedStyle', releaseWindow.getComputedStyle.bind(releaseWindow));
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal(
    'requestAnimationFrame',
    (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
};

describe('HubWorkspacePage packaged C4 Surface pilot', () => {
  beforeEach(() => {
    packageMocks.list.mockReset();
    packageMocks.federatedSearch.mockReset();
    packageMocks.list.mockResolvedValue([]);
    packageMocks.federatedSearch.mockResolvedValue({ items: [], sources: [] });
    installReleaseFileRealm();
  });

  afterEach(async () => {
    cleanupReleaseRender?.();
    cleanupReleaseRender = undefined;
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseDom?.window.close();
    releaseDom = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not expose a C4 local execution or consent action in packaged file pages', async () => {
    const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
    cleanupReleaseRender = cleanup;
    const { MemoryRouter } = await import('react-router-dom');
    const { default: HubWorkspacePage } = await import('@/renderer/pages/hub/HubWorkspacePage');
    const plan = vi.fn().mockResolvedValue({ ok: true, plan: createExecutableLocalPlan() });
    const prepare = vi.fn();
    const execute = vi.fn();
    const cancel = vi.fn();
    const requestChallenge = vi.fn();
    const confirmChallenge = vi.fn();
    window.electronAPI = {
      hubModelSelection: {
        get: vi
          .fn()
          .mockResolvedValue({ ok: true, selection: { targetId: 'release-target', modelKey: 'release-model' } }),
        list: vi
          .fn()
          .mockResolvedValue({ ok: true, targets: [{ targetId: 'release-target', modelKeys: ['release-model'] }] }),
        set: vi
          .fn()
          .mockResolvedValue({ ok: true, selection: { targetId: 'release-target', modelKey: 'release-model' } }),
      },
      hubGoalSurfacePlanning: { plan },
      hubGoalSurfaceAction: { prepare, execute, cancel },
      packageSurfaceAiAccess: { requestChallenge, confirmChallenge },
    } as never;

    expect(window.location.protocol).toBe('file:');
    render(React.createElement(MemoryRouter, undefined, React.createElement(HubWorkspacePage, { kind: 'store' })));

    const planner = await screen.findByTestId('store-goal-surface-planner');
    expect(planner.textContent).toContain('guid.hubHome.storeDetail.goalPlanningNoAction');
    const goalField = planner.querySelector('textarea');
    if (goalField === null) throw new Error('Goal text input was not rendered.');
    fireEvent.change(goalField, { target: { value: 'Create a release-safe private app.' } });
    const planButton = screen.getByTestId('store-goal-surface-plan');
    await waitFor(() => expect(planButton.hasAttribute('disabled')).toBe(false));
    fireEvent.click(planButton);
    await waitFor(() => expect(plan).toHaveBeenCalledOnce());
    await screen.findByTestId('store-goal-surface-plan-result');

    expect(screen.queryByTestId('store-goal-surface-run-local-0')).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(requestChallenge).not.toHaveBeenCalled();
    expect(confirmChallenge).not.toHaveBeenCalled();
  }, 20_000);
});
