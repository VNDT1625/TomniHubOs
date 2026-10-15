/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_RULES, type NotificationRules } from '@/common/types/platform/notificationHub';
import {
  EscalationQueue,
  buildEscalationMessages,
  isAmbiguous,
  parseEscalationReply,
  type EscalationCandidate,
  type EscalationLedger,
} from '@process/system/hubActivity/notificationTriage/escalation';
import {
  redactForModel,
  redactSecrets,
  senderDomain,
  senderIdentity,
} from '@process/system/hubActivity/notificationTriage/redaction';
import {
  MAX_REPUTATION_ENTRIES,
  recordReputation,
  reputationKey,
  reputationScore,
  type ReputationBook,
} from '@process/system/hubActivity/notificationTriage/senderReputation';
import { applyTriage, deliveryFor } from '@process/system/hubActivity/notificationTriage/triagePolicy';

const rules = (patch: Partial<NotificationRules> = {}): NotificationRules => ({
  ...structuredClone(DEFAULT_NOTIFICATION_RULES),
  ...patch,
});

describe('redaction', () => {
  it('masks codes, keys, card numbers and link queries but keeps people for agents', () => {
    const text =
      'Mã OTP 482913 cho lan@home.vn, thẻ 4111 1111 1111 1111, key sk-abcdefghijklmnop1234 https://bank.vn/reset?token=zzz password: hunter2';
    const out = redactSecrets(text);
    expect(out).not.toMatch(/482913|4111|sk-abcdef|token=zzz|hunter2/);
    expect(out).toContain('lan@home.vn');
    expect(out).toContain('https://bank.vn/…');
  });

  it('also hides mail addresses (domain only) before anything reaches an external model', () => {
    expect(redactForModel('Write to boss@acme.com today')).toBe('Write to [email@acme.com] today');
    expect(senderDomain('Boss <boss@acme.com>')).toBe('acme.com');
    expect(senderIdentity('Boss <Boss@Acme.com>')).toBe('boss@acme.com');
    expect(senderIdentity('Nguyễn Lan')).toBe('nguyễn lan');
  });
});

describe('triage policy', () => {
  const base = { level: 'P2' as const, category: 'social' as const, classifiedBy: 'rules' as const, reason: 'social' };

  it('turns levels into delivery by the interrupt threshold', () => {
    expect(deliveryFor('P0', rules())).toBe('interrupt');
    expect(deliveryFor('P1', rules())).toBe('digest');
    expect(deliveryFor('P1', rules({ interruptLevel: 'P1' }))).toBe('interrupt');
    expect(deliveryFor('P3', rules({ interruptLevel: 'P1' }))).toBe('silent');
  });

  it('silences a muted source by connector id or by kind, except a Tomny agent waiting for input', () => {
    const muted = rules({ mutedSources: ['conn-1', 'feed'] });
    expect(applyTriage(base, { rules: muted, source: 'web', connectorId: 'conn-1', reputation: 0 })).toMatchObject({
      level: 'P3',
      delivery: 'silent',
      reason: 'muted-source',
    });
    expect(applyTriage(base, { rules: muted, source: 'feed', reputation: 0 }).delivery).toBe('silent');
    const waiting = { ...base, level: 'P0' as const, reason: 'needs-input', final: true };
    expect(
      applyTriage(waiting, { rules: rules({ mutedSources: ['agent'] }), source: 'agent', reputation: 0 }).delivery
    ).toBe('interrupt');
  });

  it('lets learned reputation move a rule level one step but never to urgent', () => {
    expect(applyTriage(base, { rules: rules(), source: 'os', reputation: 3 })).toMatchObject({
      level: 'P1',
      reason: 'reputation-up',
      delivery: 'digest',
    });
    const important = { ...base, level: 'P1' as const };
    expect(applyTriage(important, { rules: rules(), source: 'os', reputation: 9 }).level).toBe('P1');
    expect(applyTriage(base, { rules: rules(), source: 'os', reputation: -3 })).toMatchObject({
      level: 'P3',
      delivery: 'silent',
    });
    expect(applyTriage({ ...base, final: true }, { rules: rules(), source: 'os', reputation: -9 }).level).toBe('P2');
    expect(applyTriage(base, { rules: rules({ learnFromFeedback: false }), source: 'os', reputation: 9 }).level).toBe(
      'P2'
    );
  });
});

describe('sender reputation', () => {
  it('scores opens and dismissals and stays bounded', () => {
    const book: ReputationBook = {};
    const key = reputationKey('Lan <lan@home.vn>', 'c1')!;
    expect(key).toBe('sender:lan@home.vn');
    expect(reputationKey(undefined, 'c1')).toBe('source:c1');
    recordReputation(book, key, 'opened', 1);
    recordReputation(book, key, 'opened', 2);
    recordReputation(book, key, 'dismissed', 3);
    expect(reputationScore(book, key)).toBe(1);
    for (let index = 0; index < MAX_REPUTATION_ENTRIES + 20; index += 1) {
      recordReputation(book, `sender:${index}`, 'opened', 10 + index);
    }
    expect(Object.keys(book)).toHaveLength(MAX_REPUTATION_ENTRIES);
    expect(book[key]).toBeUndefined();
  });
});

describe('LLM escalation', () => {
  const candidate = (id: string, patch: Partial<EscalationCandidate> = {}): EscalationCandidate => ({
    id,
    source: 'email',
    sender: 'Lan <lan@home.vn>',
    title: `Lunch? call 0912 345 678 code 123456 (${id})`,
    body: 'Private body text',
    level: 'P2',
    category: 'personal',
    ...patch,
  });

  const setup = (
    patch: Partial<{ enabled: boolean; model: string; dailyLimit: number; includeSnippet: boolean }> = {}
  ) => {
    let ledger: EscalationLedger | undefined;
    const llm = { enabled: true, model: 'cheap-model', dailyLimit: 5, includeSnippet: false, ...patch };
    const chat = vi.fn(
      async () => '[{"i":0,"level":"P1","category":"work"},{"i":1,"level":"P3","category":"promotion"}]'
    );
    const apply = vi.fn();
    const queue = new EscalationQueue({
      rules: () => llm,
      chat: () => chat,
      ledger: { read: () => ledger, write: (next) => void (ledger = next) },
      apply,
      now: () => new Date(2026, 9, 8, 9).getTime(),
      batchSize: 2,
      flushDelayMs: 60_000,
    });
    return { queue, chat, apply, ledger: () => ledger };
  };

  it('only treats unclear rule outcomes as ambiguous', () => {
    expect(isAmbiguous({ classifiedBy: 'rules', reason: 'direct-mail', level: 'P1' })).toBe(true);
    expect(isAmbiguous({ classifiedBy: 'rules', reason: 'otp', level: 'P0' })).toBe(false);
    expect(isAmbiguous({ classifiedBy: 'laya', reason: 'laya', level: 'P2' })).toBe(false);
    expect(isAmbiguous({ classifiedBy: 'rules', reason: 'promotion', level: 'P3' })).toBe(false);
  });

  it('is off by default and without a model', () => {
    const off = setup({ enabled: false });
    expect(off.queue.enqueue(candidate('a'))).toBe(false);
    const noModel = setup({ model: '' });
    expect(noModel.queue.enqueue(candidate('a'))).toBe(false);
    expect(noModel.queue.status()).toMatchObject({ active: false, usedToday: 0 });
  });

  it('sends a redacted batch, applies the decisions and charges the daily budget', async () => {
    const { queue, chat, apply, ledger } = setup();
    expect(queue.enqueue(candidate('a'))).toBe(true);
    expect(queue.enqueue(candidate('b'))).toBe(true);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const payload = JSON.stringify((chat.mock.calls as unknown as Array<[unknown]>)[0]![0]);
    expect(payload).not.toMatch(/lan@home|0912|123456|Private body/);
    expect(payload).toContain('home.vn');
    expect(apply.mock.calls[0]![0]).toEqual([
      { id: 'a', level: 'P1', category: 'work' },
      { id: 'b', level: 'P3', category: 'promotion' },
    ]);
    expect(ledger()).toMatchObject({ used: 2, day: '2026-10-08' });
    queue.dispose();
  });

  it('never exceeds the daily item budget, even when the provider fails', async () => {
    const { queue, chat, ledger } = setup({ dailyLimit: 3 });
    chat.mockRejectedValue(new Error('provider down'));
    for (const id of ['a', 'b', 'c', 'd', 'e']) queue.enqueue(candidate(id));
    await vi.waitFor(() => expect(ledger()?.lastError).toContain('provider down'));
    await queue.flush();
    await queue.flush();
    expect(ledger()?.used).toBe(3);
    expect(
      chat.mock.calls.flatMap((call) => JSON.parse((call as unknown as [Array<{ content: string }>])[0][1]!.content))
    ).toHaveLength(3);
    expect(queue.enqueue(candidate('z'))).toBe(false);
    queue.dispose();
  });

  it('includes previews only when allowed, and parses replies strictly', () => {
    const withPreview = JSON.stringify(buildEscalationMessages([candidate('a')], true));
    expect(withPreview).toContain('Private body text');
    expect(JSON.stringify(buildEscalationMessages([candidate('a')], false))).not.toContain('Private body');
    expect(parseEscalationReply('nonsense', [candidate('a')])).toEqual([]);
    expect(parseEscalationReply('[{"i":5,"level":"P0"},{"i":0,"level":"PX"}]', [candidate('a')])).toEqual([]);
    expect(parseEscalationReply('ok: [{"i":0,"level":"P0","category":"weird"}]', [candidate('a')])).toEqual([
      { id: 'a', level: 'P0', category: 'personal' },
    ]);
  });
});
