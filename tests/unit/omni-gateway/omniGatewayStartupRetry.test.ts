import { describe, expect, it } from 'vitest';
import {
  GATEWAY_KEYCHAIN_RETRY_DELAYS_MS,
  nextGatewayKeychainRetryDelay,
} from '@process/omni-gateway/omniGatewayStartupRetry';

describe('External MCP gateway keychain recovery', () => {
  it('retries only the transient OS-encryption availability failure', () => {
    const locked = new Error('OS credential encryption is unavailable');
    expect(nextGatewayKeychainRetryDelay(locked, 0)).toBe(1000);
    expect(nextGatewayKeychainRetryDelay(locked, 1)).toBe(2500);
    expect(nextGatewayKeychainRetryDelay(locked, GATEWAY_KEYCHAIN_RETRY_DELAYS_MS.length)).toBeNull();
    expect(nextGatewayKeychainRetryDelay(locked, -1)).toBeNull();
    expect(nextGatewayKeychainRetryDelay(locked, 0.5)).toBeNull();
  });

  it('never retries when decryption fails, storage is corrupt, or a port is unavailable', () => {
    for (const error of [
      new Error('Legacy credential decryption failed'),
      new Error('Port is already in use'),
      new Error('bad config'),
      'OS credential encryption is unavailable',
    ]) {
      expect(nextGatewayKeychainRetryDelay(error, 0)).toBeNull();
    }
  });
});
