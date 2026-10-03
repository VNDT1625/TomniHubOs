import { describe, expect, it } from 'vitest';
import { stagePackageArtifact } from '../src/staging.js';
describe('artifact staging', () => {
  it('hashes bytes and binds metadata', () => {
    const out = stagePackageArtifact({
      bytes: Buffer.from('package'),
      packageId: 'pkg',
      version: '1.0.0',
      manifestDigest: `sha256-${'a'.repeat(64)}`,
    });
    expect(out.digest).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(out.objectKey).toBe(`sha256/${out.digest.slice(7)}`);
  });
  it('rejects oversized or malformed metadata', () => {
    expect(() =>
      stagePackageArtifact({ bytes: Buffer.from('x'), packageId: '', version: '1', manifestDigest: 'bad' })
    ).toThrow('ARTIFACT_METADATA_INVALID');
    expect(() =>
      stagePackageArtifact({
        bytes: Buffer.from('1234'),
        packageId: 'p',
        version: '1',
        manifestDigest: `sha256-${'a'.repeat(64)}`,
        maxBytes: 2,
      })
    ).toThrow('ARTIFACT_SIZE_INVALID');
  });
});
