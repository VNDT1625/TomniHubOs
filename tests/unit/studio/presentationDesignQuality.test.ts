import { describe, expect, it } from 'vitest';
import { preflightDeckDesignPlan, renderDeckPreflightReport, type DeckDesignPlan } from '@/common/presentationDesign';

const strongPlan = (): DeckDesignPlan => ({
  title: 'AI Security Armor',
  designStyle: 'technical',
  theme: {
    primary: '#246BFD',
    secondary: '#10A37F',
    background: '#F7F8FA',
    text: '#121826',
    fontFamily: 'Aptos',
  },
  slides: [
    { title: 'AI Security Armor', subtitle: 'Evidence-led defense', bullets: [], layout: 'cover' },
    {
      title: 'Validated detection performance',
      bullets: ['Local ONNX inference'],
      layout: 'chart',
      chartValues: [[84, 92, 99]],
      chartLabels: ['URL', 'Text', 'Prompt'],
      source: 'MODEL_VALIDATION_REPORT.md',
    },
    {
      title: 'Approve the competition demo',
      subtitle: 'Run the evidence-backed judge flow',
      bullets: ['Open the demo'],
      layout: 'closing',
    },
  ],
});

describe('presentation design preflight', () => {
  it('passes a concise, evidence-led deck with cover, visual proof and closing action', () => {
    const report = preflightDeckDesignPlan(strongPlan());

    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
    expect(report.issues).toEqual([]);
  });

  it('blocks a deck that lacks narrative structure and meaningful visuals', () => {
    const plan = strongPlan();
    plan.slides = [{ title: 'Single page', bullets: [], layout: 'content' }];

    const report = preflightDeckDesignPlan(plan);

    expect(report.passed).toBe(false);
    expect(renderDeckPreflightReport(report)).toContain('Deck preflight blocked');
    expect(report.issues.some((issue) => issue.message.includes('first slide'))).toBe(true);
  });

  it('validates one appended macro slide without requiring a new cover and closing', () => {
    const plan = strongPlan();
    plan.slides = [
      {
        title: 'Key metrics',
        bullets: [],
        layout: 'metrics',
        items: [{ label: 'URL F1', value: '84.3%' }],
      },
    ];

    const report = preflightDeckDesignPlan(plan, 'append');

    expect(report.passed).toBe(true);
    expect(report.issues).toEqual([
      expect.objectContaining({ severity: 'recommended', message: expect.stringContaining('source') }),
    ]);
  });

  it('blocks presenter-hostile copy density', () => {
    const plan = strongPlan();
    plan.slides[1] = {
      ...plan.slides[1],
      title: Array.from({ length: 71 }, (_, index) => `word${index}`).join(' '),
    };

    const report = preflightDeckDesignPlan(plan);

    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ severity: 'required', message: expect.stringContaining('70 words') })
    );
  });
});
