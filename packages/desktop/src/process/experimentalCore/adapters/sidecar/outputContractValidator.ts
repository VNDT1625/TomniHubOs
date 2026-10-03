/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CANONICAL_SECURITY_REASON_CODES,
  CANONICAL_SECURITY_RISK_TYPES,
  SECURITY_REASON_CODE_RISK_TYPE,
} from './securityOntology';
/**
 * A deliberately non-descriptive result category. It is safe to retain in a
 * receipt or telemetry without retaining model output or validation details.
 */
export type CoreModelOutputValidationErrorCode =
  | 'unsupported-schema'
  | 'not-json-object'
  | 'unexpected-key'
  | 'missing-key'
  | 'invalid-type'
  | 'invalid-enum'
  | 'invalid-number'
  | 'invalid-bounds'
  | 'array-limit';

export type CoreModelOutputValidationResult =
  | { valid: true }
  | { valid: false; code: CoreModelOutputValidationErrorCode };

type StringRule = {
  kind: 'string';
  maxLength: number;
  values?: readonly string[];
};

type BooleanRule = { kind: 'boolean'; value?: boolean };

type ConfidenceRule = { kind: 'confidence' };

type StringArrayRule = {
  kind: 'string-array';
  maxItems: number;
  maxItemLength: number;
  values?: readonly string[];
};

type OutputFieldRule = StringRule | BooleanRule | ConfidenceRule | StringArrayRule;

type OutputContract = { readonly fields: Readonly<Record<string, OutputFieldRule>> };

const SEMANTIC_ANALYSIS_OUTPUT_SCHEMA = 'tomny.semantic-analysis.output.v1';
const SECURITY_SEMANTIC_OUTPUT_V2_SCHEMA = 'tomny.security.semantic.output.v2';
const SECURITY_SEMANTIC_OUTPUT_V3_SCHEMA = 'tomny.security.semantic.output.v3';

const ACTIONS = {
  security: ['allow', 'ask', 'local_only', 'block'],
  userUnderstanding: ['update_projection', 'abstain', 'revert_projection'],
  orchestrator: ['select_candidate', 'queue', 'ask_confirmation', 'abstain'],
  assistant: ['ready', 'needs_confirmation', 'cannot_verify'],
} as const;

const SCHEMAS: Readonly<Record<string, OutputContract>> = {
  'tomny.security.output.v1': {
    fields: {
      riskType: { kind: 'string', maxLength: 96, values: CANONICAL_SECURITY_RISK_TYPES },
      action: { kind: 'string', maxLength: 32, values: ACTIONS.security },
      confidence: { kind: 'confidence' },
      reasonCode: { kind: 'string', maxLength: 128, values: CANONICAL_SECURITY_REASON_CODES },
      requiresBackendValidation: { kind: 'boolean', value: true },
      redactions: { kind: 'string-array', maxItems: 8, maxItemLength: 64, values: ['credential', 'private_fields'] },
    },
  },
  'tomny.security.semantic.output.v2': {
    fields: {
      riskType: { kind: 'string', maxLength: 96, values: CANONICAL_SECURITY_RISK_TYPES },
      reasonCode: { kind: 'string', maxLength: 128, values: CANONICAL_SECURITY_REASON_CODES },
      requiresBackendValidation: { kind: 'boolean', value: true },
      redactions: { kind: 'string-array', maxItems: 8, maxItemLength: 64, values: ['credential', 'private_fields'] },
    },
  },
  'tomny.security.semantic.output.v3': {
    fields: {
      riskType: { kind: 'string', maxLength: 96, values: CANONICAL_SECURITY_RISK_TYPES },
      reasonCode: { kind: 'string', maxLength: 128, values: CANONICAL_SECURITY_REASON_CODES },
      requiresBackendValidation: { kind: 'boolean', value: true },
    },
  },
  'tomny.user-understanding.output.v1': {
    fields: {
      hypothesis: { kind: 'string', maxLength: 128 },
      action: { kind: 'string', maxLength: 32, values: ACTIONS.userUnderstanding },
      confidence: { kind: 'confidence' },
      evidenceBasis: { kind: 'string', maxLength: 128 },
      reasonCode: { kind: 'string', maxLength: 128 },
      needsConfirmation: { kind: 'boolean' },
    },
  },
  'tomny.user-understanding.output.v2': {
    fields: {
      hasMemorySignal: { kind: 'boolean' },
      kind: { kind: 'string', maxLength: 16, values: ['preference', 'fact', 'decision', 'habit', 'none'] },
      scopeHint: { kind: 'string', maxLength: 16, values: ['workspace', 'surface', 'global', 'none'] },
      confidence: { kind: 'confidence' },
      reason: { kind: 'string', maxLength: 240 },
      requiresUserConfirmation: { kind: 'boolean' },
    },
  },
  'tomny.orchestrator.output.v1': {
    fields: {
      decision: { kind: 'string', maxLength: 32, values: ACTIONS.orchestrator },
      candidateId: { kind: 'string', maxLength: 128 },
      confidence: { kind: 'confidence' },
      reasonCode: { kind: 'string', maxLength: 128 },
      requiresConfirmation: { kind: 'boolean' },
      fallback: { kind: 'string', maxLength: 128 },
    },
  },
  'tomny.assistant.output.v1': {
    fields: {
      intent: { kind: 'string', maxLength: 128 },
      status: { kind: 'string', maxLength: 32, values: ACTIONS.assistant },
      confidence: { kind: 'confidence' },
      reasonCode: { kind: 'string', maxLength: 128 },
      nextAction: { kind: 'string', maxLength: 128 },
      requiresConfirmation: { kind: 'boolean' },
    },
  },
};

const isPlainJsonObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const validString = (value: unknown, rule: StringRule): CoreModelOutputValidationResult => {
  if (typeof value !== 'string') return { valid: false, code: 'invalid-type' };
  if (value.length === 0 || value.length > rule.maxLength) return { valid: false, code: 'invalid-bounds' };
  if (rule.values && !rule.values.includes(value)) return { valid: false, code: 'invalid-enum' };
  return { valid: true };
};

const validStringArray = (value: unknown, rule: StringArrayRule): CoreModelOutputValidationResult => {
  if (!Array.isArray(value) || value.length > rule.maxItems) return { valid: false, code: 'array-limit' };
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return { valid: false, code: 'invalid-type' };
    if (item.length === 0 || item.length > rule.maxItemLength) return { valid: false, code: 'invalid-bounds' };
    if (seen.has(item) || (rule.values && !rule.values.includes(item))) return { valid: false, code: 'invalid-enum' };
    seen.add(item);
  }
  return { valid: true };
};

const validateValue = (value: unknown, rule: OutputFieldRule): CoreModelOutputValidationResult => {
  if (rule.kind === 'string') return validString(value, rule);
  if (rule.kind === 'string-array') return validStringArray(value, rule);
  if (rule.kind === 'boolean') {
    if (typeof value !== 'boolean') return { valid: false, code: 'invalid-type' };
    if (rule.value !== undefined && value !== rule.value) return { valid: false, code: 'invalid-enum' };
    return { valid: true };
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? { valid: true }
    : { valid: false, code: 'invalid-number' };
};

/**
 * Validates only the fixed local Core Adapter response contracts. Unknown
 * schemas and malformed values fail closed without exposing model content.
 */
export class BoundedCoreModelOutputValidator {
  public validate(schemaId: string, value: unknown): CoreModelOutputValidationResult {
    if (schemaId === SEMANTIC_ANALYSIS_OUTPUT_SCHEMA) return this.validateSemanticAnalysis(value);
    const contract = SCHEMAS[schemaId];
    if (!contract) return { valid: false, code: 'unsupported-schema' };
    if (!isPlainJsonObject(value) || Object.getOwnPropertySymbols(value).length > 0) {
      return { valid: false, code: 'not-json-object' };
    }

    const keys = Object.getOwnPropertyNames(value);
    const expectedKeys = Object.keys(contract.fields);
    for (const key of keys) {
      if (!(key in contract.fields)) return { valid: false, code: 'unexpected-key' };
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
        return { valid: false, code: 'not-json-object' };
    }
    for (const key of expectedKeys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return { valid: false, code: 'missing-key' };
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) return { valid: false, code: 'not-json-object' };
      const result = validateValue(descriptor.value, contract.fields[key]!);
      if (!result.valid) return result;
    }
    if (
      (schemaId === 'tomny.security.output.v1' ||
        schemaId === SECURITY_SEMANTIC_OUTPUT_V2_SCHEMA ||
        schemaId === SECURITY_SEMANTIC_OUTPUT_V3_SCHEMA) &&
      SECURITY_REASON_CODE_RISK_TYPE[
        (value as Record<string, unknown>).reasonCode as keyof typeof SECURITY_REASON_CODE_RISK_TYPE
      ] !== (value as Record<string, unknown>).riskType
    )
      return { valid: false, code: 'invalid-enum' };
    return { valid: true };
  }
  // Semantic sub-output validation follows.

  /** The nested v1 outputs stay exact; null means that sub-result abstained. */
  private validateSemanticAnalysis(value: unknown): CoreModelOutputValidationResult {
    if (!isPlainJsonObject(value) || Object.getOwnPropertySymbols(value).length > 0) {
      return { valid: false, code: 'not-json-object' };
    }
    const keys = Object.getOwnPropertyNames(value);
    if (keys.length !== 2 || !keys.includes('security') || !keys.includes('userUnderstanding')) {
      return {
        valid: false,
        code: keys.some((key) => key !== 'security' && key !== 'userUnderstanding') ? 'unexpected-key' : 'missing-key',
      };
    }
    for (const [key, schemaId] of [
      ['security', 'tomny.security.output.v1'],
      ['userUnderstanding', 'tomny.user-understanding.output.v2'],
    ] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
        return { valid: false, code: 'not-json-object' };
      if (descriptor.value !== null) {
        const result = this.validate(schemaId, descriptor.value);
        if (!result.valid) return result;
      }
    }
    return { valid: true };
  }
}
