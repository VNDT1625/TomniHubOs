/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type { ICreatorSandboxDriverRegistry } from '@process/workspace/creatorPreviewRuntime';
import type { CreatorSandboxDriverHealth } from '@process/workspace/creatorPreviewTypes';
import type { WindowsCreatorSandboxTrustPolicy } from './windowsSandboxTrustAdmission';
import type { WindowsCreatorSandboxTrustRevocationSource } from './windowsSandboxTrustRevocation';
import {
  prepareWindowsCreatorSandboxBoundary,
  type PreparedWindowsCreatorSandboxBoundary,
  type WindowsCreatorSandboxBoundaryOptions,
  type WindowsCreatorSandboxBoundaryResult,
  type WindowsCreatorSandboxBoundaryUnavailableCode,
} from './windowsSandboxBoundary';

const DEFAULT_HEALTH_INTERVAL_MS = 10_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CERTIFICATE_THUMBPRINT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MINIMUM_HEALTH_INTERVAL_MS = 1_000;
const MAXIMUM_HEALTH_INTERVAL_MS = 30_000;

export type WindowsCreatorSandboxHealthScheduler = (check: () => Promise<void>, intervalMs: number) => () => void;

export type WindowsCreatorSandboxActivationOptions = WindowsCreatorSandboxBoundaryOptions & {
  driverRegistry: Pick<ICreatorSandboxDriverRegistry, 'register' | 'unregister' | 'updateHealth'>;
  healthIntervalMs?: number;
  scheduleHealthCheck?: WindowsCreatorSandboxHealthScheduler;
};

export type ActiveWindowsCreatorSandboxBoundary = {
  state: 'ready';
  driverId: string;
  checkHealth(): Promise<CreatorSandboxDriverHealth>;
  dispose(): Promise<void>;
};

export type WindowsCreatorSandboxActivationDependencies = {
  prepareBoundary?: typeof prepareWindowsCreatorSandboxBoundary;
};

export type WindowsCreatorSandboxActivationResult =
  | ActiveWindowsCreatorSandboxBoundary
  | {
      state: 'unavailable';
      code: WindowsCreatorSandboxBoundaryUnavailableCode | 'DRIVER_REGISTRATION_REJECTED';
    };

/**
 * The only production configuration accepted at application startup. It intentionally
 * contains no filesystem, process, clock, platform, or client overrides: those hooks
 * exist only for unit tests and must never choose the production sandbox driver.
 */
export type WindowsCreatorSandboxProductionConfiguration = {
  resourcesPath: string;
  dataRoot: string;
  sidecar: {
    expectedBinarySha256: readonly string[];
    expectedSignerThumbprints: readonly string[];
    trustAdmission: {
      policy: WindowsCreatorSandboxTrustPolicy;
      revocationSource: WindowsCreatorSandboxTrustRevocationSource;
    };
  };
  permissionPolicy: NonNullable<WindowsCreatorSandboxBoundaryOptions['permissionPolicy']>;
  healthIntervalMs?: number;
};

export type WindowsCreatorSandboxProductionConfigurationResult =
  | { state: 'ready'; configuration: WindowsCreatorSandboxProductionConfiguration }
  | { state: 'unavailable'; code: 'PRODUCTION_CONFIGURATION_INVALID' };

export type WindowsCreatorSandboxProductionActivationResult =
  | WindowsCreatorSandboxActivationResult
  | { state: 'unavailable'; code: 'PRODUCTION_CONFIGURATION_INVALID' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const normalizeAbsolutePath = (value: unknown): string | undefined => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && path.isAbsolute(normalized) ? normalized : undefined;
};

const normalizeTrustedList = (value: unknown, pattern: RegExp): readonly string[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const normalized = value.map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''));
  if (normalized.some((entry) => !pattern.test(entry)) || new Set(normalized).size !== normalized.length) {
    return undefined;
  }
  return normalized;
};

/**
 * Validate the narrow startup configuration before the boundary is allowed to touch a
 * sidecar. Deeper verification remains in `prepareWindowsCreatorSandboxBoundary`: it
 * validates the signed manifest, byte size, package version, key pin, revocation, hash,
 * Authenticode, capability negotiation, and permission-policy acknowledgement.
 */
export const validateWindowsCreatorSandboxProductionConfiguration = (
  value: unknown
): WindowsCreatorSandboxProductionConfigurationResult => {
  if (
    !isRecord(value) ||
    !(
      hasExactKeys(value, ['dataRoot', 'permissionPolicy', 'resourcesPath', 'sidecar']) ||
      hasExactKeys(value, ['dataRoot', 'healthIntervalMs', 'permissionPolicy', 'resourcesPath', 'sidecar'])
    )
  ) {
    return { state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' };
  }
  const resourcesPath = normalizeAbsolutePath(value.resourcesPath);
  const dataRoot = normalizeAbsolutePath(value.dataRoot);
  if (!resourcesPath || !dataRoot || !isRecord(value.sidecar) || !isRecord(value.permissionPolicy)) {
    return { state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' };
  }
  if (!hasExactKeys(value.sidecar, ['expectedBinarySha256', 'expectedSignerThumbprints', 'trustAdmission'])) {
    return { state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' };
  }
  const expectedBinarySha256 = normalizeTrustedList(value.sidecar.expectedBinarySha256, SHA256_PATTERN);
  const expectedSignerThumbprints = normalizeTrustedList(
    value.sidecar.expectedSignerThumbprints,
    CERTIFICATE_THUMBPRINT_PATTERN
  );
  if (!expectedBinarySha256 || !expectedSignerThumbprints || !isRecord(value.sidecar.trustAdmission)) {
    return { state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' };
  }
  const trustAdmission = value.sidecar.trustAdmission;
  if (!hasExactKeys(trustAdmission, ['policy', 'revocationSource']) || !isRecord(trustAdmission.policy)) {
    return { state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' };
  }
  if (
    !isRecord(trustAdmission.revocationSource) ||
    !hasExactKeys(trustAdmission.revocationSource, ['readSnapshot', 'subscribe']) ||
    typeof trustAdmission.revocationSource.readSnapshot !== 'function' ||
    typeof trustAdmission.revocationSource.subscribe !== 'function'
  ) {
    return { state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' };
  }
  if (!hasExactKeys(value.permissionPolicy, ['manifest', 'policy'])) {
    return { state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' };
  }
  const healthIntervalMs = value.healthIntervalMs;
  if (
    healthIntervalMs !== undefined &&
    (typeof healthIntervalMs !== 'number' ||
      !Number.isFinite(healthIntervalMs) ||
      Math.floor(healthIntervalMs) !== healthIntervalMs ||
      healthIntervalMs < MINIMUM_HEALTH_INTERVAL_MS ||
      healthIntervalMs > MAXIMUM_HEALTH_INTERVAL_MS)
  ) {
    return { state: 'unavailable', code: 'PRODUCTION_CONFIGURATION_INVALID' };
  }
  return {
    state: 'ready',
    configuration: {
      resourcesPath,
      dataRoot,
      sidecar: {
        expectedBinarySha256,
        expectedSignerThumbprints,
        trustAdmission: {
          policy: trustAdmission.policy as WindowsCreatorSandboxTrustPolicy,
          revocationSource: trustAdmission.revocationSource as WindowsCreatorSandboxTrustRevocationSource,
        },
      },
      permissionPolicy: value.permissionPolicy as NonNullable<WindowsCreatorSandboxBoundaryOptions['permissionPolicy']>,
      ...(typeof healthIntervalMs === 'number' ? { healthIntervalMs } : {}),
    },
  };
};

/**
 * Activate only from the validated production shape and the caller-owned registry. This
 * adapter deliberately does not expose boundary dependency injection, so production
 * startup cannot silently substitute a fake native driver.
 */
export const activateWindowsCreatorSandboxFromProductionConfiguration = async (
  configuration: unknown,
  driverRegistry: WindowsCreatorSandboxActivationOptions['driverRegistry']
): Promise<WindowsCreatorSandboxProductionActivationResult> => {
  const validated = validateWindowsCreatorSandboxProductionConfiguration(configuration);
  if (validated.state === 'unavailable') return validated;
  const config = validated.configuration;
  try {
    return await activateWindowsCreatorSandboxBoundary({
      resourcesPath: config.resourcesPath,
      dataRoot: config.dataRoot,
      trustedBinarySha256: config.sidecar.expectedBinarySha256,
      trustedSignerThumbprints: config.sidecar.expectedSignerThumbprints,
      permissionPolicy: config.permissionPolicy,
      trustAdmission: config.sidecar.trustAdmission,
      driverRegistry,
      ...(config.healthIntervalMs === undefined ? {} : { healthIntervalMs: config.healthIntervalMs }),
    });
  } catch {
    return { state: 'unavailable', code: 'DRIVER_REGISTRATION_REJECTED' };
  }
};

const defaultScheduleHealthCheck: WindowsCreatorSandboxHealthScheduler = (check, intervalMs) => {
  const timer = setInterval(() => void check().catch((): undefined => undefined), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
};

const disposeRejectedBoundary = async (boundary: PreparedWindowsCreatorSandboxBoundary): Promise<void> => {
  await boundary.dispose().catch((): undefined => undefined);
};

/**
 * Register an attested boundary, keep its health evidence fresh, and remove it as soon
 * as containment is lost. Registration or monitoring setup failure remains fail-closed.
 */
export const activateWindowsCreatorSandboxBoundary = async (
  options: WindowsCreatorSandboxActivationOptions,
  dependencies: WindowsCreatorSandboxActivationDependencies = {}
): Promise<WindowsCreatorSandboxActivationResult> => {
  const prepared: WindowsCreatorSandboxBoundaryResult = await (
    dependencies.prepareBoundary ?? prepareWindowsCreatorSandboxBoundary
  )(options);
  if (prepared.state === 'unavailable') return prepared;

  let unregister: (() => void) | undefined;
  try {
    unregister = options.driverRegistry.register(prepared.registration);
  } catch {
    await disposeRejectedBoundary(prepared);
    return { state: 'unavailable', code: 'DRIVER_REGISTRATION_REJECTED' };
  }

  let cancelSchedule: (() => void) | undefined;

  let cancelTrustRevocation: (() => void) | undefined;
  let cancelProcessExit: (() => void) | undefined;
  let disposeInFlight: Promise<void> | undefined;
  let healthInFlight: Promise<CreatorSandboxDriverHealth> | undefined;
  let disposed = false;

  const dispose = (): Promise<void> => {
    if (disposeInFlight) return disposeInFlight;
    disposeInFlight = (async () => {
      if (disposed) return;
      disposed = true;
      cancelSchedule?.();
      cancelSchedule = undefined;

      cancelTrustRevocation?.();
      cancelTrustRevocation = undefined;

      cancelProcessExit?.();
      cancelProcessExit = undefined;
      const unregisterDriver = unregister;
      unregister = undefined;
      let unregisterError: unknown;
      try {
        unregisterDriver?.();
      } catch (error) {
        unregisterError = error;
      }
      try {
        await prepared.dispose();
      } catch (boundaryError) {
        if (unregisterError === undefined) throw boundaryError;
        const cleanupError = new AggregateError(
          [unregisterError, boundaryError],
          'Sandbox registry and native boundary cleanup both failed.'
        );
        cleanupError.cause = boundaryError;
        throw cleanupError;
      }
      if (unregisterError !== undefined) throw unregisterError;
    })();
    return disposeInFlight;
  };

  try {
    cancelTrustRevocation = prepared.subscribeTrustRevocation(() => {
      void dispose().catch((): undefined => undefined);
    });
    if (disposed) {
      cancelTrustRevocation();
      cancelTrustRevocation = undefined;
      return { state: 'unavailable', code: 'DRIVER_REGISTRATION_REJECTED' };
    }
    cancelProcessExit = prepared.subscribeProcessExit(() => {
      void dispose().catch((): undefined => undefined);
    });
    if (disposed) {
      cancelProcessExit();
      cancelProcessExit = undefined;
      return { state: 'unavailable', code: 'DRIVER_REGISTRATION_REJECTED' };
    }
  } catch {
    await dispose();
    return { state: 'unavailable', code: 'DRIVER_REGISTRATION_REJECTED' };
  }

  const checkHealth = (): Promise<CreatorSandboxDriverHealth> => {
    if (healthInFlight) return healthInFlight;
    healthInFlight = (async () => {
      const health = await prepared.observeHealth();
      if (disposed) return health;
      let updated = false;
      try {
        updated = options.driverRegistry.updateHealth(prepared.registration.driverId, health);
      } catch {
        updated = false;
      }
      if (!updated || health.state !== 'healthy') await dispose();
      return health;
    })();
    return healthInFlight.finally(() => {
      healthInFlight = undefined;
    });
  };

  const healthIntervalMs = Math.floor(options.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS);
  if (
    !Number.isFinite(healthIntervalMs) ||
    healthIntervalMs < MINIMUM_HEALTH_INTERVAL_MS ||
    healthIntervalMs > MAXIMUM_HEALTH_INTERVAL_MS
  ) {
    await dispose();
    return { state: 'unavailable', code: 'DRIVER_REGISTRATION_REJECTED' };
  }

  try {
    cancelSchedule = (options.scheduleHealthCheck ?? defaultScheduleHealthCheck)(async () => {
      await checkHealth().catch(async () => dispose());
    }, healthIntervalMs);
  } catch {
    await dispose();
    return { state: 'unavailable', code: 'DRIVER_REGISTRATION_REJECTED' };
  }

  return {
    state: 'ready',
    driverId: prepared.registration.driverId,
    checkHealth,
    dispose,
  };
};
