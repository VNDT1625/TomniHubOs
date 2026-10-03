import type { OutboundInspectionResult, OutboundTextPart } from './types';

export type SemanticVerifierRecommendation = {
  recommendation: 'allow' | 'sanitize' | 'approval_required' | 'block';
  confidence: number;
  categories: readonly string[];
  reasonCodes: readonly string[];
};

export type SemanticVerifier = (input: {
  safeParts: readonly OutboundTextPart[];
  surface: string;
  targetKind: string;
}) => Promise<SemanticVerifierRecommendation>;

export type SemanticVerificationResult = {
  recommendation: SemanticVerifierRecommendation['recommendation'];
  confidence: number;
  reasonCode: string;
};

const MIN_CONFIDENCE = 0.9;

/** Optional semantic verifier. It receives sanitized text and can never grant final permission. */
export const verifySanitizedInspection = async (
  inspection: OutboundInspectionResult,
  verifier: SemanticVerifier | undefined
): Promise<SemanticVerificationResult> => {
  if (!verifier) return { recommendation: 'approval_required', confidence: 0, reasonCode: 'model_unavailable' };
  try {
    const result = await verifier({
      safeParts: inspection.safeParts,
      surface: inspection.receipt.surface,
      targetKind: inspection.receipt.targetKind,
    });
    if (!Number.isFinite(result.confidence) || result.confidence < MIN_CONFIDENCE) {
      return { recommendation: 'approval_required', confidence: 0, reasonCode: 'model_low_confidence' };
    }
    if (!['allow', 'sanitize', 'approval_required', 'block'].includes(result.recommendation)) {
      return { recommendation: 'block', confidence: 0, reasonCode: 'model_invalid_output' };
    }
    return {
      recommendation: result.recommendation,
      confidence: result.confidence,
      reasonCode: result.reasonCodes[0] ?? 'model_reviewed',
    };
  } catch {
    return { recommendation: 'block', confidence: 0, reasonCode: 'model_error' };
  }
};
