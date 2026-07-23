import { describe, expect, it } from 'vitest';

import {
  decideExternalKnowledge,
  EXPBASE_AUTO_SCORE,
  selectExperienceMatches,
} from '@/process/services/debug/knowledgeDecision';
import { createWorkStatusController } from '@/process/services/debug/workStatus';
import type { ExperienceSuggestion } from '@/process/experience/experienceTypes';

const suggestion = (entryId: string, score: number): ExperienceSuggestion => ({
  entryId,
  score,
  kind: 'successful_fix',
  symptom: 'invoice route missing',
  lesson: `lesson ${entryId}`,
  whyRelevant: ['same file'],
  caution: [],
  suggestedChecks: ['rerun billing probe'],
});

describe('debug knowledge decisions', () => {
  it('injects only verified ExpBase matches above the automatic threshold', () => {
    const matches = selectExperienceMatches([
      suggestion('weak', EXPBASE_AUTO_SCORE - 0.01),
      suggestion('auto', EXPBASE_AUTO_SCORE),
      suggestion('strong', 0.9),
    ]);

    expect(matches.map((match) => match.entryId)).toEqual(['strong', 'auto']);
    expect(matches[0]?.tier).toBe('strong');
  });

  it('skips external search for a local bug with sufficient evidence', () => {
    const decision = decideExternalKnowledge({ symptom: 'local ranking condition is incorrect' });

    expect(decision.recommended).toBe(false);
  });

  it('recommends current external knowledge for version-sensitive failures', () => {
    const decision = decideExternalKnowledge({
      symptom: 'Electron CDP protocol changed after version upgrade',
      frameworks: ['Electron 35'],
    });

    expect(decision.recommended).toBe(true);
    expect(decision.query).toContain('Electron 35');
  });

  it('raises external lookup priority when Deep Debug was forced', () => {
    const controller = createWorkStatusController();
    const workStatus = controller.start('repo', { intent: '/deep-debug unknown runtime failure' });
    const decision = decideExternalKnowledge({ symptom: 'unknown runtime failure', workStatus });

    expect(decision).toMatchObject({ recommended: true, priority: 'high' });
  });
});
