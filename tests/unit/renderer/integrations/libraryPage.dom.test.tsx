import type {
  HubFileResult,
  LibraryEntrySummary,
  LibraryNativeAPI,
} from '@/common/integrations/library/libraryContracts';
import LibraryPage from '@/renderer/pages/integrations/library';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const entry = (overrides: Partial<LibraryEntrySummary>): LibraryEntrySummary => ({
  id: 'e1',
  name: 'plan.md',
  path: 'C:\\docs\\plan.md',
  extension: '.md',
  addedAt: 1,
  missing: false,
  ...overrides,
});
const ok = <T,>(data: T): HubFileResult<T> => ({ ok: true, data });

let api: { [K in keyof LibraryNativeAPI]: ReturnType<typeof vi.fn> };
let entries: LibraryEntrySummary[];

beforeEach(() => {
  entries = [entry({}), entry({ id: 'e2', name: 'budget.xlsx', path: 'D:\\money\\budget.xlsx', missing: true })];
  api = {
    list: vi.fn(async () => ok(entries)),
    add: vi.fn().mockResolvedValue(ok([])),
    addFromView: vi.fn(),
    repick: vi.fn(),
    remove: vi.fn().mockResolvedValue(ok(null)),
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { library: api } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
});

const Where: React.FC = () => {
  const location = useLocation();
  return <div data-testid='where'>{`${location.pathname}${location.search}`}</div>;
};
const renderLibrary = () =>
  render(
    <MemoryRouter initialEntries={['/library']}>
      <Routes>
        <Route path='/library' element={<LibraryPage />} />
        <Route path='*' element={<Where />} />
      </Routes>
    </MemoryRouter>
  );

describe('Library page', () => {
  it('lists documents by path and flags a missing file with a re-pick action instead of Open', async () => {
    renderLibrary();
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('plan.md')).toBeTruthy();
    expect(within(rows[0]!).getByText('C:\\docs\\plan.md')).toBeTruthy();
    expect(within(rows[0]!).getByText('guid.hubHome.library.open')).toBeTruthy();
    expect(within(rows[0]!).queryByText('guid.hubHome.library.missing')).toBeNull();
    expect(within(rows[1]!).getByText('guid.hubHome.library.missing')).toBeTruthy();
    expect(within(rows[1]!).getByText('guid.hubHome.library.repick')).toBeTruthy();
    expect(within(rows[1]!).queryByText('guid.hubHome.library.open')).toBeNull();
  });

  it('opens a document in the centre viewer by Library id, never by path', async () => {
    renderLibrary();
    fireEvent.click(await screen.findByText('guid.hubHome.library.open'));
    expect((await screen.findByTestId('where')).textContent).toBe('/file-viewer?src=library&id=e1');
  });

  it('re-picks a missing file through Main and reloads the list', async () => {
    api.repick.mockImplementation(async () => {
      entries = [entry({}), entry({ id: 'e2', name: 'budget-2026.xlsx', path: 'D:\\new\\budget-2026.xlsx' })];
      return ok(entries[1]);
    });
    renderLibrary();
    fireEvent.click(await screen.findByText('guid.hubHome.library.repick'));
    expect(api.repick).toHaveBeenCalledWith({ entryId: 'e2' });
    expect(await screen.findByText('budget-2026.xlsx')).toBeTruthy();
    expect(screen.queryByText('guid.hubHome.library.missing')).toBeNull();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('does not treat a cancelled picker as an error', async () => {
    api.repick.mockResolvedValue({ ok: false, code: 'CANCELLED' });
    renderLibrary();
    fireEvent.click(await screen.findByText('guid.hubHome.library.repick'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a duplicate message and a generic message for failed actions', async () => {
    api.repick.mockResolvedValueOnce({ ok: false, code: 'INVALID_REQUEST' });
    renderLibrary();
    fireEvent.click(await screen.findByText('guid.hubHome.library.repick'));
    expect((await screen.findByRole('alert')).textContent).toBe('guid.hubHome.library.errors.duplicate');
    api.remove.mockResolvedValueOnce({ ok: false, code: 'IO_ERROR' });
    fireEvent.click(screen.getAllByText('guid.hubHome.library.remove')[0]!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('guid.hubHome.library.errors.generic'));
  });

  it('adds files through the native picker held by Main and reloads', async () => {
    renderLibrary();
    await screen.findAllByRole('listitem');
    entries = [...entries, entry({ id: 'e3', name: 'new.txt', path: 'C:\\new.txt' })];
    fireEvent.click(screen.getByText('guid.hubHome.library.add'));
    expect(api.add).toHaveBeenCalledWith();
    expect(await screen.findByText('new.txt')).toBeTruthy();
  });

  it('removes an entry from the Library by id', async () => {
    renderLibrary();
    const rows = await screen.findAllByRole('listitem');
    fireEvent.click(within(rows[0]!).getByText('guid.hubHome.library.remove'));
    expect(api.remove).toHaveBeenCalledWith({ entryId: 'e1' });
  });

  it('filters by name or path', async () => {
    renderLibrary();
    await screen.findAllByRole('listitem');
    fireEvent.change(screen.getByPlaceholderText('guid.hubHome.library.searchPlaceholder'), {
      target: { value: 'money budget' },
    });
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByText('budget.xlsx')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('guid.hubHome.library.searchPlaceholder'), {
      target: { value: 'zzz' },
    });
    expect(await screen.findByText('guid.hubHome.library.noMatches')).toBeTruthy();
  });

  it('explains an empty Library and a failed load', async () => {
    entries = [];
    const empty = renderLibrary();
    expect(await screen.findByTestId('library-empty')).toBeTruthy();
    empty.unmount();
    api.list.mockResolvedValue({ ok: false, code: 'IO_ERROR' });
    renderLibrary();
    expect((await screen.findByRole('alert')).textContent).toBe('guid.hubHome.library.errors.generic');
  });
});
