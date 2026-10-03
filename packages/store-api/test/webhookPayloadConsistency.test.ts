import { describe, expect, it } from 'vitest';
import { assertWebhookPayloadConsistency } from '../src/commerceRepository.js';

describe('Paddle webhook payload consistency', () => {
  it('accepts an exact duplicate payload hash', () => {
    expect(() => assertWebhookPayloadConsistency('hash-a', 'hash-a')).not.toThrow();
  });

  it('rejects the same provider event with a different payload hash', () => {
    expect(() => assertWebhookPayloadConsistency('hash-a', 'hash-b')).toThrow('WEBHOOK_PAYLOAD_CONFLICT');
  });
});
