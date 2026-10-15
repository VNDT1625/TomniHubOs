/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `packages.revokeLocalKey` channel (docs/platform/repotopackage-design.md section 9.1). Only the main window's top
 * frame may call it (`verifySender`, the same check as the other connection channels). Main asks the person first; the
 * default answer is cancel. The receipt records the outcome and a count, never a key id, package id or path.
 */

import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { LOCAL_KEY_CHANNELS, type LocalKeyRevokeResult } from '@/common/types/platform/packageConnections';

export type LocalKeyBridgeDeps = Readonly<{
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  /** Main's own native confirmation. Resolves true only for an explicit approval. */
  confirm: (event: IpcMainInvokeEvent) => Promise<boolean>;
  /** Revokes the key and reconciles; resolves with how many installed packages became unsigned. */
  revoke: () => Promise<number>;
  /** Content-free receipt of what happened after the confirmation was shown. */
  audit: (
    record: Readonly<{ status: 'completed' | 'cancelled' | 'failed'; unsignedPackages?: number }>
  ) => Promise<void>;
}>;

/** Registers the channel. Returns the function that removes it. */
export const registerLocalKeyBridge = (deps: LocalKeyBridgeDeps): (() => void) => {
  let active = true;
  const record = async (status: 'completed' | 'cancelled' | 'failed', unsignedPackages?: number): Promise<void> => {
    try {
      await deps.audit(unsignedPackages === undefined ? { status } : { status, unsignedPackages });
    } catch {
      // A receipt that cannot be written must not undo or hide what already happened.
    }
  };

  deps.ipcMain.handle(LOCAL_KEY_CHANNELS.revoke, async (event: IpcMainInvokeEvent): Promise<LocalKeyRevokeResult> => {
    if (!active || !deps.verifySender(event)) return { ok: false, error: 'DENIED' };
    let approved: boolean;
    try {
      approved = await deps.confirm(event);
    } catch {
      approved = false;
    }
    if (!approved) {
      await record('cancelled');
      return { ok: false, error: 'CANCELLED' };
    }
    try {
      const unsignedPackages = await deps.revoke();
      await record('completed', unsignedPackages);
      return { ok: true, unsignedPackages };
    } catch {
      await record('failed');
      return { ok: false, error: 'FAILED' };
    }
  });

  return () => {
    active = false;
    deps.ipcMain.removeHandler(LOCAL_KEY_CHANNELS.revoke);
  };
};
