/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Desktop IPC bridge for WebUI lifecycle (start/stop/getStatus).
 *
 * WebUI credential operations (change-password / change-username / reset-password /
 * generate-qr-token) are NOT handled here — those are HTTP routes on tomnycore's
 * local-only /api/webui/*, called directly by the renderer via ipcBridge HTTP.
 *
 * This bridge owns only the lifecycle + status snapshot, because spawning a
 * WebUI instance requires Electron's app.* / Node child_process — tomnycore
 * has no way to start a WebUI wrapper around itself.
 */

import { ipcBridge } from '@/common';
import {
  getDesktopWebUIStatus,
  restoreDesktopWebUIFromPreferences,
  setDesktopWebUIInitialPassword,
  startDesktopWebUI,
  stopDesktopWebUI,
} from '@process/utils/webuiConfig';
import { getTomniGatewayEndpoint } from '@process/tomnigateway';

type AdminUsernameResult = { username?: string };
type WebUIAuthEndpoint = {
  baseUrl: string;
  native: boolean;
  headers?: Record<string, string>;
};

function getBackendPort(): number | undefined {
  return (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
}

const resolveWebUIAuthEndpoint = async (): Promise<WebUIAuthEndpoint> => {
  const port = getBackendPort();
  if (port) return { baseUrl: `http://127.0.0.1:${port}`, native: false };
  const gateway = await getTomniGatewayEndpoint();
  return {
    baseUrl: gateway.url,
    native: true,
    headers: {
      authorization: `Bearer ${gateway.sessionToken}`,
      'x-tomni-internal': '1',
    },
  };
};

async function fetchAdminUsername(): Promise<string> {
  try {
    const endpoint = await resolveWebUIAuthEndpoint();
    const path = endpoint.native ? '/api/auth/status' : '/api/auth/internal/users/system';
    const res = await fetch(endpoint.baseUrl + path, { headers: endpoint.headers });
    if (!res.ok) return 'admin';
    const json = (await res.json()) as {
      username?: string;
      data?: AdminUsernameResult | null;
    };
    return json.username ?? json.data?.username ?? 'admin';
  } catch {
    return 'admin';
  }
}

/**
 * On first Enable-WebUI click after a fresh install, the backend's users table
 * holds the seeded `system_default_user` row with an empty password_hash.
 * Probe /api/auth/status; if `needs_setup === true`, ask backend to generate
 * and persist a random password, then stash the plaintext for Settings to show
 * once. When the backend already has credentials (upgrade path handled by
 * ensureAdminUser, or a prior Enable-WebUI), this is a no-op.
 */
export async function maybeSeedInitialPassword(): Promise<void> {
  const endpoint = await resolveWebUIAuthEndpoint();
  const statusRes = await fetch(`${endpoint.baseUrl}/api/auth/status`, { headers: endpoint.headers });
  if (!statusRes.ok) {
    throw new Error(`[WebUI] /api/auth/status returned ${statusRes.status}`);
  }
  const statusJson = (await statusRes.json()) as { needs_setup?: boolean; data?: { needs_setup?: boolean } };
  const needsSetup = statusJson.needs_setup ?? statusJson.data?.needs_setup ?? false;
  if (!needsSetup) {
    setDesktopWebUIInitialPassword(undefined);
    return;
  }
  const resetRes = await fetch(`${endpoint.baseUrl}/api/webui/reset-password`, {
    method: 'POST',
    headers: endpoint.headers,
  });
  if (!resetRes.ok) {
    throw new Error(`[WebUI] /api/webui/reset-password returned ${resetRes.status}`);
  }
  const resetJson = (await resetRes.json()) as { data?: { new_password?: string }; new_password?: string };
  const newPassword = resetJson.data?.new_password ?? resetJson.new_password;
  if (!newPassword) {
    throw new Error('[WebUI] /api/webui/reset-password returned no new_password');
  }
  setDesktopWebUIInitialPassword(newPassword);
}

export type WebUIAccountExecutionLease = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
}>;

export type WebUIAccountExecutionLeaseOptions = Readonly<{
  requireAuthenticatedAccount: () => void;
  restore?: () => Promise<void>;
  stop?: () => Promise<void>;
}>;

/**
 * Main-only background owner for the persisted WebUI preference. A saved
 * preference is never authority to expose a host or public tunnel before the
 * account execution lifecycle admits this lease.
 */
export const createWebUIAccountExecutionLease = (
  options: WebUIAccountExecutionLeaseOptions
): WebUIAccountExecutionLease => {
  const restore = options.restore ?? restoreDesktopWebUIFromPreferences;
  const stop = options.stop ?? stopDesktopWebUI;
  return Object.freeze({
    start: async () => {
      options.requireAuthenticatedAccount();
      try {
        await restore();
        // Sign-out may race preference I/O or tunnel startup. Roll back before
        // this lease is admitted to the lifecycle's active set.
        options.requireAuthenticatedAccount();
      } catch (error) {
        await stop();
        throw error;
      }
    },
    stop,
  });
};

export type WebuiBridgeOptions = Readonly<{
  requireAuthenticatedAccount: () => void;
}>;

export function initWebuiBridge(options: WebuiBridgeOptions): void {
  ipcBridge.webui.getStatus.provider(async () => {
    options.requireAuthenticatedAccount();
    const snapshot = getDesktopWebUIStatus();
    const adminUsername = await fetchAdminUsername();
    return { ...snapshot, adminUsername };
  });

  ipcBridge.webui.start.provider(async (params) => {
    options.requireAuthenticatedAccount();
    let handle: Awaited<ReturnType<typeof startDesktopWebUI>> | undefined;
    try {
      await maybeSeedInitialPassword();
      options.requireAuthenticatedAccount();
      handle = await startDesktopWebUI({
        port: params?.port,
        allowRemote: params?.allowRemote,
      });
      // Never return a live host or public tunnel after a session transition.
      options.requireAuthenticatedAccount();
    } catch (error) {
      if (handle !== undefined) await stopDesktopWebUI();
      throw error;
    }
    ipcBridge.webui.statusChanged.emit({
      running: true,
      port: handle.port,
      localUrl: handle.localUrl,
      networkUrl: handle.networkUrl,
      lanIP: handle.lanIP,
      candidateLanIPs: handle.candidateLanIPs,
      publicUrl: handle.publicUrl,
      initialPassword: handle.initialPassword,
    });
    return handle;
  });

  ipcBridge.webui.stop.provider(async () => {
    options.requireAuthenticatedAccount();
    await stopDesktopWebUI();
    ipcBridge.webui.statusChanged.emit({ running: false });
  });
}
