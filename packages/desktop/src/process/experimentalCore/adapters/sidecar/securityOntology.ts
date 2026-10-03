import ontology from '../../../services/security/security-ontology-v1.json';

export const CANONICAL_SECURITY_RISK_TYPES = ontology.riskTypes;
export const CANONICAL_SECURITY_REASON_CODES = ontology.reasonCodes;
export const SECURITY_REASON_CODE_RISK_TYPE = ontology.reasonCodeRiskType;

export type CanonicalSecurityRiskType = (typeof CANONICAL_SECURITY_RISK_TYPES)[number];
export type CanonicalSecurityReasonCode = (typeof CANONICAL_SECURITY_REASON_CODES)[number];
