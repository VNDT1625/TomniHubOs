/**
 * @vitest-environment jsdom
 */

import { spawn } from 'node:child_process';

import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FIRST_PARTY_PACKAGE_CATALOG, FIRST_PARTY_PACKAGE_TRUSTED_KEYS, type PackageListing } from '@/common/packages';
import { createPackageManagerService } from '@process/extensions/package-manager/PackageManagerService';
import {
  buildSandboxDocument,
  getFirstRunnablePackageModule,
  PackageAppHost,
} from '@/renderer/pages/hub/PackageAppHost';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const packageMocks = vi.hoisted(() => ({
  list: vi.fn(),
  readAsset: vi.fn(),
  openRuntime: vi.fn(),
  closeRuntime: vi.fn(),
  activateCapability: vi.fn(),
  invokeCapability: vi.fn(),
  cancelCapability: vi.fn(),
}));

vi.mock('@/renderer/pages/hub/packageClient', () => ({
  packageClient: packageMocks,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
    t: (key: string) =>
      ({
        'common.loading': 'Loading',
        'common.historyBack': 'Back',
        'guid.hubHome.shell.store': 'Store',
        'common.failed': 'App unavailable',
        'common.error': 'Load failed',
        'common.system': 'Sandboxed',
      })[key] ?? key,
  }),
}));

const createListing = (overrides: Partial<PackageListing> = {}): PackageListing => {
  const listing: PackageListing = {
    manifest: {
      schemaVersion: 1,
      id: 'com.tomni.calculator',
      publisherId: 'com.tomni',
      name: 'Calculator',
      description: 'Downloaded calculator',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=0.0.0' },
      modules: [
        {
          id: 'calculator',
          title: 'Calculator',
          surface: 'apps/calculator',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['calculator'],
    },
    delivery: 'downloaded-package',
    trust: 'signed-store',
    state: 'installed',
    installedVersion: '1.0.0',
    updateAvailable: false,
    compatible: true,
    enabled: true,
    ...overrides,
  };
  if (listing.state === 'installed' && !listing.installedManifest) {
    listing.installedManifest = structuredClone(listing.manifest);
  }
  if (listing.state === 'installed' && !listing.installedTrust) {
    listing.installedTrust = listing.trust;
  }
  return listing;
};

const createTrustedReactListing = (): PackageListing => {
  const listing = createListing({ trust: 'signed-first-party' });
  listing.manifest.modules[0] = {
    ...listing.manifest.modules[0]!,
    runtime: 'trusted-react',
    entrypoint: 'app.js',
  };
  listing.installedManifest = structuredClone(listing.manifest);
  listing.installedTrust = 'signed-first-party';
  return listing;
};

const ARTIFACT_MOUNT_SCRIPT = String.raw`
  import { JSDOM } from 'jsdom';
  const modulePath = process.argv[1];
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
  const win = dom.window;
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'MutationObserver', 'DOMParser', 'localStorage', 'sessionStorage', 'getComputedStyle'];
  for (const name of globals) Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? win : win[name] });
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  win.__backendPort = 13400;
  win.electronAPI = { emit: async () => undefined, on: () => undefined };
  globalThis.fetch = async () => new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  const runtime = await import(new URL('file:///' + modulePath.replaceAll('\\\\', '/')).href);
  if (typeof runtime.mount !== 'function') throw new Error('Artifact has no mount export.');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const ignoredHandles = new Set([process.stdin, process.stdout, process.stderr]);
  const baselineHandles = process._getActiveHandles().filter((handle) => !ignoredHandles.has(handle));
  const baselineRequests = process._getActiveRequests();
  const container = document.createElement('div');
  container.style.width = '1280px';
  container.style.height = '800px';
  document.body.append(container);
  const mounted = runtime.mount(container, { locale: 'vi-VN', onBack() {}, openPackageModule() {} });
  const deadline = Date.now() + 15000;
  while (container.childElementCount === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  const rendered = container.childElementCount > 0 && Boolean(container.textContent?.trim() || container.innerHTML.trim());
  mounted?.unmount?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const cleaned = container.childElementCount === 0;
  dom.window.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const activeHandles = process._getActiveHandles().filter((handle) => !ignoredHandles.has(handle));
  const activeRequests = process._getActiveRequests();
  const introducedHandles = activeHandles
    .filter((handle) => !baselineHandles.includes(handle))
    .map((handle) => handle.constructor?.name ?? 'Unknown');
  const introducedRequests = activeRequests
    .filter((request) => !baselineRequests.includes(request))
    .map((request) => request.constructor?.name ?? 'Unknown');
  for (const handle of activeHandles) handle.unref?.();
  console.log(JSON.stringify({ rendered, cleaned, introducedHandles, introducedRequests }));
`;

const runArtifactMountSmoke = (
  modulePath: string
): Promise<{ rendered: boolean; cleaned: boolean; introducedHandles: string[]; introducedRequests: string[] }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', ARTIFACT_MOUNT_SCRIPT, modulePath], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Artifact mount process exceeded 30 seconds.'));
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Artifact mount process failed (${code}): ${stderr || stdout}`));
        return;
      }
      const resultLine = stdout.trim().split(/\r?\n/).at(-1);
      if (!resultLine) {
        reject(new Error('Artifact mount process returned no evidence.'));
        return;
      }
      resolve(
        JSON.parse(resultLine) as {
          rendered: boolean;
          cleaned: boolean;
          introducedHandles: string[];
          introducedRequests: string[];
        }
      );
    });
  });

describe('downloaded package app sandbox', () => {
  beforeEach(() => {
    packageMocks.list.mockReset();
    packageMocks.readAsset.mockReset();
    packageMocks.openRuntime.mockReset().mockResolvedValue(undefined);
    packageMocks.closeRuntime.mockReset().mockResolvedValue(undefined);
    packageMocks.activateCapability.mockReset().mockResolvedValue({
      version: 1,
      leaseId: 'lease-1',
      packageId: 'com.tomni.calculator',
      runtimeId: 'runtime-1',
      capability: 'host.runtime.info',
      expiresAt: '2026-08-13T00:01:00.000Z',
    });
    packageMocks.invokeCapability.mockReset().mockResolvedValue({
      ok: true,
      data: { abiVersion: 1, packageId: 'com.tomni.calculator' },
      receipt: { receiptId: 'receipt-1' },
    });
    packageMocks.cancelCapability.mockReset().mockResolvedValue(true);
    packageMocks.list.mockResolvedValue([createListing()]);
    packageMocks.readAsset.mockResolvedValue({
      content:
        '<!doctype html><html><body><main>Calculator runtime</main><script>window.__ready=true</script></body></html>',
      contentType: 'text/html',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('places a host-owned restrictive CSP first in the downloaded document', () => {
    const source = buildSandboxDocument('<html><head><title>App</title></head><body>Ready</body></html>');
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    const policy = parsed.head.firstElementChild as HTMLMetaElement;

    expect(policy.httpEquiv).toBe('Content-Security-Policy');
    expect(policy.content).toContain("default-src 'none'");
    expect(policy.content).toContain("connect-src 'none'");
  });

  it('removes package-controlled navigation and remote resource vectors', () => {
    const source = buildSandboxDocument(`
      <html><head><meta http-equiv='refresh' content='0;url=https://attacker.test'><base href='https://attacker.test'></head>
      <body><a href='https://attacker.test'>leave</a><img src='https://attacker.test/x.png'>
      <script src='https://attacker.test/x.js'></script><script>window.safeInline=true</script></body></html>
    `);
    const parsed = new DOMParser().parseFromString(source, 'text/html');

    expect(parsed.querySelector('meta[http-equiv="refresh"], base')).toBeNull();
    expect(parsed.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(parsed.querySelector('script[src], img[src]')).toBeNull();
    expect(parsed.scripts.item(0)?.textContent).toContain('safeInline');
  });

  it('does not read or mount sandboxed-web when the runtime opt-in is omitted', async () => {
    render(<PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} />);

    expect(await screen.findByTestId('package-app-unavailable')).toBeInTheDocument();
    expect(packageMocks.readAsset).not.toHaveBeenCalled();
    expect(screen.queryByTestId('package-app-frame')).not.toBeInTheDocument();
  });

  it('fails closed when a sandboxed entrypoint crosses the content-type boundary', async () => {
    packageMocks.readAsset.mockResolvedValue({
      content: 'export const unexpected = true;',
      contentType: 'application/javascript',
    });
    render(
      <PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} allowSandboxedWeb />
    );

    expect(await screen.findByTestId('package-app-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('package-app-frame')).not.toBeInTheDocument();
  });

  it('fails closed before reading assets when runtime tracking is unavailable', async () => {
    packageMocks.openRuntime.mockRejectedValue(new Error('PACKAGE_RUNTIME_TRACKING_UNAVAILABLE'));
    render(
      <PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} allowSandboxedWeb />
    );

    expect(await screen.findByTestId('package-app-failed')).toBeInTheDocument();
    expect(packageMocks.readAsset).not.toHaveBeenCalled();
  });

  it('registers the sandbox before reading assets and closes it when the host unmounts', async () => {
    const { unmount } = render(
      <PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} allowSandboxedWeb />
    );

    expect(await screen.findByTestId('package-app-frame')).toBeInTheDocument();
    expect(packageMocks.openRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      packageMocks.readAsset.mock.invocationCallOrder[0]!
    );
    const runtimeId = packageMocks.openRuntime.mock.calls[0]?.[1] as string;

    unmount();
    await waitFor(() => expect(packageMocks.closeRuntime).toHaveBeenCalledWith('com.tomni.calculator', runtimeId));
  });

  it('retains the runtime id and retries close after the first IPC failure', async () => {
    packageMocks.closeRuntime
      .mockRejectedValueOnce(new Error('runtime close unavailable'))
      .mockResolvedValue(undefined);
    const { unmount } = render(
      <PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} allowSandboxedWeb />
    );

    expect(await screen.findByTestId('package-app-frame')).toBeInTheDocument();
    const runtimeId = packageMocks.openRuntime.mock.calls[0]?.[1] as string;

    unmount();
    await waitFor(() => expect(packageMocks.closeRuntime).toHaveBeenCalledTimes(2));
    expect(packageMocks.closeRuntime.mock.calls).toEqual([
      ['com.tomni.calculator', runtimeId],
      ['com.tomni.calculator', runtimeId],
    ]);
  });

  it('refuses to load a package module without the explicit sandboxed-web runtime', async () => {
    const listing = createListing();
    listing.installedManifest!.modules[0] = { ...listing.installedManifest!.modules[0]!, runtime: undefined };
    packageMocks.list.mockResolvedValue([listing]);

    render(<PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} />);

    expect(await screen.findByTestId('package-app-unavailable')).toBeInTheDocument();
    expect(packageMocks.readAsset).not.toHaveBeenCalled();
  });

  it('runs trusted React modules only for signed first-party packages', () => {
    const firstParty = createListing({ trust: 'signed-first-party' });
    firstParty.manifest.modules[0] = {
      ...firstParty.manifest.modules[0]!,
      runtime: 'trusted-react',
      entrypoint: 'app.js',
    };
    firstParty.installedManifest = structuredClone(firstParty.manifest);
    firstParty.installedTrust = 'signed-first-party';
    expect(getFirstRunnablePackageModule(firstParty)?.runtime).toBe('trusted-react');

    const marketplace = createListing();
    marketplace.manifest.modules[0] = {
      ...marketplace.manifest.modules[0]!,
      runtime: 'trusted-react',
      entrypoint: 'app.js',
    };
    marketplace.installedManifest = structuredClone(marketplace.manifest);
    expect(getFirstRunnablePackageModule(marketplace)).toBeUndefined();
  });

  it('refuses trusted React when an unprivileged Store key claims the Tomni publisher', () => {
    const adversarial = createListing({ trust: 'signed-store' });
    adversarial.manifest.id = 'com.tomni.malicious';
    adversarial.manifest.publisherId = 'com.tomni';
    adversarial.manifest.modules[0] = {
      ...adversarial.manifest.modules[0]!,
      runtime: 'trusted-react',
      entrypoint: 'app.js',
    };
    adversarial.installedManifest = structuredClone(adversarial.manifest);
    adversarial.installedTrust = 'signed-store';

    expect(getFirstRunnablePackageModule(adversarial)).toBeUndefined();
  });

  it('refuses an installed Store artifact when the newer catalog entry is first-party', async () => {
    const listing = createTrustedReactListing();
    listing.installedTrust = 'signed-store';
    listing.installedManifest = { ...listing.installedManifest!, publisherId: 'com.example.publisher' };
    packageMocks.list.mockResolvedValue([listing]);

    render(<PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} />);

    expect(await screen.findByTestId('package-app-unavailable')).toBeInTheDocument();
    expect(packageMocks.readAsset).not.toHaveBeenCalled();
  });

  it('never runs a catalog module when the installed record lacks its manifest or trust', async () => {
    const listing = createListing();
    delete listing.installedManifest;
    delete listing.installedTrust;
    listing.manifest = {
      ...listing.manifest,
      publisherId: 'com.tomni',
      modules: [{ ...listing.manifest.modules[0]!, runtime: 'sandboxed-web', entrypoint: 'catalog.html' }],
    };
    packageMocks.list.mockResolvedValue([listing]);

    expect(getFirstRunnablePackageModule(listing)).toBeUndefined();
    render(
      <PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} allowSandboxedWeb />
    );

    expect(await screen.findByTestId('package-app-unavailable')).toBeInTheDocument();
    expect(packageMocks.readAsset).not.toHaveBeenCalled();
  });

  it('imports, mounts and unmounts the installed Document and Design artifact ESM', async () => {
    const packageIds = ['com.tomni.document-studio', 'com.tomni.design-studio'] as const;
    const artifacts = new Map<string, Buffer>(
      await Promise.all(
        packageIds.map(
          async (packageId) =>
            [
              '/' + packageId + '-1.0.0.tomni-package.json',
              await readFile(path.resolve('store-artifacts', packageId + '-1.0.0.tomni-package.json')),
            ] as const
        )
      )
    );
    const server = createServer((request, response) => {
      const artifact = artifacts.get(request.url ?? '');
      if (!artifact) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'content-length': String(artifact.byteLength),
        'content-type': 'application/vnd.tomni.package+json',
      });
      response.end(artifact);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Artifact server did not start.');
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomny-package-mount-'));
    const catalog = FIRST_PARTY_PACKAGE_CATALOG.filter((entry) =>
      packageIds.includes(entry.manifest.id as (typeof packageIds)[number])
    ).map((entry) => ({
      ...entry,
      artifactUrl: 'http://127.0.0.1:' + address.port + '/' + entry.manifest.id + '-1.0.0.tomni-package.json',
    }));
    const service = createPackageManagerService({
      rootDir,
      appVersion: '1.2.0',
      catalog,
      trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
      allowLocalArtifactUrls: true,
    });
    await service.initialize();
    try {
      for (const packageId of packageIds) {
        await service.install(packageId);
        const asset = await service.readAsset(packageId, 'app.js');
        const modulePath = path.join(rootDir, packageId + '.mjs');
        await writeFile(modulePath, asset.content);
        const evidence = await runArtifactMountSmoke(modulePath);
        expect(evidence).toEqual({ rendered: true, cleaned: true, introducedHandles: [], introducedRequests: [] });
        await service.uninstall(packageId);
        await expect(service.readAsset(packageId, 'app.js')).rejects.toThrow(/not installed/i);
        await expect(access(path.join(rootDir, 'packages', packageId))).rejects.toMatchObject({ code: 'ENOENT' });
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('fails closed when the installed package asset cannot be read', async () => {
    packageMocks.list.mockResolvedValue([createTrustedReactListing()]);
    packageMocks.readAsset.mockRejectedValue(new Error('missing payload'));

    render(<PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} />);

    expect(await screen.findByTestId('package-app-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('package-app-frame')).not.toBeInTheDocument();
  });

  it('brokers the pilot capability only from the mounted sandbox frame and cancels its lease', async () => {
    render(
      <PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} allowSandboxedWeb />
    );
    const frame = (await screen.findByTestId('package-app-frame')) as HTMLIFrameElement;
    const runtimeId = packageMocks.openRuntime.mock.calls[0]?.[1] as string;
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage');

    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        data: { type: 'tomni.capability.invoke', requestId: 'request-1', capability: 'host.runtime.info' },
      })
    );

    await waitFor(() =>
      expect(packageMocks.activateCapability).toHaveBeenCalledWith({
        version: 1,
        packageId: 'com.tomni.calculator',
        runtimeId,
        capability: 'host.runtime.info',
      })
    );
    expect(packageMocks.invokeCapability).toHaveBeenCalledWith({
      version: 1,
      leaseId: 'lease-1',
      packageId: 'com.tomni.calculator',
      runtimeId,
      name: 'host.runtime.info',
    });
    await waitFor(() => expect(packageMocks.cancelCapability).toHaveBeenCalled());
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tomni.capability.result',
        requestId: 'request-1',
        result: { ok: true, data: expect.any(Object), receipt: expect.any(Object) },
      }),
      '*'
    );
  });

  it('ignores capability messages not sent by the mounted sandbox frame', async () => {
    render(
      <PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} allowSandboxedWeb />
    );
    await screen.findByTestId('package-app-frame');
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: { type: 'tomni.capability.invoke', requestId: 'request-1', capability: 'host.runtime.info' },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(packageMocks.activateCapability).not.toHaveBeenCalled();
  });

  it('removes a running trusted host after another tab uninstalls the package', async () => {
    packageMocks.readAsset.mockResolvedValue({
      content: 'export const mount = () => undefined;',
      contentType: 'application/javascript',
    });
    packageMocks.list.mockResolvedValueOnce([createTrustedReactListing()]).mockResolvedValue([]);
    render(<PackageAppHost packageId='com.tomni.calculator' moduleId='calculator' onBack={vi.fn()} />);
    expect(await screen.findByTestId('package-app-host')).toBeInTheDocument();

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(screen.getByTestId('package-app-unavailable')).toBeInTheDocument());
    expect(screen.queryByTestId('package-app-host')).not.toBeInTheDocument();
  });

  it('does not expose a generic app route for bundled legacy packages', () => {
    const legacy = createListing({ delivery: 'bundled-legacy' });

    expect(getFirstRunnablePackageModule(legacy)).toBeUndefined();
    expect(getFirstRunnablePackageModule(createListing())?.id).toBe('calculator');
  });
});
