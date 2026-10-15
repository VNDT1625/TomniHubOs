/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

/**
 * The browser page is a native WebContentsView, which always paints above the
 * renderer DOM. Any DOM popup (header dropdowns, selects, modals, drawers) would
 * therefore open *underneath* the page. This selector matches the portal-mounted
 * popups the app produces so the page can yield while one is visible.
 */
const POPUP_SELECTOR = [
  '.arco-trigger-popup',
  '.arco-modal-wrapper',
  '.arco-drawer-wrapper',
  '[data-browser-overlay]',
  'body > [role="menu"]',
  'body > [role="listbox"]',
  'body > [role="dialog"]',
].join(',');

const isVisible = (el: Element): boolean => {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
};

const hasVisiblePopup = (): boolean => Array.from(document.querySelectorAll(POPUP_SELECTOR)).some(isVisible);

/** Returns true while any DOM popup is visible anywhere in the document. */
export function useDomOverlayGuard(enabled: boolean): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    let rafId: number | null = null;
    const check = () => {
      rafId = null;
      setOpen(hasVisiblePopup());
    };
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(check);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
    check();
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      setOpen(false);
    };
  }, [enabled]);

  return open;
}
