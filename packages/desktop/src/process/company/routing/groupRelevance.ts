/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LayaAnswerNoul, LayaPredictor, LayaQuestion } from '@process/services/security/layaSemanticEgressModel';

/** Agents scoring at or above this are called to read the message; the rest stay idle and spend no tokens. */
export const GROUP_RELEVANCE_THRESHOLD = 0.6;

export const MAX_ROUTING_CANDIDATES = 24;
export const MAX_ROUTING_TEXT_CHARS = 4_000;
const MAX_FIELD_CHARS = 240;

export type RoutingCandidate = { id: string; name: string; responsibilities?: string };

export type RoutingScore = { id: string; score: number };

export type RoutingResult = {
  scores: RoutingScore[];
  /** `laya` when the decision model answered, `keywords` for the deterministic fallback. */
  source: 'laya' | 'keywords';
};

const clip = (value: string | undefined, max: number): string => (value ?? '').trim().slice(0, max);

/** Bound and normalise untrusted renderer input. */
export const sanitizeRoutingInput = (
  text: unknown,
  candidates: unknown
): { text: string; candidates: RoutingCandidate[] } | null => {
  if (typeof text !== 'string' || !text.trim() || !Array.isArray(candidates)) return null;
  const seen = new Set<string>();
  const clean: RoutingCandidate[] = [];
  for (const raw of candidates.slice(0, MAX_ROUTING_CANDIDATES)) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, name, responsibilities } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    clean.push({
      id: clip(id, 200),
      name: clip(name, 80),
      responsibilities: typeof responsibilities === 'string' ? clip(responsibilities, MAX_FIELD_CHARS) : undefined,
    });
  }
  return clean.length > 0 ? { text: text.trim().slice(0, MAX_ROUTING_TEXT_CHARS), candidates: clean } : null;
};

const tokens = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/đ/g, 'd')
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2)
  );

/** Deterministic fallback: word overlap between the message and the agent's name and duties. */
export const scoreByKeywords = (text: string, candidates: readonly RoutingCandidate[]): RoutingScore[] => {
  const message = tokens(text);
  return candidates.map((candidate) => {
    const profile = tokens(`${candidate.name} ${candidate.responsibilities ?? ''}`);
    if (profile.size === 0) return { id: candidate.id, score: 0 };
    let hits = 0;
    for (const word of profile) if (message.has(word)) hits += 1;
    return { id: candidate.id, score: hits === 0 ? 0 : Math.min(1, 0.5 + hits * 0.2) };
  });
};

/**
 * Ask Laya, in one forward pass, how likely each agent is to be needed for the message. Falls back to
 * keyword overlap when the model is unavailable so routing never blocks the chat.
 */
export const scoreGroupRelevance = async (
  input: { text: string; candidates: readonly RoutingCandidate[] },
  predictor: LayaPredictor | undefined
): Promise<RoutingResult> => {
  if (predictor) {
    try {
      const questions: Record<string, LayaQuestion> = {};
      input.candidates.forEach((candidate, index) => {
        questions[`a${index}`] = {
          type: 'noul',
          instructions: `Does the body need input from ${candidate.name}${
            candidate.responsibilities ? `, whose duties are: ${candidate.responsibilities}` : ''
          }?`,
        };
      });
      const { answers } = await predictor({ body: input.text }, questions);
      return {
        source: 'laya',
        scores: input.candidates.map((candidate, index) => {
          const noul = (answers[`a${index}`] as LayaAnswerNoul | undefined)?.noul;
          return { id: candidate.id, score: typeof noul === 'number' ? Math.min(1, Math.max(0, noul)) : 0 };
        }),
      };
    } catch (error) {
      console.warn('[GroupRouting] Laya unavailable, using keyword fallback:', error);
    }
  }
  return { source: 'keywords', scores: scoreByKeywords(input.text, input.candidates) };
};
