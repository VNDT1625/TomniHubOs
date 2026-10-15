/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveAudience, selectReaders } from '@renderer/pages/guid/HubHome/company/companyGroups';
import { buildGroupPrompt, PASS_TOKEN } from '@renderer/pages/guid/HubHome/company/group/groupPrompts';
import {
  GROUP_RELEVANCE_THRESHOLD,
  sanitizeRoutingInput,
  scoreByKeywords,
  scoreGroupRelevance,
} from '@process/company/routing/groupRelevance';

const role = (id: string, name: string, children: unknown[] = []) => ({ id, role: 'worker', name, children });
const lead = role('lead', 'Lead');
const fe = role('fe', 'Frontend');
const be = role('be', 'Backend');
const structure = { companyId: 'c', root: { ...role('root', 'Boss', [lead, fe, be]), role: 'president' } };
const group = { id: 'g', name: 'g', leader: lead, members: [fe, be] };

describe('selectReaders', () => {
  const audience = resolveAudience(group as never, structure as never, 'hello');

  it('calls only members at or above the threshold', () => {
    const picked = selectReaders(
      audience,
      new Map([
        ['lead', 0.1],
        ['fe', 0.9],
        ['be', 0.59],
      ]),
      'lead'
    );
    expect(picked.called.map((n) => n.id)).toEqual(['fe']);
    expect(picked.skipped.map((s) => s.role.id)).toEqual(['lead', 'be']);
  });

  it('always includes tagged members and falls back to the leader', () => {
    const tagged = resolveAudience(group as never, structure as never, '@Backend ping');
    expect(selectReaders(tagged, new Map(), 'lead').called.map((n) => n.id)).toEqual(['be']);
    expect(selectReaders(audience, new Map(), 'lead').called.map((n) => n.id)).toEqual(['lead']);
  });
});

describe('group relevance scoring', () => {
  const candidates = [
    { id: 'fe', name: 'Frontend', responsibilities: 'react ui components' },
    { id: 'be', name: 'Backend', responsibilities: 'database api' },
  ];

  it('bounds untrusted input', () => {
    expect(sanitizeRoutingInput('', candidates)).toBeNull();
    expect(sanitizeRoutingInput('hi', [])).toBeNull();
    expect(sanitizeRoutingInput('x'.repeat(9000), candidates)?.text.length).toBe(4000);
  });

  it('scores by keywords when Laya is unavailable', async () => {
    const result = await scoreGroupRelevance({ text: 'fix the database api', candidates }, undefined);
    const byId = new Map(result.scores.map((s) => [s.id, s.score]));
    expect(result.source).toBe('keywords');
    expect(byId.get('be')).toBeGreaterThanOrEqual(GROUP_RELEVANCE_THRESHOLD);
    expect(byId.get('fe')).toBe(0);
    expect(scoreByKeywords('x', [{ id: 'z', name: '' }])[0].score).toBe(0);
  });

  it('uses Laya answers and clamps them', async () => {
    const predictor = async () => ({ answers: { a0: { noul: 1.7 }, a1: { noul: 0.2 } } });
    const result = await scoreGroupRelevance({ text: 'ui', candidates }, predictor);
    expect(result).toEqual({
      source: 'laya',
      scores: [
        { id: 'fe', score: 1 },
        { id: 'be', score: 0.2 },
      ],
    });
  });

  it('falls back when Laya throws', async () => {
    const result = await scoreGroupRelevance({ text: 'react', candidates }, async () => {
      throw new Error('down');
    });
    expect(result.source).toBe('keywords');
  });
});

describe('group prompt', () => {
  const line = (text: string) => ({ id: text, from: 'user', name: 'User', text, at: 0 });

  it('lets members pass and notes omitted backlog', () => {
    const prompt = buildGroupPrompt({
      companyName: 'Acme',
      group: group as never,
      role: fe as never,
      guest: false,
      unseen: [line('hi')],
      omitted: 5,
    });
    expect(prompt).toContain(`reply with exactly ${PASS_TOKEN}`);
    expect(prompt).toContain('(5 earlier lines omitted)');
    expect(prompt).toContain('@mention them by name');
  });

  it('tells a handed-off agent who passed it the work', () => {
    const prompt = buildGroupPrompt({
      companyName: 'Acme',
      group: group as never,
      role: be as never,
      guest: false,
      unseen: [],
      handoffFrom: 'Lead',
    });
    expect(prompt).toContain('Lead mentioned you');
    expect(prompt).not.toContain(PASS_TOKEN);
  });

  it('matches Vietnamese keywords without diacritics', () => {
    const [score] = scoreByKeywords('Sửa giao diện đăng nhập', [
      { id: 'fe', name: 'Frontend', responsibilities: 'giao dien dang nhap' },
    ]);
    expect(score.score).toBeGreaterThanOrEqual(GROUP_RELEVANCE_THRESHOLD);
  });
});
