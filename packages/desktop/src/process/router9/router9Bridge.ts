/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 9Router connector IPC bridge — exposes the Main-process applier to the
 * renderer's "Distribute via 9Router" panel.
 *
 * Like the News/Manager bridges, this is an Electron-native bridge (not an
 * aioncore HTTP route), built with the `@office-ai/platform` `bridge` helper.
 * The channel-name constants ({@link ROUTER9_CHANNELS}) are the renderer-safe
 * contract — the renderer rebuilds matching invokers without importing this
 * Node-only module (see `router9BridgeClient.ts`).
 *
 * The single handler resolves an always-resolve {@link Router9Result} envelope:
 * the platform bridge swallows thrown errors (leaving `invoke()` pending
 * forever), so failures are surfaced as `{ ok: false, error }`.
 *
 * Process boundary: Main-process (Node.js) module. No DOM APIs.
 */

import { bridge } from '@office-ai/platform';

import { applyConnectorPlan, type ApplyResult } from './router9Applier';
import {
  getManagedRouter9Service,
  type ManagedRouter9Client,
  type ManagedRouter9Model,
  type ManagedRouter9Provider,
  type ManagedRouter9Status,
  type ManagedRouter9UsageStats,
  type ManagedRouter9UsageBreakdown,
} from './managedRouter9';
import type { Router9Endpoint } from '@/common/router9';
import { getReadyProviderStore } from '@process/services/tomnyProviderBridge';
import {
  autoStartAndSyncManagedRouter9Provider,
  syncManagedRouter9Provider,
  type ManagedRouter9ProviderSync,
} from './managedRouter9ProviderSync';

/** IPC channel names for the 9Router connector surface. Safe to mirror in the renderer. */
export const ROUTER9_CHANNELS = {
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

/** Apply request: which target + the endpoint credentials to write. */
export type ApplyPlanRequest = {
  targetId: string;
  endpoint: Router9Endpoint;
};

/** Always-resolve result envelope. */
export type Router9Result<T> = { ok: true; data: T } | { ok: false; error: string };

const wrapRouter9Operation = async <T>(operation: () => Promise<T>): Promise<Router9Result<T>> => {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Router9Bridge] managed operation failed:', error);
    return { ok: false, error: message };
  }
};

/** Typed channels. Exported for the bootstrap registration wiring. */
export const router9Channels = {
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

/**
 * Register the 9Router connector IPC handler.
 *
 * Idempotent: a repeated call re-registers the provider. Intended to be invoked
 * once during Main-process bootstrap.
 */
export function registerRouter9Bridge(): void {
  const managed = getManagedRouter9Service();
  router9Channels.applyPlan.provider(async ({ targetId, endpoint }): Promise<Router9Result<ApplyResult>> => {
    try {
      const data = await applyConnectorPlan(targetId, endpoint);
      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Router9Bridge] applyPlan failed:', error);
      return { ok: false, error: message };
    }
  });
  router9Channels.status.provider(() => wrapRouter9Operation(() => managed.status()));
  router9Channels.start.provider(() => wrapRouter9Operation(() => managed.start()));
  router9Channels.stop.provider(() => wrapRouter9Operation(() => managed.stop()));
  router9Channels.ensureClient.provider(({ name }) => wrapRouter9Operation(() => managed.ensureClient(name)));
  router9Channels.listClients.provider(() => wrapRouter9Operation(() => managed.listClients()));
  router9Channels.revokeClient.provider(({ id }) => wrapRouter9Operation(() => managed.revokeClient(id)));
  router9Channels.listProviders.provider(() => wrapRouter9Operation(() => managed.listProviders()));
  router9Channels.listUsageLogs.provider(() => wrapRouter9Operation(() => managed.listUsageLogs()));
  router9Channels.usageStats.provider(() => wrapRouter9Operation(() => managed.usageStats()));
  router9Channels.usageBreakdown.provider(() => wrapRouter9Operation(() => managed.usageBreakdown()));
  router9Channels.setAutoStart.provider(({ enabled }) => wrapRouter9Operation(() => managed.setAutoStart(enabled)));
  router9Channels.listModels.provider(({ clientKey }) => wrapRouter9Operation(() => managed.listModels(clientKey)));
  router9Channels.syncTomniProvider.provider(() =>
    wrapRouter9Operation(async () => syncManagedRouter9Provider(managed, await getReadyProviderStore()))
  );
  router9Channels.openDashboard.provider(({ section }) => wrapRouter9Operation(() => managed.openDashboard(section)));
  void getReadyProviderStore()
    .then((store) => autoStartAndSyncManagedRouter9Provider(managed, store))
    .catch((error: unknown) => {
      console.warn('[Router9Bridge] model gateway auto-start or provider sync failed:', error);
    });
}

export type { ApplyResult, AppliedFile } from './router9Applier';
export type {
  ManagedRouter9Client,
  ManagedRouter9Model,
  ManagedRouter9Provider,
  ManagedRouter9Status,
  ManagedRouter9UsageStats,
  ManagedRouter9UsageBreakdown,
} from './managedRouter9';
export type { ManagedRouter9ProviderSync } from './managedRouter9ProviderSync';
