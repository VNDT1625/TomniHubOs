/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  MAX_REMEMBERED_LENGTH,
  parseMemoryCommand,
  runMemoryCommand,
  type MemoryCommandApi,
} from '@/common/chat/slash/memoryCommand';
import type { ContextFact, PersonalContext, PersonalLearningRecord } from '@process/agentRuntime/contextTypes';

const fact = (key: string, value: string, extra: Partial<ContextFact> = {}): ContextFact => ({
  key,
  value,
  confidence: 1,
  source: 'user',
  learnedAt: 1,
  scope: { kind: 'global' },
  sensitivity: 'normal',
  userLocked: true,
  ...extra,
});

const profile = (patch: Partial<PersonalContext> = {}): PersonalContext =>
  ({
    id: 'default',
    facts: [],
    preferences: [],
    habits: [],
    secretReferences: [],
    structuredProfile: {},
    communication: {},
    decisionPolicy: {},
    updatedAt: 0,
    ...patch,
  }) as PersonalContext;

const apiFor = (current: PersonalContext) => {
  const saved: PersonalContext[] = [];
  const api: MemoryCommandApi & { forgetLearning: ReturnType<typeof vi.fn> } = {
    get: async () => current,
    save: async (next) => {
      saved.push(next);
    },
    forgetLearning: vi.fn(async () => true),
  };
  return { api, saved };
};

describe('/remember and /forget', () => {
  it('only reads its own commands', () => {
    expect(parseMemoryCommand('/remember  I use pnpm ')).toEqual({ kind: 'remember', text: 'I use pnpm' });
    expect(parseMemoryCommand('/FORGET pnpm')).toEqual({ kind: 'forget', text: 'pnpm' });
    expect(parseMemoryCommand('/remembering x')).toBeNull();
    expect(parseMemoryCommand('please /remember x')).toBeNull();
  });

  it('stores a user-locked global fact that later conversations receive', async () => {
    const { api, saved } = apiFor(profile({ facts: [fact('name', 'Ada')] }));
    const result = await runMemoryCommand({ kind: 'remember', text: 'I prefer   short answers' }, api, () => 42);
    expect(result).toEqual({ kind: 'remembered', duplicate: false });
    expect(saved).toHaveLength(1);
    expect(saved[0].facts).toEqual([
      fact('name', 'Ada'),
      fact('remembered', 'I prefer short answers', { learnedAt: 42, lastConfirmedAt: 42 }),
    ]);
    expect(saved[0].updatedAt).toBe(42);
  });

  it('does not store the same thing twice and caps long text', async () => {
    const duplicate = apiFor(profile({ facts: [fact('remembered', 'I prefer short answers')] }));
    await expect(
      runMemoryCommand({ kind: 'remember', text: 'i prefer SHORT answers' }, duplicate.api)
    ).resolves.toEqual({ kind: 'remembered', duplicate: true });
    expect(duplicate.saved).toHaveLength(0);

    const long = apiFor(profile());
    await runMemoryCommand({ kind: 'remember', text: 'x'.repeat(2000) }, long.api);
    expect(long.saved[0].facts[0].value).toHaveLength(MAX_REMEMBERED_LENGTH);
  });

  it('forgets matching facts, preferences, habits and learning records, counting each once', async () => {
    const learned = fact('tool', 'uses pnpm daily', { source: 'observed', userLocked: false });
    const record = { id: 'r1', collection: 'habits', fact: learned, status: 'applied' } as PersonalLearningRecord;
    const old = {
      id: 'r2',
      collection: 'facts',
      fact: fact('x', 'pnpm'),
      status: 'forgotten',
    } as PersonalLearningRecord;
    const { api, saved } = apiFor(
      profile({
        facts: [fact('remembered', 'I use PNPM'), fact('name', 'Ada')],
        preferences: [fact('style', 'short answers')],
        habits: [learned],
        learningRecords: [record, old],
      })
    );
    const result = await runMemoryCommand({ kind: 'forget', text: 'pnpm' }, api);
    expect(result).toEqual({ kind: 'forgotten', count: 2 });
    expect(saved[0].facts).toEqual([fact('name', 'Ada')]);
    expect(saved[0].preferences).toHaveLength(1);
    expect(saved[0].habits).toEqual([]);
    expect(api.forgetLearning).toHaveBeenCalledTimes(1);
    expect(api.forgetLearning).toHaveBeenCalledWith('r1');
  });

  it('changes nothing when nothing matches or no text is given', async () => {
    const { api, saved } = apiFor(profile({ facts: [fact('name', 'Ada')] }));
    await expect(runMemoryCommand({ kind: 'forget', text: 'pnpm' }, api)).resolves.toEqual({
      kind: 'forgotten',
      count: 0,
    });
    await expect(runMemoryCommand({ kind: 'remember', text: '   ' }, api)).resolves.toEqual({
      kind: 'empty',
      command: 'remember',
    });
    expect(saved).toHaveLength(0);
    expect(api.forgetLearning).not.toHaveBeenCalled();
  });
});
