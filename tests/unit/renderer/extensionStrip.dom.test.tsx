/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPopupSections } from '@/common/integrations/extensions/siteAccess';
import type { ExtensionStripItem } from '@/common/integrations/extensions/stripContract';
import { ExtensionPopup } from '@/renderer/components/layout/Titlebar/extensions/ExtensionPopup';
import ExtensionStrip, { surfaceForPath } from '@/renderer/components/layout/Titlebar/extensions/ExtensionStrip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

type WindowWithApi = Window & { electronAPI?: unknown };

const item = (
  overrides: Partial<ExtensionStripItem> & Pick<ExtensionStripItem, 'id' | 'name'>
): ExtensionStripItem => ({
  packageId: 'com.test.pkg',
  connectionId: 'c',
  surfaces: ['none'],
  needsAccess: false,
  pinned: false,
  siteAccess: 'all-sites',
  canAllowSite: false,
  ...overrides,
});

const ENTRIES: ExtensionStripItem[] = [
  item({ id: 'one', name: 'Alpha' }),
  item({ id: 'two', name: 'Beta', needsAccess: true, canAllowSite: true, siteAccess: 'on-click' }),
];

const handlers = () => ({
  onTogglePin: vi.fn(),
  onSetSiteAccess: vi.fn(),
  onAllowSite: vi.fn(),
  onUninstall: vi.fn(),
  onManage: vi.fn(),
  onClose: vi.fn(),
});

const popup = (
  entries: ExtensionStripItem[],
  callbacks: ReturnType<typeof handlers>,
  extra: Partial<{ failed: boolean; actionFailed: boolean }> = {}
) => (
  <ExtensionPopup
    anchor={{ bottom: 36, right: 600 }}
    sections={buildPopupSections(entries, 'none')}
    failed={extra.failed ?? false}
    actionFailed={extra.actionFailed ?? false}
    {...callbacks}
  />
);

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid='location'>{location.pathname}</div>;
};

afterEach(() => {
  cleanup();
  delete (window as WindowWithApi).electronAPI;
});

describe('ExtensionPopup', () => {
  it('shows both sections with their rows', () => {
    render(popup(ENTRIES, handlers()));
    expect(screen.getByText('browser.extensionStrip.fullAccess')).toBeTruthy();
    expect(screen.getByText('browser.extensionStrip.accessRequested')).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('toggles the pin of a row, and labels a pinned row as unpin', () => {
    const callbacks = handlers();
    const { rerender } = render(popup(ENTRIES, callbacks));
    fireEvent.click(screen.getAllByRole('button', { name: 'browser.extensionStrip.pin' })[0]!);
    expect(callbacks.onTogglePin).toHaveBeenCalledWith('one');

    rerender(popup([item({ id: 'one', name: 'Alpha', pinned: true }), ENTRIES[1]!], callbacks));
    expect(screen.getAllByRole('button', { name: 'browser.extensionStrip.unpin' })).toHaveLength(1);
  });

  it('sets the site access level from the overflow menu', () => {
    const callbacks = handlers();
    render(popup(ENTRIES, callbacks));
    fireEvent.click(screen.getAllByRole('button', { name: 'browser.extensionStrip.more' })[1]!);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'browser.extensionStrip.siteOnSite' }));
    expect(callbacks.onSetSiteAccess).toHaveBeenCalledWith('two', 'on-site');
  });

  it('offers "allow on this site" only where access is requested and the mode allows it', () => {
    const callbacks = handlers();
    render(popup(ENTRIES, callbacks));
    fireEvent.click(screen.getAllByRole('button', { name: 'browser.extensionStrip.more' })[0]!);
    expect(screen.queryByRole('menuitem', { name: 'browser.extensionStrip.allowSite' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'browser.extensionStrip.more' })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'browser.extensionStrip.more' })[1]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'browser.extensionStrip.allowSite' }));
    expect(callbacks.onAllowSite).toHaveBeenCalledWith('two');
  });

  it('asks for the removal of an extension from its overflow menu', () => {
    const callbacks = handlers();
    render(popup(ENTRIES, callbacks));
    fireEvent.click(screen.getAllByRole('button', { name: 'browser.extensionStrip.more' })[0]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'browser.extensionStrip.uninstall' }));
    expect(callbacks.onUninstall).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'one', packageId: 'com.test.pkg' })
    );
  });

  it('shows the icon of the extension when Main gave one, and the first letter otherwise', () => {
    render(
      popup(
        [item({ id: 'one', name: 'Alpha', iconDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }), ENTRIES[1]!],
        handlers()
      )
    );
    const image = document.body.querySelector('img.extension-popup__icon--image');
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('opens the store from the footer link', () => {
    const callbacks = handlers();
    render(popup([], callbacks));
    fireEvent.click(screen.getByRole('button', { name: 'browser.extensionStrip.manage' }));
    expect(callbacks.onManage).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and on a press outside the strip', () => {
    const callbacks = handlers();
    render(popup(ENTRIES, callbacks));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    expect(callbacks.onClose).toHaveBeenCalledTimes(2);
  });

  it('shows the empty, load error and action failed notices', () => {
    const { rerender } = render(popup([], handlers()));
    expect(screen.getByText('browser.extensionStrip.empty')).toBeTruthy();
    rerender(popup([], handlers(), { failed: true }));
    expect(screen.getByText('browser.extensionStrip.loadError')).toBeTruthy();
    expect(screen.queryByText('browser.extensionStrip.empty')).toBeNull();
    rerender(popup(ENTRIES, handlers(), { actionFailed: true }));
    expect(screen.getByText('browser.extensionStrip.actionFailed')).toBeTruthy();
  });
});

describe('ExtensionStrip', () => {
  it('always shows the puzzle button, even with no bridge', () => {
    render(
      <MemoryRouter>
        <ExtensionStrip surface='none' sidePanelOpen={false} />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'browser.extensionStrip.button' })).toBeTruthy();
  });

  it('reads the list when the popup opens, sends no origin, and shows only the entries of the surface', async () => {
    const list = vi.fn(async () => ({
      ok: true as const,
      data: [item({ id: 'one', name: 'Alpha' }), item({ id: 'two', name: 'Browser only', surfaces: ['browser'] })],
    }));
    (window as WindowWithApi).electronAPI = { extensionStrip: { list } };

    render(
      <MemoryRouter>
        <ExtensionStrip surface='none' sidePanelOpen={false} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'browser.extensionStrip.button' }));

    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(list).toHaveBeenCalledWith({});
    expect(screen.queryByText('Browser only')).toBeNull();
  });

  it('opens the Extensions tab of the Store from the footer link', async () => {
    (window as WindowWithApi).electronAPI = { extensionStrip: { list: vi.fn(async () => ({ ok: true, data: [] })) } };
    render(
      <MemoryRouter initialEntries={['/browser']}>
        <Routes>
          <Route path='/store/*' element={<LocationProbe />} />
          <Route
            path='*'
            element={
              <>
                <ExtensionStrip surface='browser' sidePanelOpen={false} />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'browser.extensionStrip.button' }));
    fireEvent.click(await screen.findByRole('button', { name: 'browser.extensionStrip.manage' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/store/extensions'));
  });

  it('maps routes to surfaces', () => {
    expect(surfaceForPath('/browser')).toBe('browser');
    expect(surfaceForPath('/browser/tab')).toBe('browser');
    expect(surfaceForPath('/browserx')).toBe('none');
    expect(surfaceForPath('/guid')).toBe('none');
  });
});
