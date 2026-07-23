import type { PresentationPlan, PresentationQualityIssue, PresentationSlideSpec } from './types';

export const PRESENTATION_SCORE_THRESHOLD = 92;
export const MAX_SLIDE_WORDS = 55;
export const MAX_SLIDE_BULLETS = 5;
export const MAX_BULLET_WORDS = 18;

const countWords = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;

const slideWordCount = (slide: PresentationSlideSpec): number =>
  countWords([slide.title, slide.subtitle, slide.message, ...slide.bullets].filter(Boolean).join(' '));

/** Validate a planned deck before any Office mutation occurs. */
export const validatePresentationPlan = (plan: PresentationPlan): PresentationQualityIssue[] => {
  const issues: PresentationQualityIssue[] = [];
  const ids = new Set<string>();

  if (plan.slides.length < 3) {
    issues.push({
      dimension: 'story',
      severity: 'required',
      message: 'Use at least a cover, a proof/body slide, and a closing slide.',
    });
  }

  for (const slide of plan.slides) {
    if (ids.has(slide.id)) {
      issues.push({
        dimension: 'consistency',
        severity: 'required',
        message: `Duplicate slide id: ${slide.id}.`,
        slideId: slide.id,
      });
    }
    ids.add(slide.id);

    if (slide.message.trim().length === 0) {
      issues.push({
        dimension: 'clarity',
        severity: 'required',
        message: 'Every slide needs one explicit takeaway message.',
        slideId: slide.id,
      });
    }
    if (slideWordCount(slide) > MAX_SLIDE_WORDS) {
      issues.push({
        dimension: 'density',
        severity: 'required',
        message: `Reduce slide copy below ${MAX_SLIDE_WORDS} words.`,
        slideId: slide.id,
      });
    }
    if (slide.bullets.length > MAX_SLIDE_BULLETS) {
      issues.push({
        dimension: 'density',
        severity: 'required',
        message: `Use no more than ${MAX_SLIDE_BULLETS} bullets.`,
        slideId: slide.id,
      });
    }
    if (slide.bullets.some((bullet) => countWords(bullet) > MAX_BULLET_WORDS)) {
      issues.push({
        dimension: 'density',
        severity: 'recommended',
        message: `Keep each bullet below ${MAX_BULLET_WORDS} words.`,
        slideId: slide.id,
      });
    }
    if (slide.layout === 'chart' && slide.visualKind !== 'chart') {
      issues.push({
        dimension: 'visuals',
        severity: 'required',
        message: 'Chart layouts must contain a chart visual.',
        slideId: slide.id,
      });
    }
    if (slide.visualKind === 'none' && !['cover', 'section', 'quote', 'closing'].includes(slide.layout)) {
      issues.push({
        dimension: 'visuals',
        severity: 'recommended',
        message: 'Body slides should use a meaningful visual, diagram, table, or chart.',
        slideId: slide.id,
      });
    }
  }

  const hasEvidence = plan.slides.some((slide) => Boolean(slide.evidence) || slide.visualKind === 'chart');
  if (!hasEvidence) {
    issues.push({
      dimension: 'evidence',
      severity: 'required',
      message: 'Add at least one quantified proof, source, comparison, or chart slide.',
    });
  }

  const lastSlide = plan.slides.at(-1);
  if (!lastSlide?.nextAction && lastSlide?.layout !== 'closing') {
    issues.push({
      dimension: 'actionability',
      severity: 'required',
      message: 'End with a decision, recommendation, or next action.',
      slideId: lastSlide?.id,
    });
  }

  return issues;
};

export const PRESENTATION_DESIGN_RULES = [
  'Use one clear takeaway per slide and make the headline state that takeaway.',
  `Keep total visible copy at or below ${MAX_SLIDE_WORDS} words per slide.`,
  `Use at most ${MAX_SLIDE_BULLETS} bullets and keep each bullet below ${MAX_BULLET_WORDS} words.`,
  'Use a 12-column grid, consistent outer margins, aligned edges, and deliberate whitespace.',
  'Use one font family, no more than three font sizes per slide, and strong contrast.',
  'Do not use decorative visuals. Every image, chart, icon, or shape must support the takeaway.',
  'Use real charts for quantitative claims and label the source or evidence in the slide or notes.',
  'Vary layouts across adjacent slides while preserving a single visual system.',
  'Finish with a recommendation, decision, or next action.',
].join('\n- ');
