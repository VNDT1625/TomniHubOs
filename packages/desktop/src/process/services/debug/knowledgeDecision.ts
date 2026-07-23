import type { ExperienceSuggestion } from '@process/experience/experienceTypes';
import type { WorkStatus } from './workStatus';

export const EXPBASE_ADVISORY_SCORE = 0.6;
export const EXPBASE_AUTO_SCORE = 0.78;
export const EXPBASE_STRONG_SCORE = 0.85;

export type ExperienceMatchTier = 'strong' | 'auto' | 'advisory';

export type SelectedExperience = ExperienceSuggestion & { tier: ExperienceMatchTier };

export type ExternalKnowledgeDecision = {
  recommended: boolean;
  priority: 'none' | 'normal' | 'high';
  reason: string;
  query?: string;
};

/** Keep ExpBase context small and exclude weak matches from automatic prompts. */
export const selectExperienceMatches = (
  suggestions: readonly ExperienceSuggestion[],
  options: { includeAdvisory?: boolean; limit?: number } = {}
): SelectedExperience[] => {
  const minimum = options.includeAdvisory ? EXPBASE_ADVISORY_SCORE : EXPBASE_AUTO_SCORE;
  return suggestions
    .filter((suggestion) => suggestion.score >= minimum)
    .toSorted((left, right) => right.score - left.score || left.entryId.localeCompare(right.entryId))
    .slice(0, options.limit ?? 3)
    .map((suggestion) => ({
      ...suggestion,
      tier:
        suggestion.score >= EXPBASE_STRONG_SCORE
          ? 'strong'
          : suggestion.score >= EXPBASE_AUTO_SCORE
            ? 'auto'
            : 'advisory',
    }));
};

const redactSearchText = (value: string): string =>
  value
    .replace(/\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\b/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();

/** Decide whether current evidence benefits from version-aware external knowledge. */
export const decideExternalKnowledge = (input: {
  symptom: string;
  workStatus?: WorkStatus;
  experienceMatches?: readonly SelectedExperience[];
  frameworks?: readonly string[];
  packages?: readonly string[];
}): ExternalKnowledgeDecision => {
  const symptom = redactSearchText(input.symptom);
  const context = [...(input.frameworks ?? []), ...(input.packages ?? [])].map(redactSearchText).filter(Boolean);
  const externalSignal =
    /\b(version|release|deprecated|protocol|provider|sdk|api|http|electron|node|typescript|vitest|react|windows|android|linux|macos)\b/i.test(
      `${symptom} ${context.join(' ')}`
    );
  const deepDebug = input.workStatus?.mode === 'deep-debug' || input.workStatus?.mode === 'backtrack';
  const onlineSearch = input.workStatus?.mode === 'online-search';
  const stalled = (input.workStatus?.stagnationTicks ?? 0) > 0;
  const hasStrongExperience = (input.experienceMatches ?? []).some((match) => match.score >= EXPBASE_STRONG_SCORE);

  if (!externalSignal && !deepDebug && !stalled) {
    return { recommended: false, priority: 'none', reason: 'Local evidence is sufficient; avoid unnecessary search.' };
  }
  if (hasStrongExperience && !deepDebug && !stalled) {
    return { recommended: false, priority: 'none', reason: 'A strongly verified ExpBase match is available first.' };
  }
  const query = redactSearchText([symptom, ...context].filter(Boolean).join(' ')).slice(0, 320);
  return {
    recommended: true,
    priority: deepDebug || onlineSearch || stalled ? 'high' : 'normal',
    reason: onlineSearch
      ? 'The bounded local loop is exhausted; try one version-matched online experience before backtracking.'
      : deepDebug
        ? 'Deep Debug requires checking current external knowledge before another speculative patch.'
        : stalled
          ? 'The local fix loop stalled; search for version-specific references and known failure patterns.'
          : 'The symptom is dependency, platform, protocol, or version sensitive.',
    ...(query ? { query } : {}),
  };
};

export const renderKnowledgeDecision = (
  matches: readonly SelectedExperience[],
  external: ExternalKnowledgeDecision
): string => {
  const lines = ['## Debug knowledge'];
  if (matches.length === 0) lines.push('ExpBase: no verified match above the automatic threshold.');
  else {
    lines.push('ExpBase matches (advisory; verify against this repository):');
    for (const match of matches) {
      lines.push(
        `- ${match.entryId} · score=${match.score.toFixed(2)} · ${match.tier} · ${match.lesson}`,
        `  Checks: ${match.suggestedChecks.slice(0, 3).join(' | ') || 'none'}`
      );
    }
  }
  lines.push(
    external.recommended
      ? `External search: ${external.priority.toUpperCase()} — ${external.reason}\nQuery: ${external.query ?? 'derive from the verified failure fingerprint'}\nUse official docs/source issues first; forum results are hypotheses, never proof.`
      : `External search: SKIP — ${external.reason}`
  );
  return lines.join('\n');
};
