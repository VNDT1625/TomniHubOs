import { describe, expect, it } from 'vitest';
import { PressureSampler } from '../../../packages/desktop/src/process/resource/pressureSampler';
import { ChoiceAdvisor } from '../../../packages/desktop/src/process/toolselect/choiceAdvisor';

describe('Efficiency Core Logic', () => {
  it('should accurately sample host pressure and adjust effective concurrency limit', () => {
    const sampler = new PressureSampler();
    const sample = sampler.sampleHostPressure(20);

    expect(sample.timestamp).toBeGreaterThan(0);
    expect(sample.level).toBeDefined();

    const healthyLimit = sampler.getEffectiveConcurrencyLimit(10);
    expect(healthyLimit).toBeGreaterThanOrEqual(1);

    // Simulate critical pressure sample
    const criticalSample = sampler.sampleHostPressure(95);
    expect(criticalSample.level).toBe('critical');
    const criticalLimit = sampler.getEffectiveConcurrencyLimit(10);
    expect(criticalLimit).toBe(3); // 30% of 10
  });

  it('should rank candidates and generate explanation', () => {
    const advisor = new ChoiceAdvisor();
    const candidates = [
      { id: 'tool_a', factors: { speed: 0.8, quality: 0.9 } },
      { id: 'tool_b', factors: { speed: 0.2, quality: 0.1 } },
    ];

    const decision = advisor.evaluateCandidates(candidates, 0.5);
    expect(decision.selectedId).toBe('tool_a');
    expect(decision.explanation).toContain('tool_a');
    expect(decision.filtered.length).toBe(1);
    expect(decision.filtered[0].id).toBe('tool_b');
  });
});
