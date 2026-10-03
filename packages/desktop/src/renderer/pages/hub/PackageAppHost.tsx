/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PackageAsset, PackageListing, PackageManifest, PackageModuleContribution } from '@/common/packages';
import type {
  PackageSurfaceAiRuntimePortBindingClaim,
  PackageSurfaceAiRuntimePortHandoff,
} from '@/common/types/platform/electron';
import { Button, Card, Tag } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './HubWorkspacePage.module.css';
import { packageClient } from './packageClient';

const PACKAGE_APP_SYNC_INTERVAL_MS = 1_500;
const PACKAGE_APP_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "child-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'",
].join('; ');
const IFRAME_PERMISSIONS = [
  "accelerometer 'none'",
  "camera 'none'",
  "clipboard-read 'none'",
  "clipboard-write 'none'",
  "display-capture 'none'",
  "geolocation 'none'",
  "gyroscope 'none'",
  "microphone 'none'",
  "payment 'none'",
  "usb 'none'",
].join('; ');
const PACKAGE_CAPABILITY_INVOKE_MESSAGE = 'tomni.capability.invoke';
const PACKAGE_CAPABILITY_RESULT_MESSAGE = 'tomni.capability.result';
const PACKAGE_SURFACE_AI_PORT_MESSAGE = 'tomni.surface-ai.port';

type SandboxedWebModule = PackageModuleContribution & {
  runtime: 'sandboxed-web';
  entrypoint: string;
};

type TrustedReactModule = PackageModuleContribution & {
  runtime: 'trusted-react';
  entrypoint: string;
};

type RunnablePackageModule = SandboxedWebModule | TrustedReactModule;

const hasExpectedRuntimeAssetTypes = (
  module: RunnablePackageModule,
  asset: PackageAsset,
  styleAsset: PackageAsset | undefined
): boolean =>
  asset.contentType === (module.runtime === 'sandboxed-web' ? 'text/html' : 'application/javascript') &&
  (styleAsset === undefined || styleAsset.contentType === 'text/css');

const isSandboxedWebModule = (module: PackageModuleContribution | undefined): module is SandboxedWebModule =>
  module?.runtime === 'sandboxed-web' &&
  typeof module.entrypoint === 'string' &&
  module.entrypoint.toLocaleLowerCase().endsWith('.html');

const isInstalledSandboxedWebModule = (
  listing: PackageListing,
  module: PackageModuleContribution | undefined
): module is SandboxedWebModule => listing.installedTrust !== undefined && isSandboxedWebModule(module);

const isTrustedReactModule = (
  listing: PackageListing,
  module: PackageModuleContribution | undefined
): module is TrustedReactModule =>
  listing.installedTrust === 'signed-first-party' &&
  listing.installedManifest?.publisherId === 'com.tomni' &&
  module?.runtime === 'trusted-react' &&
  typeof module.entrypoint === 'string' &&
  module.entrypoint.toLocaleLowerCase().endsWith('.js');

export const getInstalledPackageManifest = (listing: PackageListing): PackageManifest | undefined =>
  listing.state === 'installed' ? listing.installedManifest : undefined;

export const getFirstRunnablePackageModule = (listing: PackageListing): RunnablePackageModule | undefined => {
  if (listing.delivery === 'bundled-legacy' || listing.state !== 'installed' || !listing.enabled) return undefined;
  const manifest = getInstalledPackageManifest(listing);
  if (!manifest) return undefined;
  return manifest.modules.find(
    (module): module is RunnablePackageModule =>
      isInstalledSandboxedWebModule(listing, module) || isTrustedReactModule(listing, module)
  );
};

/**
 * Rebuild untrusted package HTML with a host-owned CSP as the first head element.
 * URL-bearing resource attributes are removed as defense in depth before the
 * iframe's opaque-origin sandbox and CSP are applied.
 */
export const buildSandboxDocument = (untrustedHtml: string): string => {
  const parsed = new DOMParser().parseFromString(untrustedHtml, 'text/html');
  parsed.querySelectorAll('meta[http-equiv]').forEach((element) => element.remove());
  parsed
    .querySelectorAll('base, link, object, embed, frame, frameset, iframe, script[src]')
    .forEach((element) => element.remove());

  parsed.querySelectorAll<HTMLElement>('*').forEach((element) => {
    for (const attribute of [
      'action',
      'background',
      'cite',
      'data',
      'formaction',
      'manifest',
      'poster',
      'src',
      'srcset',
    ]) {
      element.removeAttribute(attribute);
    }
    const href = element.getAttribute('href');
    if (href && !href.startsWith('#')) element.removeAttribute('href');
  });

  const policy = parsed.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = PACKAGE_APP_CSP;
  parsed.head.prepend(policy);
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
};

type PackageAppHostProps = {
  packageId: string;
  moduleId: string;
  onBack: () => void;
  allowSandboxedWeb?: boolean;
};

type ReadyPackageHostState = {
  status: 'ready';
  listing: PackageListing;
  manifest: PackageManifest;
  module: RunnablePackageModule;
  sourceContent: string;
  styleContent?: string;
};

type PackageAppHostState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed' }
  | ReadyPackageHostState;

type ActiveSandboxRuntime = {
  runtimeId: string;
  packageVersion: string;
  publisherId: string;
  moduleId: string;
  artifactIntegrity?: string;
};

type PendingSurfaceAiPortHandoff = {
  requestId: string;
  claim: PackageSurfaceAiRuntimePortBindingClaim;
  delivered: boolean;
};

type PackageAppMountOptions = {
  locale: string;
  onBack: () => void;
  openPackageModule: (packageId: string, moduleId: string) => void;
  openDefaultSurface: (surface: 'ide') => void;
};

type PackageAppUnmountResult = void | (() => void) | { unmount: () => void };

type SandboxCapabilityInvokeMessage = {
  type: typeof PACKAGE_CAPABILITY_INVOKE_MESSAGE;
  requestId: string;
  capability: 'host.runtime.info';
};

const isSandboxCapabilityInvokeMessage = (value: unknown): value is SandboxCapabilityInvokeMessage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === PACKAGE_CAPABILITY_INVOKE_MESSAGE &&
    typeof message.requestId === 'string' &&
    message.requestId.length > 0 &&
    message.requestId.length <= 128 &&
    message.capability === 'host.runtime.info'
  );
};

type TrustedPackageRuntime = {
  mount: (container: HTMLElement, options: PackageAppMountOptions) => PackageAppUnmountResult;
};

const disposeMountedPackage = (result: PackageAppUnmountResult): void => {
  if (typeof result === 'function') {
    result();
  } else if (result && typeof result === 'object') {
    result.unmount();
  }
};

const TrustedPackageModuleHost: React.FC<{
  sourceContent: string;
  styleContent?: string;
  locale: string;
  onBack: () => void;
}> = ({ sourceContent, styleContent, locale, onBack }) => {
  const { t } = useTranslation();
  const mountRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return undefined;
    let disposed = false;
    let mounted: PackageAppUnmountResult;
    const styleElement = styleContent ? document.createElement('style') : undefined;
    if (styleElement && styleContent) {
      styleElement.dataset.tomniPackageStyle = 'true';
      styleElement.textContent = styleContent;
      document.head.append(styleElement);
    }
    const moduleUrl = URL.createObjectURL(new Blob([sourceContent], { type: 'application/javascript' }));

    void import(/* @vite-ignore */ moduleUrl)
      .then((loaded: unknown) => {
        if (disposed) return;
        const runtime = loaded as Partial<TrustedPackageRuntime>;
        if (typeof runtime.mount !== 'function') throw new Error('Package does not export mount().');
        mounted = runtime.mount(container, {
          locale,
          onBack,
          openPackageModule: (packageId, moduleId) => {
            window.location.hash = `/apps/${encodeURIComponent(packageId)}/${encodeURIComponent(moduleId)}`;
          },
          openDefaultSurface: (surface) => {
            window.location.hash = `/${surface}`;
          },
        });
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      disposeMountedPackage(mounted);
      URL.revokeObjectURL(moduleUrl);
      styleElement?.remove();
    };
  }, [locale, onBack, sourceContent, styleContent]);

  if (failed) return <div className={styles.storeError}>{t('common.error')}</div>;
  return <div ref={mountRef} className={styles.trustedPackageMount} data-testid='package-app-trusted' />;
};

export const PackageAppHost: React.FC<PackageAppHostProps> = ({
  packageId,
  moduleId,
  onBack,
  allowSandboxedWeb = false,
}) => {
  const { t, i18n } = useTranslation();
  const [hostState, setHostState] = useState<PackageAppHostState>({ status: 'loading' });
  const sandboxFrameRef = useRef<HTMLIFrameElement>(null);
  const activeSandboxRuntimeRef = useRef<ActiveSandboxRuntime | undefined>(undefined);
  const pendingSurfaceAiPortHandoffRef = useRef<PendingSurfaceAiPortHandoff | undefined>(undefined);
  const iframeLoadHandlerRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let disposed = false;
    let syncing = false;
    let loadedRuntimeKey = '';
    const closeSandboxRuntime = async (): Promise<void> => {
      const runtime = activeSandboxRuntimeRef.current;
      if (!runtime) return;
      try {
        await packageClient.closeRuntime(packageId, runtime.runtimeId);
      } catch {
        await packageClient.closeRuntime(packageId, runtime.runtimeId);
      }
      if (activeSandboxRuntimeRef.current === runtime) activeSandboxRuntimeRef.current = undefined;
      pendingSurfaceAiPortHandoffRef.current = undefined;
    };

    const ensureSandboxRuntimeOpen = async (
      manifest: PackageManifest,
      module: SandboxedWebModule
    ): Promise<boolean> => {
      const surface = {
        packageVersion: manifest.version,
        publisherId: manifest.publisherId,
        moduleId: module.id,
      };
      if (
        activeSandboxRuntimeRef.current &&
        activeSandboxRuntimeRef.current.packageVersion === surface.packageVersion &&
        activeSandboxRuntimeRef.current.publisherId === surface.publisherId &&
        activeSandboxRuntimeRef.current.moduleId === surface.moduleId
      ) {
        return true;
      }
      await closeSandboxRuntime();
      const runtimeId = globalThis.crypto.randomUUID();
      const runtime: ActiveSandboxRuntime = {
        runtimeId,
        ...surface,
        ...(manifest.artifact ? { artifactIntegrity: manifest.artifact.integrity } : {}),
      };
      await packageClient.openRuntime(packageId, runtimeId, surface);
      activeSandboxRuntimeRef.current = runtime;
      if (disposed) {
        await closeSandboxRuntime();
        return false;
      }
      return true;
    };

    const synchronize = async (): Promise<void> => {
      if (syncing) return;
      syncing = true;
      try {
        const items = await packageClient.list({ installedOnly: true });
        if (disposed) return;
        const listing = items.find((item) => item.installedManifest?.id === packageId);
        const installedManifest = listing ? getInstalledPackageManifest(listing) : undefined;
        const module = installedManifest?.modules.find((candidate) => candidate.id === moduleId);
        if (
          !listing ||
          listing.delivery === 'bundled-legacy' ||
          listing.state !== 'installed' ||
          !listing.enabled ||
          (!(allowSandboxedWeb && isInstalledSandboxedWebModule(listing, module)) &&
            !isTrustedReactModule(listing, module))
        ) {
          await closeSandboxRuntime();
          loadedRuntimeKey = '';
          setHostState({ status: 'unavailable' });
          return;
        }

        if (isSandboxedWebModule(module)) {
          if (!(await ensureSandboxRuntimeOpen(installedManifest, module))) return;
        } else {
          await closeSandboxRuntime();
        }

        const runtimeKey = `${installedManifest.id}@${listing.installedVersion ?? installedManifest.version}:${module.entrypoint}`;
        if (runtimeKey === loadedRuntimeKey) return;

        const [asset, styleAsset] = await Promise.all([
          packageClient.readAsset(packageId, module.entrypoint),
          module.runtime === 'trusted-react' && module.styleEntrypoint
            ? packageClient.readAsset(packageId, module.styleEntrypoint)
            : Promise.resolve(undefined),
        ]);
        if (disposed) return;
        if (!hasExpectedRuntimeAssetTypes(module, asset, styleAsset)) {
          throw new Error('Package runtime asset content type is invalid.');
        }
        loadedRuntimeKey = runtimeKey;
        setHostState({
          status: 'ready',
          listing,
          manifest: installedManifest,
          module,
          sourceContent: isSandboxedWebModule(module) ? buildSandboxDocument(asset.content) : asset.content,
          ...(styleAsset ? { styleContent: styleAsset.content } : {}),
        });
      } catch {
        await closeSandboxRuntime().catch((): undefined => undefined);
        if (!disposed) {
          loadedRuntimeKey = '';
          setHostState({ status: 'failed' });
        }
      } finally {
        syncing = false;
      }
    };

    const synchronizeWhenVisible = (): void => {
      if (document.visibilityState === 'visible') void synchronize();
    };

    const invokeSandboxCapability = async (event: MessageEvent<unknown>): Promise<void> => {
      const frame = sandboxFrameRef.current;
      if (
        !frame?.contentWindow ||
        event.source !== frame.contentWindow ||
        !isSandboxCapabilityInvokeMessage(event.data)
      )
        return;
      const runtimeId = activeSandboxRuntimeRef.current?.runtimeId;
      if (!runtimeId) {
        frame.contentWindow.postMessage(
          {
            type: PACKAGE_CAPABILITY_RESULT_MESSAGE,
            requestId: event.data.requestId,
            result: { ok: false, code: 'PACKAGE_CAPABILITY_RUNTIME_UNAVAILABLE' },
          },
          '*'
        );
        return;
      }
      try {
        const lease = await packageClient.activateCapability({
          version: 1,
          packageId,
          runtimeId,
          capability: event.data.capability,
        });
        try {
          const result = await packageClient.invokeCapability({
            version: 1,
            leaseId: lease.leaseId,
            packageId,
            runtimeId,
            name: 'host.runtime.info',
          });
          if (!disposed && sandboxFrameRef.current?.contentWindow === event.source) {
            sandboxFrameRef.current.contentWindow.postMessage(
              { type: PACKAGE_CAPABILITY_RESULT_MESSAGE, requestId: event.data.requestId, result },
              '*'
            );
          }
        } finally {
          await packageClient
            .cancelCapability({ leaseId: lease.leaseId, packageId, runtimeId })
            .catch((): undefined => undefined);
        }
      } catch {
        if (!disposed && sandboxFrameRef.current?.contentWindow === event.source) {
          sandboxFrameRef.current.contentWindow.postMessage(
            {
              type: PACKAGE_CAPABILITY_RESULT_MESSAGE,
              requestId: event.data.requestId,
              result: { ok: false, code: 'PACKAGE_CAPABILITY_SYSCALL_DENIED' },
            },
            '*'
          );
        }
      }
    };

    const acceptSurfaceAiPortHandoff = (handoff: PackageSurfaceAiRuntimePortHandoff): boolean => {
      const frame = sandboxFrameRef.current;
      const runtime = activeSandboxRuntimeRef.current;
      const pending = pendingSurfaceAiPortHandoffRef.current;
      if (
        disposed ||
        !frame?.contentWindow ||
        !runtime ||
        !pending ||
        pending.delivered ||
        handoff.requestId !== pending.requestId ||
        handoff.binding.surface.packageId !== pending.claim.packageId ||
        handoff.binding.surface.packageVersion !== pending.claim.packageVersion ||
        handoff.binding.surface.publisherId !== pending.claim.publisherId ||
        handoff.binding.runtimeId !== pending.claim.runtimeId ||
        handoff.binding.moduleId !== pending.claim.moduleId ||
        handoff.binding.artifactIntegrity !== pending.claim.artifactIntegrity ||
        handoff.binding.runtimeId !== runtime.runtimeId
      ) {
        return false;
      }
      try {
        frame.contentWindow.postMessage(
          {
            type: PACKAGE_SURFACE_AI_PORT_MESSAGE,
            schemaVersion: 1,
            requestId: handoff.requestId,
            connectionId: handoff.connectionId,
            binding: handoff.binding,
          },
          '*',
          [handoff.port]
        );
        pending.delivered = true;
        return true;
      } catch {
        return false;
      }
    };

    const removeSurfaceAiPortHandoff =
      window.electronAPI?.packageSurfaceAiRuntime?.onPortHandoff(acceptSurfaceAiPortHandoff);
    iframeLoadHandlerRef.current = (): void => {
      const frame = sandboxFrameRef.current;
      const runtime = activeSandboxRuntimeRef.current;
      const api = window.electronAPI?.packageSurfaceAiRuntime;
      if (!frame?.contentWindow || !runtime || !api || !runtime.artifactIntegrity) return;

      const existing = pendingSurfaceAiPortHandoffRef.current;
      if (existing?.delivered) {
        // A sandbox document reload invalidates its transferred port. Close the
        // Main runtime binding rather than ever handing the same authority to it.
        void closeSandboxRuntime().catch((): undefined => undefined);
        setHostState({ status: 'failed' });
        return;
      }
      if (existing) return;

      const requestId = globalThis.crypto.randomUUID();
      const claim: PackageSurfaceAiRuntimePortBindingClaim = {
        packageId,
        packageVersion: runtime.packageVersion,
        publisherId: runtime.publisherId,
        runtimeId: runtime.runtimeId,
        moduleId: runtime.moduleId,
        artifactIntegrity: runtime.artifactIntegrity,
      };
      const pending: PendingSurfaceAiPortHandoff = { requestId, claim, delivered: false };
      pendingSurfaceAiPortHandoffRef.current = pending;
      void api.requestPortHandoff({ requestId, binding: claim }).catch((): undefined => {
        if (pendingSurfaceAiPortHandoffRef.current === pending) pendingSurfaceAiPortHandoffRef.current = undefined;
        return undefined;
      });
    };

    void synchronize();
    const interval = window.setInterval((): void => {
      void synchronize();
    }, PACKAGE_APP_SYNC_INTERVAL_MS);
    window.addEventListener('focus', synchronizeWhenVisible);
    document.addEventListener('visibilitychange', synchronizeWhenVisible);
    window.addEventListener('message', invokeSandboxCapability);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', synchronizeWhenVisible);
      document.removeEventListener('visibilitychange', synchronizeWhenVisible);
      window.removeEventListener('message', invokeSandboxCapability);
      removeSurfaceAiPortHandoff?.();
      iframeLoadHandlerRef.current = (): void => undefined;
      void closeSandboxRuntime().catch((): undefined => undefined);
    };
  }, [allowSandboxedWeb, moduleId, packageId]);

  if (hostState.status !== 'ready') {
    const messageKey =
      hostState.status === 'loading'
        ? 'common.loading'
        : hostState.status === 'unavailable'
          ? 'common.failed'
          : 'common.error';
    return (
      <div className={styles.emptyState} data-testid={`package-app-${hostState.status}`}>
        <div className={styles.storeError}>
          <span>{t(messageKey)}</span>
          {hostState.status !== 'loading' && (
            <Button type='primary' onClick={onBack}>
              {t('guid.hubHome.shell.store')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className={styles.packageApp} bordered data-testid='package-app-host'>
      <div className={styles.packageAppHeading}>
        <div className={styles.packageAppIdentity}>
          <Tag color='arcoblue'>{hostState.manifest.publisherId}</Tag>
          <h2>{hostState.module.title}</h2>
          <p>{hostState.manifest.description}</p>
          <span className={styles.packageSandboxBadge}>
            <Shield theme='outline' size={14} fill='currentColor' />
            {t('common.system')}
          </span>
        </div>
        <Button type='secondary' onClick={onBack}>
          {t('common.historyBack')}
        </Button>
      </div>
      <div className={styles.packageFrameShell}>
        {hostState.module.runtime === 'sandboxed-web' ? (
          <iframe
            className={styles.packageFrame}
            data-testid='package-app-frame'
            title={hostState.module.title}
            sandbox='allow-scripts'
            allow={IFRAME_PERMISSIONS}
            referrerPolicy='no-referrer'
            ref={sandboxFrameRef}
            onLoad={() => iframeLoadHandlerRef.current()}
            srcDoc={hostState.sourceContent}
          />
        ) : (
          <TrustedPackageModuleHost
            sourceContent={hostState.sourceContent}
            styleContent={hostState.styleContent}
            locale={i18n.resolvedLanguage ?? i18n.language}
            onBack={onBack}
          />
        )}
      </div>
    </Card>
  );
};
