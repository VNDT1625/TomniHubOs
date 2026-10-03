/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CoreAdapterDefinition, DetectedCoreTarget, ExecutableResolver } from './adapters';
import { AdapterCatalogStore, createEd25519CatalogVerifier } from './catalog';

const execFileAsync = promisify(execFile);

const tomnyBinaryName = (): string => (process.platform === 'win32' ? 'tomny.exe' : 'tomny');

export const bundledTomnyCliCandidates = (): string[] => {
  const runtimeKey = `${process.platform}-${process.arch}`;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return [
    ...(resourcesPath ? [path.join(resourcesPath, 'bundled-tomny-cli', runtimeKey, tomnyBinaryName())] : []),
    path.resolve(process.cwd(), 'resources', 'bundled-tomny-cli', runtimeKey, tomnyBinaryName()),
    'tomny',
  ];
};

/**
 * Direct adapters owned by the TypeScript core. Adding a CLI is data-driven:
 * detection metadata is separate from the protocol implementation.
 */
export const CORE_ADAPTER_DEFINITIONS: CoreAdapterDefinition[] = [
  {
    id: 'tomny',
    name: 'Tomny CLI',
    protocol: 'tomny-json-stream',
    candidates: bundledTomnyCliCandidates(),
    args: ['--json-stream'],
    detail: 'Built-in Tomny agent (direct JSONL stdio)',
    runnable: true,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    protocol: 'codex-app-server',
    candidates: ['codex'],
    args: ['app-server'],
    detail: 'OpenAI app-server (JSONL stdio)',
    runnable: true,
  },
  {
    id: 'claude',
    name: 'Claude Code',
    protocol: 'acp',
    candidates: ['claude-agent-acp'],
    args: [],
    detail: 'Claude Agent ACP',
    runnable: true,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    protocol: 'acp',
    candidates: ['opencode'],
    args: ['acp'],
    detail: 'OpenCode ACP',
    runnable: true,
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    protocol: 'acp',
    candidates: ['agent', 'cursor-agent'],
    args: ['acp'],
    detail: 'Cursor Agent ACP',
    runnable: true,
  },
  {
    id: 'hermes',
    name: 'Hermes Agent',
    protocol: 'acp',
    candidates: ['hermes'],
    args: ['acp'],
    detail: 'Hermes ACP',
    runnable: true,
  },
  {
    id: 'kiro',
    name: 'Kiro CLI',
    protocol: 'acp',
    candidates: ['kiro-cli', 'kiro'],
    args: ['acp'],
    detail: 'Kiro ACP (capability verified at handshake)',
    runnable: true,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    protocol: 'acp',
    candidates: process.platform === 'win32' ? ['agi.exe', 'agi'] : ['agi'],
    args: ['acp'],
    detail: 'Antigravity ACP',
    runnable: true,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    protocol: 'acp',
    candidates: ['gemini'],
    args: ['--experimental-acp'],
    detail: 'Gemini CLI ACP',
    runnable: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek TUI',
    protocol: 'acp',
    candidates: ['deepseek-tui'],
    args: ['serve', '--acp'],
    detail: 'DeepSeek TUI ACP',
    runnable: true,
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    protocol: 'acp',
    candidates: ['openclaw'],
    args: ['acp'],
    detail: 'OpenClaw ACP bridge backed by its configured Gateway',
    runnable: true,
  },
];

const isAdapterDefinition = (value: unknown): value is CoreAdapterDefinition => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CoreAdapterDefinition>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    ['tomny-json-stream', 'codex-app-server', 'acp', 'openclaw-gateway', 'tomny-remote-v1'].includes(
      candidate.protocol ?? ''
    ) &&
    Array.isArray(candidate.candidates) &&
    candidate.candidates.every((item) => typeof item === 'string') &&
    Array.isArray(candidate.args) &&
    candidate.args.every((item) => typeof item === 'string') &&
    typeof candidate.detail === 'string' &&
    typeof candidate.runnable === 'boolean'
  );
};

/**
 * Load an optional versioned adapter catalog. Existing IDs are replaced and new
 * adapters are appended, allowing CLI command changes without rebuilding Tomny Core.
 */
export const loadCoreAdapterDefinitions = async (
  catalogPath = process.env.TOMNY_CORE_ADAPTER_CATALOG,
  publicKey = process.env.TOMNY_CORE_ADAPTER_CATALOG_PUBLIC_KEY
): Promise<CoreAdapterDefinition[]> => {
  if (!catalogPath) return CORE_ADAPTER_DEFINITIONS;
  if (!publicKey?.trim()) {
    throw new Error('TOMNY_CORE_ADAPTER_CATALOG_PUBLIC_KEY is required for an external adapter catalog.');
  }
  const catalog = await new AdapterCatalogStore(catalogPath).load({
    coreVersion: process.env.TOMNY_CORE_VERSION,
    requireSignature: true,
    verifySignature: createEd25519CatalogVerifier(publicKey),
  });
  const catalogDefinitions = catalog?.definitions;
  if (!Array.isArray(catalogDefinitions) || !catalogDefinitions.every(isAdapterDefinition)) {
    throw new Error(`Invalid or unsigned Tomny Core adapter catalog: ${catalogPath}`);
  }
  const definitions = new Map(CORE_ADAPTER_DEFINITIONS.map((definition) => [definition.id, definition]));
  for (const definition of catalogDefinitions) definitions.set(definition.id, definition);
  return [...definitions.values()];
};

export type Sha256File = (filePath: string) => Promise<string>;

const sha256FileWithNode: Sha256File = async (filePath) =>
  createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');

const verifyTomnyArtifact = async (
  binaryPath: string,
  manifestPath: string,
  sha256File: Sha256File
): Promise<boolean> => {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { binarySha256?: unknown };
    if (typeof manifest.binarySha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(manifest.binarySha256)) return false;
    return (await sha256File(binaryPath)) === manifest.binarySha256;
  } catch {
    return false;
  }
};

const pendingTomnyBinaryPath = (binaryPath: string): string => {
  const extension = path.extname(binaryPath);
  return extension ? `${binaryPath.slice(0, -extension.length)}.next${extension}` : `${binaryPath}.next`;
};

/** Promote a separately verified staged CLI before target detection can reject the old artifact. */
const promotePendingBundledTomnyCli = async (binaryPath: string, sha256File: Sha256File): Promise<void> => {
  const directory = path.dirname(binaryPath);
  const pendingBinary = pendingTomnyBinaryPath(binaryPath);
  const pendingManifest = path.join(directory, 'manifest.next.json');
  if (!(await verifyTomnyArtifact(pendingBinary, pendingManifest, sha256File))) return;

  try {
    await copyFile(pendingBinary, binaryPath);
    await copyFile(pendingManifest, path.join(directory, 'manifest.json'));
    if (!(await verifyTomnyArtifact(binaryPath, path.join(directory, 'manifest.json'), sha256File))) return;
    await Promise.allSettled([unlink(pendingBinary), unlink(pendingManifest)]);
  } catch (error) {
    // A still-running CLI may lock the executable on Windows. Detection retries on the next app start.
    console.warn('[TomnyCore] Pending CLI promotion deferred:', error);
  }
};

const verifyBundledTomnyCli = async (
  binaryPath: string,
  sha256File: Sha256File = sha256FileWithNode
): Promise<boolean> => {
  if (!binaryPath.split(path.sep).includes('bundled-tomny-cli')) return true;
  await promotePendingBundledTomnyCli(binaryPath, sha256File);
  return verifyTomnyArtifact(binaryPath, path.join(path.dirname(binaryPath), 'manifest.json'), sha256File);
};

type CandidateResolution = {
  path: string | null;
  expiresAt: number;
};

const candidateCache = new Map<string, CandidateResolution>();
const CANDIDATE_CACHE_TTL_MS = 60_000;

export const clearExecutableResolutionCache = (): void => {
  candidateCache.clear();
};

/** Resolve the first executable without invoking tomnycore or its HTTP detector. */
export const resolveExecutableOnPath = async (
  candidates: string[],
  sha256File: Sha256File = sha256FileWithNode
): Promise<string | null> => {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  const now = Date.now();
  const resolved = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        if (path.isAbsolute(candidate)) {
          await access(candidate);
          return (await verifyBundledTomnyCli(candidate, sha256File)) ? candidate : null;
        }
        const cached = candidateCache.get(candidate);
        if (cached && cached.expiresAt > now) {
          return cached.path;
        }
        const { stdout } = await execFileAsync(probe, [candidate], { windowsHide: true, timeout: 800 });
        const paths = stdout
          .split(/\r?\n/u)
          .map((value) => value.trim())
          .filter(Boolean);
        const resolvedPath =
          paths.find((value) => /\.cmd$/iu.test(value)) ??
          paths.find((value) => /\.exe$/iu.test(value) && !value.includes('WindowsApps')) ??
          paths.find((value) => /\.exe$/iu.test(value)) ??
          paths.find((value) => !/\.ps1$/iu.test(value)) ??
          null;
        candidateCache.set(candidate, { path: resolvedPath, expiresAt: now + CANDIDATE_CACHE_TTL_MS });
        return resolvedPath;
      } catch {
        candidateCache.set(candidate, { path: null, expiresAt: now + CANDIDATE_CACHE_TTL_MS });
        return null;
      }
    })
  );
  return resolved.find((value): value is string => value !== null) ?? null;
};

export const detectCoreTargets = async (
  resolveExecutable: ExecutableResolver = resolveExecutableOnPath,
  definitions?: CoreAdapterDefinition[]
): Promise<DetectedCoreTarget[]> =>
  Promise.all(
    (definitions ?? (await loadCoreAdapterDefinitions())).map(async (definition) => {
      const command = await resolveExecutable(definition.candidates);
      return Object.assign({}, definition, {
        command: command ?? undefined,
        detected: command !== null,
        available: command !== null && definition.runnable,
        detail: definition.detail,
      });
    })
  );
