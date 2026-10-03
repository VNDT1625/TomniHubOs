import type { SecretConfidence, SecretFindingType } from '@process/agentRuntime/agentMesh/security/types';

export type OutboundSurface = 'chat' | 'agent' | 'tool' | 'browser' | 'command' | 'file' | 'image' | 'provider';

export type InspectionDecision = 'allow' | 'sanitize' | 'block' | 'approval_required' | 'failed_closed';
export type InspectionSensitivity = 'normal' | 'restricted' | 'secret-bearing';

export type OutboundTextPart = {
  id: string;
  text: string;
  role?: 'system' | 'user' | 'assistant' | 'tool' | 'metadata';
  source?: 'user' | 'agent' | 'file' | 'browser' | 'command' | 'tool' | 'generated';
};

export type OutboundInspectionRequest = {
  schemaVersion: 1;
  requestId: string;
  runId?: string;
  taskId?: string;
  actorId: string;
  surface: OutboundSurface;
  target: { kind: string; id: string };
  parts: readonly OutboundTextPart[];
  requestedCapability?: string;
  sensitivity: InspectionSensitivity;
};

export type SafeFinding = {
  name: string;
  type: SecretFindingType;
  confidence: SecretConfidence;
};

export type OutboundSecurityReceipt = {
  schemaVersion: 1;
  receiptId: string;
  requestId: string;
  runId?: string;
  actorId: string;
  surface: OutboundSurface;
  targetKind: string;
  decision: InspectionDecision;
  reasonCode: string;
  findingTypes: readonly SecretFindingType[];
  policyVersion: string;
  createdAt: number;
};

export type OutboundInspectionResult = {
  schemaVersion: 1;
  requestId: string;
  decision: InspectionDecision;
  safeParts: readonly OutboundTextPart[];
  findings: readonly SafeFinding[];
  reasonCode: string;
  requiresUserDecision: boolean;
  receipt: OutboundSecurityReceipt;
};

export type OutboundPolicyContext = {
  allowSanitize: boolean;
  requireApprovalForFindings: boolean;
  policyVersion: string;
  now?: () => number;
  createReceiptId?: () => string;
  authorize?: (request: OutboundInspectionRequest) => Promise<boolean>;
};
