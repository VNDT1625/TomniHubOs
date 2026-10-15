/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContextFact, PersonalContext } from '@process/agentRuntime/contextTypes';

/**
 * `/remember <something>` and `/forget <something>`: the user edits their long-term Personal Context from the
 * chat box. A remembered item is a user-provided, user-locked fact, so every later conversation receives it the
 * same way as facts typed in Settings → Personal. Forgetting removes matching facts, preferences and habits and
 * marks matching learning records as forgotten. Nothing is sent to the model.
 */
export type MemoryCommand = Readonly<{ kind: 'remember' | 'forget'; text: string }>;

export type MemoryCommandResult =
  | Readonly<{ kind: 'empty'; command: MemoryCommand['kind'] }>
  | Readonly<{ kind: 'remembered'; duplicate: boolean }>
  | Readonly<{ kind: 'forgotten'; count: number }>;

export type MemoryCommandApi = Readonly<{
  get: () => Promise<PersonalContext>;
  save: (profile: PersonalContext) => Promise<unknown>;
  forgetLearning: (recordId: string) => Promise<unknown>;
}>;

export const REMEMBERED_FACT_KEY = 'remembered';
/** Long enough for a rule or a habit, short enough not to swallow a pasted document into every prompt. */
export const MAX_REMEMBERED_LENGTH = 500;

const MEMORY_COMMAND_RE = /^\s*\/(remember|forget)(?:\s+([\s\S]*))?$/iu;
const COLLECTIONS = ['facts', 'preferences', 'habits'] as const;

const normalize = (value: string): string => value.normalize('NFC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

export const parseMemoryCommand = (input: string): MemoryCommand | null => {
  const match = MEMORY_COMMAND_RE.exec(input);
  if (!match) return null;
  return { kind: match[1].toLowerCase() as MemoryCommand['kind'], text: (match[2] ?? '').trim() };
};

const matches = (fact: ContextFact, needle: string): boolean =>
  normalize(fact.value).includes(needle) || normalize(`${fact.key}: ${fact.value}`).includes(needle);

/** Applies a parsed command to the stored profile through the existing Personal Context IPC. */
export const runMemoryCommand = async (
  command: MemoryCommand,
  api: MemoryCommandApi,
  now: () => number = Date.now
): Promise<MemoryCommandResult> => {
  const needle = normalize(command.text);
  if (!needle) return { kind: 'empty', command: command.kind };
  const profile = await api.get();

  if (command.kind === 'remember') {
    const value = command.text.replace(/\s+/gu, ' ').slice(0, MAX_REMEMBERED_LENGTH);
    if (profile.facts.some((fact) => normalize(fact.value) === normalize(value))) {
      return { kind: 'remembered', duplicate: true };
    }
    const at = now();
    const fact: ContextFact = {
      key: REMEMBERED_FACT_KEY,
      value,
      confidence: 1,
      source: 'user',
      learnedAt: at,
      lastConfirmedAt: at,
      scope: { kind: 'global' },
      sensitivity: 'normal',
      userLocked: true,
    };
    await api.save({ ...profile, facts: [...profile.facts, fact], updatedAt: at });
    return { kind: 'remembered', duplicate: false };
  }

  // One item can sit both in a collection and in a learning record; count it once.
  const removed = new Set<string>();
  const next: PersonalContext = { ...profile, updatedAt: now() };
  for (const collection of COLLECTIONS) {
    next[collection] = profile[collection].filter((fact) => {
      if (!matches(fact, needle)) return true;
      removed.add(`${collection}:${fact.key}:${fact.value}`);
      return false;
    });
  }
  if (removed.size > 0) await api.save(next);
  const records = (profile.learningRecords ?? []).filter(
    (record) => record.status !== 'forgotten' && matches(record.fact, needle)
  );
  // Main serialises every Personal Context change, so these can be sent together.
  await Promise.all(records.map((record) => api.forgetLearning(record.id)));
  for (const record of records) removed.add(`${record.collection}:${record.fact.key}:${record.fact.value}`);
  return { kind: 'forgotten', count: removed.size };
};
