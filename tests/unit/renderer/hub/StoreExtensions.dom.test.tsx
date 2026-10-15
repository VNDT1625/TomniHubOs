import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionsTab, storeViewForPath } from '@/renderer/pages/integrations/extensions/ExtensionsTab';
import { LocalBuiltUpdateCheck } from '@/renderer/pages/integrations/store/LocalBuiltUpdateCheck';
import { StoreControls } from '@/renderer/pages/integrations/store/StoreControls';

const mocks = vi.hoisted(() => ({
  t: (key: string, values?: Record<string, string>) => (values?.code ? `${key}:${values.code}` : key),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));

const PKG = 'acme.demo';
const view = (overrides: Record<string, unknown> = {}) => ({
  key: 'extension:ext-1',
  kind: 'extension',
  title: 'Ad Blocker',
  format: 'chrome-mv3',
  runsCode: true,
  enabled: false,
  status: 'off',
  ...overrides,
});

describe('Store update check, extension sources and Extensions tab (S1, S2, S3 UI)', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    api = {
      checkUpdate: vi.fn().mockResolvedValue({ ok: true, status: 'up-to-date' }),
      import: vi.fn().mockResolvedValue({ ok: false, error: 'DISABLED' }),
      onProgress: vi.fn().mockReturnValue(() => undefined),
      list: vi.fn().mockResolvedValue({ ok: true, data: [view()] }),
      describe: vi.fn().mockResolvedValue({ ok: true, data: { approvalHash: 'sha256-' + 'a'.repeat(64) } }),
      enable: vi.fn().mockResolvedValue({ ok: true, data: view({ enabled: true, status: 'on' }) }),
      disable: vi.fn().mockResolvedValue({ ok: true, data: view() }),
    };
    vi.stubGlobal('electronAPI', { repoStore: api, packageConnections: api });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks Main for the read-only check and shows the answer', async () => {
    render(<LocalBuiltUpdateCheck packageId={PKG} />);
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.storeImport.checkUpdate' }));
    expect(api.checkUpdate).toHaveBeenCalledWith({ packageId: PKG });
    expect(await screen.findByText('guid.hubHome.storeImport.checkUpdateCurrent')).toBeInTheDocument();
  });

  it('shows the stable failure code when the check is refused', async () => {
    api.checkUpdate.mockResolvedValueOnce({ ok: false, error: 'NOT_LOCAL_BUILT' });
    render(<LocalBuiltUpdateCheck packageId={PKG} />);
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.storeImport.checkUpdate' }));
    expect(await screen.findByText('guid.hubHome.storeImport.checkUpdateFailed:NOT_LOCAL_BUILT')).toBeInTheDocument();
  });

  it('sends the extension file kind and the typed Web Store input, and explains a disabled source', async () => {
    render(<StoreControls filter='all' onFilter={vi.fn()} onImported={vi.fn()} onOpenDetails={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.storeImport.chooseExtensionFile' }));
    await waitFor(() => expect(api.import).toHaveBeenCalledWith(expect.objectContaining({ kind: 'extension-file' })));
    expect(await screen.findByText('guid.hubHome.storeImport.webStoreDisabled')).toBeInTheDocument();
    const webStore = screen.getByRole('textbox', { name: 'guid.hubHome.storeImport.webStoreInput' });
    fireEvent.change(webStore, { target: { value: 'abcdefghijklmnopabcdefghijklmnop' } });
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.storeImport.importWebStore' }));
    await waitFor(() =>
      expect(api.import).toHaveBeenLastCalledWith({
        requestId: expect.any(String),
        kind: 'chrome-web-store',
        url: 'abcdefghijklmnopabcdefghijklmnop',
      })
    );
  });

  it('lists extensions of installed packages and turns one on only through describe then enable', async () => {
    render(<ExtensionsTab packageIds={[PKG]} />);
    expect(await screen.findByText('Ad Blocker')).toBeInTheDocument();
    expect(screen.getByText('chrome-mv3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'guid.hubHome.storeImport.ext.turnOn' }));
    await waitFor(() =>
      expect(api.enable).toHaveBeenCalledWith({
        packageId: PKG,
        connectionKey: 'extension:ext-1',
        approvalHash: 'sha256-' + 'a'.repeat(64),
      })
    );
    expect(api.describe).toHaveBeenCalledBefore(api.enable);
  });

  it('shows the exact reason and last error text of a connection that failed to load', async () => {
    api.list.mockResolvedValueOnce({
      ok: true,
      data: [view({ status: 'error', reason: 'Manifest v3 field missing', lastError: 'service worker crashed' })],
    });
    render(<ExtensionsTab packageIds={[PKG]} />);
    expect(await screen.findByText('Manifest v3 field missing')).toBeInTheDocument();
    expect(screen.getByText('service worker crashed')).toBeInTheDocument();
  });

  it('maps the Store path /store/extensions to the Extensions tab and every other path to Packages', () => {
    expect(storeViewForPath('/store/extensions')).toBe('extensions');
    expect(storeViewForPath('/store/extensions/')).toBe('extensions');
    expect(storeViewForPath('/store')).toBe('packages');
    expect(storeViewForPath('/store/package/acme.demo')).toBe('packages');
  });

  it('pins, sets the site access level and removes a loaded extension only through Main', async () => {
    const id = 'a'.repeat(32);
    const strip = {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          {
            id,
            packageId: PKG,
            connectionId: 'ext-1',
            name: 'Ad Blocker',
            surfaces: ['none'],
            needsAccess: false,
            pinned: false,
            siteAccess: 'on-click',
            canAllowSite: false,
          },
        ],
      }),
      setPinned: vi.fn().mockResolvedValue({ ok: true }),
      setSiteAccess: vi.fn().mockResolvedValue({ ok: true }),
      allowSite: vi.fn().mockResolvedValue({ ok: true }),
      uninstall: vi.fn().mockResolvedValue({ ok: true }),
    };
    vi.stubGlobal('electronAPI', { repoStore: api, packageConnections: api, extensionStrip: strip });
    render(<ExtensionsTab packageIds={[PKG]} />);

    fireEvent.click(await screen.findByTestId('extension-site-on-site-extension:ext-1'));
    await waitFor(() => expect(strip.setSiteAccess).toHaveBeenCalledWith({ id, mode: 'on-site' }));
    fireEvent.click(screen.getByTestId('extension-pin-extension:ext-1'));
    await waitFor(() => expect(strip.setPinned).toHaveBeenCalledWith({ id, pinned: true }));
    fireEvent.click(screen.getByTestId('extension-remove-extension:ext-1'));
    await waitFor(() => expect(strip.uninstall).toHaveBeenCalledWith({ packageId: PKG }));
  });
});
