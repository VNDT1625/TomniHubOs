import { randomUUID } from 'node:crypto';

import { redactSensitiveText, redactSecretText } from '@process/agentRuntime/agentMesh/security';
import type { SecretFirewallResult } from '@process/agentRuntime/agentMesh/security/types';

import type {
  InspectionDecision,
  OutboundInspectionRequest,
  OutboundInspectionResult,
  OutboundPolicyContext,
  OutboundSecurityReceipt,
  OutboundTextPart,
  SafeFinding,
} from './types';

const MAX_PARTS = 128;
const MAX_PART_LENGTH = 200_000;
const MAX_TOTAL_LENGTH = 1_000_000;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;

const invalid = (
  request: OutboundInspectionRequest,
  reasonCode: string,
  context: OutboundPolicyContext
): OutboundInspectionResult => {
  const now = context.now?.() ?? Date.now();
  const receipt: OutboundSecurityReceipt = {
    schemaVersion: 1,
    receiptId: context.createReceiptId?.() ?? randomUUID(),
    requestId: request.requestId,
    runId: request.runId,
    actorId: request.actorId,
    surface: request.surface,
    targetKind: request.target.kind,
    decision: 'failed_closed',
    reasonCode,
    findingTypes: [],
    policyVersion: context.policyVersion,
    createdAt: now,
  };
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    decision: 'failed_closed',
    safeParts: [],
    findings: [],
    reasonCode,
    requiresUserDecision: false,
    receipt,
  };
};

const toFindings = (result: SecretFirewallResult): SafeFinding[] => result.findings.map((finding) => ({ ...finding }));

const inspectPart = (
  part: OutboundTextPart,
  sensitivity: OutboundInspectionRequest['sensitivity']
): { part: OutboundTextPart; findings: SafeFinding[] } => {
  const result = sensitivity === 'secret-bearing' ? redactSensitiveText(part.text) : redactSecretText(part.text);
  return { part: { ...part, text: result.text }, findings: toFindings(result) };
};

const validateRequest = (request: OutboundInspectionRequest): string | undefined => {
  if (request.schemaVersion !== 1) return 'unknown_schema';
  if (!SAFE_ID.test(request.requestId) || !SAFE_ID.test(request.actorId)) return 'invalid_identity';
  if (!SAFE_ID.test(request.target.kind) || !SAFE_ID.test(request.target.id)) return 'invalid_target';
  if (request.parts.length === 0 || request.parts.length > MAX_PARTS) return 'invalid_parts';
  let total = 0;
  for (const part of request.parts) {
    if (!SAFE_ID.test(part.id) || typeof part.text !== 'string' || part.text.length > MAX_PART_LENGTH)
      return 'invalid_part';
    total += part.text.length;
    if (total > MAX_TOTAL_LENGTH) return 'input_too_large';
  }
  return undefined;
};

/** Inspect text before an outbound side effect. This function never logs or returns original plaintext. */
export const inspectOutboundText = async (
  request: OutboundInspectionRequest,
  context: OutboundPolicyContext
): Promise<OutboundInspectionResult> => {
  const validationError = validateRequest(request);
  if (validationError) return invalid(request, validationError, context);

  try {
    const inspected = request.parts.map((part) => inspectPart(part, request.sensitivity));
    const safeParts = inspected.map(({ part }) => part);
    const findings = inspected.flatMap(({ findings: partFindings }) => partFindings);
    const uniqueFindings = [
      ...new Map(
        findings.map((finding) => [`${finding.name}:${finding.type}:${finding.confidence}`, finding])
      ).values(),
    ];
    const authorized = context.authorize ? await context.authorize(request) : true;
    const hasFindings = uniqueFindings.length > 0;
    let decision: InspectionDecision;
    let reasonCode: string;
    let requiresUserDecision = false;

    if (!authorized) {
      decision = 'block';
      reasonCode = 'permission_denied';
    } else if (!hasFindings) {
      decision = 'allow';
      reasonCode = 'no_sensitive_data';
    } else if (context.requireApprovalForFindings) {
      decision = 'approval_required';
      reasonCode = 'approval_required';
      requiresUserDecision = true;
    } else if (context.allowSanitize) {
      decision = 'sanitize';
      reasonCode = 'sanitized_secret';
    } else {
      decision = 'block';
      reasonCode = 'secret_detected';
    }

    const now = context.now?.() ?? Date.now();
    const receipt: OutboundSecurityReceipt = {
      schemaVersion: 1,
      receiptId: context.createReceiptId?.() ?? randomUUID(),
      requestId: request.requestId,
      runId: request.runId,
      actorId: request.actorId,
      surface: request.surface,
      targetKind: request.target.kind,
      decision,
      reasonCode,
      findingTypes: uniqueFindings.map((finding) => finding.type),
      policyVersion: context.policyVersion,
      createdAt: now,
    };
    return {
      schemaVersion: 1,
      requestId: request.requestId,
      decision,
      safeParts,
      findings: uniqueFindings,
      reasonCode,
      requiresUserDecision,
      receipt,
    };
  } catch {
    return invalid(request, 'inspection_error', context);
  }
};

export const executeAfterOutboundInspection = async <T>(
  request: OutboundInspectionRequest,
  context: OutboundPolicyContext,
  effect: (safeParts: readonly OutboundTextPart[]) => Promise<T>
): Promise<{ inspection: OutboundInspectionResult; value?: T }> => {
  const inspection = await inspectOutboundText(request, context);
  if (!['allow', 'sanitize'].includes(inspection.decision)) return { inspection };
  return { inspection, value: await effect(inspection.safeParts) };
};
