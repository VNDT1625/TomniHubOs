import { randomBytes as nodeRandomBytes, randomUUID } from 'node:crypto';

import type { SecretDescriptor, SecretKind } from '@process/agentRuntime/contextTypes';
import type { SecretVault } from '@process/agentRuntime/secretVault';

export type SecretContextUseRequest = {
  handle: string;
  field: string;
  sink: string;
  locator: Readonly<Record<string, string>>;
  surface: string;
  purpose: string;
  target?: string;
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

type SecretContextVault = Pick<SecretVault, 'put'>;
type RandomBytes = (size: number) => Uint8Array;

export type SecretContextUseRouterOptions = {
  now?: () => number;
  createReceiptId?: () => string;
  createCaptureReceiptId?: () => string;
  createGenerateReceiptId?: () => string;
  vault?: SecretContextVault;
  captureBrowserValue?: SecretContextBrowserCapture;
  randomBytes?: RandomBytes;
  onSecretStored?: SecretContextStoredCallback;
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

  public constructor(options: SecretContextUseRouterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createReceiptId = options.createReceiptId ?? (() => `secret-use://${randomUUID()}`);
    this.createCaptureReceiptId = options.createCaptureReceiptId ?? (() => `secret-capture://${randomUUID()}`);
    this.createGenerateReceiptId = options.createGenerateReceiptId ?? (() => `secret-generate://${randomUUID()}`);
    this.vault = options.vault;
    this.captureBrowserValue = options.captureBrowserValue;
    this.randomBytes = options.randomBytes ?? nodeRandomBytes;
    this.onSecretStored = options.onSecretStored;
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
