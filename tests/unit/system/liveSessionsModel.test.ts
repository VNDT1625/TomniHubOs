import { describe, expect, it } from 'vitest';

import {
  aggregateDisplay,
  displayStatus,
  IDLE_TO_GREY_MS,
  LIVE_SESSION_LIMITS,
  normalizeSessions,
  type LiveSession,
} from '@/common/liveSessions/model';

const session = (patch: Partial<LiveSession> = {}): LiveSession => ({
  id: 'a',
  title: 'Tab',
  status: 'idle',
  ...patch,
});

describe('normalizeSessions', () => {
  it('returns undefined when the input is not an array', () => {
    expect(normalizeSessions('x')).toBeUndefined();
    expect(normalizeSessions(null)).toBeUndefined();
    expect(normalizeSessions({ sessions: [] })).toBeUndefined();
  });

  it('drops entries without id or title and entries with an unknown status', () => {
    const result = normalizeSessions([
      { id: 'ok', title: 'Good', status: 'working' },
      { title: 'no id', status: 'idle' },
      { id: 'no-title', status: 'idle' },
      { id: 'bad', title: 'Bad status', status: 'bogus' },
      42,
      null,
    ]);
    expect(result?.map((entry) => entry.id)).toEqual(['ok']);
  });

  it('caps the list at the session limit', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ id: `s${index}`, title: 't', status: 'idle' }));
    expect(normalizeSessions(many)).toHaveLength(LIVE_SESSION_LIMITS.maxSessions);
  });

  it('collapses whitespace and cuts long titles', () => {
    const [entry] = normalizeSessions([{ id: 'a', title: `  ${'x'.repeat(500)}  \n y`, status: 'idle' }]) ?? [];
    expect(entry.title).toHaveLength(LIVE_SESSION_LIMITS.title);
  });

  it('keeps the later entry when ids repeat', () => {
    const result = normalizeSessions([
      { id: 'a', title: 'first', status: 'idle' },
      { id: 'a', title: 'second', status: 'working' },
    ]);
    expect(result).toEqual([{ id: 'a', title: 'second', status: 'working' }]);
  });

  it('keeps only finite lastActiveAt and well-formed icons', () => {
    const [entry] =
      normalizeSessions([
        { id: 'a', title: 't', status: 'idle', lastActiveAt: Number.NaN, icon: 'Bad Icon!', group: 'g', detail: 'd' },
      ]) ?? [];
    expect(entry.lastActiveAt).toBeUndefined();
    expect(entry.icon).toBeUndefined();
    expect(entry.group).toBe('g');
    expect(entry.detail).toBe('d');
  });
});

describe('normalizeSessions: hostile input', () => {
  it('treats a non-empty list with no valid entry as unreadable, not as an empty list', () => {
    expect(normalizeSessions([{ id: 'a', title: 'x', status: 'IDLE' }])).toBeUndefined();
    expect(normalizeSessions([null, 5, 'x'])).toBeUndefined();
  });

  it('still treats an explicitly empty list as an empty list', () => {
    expect(normalizeSessions([])).toEqual([]);
  });

  it('only looks at the first entries so a huge list cannot stall Main', () => {
    const many = Array.from({ length: 1_000 }, (_, index) => ({ id: `s${index}`, title: 't', status: 'idle' }));
    const result = normalizeSessions([...many.slice(0, 5), ...Array.from({ length: 600 }, () => null), ...many.slice(5)]);
    expect(result?.map((entry) => entry.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });

  it('keeps ids exactly as sent so a focus request can find the session again', () => {
    const [entry] = normalizeSessions([{ id: 'docs/My  Docs/a.md', title: 't', status: 'idle' }]) ?? [];
    expect(entry.id).toBe('docs/My  Docs/a.md');
  });

  it('drops an id that is blank or longer than the limit instead of cutting it', () => {
    const result = normalizeSessions([
      { id: 'x'.repeat(LIVE_SESSION_LIMITS.id + 1), title: 't', status: 'idle' },
      { id: '   ', title: 't', status: 'idle' },
      { id: 'ok', title: 't', status: 'idle' },
    ]);
    expect(result?.map((entry) => entry.id)).toEqual(['ok']);
  });
});

describe('displayStatus', () => {
  it('turns idle into dormant only after five minutes without activity', () => {
    expect(displayStatus(session({ lastActiveAt: 0 }), IDLE_TO_GREY_MS)).toBe('idle');
    expect(displayStatus(session({ lastActiveAt: 0 }), IDLE_TO_GREY_MS + 1)).toBe('dormant');
  });

  it('keeps idle without lastActiveAt and never dims other statuses', () => {
    expect(displayStatus(session(), 10 * IDLE_TO_GREY_MS)).toBe('idle');
    expect(displayStatus(session({ status: 'working', lastActiveAt: 0 }), 10 * IDLE_TO_GREY_MS)).toBe('working');
    expect(displayStatus(session({ status: 'suspended' }), 0)).toBe('suspended');
  });
});

describe('aggregateDisplay', () => {
  it('ranks error above attention above working above idle above suspended', () => {
    const now = 0;
    expect(
      aggregateDisplay([session({ status: 'idle' }), session({ id: 'b', status: 'error' }), session({ id: 'c', status: 'working' })], now)
    ).toBe('error');
    expect(aggregateDisplay([session({ status: 'working' }), session({ id: 'b', status: 'attention' })], now)).toBe('attention');
    expect(aggregateDisplay([session({ status: 'suspended' }), session({ id: 'b', status: 'idle' })], now)).toBe('idle');
  });

  it('returns undefined for an empty list', () => {
    expect(aggregateDisplay([], 0)).toBeUndefined();
  });
});
