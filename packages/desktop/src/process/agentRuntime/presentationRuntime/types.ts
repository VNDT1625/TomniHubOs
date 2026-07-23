export type PresentationLayout =
  | 'cover'
  | 'section'
  | 'content'
  | 'split'
  | 'image'
  | 'chart'
  | 'quote'
  | 'agenda'
  | 'comparison'
  | 'timeline'
  | 'process'
  | 'metric'
  | 'metrics'
  | 'architecture'
  | 'closing';

export type PresentationVisualKind = 'none' | 'image' | 'chart' | 'diagram' | 'table' | 'icon-grid';

export type PresentationSlideSpec = {
  id: string;
  title: string;
  message: string;
  subtitle?: string;
  bullets: string[];
  layout: PresentationLayout;
  visualKind: PresentationVisualKind;
  evidence?: string;
  nextAction?: string;
};

export type PresentationPlan = {
  title: string;
  audience: string;
  objective: string;
  tone: string;
  storyArc: string[];
  slides: PresentationSlideSpec[];
};

export type PresentationQualityDimension =
  | 'story'
  | 'clarity'
  | 'density'
  | 'visuals'
  | 'evidence'
  | 'consistency'
  | 'actionability'
  | 'accessibility';

export type PresentationQualityIssue = {
  dimension: PresentationQualityDimension;
  severity: 'required' | 'recommended';
  message: string;
  slideId?: string;
};

export type PresentationQualityReport = {
  score: number;
  passed: boolean;
  dimensionScores: Record<PresentationQualityDimension, number>;
  issues: PresentationQualityIssue[];
};
