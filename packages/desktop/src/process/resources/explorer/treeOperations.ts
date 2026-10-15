/* oxlint-disable no-await-in-loop -- bounded traversal and mutations must remain sequential. */
import { constants, type Stats } from 'node:fs';
import { mkdir, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import {
  checkOperation,
  ExplorerServiceError,
  parseRelativePath,
  resolveExisting,
  resolveNew,
  type ExplorerRoot,
  type OperationGuard,
} from './pathGuard';

export type ExplorerLimits = Readonly<{ maxEntries: number; maxBytes: number; maxDepth: number; timeoutMs: number }>;
export const DEFAULT_EXPLORER_LIMITS: ExplorerLimits = {
  maxEntries: 5000,
  maxBytes: 256 * 1024 * 1024,
  maxDepth: 32,
  timeoutMs: 30000,
};
export type TreeItem = Readonly<{ relativePath: string; info: Stats }>;

export const sameIdentity = (before: Stats, after: Stats): boolean =>
  before.dev === after.dev &&
  before.ino === after.ino &&
  before.isDirectory() === after.isDirectory() &&
  before.size === after.size &&
  before.mtimeMs === after.mtimeMs;

/** Preflight every tree before creating any destination or trashing any source. */
export const scanTrees = async (
  root: ExplorerRoot,
  sources: string[],
  limits: ExplorerLimits,
  guard: OperationGuard
): Promise<TreeItem[]> => {
  const result: TreeItem[] = [];
  let bytes = 0;
  const visit = async (relativePath: string, depth: number): Promise<void> => {
    checkOperation(guard);
    if (depth > limits.maxDepth || result.length >= limits.maxEntries) throw new ExplorerServiceError('LIMIT_EXCEEDED');
    const entry = await resolveExisting(root, relativePath);
    result.push({ relativePath, info: entry.info });
    if (entry.info.isFile()) {
      bytes += entry.info.size;
      if (bytes > limits.maxBytes) throw new ExplorerServiceError('LIMIT_EXCEEDED');
      return;
    }
    const directory = await opendir(entry.path);
    for await (const child of directory) {
      checkOperation(guard);
      parseRelativePath(child.name);
      if (child.isSymbolicLink() || (!child.isFile() && !child.isDirectory())) throw new ExplorerServiceError('DENIED');
      await visit(path.join(relativePath, child.name), depth + 1);
    }
  };
  for (const source of sources) await visit(source, 0);
  return result;
};

export const verifyTree = async (root: ExplorerRoot, items: TreeItem[], guard: OperationGuard): Promise<void> => {
  for (const item of items) {
    checkOperation(guard);
    const current = await resolveExisting(root, item.relativePath, true);
    if (!sameIdentity(item.info, current.info)) throw new ExplorerServiceError('IO_ERROR');
  }
};

export const copyTree = async (
  root: ExplorerRoot,
  source: string,
  destination: string,
  items: TreeItem[],
  guard: OperationGuard,
  recordCreated: (relativePath: string) => void
): Promise<void> => {
  const sourceItems = items.filter(
    (item) => item.relativePath === source || item.relativePath.startsWith(source + path.sep)
  );
  for (const item of sourceItems) {
    checkOperation(guard);
    const suffix = path.relative(source, item.relativePath);
    const targetRelative = suffix ? path.join(destination, suffix) : destination;
    const sourceEntry = await resolveExisting(root, item.relativePath);
    if (!sameIdentity(item.info, sourceEntry.info)) throw new ExplorerServiceError('IO_ERROR');
    const target = await resolveNew(root, targetRelative);
    if (item.info.isDirectory()) {
      await mkdir(target);
      recordCreated(targetRelative);
      continue;
    }
    // Open without following a source link, and reserve the destination exclusively.
    const sourceFile = await open(sourceEntry.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!sameIdentity(item.info, await sourceFile.stat())) throw new ExplorerServiceError('IO_ERROR');
      const destinationFile = await open(target, 'wx');
      recordCreated(targetRelative);
      try {
        const buffer = Buffer.alloc(64 * 1024);
        let position = 0;
        while (position < item.info.size) {
          checkOperation(guard);
          const read = await sourceFile.read(buffer, 0, Math.min(buffer.length, item.info.size - position), position);
          if (read.bytesRead === 0) throw new ExplorerServiceError('IO_ERROR');
          let written = 0;
          while (written < read.bytesRead) {
            checkOperation(guard);
            const write = await destinationFile.write(buffer, written, read.bytesRead - written, position + written);
            if (!write.bytesWritten) throw new ExplorerServiceError('IO_ERROR');
            written += write.bytesWritten;
          }
          position += read.bytesRead;
        }
        await destinationFile.sync();
        if (!sameIdentity(item.info, await sourceFile.stat())) throw new ExplorerServiceError('IO_ERROR');
      } finally {
        await destinationFile.close();
      }
    } finally {
      await sourceFile.close();
    }
  }
};
