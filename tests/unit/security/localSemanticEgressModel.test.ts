import { describe, expect, it } from 'vitest';

import { createLocalSemanticEgressModel } from '@process/services/security/localSemanticEgressModel';

const request = { sanitizedPayload: 'gray zone', contentHash: 'a'.repeat(64), signal: new AbortController().signal };

describe('local semantic egress model', () => {
  it('uses only adapter-backed security results and maps non-allow responses to block', async () => {
    const infer = async () => ({
      source: 'adapter' as const,
      validation: 'passed' as const,
      value: {
        riskType: 'prompt_injection',
        reasonCode: 'PROMPT_INJECTION',
        requiresBackendValidation: true,
        redactions: [],
      },
    });
    const model = createLocalSemanticEgressModel({ infer } as never, { now: () => 1_000 });

    await expect(model(request)).resolves.toEqual({
      riskType: 'prompt_injection',
      reasonCode: 'PROMPT_INJECTION',
      requiresBackendValidation: true,
      redactions: [],
    });
  });

  it('accepts the security branch from the combined semantic output contract', async () => {
    const model = createLocalSemanticEgressModel({
      infer: async () => ({
        source: 'adapter' as const,
        validation: 'passed' as const,
        value: {
          security: {
            riskType: 'none' as const,
            reasonCode: 'NO_SEMANTIC_RISK' as const,
            requiresBackendValidation: true,
            redactions: [],
          },
          userUnderstanding: null,
        },
      }),
    } as never);

    await expect(model(request)).resolves.toMatchObject({ riskType: 'none', reasonCode: 'NO_SEMANTIC_RISK' });
  });

  it('fails closed when local inference falls back or returns an invalid schema', async () => {
    const model = createLocalSemanticEgressModel({
      infer: async () => ({ source: 'abstain' as const, validation: 'not-run' as const }),
    } as never);

    await expect(model(request)).rejects.toThrow('LOCAL_SEMANTIC_SECURITY_UNAVAILABLE');
  });
});
