import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  inspectOutboundFileText,
  inspectOutboundImage,
  inspectQuarantinedTextFile,
  verifySanitizedInspection,
} from '@process/services/security';
import type { OutboundPolicyContext } from '@process/services/security';

const context: OutboundPolicyContext = {
  allowSanitize: true,
  requireApprovalForFindings: false,
  policyVersion: 'security-test-1',
  now: () => 1,
  createReceiptId: () => 'receipt-1',
};

describe('security artifact inspection', () => {
  it('sanitizes sensitive file content using the existing file classifier', async () => {
    const result = await inspectOutboundFileText(
      {
        requestId: 'request-1',
        actorId: 'user-1',
        target: { kind: 'provider', id: 'provider-1' },
        filePath: '.env',
        content: 'PASSWORD=private-value-123',
      },
      context
    );
    expect(JSON.stringify(result)).not.toContain('private-value-123');
    expect(['sanitize', 'block']).toContain(result.decision);
  });

  it('removes quarantined text after inspection', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-security-'));
    const filePath = path.join(directory, '.env');
    await writeFile(filePath, 'TOKEN=private-value-456', 'utf8');
    await inspectQuarantinedTextFile(
      {
        requestId: 'request-2',
        actorId: 'user-1',
        target: { kind: 'provider', id: 'provider-1' },
        filePath,
        removeAfterInspection: true,
      },
      context
    );
    await expect(readFile(filePath)).rejects.toThrow();
  });

  it('blocks image egress when OCR fails and always releases the lease', async () => {
    const coordinator = {
      requestLease: vi.fn().mockResolvedValue({ id: 'lease-1' }),
      releaseLease: vi.fn(),
    };
    const result = await inspectOutboundImage({
      imagePath: 'image.png',
      coordinator,
      scan: vi.fn().mockRejectedValue(new Error('OCR unavailable')),
    });
    expect(result.decision).toBe('block');
    expect(coordinator.releaseLease).toHaveBeenCalledWith('lease-1');
  });

  it('treats missing and low-confidence semantic models as approval-required', async () => {
    const inspection = await inspectOutboundFileText(
      {
        requestId: 'request-3',
        actorId: 'user-1',
        target: { kind: 'provider', id: 'provider-1' },
        filePath: 'notes.txt',
        content: 'ordinary content',
      },
      context
    );
    await expect(verifySanitizedInspection(inspection, undefined)).resolves.toMatchObject({
      recommendation: 'approval_required',
      reasonCode: 'model_unavailable',
    });
    await expect(
      verifySanitizedInspection(inspection, async () => ({
        recommendation: 'allow',
        confidence: 0.2,
        categories: [],
        reasonCodes: [],
      }))
    ).resolves.toMatchObject({ recommendation: 'approval_required', reasonCode: 'model_low_confidence' });
  });
});
