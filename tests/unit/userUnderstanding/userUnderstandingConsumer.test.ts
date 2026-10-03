import { describe, expect, it, vi } from 'vitest';

import { createUserUnderstandingConsumer } from '@process/userUnderstanding/userUnderstandingConsumer';

describe('userUnderstanding consumer', () => {
  it('returns immediately and creates only a confirmation-required language proposal', async () => {
    const infer = vi.fn(async () => ({
      source: 'adapter',
      validation: 'passed',
      value: {
        hasMemorySignal: true,
        kind: 'preference',
        scopeHint: 'global',
        confidence: 0.95,
        reason: 'Explicit durable language preference.',
        requiresUserConfirmation: true,
      },
    }));
    const propose = vi.fn(async (value) => ({ ...value, id: 'proposal-1', status: 'proposed', createdAt: 1 }));
    const consumer = createUserUnderstandingConsumer({
      broker: { infer } as never,
      getLearningCoordinator: async () => ({ propose }) as never,
      enabled: () => true,
    });

    expect(
      consumer.observe({ requestId: 'run-1', userQuery: 'Please reply in Vietnamese.', provenance: 'run:1' })
    ).toBeUndefined();
    await vi.waitFor(() => expect(propose).toHaveBeenCalledOnce());
    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'preferences',
        fact: expect.objectContaining({ value: 'Vietnamese', scope: { kind: 'global' } }),
      })
    );
  });

  it('does not infer from non-language text or persist a non-preference signal', async () => {
    const infer = vi.fn();
    const propose = vi.fn();
    const consumer = createUserUnderstandingConsumer({
      broker: { infer } as never,
      getLearningCoordinator: async () => ({ propose }) as never,
      enabled: () => true,
    });

    consumer.observe({ requestId: 'run-2', userQuery: 'Read this terminal output.', provenance: 'run:2' });
    await Promise.resolve();
    expect(infer).not.toHaveBeenCalled();
    expect(propose).not.toHaveBeenCalled();

    consumer.observe({
      requestId: 'run-3',
      userQuery: 'Reply in Vietnamese and use my password.',
      provenance: 'run:3',
    });
    await Promise.resolve();
    expect(infer).not.toHaveBeenCalled();
  });
});
