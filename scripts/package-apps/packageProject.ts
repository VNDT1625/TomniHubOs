/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, sign } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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
const ADAPTER_DIRECTORY = 'adapter';
const MAX_FILES = 4_096;
const MAX_PAYLOAD_BYTES = 200 * 1024 * 1024;
const INLINE_SCRIPT_MARKER = /<!--\s*tomni:inline\s+([A-Za-z0-9._/-]+)\s*-->/gu;

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

const assertSafeArchivePath = (value: string): string => {
  const normalized = value.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Package file has an unsafe archive path: ${value}`);
  }
  return normalized;
};

const isMissingDirectory = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

const collectDirectory = async (directory: string, archivePrefix: string): Promise<PayloadFile[]> => {
  try {
    const metadata = await stat(directory);
    if (!metadata.isDirectory()) throw new Error(`Package root is not a directory: ${directory}`);
  } catch (error) {
    if (isMissingDirectory(error)) return [];
    throw error;
  }

  const files: PayloadFile[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      const entryStat = await lstat(absolutePath);
      if (entryStat.isSymbolicLink()) throw new Error(`Package files cannot contain symlinks: ${entry.name}`);
      if (entryStat.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entryStat.isFile()) throw new Error(`Unsupported package file: ${entry.name}`);
      const relativePath = assertSafeArchivePath(
        path.posix.join(archivePrefix, path.relative(directory, absolutePath).replaceAll(path.sep, '/'))
      );
      if (relativePath === MANIFEST_FILE) throw new Error(`${MANIFEST_FILE} is reserved for the signed manifest.`);
      files.push({ relativePath, content: await readFile(absolutePath) });
    }
  };
  await visit(directory);
  return files;
};

const collectPackageFiles = async (projectRoot: string): Promise<PayloadFile[]> => {
  const [payload, adapter] = await Promise.all([
    collectDirectory(path.join(projectRoot, PAYLOAD_DIRECTORY), ''),
    collectDirectory(path.join(projectRoot, ADAPTER_DIRECTORY), ADAPTER_DIRECTORY),
  ]);
  const files = [...payload, ...adapter].toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (files.length > MAX_FILES) throw new Error(`Package files exceed ${MAX_FILES} entries.`);
  const paths = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    if (paths.has(file.relativePath)) throw new Error(`Package contains duplicate file: ${file.relativePath}`);
    paths.add(file.relativePath);
    bytes += file.content.byteLength;
    if (bytes > MAX_PAYLOAD_BYTES) throw new Error('Package files exceed 200 MB.');
  }
  return files;
};

/**
 * Sandboxed package hosts remove script[src], so reviewed package scripts can opt
 * into deterministic build-time inlining. The marker refers only to another
 * signed package file; no URL or filesystem path can be resolved at runtime.
 */
const inlineMarkedScripts = (files: readonly PayloadFile[]): PayloadFile[] => {
  const byPath = new Map(files.map((file) => [file.relativePath, file]));
  return files.map((file) => {
    if (!file.relativePath.endsWith('.html')) return file;
    const source = file.content.toString('utf8');
    if (!source.includes('tomni:inline')) return file;
    const content = source.replace(INLINE_SCRIPT_MARKER, (_marker, rawPath: string) => {
      const pathValue = assertSafeArchivePath(rawPath);
      const script = byPath.get(pathValue);
      if (!script || !script.relativePath.endsWith('.js')) {
        throw new Error(`Inline script marker references a missing JavaScript package file: ${pathValue}`);
      }
      const scriptText = script.content.toString('utf8');
      if (scriptText.includes('</script')) {
        throw new Error(`Inline script contains a closing script tag: ${pathValue}`);
      }
      return `<script>\n${scriptText}\n</script>`;
    });
    if (content.includes('tomni:inline')) throw new Error(`Package HTML has an invalid inline script marker: ${file.relativePath}`);
    return { ...file, content: Buffer.from(content, 'utf8') };
  });
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
  const manifestValue = JSON.parse(await readFile(path.join(projectRoot, MANIFEST_FILE), 'utf8')) as unknown;
  const parsedManifest = parsePackageManifest(manifestValue);
  const files = inlineMarkedScripts(await collectPackageFiles(projectRoot));
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
