/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPackBaseBinding } from '../../catalog/modelPackTypes';

export type LocalInferencePoolId = 'qwen-0.8b';

export type LoadedBase = {
  poolId: LocalInferencePoolId;
  binding: ModelPackBaseBinding;
};

export type LocalInferenceLifecycleProvider = {
  getLoadedBase(): Promise<LoadedBase | undefined>;
  loadBase(base: LoadedBase, signal: AbortSignal): Promise<void>;
  unloadBase(base: LoadedBase, signal: AbortSignal): Promise<void>;
};

export type BaseRouteTelemetry = {
  poolId: LocalInferencePoolId;
  transition: 'reused' | 'loaded' | 'reloaded';
  queueWaitMs: number;
};

export class LocalInferenceRuntimeError extends Error {
  public constructor(
    public readonly code: 'base-binding-mismatch' | 'base-load-failed',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'LocalInferenceRuntimeError';
  }
}

const sameBinding = (left: ModelPackBaseBinding, right: ModelPackBaseBinding): boolean =>
  left.id === right.id && left.revision === right.revision && left.sha256 === right.sha256;

/** Serializes the local model base (Laya Decision Engine) and its critical section. */
export class LocalInferenceRuntimeRouter {
  private operation = Promise.resolve();

  private poisoned = false;

  public constructor(
    private readonly provider: LocalInferenceLifecycleProvider,
    private readonly binding: ModelPackBaseBinding,
    private readonly now: () => number = Date.now
  ) {}

  public execute<T>(
    manifestBase: ModelPackBaseBinding,
    signal: AbortSignal,
    operation: (base: LoadedBase, telemetry: BaseRouteTelemetry) => Promise<T>
  ): Promise<{ value: T; telemetry: BaseRouteTelemetry }> {
    const queuedAt = this.now();
    return this.serialized(async () => {
      if (signal.aborted)
        throw new LocalInferenceRuntimeError('base-load-failed', 'Request expired while waiting for base.');

      await this.recoverIfPoisoned();
      if (signal.aborted) throw new LocalInferenceRuntimeError('base-load-failed', 'Request expired during recovery.');
      if (!sameBinding(manifestBase, this.binding)) {
        throw new LocalInferenceRuntimeError('base-binding-mismatch', 'Adapter is not bound to Qwen 0.8B.');
      }

      const loaded = await this.provider.getLoadedBase();
      let transition: BaseRouteTelemetry['transition'] = 'reused';
      if (!loaded || loaded.poolId !== 'qwen-0.8b' || !sameBinding(loaded.binding, this.binding)) {
        transition = loaded ? 'reloaded' : 'loaded';
        try {
          if (loaded) await this.provider.unloadBase(loaded, signal);
          if (signal.aborted) throw new Error('Base load aborted.');
          await this.provider.loadBase({ poolId: 'qwen-0.8b', binding: this.binding }, signal);
          const verified = await this.provider.getLoadedBase();
          if (!verified || verified.poolId !== 'qwen-0.8b' || !sameBinding(verified.binding, this.binding)) {
            throw new Error('Provider did not confirm the immutable Qwen 0.8B base.');
          }
        } catch (error) {
          this.poisoned = true;
          await this.recoverIfPoisoned().catch((): void => undefined);
          throw new LocalInferenceRuntimeError('base-load-failed', 'Failed to activate Qwen 0.8B.', { cause: error });
        }
      }

      return {
        value: await operation(
          { poolId: 'qwen-0.8b', binding: this.binding },
          {
            poolId: 'qwen-0.8b',
            transition,
            queueWaitMs: Math.max(0, this.now() - queuedAt),
          }
        ),
        telemetry: { poolId: 'qwen-0.8b', transition, queueWaitMs: Math.max(0, this.now() - queuedAt) },
      };
    });
  }

  private async recoverIfPoisoned(): Promise<void> {
    if (!this.poisoned) return;
    const loaded = await this.provider.getLoadedBase();
    if (loaded) await this.provider.unloadBase(loaded, AbortSignal.timeout(5_000));
    if (await this.provider.getLoadedBase()) {
      throw new LocalInferenceRuntimeError('base-load-failed', 'Provider remains loaded after poisoned-state cleanup.');
    }
    this.poisoned = false;
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  }
}
