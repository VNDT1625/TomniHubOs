import { EventEmitter } from 'node:events';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeHarness = vi.hoisted(() => {
  const handlers = new Map<string, (request: unknown) => Promise<unknown>>();
  const emit = vi.fn();
  return {
    handlers,
    emit,
    bridge: {
      buildProvider: (channel: string) => ({
        provider: vi.fn((handler: (request: unknown) => Promise<unknown>) => handlers.set(channel, handler)),
        invoke: vi.fn(),
      }),
      buildEmitter: () => ({ emit, on: vi.fn() }),
    },
  };
});

vi.mock('@office-ai/platform', () => ({ bridge: bridgeHarness.bridge }));

import {
  CREATOR_PREVIEW_CHANNELS,
  creatorPreviewChannels,
  createCreatorPreviewProjectOwnershipRegistry,
  disposeCreatorPreviewBridge,
  registerCreatorPreviewBridge,
  registerElectronCreatorPreviewIpcBridge,
  registerTrustedCreatorPreviewIpcBridge,
  type CreatorPreviewBridgeResult,
  type CreatorPreviewPublicState,
} from '@/process/workspace/creatorPreviewBridge';
import { CreatorPreviewError, type ICreatorPreviewRuntime } from '@/process/workspace/creatorPreviewRuntime';
import type {
  CreatorPreviewOpenRequest,
  CreatorPreviewOperation,
  CreatorPreviewReceipt,
  CreatorPreviewSessionSnapshot,
} from '@/process/workspace/creatorPreviewTypes';

const receipt = (operation: CreatorPreviewOperation = 'open'): CreatorPreviewReceipt => ({
  receiptId: 'receipt-1',
  requestId: 'request-1',
  correlationId: 'correlation-1',
  previewId: 'preview-alarm',
  projectId: 'project-alarm',
  operation,
  status: 'succeeded',
  from: 'cold',
  to: 'active',
  startedAt: 1,
  finishedAt: 2,
  durationMs: 1,
  code: 'PREVIEW_READY',
});

const previewPolicy: CreatorPreviewOpenRequest['policy'] = {
  quota: { ramMiB: 256, cpuPercent: 50, diskMiB: 512, processes: 4, timeoutMs: 30_000 },
  network: { mode: 'blocked', allowedOrigins: [] },
  requestedCapabilities: ['notifications'],
  grantedCapabilities: [],
};

const openRequest = (): Omit<CreatorPreviewOpenRequest, 'signal'> => ({
  previewId: 'preview-alarm',
  projectId: 'project-alarm',
  requestId: 'request-1',
  correlationId: 'correlation-1',
  workspaceRoot: 'C:/workspace/alarm',
  entrypoint: 'dist/index.html',
  policy: previewPolicy,
});

const createRuntime = (overrides: Partial<ICreatorPreviewRuntime> = {}) => {
  const runtime = {
    open: vi.fn(async () => receipt('open')),
    suspend: vi.fn(async () => receipt('suspend')),
    captureSnapshot: vi.fn(async () => receipt('snapshot')),
    reset: vi.fn(async () => receipt('reset')),
    reportCrash: vi.fn(async () => receipt('crash')),
    remove: vi.fn(async () => receipt('remove')),
    getSession: vi.fn(() => undefined),
    listEvents: vi.fn(() => []),
    listReceipts: vi.fn(() => []),
    onEvent: vi.fn(() => vi.fn()),
    dispose: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ICreatorPreviewRuntime;
  return { runtime };
};

class FakeCreatorPreviewWebContents extends EventEmitter {
  readonly mainFrame = {};
  readonly send = vi.fn();
  private destroyed = false;

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('destroyed');
  }
}

type NativeHandler = (event: IpcMainInvokeEvent, payload: unknown) => Promise<CreatorPreviewBridgeResult<unknown>>;

const createNativeHarness = (webContentsId = 17) => {
  const handlers = new Map<string, NativeHandler>();
  const webContents = new FakeCreatorPreviewWebContents(webContentsId);
  let windowDestroyed = false;
  const mainWindow = {
    isDestroyed: () => windowDestroyed,
    webContents,
  } as unknown as BrowserWindow;
  const ipcMain = {
    handle: (channel: string, handler: NativeHandler): void => {
      if (handlers.has(channel)) throw new Error(`Duplicate native handler: ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string): void => {
      handlers.delete(channel);
    },
  } as unknown as Pick<IpcMain, 'handle' | 'removeHandler'>;
  const event = (
    sender: FakeCreatorPreviewWebContents = webContents,
    senderFrame: unknown = sender.mainFrame
  ): IpcMainInvokeEvent => ({ sender, senderFrame }) as unknown as IpcMainInvokeEvent;
  const invoke = async <T>(
    channel: string,
    payload: unknown,
    senderEvent: IpcMainInvokeEvent = event()
  ): Promise<CreatorPreviewBridgeResult<T>> => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Missing native handler: ${channel}`);
    return (await handler(senderEvent, payload)) as CreatorPreviewBridgeResult<T>;
  };
  return {
    handlers,
    webContents,
    mainWindow,
    ipcMain,
    event,
    invoke,
    destroyWindow: () => {
      windowDestroyed = true;
      webContents.destroy();
    },
  };
};

type TrustedSender = { webContentsId: number; mainFrame: boolean };
type TrustedHandler = (sender: TrustedSender, payload: unknown) => Promise<CreatorPreviewBridgeResult<unknown>>;

const trustedHandlers = new Map<string, TrustedHandler>();
const removeTrustedHandler = vi.fn((channel: string) => trustedHandlers.delete(channel));
const trustedHost = {
  handle: (channel: string, handler: TrustedHandler): void => {
    if (trustedHandlers.has(channel)) throw new Error(`Duplicate trusted handler: ${channel}`);
    trustedHandlers.set(channel, handler);
  },
  removeHandler: removeTrustedHandler,
};
const trustedDisposers: Array<() => void> = [];
const trustedSender: TrustedSender = { webContentsId: 7, mainFrame: true };

const invokeTrusted = async <T>(
  channel: string,
  request: unknown,
  sender: TrustedSender = trustedSender
): Promise<CreatorPreviewBridgeResult<T>> => {
  const handler = trustedHandlers.get(channel);
  if (!handler) throw new Error(`Missing trusted handler: ${channel}`);
  return (await handler(sender, request)) as CreatorPreviewBridgeResult<T>;
};

const invoke = async <T>(channel: string, request: unknown): Promise<CreatorPreviewBridgeResult<T>> => {
  const handler = bridgeHarness.handlers.get(channel);
  if (!handler) throw new Error(`Missing provider: ${channel}`);
  return (await handler(request)) as CreatorPreviewBridgeResult<T>;
};

beforeEach(() => {
  bridgeHarness.handlers.clear();
  bridgeHarness.emit.mockClear();
  trustedHandlers.clear();
  removeTrustedHandler.mockClear();
});

afterEach(() => {
  for (const dispose of trustedDisposers.splice(0)) dispose();
  disposeCreatorPreviewBridge();
  vi.restoreAllMocks();
});

describe('creator preview bridge', () => {
  it('denies a valid request when the generic transport cannot authenticate its sender', async () => {
    const fixture = createRuntime();
    registerCreatorPreviewBridge(fixture.runtime);

    expect(await invoke<CreatorPreviewReceipt>(CREATOR_PREVIEW_CHANNELS.open, openRequest())).toEqual({
      ok: false,
      code: 'CREATOR_PREVIEW_SENDER_UNVERIFIED',
    });
    expect(fixture.runtime.open).not.toHaveBeenCalled();
    expect(
      await invoke<CreatorPreviewPublicState>(CREATOR_PREVIEW_CHANNELS.getState, {
        previewId: 'preview-alarm',
      })
    ).toEqual({ ok: false, code: 'CREATOR_PREVIEW_SENDER_UNVERIFIED' });
    expect(fixture.runtime.getSession).not.toHaveBeenCalled();
  });

  it('rejects malformed data and renderer-provided capability grants before transport admission', async () => {
    const fixture = createRuntime();
    registerCreatorPreviewBridge(fixture.runtime);

    expect(
      await invoke<CreatorPreviewReceipt>(CREATOR_PREVIEW_CHANNELS.open, {
        ...openRequest(),
        unexpected: 'forbidden',
      })
    ).toEqual({ ok: false, code: 'INVALID_PREVIEW_REQUEST' });
    expect(
      await invoke<CreatorPreviewReceipt>(CREATOR_PREVIEW_CHANNELS.open, {
        ...openRequest(),
        policy: { ...previewPolicy, grantedCapabilities: ['notifications'] },
      })
    ).toEqual({ ok: false, code: 'CREATOR_PREVIEW_UNAUTHORIZED' });
    expect(fixture.runtime.open).not.toHaveBeenCalled();
  });

  it('requires both preview and request identifiers before it evaluates cancellation', async () => {
    const fixture = createRuntime();
    registerCreatorPreviewBridge(fixture.runtime);

    expect(await invoke<boolean>(CREATOR_PREVIEW_CHANNELS.cancel, { requestId: 'request-1' })).toEqual({
      ok: false,
      code: 'INVALID_PREVIEW_REQUEST',
    });
    expect(
      await invoke<boolean>(CREATOR_PREVIEW_CHANNELS.cancel, {
        previewId: 'preview-alarm',
        requestId: 'request-1',
      })
    ).toEqual({ ok: false, code: 'CREATOR_PREVIEW_SENDER_UNVERIFIED' });
  });

  it('keeps generic event broadcast disabled and reports inactive only when no runtime is wired', async () => {
    const fixture = createRuntime();
    registerCreatorPreviewBridge(fixture.runtime);
    expect(fixture.runtime.onEvent).not.toHaveBeenCalled();
    expect(bridgeHarness.emit).not.toHaveBeenCalled();
    expect(creatorPreviewChannels).not.toHaveProperty('reportCrash');

    registerCreatorPreviewBridge();
    expect(
      await invoke<CreatorPreviewPublicState>(CREATOR_PREVIEW_CHANNELS.getState, {
        previewId: 'preview-alarm',
      })
    ).toEqual({ ok: false, code: 'CREATOR_PREVIEW_BRIDGE_INACTIVE' });
  });

  it('dispatches through the trusted route only after sender and ownership admission', async () => {
    const fixture = createRuntime();
    const verify = vi.fn(() => true);
    const authorize = vi.fn(() => true);
    trustedDisposers.push(
      registerTrustedCreatorPreviewIpcBridge({
        runtime: fixture.runtime,
        host: trustedHost,
        senderVerifier: { verify },
        accessPolicy: { authorize },
      })
    );

    expect(await invokeTrusted<CreatorPreviewReceipt>(CREATOR_PREVIEW_CHANNELS.open, openRequest())).toEqual({
      ok: true,
      data: receipt('open'),
    });
    expect(verify).toHaveBeenCalledWith(trustedSender);
    expect(authorize).toHaveBeenCalledWith(trustedSender, {
      operation: 'open',
      previewId: 'preview-alarm',
      projectId: 'project-alarm',
      workspaceRoot: 'C:/workspace/alarm',
      entrypoint: 'dist/index.html',
      requestedCapabilities: ['notifications'],
    });
    expect(fixture.runtime.open).toHaveBeenCalledWith(
      expect.objectContaining({ previewId: 'preview-alarm', signal: expect.any(AbortSignal) })
    );
  });

  it('denies unverified senders and unauthorized project access before runtime dispatch', async () => {
    const fixture = createRuntime();
    let senderAllowed = false;
    let ownerAllowed = true;
    trustedDisposers.push(
      registerTrustedCreatorPreviewIpcBridge({
        runtime: fixture.runtime,
        host: trustedHost,
        senderVerifier: { verify: () => senderAllowed },
        accessPolicy: { authorize: () => ownerAllowed },
      })
    );

    expect(await invokeTrusted(CREATOR_PREVIEW_CHANNELS.open, openRequest())).toEqual({
      ok: false,
      code: 'CREATOR_PREVIEW_SENDER_UNVERIFIED',
    });
    senderAllowed = true;
    ownerAllowed = false;
    expect(await invokeTrusted(CREATOR_PREVIEW_CHANNELS.open, openRequest())).toEqual({
      ok: false,
      code: 'CREATOR_PREVIEW_UNAUTHORIZED',
    });
    expect(fixture.runtime.open).not.toHaveBeenCalled();
  });

  it('returns a public state without workspace, entrypoint, or sandbox identifiers', async () => {
    const session: CreatorPreviewSessionSnapshot = {
      previewId: 'preview-alarm',
      projectId: 'project-alarm',
      correlationId: 'correlation-1',
      workspaceRoot: 'C:/workspace/alarm',
      entrypoint: 'dist/index.html',
      policy: previewPolicy,
      state: 'active',
      sandboxId: 'sandbox-secret',
      previewUrl: 'https://preview.invalid',
      crashCount: 0,
      transitionSequence: 2,
    };
    const fixture = createRuntime({ getSession: vi.fn(() => session) });
    trustedDisposers.push(
      registerTrustedCreatorPreviewIpcBridge({
        runtime: fixture.runtime,
        host: trustedHost,
        senderVerifier: { verify: () => true },
        accessPolicy: { authorize: () => true },
      })
    );

    const result = await invokeTrusted<CreatorPreviewPublicState>(CREATOR_PREVIEW_CHANNELS.getState, {
      previewId: 'preview-alarm',
    });
    expect(result.ok).toBe(true);
    if (result.ok === false) throw new Error(result.code);
    expect(result.data.session).toMatchObject({ previewId: 'preview-alarm', projectId: 'project-alarm' });
    expect(result.data.session).not.toHaveProperty('workspaceRoot');
    expect(result.data.session).not.toHaveProperty('entrypoint');
    expect(result.data.session).not.toHaveProperty('sandboxId');
  });

  it('cancels every matching trusted invocation without exposing a renderer abort signal', async () => {
    const open = vi.fn(
      (request: CreatorPreviewOpenRequest) =>
        new Promise<CreatorPreviewReceipt>((_resolve, reject) => {
          const rejectCancelled = (): void => reject(new CreatorPreviewError('PREVIEW_CANCELLED', request.previewId));
          if (request.signal?.aborted) rejectCancelled();
          else request.signal?.addEventListener('abort', rejectCancelled, { once: true });
        })
    );
    const fixture = createRuntime({ open });
    trustedDisposers.push(
      registerTrustedCreatorPreviewIpcBridge({
        runtime: fixture.runtime,
        host: trustedHost,
        senderVerifier: { verify: () => true },
        accessPolicy: { authorize: () => true },
      })
    );

    const opening = invokeTrusted<CreatorPreviewReceipt>(CREATOR_PREVIEW_CHANNELS.open, openRequest());
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(
      await invokeTrusted<boolean>(CREATOR_PREVIEW_CHANNELS.cancel, {
        previewId: 'preview-alarm',
        requestId: 'request-1',
      })
    ).toEqual({ ok: true, data: true });
    expect(await opening).toEqual({ ok: false, code: 'PREVIEW_CANCELLED' });
  });
});

describe('creator preview project ownership registry', () => {
  it('keeps main-owned project claims reference-counted and rejects owner or root substitution', () => {
    const registry = createCreatorPreviewProjectOwnershipRegistry({
      normalizeWorkspaceRoot: (value) => value.replaceAll('\\', '/').toLowerCase(),
    });
    const releaseFirst = registry.claim({
      projectId: 'project-alarm',
      workspaceRoot: 'C:/Workspace/Alarm',
      ownerWebContentsId: 17,
    });
    const releaseSecond = registry.claim({
      projectId: 'project-alarm',
      workspaceRoot: 'c:/workspace/alarm',
      ownerWebContentsId: 17,
    });

    expect(
      registry.authorize(17, {
        operation: 'open',
        previewId: 'preview-alarm',
        projectId: 'project-alarm',
        workspaceRoot: 'C:\\Workspace\\Alarm',
      })
    ).toBe(true);
    expect(
      registry.authorize(18, {
        operation: 'open',
        previewId: 'preview-alarm',
        projectId: 'project-alarm',
        workspaceRoot: 'C:/Workspace/Alarm',
      })
    ).toBe(false);
    expect(registry.reservePreview(17, 'project-alarm', 'preview-alarm')).toBe(true);
    expect(registry.authorizePreview(17, 'project-alarm', 'preview-alarm')).toBe(true);
    expect(registry.authorizePreview(18, 'project-alarm', 'preview-alarm')).toBe(false);
    expect(() =>
      registry.claim({
        projectId: 'project-alarm',
        workspaceRoot: 'D:/Other',
        ownerWebContentsId: 17,
      })
    ).toThrow('different owner');

    expect(releaseFirst()).toEqual({ projectIds: [], previewIds: [] });
    expect(registry.getOwner('project-alarm')).toBe(17);
    expect(releaseSecond()).toEqual({ projectIds: ['project-alarm'], previewIds: ['preview-alarm'] });
    expect(registry.getOwner('project-alarm')).toBeUndefined();
  });
});

describe('creator preview Electron IPC wiring', () => {
  it('dispatches only for the claimed project root from the current main frame', async () => {
    const harness = createNativeHarness();
    const ownership = createCreatorPreviewProjectOwnershipRegistry({ normalizeWorkspaceRoot: (value) => value });
    const releaseClaim = ownership.claim({
      projectId: 'project-alarm',
      workspaceRoot: 'C:/workspace/alarm',
      ownerWebContentsId: harness.webContents.id,
    });
    const fixture = createRuntime();
    const dispose = registerElectronCreatorPreviewIpcBridge({
      runtime: fixture.runtime,
      ipcMain: harness.ipcMain,
      getMainWindow: () => harness.mainWindow,
      ownershipRegistry: ownership,
    });

    try {
      expect(await harness.invoke(CREATOR_PREVIEW_CHANNELS.open, openRequest())).toEqual({
        ok: true,
        data: receipt('open'),
      });
      expect(
        await harness.invoke(
          CREATOR_PREVIEW_CHANNELS.open,
          { ...openRequest(), requestId: 'request-child' },
          harness.event(harness.webContents, {})
        )
      ).toEqual({ ok: false, code: 'CREATOR_PREVIEW_SENDER_UNVERIFIED' });
      expect(
        await harness.invoke(CREATOR_PREVIEW_CHANNELS.open, {
          ...openRequest(),
          requestId: 'request-root-swap',
          workspaceRoot: 'D:/stolen',
        })
      ).toEqual({ ok: false, code: 'CREATOR_PREVIEW_UNAUTHORIZED' });
      expect(fixture.runtime.open).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
      releaseClaim();
    }
  });

  it('aborts pending native work and revokes project claims when its sender disappears', async () => {
    const harness = createNativeHarness();
    const ownership = createCreatorPreviewProjectOwnershipRegistry({ normalizeWorkspaceRoot: (value) => value });
    ownership.claim({
      projectId: 'project-alarm',
      workspaceRoot: 'C:/workspace/alarm',
      ownerWebContentsId: harness.webContents.id,
    });
    const open = vi.fn(
      (request: CreatorPreviewOpenRequest) =>
        new Promise<CreatorPreviewReceipt>((_resolve, reject) => {
          const rejectCancelled = (): void => reject(new CreatorPreviewError('PREVIEW_CANCELLED', request.previewId));
          if (request.signal?.aborted) rejectCancelled();
          else request.signal?.addEventListener('abort', rejectCancelled, { once: true });
        })
    );
    const session: CreatorPreviewSessionSnapshot = {
      previewId: 'preview-alarm',
      projectId: 'project-alarm',
      correlationId: 'correlation-1',
      workspaceRoot: 'C:/workspace/alarm',
      entrypoint: 'dist/index.html',
      policy: previewPolicy,
      state: 'active',
      sandboxId: 'sandbox-private',
      previewUrl: 'http://127.0.0.1:19001/',
      crashCount: 0,
      transitionSequence: 2,
    };
    const remove = vi.fn(async () => receipt('remove'));
    const fixture = createRuntime({ open, remove, getSession: vi.fn(() => session) });
    const dispose = registerElectronCreatorPreviewIpcBridge({
      runtime: fixture.runtime,
      ipcMain: harness.ipcMain,
      getMainWindow: () => harness.mainWindow,
      ownershipRegistry: ownership,
    });

    const opening = harness.invoke<CreatorPreviewReceipt>(CREATOR_PREVIEW_CHANNELS.open, openRequest());
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    harness.destroyWindow();

    expect(await opening).toEqual({ ok: false, code: 'PREVIEW_CANCELLED' });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({ previewId: 'preview-alarm', requestId: expect.stringMatching(/^owner-teardown-/) })
    );
    expect(ownership.getOwner('project-alarm')).toBeUndefined();
    dispose();
  });
});
