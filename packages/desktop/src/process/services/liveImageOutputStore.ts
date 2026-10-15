import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LiveImageOutputReadResult } from '@/common/adapter/ipcBridge';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const LIVE_IMAGE_DIRECTORY = ['.tomni', 'artifacts', 'live-images'] as const;
const OPAQUE_VALUE = /^[A-Za-z0-9._:@-]{1,200}$/u;

type StoredLiveImageOutput = Readonly<{
  schemaVersion: 1;
  outputId: string;
  outputRef: string;
  accountId: string;
  conversationId: string;
  runId: string;
  workspacePath: string;
  relativePath: string;
  state: 'finalizing' | 'completed' | 'failed' | 'cancelled';
  mimeType: 'image/png';
  width: number;
  height: number;
  size: number;
  sha256: string;
  receiptId?: string;
  createdAt: number;
  updatedAt: number;
}>;

type LiveImageOutputSnapshot = Readonly<{ version: 1; outputs: StoredLiveImageOutput[] }>;

export type PublishLiveImageOutput = Readonly<{
  outputId: string;
  accountId: string;
  conversationId: string;
  runId: string;
  workspace: string;
  png: Uint8Array;
  width: number;
  height: number;
}>;

export type CompleteLiveImageOutput = Readonly<{
  outputId: string;
  receiptId: string;
  receiptStatus: 'verified' | 'failed' | 'cancelled' | 'timed_out';
}>;

export type ReadLiveImageOutput = Readonly<{
  accountId: string;
  conversationId: string;
  outputId: string;
  outputRef: string;
}>;

export type PublishedLiveImageOutput = Readonly<{
  outputId: string;
  outputRef: string;
  relativePath: string;
  state: 'finalizing';
}>;

export type CompletedLiveImageOutput = Readonly<{
  outputId: string;
  outputRef: string;
  state: 'completed';
  receiptId: string;
}>;

export type LiveImageOutputStore = Readonly<{
  publish(input: PublishLiveImageOutput): Promise<PublishedLiveImageOutput>;
  complete(input: CompleteLiveImageOutput): Promise<CompletedLiveImageOutput | undefined>;
  read(input: ReadLiveImageOutput): Promise<LiveImageOutputReadResult | null>;
}>;

const isOpaqueValue = (value: string): boolean => OPAQUE_VALUE.test(value);

const isValidDimension = (value: number): boolean => Number.isSafeInteger(value) && value > 0 && value <= 16_384;

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const emptySnapshot = (): LiveImageOutputSnapshot => ({ version: 1, outputs: [] });

const validStoredOutput = (value: unknown): value is StoredLiveImageOutput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    item.schemaVersion === 1 &&
    typeof item.outputId === 'string' &&
    isOpaqueValue(item.outputId) &&
    typeof item.outputRef === 'string' &&
    isOpaqueValue(item.outputRef) &&
    typeof item.accountId === 'string' &&
    isOpaqueValue(item.accountId) &&
    typeof item.conversationId === 'string' &&
    isOpaqueValue(item.conversationId) &&
    typeof item.runId === 'string' &&
    isOpaqueValue(item.runId) &&
    typeof item.workspacePath === 'string' &&
    path.isAbsolute(item.workspacePath) &&
    typeof item.relativePath === 'string' &&
    item.relativePath === LIVE_IMAGE_DIRECTORY.join('/') + `/${item.outputId}.png` &&
    ['finalizing', 'completed', 'failed', 'cancelled'].includes(item.state as string) &&
    item.mimeType === 'image/png' &&
    typeof item.width === 'number' &&
    isValidDimension(item.width) &&
    typeof item.height === 'number' &&
    isValidDimension(item.height) &&
    typeof item.size === 'number' &&
    Number.isSafeInteger(item.size) &&
    item.size > 0 &&
    item.size <= MAX_IMAGE_BYTES &&
    typeof item.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(item.sha256) &&
    (item.receiptId === undefined || (typeof item.receiptId === 'string' && isOpaqueValue(item.receiptId))) &&
    typeof item.createdAt === 'number' &&
    Number.isSafeInteger(item.createdAt) &&
    typeof item.updatedAt === 'number' &&
    Number.isSafeInteger(item.updatedAt)
  );
};

/**
 * Stores only output provenance and a workspace-relative path. Image bytes live
 * exactly once in the conversation workspace, never in a hidden blob store.
 */
export const createLiveImageOutputStore = (input: { indexPath: string; now?: () => number }): LiveImageOutputStore => {
  const indexPath = path.resolve(input.indexPath);
  const now = input.now ?? Date.now;
  let loadPromise: Promise<LiveImageOutputSnapshot> | undefined;
  let writeQueue = Promise.resolve();

  const load = (): Promise<LiveImageOutputSnapshot> => {
    loadPromise ??= (async () => {
      try {
        const parsed: unknown = JSON.parse(await readFile(indexPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptySnapshot();
        const snapshot = parsed as { version?: unknown; outputs?: unknown };
        if (snapshot.version !== 1 || !Array.isArray(snapshot.outputs)) return emptySnapshot();
        return { version: 1, outputs: snapshot.outputs.filter(validStoredOutput) };
      } catch {
        return emptySnapshot();
      }
    })();
    return loadPromise;
  };

  const flush = async (snapshot: LiveImageOutputSnapshot): Promise<void> => {
    writeQueue = writeQueue.then(async () => {
      await mkdir(path.dirname(indexPath), { recursive: true });
      const temporary = `${indexPath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8');
      await rename(temporary, indexPath);
    });
    await writeQueue;
  };

  const publish = async (request: PublishLiveImageOutput): Promise<PublishedLiveImageOutput> => {
    if (
      !isOpaqueValue(request.outputId) ||
      !isOpaqueValue(request.accountId) ||
      !isOpaqueValue(request.conversationId) ||
      !isOpaqueValue(request.runId) ||
      !isValidDimension(request.width) ||
      !isValidDimension(request.height) ||
      request.png.byteLength === 0 ||
      request.png.byteLength > MAX_IMAGE_BYTES
    ) {
      throw new Error('LIVE_IMAGE_OUTPUT_INVALID_PUBLICATION');
    }
    const workspace = path.resolve(request.workspace);
    await mkdir(workspace, { recursive: true });
    const canonicalWorkspace = await realpath(workspace);
    const directory = path.join(canonicalWorkspace, ...LIVE_IMAGE_DIRECTORY);
    await mkdir(directory, { recursive: true });
    const canonicalDirectory = await realpath(directory);
    if (!isWithin(canonicalWorkspace, canonicalDirectory)) throw new Error('LIVE_IMAGE_OUTPUT_WORKSPACE_ESCAPE');
    const relativePath = `${LIVE_IMAGE_DIRECTORY.join('/')}/${request.outputId}.png`;
    const destination = path.join(canonicalDirectory, `${request.outputId}.png`);
    if (!isWithin(canonicalDirectory, destination)) throw new Error('LIVE_IMAGE_OUTPUT_DESTINATION_ESCAPE');

    const bytes = Buffer.from(request.png);
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, destination);
    const details = await lstat(destination);
    if (!details.isFile() || details.isSymbolicLink() || details.size !== bytes.byteLength) {
      throw new Error('LIVE_IMAGE_OUTPUT_PUBLICATION_INVALID');
    }

    const snapshot = await load();
    const existing = snapshot.outputs.find((item) => item.outputId === request.outputId);
    if (existing) throw new Error('LIVE_IMAGE_OUTPUT_ID_CONFLICT');
    const timestamp = now();
    const output: StoredLiveImageOutput = {
      schemaVersion: 1,
      outputId: request.outputId,
      outputRef: `outref_${randomUUID().replaceAll('-', '')}`,
      accountId: request.accountId,
      conversationId: request.conversationId,
      runId: request.runId,
      workspacePath: canonicalWorkspace,
      relativePath,
      state: 'finalizing',
      mimeType: 'image/png',
      width: request.width,
      height: request.height,
      size: bytes.byteLength,
      sha256: digest(bytes),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const next = { version: 1 as const, outputs: [...snapshot.outputs, output] };
    await flush(next);
    loadPromise = Promise.resolve(next);
    return { outputId: output.outputId, outputRef: output.outputRef, relativePath: output.relativePath, state: 'finalizing' };
  };

  const complete = async (request: CompleteLiveImageOutput): Promise<CompletedLiveImageOutput | undefined> => {
    if (!isOpaqueValue(request.outputId) || !isOpaqueValue(request.receiptId)) return undefined;
    const snapshot = await load();
    const index = snapshot.outputs.findIndex((item) => item.outputId === request.outputId);
    if (index < 0) return undefined;
    const current = snapshot.outputs[index];
    if (!current || current.state !== 'finalizing' || request.receiptStatus !== 'verified') return undefined;
    const completed: StoredLiveImageOutput = {
      ...current,
      state: 'completed',
      receiptId: request.receiptId,
      updatedAt: now(),
    };
    const outputs = snapshot.outputs.slice();
    outputs[index] = completed;
    const next = { version: 1 as const, outputs };
    await flush(next);
    loadPromise = Promise.resolve(next);
    return {
      outputId: completed.outputId,
      outputRef: completed.outputRef,
      state: 'completed',
      receiptId: request.receiptId,
    };
  };

  const read = async (request: ReadLiveImageOutput): Promise<LiveImageOutputReadResult | null> => {
    if (
      !isOpaqueValue(request.accountId) ||
      !isOpaqueValue(request.conversationId) ||
      !isOpaqueValue(request.outputId) ||
      !isOpaqueValue(request.outputRef)
    ) {
      return null;
    }
    const snapshot = await load();
    const output = snapshot.outputs.find(
      (item) =>
        item.outputId === request.outputId &&
        item.outputRef === request.outputRef &&
        item.accountId === request.accountId &&
        item.conversationId === request.conversationId &&
        item.state === 'completed' &&
        item.receiptId
    );
    if (!output) return null;
    const canonicalWorkspace = await realpath(output.workspacePath).catch((): undefined => undefined);
    if (!canonicalWorkspace) return null;
    const candidate = path.resolve(canonicalWorkspace, output.relativePath);
    if (!isWithin(canonicalWorkspace, candidate)) return null;
    try {
      const details = await lstat(candidate);
      if (!details.isFile() || details.isSymbolicLink() || details.size !== output.size) return null;
      const bytes = await readFile(candidate);
      if (digest(bytes) !== output.sha256) return null;
      return {
        dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
        mimeType: 'image/png',
        width: output.width,
        height: output.height,
      };
    } catch {
      return null;
    }
  };

  return Object.freeze({ publish, complete, read });
};
