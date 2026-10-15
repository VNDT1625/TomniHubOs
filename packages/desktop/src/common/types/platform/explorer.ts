/** Human-operated Explorer contracts. Main issues sender-bound directory sessions. */
export const EXPLORER_CHANNELS = {
  open: 'explorer.open',
  list: 'explorer.list',
  action: 'explorer.action',
  close: 'explorer.close',
  quickView: 'explorer.quick-view',
} as const;

export type ExplorerEntry = {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
  /** True when this item (or an ancestor) is on the user's block list. */
  blocked: boolean;
};

export type ExplorerSession = {
  id: string;
  root: string;
  expiresAt: number;
};

export type ExplorerListing = {
  relativePath: string;
  entries: ExplorerEntry[];
  truncated: boolean;
};

export type ExplorerErrorCode =
  | 'UNAVAILABLE'
  | 'DENIED'
  | 'INVALID_REQUEST'
  | 'CANCELLED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'LIMIT_EXCEEDED'
  | 'IO_ERROR'
  | 'SESSION_EXPIRED'
  | 'BUSY'
  | 'AUDIT_FAILED';

export type ExplorerResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: ExplorerErrorCode;
      receiptId?: string;
      affectedPaths?: string[];
      mayHaveCommitted?: boolean;
      /** First free sibling name the Hub proposes when code is CONFLICT. */
      suggestedName?: string;
    };

export type ExplorerOperation =
  | 'create-file'
  | 'create-directory'
  | 'rename'
  | 'copy'
  | 'move'
  | 'delete'
  | 'open'
  | 'reveal'
  | 'block'
  | 'unblock';

export type ExplorerActionRequest = {
  sessionId: string;
  operation: ExplorerOperation;
  paths: string[];
  destination?: string;
  name?: string;
  /** Resolve name collisions by proposing the first free `name (n)` sibling instead of failing. */
  autoRename?: boolean;
};

export type ExplorerActionOutcome = {
  receiptId: string;
  affectedPaths: string[];
};

export type ExplorerNativeAPI = {
  open(request: {
    path?: string;
    pick?: boolean;
  }): Promise<ExplorerResult<{ session: ExplorerSession; listing: ExplorerListing }>>;
  list(request: { sessionId: string; relativePath: string }): Promise<ExplorerResult<ExplorerListing>>;
  action(request: ExplorerActionRequest): Promise<ExplorerResult<ExplorerActionOutcome>>;
  close(request: { sessionId: string }): Promise<ExplorerResult<null>>;
  quickView(request: {
    sessionId: string;
    relativePath: string;
  }): Promise<ExplorerResult<import('@/common/chat/attachmentQuickView').AttachmentQuickView>>;
};
