import { describe, expect, it, vi } from 'vitest';

import {
  Router9ConfigSession,
  type Router9ConfigWriteHooks,
  shutdownRouter9Integration,
} from '@process/router9/router9Lifecycle';

const CONFIG_PATH = '/config/settings.json';
const JOURNAL_PATH = '/state/router9-config-recovery.json';

const createSession = (files: Map<string, string>, logWarn = vi.fn()): Router9ConfigSession =>
  new Router9ConfigSession({
    journalPath: () => JOURNAL_PATH,
    isManagedPath: (configPath) => configPath.startsWith('/config/'),
    readFile: async (filePath) => files.get(filePath),
    writeFileAtomic: async (filePath, content) => {
      files.set(filePath, content);
    },
    removeFile: async (filePath) => {
      files.delete(filePath);
    },
    logWarn,
  });

const applyConfig = async (
  session: Router9ConfigSession,
  files: Map<string, string>,
  appliedContent: string
): Promise<void> => {
  await session.apply(async (hooks: Router9ConfigWriteHooks) => {
    const originalContent = files.get(CONFIG_PATH);
    await hooks.beforeWrite(CONFIG_PATH, originalContent, appliedContent);
    files.set(CONFIG_PATH, appliedContent);
    await hooks.afterWrite(CONFIG_PATH, appliedContent);
  });
};

describe('Router9ConfigSession', () => {
  it('restores the first original content after repeated applies in one session', async () => {
    const files = new Map([[CONFIG_PATH, 'before']]);
    const session = createSession(files);

    await applyConfig(session, files, 'tomni-v1');
    await applyConfig(session, files, 'tomni-v2');
    await session.restore();

    expect(files.get(CONFIG_PATH)).toBe('before');
    expect(files.has(JOURNAL_PATH)).toBe(false);
  });

  it('removes a config created by Tomny only while its content still matches', async () => {
    const files = new Map<string, string>();
    const session = createSession(files);

    await applyConfig(session, files, 'tomni-created');
    await session.restore();

    expect(files.has(CONFIG_PATH)).toBe(false);
  });

  it('preserves a user edit made after apply and clears the unsafe recovery entry', async () => {
    const files = new Map([[CONFIG_PATH, 'before']]);
    const logWarn = vi.fn();
    const session = createSession(files, logWarn);
    await applyConfig(session, files, 'tomni-applied');
    files.set(CONFIG_PATH, 'user-edited');

    await session.restore();

    expect(files.get(CONFIG_PATH)).toBe('user-edited');
    expect(logWarn).toHaveBeenCalledWith(expect.stringMatching(/changed outside Tomny/i));
    expect(files.has(JOURNAL_PATH)).toBe(false);
  });

  it('recovers a crash after config write but before journal commit', async () => {
    const files = new Map([[CONFIG_PATH, 'before']]);
    const first = createSession(files);
    await first.apply(async (hooks) => {
      await hooks.beforeWrite(CONFIG_PATH, 'before', 'tomni-pending');
      files.set(CONFIG_PATH, 'tomni-pending');
      // Simulate process loss before afterWrite can promote pendingContent.
    });

    const restarted = createSession(files);
    await restarted.recover();

    expect(files.get(CONFIG_PATH)).toBe('before');
    expect(files.has(JOURNAL_PATH)).toBe(false);
  });

  it('retains proof of the prior Tomny content when a later apply crashes before writing', async () => {
    const files = new Map([[CONFIG_PATH, 'before']]);
    const first = createSession(files);
    await first.apply(async (hooks) => {
      await hooks.beforeWrite(CONFIG_PATH, 'before', 'tomni-v1');
      files.set(CONFIG_PATH, 'tomni-v1');
      // Simulate a crash before the first commit marker.
    });
    await first.apply(async (hooks) => {
      await hooks.beforeWrite(CONFIG_PATH, 'tomni-v1', 'tomni-v2');
      // Simulate another crash before writing tomni-v2.
    });

    const restarted = createSession(files);
    await restarted.recover();

    expect(files.get(CONFIG_PATH)).toBe('before');
  });

  it('ignores recovery entries outside the managed config allowlist', async () => {
    const unsafePath = '/outside/account-config.json';
    const journal = {
      schemaVersion: 1,
      entries: [
        {
          configPath: unsafePath,
          originalContent: 'before',
          appliedContent: 'tomni-applied',
          pendingContent: null,
        },
      ],
    };
    const files = new Map([
      [unsafePath, 'tomni-applied'],
      [JOURNAL_PATH, `${JSON.stringify(journal)}\n`],
    ]);
    const logWarn = vi.fn();

    await createSession(files, logWarn).recover();

    expect(files.get(unsafePath)).toBe('tomni-applied');
    expect(files.has(JOURNAL_PATH)).toBe(false);
    expect(logWarn).toHaveBeenCalledWith(expect.stringMatching(/unsafe/i));
  });

  it('serializes an active apply before restore and rejects applies once shutdown begins', async () => {
    const files = new Map([[CONFIG_PATH, 'before']]);
    const session = createSession(files);
    let releaseApply: (() => void) | undefined;
    let markApplyStarted: (() => void) | undefined;
    const applyStarted = new Promise<void>((resolve) => {
      markApplyStarted = resolve;
    });
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const applyPromise = session.apply(async (hooks) => {
      await hooks.beforeWrite(CONFIG_PATH, 'before', 'tomni-applied');
      markApplyStarted?.();
      await applyGate;
      files.set(CONFIG_PATH, 'tomni-applied');
      await hooks.afterWrite(CONFIG_PATH, 'tomni-applied');
    });
    await applyStarted;

    session.beginShutdown();
    const restorePromise = session.restore();
    await expect(session.apply(async () => undefined)).rejects.toThrow(/shutting down/i);
    releaseApply?.();
    await applyPromise;
    await restorePromise;

    expect(files.get(CONFIG_PATH)).toBe('before');
  });
});

describe('shutdownRouter9Integration', () => {
  it('closes config writes and restores configs even when stopping the gateway fails', async () => {
    const beginConfigShutdown = vi.fn();
    const restoreConfigs = vi.fn(async () => undefined);

    await expect(
      shutdownRouter9Integration({
        beginConfigShutdown,
        stopManagedGateway: async () => {
          throw new Error('stop failed');
        },
        restoreConfigs,
      })
    ).rejects.toThrow(/shutdown/i);

    expect(beginConfigShutdown).toHaveBeenCalledOnce();
    expect(restoreConfigs).toHaveBeenCalledOnce();
  });
});
