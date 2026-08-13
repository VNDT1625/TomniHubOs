import { describe, expect, it } from 'vitest';
import {
  buildPresentationRuntimePrompt,
  renderPresentationRevisionBrief,
  scorePresentationPlan,
  validatePresentationPlan,
  type PresentationPlan,
} from '../../../packages/desktop/src/process/agentRuntime/presentationRuntime';

const strongPlan = (): PresentationPlan => ({
  title: 'TOMNY Presentation Runtime',
  audience: 'Product leadership',
  objective: 'Approve the implementation roadmap',
  tone: 'Confident and evidence-led',
  storyArc: ['Current gap', 'Runtime solution', 'Decision and next action'],
  slides: [
    {
      id: 's01',
      title: 'Presentation quality must be engineered',
      message: 'A deterministic runtime closes the gap with dedicated presentation tools.',
      bullets: [],
      layout: 'cover',
      visualKind: 'image',
    },
    {
      id: 's02',
      title: 'A gated pipeline prevents weak decks',
      message: 'Planning, scoring, generation, and repair happen before completion.',
      bullets: ['Plan against audience and objective', 'Score before mutating the live file'],
      layout: 'chart',
      visualKind: 'chart',
      evidence: 'Internal quality threshold: 92/100',
    },
    {
      id: 's03',
      title: 'Approve the runtime rollout',
      message: 'Ship the Office surface integration and measure visual QA outcomes.',
      bullets: ['Enable for PowerPoint creation and redesign'],
      layout: 'closing',
      visualKind: 'none',
      nextAction: 'Approve rollout',
    },
  ],
});

describe('presentation runtime', () => {
  it('passes a concise, evidence-led plan with a closing action', () => {
    const report = scorePresentationPlan(strongPlan());

    expect(validatePresentationPlan(strongPlan())).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(92);
  });

  it('blocks dense and visually weak plans before Office mutation', () => {
    const plan = strongPlan();
    plan.slides[1] = {
      ...plan.slides[1],
      message: Array.from({ length: 65 }, (_, index) => `word${index}`).join(' '),
      bullets: ['one', 'two', 'three', 'four', 'five', 'six'],
      layout: 'chart',
      visualKind: 'none',
      evidence: undefined,
    };

    const report = scorePresentationPlan(plan);
    const brief = renderPresentationRevisionBrief(report);

    expect(report.passed).toBe(false);
    expect(report.issues.some((issue) => issue.dimension === 'density')).toBe(true);
    expect(report.issues.some((issue) => issue.dimension === 'visuals')).toBe(true);
    expect(brief).toContain('Required fixes');
  });

  it('defines a full observe-plan-build-review-repair protocol', () => {
    const prompt = buildPresentationRuntimePrompt();

    expect(prompt).toContain('[Presentation Runtime v1]');
    expect(prompt).toContain('Stage 1 — Observe');
    expect(prompt).toContain('Stage 6 — Repair loop');

    expect(prompt).toContain('office_add_* slide macros');
    expect(prompt).toContain('architecture');
    expect(prompt).toContain('92+');
    expect(prompt).toContain('Never fabricate metrics');
  });
});
