import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreControls } from '@/renderer/pages/integrations/store/StoreControls';

const mocks = vi.hoisted(() => ({
  t: (key: string, values?: Record<string, string>) => (values?.name ? `${key}:${values.name}` : key),
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));

describe('Store filters and source import T2.7', () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue({
      ok: true,
      packageId: 'user.demo.package',
      version: '1.0.0',
      report: 'Signed and installed',
    });
    mocks.listen.mockReset().mockReturnValue(() => undefined);
    vi.stubGlobal('electronAPI', { repoStore: { import: mocks.invoke, onProgress: mocks.listen } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('changes installed/update filters and never calls Main for a malformed URL', async () => {
    const onFilter = vi.fn();
    render(<StoreControls filter='all' onFilter={onFilter} onImported={vi.fn()} onOpenDetails={vi.fn()} />);
    fireEvent.click(screen.getByTestId('store-filter-installed'));
    expect(onFilter).toHaveBeenCalledWith('installed');
    fireEvent.click(screen.getByTestId('store-filter-updates'));
    expect(onFilter).toHaveBeenCalledWith('updates');
    fireEvent.change(screen.getByRole('textbox', { name: 'guid.hubHome.storeImport.githubUrl' }), {
      target: { value: 'https://evil.example.com/foo/bar' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.storeImport.importGithub' }));
    expect(await screen.findByText('guid.hubHome.storeImport.invalidUrl')).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('reports real progress, installs a GitHub source, then offers package details', async () => {
    const onImported = vi.fn();
    const openDetails = vi.fn();
    let finish!: (result: unknown) => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    render(<StoreControls filter='all' onFilter={vi.fn()} onImported={onImported} onOpenDetails={openDetails} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'guid.hubHome.storeImport.githubUrl' }), {
      target: { value: 'https://github.com/acme/repo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.storeImport.importGithub' }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'github', url: 'https://github.com/acme/repo' })
      )
    );
    const request = mocks.invoke.mock.calls[0]?.[0] as { requestId: string };
    const onProgress = mocks.listen.mock.calls[0]?.[0] as (progress: unknown) => void;
    onProgress({ requestId: request.requestId, progress: 90, phase: 'building', text: 'Inspecting repository' });
    expect(await screen.findByTestId('store-import-progress')).toHaveTextContent(
      'guid.hubHome.storeImport.phase.building'
    );
    finish({ ok: true, packageId: 'user.demo.package', version: '1.0.0', report: 'Signed and installed' });
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('user.demo.package'));
    expect(await screen.findByTestId('store-import-success')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.storeImport.openDetails' }));
    expect(openDetails).toHaveBeenCalledWith('user.demo.package');
  });

  it('uses native folder picker without transmitting a local path', async () => {
    render(<StoreControls filter='all' onFilter={vi.fn()} onImported={vi.fn()} onOpenDetails={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.storeImport.chooseFolder' }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith({
        requestId: expect.any(String),
        kind: 'folder',
      })
    );
  });
});
