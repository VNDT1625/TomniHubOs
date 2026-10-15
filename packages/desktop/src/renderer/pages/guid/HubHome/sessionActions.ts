import type { PackageSessionAction } from '@/renderer/pages/hub/packageSessionActions';
import { BROWSER_HOME_URL } from '@package-apps/browser/renderer/browser/constants';

export const BROWSER_APP_ID = 'com.tomni.browser';

export type SessionActionDeps = {
  openBrowserTab: (url: string) => Promise<{ id?: string } | undefined>;
  closeBrowserTab: (id: string) => Promise<unknown>;
  focusBrowserTab: (id: string) => void;
  navigate: (path: string) => void;
  emit: (action: PackageSessionAction) => void;
};

/**
 * What the sidebar "+" and "x" do. Browser is driven directly; every other app gets a request on the package
 * bus. Any failure is dropped silently: the sidebar just stays as it was.
 */
export const createSessionActions = (deps: SessionActionDeps) => ({
  createSession: async (appId: string): Promise<void> => {
    try {
      if (appId !== BROWSER_APP_ID) {
        deps.emit({ packageId: appId, kind: 'create' });
        return;
      }
      // A new tab starts on the home page, like the "+" in the Browser's own tab strip.
      const result = await deps.openBrowserTab(BROWSER_HOME_URL);
      if (!result || typeof result.id !== 'string' || result.id.length === 0) return;
      deps.focusBrowserTab(result.id);
      deps.navigate('/browser');
    } catch {
      // Nothing to show: the "+" simply did nothing.
    }
  },
  closeSession: async (appId: string, sessionId: string): Promise<void> => {
    try {
      if (appId !== BROWSER_APP_ID) {
        deps.emit({ packageId: appId, kind: 'close', sessionId });
        return;
      }
      await deps.closeBrowserTab(sessionId);
    } catch {
      // Nothing to show: the "x" simply did nothing.
    }
  },
});
