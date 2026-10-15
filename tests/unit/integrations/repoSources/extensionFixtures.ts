import { createHash, createSign, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import type { RepoToPackageResult } from '@process/extensions/package-manager/repoPackaging/types';
import type { LocalInstallOutcome } from '@process/integrations/connections/wiring/localInstall';
import type { ExtensionBuildRequest, ExtensionInstallDeps } from '@process/integrations/repoSources/folder';

export const roots: string[] = [];

export const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-ext-test-'));
  roots.push(root);
  return root;
};

export const cleanRoots = async (): Promise<void> => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3 })));
};

export const MANIFEST_V3 = JSON.stringify({ manifest_version: 3, name: 'Sample', version: '1.2.3' });

export const writeFolder = async (root: string, files: Readonly<Record<string, string>>): Promise<void> => {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    // oxlint-disable-next-line no-await-in-loop -- tiny fixtures, sequential on purpose.
    await mkdir(path.dirname(target), { recursive: true });
    // oxlint-disable-next-line no-await-in-loop -- tiny fixtures, sequential on purpose.
    await writeFile(target, content);
  }
};

export type ZipSpec = Readonly<Record<string, string | Readonly<{ content: string; mode?: number }>>>;

export const zipOf = async (spec: ZipSpec): Promise<Buffer> => {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(spec)) {
    if (typeof value === 'string') zip.file(name, value);
    else zip.file(name, value.content, value.mode === undefined ? {} : { unixPermissions: value.mode });
  }
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE' });
};

/* ---------- CRX3 builder (a second, independent implementation of the container format) ---------- */

const varint = (value: number): Buffer => {
  const bytes: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
};

export const lengthDelimited = (field: number, body: Buffer): Buffer =>
  Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);

export type TestKey = Readonly<{ privateKey: KeyObject; spki: Buffer; type: 'rsa' | 'ec' | 'ed25519' }>;

const wrap = (type: TestKey['type'], pair: { privateKey: KeyObject; publicKey: KeyObject }): TestKey => ({
  privateKey: pair.privateKey,
  spki: pair.publicKey.export({ type: 'spki', format: 'der' }),
  type,
});

export const rsaKey = (): TestKey => wrap('rsa', generateKeyPairSync('rsa', { modulusLength: 2048 }));
export const ecKey = (): TestKey => wrap('ec', generateKeyPairSync('ec', { namedCurve: 'prime256v1' }));
export const edKey = (): TestKey => wrap('ed25519', generateKeyPairSync('ed25519'));

/** The id a key gets, computed here independently of the module under test. */
export const idOfKey = (key: TestKey): string =>
  [...createHash('sha256').update(key.spki).digest().subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15)))
    .join('');

export const crxIdBytes = (key: TestKey): Buffer => createHash('sha256').update(key.spki).digest().subarray(0, 16);

export const signedHeaderOf = (crxId: Buffer): Buffer => lengthDelimited(1, crxId);

export const signedPayload = (signedHeader: Buffer, zip: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeader.length);
  return Buffer.concat([Buffer.from('CRX3 SignedData\u0000', 'latin1'), length, signedHeader, zip]);
};

export const signWith = (key: TestKey, data: Buffer): Buffer => {
  if (key.type === 'ed25519') return sign(null, data, key.privateKey);
  const signer = createSign('sha256');
  signer.update(data);
  return signer.sign(key.privateKey);
};

export type ProofSpec = Readonly<{
  key: TestKey;
  /** The protobuf field: 2 = RSA, 3 = ECDSA. Defaults from the key type. */
  field?: number;
  /** Replaces the signature (for a deliberately wrong proof). */
  signature?: Buffer;
}>;

export const proofBytes = (proof: ProofSpec, signedHeader: Buffer, zip: Buffer): Buffer => {
  const field = proof.field ?? (proof.key.type === 'ec' ? 3 : 2);
  const signature = proof.signature ?? signWith(proof.key, signedPayload(signedHeader, zip));
  return lengthDelimited(field, Buffer.concat([lengthDelimited(1, proof.key.spki), lengthDelimited(2, signature)]));
};

export type CrxSpec = Readonly<{
  zip: Buffer;
  proofs: readonly ProofSpec[];
  /** The key whose id `crx_id` declares. */
  idKey: TestKey;
  version?: number;
  /** Replaces the whole signed_header_data. */
  signedHeader?: Buffer;
  /** Bytes appended to the header message after the proofs. */
  extraHeader?: Buffer;
  /** Overrides the header length field. */
  headerLength?: number;
}>;

export const buildCrx = (spec: CrxSpec): Buffer => {
  const signedHeader = spec.signedHeader ?? signedHeaderOf(crxIdBytes(spec.idKey));
  const header = Buffer.concat([
    ...spec.proofs.map((proof) => proofBytes(proof, signedHeader, spec.zip)),
    lengthDelimited(10_000, signedHeader),
    spec.extraHeader ?? Buffer.alloc(0),
  ]);
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'latin1');
  prefix.writeUInt32LE(spec.version ?? 3, 4);
  prefix.writeUInt32LE(spec.headerLength ?? header.length, 8);
  return Buffer.concat([prefix, header, spec.zip]);
};

/* ---------- fake install dependencies ---------- */

export const EXTENSION_CONNECTION = {
  kind: 'extension',
  id: 'extension',
  title: 'Sample',
  format: 'chrome-mv3',
  root: 'source',
  permissions: [],
  hostPermissions: [],
  unsupported: [],
};

export type FakeRun = {
  deps: ExtensionInstallDeps;
  builds: ExtensionBuildRequest[];
  /** The manifest.json the build saw (read while the staged folder still exists). */
  manifestSeen: string[];
  /** Relative paths of the files the build saw. */
  filesSeen: string[][];
  installs: string[];
  discarded: string[];
  staging: string;
};

export const fakeDeps = async (
  overrides: Readonly<{
    verified?: boolean;
    connections?: readonly unknown[];
    install?: (artifactPath: string) => Promise<LocalInstallOutcome>;
    limits?: ExtensionInstallDeps['limits'];
  }> = {}
): Promise<FakeRun> => {
  const staging = await makeRoot();
  const run: FakeRun = {
    builds: [],
    manifestSeen: [],
    filesSeen: [],
    installs: [],
    discarded: [],
    staging,
    deps: undefined as unknown as ExtensionInstallDeps,
  };
  const listFiles = async (dir: string, base = ''): Promise<string[]> => {
    const { readdir } = await import('node:fs/promises');
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = base === '' ? entry.name : `${base}/${entry.name}`;
      // oxlint-disable-next-line no-await-in-loop -- tiny fixture tree, listed in order.
      if (entry.isDirectory()) out.push(...(await listFiles(path.join(dir, entry.name), relative)));
      else out.push(relative);
    }
    return out.toSorted();
  };
  run.deps = {
    temporaryRoot: staging,
    ...(overrides.limits === undefined ? {} : { limits: overrides.limits }),
    build: async (request) => {
      run.builds.push(request);
      run.manifestSeen.push(await readFile(path.join(request.source, 'manifest.json'), 'utf8'));
      run.filesSeen.push(await listFiles(request.source));
      const connections = overrides.connections ?? [EXTENSION_CONNECTION];
      return {
        artifactPath: path.join(staging, 'out.tomny'),
        verified: overrides.verified ?? true,
        manifest: { id: 'local.sample', version: '1.0.0' },
        adapter: { schemaVersion: 1, generatedBy: 'classifier', connections },
      } as unknown as RepoToPackageResult;
    },
    install: async (artifactPath) => {
      run.installs.push(artifactPath);
      return overrides.install
        ? overrides.install(artifactPath)
        : { packageId: 'local.sample', version: '1.0.0', connections: [{ key: 'extension', status: 'off' }] };
    },
    discardArtifact: async (artifactPath) => {
      run.discarded.push(artifactPath);
    },
  };
  return run;
};
