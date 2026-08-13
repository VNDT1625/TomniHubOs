/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { LinkedMicrosoftAppRecord } from '../../../../common/packages';
import {
  MICROSOFT_STORE_NATIVE_CHANNELS,
  type MicrosoftStoreNativeAction,
  type MicrosoftStoreNativeConsentGrant,
  type MicrosoftStoreNativeConsentRequest,
  type MicrosoftStoreNativeErrorCode,
  type MicrosoftStoreNativeExecuteRequest,
  type MicrosoftStoreNativeExecutionReceipt,
  type MicrosoftStoreNativeOpenPageReceipt,
  type MicrosoftStoreNativeOpenPageRequest,
  type MicrosoftStoreNativeResult,
} from '../../../../common/types/platform/electron';
import { createCatalogActionConsentAuthority, type CatalogActionConsentAuthority } from './actionLedger';
import {
  assertLinkedAppMayRun,
  normalizeProductId,
  parseLimit,
  parseLinkedMicrosoftAppRecord,
  parseMicrosoftProductId,
  parseRegion,
  parseSearchQuery,
  verifyLinkedIdentity,
} from './validation';
import {
  CatalogFederationError,
  type InstalledMicrosoftAppIdentity,
  type MicrosoftStoreSearchHit,
  type SafeFileRunner,
  type WindowsMicrosoftStoreAdapter,
  type WindowsMicrosoftStoreAdapterDeps,
} from './types';

const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;

export const runSafeFile: SafeFileRunner = async (executable, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        windowsHide: true,
        shell: false,
        timeout: options.timeoutMs,
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new CatalogFederationError('CATALOG_SOURCE_UNAVAILABLE', `${executable} operation failed.`, {
              cause: error,
            })
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    );
  });

export const parseWingetMicrosoftStoreSearch = (output: string, limit: number): MicrosoftStoreSearchHit[] => {
  const lines = output.replaceAll('\r', '').split('\n');
  const dividerIndex = lines.findIndex((line) => /^-{8,}\s*$/.test(line.trim()));
  if (dividerIndex < 0) return [];
  const hits: MicrosoftStoreSearchHit[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(dividerIndex + 1)) {
    const match = /^(.*?)\s+([A-Za-z0-9]{8,32})\s+(\S+)\s*$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    let productId: string;
    try {
      productId = parseMicrosoftProductId(match[2]);
    } catch {
      continue;
    }
    if (seen.has(productId)) continue;
    seen.add(productId);
    hits.push({
      productId,
      name: match[1].trim(),
      ...(match[3] && match[3].toLocaleLowerCase() !== 'unknown' ? { version: match[3] } : {}),
    });
    if (hits.length >= limit) break;
  }
  return hits;
};

const POWERSHELL_IDENTITY_SCRIPT = `
$target = $env:TOMNI_LINKED_APP_PFN
$package = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $target } | Select-Object -First 1
if ($null -eq $package) { Write-Output '{}'; exit 0 }
[pscustomobject]@{
  packageFamilyName = $package.PackageFamilyName
  publisherIdentity = $package.Publisher
  version = $package.Version.ToString()
} | ConvertTo-Json -Compress
`.trim();

const encodedPowerShellIdentityScript = Buffer.from(POWERSHELL_IDENTITY_SCRIPT, 'utf16le').toString('base64');

const parseInstalledIdentity = (output: string): InstalledMicrosoftAppIdentity | undefined => {
  const text = output.trim();
  if (!text || text === '{}') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new CatalogFederationError('CATALOG_SOURCE_UNAVAILABLE', 'Windows app identity response is invalid.', {
      cause: error,
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogFederationError('CATALOG_SOURCE_UNAVAILABLE', 'Windows app identity response is invalid.');
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.packageFamilyName !== 'string' ||
    typeof raw.publisherIdentity !== 'string' ||
    typeof raw.version !== 'string'
  ) {
    throw new CatalogFederationError('CATALOG_SOURCE_UNAVAILABLE', 'Windows app identity response is incomplete.');
  }
  return {
    packageFamilyName: raw.packageFamilyName,
    publisherIdentity: raw.publisherIdentity,
    version: raw.version,
  };
};

export const createWindowsMicrosoftStoreAdapter = ({
  runFile = runSafeFile,
  openExternal = async (uri: string): Promise<void> => {
    const { shell } = await import('electron');
    await shell.openExternal(uri);
  },
}: WindowsMicrosoftStoreAdapterDeps = {}): WindowsMicrosoftStoreAdapter => {
  const inspectInstalled = async (
    record: LinkedMicrosoftAppRecord
  ): Promise<InstalledMicrosoftAppIdentity | undefined> => {
    const result = await runFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShellIdentityScript],
      {
        timeoutMs: 30_000,
        env: { TOMNI_LINKED_APP_PFN: record.microsoft.packageFamilyName },
      }
    );
    return parseInstalledIdentity(result.stdout);
  };

  return {
    search: async (rawQuery, rawLimit) => {
      const query = parseSearchQuery(rawQuery);
      const limit = parseLimit(rawLimit);
      const result = await runFile(
        'winget',
        [
          'search',
          '--source',
          'msstore',
          '--query',
          query,
          '--count',
          String(limit),
          '--accept-source-agreements',
          '--disable-interactivity',
        ],
        { timeoutMs: 30_000 }
      );
      return parseWingetMicrosoftStoreSearch(result.stdout, limit);
    },
    installLinked: async (rawRecord, rawRegion) => {
      const record = parseLinkedMicrosoftAppRecord(rawRecord);
      const region = parseRegion(rawRegion);
      assertLinkedAppMayRun(record, region);
      await runFile(
        'winget',
        [
          'install',
          '--id',
          record.microsoft.productId,
          '--source',
          'msstore',
          '--exact',
          '--accept-package-agreements',
          '--accept-source-agreements',
          '--disable-interactivity',
        ],
        { timeoutMs: 15 * 60_000 }
      );
      return verifyLinkedIdentity(record, await inspectInstalled(record));
    },
    launchLinked: async (rawRecord, rawRegion) => {
      const record = parseLinkedMicrosoftAppRecord(rawRecord);
      const region = parseRegion(rawRegion);
      assertLinkedAppMayRun(record, region);
      if (!record.activation) {
        throw new CatalogFederationError(
          'CATALOG_ACTION_UNSUPPORTED',
          'Linked app does not publish an activation URI.'
        );
      }
      const identity = verifyLinkedIdentity(record, await inspectInstalled(record));
      await openExternal(record.activation.uri);
      return identity;
    },
    openStoreProduct: async (rawProductId) => {
      const productId = parseMicrosoftProductId(normalizeProductId(rawProductId));
      const uri = new URL('ms-windows-store://pdp/');
      uri.searchParams.set('ProductId', productId);
      await openExternal(uri.toString());
    },
  };
};

const MICROSOFT_STORE_OWNER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_MICROSOFT_STORE_ACTION_TEXT = 200;

class MicrosoftStoreNativeBoundaryError extends Error {
  constructor(readonly code: MicrosoftStoreNativeErrorCode) {
    super(code);
    this.name = 'MicrosoftStoreNativeBoundaryError';
  }
}

const requireExactRecord = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_REQUEST_INVALID');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).toSorted();
  const expectedKeys = [...keys].toSorted();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_REQUEST_INVALID');
  }
  return record;
};

const requireActionText = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length === 0 ||
    value.length > MAX_MICROSOFT_STORE_ACTION_TEXT ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  ) {
    throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_REQUEST_INVALID');
  }
  return value;
};

const parseMicrosoftStoreAction = (value: unknown): MicrosoftStoreNativeAction => {
  if (value !== 'install' && value !== 'launch') {
    throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_REQUEST_INVALID');
  }
  return value;
};

const parseMicrosoftStoreOpenPageRequest = (value: unknown): MicrosoftStoreNativeOpenPageRequest => {
  const input = requireExactRecord(value, ['productId']);
  try {
    return { productId: parseMicrosoftProductId(normalizeProductId(requireActionText(input.productId))) };
  } catch (error) {
    if (error instanceof MicrosoftStoreNativeBoundaryError) throw error;
    throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_REQUEST_INVALID');
  }
};

const parseMicrosoftStoreConsentRequest = (value: unknown): MicrosoftStoreNativeConsentRequest => {
  const input = requireExactRecord(value, ['action', 'linkedAppId', 'region', 'idempotencyKey']);
  try {
    return {
      action: parseMicrosoftStoreAction(input.action),
      linkedAppId: requireActionText(input.linkedAppId),
      region: parseRegion(requireActionText(input.region)),
      idempotencyKey: requireActionText(input.idempotencyKey),
    };
  } catch (error) {
    if (error instanceof MicrosoftStoreNativeBoundaryError) throw error;
    throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_REQUEST_INVALID');
  }
};

const parseMicrosoftStoreExecuteRequest = (value: unknown): MicrosoftStoreNativeExecuteRequest => {
  const input = requireExactRecord(value, ['action', 'linkedAppId', 'region', 'idempotencyKey', 'consentId']);
  try {
    return {
      action: parseMicrosoftStoreAction(input.action),
      linkedAppId: requireActionText(input.linkedAppId),
      region: parseRegion(requireActionText(input.region)),
      idempotencyKey: requireActionText(input.idempotencyKey),
      consentId: requireActionText(input.consentId),
    };
  } catch (error) {
    if (error instanceof MicrosoftStoreNativeBoundaryError) throw error;
    throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_REQUEST_INVALID');
  }
};

const consentSubject = (record: LinkedMicrosoftAppRecord): string => {
  const digest = createHash('sha256').update(JSON.stringify(record)).digest('hex');
  return `${record.microsoft.productId}:${digest}`;
};

const executionFingerprint = (request: MicrosoftStoreNativeExecuteRequest): string =>
  createHash('sha256')
    .update(JSON.stringify([request.action, request.linkedAppId, request.region]))
    .digest('hex');

const DEFAULT_MAX_MICROSOFT_STORE_RECEIPTS = 512;
const MAX_MICROSOFT_STORE_RECEIPTS = 4_096;

type MicrosoftStoreTrustedAction = MicrosoftStoreNativeConsentRequest & {
  ownerId: string;
  record: LinkedMicrosoftAppRecord;
};

type MicrosoftStoreExecutionEntry = {
  fingerprint: string;
  ownerId: string;
  operation: Promise<MicrosoftStoreNativeExecutionReceipt>;
};

export type MicrosoftStoreNativeRuntime = {
  requestConsent(
    request: MicrosoftStoreNativeConsentRequest & { ownerId: string }
  ): Promise<MicrosoftStoreNativeConsentGrant>;
  execute(
    request: MicrosoftStoreNativeExecuteRequest & { ownerId: string }
  ): Promise<MicrosoftStoreNativeExecutionReceipt>;
  openStorePage(
    request: MicrosoftStoreNativeOpenPageRequest & { ownerId: string }
  ): Promise<MicrosoftStoreNativeOpenPageReceipt>;
  revokeOwner(ownerId: string): void;
};

export const createMicrosoftStoreNativeRuntime = (options: {
  adapter: WindowsMicrosoftStoreAdapter;
  loadLinkedApp(
    linkedAppId: string
  ): LinkedMicrosoftAppRecord | undefined | Promise<LinkedMicrosoftAppRecord | undefined>;
  confirmAction(action: MicrosoftStoreTrustedAction): boolean | Promise<boolean>;
  consent?: CatalogActionConsentAuthority;
  createReceiptId?: () => string;
  maxExecutionReceipts?: number;
}): MicrosoftStoreNativeRuntime => {
  const consent = options.consent ?? createCatalogActionConsentAuthority();
  const createReceiptId = options.createReceiptId ?? randomUUID;
  const maxExecutionReceipts = options.maxExecutionReceipts ?? DEFAULT_MAX_MICROSOFT_STORE_RECEIPTS;
  if (
    !Number.isSafeInteger(maxExecutionReceipts) ||
    maxExecutionReceipts < 1 ||
    maxExecutionReceipts > MAX_MICROSOFT_STORE_RECEIPTS
  ) {
    throw new RangeError('Microsoft Store execution receipt capacity is invalid.');
  }
  const executions = new Map<string, MicrosoftStoreExecutionEntry>();
  const loadTrustedRecord = async (request: MicrosoftStoreNativeConsentRequest): Promise<LinkedMicrosoftAppRecord> => {
    try {
      const loaded = await options.loadLinkedApp(request.linkedAppId);
      if (!loaded) throw new Error('Linked app is unavailable.');
      const record = parseLinkedMicrosoftAppRecord(loaded);
      if (record.id !== request.linkedAppId) throw new Error('Linked app identity does not match.');
      assertLinkedAppMayRun(record, request.region);
      return record;
    } catch {
      throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_CONSENT_DENIED');
    }
  };

  return {
    openStorePage: async (request) => {
      const productId = parseMicrosoftProductId(normalizeProductId(request.productId));
      await options.adapter.openStoreProduct(productId);
      return { productId };
    },
    requestConsent: async (request) => {
      const record = await loadTrustedRecord(request);
      const approved = await options.confirmAction({ ...request, record: structuredClone(record) });
      if (!approved) throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_CONSENT_DENIED');
      const grant = consent.recordUserDecision({
        action: request.action,
        source: 'microsoft-store',
        sourceItemId: consentSubject(record),
        region: request.region,
        ownerId: request.ownerId,
        idempotencyKey: request.idempotencyKey,
        approved: true,
      });
      if (!grant) throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_CONSENT_DENIED');
      return { consentId: grant.consentId, expiresAt: grant.expiresAt };
    },
    execute: (request) => {
      const key = `${request.ownerId}\u0000${request.idempotencyKey}`;
      const fingerprint = executionFingerprint(request);
      const existing = executions.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_REQUEST_INVALID');
        }
        return existing.operation;
      }
      if (executions.size >= maxExecutionReceipts) {
        throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_ACTION_FAILED');
      }
      const operation = (async (): Promise<MicrosoftStoreNativeExecutionReceipt> => {
        const record = await loadTrustedRecord(request);
        const decision = await consent.authorize({
          action: request.action,
          source: 'microsoft-store',
          sourceItemId: consentSubject(record),
          region: request.region,
          ownerId: request.ownerId,
          idempotencyKey: request.idempotencyKey,
          consentId: request.consentId,
        });
        if (!decision.allowed) {
          throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_CONSENT_DENIED');
        }
        const identity =
          request.action === 'install'
            ? await options.adapter.installLinked(record, request.region)
            : await options.adapter.launchLinked(record, request.region);
        return {
          receiptId: requireActionText(createReceiptId()),
          action: request.action,
          linkedAppId: request.linkedAppId,
          identity,
        };
      })();
      executions.set(key, { fingerprint, ownerId: request.ownerId, operation });
      return operation;
    },
    revokeOwner: (ownerId) => {
      consent.revokeOwner(ownerId);
      for (const [key, entry] of executions) {
        if (entry.ownerId === ownerId) executions.delete(key);
      }
    },
  };
};

export type TrustedMicrosoftStoreNativeIpcHost<Sender> = {
  handle(
    channel: string,
    handler: (sender: Sender, payload: unknown) => Promise<MicrosoftStoreNativeResult<unknown>>
  ): void;
  removeHandler(channel: string): void;
};

export const registerTrustedMicrosoftStoreNativeIpcBridge = <Sender>(options: {
  host: TrustedMicrosoftStoreNativeIpcHost<Sender>;
  runtime: MicrosoftStoreNativeRuntime;
  verifySender(sender: Sender): boolean | Promise<boolean>;
  identifySender(sender: Sender): string | undefined;
  subscribeOwnerUnavailable?(listener: (ownerId: string) => void): () => void;
}): (() => void) => {
  const invoke = async <Request extends object, Result>(
    sender: Sender,
    payload: unknown,
    parse: (value: unknown) => Request,
    execute: (request: Request & { ownerId: string }) => Result | Promise<Result>,
    failureCode: MicrosoftStoreNativeErrorCode
  ): Promise<MicrosoftStoreNativeResult<Result>> => {
    try {
      if (!(await options.verifySender(sender))) {
        throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_SENDER_UNTRUSTED');
      }
      const ownerId = options.identifySender(sender);
      if (!ownerId || !MICROSOFT_STORE_OWNER_ID.test(ownerId)) {
        throw new MicrosoftStoreNativeBoundaryError('MICROSOFT_STORE_OWNER_UNAVAILABLE');
      }
      return { ok: true, data: await execute({ ...parse(payload), ownerId }) };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof MicrosoftStoreNativeBoundaryError ? error.code : failureCode,
      };
    }
  };

  const registeredChannels: string[] = [];
  try {
    options.host.handle(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent, (sender, payload) =>
      invoke(
        sender,
        payload,
        parseMicrosoftStoreConsentRequest,
        (request) => options.runtime.requestConsent(request),
        'MICROSOFT_STORE_BRIDGE_FAILURE'
      )
    );
    registeredChannels.push(MICROSOFT_STORE_NATIVE_CHANNELS.requestConsent);
    options.host.handle(MICROSOFT_STORE_NATIVE_CHANNELS.execute, (sender, payload) =>
      invoke(
        sender,
        payload,
        parseMicrosoftStoreExecuteRequest,
        (request) => options.runtime.execute(request),
        'MICROSOFT_STORE_ACTION_FAILED'
      )
    );
    registeredChannels.push(MICROSOFT_STORE_NATIVE_CHANNELS.execute);
    options.host.handle(MICROSOFT_STORE_NATIVE_CHANNELS.openStorePage, (sender, payload) =>
      invoke(
        sender,
        payload,
        parseMicrosoftStoreOpenPageRequest,
        (request) => options.runtime.openStorePage(request),
        'MICROSOFT_STORE_ACTION_FAILED'
      )
    );
    registeredChannels.push(MICROSOFT_STORE_NATIVE_CHANNELS.openStorePage);
  } catch (error) {
    for (const channel of registeredChannels) options.host.removeHandler(channel);
    throw error;
  }

  const unsubscribeOwnerUnavailable = options.subscribeOwnerUnavailable?.((ownerId) => {
    if (MICROSOFT_STORE_OWNER_ID.test(ownerId)) options.runtime.revokeOwner(ownerId);
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribeOwnerUnavailable?.();
    for (const channel of registeredChannels) options.host.removeHandler(channel);
  };
};
