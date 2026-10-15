/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, webContents } from 'electron';
import {
  NOTIFICATION_LEVELS,
  notificationHubChannels,
  type ConnectorDraft,
  type NotificationFeedbackAction,
  type NotificationLevel,
  type NotificationRules,
  type SaveConnectorResult,
} from '@/common/types/platform/notificationHub';
import { createCredentialStore } from '@process/automation/credentialStore';
import { showNotification } from '@process/bridge/notificationBridge';
import i18n from '@process/services/i18n';
import { createLayaSidecarPredictor, getSharedLayaSidecarClient } from '@process/services/security/layaSidecarClient';
import { getHubActivityRegistry } from '../hubActivityRegistry';
import {
  createWindowsToastReader,
  type OsSqliteDatabase,
  type OsToastReader,
} from '../notificationSources/osToastSource';
import { setPackageNotificationHandler } from '../notificationSources/packageNotificationPort';
import { createWebNotificationCapture } from '../notificationSources/webNotificationCapture';
import { createRamWatcher, decideAlert } from './alertPolicy';
import { createActivityNotifier } from './internalNotificationSources';
import { fetchFeedText } from './feedConnector';
import { fetchNewMail } from './imapClient';
import { createNotificationClassifier } from './notificationClassifier';
import { NotificationHubService } from './notificationHubService';
import { createNotificationStore } from './notificationStore';
import { createWebTitleWatcher } from './webTitleWatcher';

const MAX_ID = 512;
const RAM_SAMPLE_MS = 60_000;
const MAX_IDS = 500;
/** How long Tomny's own OS alert texts are remembered so the Windows source does not read them back. */
const SELF_ALERT_MEMORY_MS = 10 * 60_000;

const FEEDBACK_ACTIONS: readonly NotificationFeedbackAction[] = [
  'opened',
  'muteSource',
  'unmuteSource',
  'boostSender',
  'muteSender',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const boundedId = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID ? value : undefined;

const idList = (input: unknown): string[] => {
  const ids = isRecord(input) ? input.ids : undefined;
  return Array.isArray(ids)
    ? ids
        .map(boundedId)
        .filter((id): id is string => Boolean(id))
        .slice(0, MAX_IDS)
    : [];
};

const levelOf = (value: unknown): NotificationLevel | undefined => NOTIFICATION_LEVELS.find((level) => level === value);

let service: NotificationHubService | undefined;

export const getNotificationHub = (): NotificationHubService | undefined => service;

type SqliteConstructor = new (file: string, options: { readonly: boolean; fileMustExist: boolean }) => OsSqliteDatabase;

/**
 * Windows keeps other apps' notifications in a per-user database. The native
 * SQLite module loads lazily and only on Windows; until then (or elsewhere)
 * the desktop-apps source reports `unsupported`.
 */
const createOsReaderProvider = (): (() => OsToastReader | undefined) => {
  if (process.platform !== 'win32') return () => undefined;
  const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  const file = path.join(localAppData, 'Microsoft', 'Windows', 'Notifications', 'wpndatabase.db');
  let reader: OsToastReader | undefined;
  void import('better-sqlite3')
    .then((module) => {
      const Sqlite = module.default as unknown as SqliteConstructor;
      reader = createWindowsToastReader((target) => new Sqlite(target, { readonly: true, fileMustExist: true }), file);
    })
    .catch((error: unknown) => console.warn('[NotificationHub] Windows notification reader unavailable:', error));
  return () => reader;
};

/**
 * Starts the notification hub and exposes it to the desktop renderer. Sender
 * trust is enforced in the main adapter allowlist; here every payload is
 * shape-checked. Passwords go straight into the OS-encrypted vault and are
 * never returned.
 */
export const registerNotificationHubBridge = (): NotificationHubService => {
  if (service) return service;
  const dir = path.join(app.getPath('userData'), 'notification-hub');
  const vault = createCredentialStore({ dir });
  const laya = getSharedLayaSidecarClient();
  const shownByTomny = new Map<string, number>();
  const rememberShown = (text: string) => {
    const now = Date.now();
    shownByTomny.set(text.trim(), now);
    for (const [key, at] of shownByTomny) if (now - at > SELF_ALERT_MEMORY_MS) shownByTomny.delete(key);
  };
  const hub = new NotificationHubService({
    store: createNotificationStore(dir),
    classify: createNotificationClassifier({ laya: () => (laya.ready ? createLayaSidecarPredictor(laya) : undefined) }),
    secrets: {
      get: async (id) => (await vault.getDecrypted(id))?.password || undefined,
      set: async (id, secret) => {
        await vault.save({ id, name: `notification-hub:${id}`, kind: 'generic', fields: { password: secret } });
      },
      remove: async (id) => {
        await vault.remove(id);
      },
    },
    fetchMail: fetchNewMail,
    fetchFeed: fetchFeedText,
    layaReady: () => laya.ready,
    osReader: createOsReaderProvider(),
    recentlyShown: (text) => {
      const at = shownByTomny.get(text.trim());
      return at !== undefined && Date.now() - at <= SELF_ALERT_MEMORY_MS;
    },
    // Off unless the user enables escalation and names a model; only redacted batches leave the device.
    escalationChat: (model) => async (messages, signal) => {
      const { createProviderChat } = await import('@process/services/agentChat');
      return createProviderChat()({ model, messages, signal });
    },
    alert: (notification, rules) => {
      const focused = BrowserWindow.getFocusedWindow() !== null;
      const decision = decideAlert(notification, rules, { now: new Date(), focused });
      if (decision.banner) {
        const title = notification.i18n
          ? i18n.t(notification.i18n.title, { ...notification.i18n.params, defaultValue: notification.title })
          : notification.title;
        const body = notification.i18n?.body
          ? i18n.t(notification.i18n.body, { ...notification.i18n.params, defaultValue: notification.body })
          : notification.body;
        const bannerTitle = `${notification.sourceLabel} · ${title}`;
        rememberShown(bannerTitle);
        void showNotification({
          title: bannerTitle,
          body: body.slice(0, 200),
          silent: !decision.sound,
        });
      }
      if (decision.attention) {
        const window = BrowserWindow.getAllWindows().find((entry) => !entry.isDestroyed());
        if (window) {
          if (window.isMinimized()) window.restore();
          window.flashFrame(true);
        }
      }
    },
  });
  service = hub;
  setPackageNotificationHandler((packageId, args) => hub.postFromPackage(packageId, args));

  const notifyActivity = createActivityNotifier((event) => void hub.ingest(event));
  getHubActivityRegistry().subscribe(notifyActivity);

  const watcher = createWebTitleWatcher(
    () => hub.webConnectors(),
    (change) => void hub.onWebUnread(change)
  );
  const capture = createWebNotificationCapture(
    () => hub.webConnectors(),
    (notification) => void hub.onWebNotification(notification)
  );
  const observe = (contents: Electron.WebContents) => {
    watcher.observe(contents);
    capture.observe(contents);
  };
  for (const contents of webContents.getAllWebContents()) observe(contents);
  app.on('web-contents-created', (_event, contents) => observe(contents));

  notificationHubChannels.snapshot.provider(async () => hub.snapshot());
  notificationHubChannels.markRead.provider(async (input) => hub.markRead(idList(input)));
  notificationHubChannels.markAllRead.provider(async () => hub.markAllRead());
  notificationHubChannels.remove.provider(async (input) => hub.remove(idList(input)));
  notificationHubChannels.clear.provider(async (input) => {
    const level = isRecord(input) ? levelOf(input.level) : undefined;
    return hub.clear(level);
  });
  notificationHubChannels.reclassify.provider(async (input) => {
    if (!isRecord(input)) return false;
    const id = boundedId(input.id);
    const level = levelOf(input.level);
    return Boolean(id && level) && hub.reclassify(id as string, level as NotificationLevel, input.remember === true);
  });
  notificationHubChannels.feedback.provider(async (input) => {
    if (!isRecord(input)) return false;
    const id = boundedId(input.id);
    const action = FEEDBACK_ACTIONS.find((entry) => entry === input.action);
    return Boolean(id && action) && hub.feedback(id as string, action as NotificationFeedbackAction);
  });
  notificationHubChannels.summary.provider(async (input) => hub.summary(input));
  notificationHubChannels.listOsApps.provider(async () => hub.osApps());
  notificationHubChannels.saveConnector.provider(
    async (input: { draft: ConnectorDraft }): Promise<SaveConnectorResult> => {
      const draft: unknown = isRecord(input) ? input.draft : undefined;
      if (!isRecord(draft) || typeof draft.kind !== 'string') return { error: 'kind' };
      const saved = await hub.saveConnector(draft as ConnectorDraft);
      return 'error' in saved ? { error: saved.error } : { connector: saved };
    }
  );
  notificationHubChannels.removeConnector.provider(async (input) => {
    const id = isRecord(input) ? boundedId(input.id) : undefined;
    return id ? hub.removeConnector(id) : false;
  });
  notificationHubChannels.testConnector.provider(async (input) => {
    const id = isRecord(input) ? boundedId(input.id) : undefined;
    return id ? hub.sync(id) : { ok: false, error: 'missing' };
  });
  notificationHubChannels.syncNow.provider(async (input) => {
    const id = isRecord(input) ? boundedId(input.id) : undefined;
    if (id) return (await hub.sync(id)).ok;
    await hub.syncAll();
    return true;
  });
  notificationHubChannels.saveRules.provider(async (input) => {
    if (!isRecord(input)) return null;
    return hub.saveRules(input as NotificationRules);
  });
  hub.subscribe((snapshot) => notificationHubChannels.changed.emit(snapshot));

  const watchRam = createRamWatcher((sample, windowKey) => {
    const params = { percent: sample.usedPercent, used: sample.usedGb, total: sample.totalGb };
    void hub.ingest({
      key: `ram:${windowKey}`,
      source: 'system',
      sourceLabel: 'Tomny',
      title: `Memory use is at ${sample.usedPercent}%`,
      body: `${sample.usedGb} of ${sample.totalGb} GB in use.`,
      route: '/settings/resource',
      hint: { level: 'P0', category: 'system', reason: 'ram-high' },
      i18n: { title: 'common.notificationHub.event.ramHigh', body: 'common.notificationHub.event.ramHighBody', params },
      group: 'system:ram',
    });
  });
  const ramTimer = setInterval(() => {
    if (!hub.snapshot().settings.rules.ramAlert) return;
    const total = os.totalmem();
    if (total <= 0) return;
    const used = total - os.freemem();
    const toGb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;
    watchRam({ usedPercent: Math.round((used / total) * 100), usedGb: toGb(used), totalGb: toGb(total) }, Date.now());
  }, RAM_SAMPLE_MS);
  ramTimer.unref?.();

  hub.start();
  app.once('before-quit', () => {
    clearInterval(ramTimer);
    setPackageNotificationHandler(undefined);
    hub.dispose();
  });
  return hub;
};
