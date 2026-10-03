import { Buffer } from 'node:buffer';
import type { CapabilityQuery } from '@/common/packages';

/**
 * Main-only contract for untrusted capability requirements emitted by a model.
 * It intentionally accepts only plain data and exposes no raw goal in errors or
 * serialized results.
 */
export const CAPABILITY_DERIVATION_INPUT_SCHEMA = 'tomny.capability-derivation.input.v1';
export const CAPABILITY_DERIVATION_OUTPUT_SCHEMA = 'tomny.capability-derivation.output.v1';

export const MAX_CAPABILITY_DERIVATION_REQUIREMENTS = 32;
export const MAX_CAPABILITY_DERIVATION_OUTPUT_BYTES = 16 * 1024;
export const MAX_CAPABILITY_DERIVATION_CAPABILITY_LENGTH = 128;
export const MAX_CAPABILITY_DERIVATION_GOAL_LENGTH = 10_000;

export type CapabilityDerivationRequirement = Readonly<{
  capability: string;
  dataLocation: CapabilityQuery['dataLocation'];
  requireUi: boolean;
  requireOffline: boolean;
}>;

export type CapabilityDerivationOutput = Readonly<{
  schema: typeof CAPABILITY_DERIVATION_OUTPUT_SCHEMA;
  requirements: readonly CapabilityDerivationRequirement[];
}>;

export type CapabilityDerivationInput = Readonly<{
  requestId: string;
  goal: string;
  requestedAt: string;
}>;

export type CapabilityDerivationValidationOptions = Readonly<{
  /** A caller may lower, but never raise, the contract's output limit. */
  maxOutputBytes?: number;
  /** The model must not restate the user's complete raw goal as a capability. */
  goal: string;
}>;

const isPlainDataObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return (prototype === Object.prototype || prototype === null) && Object.getOwnPropertySymbols(value).length === 0;
  } catch {
    return false;
  }
};

const hasExactDataKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  try {
    const actual = Object.getOwnPropertyNames(value);
    if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) return false;
    return actual.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
    });
  } catch {
    return false;
  }
};

const isBoundedText = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;

const isDataLocation = (value: unknown): value is CapabilityQuery['dataLocation'] =>
  value === 'local-only' || value === 'region-bound' || value === 'remote-allowed';

const fitsByteLimit = (output: CapabilityDerivationOutput, maximum: number): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(output), 'utf8') <= maximum;
  } catch {
    return false;
  }
};

const echoesGoal = (requirement: CapabilityDerivationRequirement, goal: string): boolean => {
  const normalizedGoal = goal.trim().toLocaleLowerCase();
  const normalizedCapability = requirement.capability.trim().toLocaleLowerCase();
  return (
    normalizedCapability === normalizedGoal ||
    (normalizedGoal.length >= 8 && normalizedCapability.includes(normalizedGoal))
  );
};

/** Strictly parses the schema before any orchestration policy consumes it. */
export const parseCapabilityDerivationOutput = (value: unknown): CapabilityDerivationOutput | undefined => {
  if (!isPlainDataObject(value) || !hasExactDataKeys(value, ['schema', 'requirements'])) return undefined;
  if (value.schema !== CAPABILITY_DERIVATION_OUTPUT_SCHEMA || !Array.isArray(value.requirements)) return undefined;
  if (value.requirements.length === 0 || value.requirements.length > MAX_CAPABILITY_DERIVATION_REQUIREMENTS)
    return undefined;

  const requirements: CapabilityDerivationRequirement[] = [];
  for (const candidate of value.requirements) {
    if (
      !isPlainDataObject(candidate) ||
      !hasExactDataKeys(candidate, ['capability', 'dataLocation', 'requireUi', 'requireOffline'])
    ) {
      return undefined;
    }
    if (
      !isBoundedText(candidate.capability, MAX_CAPABILITY_DERIVATION_CAPABILITY_LENGTH) ||
      !isDataLocation(candidate.dataLocation) ||
      typeof candidate.requireUi !== 'boolean' ||
      typeof candidate.requireOffline !== 'boolean'
    ) {
      return undefined;
    }
    requirements.push({
      capability: candidate.capability,
      dataLocation: candidate.dataLocation,
      requireUi: candidate.requireUi,
      requireOffline: candidate.requireOffline,
    });
  }
  return { schema: CAPABILITY_DERIVATION_OUTPUT_SCHEMA, requirements };
};

/**
 * Validates the complete C3 output boundary, including its private-goal
 * non-projection rule. Invalid output is represented only by undefined.
 */
export const validateCapabilityDerivationOutput = (
  value: unknown,
  options: CapabilityDerivationValidationOptions
): CapabilityDerivationOutput | undefined => {
  if (!isBoundedText(options.goal, MAX_CAPABILITY_DERIVATION_GOAL_LENGTH)) return undefined;
  const configuredLimit = options.maxOutputBytes ?? MAX_CAPABILITY_DERIVATION_OUTPUT_BYTES;
  if (!Number.isInteger(configuredLimit) || configuredLimit < 1) return undefined;

  const output = parseCapabilityDerivationOutput(value);
  if (!output || !fitsByteLimit(output, Math.min(configuredLimit, MAX_CAPABILITY_DERIVATION_OUTPUT_BYTES)))
    return undefined;
  return output.requirements.some((requirement) => echoesGoal(requirement, options.goal)) ? undefined : output;
};

/** Validates only the bounded Main-owned input required by the derivation contract. */
export const isCapabilityDerivationInput = (input: CapabilityDerivationInput): boolean =>
  isBoundedText(input.requestId, 200) &&
  isBoundedText(input.goal, MAX_CAPABILITY_DERIVATION_GOAL_LENGTH) &&
  isBoundedText(input.requestedAt, 64) &&
  Number.isFinite(Date.parse(input.requestedAt));
