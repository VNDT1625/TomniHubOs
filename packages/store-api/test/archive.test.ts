import { describe, expect, it } from 'vitest';
import { validatePackageArchive } from '../src/staging.js';

const localZip = (name: string, body = Buffer.from('x')): Buffer => {
  const nameBytes = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(body.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return Buffer.concat([header, nameBytes, body]);
};

describe('package archive validation', () => {
  it('accepts bounded relative ZIP entries', () =>
    expect(() => validatePackageArchive(localZip('package.json'), true)).not.toThrow());
  it('rejects traversal and absolute paths', () => {
    expect(() => validatePackageArchive(localZip('../evil'), true)).toThrow('ARCHIVE_PATH_TRAVERSAL');
    expect(() => validatePackageArchive(localZip('/evil'), true)).toThrow('ARCHIVE_PATH_TRAVERSAL');
  });
  it('fails closed when production requires an archive', () =>
    expect(() => validatePackageArchive(Buffer.from('plain'), true)).toThrow('ARCHIVE_REQUIRED'));
});
