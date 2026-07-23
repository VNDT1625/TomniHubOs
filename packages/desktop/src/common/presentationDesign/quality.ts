import type { DeckDesignLayout, DeckDesignPlan, DeckDesignSlide } from './types';

export type DeckPreflightIssue = {
  severity: 'required' | 'recommended';
  message: string;
  slideIndex?: number;
};

export type DeckPreflightReport = {
  passed: boolean;
  score: number;
  issues: DeckPreflightIssue[];
};

const VISUAL_LAYOUTS = new Set<DeckDesignLayout>([
  'image',
  'chart',
  'comparison',
  'timeline',
  'process',
  'metrics',
  'architecture',
]);

const countWords = (value: string): number => value.trim().split(/\s+/).filter(Boolean).length;

const visibleSlideWords = (slide: DeckDesignSlide): number => {
  const itemCopy = (slide.items ?? []).flatMap((item) => [item.label, item.value ?? '', item.detail ?? '']);
  const columnCopy = (slide.columns ?? []).flatMap((column) => [column.heading].concat(column.bullets));
  return countWords([slide.title, slide.subtitle ?? '', ...slide.bullets, ...itemCopy, ...columnCopy].join(' '));
};

const requiresItems = (layout: DeckDesignLayout): boolean =>
  ['agenda', 'timeline', 'process', 'metrics', 'architecture'].includes(layout);

/** Validate a normalized deck plan before mutating the live presentation. */
export const preflightDeckDesignPlan = (
  plan: DeckDesignPlan,
  mode: 'replace' | 'append' = 'replace'
): DeckPreflightReport => {
  const issues: DeckPreflightIssue[] = [];
  const add = (issue: DeckPreflightIssue): void => {
    issues.push(issue);
  };

  if (mode === 'replace') {
    if (plan.slides.length < 3) {
      add({ severity: 'required', message: 'Use at least a cover, one proof/body slide, and a closing slide.' });
    }
    if (plan.slides[0]?.layout !== 'cover') {
      add({ severity: 'required', message: 'The first slide must use the cover layout.' });
    }
    if (plan.slides.at(-1)?.layout !== 'closing') {
      add({ severity: 'required', message: 'The final slide must use the closing layout with a clear next action.' });
    }
    if (plan.slides.length >= 6 && new Set(plan.slides.map((slide) => slide.layout)).size < 3) {
      add({ severity: 'recommended', message: 'Vary at least three layouts across a deck of six or more slides.' });
    }
    if (!plan.slides.some((slide) => VISUAL_LAYOUTS.has(slide.layout))) {
      add({
        severity: 'required',
        message: 'Add at least one meaningful visual, chart, comparison, process or architecture slide.',
      });
    }
  }

  plan.slides.forEach((slide, index) => {
    const slideIndex = index + 1;
    const words = visibleSlideWords(slide);
    if (words > 70) {
      add({ severity: 'required', message: 'Reduce visible copy below 70 words.', slideIndex });
    } else if (words > 55) {
      add({
        severity: 'recommended',
        message: 'Reduce visible copy below 55 words for presenter-friendly density.',
        slideIndex,
      });
    }
    if (slide.bullets.length > 5) {
      add({ severity: 'recommended', message: 'Use no more than five visible bullets.', slideIndex });
    }
    if (slide.layout === 'chart' && (!slide.chartValues || slide.chartValues.length === 0)) {
      add({ severity: 'required', message: 'Chart layouts require chartValues.', slideIndex });
    }
    if (slide.layout === 'comparison' && (!slide.columns || slide.columns.length < 2)) {
      add({ severity: 'required', message: 'Comparison layouts require at least two columns.', slideIndex });
    }
    if (requiresItems(slide.layout) && (!slide.items || slide.items.length === 0) && slide.bullets.length === 0) {
      add({
        severity: 'required',
        message: `${slide.layout} layouts require structured items or bullets.`,
        slideIndex,
      });
    }
    if ((slide.layout === 'image' || slide.layout === 'split') && !slide.imageUrl) {
      add({ severity: 'recommended', message: 'Image-led layouts should include an imageUrl.', slideIndex });
    }
    if ((slide.layout === 'chart' || slide.layout === 'metrics') && !slide.source) {
      add({
        severity: 'recommended',
        message: 'Quantitative slides should include a short evidence/source label.',
        slideIndex,
      });
    }
    if (slide.layout === 'closing' && slide.bullets.length === 0 && !slide.subtitle) {
      add({
        severity: 'required',
        message: 'Closing slides need a decision, recommendation or next action.',
        slideIndex,
      });
    }
  });

  const requiredCount = issues.filter((issue) => issue.severity === 'required').length;
  const recommendedCount = issues.length - requiredCount;
  const score = Math.max(0, 100 - requiredCount * 15 - recommendedCount * 5);
  return { passed: requiredCount === 0, score, issues };
};

export const renderDeckPreflightReport = (report: DeckPreflightReport): string => {
  if (report.issues.length === 0) return `Deck preflight passed: ${report.score}/100.`;
  const lines = report.issues.map((issue) => {
    const slide = issue.slideIndex ? ` slide ${issue.slideIndex}:` : ':';
    return `- [${issue.severity}]${slide} ${issue.message}`;
  });
  return `Deck preflight ${report.passed ? 'passed with recommendations' : 'blocked'}: ${report.score}/100\n${lines.join('\n')}`;
};
