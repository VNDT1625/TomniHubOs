import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const DISCOVERY_BRIDGE = 'packages/desktop/src/process/services/security/providerDiscovery/providerDiscoveryBridge.ts';
const readDiscoveryBridge = (): string => readFileSync(resolve(PROJECT_ROOT, DISCOVERY_BRIDGE), 'utf8');

/**
 * Provider model discovery is configuration-time egress, not a chat completion.
 * Until it has its own shared Main execution contract, this inventory prevents a
 * passing endpoint-pinning test from being mistaken for C0/C3 governed egress.
 */
const REQUIRED_DISCOVERY_REPLACEMENT_CONTRACT =
  'authenticated actor + trusted sender/origin + run/task identity + saved-provider binding + canonical destination admission + final request inspection + destination-bound opaque secret lease + caller cancellation + bounded transport + durable terminal receipt';

describe('C0/C3 provider model discovery governance inventory', () => {
  it('keeps the current account-bound, endpoint-pinned discovery seam explicit', () => {
    const source = readDiscoveryBridge();

    for (const marker of [
      'options.verifySender(event)',
      'options.accountSession.requireOnlineSession()',
      'options.providerStore.get(request.providerId)',
      'fetchProviderModelList(provider, createPinnedProviderDiscoveryFetch())',
      'timeout: REQUEST_TIMEOUT_MS',
      'assertProviderDiscoveryDestination',
      'PROVIDER_DISCOVERY_EGRESS_FAILED',
    ]) {
      expect(source, marker).toContain(marker);
    }
  });

  it('does not misrepresent configuration discovery as a Foundation-governed provider execution', () => {
    const source = readDiscoveryBridge();

    expect(REQUIRED_DISCOVERY_REPLACEMENT_CONTRACT).toContain('run/task identity');
    expect(REQUIRED_DISCOVERY_REPLACEMENT_CONTRACT).toContain('final request inspection');
    expect(REQUIRED_DISCOVERY_REPLACEMENT_CONTRACT).toContain('durable terminal receipt');

    for (const absentGovernanceMarker of [
      'FoundationTrustRuntime',
      'RunKernel',
      'requestCapability',
      'inspectFinalEgress',
      'resolveSecret',
      'evidenceRef',
    ]) {
      expect(source, absentGovernanceMarker).not.toContain(absentGovernanceMarker);
    }
  });
});
