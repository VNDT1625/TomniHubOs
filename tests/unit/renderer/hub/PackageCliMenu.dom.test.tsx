import type { PackageListing } from '@/common/packages';
import { Message } from '@arco-design/web-react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientMock = vi.hoisted(() => ({ openInTerminal: vi.fn() }));
const connectionMock = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/common/integrations/cli/packageCliClient', () => ({ packageCliClient: clientMock }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name === undefined ? key : `${key}|${options.name}`),
  }),
}));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, info: vi.fn(), error: vi.fn() } };
});

import PackageCliMenu from '@/renderer/pages/guid/shell/PackageCliMenu';

const installed = (id: string): PackageListing => ({ installedManifest: { id } }) as unknown as PackageListing;

const view = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  kind: key.split(':')[0],
  title: key.split(':')[1],
  runsCode: true,
  enabled: true,
  status: 'on',
  ...extra,
});

const connectionsOf: Record<string, unknown[]> = {
  'com.x.one': [
    view('cli:ctx7', { title: 'Context7' }),
    view('tool:fmt'),
    view('cli:off', { enabled: false, status: 'off' }),
  ],
  'com.x.two': [view('cli:lint', { title: 'Linter' })],
};

beforeEach(() => {
  connectionMock.list.mockImplementation(async ({ packageId }: { packageId: string }) => ({
    ok: true,
    data: connectionsOf[packageId] ?? [],
  }));
  (window as unknown as { electronAPI: unknown }).electronAPI = { packageConnections: connectionMock };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const renderMenu = (props: Partial<React.ComponentProps<typeof PackageCliMenu>> = {}) => {
  const onOpened = vi.fn();
  const packages = [installed('com.x.one'), installed('com.x.two')];
  render(<PackageCliMenu installedPackages={packages} onOpened={onOpened} {...props} />);
  return { onOpened };
};

describe('PackageCliMenu (design S14)', () => {
  it('shows nothing when no package CLI is turned on', async () => {
    cleanup();
    render(<PackageCliMenu installedPackages={[installed('com.x.none')]} onOpened={vi.fn()} />);
    await waitFor(() => expect(connectionMock.list).toHaveBeenCalled());
    expect(screen.queryByTestId('hub-footer-terminal-menu')).toBeNull();
  });

  it('shows nothing without the connections bridge', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    renderMenu();
    expect(screen.queryByTestId('hub-footer-terminal-menu')).toBeNull();
  });

  it('lists only the CLIs that are on, one entry each, named by their title', async () => {
    renderMenu();
    const toggle = await screen.findByTestId('hub-footer-terminal-menu');
    expect(toggle.getAttribute('aria-haspopup')).toBe('menu');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'guid.hubHome.layout.terminalWith|Context7',
      'guid.hubHome.layout.terminalWith|Linter',
    ]);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('sends only the two ids and the workspace, then shows the terminal and says the line is not run', async () => {
    clientMock.openInTerminal.mockResolvedValue({ ok: true, sessionId: 's1' });
    const { onOpened } = renderMenu({ workspace: 'C:\\work' });
    fireEvent.click(await screen.findByTestId('hub-footer-terminal-menu'));
    fireEvent.click((await screen.findAllByRole('menuitem'))[0] as HTMLElement);
    await waitFor(() => expect(onOpened).toHaveBeenCalledTimes(1));
    expect(clientMock.openInTerminal).toHaveBeenCalledWith(
      { packageId: 'com.x.one', connectionId: 'ctx7' },
      { cwd: 'C:\\work' }
    );
    expect(Message.info).toHaveBeenCalledWith('guid.hubHome.layout.terminalTyped');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not pass a workspace that is not known', async () => {
    clientMock.openInTerminal.mockResolvedValue({ ok: true, sessionId: 's1' });
    renderMenu();
    fireEvent.click(await screen.findByTestId('hub-footer-terminal-menu'));
    fireEvent.click((await screen.findAllByRole('menuitem'))[1] as HTMLElement);
    await waitFor(() => expect(clientMock.openInTerminal).toHaveBeenCalled());
    expect(clientMock.openInTerminal).toHaveBeenCalledWith({ packageId: 'com.x.two', connectionId: 'lint' }, {});
  });

  it('reports a failure and does not open the terminal', async () => {
    clientMock.openInTerminal.mockResolvedValue({ ok: false, error: 'NOT_ENABLED' });
    const { onOpened } = renderMenu();
    fireEvent.click(await screen.findByTestId('hub-footer-terminal-menu'));
    fireEvent.click((await screen.findAllByRole('menuitem'))[0] as HTMLElement);
    await waitFor(() => expect(Message.error).toHaveBeenCalledWith('guid.hubHome.layout.terminalOpenFailed'));
    expect(onOpened).not.toHaveBeenCalled();
  });

  it('closes on Escape and on a click outside, and reads the connections again each time it opens', async () => {
    renderMenu();
    const toggle = await screen.findByTestId('hub-footer-terminal-menu');
    const reads = connectionMock.list.mock.calls.length;
    fireEvent.click(toggle);
    await screen.findByRole('menu');
    expect(connectionMock.list.mock.calls.length).toBeGreaterThan(reads);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(toggle);
    await screen.findByRole('menu');
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('drops a CLI that was turned off when the menu is opened again', async () => {
    renderMenu();
    const toggle = await screen.findByTestId('hub-footer-terminal-menu');
    connectionsOf['com.x.two'] = [];
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(1));
    connectionsOf['com.x.two'] = [view('cli:lint', { title: 'Linter' })];
  });
});
