import { describe, expect, it } from 'vitest';

import { readLocalUserUnderstandingSignal } from '@process/userUnderstanding/localUserUnderstandingSignal';

describe('local userUnderstanding signal reader', () => {
  it('accepts only an adapter-backed v2 signal from a user query', async () => {
    const signal = await readLocalUserUnderstandingSignal(
      {
        infer: async () => ({
          source: 'adapter',
          validation: 'passed',
          value: {
            hasMemorySignal: true,
            kind: 'preference',
            scopeHint: 'workspace',
            confidence: 0.95,
            reason: 'Explicit durable preference.',
            requiresUserConfirmation: true,
          },
        }),
      } as never,
      { requestId: 'request-1', userQuery: 'Use Vietnamese in this workspace.', deadlineMs: Date.now() + 30_000 }
    );

    expect(signal).toMatchObject({ kind: 'preference', scopeHint: 'workspace' });
  });

  it('drops fallback and malformed output without persistence', async () => {
    await expect(
      readLocalUserUnderstandingSignal({ infer: async () => ({ source: 'abstain', validation: 'not-run' }) } as never, {
        requestId: 'request-2',
        userQuery: 'Use Vietnamese.',
        deadlineMs: Date.now() + 30_000,
      })
    ).resolves.toBeUndefined();
  });
});
