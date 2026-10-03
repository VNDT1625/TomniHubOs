import { describe, expect, it } from 'vitest';
import { decodeBase64 } from '../src/index.js';

describe('strict artifact base64 decoding', () => {
  it('accepts canonical base64', () =>
    expect(decodeBase64(Buffer.from('package').toString('base64'))).toEqual(Buffer.from('package')));
  it('rejects malformed or non-canonical payloads', () => {
    expect(() => decodeBase64('not base64')).toThrow('ARTIFACT_BASE64_INVALID');
    expect(() => decodeBase64('YQ')).toThrow('ARTIFACT_BASE64_INVALID');
  });
});
