/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/* oxlint-disable no-await-in-loop -- artifact verification and filesystem boundaries are intentionally sequential. */

import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, rename, rm, statfs, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { parseModelPackManifest } from '../modelPackManifest';
import { ModelRegistryError, type ModelRegistryStore } from '../modelRegistryStore';
import {
  modelPackKey,
  type CoreModelPurpose,
  type ModelPackBaseBinding,
  type ModelPackManifest,
  type ModelPackRegistryRecord,
} from '../modelPackTypes';
import type { ModelPackCatalogClient, StrictHttpsFetcher } from './catalogClient';
import {
  ModelPackServiceError,
  type ModelPackAuditOperation,
  type ModelPackAuditReceipt,
  type ModelPackAuditSink,
  type ModelPackCatalogEntry,
  type ModelPackServiceErrorCode,
} from './types';

const DEFAULT_MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

const DEFAULT_MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;
const FILE_HASH_BUFFER_BYTES = 64 * 1024;
const DEFAULT_DISK_RESERVE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_TRANSACTION_JOURNAL_BYTES = 16 * 1024;
const DEFAULT_MAX_TRANSACTION_JOURNALS = 256;
const DEFAULT_MAX_TRANSACTION_QUARANTINE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_TRANSACTION_QUARANTINE_ENTRIES = 256;
const MAX_ARCHIVE_ENTRIES = 128;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_SYMLINK_MODE = 0o120000;
const ZIP_TYPE_MASK = 0o170000;

type ModelPackTransaction = {
  schemaVersion: 1;
  operation: 'install' | 'uninstall';
  key: string;
  destinationName: string;
  trashName?: string;
};

const isInside = (parent: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

const isSameNode = (left: Stats, right: Stats): boolean => left.dev === right.dev && left.ino === right.ino;

const isSameFileState = (left: Stats, right: Stats): boolean =>
  isSameNode(left, right) &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs;

const safeArchivePath = (value: string): boolean => {
  const segments = value.split('/');
  return (
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.includes(':') &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
};

const archiveFiles = (bytes: Buffer): Map<string, number> => {
  let eocd = -1;
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new ModelPackServiceError('archive-invalid', 'ZIP end-of-central-directory is missing.');
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const entries = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entries > MAX_ARCHIVE_ENTRIES ||
    entries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    centralOffset + centralSize > eocd
  ) {
    throw new ModelPackServiceError('archive-invalid', 'ZIP64, split, oversized, or malformed archives are rejected.');
  }
  const files = new Map<string, number>();
  let cursor = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== ZIP_CENTRAL_SIGNATURE) {
      throw new ModelPackServiceError('archive-invalid', 'ZIP central directory is malformed.');
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length || (flags & 1) !== 0) {
      throw new ModelPackServiceError('archive-invalid', 'Encrypted or truncated ZIP entries are rejected.');
    }
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    const utf8 = (flags & 0x0800) !== 0;
    if (Buffer.from(name, 'utf8').compare(nameBytes) !== 0 || (!utf8 && /[^\x20-\x7e]/u.test(name))) {
      throw new ModelPackServiceError('archive-invalid', 'ZIP entry names must be canonical UTF-8 or ASCII.');
    }
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & ZIP_TYPE_MASK) === ZIP_SYMLINK_MODE) {
      throw new ModelPackServiceError('unsafe-entry', `ZIP symlink is forbidden: ${name}`);
    }
    if (!name.endsWith('/')) {
      if (!safeArchivePath(name) || files.has(name)) {
        throw new ModelPackServiceError('unsafe-entry', `ZIP entry path is unsafe or duplicated: ${name}`);
      }
      files.set(name, uncompressedSize);
    }
    cursor = next;
  }
  if (cursor !== centralOffset + centralSize) {
    throw new ModelPackServiceError('archive-invalid', 'ZIP central directory length is inconsistent.');
  }
  return files;
};

const defaultDiskBytes = async (target: string): Promise<bigint> => {
  const stats = await statfs(target, { bigint: true });
  return stats.bavail * stats.bsize;
};

const errorCode = (error: unknown): ModelPackServiceErrorCode =>
  error instanceof ModelPackServiceError ? error.code : 'filesystem-error';

export type ModelPackServiceOptions = {
  rootDir: string;
  registry: ModelRegistryStore;
  catalogClient: ModelPackCatalogClient;
  auditSink: ModelPackAuditSink;

  onAuditError?: (error: unknown, receipt: Readonly<ModelPackAuditReceipt>) => void;
  expectedBases: Readonly<Partial<Record<CoreModelPurpose, ModelPackBaseBinding>>>;
  network: StrictHttpsFetcher;
  availableDiskBytes?: (target: string) => Promise<bigint>;
  maxArtifactBytes?: number;

  maxExtractedBytes?: number;
  maxTransactionJournalBytes?: number;
  maxTransactionJournals?: number;
  maxTransactionQuarantineBytes?: number;
  maxTransactionQuarantineEntries?: number;
  diskReserveBytes?: number;
  now?: () => Date;
  randomId?: () => string;
};

export class ModelPackService {
  private readonly rootDir: string;
  private readonly stagingDir: string;
  private readonly installedDir: string;
  private readonly trashDir: string;
  private readonly transactionsDir: string;
  private readonly transactionQuarantineDir: string;
  private readonly network: StrictHttpsFetcher;
  private readonly availableDiskBytes: (target: string) => Promise<bigint>;
  private readonly now: () => Date;
  private readonly randomId: () => string;
  private readonly entries = new Map<string, ModelPackCatalogEntry>();
  private lifecycleTail: Promise<void> = Promise.resolve();
  private readonly installOperations = new Map<string, Promise<ModelPackRegistryRecord>>();
  private readonly uninstallOperations = new Map<string, Promise<void>>();

  public constructor(private readonly options: ModelPackServiceOptions) {
    if (!path.isAbsolute(options.rootDir)) {
      throw new ModelPackServiceError('filesystem-error', 'Model Pack userData root must be absolute.');
    }
    this.rootDir = path.resolve(options.rootDir, 'model-packs');
    this.stagingDir = path.join(this.rootDir, '.staging');
    this.installedDir = path.join(this.rootDir, 'installed');
    this.trashDir = path.join(this.rootDir, '.trash');

    this.transactionsDir = path.join(this.rootDir, '.transactions');
    this.transactionQuarantineDir = path.join(this.rootDir, '.transaction-quarantine');
    this.network = options.network;
    this.availableDiskBytes = options.availableDiskBytes ?? defaultDiskBytes;
    this.now = options.now ?? (() => new Date());
    this.randomId = options.randomId ?? randomUUID;
  }

  public initialize(): Promise<void> {
    return this.runLifecycleExclusive(() => this.initializeOnce());
  }

  private async initializeOnce(): Promise<void> {
    const started = this.now();
    try {
      await this.prepareManagedRoots();
      await this.recoverTransactions();
      await this.assertManagedRoots();
      await this.revalidateInstalledRecords();
      await this.cleanDirectory(this.stagingDir);
      await this.cleanDirectory(this.trashDir);
      await this.audit('recovery', 'model-packs', 'succeeded', started);
    } catch (error) {
      await this.audit('recovery', 'model-packs', 'failed', started, undefined, undefined, errorCode(error));
      throw error;
    }
  }

  public refreshCatalog(): Promise<readonly ModelPackCatalogEntry[]> {
    return this.runLifecycleExclusive(() => this.refreshCatalogOnce());
  }

  private async refreshCatalogOnce(): Promise<readonly ModelPackCatalogEntry[]> {
    const started = this.now();
    try {
      const current = await this.options.registry.read();
      const refreshed = await this.options.catalogClient.refresh(current.revision);
      this.entries.clear();
      for (const entry of refreshed.document.entries) {
        this.entries.set(`${entry.manifest.id}@${entry.manifest.version}`, entry);
      }
      await this.audit(
        'catalog-refresh',
        `revision:${refreshed.document.revision}`,
        'succeeded',
        started,
        refreshed.registryRevision
      );
      return [...this.entries.values()].map((entry) => structuredClone(entry));
    } catch (error) {
      await this.audit('catalog-refresh', 'catalog', 'failed', started, undefined, undefined, errorCode(error));
      throw error;
    }
  }

  public loadOfflineCatalog(): Promise<readonly ModelPackCatalogEntry[]> {
    return this.runLifecycleExclusive(() => this.loadOfflineCatalogOnce());
  }

  private async loadOfflineCatalogOnce(): Promise<readonly ModelPackCatalogEntry[]> {
    const started = this.now();
    try {
      const current = await this.options.registry.read();
      const refreshed = await this.options.catalogClient.loadOffline(current.revision);
      this.entries.clear();
      for (const entry of refreshed.document.entries) {
        this.entries.set(`${entry.manifest.id}@${entry.manifest.version}`, entry);
      }
      await this.audit(
        'catalog-refresh',
        `offline-revision:${refreshed.document.revision}`,
        'succeeded',
        started,
        refreshed.registryRevision
      );
      return [...this.entries.values()].map((entry) => structuredClone(entry));
    } catch (error) {
      await this.audit('catalog-refresh', 'offline-catalog', 'failed', started, undefined, undefined, errorCode(error));
      throw error;
    }
  }

  public install(id: string, version: string): Promise<ModelPackRegistryRecord> {
    const catalogKey = `${id}@${version}`;
    const running = this.installOperations.get(catalogKey);
    if (running) return running;
    const operation = this.runLifecycleExclusive(async () => {
      await this.recoverPendingMutationState();
      return this.installOnce(catalogKey);
    }).finally(() => this.installOperations.delete(catalogKey));
    this.installOperations.set(catalogKey, operation);
    return operation;
  }

  public uninstall(key: string): Promise<void> {
    const running = this.uninstallOperations.get(key);
    if (running) return running;
    const operation = this.runLifecycleExclusive(async () => {
      await this.recoverPendingMutationState();
      await this.uninstallOnce(key);
    }).finally(() => this.uninstallOperations.delete(key));
    this.uninstallOperations.set(key, operation);
    return operation;
  }

  private async uninstallOnce(key: string): Promise<void> {
    const started = this.now();
    let trashedPath: string | undefined;
    let originalPath: string | undefined;
    let journalPath: string | undefined;
    try {
      await this.assertManagedRoots();
      const snapshot = await this.options.registry.read();
      const record = snapshot.records[key];
      if (!record) throw new ModelPackServiceError('pack-not-found', `Model Pack is not installed: ${key}`);
      if (record.status === 'active' || Object.values(snapshot.activeByPurpose).includes(key)) {
        throw new ModelPackServiceError('pack-active', 'Active Model Pack cannot be uninstalled.');
      }
      if (Object.values(snapshot.previousActiveByPurpose).includes(key)) {
        throw new ModelPackServiceError(
          'pack-rollback-retained',
          'Rollback-retained Model Pack cannot be uninstalled.'
        );
      }
      if (!record.installedPath || !isInside(this.installedDir, record.installedPath)) {
        throw new ModelPackServiceError('filesystem-error', 'Installed Model Pack path is outside managed storage.');
      }
      await this.verifyArtifactTree(record.installedPath, record.manifest, this.installedDir);
      originalPath = record.installedPath;
      const destinationName = path.basename(originalPath);
      const trashName = createHash('sha256').update(this.randomId()).digest('hex');
      trashedPath = path.join(this.trashDir, trashName);
      journalPath = await this.writeTransaction({
        schemaVersion: 1,
        operation: 'uninstall',
        key,
        destinationName,
        trashName,
      });
      await rename(originalPath, trashedPath);
      let updated;
      try {
        updated = await this.options.registry.unregister(key, snapshot.revision);
      } catch (error) {
        const restored = await rename(trashedPath, originalPath)
          .then((): boolean => true)
          .catch((): boolean => false);
        if (restored && journalPath) {
          await unlink(journalPath).catch((): void => undefined);
          journalPath = undefined;
        }
        throw error;
      }
      const removed = await rm(trashedPath, { recursive: true, force: true })
        .then((): boolean => true)
        .catch((): boolean => false);
      if (removed) {
        await unlink(journalPath).catch((): void => undefined);
        journalPath = undefined;
      }
      await this.audit('uninstall', key, 'succeeded', started, updated.revision);
    } catch (error) {
      await this.audit('uninstall', key, 'failed', started, undefined, undefined, errorCode(error));
      throw error;
    }
  }

  private runLifecycleExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  }

  /**
   * A failed mutation can leave a journal or an extracted staging directory even
   * though its Promise is rejected. Recover it before the next mutation rather
   * than requiring an application restart to reclaim that state.
   */
  private async recoverPendingMutationState(): Promise<void> {
    await this.recoverTransactions();
    await this.cleanDirectory(this.stagingDir);
  }

  private async installOnce(catalogKey: string): Promise<ModelPackRegistryRecord> {
    const started = this.now();
    const entry = this.entries.get(catalogKey);
    let stagePath: string | undefined;
    let destination: string | undefined;
    let journalPath: string | undefined;
    let registryKey: string | undefined;
    try {
      await this.assertManagedRoots();
      if (!entry) throw new ModelPackServiceError('pack-not-found', `Model Pack is absent from catalog: ${catalogKey}`);
      const expectedBase = this.options.expectedBases[entry.manifest.purpose];
      if (!expectedBase) {
        throw new ModelPackServiceError(
          'install-conflict',
          `No immutable base binding is configured for ${entry.manifest.purpose}.`
        );
      }
      const manifest = parseModelPackManifest(entry.manifest, { expectedBaseModel: expectedBase });
      const declaredPayloadBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
      if (
        !Number.isSafeInteger(declaredPayloadBytes) ||
        declaredPayloadBytes > (this.options.maxExtractedBytes ?? DEFAULT_MAX_EXTRACTED_BYTES)
      ) {
        throw new ModelPackServiceError('payload-too-large', 'Model Pack extracted payload exceeds configured limit.');
      }
      const registryBefore = await this.options.registry.read();
      const key = modelPackKey(manifest);
      registryKey = key;
      if (registryBefore.records[key]) {
        throw new ModelPackServiceError('already-installed', `Model Pack is already registered: ${key}`);
      }
      const artifactLimit = this.options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
      if (entry.artifact.size > artifactLimit) {
        throw new ModelPackServiceError('download-too-large', 'Model Pack artifact exceeds configured limit.');
      }
      const bytes = await this.network.fetchBytes(entry.artifact.url, artifactLimit, entry.artifact.size);
      if (createHash('sha256').update(bytes).digest('hex') !== entry.artifact.sha256) {
        throw new ModelPackServiceError('artifact-tampered', 'Downloaded Model Pack artifact hash is invalid.');
      }
      const required = BigInt(
        entry.artifact.size + declaredPayloadBytes + (this.options.diskReserveBytes ?? DEFAULT_DISK_RESERVE_BYTES)
      );
      if ((await this.availableDiskBytes(this.rootDir)) < required) {
        throw new ModelPackServiceError('disk-full', 'Insufficient disk space for staging and atomic installation.');
      }
      stagePath = path.join(this.stagingDir, createHash('sha256').update(this.randomId()).digest('hex'));
      const payloadPath = path.join(stagePath, 'payload');
      await mkdir(payloadPath, { recursive: true, mode: 0o700 });
      await this.extractAndVerify(bytes, manifest, payloadPath);
      const destinationName = createHash('sha256').update(key).digest('hex');
      destination = path.join(this.installedDir, destinationName);
      journalPath = await this.writeTransaction({
        schemaVersion: 1,
        operation: 'install',
        key,
        destinationName,
      });
      try {
        await rename(payloadPath, destination);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'ENOTEMPTY') {
          throw new ModelPackServiceError('already-installed', 'Immutable Model Pack destination already exists.', {
            cause: error,
          });
        }
        throw error;
      }
      await this.verifyArtifactTree(destination, manifest, this.installedDir);
      let updated;
      try {
        updated = await this.options.registry.registerCandidate(manifest, destination, registryBefore.revision);
      } catch (error) {
        await rm(destination, { recursive: true, force: true });
        destination = undefined;
        if (error instanceof ModelRegistryError && error.code === 'revision-conflict') {
          throw new ModelPackServiceError('install-conflict', 'Registry changed during Model Pack installation.', {
            cause: error,
          });
        }
        throw error;
      }
      const installed = updated.records[key];
      await unlink(journalPath).catch((): void => undefined);
      journalPath = undefined;
      await this.audit('install', key, 'succeeded', started, updated.revision, entry.artifact.size);
      return structuredClone(installed);
    } catch (error) {
      await this.audit('install', catalogKey, 'failed', started, undefined, entry?.artifact.size, errorCode(error));
      throw error;
    } finally {
      if (stagePath) await rm(stagePath, { recursive: true, force: true }).catch((): void => undefined);
      if (journalPath) {
        const destinationExists = destination ? await this.pathExists(destination).catch((): boolean => true) : false;
        const registered = registryKey
          ? await this.options.registry
              .read()
              .then((snapshot): boolean => Boolean(snapshot.records[registryKey!]))
              .catch((): boolean => false)
          : false;
        if (!destinationExists || registered) await unlink(journalPath).catch((): void => undefined);
      }
    }
  }

  private async extractAndVerify(bytes: Buffer, manifest: ModelPackManifest, destination: string): Promise<void> {
    const centralFiles = archiveFiles(bytes);
    const declared = new Map(manifest.files.map((file) => [file.path, file]));
    if (centralFiles.size !== declared.size) {
      throw new ModelPackServiceError('unsafe-entry', 'Model Pack archive contains missing or extra files.');
    }
    for (const [filePath, uncompressedSize] of centralFiles) {
      const expected = declared.get(filePath);
      if (!expected || expected.size !== uncompressedSize) {
        throw new ModelPackServiceError('unsafe-entry', `ZIP entry is undeclared or has a false size: ${filePath}`);
      }
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
    } catch (error) {
      throw new ModelPackServiceError('archive-invalid', 'Model Pack ZIP cannot be decoded.', { cause: error });
    }
    for (const file of manifest.files) {
      const entry = zip.file(file.path);
      if (!entry || entry.dir) throw new ModelPackServiceError('unsafe-entry', `ZIP file is missing: ${file.path}`);
      const content = await entry.async('uint8array');
      const digest = createHash('sha256').update(content).digest('hex');
      if (content.byteLength !== file.size || digest !== file.sha256) {
        throw new ModelPackServiceError(
          'artifact-tampered',
          `Extracted Model Pack file failed integrity: ${file.path}`
        );
      }
      const target = path.resolve(destination, file.path);
      if (!isInside(destination, target))
        throw new ModelPackServiceError('unsafe-entry', 'Extraction path escaped staging.');
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, content, { flag: 'wx', mode: 0o600 });
    }
    await this.verifyArtifactTree(destination, manifest, this.stagingDir);
  }

  private async verifyArtifactTree(root: string, manifest: ModelPackManifest, allowedParent: string): Promise<void> {
    await this.assertManagedRoots();
    const allowedParentRealPath = await this.assertManagedDirectory(allowedParent);
    const rootBefore = await lstat(root);
    if (rootBefore.isSymbolicLink() || !rootBefore.isDirectory()) {
      throw new ModelPackServiceError('unsafe-entry', 'Model Pack root is a link or special file.');
    }
    const rootRealPath = await realpath(root);
    if (!isInside(allowedParentRealPath, rootRealPath)) {
      throw new ModelPackServiceError('unsafe-entry', 'Model Pack root escaped managed storage.');
    }
    const expected = new Map(manifest.files.map((file) => [file.path, file]));
    const expectedDirectories = new Set<string>();
    for (const file of manifest.files) {
      let directory = path.posix.dirname(file.path);
      while (directory !== '.') {
        expectedDirectories.add(directory);
        directory = path.posix.dirname(directory);
      }
    }
    const maxTreeEntries = expected.size + expectedDirectories.size;
    let observedTreeEntries = 0;
    const found = new Set<string>();
    const pendingDirectories = [root];
    while (pendingDirectories.length > 0) {
      const directory = pendingDirectories.pop()!;
      const directoryHandle = await opendir(directory);
      for await (const entry of directoryHandle) {
        observedTreeEntries += 1;
        if (observedTreeEntries > maxTreeEntries) {
          throw new ModelPackServiceError('unsafe-entry', 'Model Pack tree exceeds its declared entry limit.');
        }
        const absolute = path.join(directory, entry.name);
        const stats = await lstat(absolute);
        if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
          throw new ModelPackServiceError('unsafe-entry', 'Model Pack contains a link or special file.');
        }
        const resolved = await realpath(absolute);
        if (!isInside(rootRealPath, resolved)) {
          throw new ModelPackServiceError('unsafe-entry', 'Model Pack entry escaped its installed root.');
        }
        const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
        if (stats.isDirectory()) {
          if (!expectedDirectories.has(relative)) {
            throw new ModelPackServiceError('unsafe-entry', 'Model Pack contains an unexpected directory.');
          }
          pendingDirectories.push(absolute);
          continue;
        }
        const expectedFile = expected.get(relative);
        if (!expectedFile) {
          throw new ModelPackServiceError('unsafe-entry', 'Model Pack contains an unexpected file.');
        }
        await this.verifyRegularFile(absolute, resolved, stats, expectedFile, rootRealPath);
        found.add(relative);
      }
    }
    const rootAfter = await lstat(root);
    if (
      rootAfter.isSymbolicLink() ||
      !rootAfter.isDirectory() ||
      !isSameNode(rootBefore, rootAfter) ||
      (await realpath(root)) !== rootRealPath
    ) {
      throw new ModelPackServiceError('unsafe-entry', 'Model Pack root changed during verification.');
    }
    if (found.size !== expected.size || [...expected.keys()].some((file) => !found.has(file))) {
      throw new ModelPackServiceError('unsafe-entry', 'Model Pack contains missing or unexpected files.');
    }
  }

  private async verifyRegularFile(
    target: string,
    resolvedBefore: string,
    pathBefore: Stats,
    expected: ModelPackManifest['files'][number],
    rootRealPath: string
  ): Promise<void> {
    if (!isInside(rootRealPath, resolvedBefore)) {
      throw new ModelPackServiceError('unsafe-entry', 'Model Pack file escaped its installed root.');
    }
    const handle = await open(target, 'r');
    try {
      const openedBefore = await handle.stat();
      if (!openedBefore.isFile() || !isSameNode(pathBefore, openedBefore)) {
        throw new ModelPackServiceError('unsafe-entry', 'Model Pack file changed before verification.');
      }
      if (openedBefore.size !== expected.size) {
        throw new ModelPackServiceError(
          'artifact-tampered',
          `Installed Model Pack file failed integrity: ${expected.path}`
        );
      }
      const digest = createHash('sha256');
      const buffer = Buffer.alloc(FILE_HASH_BUFFER_BYTES);
      let verifiedBytes = 0;
      while (verifiedBytes < expected.size) {
        const length = Math.min(buffer.byteLength, expected.size - verifiedBytes);
        const { bytesRead } = await handle.read(buffer, 0, length, verifiedBytes);
        if (bytesRead === 0) break;
        digest.update(buffer.subarray(0, bytesRead));
        verifiedBytes += bytesRead;
      }
      const openedAfter = await handle.stat();
      const pathAfter = await lstat(target);
      const resolvedAfter = await realpath(target);
      if (
        pathAfter.isSymbolicLink() ||
        !pathAfter.isFile() ||
        !isSameFileState(openedBefore, openedAfter) ||
        !isSameFileState(openedAfter, pathAfter) ||
        resolvedAfter !== resolvedBefore
      ) {
        throw new ModelPackServiceError('unsafe-entry', 'Model Pack file changed during verification.');
      }
      if (verifiedBytes !== expected.size || digest.digest('hex') !== expected.sha256) {
        throw new ModelPackServiceError(
          'artifact-tampered',
          `Installed Model Pack file failed integrity: ${expected.path}`
        );
      }
    } finally {
      await handle.close();
    }
  }

  private async prepareManagedRoots(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    const rootRealPath = await this.assertManagedDirectory(this.rootDir);
    for (const directory of [
      this.stagingDir,
      this.installedDir,
      this.trashDir,
      this.transactionsDir,
      this.transactionQuarantineDir,
    ]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const resolved = await this.assertManagedDirectory(directory);
      if (!isInside(rootRealPath, resolved)) {
        throw new ModelPackServiceError('filesystem-error', 'Managed Model Pack directory escaped its root.');
      }
    }
  }

  private async assertManagedRoots(): Promise<void> {
    const rootRealPath = await this.assertManagedDirectory(this.rootDir);
    for (const directory of [
      this.stagingDir,
      this.installedDir,
      this.trashDir,
      this.transactionsDir,
      this.transactionQuarantineDir,
    ]) {
      const resolved = await this.assertManagedDirectory(directory);
      if (!isInside(rootRealPath, resolved)) {
        throw new ModelPackServiceError('filesystem-error', 'Managed Model Pack directory escaped its root.');
      }
    }
  }

  private async assertManagedDirectory(directory: string): Promise<string> {
    const before = await lstat(directory);
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new ModelPackServiceError('filesystem-error', 'Managed Model Pack path is a link or special file.');
    }
    const resolved = await realpath(directory);
    const after = await lstat(directory);
    if (after.isSymbolicLink() || !after.isDirectory() || !isSameNode(before, after)) {
      throw new ModelPackServiceError('filesystem-error', 'Managed Model Pack path changed during validation.');
    }
    return resolved;
  }

  private async revalidateInstalledRecords(): Promise<void> {
    const snapshot = await this.options.registry.read();
    const invalidKeys: string[] = [];
    for (const record of Object.values(snapshot.records)) {
      if (record.status === 'discovered' || record.status === 'downloading' || record.status === 'quarantined')
        continue;
      try {
        const expectedPath = path.join(this.installedDir, createHash('sha256').update(record.key).digest('hex'));
        if (record.installedPath !== expectedPath) {
          throw new ModelPackServiceError('filesystem-error', 'Installed Model Pack path does not match its key.');
        }
        await this.verifyArtifactTree(expectedPath, record.manifest, this.installedDir);
      } catch {
        invalidKeys.push(record.key);
      }
    }
    const activeKeys = new Set(Object.values(snapshot.activeByPurpose));
    const orderedInvalidKeys = [
      ...invalidKeys.filter((key) => !activeKeys.has(key)),
      ...invalidKeys.filter((key) => activeKeys.has(key)),
    ];
    for (const key of orderedInvalidKeys) {
      const current = await this.options.registry.read();
      const record = current.records[key];
      if (record && record.status !== 'quarantined') {
        await this.options.registry.quarantine(key, 'installed-artifact-integrity-failed', current.revision);
      }
    }
  }

  private async writeTransaction(transaction: ModelPackTransaction): Promise<string> {
    await this.assertManagedRoots();
    await this.assertTransactionJournalCount(true);
    const serialized = JSON.stringify(transaction);
    const maxJournalBytes = this.options.maxTransactionJournalBytes ?? DEFAULT_MAX_TRANSACTION_JOURNAL_BYTES;
    if (
      !Number.isSafeInteger(maxJournalBytes) ||
      maxJournalBytes <= 0 ||
      maxJournalBytes > DEFAULT_MAX_TRANSACTION_QUARANTINE_BYTES ||
      Buffer.byteLength(serialized, 'utf8') > maxJournalBytes
    ) {
      throw new ModelPackServiceError('filesystem-error', 'Transaction journal exceeds its byte limit.');
    }
    const name = `${createHash('sha256').update(this.randomId()).digest('hex')}.json`;
    const journalPath = path.join(this.transactionsDir, name);
    const handle = await open(journalPath, 'wx', 0o600);
    try {
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return journalPath;
  }

  private async readTransactionJournal(journalPath: string, pathBefore: Stats, maxBytes: number): Promise<string> {
    const handle = await open(journalPath, 'r');
    try {
      const openedBefore = await handle.stat();
      if (!openedBefore.isFile() || !isSameNode(pathBefore, openedBefore) || openedBefore.size > maxBytes) {
        throw new ModelPackServiceError('filesystem-error', 'Transaction journal changed before bounded read.');
      }
      const content = Buffer.alloc(maxBytes + 1);
      let offset = 0;
      while (offset < content.byteLength) {
        const { bytesRead } = await handle.read(content, offset, content.byteLength - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      const openedAfter = await handle.stat();
      const pathAfter = await lstat(journalPath);
      if (
        offset > maxBytes ||
        pathAfter.isSymbolicLink() ||
        !pathAfter.isFile() ||
        !isSameFileState(openedBefore, openedAfter) ||
        !isSameFileState(openedAfter, pathAfter)
      ) {
        throw new ModelPackServiceError('filesystem-error', 'Transaction journal changed during bounded read.');
      }
      return content.subarray(0, offset).toString('utf8');
    } finally {
      await handle.close();
    }
  }

  private async assertTransactionJournalCount(addingEntry = false): Promise<void> {
    const maxJournals = this.options.maxTransactionJournals ?? DEFAULT_MAX_TRANSACTION_JOURNALS;
    if (!Number.isSafeInteger(maxJournals) || maxJournals <= 0) {
      throw new ModelPackServiceError('filesystem-error', 'Transaction journal count limit is invalid.');
    }
    let count = 0;
    const directory = await opendir(this.transactionsDir);
    for await (const _entry of directory) {
      count += 1;
      if (count > maxJournals || (addingEntry && count >= maxJournals)) {
        throw new ModelPackServiceError('filesystem-error', 'Transaction journal count exceeds its limit.');
      }
    }
  }

  private async assertTransactionQuarantineCapacity(incomingBytes?: number): Promise<void> {
    const maxBytes = this.options.maxTransactionQuarantineBytes ?? DEFAULT_MAX_TRANSACTION_QUARANTINE_BYTES;
    const maxEntries = this.options.maxTransactionQuarantineEntries ?? DEFAULT_MAX_TRANSACTION_QUARANTINE_ENTRIES;
    const bytesToAdd = incomingBytes ?? 0;
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0 ||
      !Number.isSafeInteger(maxEntries) ||
      maxEntries <= 0 ||
      !Number.isSafeInteger(bytesToAdd) ||
      bytesToAdd < 0 ||
      bytesToAdd > maxBytes
    ) {
      throw new ModelPackServiceError('filesystem-error', 'Transaction journal exceeds quarantine capacity.');
    }
    let entries = 0;
    let bytes = 0;
    const directory = await opendir(this.transactionQuarantineDir);
    for await (const entry of directory) {
      entries += 1;
      if (entries > maxEntries || (incomingBytes !== undefined && entries >= maxEntries)) {
        throw new ModelPackServiceError('filesystem-error', 'Transaction quarantine entry quota is exhausted.');
      }
      const stats = await lstat(path.join(this.transactionQuarantineDir, entry.name));
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new ModelPackServiceError('filesystem-error', 'Transaction quarantine contains an unsafe entry.');
      }
      bytes += stats.size;
      if (!Number.isSafeInteger(bytes) || bytes > maxBytes - bytesToAdd) {
        throw new ModelPackServiceError('filesystem-error', 'Transaction quarantine byte quota is exhausted.');
      }
    }
  }

  private async quarantineTransaction(journalPath: string, filename: string): Promise<void> {
    await this.assertManagedRoots();
    if (!isInside(this.transactionsDir, journalPath)) {
      throw new ModelPackServiceError('filesystem-error', 'Transaction journal escaped managed storage.');
    }
    const journalStats = await lstat(journalPath);
    if (journalStats.isSymbolicLink() || !journalStats.isFile()) {
      throw new ModelPackServiceError('filesystem-error', 'Unsafe transaction entry cannot enter quarantine.');
    }
    await this.assertTransactionQuarantineCapacity(journalStats.size);
    const quarantineName = `${createHash('sha256').update(`${filename}\0${this.randomId()}`).digest('hex')}.invalid`;
    const quarantinePath = path.join(this.transactionQuarantineDir, quarantineName);
    if (!isInside(this.transactionQuarantineDir, quarantinePath) || (await this.pathExists(quarantinePath))) {
      throw new ModelPackServiceError('filesystem-error', 'Transaction quarantine destination is invalid.');
    }
    await rename(journalPath, quarantinePath);
  }

  private async recoverTransactions(): Promise<void> {
    await this.assertManagedRoots();
    await this.assertTransactionJournalCount();
    await this.assertTransactionQuarantineCapacity();
    const maxJournalBytes = this.options.maxTransactionJournalBytes ?? DEFAULT_MAX_TRANSACTION_JOURNAL_BYTES;
    if (
      !Number.isSafeInteger(maxJournalBytes) ||
      maxJournalBytes <= 0 ||
      maxJournalBytes > DEFAULT_MAX_TRANSACTION_QUARANTINE_BYTES
    ) {
      throw new ModelPackServiceError('filesystem-error', 'Transaction journal byte limit is invalid.');
    }
    const snapshot = await this.options.registry.read();
    const transactionDirectory = await opendir(this.transactionsDir);
    for await (const entry of transactionDirectory) {
      const filename = entry.name;
      const journalPath = path.join(this.transactionsDir, filename);
      const journalStats = await lstat(journalPath);
      if (journalStats.isSymbolicLink() || !journalStats.isFile()) {
        throw new ModelPackServiceError('filesystem-error', 'Transaction directory contains an unsafe entry.');
      }
      if (!/^[0-9a-f]{64}\.json$/u.test(filename) || journalStats.size === 0 || journalStats.size > maxJournalBytes) {
        await this.quarantineTransaction(journalPath, filename);
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(await this.readTransactionJournal(journalPath, journalStats, maxJournalBytes)) as unknown;
      } catch {
        await this.quarantineTransaction(journalPath, filename);
        continue;
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        await this.quarantineTransaction(journalPath, filename);
        continue;
      }
      const raw = value as Record<string, unknown>;
      const allowed = new Set(['schemaVersion', 'operation', 'key', 'destinationName', 'trashName']);
      if (
        raw.schemaVersion !== 1 ||
        (raw.operation !== 'install' && raw.operation !== 'uninstall') ||
        typeof raw.key !== 'string' ||
        typeof raw.destinationName !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(raw.destinationName) ||
        Object.keys(raw).some((key) => !allowed.has(key)) ||
        (raw.operation === 'uninstall' &&
          (typeof raw.trashName !== 'string' || !/^[0-9a-f]{64}$/u.test(raw.trashName))) ||
        (raw.operation === 'install' && raw.trashName !== undefined)
      ) {
        await this.quarantineTransaction(journalPath, filename);
        continue;
      }
      const transaction = raw as ModelPackTransaction;
      const expectedDestinationName = createHash('sha256').update(transaction.key).digest('hex');
      if (transaction.destinationName !== expectedDestinationName) {
        await this.quarantineTransaction(journalPath, filename);
        continue;
      }
      const destination = path.join(this.installedDir, transaction.destinationName);
      const destinationExists = await this.pathExists(destination);
      if (destinationExists) {
        const destinationStats = await lstat(destination);
        if (destinationStats.isSymbolicLink() || !destinationStats.isDirectory()) {
          await this.quarantineTransaction(journalPath, filename);
          continue;
        }
      }
      const record = snapshot.records[transaction.key];
      if (transaction.operation === 'install') {
        if (record) {
          if (path.resolve(record.installedPath ?? '') !== path.resolve(destination) || !destinationExists) {
            await this.quarantineTransaction(journalPath, filename);
            continue;
          }
        } else if (destinationExists) {
          await rm(destination, { recursive: true, force: true });
        }
      } else {
        const trash = path.join(this.trashDir, transaction.trashName!);
        const trashExists = await this.pathExists(trash);
        if (trashExists) {
          const trashStats = await lstat(trash);
          if (trashStats.isSymbolicLink() || !trashStats.isDirectory()) {
            await this.quarantineTransaction(journalPath, filename);
            continue;
          }
        }
        if (record) {
          if (path.resolve(record.installedPath ?? '') !== path.resolve(destination)) {
            await this.quarantineTransaction(journalPath, filename);
            continue;
          }
          if (!destinationExists) {
            if (!trashExists) {
              await this.quarantineTransaction(journalPath, filename);
              continue;
            }
            await rename(trash, destination);
          } else if (trashExists) {
            await rm(trash, { recursive: true, force: true });
          }
        } else {
          if (trashExists) await rm(trash, { recursive: true, force: true });
          if (destinationExists) await rm(destination, { recursive: true, force: true });
        }
      }
      await unlink(journalPath);
    }
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await lstat(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async cleanDirectory(directory: string): Promise<void> {
    await this.assertManagedRoots();
    await this.assertManagedDirectory(directory);
    const directoryHandle = await opendir(directory);
    for await (const entry of directoryHandle) {
      const target = path.join(directory, entry.name);
      if (!isInside(directory, target))
        throw new ModelPackServiceError('filesystem-error', 'Cleanup path escaped root.');
      const stats = await lstat(target);
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        throw new ModelPackServiceError('filesystem-error', 'Cleanup target is a link or special file.');
      }
      await rm(target, { recursive: true, force: true });
    }
  }

  private async audit(
    operation: ModelPackAuditOperation,
    subject: string,
    status: 'succeeded' | 'failed',
    started: Date,
    registryRevision?: number,
    bytes?: number,
    failureCode?: ModelPackServiceErrorCode
  ): Promise<void> {
    const receipt: ModelPackAuditReceipt = {
      receiptId: this.randomId(),
      operation,
      subject,
      status,
      startedAt: started.toISOString(),
      finishedAt: this.now().toISOString(),
      ...(registryRevision === undefined ? {} : { registryRevision }),
      ...(bytes === undefined ? {} : { bytes }),
      ...(failureCode === undefined ? {} : { errorCode: failureCode }),
    };
    try {
      await this.options.auditSink.append(Object.freeze(receipt));
    } catch (error) {
      this.options.onAuditError?.(error, receipt);
    }
  }
}
