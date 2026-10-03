/**
 * Default Browser runtime entrypoint. Core starts this base capability during
 * Electron bootstrap; it is not loaded from a Store artifact.
 */

import type { BrowserWindow } from 'electron';
import { disposeBrowserBridge, registerBrowserBridge } from '@process/browser/browserBridge';
import { stopBrowserControlMcpHost } from '@process/browser/browserControlMcpHost';
import { ensureBrowserControlMcpRegistered } from '@process/browser/registerBrowserControlMcp';
import { disposeBrowserControl } from '@process/browser/browserControlWiring';

export const activate = async (
  input: Readonly<{ getMainWindow: () => BrowserWindow | null | undefined }>
): Promise<void> => {
  registerBrowserBridge({ getWindow: input.getMainWindow });
  await ensureBrowserControlMcpRegistered();
};

export const deactivate = async (): Promise<void> => {
  await stopBrowserControlMcpHost();
  disposeBrowserControl();
  disposeBrowserBridge();
};
