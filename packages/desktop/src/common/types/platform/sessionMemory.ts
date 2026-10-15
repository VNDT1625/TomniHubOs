import type { RememberInput, RememberResult, SuperMemorySnapshot } from '@process/userUnderstanding/sessionMemoryStore';

/** Human-owned Core memory controls. Renderer ids are conversation ids, never storage ids. */
export const SESSION_MEMORY_CHANNELS = {
  snapshot: 'core.session-memory.snapshot',
  remember: 'core.session-memory.remember',
  clear: 'core.session-memory.clear',
  forget: 'core.session-memory.forget',
} as const;

export type SessionMemorySnapshot = SuperMemorySnapshot & { truncated?: boolean };
export type SessionMemoryResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type SessionMemoryRequest = { sessionId: string };
export type SessionMemoryRememberRequest = SessionMemoryRequest & RememberInput;
export type SessionMemoryForgetRequest = SessionMemoryRequest & { itemId: string };
export type SessionMemoryNativeAPI = {
  snapshot: (request: SessionMemoryRequest) => Promise<SessionMemoryResult<SessionMemorySnapshot>>;
  remember: (request: SessionMemoryRememberRequest) => Promise<SessionMemoryResult<RememberResult>>;
  clear: (request: SessionMemoryRequest) => Promise<SessionMemoryResult<boolean>>;
  /** Drops one Save item. The renderer addresses it by the item id from the snapshot. */
  forget: (request: SessionMemoryForgetRequest) => Promise<SessionMemoryResult<boolean>>;
};
