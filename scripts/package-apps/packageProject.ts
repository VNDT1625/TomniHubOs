/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, sign } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import {
  packageSignaturePayload,
  parsePackageManifest,
  type PackageManifest,
} from '../../packages/desktop/src/common/packages/index.js';

import { loadExplicitPackageSigningKey } from './signing.js';

const MANIFEST_FILE = 'tomny-package.json';
const PAYLOAD_DIRECTORY = 'payload';
const MAX_FILES = 4_096;
const MAX_PAYLOAD_BYTES = 200 * 1024 * 1024;

export type PackageBuildOptions = {
  projectDirectory: string;
  outputDirectory: string;
  privateKeyPath: string;
  keyId: string;
};

export type PackageBuildResult = {
  artifactPath: string;
  manifest: PackageManifest;
  archiveBytes: number;
};

type PayloadFile = {
  relativePath: string;
  content: Buffer;
};

const collectPayload = async (payloadRoot: string): Promise<PayloadFile[]> => {
  const files: PayloadFile[] = [];
  let payloadBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const entryStat = await lstat(absolutePath);
      if (entryStat.isSymbolicLink()) throw new Error(`Package payload cannot contain symlinks: ${entry.name}`);
      if (entryStat.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entryStat.isFile()) throw new Error(`Unsupported package payload entry: ${entry.name}`);
      const relativePath = path.relative(payloadRoot, absolutePath).replaceAll(path.sep, '/');
      if (relativePath === MANIFEST_FILE) throw new Error(`${MANIFEST_FILE} is reserved for the signed manifest.`);
      payloadBytes += entryStat.size;
      if (payloadBytes > MAX_PAYLOAD_BYTES) throw new Error('Package payload exceeds 200 MB.');
      files.push({ relativePath, content: await readFile(absolutePath) });
      if (files.length > MAX_FILES) throw new Error(`Package payload exceeds ${MAX_FILES} files.`);
    }
  };
  await visit(payloadRoot);
  return files.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
};

const integrityFor = (files: readonly PayloadFile[]): { integrity: string; sizeBytes: number } => {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
    sizeBytes += file.content.byteLength;
  }
  return { integrity: `sha256-${hash.digest('hex')}`, sizeBytes };
};

const ensureEntrypointsExist = (manifest: PackageManifest, files: readonly PayloadFile[]): void => {
  const paths = new Set(files.map((file) => file.relativePath));
  for (const module of manifest.modules) {
    if (module.entrypoint && !paths.has(module.entrypoint)) {
      throw new Error(`Package module ${module.id} entrypoint is missing: ${module.entrypoint}`);
    }
    if (module.styleEntrypoint && !paths.has(module.styleEntrypoint)) {
      throw new Error(`Package module ${module.id} style entrypoint is missing: ${module.styleEntrypoint}`);
    }
    if (module.runtime === 'trusted-react' && manifest.publisherId !== 'com.tomni') {
      throw new Error('Only first-party com.tomni packages may use the trusted-react runtime.');
    }
  }
};

export const buildPackageProject = async ({
  projectDirectory,
  outputDirectory,
  privateKeyPath,
  keyId,
}: PackageBuildOptions): Promise<PackageBuildResult> => {
  const projectRoot = path.resolve(projectDirectory);
  const payloadRoot = path.join(projectRoot, PAYLOAD_DIRECTORY);
  const manifestValue = JSON.parse(await readFile(path.join(projectRoot, MANIFEST_FILE), 'utf8')) as unknown;
  const parsedManifest = parsePackageManifest(manifestValue);
  const files = await collectPayload(payloadRoot);
  ensureEntrypointsExist(parsedManifest, files);

  const unsignedManifest: PackageManifest = {
    ...parsedManifest,
    artifact: {
      ...integrityFor(files),
      signature: { algorithm: 'ed25519', keyId, value: '' },
    },
  };
  const signingKey = await loadExplicitPackageSigningKey(privateKeyPath, keyId);
  const signature = sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), signingKey.privateKey).toString(
    'base64'
  );
  const manifest: PackageManifest = {
    ...unsignedManifest,
    artifact: {
      ...unsignedManifest.artifact!,
      signature: { ...unsignedManifest.artifact!.signature, value: signature },
    },
  };

  const archive = new JSZip();
  archive.file(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of files) archive.file(file.relativePath, file.content);
  const bytes = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
  });
  await mkdir(path.resolve(outputDirectory), { recursive: true });
  const artifactPath = path.join(path.resolve(outputDirectory), `${manifest.id}-${manifest.version}.tomny`);
  const temporaryArtifactPath = `${artifactPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryArtifactPath, bytes, { mode: 0o600 });
    await rename(temporaryArtifactPath, artifactPath);
  } finally {
    await rm(temporaryArtifactPath, { force: true });
  }
  return { artifactPath, manifest, archiveBytes: bytes.byteLength };
};
