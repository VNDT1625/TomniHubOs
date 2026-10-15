/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pin } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { SITE_ACCESS_MODES, type SiteAccessMode } from '@/common/integrations/extensions/siteAccess';
import type { PopupSections } from '@/common/integrations/extensions/siteAccess';
import type { ExtensionStripItem } from '@/common/integrations/extensions/stripContract';

export type ExtensionPopupProps = Readonly<{
  /** Bottom-right corner of the puzzle button, in viewport pixels; the popup hangs under it. */
  anchor: Readonly<{ bottom: number; right: number }>;
  sections: PopupSections<ExtensionStripItem>;
  failed: boolean;
  actionFailed: boolean;
  onTogglePin: (id: string) => void;
  onSetSiteAccess: (id: string, mode: SiteAccessMode) => void;
  onAllowSite: (id: string) => void;
  onUninstall: (item: ExtensionStripItem) => void;
  onManage: () => void;
  onClose: () => void;
}>;

/** Closes on Escape and on a press outside the strip (presses inside the strip belong to its own buttons). */
const useDismiss = (onClose: () => void): void => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const onPress = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-extension-strip], [data-extension-popup]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPress);
    };
  }, [onClose]);
};

/** The row icon: the manifest icon when Main gave one, else the first letter of the name. */
const renderIcon = (entry: ExtensionStripItem): React.ReactNode =>
  entry.iconDataUrl === undefined ? (
    <span className='extension-popup__icon' aria-hidden='true'>
      {entry.name.charAt(0).toUpperCase()}
    </span>
  ) : (
    <img className='extension-popup__icon extension-popup__icon--image' src={entry.iconDataUrl} alt='' />
  );

const MODE_KEYS: Readonly<Record<SiteAccessMode, string>> = {
  'on-click': 'browser.extensionStrip.siteOnClick',
  'on-site': 'browser.extensionStrip.siteOnSite',
  'all-sites': 'browser.extensionStrip.siteAllSites',
};

/** The dropdown under the puzzle button: two sections, a pin toggle and an overflow menu per row, and a footer link. */
export const ExtensionPopup: React.FC<ExtensionPopupProps> = ({
  anchor,
  sections,
  failed,
  actionFailed,
  onTogglePin,
  onSetSiteAccess,
  onAllowSite,
  onUninstall,
  onManage,
  onClose,
}) => {
  const { t } = useTranslation();
  const [menuId, setMenuId] = useState<string | null>(null);
  useDismiss(onClose);

  const renderRow = (entry: ExtensionStripItem): React.ReactNode => {
    const pinned = entry.pinned;
    const menuOpen = menuId === entry.id;
    const closeMenu = (): void => setMenuId(null);
    return (
      <li key={entry.id} className='extension-popup__row'>
        {renderIcon(entry)}
        <span className='extension-popup__name' title={entry.name}>
          {entry.name}
        </span>
        <button
          type='button'
          className={`extension-popup__action${pinned ? ' extension-popup__action--on' : ''}`}
          aria-pressed={pinned}
          aria-label={pinned ? t('browser.extensionStrip.unpin') : t('browser.extensionStrip.pin')}
          title={pinned ? t('browser.extensionStrip.unpin') : t('browser.extensionStrip.pin')}
          onClick={() => onTogglePin(entry.id)}
        >
          <Pin theme='outline' size={14} fill='currentColor' />
        </button>
        <div className='extension-popup__more'>
          <button
            type='button'
            className='extension-popup__action'
            aria-haspopup='menu'
            aria-expanded={menuOpen}
            aria-label={t('browser.extensionStrip.more')}
            title={t('browser.extensionStrip.more')}
            onClick={() => setMenuId(menuOpen ? null : entry.id)}
          >
            ⋮
          </button>
          {menuOpen && (
            <ul className='extension-popup__menu' role='menu'>
              <li role='none'>
                <button
                  type='button'
                  role='menuitem'
                  className='extension-popup__menu-item'
                  onClick={() => {
                    closeMenu();
                    onTogglePin(entry.id);
                  }}
                >
                  {pinned ? t('browser.extensionStrip.unpin') : t('browser.extensionStrip.pin')}
                </button>
              </li>
              <li role='none' className='extension-popup__menu-label'>
                {t('browser.extensionStrip.siteAccess')}
              </li>
              {SITE_ACCESS_MODES.map((mode) => (
                <li role='none' key={mode}>
                  <button
                    type='button'
                    role='menuitemradio'
                    aria-checked={entry.siteAccess === mode}
                    className='extension-popup__menu-item'
                    onClick={() => {
                      closeMenu();
                      onSetSiteAccess(entry.id, mode);
                    }}
                  >
                    {entry.siteAccess === mode ? '• ' : ''}
                    {t(MODE_KEYS[mode])}
                  </button>
                </li>
              ))}
              {entry.canAllowSite && (
                <li role='none'>
                  <button
                    type='button'
                    role='menuitem'
                    className='extension-popup__menu-item'
                    onClick={() => {
                      closeMenu();
                      onAllowSite(entry.id);
                    }}
                  >
                    {t('browser.extensionStrip.allowSite')}
                  </button>
                </li>
              )}
              <li role='none'>
                <button
                  type='button'
                  role='menuitem'
                  className='extension-popup__menu-item'
                  onClick={() => {
                    closeMenu();
                    onManage();
                  }}
                >
                  {t('browser.extensionStrip.manage')}
                </button>
              </li>
              <li role='none'>
                <button
                  type='button'
                  role='menuitem'
                  className='extension-popup__menu-item extension-popup__menu-item--danger'
                  onClick={() => {
                    closeMenu();
                    onUninstall(entry);
                  }}
                >
                  {t('browser.extensionStrip.uninstall')}
                </button>
              </li>
            </ul>
          )}
        </div>
      </li>
    );
  };

  const empty = sections.fullAccess.length === 0 && sections.accessRequested.length === 0;

  const position: React.CSSProperties = {
    top: Math.round(anchor.bottom + 6),
    right: Math.max(8, Math.round(window.innerWidth - anchor.right)),
  };

  // Drawn on the page body, not inside the header, so no panel or tab bar can sit on top of it.
  return createPortal(
    <div
      className='extension-popup app-titlebar__no-drag'
      data-extension-popup
      style={position}
      role='dialog'
      aria-label={t('browser.extensionStrip.popupTitle')}
    >
      <div className='extension-popup__title'>{t('browser.extensionStrip.popupTitle')}</div>
      {failed && <p className='extension-popup__notice'>{t('browser.extensionStrip.loadError')}</p>}
      {actionFailed && <p className='extension-popup__notice'>{t('browser.extensionStrip.actionFailed')}</p>}
      {empty && !failed && <p className='extension-popup__notice'>{t('browser.extensionStrip.empty')}</p>}
      {sections.fullAccess.length > 0 && (
        <section className='extension-popup__section'>
          <h4 className='extension-popup__heading'>{t('browser.extensionStrip.fullAccess')}</h4>
          <ul className='extension-popup__list'>{sections.fullAccess.map(renderRow)}</ul>
        </section>
      )}
      {sections.accessRequested.length > 0 && (
        <section className='extension-popup__section'>
          <h4 className='extension-popup__heading'>{t('browser.extensionStrip.accessRequested')}</h4>
          <ul className='extension-popup__list'>{sections.accessRequested.map(renderRow)}</ul>
        </section>
      )}
      <button type='button' className='extension-popup__footer' onClick={onManage}>
        {t('browser.extensionStrip.manage')}
      </button>
    </div>,
    document.body
  );
};

export default ExtensionPopup;
