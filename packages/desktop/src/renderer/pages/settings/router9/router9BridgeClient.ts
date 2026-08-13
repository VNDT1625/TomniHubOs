/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renderer-safe client for the 9Router connector IPC surface.
 *
 * The Main-process bridge module (`process/router9/router9Bridge.ts`) pulls in
 * Node `fs`/`os`, so it must NOT be imported into the renderer at runtime.
 * Mirroring `newsBridgeClient.ts`, this module re-declares the channel-name
 * strings (kept in sync with `ROUTER9_CHANNELS`), rebuilds matching invokers,
 * and wraps the call with a timeout so an unregistered channel rejects instead
 * of hanging. Only **types** are borrowed from Main via `import type`.
 *
 * Process boundary: Renderer module. No Node.js APIs.
 */

import { bridge } from '@office-ai/platform';
import type { Router9Endpoint } from '@/common/router9';
import type {
  ApplyPlanRequest,
  ApplyResult,
  ManagedRouter9Client,
  ManagedRouter9Model,
  ManagedRouter9Provider,
  ManagedRouter9ProviderSync,
  ManagedRouter9Status,
  ManagedRouter9UsageStats,
  ManagedRouter9UsageBreakdown,
  Router9Result,
} from '@process/router9/router9Bridge';

/** 9Router IPC channel names. Mirrors `ROUTER9_CHANNELS` in the bridge. */
const ROUTER9_CHANNELS = {
  applyPlan: 'router9.apply-plan',
  status: 'router9.status',
  start: 'router9.start',
  stop: 'router9.stop',
  ensureClient: 'router9.ensure-client',
  listClients: 'router9.list-clients',
  revokeClient: 'router9.revoke-client',
  listProviders: 'router9.list-providers',
  listUsageLogs: 'router9.list-usage-logs',
  usageStats: 'router9.usage-stats',
  usageBreakdown: 'router9.usage-breakdown',
  setAutoStart: 'router9.set-auto-start',
  listModels: 'router9.list-models',
  syncTomniProvider: 'router9.sync-tomni-provider',
  openDashboard: 'router9.open-dashboard',
} as const;

const channels = {
  applyPlan: bridge.buildProvider<Router9Result<ApplyResult>, ApplyPlanRequest>(ROUTER9_CHANNELS.applyPlan),
  status: bridge.buildProvider<Router9Result<ManagedRouter9Status>, void>(ROUTER9_CHANNELS.status),
  start: bridge.buildProvider<Router9Result<ManagedRouter9Status>, void>(ROUTER9_CHANNELS.start),
  stop: bridge.buildProvider<Router9Result<ManagedRouter9Status>, void>(ROUTER9_CHANNELS.stop),
  ensureClient: bridge.buildProvider<Router9Result<ManagedRouter9Client>, { name: string }>(
    ROUTER9_CHANNELS.ensureClient
  ),
  listClients: bridge.buildProvider<Router9Result<ManagedRouter9Client[]>, void>(ROUTER9_CHANNELS.listClients),
  revokeClient: bridge.buildProvider<Router9Result<void>, { id: string }>(ROUTER9_CHANNELS.revokeClient),
  listProviders: bridge.buildProvider<Router9Result<{ connections?: ManagedRouter9Provider[] }>, void>(
    ROUTER9_CHANNELS.listProviders
  ),
  listUsageLogs: bridge.buildProvider<Router9Result<string[]>, void>(ROUTER9_CHANNELS.listUsageLogs),
  usageStats: bridge.buildProvider<Router9Result<ManagedRouter9UsageStats>, void>(ROUTER9_CHANNELS.usageStats),
  usageBreakdown: bridge.buildProvider<Router9Result<ManagedRouter9UsageBreakdown>, void>(
    ROUTER9_CHANNELS.usageBreakdown
  ),
  setAutoStart: bridge.buildProvider<Router9Result<ManagedRouter9Status>, { enabled: boolean }>(
    ROUTER9_CHANNELS.setAutoStart
  ),
  listModels: bridge.buildProvider<Router9Result<ManagedRouter9Model[]>, { clientKey?: string }>(
    ROUTER9_CHANNELS.listModels
  ),
  syncTomniProvider: bridge.buildProvider<Router9Result<ManagedRouter9ProviderSync>, void>(
    ROUTER9_CHANNELS.syncTomniProvider
  ),
  openDashboard: bridge.buildProvider<Router9Result<void>, { section: 'providers' | 'usage' | 'endpoint' }>(
    ROUTER9_CHANNELS.openDashboard
  ),
};

/** Apply writes files — allow a generous budget but still bound it. */
const APPLY_TIMEOUT_MS = 15_000;

/** Error thrown when the apply call does not reply within its budget. */
export class Router9BridgeTimeoutError extends Error {
  constructor(channel: string) {
    super(`[Router9BridgeClient] No reply on "${channel}" — the 9Router bridge may not be wired yet.`);
    this.name = 'Router9BridgeTimeoutError';
  }
}

/** Race an `invoke` against a timeout so a missing handler rejects, not hangs. */
const withTimeout = <T>(channel: string, call: () => Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Router9BridgeTimeoutError(channel));
    }, timeoutMs);
    call().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });

/** Timeout-guarded 9Router connector invokers. */
export const router9Client = {
  /** Write the target's config files (deep-merge, with backup) for the endpoint. */
  applyPlan: (targetId: string, endpoint: Router9Endpoint) =>
    withTimeout(ROUTER9_CHANNELS.applyPlan, () => channels.applyPlan.invoke({ targetId, endpoint }), APPLY_TIMEOUT_MS),
  status: () => withTimeout(ROUTER9_CHANNELS.status, () => channels.status.invoke(), APPLY_TIMEOUT_MS),
  start: () => withTimeout(ROUTER9_CHANNELS.start, () => channels.start.invoke(), 60_000),
  stop: () => withTimeout(ROUTER9_CHANNELS.stop, () => channels.stop.invoke(), APPLY_TIMEOUT_MS),
  ensureClient: (name: string) =>
    withTimeout(ROUTER9_CHANNELS.ensureClient, () => channels.ensureClient.invoke({ name }), APPLY_TIMEOUT_MS),
  listClients: () => withTimeout(ROUTER9_CHANNELS.listClients, () => channels.listClients.invoke(), APPLY_TIMEOUT_MS),
  revokeClient: (id: string) =>
    withTimeout(ROUTER9_CHANNELS.revokeClient, () => channels.revokeClient.invoke({ id }), APPLY_TIMEOUT_MS),
  listProviders: () =>
    withTimeout(ROUTER9_CHANNELS.listProviders, () => channels.listProviders.invoke(), APPLY_TIMEOUT_MS),
  listUsageLogs: () =>
    withTimeout(ROUTER9_CHANNELS.listUsageLogs, () => channels.listUsageLogs.invoke(), APPLY_TIMEOUT_MS),
  usageStats: () => withTimeout(ROUTER9_CHANNELS.usageStats, () => channels.usageStats.invoke(), APPLY_TIMEOUT_MS),
  usageBreakdown: () =>
    withTimeout(ROUTER9_CHANNELS.usageBreakdown, () => channels.usageBreakdown.invoke(), APPLY_TIMEOUT_MS),
  setAutoStart: (enabled: boolean) =>
    withTimeout(ROUTER9_CHANNELS.setAutoStart, () => channels.setAutoStart.invoke({ enabled }), APPLY_TIMEOUT_MS),
  listModels: (clientKey?: string) =>
    withTimeout(ROUTER9_CHANNELS.listModels, () => channels.listModels.invoke({ clientKey }), APPLY_TIMEOUT_MS),
  syncTomniProvider: () =>
    withTimeout(ROUTER9_CHANNELS.syncTomniProvider, () => channels.syncTomniProvider.invoke(), APPLY_TIMEOUT_MS),
  openDashboard: (section: 'providers' | 'usage' | 'endpoint') =>
    withTimeout(ROUTER9_CHANNELS.openDashboard, () => channels.openDashboard.invoke({ section }), APPLY_TIMEOUT_MS),
};

export type {
  ApplyResult,
  ManagedRouter9Client,
  ManagedRouter9Model,
  ManagedRouter9Provider,
  ManagedRouter9ProviderSync,
  ManagedRouter9Status,
  ManagedRouter9UsageStats,
  ManagedRouter9UsageBreakdown,
} from '@process/router9/router9Bridge';
