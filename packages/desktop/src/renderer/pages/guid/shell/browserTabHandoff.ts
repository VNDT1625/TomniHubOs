/**
 * Browser tab focus protocol shared by separate bundle realms.
 *
 * The Hub base and a downloaded Browser entrypoint cannot share module-local
 * Sets: the package's app.js is loaded through an isolated blob import.
 * DOM events and ephemeral sessionStorage supply a host-owned hand-off.
 */
const FOCUS_KEY = 'tomni.browser.requestedTab';
const FOCUS_EVENT = 'tomni:browser.focus-tab';
const REFRESH_EVENT = 'tomni:browser.tabs-refresh';
let fallbackPendingId: string | null = null;

export const requestActiveTab = (id: string): void => {
  if (typeof window === 'undefined' || !id || id.length > 256) return;
  fallbackPendingId = id;
  try { window.sessionStorage.setItem(FOCUS_KEY, id); } catch { /* optional storage */ }
  window.dispatchEvent(new CustomEvent<string>(FOCUS_EVENT, { detail: id }));
};

export const subscribeActiveTabRequests = (listener: (id: string) => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const onFocus = (event: Event): void => {
    const id = (event as CustomEvent<unknown>).detail;
    if (typeof id !== 'string' || !id || id.length > 256) return;
    if (fallbackPendingId === id) fallbackPendingId = null;
    try {
      if (window.sessionStorage.getItem(FOCUS_KEY) === id) window.sessionStorage.removeItem(FOCUS_KEY);
    } catch { /* optional storage */ }
    listener(id);
  };
  window.addEventListener(FOCUS_EVENT, onFocus);
  return () => window.removeEventListener(FOCUS_EVENT, onFocus);
};

export const requestTabsRefresh = (): void => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT));
};

export const subscribeTabsRefresh = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(REFRESH_EVENT, listener);
  return () => window.removeEventListener(REFRESH_EVENT, listener);
};

export const consumeRequestedActiveTab = (): string | null => {
  let id: string | null = fallbackPendingId;
  fallbackPendingId = null;
  if (typeof window === 'undefined') return id;
  try {
    id = window.sessionStorage.getItem(FOCUS_KEY) || id;
    window.sessionStorage.removeItem(FOCUS_KEY);
  } catch { /* fallback to in-memory value */ }
  return id;
};
