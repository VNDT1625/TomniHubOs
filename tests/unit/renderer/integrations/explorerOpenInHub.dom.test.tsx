import type { ExplorerListing, ExplorerNativeAPI, ExplorerSession } from '@/common/types/platform/explorer';
import { HubExplorer } from '@/renderer/pages/guid/HubHome/explorer/HubExplorer';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

const session: ExplorerSession = { id: 'session-a', root: 'C:\\work', expiresAt: Date.now() + 3600000 };
const listing: ExplorerListing = {
  relativePath: '',
  truncated: false,
  entries: [
    { name: 'folder', relativePath: 'folder', isDirectory: true, size: 0, modifiedAt: 1, blocked: false },
    { name: 'a.txt', relativePath: 'a.txt', isDirectory: false, size: 1, modifiedAt: 1, blocked: false },
  ],
};
let openFromExplorer: ReturnType<typeof vi.fn>;
let action: ReturnType<typeof vi.fn>;

beforeEach(() => {
  action = vi.fn().mockResolvedValue({ ok: true, data: { receiptId: 'r', affectedPaths: [] } });
  openFromExplorer = vi.fn().mockResolvedValue({ ok: true, data: { viewId: 'view-9', name: 'a.txt' } });
  const explorer = {
    open: vi.fn().mockResolvedValue({ ok: true, data: { session, listing } }),
    list: vi.fn().mockResolvedValue({ ok: true, data: listing }),
    action,
    close: vi.fn().mockResolvedValue({ ok: true, data: null }),
  } as unknown as ExplorerNativeAPI;
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { explorer, fileViewer: { openFromExplorer } },
  });
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
  window.location.hash = '';
});

describe('Explorer "open in Hub"', () => {
  it('asks Main for a view id (session + relative path only) and opens the centre viewer with that id', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    fireEvent.contextMenu(await screen.findByRole('option', { name: 'a.txt' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.openInHub' }));
    expect(openFromExplorer).toHaveBeenCalledWith({ sessionId: 'session-a', relativePath: 'a.txt' });
    await waitFor(() => expect(window.location.hash).toBe('#/file-viewer?src=view&id=view-9'));
    expect(window.location.hash).not.toContain('work');
  });

  it('keeps "open externally" as a separate command and does not open folders in the viewer', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    fireEvent.contextMenu(await screen.findByRole('option', { name: 'folder' }));
    const item = await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.openInHub' });
    fireEvent.click(item);
    expect(openFromExplorer).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'guid.hubHome.explorer.open' })).toBeTruthy();
    expect(window.location.hash).toBe('');
  });

  it('leaves the location alone when Main refuses', async () => {
    openFromExplorer.mockResolvedValue({ ok: false, code: 'DENIED' });
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    fireEvent.contextMenu(await screen.findByRole('option', { name: 'a.txt' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.openInHub' }));
    await waitFor(() => expect(openFromExplorer).toHaveBeenCalled());
    expect(window.location.hash).toBe('');
  });
});
