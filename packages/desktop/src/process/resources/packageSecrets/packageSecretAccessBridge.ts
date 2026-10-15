import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { PACKAGE_SECRETS_ACCESS_CHANNEL } from '@/common/types/platform/sessionSecrets';
import type { PackageSecretAccess } from './packageSecretAccess';

const PACKAGE_ID = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);
const HANDLE = z
  .string()
  .min(10)
  .max(300)
  .regex(/^secret:\/\/[A-Za-z0-9/_.-]+$/u);
const REQUEST_ID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/u);

const REQUEST = z.discriminatedUnion('action', [
  z.object({ action: z.literal('overview'), packageId: PACKAGE_ID }).strict(),
  z.object({ action: z.literal('approve'), packageId: PACKAGE_ID, requestId: REQUEST_ID }).strict(),
  z.object({ action: z.literal('deny'), packageId: PACKAGE_ID, requestId: REQUEST_ID }).strict(),
  z.object({ action: z.literal('grant'), packageId: PACKAGE_ID, handle: HANDLE }).strict(),
  z.object({ action: z.literal('revoke'), packageId: PACKAGE_ID, handle: HANDLE }).strict(),
]);

/** Receipts never carry a label, a handle, a reason or a value. */
type Audit = { subjectId: string; operation: string; status: 'completed' | 'failed' };

type Options = {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  /** Whether the Package App is installed. Only an installed package can hold access. */
  packageInstalled: (packageId: string) => Promise<boolean>;
  access: PackageSecretAccess;
  /** Native approval naming the package and the set, for the two actions that give a package access. */
  confirmGrant: (event: IpcMainInvokeEvent, detail: { packageId: string; label: string }) => Promise<boolean>;
  audit: (record: Audit) => Promise<void>;
};

/**
 * The person's controls over which general app secrets a Package App may use. The package asks (through the
 * `tomny_secret_request_access` tool or a Main-side request); only an approval made here, behind a native dialog,
 * turns a request into a grant. Responses are metadata only.
 */
export const registerPackageSecretAccessBridge = (options: Options): (() => void) => {
  let active = true;
  const done = (packageId: string, operation: string, succeeded = true): Promise<void> =>
    options.audit({ subjectId: packageId, operation, status: succeeded ? 'completed' : 'failed' });

  options.ipcMain.handle(PACKAGE_SECRETS_ACCESS_CHANNEL, async (event, raw: unknown) => {
    try {
      if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
      const parsed = REQUEST.safeParse(raw);
      if (!parsed.success) return { ok: false, error: 'INVALID_REQUEST' };
      const request = parsed.data;
      const { packageId } = request;
      if (!(await options.packageInstalled(packageId))) return { ok: false, error: 'NOT_FOUND' };
      if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };

      switch (request.action) {
        case 'overview':
          return { ok: true, data: await options.access.overview(packageId) };
        case 'deny': {
          const removed = options.access.deny(packageId, request.requestId);
          await done(packageId, 'access-deny', removed);
          return { ok: true, data: removed };
        }
        case 'revoke': {
          const removed = await options.access.revoke(packageId, request.handle);
          await done(packageId, 'access-revoke', removed);
          return { ok: true, data: removed };
        }
        case 'approve': {
          const overview = await options.access.overview(packageId);
          const pending = overview.pending.find((item) => item.id === request.requestId);
          if (!pending) return { ok: false, error: 'NOT_FOUND' };
          if (!(await options.confirmGrant(event, { packageId, label: pending.label }))) {
            return { ok: false, error: 'CANCELLED' };
          }
          if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
          // The package may have been uninstalled while the dialog was open.
          if (!(await options.packageInstalled(packageId))) return { ok: false, error: 'NOT_FOUND' };
          const granted = await options.access.approve(packageId, request.requestId);
          await done(packageId, 'access-approve', granted);
          return { ok: true, data: granted };
        }
        case 'grant': {
          const overview = await options.access.overview(packageId);
          const target = overview.available.find((item) => item.handle === request.handle);
          if (!target) return { ok: false, error: 'NOT_FOUND' };
          if (!(await options.confirmGrant(event, { packageId, label: target.label }))) {
            return { ok: false, error: 'CANCELLED' };
          }
          if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
          if (!(await options.packageInstalled(packageId))) return { ok: false, error: 'NOT_FOUND' };
          const granted = await options.access.grant(packageId, request.handle);
          await done(packageId, 'access-grant', granted);
          return { ok: true, data: granted };
        }
      }
    } catch {
      return { ok: false, error: 'IO_ERROR' };
    }
  });

  return () => {
    active = false;
    options.ipcMain.removeHandler(PACKAGE_SECRETS_ACCESS_CHANNEL);
  };
};
