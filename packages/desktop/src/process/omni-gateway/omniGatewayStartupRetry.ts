/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/** Bounded recovery for OS keychain initialization only. No plaintext secret fallback. */
export const GATEWAY_KEYCHAIN_RETRY_DELAYS_MS = [1000, 2500, 5000, 10000, 20000] as const;

export const nextGatewayKeychainRetryDelay = (error: unknown, attempt: number): number | null => {
  if (!(error instanceof Error) || error.message !== 'OS credential encryption is unavailable') return null;
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= GATEWAY_KEYCHAIN_RETRY_DELAYS_MS.length) return null;
  return GATEWAY_KEYCHAIN_RETRY_DELAYS_MS[attempt];
};
