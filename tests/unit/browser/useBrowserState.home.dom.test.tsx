import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({
  listTabs: vi.fn(),
  onTabUpdated: vi.fn(() => () => undefined),
  openTab: vi.fn(),
  destroyTab: vi.fn(),
  navigate: vi.fn(),
  show: vi.fn(),
  hideAll: vi.fn(),
  getAgentMode: vi.fn(),
  setAgentMode: vi.fn(),
  setBounds: vi.fn(),
}));

vi.mock('@package-apps/browser/renderer/browser/browserBridgeClient', () => ({ browserClient: client }));

import {
  BROWSER_HOME_URL,
  consumeRequestedActiveTab,
  requestActiveTab,
        requestTabsRefresh,
  subscribeActiveTabRequests,


} from '@package-apps/browser/renderer/browser/constants';
import { useBrowserState } from '@package-apps/browser/renderer/browser/useBrowserState';

const tab = (id: string) => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  visible: true,
  bounds: { x: 0, y: 0, width: 1, height: 1 },
});

describe('Browser home page and live tab hand-off', () => {
  beforeEach(() => {
    consumeRequestedActiveTab();
    Object.values(client).forEach((mock) => mock.mockReset());
    client.onTabUpdated.mockReturnValue(() => undefined);
    client.hideAll.mockResolvedValue(undefined);
    client.show.mockResolvedValue(undefined);
    client.getAgentMode.mockResolvedValue({ enabled: false });
    client.openTab.mockResolvedValue({ id: 'new' });
    client.destroyTab.mockResolvedValue(undefined);
    client.listTabs.mockResolvedValue([]);
  });

  it('goes to Google by itself when the Browser app opens with no tab', async () => {
    renderHook(() => useBrowserState());
    await waitFor(() => expect(client.openTab).toHaveBeenCalledTimes(1));
    expect(client.openTab).toHaveBeenCalledWith({ url: BROWSER_HOME_URL });
    expect(BROWSER_HOME_URL).toBe('https://www.google.com');
  });

  it('leaves the tabs alone when some are already open', async () => {
    client.listTabs.mockResolvedValue([tab('a')]);
    const { result } = renderHook(() => useBrowserState());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(client.openTab).not.toHaveBeenCalled();
  });

  it('starts every new tab on Google', async () => {
    client.listTabs.mockResolvedValue([tab('a')]);
    const { result } = renderHook(() => useBrowserState());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.openTab();
    });
    expect(client.openTab).toHaveBeenCalledWith({ url: 'https://www.google.com' });
  });

  it('still opens the address the user typed into a new tab', async () => {
    client.listTabs.mockResolvedValue([tab('a')]);
    const { result } = renderHook(() => useBrowserState());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.openTab('example.org');
    });
    expect(client.openTab).toHaveBeenCalledWith({ url: 'https://example.org' });
  });

  it('does not reopen Google after the user closes the last tab', async () => {
    client.listTabs.mockResolvedValue([tab('a')]);
    const { result } = renderHook(() => useBrowserState());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    client.listTabs.mockResolvedValue([]);
    await act(async () => {
      await result.current.closeTab('a');
    });
    await waitFor(() => expect(result.current.tabs).toEqual([]));
    expect(client.openTab).not.toHaveBeenCalled();
  });

  it('does not open anything when the browser bridge is not available', async () => {
    client.listTabs.mockRejectedValue(new Error('no bridge'));
    const { result } = renderHook(() => useBrowserState());
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(client.openTab).not.toHaveBeenCalled();
  });

  it('switches to a tab requested while the Browser page is already open', async () => {
    client.listTabs.mockResolvedValue([tab('a')]);
    const { result } = renderHook(() => useBrowserState());
    await waitFor(() => expect(result.current.activeTabId).toBe('a'));

    client.listTabs.mockResolvedValue([tab('a'), tab('b')]);
    act(() => requestActiveTab('b'));

    await waitFor(() => expect(result.current.activeTabId).toBe('b'));
    expect(result.current.tabs.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(client.show).toHaveBeenCalledWith({ id: 'b' });
    expect(consumeRequestedActiveTab()).toBeNull();
  });

    it('receives focus requests through the cross-bundle host event channel', () => {
    const requests: string[] = [];
    const off = subscribeActiveTabRequests((id) => requests.push(id));
    try {
      window.dispatchEvent(new CustomEvent('tomni:browser.focus-tab', { detail: 'from-host-bundle' }));
      expect(requests).toEqual(['from-host-bundle']);
      requestActiveTab('during-mount');
      expect(requests).toEqual(['from-host-bundle', 'during-mount']);
      expect(consumeRequestedActiveTab()).toBeNull();
    } finally {
      off();
    }
  });

  it('keeps a request for the next visit when the Browser page is not open', () => {
    requestActiveTab('later');
    expect(consumeRequestedActiveTab()).toBe('later');
  });

  it('refreshes the tab strip when the sidebar closes a tab behind its back', async () => {
    client.listTabs.mockResolvedValue([tab('a'), tab('b')]);
    const { result } = renderHook(() => useBrowserState());
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));

    client.listTabs.mockResolvedValue([tab('a')]);
    act(() => requestTabsRefresh());

    await waitFor(() => expect(result.current.tabs.map((entry) => entry.id)).toEqual(['a']));
  });
});
