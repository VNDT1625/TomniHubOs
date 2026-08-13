/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CoreModelPurpose, ModelPackBaseBinding } from '../../catalog/modelPackTypes';

export type TwoBasePoolId = 'security-0.8b' | 'general-2b';

export type TwoBaseRuntimeBindings = {
  security: ModelPackBaseBinding;
  general: ModelPackBaseBinding;
};

export type LoadedBase = {
  poolId: TwoBasePoolId;
  binding: ModelPackBaseBinding;
};

export type TwoBaseLifecycleProvider = {
  getLoadedBase(): Promise<LoadedBase | undefined>;
  loadBase(base: LoadedBase, signal: AbortSignal): Promise<void>;
  unloadBase(base: LoadedBase, signal: AbortSignal): Promise<void>;
};

export type BaseRouteTelemetry = {
  poolId: TwoBasePoolId;
  transition: 'reused' | 'loaded' | 'switched';
  fromPoolId?: TwoBasePoolId;
  queueWaitMs: number;
};

export class TwoBaseRuntimeError extends Error {
  public constructor(
    public readonly code: 'base-binding-mismatch' | 'base-switch-failed',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'TwoBaseRuntimeError';
  }
}

const sameBinding = (left: ModelPackBaseBinding, right: ModelPackBaseBinding): boolean =>
  left.id === right.id && left.revision === right.revision && left.sha256 === right.sha256;

const targetFor = (
  purpose: CoreModelPurpose,
  bindings: TwoBaseRuntimeBindings
): { poolId: TwoBasePoolId; binding: ModelPackBaseBinding } =>
  purpose === 'security'
    ? { poolId: 'security-0.8b', binding: bindings.security }
    : { poolId: 'general-2b', binding: bindings.general };

/** Serializes the entire base switch + adapter inference critical section, keeping at most one base loaded. */
export class TwoBaseRuntimeRouter {
  private operation = Promise.resolve();

  private poisoned = false;

  public constructor(
    private readonly provider: TwoBaseLifecycleProvider,
    private readonly bindings: TwoBaseRuntimeBindings,
    private readonly now: () => number = Date.now
  ) {}

  public execute<T>(
    purpose: CoreModelPurpose,
    manifestBase: ModelPackBaseBinding,
    signal: AbortSignal,
    operation: (base: LoadedBase, telemetry: BaseRouteTelemetry) => Promise<T>
  ): Promise<{ value: T; telemetry: BaseRouteTelemetry }> {
    const queuedAt = this.now();
    return this.serialized(async () => {
      if (signal.aborted)
        throw new TwoBaseRuntimeError('base-switch-failed', 'Request expired while waiting for base.');

      await this.recoverIfPoisoned();
      if (signal.aborted) throw new TwoBaseRuntimeError('base-switch-failed', 'Request expired during recovery.');
      const target = targetFor(purpose, this.bindings);
      if (!sameBinding(manifestBase, target.binding)) {
        throw new TwoBaseRuntimeError('base-binding-mismatch', `Adapter is not bound to ${target.poolId}.`);
      }
      const loaded = await this.provider.getLoadedBase();
      let transition: BaseRouteTelemetry['transition'] = 'reused';
      if (!loaded || loaded.poolId !== target.poolId || !sameBinding(loaded.binding, target.binding)) {
        transition = loaded ? 'switched' : 'loaded';
        try {
          if (loaded) await this.provider.unloadBase(loaded, signal);
          if (signal.aborted) throw new Error('Base load aborted.');
          await this.provider.loadBase(target, signal);
          const verified = await this.provider.getLoadedBase();
          if (!verified || verified.poolId !== target.poolId || !sameBinding(verified.binding, target.binding)) {
            throw new Error('Provider did not confirm the requested immutable base.');
          }
        } catch (error) {
          this.poisoned = true;
          await this.recoverIfPoisoned().catch((): void => undefined);
          throw new TwoBaseRuntimeError('base-switch-failed', `Failed to activate ${target.poolId}.`, { cause: error });
        }
      }
      const telemetry: BaseRouteTelemetry = {
        poolId: target.poolId,
        transition,
        ...(loaded ? { fromPoolId: loaded.poolId } : {}),
        queueWaitMs: Math.max(0, this.now() - queuedAt),
      };
      return { value: await operation(target, telemetry), telemetry };
    });
  }

  private async recoverIfPoisoned(): Promise<void> {
    if (!this.poisoned) return;
    const loaded = await this.provider.getLoadedBase();
    if (loaded) await this.provider.unloadBase(loaded, AbortSignal.timeout(5_000));
    if (await this.provider.getLoadedBase()) {
      throw new TwoBaseRuntimeError('base-switch-failed', 'Provider remains loaded after poisoned-state cleanup.');
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
