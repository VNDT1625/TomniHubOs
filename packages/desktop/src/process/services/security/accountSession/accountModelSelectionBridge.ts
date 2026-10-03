import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  HUB_MODEL_SELECTION_NATIVE_CHANNELS,
  type HubModelSelectionCatalogResult,
  type HubModelSelectionNativeRecord,
  type HubModelSelectionNativeResult,
} from '@/common/types/platform/electron';
import type { AccountSessionService } from './accountSessionService';
import type { AccountModelSelectionVault } from './accountModelSelectionVault';

type HubModelRuntime = Readonly<{
  listTargets: () => Promise<readonly Readonly<{ id: string; available: boolean }>[]>;
  listModels: (targetId: string, workspace: string) => Promise<readonly Readonly<{ key: string }>[]>;
}>;

export type AccountModelSelectionBridgeOptions = Readonly<{
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  accountSession: AccountSessionService;
  vault: AccountModelSelectionVault;
  runtime: HubModelRuntime;
  workspace: () => string;
  verifySender(event: IpcMainInvokeEvent): boolean;
  now?: () => Date;
}>;

const bounded = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !/\p{Cc}/u.test(value);

const parseSelectionRequest = (value: unknown): Readonly<{ targetId: string; modelKey: string }> | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || Object.keys(record).some((key) => key !== 'targetId' && key !== 'modelKey')) {
    return undefined;
  }
  return bounded(record.targetId, 512) && bounded(record.modelKey, 2_048)
    ? { targetId: record.targetId, modelKey: record.modelKey }
    : undefined;
};

const storageFailure = (): HubModelSelectionNativeResult => ({ ok: false, code: 'HUB_MODEL_SELECTION_STORAGE_FAILED' });

/**
 * Narrow Main-only profile bridge. Renderer can request a user choice, but
 * cannot attach an account, invent a target/model, or execute a model.
 */
export const registerAccountModelSelectionBridge = (options: AccountModelSelectionBridgeOptions): (() => void) => {
  const now = options.now ?? (() => new Date());
  const requireTrustedSession = (event: IpcMainInvokeEvent): string | undefined => {
    if (!options.verifySender(event)) return undefined;
    try {
      return options.accountSession.requireOnlineSession().accountId;
    } catch {
      return undefined;
    }
  };
  const unauthorized = (event: IpcMainInvokeEvent): HubModelSelectionNativeResult =>
    options.verifySender(event)
      ? { ok: false, code: 'HUB_MODEL_SELECTION_ACCOUNT_REQUIRED' }
      : { ok: false, code: 'HUB_MODEL_SELECTION_SENDER_UNTRUSTED' };

  options.ipcMain.handle(
    HUB_MODEL_SELECTION_NATIVE_CHANNELS.get,
    async (event): Promise<HubModelSelectionNativeResult> => {
      const accountId = requireTrustedSession(event);
      if (!accountId) return unauthorized(event);
      try {
        const selection = await options.vault.load(accountId);
        const record: HubModelSelectionNativeRecord | undefined =
          selection === undefined
            ? undefined
            : { targetId: selection.targetId, modelKey: selection.modelKey, updatedAt: selection.updatedAt };
        return record === undefined ? { ok: true } : { ok: true, selection: record };
      } catch {
        return storageFailure();
      }
    }
  );
  options.ipcMain.handle(
    HUB_MODEL_SELECTION_NATIVE_CHANNELS.list,
    async (event): Promise<HubModelSelectionCatalogResult> => {
      const accountId = requireTrustedSession(event);
      if (!accountId) {
        return options.verifySender(event)
          ? { ok: false, code: 'HUB_MODEL_SELECTION_ACCOUNT_REQUIRED' }
          : { ok: false, code: 'HUB_MODEL_SELECTION_SENDER_UNTRUSTED' };
      }
      try {
        const targets = await options.runtime.listTargets();
        const availableTargets = targets
          .filter((target) => target.available)
          .toSorted((left, right) => left.id.localeCompare(right.id));
        const catalog = await Promise.all(
          availableTargets.map(async (target) => ({
            targetId: target.id,
            modelKeys: (await options.runtime.listModels(target.id, options.workspace()))
              .map((model) => model.key)
              .filter((modelKey) => bounded(modelKey, 2_048))
              .toSorted(),
          }))
        );
        return { ok: true, targets: catalog.filter((target) => target.modelKeys.length > 0) };
      } catch {
        return { ok: false, code: 'HUB_MODEL_SELECTION_UNAVAILABLE' };
      }
    }
  );
  options.ipcMain.handle(
    HUB_MODEL_SELECTION_NATIVE_CHANNELS.set,
    async (event, raw: unknown): Promise<HubModelSelectionNativeResult> => {
      const accountId = requireTrustedSession(event);
      if (!accountId) return unauthorized(event);
      const request = parseSelectionRequest(raw);
      if (!request) return { ok: false, code: 'HUB_MODEL_SELECTION_REQUEST_INVALID' };
      try {
        const target = (await options.runtime.listTargets()).find(
          (candidate) => candidate.available && candidate.id === request.targetId
        );
        if (!target) return { ok: false, code: 'HUB_MODEL_SELECTION_UNAVAILABLE' };
        const modelAvailable = (await options.runtime.listModels(request.targetId, options.workspace())).some(
          (model) => model.key === request.modelKey
        );
        if (!modelAvailable) return { ok: false, code: 'HUB_MODEL_SELECTION_UNAVAILABLE' };
        const selection = {
          schemaVersion: 1 as const,
          accountId,
          targetId: request.targetId,
          modelKey: request.modelKey,
          updatedAt: now().toISOString(),
        };
        await options.vault.save(selection);
        return {
          ok: true,
          selection: { targetId: selection.targetId, modelKey: selection.modelKey, updatedAt: selection.updatedAt },
        };
      } catch {
        return storageFailure();
      }
    }
  );
  return () => {
    options.ipcMain.removeHandler(HUB_MODEL_SELECTION_NATIVE_CHANNELS.get);
    options.ipcMain.removeHandler(HUB_MODEL_SELECTION_NATIVE_CHANNELS.list);
    options.ipcMain.removeHandler(HUB_MODEL_SELECTION_NATIVE_CHANNELS.set);
  };
};
