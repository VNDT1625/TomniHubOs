/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The extension strip in the shared header (docs/platform/repotopackage-design.md section 12.5):
 * `[pinned icons 1..n] [🧩] ` placed before the notification bell. The strip sizes itself from the spare width of the
 * header and only shows the extensions of the current surface. Pins that do not fit open from the 🧩 popup.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Puzzle } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { buildPopupSections } from '@/common/integrations/extensions/siteAccess';
import {
  SURFACE_NONE,
  computeStripGeometry,
  filterForSurface,
  splitPinnedForStrip,
} from '@/common/integrations/extensions/surface';
import { ExtensionPopup } from './ExtensionPopup';
import { measureSpareWidth } from './stripGap';
import { useExtensionStrip } from './useExtensionStrip';

/** Metrics of the strip; the CSS in tomni-ui.css uses the same sizes. */
const ICON_WIDTH = 28;
const ICON_GAP = 4;
const TOGGLE_WIDTH = 32;
/** Width the open side panel takes from the header room. */
const SIDE_PANEL_WIDTH = 320;
const BROWSER_SURFACE = 'browser';

/** The surface of a route: the Browser page, or elsewhere (where only `none` extensions show). */
export const surfaceForPath = (pathname: string): string =>
  pathname === '/browser' || pathname.startsWith('/browser/') ? BROWSER_SURFACE : SURFACE_NONE;

export type ExtensionStripProps = Readonly<{
  surface: string;
  sidePanelOpen: boolean;
}>;

const ExtensionStrip: React.FC<ExtensionStripProps> = ({ surface, sidePanelOpen }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [spare, setSpare] = useState(0);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState({ bottom: 0, right: 0 });
  const { items, pinnedIds, failed, actionFailed, refresh, togglePin, setSiteAccess, allowSite, uninstall } =
    useExtensionStrip();

  // Follow the header's width and the strip's own width, since the strip itself takes part in the budget.
  useEffect(() => {
    const strip = rootRef.current;
    const header = strip?.closest<HTMLElement>('.app-titlebar');
    if (!strip || !header) return undefined;
    const measure = (): void => setSpare(measureSpareWidth(header));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(strip);
    const toolbar = header.querySelector<HTMLElement>('.app-titlebar__toolbar');
    if (toolbar) observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);

  // Each time the popup opens the list is read again, so an extension turned on elsewhere shows up.
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const onSurface = useMemo(() => filterForSurface(items, surface), [items, surface]);
  const pinnedOnSurface = splitPinnedForStrip(onSurface, pinnedIds, surface, pinnedIds.length).inline.length;
  const geometry = computeStripGeometry({
    gapWidth: spare,
    // The header gap is measured from the real positions of the search box and the bell, and the bell moves with the
    // side panel, so the panel is already counted; subtracting its width again would count it twice.
    sidePanelOpen: false,
    sidePanelWidth: SIDE_PANEL_WIDTH,
    pinnedCount: pinnedOnSurface,
    iconWidth: ICON_WIDTH,
    gap: ICON_GAP,
    toggleWidth: TOGGLE_WIDTH,
  });
  const inline = splitPinnedForStrip(onSurface, pinnedIds, surface, geometry.visibleCount).inline;
  const sections = useMemo(() => buildPopupSections(onSurface, surface), [onSurface, surface]);

  const togglePopup = (): void => {
    const rect = toggleRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ bottom: rect.bottom, right: rect.right });
    setOpen((value) => !value);
  };

  const toggleLabel = t('browser.extensionStrip.button');
  const style = { '--extension-strip-width': `${geometry.width}px` } as React.CSSProperties;

  return (
    <div ref={rootRef} className='extension-strip app-titlebar__no-drag' data-extension-strip style={style}>
      {inline.map((item) => (
        <button
          key={item.id}
          type='button'
          className='extension-strip__pin'
          title={item.name}
          aria-label={item.name}
          onClick={togglePopup}
        >
          {item.iconDataUrl === undefined ? (
            item.name.charAt(0).toUpperCase()
          ) : (
            <img className='extension-strip__icon' src={item.iconDataUrl} alt='' />
          )}
        </button>
      ))}
      <button
        type='button'
        ref={toggleRef}
        className='extension-strip__toggle'
        title={toggleLabel}
        aria-label={toggleLabel}
        aria-haspopup='dialog'
        aria-expanded={open}
        onClick={togglePopup}
      >
        <Puzzle theme='outline' size={16} fill='currentColor' />
      </button>
      {open && (
        <ExtensionPopup
          anchor={anchor}
          sections={sections}
          failed={failed}
          actionFailed={actionFailed}
          onTogglePin={(id) => void togglePin(id)}
          onSetSiteAccess={(id, mode) => void setSiteAccess(id, mode)}
          onAllowSite={(id) => void allowSite(id)}
          onUninstall={(item) => void uninstall(item.packageId)}
          onManage={() => {
            setOpen(false);
            void navigate('/store/extensions');
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};

export default ExtensionStrip;
