export type DeckDesignLayout =
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
  | 'metrics'
  | 'architecture'
  | 'closing';

export type DeckDesignStyle = 'modern' | 'minimal' | 'editorial' | 'technical' | 'cinematic' | 'academic';

export type DeckTransition = 'none' | 'fade' | 'push' | 'wipe' | 'split';

export type DeckDesignTheme = {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  fontFamily: string;
};

export type DeckDesignItem = {
  label: string;
  value?: string;
  detail?: string;
  group?: string;
};

export type DeckDesignColumn = {
  heading: string;
  bullets: string[];
};

export type DeckDesignSlide = {
  title: string;
  subtitle?: string;
  bullets: string[];
  layout: DeckDesignLayout;
  imageUrl?: string;
  accentColor?: string;
  chartValues?: number[][];
  chartLabels?: string[];
  items?: DeckDesignItem[];
  columns?: DeckDesignColumn[];
  source?: string;
  speakerNotes?: string;
  transition?: DeckTransition;
};

export type DeckDesignPlan = {
  title: string;
  subtitle?: string;
  designStyle?: DeckDesignStyle;
  theme: DeckDesignTheme;
  slides: DeckDesignSlide[];
};

export type DeckBuildOptions = {
  mode?: 'replace' | 'append';
};

/** Conservative, documented ONLYOFFICE animation effects used by agent tools. */
export const OBJECT_ANIMATION_EFFECTS = [
  'entranceAppear',
  'entranceFade',
  'entranceFlyIn',
  'entranceWipe',
  'entranceZoom',
  'emphasisPulse',
  'emphasisGrowShrink',
  'exitFadeOut',
] as const;

export const OBJECT_ANIMATION_TRIGGERS = ['onclick', 'withprevious', 'afterprevious'] as const;

export const OBJECT_ANIMATION_PURPOSES = [
  'progressive-disclosure',
  'causal-sequence',
  'process-flow',
  'comparison',
  'emphasis',
  'focus-transition',
  'exit-cleanup',
] as const;

export type ObjectAnimationEffect = (typeof OBJECT_ANIMATION_EFFECTS)[number];
export type ObjectAnimationTrigger = (typeof OBJECT_ANIMATION_TRIGGERS)[number];
export type ObjectAnimationPurpose = (typeof OBJECT_ANIMATION_PURPOSES)[number];

/** A purpose-led object animation request for a one-based slide index. */
export type ObjectAnimationSpec = {
  slideIndex: number;
  /** Preferred stable target; discover it through animation review. */
  drawingName?: string;
  /** Zero-based fallback target; use with drawingName when possible. */
  drawingIndex?: number;
  effect: ObjectAnimationEffect;
  trigger: ObjectAnimationTrigger;
  durationMs: number;
  delayMs: number;
  repeatCount: number;
  /** Order within the submitted batch on this slide (zero-based). */
  order: number;
  purpose: ObjectAnimationPurpose;
  rationale: string;
};
