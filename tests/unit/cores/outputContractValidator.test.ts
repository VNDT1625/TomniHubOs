import { describe, expect, it } from 'vitest';
import { BoundedCoreModelOutputValidator } from '../../../packages/desktop/src/process/experimentalCore/adapters/sidecar/outputContractValidator';

const validator = new BoundedCoreModelOutputValidator();

const assistantOutput = () => ({
  intent: 'open_help',
  status: 'ready',
  confidence: 0.9,
  reasonCode: 'READ_ONLY_HELP',
  nextAction: 'open_bundled_guide',
  requiresConfirmation: false,
});

describe('Bounded Core Model Output Validator', () => {
  it('accepts an exact, bounded assistant output contract', () => {
    expect(validator.validate('tomny.assistant.output.v1', assistantOutput())).toEqual({ valid: true });
  });

  it('rejects unknown schemas without exposing output content', () => {
    expect(validator.validate('tomny.unknown.output.v1', assistantOutput())).toEqual({
      valid: false,
      code: 'unsupported-schema',
    });
  });

  it('rejects a JSON string rather than parsing model text implicitly', () => {
    expect(validator.validate('tomny.assistant.output.v1', JSON.stringify(assistantOutput()))).toEqual({
      valid: false,
      code: 'not-json-object',
    });
  });

  it('rejects unexpected and missing keys as separate safe categories', () => {
    expect(validator.validate('tomny.assistant.output.v1', { ...assistantOutput(), extra: 'ignored' })).toEqual({
      valid: false,
      code: 'unexpected-key',
    });
    const { intent: _intent, ...missing } = assistantOutput();
    expect(validator.validate('tomny.assistant.output.v1', missing)).toEqual({ valid: false, code: 'missing-key' });
  });

  it('rejects invalid types, bounds, and closed enum values', () => {
    expect(validator.validate('tomny.assistant.output.v1', { ...assistantOutput(), confidence: 1.1 })).toEqual({
      valid: false,
      code: 'invalid-number',
    });
    expect(validator.validate('tomny.assistant.output.v1', { ...assistantOutput(), status: 'completed' })).toEqual({
      valid: false,
      code: 'invalid-enum',
    });
    expect(
      validator.validate('tomny.assistant.output.v1', { ...assistantOutput(), nextAction: 'a'.repeat(129) })
    ).toEqual({
      valid: false,
      code: 'invalid-bounds',
    });
  });

  it('enforces bounded security redactions and their closed values', () => {
    const output = {
      riskType: 'prompt_injection',
      action: 'block',
      confidence: 0.98,
      reasonCode: 'UNTRUSTED_OVERRIDE',
      requiresBackendValidation: true,
      redactions: ['credential'],
    };
    expect(validator.validate('tomny.security.output.v1', output)).toEqual({ valid: true });
    expect(validator.validate('tomny.security.output.v1', { ...output, redactions: ['unknown-category'] })).toEqual({
      valid: false,
      code: 'invalid-enum',
    });
  });

  it('accepts the benchmark-compatible user understanding contract', () => {
    expect(
      validator.validate('tomny.user-understanding.output.v1', {
        hypothesis: 'prefers_concise_complete_answers',
        action: 'update_projection',
        confidence: 0.96,
        evidenceBasis: 'explicit_statement',
        reasonCode: 'EXPLICIT_DURABLE_PREFERENCE',
        needsConfirmation: false,
      })
    ).toEqual({ valid: true });
  });

  it('accepts the benchmark-compatible orchestrator contract', () => {
    expect(
      validator.validate('tomny.orchestrator.output.v1', {
        decision: 'ask_confirmation',
        candidateId: 'email-agent',
        confidence: 0.96,
        reasonCode: 'SIDE_EFFECT_CONFIRMATION',
        requiresConfirmation: true,
        fallback: 'none',
      })
    ).toEqual({ valid: true });
  });
});
