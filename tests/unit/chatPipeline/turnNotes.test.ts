/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildTurnNote,
  createTurnNotePolicy,
  MIN_NOTE_WORTH,
  scoreTurnWorth,
  type TurnNoteInput,
} from '@process/services/database/nativeConversation/turnNotes';

const turn = (overrides: Partial<TurnNoteInput> = {}): TurnNoteInput => ({
  messageId: 'm-1',
  userText: 'How should we store the retry state? Never keep it in localStorage.',
  assistantText:
    'Keep the retry state in src/retry/state.ts and persist it through the session store. Do not use localStorage because the window can be cleared.',
  state: 'finish',
  ...overrides,
});

describe('scoreTurnWorth', () => {
  it('keeps greetings and small talk below the threshold, in two languages', () => {
    for (const [userText, assistantText] of [
      ['hello', 'Hello!'],
      ['thanks', "You're welcome."],
      ['chào', 'Chào bạn, mình giúp được gì?'],
      ['cảm ơn', 'Không có gì!'],
    ]) {
      expect(scoreTurnWorth({ userText, assistantText })).toBeLessThan(MIN_NOTE_WORTH);
    }
  });

  it('rates an answer that names files and sets a constraint above the threshold', () => {
    expect(scoreTurnWorth(turn())).toBeGreaterThanOrEqual(MIN_NOTE_WORTH);
  });

  it('scores nothing when the assistant said nothing', () => {
    expect(scoreTurnWorth(turn({ assistantText: '   ' }))).toBe(0);
  });

  it('never exceeds 1', () => {
    const long = `${'Never do this. See src/a/b.ts. '.repeat(60)}\n1. step\n\`\`\`ts\ncode\n\`\`\``;
    expect(scoreTurnWorth(turn({ userText: 'x'.repeat(400), assistantText: long }))).toBeLessThanOrEqual(1);
  });
});

describe('buildTurnNote', () => {
  it('carries the message id so the original can be read back', () => {
    expect(buildTurnNote(turn())).toContain('[msg:m-1]');
  });

  it('extracts instead of generating: every sentence of the note comes from the answer', () => {
    const note = buildTurnNote(turn());
    expect(note).toContain('src/retry/state.ts');
    expect(note).toContain('Do not use localStorage');
  });

  it('replaces code blocks with a marker and clips long input', () => {
    const note = buildTurnNote(
      turn({
        userText: 'q'.repeat(2000),
        assistantText: 'Here is the fix in src/a.ts.\n```ts\nconst SECRET_BODY = 1;\n```\nThen rerun the tests.',
      })
    );
    expect(note).not.toContain('SECRET_BODY');
    expect(note).toContain('[code block]');
    expect(note.length).toBeLessThan(1300);
  });
});

describe('createTurnNotePolicy', () => {
  const sanitize = async (text: string): Promise<string | undefined> => text;

  it('only remembers turns that finished', async () => {
    const policy = createTurnNotePolicy({ sanitize });
    expect(await policy.noteFor(turn({ state: 'error' }))).toBeUndefined();
    expect(await policy.noteFor(turn({ state: 'stopped' }))).toBeUndefined();
    expect(await policy.noteFor(turn())).toContain('Turn note');
  });

  it('skips small talk', async () => {
    const policy = createTurnNotePolicy({ sanitize });
    expect(await policy.noteFor(turn({ userText: 'hello', assistantText: 'Hello!' }))).toBeUndefined();
  });

  it('lets a confident model rescue a turn the heuristic would drop, and veto one it would keep', async () => {
    const dropped = turn({ userText: 'ok go on', assistantText: 'Understood, continuing with the plan.' });
    expect(await createTurnNotePolicy({ sanitize }).noteFor(dropped)).toBeUndefined();
    expect(await createTurnNotePolicy({ sanitize, worthModel: async () => 0.95 }).noteFor(dropped)).toBeDefined();
    expect(await createTurnNotePolicy({ sanitize, worthModel: async () => 0 }).noteFor(turn())).toBeUndefined();
  });

  it('falls back to the heuristic when the model is unavailable or throws', async () => {
    const failing = createTurnNotePolicy({
      sanitize,
      worthModel: vi.fn(async () => {
        throw new Error('sidecar down');
      }),
    });
    expect(await failing.noteFor(turn())).toBeDefined();
    expect(await createTurnNotePolicy({ sanitize, worthModel: async () => undefined }).noteFor(turn())).toBeDefined();
  });

  it('stores what the sanitizer returns, and nothing when it refuses', async () => {
    const redacting = createTurnNotePolicy({ sanitize: async (text) => text.replaceAll('localStorage', '[REDACTED]') });
    expect(await redacting.noteFor(turn())).not.toContain('localStorage');
    expect(await createTurnNotePolicy({ sanitize: async () => undefined }).noteFor(turn())).toBeUndefined();
  });
});

describe('unfinished requests', () => {
  const sanitize = async (text: string): Promise<string | undefined> => text;

  it('remembers what was asked when a turn ended without an answer', async () => {
    const policy = createTurnNotePolicy({ sanitize });
    const note = await policy.unfinishedFor(turn({ state: 'error', assistantText: '' }));
    expect(note).toContain('Unfinished request [msg:m-1]');
    expect(note).toContain('Never keep it in localStorage');
    expect(note).toContain('none before it stopped');
  });

  it('keeps the progress made before it stopped', async () => {
    const policy = createTurnNotePolicy({ sanitize });
    expect(await policy.unfinishedFor(turn({ state: 'stopped' }))).toContain('src/retry/state.ts');
  });

  it('has nothing to add for a turn that finished', async () => {
    expect(await createTurnNotePolicy({ sanitize }).unfinishedFor(turn())).toBeUndefined();
  });

  it('ignores the host resume instruction and requests too short to mean anything', async () => {
    const policy = createTurnNotePolicy({ sanitize });
    expect(
      await policy.unfinishedFor(
        turn({
          state: 'error',
          userText:
            'Hãy tiếp tục công việc đang dở từ chỗ bị gián đoạn. / Continue the unfinished work from where it was interrupted.',
        })
      )
    ).toBeUndefined();
    expect(await policy.unfinishedFor(turn({ state: 'error', userText: 'ok' }))).toBeUndefined();
  });

  it('cleans the note before it is stored', async () => {
    const policy = createTurnNotePolicy({ sanitize: async (text) => text.replaceAll('localStorage', '[REDACTED]') });
    expect(await policy.unfinishedFor(turn({ state: 'error' }))).not.toContain('localStorage');
    expect(
      await createTurnNotePolicy({ sanitize: async () => undefined }).unfinishedFor(turn({ state: 'error' }))
    ).toBeUndefined();
  });
});
