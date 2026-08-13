/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PackageAsset, PackageListing, PackageManifest, PackageModuleContribution } from '@/common/packages';
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

type PackageAppMountOptions = {
  locale: string;
  onBack: () => void;
  openPackageModule: (packageId: string, moduleId: string) => void;
};

type PackageAppUnmountResult = void | (() => void) | { unmount: () => void };

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
            window.location.hash = `/store/app/${encodeURIComponent(packageId)}/${encodeURIComponent(moduleId)}`;
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

  useEffect(() => {
    let disposed = false;
    let syncing = false;
    let loadedRuntimeKey = '';
    let activeSandboxRuntimeId: string | undefined;

    const closeSandboxRuntime = async (): Promise<void> => {
      const runtimeId = activeSandboxRuntimeId;
      if (!runtimeId) return;
      try {
        await packageClient.closeRuntime(packageId, runtimeId);
      } catch {
        await packageClient.closeRuntime(packageId, runtimeId);
      }
      if (activeSandboxRuntimeId === runtimeId) activeSandboxRuntimeId = undefined;
    };

    const ensureSandboxRuntimeOpen = async (): Promise<boolean> => {
      if (activeSandboxRuntimeId) return true;
      const runtimeId = globalThis.crypto.randomUUID();
      await packageClient.openRuntime(packageId, runtimeId);
      activeSandboxRuntimeId = runtimeId;
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
          if (activeSandboxRuntimeId) await packageClient.openRuntime(packageId, activeSandboxRuntimeId);
          else if (!(await ensureSandboxRuntimeOpen())) return;
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

    void synchronize();
    const interval = window.setInterval((): void => {
      void synchronize();
    }, PACKAGE_APP_SYNC_INTERVAL_MS);
    window.addEventListener('focus', synchronizeWhenVisible);
    document.addEventListener('visibilitychange', synchronizeWhenVisible);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', synchronizeWhenVisible);
      document.removeEventListener('visibilitychange', synchronizeWhenVisible);
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
