import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createCrx3Verifier,
  crxIdToExtensionId,
  deriveExtensionId,
  extractCrx3Payload,
  injectManifestKey,
  installExtensionFromCrx,
  installExtensionFromFile,
  isExtensionId,
  parseCrx3Header,
  parseCrx3Prefix,
  verifyCrx3Buffer,
} from '@process/integrations/repoSources/crx';
import { ExtensionSourceError } from '@process/integrations/repoSources/folder';
import {
  buildCrx,
  cleanRoots,
  crxIdBytes,
  ecKey,
  edKey,
  EXTENSION_CONNECTION,
  fakeDeps,
  idOfKey,
  lengthDelimited,
  makeRoot,
  MANIFEST_V3,
  proofBytes,
  rsaKey,
  signedHeaderOf,
  signedPayload,
  signWith,
  zipOf,
  type TestKey,
} from './extensionFixtures';

let ours: TestKey;
let google: TestKey;
let googleEc: TestKey;
let zip: Buffer;

beforeAll(async () => {
  ours = rsaKey();
  google = rsaKey();
  googleEc = ecKey();
  zip = await zipOf({ 'manifest.json': MANIFEST_V3, 'background.js': 'console.log(1)' });
});
afterEach(cleanRoots);

const codeOf = (action: () => unknown): string | undefined => {
  try {
    action();
  } catch (error) {
    return error instanceof ExtensionSourceError ? error.code : `other:${String(error)}`;
  }
  return undefined;
};
const codeOfAsync = async (action: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await action();
  } catch (error) {
    return error instanceof ExtensionSourceError ? error.code : `other:${String(error)}`;
  }
  return undefined;
};

const header = (...parts: Buffer[]): Buffer => Buffer.concat(parts);

const valid = (): Buffer => buildCrx({ zip, proofs: [{ key: ours }], idKey: ours });

describe('CRX3 verification (pure)', () => {
  it('accepts a valid file and derives id and key from the matching proof', () => {
    const result = verifyCrx3Buffer(valid());
    expect(result.extensionId).toBe(idOfKey(ours));
    expect(isExtensionId(result.extensionId)).toBe(true);
    expect(result.publicKey).toBe(ours.spki.toString('base64'));
    expect(result.proofCount).toBe(1);
    expect(result.zip.equals(zip)).toBe(true);
  });

  it('matches the Chromium id rule: first 16 bytes of SHA-256, nibbles mapped to a-p', () => {
    expect(crxIdToExtensionId(Buffer.from('00ff10', 'hex'))).toBe('aappba');
    expect(deriveExtensionId(ours.spki)).toBe(idOfKey(ours));
  });

  it('with several proofs only the one matching the id supplies the key, in any order', () => {
    for (const order of [
      [ours, google, googleEc],
      [google, googleEc, ours],
      [google, ours, googleEc],
    ]) {
      const file = buildCrx({ zip, proofs: order.map((key) => ({ key })), idKey: ours });
      const result = verifyCrx3Buffer(file, { expectedId: idOfKey(ours) });
      expect(result.publicKey).toBe(ours.spki.toString('base64'));
      expect(result.proofCount).toBe(3);
    }
  });

  it('accepts an ECDSA proof as the identity', () => {
    const ec = ecKey();
    const result = verifyCrx3Buffer(buildCrx({ zip, proofs: [{ key: ec }, { key: google }], idKey: ec }));
    expect(result.extensionId).toBe(idOfKey(ec));
  });

  it('rejects a payload changed after signing', () => {
    const file = valid();
    file[file.length - 5] = (file[file.length - 5] ?? 0) ^ 0xff;
    expect(codeOf(() => verifyCrx3Buffer(file))).toBe('CRX_INVALID');
  });

  it('rejects a wrong signature on the identity proof', () => {
    const signedHeader = signedHeaderOf(crxIdBytes(ours));
    const wrong = signWith(ours, Buffer.from('something else'));
    const file = buildCrx({ zip, proofs: [{ key: ours, signature: wrong }], idKey: ours, signedHeader });
    expect(codeOf(() => verifyCrx3Buffer(file))).toBe('CRX_INVALID');
  });

  it('rejects when crx_id belongs to no proof, even though every signature is valid', () => {
    const file = buildCrx({ zip, proofs: [{ key: ours }, { key: google }], idKey: rsaKey() });
    expect(codeOf(() => verifyCrx3Buffer(file))).toBe('CRX_INVALID');
  });

  it('rejects when only a non-identity proof carries the declared id', () => {
    // Declared id is Google's; Google's proof is valid but ours is the only one the caller expected.
    const file = buildCrx({ zip, proofs: [{ key: ours }, { key: google }], idKey: google });
    expect(codeOf(() => verifyCrx3Buffer(file, { expectedId: idOfKey(ours) }))).toBe('CRX_INVALID');
  });

  it('rejects when the requested id differs from the declared id', () => {
    expect(codeOf(() => verifyCrx3Buffer(valid(), { expectedId: idOfKey(google) }))).toBe('CRX_INVALID');
  });

  it('rejects the file when an extra proof has a bad signature (all signatures must verify)', () => {
    const signedHeader = signedHeaderOf(crxIdBytes(ours));
    const file = buildCrx({
      zip,
      proofs: [{ key: ours }, { key: google, signature: signWith(google, Buffer.from('nope')) }],
      idKey: ours,
      signedHeader,
    });
    expect(codeOf(() => verifyCrx3Buffer(file))).toBe('CRX_INVALID');
    const ecBad = buildCrx({
      zip,
      proofs: [{ key: ours }, { key: googleEc, signature: Buffer.from('3006020101020101', 'hex') }],
      idKey: ours,
    });
    expect(codeOf(() => verifyCrx3Buffer(ecBad))).toBe('CRX_INVALID');
  });

  it('rejects a signature made over the wrong range', () => {
    const signedHeader = signedHeaderOf(crxIdBytes(ours));
    const good = signedPayload(signedHeader, zip);
    const variants: Buffer[] = [
      // no zip
      Buffer.concat([good.subarray(0, good.length - zip.length)]),
      // zip only
      zip,
      // no length prefix
      Buffer.concat([Buffer.from('CRX3 SignedData\u0000', 'latin1'), signedHeader, zip]),
      // no magic string
      good.subarray(16),
      // no NUL in the magic string
      Buffer.concat([Buffer.from('CRX3 SignedData', 'latin1'), good.subarray(16)]),
    ];
    for (const data of variants) {
      const file = buildCrx({
        zip,
        proofs: [{ key: ours, signature: signWith(ours, data) }],
        idKey: ours,
        signedHeader,
      });
      expect(codeOf(() => verifyCrx3Buffer(file))).toBe('CRX_INVALID');
    }
  });

  it('rejects every truncation', () => {
    const file = valid();
    const headerEnd = 12 + file.readUInt32LE(8);
    const cuts = new Set<number>([
      0,
      1,
      3,
      4,
      7,
      8,
      11,
      12,
      13,
      40,
      headerEnd - 1,
      headerEnd,
      headerEnd + 1,
      file.length - 1,
    ]);
    for (const cut of cuts) {
      expect(codeOf(() => verifyCrx3Buffer(file.subarray(0, cut)))).toBe('CRX_INVALID');
    }
  });

  it('rejects huge and zero header lengths without reading them', () => {
    for (const headerLength of [0, 0xffffffff, 1024 * 1024 + 1, 0x7fffffff]) {
      const file = buildCrx({ zip, proofs: [{ key: ours }], idKey: ours, headerLength });
      expect(codeOf(() => verifyCrx3Buffer(file))).toBe('CRX_INVALID');
    }
    // A header length that fits the cap but not the file.
    const tooLong = buildCrx({ zip: Buffer.from('x'), proofs: [{ key: ours }], idKey: ours, headerLength: 900_000 });
    expect(codeOf(() => verifyCrx3Buffer(tooLong))).toBe('CRX_INVALID');
    expect(
      codeOf(() => parseCrx3Prefix(Buffer.from('Cr24\u0003\u0000\u0000\u0000\u0000\u0000\u0010\u0000', 'latin1'), 100))
    ).toBe('CRX_INVALID');
  });

  it('rejects an unknown version and a wrong magic', () => {
    for (const version of [0, 1, 2, 4, 0xffffffff]) {
      expect(codeOf(() => verifyCrx3Buffer(buildCrx({ zip, proofs: [{ key: ours }], idKey: ours, version })))).toBe(
        'CRX_INVALID'
      );
    }
    const wrongMagic = valid();
    wrongMagic.write('PK\u0003\u0004', 0, 'latin1');
    expect(codeOf(() => verifyCrx3Buffer(wrongMagic))).toBe('CRX_INVALID');
  });

  it('rejects a key type that does not match the proof field', () => {
    const ed = edKey();
    const asRsa = buildCrx({ zip, proofs: [{ key: ed, field: 2 }], idKey: ed });
    expect(codeOf(() => verifyCrx3Buffer(asRsa))).toBe('CRX_INVALID');
    const ecInRsa = buildCrx({ zip, proofs: [{ key: googleEc, field: 2 }], idKey: googleEc });
    expect(codeOf(() => verifyCrx3Buffer(ecInRsa))).toBe('CRX_INVALID');
    const rsaInEc = buildCrx({ zip, proofs: [{ key: ours, field: 3 }], idKey: ours });
    expect(codeOf(() => verifyCrx3Buffer(rsaInEc))).toBe('CRX_INVALID');
  });

  it('rejects a public key that is not canonical DER', () => {
    const padded = { ...ours, spki: Buffer.concat([ours.spki, Buffer.from([0])]) };
    const file = buildCrx({ zip, proofs: [{ key: padded, signature: Buffer.from('abcd', 'hex') }], idKey: padded });
    expect(codeOf(() => verifyCrx3Buffer(file))).toBe('CRX_INVALID');
  });

  it('rejects malformed headers', () => {
    const signedHeader = signedHeaderOf(crxIdBytes(ours));
    const proof = proofBytes({ key: ours }, signedHeader, zip);
    const cases: Buffer[] = [
      header(lengthDelimited(10_000, signedHeader)), // no proofs
      header(proof), // no signed_header_data
      header(proof, lengthDelimited(10_000, signedHeader), lengthDelimited(10_000, signedHeader)), // duplicate
      header(proof, lengthDelimited(10_000, lengthDelimited(1, Buffer.alloc(15)))), // crx_id too short
      header(proof, lengthDelimited(10_000, lengthDelimited(1, Buffer.alloc(17)))), // crx_id too long
      header(proof, lengthDelimited(10_000, Buffer.alloc(0))), // crx_id missing
      header(proof, Buffer.from([0x92, 0x4e, 0xff, 0x7f])), // field 10000 as varint-ish junk
      header(proof, lengthDelimited(10_000, signedHeader), Buffer.from([0x12, 0x7f, 0x01])), // length beyond the header
      header(proof, lengthDelimited(10_000, signedHeader), Buffer.from([0x0b])), // group wire type
      header(proof, lengthDelimited(10_000, signedHeader), Buffer.from([0x80])), // truncated tag
      header(proof, lengthDelimited(10_000, signedHeader), Buffer.from([0x00, 0x01])), // field number 0
      header(Buffer.from([0x10, ...Array.from({ length: 11 }, () => 0xff)])), // overlong varint
      header(lengthDelimited(2, Buffer.alloc(0)), lengthDelimited(10_000, signedHeader)), // empty proof
      header(lengthDelimited(2, lengthDelimited(1, ours.spki)), lengthDelimited(10_000, signedHeader)), // no signature
    ];
    for (const bytes of cases) {
      expect(codeOf(() => parseCrx3Header(bytes))).toBe('CRX_INVALID');
    }
  });

  it('rejects an oversize proof list and oversize fields', () => {
    const signedHeader = signedHeaderOf(crxIdBytes(ours));
    const proof = proofBytes({ key: ours }, signedHeader, zip);
    const many = Buffer.concat([...Array.from({ length: 17 }, () => proof), lengthDelimited(10_000, signedHeader)]);
    expect(codeOf(() => parseCrx3Header(many))).toBe('CRX_INVALID');
    const hugeSignature = lengthDelimited(
      2,
      Buffer.concat([lengthDelimited(1, ours.spki), lengthDelimited(2, Buffer.alloc(5000))])
    );
    expect(codeOf(() => parseCrx3Header(Buffer.concat([hugeSignature, lengthDelimited(10_000, signedHeader)])))).toBe(
      'CRX_INVALID'
    );
    const hugeSigned = lengthDelimited(10_000, Buffer.alloc(5000));
    expect(codeOf(() => parseCrx3Header(Buffer.concat([proof, hugeSigned])))).toBe('CRX_INVALID');
  });

  it('ignores unknown fields in the header and in the signed data', () => {
    const signedHeader = Buffer.concat([signedHeaderOf(crxIdBytes(ours)), lengthDelimited(7, Buffer.from('x'))]);
    const file = buildCrx({
      zip,
      proofs: [{ key: ours }],
      idKey: ours,
      signedHeader,
      extraHeader: Buffer.concat([lengthDelimited(5, Buffer.from('unknown')), Buffer.from([0x20, 0x07])]),
    });
    expect(verifyCrx3Buffer(file).extensionId).toBe(idOfKey(ours));
  });

  it('cannot be finished or fed twice', () => {
    const file = valid();
    const verifier = createCrx3Verifier(file.subarray(12, 12 + file.readUInt32LE(8)));
    verifier.update(zip);
    verifier.finish();
    expect(codeOf(() => verifier.update(zip))).toBe('CRX_INVALID');
    expect(codeOf(() => verifier.finish())).toBe('CRX_INVALID');
  });
});

describe('injectManifestKey', () => {
  it('adds the key, keeps other fields, and tolerates a byte order mark', () => {
    const text = injectManifestKey(`\uFEFF${MANIFEST_V3}`, 'QUJD');
    expect(JSON.parse(text)).toEqual({ manifest_version: 3, name: 'Sample', version: '1.2.3', key: 'QUJD' });
  });

  it('keeps a matching key (whitespace aside) and refuses a different one', () => {
    const same = JSON.stringify({ manifest_version: 3, key: 'QU\nJD' });
    expect(injectManifestKey(same, 'QUJD')).toBe(same);
    expect(codeOf(() => injectManifestKey(JSON.stringify({ manifest_version: 3, key: 'WFla' }), 'QUJD'))).toBe(
      'CRX_INVALID'
    );
    expect(codeOf(() => injectManifestKey(JSON.stringify({ manifest_version: 3, key: 5 }), 'QUJD'))).toBe(
      'CRX_INVALID'
    );
  });

  it('rejects text that is not a manifest object', () => {
    for (const text of ['', '[]', 'null', '{']) {
      expect(codeOf(() => injectManifestKey(text, 'QUJD'))).toBe('EXTENSION_INVALID');
    }
  });
});

describe('extractCrx3Payload (file)', () => {
  it('writes exactly the verified ZIP and returns the identity', async () => {
    const root = await makeRoot();
    const crx = path.join(root, 'a.crx');
    await writeFile(crx, valid());
    const out = path.join(root, 'payload.zip');
    const result = await extractCrx3Payload(crx, out);
    expect(result.extensionId).toBe(idOfKey(ours));
    expect((await readFile(out)).equals(zip)).toBe(true);
  });

  it('removes the copy and reports CRX_INVALID when the signature fails', async () => {
    const root = await makeRoot();
    const file = valid();
    file[file.length - 3] = (file[file.length - 3] ?? 0) ^ 1;
    const crx = path.join(root, 'bad.crx');
    await writeFile(crx, file);
    const out = path.join(root, 'payload.zip');
    expect(await codeOfAsync(() => extractCrx3Payload(crx, out))).toBe('CRX_INVALID');
    expect(await readdir(root)).toEqual(['bad.crx']);
  });

  it('enforces the size cap on the payload', async () => {
    const root = await makeRoot();
    const crx = path.join(root, 'a.crx');
    await writeFile(crx, valid());
    expect(await codeOfAsync(() => extractCrx3Payload(crx, path.join(root, 'p.zip'), { maxZipBytes: 10 }))).toBe(
      'TOO_LARGE'
    );
    expect(await readdir(root)).toEqual(['a.crx']);
  });

  it('rejects truncated, huge-header and missing files', async () => {
    const root = await makeRoot();
    const file = valid();
    const cases: Record<string, Buffer> = {
      empty: Buffer.alloc(0),
      short: file.subarray(0, 9),
      cutHeader: file.subarray(0, 40),
      huge: buildCrx({ zip, proofs: [{ key: ours }], idKey: ours, headerLength: 0xffffffff }),
      cutZip: file.subarray(0, file.length - 10),
    };
    for (const [name, bytes] of Object.entries(cases)) {
      const crx = path.join(root, `${name}.crx`);
      // oxlint-disable-next-line no-await-in-loop -- tiny fixtures.
      await writeFile(crx, bytes);
      // oxlint-disable-next-line no-await-in-loop -- tiny fixtures.
      expect(await codeOfAsync(() => extractCrx3Payload(crx, path.join(root, `${name}.zip`)))).toBe('CRX_INVALID');
    }
    expect(await codeOfAsync(() => extractCrx3Payload(path.join(root, 'missing.crx'), path.join(root, 'm.zip')))).toBe(
      'SOURCE_NOT_FOUND'
    );
  });
});

describe('installExtensionFromCrx', () => {
  const writeCrx = async (bytes: Buffer): Promise<string> => {
    const root = await makeRoot();
    const crx = path.join(root, 'ext.crx');
    await writeFile(crx, bytes);
    return crx;
  };

  it('verifies, injects the proven key, and builds then installs as local-built', async () => {
    const run = await fakeDeps();
    const result = await installExtensionFromCrx(run.deps, await writeCrx(valid()), { expectedId: idOfKey(ours) });
    expect(result).toMatchObject({
      from: 'crx',
      extensionId: idOfKey(ours),
      extensionName: 'Sample',
      extensionVersion: '1.2.3',
      install: { packageId: 'local.sample' },
    });
    expect(run.builds).toHaveLength(1);
    expect(run.builds[0]?.allowLocalOutsideWorkspace).toBe(true);
    expect(JSON.parse(run.manifestSeen[0] ?? '{}').key).toBe(ours.spki.toString('base64'));
    expect(run.filesSeen[0]).toEqual(['background.js', 'manifest.json']);
    expect(run.installs).toEqual([path.join(run.staging, 'out.tomny')]);
    expect(run.discarded).toEqual(run.installs);
    expect((await readdir(run.staging)).filter((name) => name.startsWith('tomny-ext-'))).toEqual([]);
  });

  it('never builds or installs a bad CRX', async () => {
    const bad = valid();
    bad[bad.length - 2] = (bad[bad.length - 2] ?? 0) ^ 1;
    const wrongId = buildCrx({ zip, proofs: [{ key: ours }], idKey: google });
    for (const bytes of [bad, wrongId, valid().subarray(0, 30)]) {
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      const run = await fakeDeps();
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      const crx = await writeCrx(bytes);
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      expect(await codeOfAsync(() => installExtensionFromCrx(run.deps, crx))).toBe('CRX_INVALID');
      expect(run.builds).toEqual([]);
      expect(run.installs).toEqual([]);
      // oxlint-disable-next-line no-await-in-loop -- sequential scenarios.
      expect(await readdir(run.staging)).toEqual([]);
    }
  });

  it('refuses a payload whose manifest carries a different key', async () => {
    const other = await zipOf({
      'manifest.json': JSON.stringify({ manifest_version: 3, name: 'X', version: '1', key: 'QUJD' }),
    });
    const run = await fakeDeps();
    const crx = await writeCrx(buildCrx({ zip: other, proofs: [{ key: ours }], idKey: ours }));
    expect(await codeOfAsync(() => installExtensionFromCrx(run.deps, crx))).toBe('CRX_INVALID');
    expect(run.builds).toEqual([]);
  });

  it('refuses a payload with a symlink entry or a zip-slip name even when correctly signed', async () => {
    const link = await zipOf({
      'manifest.json': MANIFEST_V3,
      link: { content: 'C:\\Windows', mode: 0o120777 },
    });
    const run = await fakeDeps();
    expect(
      await codeOfAsync(async () =>
        installExtensionFromCrx(run.deps, await writeCrx(buildCrx({ zip: link, proofs: [{ key: ours }], idKey: ours })))
      )
    ).toBe('ARCHIVE_UNSAFE');
    expect(run.builds).toEqual([]);
  });

  it('refuses a build whose connection records another public key', async () => {
    const run = await fakeDeps({ connections: [{ ...EXTENSION_CONNECTION, publicKey: 'QUJD' }] });
    expect(await codeOfAsync(async () => installExtensionFromCrx(run.deps, await writeCrx(valid())))).toBe(
      'CRX_INVALID'
    );
    expect(run.installs).toEqual([]);
    expect(run.discarded).toHaveLength(1);
  });

  it('accepts a build whose connection records the same public key', async () => {
    const run = await fakeDeps({
      connections: [{ ...EXTENSION_CONNECTION, publicKey: ours.spki.toString('base64') }],
    });
    await installExtensionFromCrx(run.deps, await writeCrx(valid()));
    expect(run.installs).toHaveLength(1);
  });
});

describe('installExtensionFromFile', () => {
  it('sends Cr24 content through the signature checks and a zip through the zip path', async () => {
    const root = await makeRoot();
    const crx = path.join(root, 'a.bin');
    await writeFile(crx, valid());
    const zipFile = path.join(root, 'b.zip');
    await writeFile(zipFile, zip);
    const run = await fakeDeps();
    expect((await installExtensionFromFile(run.deps, crx)).from).toBe('crx');
    expect((await installExtensionFromFile(run.deps, zipFile)).from).toBe('zip');
  });

  it('refuses a bare zip renamed to .crx (it would skip the signature checks)', async () => {
    const root = await makeRoot();
    const fake = path.join(root, 'renamed.crx');
    await writeFile(fake, zip);
    const run = await fakeDeps();
    expect(await codeOfAsync(() => installExtensionFromFile(run.deps, fake))).toBe('CRX_INVALID');
    expect(run.builds).toEqual([]);
  });

  it('reports a missing file', async () => {
    const run = await fakeDeps();
    expect(await codeOfAsync(() => installExtensionFromFile(run.deps, path.join(run.staging, 'nope.crx')))).toBe(
      'SOURCE_NOT_FOUND'
    );
  });
});
