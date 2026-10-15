/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/* oxlint-disable no-await-in-loop -- artifact validation and hashing are deliberately ordered for deterministic integrity and bounded I/O. */

import { createHash, createPublicKey, verify } from 'node:crypto';
import { copyFile, lstat, mkdir, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { packageSignaturePayload, parsePackageManifest, type PackageManifest } from '../../../common/packages';

export const PACKAGE_MANIFEST_FILE = 'tomny-package.json';
const MAX_ARTIFACT_FILES = 20_000;
const MAX_PACKAGE_MANIFEST_BYTES = 256 * 1024;

/**
 * Setup output rule, version 1. The setup of a source-backed MCP server (for example `npm install`) writes its
 * dependencies to `source/node_modules`. That directory is never part of the signed artifact. An archive that
 * contains it is refused at install, and a sealed installed payload is hashed without it (`setupOutputs: 'exclude'`).
 * Every other file of the payload is still hashed exactly. The runtime never executes from the sealed payload: a
 * source-backed server runs from a copy under the app data folder (see `mcpSourceRuntime`), so setup and runtime
 * self-healing cannot change the signed files. Bump the version when this rule changes.
 */
export const SETUP_OUTPUT_RULE_VERSION = 1;
export const SETUP_OUTPUT_DIRECTORY = 'source/node_modules';

/** How a package folder treats setup output while it is hashed. */
export type SetupOutputMode = 'include' | 'exclude' | 'reject';

/** True for the setup output directory itself or anything below it (a relative path with `/` separators). */
export const isSetupOutputPath = (relativePath: string): boolean =>
  relativePath === SETUP_OUTPUT_DIRECTORY || relativePath.startsWith(`${SETUP_OUTPUT_DIRECTORY}/`);

type ArtifactFile = {
  absolutePath: string;
  relativePath: string;
  size: number;
};

type ArtifactContentOverride = {
  relativePath: string;
  content: string;
};

export type ArtifactIntegrityOptions = Readonly<{
  /** Default `include`: every file is hashed, which is what an archive and its manifest are checked with. */
  setupOutputs?: SetupOutputMode;
}>;

const isInside = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const scanArtifact = async (
  sourceDirectory: string,
  setupOutputs: SetupOutputMode = 'include'
): Promise<{ root: string; files: ArtifactFile[] }> => {
  if (!path.isAbsolute(sourceDirectory)) throw new Error('Package source directory must be absolute.');
  const root = await realpath(sourceDirectory);
  const files: ArtifactFile[] = [];

  const visit = async (directory: string): Promise<void> => {
    if (!isInside(root, directory)) throw new Error('Package entry escapes its source directory.');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`Package artifacts cannot contain symbolic links: ${entry.name}`);
      if (!isInside(root, absolutePath)) throw new Error('Package entry escapes its source directory.');
      const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/');
      if (stat.isDirectory()) {
        if (relativePath === SETUP_OUTPUT_DIRECTORY) {
          // Setup output: refused in an archive, skipped (not walked) in a sealed payload.
          if (setupOutputs === 'reject')
            throw new Error(`Package artifacts cannot contain setup output: ${SETUP_OUTPUT_DIRECTORY}`);
          if (setupOutputs === 'exclude') continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Unsupported package entry: ${entry.name}`);
      if (relativePath === PACKAGE_MANIFEST_FILE) continue;
      files.push({ absolutePath, relativePath, size: stat.size });
      if (files.length > MAX_ARTIFACT_FILES) throw new Error(`Package exceeds ${MAX_ARTIFACT_FILES} files.`);
    }
  };

  await visit(root);
  files.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  );
  return { root, files };
};

export const computeArtifactIntegrity = async (
  sourceDirectory: string,
  contentOverride?: ArtifactContentOverride,
  options: ArtifactIntegrityOptions = {}
): Promise<{ integrity: string; sizeBytes: number }> => {
  const mode = options.setupOutputs ?? 'include';
  // A file under setup output is never hashed, so it can never be served as verified content.
  if (contentOverride !== undefined && mode !== 'include' && isSetupOutputPath(contentOverride.relativePath)) {
    throw new Error('Package setup output is not part of the verified payload.');
  }
  const { files } = await scanArtifact(sourceDirectory, mode);
  const hash = createHash('sha256');
  let sizeBytes = 0;

  for (const file of files) {
    hash.update(file.relativePath);
    hash.update('\0');
    const overriddenContent = contentOverride?.relativePath === file.relativePath ? contentOverride.content : undefined;
    if (overriddenContent !== undefined) hash.update(overriddenContent, 'utf8');
    else for await (const chunk of createReadStream(file.absolutePath)) hash.update(chunk);
    hash.update('\0');
    sizeBytes += overriddenContent === undefined ? file.size : Buffer.byteLength(overriddenContent, 'utf8');
  }

  return { integrity: `sha256-${hash.digest('hex')}`, sizeBytes };
};

export const readArtifactManifest = async (sourceDirectory: string): Promise<PackageManifest> => {
  const manifestPath = path.join(await realpath(sourceDirectory), PACKAGE_MANIFEST_FILE);
  const stat = await lstat(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Package manifest must be a regular file.');
  if (stat.size > MAX_PACKAGE_MANIFEST_BYTES) throw new Error('Package manifest exceeds the size limit.');
  const content = await import('node:fs/promises').then(({ readFile }) => readFile(manifestPath, 'utf8'));
  return parsePackageManifest(JSON.parse(content) as unknown);
};

export const packageArtifactManifestsMatch = (expected: PackageManifest, received: PackageManifest): boolean =>
  packageSignaturePayload(expected) === packageSignaturePayload(received) &&
  expected.artifact?.signature.value === received.artifact?.signature.value;

export const verifyArtifactSignature = (
  manifest: PackageManifest,
  trustedKeys: Readonly<Record<string, string>>
): void => {
  const artifact = manifest.artifact;
  if (!artifact) throw new Error(`Signed package ${manifest.id} does not declare an artifact.`);
  const key = trustedKeys[artifact.signature.keyId];
  if (!key) throw new Error(`Package signing key is not trusted: ${artifact.signature.keyId}`);
  const encodedSignature = artifact.signature.value;
  if (!/^[A-Za-z0-9+/]{86}==$/.test(encodedSignature)) {
    throw new Error('Package signature is not valid Ed25519 base64.');
  }
  const signature = Buffer.from(encodedSignature, 'base64');
  if (signature.byteLength !== 64) throw new Error('Package signature must contain exactly 64 bytes.');
  const valid = verify(null, Buffer.from(packageSignaturePayload(manifest)), createPublicKey(key), signature);
  if (!valid) throw new Error(`Package signature verification failed for ${manifest.id}.`);
};

export const copyArtifactSecurely = async (sourceDirectory: string, targetDirectory: string): Promise<void> => {
  const { root, files } = await scanArtifact(sourceDirectory);
  await mkdir(targetDirectory, { recursive: true });

  for (const file of files) {
    const target = path.resolve(targetDirectory, file.relativePath);
    if (!isInside(path.resolve(targetDirectory), target))
      throw new Error('Package target path escapes the staging directory.');
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file.absolutePath, target);
  }

  const sourceManifest = path.join(root, PACKAGE_MANIFEST_FILE);
  const targetManifest = path.join(targetDirectory, PACKAGE_MANIFEST_FILE);
  await copyFile(sourceManifest, targetManifest);
};

export const isPathInside = isInside;
