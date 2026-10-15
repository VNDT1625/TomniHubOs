import { randomBytes as nodeRandomBytes, randomUUID } from 'node:crypto';

import type { SecretCaller, SecretDescriptor, SecretKind, SecretScope } from '@process/agentRuntime/contextTypes';
import { secretVisibleTo, type SecretVault } from '@process/agentRuntime/secretVault';
import {
  getSecretRequestStore,
  type SecretDestination,
  type SecretRequest,
  type SecretRequestInput,
  type SecretRequestStore,
} from './requests';

export type SecretContextUseRequest = {
  handle: string;
  field: string;
  sink: string;
  locator: Readonly<Record<string, string>>;
  surface: string;
  purpose: string;
  target?: string;
  /** Host-resolved identity of the run; selects which session/company sets may resolve. */
  caller?: SecretCaller;
};

export type SecretContextUseReceipt = {
  receiptId: string;
  status: 'used';
  sink: string;
  surface: string;
  purpose: string;
  target?: string;
  usedAt: number;
};

export type SecretContextSink = (request: SecretContextUseRequest) => Promise<void>;

export type SecretContextCaptureRequest = {
  label: string;
  field: string;
  kind: SecretKind;
  tabId: string;
  selector: string;
  target: string;
  /** Where the captured set lives; absent means permanent app scope. */
  scope?: SecretScope;
};

export type SecretContextCaptureReceipt = {
  receiptId: string;
  status: 'captured';
  handle: string;
  field: string;
  capturedAt: number;
};

export type SecretContextGenerator = 'fernet-key' | 'api-key';

export type SecretContextGenerateRequest = {
  label: string;
  field: string;
  generator: SecretContextGenerator;
  scope?: SecretScope;
};

export type SecretContextGenerateReceipt = {
  receiptId: string;
  status: 'generated';
  handle: string;
  field: string;
  generatedAt: number;
};

export type SecretContextBrowserCapture = (request: {
  tabId: string;
  selector: string;
  target: string;
  field: string;
}) => Promise<string>;

export type SecretContextStoredEvent = {
  operation: 'capture' | 'generate';
  descriptor: SecretDescriptor;
};

export type SecretContextStoredCallback = (event: SecretContextStoredEvent) => Promise<void> | void;

type SecretContextVault = Pick<SecretVault, 'put' | 'list'>;

/** What an agent may learn about a set: where it lives and where it can be used. Never a value. */
export type SecretContextSetView = Readonly<{
  handle: string;
  label: string;
  note?: string;
  kind: SecretKind;
  fields: readonly string[];
  scope: 'app' | 'session' | 'company' | 'package';
  destinations: readonly SecretDestination[];
  hosts?: readonly string[];
}>;

const destinationsOf = (binding: SecretDescriptor['binding']): SecretDestination[] => {
  const result: SecretDestination[] = [];
  if (binding.surfaces.includes('secret-firewall') && binding.purposes.includes('opaque-use')) {
    result.push('process', 'deploy');
  }
  if (binding.surfaces.includes('browser') && binding.purposes.includes('browser-fill')) result.push('browser');
  if (binding.surfaces.includes('terminal') && binding.purposes.includes('terminal-input')) result.push('terminal');
  return result;
};
type RandomBytes = (size: number) => Uint8Array;

/** Asks the person for a Package App's access to one general app secret. Records a request; grants nothing. */
export type PackageAccessRequester = {
  requestAccess(
    packageId: string,
    input: { handle: string; reason: string }
  ): Promise<{ requestId?: string; status: 'pending' | 'already-granted' }>;
};

export type SecretContextUseRouterOptions = {
  now?: () => number;
  createReceiptId?: () => string;
  createCaptureReceiptId?: () => string;
  createGenerateReceiptId?: () => string;
  vault?: SecretContextVault;
  captureBrowserValue?: SecretContextBrowserCapture;
  randomBytes?: RandomBytes;
  onSecretStored?: SecretContextStoredCallback;
  requests?: SecretRequestStore;
  packageAccess?: PackageAccessRequester;
};

const GENERIC_USE_ERROR = 'Secret context use failed.';
const GENERIC_CAPTURE_ERROR = 'Secret context capture failed.';
const GENERIC_GENERATE_ERROR = 'Secret context generation failed.';
export const SECRET_FIREWALL_SURFACE = 'secret-firewall';
export const SECRET_FIREWALL_PURPOSE = 'opaque-use';
const GENERATED_SECRET_BYTES = 32;

const paddedBase64Url = (value: Uint8Array): string =>
  Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_');

const generatedValue = (generator: SecretContextGenerator, bytes: Uint8Array): string =>
  generator === 'fernet-key' ? paddedBase64Url(bytes) : Buffer.from(bytes).toString('base64url');

/**
 * Routes opaque capabilities directly to trusted Main-process sinks.
 * Requests and resolved values must never be logged, checkpointed or returned.
 */
export class SecretContextUseRouter {
  private readonly sinks = new Map<string, SecretContextSink>();
  private readonly now: () => number;
  private readonly createReceiptId: () => string;
  private readonly createCaptureReceiptId: () => string;
  private readonly createGenerateReceiptId: () => string;
  private readonly captureBrowserValue?: SecretContextBrowserCapture;
  private readonly randomBytes: RandomBytes;
  private vault?: SecretContextVault;
  private onSecretStored?: SecretContextStoredCallback;
  private readonly requests: SecretRequestStore;
  private packageAccess?: PackageAccessRequester;

  public constructor(options: SecretContextUseRouterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createReceiptId = options.createReceiptId ?? (() => `secret-use://${randomUUID()}`);
    this.createCaptureReceiptId = options.createCaptureReceiptId ?? (() => `secret-capture://${randomUUID()}`);
    this.createGenerateReceiptId = options.createGenerateReceiptId ?? (() => `secret-generate://${randomUUID()}`);
    this.vault = options.vault;
    this.captureBrowserValue = options.captureBrowserValue;
    this.randomBytes = options.randomBytes ?? nodeRandomBytes;
    this.onSecretStored = options.onSecretStored;
    this.requests = options.requests ?? getSecretRequestStore();
    this.packageAccess = options.packageAccess;
  }

  /** Sets this run may use, in user-facing scopes only. Internal credentials (Telegram, channels) never appear. */
  public async listVisible(caller: SecretCaller | undefined): Promise<SecretContextSetView[]> {
    if (!this.vault) throw new Error('Secret listing failed.');
    const time = this.now();
    return (await this.vault.list())
      .filter(
        (item) =>
          item.revokedAt === undefined &&
          (item.expiresAt === undefined || item.expiresAt > time) &&
          secretVisibleTo(item, caller)
      )
      .flatMap((item): SecretContextSetView[] => {
        const destinations = destinationsOf(item.binding);
        if (destinations.length === 0) return [];
        return [
          {
            handle: item.handle,
            label: item.label,
            ...(item.note ? { note: item.note } : {}),
            kind: item.kind,
            fields: [...item.fields],
            scope: item.scope?.kind ?? 'app',
            destinations,
            ...(destinations.includes('browser') && item.binding.targets ? { hosts: [...item.binding.targets] } : {}),
          },
        ];
      });
  }

  /** Record that the agent needs a secret from the person. Nothing is stored in the vault. */
  public request(sessionId: string, input: SecretRequestInput): { requestId: string; status: 'pending' } {
    const request: SecretRequest = this.requests.add(sessionId, input);
    return { requestId: request.id, status: 'pending' };
  }

  /** The active Package App asks for one of the person's general secrets. The person decides elsewhere. */
  public async requestPackageAccess(
    packageId: string,
    input: { handle: string; reason: string }
  ): Promise<{ requestId?: string; status: 'pending' | 'already-granted' }> {
    if (!this.packageAccess) throw new Error('Package secret access is unavailable.');
    return this.packageAccess.requestAccess(packageId, input);
  }

  public configurePackageAccess(access: PackageAccessRequester): void {
    this.packageAccess = access;
  }

  /** Attach the Main-process vault without exposing it through the MCP server. */
  public configureVault(vault: SecretContextVault): void {
    this.vault = vault;
  }

  /** Observe non-secret descriptor metadata after a successful vault write. */
  public configureStoredCallback(callback: SecretContextStoredCallback): void {
    this.onSecretStored = callback;
  }

  private async notifySecretStored(event: SecretContextStoredEvent): Promise<void> {
    // Session, company and package sets belong to their owner and never become part of the person's profile.
    if (event.descriptor.scope && event.descriptor.scope.kind !== 'app') return;
    try {
      await this.onSecretStored?.(structuredClone(event));
    } catch {
      // The encrypted secret is already durable. A metadata callback failure
      // must not encourage a retry that creates duplicate secret records.
    }
  }

  public registerSink(name: string, sink: SecretContextSink, replace = false): void {
    const normalized = name.trim().toLowerCase();
    if (!normalized) throw new Error('Secret context sink name cannot be empty.');
    if (!replace && this.sinks.has(normalized)) throw new Error(`Secret context sink ${normalized} already exists.`);
    this.sinks.set(normalized, sink);
  }

  public async use(request: SecretContextUseRequest): Promise<SecretContextUseReceipt> {
    const sinkName = request.sink.trim().toLowerCase();
    const sink = this.sinks.get(sinkName);
    if (!sink) throw new Error(GENERIC_USE_ERROR);
    try {
      await sink(request);
    } catch {
      throw new Error(GENERIC_USE_ERROR);
    }
    return {
      receiptId: this.createReceiptId(),
      status: 'used',
      sink: sinkName,
      surface: request.surface,
      purpose: request.purpose,
      ...(request.target ? { target: request.target } : {}),
      usedAt: this.now(),
    };
  }

  /** Capture one exact browser field and persist it without returning plaintext. */
  public async capture(request: SecretContextCaptureRequest): Promise<SecretContextCaptureReceipt> {
    if (!this.vault || !this.captureBrowserValue) throw new Error(GENERIC_CAPTURE_ERROR);
    try {
      const value = await this.captureBrowserValue({
        tabId: request.tabId,
        selector: request.selector,
        target: request.target,
        field: request.field,
      });
      const descriptor = await this.vault.put(
        {
          label: request.label,
          kind: request.kind,
          fields: [request.field],
          binding: {
            surfaces: [SECRET_FIREWALL_SURFACE, 'browser'],
            purposes: [SECRET_FIREWALL_PURPOSE, 'browser-fill'],
            targets: [request.target],
          },
          ...(request.scope ? { scope: request.scope } : {}),
        },
        { [request.field]: value }
      );
      await this.notifySecretStored({ operation: 'capture', descriptor });
      return {
        receiptId: this.createCaptureReceiptId(),
        status: 'captured',
        handle: descriptor.handle,
        field: request.field,
        capturedAt: this.now(),
      };
    } catch {
      throw new Error(GENERIC_CAPTURE_ERROR);
    }
  }

  /** Generate a fixed-format secret with CSPRNG bytes and persist it directly. */
  public async generate(request: SecretContextGenerateRequest): Promise<SecretContextGenerateReceipt> {
    if (!this.vault) throw new Error(GENERIC_GENERATE_ERROR);
    let bytes: Uint8Array | undefined;
    try {
      bytes = this.randomBytes(GENERATED_SECRET_BYTES);
      if (bytes.byteLength !== GENERATED_SECRET_BYTES) throw new Error(GENERIC_GENERATE_ERROR);
      const value = generatedValue(request.generator, bytes);
      const descriptor = await this.vault.put(
        {
          label: request.label,
          kind: request.generator === 'fernet-key' ? 'private-key' : 'token',
          fields: [request.field],
          binding: {
            surfaces: [SECRET_FIREWALL_SURFACE],
            purposes: [SECRET_FIREWALL_PURPOSE],
          },
          ...(request.scope ? { scope: request.scope } : {}),
        },
        { [request.field]: value }
      );
      await this.notifySecretStored({ operation: 'generate', descriptor });
      return {
        receiptId: this.createGenerateReceiptId(),
        status: 'generated',
        handle: descriptor.handle,
        field: request.field,
        generatedAt: this.now(),
      };
    } catch {
      throw new Error(GENERIC_GENERATE_ERROR);
    } finally {
      bytes?.fill(0);
    }
  }
}

export const createSecretContextUseRouter = (options?: SecretContextUseRouterOptions): SecretContextUseRouter =>
  new SecretContextUseRouter(options);
