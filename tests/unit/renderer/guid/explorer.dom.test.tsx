import type {
  ExplorerListing,
  ExplorerNativeAPI,
  ExplorerResult,
  ExplorerSession,
} from '@/common/types/platform/explorer';
import { HubExplorer } from '@/renderer/pages/guid/HubHome/explorer/HubExplorer';
import { explorerCrumbs, explorerRelativePath } from '@/renderer/pages/guid/HubHome/explorer/path';
import { useExplorer } from '@/renderer/pages/guid/HubHome/explorer/useExplorer';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

const session: ExplorerSession = { id: 'session-a', root: 'C:\\work', expiresAt: Date.now() + 3600000 };
const listing: ExplorerListing = {
  relativePath: '',
  truncated: false,
  entries: [
    { name: 'folder', relativePath: 'folder', isDirectory: true, size: 0, modifiedAt: 1 },
    { name: 'a.txt', relativePath: 'a.txt', isDirectory: false, size: 1, modifiedAt: 1 },
    { name: 'b.txt', relativePath: 'b.txt', isDirectory: false, size: 2, modifiedAt: 2 },
    { name: '.hidden', relativePath: '.hidden', isDirectory: false, size: 0, modifiedAt: 0 },
  ],
};
let api: ExplorerNativeAPI;

/** jsdom has no DragEvent, so modifier drags are dispatched as a MouseEvent carrying the dataTransfer. */
const fireDragEvent = (
  target: Element,
  type: 'dragover' | 'drop',
  dataTransfer: unknown,
  init: MouseEventInit = {}
): void => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  act(() => {
    target.dispatchEvent(event);
  });
};
beforeEach(() => {
  api = {
    open: vi.fn().mockResolvedValue({ ok: true, data: { session, listing } }),
    list: vi.fn().mockResolvedValue({ ok: true, data: listing }),
    action: vi.fn().mockResolvedValue({ ok: true, data: { receiptId: 'receipt', affectedPaths: [] } }),
    close: vi.fn().mockResolvedValue({ ok: true, data: null }),
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { explorer: api } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
});

describe('human Explorer renderer', () => {
  it('switches from the compact tree to detail when a metadata column is chosen', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    await screen.findByRole('option', { name: 'a.txt' });

    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.explorer.detailColumn' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.modified' }));

    expect(screen.getByRole('button', { name: 'guid.hubHome.explorer.modified' })).toBeTruthy();
  });

  it('locks into the wide four-column tree when the panel is wide enough', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
    try {
      render(<HubExplorer onFocusDirectory={() => undefined} />);
      const file = await screen.findByRole('option', { name: /a\.txt/ });

      expect(screen.getByTestId('hub-explorer').getAttribute('data-wide')).toBe('true');
      expect(screen.queryByRole('button', { name: 'guid.hubHome.explorer.viewMode' })).toBeNull();
      expect(screen.getByRole('button', { name: 'guid.hubHome.explorer.modified' })).toBeTruthy();
      expect(file.querySelector('.hub-explorer-size')).toBeTruthy();
      expect(file.querySelector('.hub-explorer-date')).toBeTruthy();
    } finally {
      width.mockRestore();
    }
  });

  it('changes the narrow detail column and supports sorting file types', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const file = await screen.findByRole('option', { name: 'a.txt' });
    expect(within(file).queryByText('TXT')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.explorer.viewMode' }));
    expect(within(file).getByText('TXT')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.explorer.detailColumn' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.type' }));
    expect(screen.getByTestId('hub-explorer').getAttribute('data-detail-column')).toBe('type');
    const type = screen.getByRole('button', { name: 'guid.hubHome.explorer.type' });
    fireEvent.click(type);
    expect(type.getAttribute('data-direction')).toBe('ascending');
    fireEvent.click(type);
    expect(type.getAttribute('data-direction')).toBe('descending');
  });

  it('starts a drag for a file without performing a filesystem action', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const file = await screen.findByRole('option', { name: 'a.txt' });
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() };

    fireEvent.dragStart(file, { dataTransfer });

    expect(file).toHaveAttribute('draggable', 'true');
    expect(file).toHaveAttribute('aria-grabbed', 'true');
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-tomni-explorer-paths', JSON.stringify(['a.txt']));
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-tomni-explorer-entries',
      JSON.stringify([{ relativePath: 'a.txt', kind: 'file', sessionId: session.id }])
    );
        expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-tomni-explorer-workspace-root', session.root);
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'a.txt');
    expect(api.action).not.toHaveBeenCalled();

    fireEvent.dragEnd(file);
    expect(file).toHaveAttribute('aria-grabbed', 'false');
  });

  it('moves a dragged file into a folder through the guarded Explorer action', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const file = await screen.findByRole('option', { name: 'a.txt' });
    const folder = screen.getByRole('option', { name: 'folder' });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };

    fireEvent.dragStart(file, { dataTransfer });
    fireEvent.dragOver(folder, { dataTransfer });
    expect(folder).toHaveAttribute('data-drop-target', 'true');
    fireEvent.drop(folder, { dataTransfer });

    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({
        sessionId: 'session-a',
        operation: 'move',
        paths: ['a.txt'],
        destination: 'folder',
      })
    );
  });

  it('groups Ctrl-selected files and folders with a file target in a named folder', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const folder = await screen.findByRole('option', { name: 'folder' });
    const first = screen.getByRole('option', { name: 'a.txt' });
    const target = screen.getByRole('option', { name: 'b.txt' });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };

    fireEvent.click(first);
    fireEvent.click(folder, { ctrlKey: true, clientX: 40 });
    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'bundle' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'guid.hubHome.explorer.save' }));

    await waitFor(() =>
      expect(api.action).toHaveBeenNthCalledWith(1, {
        sessionId: 'session-a',
        operation: 'create-directory',
        paths: [''],
        name: 'bundle',
      })
    );
    await waitFor(() =>
      expect(api.action).toHaveBeenNthCalledWith(2, {
        sessionId: 'session-a',
        operation: 'move',
        paths: ['a.txt', 'folder', 'b.txt'],
        destination: 'bundle',
      })
    );
  });

  it('moves a multi-file selection into a folder without offering a new folder', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const first = await screen.findByRole('option', { name: 'a.txt' });
    const second = screen.getByRole('option', { name: 'b.txt' });
    const folder = screen.getByRole('option', { name: 'folder' });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };

    fireEvent.click(first);
    fireEvent.click(second, { ctrlKey: true });
    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.dragOver(folder, { dataTransfer });
    expect(folder).toHaveAttribute('data-drop-target', 'true');
    expect(folder).not.toHaveAttribute('data-drop-group');
    fireEvent.drop(folder, { dataTransfer });

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({
        sessionId: 'session-a',
        operation: 'move',
        paths: ['a.txt', 'b.txt'],
        destination: 'folder',
      })
    );
  });

  it('moves a folder-containing selection dropped on a folder (plain move, no auto-group)', async () => {
    vi.mocked(api.open).mockResolvedValue({
      ok: true,
      data: {
        session,
        listing: {
          relativePath: '',
          truncated: false,
          entries: [
            { name: 'alpha', relativePath: 'alpha', isDirectory: true, size: 0, modifiedAt: 1 },
            { name: 'beta', relativePath: 'beta', isDirectory: true, size: 0, modifiedAt: 1 },
            { name: 'a.txt', relativePath: 'a.txt', isDirectory: false, size: 1, modifiedAt: 1 },
          ],
        },
      },
    });
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const alpha = await screen.findByRole('option', { name: 'alpha' });
    const beta = screen.getByRole('option', { name: 'beta' });
    const file = screen.getByRole('option', { name: 'a.txt' });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };

    fireEvent.click(file);
    fireEvent.click(alpha, { ctrlKey: true, clientX: 40 });
    fireEvent.dragStart(file, { dataTransfer });
    fireEvent.dragOver(beta, { dataTransfer });
    expect(beta).not.toHaveAttribute('data-drop-group');
    fireEvent.drop(beta, { dataTransfer });

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({
        sessionId: 'session-a',
        operation: 'move',
        paths: ['a.txt', 'alpha'],
        destination: 'beta',
      })
    );
  });

  it('moves a lone folder into another folder without grouping', async () => {
    vi.mocked(api.open).mockResolvedValue({
      ok: true,
      data: {
        session,
        listing: {
          relativePath: '',
          truncated: false,
          entries: [
            { name: 'alpha', relativePath: 'alpha', isDirectory: true, size: 0, modifiedAt: 1 },
            { name: 'beta', relativePath: 'beta', isDirectory: true, size: 0, modifiedAt: 1 },
          ],
        },
      },
    });
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const alpha = await screen.findByRole('option', { name: 'alpha' });
    const beta = screen.getByRole('option', { name: 'beta' });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };

    fireEvent.click(alpha);
    fireEvent.dragStart(alpha, { dataTransfer });
    fireEvent.dragOver(beta, { dataTransfer });
    expect(beta).not.toHaveAttribute('data-drop-group');
    fireEvent.drop(beta, { dataTransfer });

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({
        sessionId: 'session-a',
        operation: 'move',
        paths: ['alpha'],
        destination: 'beta',
      })
    );
  });

  it('moves a tree child dropped onto blank space up into the current folder', async () => {
    vi.mocked(api.list).mockResolvedValue({
      ok: true,
      data: {
        relativePath: 'folder',
        truncated: false,
        entries: [
          { name: 'x.txt', relativePath: 'folder/x.txt', isDirectory: false, size: 1, modifiedAt: 1, blocked: false },
        ],
      },
    });
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const folder = await screen.findByRole('option', { name: 'folder' });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };

    // Expand the folder so its child row appears in the tree.
    fireEvent.click(folder, { clientX: 20 });
    const child = await screen.findByRole('option', { name: 'x.txt' });
    const list = screen.getByRole('listbox', { name: 'guid.hubHome.explorer.files' });
    fireEvent.dragStart(child, { dataTransfer });
    fireDragEvent(list, 'dragover', dataTransfer);
    expect(list).toHaveAttribute('data-blank-drop-target', 'true');
    fireDragEvent(list, 'drop', dataTransfer);

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({
        sessionId: 'session-a',
        operation: 'move',
        paths: ['folder/x.txt'],
        destination: '',
      })
    );
  });

  it('groups a file dropped onto a file into a new folder beside the target', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const target = await screen.findByRole('option', { name: 'b.txt' });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };
    fireEvent.dragStart(screen.getByRole('option', { name: 'a.txt' }), { dataTransfer });

    fireDragEvent(target, 'dragover', dataTransfer);
    expect(target).toHaveAttribute('data-drop-group', 'true');
    fireDragEvent(target, 'drop', dataTransfer);

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'bundle' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'guid.hubHome.explorer.save' }));

    await waitFor(() =>
      expect(api.action).toHaveBeenNthCalledWith(1, {
        sessionId: 'session-a',
        operation: 'create-directory',
        paths: [''],
        name: 'bundle',
      })
    );
    await waitFor(() =>
      expect(api.action).toHaveBeenNthCalledWith(2, {
        sessionId: 'session-a',
        operation: 'move',
        paths: ['a.txt', 'b.txt'],
        destination: 'bundle',
      })
    );
  });

  it('shows a lock indicator and toggles the block list from the context menu', async () => {
    vi.mocked(api.open).mockResolvedValue({
      ok: true,
      data: {
        session,
        listing: {
          relativePath: '',
          truncated: false,
          entries: [
            { name: 'folder', relativePath: 'folder', isDirectory: true, size: 0, modifiedAt: 1, blocked: true },
            { name: 'a.txt', relativePath: 'a.txt', isDirectory: false, size: 1, modifiedAt: 1, blocked: false },
          ],
        },
      },
    });
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const folder = await screen.findByRole('option', { name: /folder/ });
    expect(folder.querySelector('.hub-explorer-lock')).toBeTruthy();
    fireEvent.contextMenu(folder);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.unblock' }));
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({ sessionId: 'session-a', operation: 'unblock', paths: ['folder'] })
    );
  });

  it('copies absolute paths and opens properties from the context menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      render(<HubExplorer onFocusDirectory={() => undefined} />);
      const file = await screen.findByRole('option', { name: 'a.txt' });
      fireEvent.contextMenu(file);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.copyAsPath' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('C:\\work\\a.txt'));
      fireEvent.contextMenu(file);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.properties' }));
      expect(await screen.findByRole('dialog')).toBeTruthy();
      expect(screen.getByText('C:\\work\\a.txt')).toBeTruthy();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    }
  });

  it('creates a new folder when Ctrl drops a single file onto a folder', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const file = await screen.findByRole('option', { name: 'a.txt' });
    const folder = screen.getByRole('option', { name: 'folder' });
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() };

    fireEvent.dragStart(file, { dataTransfer });
    fireDragEvent(folder, 'dragover', dataTransfer, { ctrlKey: true });
    expect(folder).toHaveAttribute('data-drop-target', 'true');
    expect(folder).toHaveAttribute('data-drop-group', 'true');
    fireDragEvent(folder, 'drop', dataTransfer, { ctrlKey: true });

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'bundle' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'guid.hubHome.explorer.save' }));

    await waitFor(() =>
      expect(api.action).toHaveBeenNthCalledWith(1, {
        sessionId: 'session-a',
        operation: 'create-directory',
        paths: [''],
        name: 'bundle',
      })
    );
    await waitFor(() =>
      expect(api.action).toHaveBeenNthCalledWith(2, {
        sessionId: 'session-a',
        operation: 'move',
        paths: ['a.txt', 'folder'],
        destination: 'bundle',
      })
    );
  });

  it('sorts from column headers and toggles ascending and descending order', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    await screen.findByRole('option', { name: 'a.txt' });
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.explorer.viewMode' }));
    const size = screen.getByRole('button', { name: 'guid.hubHome.explorer.size' });
    fireEvent.click(size);
    expect(size.getAttribute('data-direction')).toBe('ascending');
    expect(screen.getAllByRole('option').map((item) => item.getAttribute('aria-label'))).toEqual([
      'folder',
      'a.txt',
      'b.txt',
    ]);
    fireEvent.click(size);
    expect(size.getAttribute('data-direction')).toBe('descending');
    expect(screen.getAllByRole('option').map((item) => item.getAttribute('aria-label'))).toEqual([
      'folder',
      'b.txt',
      'a.txt',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.explorer.name' }));
    expect(size.getAttribute('data-direction')).toBeNull();
  });

  it('collapses intermediate breadcrumb folders into a navigable menu only when the path overflows', async () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(180);
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(360);
    try {
      vi.mocked(api.open).mockResolvedValue({
        ok: true,
        data: { session: { ...session, root: 'C:/Users/MyPC/AppData/Tomny' }, listing },
      });
      render(<HubExplorer onFocusDirectory={() => undefined} />);
      const path = await screen.findByRole('navigation', { name: 'guid.hubHome.explorer.pathLabel' });
      expect(within(path).getByRole('button', { name: 'Tomny' })).toBeTruthy();
      expect(within(path).getByRole('button', { name: 'AppData' })).toBeTruthy();
      expect(within(path).queryByRole('button', { name: 'Users' })).toBeNull();
      fireEvent.click(within(path).getByRole('button', { name: 'guid.hubHome.explorer.pathLabel' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'MyPC' }));
      await waitFor(() => expect(api.open).toHaveBeenLastCalledWith({ path: 'C:\\Users\\MyPC' }));
    } finally {
      clientWidth.mockRestore();
      scrollWidth.mockRestore();
    }
  });

  it('keeps every breadcrumb folder visible when the path fits', async () => {
    vi.mocked(api.open).mockResolvedValue({
      ok: true,
      data: { session: { ...session, root: 'C:/Users/MyPC/AppData/Tomny' }, listing },
    });
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const path = await screen.findByRole('navigation', { name: 'guid.hubHome.explorer.pathLabel' });
    expect(within(path).getByRole('button', { name: 'Users' })).toBeTruthy();
    expect(within(path).getByRole('button', { name: 'MyPC' })).toBeTruthy();
    expect(within(path).queryByRole('button', { name: 'guid.hubHome.explorer.pathLabel' })).toBeNull();
  });

  it('opens the native default directory when the workspace is empty or cleared', async () => {
    const { result, rerender } = renderHook(({ workspace }: { workspace?: string }) => useExplorer(workspace), {
      initialProps: { workspace: '   ' },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api.open).toHaveBeenLastCalledWith({});
    rerender({ workspace: 'C:/other' });
    await waitFor(() => expect(api.open).toHaveBeenLastCalledWith({ path: 'C:/other' }));
    rerender({ workspace: '' });
    await waitFor(() => expect(api.open).toHaveBeenLastCalledWith({}));
  });

  it('navigates directories and focuses the selected folder using the granted absolute root', async () => {
    const focus = vi.fn();
    vi.mocked(api.list).mockResolvedValue({
      ok: true,
      data: { relativePath: 'folder', entries: [], truncated: false },
    });
    render(<HubExplorer onFocusDirectory={focus} />);
    const folder = await screen.findByRole('option', { name: 'folder' });
    fireEvent.click(folder);
    fireEvent.contextMenu(folder);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.focusDirectory' }));
    await waitFor(() => expect(focus).toHaveBeenCalledWith('C:\\work\\folder'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'folder' }).hasAttribute('disabled')).toBe(false));
    fireEvent.doubleClick(screen.getByRole('option', { name: 'folder' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledWith({ sessionId: 'session-a', relativePath: 'folder' }));
    expect(api.action).not.toHaveBeenCalled();
  });

  it('selects a contiguous range with Shift and adds another entry with Ctrl', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const folder = await screen.findByRole('option', { name: 'folder' });
    const first = screen.getByRole('option', { name: 'a.txt' });
    const last = screen.getByRole('option', { name: 'b.txt' });

    fireEvent.click(first);
    fireEvent.click(last, { shiftKey: true });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(last).toHaveAttribute('aria-selected', 'true');
    expect(folder).toHaveAttribute('aria-selected', 'false');

    fireEvent.click(folder, { ctrlKey: true, clientX: 40 });
    expect(folder).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(last).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(first, { ctrlKey: true });
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(folder).toHaveAttribute('aria-selected', 'true');
    expect(last).toHaveAttribute('aria-selected', 'true');
  });

  it('uses the context target for deletion and clears selection on empty space', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const first = await screen.findByRole('option', { name: 'a.txt' });
    fireEvent.click(first);
    fireEvent.contextMenu(screen.getByRole('option', { name: 'b.txt' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.delete' }));
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({ sessionId: 'session-a', operation: 'delete', paths: ['b.txt'] })
    );
    await waitFor(() => expect(screen.getByTestId('hub-explorer').getAttribute('aria-busy')).toBe('false'));
    fireEvent.click(screen.getByRole('option', { name: 'a.txt' }));
    fireEvent.contextMenu(screen.getByRole('listbox', { name: 'guid.hubHome.explorer.files' }));
    await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.newFolder' });
    expect(screen.getByRole('option', { name: 'a.txt' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.queryByRole('button', { name: 'guid.hubHome.explorer.newFile' })).toBeNull();
  });

  it('discards stale navigation responses and leaves the latest directory visible', async () => {
    const { result } = renderHook(() => useExplorer());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let resolveOlder: ((value: ExplorerResult<ExplorerListing>) => void) | undefined;
    vi.mocked(api.list).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOlder = resolve;
        })
    );
    vi.mocked(api.list).mockResolvedValueOnce({
      ok: true,
      data: { relativePath: 'new', entries: [], truncated: false },
    });
    let older: Promise<void> | undefined;
    act(() => {
      older = result.current.load('C:\\work\\old');
    });
    await act(async () => {
      await result.current.load('C:\\work\\new');
    });
    await act(async () => {
      resolveOlder?.({ ok: true, data: { relativePath: 'old', entries: [], truncated: false } });
      await older;
    });
    expect(result.current.location?.listing.relativePath).toBe('new');
  });

  it('keeps cut selections after a cancelled move and refreshes only after a successful retry', async () => {
    const { result } = renderHook(() => useExplorer());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.select('a.txt', false, false);
    });
    act(() => {
      result.current.storeClipboard(true);
    });
    vi.mocked(api.action).mockResolvedValueOnce({ ok: false, code: 'CANCELLED' });
    await act(async () => {
      await result.current.paste();
    });
    expect(result.current.clipboard?.paths).toEqual(['a.txt']);
    expect(api.list).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.paste();
    });
    expect(api.action).toHaveBeenLastCalledWith({
      sessionId: 'session-a',
      operation: 'move',
      paths: ['a.txt'],
      destination: '',
    });
    expect(result.current.clipboard).toBeNull();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('supports range selection and prevents invisible search results from being deleted', async () => {
    const { result } = renderHook(() => useExplorer());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.select('folder', false, false);
      result.current.select('b.txt', false, true);
    });
    expect(result.current.selection).toEqual(['folder', 'a.txt', 'b.txt']);
    act(() => {
      result.current.setSearch('a.txt');
    });
    await waitFor(() => expect(result.current.selection).toEqual(['a.txt']));
    expect(result.current.entries.map((entry) => entry.name)).toEqual(['a.txt']);
  });

  it('clears the clipboard when a newly granted directory replaces the session', async () => {
    const { result } = renderHook(() => useExplorer());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.select('a.txt', false, false);
    });
    act(() => {
      result.current.storeClipboard(false);
    });
    vi.mocked(api.open).mockResolvedValueOnce({
      ok: true,
      data: {
        session: { ...session, id: 'session-b', root: 'D:\\other' },
        listing: { relativePath: '', entries: [], truncated: false },
      },
    });
    await act(async () => {
      await result.current.load('D:\\other');
    });
    expect(result.current.clipboard).toBeNull();
    expect(api.close).toHaveBeenCalledWith({ sessionId: 'session-a' });
  });

  it('handles unavailable native APIs without pretending the directory is empty', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'guid.hubHome.explorer.errors.UNAVAILABLE');
    expect(screen.queryByText('guid.hubHome.explorer.empty')).toBeNull();
    expect(screen.queryByText('guid.hubHome.explorer.items')).toBeNull();
    expect(screen.queryByText('guid.hubHome.explorer.modified')).toBeNull();
  });

  it('creates in the current directory and renames selected entries without an invalid destination', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    await screen.findByRole('option', { name: 'a.txt' });
    fireEvent.contextMenu(screen.getByRole('listbox', { name: 'guid.hubHome.explorer.files' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.newFile' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'new.txt' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'guid.hubHome.explorer.save' }));
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({
        sessionId: 'session-a',
        operation: 'create-file',
        paths: [''],
        name: 'new.txt',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('option', { name: 'a.txt' }));
    fireEvent.keyDown(screen.getByTestId('hub-explorer'), { key: 'F2' });
    const renameDialog = await screen.findByRole('dialog');
    fireEvent.change(within(renameDialog).getByRole('textbox'), { target: { value: 'renamed.txt' } });
    fireEvent.click(within(renameDialog).getByRole('button', { name: 'guid.hubHome.explorer.save' }));
    await waitFor(() =>
      expect(api.action).toHaveBeenLastCalledWith({
        sessionId: 'session-a',
        operation: 'rename',
        paths: ['a.txt'],
        name: 'renamed.txt',
      })
    );
  });

  it('offers the first free rename when a mutation reports a conflict', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    await screen.findByRole('option', { name: 'a.txt' });
    fireEvent.click(screen.getByRole('option', { name: 'a.txt' }));
    fireEvent.keyDown(screen.getByTestId('hub-explorer'), { key: 'F2' });
    const nameDialog = await screen.findByRole('dialog');
    fireEvent.change(within(nameDialog).getByRole('textbox'), { target: { value: 'b.txt' } });
    vi.mocked(api.action).mockResolvedValueOnce({ ok: false, code: 'CONFLICT', suggestedName: 'b (1)' });
    fireEvent.click(within(nameDialog).getByRole('button', { name: 'guid.hubHome.explorer.save' }));

    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({
        sessionId: 'session-a',
        operation: 'rename',
        paths: ['a.txt'],
        name: 'b.txt',
      })
    );
    const conflictDialog = await screen.findByRole('dialog');
    expect(within(conflictDialog).getByText('guid.hubHome.explorer.conflictRename')).toBeTruthy();
    fireEvent.click(within(conflictDialog).getByRole('button', { name: 'guid.hubHome.explorer.rename' }));

    await waitFor(() =>
      expect(api.action).toHaveBeenLastCalledWith({
        sessionId: 'session-a',
        operation: 'rename',
        paths: ['a.txt'],
        name: 'b.txt',
        autoRename: true,
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('creates a new file inside the right-clicked folder, not the parent', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    await screen.findByRole('option', { name: 'a.txt' });
    fireEvent.contextMenu(screen.getByRole('option', { name: 'folder' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'guid.hubHome.explorer.newFile' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'inside.txt' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'guid.hubHome.explorer.save' }));
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({
        sessionId: 'session-a',
        operation: 'create-file',
        paths: ['folder'],
        name: 'inside.txt',
      })
    );
  });

  it('routes opening and deletion through native actions', async () => {
    render(<HubExplorer onFocusDirectory={() => undefined} />);
    const file = await screen.findByRole('option', { name: 'a.txt' });
    fireEvent.doubleClick(file);
    await waitFor(() =>
      expect(api.action).toHaveBeenCalledWith({ sessionId: 'session-a', operation: 'open', paths: ['a.txt'] })
    );
    await waitFor(() => expect(screen.getByTestId('hub-explorer').getAttribute('aria-busy')).toBe('false'));
    fireEvent.click(screen.getByRole('option', { name: 'a.txt' }));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'a.txt' }).getAttribute('aria-selected')).toBe('true')
    );
    fireEvent.keyDown(screen.getByTestId('hub-explorer'), { key: 'Delete' });
    await waitFor(() =>
      expect(api.action).toHaveBeenLastCalledWith({ sessionId: 'session-a', operation: 'delete', paths: ['a.txt'] })
    );
  });

  it('pastes a copied selection into the navigated destination and preserves source paths', async () => {
    const { result } = renderHook(() => useExplorer());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.select('a.txt', false, false);
    });
    act(() => {
      result.current.storeClipboard(false);
    });
    vi.mocked(api.list).mockResolvedValue({
      ok: true,
      data: { relativePath: 'folder', entries: [], truncated: false },
    });
    await act(async () => {
      await result.current.load('C:\\work\\folder');
    });
    await act(async () => {
      await result.current.paste();
    });
    expect(api.action).toHaveBeenLastCalledWith({
      sessionId: 'session-a',
      operation: 'copy',
      paths: ['a.txt'],
      destination: 'folder',
    });
    expect(result.current.clipboard?.paths).toEqual(['a.txt']);
  });

  it('refreshes uncertain changes, retains the error and clears a partially completed cut', async () => {
    const { result } = renderHook(() => useExplorer());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.select('a.txt', false, false);
    });
    act(() => {
      result.current.storeClipboard(true);
    });
    vi.mocked(api.action).mockResolvedValueOnce({
      ok: false,
      code: 'IO_ERROR',
      mayHaveCommitted: true,
      affectedPaths: ['folder/a.txt'],
    });
    await act(async () => {
      await result.current.paste();
    });
    expect(result.current.partial).toBe(true);
    expect(result.current.error).toBe('IO_ERROR');
    expect(result.current.clipboard).toBeNull();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('treats a rejected mutation transport as uncertain and avoids reusing cut sources', async () => {
    const { result } = renderHook(() => useExplorer());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.select('a.txt', false, false);
    });
    act(() => {
      result.current.storeClipboard(true);
    });
    vi.mocked(api.action).mockRejectedValueOnce(new Error('transport disconnected after submission'));
    await act(async () => {
      await result.current.paste();
    });
    expect(result.current.partial).toBe(true);
    expect(result.current.error).toBe('IO_ERROR');
    expect(result.current.clipboard).toBeNull();
    expect(api.list).toHaveBeenCalledWith({ sessionId: 'session-a', relativePath: '' });
  });

  it('refreshes the granted root using the native empty relative-path representation', async () => {
    const { result } = renderHook(() => useExplorer());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(api.list).toHaveBeenCalledWith({ sessionId: 'session-a', relativePath: '' }));
    expect(explorerRelativePath('C:\\work', 'C:\\work')).toBe('');
  });

  it('loads the granted directory when mounted in React StrictMode', async () => {
    const { result } = renderHook(() => useExplorer(), {
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.location?.session.root).toBe('C:\\work');
    expect(api.open).toHaveBeenCalledWith({});
  });

  it('builds drive and UNC breadcrumbs and refuses sibling-prefix or traversal session reuse', () => {
    expect(explorerCrumbs('C:\\work\\nested').map((crumb) => crumb.path)).toEqual([
      'C:\\',
      'C:\\work',
      'C:\\work\\nested',
    ]);
    expect(explorerCrumbs('\\\\server\\share\\nested').map((crumb) => crumb.path)).toEqual([
      '\\\\server\\share\\',
      '\\\\server\\share\\nested',
    ]);
    expect(explorerRelativePath('C:\\work', 'c:\\WORK\\nested')).toBe('nested');
    expect(explorerRelativePath('C:\\work', 'C:\\workspace\\nested')).toBeNull();
    expect(explorerRelativePath('C:\\work', 'C:\\work\\..\\secret')).toBeNull();
  });
});
