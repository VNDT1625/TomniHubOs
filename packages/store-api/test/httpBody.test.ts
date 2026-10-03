import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { readBody } from '../src/index.js';

const request = (chunks: readonly string[], contentLength?: string): IncomingMessage => {
  const stream = Readable.from(chunks) as IncomingMessage;
  stream.headers = contentLength === undefined ? {} : { 'content-length': contentLength };
  return stream;
};

describe('Store API HTTP body boundary', () => {
  it('rejects malformed and negative declared lengths', async () => {
    await expect(readBody(request([], 'not-a-number'))).rejects.toThrow('INVALID_CONTENT_LENGTH');
    await expect(readBody(request([], '-1'))).rejects.toThrow('INVALID_CONTENT_LENGTH');
  });

  it('rejects oversized declared and streamed payloads', async () => {
    await expect(readBody(request([], '11'), 10)).rejects.toThrow('PAYLOAD_TOO_LARGE');
    await expect(readBody(request(['123456', '78901']), 10)).rejects.toThrow('PAYLOAD_TOO_LARGE');
  });

  it('accepts a valid bounded body', async () => {
    await expect(readBody(request(['hello'], '5'), 5)).resolves.toEqual(Buffer.from('hello'));
  });
});
