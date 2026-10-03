/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import {
  classifyRepository,
  packageSignaturePayload,
  parsePackageManifest,
  type PackageManifest,
  type RepoClassificationResult,
} from '../../../common/packages';

const execFileAsync = promisify(execFile);

import { PACKAGE_MANIFEST_FILE } from './artifactSecurity';
const MAX_PAYLOAD_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 10_000;

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.github',
  '.vscode',
  '.idea',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.tmp',
  'coverage',
]);

const IGNORED_FILE_NAMES = new Set([
  '.ds_store',
  'thumbs.db',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
]);

export type RepoToPackageOptions = {
  /** Local directory path or remote Git URL (https://github.com/... or git@...) */
  source: string;
  /** Output directory for the .tomny bundle (defaults to tmp or store-artifacts) */
  outputDirectory?: string;
  /** Custom package identifier override */
  packageId?: string;
  /** Custom package display name override */
  name?: string;
  /** Custom publisher identifier (defaults to 'com.community') */
  publisherId?: string;
  /** Custom semantic version (defaults to version in package.json or '1.0.0') */
  version?: string;
  /** Private Ed25519 signing key PEM (if omitted, a new development keypair is generated) */
  privateKeyPem?: string;
  /** Key ID for signing (defaults to 'dev-repo-packager-key') */
  keyId?: string;
};

export type RepoToPackageResult = {
  readonly artifactPath: string;
  readonly manifest: PackageManifest;
  readonly classification: RepoClassificationResult;
  readonly archiveBytes: number;
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly privateKeyPem: string;
};

type DiscoveredFile = {
  relativePath: string;
  absolutePath: string;
  size: number;
};

const isGitUrl = (source: string): boolean =>
  source.startsWith('http://') || source.startsWith('https://') || source.startsWith('git@') || source.endsWith('.git');

const collectRepoFiles = async (rootDirectory: string): Promise<DiscoveredFile[]> => {
  const discovered: DiscoveredFile[] = [];

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const name = entry.name;
      if (IGNORED_DIRECTORY_NAMES.has(name.toLowerCase()) || IGNORED_FILE_NAMES.has(name.toLowerCase())) {
        continue;
      }
      const absolutePath = path.join(directory, name);
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) continue;

      if (stat.isDirectory()) {
        await visit(absolutePath);
      } else if (stat.isFile()) {
        const relativePath = path.relative(rootDirectory, absolutePath).replaceAll(path.sep, '/');
        if (relativePath === PACKAGE_MANIFEST_FILE) continue;
        discovered.push({ relativePath, absolutePath, size: stat.size });
        if (discovered.length > MAX_FILES) {
          throw new Error(`Repository exceeds maximum supported file count of ${MAX_FILES}.`);
        }
      }
    }
  };

  await visit(rootDirectory);
  discovered.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return discovered;
};

const computePayloadIntegrity = (
  files: Array<{ relativePath: string; content: Buffer }>
): { integrity: string; sizeBytes: number } => {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for (const file of files.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
    sizeBytes += file.content.byteLength;
  }
  return { integrity: `sha256-${hash.digest('hex')}`, sizeBytes };
};

/**
 * Builds a signed .tomny package bundle from any local folder or Git repository URL.
 * Automatically runs heuristic scanning, classifies into the proper archetype, derives
 * Least-Privilege permissions, and packages a compliant .tomny archive.
 */
export const buildTomnyPackageFromRepo = async (options: RepoToPackageOptions): Promise<RepoToPackageResult> => {
  let workingRoot = path.resolve(options.source);
  let isTempDir = false;

  // Handle Remote Git URLs by cloning to temporary directory
  if (isGitUrl(options.source)) {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'tomni-repo-packager-'));
    workingRoot = tempDir;
    isTempDir = true;
    try {
      await execFileAsync('git', ['clone', '--depth', '1', options.source, tempDir], {
        timeout: 60_000,
      });
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true }).catch((): undefined => undefined);
      throw new Error(
        `Failed to clone git repository ${options.source}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  try {
    const discovered = await collectRepoFiles(workingRoot);
    const relativePaths = discovered.map((f) => f.relativePath);

    // Read package.json if available
    let packageJsonContent: string | undefined;
    const packageJsonFile = discovered.find((f) => f.relativePath === 'package.json');
    if (packageJsonFile) {
      try {
        packageJsonContent = await readFile(packageJsonFile.absolutePath, 'utf8');
      } catch {
        packageJsonContent = undefined;
      }
    }

    // Read snippets of key configuration files
    const fileSnippets: Record<string, string> = {};
    const keyFilePatterns = ['mcp.json', 'workflow.json', 'index.html', 'main.ts', 'index.ts', 'server.ts', 'app.ts'];
    for (const pattern of keyFilePatterns) {
      const match = discovered.find((f) => f.relativePath.toLowerCase().endsWith(pattern));
      if (match && match.size < 100 * 1024) {
        try {
          fileSnippets[match.relativePath] = await readFile(match.absolutePath, 'utf8');
        } catch {
          // ignore read errors for snippets
        }
      }
    }

    const repoDirName = path.basename(workingRoot);
    const classification = classifyRepository({
      files: relativePaths,
      packageJson: packageJsonContent,
      repositoryName: options.name ?? repoDirName,
      publisherId: options.publisherId,
      fileSnippets,
    });

    if (!classification.isSupported) {
      throw new Error(`Cannot package repository: Classified as ${classification.archetype} which is unsupported.`);
    }

    // Read file contents for payload
    const payloadFiles: Array<{ relativePath: string; content: Buffer }> = [];
    let totalBytes = 0;

    for (const item of discovered) {
      const content = await readFile(item.absolutePath);
      totalBytes += content.byteLength;
      if (totalBytes > MAX_PAYLOAD_BYTES) {
        throw new Error(`Repository payload exceeds maximum size limit of 200 MB.`);
      }
      payloadFiles.push({ relativePath: item.relativePath, content });
    }

    // Apply any explicit user overrides to manifest
    const manifest: PackageManifest = {
      ...classification.manifest,
      ...(options.packageId ? { id: options.packageId } : {}),
      ...(options.name ? { name: options.name } : {}),
      ...(options.version ? { version: options.version } : {}),
    };

    // Ensure there is an index.html if any module requires it
    const requiresHtml = manifest.modules.some((m) => m.runtime === 'sandboxed-web' && m.entrypoint?.endsWith('.html'));
    if (requiresHtml && !payloadFiles.some((f) => f.relativePath === 'index.html')) {
      const fallbackHtml = Buffer.from(
        `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${manifest.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2rem; color: #333; }
    h1 { color: #165dff; }
    pre { background: #f2f3f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>${manifest.name}</h1>
  <p>${manifest.description}</p>
  <p><strong>Archetype:</strong> ${classification.archetype}</p>
  <h3>Files in package:</h3>
  <pre>${payloadFiles.map((f) => f.relativePath).join('\n')}</pre>
</body>
</html>\n`,
        'utf8'
      );
      payloadFiles.push({ relativePath: 'index.html', content: fallbackHtml });
    }

    // Calculate SHA-256 integrity of all payload files
    const { integrity, sizeBytes } = computePayloadIntegrity(payloadFiles);

    // Setup signing keys
    let privateKeyPem = options.privateKeyPem;
    let publicKeyPem = '';
    const keyId = options.keyId ?? 'dev-repo-packager-key';

    if (!privateKeyPem) {
      const keypair = generateKeyPairSync('ed25519');
      privateKeyPem = keypair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      publicKeyPem = keypair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    }

    const unsignedManifest: PackageManifest = {
      ...manifest,
      artifact: {
        integrity,
        sizeBytes,
        signature: { algorithm: 'ed25519', keyId, value: '' },
      },
    };

    const signature = sign(null, Buffer.from(packageSignaturePayload(unsignedManifest)), privateKeyPem).toString(
      'base64'
    );

    const signedManifest: PackageManifest = {
      ...unsignedManifest,
      artifact: {
        ...unsignedManifest.artifact!,
        signature: { algorithm: 'ed25519', keyId, value: signature },
      },
    };

    // Validate the finalized manifest against the canonical schema
    const verifiedManifest = parsePackageManifest(signedManifest);

    // Build the .tomny ZIP archive using JSZip
    const archive = new JSZip();
    archive.file(PACKAGE_MANIFEST_FILE, `${JSON.stringify(verifiedManifest, null, 2)}\n`);

    for (const file of payloadFiles) {
      archive.file(file.relativePath, file.content);
    }

    const zipBuffer = await archive.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const outputDir = options.outputDirectory ?? path.join(workingRoot, '.store-output');
    await mkdir(outputDir, { recursive: true });

    const artifactFileName = `${verifiedManifest.id}-${verifiedManifest.version}.tomny`;
    const artifactPath = path.join(outputDir, artifactFileName);
    await writeFile(artifactPath, zipBuffer);

    return {
      artifactPath,
      manifest: verifiedManifest,
      classification,
      archiveBytes: zipBuffer.byteLength,
      keyId,
      publicKeyPem,
      privateKeyPem,
    };
  } finally {
    if (isTempDir) {
      await rm(workingRoot, { recursive: true, force: true }).catch((): undefined => undefined);
    }
  }
};
