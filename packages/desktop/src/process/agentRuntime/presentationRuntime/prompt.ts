import { PRESENTATION_DESIGN_RULES, PRESENTATION_SCORE_THRESHOLD } from './rules';

const SLIDE_SPEC_SCHEMA = `{
  "title": "deck title",
  "audience": "specific audience",
  "objective": "decision or outcome",
  "tone": "visual and verbal tone",
  "storyArc": ["context", "tension", "resolution"],
  "slides": [{
    "id": "s01",
    "title": "takeaway headline",
    "message": "one-sentence takeaway",
    "subtitle": "optional support",
    "bullets": ["short point"],
    "layout": "cover|section|content|split|image|chart|quote|agenda|comparison|timeline|process|metrics|architecture|closing",
    "visualKind": "none|image|chart|diagram|table|icon-grid",
    "evidence": "optional source or proof",
    "nextAction": "optional decision or action"
  }]
}`;

/** Build the execution protocol for high-quality PowerPoint work on the Office surface. */
export const buildPresentationRuntimePrompt = (): string =>
  [
    '[Presentation Runtime v1]',
    'For PPTX creation or major redesign, execute this gated pipeline. Do not skip stages or expose internal planning unless asked.',
    'Stage 1 — Observe: read the live deck and identify its audience, objective, constraints, reusable content, theme, and existing slide order.',
    'Stage 2 — Plan: create an internal PresentationPlan matching this schema:',
    SLIDE_SPEC_SCHEMA,
    'Stage 3 — Preflight: validate the plan against every design rule below. Revise the plan until no required issue remains and the internal score is at least ' +
      PRESENTATION_SCORE_THRESHOLD +
      '/100.',
    '- ' + PRESENTATION_DESIGN_RULES,
    'Stage 4 — Build: map supported layouts to office_create_premium_deck and use the dedicated office_add_* slide macros for targeted agenda, comparison, timeline, process, metrics and architecture work. Use office_run_api only for tables, custom diagrams, image treatment, animation or layouts the structured tools cannot faithfully express.',
    'Stage 5 — Inspect: re-read the live deck, run office_review_premium_quality, and visually inspect object density, alignment, clipping, contrast, chart legibility, image crops, and consistency.',
    'Stage 6 — Repair loop: fix every required finding, then repeat inspection. Maximum three repair passes; if a blocker is caused by missing user data or unsupported Office API behavior, report the exact blocker rather than claiming success.',
    'Stage 7 — Complete: call finish only after the live-deck audit reaches 92+ or has no required improvements. Summarize slides created/changed, visuals added, evidence used, and any remaining non-blocking caveat.',
    'Non-negotiable rules:',
    '- Never paste report paragraphs onto slides.',
    '- Never fabricate metrics, sources, quotes, customer names, or file paths.',
    '- Prefer evidence over decoration and diagrams over bullet walls.',
    '- Preserve user-provided facts and brand constraints; separate assumptions clearly.',
    '- Treat a tool success response as execution evidence, not as proof of visual quality.',
  ].join('\n');
