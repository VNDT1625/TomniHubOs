/**
 * Restricted native RepoToPackage Store importer. One import at a time, no arbitrary paths
 * from the renderer, no command execution from input, progress bound to its caller.
 */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { parseSource } from '@process/extensions/package-manager/repoPackaging/sourceResolver';
import type { RepoPackagingProgress } from '@process/extensions/package-manager/repoPackaging/types';
import { parseChromeWebStoreInput } from '@process/integrations/repoSources/chromeWebStore';
import {
  REPO_STORE_CHANNELS,
  type RepoStoreCheckError,
  type RepoStoreCheckResult,
  type RepoStoreImportResult,
  type RepoStoreProgress,
} from '@/common/types/platform/repoStore';

const REQUEST = z
  .object({
    requestId: z.string().uuid(),
    kind: z.enum(['github', 'folder', 'extension-file', 'chrome-web-store']),
    url: z.string().max(2048).optional(),
  })
  .strict()
  .refine((value) =>
    value.kind === 'github' || value.kind === 'chrome-web-store'
      ? typeof value.url === 'string' && value.url.length > 0
      : value.url === undefined
  );

export type RepoStoreBridgeDeps = Readonly<{
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  verifySender: (event: IpcMainInvokeEvent) => boolean;
  selectFolder: (event: IpcMainInvokeEvent) => Promise<string | undefined>;
  build: (
    source: string,
    workspaceRoot: string | undefined,
    publish: (progress: Readonly<{ text: string; progress: number; completed: boolean }>) => void
  ) => Promise<Readonly<{ ok?: boolean; artifactPath?: string; text: string }>>;
  install: (artifactPath: string) => Promise<Readonly<{ packageId: string; version: string }>>;
  /** Main's file dialog for a .zip or .crx extension (the renderer never names the path). */
  selectExtensionFile: (event: IpcMainInvokeEvent) => Promise<string | undefined>;
  /** Installs a picked extension file as `local-built`; `publish` receives the real packaging stages. */
  installExtensionFile: (
    filePath: string,
    publish: (progress: RepoPackagingProgress) => void
  ) => Promise<Readonly<{ packageId: string; version: string }>>;
  /** Installs from the Chrome Web Store (id or detail URL). Only called when `chromeWebStoreEnabled` is true. */
  installChromeWebStore: (
    input: string,
    publish: (progress: RepoPackagingProgress) => void
  ) => Promise<Readonly<{ packageId: string; version: string }>>;
  /** The caller's `chromeWebStoreSource` switch (D14). Off means the Web Store source refuses every request. */
  chromeWebStoreEnabled: () => boolean;
  /** Read-only: asks the recorded GitHub address whether a newer commit exists. Never builds or installs. */
  checkUpdate: (
    packageId: string
  ) => Promise<
    Readonly<{ status: 'update-available' | 'up-to-date' | 'unknown'; installedCommit?: string; remoteCommit?: string }>
  >;
}>;

const CHECK_REQUEST = z
  .object({
    packageId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9][a-z0-9._-]*$/u),
  })
  .strict();

const CHECK_ERROR_CODES: ReadonlySet<string> = new Set<RepoStoreCheckError>([
  'NOT_INSTALLED',
  'NOT_LOCAL_BUILT',
  'NO_PROVENANCE',
  'SOURCE_NOT_UPDATABLE',
]);

/** Maps a failure to a stable code. Only codes the Store may show pass through; everything else is FAILED. */
const checkErrorCode = (error: unknown): RepoStoreCheckError => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined;
  return typeof code === 'string' && CHECK_ERROR_CODES.has(code) ? (code as RepoStoreCheckError) : 'FAILED';
};

export const registerRepoStoreBridge = (deps: RepoStoreBridgeDeps): (() => void) => {
  let running = false;
  let active = true;
  const trusted = (event: IpcMainInvokeEvent) => active && deps.verifySender(event);
  const report = (event: IpcMainInvokeEvent, progress: RepoStoreProgress): void => {
    if (trusted(event)) event.sender.send(REPO_STORE_CHANNELS.progress, progress);
  };
  /** Extension sources (.zip, .crx, Chrome Web Store). Progress is the packager's own stages, never a guess. */
  const importExtension = async (
    event: IpcMainInvokeEvent,
    request: Readonly<{ requestId: string; kind: 'extension-file' | 'chrome-web-store'; url?: string }>
  ): Promise<RepoStoreImportResult> => {
    const lines: string[] = [];
    const publish = (stage: RepoPackagingProgress): void => {
      lines.push(stage.detail ?? `${stage.stage} ${stage.status}`);
      report(event, {
        requestId: request.requestId,
        phase: 'building',
        progress: Math.min(95, 10 + lines.length * 8),
        text: lines.join('\n').slice(-12000),
      });
    };
    let installed: Readonly<{ packageId: string; version: string }>;
    if (request.kind === 'chrome-web-store') {
      if (!deps.chromeWebStoreEnabled()) return { ok: false, error: 'DISABLED' };
      try {
        parseChromeWebStoreInput(request.url!);
      } catch {
        return { ok: false, error: 'INVALID_REQUEST' };
      }
      installed = await deps.installChromeWebStore(request.url!, publish);
    } else {
      const file = await deps.selectExtensionFile(event);
      if (!trusted(event)) return { ok: false, error: 'DENIED' };
      if (!file) return { ok: false, error: 'CANCELLED' };
      installed = await deps.installExtensionFile(file, publish);
    }
    report(event, {
      requestId: request.requestId,
      phase: 'finished',
      progress: 100,
      text: lines.join('\n').slice(-12000),
    });
    return {
      ok: true,
      packageId: installed.packageId,
      version: installed.version,
      report: lines.join('\n').slice(-12000),
    };
  };

  deps.ipcMain.handle(REPO_STORE_CHANNELS.import, async (event, raw: unknown): Promise<RepoStoreImportResult> => {
    if (!trusted(event)) return { ok: false, error: 'DENIED' };
    const parsed = REQUEST.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'INVALID_REQUEST' };
    if (running) return { ok: false, error: 'BUSY' };
    const request = parsed.data;
    if (request.kind === 'github') {
      try {
        if (parseSource(request.url!, ['github.com']).kind !== 'git') return { ok: false, error: 'INVALID_REQUEST' };
      } catch {
        return { ok: false, error: 'INVALID_REQUEST' };
      }
    }
    running = true;
    try {
      if (request.kind === 'extension-file' || request.kind === 'chrome-web-store') {
        return await importExtension(event, { requestId: request.requestId, kind: request.kind, url: request.url });
      }
      const folder = request.kind === 'folder' ? await deps.selectFolder(event) : undefined;
      if (!trusted(event)) return { ok: false, error: 'DENIED' };
      if (request.kind === 'folder' && !folder) return { ok: false, error: 'CANCELLED' };
      const output = await deps.build(request.kind === 'github' ? request.url! : '.', folder, (update) =>
        report(event, {
          requestId: request.requestId,
          phase: 'building',
          progress: Math.max(0, Math.min(100, update.progress)),
          text: update.text.slice(0, 12000),
        })
      );
      if (!output.ok || !output.artifactPath)
        return { ok: false, error: 'FAILED', report: output.text.slice(0, 12000) };
      if (!trusted(event)) return { ok: false, error: 'DENIED' };
      report(event, {
        requestId: request.requestId,
        phase: 'installing',
        progress: 99,
        text: output.text.slice(0, 12000),
      });
      // This path originates ONLY in the packager's signed result; it is never supplied by the renderer.
      const installed = await deps.install(output.artifactPath);
      report(event, {
        requestId: request.requestId,
        phase: 'finished',
        progress: 100,
        text: output.text.slice(0, 12000),
      });
      return {
        ok: true,
        packageId: installed.packageId,
        version: installed.version,
        report: output.text.slice(0, 12000),
      };
    } catch {
      return { ok: false, error: 'FAILED' };
    } finally {
      running = false;
    }
  });
  deps.ipcMain.handle(REPO_STORE_CHANNELS.checkUpdate, async (event, raw: unknown): Promise<RepoStoreCheckResult> => {
    if (!trusted(event)) return { ok: false, error: 'DENIED' };
    const parsed = CHECK_REQUEST.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'INVALID_REQUEST' };
    try {
      const result = await deps.checkUpdate(parsed.data.packageId);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: checkErrorCode(error) };
    }
  });
  return () => {
    active = false;
    deps.ipcMain.removeHandler(REPO_STORE_CHANNELS.import);
    deps.ipcMain.removeHandler(REPO_STORE_CHANNELS.checkUpdate);
  };
};
