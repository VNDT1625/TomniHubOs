/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  PackageAsset,
  PackageListing,
  PackageManifest,
  PackageModelInvokeArgs,
  PackageModuleContribution,
  PackageNotificationPost,
} from '@/common/packages';
import type {
  PackageSurfaceAiRuntimePortBindingClaim,
  PackageSurfaceAiRuntimePortHandoff,
} from '@/common/types/platform/electron';
import { Button, Card, Tag } from '@arco-design/web-react';
import { Shield } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './HubWorkspacePage.module.css';
import { packageClient } from './packageClient';
import { onPackageSessionAction } from './packageSessionActions';

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
const PACKAGE_CAPABILITY_CANCEL_MESSAGE = 'tomni.capability.cancel';
const PACKAGE_CAPABILITY_RESULT_MESSAGE = 'tomni.capability.result';
const PACKAGE_SURFACE_AI_PORT_MESSAGE = 'tomni.surface-ai.port';
const PACKAGE_SESSION_FOCUS_MESSAGE = 'tomni.sessions.focus';
const PACKAGE_SESSION_CREATE_MESSAGE = 'tomni.sessions.create';
const PACKAGE_SESSION_CLOSE_MESSAGE = 'tomni.sessions.close';

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

export const getRunnablePackageModules = (listing: PackageListing): readonly RunnablePackageModule[] => {
    if (listing.delivery === 'bundled-legacy' || listing.state !== 'installed' || !listing.enabled ||
    !listing.compatible || listing.revoked || listing.installedTrust === 'unsigned-revoked') return [];
  const manifest = getInstalledPackageManifest(listing);
  if (!manifest) return [];
  return manifest.modules.filter(
    (module): module is RunnablePackageModule =>
      isInstalledSandboxedWebModule(listing, module) || isTrustedReactModule(listing, module)
  );
};

export const getFirstRunnablePackageModule = (listing: PackageListing): RunnablePackageModule | undefined =>
  getRunnablePackageModules(listing)[0];

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
  /** A session id the sidebar asked the package to bring forward; delivered to a sandboxed package as a message. */
  focusSession?: string;
  /** Changes on every request, so asking for the same session twice delivers the message twice. */
  focusNonce?: string;
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

type SandboxCapabilityInvokeMessage =
  | {
      type: typeof PACKAGE_CAPABILITY_INVOKE_MESSAGE;
      requestId: string;
      capability: 'host.runtime.info' | 'notifications.post' | 'sessions.report';
      /** `notifications.post` and `sessions.report` only; Main validates and bounds it. */
      args?: unknown;
    }
  | {
      type: typeof PACKAGE_CAPABILITY_INVOKE_MESSAGE;
      requestId: string;
      capability: 'model.invoke';
      args: PackageModelInvokeArgs;
    };

type SandboxCapabilityCancelMessage = {
  type: typeof PACKAGE_CAPABILITY_CANCEL_MESSAGE;
  requestId: string;
};

const isSandboxCapabilityInvokeMessage = (value: unknown): value is SandboxCapabilityInvokeMessage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (
    message.type !== PACKAGE_CAPABILITY_INVOKE_MESSAGE ||
    typeof message.requestId !== 'string' ||
    message.requestId.length === 0 ||
    message.requestId.length > 128
  ) {
    return false;
  }
  if (
    message.capability === 'host.runtime.info' ||
    message.capability === 'notifications.post' ||
    message.capability === 'sessions.report'
  ) {
    return true;
  }
  if (message.capability === 'model.invoke') {
    if (!message.args || typeof message.args !== 'object' || Array.isArray(message.args)) return false;
    const args = message.args as Record<string, unknown>;
    return (
      args.contract === 'ai-challenge.turn.v1' &&
      typeof args.prompt === 'string' &&
      args.prompt.trim().length > 0 &&
      args.prompt.length <= 16_384 &&
      (args.systemPrompt === undefined ||
        (typeof args.systemPrompt === 'string' && args.systemPrompt.length <= 4_096)) &&
      (args.temperature === undefined ||
        (typeof args.temperature === 'number' && !Number.isNaN(args.temperature))) &&
      (args.maxTokens === undefined ||
        (typeof args.maxTokens === 'number' && !Number.isNaN(args.maxTokens)))
    );
  }
  return false;
};

const isSandboxCapabilityCancelMessage = (value: unknown): value is SandboxCapabilityCancelMessage => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === PACKAGE_CAPABILITY_CANCEL_MESSAGE &&
    typeof message.requestId === 'string' &&
    message.requestId.length > 0 &&
    message.requestId.length <= 128
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
  focusSession,
  focusNonce,
}) => {
  const { t, i18n } = useTranslation();
  const [hostState, setHostState] = useState<PackageAppHostState>({ status: 'loading' });
  const sandboxFrameRef = useRef<HTMLIFrameElement>(null);
  const activeSandboxRuntimeRef = useRef<ActiveSandboxRuntime | undefined>(undefined);
  const pendingSurfaceAiPortHandoffRef = useRef<PendingSurfaceAiPortHandoff | undefined>(undefined);
  const pendingModelInvocationRef = useRef<{ requestId: string; runtimeId: string } | undefined>(undefined);
  const iframeLoadHandlerRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let disposed = false;
    let syncing = false;
    let loadedRuntimeKey = '';
    const closeSandboxRuntime = async (): Promise<void> => {
      const runtime = activeSandboxRuntimeRef.current;
      if (pendingModelInvocationRef.current) {
        const pending = pendingModelInvocationRef.current;
        pendingModelInvocationRef.current = undefined;
        void packageClient
          .cancelModel({
            packageId,
            runtimeId: pending.runtimeId,
            requestId: pending.requestId,
          })
          .catch((): undefined => undefined);
      }
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
          !listing.compatible || listing.revoked || listing.installedTrust === 'unsigned-revoked' ||
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
      if (!frame?.contentWindow || event.source !== frame.contentWindow) return;

      if (isSandboxCapabilityCancelMessage(event.data)) {
        if (pendingModelInvocationRef.current?.requestId === event.data.requestId) {
          const pending = pendingModelInvocationRef.current;
          pendingModelInvocationRef.current = undefined;
          void packageClient
            .cancelModel({
              packageId,
              runtimeId: pending.runtimeId,
              requestId: pending.requestId,
            })
            .catch((): undefined => undefined);
        }
        return;
      }

      if (!isSandboxCapabilityInvokeMessage(event.data)) return;

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

      if (event.data.capability === 'model.invoke') {
        if (pendingModelInvocationRef.current) {
          frame.contentWindow.postMessage(
            {
              type: PACKAGE_CAPABILITY_RESULT_MESSAGE,
              requestId: event.data.requestId,
              result: { ok: false, code: 'PACKAGE_CAPABILITY_MODEL_BUSY' },
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
            capability: 'model.invoke',
          });
          pendingModelInvocationRef.current = { requestId: event.data.requestId, runtimeId };
          try {
            const modelArgs = event.data.args;
            const result = await packageClient.invokeModel({
              version: 1,
              leaseId: lease.leaseId,
              packageId,
              runtimeId,
              requestId: event.data.requestId,
              contract: 'ai-challenge.turn.v1',
              prompt: modelArgs.prompt,
              systemPrompt: modelArgs.systemPrompt,
              temperature: modelArgs.temperature,
              maxTokens: modelArgs.maxTokens,
            });
            if (!disposed && sandboxFrameRef.current?.contentWindow === event.source) {
              sandboxFrameRef.current.contentWindow.postMessage(
                { type: PACKAGE_CAPABILITY_RESULT_MESSAGE, requestId: event.data.requestId, result },
                '*'
              );
            }
          } finally {
            if (pendingModelInvocationRef.current?.requestId === event.data.requestId) {
              pendingModelInvocationRef.current = undefined;
            }
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
            name: event.data.capability,
            ...((event.data.capability === 'notifications.post' || event.data.capability === 'sessions.report') &&
            event.data.args &&
            typeof event.data.args === 'object'
              ? { args: event.data.args as PackageNotificationPost }
              : {}),
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

  const ready = hostState.status === 'ready';
  const focusSessionRef = useRef(focusSession);
  focusSessionRef.current = focusSession;
  const deliverFocus = useCallback((): void => {
    const sessionId = focusSessionRef.current;
    if (!sessionId) return;
    try {
      sandboxFrameRef.current?.contentWindow?.postMessage({ type: PACKAGE_SESSION_FOCUS_MESSAGE, sessionId }, '*');
    } catch {
      // A package that cannot receive the focus request simply stays where it is.
    }
  }, []);
  useEffect(() => {
    if (ready) deliverFocus();
  }, [deliverFocus, focusNonce, focusSession, ready]);

  useEffect(() => {
    if (!ready) return undefined;
    return onPackageSessionAction((action) => {
      if (action.packageId !== packageId) return;
      const message =
        action.kind === 'create'
          ? { type: PACKAGE_SESSION_CREATE_MESSAGE }
          : { type: PACKAGE_SESSION_CLOSE_MESSAGE, sessionId: action.sessionId };
      try {
        sandboxFrameRef.current?.contentWindow?.postMessage(message, '*');
      } catch {
        // A package that cannot receive the request simply ignores it.
      }
    });
  }, [packageId, ready]);

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
              {t('common.back')}
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
            onLoad={() => {
              iframeLoadHandlerRef.current();
              // The first message can arrive before the package script runs; the document is listening once it has loaded.
              deliverFocus();
            }}
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
