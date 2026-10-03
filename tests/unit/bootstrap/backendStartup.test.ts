/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { startBackendOrExit } from '@/process/startup/backendStartup';
import { isDevelopmentCompatibilityOptIn, resolveCoreBootPolicy } from '@/process/startup/coreBootPolicy';

describe('resolveCoreBootPolicy', () => {
  it('recognizes only the exact development opt-in environment value', () => {
    expect(isDevelopmentCompatibilityOptIn(undefined)).toBe(false);
    expect(isDevelopmentCompatibilityOptIn('')).toBe(false);
    expect(isDevelopmentCompatibilityOptIn('true')).toBe(false);
    expect(isDevelopmentCompatibilityOptIn('yes')).toBe(false);
    expect(isDevelopmentCompatibilityOptIn('1')).toBe(true);
  });

  it('fails closed to native Tomny Core by default', () => {
    expect(resolveCoreBootPolicy()).toEqual({
      mode: 'tomny',
      startLegacyBackend: false,
      requireLegacyBackend: false,
    });
  });

  it('allows an explicit native-only Tomny Core boot after compatibility features are no longer needed', () => {
    expect(resolveCoreBootPolicy({ requestedMode: 'tomny' })).toEqual({
      mode: 'tomny',
      startLegacyBackend: false,
      requireLegacyBackend: false,
    });
  });

  it('allows compatibility only for an unpackaged development build with an explicit opt-in', () => {
    expect(
      resolveCoreBootPolicy({
        requestedMode: 'compat',
        isPackaged: false,
        developmentCompatibilityOptIn: true,
      })
    ).toEqual({
      mode: 'compat',
      startLegacyBackend: true,
      requireLegacyBackend: false,
    });
  });

  it('allows fail-fast legacy mode only with the same development opt-in', () => {
    expect(
      resolveCoreBootPolicy({
        requestedMode: 'legacy',
        isPackaged: false,
        developmentCompatibilityOptIn: true,
      })
    ).toEqual({
      mode: 'legacy',
      startLegacyBackend: true,
      requireLegacyBackend: true,
    });
  });

  it('rejects invalid modes instead of silently selecting a backend', () => {
    expect(() => resolveCoreBootPolicy({ requestedMode: 'future' })).toThrow('Invalid Tomny Core boot mode');
  });

  it('does not let WebUI or reset modes widen the backend policy', () => {
    expect(resolveCoreBootPolicy({ isWebUIMode: true })).toEqual({
      mode: 'tomny',
      startLegacyBackend: false,
      requireLegacyBackend: false,
    });
    expect(resolveCoreBootPolicy({ requestedMode: 'tomny', isResetPasswordMode: true })).toEqual({
      mode: 'tomny',
      startLegacyBackend: false,
      requireLegacyBackend: false,
    });
  });

  it('rejects legacy compatibility requests in a packaged app even with the opt-in environment value', () => {
    expect(
      resolveCoreBootPolicy({
        requestedMode: 'compat',
        isPackaged: true,
        developmentCompatibilityOptIn: true,
      })
    ).toEqual({
      mode: 'tomny',
      startLegacyBackend: false,
      requireLegacyBackend: false,
    });
    expect(
      resolveCoreBootPolicy({
        requestedMode: 'legacy',
        isPackaged: true,
        developmentCompatibilityOptIn: true,
      })
    ).toEqual({
      mode: 'tomny',
      startLegacyBackend: false,
      requireLegacyBackend: false,
    });
  });

  it('requires both the unpackaged signal and exact opt-in for an explicit compatibility request', () => {
    expect(resolveCoreBootPolicy({ requestedMode: 'compat', isPackaged: false })).toEqual({
      mode: 'tomny',
      startLegacyBackend: false,
      requireLegacyBackend: false,
    });
    expect(resolveCoreBootPolicy({ requestedMode: 'compat', developmentCompatibilityOptIn: true })).toEqual({
      mode: 'tomny',
      startLegacyBackend: false,
      requireLegacyBackend: false,
    });
  });
});

describe('startBackendOrExit', () => {
  it('does not touch the legacy backend when Tomny-native startup disables it', async () => {
    const startBackend = vi.fn(async () => 42123);
    const onStarted = vi.fn();
    const captureFailure = vi.fn();
    const exitApp = vi.fn();

    const result = await startBackendOrExit({
      enabled: false,
      startBackend,
      onStarted,
      captureFailure,
      exitApp,
    });

    expect(result).toEqual({ ok: true, skipped: true });
    expect(startBackend).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    expect(captureFailure).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
  });
  it('registers the backend port when startup succeeds', async () => {
    const onStarted = vi.fn();
    const captureFailure = vi.fn();
    const exitApp = vi.fn();

    const result = await startBackendOrExit({
      startBackend: async () => 42123,
      onStarted,
      captureFailure,
      exitApp,
      logError: vi.fn(),
    });

    expect(result).toEqual({ ok: true, port: 42123 });
    expect(onStarted).toHaveBeenCalledWith(42123);
    expect(captureFailure).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('captures startup failure and exits without registering a backend port by default', async () => {
    const error = new Error('tomnycore failed to start within timeout');
    const calls: string[] = [];
    const onStarted = vi.fn();
    const captureFailure = vi.fn(async () => {
      calls.push('capture-start');
      await Promise.resolve();
      calls.push('capture-end');
    });
    const exitApp = vi.fn(() => {
      calls.push('exit');
    });
    const logError = vi.fn();

    const result = await startBackendOrExit({
      startBackend: async () => {
        throw error;
      },
      onStarted,
      captureFailure,
      exitApp,
      logError,
    });

    expect(result).toEqual({ ok: false });
    expect(logError).toHaveBeenCalledWith('[TomnyCore] Failed to start the legacy compatibility backend:', error);
    expect(captureFailure).toHaveBeenCalledWith(error);
    expect(exitApp).toHaveBeenCalledWith(1);
    expect(calls).toEqual(['capture-start', 'capture-end', 'exit']);
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('captures startup failure without dialog or exit when exitOnFailure is disabled', async () => {
    const error = new Error('tomnycore exited before health check passed');
    const onStarted = vi.fn();
    const captureFailure = vi.fn();
    const exitApp = vi.fn();
    const logError = vi.fn();

    const result = await startBackendOrExit({
      startBackend: async () => {
        throw error;
      },
      onStarted,
      captureFailure,
      exitApp,
      exitOnFailure: false,
      logError,
    });

    expect(result).toEqual({ ok: false });
    expect(logError).toHaveBeenCalledWith('[TomnyCore] Failed to start the legacy compatibility backend:', error);
    expect(captureFailure).toHaveBeenCalledWith(error);
    expect(exitApp).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it('does not capture or exit when backend startup is cancelled by shutdown', async () => {
    const error = new Error('tomnycore startup cancelled');
    error.name = 'BackendStartupCancelledError';
    const onStarted = vi.fn();
    const captureFailure = vi.fn();
    const exitApp = vi.fn();
    const logError = vi.fn();

    const result = await startBackendOrExit({
      startBackend: async () => {
        throw error;
      },
      onStarted,
      captureFailure,
      exitApp,
      logError,
    });

    expect(result).toEqual({ ok: false });
    expect(logError).not.toHaveBeenCalled();
    expect(captureFailure).not.toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
