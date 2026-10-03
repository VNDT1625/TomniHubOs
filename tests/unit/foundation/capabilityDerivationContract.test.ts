import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_DERIVATION_OUTPUT_SCHEMA,
  isCapabilityDerivationInput,
  MAX_CAPABILITY_DERIVATION_REQUIREMENTS,
  parseCapabilityDerivationOutput,
  validateCapabilityDerivationOutput,
} from '../../../packages/desktop/src/process/resources/packageCapability/capabilityDerivationContract';

const goal = 'Create an offline desktop app for my notes.';
const validRequirement = {
  capability: 'workspace.code.edit',
  dataLocation: 'local-only',
  requireUi: true,
  requireOffline: true,
} as const;
const validOutput = {
  schema: CAPABILITY_DERIVATION_OUTPUT_SCHEMA,
  requirements: [validRequirement],
};

describe('capability derivation contract', () => {
  it('accepts only the exact bounded output shape', () => {
    expect(parseCapabilityDerivationOutput(validOutput)).toEqual(validOutput);
    expect(validateCapabilityDerivationOutput(validOutput, { goal })).toEqual(validOutput);
  });

  it.each([
    ['unknown output field', { ...validOutput, unexpected: true }],
    ['wrong schema', { ...validOutput, schema: 'tomny.untrusted.output.v1' }],
    ['empty requirements', { ...validOutput, requirements: [] }],
    [
      'too many requirements',
      {
        schema: CAPABILITY_DERIVATION_OUTPUT_SCHEMA,
        requirements: Array.from({ length: MAX_CAPABILITY_DERIVATION_REQUIREMENTS + 1 }, () => validRequirement),
      },
    ],
    ['unknown requirement field', { ...validOutput, requirements: [{ ...validRequirement, unexpected: true }] }],
    ['unknown data location', { ...validOutput, requirements: [{ ...validRequirement, dataLocation: 'anywhere' }] }],
    ['non-boolean UI requirement', { ...validOutput, requirements: [{ ...validRequirement, requireUi: 'true' }] }],
    ['non-boolean offline requirement', { ...validOutput, requirements: [{ ...validRequirement, requireOffline: 1 }] }],
    ['overlong capability', { ...validOutput, requirements: [{ ...validRequirement, capability: 'x'.repeat(129) }] }],
  ])('rejects %s', (_label, value) => {
    expect(parseCapabilityDerivationOutput(value)).toBeUndefined();
    expect(validateCapabilityDerivationOutput(value, { goal })).toBeUndefined();
  });

  it('rejects output that exceeds the caller cap or projects the complete raw goal', () => {
    expect(validateCapabilityDerivationOutput(validOutput, { goal, maxOutputBytes: 1 })).toBeUndefined();
    expect(
      validateCapabilityDerivationOutput(
        {
          ...validOutput,
          requirements: [{ ...validRequirement, capability: `Use ${goal} now` }],
        },
        { goal }
      )
    ).toBeUndefined();
    expect(
      validateCapabilityDerivationOutput(
        { ...validOutput, requirements: [{ ...validRequirement, capability: goal }] },
        { goal }
      )
    ).toBeUndefined();
  });

  it('fails closed when an untrusted object traps reflective inspection', () => {
    const trapped = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error('trap');
        },
      }
    );
    expect(parseCapabilityDerivationOutput(trapped)).toBeUndefined();
    expect(validateCapabilityDerivationOutput(trapped, { goal })).toBeUndefined();
  });

  it('requires bounded Main-owned input before a model can be called', () => {
    expect(isCapabilityDerivationInput({ requestId: 'request-1', goal, requestedAt: '2026-08-20T10:00:00.000Z' })).toBe(
      true
    );
    expect(isCapabilityDerivationInput({ requestId: '', goal, requestedAt: '2026-08-20T10:00:00.000Z' })).toBe(false);
    expect(
      isCapabilityDerivationInput({
        requestId: 'request-1',
        goal: 'x'.repeat(10_001),
        requestedAt: '2026-08-20T10:00:00.000Z',
      })
    ).toBe(false);
    expect(isCapabilityDerivationInput({ requestId: 'request-1', goal, requestedAt: 'not-a-date' })).toBe(false);
  });
});
