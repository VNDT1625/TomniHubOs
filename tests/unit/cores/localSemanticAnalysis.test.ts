import { describe, expect, it } from 'vitest';

import { readLocalSemanticAnalysis } from '@process/experimentalCore/adapters/sidecar/localSemanticAnalysis';

describe('local semantic analysis', () => {
  it('uses one combined inference and keeps its output branches independent', async () => {
    let calls = 0;
    const result = await readLocalSemanticAnalysis(
      {
        infer: async () => {
          calls += 1;
          return {
            source: 'adapter',
            validation: 'passed',
            value: {
              security: { action: 'allow', confidence: 0.99, reasonCode: 'SAFE_CONTEXT' },
              userUnderstanding: {
                hasMemorySignal: true,
                kind: 'preference',
                scopeHint: 'workspace',
                confidence: 0.95,
                reason: 'Explicit durable preference.',
                requiresUserConfirmation: true,
              },
            },
          };
        },
      } as never,
      {
        requestId: 'combined-1',
        securityPayload: 'sanitized egress payload',
        userAuthoredQuery: 'Use Vietnamese in this workspace.',
        deadlineMs: Date.now() + 30_000,
      }
    );

    expect(calls).toBe(1);
    expect(result).toMatchObject({
      security: { action: 'allow', reasonCode: 'SAFE_CONTEXT' },
      userUnderstanding: { kind: 'preference', scopeHint: 'workspace' },
    });
  });

  it('does not create a combined request without both bounded inputs', async () => {
    const infer = async (): Promise<never> => {
      throw new Error('must not run');
    };
    await expect(
      readLocalSemanticAnalysis({ infer } as never, {
        requestId: 'combined-2',
        securityPayload: 'sanitized egress payload',
        userAuthoredQuery: '',
        deadlineMs: Date.now() + 30_000,
      })
    ).resolves.toBeUndefined();
  });
});
