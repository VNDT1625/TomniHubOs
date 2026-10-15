/** Fixed reviewed Browser native host; PackageManager activates it only for a verified installed package. */

import type { BrowserWindow } from 'electron';
import { disposeBrowserBridge, getBrowserServices, registerBrowserBridge } from '@process/browser/browserBridge';
import { stopBrowserControlMcpHost } from '@process/browser/browserControlMcpHost';
import { ensureBrowserControlMcpRegistered } from '@process/browser/registerBrowserControlMcp';
import { disposeBrowserControl } from '@process/browser/browserControlWiring';
import { prepareBrowserProfile } from '@process/integrations/browserExtensions/profile';

let detachWindowListeners: (() => void) | undefined;

export const activate = async (
  input: Readonly<{ getMainWindow: () => BrowserWindow | null | undefined }>
): Promise<void> => {
  // Permission policy + one-time cookie copy must finish before the first tab loads a page.
    await prepareBrowserProfile({ getWindow: input.getMainWindow });
  registerBrowserBridge({ getWindow: input.getMainWindow });
  detachWindowListeners?.();
  const window = input.getMainWindow();
  if (window && !window.isDestroyed()) {
    const services = getBrowserServices(input.getMainWindow);
    const onHide = (): void => {
      const protectedTabs = services.viewManager.listTabs()
        .filter((tab) => services.isAgentMode(tab.id))
        .map((tab) => tab.id);
      services.viewManager.setHubSleeping?.(true, protectedTabs);
    };
    const onShow = (): void => services.viewManager.setHubSleeping?.(false);
    window.on('hide', onHide);
    window.on('show', onShow);
    detachWindowListeners = () => {
      window.removeListener('hide', onHide);
      window.removeListener('show', onShow);
    };
    if (!window.isVisible()) onHide();
  }
  await ensureBrowserControlMcpRegistered();
};

export const deactivate = async (): Promise<void> => {
  detachWindowListeners?.();
  detachWindowListeners = undefined;
  await stopBrowserControlMcpHost();
  disposeBrowserControl();
  disposeBrowserBridge();
};
