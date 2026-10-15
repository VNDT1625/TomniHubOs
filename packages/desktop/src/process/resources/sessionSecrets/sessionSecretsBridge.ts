import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import type { SecretRequestStore } from '@process/agentRuntime/agentMesh/mcp/secret-context/requests';
import type { SecretCaller, SecretDescriptor, SecretScope } from '@process/agentRuntime/contextTypes';
import { secretVisibleTo, type SecretVault } from '@process/agentRuntime/secretVault';
import {
  SECRET_DESTINATIONS,
  SECRET_SET_LIMITS,
  type SecretRequestView,
  type SecretSetView,
  type SecretsListing,
} from '@/common/types/platform/sessionSecrets';
import { bindingForDestinations, destinationsOfBinding, OWNER_REVEAL_PURPOSE, OWNER_SURFACE } from './destinations';

type Operation = 'list' | 'save' | 'remove' | 'reveal' | 'dismissRequest';
type Channels = Readonly<Record<Operation, string>>;

const SCOPE_ID = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9._:@-]+$/);
const HANDLE = z
  .string()
  .min(10)
  .max(300)
  .regex(/^secret:\/\/[A-Za-z0-9/_.-]+$/);
const VARIABLE_NAME = z
  .string()
  .trim()
  .min(1)
  .max(SECRET_SET_LIMITS.maxNameChars)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const SET = z
  .object({
    handle: HANDLE.optional(),
    requestId: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/)
      .optional(),
    label: z.string().trim().min(1).max(SECRET_SET_LIMITS.maxLabelChars),
    note: z.string().trim().max(SECRET_SET_LIMITS.maxNoteChars).optional(),
    destinations: z.array(z.enum(SECRET_DESTINATIONS)).min(1).max(SECRET_DESTINATIONS.length),
    hosts: z.array(z.string().trim().min(1).max(253)).max(SECRET_SET_LIMITS.maxHosts).optional(),
    variables: z
      .array(z.object({ name: VARIABLE_NAME, value: z.string().min(1).max(SECRET_SET_LIMITS.maxValueChars) }).strict())
      .min(1)
      .max(SECRET_SET_LIMITS.maxVariables)
      .refine((variables) => new Set(variables.map((variable) => variable.name)).size === variables.length),
  })
  .strict();

/** Receipts never carry a label, a variable name or a value. */
type Audit = {
  subjectId: string;
  operation: 'save' | 'remove' | 'reveal' | 'dismiss-request';
  status: 'completed' | 'failed';
};

type Resolved = { scope: SecretScope; caller: SecretCaller; requestKey: string };

type Options = {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  channels: Channels;
  /** Which request field carries the scope owner: a conversation, a company or a Package App. */
  idKey: 'sessionId' | 'companyId' | 'packageId';
  /** Whether app-scoped sets are shown (read-only) beside this scope's own sets. */
  includeAppSets: boolean;
  /** Permanent scopes are encrypted with the OS keychain and fail closed without it; RAM scopes need none. */
  requiresKeychain: boolean;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  /** Maps the id the renderer gave to its vault scope and caller identity, or undefined when it does not exist. */
  resolve: (id: string) => Promise<Resolved | undefined>;
  store: SecretVault;
  /** Agent requests (`tomny_secret_request`); only the session scope has them. */
  requests?: SecretRequestStore;
  keychainAvailable: () => boolean;
  /** Native approval for the two destructive or high-risk actions. */
  confirm: (event: IpcMainInvokeEvent, operation: 'remove' | 'reveal') => Promise<boolean>;
  audit: (record: Audit) => Promise<void>;
};

const sameScope = (left: SecretScope | undefined, right: SecretScope): boolean => {
  if (!left || left.kind === 'app') return right.kind === 'app';
  if (left.kind === 'company') return right.kind === 'company' && right.companyId === left.companyId;
  if (left.kind === 'package') return right.kind === 'package' && right.packageId === left.packageId;
  return right.kind === 'session' && right.sessionId === left.sessionId;
};

const toRequestView = (request: ReturnType<SecretRequestStore['list']>[number]): SecretRequestView => ({
  id: request.id,
  label: request.label,
  note: request.note,
  fields: [...request.fields],
  destinations: [
    ...new Set(request.destinations.map((destination) => (destination === 'deploy' ? 'process' : destination))),
  ],
  ...(request.hosts && request.hosts.length > 0 ? { hosts: [...request.hosts] } : {}),
  createdAt: request.createdAt,
});

/**
 * Sender-bound human controls for the secret sets of one scope (a conversation, or a company). Responses carry
 * metadata only, except the one natively approved `reveal`; failures collapse to stable codes so a vault error can
 * never echo a value.
 */
export const registerScopedSecretsBridge = (options: Options): (() => void) => {
  let active = true;
  const idKey = options.idKey;
  const base = z.object({ [idKey]: SCOPE_ID } as Record<string, typeof SCOPE_ID>).strict();
  const schemas: Record<Operation, z.ZodType> = {
    list: base,
    save: base.extend({ set: SET }).strict(),
    remove: base.extend({ handle: HANDLE }).strict(),
    reveal: base.extend({ handle: HANDLE, field: VARIABLE_NAME }).strict(),
    dismissRequest: base.extend({
      requestId: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z0-9-]+$/),
    }),
  };

  const attempt = async (record: Audit, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      await options.audit({ ...record, status: 'failed' }).catch((): undefined => undefined);
      throw error;
    }
    await options.audit(record);
  };

  const userFacing = (item: SecretDescriptor, now: number): boolean =>
    item.revokedAt === undefined &&
    (item.expiresAt === undefined || item.expiresAt > now) &&
    destinationsOfBinding(item.binding).destinations.length > 0;

  const toView = (item: SecretDescriptor): SecretSetView => {
    const { destinations, hosts } = destinationsOfBinding(item.binding);
    return {
      handle: item.handle,
      label: item.label,
      ...(item.note ? { note: item.note } : {}),
      fields: [...item.fields],
      scope: item.scope?.kind ?? 'app',
      destinations,
      ...(hosts ? { hosts } : {}),
      updatedAt: item.updatedAt,
    };
  };

  for (const operation of Object.keys(options.channels) as Operation[]) {
    options.ipcMain.handle(options.channels[operation], async (event, raw: unknown) => {
      try {
        if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
        const parsed = schemas[operation].safeParse(raw);
        if (!parsed.success) return { ok: false, error: 'INVALID_REQUEST' };
        const request = parsed.data as Record<string, unknown>;
        const subjectId = request[idKey] as string;
        const resolved = await options.resolve(subjectId);
        if (!resolved) return { ok: false, error: 'NOT_FOUND' };
        if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
        const { scope, caller, requestKey } = resolved;
        const receipt = (name: Audit['operation']): Audit => ({ subjectId, operation: name, status: 'completed' });
        const own = async (): Promise<SecretDescriptor[]> => {
          const now = Date.now();
          return (await options.store.list()).filter((item) => sameScope(item.scope, scope) && userFacing(item, now));
        };

        switch (operation) {
          case 'list': {
            const now = Date.now();
            const sets = (await options.store.list())
              .filter((item) => {
                const mine = sameScope(item.scope, scope);
                const app = options.includeAppSets && (!item.scope || item.scope.kind === 'app');
                return (mine || app) && secretVisibleTo(item, caller) && userFacing(item, now);
              })
              .map(toView);
            const listing: SecretsListing = {
              sets,
              requests: (options.requests?.list(requestKey) ?? []).map(toRequestView),
              keychainAvailable: options.keychainAvailable(),
            };
            return { ok: true, data: listing };
          }
          case 'save': {
            const input = request.set as z.infer<typeof SET>;
            let binding: ReturnType<typeof bindingForDestinations>;
            try {
              binding = bindingForDestinations(input.destinations, input.hosts);
            } catch {
              return { ok: false, error: 'INVALID_REQUEST' };
            }
            if (options.requiresKeychain && !options.keychainAvailable()) {
              return { ok: false, error: 'KEYCHAIN_UNAVAILABLE' };
            }
            if (input.handle && !(await own()).some((item) => item.handle === input.handle)) {
              return { ok: false, error: 'NOT_FOUND' };
            }
            const descriptorInput = {
              label: input.label,
              ...(input.note ? { note: input.note } : {}),
              kind: 'credential' as const,
              fields: input.variables.map((variable) => variable.name),
              binding,
              ...(scope.kind === 'app' ? {} : { scope }),
            };
            const payload = Object.fromEntries(input.variables.map((variable) => [variable.name, variable.value]));
            let saved: SecretDescriptor | undefined;
            await attempt(receipt('save'), async () => {
              saved = input.handle
                ? await options.store.replace(input.handle, descriptorInput, payload)
                : await options.store.put(descriptorInput, payload);
            });
            if (input.requestId) options.requests?.dismiss(requestKey, input.requestId);
            return { ok: true, data: toView(saved as SecretDescriptor) };
          }
          case 'remove': {
            const handle = request.handle as string;
            if (!(await own()).some((item) => item.handle === handle)) return { ok: false, error: 'NOT_FOUND' };
            if (!(await options.confirm(event, 'remove'))) return { ok: false, error: 'CANCELLED' };
            if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
            await attempt(receipt('remove'), async () => {
              await options.store.remove(handle);
            });
            return { ok: true, data: true };
          }
          case 'reveal': {
            const handle = request.handle as string;
            const field = request.field as string;
            const target = (await own()).find((item) => item.handle === handle);
            if (!target?.fields.includes(field)) return { ok: false, error: 'NOT_FOUND' };
            if (!(await options.confirm(event, 'reveal'))) return { ok: false, error: 'CANCELLED' };
            if (!active || !options.verifySender(event)) return { ok: false, error: 'DENIED' };
            let value = '';
            await attempt(receipt('reveal'), async () => {
              const payload = await options.store.resolve({
                handle,
                fields: [field],
                surface: OWNER_SURFACE,
                purpose: OWNER_REVEAL_PURPOSE,
                caller,
              });
              value = payload[field] ?? '';
            });
            return { ok: true, data: value };
          }
          case 'dismissRequest': {
            const removed = options.requests?.dismiss(requestKey, request.requestId as string) ?? false;
            await options.audit(receipt('dismiss-request'));
            return { ok: true, data: removed };
          }
        }
      } catch {
        return { ok: false, error: 'IO_ERROR' };
      }
    });
  }
  return () => {
    active = false;
    for (const channel of Object.values(options.channels)) options.ipcMain.removeHandler(channel);
  };
};
