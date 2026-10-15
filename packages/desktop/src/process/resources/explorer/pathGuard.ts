/* oxlint-disable no-await-in-loop -- each ancestor is validated before entering the next. */
import type { Stats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ExplorerErrorCode } from '@/common/types/platform/explorer';

export class ExplorerServiceError extends Error {
  receiptId?: string;
  affectedPaths?: string[];
  mayHaveCommitted?: boolean;
  suggestedName?: string;
  constructor(readonly code: ExplorerErrorCode) {
    super(code);
    this.name = 'ExplorerServiceError';
  }
}

export type ExplorerRoot = Readonly<{ path: string; dev: number; ino: number }>;
export type OperationGuard = Readonly<{
  deadline: number;
  signal?: AbortSignal;
  now: () => number;
  assertActive?: () => void;
}>;

export const checkOperation = (guard: OperationGuard): void => {
  guard.assertActive?.();
  if (guard.signal?.aborted) throw new ExplorerServiceError('CANCELLED');
  if (guard.now() > guard.deadline) throw new ExplorerServiceError('LIMIT_EXCEEDED');
};

const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const BAD_CHARACTER = /[<>:"|?*]/u;
const hasControlCharacter = (value: string): boolean => [...value].some((character) => character.charCodeAt(0) < 32);

/** Reject traversal, Windows device names and alternate streams on every host. */
export const parseRelativePath = (value: string, allowRoot = false): string => {
  if (typeof value !== 'string' || value.length > 2048) throw new ExplorerServiceError('DENIED');
  if (value === '' && allowRoot) return '';
  if (!value || path.isAbsolute(value) || path.win32.isAbsolute(value)) throw new ExplorerServiceError('DENIED');
  const parts = value.split(/[\\/]/);
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.length > 255 ||
        hasControlCharacter(part) ||
        BAD_CHARACTER.test(part) ||
        /[. ]$/.test(part) ||
        DEVICE_NAME.test(part)
    )
  ) {
    throw new ExplorerServiceError('DENIED');
  }
  return parts.join(path.sep);
};

export const canonicalRoot = async (input: string): Promise<ExplorerRoot> => {
  assertLocalRootPath(input);
  const resolved = path.resolve(input);
  let prefix = path.parse(resolved).root;
  for (const part of resolved.slice(prefix.length).split(path.sep).filter(Boolean)) {
    prefix = path.join(prefix, part);
    if ((await lstat(prefix)).isSymbolicLink()) throw new ExplorerServiceError('DENIED');
  }
  const rootPath = await realpath(input);
  assertLocalRootPath(rootPath);
  const info = await lstat(rootPath);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new ExplorerServiceError('DENIED');
  return { path: rootPath, dev: info.dev, ino: info.ino };
};

/** Explorer is a local filesystem capability; UNC paths may initiate network access. */
export const assertLocalRootPath = (value: string): void => {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !path.isAbsolute(value) ||
    value.startsWith('\\\\') ||
    value.startsWith('//') ||
    hasControlCharacter(value)
  )
    throw new ExplorerServiceError('DENIED');
};

export const checkRoot = async (root: ExplorerRoot): Promise<void> => {
  const current = await lstat(root.path);
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== root.dev ||
    current.ino !== root.ino ||
    (await realpath(root.path)) !== root.path
  ) {
    throw new ExplorerServiceError('DENIED');
  }
};

/** Main retains the root. Renderer paths are always relative and links are never followed. */
export const resolveExisting = async (
  root: ExplorerRoot,
  relativePath: string,
  allowRoot = false
): Promise<{ path: string; info: Stats }> => {
  const normalized = parseRelativePath(relativePath, allowRoot);
  await checkRoot(root);
  let target = root.path;
  let info = await lstat(target);
  for (const part of normalized ? normalized.split(path.sep) : []) {
    if (!info.isDirectory()) throw new ExplorerServiceError('DENIED');
    target = path.join(target, part);
    info = await lstat(target);
    if (info.isSymbolicLink()) throw new ExplorerServiceError('DENIED');
  }
  if (!info.isFile() && !info.isDirectory()) throw new ExplorerServiceError('DENIED');
  if ((await realpath(target)) !== target) throw new ExplorerServiceError('DENIED');
  return { path: target, info };
};

export const resolveNew = async (root: ExplorerRoot, relativePath: string): Promise<string> => {
  const normalized = parseRelativePath(relativePath);
  const parent = path.dirname(normalized);
  const parentEntry = await resolveExisting(root, parent === '.' ? '' : parent, true);
  if (!parentEntry.info.isDirectory()) throw new ExplorerServiceError('DENIED');
  const target = path.join(parentEntry.path, path.basename(normalized));
  try {
    await lstat(target);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return target;
    throw error;
  }
  throw new ExplorerServiceError('CONFLICT');
};

export type ExistingType = 'file' | 'directory';

/** Whether a path exists and, if so, what entry type occupies it. Returns null when absent. */
export const existingType = async (root: ExplorerRoot, relativePath: string): Promise<ExistingType | null> => {
  try {
    const entry = await resolveExisting(root, relativePath);
    return entry.info.isDirectory() ? 'directory' : 'file';
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null;
    throw error;
  }
};

export const isNodeError = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code;

export const serviceError = (error: unknown): ExplorerServiceError => {
  if (error instanceof ExplorerServiceError) return error;
  if (isNodeError(error, 'ENOENT')) return new ExplorerServiceError('NOT_FOUND');
  if (isNodeError(error, 'EEXIST')) return new ExplorerServiceError('CONFLICT');
  if (isNodeError(error, 'EACCES') || isNodeError(error, 'EPERM') || isNodeError(error, 'ELOOP'))
    return new ExplorerServiceError('DENIED');
  return new ExplorerServiceError('IO_ERROR');
};
