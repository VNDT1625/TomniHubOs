/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startStaticServer, type StaticServerHandle } from '@tomny/web-host';
import {
  FIRST_PARTY_PACKAGE_CATALOG,
  type PackageListing,
  type PackageMutationAction,
} from '../../../packages/desktop/src/common/packages';
import { PACKAGE_MUTATION_NATIVE_CHANNELS } from '../../../packages/desktop/src/common/types/platform/electron';
import {
  createLocalPackageMutationRuntime,
  createPackageHttpApi,
  createPackageHttpRuntimeRegistry,
  createPackageUpdatePermissionConsentAuthority,
  parsePackageMutationExecuteRequest,
  registerTrustedPackageMutationIpcBridge,
  type PackageMutationRuntime,
  type TrustedPackageMutationIpcHost,
} from '../../../packages/desktop/src/process/extensions/package-manager/packageHttpApi';
import type { PackageManagerService } from '../../../packages/desktop/src/process/extensions/package-manager/PackageManagerService';
import { createCatalogActionConsentAuthority } from '../../../packages/desktop/src/process/extensions/package-manager/catalog-federation/actionLedger';
import { CatalogFederationError } from '../../../packages/desktop/src/process/extensions/package-manager/catalog-federation/types';

import {
  createWebCliPackageApiHandler,
  resolveWebCliPackageArtifactUrl,
} from '../../../packages/web-cli/src/packageApi';

const DOWNLOADABLE_PACKAGE = FIRST_PARTY_PACKAGE_CATALOG.find(
  (entry) =>
    entry.manifest.id === 'com.tomni.calculator' && entry.delivery === 'downloaded-package' && entry.artifactUrl
);
if (!DOWNLOADABLE_PACKAGE?.artifactUrl) throw new Error('Expected a downloadable first-party package fixture.');
const PACKAGE_ID = DOWNLOADABLE_PACKAGE.manifest.id;
const ARTIFACT_NAME = decodeURIComponent(new URL(DOWNLOADABLE_PACKAGE.artifactUrl).pathname.split('/').at(-1)!);

const listen = async (server: Server): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};

const close = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

describe('released Web CLI Package API', () => {
  let dataDir = '';
  let staticDir = '';
  let backend: Server;
  let artifactServer: Server;
  let handle: StaticServerHandle | undefined;
  let backendPort = 0;
  let artifactPort = 0;
  let authorized = true;
  let authenticatedUserId = 'tomni-admin';

  beforeEach(async () => {
    authorized = true;
    authenticatedUserId = 'tomni-admin';
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tomny-web-package-data-'));
    staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tomny-web-package-static-'));
    await fs.writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>Tomny</title>');

    backend = http.createServer((request, response) => {
      if (request.url === '/api/auth/user') {
        response.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: { id: authenticatedUserId, username: 'admin' } }));
        return;
      }
      response.writeHead(404).end();
    });
    backendPort = await listen(backend);

    const artifact = await fs.readFile(path.resolve('store-artifacts', ARTIFACT_NAME));
    artifactServer = http.createServer((_request, response) => {
      response.writeHead(200, {
        'content-length': String(artifact.byteLength),
        'content-type': 'application/vnd.tomni.package+json',
      });
      response.end(artifact);
    });
    artifactPort = await listen(artifactServer);
  });

  afterEach(async () => {
    await handle?.stop();
    await Promise.all([close(backend), close(artifactServer)]);
    await Promise.all([
      fs.rm(dataDir, { recursive: true, force: true }),
      fs.rm(staticDir, { recursive: true, force: true }),
    ]);
  });

  const startHost = async (): Promise<void> => {
    handle = await startStaticServer({
      staticDir,
      backendPort,
      port: 0,
      localApiHandler: createWebCliPackageApiHandler({
        dataDir,
        appVersion: '1.0.0',
        backendPort,
        resolveArtifactUrl: () => `http://127.0.0.1:${artifactPort}/${ARTIFACT_NAME}`,
        allowLocalArtifactUrls: true,
      }),
    });
  };

  const contributionState = async (): Promise<{ snapshot: { revision: number; packageIds: string[] } }> => {
    const response = await fetch(`${handle!.localUrl}/api/packages/contributions`, {
      headers: { connection: 'close' },
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: { snapshot: { revision: number; packageIds: string[] } } }).data;
  };

  const waitForContributions = async (
    afterRevision: number,
    timeoutMs: number
  ): Promise<{ data: { snapshot: { revision: number; packageIds: string[] } }; timedOut: boolean }> => {
    const response = await fetch(
      `${handle!.localUrl}/api/packages/contributions/wait?afterRevision=${afterRevision}&timeoutMs=${timeoutMs}`,
      { headers: { connection: 'close' } }
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{
      data: { snapshot: { revision: number; packageIds: string[] } };
      timedOut: boolean;
    }>;
  };

  const grantMutation = async (action: PackageMutationAction, idempotencyKey: string, cookie = ''): Promise<string> => {
    const response = await fetch(`${handle!.localUrl}/api/packages/${encodeURIComponent(PACKAGE_ID)}/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: handle!.localUrl, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ action, idempotencyKey, region: 'VN', confirmed: true }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { consentId: string } };
    return payload.data.consentId;
  };

  const mutatePackage = async (
    action: PackageMutationAction,
    idempotencyKey: string,
    cookie = ''
  ): Promise<Response> => {
    const consentId = await grantMutation(action, idempotencyKey, cookie);
    return fetch(`${handle!.localUrl}/api/packages/${encodeURIComponent(PACKAGE_ID)}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: handle!.localUrl, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ idempotencyKey, region: 'VN', consentId }),
    });
  };

  it('requires authentication before opening a contribution wait', async () => {
    authorized = false;
    await startHost();

    const response = await fetch(`${handle!.localUrl}/api/packages/contributions/wait?afterRevision=0&timeoutMs=1`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });

  it('returns contribution waits immediately when a newer revision already exists', async () => {
    await startHost();
    const current = await contributionState();

    const result = await waitForContributions(Math.max(0, current.snapshot.revision - 1), 5_000);

    expect(result.timedOut).toBe(false);
    expect(result.data.snapshot.revision).toBe(current.snapshot.revision);
  });

  it('wakes contribution waits on install and uninstall revisions', async () => {
    await startHost();
    const initial = await contributionState();
    const installWait = waitForContributions(initial.snapshot.revision, 5_000);

    const install = await mutatePackage('install', 'install-contribution-wait-1');

    expect(install.status).toBe(200);
    const installed = await installWait;
    expect(installed.timedOut).toBe(false);
    expect(installed.data.snapshot.revision).toBeGreaterThan(initial.snapshot.revision);
    expect(installed.data.snapshot.packageIds).toContain(PACKAGE_ID);

    const uninstallWait = waitForContributions(installed.data.snapshot.revision, 5_000);
    const uninstall = await mutatePackage('uninstall', 'uninstall-contribution-wait-1');

    expect(uninstall.status).toBe(200);
    const uninstalled = await uninstallWait;
    expect(uninstalled.timedOut).toBe(false);
    expect(uninstalled.data.snapshot.revision).toBeGreaterThan(installed.data.snapshot.revision);
    expect(uninstalled.data.snapshot.packageIds).not.toContain(PACKAGE_ID);
  });

  it('blocks uninstall while a browser sandbox lease is active and releases it after close', async () => {
    await startHost();
    const install = await mutatePackage('install', 'install-runtime-lease-1');
    expect(install.status).toBe(200);

    const runtimeUrl = `${handle!.localUrl}/api/packages/${encodeURIComponent(PACKAGE_ID)}/runtime`;
    const headers = { 'content-type': 'application/json', origin: handle!.localUrl };
    const open = await fetch(`${runtimeUrl}/open`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runtimeId: 'browser-tab-1' }),
    });
    expect(open.status).toBe(200);

    const blocked = await mutatePackage('uninstall', 'uninstall-runtime-lease-blocked-1');
    expect(blocked.status).toBe(400);

    const closeRuntime = await fetch(`${runtimeUrl}/close`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runtimeId: 'browser-tab-1' }),
    });
    expect(closeRuntime.status).toBe(200);

    const uninstall = await mutatePackage('uninstall', 'uninstall-runtime-lease-released-1');
    expect(uninstall.status).toBe(200);
  });

  it('governs enable and disable through the same consent-bound HTTP mutation path', async () => {
    await startHost();
    expect((await mutatePackage('install', 'install-lifecycle-route-1')).status).toBe(200);

    const disabled = await mutatePackage('disable', 'disable-lifecycle-route-1');
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({ data: { state: 'installed', enabled: false } });

    const enabled = await mutatePackage('enable', 'enable-lifecycle-route-1');
    expect(enabled.status).toBe(200);
    await expect(enabled.json()).resolves.toMatchObject({ data: { state: 'installed', enabled: true } });
  });

  it('returns the current revision when a bounded contribution wait times out', async () => {
    await startHost();
    const current = await contributionState();

    const result = await waitForContributions(current.snapshot.revision, 10);

    expect(result.timedOut).toBe(true);
    expect(result.data.snapshot.revision).toBe(current.snapshot.revision);
  });

  it('cleans a contribution waiter when its client disconnects', async () => {
    await startHost();
    const current = await contributionState();
    const waitUrl = new URL(
      `/api/packages/contributions/wait?afterRevision=${current.snapshot.revision}&timeoutMs=30000`,
      handle!.localUrl
    );

    await new Promise<void>((resolve) => {
      const request = http.get(waitUrl);
      request.once('error', () => resolve());
      request.once('close', () => resolve());
      setTimeout(() => request.destroy(), 25);
    });

    const followUp = await waitForContributions(current.snapshot.revision, 10);
    expect(followUp.timedOut).toBe(true);
  });

  it('removes the contribution listener and timer when a waiting socket closes', async () => {
    const listeners = new Set<(event: { revision: number }) => void>();
    const state = {
      snapshot: {
        revision: 7,
        packageIds: [],
        apps: [],
        activityGroups: [],
        subtabs: [],
        commands: [],
        settings: [],
      },
      diagnostics: [],
    };
    const service = {
      initialize: async () => undefined,
      contributions: async () => state,
      onContributionsChanged: (listener: (event: { revision: number }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as PackageManagerService;
    const handler = createPackageHttpApi({ service, authorize: async () => true });
    const server = http.createServer((request, response) => {
      void handler(request, response).catch(() => response.destroy());
    });
    const port = await listen(server);
    let request: ReturnType<typeof http.get> | undefined;

    try {
      request = http.get(`http://127.0.0.1:${port}/api/packages/contributions/wait?afterRevision=7&timeoutMs=30000`, {
        headers: { connection: 'close' },
      });
      request.on('error', () => undefined);
      await vi.waitFor(() => expect(listeners.size).toBe(1), { timeout: 500, interval: 5 });

      request.destroy();

      await vi.waitFor(() => expect(listeners.size).toBe(0), { timeout: 500, interval: 5 });
    } finally {
      request?.destroy();
      await close(server);
    }
  });

  it('requires authentication before an artifact provider can read a package payload', async () => {
    let artifactReads = 0;
    const service = { initialize: async () => undefined } as unknown as PackageManagerService;
    const handler = createPackageHttpApi({
      service,
      authorize: async () => false,
      artifactProvider: async () => {
        artifactReads += 1;
        return Buffer.from('package payload');
      },
    });
    const server = http.createServer((request, response) => {
      void handler(request, response).catch(() => response.destroy());
    });
    const port = await listen(server);

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/packages/artifacts/private.tomny`, {
        headers: { connection: 'close' },
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'UNAUTHORIZED' });
      expect(artifactReads).toBe(0);
    } finally {
      await close(server);
    }
  });

  it('rejects encoded artifact path ambiguity and does not cache an authorized payload', async () => {
    const artifactNames: string[] = [];
    const service = { initialize: async () => undefined } as unknown as PackageManagerService;
    const handler = createPackageHttpApi({
      service,
      authorize: async () => true,
      artifactProvider: async (name) => {
        artifactNames.push(name);
        return Buffer.from('package payload');
      },
    });
    const server = http.createServer((request, response) => {
      void handler(request, response).catch(() => response.destroy());
    });
    const port = await listen(server);

    try {
      const ambiguous = await fetch(`http://127.0.0.1:${port}/api/packages/artifacts/%252e%252e%252fprivate.tomny`, {
        headers: { connection: 'close' },
      });

      expect(ambiguous.status).toBe(404);
      await expect(ambiguous.json()).resolves.toEqual({ error: 'PACKAGE_ARTIFACT_NOT_FOUND' });
      expect(artifactNames).toEqual([]);

      const response = await fetch(`http://127.0.0.1:${port}/api/packages/artifacts/released.tomny`, {
        headers: { connection: 'close' },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      await expect(response.text()).resolves.toBe('package payload');
      expect(artifactNames).toEqual(['released.tomny']);
    } finally {
      await close(server);
    }
  });

  it('fails closed for cross-site package mutations while allowing read-only access', async () => {
    await startHost();
    const forbidden = await fetch(`${handle!.localUrl}/api/packages/${encodeURIComponent(PACKAGE_ID)}/install`, {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
      body: '{}',
    });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: 'PACKAGE_MUTATION_FORBIDDEN' });

    const readOnly = await fetch(`${handle!.localUrl}/api/packages`);
    expect(readOnly.status).toBe(200);
  });

  it('rejects an install that invents a consent identifier', async () => {
    await startHost();

    const response = await fetch(`${handle!.localUrl}/api/packages/${encodeURIComponent(PACKAGE_ID)}/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=owner-a', origin: handle!.localUrl },
      body: JSON.stringify({ idempotencyKey: 'forged-consent-1', region: 'VN', consentId: 'forged' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'CATALOG_ACTION_DENIED' });
  });

  it('rejects a valid consent grant when a different authenticated user submits it', async () => {
    await startHost();
    const idempotencyKey = 'owner-mismatch-1';
    const consentId = await grantMutation('install', idempotencyKey, 'session=owner-a');
    authenticatedUserId = 'different-user';

    const response = await fetch(`${handle!.localUrl}/api/packages/${encodeURIComponent(PACKAGE_ID)}/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=owner-a', origin: handle!.localUrl },
      body: JSON.stringify({ idempotencyKey, region: 'VN', consentId }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'CATALOG_ACTION_DENIED' });
  });

  it('keeps consent ownership stable when the authenticated user cookie rotates', async () => {
    await startHost();
    const idempotencyKey = 'owner-cookie-rotation-1';
    const consentId = await grantMutation('install', idempotencyKey, 'session=old-cookie');

    const response = await fetch(`${handle!.localUrl}/api/packages/${encodeURIComponent(PACKAGE_ID)}/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'session=new-cookie', origin: handle!.localUrl },
      body: JSON.stringify({ idempotencyKey, region: 'VN', consentId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { state: 'installed' } });
  });

  it('replays a completed HTTP mutation from the durable ledger after host restart', async () => {
    await startHost();
    const idempotencyKey = 'http-ledger-replay-1';
    const consentId = await grantMutation('install', idempotencyKey, 'session=owner-a');
    const execute = (): Promise<Response> =>
      fetch(`${handle!.localUrl}/api/packages/${encodeURIComponent(PACKAGE_ID)}/install`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: 'session=owner-a', origin: handle!.localUrl },
        body: JSON.stringify({ idempotencyKey, region: 'VN', consentId }),
      });

    expect((await execute()).status).toBe(200);
    await handle!.stop();
    handle = undefined;
    await startHost();

    const replay = await execute();
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ data: { state: 'installed' } });
    const ledger = JSON.parse(
      await fs.readFile(path.join(dataDir, 'tomny-packages', 'catalog-action-ledger', 'active.json'), 'utf8')
    ) as { entries: Array<{ idempotencyKey: string; state: string; consent?: { consentId: string } }> };
    expect(ledger.entries.filter((entry) => entry.idempotencyKey === idempotencyKey)).toEqual([
      expect.objectContaining({ state: 'completed', consent: expect.objectContaining({ consentId }) }),
    ]);
  });

  it('keeps the free signed Store package consent-bound through restart and removes it cleanly', async () => {
    await startHost();
    const install = await mutatePackage('install', 'install-contribution-wait-1');

    expect(install.status).toBe(200);

    await handle!.stop();
    handle = undefined;
    await startHost();

    const response = await fetch(`${handle!.localUrl}/api/packages?installedOnly=true`);
    const payload = (await response.json()) as { data: Array<{ manifest: { id: string }; state: string }> };
    expect(payload.data).toEqual([
      expect.objectContaining({ manifest: expect.objectContaining({ id: PACKAGE_ID }), state: 'installed' }),
    ]);

    const contributions = await fetch(`${handle!.localUrl}/api/packages/contributions`);
    expect(contributions.status).toBe(200);
    await expect(contributions.json()).resolves.toEqual({
      data: {
        snapshot: expect.objectContaining({ packageIds: [PACKAGE_ID] }),
        diagnostics: [],
      },
    });
    await expect(fs.access(path.join(dataDir, 'tomny-packages', 'installed.json'))).resolves.toBeUndefined();

    const uninstall = await mutatePackage('uninstall', 'uninstall-after-restart-1');
    expect(uninstall.status).toBe(200);
    await expect(uninstall.json()).resolves.toMatchObject({ data: { state: 'available', enabled: false } });

    const afterUninstall = await fetch(`${handle!.localUrl}/api/packages?installedOnly=true`);
    await expect(afterUninstall.json()).resolves.toEqual({ data: [] });
    expect((await contributionState()).snapshot.packageIds).toEqual([]);
  });

  it('preserves the catalog URL by default and supports a configurable remote mirror', () => {
    expect(resolveWebCliPackageArtifactUrl(DOWNLOADABLE_PACKAGE.artifactUrl!, {})).toBe(
      DOWNLOADABLE_PACKAGE.artifactUrl
    );
    expect(
      resolveWebCliPackageArtifactUrl(DOWNLOADABLE_PACKAGE.artifactUrl!, {
        TOMNI_PACKAGE_ARTIFACT_BASE_URL: 'https://packages.example.test/releases',
      })
    ).toBe(`https://packages.example.test/releases/${encodeURIComponent(ARTIFACT_NAME)}`);
  });

  it('does not expose a bundled package artifact from the base Web CLI', async () => {
    await startHost();

    const response = await fetch(`${handle!.localUrl}/api/packages/artifacts/${ARTIFACT_NAME}`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'PACKAGE_ROUTE_NOT_FOUND' });
  });
});

describe('trusted package mutation IPC gateway', () => {
  type TestSender = { id: string; trusted: boolean };
  type TestHandler = (sender: TestSender, payload: unknown) => Promise<unknown>;

  const createHarness = () => {
    const handlers = new Map<string, TestHandler>();
    const grantOwners = new Map<string, string>();
    let ownerUnavailable: ((ownerId: string) => void) | undefined;
    const listing: PackageListing = {
      manifest: DOWNLOADABLE_PACKAGE.manifest,
      delivery: DOWNLOADABLE_PACKAGE.delivery,
      trust: DOWNLOADABLE_PACKAGE.trust,
      state: 'installed',
      installedVersion: DOWNLOADABLE_PACKAGE.manifest.version,
      updateAvailable: false,
      compatible: true,
      enabled: true,
    };
    const runtime: PackageMutationRuntime = {
      requestConsent: vi.fn((request) => {
        const consentId = `consent-${request.ownerId}`;
        grantOwners.set(consentId, request.ownerId);
        return { consentId, expiresAt: '2026-07-27T00:02:00.000Z' };
      }),
      preparePermissionConsent: vi.fn(async () => ({ required: false })),
      approvePermissionConsent: vi.fn(async () => ({
        receiptId: 'permission-receipt-1',
        packageId: PACKAGE_ID,
        from: { version: '1.0.0', revision: `sha256-${'a'.repeat(64)}` },
        to: { version: '1.1.0', revision: `sha256-${'b'.repeat(64)}` },
        permissions: { added: ['network.fetch'], removed: [], changed: [] },
        issuedAt: '2026-07-27T00:00:00.000Z',
        expiresAt: '2026-07-27T00:02:00.000Z',
      })),
      execute: vi.fn(async (request) => {
        if (grantOwners.get(request.consentId) !== request.ownerId) {
          throw new CatalogFederationError('CATALOG_ACTION_DENIED', 'Consent owner mismatch.');
        }
        return listing;
      }),
      recoverPendingActions: vi.fn(async () => ({ recovered: [], failed: [], quarantined: [] })),
      revokeOwner: vi.fn((ownerId) => {
        for (const [consentId, grantOwner] of grantOwners) {
          if (grantOwner === ownerId) grantOwners.delete(consentId);
        }
      }),
    };
    const host: TrustedPackageMutationIpcHost<TestSender> = {
      handle: (channel, handler) => {
        if (handlers.has(channel)) throw new Error(`Duplicate test handler: ${channel}`);
        handlers.set(channel, handler);
      },
      removeHandler: (channel) => {
        handlers.delete(channel);
      },
    };
    const dispose = registerTrustedPackageMutationIpcBridge({
      host,
      runtime,
      verifySender: (sender) => sender.trusted,
      identifySender: (sender) => `electron:${sender.id}`,
      subscribeOwnerUnavailable: (listener) => {
        ownerUnavailable = listener;
        return () => {
          ownerUnavailable = undefined;
        };
      },
    });
    return {
      handlers,
      runtime,
      dispose,
      emitOwnerUnavailable: (ownerId: string): void => ownerUnavailable?.(ownerId),
    };
  };

  const consentPayload = {
    id: PACKAGE_ID,
    action: 'install' as const,
    idempotencyKey: 'native-install-1',
    region: 'VN',
    confirmed: true as const,
  };

  it('rejects an untrusted sender before issuing consent', async () => {
    const harness = createHarness();
    const handler = harness.handlers.get(PACKAGE_MUTATION_NATIVE_CHANNELS.requestConsent)!;

    await expect(handler({ id: 'attacker', trusted: false }, consentPayload)).rejects.toThrow(
      'PACKAGE_MUTATION_SENDER_UNTRUSTED'
    );
    expect(harness.runtime.requestConsent).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('binds consent to the host-derived sender and revokes it when that owner disappears', async () => {
    const harness = createHarness();
    const requestConsent = harness.handlers.get(PACKAGE_MUTATION_NATIVE_CHANNELS.requestConsent)!;
    const execute = harness.handlers.get(PACKAGE_MUTATION_NATIVE_CHANNELS.execute)!;
    const senderA = { id: 'owner-a', trusted: true };
    const grant = (await requestConsent(senderA, consentPayload)) as { consentId: string };
    const executePayload = {
      id: PACKAGE_ID,
      action: 'install' as const,
      idempotencyKey: consentPayload.idempotencyKey,
      region: 'VN',
      consentId: grant.consentId,
    };

    await expect(execute({ id: 'owner-b', trusted: true }, executePayload)).rejects.toThrow('CATALOG_ACTION_DENIED');
    await expect(execute(senderA, executePayload)).resolves.toMatchObject({ state: 'installed' });
    expect(harness.runtime.requestConsent).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'electron:owner-a' })
    );

    harness.emitOwnerUnavailable('electron:owner-a');
    expect(harness.runtime.revokeOwner).toHaveBeenCalledWith('electron:owner-a');
    harness.dispose();
    expect(harness.handlers.size).toBe(0);
  });

  it('rejects renderer-supplied ownership fields instead of trusting them', async () => {
    const harness = createHarness();
    const handler = harness.handlers.get(PACKAGE_MUTATION_NATIVE_CHANNELS.requestConsent)!;

    await expect(
      handler({ id: 'owner-a', trusted: true }, { ...consentPayload, ownerId: 'electron:attacker' })
    ).rejects.toThrow('PACKAGE_MUTATION_REQUEST_INVALID');
    expect(harness.runtime.requestConsent).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('redacts internal runtime metadata from consent IPC failures while preserving a stable code', async () => {
    const harness = createHarness();
    const handler = harness.handlers.get(PACKAGE_MUTATION_NATIVE_CHANNELS.requestConsent)!;
    harness.runtime.requestConsent = () => {
      throw new Error('C:\\sensitive-package-root\\consent-token.txt');
    };

    const failure = await handler({ id: 'owner-a', trusted: true }, consentPayload).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: 'PackageOperationError',
      message: 'PACKAGE_OPERATION_FAILED',
      failure: { phase: 'install', code: 'PACKAGE_OPERATION_FAILED' },
    });
    expect(String(failure)).not.toContain('sensitive-package-root');
    expect(String(failure)).not.toContain('consent-token.txt');
    harness.dispose();
  });
});

describe('package mutation input canonicalization', () => {
  it('rejects padded idempotency keys and permission receipts before they reach mutation maps', () => {
    const request = {
      id: PACKAGE_ID,
      action: 'install',
      idempotencyKey: 'request-1',
      region: 'VN',
      consentId: 'consent-1',
    } as const;

    expect(() => parsePackageMutationExecuteRequest({ ...request, idempotencyKey: 'request-1 ' })).toThrow(
      'PACKAGE_IDEMPOTENCY_KEY_INVALID'
    );
    expect(() => parsePackageMutationExecuteRequest({ ...request, permissionConsentId: 'receipt-1 ' })).toThrow(
      'PACKAGE_PERMISSION_CONSENT_ID_INVALID'
    );
  });
});

describe('catalog consent capacity', () => {
  it('bounds unconsumed action grants before they can grow the trusted-memory map', () => {
    let nextId = 0;
    const authority = createCatalogActionConsentAuthority({
      randomId: () => `catalog-consent-${++nextId}`,
      maxPendingGrants: 1,
    });
    const decision = {
      action: 'install' as const,
      source: 'tomni-store' as const,
      sourceItemId: PACKAGE_ID,
      ownerId: 'electron:window-a',
      idempotencyKey: 'catalog-request-1',
      region: 'VN',
      approved: true,
    };

    expect(authority.recordUserDecision(decision)).toMatchObject({ consentId: 'catalog-consent-1' });
    expect(authority.recordUserDecision({ ...decision, idempotencyKey: 'catalog-request-2' })).toBeUndefined();
  });
});

describe('package update permission consent authority', () => {
  const updateListing = (fromPermissions: string[], toPermissions: string[]): PackageListing => {
    const installedManifest = {
      ...DOWNLOADABLE_PACKAGE.manifest,
      version: '1.0.0',
      permissions: fromPermissions,
    };
    return {
      manifest: { ...installedManifest, version: '1.1.0', permissions: toPermissions },
      delivery: DOWNLOADABLE_PACKAGE.delivery,
      trust: DOWNLOADABLE_PACKAGE.trust,
      state: 'installed',
      installedVersion: installedManifest.version,
      installedManifest,
      updateAvailable: true,
      compatible: true,
      enabled: true,
    };
  };

  it('requires an owner-bound receipt for the exact main-process permission delta', async () => {
    let listing = updateListing(['workspace.read'], ['workspace.read', 'network.fetch']);
    let nextId = 0;
    const authority = createPackageUpdatePermissionConsentAuthority({
      lookupPackage: async () => listing,
      now: () => new Date('2026-07-27T00:00:00.000Z'),
      randomId: () => `permission-consent-${++nextId}`,
    });

    const preparation = await authority.prepare({ id: PACKAGE_ID, ownerId: 'electron:window-a' });

    expect(preparation).toMatchObject({
      required: true,
      challenge: {
        packageId: PACKAGE_ID,
        from: { version: '1.0.0', revision: expect.stringMatching(/^sha256-[a-f0-9]{64}$/) },
        to: { version: '1.1.0', revision: expect.stringMatching(/^sha256-[a-f0-9]{64}$/) },
        permissions: { added: ['network.fetch'], removed: [], changed: [] },
      },
    });
    const receipt = await authority.approve({
      challengeId: preparation.challenge!.challengeId,
      confirmed: true,
      ownerId: 'electron:window-a',
    });

    await expect(
      authority.authorize({ id: PACKAGE_ID, ownerId: 'electron:window-b', receiptId: receipt.receiptId })
    ).rejects.toThrow('PACKAGE_PERMISSION_CONSENT_INVALID');
    await expect(
      authority.authorize({ id: 'com.tomni.other', ownerId: 'electron:window-a', receiptId: receipt.receiptId })
    ).rejects.toThrow('PACKAGE_PERMISSION_CONSENT_INVALID');
    await expect(
      authority.authorize({ id: PACKAGE_ID, ownerId: 'electron:window-a', receiptId: receipt.receiptId })
    ).resolves.toBeUndefined();
    await expect(
      authority.authorize({ id: PACKAGE_ID, ownerId: 'electron:window-a', receiptId: receipt.receiptId })
    ).rejects.toThrow('PACKAGE_PERMISSION_CONSENT_INVALID');

    const stalePreparation = await authority.prepare({ id: PACKAGE_ID, ownerId: 'electron:window-a' });
    const staleReceipt = await authority.approve({
      challengeId: stalePreparation.challenge!.challengeId,
      confirmed: true,
      ownerId: 'electron:window-a',
    });
    listing = updateListing(['workspace.read'], ['workspace.read', 'filesystem.write']);
    await expect(
      authority.authorize({ id: PACKAGE_ID, ownerId: 'electron:window-a', receiptId: staleReceipt.receiptId })
    ).rejects.toThrow('PACKAGE_PERMISSION_CONSENT_STALE');
  });

  it('denies an expired challenge and preserves updates with no permission change', async () => {
    let nowMs = Date.parse('2026-07-27T00:00:00.000Z');
    const authority = createPackageUpdatePermissionConsentAuthority({
      lookupPackage: async () => updateListing(['workspace.read'], ['workspace.read', 'network.fetch']),
      now: () => new Date(nowMs),
      randomId: () => 'permission-consent-expiring',
      ttlMs: 1_000,
    });
    const preparation = await authority.prepare({ id: PACKAGE_ID, ownerId: 'electron:window-a' });
    nowMs += 1_001;
    await expect(
      authority.approve({
        challengeId: preparation.challenge!.challengeId,
        confirmed: true,
        ownerId: 'electron:window-a',
      })
    ).rejects.toThrow('PACKAGE_PERMISSION_CONSENT_INVALID');

    const unchanged = createPackageUpdatePermissionConsentAuthority({
      lookupPackage: async () =>
        updateListing(['workspace.read', 'network.fetch'], ['network.fetch', 'workspace.read']),
    });
    await expect(unchanged.prepare({ id: PACKAGE_ID, ownerId: 'electron:window-a' })).resolves.toEqual({
      required: false,
    });
    await expect(unchanged.authorize({ id: PACKAGE_ID, ownerId: 'electron:window-a' })).resolves.toBeUndefined();
  });

  it('bounds pending permission challenges and receipts', async () => {
    let nextId = 0;
    const authority = createPackageUpdatePermissionConsentAuthority({
      lookupPackage: async () => updateListing(['workspace.read'], ['workspace.read', 'network.fetch']),
      randomId: () => `bounded-consent-${++nextId}`,
      maxPendingConsents: 1,
    });
    const ownerId = 'electron:window-a';
    const first = await authority.prepare({ id: PACKAGE_ID, ownerId });

    await expect(authority.prepare({ id: PACKAGE_ID, ownerId })).rejects.toThrow(
      'PACKAGE_PERMISSION_CONSENT_UNAVAILABLE'
    );

    await authority.approve({ challengeId: first.challenge!.challengeId, confirmed: true, ownerId });
    const second = await authority.prepare({ id: PACKAGE_ID, ownerId });
    await expect(
      authority.approve({ challengeId: second.challenge!.challengeId, confirmed: true, ownerId })
    ).rejects.toThrow('PACKAGE_PERMISSION_CONSENT_UNAVAILABLE');
  });

  it('coalesces an exact duplicate permissioned update without reusing its receipt', async () => {
    const ledgerRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tomny-package-ledger-'));
    try {
      let listing = updateListing(['workspace.read'], ['workspace.read', 'network.fetch']);
      let releaseInstall = (): void => undefined;
      let markInstallStarted = (): void => undefined;
      const installStarted = new Promise<void>((resolve) => {
        markInstallStarted = resolve;
      });
      const installGate = new Promise<void>((resolve) => {
        releaseInstall = resolve;
      });
      const service = {
        status: vi.fn(async (): Promise<PackageListing> => listing),
        install: vi.fn(async (): Promise<PackageListing> => {
          markInstallStarted();
          await installGate;
          listing = {
            ...listing,
            installedVersion: listing.manifest.version,
            installedManifest: structuredClone(listing.manifest),
            updateAvailable: false,
          };
          return listing;
        }),
      } as unknown as PackageManagerService;
      let nextId = 0;
      const runtime = createLocalPackageMutationRuntime({
        service,
        ledgerRootDir,
        now: () => new Date('2026-07-27T00:00:00.000Z'),
        randomId: () => `id-${++nextId}`,
      });
      const ownerId = 'electron:window-a';
      const idempotencyKey = 'permissioned-update-1';
      const consent = await runtime.requestConsent({
        id: PACKAGE_ID,
        action: 'install',
        idempotencyKey,
        region: 'VN',
        confirmed: true,
        ownerId,
      });
      const preparation = await runtime.preparePermissionConsent({ id: PACKAGE_ID, ownerId });
      const permission = await runtime.approvePermissionConsent({
        challengeId: preparation.challenge!.challengeId,
        confirmed: true,
        ownerId,
      });
      const request = {
        id: PACKAGE_ID,
        action: 'install' as const,
        idempotencyKey,
        region: 'VN',
        consentId: consent.consentId,
        permissionConsentId: permission.receiptId,
        ownerId,
      };

      const first = runtime.execute(request);
      await installStarted;
      const duplicate = runtime.execute(request);
      releaseInstall();

      await expect(Promise.all([first, duplicate])).resolves.toEqual([
        expect.objectContaining({ installedVersion: '1.1.0', updateAvailable: false }),
        expect.objectContaining({ installedVersion: '1.1.0', updateAvailable: false }),
      ]);
      expect(service.install).toHaveBeenCalledTimes(1);
      await expect(runtime.execute(request)).resolves.toMatchObject({
        installedVersion: '1.1.0',
        updateAvailable: false,
      });
      expect(service.install).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(ledgerRootDir, { recursive: true, force: true });
    }
  });
});

describe('browser package runtime registry', () => {
  it('keeps independent owners active until their lease closes or expires', () => {
    let now = 1_000;
    const runtime = createPackageHttpRuntimeRegistry({ now: () => now, leaseMs: 100 });

    runtime.open({ packageId: PACKAGE_ID, runtimeId: 'tab-a', ownerId: 'owner-a' });
    runtime.open({ packageId: PACKAGE_ID, runtimeId: 'tab-b', ownerId: 'owner-b' });
    runtime.close({ packageId: PACKAGE_ID, runtimeId: 'tab-a', ownerId: 'owner-a' });
    expect(runtime.isActive(PACKAGE_ID)).toBe(true);

    now = 1_100;
    expect(runtime.isActive(PACKAGE_ID)).toBe(false);
    expect(runtime.reserveMutation(PACKAGE_ID)).toBeDefined();
  });

  it('excludes runtime opens while a package mutation owns the reservation', () => {
    const runtime = createPackageHttpRuntimeRegistry();
    const reservation = runtime.reserveMutation(PACKAGE_ID)!;

    expect(() => runtime.open({ packageId: PACKAGE_ID, runtimeId: 'tab-a', ownerId: 'owner-a' })).toThrowError(
      'PACKAGE_RUNTIME_MUTATION_ACTIVE'
    );

    reservation.release();
    reservation.release();
    expect(() => runtime.open({ packageId: PACKAGE_ID, runtimeId: 'tab-a', ownerId: 'owner-a' })).not.toThrow();
    expect(runtime.reserveMutation(PACKAGE_ID)).toBeUndefined();
  });

  it('rejects non-positive lease durations', () => {
    expect(() => createPackageHttpRuntimeRegistry({ leaseMs: 0 })).toThrowError('PACKAGE_RUNTIME_LEASE_INVALID');
  });
});
