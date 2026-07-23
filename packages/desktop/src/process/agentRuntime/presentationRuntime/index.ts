export { buildPresentationRuntimePrompt } from './prompt';
export {
  MAX_BULLET_WORDS,
  MAX_SLIDE_BULLETS,
  MAX_SLIDE_WORDS,
  PRESENTATION_DESIGN_RULES,
  PRESENTATION_SCORE_THRESHOLD,
  validatePresentationPlan,
} from './rules';
export { renderPresentationRevisionBrief, scorePresentationPlan } from './scoring';
export type {
  PresentationLayout,
  PresentationPlan,
  PresentationQualityDimension,
  PresentationQualityIssue,
  PresentationQualityReport,
  PresentationSlideSpec,
  PresentationVisualKind,
} from './types';
