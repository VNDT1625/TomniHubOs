/* oxlint-disable no-await-in-loop -- side effects are ordered and bounded per sender session. */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, opendir, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { AttachmentQuickView } from '@/common/chat/attachmentQuickView';
import type {
  ExplorerActionOutcome,
  ExplorerActionRequest,
  ExplorerErrorCode,
  ExplorerListing,
  ExplorerOperation,
  ExplorerSession,
} from '@/common/types/platform/explorer';
import {
  canonicalRoot,
  checkOperation,
  ExplorerServiceError,
  existingType,
  parseRelativePath,
  resolveExisting,
  resolveNew,
  serviceError,
  type ExplorerRoot,
  type ExistingType,
  type OperationGuard,
} from './pathGuard';
import {
  copyTree,
  DEFAULT_EXPLORER_LIMITS,
  sameIdentity,
  scanTrees,
  verifyTree,
  type ExplorerLimits,
  type TreeItem,
} from './treeOperations';

export { ExplorerServiceError } from './pathGuard';

export type ExplorerAuditReceipt = Readonly<{
  receiptId: string;
  sessionId: string;
  ownerId: number;
  operation: ExplorerOperation;
  status: 'proposed' | 'completed' | 'failed' | 'cancelled' | 'denied';
  timestamp: number;
  paths: readonly string[];
  targets: readonly string[];
  affectedPaths: readonly string[];
  errorCode?: ExplorerErrorCode;
}>;

export type ExplorerServiceDeps = Readonly<{
  /** Must durably flush before resolving. An audit failure prevents new side effects. */
  appendAudit: (receipt: ExplorerAuditReceipt) => Promise<void>;
  /** Native Main-owned confirmation for the exact request and canonical targets. */
  approveMutation: (
    request: ExplorerActionRequest,
    canonicalPaths: readonly string[],
    ownerId: number
  ) => Promise<boolean>;
  /** Decides whether any canonical path is on the user's block list; always in Main. */
  isBlocked?: (canonicalPaths: readonly string[]) => Promise<boolean>;
  /** Mutate the block list. When present, block/unblock operations are enabled. */
  blockMutation?: (
    operation: 'block' | 'unblock',
    canonicalPaths: readonly string[],
    request: ExplorerActionRequest
  ) => Promise<void>;
  /** Recoverable OS trash only; permanent recursive deletion is never a fallback. */
  trashItem: (absolutePath: string) => Promise<void>;
  /** Native no-replace move. It must preserve metadata and fail on cross-volume moves. */
  moveItem?: (sourcePath: string, destinationPath: string) => Promise<void>;
  openItem?: (absolutePath: string) => Promise<void>;
  revealItem?: (absolutePath: string) => Promise<void>;
  now?: () => number;
  limits?: Partial<ExplorerLimits>;
}>;

type RetainedSession = {
  root: ExplorerRoot;
  owner: number;
  expiresAt: number;
  controller: AbortController;
  busy: boolean;
};
type PreparedAction = { sources: string[]; targets: string[]; canonicalPaths: string[]; tree: TreeItem[] };
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 32;
const MAX_SELECTION = 100;
const QUICK_VIEW_TEXT_EXTENSIONS = new Set([
  '.c', '.cpp', '.css', '.csv', '.go', '.h', '.java', '.js', '.json', '.jsx', '.log', '.md', '.markdown',
  '.py', '.rs', '.text', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);
const QUICK_VIEW_IMAGE_EXTENSIONS = new Set(['.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp']);
const QUICK_VIEW_MAX_BYTES = 256 * 1024;
const QUICK_VIEW_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const QUICK_VIEW_MAX_CHARS = 16_000;
const MIME_BY_EXTENSION: Record<string, string> = {
  '.bmp': 'image/bmp', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};
const publicPath = (value: string): string => value.split(path.sep).join('/');
const mimeFor = (filePath: string): string => MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
const contains = (parent: string, child: string): boolean => {
  const relation = path.relative(parent, child);
  return relation === '' || (!relation.startsWith('..' + path.sep) && relation !== '..' && !path.isAbsolute(relation));
};

/** Human Explorer authority is issued by Main and cannot be reused by another sender. */
export class ExplorerService {
  private readonly sessions = new Map<string, RetainedSession>();
  private pendingSessions = 0;
  private readonly now: () => number;
  private readonly limits: ExplorerLimits;

  constructor(private readonly deps: ExplorerServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.limits = { ...DEFAULT_EXPLORER_LIMITS, ...deps.limits };
    for (const [key, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > DEFAULT_EXPLORER_LIMITS[key as keyof ExplorerLimits])
        throw new ExplorerServiceError('INVALID_REQUEST');
    }
  }

  async openSession(owner: number, root: string): Promise<ExplorerSession> {
    let reserved = false;
    try {
      if (!Number.isSafeInteger(owner) || owner < 0) throw new ExplorerServiceError('DENIED');
      for (const [id, retained] of this.sessions) if (retained.expiresAt <= this.now()) this.close(retained.owner, id);
      if (this.sessions.size + this.pendingSessions >= MAX_SESSIONS) throw new ExplorerServiceError('LIMIT_EXCEEDED');
      this.pendingSessions++;
      reserved = true;
      const canonical = await canonicalRoot(root);
      const id = randomUUID();
      const expiresAt = this.now() + SESSION_TTL_MS;
      this.sessions.set(id, { root: canonical, owner, expiresAt, controller: new AbortController(), busy: false });
      return { id, root: canonical.path, expiresAt };
    } catch (error) {
      throw serviceError(error);
    } finally {
      if (reserved) this.pendingSessions--;
    }
  }

  close(owner: number, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.owner !== owner) return;
    session.controller.abort();
    this.sessions.delete(sessionId);
  }

  closeOwner(owner: number): void {
    for (const [id, session] of this.sessions) if (session.owner === owner) this.close(owner, id);
  }

  private session(owner: number, sessionId: string): RetainedSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.owner !== owner) throw new ExplorerServiceError('DENIED');
    if (session.controller.signal.aborted) throw new ExplorerServiceError('CANCELLED');
    if (session.expiresAt <= this.now()) {
      this.close(owner, sessionId);
      throw new ExplorerServiceError('SESSION_EXPIRED');
    }
    return session;
  }

  private guard(owner: number, sessionId: string, session: RetainedSession): OperationGuard {
    return {
      deadline: this.now() + this.limits.timeoutMs,
      signal: session.controller.signal,
      now: this.now,
      assertActive: () => {
        this.session(owner, sessionId);
      },
    };
  }

  async list(owner: number, sessionId: string, relativePath: string): Promise<ExplorerListing> {
    try {
      const session = this.session(owner, sessionId);
      const guard = this.guard(owner, sessionId, session);
      const normalized = parseRelativePath(relativePath, true);
      const target = await resolveExisting(session.root, normalized, true);
      if (!target.info.isDirectory()) throw new ExplorerServiceError('INVALID_REQUEST');
      const listing: ExplorerListing = { relativePath: publicPath(normalized), entries: [], truncated: false };
      const directory = await opendir(target.path);
      let visited = 0;
      for await (const child of directory) {
        checkOperation(guard);
        if (visited++ >= this.limits.maxEntries) {
          listing.truncated = true;
          break;
        }
        if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile())) continue;
        try {
          parseRelativePath(child.name);
        } catch {
          continue;
        }
        const childPath = path.join(normalized, child.name);
        const entry = await resolveExisting(session.root, childPath);
        const absolute = path.join(target.path, path.relative(normalized || '.', childPath));
        listing.entries.push({
          name: child.name,
          relativePath: publicPath(childPath),
          isDirectory: entry.info.isDirectory(),
          size: entry.info.isDirectory() ? 0 : entry.info.size,
          modifiedAt: entry.info.mtimeMs,
          blocked: await this.isPathBlocked(absolute),
        });
      }
      listing.entries.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
      checkOperation(guard);
      return listing;
    } catch (error) {
      throw serviceError(error);
    }
  }

  /** True when the path itself OR any of its ancestors is on the block list. */
  private async isPathBlocked(absolute: string): Promise<boolean> {
    if (!this.deps.isBlocked) return false;
    let probe: string | undefined = absolute;
    while (probe) {
      if (await this.deps.isBlocked([probe])) return true;
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    return false;
  }

  async resolveForOpen(owner: number, sessionId: string, relativePath: string): Promise<string> {
    try {
      const session = this.session(owner, sessionId);
      return (await resolveExisting(session.root, relativePath, true)).path;
    } catch (error) {
      throw serviceError(error);
    }
  }

  async quickView(owner: number, sessionId: string, relativePath: string): Promise<AttachmentQuickView> {
    try {
      const session = this.session(owner, sessionId);
      const target = await resolveExisting(session.root, relativePath);
      if (target.info.isDirectory()) {
        return { kind: 'metadata', name: path.basename(target.path), size: 0, reason: 'directory' };
      }
      const extension = path.extname(target.path).toLowerCase();
      if (QUICK_VIEW_IMAGE_EXTENSIONS.has(extension)) {
        if (target.info.size > QUICK_VIEW_MAX_IMAGE_BYTES) {
          return { kind: 'metadata', name: path.basename(target.path), size: target.info.size, reason: 'too-large' };
        }
        const data = await readFile(target.path);
        const metadata = await sharp(data, { animated: false })
          .metadata()
          .catch((): undefined => undefined);
        if (!metadata?.width || !metadata.height) {
          return { kind: 'metadata', name: path.basename(target.path), size: target.info.size, reason: 'unsupported' };
        }
        return {
          kind: 'image',
          dataUrl: `data:${mimeFor(target.path)};base64,${data.toString('base64')}`,
          width: metadata.width,
          height: metadata.height,
        };
      }
      if (!QUICK_VIEW_TEXT_EXTENSIONS.has(extension)) {
        return { kind: 'metadata', name: path.basename(target.path), size: target.info.size, reason: 'unsupported' };
      }
      if (target.info.size > QUICK_VIEW_MAX_BYTES) {
        return { kind: 'metadata', name: path.basename(target.path), size: target.info.size, reason: 'too-large' };
      }
      const content = await readFile(target.path, 'utf8');
      if (content.includes('\0')) {
        return { kind: 'metadata', name: path.basename(target.path), size: target.info.size, reason: 'unsupported' };
      }
      return { kind: 'text', content: content.slice(0, QUICK_VIEW_MAX_CHARS), truncated: content.length > QUICK_VIEW_MAX_CHARS };
    } catch (error) {
      throw serviceError(error);
    }
  }

  private async prepare(
    session: RetainedSession,
    request: ExplorerActionRequest,
    guard: OperationGuard
  ): Promise<PreparedAction> {
    const operations: ExplorerOperation[] = [
      'create-file',
      'create-directory',
      'rename',
      'copy',
      'move',
      'delete',
      'open',
      'reveal',
      'block',
      'unblock',
    ];
    if (
      !operations.includes(request.operation) ||
      !Array.isArray(request.paths) ||
      !request.paths.length ||
      request.paths.length > MAX_SELECTION
    )
      throw new ExplorerServiceError('INVALID_REQUEST');
    if (
      Object.keys(request).some(
        (key) => !['sessionId', 'operation', 'paths', 'destination', 'name', 'autoRename'].includes(key)
      )
    )
      throw new ExplorerServiceError('INVALID_REQUEST');
    if (request.autoRename !== undefined && typeof request.autoRename !== 'boolean')
      throw new ExplorerServiceError('INVALID_REQUEST');
    const creating = request.operation === 'create-file' || request.operation === 'create-directory';
    const naming = creating || request.operation === 'rename';
    const transferring = request.operation === 'copy' || request.operation === 'move';
    const handoff = request.operation === 'open' || request.operation === 'reveal';
    const blocking = request.operation === 'block' || request.operation === 'unblock';
    if (((naming || handoff) && request.paths.length !== 1) || (blocking && request.paths.length === 0))
      throw new ExplorerServiceError('INVALID_REQUEST');
    if (naming) {
      if (typeof request.name !== 'string' || parseRelativePath(request.name).includes(path.sep))
        throw new ExplorerServiceError('INVALID_REQUEST');
    } else if (request.name !== undefined) throw new ExplorerServiceError('INVALID_REQUEST');
    if (transferring ? typeof request.destination !== 'string' : request.destination !== undefined)
      throw new ExplorerServiceError('INVALID_REQUEST');
    let sources = request.paths.map((value) => parseRelativePath(value, creating || handoff));
    let absoluteSources: string[] = [];
    let sourceSnapshots: TreeItem[] = [];
    let incomingTypes: ExistingType[] = [];
    for (const source of sources) {
      checkOperation(guard);
      const entry = await resolveExisting(session.root, source, creating || handoff);
      if (creating && !entry.info.isDirectory()) throw new ExplorerServiceError('INVALID_REQUEST');
      absoluteSources.push(entry.path);
      sourceSnapshots.push({ relativePath: source, info: entry.info });
      // A create makes a NEW node whose type is the request, not the parent directory type.
      incomingTypes.push(
        creating
          ? request.operation === 'create-directory'
            ? 'directory'
            : 'file'
          : entry.info.isDirectory()
            ? 'directory'
            : 'file'
      );
    }
    if (
      absoluteSources.some((source, index) =>
        absoluteSources.some((other, otherIndex) => index !== otherIndex && contains(source, other))
      )
    )
      throw new ExplorerServiceError('INVALID_REQUEST');
    const reserved = new Map<string, ExistingType>();
    const keyOf = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value);
    // Resolve one requested target. ANY occupant of the exact name (same or different type) is a
    // duplicate: without autoRename the run fails and offers the first free `name (n)` sibling as
    // suggestedName; with autoRename it resolves to that sibling directly. Suffixes start at (1).
    const resolveTarget = async (requested: string, incoming: ExistingType): Promise<string> => {
      const parsed = path.parse(requested);
      const parent = path.dirname(requested);
      const existing = await existingType(session.root, requested);
      const reservedExisting = reserved.get(keyOf(requested));
      if (existing === null && reservedExisting === undefined) {
        reserved.set(keyOf(requested), incoming);
        return requested;
      }
      let suggestion: string | undefined;
      for (let counter = 1; counter <= 1000; counter++) {
        const candidate =
          parent === '.'
            ? `${parsed.name} (${counter})${parsed.ext}`
            : path.join(parent, `${parsed.name} (${counter})${parsed.ext}`);
        if ((await existingType(session.root, candidate)) !== null || reserved.get(keyOf(candidate)) !== undefined)
          continue;
        if (request.autoRename === true) {
          reserved.set(keyOf(candidate), incoming);
          return candidate;
        }
        suggestion = path.basename(candidate);
        break;
      }
      const conflict = new ExplorerServiceError('CONFLICT');
      if (suggestion !== undefined) conflict.suggestedName = suggestion;
      throw conflict;
    };
    let targets: string[] = [];
    let absoluteTargets: string[] = [];
    if (blocking) {
      targets = [];
    } else if (creating) {
      targets = [await resolveTarget(path.join(sources[0], request.name!), incomingTypes[0])];
    } else if (request.operation === 'rename') {
      targets = [await resolveTarget(path.join(path.dirname(sources[0]), request.name!), incomingTypes[0])];
    } else if (transferring) {
      const destination = parseRelativePath(request.destination!, true);
      if (!(await resolveExisting(session.root, destination, true)).info.isDirectory())
        throw new ExplorerServiceError('INVALID_REQUEST');
      // A move dropped onto the item's own containing folder is a no-op, not a duplicate; copy
      // onto the same path stays a real conflict (the OS forbids it too).
      if (request.operation === 'move') {
        const keep = sources.map((source) => keyOf(path.join(destination, path.basename(source))) !== keyOf(source));
        if (keep.some((value) => !value)) {
          sources = sources.filter((_source, index) => keep[index]);
          absoluteSources = absoluteSources.filter((_source, index) => keep[index]);
          sourceSnapshots = sourceSnapshots.filter((_source, index) => keep[index]);
          incomingTypes = incomingTypes.filter((_type, index) => keep[index]);
        }
      }
      targets = [];
      for (let index = 0; index < sources.length; index++)
        targets.push(await resolveTarget(path.join(destination, path.basename(sources[index])), incomingTypes[index]));
    }
    for (const target of targets) {
      const absoluteTarget = await resolveNew(session.root, target);
      if (absoluteSources.some((source) => contains(source, absoluteTarget)) && !creating)
        throw new ExplorerServiceError('INVALID_REQUEST');
      absoluteTargets.push(absoluteTarget);
    }
    const canonicalPaths = [...absoluteSources, ...absoluteTargets];
    const tree =
      request.operation === 'copy' || request.operation === 'delete'
        ? await scanTrees(session.root, sources, this.limits, guard)
        : sourceSnapshots;
    return { sources, targets, canonicalPaths, tree };
  }

  private async audit(receipt: ExplorerAuditReceipt): Promise<void> {
    try {
      await this.deps.appendAudit(receipt);
    } catch {
      throw new ExplorerServiceError('AUDIT_FAILED');
    }
  }

  async action(owner: number, request: ExplorerActionRequest): Promise<ExplorerActionOutcome> {
    const session = this.session(owner, request.sessionId);
    if (session.busy) throw new ExplorerServiceError('BUSY');
    session.busy = true;
    const blocking = request.operation === 'block' || request.operation === 'unblock';
    const receiptId = randomUUID();
    const affectedPaths: string[] = [];
    let targetPaths: string[] = [];
    let proposed = false;
    let nativeEffectAttempted = false;
    const receipt = (status: ExplorerAuditReceipt['status'], errorCode?: ExplorerErrorCode): ExplorerAuditReceipt => ({
      receiptId,
      sessionId: request.sessionId,
      ownerId: owner,
      operation: request.operation,
      status,
      timestamp: this.now(),
      paths: request.paths.map(publicPath),
      targets: targetPaths,
      affectedPaths: [...affectedPaths],
      ...(errorCode ? { errorCode } : {}),
    });
    try {
      let guard = this.guard(owner, request.sessionId, session);
      const prepared = await this.prepare(session, request, guard);
      targetPaths = prepared.targets.map(publicPath);
      // A move dropped onto its own containing folder resolves to zero sources: nothing to consent
      // to and nothing to mutate, but the run still records a terminal completed receipt.
      if (request.operation === 'move' && prepared.sources.length === 0) {
        await this.audit(receipt('completed'));
        return { receiptId, affectedPaths };
      }
      // A block/unblock operation acts on the block list itself; a source-containing mutation must
      // never touch a blocked tree. block/unblock are exempt because the user is managing the block list.
      if (!blocking && this.deps.isBlocked) {
        if (await this.deps.isBlocked(prepared.canonicalPaths)) throw new ExplorerServiceError('DENIED');
      }
      await this.audit(receipt('proposed'));
      proposed = true;
      const approved = await this.deps.approveMutation(request, prepared.canonicalPaths, owner);
      this.session(owner, request.sessionId);
      if (!approved) throw new ExplorerServiceError('CANCELLED');
      // Consent may take time; the filesystem budget starts after native confirmation.
      guard = this.guard(owner, request.sessionId, session);
      await verifyTree(session.root, prepared.tree, guard);
      const record = (relativePath: string): void => {
        affectedPaths.push(publicPath(relativePath));
      };
      if (request.operation === 'block' || request.operation === 'unblock') {
        if (!this.deps.blockMutation) throw new ExplorerServiceError('UNAVAILABLE');
        await this.deps.blockMutation(request.operation, prepared.canonicalPaths, request);
        for (const source of prepared.sources) record(source);
      } else if (request.operation === 'create-file') {
        checkOperation(guard);
        const target = await resolveNew(session.root, prepared.targets[0]);
        checkOperation(guard);
        const file = await open(target, 'wx');
        record(prepared.targets[0]);
        try {
          await file.sync();
        } finally {
          await file.close();
        }
      } else if (request.operation === 'create-directory') {
        const target = await resolveNew(session.root, prepared.targets[0]);
        checkOperation(guard);
        await mkdir(target);
        record(prepared.targets[0]);
      } else if (request.operation === 'copy') {
        for (let index = 0; index < prepared.sources.length; index++)
          await copyTree(session.root, prepared.sources[index], prepared.targets[index], prepared.tree, guard, record);
      } else if (request.operation === 'move' || request.operation === 'rename') {
        if (!this.deps.moveItem) throw new ExplorerServiceError('UNAVAILABLE');
        for (let index = 0; index < prepared.sources.length; index++) {
          const source = prepared.sources[index];
          const expected = prepared.tree.find((item) => item.relativePath === source);
          const entry = await resolveExisting(session.root, source);
          if (!expected || !sameIdentity(expected.info, entry.info)) throw new ExplorerServiceError('IO_ERROR');
          const target = await resolveNew(session.root, prepared.targets[index]);
          const currentSource = await resolveExisting(session.root, source);
          if (!sameIdentity(expected.info, currentSource.info)) throw new ExplorerServiceError('IO_ERROR');
          checkOperation(guard);
          nativeEffectAttempted = true;
          await this.deps.moveItem(currentSource.path, target);
          record(source);
          record(prepared.targets[index]);
        }
      } else if (request.operation === 'delete') {
        await verifyTree(session.root, prepared.tree, guard);
        for (const source of prepared.sources) {
          const entry = await resolveExisting(session.root, source);
          const expected = prepared.tree.find((item) => item.relativePath === source);
          if (!expected || !sameIdentity(expected.info, entry.info)) throw new ExplorerServiceError('IO_ERROR');
          checkOperation(guard);
          nativeEffectAttempted = true;
          await this.deps.trashItem(entry.path);
          record(source);
        }
      } else {
        const callback = request.operation === 'open' ? this.deps.openItem : this.deps.revealItem;
        if (!callback) throw new ExplorerServiceError('UNAVAILABLE');
        const entry = await resolveExisting(session.root, prepared.sources[0], true);
        if (!sameIdentity(prepared.tree[0].info, entry.info)) throw new ExplorerServiceError('IO_ERROR');
        checkOperation(guard);
        nativeEffectAttempted = true;
        await callback(entry.path);
        record(prepared.sources[0]);
      }
      await this.audit(receipt('completed'));
      return { receiptId, affectedPaths };
    } catch (error) {
      const safeError = serviceError(error);
      let finalError = safeError;
      try {
        if (proposed && safeError.code !== 'AUDIT_FAILED')
          await this.audit(
            receipt(
              safeError.code === 'CANCELLED' ? 'cancelled' : safeError.code === 'DENIED' ? 'denied' : 'failed',
              safeError.code
            )
          );
      } catch (auditError) {
        finalError = serviceError(auditError);
      }
      if (finalError.code === 'AUDIT_FAILED') {
        this.close(owner, request.sessionId);
      }
      finalError.receiptId = proposed ? receiptId : undefined;
      finalError.affectedPaths = [...affectedPaths];
      finalError.mayHaveCommitted = nativeEffectAttempted || affectedPaths.length > 0;
      throw finalError;
    } finally {
      session.busy = false;
    }
  }
}

export const createExplorerService = (deps: ExplorerServiceDeps): ExplorerService => new ExplorerService(deps);
