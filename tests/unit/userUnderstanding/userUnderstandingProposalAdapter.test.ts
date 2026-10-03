import { describe, expect, it, vi } from 'vitest';

import { createUserUnderstandingProposalAdapter } from '@process/userUnderstanding/userUnderstandingProposalAdapter';
import type { PersonalLearningCoordinator } from '@process/agentRuntime/contextStore';

describe('userUnderstanding proposal adapter', () => {
  const proposal = (overrides: Record<string, unknown> = {}) => ({
    featureEnabled: true,
    source: 'user-query' as const,
    userQuery: 'Please answer in Vietnamese for this workspace.',
    signal: {
      hasMemorySignal: true,
      kind: 'preference',
      scopeHint: 'workspace',
      confidence: 0.95,
      reason: 'The user explicitly requested a language preference.',
      requiresUserConfirmation: true,
    },
    value: 'Vietnamese',
    key: 'response-language',
    workspaceId: 'workspace-1',
    provenance: 'run:1:query:1',
    ...overrides,
  });

  it('creates a proposed record for an explicit non-sensitive preference only', async () => {
    const propose = vi.fn(async (input: Parameters<PersonalLearningCoordinator['propose']>[0]) => ({
      ...input,
      id: 'proposal-1',
      status: 'proposed' as const,
      createdAt: 1,
    }));
    const result = await createUserUnderstandingProposalAdapter({ propose }).propose(proposal());

    expect(result).toMatchObject({ created: true, record: { status: 'proposed', collection: 'preferences' } });
    expect(propose).toHaveBeenCalledOnce();
    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({
        fact: expect.objectContaining({ scope: { kind: 'workspace', workspace: 'workspace-1' } }),
      })
    );
  });

  it('rejects signal schema drift, sensitive reasons, and inconsistent abstentions', () => {
    const valid = {
      hasMemorySignal: true,
      kind: 'preference',
      scopeHint: 'global',
      confidence: 0.95,
      reason: 'Explicit durable language preference.',
      requiresUserConfirmation: true,
    };
    const adapter = createUserUnderstandingProposalAdapter({ propose: vi.fn() });

    return Promise.all([
      adapter.propose(proposal({ signal: { ...valid, unexpected: true } })),
      adapter.propose(proposal({ signal: { ...valid, reason: 'The secret is secret-value.' } })),
      adapter.propose(proposal({ signal: { ...valid, hasMemorySignal: false } })),
    ]).then((results) => {
      expect(results).toEqual([
        { created: false, reasonCode: 'invalid_signal' },
        { created: false, reasonCode: 'invalid_signal' },
        { created: false, reasonCode: 'invalid_signal' },
      ]);
    });
  });

  it('does not create proposals for temporary, sensitive, or malformed signals', async () => {
    const propose = vi.fn();
    const adapter = createUserUnderstandingProposalAdapter({ propose });

    await expect(adapter.propose(proposal({ signal: { hasMemorySignal: false } }))).resolves.toMatchObject({
      created: false,
    });
    await expect(adapter.propose(proposal({ userQuery: 'My password is secret-value' }))).resolves.toMatchObject({
      created: false,
      reasonCode: 'sensitive_or_injected',
    });
    await expect(
      adapter.propose(proposal({ userQuery: 'For this message, answer in Vietnamese.' }))
    ).resolves.toMatchObject({
      created: false,
      reasonCode: 'temporary_instruction',
    });
    await expect(
      adapter.propose(
        proposal({
          signal: {
            hasMemorySignal: true,
            kind: 'preference',
            scopeHint: 'workspace',
            confidence: 0.95,
            reason: 'Explicit but confirmation is required.',
            requiresUserConfirmation: false,
          },
        })
      )
    ).resolves.toMatchObject({ created: false, reasonCode: 'confirmation_or_confidence_required' });
    expect(propose).not.toHaveBeenCalled();
  });
});
