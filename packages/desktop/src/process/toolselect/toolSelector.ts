/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CatalogEntry, ScoredEntry } from './catalogTypes';
import type { ICatalog } from './catalog';
import { keywordFilter, type KeywordFilterOptions } from './keywordFilter';
import type { ISemanticFilter } from './semanticFilter';
import type { ISelectionLog, SelectionOutcome } from './selectionLog';

export type AttemptResult = {
  ok: boolean;
  detail?: string;
  outcome?: SelectionOutcome;
};

export type AttemptFn = (entry: CatalogEntry, request: string) => Promise<AttemptResult>;

export type SelectionTier = 'keyword' | 'semantic' | 'recall' | 'advisor';

export type SelectionFactors = {
  compatibility?: number;
  availability?: number;
  health?: number;
  historicalSuccess?: number;
  latency?: number;
  monetaryCost?: number;
  tokenCost?: number;
  memory?: number;
  cpu?: number;
  risk?: number;
};

export type ExplainedCandidate = ScoredEntry & {
  tier: SelectionTier;
  explanation: string;
  factors: SelectionFactors;
};

export type RejectedCandidate = {
  entry: CatalogEntry;
  reason: string;
  factors: SelectionFactors;
};

export type AdvisorInput = {
  request: string;
  candidates: ExplainedCandidate[];
};

export type AdvisorOutput = {
  candidateId: string;
  explanation: string;
};

export type SelectionAdvisor = (input: AdvisorInput) => Promise<unknown>;

export type ToolSelectorDeps = {
  catalog: ICatalog;
  semanticFilter?: ISemanticFilter;
  selectionLog: ISelectionLog;
  topK?: number;
  maxRounds?: number;
  keywordOptions?: KeywordFilterOptions;
  advisor?: SelectionAdvisor;
  advisorThreshold?: number;
  ambiguityDelta?: number;
  factors?: (entry: CatalogEntry, request: string) => SelectionFactors;
  eligible?: (entry: CatalogEntry, request: string) => boolean | string;
};

export type SelectionResult = {
  succeeded: boolean;
  candidates: ScoredEntry[];
  tried: CatalogEntry[];
  chosen?: CatalogEntry;
  fromRecall: boolean;
  explanation: string;
  tier: SelectionTier;
  rejected: RejectedCandidate[];
  factors: SelectionFactors;
};

export type IToolSelector = {
  shortlist(request: string): Promise<ScoredEntry[]>;
  select(request: string, attempt: AttemptFn): Promise<SelectionResult>;
};

const isAdvisorOutput = (value: unknown, allowed: Set<string>): value is AdvisorOutput => {
  if (!value || typeof value !== 'object') return false;
  const candidateId = Reflect.get(value, 'candidateId');
  const explanation = Reflect.get(value, 'explanation');
  return typeof candidateId === 'string' && allowed.has(candidateId) && typeof explanation === 'string';
};

export const createToolSelector = (deps: ToolSelectorDeps): IToolSelector => {
  const topK = deps.topK ?? 5;
  const maxRounds = deps.maxRounds ?? 3;
  const advisorThreshold = deps.advisorThreshold ?? 1;
  const ambiguityDelta = deps.ambiguityDelta ?? 0.25;
  const factorValues = (entry: CatalogEntry, request: string): SelectionFactors => deps.factors?.(entry, request) ?? {};
  let shortlistTier: Exclude<SelectionTier, 'recall' | 'advisor'> = 'keyword';

  const shortlist: IToolSelector['shortlist'] = async (request) => {
    const entries = await deps.catalog.list();
    const eligible = entries.filter(
      (entry) => deps.eligible?.(entry, request) !== false && typeof deps.eligible?.(entry, request) !== 'string'
    );
    const keyworded = keywordFilter(request, eligible, { ...deps.keywordOptions, limit: Math.max(topK * 2, topK) });
    shortlistTier = 'keyword';

    if (deps.semanticFilter) {
      const base = keyworded.length > 0 ? keyworded.map((scored) => scored.entry) : eligible;
      await deps.semanticFilter.index(base);
      const ranked = await deps.semanticFilter.rank(request, topK);
      if (ranked.length > 0) {
        shortlistTier = 'semantic';
        return ranked.slice(0, topK);
      }
    }

    return keyworded.slice(0, topK);
  };

  const select: IToolSelector['select'] = async (request, attempt) => {
    let candidates = await shortlist(request);
    const rejected: RejectedCandidate[] = [];
    const allEntries = await deps.catalog.list();
    for (const entry of allEntries) {
      const eligibility = deps.eligible?.(entry, request);
      if (eligibility === false || typeof eligibility === 'string') {
        rejected.push({
          entry,
          reason: typeof eligibility === 'string' ? eligibility : 'ineligible',
          factors: factorValues(entry, request),
        });
      }
    }

    let tier: SelectionTier = shortlistTier;
    let explanation = candidates[0]?.reason ?? 'no candidate matched';
    const explained = (): ExplainedCandidate[] =>
      candidates.map((candidate) => ({
        ...candidate,
        tier: shortlistTier,
        explanation: candidate.reason,
        factors: factorValues(candidate.entry, request),
      }));
    const hardCase =
      candidates.length === 0 ||
      (candidates[0]?.score ?? 0) < advisorThreshold ||
      (candidates.length > 1 && Math.abs(candidates[0].score - candidates[1].score) <= ambiguityDelta);

    if (hardCase && deps.advisor && candidates.length > 0) {
      try {
        const advised = await deps.advisor({ request, candidates: explained() });
        if (isAdvisorOutput(advised, new Set(candidates.map((candidate) => candidate.entry.id)))) {
          const selected = candidates.find((candidate) => candidate.entry.id === advised.candidateId);
          if (selected) {
            candidates = [selected, ...candidates.filter((candidate) => candidate !== selected)];
            tier = 'advisor';
            explanation = advised.explanation;
          }
        }
      } catch {
        // Advisor is optional; deterministic ranking remains the safe fallback.
      }
    }

    const recalled = await deps.selectionLog.recall(request);
    if (recalled?.chosen[0]) {
      const entry = candidates.find((candidate) => candidate.entry.id === recalled.chosen[0])?.entry;
      if (entry) {
        const result = await attempt(entry, request);
        if (result.ok) {
          return {
            succeeded: true,
            candidates,
            tried: [entry],
            chosen: entry,
            fromRecall: true,
            explanation: 'verified historical selection',
            tier: 'recall',
            rejected,
            factors: factorValues(entry, request),
          };
        }
        rejected.push({
          entry,
          reason: result.detail ?? 'recalled candidate failed',
          factors: factorValues(entry, request),
        });
        candidates = candidates.filter((candidate) => candidate.entry.id !== entry.id);
      }
    }

    const tried: CatalogEntry[] = [];
    const rounds = Math.min(maxRounds, candidates.length);
    for (let i = 0; i < rounds; i++) {
      const candidate = candidates[i];
      if (!candidate) break;
      const entry = candidate.entry;
      tried.push(entry);
      const result = await attempt(entry, request);
      if (result.ok) {
        await deps.selectionLog.record(request, [entry.id], true);
        return {
          succeeded: true,
          candidates,
          tried,
          chosen: entry,
          fromRecall: false,
          explanation: tier === 'advisor' && i === 0 ? explanation : candidate.reason,
          tier: tier === 'advisor' && i === 0 ? 'advisor' : shortlistTier,
          rejected,
          factors: factorValues(entry, request),
        };
      }
      rejected.push({ entry, reason: result.detail ?? 'attempt failed', factors: factorValues(entry, request) });
    }

    await deps.selectionLog.record(
      request,
      tried.map((entry) => entry.id),
      false
    );
    return { succeeded: false, candidates, tried, fromRecall: false, explanation, tier, rejected, factors: {} };
  };

  return { shortlist, select };
};
