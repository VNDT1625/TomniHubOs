/** Sender-aware IPC boundary for persisted package app groups. */

import {
  parsePackageAppGroupCreateRequest,
  parsePackageAppGroupReadRequest,
  parsePackageAppGroupRemoveRequest,
  parsePackageAppGroupRenameRequest,
  parsePackageAppGroupReorderRequest,
  type PackageAppGroupDocument,
} from '@/common/packages';
import { PACKAGE_APP_GROUP_NATIVE_CHANNELS, type PackageAppGroupNativeResult } from '@/common/types/platform/electron';
import { PackageAppGroupServiceError, type PackageAppGroupService } from './appGroupService';

export type PackageAppGroupBridgeErrorCode =
  | 'APP_GROUP_BRIDGE_UNAUTHORIZED'
  | 'APP_GROUP_REQUEST_INVALID'
  | 'APP_GROUP_NOT_FOUND'
  | 'APP_GROUP_ORDER_INVALID'
  | 'APP_GROUP_ID_CONFLICT'
  | 'APP_GROUP_SCOPE_LIMIT'
  | 'APP_GROUP_BRIDGE_FAILURE';

export type PackageAppGroupBridgeResult<T> = PackageAppGroupNativeResult<T>;

export type TrustedPackageAppGroupIpcHost<Sender> = {
  handle(
    channel: string,
    handler: (sender: Sender, payload: unknown) => Promise<PackageAppGroupBridgeResult<unknown>>
  ): void;
  removeHandler(channel: string): void;
};

export type TrustedPackageAppGroupIpcOptions<Sender> = {
  host: TrustedPackageAppGroupIpcHost<Sender>;
  service: PackageAppGroupService;
  verifySender: (sender: Sender) => boolean | Promise<boolean>;
};

const MAX_APP_GROUP_IPC_PAYLOAD_BYTES = 128 * 1024;

const isPayloadWithinLimit = (payload: unknown): boolean => {
  try {
    const serialized = JSON.stringify(payload);
    return typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= MAX_APP_GROUP_IPC_PAYLOAD_BYTES;
  } catch {
    return false;
  }
};

const failureCode = (error: unknown): PackageAppGroupBridgeErrorCode => {
  if (error instanceof PackageAppGroupServiceError) return error.code;
  return 'APP_GROUP_BRIDGE_FAILURE';
};

const resolve = async <T>(work: () => Promise<T>): Promise<PackageAppGroupBridgeResult<T>> => {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return { ok: false, code: failureCode(error) };
  }
};

/**
 * Registers only native sender-aware IPC. The generic adapter intentionally is
 * not used because it discards the Electron sender authority needed for a
 * user/workspace state mutation.
 */
export const registerTrustedPackageAppGroupIpcBridge = <Sender>({
  host,
  service,
  verifySender,
}: TrustedPackageAppGroupIpcOptions<Sender>): (() => void) => {
  const authorize = async (sender: Sender): Promise<void> => {
    let trusted = false;
    try {
      trusted = await verifySender(sender);
    } catch {
      trusted = false;
    }
    if (!trusted) throw new Error('Untrusted package app group sender.');
  };

  const denied = (): PackageAppGroupBridgeResult<never> => ({ ok: false, code: 'APP_GROUP_BRIDGE_UNAUTHORIZED' });
  const invalid = (): PackageAppGroupBridgeResult<never> => ({ ok: false, code: 'APP_GROUP_REQUEST_INVALID' });

  const register = (
    channel: string,
    parse: (payload: unknown) => unknown,
    invoke: (payload: unknown) => Promise<PackageAppGroupDocument>
  ): void => {
    host.handle(channel, async (sender, payload) => {
      if (!isPayloadWithinLimit(payload)) return invalid();
      try {
        parse(payload);
      } catch {
        return invalid();
      }
      try {
        await authorize(sender);
      } catch {
        return denied();
      }
      return resolve(() => invoke(payload));
    });
  };

  register(PACKAGE_APP_GROUP_NATIVE_CHANNELS.read, parsePackageAppGroupReadRequest, (payload) =>
    service.read(parsePackageAppGroupReadRequest(payload))
  );
  register(PACKAGE_APP_GROUP_NATIVE_CHANNELS.create, parsePackageAppGroupCreateRequest, (payload) =>
    service.create(parsePackageAppGroupCreateRequest(payload))
  );
  register(PACKAGE_APP_GROUP_NATIVE_CHANNELS.rename, parsePackageAppGroupRenameRequest, (payload) =>
    service.rename(parsePackageAppGroupRenameRequest(payload))
  );
  register(PACKAGE_APP_GROUP_NATIVE_CHANNELS.reorder, parsePackageAppGroupReorderRequest, (payload) =>
    service.reorder(parsePackageAppGroupReorderRequest(payload))
  );
  register(PACKAGE_APP_GROUP_NATIVE_CHANNELS.remove, parsePackageAppGroupRemoveRequest, (payload) =>
    service.remove(parsePackageAppGroupRemoveRequest(payload))
  );

  return () => {
    for (const channel of Object.values(PACKAGE_APP_GROUP_NATIVE_CHANNELS)) host.removeHandler(channel);
  };
};
