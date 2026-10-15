import { app, dialog, ipcMain, safeStorage, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SecretRequestStore } from '@process/agentRuntime/agentMesh/mcp/secret-context/requests';
import type { ScopedSecretVault } from '@process/agentRuntime/secretVault';
import i18n, { i18nReady } from '@process/services/i18n';
import { JsonlDurableEventStore } from '@process/services/agentChat/durability';
import type { TChatConversation } from '@/common/config/storage';
import { z } from 'zod';
import {
  COMPANY_SECRETS_CHANNELS,
  PACKAGE_SECRETS_CHANNELS,
  PACKAGE_SECRETS_LEGACY_CHANNEL,
  SESSION_SECRETS_CHANNELS,
} from '@/common/types/platform/sessionSecrets';
import type { PackageSecretAccess } from '@process/resources/packageSecrets/packageSecretAccess';
import { registerPackageSecretAccessBridge } from '@process/resources/packageSecrets/packageSecretAccessBridge';
import { countPendingLegacySecrets, importLegacySecrets, type LegacySecretSource } from './legacyImport';
import { registerScopedSecretsBridge } from './sessionSecretsBridge';

type Options = {
  getWindow: () => BrowserWindow | null;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  accountId: () => string;
  getConversation: (id: string) => Promise<TChatConversation | undefined>;
  /** The app vault: permanent encrypted sets plus the RAM-only per-conversation sets. */
  store: ScopedSecretVault;
  requests: SecretRequestStore;
  /** Whether a Package App is installed; package-scoped sets can only be managed for an installed package. */
  packageInstalled: (packageId: string) => Promise<boolean>;
  /** Per-package readers of keys kept before the app vault existed, offered for an approved import. */
  legacySources?: Readonly<Record<string, LegacySecretSource>>;
  /** Requests and grants for a package's use of the person's general app secrets. */
  packageAccess: PackageSecretAccess;
};

const COMPANY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const LEGACY_REQUEST = z
  .object({ packageId: z.string().regex(PACKAGE_ID), action: z.enum(['status', 'import']) })
  .strict();

/**
 * Wires the secret-set controls to the application main frame, the OS keychain, native approvals and content-free
 * receipts: one registration for the selected conversation (temporary sets) and one for a company group chat.
 */
export const registerDesktopSecretSets = (options: Options): (() => void) => {
  const journal = new JsonlDurableEventStore(
    path.join(app.getPath('userData'), 'tomny-core', 'runs', 'session-secrets.jsonl')
  );
  const ready = journal.initialize();
  void ready.catch((): undefined => undefined);
  let tail: Promise<unknown> = ready;
  const owners = new WeakMap<IpcMainInvokeEvent, string>();
  const trusted = (event: IpcMainInvokeEvent): boolean => {
    let account: string;
    try {
      account = options.accountId();
    } catch {
      return false;
    }
    if (!account || (owners.has(event) && owners.get(event) !== account)) return false;
    owners.set(event, account);
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
  const confirm = async (
    event: IpcMainInvokeEvent,
    operation: 'remove' | 'reveal' | 'import' | 'grant',
    detail: { packageId?: string; label?: string } = {}
  ): Promise<boolean> => {
    await i18nReady;
    const window = options.getWindow();
    if (!window || !trusted(event)) return false;
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: i18n.t('guid.hubHome.secrets.title'),
      message: i18n.t(
        operation === 'reveal'
          ? 'guid.hubHome.secrets.confirmReveal'
          : operation === 'import'
            ? 'guid.hubHome.secrets.confirmImport'
            : operation === 'grant'
              ? 'guid.hubHome.secrets.confirmGrant'
              : 'guid.hubHome.secrets.confirmRemove',
        { package: detail.packageId ?? '', label: detail.label ?? '' }
      ),
      buttons: [i18n.t('guid.hubHome.explorer.cancel'), i18n.t('guid.hubHome.explorer.approve')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1;
  };
  const audit = async (record: { subjectId: string; operation: string; status: string }): Promise<void> => {
    const next = tail.then(() =>
      journal.append({
        sessionId: record.subjectId,
        requestId: `secret-set:${record.operation}`,
        kind: 'custom',
        visibility: 'private',
        payload: { origin: 'human-secret-sets', operation: record.operation, status: record.status },
      })
    );
    tail = next.catch((): undefined => undefined);
    await next;
  };
  const keychainAvailable = (): boolean => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };

  const disposeSession = registerScopedSecretsBridge({
    ipcMain,
    channels: SESSION_SECRETS_CHANNELS,
    idKey: 'sessionId',
    includeAppSets: true,
    requiresKeychain: false,
    verifySender: trusted,
    // Hosts see the Core session id, which is not always the conversation id.
    resolve: async (id) => {
      const conversation = await options.getConversation(id);
      if (!conversation) return undefined;
      const core = (conversation.extra as Record<string, unknown> | undefined)?.tomny_core_session_id;
      const sessionId = typeof core === 'string' && core.trim() ? core.trim() : id;
      return { scope: { kind: 'session', sessionId }, caller: { sessionId }, requestKey: sessionId };
    },
    store: options.store,
    requests: options.requests,
    keychainAvailable,
    confirm,
    audit,
  });
  const disposeCompany = registerScopedSecretsBridge({
    ipcMain,
    channels: COMPANY_SECRETS_CHANNELS,
    idKey: 'companyId',
    includeAppSets: false,
    requiresKeychain: true,
    verifySender: trusted,
    resolve: async (id) => {
      if (!COMPANY_ID.test(id) || id.includes('..')) return undefined;
      if (!existsSync(path.join(app.getPath('userData'), 'companies', id, 'company.json'))) return undefined;
      return { scope: { kind: 'company', companyId: id }, caller: { companyId: id }, requestKey: id };
    },
    store: options.store,
    keychainAvailable,
    confirm,
    audit,
  });
  const resolvePackage = async (id: string) => {
    if (!PACKAGE_ID.test(id) || id.includes('..') || !(await options.packageInstalled(id))) return undefined;
    return { scope: { kind: 'package' as const, packageId: id }, caller: { packageId: id }, requestKey: id };
  };
  const disposePackage = registerScopedSecretsBridge({
    ipcMain,
    channels: PACKAGE_SECRETS_CHANNELS,
    idKey: 'packageId',
    includeAppSets: false,
    requiresKeychain: true,
    verifySender: trusted,
    resolve: resolvePackage,
    store: options.store,
    keychainAvailable,
    confirm,
    audit,
  });
  // Keys a package kept in its own storage: count what is not in the app vault yet, and copy it after approval.
  ipcMain.handle(PACKAGE_SECRETS_LEGACY_CHANNEL, async (event, raw: unknown) => {
    try {
      if (!trusted(event)) return { ok: false, error: 'DENIED' };
      const parsed = LEGACY_REQUEST.safeParse(raw);
      if (!parsed.success) return { ok: false, error: 'INVALID_REQUEST' };
      const { packageId, action } = parsed.data;
      const source = Object.hasOwn(options.legacySources ?? {}, packageId)
        ? options.legacySources?.[packageId]
        : undefined;
      if (!source || !(await resolvePackage(packageId))) return { ok: false, error: 'NOT_FOUND' };
      if (action === 'status') {
        return { ok: true, data: { pending: await countPendingLegacySecrets(options.store, packageId, source) } };
      }
      if (!keychainAvailable()) return { ok: false, error: 'KEYCHAIN_UNAVAILABLE' };
      if (!(await confirm(event, 'import', { packageId })) || !trusted(event)) return { ok: false, error: 'CANCELLED' };
      const report = await importLegacySecrets(options.store, packageId, source);
      await audit({ subjectId: packageId, operation: 'import', status: report.failed > 0 ? 'failed' : 'completed' });
      const { imported, existing, skipped, failed } = report;
      return { ok: true, data: { imported, existing, skipped, failed } };
    } catch {
      return { ok: false, error: 'IO_ERROR' };
    }
  });
  const disposeAccess = registerPackageSecretAccessBridge({
    ipcMain,
    verifySender: trusted,
    packageInstalled: async (packageId) => (await resolvePackage(packageId)) !== undefined,
    access: options.packageAccess,
    confirmGrant: (event, detail) => confirm(event, 'grant', detail),
    audit,
  });
  return () => {
    disposeSession();
    disposeCompany();
    disposePackage();
    disposeAccess();
    ipcMain.removeHandler(PACKAGE_SECRETS_LEGACY_CHANNEL);
  };
};
