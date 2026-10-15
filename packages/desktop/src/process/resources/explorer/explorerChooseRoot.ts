import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { ExplorerServiceError } from './pathGuard';

export type ExplorerConsentDeps = {
  /** Resolves the live main window for this event, or throws DENIED when the sender is not it. */
  resolveWindow: (event: IpcMainInvokeEvent) => BrowserWindow;
  /** Awaited before any dialog so localized copy is ready. */
  ready: Promise<unknown>;
  defaultRoot: () => string;
  /** Durable consent ledger consulted before a folder-open dialog is ever shown. */
  grantStore: {
    covers: (canonicalPaths: readonly string[]) => Promise<boolean>;
    grant: (root: string) => Promise<void>;
  };
  t: (key: string, options?: Record<string, unknown>) => string;
  pickFolder: (window: BrowserWindow, defaultPath: string, title: string) => Promise<string | null>;
  /** Native consent for one folder; resolves true when the user approves it. */
  confirmGrant: (window: BrowserWindow, target: string) => Promise<boolean>;
};

/**
 * Builds the Explorer's folder-consent gate.
 *
 * The consent dialog is the only place a grant is created, and `grantStore.covers` is the
 * only thing that can skip it — so a folder the user already approved opens silently on
 * every later request, including after a restart, instead of asking again.
 */
export const createChooseRoot =
  (deps: ExplorerConsentDeps) =>
  async (event: IpcMainInvokeEvent, request: { path?: string; pick?: boolean }): Promise<string | null> => {
    await deps.ready;
    const window = deps.resolveWindow(event);
    const defaultRoot = deps.defaultRoot();
    let chosen: string | null = null;
    if (request.pick) {
      chosen = await deps.pickFolder(window, defaultRoot, deps.t('guid.hubHome.explorer.pickFolder'));
    } else if (!request.path) {
      chosen = defaultRoot;
    } else {
      if (!path.isAbsolute(request.path) || request.path.startsWith('\\\\') || request.path.startsWith('//'))
        throw new ExplorerServiceError('INVALID_REQUEST');
      const alreadyGranted = await deps.grantStore.covers([path.resolve(request.path)]);
      if (!alreadyGranted) {
        const approved = await deps.confirmGrant(window, request.path);
        if (!approved) return null;
      }
      chosen = request.path;
    }
    if (chosen) await deps.grantStore.grant(path.resolve(chosen));
    return chosen;
  };
