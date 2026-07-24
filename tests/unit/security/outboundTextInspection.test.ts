import { describe, expect, it, vi } from 'vitest';

import { executeAfterOutboundInspection, inspectOutboundText } from '@process/services/security';
import type { OutboundInspectionRequest, OutboundPolicyContext } from '@process/services/security';

const request = (text: string): OutboundInspectionRequest => ({
  schemaVersion: 1,
  requestId: 'request-1',
  actorId: 'user-1',
  surface: 'chat',
  target: { kind: 'provider', id: 'provider-1' },
  parts: [{ id: 'part-1', text, source: 'user' }],
  sensitivity: 'normal',
});

const context = (overrides: Partial<OutboundPolicyContext> = {}): OutboundPolicyContext => ({
  allowSanitize: true,
  requireApprovalForFindings: false,
  policyVersion: 'security-test-1',
  now: () => 1_000,
  createReceiptId: () => 'receipt-1',
  ...overrides,
});

describe('inspectOutboundText', () => {
  it('allows ordinary text and produces a safe receipt', async () => {
    const result = await inspectOutboundText(request('hello world'), context());
    expect(result.decision).toBe('allow');
    expect(result.safeParts[0]?.text).toBe('hello world');
    expect(result.receipt.findingTypes).toEqual([]);
  });

  it('sanitizes secrets without returning the original value in metadata', async () => {
    const secret = 'password = super-secret-value-123';
    const result = await inspectOutboundText(request(secret), context());
    expect(result.decision).toBe('sanitize');
    expect(result.safeParts[0]?.text).not.toContain('super-secret-value-123');
    expect(JSON.stringify(result)).not.toContain('super-secret-value-123');
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('requires explicit approval when policy requires it', async () => {
    const result = await inspectOutboundText(request('token: ghp_123456789012345678901234567890123456'), context({ requireApprovalForFindings: true }));
    expect(result.decision).toBe('approval_required');
    expect(result.requiresUserDecision).toBe(true);
  });

  it('fails closed for malformed requests and authorization failures', async () => {
    const malformed = await inspectOutboundText({ ...request('hello'), schemaVersion: 2 } as never, context());
    expect(malformed.decision).toBe('failed_closed');

    const denied = await inspectOutboundText(request('hello'), context({ authorize: vi.fn().mockResolvedValue(false) }));
    expect(denied.decision).toBe('block');
    expect(denied.reasonCode).toBe('permission_denied');
  });

  it('does not execute effects for block or approval', async () => {
    const effect = vi.fn().mockResolvedValue('sent');
    const result = await executeAfterOutboundInspection(
      request('password = secret-value-123'),
      context({ allowSanitize: false }),
      effect
    );
    expect(result.inspection.decision).toBe('block');
    expect(effect).not.toHaveBeenCalled();
  });

  it('executes exactly once with sanitized parts', async () => {
    const effect = vi.fn().mockResolvedValue('sent');
    const result = await executeAfterOutboundInspection(
      request('password = secret-value-123'),
      context(),
      effect
    );
    expect(result.value).toBe('sent');
    expect(effect).toHaveBeenCalledTimes(1);
    expect(effect.mock.calls[0]?.[0][0]?.text).not.toContain('secret-value-123');
  });
});
