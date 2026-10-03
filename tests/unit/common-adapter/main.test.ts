/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AdapterConfig = {
  on: (emitter: { emit: (name: string, data: unknown) => unknown }) => void;
};
type AdapterIpcHandler = (event: unknown, info: unknown) => Promise<unknown>;

const mocks = vi.hoisted(() => ({
  adapter: vi.fn(),
  emit: vi.fn(),
  handle: vi.fn(),
  fromWebContents: vi.fn(),
  handler: undefined as AdapterIpcHandler | undefined,
  isPackaged: false,
}));

vi.mock('@office-ai/platform', () => ({
  bridge: { adapter: mocks.adapter },
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged;
    },
  },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: {
    handle: mocks.handle.mockImplementation((_channel: string, handler: AdapterIpcHandler) => {
      mocks.handler = handler;
    }),
  },
}));

vi.mock('@/common/adapter/registry', () => ({
  broadcastToAll: vi.fn(),
  getBridgeEmitter: vi.fn(),
  registerWebSocketBroadcaster: vi.fn(),
  setBridgeEmitter: vi.fn(),
}));

const registerAdapterHandler = async (): Promise<AdapterIpcHandler> => {
  await import('@/common/adapter/main');
  const config = mocks.adapter.mock.calls.at(-1)?.[0] as AdapterConfig | undefined;
  if (!config) throw new Error('Main adapter was not registered');
  config.on({ emit: mocks.emit });
  if (!mocks.handler) throw new Error('Main adapter IPC handler was not registered');
  return mocks.handler;
};

const trustedSenderEvent = (url = 'http://localhost:5173/settings'): unknown => {
  const frame = { url };
  const sender = { isDestroyed: vi.fn(() => false), mainFrame: frame };
  mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
  return { sender, senderFrame: frame };
};

const destroyedSenderEvent = (): unknown => {
  const frame = { url: 'http://localhost:5173/settings' };
  const sender = { isDestroyed: vi.fn(() => true), mainFrame: frame };
  mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
  return { sender, senderFrame: frame };
};

const subframeSenderEvent = (): unknown => {
  const topFrame = { url: 'http://localhost:5173/settings' };
  const childFrame = { url: 'http://localhost:5173/embedded' };
  const sender = { isDestroyed: vi.fn(() => false), mainFrame: topFrame };
  mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
  return { sender, senderFrame: childFrame };
};

const PERSONAL_CONTEXT_PROVIDER_EVENTS = [
  'personal-context.get',
  'personal-context.save',
  'personal-context.learning.set-paused',
  'personal-context.learning.propose',
  'personal-context.learning.confirm',
  'personal-context.learning.reject',
  'personal-context.learning.correct',
  'personal-context.learning.outcome',
  'personal-context.learning.forget',
  'personal-context.learning.delete',
  'personal-context.learning.export',
  'personal-secrets.list',
  'personal-secrets.save',
  'personal-secrets.remove',
] as const;

const SHELL_PROVIDER_EVENTS = [
  'shell.open-file',
  'shell.show-item-in-folder',
  'shell.open-external',
  'shell.check-tool-installed',
  'shell.open-folder-with',
] as const;

const NATIVE_FILE_PROVIDER_EVENTS = [
  'native-fs.get-files-by-dir',
  'native-fs.list-workspace-files',
  'native-fs.image-base64',
  'native-fs.fetch-remote-image',
  'native-fs.read',
  'native-fs.read-buffer',
  'native-fs.temp',
  'native-fs.write',
  'native-fs.zip',
  'native-fs.zip-cancel',
  'native-fs.metadata',
  'native-fs.copy',
  'native-fs.remove',
  'native-fs.rename',
  'native-fs.watch-start',
  'native-fs.watch-stop',
  'native-fs.watch-stop-all',
  'native-fs.office-watch-start',
  'native-fs.office-watch-stop',
] as const;

const NATIVE_CAPABILITY_PROVIDER_EVENTS = [
  'mcp-registry.list',
  'mcp-registry.extension-list',
  'mcp-registry.create',
  'mcp-registry.import',
  'mcp-registry.update',
  'mcp-registry.remove',
  'mcp-registry.toggle',
  'native-mcp.agent-configs',
  'native-mcp.test',
  'native-mcp.oauth-status',
  'native-mcp.oauth-login',
  'native-mcp.oauth-logout',
  'native-mcp.oauth-authenticated',
  'native-skills.list',
  'native-skills.materialize',
  'native-skills.info',
  'native-skills.import',
  'native-skills.scan',
  'native-skills.common-paths',
  'native-skills.detect-external',
  'native-skills.import-link',
  'native-skills.delete',
  'native-skills.paths',
  'native-skills.external-paths',
  'native-skills.external-add',
  'native-skills.external-remove',
] as const;

const ASSISTANT_RESOURCE_AND_SPEECH_PROVIDER_EVENTS = [
  'assistant-resource.read-rule',
  'assistant-resource.write-rule',
  'assistant-resource.delete-rule',
  'assistant-resource.read-skill',
  'assistant-resource.write-skill',
  'assistant-resource.delete-skill',
  'speech.transcribe',
] as const;

const WEBUI_PROVIDER_EVENTS = ['webui.get-status', 'webui.start', 'webui.stop'] as const;

const CRON_PROVIDER_EVENTS = [
  'cron.list-jobs',
  'cron.list-by-conversation',
  'cron.get-job',
  'cron.add-job',
  'cron.update-job',
  'cron.remove-job',
  'cron.run-now',
  'cron.save-skill',
  'cron.has-skill',
  'cron.delete-skill',
] as const;

const TEAM_PROVIDER_EVENTS = [
  'team.create',
  'team.list',
  'team.get',
  'team.remove',
  'team.add-agent',
  'team.remove-agent',
  'team.stop',
  'team.ensure-session',
  'team.rename-agent',
  'team.rename',
  'team.group.save',
  'team.group.remove',
  'team.task.save',
  'team.task.remove',
  'team.task.bind',
  'team.task.unbind',
  'team.set-session-mode',
] as const;

const COMPANY_PROVIDER_EVENTS = [
  'company.create-from-description',
  'company.get-structure',
  'company.get-rules',
  'company.set-rules',
  'company.list-agents',
  'company.set-assignment',
  'company.accept-drafts',
  'company.update-structure',
  'company.delete-company',
  'company.run-conversation',
  'company.resolve-permission',
  'company.cancel-conversation',
] as const;

const PACKAGE_PLATFORM_PROVIDER_EVENTS = [
  'package-platform.refresh',
  'package-platform.list',
  'package-platform.search',
  'package-platform.catalog.federated-search',
  'package-platform.status',
  'package-platform.install',
  'package-platform.uninstall',
  'package-platform.contributions',
  'package-platform.read-asset',
] as const;

const RESOURCE_PROVIDER_EVENTS = [
  'resource.get-state',
  'resource.set-mode',
  'resource.set-budget',
  'resource.apply-preset',
  'resource.lifecycle-activate',
  'resource.lifecycle-deactivate',
  'resource.lifecycle-get',
] as const;

const SYSTEM_INFO_PROVIDER_EVENTS = [
  'system-info.get-static',
  'system-info.refresh-static',
  'system-info.get-snapshot',
  'system-info.set-process-priority',
  'system-info.start-stream',
  'system-info.stop-stream',
] as const;

const OMNI_GATEWAY_PROVIDER_EVENTS = [
  'omni-gateway.get-status',
  'omni-gateway.apply-config',
  'omni-gateway.rotate-token',
  'omni-gateway.reveal-token',
  'omni-gateway.enable-web-access',
  'omni-gateway.disable-web-access',
  'omni-gateway.create-debug-access',
  'omni-gateway.revoke-debug-access',
  'omni-gateway.get-progress',
  'omni-gateway.set-auth-mode',
  'omni-gateway.set-session-ttl',
  'omni-gateway.set-tool-permission',
  'omni-gateway.list-oauth-clients',
  'omni-gateway.revoke-oauth-client',
  'omni-gateway.set-remote-access',
] as const;

describe('native auto-update adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows the configured development main frame without requiring an account', async () => {
    const handler = await registerAdapterHandler();

    await expect(
      handler(trustedSenderEvent(), JSON.stringify({ name: 'subscribe-auto-update.check', data: {} }))
    ).resolves.toBeUndefined();

    expect(mocks.emit).toHaveBeenCalledWith('subscribe-auto-update.check', {});
  });

  it('fails closed before dispatch for an untrusted renderer origin', async () => {
    const handler = await registerAdapterHandler();

    await expect(
      handler(
        trustedSenderEvent('https://untrusted.example/settings'),
        JSON.stringify({ name: 'subscribe-auto-update.download' })
      )
    ).rejects.toThrow('Untrusted auto-update IPC sender');

    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('rejects a remote origin in a packaged build even if it matches the development URL', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;

    await expect(
      handler(trustedSenderEvent(), JSON.stringify({ name: 'subscribe-auto-update.download' }))
    ).rejects.toThrow('Untrusted auto-update IPC sender');

    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('rejects a same-origin subframe even when its URL matches the configured renderer origin', async () => {
    const handler = await registerAdapterHandler();
    const topFrame = { url: 'http://localhost:5173/settings' };
    const childFrame = { url: 'http://localhost:5173/embedded' };
    const sender = { isDestroyed: vi.fn(() => false), mainFrame: topFrame };
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });

    await expect(
      handler({ sender, senderFrame: childFrame }, JSON.stringify({ name: 'subscribe-auto-update.quit-and-install' }))
    ).rejects.toThrow('Untrusted auto-update IPC sender');

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('Personal Context adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every registered Personal Context lifecycle provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      PERSONAL_CONTEXT_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(PERSONAL_CONTEXT_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(PERSONAL_CONTEXT_PROVIDER_EVENTS);
  });

  it('fails closed for every Personal Context lifecycle provider before the callback for an untrusted sender', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      PERSONAL_CONTEXT_PROVIDER_EVENTS.map((name) =>
        expect(
          handler(
            trustedSenderEvent('https://untrusted.example/settings'),
            JSON.stringify({ name, data: { unexpected: true } })
          )
        ).rejects.toThrow('Untrusted personal context IPC sender')
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file Personal Context senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.map((event) =>
        expect(handler(event(), JSON.stringify({ name: 'personal-context.get', data: undefined }))).rejects.toThrow(
          'Untrusted personal context IPC sender'
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('native capability adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact native capability provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      NATIVE_CAPABILITY_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(NATIVE_CAPABILITY_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(NATIVE_CAPABILITY_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file native capability senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        NATIVE_CAPABILITY_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow(
            'Untrusted native capability IPC sender'
          )
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('native file adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact native-file provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      NATIVE_FILE_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(NATIVE_FILE_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(NATIVE_FILE_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong packaged-file native-file senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        NATIVE_FILE_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow(
            'Untrusted native file IPC sender'
          )
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('assistant resource and speech adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact assistant-resource and speech provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      ASSISTANT_RESOURCE_AND_SPEECH_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(ASSISTANT_RESOURCE_AND_SPEECH_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(ASSISTANT_RESOURCE_AND_SPEECH_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file assistant-resource and speech senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        ASSISTANT_RESOURCE_AND_SPEECH_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow(
            'Untrusted assistant resource or speech IPC sender'
          )
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('WebUI adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact WebUI provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      WEBUI_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(WEBUI_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(WEBUI_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file WebUI senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        WEBUI_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow('Untrusted WebUI IPC sender')
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('Cron adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact Cron provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      CRON_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(CRON_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(CRON_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file Cron senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        CRON_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow('Untrusted cron IPC sender')
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('Team adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact Team provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      TEAM_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(TEAM_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(TEAM_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file Team senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        TEAM_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow('Untrusted Team IPC sender')
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('Company adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact Company provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      COMPANY_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(COMPANY_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(COMPANY_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file Company senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        COMPANY_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow('Untrusted Company IPC sender')
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('Shell adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact Shell provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      SHELL_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(SHELL_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(SHELL_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file Shell senders before dispatch', async () => {
    const handler = await registerAdapterHandler();
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        SHELL_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow('Untrusted shell IPC sender')
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('resource lifecycle adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact resource lifecycle provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      RESOURCE_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(RESOURCE_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(RESOURCE_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file resource lifecycle senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        RESOURCE_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow('Untrusted resource IPC sender')
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('system info adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact system-info provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      SYSTEM_INFO_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(SYSTEM_INFO_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(SYSTEM_INFO_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file system-info senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        SYSTEM_INFO_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow(
            'Untrusted system info IPC sender'
          )
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('package platform adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact package-platform provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      PACKAGE_PLATFORM_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(PACKAGE_PLATFORM_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(PACKAGE_PLATFORM_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file package-platform senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        PACKAGE_PLATFORM_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow(
            'Untrusted package platform IPC sender'
          )
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});

describe('Omni Gateway adapter IPC', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.handler = undefined;
    mocks.isPackaged = false;
    mocks.fromWebContents.mockReturnValue({ isDestroyed: vi.fn(() => false) });
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches every exact Omni Gateway provider for the trusted desktop main frame', async () => {
    const handler = await registerAdapterHandler();

    await Promise.all(
      OMNI_GATEWAY_PROVIDER_EVENTS.map((name) =>
        expect(handler(trustedSenderEvent(), JSON.stringify({ name, data: {} }))).resolves.toBeUndefined()
      )
    );

    expect(mocks.emit).toHaveBeenCalledTimes(OMNI_GATEWAY_PROVIDER_EVENTS.length);
    expect(mocks.emit.mock.calls.map(([name]) => name)).toEqual(OMNI_GATEWAY_PROVIDER_EVENTS);
  });

  it('rejects destroyed, subframe, wrong-origin, and wrong-file Omni Gateway senders before the callback', async () => {
    const handler = await registerAdapterHandler();
    mocks.isPackaged = true;
    const cases = [
      destroyedSenderEvent,
      subframeSenderEvent,
      () => trustedSenderEvent('https://untrusted.example/settings'),
      () => trustedSenderEvent('file:///C:/untrusted/index.html'),
    ];

    await Promise.all(
      cases.flatMap((event) =>
        OMNI_GATEWAY_PROVIDER_EVENTS.map((name) =>
          expect(handler(event(), JSON.stringify({ name, data: {} }))).rejects.toThrow(
            'Untrusted Omni Gateway IPC sender'
          )
        )
      )
    );

    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
