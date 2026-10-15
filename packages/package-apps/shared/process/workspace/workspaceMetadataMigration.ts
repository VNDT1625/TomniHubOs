import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const CANONICAL_ROOT = '.tomni';
const LEGACY_ROOTS = ['.omni', '.tomny'] as const;
const KNOWN_AREAS = new Set(['specs', 'understand', 'wiki', 'inspect', 'quick-test', 'artifacts', 'logs']);
const MIGRATION_VERSION = 1;
const LOCK_RETRIES = 50;
const LOCK_RETRY_MS = 10;
const LOCK_STALE_MS = 30_000;

type LegacyRoot = (typeof LEGACY_ROOTS)[number];
type MigrationStatus = 'already_canonical' | 'migrated' | 'conflicted' | 'failed';
type MigrationDisposition = 'migrated' | 'duplicate' | 'conflict' | 'recovery';

type MigrationEntry = {
  source: string;
  target: string;
  sourceDigest: string;
  disposition: MigrationDisposition;
  conflictPath?: string;
};

type MigrationManifest = {
  version: number;
  completedAt: string;
  status: MigrationStatus;
  entries: MigrationEntry[];
  error?: string;
};

export type WorkspaceMetadataMigrationResult = {
  status: MigrationStatus;
  manifestPath: string;
  entries: MigrationEntry[];
  error?: string;
};

type SourceFile = {
  root: LegacyRoot;
  relativePath: string;
  absolutePath: string;
};

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const normalizeRelativePath = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\//, '');

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const digest = (content: Buffer): string => createHash('sha256').update(content).digest('hex');

const safeRemoveEmptyDirectories = async (root: string, directory: string): Promise<void> => {
  let current = directory;
  while (isWithin(root, current) && current !== root) {
    const entries = await fs.readdir(current).catch((): string[] => []);
    if (entries.length > 0) return;
    await fs.rmdir(current).catch((): undefined => undefined);
    current = path.dirname(current);
  }
};

const collectFiles = async (workspaceRoot: string, legacyRoot: LegacyRoot): Promise<SourceFile[]> => {
  const legacyPath = path.join(workspaceRoot, legacyRoot);
  const rootStat = await fs.lstat(legacyPath).catch((): undefined => undefined);
  if (!rootStat) return [];
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`WORKSPACE_METADATA_INVALID_ROOT:${legacyRoot}`);
  }

  const files: SourceFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(legacyPath, candidate));
      if (!relativePath || !isWithin(legacyPath, candidate)) throw new Error('WORKSPACE_METADATA_PATH_ESCAPE');
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) throw new Error(`WORKSPACE_METADATA_SYMLINK:${legacyRoot}/${relativePath}`);
      if (stat.isDirectory()) {
        await visit(candidate);
        continue;
      }
      if (!stat.isFile()) throw new Error(`WORKSPACE_METADATA_UNSUPPORTED_ENTRY:${legacyRoot}/${relativePath}`);
      files.push({ root: legacyRoot, relativePath, absolutePath: candidate });
    }
  };

  await visit(legacyPath);
  return files.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
};

const canonicalRelativePath = (source: SourceFile): string => {
  const [area, ...rest] = source.relativePath.split('/');
  if (area && KNOWN_AREAS.has(area)) return [area, ...rest].join('/');
  return ['legacy-root', source.root.slice(1), source.relativePath].join('/');
};

const atomicWrite = async (target: string, content: string | Buffer): Promise<void> => {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, content);
  await fs.rename(temporary, target);
};

const acquireMigrationLock = async (workspaceRoot: string): Promise<() => Promise<void>> => {
  const lockPath = path.join(workspaceRoot, CANONICAL_ROOT, 'migration', 'workspace-metadata-v1.lock');
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(
        path.join(lockPath, 'owner.json'),
        JSON.stringify({ pid: process.pid, startedAt: Date.now() })
      );
      return async (): Promise<void> => {
        await fs.rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const stat = await fs.stat(lockPath).catch((): undefined => undefined);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        const stalePath = `${lockPath}.stale.${process.pid}.${Date.now()}`;
        await fs.rename(lockPath, stalePath).catch((): undefined => undefined);
        await fs.rm(stalePath, { recursive: true, force: true });
        continue;
      }
      await delay(LOCK_RETRY_MS);
    }
  }
  throw new Error('WORKSPACE_METADATA_MIGRATION_LOCK_TIMEOUT');
};

const manifestPathFor = (workspaceRoot: string): string =>
  path.join(workspaceRoot, CANONICAL_ROOT, 'migration', 'metadata-v1.json');

const conflictTargetFor = (workspaceRoot: string, migrationId: string, source: SourceFile): string =>
  path.join(
    workspaceRoot,
    CANONICAL_ROOT,
    'migration',
    'conflicts',
    migrationId,
    source.root.slice(1),
    source.relativePath
  );

const stageTargetFor = (workspaceRoot: string, migrationId: string, source: SourceFile): string =>
  path.join(
    workspaceRoot,
    CANONICAL_ROOT,
    'migration',
    'staging',
    migrationId,
    source.root.slice(1),
    source.relativePath
  );

const writeManifest = async (workspaceRoot: string, manifest: MigrationManifest): Promise<void> => {
  await atomicWrite(manifestPathFor(workspaceRoot), `${JSON.stringify(manifest, null, 2)}\n`);
};

/**
 * Migrates workspace-owned metadata before a caller resolves an active metadata path.
 * Legacy content is never a fallback: it is copied, verified, recorded, then retired.
 */
export const ensureCanonicalWorkspaceMetadata = async (rootPath: string): Promise<WorkspaceMetadataMigrationResult> => {
  const workspaceRoot = path.resolve(rootPath);
  const manifestPath = manifestPathFor(workspaceRoot);
  let releaseLock: (() => Promise<void>) | undefined;
  const entries: MigrationEntry[] = [];

  try {
    releaseLock = await acquireMigrationLock(workspaceRoot);
    const sources = (
      await Promise.all(LEGACY_ROOTS.map((legacyRoot) => collectFiles(workspaceRoot, legacyRoot)))
    ).flat();
    if (sources.length === 0) {
      return { status: 'already_canonical', manifestPath, entries };
    }

    const migrationId = `${process.pid}-${Date.now()}`;
    let conflicted = false;
    const selectedLegacy = new Map<string, Buffer>();

    for (const source of sources) {
      const targetRelativePath = canonicalRelativePath(source);
      const target = path.join(workspaceRoot, CANONICAL_ROOT, targetRelativePath);
      if (!isWithin(path.join(workspaceRoot, CANONICAL_ROOT), target))
        throw new Error('WORKSPACE_METADATA_TARGET_ESCAPE');
      const sourceContent = await fs.readFile(source.absolutePath);
      const sourceDigest = digest(sourceContent);
      const canonicalContent = await fs.readFile(target).catch((): undefined => undefined);
      const prior = selectedLegacy.get(targetRelativePath);

      if (canonicalContent) {
        if (digest(canonicalContent) === sourceDigest) {
          entries.push({
            source: `${source.root}/${source.relativePath}`,
            target: `.tomni/${targetRelativePath}`,
            sourceDigest,
            disposition: 'duplicate',
          });
          continue;
        }
        const conflictPath = conflictTargetFor(workspaceRoot, migrationId, source);
        await atomicWrite(conflictPath, sourceContent);
        entries.push({
          source: `${source.root}/${source.relativePath}`,
          target: `.tomni/${targetRelativePath}`,
          sourceDigest,
          disposition: 'conflict',
          conflictPath: normalizeRelativePath(path.relative(workspaceRoot, conflictPath)),
        });
        conflicted = true;
        continue;
      }

      if (prior) {
        if (digest(prior) !== sourceDigest) {
          const conflictPath = conflictTargetFor(workspaceRoot, migrationId, source);
          await atomicWrite(conflictPath, sourceContent);
          entries.push({
            source: `${source.root}/${source.relativePath}`,
            target: `.tomni/${targetRelativePath}`,
            sourceDigest,
            disposition: 'conflict',
            conflictPath: normalizeRelativePath(path.relative(workspaceRoot, conflictPath)),
          });
          conflicted = true;
          continue;
        }
        entries.push({
          source: `${source.root}/${source.relativePath}`,
          target: `.tomni/${targetRelativePath}`,
          sourceDigest,
          disposition: 'duplicate',
        });
        continue;
      }

      selectedLegacy.set(targetRelativePath, sourceContent);
      const staged = stageTargetFor(workspaceRoot, migrationId, source);
      await atomicWrite(staged, sourceContent);
      const stagedContent = await fs.readFile(staged);
      if (digest(stagedContent) !== sourceDigest) throw new Error('WORKSPACE_METADATA_STAGE_HASH_MISMATCH');
      await atomicWrite(target, stagedContent);
      const targetContent = await fs.readFile(target);
      if (digest(targetContent) !== sourceDigest) throw new Error('WORKSPACE_METADATA_TARGET_HASH_MISMATCH');
      entries.push({
        source: `${source.root}/${source.relativePath}`,
        target: `.tomni/${targetRelativePath}`,
        sourceDigest,
        disposition: targetRelativePath.startsWith('legacy-root/') ? 'recovery' : 'migrated',
      });
    }

    const status: MigrationStatus = conflicted ? 'conflicted' : 'migrated';
    await writeManifest(workspaceRoot, {
      version: MIGRATION_VERSION,
      completedAt: new Date().toISOString(),
      status,
      entries,
    });
    for (const source of sources) {
      await fs.rm(source.absolutePath);
      await safeRemoveEmptyDirectories(workspaceRoot, path.dirname(source.absolutePath));
    }
    return { status, manifestPath, entries };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WORKSPACE_METADATA_MIGRATION_FAILED';
    await writeManifest(workspaceRoot, {
      version: MIGRATION_VERSION,
      completedAt: new Date().toISOString(),
      status: 'failed',
      entries,
      error: message,
    }).catch((): undefined => undefined);
    return { status: 'failed', manifestPath, entries, error: message };
  } finally {
    await releaseLock?.();
  }
};
