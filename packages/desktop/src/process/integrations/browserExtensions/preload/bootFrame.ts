/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the frame preload does (docs/platform/repotopackage-design.md section 12.3). Electron runs a `type: 'frame'`
 * preload in every frame of the Browser profile session, ordinary web pages included, so the first statement leaves
 * unless the page is a `chrome-extension:` page; a web page therefore gets no function and no IPC channel from here.
 * For an extension page the preload asks Main once, synchronously, whether the page belongs to an extension the host
 * loaded, and installs the shim only on a yes. Main checks the sender again on every call.
 *
 * Electron's objects are passed in, so this runs under Node in the unit tests.
 */

import { SHIM_HELLO_CHANNEL, SHIM_NAMESPACES } from '@/process/integrations/browserExtensions/api/contract';
import {
  createCall,
  installShimInWorld,
  type InvokeRenderer,
} from '@/process/integrations/browserExtensions/preload/bridge';

export type FrameEnvironment = Readonly<{
  /** `location.protocol` of the frame. */
  protocol: string;
  ipcRenderer: InvokeRenderer & Readonly<{ sendSync: (channel: string) => unknown }>;
  contextBridge: Readonly<{
    executeInMainWorld: (script: { func: (...args: never[]) => unknown; args: unknown[] }) => unknown;
  }>;
}>;

/** Returns true when the shim was installed in this frame. */
export const bootFrame = (environment: FrameEnvironment): boolean => {
  if (environment.protocol !== 'chrome-extension:') return false;
  let known = false;
  try {
    known = environment.ipcRenderer.sendSync(SHIM_HELLO_CHANNEL) === true;
  } catch {
    return false;
  }
  if (!known) return false;
  try {
    environment.contextBridge.executeInMainWorld({
      func: installShimInWorld as unknown as (...args: never[]) => unknown,
      args: [createCall(environment.ipcRenderer), SHIM_NAMESPACES],
    });
    return true;
  } catch {
    return false;
  }
};
