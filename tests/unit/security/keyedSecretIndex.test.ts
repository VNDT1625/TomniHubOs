import { describe, expect, it } from 'vitest';
import { createKeyedSecretIndex } from '@process/services/security/keyedSecretIndex';
import { createSemanticEgressGuard } from '@process/services/security/semanticEgressGuard';

describe('keyed secret egress boundary', () => {
  it('matches an exact registered payload before model inference', async () => {
    const index = createKeyedSecretIndex('vault-1', Buffer.alloc(32, 7));
    index.add('sk-live-123');
    expect(index.hasInText('prefix sk-live-123 suffix')).toBe(true);
    const result = await createSemanticEgressGuard({ keyedSecretIndex: index }).inspect({
      serializedPayload: 'prefix sk-live-123 suffix',
      origin: 'provider',
      policyVersion: 'p1',
      modelVersion: 'm1',
      cacheScope: { accountId: 'a', workspaceId: 'w', vaultRevision: 'vault-1', destination: 'https://x.test' },
    });
    expect(result.audit.reasonCode).toBe('registered_secret_match');
    const model = async (): Promise<unknown> => ({
      riskType: 'none',
      reasonCode: 'NO_SEMANTIC_RISK',
      requiresBackendValidation: true,
      redactions: [],
    });
    const exactResult = await createSemanticEgressGuard({ model, keyedSecretIndex: index }).inspect({
      serializedPayload: 'sk-live-123',
      origin: 'provider',
      policyVersion: 'p1',
      modelVersion: 'm1',
      cacheScope: { accountId: 'a', workspaceId: 'w', vaultRevision: 'vault-1', destination: 'https://x.test' },
    });
    expect(exactResult).toMatchObject({ decision: 'block', audit: { reasonCode: 'registered_secret_match' } });
    const stale = await createSemanticEgressGuard({ keyedSecretIndex: index }).inspect({
      serializedPayload: 'sk-live-123',
      origin: 'provider',
      policyVersion: 'p1',
      modelVersion: 'm1',
      cacheScope: { accountId: 'a', workspaceId: 'w', vaultRevision: 'rotated', destination: 'https://x.test' },
    });
    expect(stale).toMatchObject({ decision: 'block', audit: { reasonCode: 'registered_secret_index_stale' } });
  });

  it('clears rotated entries', () => {
    const index = createKeyedSecretIndex('vault-1', Buffer.alloc(32, 8));
    index.add('secret');
    expect(index.has('secret')).toBe(true);
    index.clear();
    expect(index.has('secret')).toBe(false);
  });
});
