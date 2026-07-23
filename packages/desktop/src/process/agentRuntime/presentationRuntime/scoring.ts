import { PRESENTATION_SCORE_THRESHOLD, validatePresentationPlan } from './rules';
import type {
  PresentationPlan,
  PresentationQualityDimension,
  PresentationQualityIssue,
  PresentationQualityReport,
} from './types';

const DIMENSIONS: PresentationQualityDimension[] = [
  'story',
  'clarity',
  'density',
  'visuals',
  'evidence',
  'consistency',
  'actionability',
  'accessibility',
];

const REQUIRED_PENALTY = 14;
const RECOMMENDED_PENALTY = 6;

/** Score a presentation plan before generation so weak decks are revised before touching the live file. */
export const scorePresentationPlan = (plan: PresentationPlan): PresentationQualityReport => {
  const issues = validatePresentationPlan(plan);
  const dimensionScores = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 100])) as Record<
    PresentationQualityDimension,
    number
  >;

  for (const issue of issues) {
    const penalty = issue.severity === 'required' ? REQUIRED_PENALTY : RECOMMENDED_PENALTY;
    dimensionScores[issue.dimension] = Math.max(0, dimensionScores[issue.dimension] - penalty);
  }

  if (plan.storyArc.length < 3) dimensionScores.story = Math.max(0, dimensionScores.story - REQUIRED_PENALTY);
  if (plan.audience.trim().length === 0 || plan.objective.trim().length === 0) {
    dimensionScores.clarity = Math.max(0, dimensionScores.clarity - REQUIRED_PENALTY);
  }

  const score = Math.round(
    DIMENSIONS.reduce((total, dimension) => total + dimensionScores[dimension], 0) / DIMENSIONS.length
  );
  const requiredIssues = issues.filter((issue) => issue.severity === 'required');

  return {
    score,
    passed: score >= PRESENTATION_SCORE_THRESHOLD && requiredIssues.length === 0,
    dimensionScores,
    issues,
  };
};

/** Render compact revision instructions suitable for an agent self-correction loop. */
export const renderPresentationRevisionBrief = (report: PresentationQualityReport): string => {
  if (report.passed) return `Plan quality gate passed at ${report.score}/100.`;
  const required = report.issues.filter((issue) => issue.severity === 'required');
  const recommended = report.issues.filter((issue) => issue.severity === 'recommended');
  const render = (issue: PresentationQualityIssue): string =>
    `- ${issue.slideId ? `[${issue.slideId}] ` : ''}${issue.message}`;

  return [
    `Plan quality gate failed at ${report.score}/100; target is ${PRESENTATION_SCORE_THRESHOLD}+.`,
    required.length > 0 ? `Required fixes:\n${required.map(render).join('\n')}` : '',
    recommended.length > 0 ? `Recommended fixes:\n${recommended.map(render).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};
