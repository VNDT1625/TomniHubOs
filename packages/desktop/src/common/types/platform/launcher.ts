/**
 * Launcher controls never receive an executable path from the renderer.
 * A person selects the file through Main's native picker and separately presses Open to run it.
 */
export const LAUNCHER_CHANNELS = {
  link: 'core.launcher.link',
  open: 'core.launcher.open',
  download: 'core.launcher.download',
} as const;
export type LauncherActionResult =
  | { ok: true; path?: string }
  | {
      ok: false;
      error: 'DENIED' | 'CANCELLED' | 'NOT_FOUND' | 'NOT_LINKED' | 'NOT_ENABLED' | 'INVALID_REQUEST' | 'FAILED';
    };
export type LauncherNativeAPI = {
  link: (request: { packageId: string; connectionId: string }) => Promise<LauncherActionResult>;
  open: (request: { packageId: string; connectionId: string }) => Promise<LauncherActionResult>;
  download: (request: { packageId: string; connectionId: string }) => Promise<LauncherActionResult>;
};
