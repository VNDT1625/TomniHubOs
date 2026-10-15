/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HubActivityItem,
  HubActivityKind,
  HubActivitySnapshot,
    HubActivityStatus,
  HubActivityStep,
  HubActivityToolTrace,
} from '@/common/types/agent/hubActivity';

const MAX_STEPS = 8;
const MAX_TRACE_CALLS = 120;
const MAX_TITLE = 120;
const MAX_TASK = 280;
const MAX_PREVIEW = 8_000;
const MAX_STEP_LABEL = 120;
const DEFAULT_MAX_ITEMS = 60;
/** Non-agent activity can expire; agent tiles stay until explicitly dismissed by the user. */
const DEFAULT_FINISHED_TTL_MS = 30 * 60 * 1000;
const DEFAULT_THROTTLE_MS = 200;
/** One write per change burst: activity streams fire many events in a row. */
const DEFAULT_PERSIST_DELAY_MS = 1_000;

const TERMINAL_STATUSES = new Set<HubActivityStatus>(['done', 'error', 'stopped']);
/** Attention first: blocked on the user, then failures, then live work, then finished. */
const STATUS_ORDER: Record<HubActivityStatus, number> = {
  needs_input: 0,
  error: 1,
  running: 2,
  stopped: 3,
  done: 4,
};

const clip = (value: string | undefined, max: number): string | undefined => {
  if (value === undefined) return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** Bounds untrusted activity payloads without flattening Markdown line structure. */
export const tailText = (value: string, max = MAX_PREVIEW): string => {
  const text = value.replace(/\r\n?/g, '\n').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const RESTORED_KINDS = new Set<HubActivityKind>(['agent', 'team', 'schedule', 'app']);
const RESTORED_STATUSES = new Set<HubActivityStatus>(['running', 'needs_input', 'done', 'error', 'stopped']);
/** Restored routes may only reach the renderer's own conversation/schedule/team surfaces. */
const RESTORED_ROUTE = /^\/(?:conversation|scheduled|team)\/[A-Za-z0-9._:-]{1,200}$/;

const boundedText = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

const readRestoredStep = (raw: unknown): HubActivityStep | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const id = boundedText(input.id, 200);
  const state = input.state;
  if (!id || (state !== 'running' && state !== 'done' && state !== 'error')) return undefined;
  const label = typeof input.label === 'string' ? clip(input.label, MAX_STEP_LABEL) : undefined;
  return { id, label: label ?? id, state };
};

/** Validates one persisted entry. The file lives on disk, so it is untrusted input. */
const readRestoredItem = (raw: unknown): HubActivityItem | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const kind = input.kind;
  const status = input.status;
  const sourceId = boundedText(input.sourceId, 512);
  const startedAt = input.startedAt;
  const updatedAt = input.updatedAt;
  if (typeof kind !== 'string' || !RESTORED_KINDS.has(kind as HubActivityKind)) return undefined;
  if (typeof status !== 'string' || !RESTORED_STATUSES.has(status as HubActivityStatus)) return undefined;
  if (!sourceId || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return undefined;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return undefined;
  const steps: HubActivityStep[] = [];
  if (Array.isArray(input.steps)) {
    for (const candidate of input.steps) {
      const step = readRestoredStep(candidate);
      if (step) steps.push(step);
      if (steps.length >= MAX_STEPS) break;
    }
  }
  const route = typeof input.route === 'string' && RESTORED_ROUTE.test(input.route) ? input.route : undefined;
  return {
    id: '',
    kind: kind as HubActivityKind,
    sourceId,
    title: boundedText(input.title, MAX_TITLE) ?? sourceId,
    task: typeof input.task === 'string' ? clip(input.task, MAX_TASK) : undefined,
    workspace: boundedText(input.workspace, 600),
    status: status as HubActivityStatus,
    startedAt,
    updatedAt,
    steps,
    preview: typeof input.preview === 'string' ? input.preview : undefined,
    // Never restored: the permission the prompt waited on died with the old process.
    prompt: undefined,
    agentName: typeof input.agentName === 'string' ? clip(input.agentName, MAX_TITLE) : undefined,
    model: typeof input.model === 'string' ? clip(input.model, MAX_TITLE) : undefined,
    route,
    appId: boundedText(input.appId, 120),
    canStop: input.canStop === true,
  };
};

export type HubActivityPatch = Partial<
  Pick<
    HubActivityItem,
    | 'title'
    | 'task'
    | 'workspace'
    | 'status'
    | 'preview'
    | 'prompt'
    | 'route'
    | 'appId'
    | 'canStop'
    | 'startedAt'
    | 'agentName'
    | 'model'
  >
> & { steps?: HubActivityStep[] };

/** Source-side control, registered per kind by the subsystem that owns the work. */
export type HubActivityController = {
  stop?: (sourceId: string) => Promise<boolean>;
  respond?: (sourceId: string, promptId: string, value: string) => Promise<boolean>;
};

export type HubActivityRegistryOptions = {
  now?: () => number;
  finishedTtlMs?: number;
  maxItems?: number;
  throttleMs?: number;
  persistDelayMs?: number;
};

const idFor = (kind: HubActivityKind, sourceId: string): string => `${kind}:${sourceId}`;

/** Main-owned, bounded registry of live Hub work. Sources push; Home and remote surfaces read. */
export class HubActivityRegistry {
    private readonly items = new Map<string, HubActivityItem>();
  /** Ephemeral redacted call details, intentionally excluded from snapshots and disk. */
    private readonly traces = new Map<string, HubActivityToolTrace[]>();
  private readonly traceOrdinals = new Map<string, number>();
  private readonly controllers = new Map<HubActivityKind, HubActivityController>();
  private readonly listeners = new Set<(snapshot: HubActivitySnapshot) => void>();
  private readonly now: () => number;
  private readonly finishedTtlMs: number;
  private readonly maxItems: number;
  private readonly throttleMs: number;
  private pending: ReturnType<typeof setTimeout> | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private readonly answering = new Set<string>();
  private readonly persistDelayMs: number;
  private persist: ((items: HubActivityItem[]) => void | Promise<void>) | undefined;
  private persistPending: ReturnType<typeof setTimeout> | undefined;
  private persistedDuringProcess = false;
  private persistSequence: Promise<void> = Promise.resolve();

  public constructor(options: HubActivityRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.finishedTtlMs = options.finishedTtlMs ?? DEFAULT_FINISHED_TTL_MS;
    this.maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    this.throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
    this.persistDelayMs = options.persistDelayMs ?? DEFAULT_PERSIST_DELAY_MS;
  }

  public registerController(kind: HubActivityKind, controller: HubActivityController): void {
    this.controllers.set(kind, controller);
  }

  /** Attaches the restart-safe writer; the first change is written immediately, later changes are batched. */
  public setPersister(persist: ((items: HubActivityItem[]) => void | Promise<void>) | undefined): void {
    if (this.persistPending) {
      clearTimeout(this.persistPending);
      this.persistPending = undefined;
    }
    this.persistedDuringProcess = false;
    this.persist = persist;
    if (persist && this.items.size > 0) {
      this.persistedDuringProcess = true;
      this.persistSnapshot();
    }
  }

  /**
   * Restores a persisted grid after a restart, treating the file as untrusted:
   * malformed entries are dropped, a live event for the same id wins, and work
   * that never finished returns as stopped with its prompt removed because the
   * permission it waited on died with the previous process.
   */
  public hydrate(restored: unknown): void {
    if (!Array.isArray(restored)) return;
    const cutoff = this.now() - this.finishedTtlMs;
    for (const raw of restored) {
      const item = readRestoredItem(raw);
      if (!item) continue;
      const id = idFor(item.kind, item.sourceId);
      if (this.items.has(id)) continue;
      if (TERMINAL_STATUSES.has(item.status)) {
        if (item.kind !== 'agent' && item.updatedAt <= cutoff) continue;
      } else {
        item.status = 'stopped';
        item.canStop = false;
        item.prompt = undefined;
        item.steps = item.steps.map((step) => (step.state === 'running' ? { ...step, state: 'error' } : step));
      }
      this.items.set(id, { ...item, id });
    }
    this.prune();
  }

  /** Subscribes to coalesced snapshots. Returns an unsubscribe function. */
  public subscribe(listener: (snapshot: HubActivitySnapshot) => void): () => void {
    this.listeners.add(listener);
    this.refreshExpiry();
    return () => {
      this.listeners.delete(listener);
      this.refreshExpiry();
    };
  }

  public get(kind: HubActivityKind, sourceId: string): HubActivityItem | undefined {
    return this.items.get(idFor(kind, sourceId));
  }

  /** Creates or merges an item. A missing title falls back to the source id. */
  public upsert(kind: HubActivityKind, sourceId: string, patch: HubActivityPatch): HubActivityItem {
    const id = idFor(kind, sourceId);
    const at = this.now();
    const current = this.items.get(id);
    const next: HubActivityItem = {
      id,
      kind,
      sourceId,
      title: clip(patch.title, MAX_TITLE) ?? current?.title ?? sourceId,
      task: 'task' in patch ? clip(patch.task, MAX_TASK) : current?.task,
      workspace: 'workspace' in patch ? patch.workspace : current?.workspace,
      status: patch.status ?? current?.status ?? 'running',
      startedAt: patch.startedAt ?? current?.startedAt ?? at,
      updatedAt: at,
      steps: (patch.steps ?? current?.steps ?? []).slice(-MAX_STEPS),
      preview: 'preview' in patch ? patch.preview : current?.preview,
      prompt: 'prompt' in patch ? patch.prompt : current?.prompt,
      route: 'route' in patch ? patch.route : current?.route,
      agentName: 'agentName' in patch ? clip(patch.agentName, MAX_TITLE) : current?.agentName,
      model: 'model' in patch ? clip(patch.model, MAX_TITLE) : current?.model,
      appId: 'appId' in patch ? patch.appId : current?.appId,
      canStop: patch.canStop ?? current?.canStop ?? false,
    };
    // A finished item can never stay blocked on a prompt nobody can answer.
    if (TERMINAL_STATUSES.has(next.status)) next.prompt = undefined;
    this.items.set(id, next);
    this.prune();
    this.schedule();
    this.schedulePersist();
    return next;
  }

    /** Merge one redacted tool update. The only caller is Main's sanitizing projector. */
  public traceTool(kind: HubActivityKind, sourceId: string, call: HubActivityToolTrace): void {
    const id = idFor(kind, sourceId);
    if (!this.items.has(id)) return;
    const calls = [...(this.traces.get(id) ?? [])];
    const index = calls.findIndex((entry) => entry.id === call.id);
    if (index >= 0) {
      const previous = calls[index]!;
      calls.splice(index, 1, {
        ...previous,
        ...call,
        input: call.input ?? previous.input,
        output: call.output ?? previous.output,
        durationMs: call.durationMs ?? previous.durationMs,
        startedAtMs: call.startedAtMs ?? previous.startedAtMs,
        finishedAtMs: call.finishedAtMs ?? previous.finishedAtMs,
      });
        } else {
      const ordinal = (this.traceOrdinals.get(id) ?? 0) + 1;
      this.traceOrdinals.set(id, ordinal);
      calls.push({ ...call, ordinal });
    }
    this.traces.set(id, calls.slice(-MAX_TRACE_CALLS));
    this.schedule();
  }

  public toolTrace(kind: HubActivityKind, sourceId: string): HubActivityToolTrace[] {
    const id = idFor(kind, sourceId);
        return this.items.has(id) ? (this.traces.get(id) ?? []).map((call) => Object.assign({}, call)) : [];
  }

  public clearToolTrace(kind: HubActivityKind, sourceId: string): void {
        this.traces.delete(idFor(kind, sourceId));
    this.traceOrdinals.delete(idFor(kind, sourceId));
  }

  /** Adds or updates one step by id, keeping the newest {@link MAX_STEPS}. */
  public step(kind: HubActivityKind, sourceId: string, step: HubActivityStep): void {
    const current = this.items.get(idFor(kind, sourceId));
    const label = clip(step.label, MAX_STEP_LABEL) ?? step.id;
    const steps = [...(current?.steps ?? [])];
    const index = steps.findIndex((candidate) => candidate.id === step.id);
    if (index >= 0) steps[index] = { ...step, label };
    else steps.push({ ...step, label });
    this.upsert(kind, sourceId, { steps });
  }

  public remove(kind: HubActivityKind, sourceId: string): void {
            this.traces.delete(idFor(kind, sourceId));
    this.traceOrdinals.delete(idFor(kind, sourceId));
    if (this.items.delete(idFor(kind, sourceId))) {
      this.refreshExpiry();
      this.schedule();
      this.schedulePersist();
    }
  }

  public snapshot(): HubActivitySnapshot {
    this.prune();
    const items = [...this.items.values()].toSorted(
      (left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || right.startedAt - left.startedAt
    );
    return { generatedAt: this.now(), items };
  }

  public async stop(id: string): Promise<boolean> {
    const item = this.items.get(id);
    const stop = item ? this.controllers.get(item.kind)?.stop : undefined;
    if (!item || !item.canStop || !stop || TERMINAL_STATUSES.has(item.status)) return false;
    return stop(item.sourceId);
  }

  /** Answers the item's open prompt. The prompt id must match: a stale button never resolves a newer request. */
  public async respond(id: string, promptId: string, value: string): Promise<boolean> {
    const item = this.items.get(id);
    const respond = item ? this.controllers.get(item.kind)?.respond : undefined;
    if (!item?.prompt || item.status !== 'needs_input' || item.prompt.id !== promptId || !respond) return false;
    if (this.answering.has(id) || !item.prompt.options.some((option) => option.value === value)) return false;
    this.answering.add(id);
    try {
      const resolved = await respond(item.sourceId, promptId, value);
      const current = this.items.get(id);
      // Source events may finish/delete the item or open another prompt while approval is pending.
      if (resolved && current?.status === 'needs_input' && current.prompt === item.prompt) {
        this.upsert(item.kind, item.sourceId, { prompt: undefined, status: 'running' });
      }
      return resolved;
    } finally {
      this.answering.delete(id);
    }
  }

  /** Removes a finished item from view. Running work cannot be dismissed, only stopped. */
  public dismiss(id: string): boolean {
    const item = this.items.get(id);
    if (!item || !TERMINAL_STATUSES.has(item.status)) return false;
        this.items.delete(id);
        this.traces.delete(id);
    this.traceOrdinals.delete(id);
    this.refreshExpiry();
    this.schedule();
    this.schedulePersist();
    return true;
  }

  public dispose(): void {
    if (this.pending) clearTimeout(this.pending);
    if (this.expiry) clearTimeout(this.expiry);
    if (this.persistPending) clearTimeout(this.persistPending);
    this.pending = undefined;
    this.expiry = undefined;
    this.persistPending = undefined;
        this.listeners.clear();
        this.traces.clear();
    this.traceOrdinals.clear();
  }

  private prune(): void {
    const cutoff = this.now() - this.finishedTtlMs;
    for (const [id, item] of this.items) {
      if (item.kind !== 'agent' && TERMINAL_STATUSES.has(item.status) && item.updatedAt <= cutoff) this.items.delete(id);
    }
    this.refreshExpiry();
    if (this.items.size <= this.maxItems) return;
        // The memory cap applies to ephemeral work, never to user-owned agent tiles.
    // An agent tile is removed only through dismiss() or deletion of its conversation.
        const ordered = [...this.items.values()].filter((item) => item.kind !== 'agent').toSorted(
      (left, right) =>
        Number(TERMINAL_STATUSES.has(right.status)) - Number(TERMINAL_STATUSES.has(left.status)) ||
        left.updatedAt - right.updatedAt
    );
        for (const item of ordered.slice(0, Math.max(0, this.items.size - this.maxItems))) this.items.delete(item.id);
  }

  /** One timer removes finished tiles even when all activity sources have gone quiet. */
  private refreshExpiry(): void {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = undefined;
    if (this.listeners.size === 0) return;
    let deadline = Infinity;
    for (const item of this.items.values()) {
      if (item.kind !== 'agent' && TERMINAL_STATUSES.has(item.status)) {
        deadline = Math.min(deadline, item.updatedAt + this.finishedTtlMs);
      }
    }
    if (!Number.isFinite(deadline)) return;
    this.expiry = setTimeout(
      () => {
        this.expiry = undefined;
        this.prune();
        this.schedule();
      },
      Math.max(1, deadline - this.now())
    );
    this.expiry.unref?.();
  }

  /** The first activity is durable immediately; later bursts are collapsed without reordering async writes. */
  private schedulePersist(): void {
    if (!this.persist) return;
    if (!this.persistedDuringProcess) {
      this.persistedDuringProcess = true;
      this.persistSnapshot();
      return;
    }
    if (this.persistPending) return;
    this.persistPending = setTimeout(() => {
      this.persistPending = undefined;
      this.persistSnapshot();
    }, this.persistDelayMs);
    this.persistPending.unref?.();
  }

  private persistSnapshot(): void {
    const persist = this.persist;
    if (!persist) return;
    const items = this.snapshot().items;
    this.persistSequence = this.persistSequence
      .then(() => persist(items))
      .catch((error: unknown) => console.error('[HubActivity] grid write failed:', error));
  }

  private schedule(): void {
    if (this.pending || this.listeners.size === 0) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      const snapshot = this.snapshot();
      for (const listener of this.listeners) {
        try {
          listener(snapshot);
        } catch (error) {
          console.error('[HubActivity] listener failed:', error);
        }
      }
    }, this.throttleMs);
    this.pending.unref?.();
  }
}

let shared: HubActivityRegistry | undefined;

/** The process-wide registry every source reports to. */
export const getHubActivityRegistry = (): HubActivityRegistry => {
  shared ??= new HubActivityRegistry();
  return shared;
};
