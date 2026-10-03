import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyPaddleWebhook } from '../src/paddle.js';
describe('Paddle webhook boundary', () => {
  it('verifies raw body and rejects tampering', () => {
    const body = Buffer.from('{"event":"transaction.completed"}');
    const ts = String(Math.floor(Date.now() / 1000));
    const secret = 'test-secret';
    const h1 = createHmac('sha256', secret).update(`${ts}:`).update(body).digest('hex');
    expect(() => verifyPaddleWebhook(body, `ts=${ts};h1=${h1}`, secret)).not.toThrow();
    expect(() => verifyPaddleWebhook(Buffer.from('tampered'), `ts=${ts};h1=${h1}`, secret)).toThrow(
      'PADDLE_SIGNATURE_INVALID'
    );
  });
});
