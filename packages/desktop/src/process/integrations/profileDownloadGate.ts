/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Download gate for the Browser profile (user decision 2026-10-15).
 *
 * Every download the Browser profile starts is paused as soon as Electron reports it. Nothing is saved until the person
 * answers a native dialog in Main: "Save" resumes the download, any other answer cancels it (Electron then removes the
 * partial file). The dialog shows the file name with its extension, the host of the page the file comes from (never the
 * path or query) and the size when Electron knows it. The answer is not remembered.
 *
 * Electron gives Main no user-activation signal for a download, so the gate asks every time. Dialogs run one at a time in
 * arrival order. At most `maxPending` downloads may wait for an answer; the others are cancelled without a dialog.
 *
 * The `chrome.downloads` observer (wiring/downloadsPort.ts) is another listener on the same session. It only observes.
 *
 * Main-process module. The session, the dialog port and the logger arrive as arguments; the native dialog is built by
 * {@link createNativeDownloadConfirm}, which loads Electron and i18n lazily so this file runs under Node in tests.
 */

/** The part of Electron's `DownloadItem` the gate uses. */
export type GateDownloadItem = Readonly<{
  getURL: () => string;
  getFilename: () => string;
  getTotalBytes: () => number;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  on: (event: 'done', listener: () => void) => unknown;
}>;

/** What the person is asked to confirm. Never contains the URL path, query or any header. */
export type DownloadConfirmRequest = Readonly<{
  filename: string;
  extension: string;
  sourceHost: string;
  sizeBytes?: number;
}>;

/** Resolves true only when the person chose to save. Rejections count as a refusal. */
export type DownloadConfirmPort = (request: DownloadConfirmRequest) => Promise<boolean>;

type WillDownloadListener = (event: unknown, item: GateDownloadItem) => void;

/** The part of the Browser profile `Session` the gate uses. */
export type DownloadGateSession = Readonly<{
  on: (event: 'will-download', listener: WillDownloadListener) => unknown;
  removeListener: (event: 'will-download', listener: WillDownloadListener) => unknown;
}>;

export type DownloadGateOptions = Readonly<{
  confirm: DownloadConfirmPort;
  /** Downloads that may wait for an answer at the same time. Extra downloads are cancelled. Default 5. */
  maxPending?: number;
  log?: (message: string) => void;
}>;

export type DownloadGate = Readonly<{
  /** Stops gating new downloads, cancels every download still waiting, and removes the listener. */
  dispose: () => void;
  /** Downloads paused and waiting for an answer, or queued behind one. */
  pendingCount: () => number;
}>;

const DEFAULT_MAX_PENDING = 5;
const MAX_FILENAME_LENGTH = 200;

/**
 * The host of the page a file comes from. Non-web URLs show their scheme; `blob:` URLs show the host of the page that made
 * them. Anything unreadable shows as `unknown`.
 */
export const describeDownloadSource = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.hostname;
    if (parsed.protocol === 'blob:') return describeDownloadSource(parsed.pathname);
    return parsed.protocol.replace(/:$/, '') || 'unknown';
  } catch {
    return 'unknown';
  }
};

/** The extension of a file name, lower case, without the dot. Empty when there is none. */
export const extensionOf = (filename: string): string => {
  const match = /\.([^./\\]{1,16})$/.exec(filename);
  return match?.[1]?.toLowerCase() ?? '';
};

/** Removes control characters (they could fake lines in the dialog) and bounds the length. */
const cleanFilename = (filename: string): string => {
  const cleaned = filename
    .replace(/\p{Cc}/gu, '')
    .slice(0, MAX_FILENAME_LENGTH)
    .trim();
  return cleaned === '' ? 'download' : cleaned;
};

/** Human-readable size for the dialog. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
};

const requestOf = (item: GateDownloadItem): DownloadConfirmRequest => {
  const filename = cleanFilename(item.getFilename());
  const total = item.getTotalBytes();
  return {
    filename,
    extension: extensionOf(filename),
    sourceHost: describeDownloadSource(item.getURL()),
    ...(total > 0 ? { sizeBytes: total } : {}),
  };
};

type Entry = { readonly item: GateDownloadItem; finished: boolean };

/**
 * Starts gating the downloads of `session`. Every download is paused first; only an approved one is resumed.
 * A download the gate cannot pause or track is cancelled, so the gate fails closed.
 */
export const installDownloadGate = (session: DownloadGateSession, options: DownloadGateOptions): DownloadGate => {
  const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
  const log = options.log ?? (() => undefined);
  const pending = new Set<Entry>();
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  const act = (item: GateDownloadItem, action: 'resume' | 'cancel'): void => {
    try {
      if (action === 'resume') item.resume();
      else item.cancel();
    } catch (error) {
      log(`The download could not be ${action === 'resume' ? 'resumed' : 'cancelled'}: ${errorText(error)}`);
    }
  };

  const ask = async (entry: Entry): Promise<void> => {
    // A download the Browser already ended needs no action. After dispose, dispose has cancelled every waiting download.
    if (entry.finished || disposed) {
      pending.delete(entry);
      return;
    }
    let approved = false;
    try {
      approved = await options.confirm(requestOf(entry.item));
    } catch (error) {
      log(`The download confirmation failed; the download is cancelled: ${errorText(error)}`);
    }
    // The gate may have been closed or the download ended while the dialog was open: then nothing more is done.
    if (!entry.finished && !disposed) act(entry.item, approved ? 'resume' : 'cancel');
    pending.delete(entry);
  };

  const onWillDownload: WillDownloadListener = (_event, item) => {
    const entry: Entry = { item, finished: false };
    try {
      item.pause();
      item.on('done', () => {
        entry.finished = true;
      });
    } catch (error) {
      log(`A download could not be held for confirmation; it is cancelled: ${errorText(error)}`);
      act(item, 'cancel');
      return;
    }
    if (disposed || pending.size >= maxPending) {
      log('Too many downloads wait for confirmation; this one is cancelled.');
      act(item, 'cancel');
      return;
    }
    pending.add(entry);
    queue = queue.then(() => ask(entry)).catch((): undefined => undefined);
  };

  session.on('will-download', onWillDownload);

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      session.removeListener('will-download', onWillDownload);
      for (const entry of pending) {
        if (!entry.finished) act(entry.item, 'cancel');
      }
    },
    pendingCount: () => pending.size,
  };
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : 'unknown error');

/**
 * The native confirmation: a question box in Main, parented to the Hub window when one exists. Electron and i18n load
 * on first use. Any failure to show the box resolves to false.
 */
export const createNativeDownloadConfirm =
  (getWindow: () => unknown): DownloadConfirmPort =>
  async (request) => {
    try {
      const { dialog } = await import('electron');
      const { default: i18n, i18nReady } = await import('@process/services/i18n');
      await i18nReady;
      const size =
        request.sizeBytes === undefined ? i18n.t('browser.downloadGate.sizeUnknown') : formatBytes(request.sizeBytes);
      const box = {
        type: 'question' as const,
        title: i18n.t('browser.downloadGate.title'),
        message: i18n.t('browser.downloadGate.message', { filename: request.filename, source: request.sourceHost }),
        detail: i18n.t('browser.downloadGate.detail', {
          extension: request.extension === '' ? i18n.t('browser.downloadGate.noExtension') : request.extension,
          size,
        }),
        buttons: [i18n.t('browser.downloadGate.cancel'), i18n.t('browser.downloadGate.save')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const owner = getWindow();
      const result =
        owner === undefined || owner === null
          ? await dialog.showMessageBox(box)
          : await dialog.showMessageBox(owner as Electron.BrowserWindow, box);
      return result.response === 1;
    } catch {
      return false;
    }
  };
