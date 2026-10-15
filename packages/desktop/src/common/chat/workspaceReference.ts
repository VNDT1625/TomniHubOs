/**
 * Renderer-safe workspace reference contracts and Explorer drag payload parsing.
 * Paths are relative to the active, main-process-owned workspace root.
 */

export type WorkspaceReferenceKind = 'file' | 'folder';

export type WorkspaceReferenceProjectionStatus = 'pending' | 'inline' | 'summary' | 'path-only' | 'unavailable' | 'stale';

export type WorkspaceReferenceAttachment = {
  id: string;
  relativePath: string;
  name: string;
  kind: WorkspaceReferenceKind;
  projectionStatus: WorkspaceReferenceProjectionStatus;
};

export type WorkspaceReferenceRequest = Pick<WorkspaceReferenceAttachment, 'relativePath' | 'kind'> & {
  /** Existing Explorer session that Main binds to the renderer sender for quick view only. */
  sessionId?: string;
};

const MAX_REFERENCE_PATHS = 32;
const MAX_REFERENCE_PATH_LENGTH = 1024;

const normalizeRelativePath = (value: string): string | undefined => {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.length > MAX_REFERENCE_PATH_LENGTH) return undefined;
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return undefined;
  if (normalized.split('/').some((segment) => segment === '..' || segment.length === 0)) return undefined;
  return normalized;
};

/** Parses the legacy Explorer path-only payload; invalid payloads produce no references. */
export const parseExplorerReferencePayload = (payload: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed) || parsed.length > MAX_REFERENCE_PATHS || !parsed.every((value) => typeof value === 'string')) {
      return [];
    }
    const paths = parsed.map(normalizeRelativePath);
    if (paths.some((path) => path === undefined)) return [];
    return [...new Set(paths as string[])];
  } catch {
    return [];
  }
};

/** Parses typed Explorer entries. Renderer metadata is revalidated by main process before use. */
export const parseExplorerReferenceEntriesPayload = (payload: string): WorkspaceReferenceRequest[] => {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed) || parsed.length > MAX_REFERENCE_PATHS) return [];
    const entries = parsed.map((value): WorkspaceReferenceRequest | undefined => {
      if (!value || typeof value !== 'object') return undefined;
      const { relativePath, kind, sessionId } = value as {
        relativePath?: unknown;
        kind?: unknown;
        sessionId?: unknown;
      };
      const normalized = typeof relativePath === 'string' ? normalizeRelativePath(relativePath) : undefined;
      if (!normalized || (kind !== 'file' && kind !== 'folder')) return undefined;
      return {
        relativePath: normalized,
        kind,
        ...(typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 128 ? { sessionId } : {}),
      };
    });
    if (entries.some((entry) => entry === undefined)) return [];
    return [...new Map((entries as WorkspaceReferenceRequest[]).map((entry) => [entry.relativePath, entry])).values()];
  } catch {
    return [];
  }
};

export const workspaceReferenceId = (relativePath: string): string => `workspace:${relativePath}`;
