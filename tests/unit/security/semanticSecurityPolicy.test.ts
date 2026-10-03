import { describe, expect, it } from 'vitest';

import {
  deriveFinalSecurityAction,
  type SemanticSecurityEvidence,
  type SemanticSecurityPolicyState,
} from '@process/services/security/semanticSecurityPolicy';

const evidence = (
  riskType: SemanticSecurityEvidence['riskType'],
  reasonCode: SemanticSecurityEvidence['reasonCode']
): SemanticSecurityEvidence => ({
  riskType,
  reasonCode,
  requiresBackendValidation: true,
  redactions: [],
});
const authorized = (extra: Partial<SemanticSecurityPolicyState> = {}): SemanticSecurityPolicyState => ({
  route: 'external',
  destinationAuthorized: true,
  capabilityGranted: true,
  scopeAuthorized: true,
  confirmation: 'not_required',
  allowedRiskTypes: [],
  ...extra,
});

describe('Main-owned semantic security policy', () => {
  it('fails closed when policy state is missing', () => {
    expect(deriveFinalSecurityAction(evidence('none', 'NO_SEMANTIC_RISK'), undefined)).toBe('block');
  });

  it('allows benign evidence only after Main authorizes the destination and capability', () => {
    expect(deriveFinalSecurityAction(evidence('none', 'NO_SEMANTIC_RISK'), authorized())).toBe('allow');
    expect(
      deriveFinalSecurityAction(evidence('none', 'NO_SEMANTIC_RISK'), authorized({ destinationAuthorized: false }))
    ).toBe('block');
    expect(
      deriveFinalSecurityAction(evidence('none', 'NO_SEMANTIC_RISK'), authorized({ capabilityGranted: false }))
    ).toBe('block');
  });

  it('permits a risky class only when Main explicitly allows it', () => {
    const privateData = evidence('private_data_egress', 'PRIVATE_DATA_EXPOSURE');
    expect(deriveFinalSecurityAction(privateData, authorized())).toBe('block');
    expect(deriveFinalSecurityAction(privateData, authorized({ allowedRiskTypes: ['private_data_egress'] }))).toBe(
      'allow'
    );
    expect(deriveFinalSecurityAction(privateData, authorized({ route: 'local' }))).toBe('local_only');
  });

  it('never lets prompt injection evidence grant authority', () => {
    expect(
      deriveFinalSecurityAction(
        evidence('prompt_injection', 'PROMPT_INJECTION'),
        authorized({ allowedRiskTypes: ['prompt_injection'] })
      )
    ).toBe('block');
  });

  it('requires confirmation and scope for destructive actions', () => {
    const destructive = evidence('destructive_action', 'DESTRUCTIVE_INTENT');
    expect(deriveFinalSecurityAction(destructive, authorized())).toBe('block');
    expect(
      deriveFinalSecurityAction(
        destructive,
        authorized({ allowedRiskTypes: ['destructive_action'], confirmation: 'required' })
      )
    ).toBe('ask');
    expect(
      deriveFinalSecurityAction(
        destructive,
        authorized({ allowedRiskTypes: ['destructive_action'], confirmation: 'confirmed', scopeAuthorized: false })
      )
    ).toBe('block');
    expect(
      deriveFinalSecurityAction(
        destructive,
        authorized({ allowedRiskTypes: ['destructive_action'], confirmation: 'confirmed' })
      )
    ).toBe('allow');
  });

  it('honors a Main policy block even when the model reports no semantic risk', () => {
    expect(deriveFinalSecurityAction(evidence('none', 'NO_SEMANTIC_RISK'), authorized({ policyBlock: true }))).toBe(
      'block'
    );
  });
});
