import { describe, expect, it } from 'vitest';
import { createDownloadsPort } from '@process/integrations/browserExtensions/wiring/downloadsPort';
import {
  describeDownloadSource,
  extensionOf,
  formatBytes,
  installDownloadGate,
  type DownloadConfirmRequest,
  type DownloadGateSession,
} from '@process/integrations/profileDownloadGate';

type Handler = (event: unknown, state: string) => void;
type FakeDownloadOptions = Readonly<{ url?: string; filename?: string; totalBytes?: number; pauseThrows?: boolean }>;

/**
 * A download the Browser profile reports. It has the methods the gate uses and the ones the chrome.downloads observer
 * uses, so one object serves both listeners. `calls` records what the gate did to it.
 */
const fakeDownload = (options: FakeDownloadOptions = {}) => {
  const doneHandlers: (() => void)[] = [];
  const calls: string[] = [];
  let paused = false;
  const item = {
    getURL: () => options.url ?? 'https://files.example.com/path/a.zip?token=secret',
    getFilename: () => options.filename ?? 'a.zip',
    getMimeType: () => 'application/zip',
    getTotalBytes: () => options.totalBytes ?? 2048,
    getReceivedBytes: () => 0,
    isPaused: () => paused,
    pause: () => {
      if (options.pauseThrows === true) throw new Error('no pause');
      paused = true;
      calls.push('pause');
    },
    resume: () => {
      paused = false;
      calls.push('resume');
    },
    cancel: () => {
      calls.push('cancel');
    },
    on: (event: 'updated' | 'done', listener: Handler | (() => void)) => {
      if (event === 'done') doneHandlers.push(listener as () => void);
      return item;
    },
  };
  return {
    item,
    calls,
    finish: () => {
      for (const handler of doneHandlers) handler();
    },
  };
};

type Fake = ReturnType<typeof fakeDownload>['item'];

/** A session that keeps every `will-download` listener, the way Electron does. */
const fakeSession = () => {
  const listeners = new Set<(event: unknown, item: Fake) => void>();
  const session = {
    on: (_event: 'will-download', listener: (event: unknown, item: Fake) => void) => {
      listeners.add(listener);
      return undefined;
    },
    removeListener: (_event: 'will-download', listener: (event: unknown, item: Fake) => void) => {
      listeners.delete(listener);
      return undefined;
    },
  };
  return {
    session,
    start: (item: Fake) => {
      for (const listener of listeners) listener({}, item);
    },
    listenerCount: () => listeners.size,
  };
};

/** A confirm port the test answers by hand, one request at a time. */
const manualConfirm = () => {
  const requests: DownloadConfirmRequest[] = [];
  const answers: ((value: boolean) => void)[] = [];
  return {
    requests,
    confirm: (request: DownloadConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        requests.push(request);
        answers.push(resolve);
      }),
    answer: (value: boolean) => answers.shift()?.(value),
  };
};

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe('download gate', () => {
  it('pauses every download, then resumes it only when the person saves', async () => {
    const env = fakeSession();
    const dialog = manualConfirm();
    installDownloadGate(env.session as DownloadGateSession, { confirm: dialog.confirm });
    const download = fakeDownload();
    env.start(download.item);
    expect(download.calls).toEqual(['pause']);
    await flush();
    expect(dialog.requests).toHaveLength(1);
    dialog.answer(true);
    await flush();
    expect(download.calls).toEqual(['pause', 'resume']);
  });

  it('cancels a download the person refuses, and one whose dialog fails', async () => {
    const refusedEnv = fakeSession();
    const refusedDialog = manualConfirm();
    installDownloadGate(refusedEnv.session as DownloadGateSession, { confirm: refusedDialog.confirm });
    const refused = fakeDownload({ filename: 'b.exe' });
    refusedEnv.start(refused.item);
    await flush();
    refusedDialog.answer(false);
    await flush();
    expect(refused.calls).toEqual(['pause', 'cancel']);

    const brokenEnv = fakeSession();
    installDownloadGate(brokenEnv.session as DownloadGateSession, {
      confirm: () => Promise.reject(new Error('dialog closed')),
    });
    const broken = fakeDownload();
    brokenEnv.start(broken.item);
    await flush();
    expect(broken.calls).toEqual(['pause', 'cancel']);
  });

  it('asks one download at a time, in arrival order', async () => {
    const env = fakeSession();
    const dialog = manualConfirm();
    installDownloadGate(env.session as DownloadGateSession, { confirm: dialog.confirm });
    const first = fakeDownload({ filename: 'first.zip' });
    const second = fakeDownload({ filename: 'second.zip' });
    env.start(first.item);
    env.start(second.item);
    await flush();
    expect(dialog.requests.map((request) => request.filename)).toEqual(['first.zip']);
    dialog.answer(true);
    await flush();
    expect(dialog.requests.map((request) => request.filename)).toEqual(['first.zip', 'second.zip']);
    dialog.answer(false);
    await flush();
    expect(first.calls).toEqual(['pause', 'resume']);
    expect(second.calls).toEqual(['pause', 'cancel']);
  });

  it('shows the file name, extension, source host and size, but never the path or query', async () => {
    const env = fakeSession();
    const dialog = manualConfirm();
    installDownloadGate(env.session as DownloadGateSession, { confirm: dialog.confirm });
    env.start(fakeDownload({ url: 'https://files.example.com/path/a.zip?token=secret', totalBytes: 2048 }).item);
    env.start(fakeDownload({ url: 'data:text/plain;base64,AAAA', filename: 'notes', totalBytes: 0 }).item);
    await flush();
    expect(dialog.requests[0]).toEqual({
      filename: 'a.zip',
      extension: 'zip',
      sourceHost: 'files.example.com',
      sizeBytes: 2048,
    });
    expect(JSON.stringify(dialog.requests[0])).not.toMatch(/token|path/);
    dialog.answer(false);
    await flush();
    dialog.answer(false);
    await flush();
    expect(dialog.requests[1]).toEqual({ filename: 'notes', extension: '', sourceHost: 'data' });
  });

  it('does not act on a download the Browser already ended while it waited', async () => {
    const env = fakeSession();
    const dialog = manualConfirm();
    installDownloadGate(env.session as DownloadGateSession, { confirm: dialog.confirm });
    const blocker = fakeDownload({ filename: 'blocker.zip' });
    const ended = fakeDownload({ filename: 'ended.zip' });
    env.start(blocker.item);
    env.start(ended.item);
    ended.finish();
    dialog.answer(true);
    await flush();
    expect(dialog.requests.map((request) => request.filename)).toEqual(['blocker.zip']);
    expect(ended.calls).toEqual(['pause']);
  });

  it('cancels, without asking, the downloads beyond the pending limit', async () => {
    const env = fakeSession();
    const dialog = manualConfirm();
    const gate = installDownloadGate(env.session as DownloadGateSession, {
      confirm: dialog.confirm,
      maxPending: 1,
    });
    const first = fakeDownload({ filename: 'one.zip' });
    const extra = fakeDownload({ filename: 'two.zip' });
    env.start(first.item);
    env.start(extra.item);
    expect(gate.pendingCount()).toBe(1);
    expect(extra.calls).toEqual(['pause', 'cancel']);
    await flush();
    expect(dialog.requests).toHaveLength(1);
    dialog.answer(true);
    await flush();
    expect(first.calls).toEqual(['pause', 'resume']);
    expect(gate.pendingCount()).toBe(0);
  });

  it('cancels a download it cannot hold', () => {
    const env = fakeSession();
    installDownloadGate(env.session as DownloadGateSession, { confirm: manualConfirm().confirm });
    const stuck = fakeDownload({ pauseThrows: true });
    env.start(stuck.item);
    expect(stuck.calls).toEqual(['cancel']);
  });

  it('on dispose, stops gating, cancels each waiting download once, and removes its listener', async () => {
    const env = fakeSession();
    const dialog = manualConfirm();
    const gate = installDownloadGate(env.session as DownloadGateSession, { confirm: dialog.confirm });
    const waiting = fakeDownload({ filename: 'waiting.zip' });
    const queued = fakeDownload({ filename: 'queued.zip' });
    env.start(waiting.item);
    env.start(queued.item);
    gate.dispose();
    expect(env.listenerCount()).toBe(0);
    dialog.answer(true);
    await flush();
    expect(waiting.calls).toEqual(['pause', 'cancel']);
    expect(queued.calls).toEqual(['pause', 'cancel']);
  });

  it('leaves the chrome.downloads observer recording on the same session', async () => {
    const env = fakeSession();
    const dialog = manualConfirm();
    installDownloadGate(env.session as DownloadGateSession, { confirm: dialog.confirm });
    const observer = createDownloadsPort(env.session as unknown as Parameters<typeof createDownloadsPort>[0]);
    const download = fakeDownload({ filename: 'seen.zip' });
    env.start(download.item);
    expect(observer.list()).toEqual([expect.objectContaining({ filename: 'seen.zip', state: 'in_progress' })]);
    expect(download.calls).toEqual(['pause']);
    await flush();
    dialog.answer(false);
    await flush();
    expect(download.calls).toEqual(['pause', 'cancel']);
  });
});

describe('download gate helpers', () => {
  it('describes the source without its path or query', () => {
    expect(describeDownloadSource('https://a.example.com:8443/x?y=1')).toBe('a.example.com');
    expect(describeDownloadSource('blob:https://b.example.org/0f1e')).toBe('b.example.org');
    expect(describeDownloadSource('file:///C:/secret/file.txt')).toBe('file');
    expect(describeDownloadSource('not a url')).toBe('unknown');
  });

  it('reads the extension and formats sizes', () => {
    expect(extensionOf('setup.EXE')).toBe('exe');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('README')).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
