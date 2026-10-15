/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import { inspectOutboundText } from '../../security/outboundTextInspection';
import { redactVietnameseCredentials } from '../../security/vietnameseNormalizer';
import type { ChatStageInput, ChatStageOutput, IChatStage } from '../types';

/**
 * Optional Main-owned guard for a complete assistant answer.
 * The native service MUST buffer before this stage runs; this stage alone cannot
 * prevent the earlier publication of a streaming delta.
 */
export class OutputSecurityStage implements IChatStage {
  public readonly id = 'builtin:output-security';
  public readonly displayName = 'Assistant Output Security Guard';
  public readonly description = 'Check completed assistant text for secrets before its release or persistence.';
  public readonly phase = 'post_model' as const;
  public readonly defaultEnabled = false;
  public readonly defaultTimeoutMs = 2_000;
  public readonly role = 'guard' as const;

  public async execute(input: ChatStageInput): Promise<ChatStageOutput> {
    input.signal?.throwIfAborted();
    const mode = input.config?.mode === 'redact' ? 'redact' : 'block';
    const inspection = await inspectOutboundText(
      {
        schemaVersion: 1,
        requestId: input.runId,
        runId: input.runId,
        actorId: 'pipeline-main',
        surface: 'chat',
        target: { kind: 'renderer', id: 'chat-output' },
        requestedCapability: 'outbound.text.send',
        sensitivity: 'secret-bearing',
        parts: [{ id: 'assistant-text', text: input.query }],
      },
      {
        policyVersion: 'assistant-output-v1',
        allowSanitize: true,
        requireApprovalForFindings: false,
      }
    );
    input.signal?.throwIfAborted();
    if (inspection.decision !== 'allow' && inspection.decision !== 'sanitize') {
      return { decision: 'block', reasonCode: 'OUTPUT_SECURITY_INSPECTION_FAILED' };
    }
    const inspected = inspection.safeParts.find((part) => part.id === 'assistant-text')?.text;
    if (typeof inspected !== 'string') {
      return { decision: 'block', reasonCode: 'OUTPUT_SECURITY_EMPTY_VERDICT' };
    }
    const safe = redactVietnameseCredentials(inspected);
    const secretDetected = inspection.findings.length > 0 || safe !== input.query;
    if (secretDetected && mode === 'block') {
      return {
        decision: 'block',
        reasonCode: 'OUTPUT_SECURITY_SECRET_DETECTED',
        evidence: { findingCount: inspection.findings.length },
      };
    }
    if (secretDetected && safe === input.query) {
      return { decision: 'block', reasonCode: 'OUTPUT_SECURITY_SANITIZATION_FAILED' };
    }
    if (safe !== input.query) {
      return {
        decision: 'rewrite',
        query: safe,
        evidence: { redacted: true, findingCount: inspection.findings.length },
      };
    }
    return { decision: 'continue', evidence: { reviewed: true } };
  }
}
