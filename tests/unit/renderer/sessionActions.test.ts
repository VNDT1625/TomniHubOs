import { describe, expect, it, vi } from 'vitest';

import { createSessionActions } from '@/renderer/pages/guid/HubHome/sessionActions';

const make = (patch: Record<string, unknown> = {}) => {
  const deps = {
    openBrowserTab: vi.fn().mockResolvedValue({ id: 'new1' }),
    closeBrowserTab: vi.fn().mockResolvedValue(undefined),
    focusBrowserTab: vi.fn(),
    navigate: vi.fn(),
    emit: vi.fn(),
    ...patch,
  };
  return { deps, actions: createSessionActions(deps as Parameters<typeof createSessionActions>[0]) };
};

describe('createSessionActions', () => {
  it('opens a browser tab, focuses it and navigates', async () => {
    const { deps, actions } = make();
    await actions.createSession('com.tomni.browser');
    expect(deps.openBrowserTab).toHaveBeenCalledTimes(1);
    expect(deps.openBrowserTab).toHaveBeenCalledWith('https://www.google.com');
    expect(deps.focusBrowserTab).toHaveBeenCalledWith('new1');
    expect(deps.navigate).toHaveBeenCalledWith('/browser');
    expect(deps.emit).not.toHaveBeenCalled();
  });

  it('does nothing visible when the browser tab fails to open', async () => {
    const { deps, actions } = make({ openBrowserTab: vi.fn().mockRejectedValue(new Error('x')) });
    await expect(actions.createSession('com.tomni.browser')).resolves.toBeUndefined();
    expect(deps.focusBrowserTab).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('ignores a result without a tab id', async () => {
    const { deps, actions } = make({ openBrowserTab: vi.fn().mockResolvedValue({}) });
    await actions.createSession('com.tomni.browser');
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it('closes a browser tab and swallows failure', async () => {
    const { deps, actions } = make();
    await actions.closeSession('com.tomni.browser', 't1');
    expect(deps.closeBrowserTab).toHaveBeenCalledWith('t1');
    const failing = make({ closeBrowserTab: vi.fn().mockRejectedValue(new Error('x')) });
    await expect(failing.actions.closeSession('com.tomni.browser', 't1')).resolves.toBeUndefined();
  });

  it('forwards other apps through the request bus', async () => {
    const { deps, actions } = make();
    await actions.createSession('com.acme.board');
    await actions.closeSession('com.acme.board', 's1');
    expect(deps.emit).toHaveBeenNthCalledWith(1, { packageId: 'com.acme.board', kind: 'create' });
    expect(deps.emit).toHaveBeenNthCalledWith(2, { packageId: 'com.acme.board', kind: 'close', sessionId: 's1' });
    expect(deps.openBrowserTab).not.toHaveBeenCalled();
  });

  it('swallows a throwing emitter', async () => {
    const { actions } = make({
      emit: vi.fn(() => {
        throw new Error('x');
      }),
    });
    await expect(actions.createSession('com.acme.board')).resolves.toBeUndefined();
  });
});
