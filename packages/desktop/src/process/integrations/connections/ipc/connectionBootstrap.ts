/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, dialog, ipcMain, net, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { JsonlDurableEventStore } from '@process/services/agentChat/durability';
import i18n, { i18nReady } from '@process/services/i18n';
import type { ConnectionRegistry } from '@process/integrations/connections/core/registry';
import type { ConnectionRuntime } from '@process/integrations/connections/wiring/connectionRuntime';
import type { ApprovalSubject } from '@process/integrations/connections/core/types';
import { registerCoreWorkspacePackageCliPort } from '@process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';
import {
  collectOwnSecretValues,
  createCorePackageCliPort,
  createPackageCliService,
} from '@process/integrations/connections/cli/packageCliService';
import { getPackageSecretPort } from '@process/resources/packageSecrets/packageSecretPort';
import { registerPackageConnectionsBridge } from './connectionBridge';
import { registerExtensionStripBridge } from './extensionStripBridge';
import { createExtensionStripActions } from './extensionStripActions';
import { activeBrowserTabUrl } from '@process/browser/browserBridge';
import { webOriginOf } from '@/common/integrations/extensions/siteAccess';
import {
  EXTENSION_PREFS_FILE,
  sharedExtensionUserState,
} from '@process/integrations/browserExtensions/state/userState';
import {
  defaultExtensionHostManager,
  loadedStripRecords,
} from '@process/integrations/connections/hosts/exec/extensionHost';
import { registerRepoStoreBridge } from './repoStoreBridge';
import { registerLocalKeyBridge } from './localKeyBridge';
import {
  countLocalBuiltPackages,
  revokeLocalSigningKey,
} from '@process/integrations/connections/wiring/localRevocation';
import type { ExtensionInstallDeps } from '@process/integrations/repoSources/folder';
import { registerPackageCliBridge } from './packageCliBridge';
import {
  setInstallActivationConfirm,
  type InstallActivationAnswer,
  type InstallActivationItem,
  type InstallActivationRequest,
} from '@process/integrations/connections/wiring/installActivation';
import { setPackageEnabled } from '@process/integrations/connections/wiring/packageSwitch';
import {
  createStartAgainRunner,
  setStartAgainRunner,
} from '@process/integrations/connections/wiring/startAgainApproval';
import { INSTALL_APPROVAL_CHANNELS } from '@/common/types/platform/packageConnections';
import { createInstallApprovalBroker } from './installApprovalBroker';
import { registerLauncherBridge, launchInstalledApplication } from './launcherBridge';
import { createNativeInstalledAppProbe } from '@process/integrations/runtime/installedAppProbe';
import { createLauncherBindings } from '@process/integrations/runtime/launcherBindings';

type Options = Readonly<{
  getWindow: () => BrowserWindow | null;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  registry: ConnectionRegistry;
  /** Rules (S11) and services (S17) of the connection runtime; without them those channels are not registered. */
  runtime?: Pick<ConnectionRuntime, 'rules' | 'services'>;
}>;

/**
 * The `chromeWebStoreSource` switch (D14). On by default (owner decision 2026-10-15): the Web Store source still verifies every download (CRX3 proof, allowed hosts).
 * See D14 in docs/platform/repotopackage-design.md.
 */
const CHROME_WEB_STORE_SOURCE_ENABLED = true;

/** The native dialog shows at most this much of the description; the full text stays in the approval hash. */
const MAX_DETAIL_CHARS = 1800;

/** The install dialog shows at most this much; the approval hashes cover the whole description regardless. */
const MAX_ACTIVATION_DETAIL_CHARS = 3000;

const activationDetailOf = (items: readonly InstallActivationItem[]): string => {
  const text = items
    .map((item) =>
      [
        `${item.kind}: ${item.subject.title}`,
        ...item.subject.lines.map((line) => `  ${line.label}: ${line.value}`),
      ].join('\n')
    )
    .join('\n\n');
  return text.length > MAX_ACTIVATION_DETAIL_CHARS ? `${text.slice(0, MAX_ACTIVATION_DETAIL_CHARS - 1)}…` : text;
};

const detailOf = (subject: ApprovalSubject): string => {
  const text = subject.lines.map((line) => `${line.label}: ${line.value}`).join('\n');
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS - 1)}…` : text;
};

/**
 * Wires the connection controls to the application main frame, a native confirmation and content-free receipts.
 * Only the main window's top frame may call them.
 */
/**
 * Dependencies of the extension sources (folder, .zip, .crx, Web Store). The build uses Main's own signing key and
 * output directory, exactly as `/repotopackage` does; the renderer supplies only the source it was allowed to name.
 */
const extensionInstallDeps = async (): Promise<ExtensionInstallDeps> => {
  const [{ buildTomnyPackageFromRepo }, packageBridge, { createRepoToPackageEnvironment }] = await Promise.all([
    import('@process/extensions/package-manager/repoPackaging/packager'),
    import('@process/extensions/package-manager/packageBridge'),
    import('@process/services/database/nativeConversation/repoToPackageEnvironment'),
  ]);
  const environment = createRepoToPackageEnvironment(undefined);
  return {
    build: (request) =>
      buildTomnyPackageFromRepo({
        source: request.source,
        allowLocalOutsideWorkspace: true,
        outputDirectory: environment.outputDirectory,
        signing: {
          keyDirectory: environment.keyStore.directory,
          protect: environment.keyStore.protect,
          unprotect: environment.keyStore.unprotect,
        },
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
      }),
    install: (artifactPath) => packageBridge.installLocalBuiltPackage(artifactPath, { activateConnections: true }),
    discardArtifact: (artifactPath) => rm(artifactPath, { force: true }),
  };
};

/** The display name of an installed package for the approval dialog; undefined when it is not installed. */
const packageNameOf = async (packageId: string): Promise<string | undefined> => {
  const bridge = await import('@process/extensions/package-manager/packageBridge');
  const service = bridge.getPackageManagerService();
  const listing = await service.status(packageId).catch((): undefined => undefined);
  return listing?.manifest.name;
};

/** How long the start-again question waits for the main window to load before it gives up for this app run. */
const START_AGAIN_WINDOW_WAIT_MS = 10 * 60_000;
const START_AGAIN_WINDOW_POLL_MS = 500;

/** The main window once it exists and has finished loading; undefined when that does not happen within the wait. */
const loadedMainWindow = async (getWindow: () => BrowserWindow | null): Promise<BrowserWindow | undefined> => {
  const deadline = Date.now() + START_AGAIN_WINDOW_WAIT_MS;
  while (Date.now() < deadline) {
    const window = getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isLoading()) {
      return window;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, START_AGAIN_WINDOW_POLL_MS));
  }
  return undefined;
};

export const registerDesktopPackageConnections = (options: Options): (() => void) => {
  const journal = new JsonlDurableEventStore(
    path.join(app.getPath('userData'), 'tomny-core', 'runs', 'package-connections.jsonl')
  );
  const ready = journal.initialize();
  void ready.catch((): undefined => undefined);
  let tail: Promise<unknown> = ready;

  const trusted = (event: IpcMainInvokeEvent): boolean => {
    const window = options.getWindow();
    return Boolean(
      window &&
      !window.isDestroyed() &&
      !event.sender.isDestroyed() &&
      window.webContents === event.sender &&
      event.senderFrame === event.sender.mainFrame &&
      options.verifySender(event)
    );
  };

  // CLIs and tools that are turned on: the Terminal menu (ids in, one typed-not-run line out) and the agent tool.
  const cliService = createPackageCliService({
    registry: options.registry,
    secretValues: (packageId) => collectOwnSecretValues(getPackageSecretPort(packageId)),
    record: async (run) => {
      const next = tail.then(() =>
        journal.append({
          sessionId: run.packageId,
          requestId: `package-cli:${run.outcome}`,
          kind: 'custom',
          visibility: 'private',
          payload: {
            origin: 'package-cli',
            connectionId: run.connectionId,
            outcome: run.outcome,
            ...(run.code === undefined ? {} : { code: run.code }),
            exitCode: run.exitCode ?? null,
            argumentCount: run.argumentCount,
            durationMs: run.durationMs,
            truncated: run.truncated,
          },
        })
      );
      tail = next.catch((): undefined => undefined);
      await next;
    },
  });
  const disposeCliBridge = registerPackageCliBridge(cliService);
  registerCoreWorkspacePackageCliPort(createCorePackageCliPort(cliService));

  // One consolidated confirmation per package, for a fresh install and for the package master switch alike. The in-app
  // dialog answers when the main window can show it; only without a window does the native dialog ask. The default is Cancel.
  const approvalBroker = createInstallApprovalBroker({
    send: (payload) => {
      const window = options.getWindow();
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false;
      window.webContents.send(INSTALL_APPROVAL_CHANNELS.request, payload);
      return true;
    },
  });
  // Only the main window's top frame may answer, and an answer must match the pending request (see the broker).
  const answerApproval = (event: IpcMainInvokeEvent, payload: unknown): boolean =>
    trusted(event) && approvalBroker.respond(payload);
  ipcMain.handle(INSTALL_APPROVAL_CHANNELS.respond, answerApproval);
  // A reloaded main window asks for the requests still waiting (the run and its Main-side promise are unaffected by a reload).
  ipcMain.handle(INSTALL_APPROVAL_CHANNELS.pending, (event: IpcMainInvokeEvent) =>
    trusted(event) ? approvalBroker.pending() : []
  );
  const nativeActivationConfirm = async (request: InstallActivationRequest): Promise<InstallActivationAnswer> => {
    await i18nReady;
    const window = options.getWindow();
    const parent = window && !window.isDestroyed() ? window : undefined;
    const dialogOptions = {
      type: 'warning' as const,
      title: i18n.t('guid.hubHome.connections.activationTitle'),
      message: i18n.t('guid.hubHome.connections.activationMessage', {
        package: request.packageId,
        total: request.items.length,
      }),
      detail: activationDetailOf(request.items),
      buttons: [i18n.t('guid.hubHome.explorer.cancel'), i18n.t('guid.hubHome.explorer.approve')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      checkboxLabel: i18n.t('guid.hubHome.connections.autoStart'),
      checkboxChecked: false,
    };
    const result = parent
      ? await dialog.showMessageBox(parent, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);
    return { approved: result.response === 1, autoStart: result.checkboxChecked };
  };
  const activationConfirm = async (request: InstallActivationRequest): Promise<InstallActivationAnswer> => {
    await i18nReady;
    const packageName = await packageNameOf(request.packageId);
    const inApp = await approvalBroker.ask(request, packageName ?? request.packageId);
    return inApp ?? nativeActivationConfirm(request);
  };
  setInstallActivationConfirm(activationConfirm);
  // The one-time start-again question of code connections that wait for an approval (wiring/startAgainApproval.ts). It is asked
  // only once the main window has loaded, so the dialog has a renderer; a renderer that mounts later gets it replayed by the broker.
  setStartAgainRunner(
    createStartAgainRunner({
      registry: options.registry,
      packageName: packageNameOf,
      ask: async (request, packageName, prompt) => {
        if ((await loadedMainWindow(options.getWindow)) === undefined) return undefined;
        return approvalBroker.ask(request, packageName, prompt);
      },
    })
  );

  const disposeRepoStore = registerRepoStoreBridge({
    ipcMain,
    verifySender: trusted,
    selectFolder: async (event) => {
      const window = options.getWindow();
      if (!window || !trusted(event)) return undefined;
      await i18nReady;
      const selection = await dialog.showOpenDialog(window, {
        title: i18n.t('guid.hubHome.storeImport.chooseFolder'),
        properties: ['openDirectory'],
      });
      return selection.canceled ? undefined : selection.filePaths[0];
    },
    build: async (source, workspaceRoot, publish) => {
      const [{ runRepoToPackageChat }, { createRepoToPackageEnvironment }] = await Promise.all([
        import('@process/extensions/package-manager/repoPackaging'),
        import('@process/services/database/nativeConversation/repoToPackageEnvironment'),
      ]);
      const environment = createRepoToPackageEnvironment(workspaceRoot);
      return runRepoToPackageChat(
        source,
        {
          ...environment,
          allowedGitHosts: ['github.com'],
        },
        publish
      );
    },
    install: async (artifactPath) => {
      const { installLocalBuiltPackage } = await import('@process/extensions/package-manager/packageBridge');
      return installLocalBuiltPackage(artifactPath, { activateConnections: true });
    },
    selectExtensionFile: async (event) => {
      const window = options.getWindow();
      if (!window || !trusted(event)) return undefined;
      await i18nReady;
      const selection = await dialog.showOpenDialog(window, {
        title: i18n.t('guid.hubHome.storeImport.chooseExtensionFile'),
        properties: ['openFile'],
        filters: [{ name: i18n.t('guid.hubHome.storeImport.extensionFilter'), extensions: ['zip', 'crx'] }],
      });
      return selection.canceled ? undefined : selection.filePaths[0];
    },
    installExtensionFile: async (filePath, publish) => {
      const [{ installExtensionFromFile }, deps] = await Promise.all([
        import('@process/integrations/repoSources/crx'),
        extensionInstallDeps(),
      ]);
      const result = await installExtensionFromFile(deps, filePath, { onProgress: publish });
      return { packageId: result.install.packageId, version: result.install.version };
    },
    installChromeWebStore: async (input, publish) => {
      const [{ installExtensionFromChromeWebStore, createFetchStorePort }, deps] = await Promise.all([
        import('@process/integrations/repoSources/chromeWebStore'),
        extensionInstallDeps(),
      ]);
      // Electron's net.fetch follows the redirect policy of the store module; it sends no cookies.
      const port = createFetchStorePort(net.fetch as unknown as Parameters<typeof createFetchStorePort>[0], {
        chromiumVersion: process.versions.chrome,
      });
      const result = await installExtensionFromChromeWebStore(deps, port, input, { onProgress: publish });
      return { packageId: result.install.packageId, version: result.install.version };
    },
    chromeWebStoreEnabled: () => CHROME_WEB_STORE_SOURCE_ENABLED,
    checkUpdate: async (packageId) => {
      const [{ checkSourceUpdate }, { createGitRemote }, packageBridge] = await Promise.all([
        import('@process/integrations/repoSources/update'),
        import('@process/integrations/repoSources/gitRemote'),
        import('@process/extensions/package-manager/packageBridge'),
      ]);
      return checkSourceUpdate(
        {
          packages: packageBridge.getPackageManagerService(),
          loadInstalled: packageBridge.getConnectionRuntime().loadPackage,
          remote: createGitRemote(),
        },
        packageId
      );
    },
  });

  const launcherProbe = createNativeInstalledAppProbe();
  const launcherBindings = createLauncherBindings(
    path.join(app.getPath('userData'), 'launcher-bindings.json'),
    launcherProbe
  );
  const disposeLauncher = registerLauncherBridge({
    ipcMain,
    verifySender: trusted,
    registry: options.registry,
    bindings: launcherBindings,
    probe: launcherProbe,
    chooseFile: async (event, executable) => {
      const window = options.getWindow();
      if (!window || !trusted(event)) return undefined;
      const result = await dialog.showOpenDialog(window, {
        title: executable,
        properties: ['openFile'],
        filters: process.platform === 'win32' ? [{ name: 'Executable', extensions: ['exe', 'com'] }] : undefined,
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
    openExternal: (url) => shell.openExternal(url),
    launch: launchInstalledApplication,
  });

  const disposeConnectionsBridge = registerPackageConnectionsBridge({
    ipcMain,
    verifySender: trusted,
    registry: options.registry,
    ...(options.runtime ? { rules: options.runtime.rules, services: options.runtime.services } : {}),
    setPackageEnabled: (event, packageId, enabled) =>
      setPackageEnabled({ registry: options.registry, confirm: activationConfirm }, packageId, enabled),
    confirmEnable: async (event, detail) => {
      await i18nReady;
      const window = options.getWindow();
      if (!window || !trusted(event)) return false;
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: i18n.t('guid.hubHome.connections.confirmTitle'),
        message: i18n.t('guid.hubHome.connections.confirmEnable', {
          package: detail.packageId,
          title: detail.subject.title,
        }),
        detail: detailOf(detail.subject),
        buttons: [i18n.t('guid.hubHome.explorer.cancel'), i18n.t('guid.hubHome.explorer.approve')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    audit: async (record) => {
      const next = tail.then(() =>
        journal.append({
          sessionId: record.subjectId,
          requestId: `package-connection:${record.operation}`,
          kind: 'custom',
          visibility: 'private',
          payload: { origin: 'human-package-connections', operation: record.operation, status: record.status },
        })
      );
      tail = next.catch((): undefined => undefined);
      await next;
    },
  });
  // Revokes this machine's local signing key. Main asks first (default: cancel) and writes a content-free receipt.
  const disposeLocalKeys = registerLocalKeyBridge({
    ipcMain,
    verifySender: trusted,
    confirm: async (event) => {
      await i18nReady;
      const window = options.getWindow();
      if (!window || !trusted(event)) return false;
      const packageBridge = await import('@process/extensions/package-manager/packageBridge');
      const packages = await countLocalBuiltPackages(packageBridge.getPackageManagerService());
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: i18n.t('guid.hubHome.localKey.revokeTitle'),
        message: i18n.t('guid.hubHome.localKey.revokeMessage', { packages }),
        detail: i18n.t('guid.hubHome.localKey.revokeDetail'),
        buttons: [i18n.t('guid.hubHome.explorer.cancel'), i18n.t('guid.hubHome.localKey.revokeApprove')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    revoke: async () => {
      const packageBridge = await import('@process/extensions/package-manager/packageBridge');
      const outcome = await revokeLocalSigningKey({
        keys: packageBridge.getLocalSigningKeys(),
        packages: packageBridge.getPackageManagerService(),
        registry: options.registry,
      });
      return outcome.unsignedPackages;
    },
    audit: async (record) => {
      const next = tail.then(() =>
        journal.append({
          sessionId: 'local-key',
          requestId: 'package-local-key:revoke',
          kind: 'custom',
          visibility: 'private',
          payload: {
            origin: 'human-local-key',
            operation: 'revoke',
            status: record.status,
            ...(record.unsignedPackages === undefined ? {} : { unsignedPackages: record.unsignedPackages }),
          },
        })
      );
      tail = next.catch((): undefined => undefined);
      await next;
    },
  });

  // Pins, site access and uninstall of the header strip. The origin is the active tab's own URL, read here.
  const userStatePath = path.join(app.getPath('userData'), EXTENSION_PREFS_FILE);
  const activeOrigin = (requestedTabId?: string): string | undefined => {
    const url = activeBrowserTabUrl(requestedTabId);
    return url === undefined ? undefined : webOriginOf(url);
  };
  const stripActions = createExtensionStripActions({
    records: () => loadedStripRecords(),
    userState: () => sharedExtensionUserState(userStatePath),
    activeOrigin: () => activeOrigin(),
    applySiteAccess: async (extensionId, config) => {
      await (await defaultExtensionHostManager()).setSiteAccess(extensionId, config);
    },
    isExtensionPackage: async (packageId) =>
      (await options.registry.view(packageId)).some((view) => view.connection.kind === 'extension'),
    confirmUninstall: async (packageId) => {
      await i18nReady;
      const window = options.getWindow();
      if (!window || window.isDestroyed()) return false;
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: i18n.t('guid.hubHome.connections.confirmUninstallTitle'),
        message: i18n.t('guid.hubHome.connections.confirmUninstall', { package: packageId }),
        buttons: [i18n.t('guid.hubHome.explorer.cancel'), i18n.t('guid.hubHome.connections.uninstallApprove')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    uninstallPackage: async (packageId) => {
      const bridge = await import('@process/extensions/package-manager/packageBridge');
      await bridge.getPackageManagerService().uninstall(packageId);
    },
    log: (message, error) => console.error(`[ExtensionStrip] ${message}`, error),
  });
  const disposeExtensionStrip = registerExtensionStripBridge({
    ipcMain,
    verifySender: trusted,
    records: () => loadedStripRecords(),
    userState: () => sharedExtensionUserState(userStatePath),
    activeOrigin,
    actions: stripActions,
  });
  return () => {
    setInstallActivationConfirm(undefined);
    setStartAgainRunner(undefined);
    ipcMain.removeHandler(INSTALL_APPROVAL_CHANNELS.respond);
    ipcMain.removeHandler(INSTALL_APPROVAL_CHANNELS.pending);
    approvalBroker.dispose();
    disposeExtensionStrip();
    disposeLocalKeys();
    disposeConnectionsBridge();
    disposeLauncher();
    disposeRepoStore();
    disposeCliBridge();
    registerCoreWorkspacePackageCliPort(undefined);
  };
};
