import ontology from './security-ontology-v1.json';

export type FinalSecurityAction = 'allow' | 'ask' | 'local_only' | 'block';
export type SecurityRiskType = (typeof ontology.riskTypes)[number];
export type SecurityReasonCode = (typeof ontology.reasonCodes)[number];

/** Semantic evidence produced by a local model under the V2 contract. */
export type SemanticSecurityEvidence = Readonly<{
  riskType: SecurityRiskType;
  reasonCode: SecurityReasonCode;
  requiresBackendValidation: true;
  redactions: readonly (typeof ontology.redactions.allowedValues)[number][];
}>;

/** Main-owned policy facts. A model output cannot populate or override these. */
export type SemanticSecurityPolicyState = Readonly<{
  route: 'external' | 'local';
  destinationAuthorized: boolean;
  capabilityGranted: boolean;
  scopeAuthorized: boolean;
  confirmation: 'confirmed' | 'not_required' | 'required' | 'unknown';
  policyBlock?: boolean;
  allowedRiskTypes?: readonly SecurityRiskType[];
}>;

const knownRiskType = (value: string): value is SecurityRiskType =>
  (ontology.riskTypes as readonly string[]).includes(value);
const knownReasonCode = (value: string): value is SecurityReasonCode =>
  (ontology.reasonCodes as readonly string[]).includes(value);

/** Reject model evidence that is outside the approved ontology before policy use. */
export const isCanonicalSemanticSecurityEvidence = (value: unknown): value is SemanticSecurityEvidence => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<SemanticSecurityEvidence>;
  return (
    Object.keys(candidate).length === 4 &&
    typeof candidate.riskType === 'string' &&
    knownRiskType(candidate.riskType) &&
    typeof candidate.reasonCode === 'string' &&
    knownReasonCode(candidate.reasonCode) &&
    ontology.reasonCodeRiskType[candidate.reasonCode as keyof typeof ontology.reasonCodeRiskType] ===
      candidate.riskType &&
    candidate.requiresBackendValidation === true &&
    Array.isArray(candidate.redactions) &&
    candidate.redactions.every((item) => (ontology.redactions.allowedValues as readonly string[]).includes(item)) &&
    new Set(candidate.redactions).size === candidate.redactions.length
  );
};

/**
 * Derives the final action from Main-owned state. Semantic evidence can narrow
 * the permitted outcome, but it can never create an authorization or grant.
 */
export const deriveFinalSecurityAction = (
  evidence: SemanticSecurityEvidence,
  policy: SemanticSecurityPolicyState | undefined
): FinalSecurityAction => {
  if (!policy || policy.policyBlock === true) return 'block';
  if (!policy.destinationAuthorized || !policy.capabilityGranted || !policy.scopeAuthorized) return 'block';
  if (policy.route === 'local') return 'local_only';
  if (evidence.riskType === 'prompt_injection') return 'block';
  if (evidence.riskType === 'none') {
    return policy.confirmation === 'required' || policy.confirmation === 'unknown' ? 'ask' : 'allow';
  }
  const riskAllowed = policy.allowedRiskTypes?.some(
    (riskType) => knownRiskType(riskType) && riskType === evidence.riskType
  );
  if (!riskAllowed) return 'block';
  if (policy.confirmation === 'required' || policy.confirmation === 'unknown') return 'ask';
  if (evidence.riskType === 'destructive_action' && policy.confirmation !== 'confirmed') return 'ask';
  return 'allow';
};
