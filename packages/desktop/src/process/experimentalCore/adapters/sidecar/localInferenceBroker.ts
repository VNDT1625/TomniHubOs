/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { RunIntent } from '../../../../common/foundation/runTypes';
import type { CoreModelPurpose, ModelPackRegistryRecord } from '../../catalog/modelPackTypes';
import type { CoreModelOutputValidationErrorCode, CoreModelOutputValidationResult } from './outputContractValidator';
import {
  TwoBaseRuntimeError,
  TwoBaseRuntimeRouter,
  type BaseRouteTelemetry,
  type LoadedBase,
  type TwoBaseLifecycleProvider,
  type TwoBaseRuntimeBindings,
} from './twoBaseRuntimeRouter';

export type CoreModelRequest = {
  requestId: string;
  purpose: CoreModelPurpose;
  contractVersion: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  /** Absolute Unix epoch deadline. */
  deadlineMs: number;
  payload: unknown;
  fallback: 'deterministic' | 'base-model' | 'abstain';
};

export type AdapterSlotPreparation =
  | {
      compatible: true;
      slotId: string;
      rank: number;
      alpha: number;
      poolId: LoadedBase['poolId'];
      baseSha256: string;
    }
  | {
      compatible: false;
      code: 'base-mismatch' | 'rank-mismatch' | 'alpha-mismatch' | 'runtime-incompatible' | 'load-failed';
      reason: string;
    };

export type CoreModelProviderOutput = {
  value: unknown;
  latencyMs?: number;
};

export type LocalInferenceProvider = TwoBaseLifecycleProvider & {
  prepareAdapter(
    record: ModelPackRegistryRecord,
    base: LoadedBase,
    signal: AbortSignal
  ): Promise<AdapterSlotPreparation>;
  infer(
    request: CoreModelRequest,
    record: ModelPackRegistryRecord,
    slot: Extract<AdapterSlotPreparation, { compatible: true }>,
    signal: AbortSignal
  ): Promise<CoreModelProviderOutput>;
};

export type ModelRegistryReader = {
  getActive(purpose: CoreModelPurpose): Promise<ModelPackRegistryRecord | undefined>;
};

export type CoreModelOutputValidator = {
  validate(schemaId: string, value: unknown): boolean | CoreModelOutputValidationResult;
};

export type CoreModelFallbacks = {
  deterministic?: (request: CoreModelRequest) => Promise<unknown> | unknown;
  baseModel?: (request: CoreModelRequest, signal: AbortSignal) => Promise<unknown>;
};

export type CoreModelResponse = {
  requestId: string;
  purpose: CoreModelPurpose;
  source: 'adapter' | 'deterministic' | 'base-model' | 'abstain';
  value?: unknown;
  baseModel?: { id: string; revision: string; sha256: string };
  adapter?: { id: string; version: string; key: string; slotId: string };
  contractVersion: string;
  outputSchema?: string;
  validation: 'passed' | 'failed' | 'validator-missing' | 'not-run';
  fallbackUsed: boolean;
  latencyMs: number;
  receiptId: string;

  runtime?: BaseRouteTelemetry;
  outputValidationError?: CoreModelOutputValidationErrorCode;
  failureCode?:
    | 'invalid-request'
    | 'deadline-exceeded'
    | 'adapter-unavailable'
    | 'contract-mismatch'
    | 'adapter-incompatible'
    | 'base-binding-mismatch'
    | 'base-switch-failed'
    | 'cancelled'
    | 'provider-failed'
    | 'output-invalid'
    | 'fallback-unavailable'
    | 'fallback-invalid';
};

export type LocalInferenceBrokerOptions = {
  baseBindings: TwoBaseRuntimeBindings;
  now?: () => number;
  createReceiptId?: (requestId: string) => string;
  resolveOutputSchema?: (purpose: CoreModelPurpose, contractVersion: string) => string | undefined;
};

class BrokerFailure extends Error {
  public constructor(
    public readonly code: NonNullable<CoreModelResponse['failureCode']>,
    message: string,
    public readonly outputValidationError?: CoreModelOutputValidationErrorCode
  ) {
    super(message);
    this.name = 'BrokerFailure';
  }
}

const responseLatency = (startedAt: number, now: () => number): number => Math.max(0, now() - startedAt);

/** Routes only to locally active adapters; every unsafe or unavailable path fails closed. */
export class LocalInferenceBroker {
  private readonly now: () => number;
  private readonly createReceiptId: (requestId: string) => string;
  private readonly resolveOutputSchema: (purpose: CoreModelPurpose, contractVersion: string) => string | undefined;
  private readonly router: TwoBaseRuntimeRouter;

  public constructor(
    private readonly registry: ModelRegistryReader,
    private readonly provider: LocalInferenceProvider,
    private readonly validator: CoreModelOutputValidator | undefined,
    private readonly fallbacks: CoreModelFallbacks = {},
    options: LocalInferenceBrokerOptions
  ) {
    this.now = options.now ?? Date.now;

    this.router = new TwoBaseRuntimeRouter(provider, options.baseBindings, this.now);
    this.createReceiptId = options.createReceiptId ?? ((requestId) => `${requestId}:${randomUUID()}`);
    this.resolveOutputSchema = options.resolveOutputSchema ?? (() => undefined);
  }

  public async infer(request: CoreModelRequest, signal?: AbortSignal): Promise<CoreModelResponse> {
    const startedAt = this.now();
    const receiptId = this.createReceiptId(request.requestId);
    let record: ModelPackRegistryRecord | undefined;
    try {
      this.assertRequest(request, signal);
      if (!this.validator) throw new BrokerFailure('fallback-unavailable', 'Output validator is unavailable.');
      record = await this.registry.getActive(request.purpose);
      if (!record || record.status !== 'active') {
        throw new BrokerFailure('adapter-unavailable', 'No active adapter exists for this purpose.');
      }
      if (record.manifest.contracts.inputSchema !== request.contractVersion) {
        throw new BrokerFailure('contract-mismatch', 'Request contract does not match the active adapter.');
      }
      const route = await this.withDeadline(
        request,
        (deadlineSignal) =>
          this.router.execute(request.purpose, record!.manifest.baseModel, deadlineSignal, async (base) => {
            const preparation = await this.provider.prepareAdapter(record!, base, deadlineSignal);
            if (preparation.compatible === false) {
              throw new BrokerFailure('adapter-incompatible', preparation.reason);
            }
            if (preparation.poolId !== base.poolId || preparation.baseSha256 !== base.binding.sha256) {
              throw new BrokerFailure('adapter-incompatible', 'Prepared adapter slot is bound to a different base.');
            }
            const providerOutput = await this.provider.infer(request, record!, preparation, deadlineSignal);
            return { providerOutput, preparation };
          }),
        signal
      );
      const output = route.value;
      const outputSchema = record.manifest.contracts.outputSchema;
      const validation = this.validateOutput(outputSchema, output.providerOutput.value);
      if ('code' in validation) {
        throw new BrokerFailure('output-invalid', 'Adapter output failed schema validation.', validation.code);
      }
      return {
        requestId: request.requestId,
        purpose: request.purpose,
        source: 'adapter',
        value: output.providerOutput.value,
        baseModel: structuredClone(record.manifest.baseModel),
        adapter: {
          id: record.manifest.id,
          version: record.manifest.version,
          key: record.key,
          slotId: output.preparation.slotId,
        },
        contractVersion: request.contractVersion,
        outputSchema,
        validation: 'passed',
        fallbackUsed: false,
        latencyMs: output.providerOutput.latencyMs ?? responseLatency(startedAt, this.now),
        receiptId,

        runtime: route.telemetry,
      };
    } catch (error) {
      const failure =
        error instanceof BrokerFailure
          ? error
          : error instanceof TwoBaseRuntimeError
            ? new BrokerFailure(error.code, error.message)
            : new BrokerFailure('provider-failed', error instanceof Error ? error.message : String(error));
      return this.fallback(request, record, failure, receiptId, startedAt);
    }
  }

  private assertRequest(request: CoreModelRequest, signal?: AbortSignal): void {
    if (signal?.aborted) throw new BrokerFailure('cancelled', 'Core model request was cancelled.');
    if (
      !request.requestId ||
      !request.contractVersion ||
      !Number.isFinite(request.deadlineMs) ||
      request.deadlineMs <= this.now()
    ) {
      const code = request.deadlineMs <= this.now() ? 'deadline-exceeded' : 'invalid-request';
      throw new BrokerFailure(code, 'Core model request is invalid or expired.');
    }
  }

  private async withDeadline<T>(
    request: CoreModelRequest,
    operation: (signal: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal
  ): Promise<T> {
    const remaining = request.deadlineMs - this.now();
    if (remaining <= 0) throw new BrokerFailure('deadline-exceeded', 'Core model deadline expired.');
    if (parentSignal?.aborted) throw new BrokerFailure('cancelled', 'Core model request was cancelled.');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new BrokerFailure('deadline-exceeded', 'Core model deadline expired.'));
      }, remaining);
    });
    const cancellation =
      parentSignal === undefined
        ? undefined
        : new Promise<never>((_resolve, reject) => {
            onAbort = () => {
              controller.abort();
              reject(new BrokerFailure('cancelled', 'Core model request was cancelled.'));
            };
            parentSignal.addEventListener('abort', onAbort, { once: true });
            if (parentSignal.aborted) onAbort();
          });
    try {
      if (controller.signal.aborted) throw new BrokerFailure('cancelled', 'Core model request was cancelled.');
      return await Promise.race([operation(controller.signal), timeout, ...(cancellation ? [cancellation] : [])]);
    } finally {
      if (timer) clearTimeout(timer);
      if (parentSignal && onAbort) parentSignal.removeEventListener('abort', onAbort);
    }
  }

  private async fallback(
    request: CoreModelRequest,
    record: ModelPackRegistryRecord | undefined,
    failure: BrokerFailure,
    receiptId: string,
    startedAt: number
  ): Promise<CoreModelResponse> {
    const base = {
      requestId: request.requestId,
      purpose: request.purpose,
      contractVersion: request.contractVersion,
      fallbackUsed: true,
      latencyMs: responseLatency(startedAt, this.now),
      receiptId,
      failureCode: failure.code,
      ...(failure.outputValidationError ? { outputValidationError: failure.outputValidationError } : {}),
    } as const;
    if (
      !this.validator ||
      request.fallback === 'abstain' ||
      failure.code === 'invalid-request' ||
      failure.code === 'deadline-exceeded' ||
      failure.code === 'cancelled'
    ) {
      return { ...base, source: 'abstain', validation: this.validator ? 'not-run' : 'validator-missing' };
    }
    const schemaId =
      record?.manifest.contracts.outputSchema ?? this.resolveOutputSchema(request.purpose, request.contractVersion);
    if (!schemaId) return { ...base, source: 'abstain', validation: 'not-run' };
    try {
      let value: unknown;
      let source: 'deterministic' | 'base-model';
      if (request.fallback === 'deterministic' && this.fallbacks.deterministic) {
        value = await this.fallbacks.deterministic(request);
        source = 'deterministic';
      } else if (request.fallback === 'base-model' && this.fallbacks.baseModel) {
        value = await this.withDeadline(request, (signal) => this.fallbacks.baseModel!(request, signal));
        source = 'base-model';
      } else {
        return { ...base, source: 'abstain', validation: 'not-run', failureCode: 'fallback-unavailable' };
      }
      const validation = this.validateOutput(schemaId, value);
      if ('code' in validation) {
        return {
          ...base,
          source: 'abstain',
          validation: 'failed',
          failureCode: 'fallback-invalid',
          outputValidationError: validation.code,
        };
      }
      return {
        ...base,
        source,
        value,
        outputSchema: schemaId,
        validation: 'passed',
        failureCode: failure.code,
      };
    } catch {
      return { ...base, source: 'abstain', validation: 'failed', failureCode: 'fallback-unavailable' };
    }
  }

  private validateOutput(schemaId: string, value: unknown): CoreModelOutputValidationResult {
    const result = this.validator!.validate(schemaId, value);
    return typeof result === 'boolean' ? (result ? { valid: true } : { valid: false, code: 'invalid-type' }) : result;
  }
}

export type LocalInferenceHubExecutionRequest = {
  intent: RunIntent;
  signal?: AbortSignal;
};

export type LocalInferenceHubExecutionResult = {
  text: string;
  evidenceRefs: readonly string[];
};

export type LocalInferenceHubTargetExecutor = {
  execute(request: LocalInferenceHubExecutionRequest): Promise<LocalInferenceHubExecutionResult>;
};

export type LocalInferenceHubTargetAdapterOptions = {
  contractVersion: string;
  deadlineMs(intent: RunIntent): number;
  purpose?: CoreModelPurpose;
  priority?: CoreModelRequest['priority'];
  payload?(intent: RunIntent): unknown;
  serializeOutput?(value: unknown, response: CoreModelResponse): string;
};

export class LocalInferenceHubTargetError extends Error {
  public constructor(
    public readonly code:
      | 'LOCAL_INFERENCE_CANCELLED'
      | 'LOCAL_INFERENCE_DEADLINE_EXCEEDED'
      | 'LOCAL_INFERENCE_DEADLINE_INVALID'
      | 'LOCAL_INFERENCE_FAILED'
  ) {
    super(code);
    this.name = 'LocalInferenceHubTargetError';
  }
}

const defaultHubPayload = (intent: RunIntent): Record<string, unknown> => ({
  goal: intent.goal,
  successCriteria: intent.successCriteria,
  constraints: intent.constraints,
  workspaceScope: intent.workspaceScope,
});

const defaultHubOutputSerializer = (value: unknown): string => {
  if (typeof value === 'string' && value.length > 0) return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized && serialized.length > 0) return serialized;
  } catch {
    // A provider result that cannot be safely serialized is not Hub output.
  }
  throw new LocalInferenceHubTargetError('LOCAL_INFERENCE_FAILED');
};

/**
 * Adapts a verified local model response to the structural target contract consumed by HubExecutionAdapter.
 * Fallbacks are deliberately disabled: a local target can only report success after adapter-backed inference.
 */
export const createLocalInferenceHubTargetExecutor = (
  broker: LocalInferenceBroker,
  options: LocalInferenceHubTargetAdapterOptions
): LocalInferenceHubTargetExecutor => ({
  async execute({ intent, signal }): Promise<LocalInferenceHubExecutionResult> {
    if (signal?.aborted) throw new LocalInferenceHubTargetError('LOCAL_INFERENCE_CANCELLED');
    const deadlineMs = options.deadlineMs(intent);
    if (!Number.isFinite(deadlineMs)) throw new LocalInferenceHubTargetError('LOCAL_INFERENCE_DEADLINE_INVALID');
    const response = await broker.infer(
      {
        requestId: intent.runId,
        purpose: options.purpose ?? 'assistant',
        contractVersion: options.contractVersion,
        priority: options.priority ?? 'P1',
        deadlineMs,
        payload: options.payload?.(intent) ?? defaultHubPayload(intent),
        fallback: 'abstain',
      },
      signal
    );
    if (response.failureCode === 'cancelled') throw new LocalInferenceHubTargetError('LOCAL_INFERENCE_CANCELLED');
    if (response.failureCode === 'deadline-exceeded') {
      throw new LocalInferenceHubTargetError('LOCAL_INFERENCE_DEADLINE_EXCEEDED');
    }
    if (response.source !== 'adapter' || response.value === undefined || !response.adapter || !response.baseModel) {
      throw new LocalInferenceHubTargetError('LOCAL_INFERENCE_FAILED');
    }
    let text: string;
    try {
      text = (options.serializeOutput ?? defaultHubOutputSerializer)(response.value, response);
    } catch {
      throw new LocalInferenceHubTargetError('LOCAL_INFERENCE_FAILED');
    }
    if (text.length === 0) throw new LocalInferenceHubTargetError('LOCAL_INFERENCE_FAILED');
    return {
      text,
      evidenceRefs: [
        `local-inference:${response.receiptId}`,
        `local-inference:adapter:${response.adapter.key}`,
        `local-inference:base:${response.baseModel.sha256}`,
      ],
    };
  },
});

export class InMemoryInferenceProvider implements LocalInferenceProvider {
  public readonly calls: Array<{ requestId: string; adapterKey: string }> = [];
  public readonly lifecycleCalls: Array<{ operation: 'load' | 'unload'; poolId: LoadedBase['poolId'] }> = [];
  private preparation: AdapterSlotPreparation = {
    compatible: true,
    slotId: 'fake-slot',
    rank: 8,
    alpha: 16,
    poolId: 'general-2b',
    baseSha256: '',
  };
  private output: CoreModelProviderOutput = { value: {} };
  private failure: Error | undefined;
  private loadFailure: Error | undefined;

  private unloadFailure: Error | undefined;
  private loadedBase: LoadedBase | undefined;
  private inferHook: ((signal: AbortSignal) => Promise<void>) | undefined;

  public setPreparation(preparation: AdapterSlotPreparation): void {
    this.preparation = preparation;
  }

  public setOutput(value: unknown, latencyMs?: number): void {
    this.output = { value, latencyMs };
    this.failure = undefined;
  }

  public setFailure(error: Error): void {
    this.failure = error;
  }

  public setLoadFailure(error: Error | undefined): void {
    this.loadFailure = error;
  }

  public setUnloadFailure(error: Error | undefined): void {
    this.unloadFailure = error;
  }

  public setInferHook(hook: ((signal: AbortSignal) => Promise<void>) | undefined): void {
    this.inferHook = hook;
  }

  public async getLoadedBase(): Promise<LoadedBase | undefined> {
    return this.loadedBase ? structuredClone(this.loadedBase) : undefined;
  }

  public async loadBase(base: LoadedBase, _signal: AbortSignal): Promise<void> {
    this.lifecycleCalls.push({ operation: 'load', poolId: base.poolId });
    this.loadedBase = structuredClone(base);
    if (this.loadFailure) throw this.loadFailure;
  }

  public async unloadBase(base: LoadedBase, _signal: AbortSignal): Promise<void> {
    this.lifecycleCalls.push({ operation: 'unload', poolId: base.poolId });

    if (this.unloadFailure) throw this.unloadFailure;
    this.loadedBase = undefined;
  }

  public async prepareAdapter(
    _record: ModelPackRegistryRecord,
    base: LoadedBase,
    _signal: AbortSignal
  ): Promise<AdapterSlotPreparation> {
    if (this.preparation.compatible === false) return structuredClone(this.preparation);
    return { ...structuredClone(this.preparation), poolId: base.poolId, baseSha256: base.binding.sha256 };
  }

  public async infer(
    request: CoreModelRequest,
    record: ModelPackRegistryRecord,
    _slot: Extract<AdapterSlotPreparation, { compatible: true }>,
    signal: AbortSignal
  ): Promise<CoreModelProviderOutput> {
    this.calls.push({ requestId: request.requestId, adapterKey: record.key });
    await this.inferHook?.(signal);
    if (this.failure) throw this.failure;
    return structuredClone(this.output);
  }
}
