import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

import { createCoreContextComposer } from '@/process/agentRuntime/contextComposer';
import {
  accountPersonalContextId,
  ensureAccountPersonalContext,
  ensureActiveAccountPersonalContext,
} from '@/process/agentRuntime/electronContext';
import { createContextStore, createPersonalLearningCoordinator } from '@/process/agentRuntime/contextStore';
import { ACCOUNT_EXECUTION_REJECTED, guardAccountExecution } from '@/process/services/database/nativeConversation';
import type { ContextFact, PersonalContext } from '@/process/agentRuntime/contextTypes';

const cleanupPaths: string[] = [];
const fact = (value: string): ContextFact => ({
  key: 'editor',
  value,
  confidence: 1,
  source: 'user',
  learnedAt: 1_720_000_000_000,
  scope: { kind: 'global' },
  sensitivity: 'normal',
  userLocked: true,
});

const legacyProfile = (): PersonalContext => ({
  id: 'default',
  facts: [fact('legacy-shared-value')],
  preferences: [],
  structuredProfile: {
    personalInformation: [],
    psychology: [],
    personality: [],
    interests: [],
    profession: [],
    aestheticTaste: [],
    pastContext: [],
  },
  communication: { vocabulary: [], writingGuidance: [] },
  decisionPolicy: { autonomy: 'minor-only', mayDecideCategories: [], alwaysAskCategories: ['secrets'] },
  habits: [],
  secretReferences: [],
  updatedAt: 1_720_000_000_000,
});

const newStore = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tomny-account-personal-'));
  cleanupPaths.push(directory);
  return createContextStore(path.join(directory, 'profiles.json'));
};

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('account-bound Personal Context', () => {
  it('uses an opaque stable profile key and rejects an absent Main account', async () => {
    const store = await newStore();

    expect(accountPersonalContextId('account-A')).not.toContain('account-A');
    expect(accountPersonalContextId('account-A')).toBe(accountPersonalContextId('account-A'));
    expect(accountPersonalContextId('account-A')).not.toBe(accountPersonalContextId('account-B'));
    await expect(ensureActiveAccountPersonalContext(store, undefined)).rejects.toThrow(
      'ACCOUNT_PERSONAL_CONTEXT_UNAVAILABLE'
    );

    const deniedOperation = vi.fn();
    const guarded = guardAccountExecution(() => {
      throw new Error('untrusted-or-signed-out');
    }, deniedOperation);
    expect(() => guarded(undefined)).toThrow(ACCOUNT_EXECUTION_REJECTED);
    expect(deniedOperation).not.toHaveBeenCalled();
  });

  it('quarantines legacy default and keeps A/B profiles isolated across restart', async () => {
    const store = await newStore();
    await store.upsertPersonal(legacyProfile());

    const accountA = await ensureAccountPersonalContext(store, 'account-A');
    await store.upsertPersonal({
      ...accountA,
      facts: [fact('account-A-only')],
      communication: { ...accountA.communication, language: 'vi' },
      updatedAt: accountA.updatedAt + 1,
    });
    const accountB = await ensureAccountPersonalContext(store, 'account-B');

    expect(accountA.id).not.toBe('default');
    expect(accountB.id).not.toBe(accountA.id);
    expect(accountB.facts).toEqual([]);
    expect(accountB.communication.language).toBeUndefined();

    const reloaded = createContextStore(path.join(cleanupPaths[0]!, 'profiles.json'));
    const persistedA = await ensureAccountPersonalContext(reloaded, 'account-A');
    const persistedB = await ensureAccountPersonalContext(reloaded, 'account-B');

    expect(persistedA.facts.map((item) => item.value)).toEqual(['account-A-only']);
    expect(persistedA.communication.language).toBe('vi');
    expect(persistedB.facts).toEqual([]);
    expect((await reloaded.getPersonal('default'))?.facts.map((item) => item.value)).toEqual(['legacy-shared-value']);
  });

  it('does not project a proposed record before the active account confirms it', async () => {
    const store = await newStore();
    const profile = await ensureAccountPersonalContext(store, 'account-A');
    const learning = createPersonalLearningCoordinator(store, {
      personalId: profile.id,
      now: () => 1_720_000_000_100,
      createId: () => 'proposal-1',
    });
    const proposal = await learning.propose({
      collection: 'preferences',
      fact: fact('account-A-editor'),
      explanation: 'The user asked for this editor in the current task.',
      provenance: 'run:account-A:1',
      causal: {
        context: 'editing a local project',
        origin: 'run:account-A:1',
        reason: 'The user selected this editor.',
        reasonKnown: true,
        proposal: 'Remember the preferred editor for future local editing.',
      },
    });
    const composer = createCoreContextComposer(store);

    const before = await composer.inspectContext!({
      agentId: 'tomny',
      personalId: profile.id,
      surface: 'chat',
    });
    expect(before.personal).not.toContain('account-A-editor');

    await learning.confirm(proposal.id);
    const after = await composer.inspectContext!({
      agentId: 'tomny',
      personalId: profile.id,
      surface: 'chat',
    });
    expect(after.personal).toContain('account-A-editor');
  });
});
