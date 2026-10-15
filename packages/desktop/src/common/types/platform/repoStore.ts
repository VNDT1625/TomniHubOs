/**
 * Main-owned, user-initiated Store import. The renderer may submit a GitHub URL,
 * never a local path, an output path, a signing key or an executable command.
 */
export const REPO_STORE_CHANNELS = {
  import: 'core.repo-store.import',
  progress: 'core.repo-store.progress',
  checkUpdate: 'core.repo-store.check-update',
} as const;

export type RepoStoreImportRequest = {
  requestId: string;
  /** `extension-file` opens Main's file dialog (.zip or .crx); `chrome-web-store` takes an id or detail URL in `url`. */
  kind: 'github' | 'folder' | 'extension-file' | 'chrome-web-store';
  url?: string;
};
export type RepoStoreProgress = {
  requestId: string;
  progress: number;
  phase: 'building' | 'installing' | 'finished';
  text: string;
};
export type RepoStoreImportResult =
  | { ok: true; packageId: string; version: string; report: string }
  | {
      ok: false;
      error: 'CANCELLED' | 'BUSY' | 'INVALID_REQUEST' | 'DENIED' | 'FAILED' | 'DISABLED';
      report?: string;
    };

/** Read-only check of a locally built package against its recorded GitHub address (no install, no build). */
export type RepoStoreCheckError =
  | 'NOT_INSTALLED'
  | 'NOT_LOCAL_BUILT'
  | 'NO_PROVENANCE'
  | 'SOURCE_NOT_UPDATABLE'
  | 'BUSY'
  | 'INVALID_REQUEST'
  | 'DENIED'
  | 'FAILED';
export type RepoStoreCheckResult =
  | {
      ok: true;
      status: 'update-available' | 'up-to-date' | 'unknown';
      installedCommit?: string;
      remoteCommit?: string;
    }
  | { ok: false; error: RepoStoreCheckError };

export type RepoStoreNativeAPI = {
  import: (request: RepoStoreImportRequest) => Promise<RepoStoreImportResult>;
  onProgress: (listener: (event: RepoStoreProgress) => void) => () => void;
  checkUpdate: (request: { packageId: string }) => Promise<RepoStoreCheckResult>;
};
