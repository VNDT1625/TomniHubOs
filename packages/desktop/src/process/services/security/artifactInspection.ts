import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { redactSecretFileText } from '@process/agentRuntime/agentMesh/security';
import { scanImageForSensitiveText, type ImageSecurityScanResult } from '@process/visualArtifact';

import type { OutboundInspectionResult, OutboundPolicyContext, OutboundTextPart } from './types';
import { inspectOutboundText } from './outboundTextInspection';

export type SecurityLease = { id: string };
export type SecurityLeaseCoordinator = {
  requestLease: (request: { kind: 'ocr'; estCostMB: number; priority: number }) => Promise<SecurityLease>;
  releaseLease: (id: string) => void;
};

export type FileInspectionRequest = {
  requestId: string;
  actorId: string;
  target: { kind: string; id: string };
  filePath: string;
  content: string;
};

/** Inspect file-derived text with the existing sensitive-file classifier. */
export const inspectOutboundFileText = async (
  request: FileInspectionRequest,
  context: OutboundPolicyContext
): Promise<OutboundInspectionResult> => {
  const firewall = redactSecretFileText(request.filePath, request.content);
  const result = await inspectOutboundText(
    {
      schemaVersion: 1,
      requestId: request.requestId,
      actorId: request.actorId,
      surface: 'file',
      target: request.target,
      parts: [{ id: 'file-content', text: firewall.text, source: 'file' }],
      sensitivity: firewall.findings.length > 0 || firewall.redacted ? 'secret-bearing' : 'normal',
    },
    context
  );

  if (firewall.redacted && result.decision === 'allow') {
    return {
      ...result,
      decision: 'sanitize',
      reasonCode: 'sanitized_secret',
      findings: firewall.findings.map((f) => ({ ...f })),
    };
  }

  return result;
};

export type QuarantinedTextFileRequest = Omit<FileInspectionRequest, 'content'> & {
  removeAfterInspection?: boolean;
};

/** Read from quarantine, inspect locally, and always clean temporary content when requested. */
export const inspectQuarantinedTextFile = async (
  request: QuarantinedTextFileRequest,
  context: OutboundPolicyContext
): Promise<OutboundInspectionResult> => {
  try {
    const content = await readFile(request.filePath, 'utf8');
    return await inspectOutboundFileText({ ...request, content }, context);
  } finally {
    if (request.removeAfterInspection) await rm(request.filePath, { force: true });
  }
};

export type ImageInspectionRequest = {
  imagePath: string;
  mimeType?: string;
  coordinator: SecurityLeaseCoordinator;
  scan?: (imagePath: string, options: { mimeType?: string }) => Promise<ImageSecurityScanResult>;
};

/** Run fail-closed local image inspection under the shared resource lease. */
export const inspectOutboundImage = async (request: ImageInspectionRequest): Promise<ImageSecurityScanResult> => {
  const lease = await request.coordinator.requestLease({ kind: 'ocr', estCostMB: 384, priority: 100 });
  try {
    return await (request.scan ?? scanImageForSensitiveText)(request.imagePath, { mimeType: request.mimeType });
  } catch {
    return {
      decision: 'block',
      safeText: '',
      findings: [],
      ocr: { blockCount: 0, averageConfidence: 0, minimumAcceptedConfidence: 0.35 },
    };
  } finally {
    request.coordinator.releaseLease(lease.id);
  }
};

export const safeFileDisplayName = (filePath: string): string => path.basename(filePath).slice(0, 120);

export const safePartsFromInspection = (inspection: OutboundInspectionResult): readonly OutboundTextPart[] =>
  inspection.safeParts;
