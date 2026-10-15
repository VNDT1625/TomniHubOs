/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createSessionMemoryStore } from '@/process/userUnderstanding/sessionMemoryStore';

const store = (clock = () => 1_000) =>
  createSessionMemoryStore({ summarizer: async () => 'SUMMARY', now: clock, policy: { tokenBudget: 50_000 } });

describe('recall with latest', () => {
  it('returns the newest note even when the query shares nothing with it', async () => {
    const memory = store();
    await memory.remember('s', { text: 'payment retries use exponential backoff' });
    await memory.remember('s', { text: 'cache layer uses redis with a sixty second ttl' });

    expect(memory.recall('s', { query: 'go ahead' }).recent).toEqual([]);

    const recalled = memory.recall('s', { query: 'go ahead', latest: 1 });
    expect(recalled.recent.map((item) => item.text)).toEqual(['cache layer uses redis with a sixty second ttl']);
    expect(recalled.latest.map((item) => item.id)).toEqual(recalled.recent.map((item) => item.id));
  });

  it('breaks creation-time ties by write order, so newest is the one written last', async () => {
    const memory = store(() => 5_000);
    await memory.remember('s', { text: 'alpha decision about the parser' });
    await memory.remember('s', { text: 'omega decision about the renderer' });
    expect(memory.recall('s', { query: 'zzz', latest: 1 }).latest[0].text).toContain('omega');
  });

  it('does not duplicate a note that is also relevant, and keeps chronological order', async () => {
    let now = 0;
    const memory = store(() => ++now);
    await memory.remember('s', { text: 'parser handles unicode input' });
    await memory.remember('s', { text: 'renderer draws the parser output' });
    const recalled = memory.recall('s', { query: 'parser', latest: 1 });
    expect(recalled.recent.map((item) => item.text)).toEqual([
      'parser handles unicode input',
      'renderer draws the parser output',
    ]);
  });

  it('never exceeds the limit and ignores latest when the session is empty', async () => {
    const memory = store();
    expect(memory.recall('empty', { latest: 3 }).latest).toEqual([]);
    for (const text of ['one note here', 'two note here', 'three note here']) await memory.remember('s', { text });
    expect(memory.recall('s', { query: 'zzz', latest: 10, limit: 2 }).recent).toHaveLength(2);
  });

  it('leaves pinned notes and summaries out of latest', async () => {
    const memory = store();
    await memory.remember('s', { text: 'pinned constraint use typescript', pinned: true });
    await memory.remember('s', { text: 'ordinary note about the build' });
    const recalled = memory.recall('s', { query: 'zzz', latest: 2 });
    expect(recalled.latest.map((item) => item.text)).toEqual(['ordinary note about the build']);
    expect(recalled.pinned).toHaveLength(1);
  });
});

describe('configure', () => {
  it('lets the budget change at run time: a larger budget stops notes being folded', async () => {
    const summarizer = vi.fn(async () => 'SUMMARY');
    const memory = createSessionMemoryStore({ summarizer, policy: { tokenBudget: 500, keepRecent: 1 } });
    const filler = (index: number): string => `note ${index} ${'word '.repeat(120)}`;

    memory.configure({ tokenBudget: 100_000 });
    for (let index = 0; index < 6; index++) await memory.remember('s', { text: filler(index) });
    expect(summarizer).not.toHaveBeenCalled();
    expect(memory.snapshot('s').items).toHaveLength(6);

    memory.configure({ tokenBudget: 500 });
    await memory.remember('s', { text: filler(99) });
    expect(summarizer).toHaveBeenCalled();
  });

  it('rejects garbage and keeps a floor, then returns the policy in force', () => {
    const memory = store();
    const policy = memory.configure({ tokenBudget: Number.NaN, recallTokenBudget: 3, keepRecent: -4 });
    expect(policy.tokenBudget).toBe(50_000);
    expect(policy.recallTokenBudget).toBe(500);
    expect(policy.keepRecent).toBe(1);
  });
});

describe('lazy embeddings', () => {
  it('does not embed saved notes while opening, only when they are first recalled, and only once', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'tomny-lazy-embed-'));
    try {
      const persistencePath = path.join(directory, 'memory.json');
      const item = (id: string, text: string) => ({
        id,
        text,
        kind: 'note',
        pinned: false,
        createdAt: 1,
        tokens: 4,
        accessCount: 0,
        lastAccessedAt: 1,
      });
      writeFileSync(
        persistencePath,
        JSON.stringify([{ sessionId: 's', items: [item('m1', 'auth flow notes'), item('m2', 'billing flow notes')] }])
      );
      const embed = vi.fn((text: string) => [text.length, 1, 0]);

      const memory = createSessionMemoryStore({
        summarizer: async () => 'x',
        embedder: { embed, dim: 3 },
        persistencePath,
      });
      expect(embed).not.toHaveBeenCalled();

      memory.recall('s', { query: 'auth' });
      const afterFirst = embed.mock.calls.length;
      expect(afterFirst).toBeGreaterThan(0);
      memory.recall('s', { query: 'auth' });
      // Only the query is embedded again: the notes were cached on first use.
      expect(embed.mock.calls.length - afterFirst).toBe(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
