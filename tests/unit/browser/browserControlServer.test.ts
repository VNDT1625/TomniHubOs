import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  createBrowserControlServer,
  type BrowserControlDeps,
  type QuickTestControl,
} from '@process/browser/browserControlServer';
import {
  createBrowserSecretRedactionRegistry,
  createPagePerception,
  redactAgentVisibleText,
} from '@process/browser/pagePerception';

const makeQuickTest = (): QuickTestControl => ({
  discover: vi.fn().mockResolvedValue({ targets: ['web'] }),
  start: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
  observe: vi.fn().mockResolvedValue({ observing: true }),
  status: vi.fn().mockResolvedValue({ phase: 'running' }),
  save: vi.fn().mockResolvedValue({ testId: 'test-1' }),
  replay: vi.fn().mockResolvedValue({ status: 'passed' }),
  stop: vi.fn().mockResolvedValue({ stopped: true }),
  close: vi.fn().mockResolvedValue({ closed: true }),
});

const connect = async (quickTest?: QuickTestControl, overrides: Partial<BrowserControlDeps> = {}): Promise<Client> => {
  const deps = {
    viewManager: {},
    createInput: vi.fn(),
    pagePerception: {},
    mediaPipeline: {},
    coordinator: {},
    quickTest,
    ...overrides,
  } as unknown as BrowserControlDeps;
  const server = createBrowserControlServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'browser-control-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
};

const textOf = (result: unknown): string => {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((item) => item.text ?? '').join('\n');
};

type DelegationCase = {
  tool: string;
  method: keyof QuickTestControl;
  arguments: Record<string, unknown>;
  expected: Record<string, unknown>;
};

const delegationCases: DelegationCase[] = [
  {
    tool: 'quick_test_discover',
    method: 'discover',
    arguments: { rootPath: 'C:/repo' },
    expected: { rootPath: 'C:/repo' },
  },
  {
    tool: 'quick_test_start',
    method: 'start',
    arguments: { rootPath: 'C:/repo', mode: 'services', serviceIds: ['frontend', 'backend'], tabId: 'tab-1' },
    expected: {
      rootPath: 'C:/repo',
      mode: 'services',
      serviceIds: ['frontend', 'backend'],
      url: undefined,
      tabId: 'tab-1',
    },
  },
  {
    tool: 'quick_test_observe',
    method: 'observe',
    arguments: { sessionId: 'session-1' },
    expected: { sessionId: 'session-1' },
  },
  {
    tool: 'quick_test_status',
    method: 'status',
    arguments: { sessionId: 'session-1' },
    expected: { sessionId: 'session-1' },
  },
  {
    tool: 'quick_test_save',
    method: 'save',
    arguments: { sessionId: 'session-1', name: 'Checkout' },
    expected: { sessionId: 'session-1', name: 'Checkout' },
  },
  {
    tool: 'quick_test_replay',
    method: 'replay',
    arguments: { rootPath: 'C:/repo', testId: 'test-1' },
    expected: { rootPath: 'C:/repo', testId: 'test-1', tabId: undefined },
  },
  {
    tool: 'quick_test_stop',
    method: 'stop',
    arguments: { sessionId: 'session-1', keepTab: true },
    expected: { sessionId: 'session-1', keepTab: true },
  },
  {
    tool: 'quick_test_close',
    method: 'close',
    arguments: { sessionId: 'session-1' },
    expected: { sessionId: 'session-1' },
  },
];

describe('browserControlServer Quick Test tools', () => {
  it('keeps Quick Test tools hidden when the lifecycle is not injected', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names.some((name) => name.startsWith('quick_test_'))).toBe(false);
  });

  it('exposes the complete lifecycle when injected', async () => {
    const client = await connect(makeQuickTest());
    const names = (await client.listTools()).tools
      .map((tool) => tool.name)
      .filter((name) => name.startsWith('quick_test_'));
    expect(names.toSorted()).toEqual([
      'quick_test_audit',
      'quick_test_capture',
      'quick_test_close',
      'quick_test_discover',
      'quick_test_observe',
      'quick_test_replay',
      'quick_test_save',
      'quick_test_start',
      'quick_test_status',
      'quick_test_stop',
      'quick_test_visibility',
    ]);
  });

  it.each(delegationCases)(
    'delegates $tool with a validated request',
    async ({ tool, method, arguments: args, expected }) => {
      const quickTest = makeQuickTest();
      const client = await connect(quickTest);
      await client.callTool({ name: tool, arguments: args });
      expect(quickTest[method]).toHaveBeenCalledWith(expected);
    }
  );

  it('rejects a services launch without explicit service ids', async () => {
    const quickTest = makeQuickTest();
    const client = await connect(quickTest);
    const result = await client.callTool({
      name: 'quick_test_start',
      arguments: { rootPath: 'C:/repo', mode: 'services' },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(quickTest.start).not.toHaveBeenCalled();
  });

  it('returns a severity-first bounded UI audit for the session tab', async () => {
    const quickTest = makeQuickTest();
    vi.mocked(quickTest.status).mockResolvedValueOnce({
      sessionId: 'session-1',
      rootPath: 'C:/repo',
      mode: 'frontend',
      tabId: 'tab-1',
      url: 'http://localhost:3000',
      services: [],
      running: true,
      observing: true,
      recordedEvents: 2,
      terminalSessionIds: [],
    });
    const contents = { executeJavaScript: vi.fn() };
    const findings = Array.from({ length: 45 }, (_, index) => ({
      ruleId: `rule-${index}`,
      category: 'accessibility' as const,
      severity: index === 44 ? ('critical' as const) : ('minor' as const),
      selector: `#item-${index}`,
      detail: 'Finding',
    }));
    const auditPage = vi.fn().mockResolvedValue({
      score: 73,
      auditedAt: 100,
      url: 'http://localhost:3000',
      elementCount: 120,
      findings,
      categoryScores: { contrast: 80, typography: 90, accessibility: 60, layout: 70, interaction: 65 },
    });
    const client = await connect(quickTest, {
      viewManager: { getWebContents: vi.fn().mockReturnValue(contents) } as never,
      auditPage,
    });

    const result = await client.callTool({ name: 'quick_test_audit', arguments: { sessionId: 'session-1' } });
    const payload = JSON.parse(textOf(result)) as {
      totalFindings: number;
      findings: Array<{ severity: string }>;
      truncated: boolean;
    };
    expect(auditPage).toHaveBeenCalledWith(contents);
    expect(payload.totalFindings).toBe(45);
    expect(payload.findings).toHaveLength(40);
    expect(payload.findings[0]?.severity).toBe('critical');
    expect(payload.truncated).toBe(true);
  });

  it('captures full-page evidence through the shared Quick Test capture engine', async () => {
    const quickTest = makeQuickTest();
    vi.mocked(quickTest.status).mockResolvedValueOnce({
      sessionId: 'session-1',
      rootPath: 'C:/repo',
      mode: 'frontend',
      tabId: 'tab-1',
      url: 'http://localhost:3000',
      services: [],
      running: true,
      observing: true,
      recordedEvents: 0,
      terminalSessionIds: [],
    });
    const contents = { executeJavaScript: vi.fn() };
    const captureEvidence = vi.fn().mockResolvedValue({
      filePath: 'C:/repo/.omni/inspect/shot-full-page-1.png',
      dataUrl: 'data:image/png;base64,cG5n',
      mode: 'fullPage',
    });
    const protectCapture = vi.fn(
      async (_tabId: string, _mode: 'viewport' | 'fullPage', capture: () => Promise<Uint8Array>) => {
        await capture();
        const png = Buffer.from('safe');
        return {
          dataUrl: `data:image/png;base64,${png.toString('base64')}`,
          png,
          width: 10,
          height: 10,
          secretContext: { redactedRegions: 1, sensitiveMode: false, detected: [] },
        };
      }
    );
    const persistProtectedEvidence = vi.fn().mockResolvedValue(undefined);
    const client = await connect(quickTest, {
      viewManager: { getWebContents: vi.fn().mockReturnValue(contents) } as never,
      captureEvidence,
      pagePerception: { protectCapture } as never,
      persistProtectedEvidence,
    });

    const result = await client.callTool({
      name: 'quick_test_capture',
      arguments: { sessionId: 'session-1', mode: 'fullPage' },
    });
    const content = (result as { content: Array<{ type: string; data?: string; text?: string }> }).content;
    expect(captureEvidence).toHaveBeenCalledWith(contents, 'C:/repo', 'fullPage', { persist: false });
    expect(protectCapture).toHaveBeenCalledWith('tab-1', 'fullPage', expect.any(Function));
    expect(persistProtectedEvidence).toHaveBeenCalledWith(
      'C:/repo/.omni/inspect/shot-full-page-1.png',
      Buffer.from('safe')
    );
    expect(content.find((item) => item.type === 'image')?.data).toBe('c2FmZQ==');
    expect(content.find((item) => item.type === 'text')?.text).toContain('shot-full-page-1.png');
  });

  it('rejects evidence collection when the session has no browser tab', async () => {
    const quickTest = makeQuickTest();
    vi.mocked(quickTest.status).mockResolvedValueOnce({
      sessionId: 'session-1',
      rootPath: 'C:/repo',
      mode: 'services',
      url: '',
      services: [],
      running: true,
      observing: false,
      recordedEvents: 0,
      terminalSessionIds: [],
    });
    const auditPage = vi.fn();
    const client = await connect(quickTest, { auditPage });
    const result = await client.callTool({ name: 'quick_test_audit', arguments: { sessionId: 'session-1' } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('no browser tab');
    expect(auditPage).not.toHaveBeenCalled();
  });

  it('returns dependency failures as bounded MCP errors', async () => {
    const quickTest = makeQuickTest();
    vi.mocked(quickTest.status).mockRejectedValueOnce(new Error('session disappeared'));
    const client = await connect(quickTest);
    const result = await client.callTool({ name: 'quick_test_status', arguments: { sessionId: 'session-1' } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).toContain('session disappeared');
  });
});

describe('browserControlServer report-ready screenshots', () => {
  it('persists a protected screenshot and returns its local artifact path', async () => {
    const png = Buffer.from('report-image');
    const persistScreenshot = vi.fn().mockResolvedValue('C:/artifacts/browser-shot.png');
    const client = await connect(undefined, {
      getActiveTabId: () => 'active-tab',
      pagePerception: {
        capture: vi.fn().mockResolvedValue({
          dataUrl: `data:image/png;base64,${png.toString('base64')}`,
          png,
          width: 1280,
          height: 720,
          secretContext: { redactedRegions: 0, sensitiveMode: false, detected: [] },
        }),
      } as never,
      persistScreenshot,
    });

    const result = await client.callTool({ name: 'browser_screenshot', arguments: { persist: true } });
    const payload = JSON.parse(textOf(result)) as { filePath?: string };

    expect(persistScreenshot).toHaveBeenCalledWith('active-tab', png);
    expect(payload.filePath).toBe('C:/artifacts/browser-shot.png');
  });
});

describe('browserControlServer browser_secret_type', () => {
  it('delegates an alias-only request and returns confirmation without the secret value', async () => {
    const fillSecret = vi.fn().mockResolvedValue(undefined);
    const client = await connect(undefined, {
      fillSecret,
      getActiveTabId: () => 'active-tab',
    });

    const result = await client.callTool({
      name: 'browser_secret_type',
      arguments: { repository: 'C:/repo', selector: '#api-key', secret_alias: 'API_KEY' },
    });

    expect(fillSecret).toHaveBeenCalledWith({
      repository: 'C:/repo',
      selector: '#api-key',
      secretAlias: 'API_KEY',
      tabId: 'active-tab',
    });
    expect(textOf(result)).toContain('The secret value was not exposed.');
  });

  it('rejects a raw secret-shaped alias before it can reach a browser callback', async () => {
    const fillSecret = vi.fn().mockResolvedValue(undefined);
    const client = await connect(undefined, { fillSecret });

    const result = await client.callTool({
      name: 'browser_secret_type',
      arguments: { repository: 'C:/repo', selector: '#api-key', secret_alias: 'not a valid alias' },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(fillSecret).not.toHaveBeenCalled();
  });

  it('does not include a callback failure detail in an MCP error', async () => {
    const client = await connect(undefined, {
      fillSecret: vi.fn().mockRejectedValue(new Error('resolved value: never-expose-this')),
      getActiveTabId: () => 'active-tab',
    });

    const result = await client.callTool({
      name: 'browser_secret_type',
      arguments: { repository: 'C:/repo', selector: '#api-key', secret_alias: 'API_KEY' },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).not.toContain('never-expose-this');
  });
});

describe('browserControlServer browser_personal_secret_type', () => {
  it('delegates an opaque handle and one variable name without returning a value', async () => {
    const fillPersonalSecret = vi.fn().mockResolvedValue(undefined);
    const client = await connect(undefined, {
      fillPersonalSecret,
      getActiveTabId: () => 'active-tab',
    });

    const result = await client.callTool({
      name: 'browser_personal_secret_type',
      arguments: {
        handle: 'secret://123e4567-e89b-12d3-a456-426614174000',
        variable_name: 'PASSWORD',
        selector: '#password',
      },
    });

    expect(fillPersonalSecret).toHaveBeenCalledWith({
      handle: 'secret://123e4567-e89b-12d3-a456-426614174000',
      field: 'PASSWORD',
      selector: '#password',
      tabId: 'active-tab',
    });
    expect(textOf(result)).toContain('The value was not exposed.');
  });

  it('does not echo a resolved value from a trusted-host failure', async () => {
    const client = await connect(undefined, {
      fillPersonalSecret: vi.fn().mockRejectedValue(new Error('resolved value: never-expose-personal-secret')),
      getActiveTabId: () => 'active-tab',
    });

    const result = await client.callTool({
      name: 'browser_personal_secret_type',
      arguments: {
        handle: 'secret://123e4567-e89b-12d3-a456-426614174000',
        variable_name: 'PASSWORD',
        selector: '#password',
      },
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(textOf(result)).not.toContain('never-expose-personal-secret');
  });
});

describe('browserControlWiring target-bound secret fill', () => {
  it('registers protection before executing a browser fill', async () => {
    const executeJavaScriptInIsolatedWorld = vi.fn();
    const wiring = await import('@process/browser/browserControlWiring');

    await expect(
      wiring.fillResolvedBrowserSecret(
        {
          viewManager: {
            getWebContents: () => ({ executeJavaScriptInIsolatedWorld }) as never,
          } as never,
          tabId: 'tab-too-broad',
          selector: `#${'x'.repeat(2_049)}`,
          expectedTarget: 'example.com',
          name: 'PASSWORD',
        },
        'must-not-reach-the-page'
      )
    ).rejects.toThrow('Secret redaction selector is invalid');

    expect(executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled();
  });

  it('refuses a navigation race in the isolated renderer world before touching the DOM', async () => {
    vi.resetModules();
    const rawSecret = 'never-fill-on-the-wrong-origin';
    const querySelector = vi.fn(() => null);
    const evaluateAtNavigatedOrigin = async (code: string): Promise<unknown> =>
      Function(
        'location',
        'document',
        `return ${code};`
      )({ href: 'https://attacker.example/collect', hostname: 'attacker.example' }, { querySelector });
    const executeJavaScript = vi.fn(evaluateAtNavigatedOrigin);
    const executeJavaScriptInIsolatedWorld = vi.fn(
      async (_worldId: number, sources: Array<{ code: string }>): Promise<unknown> =>
        evaluateAtNavigatedOrigin(sources[0]?.code ?? '')
    );
    const contents = {
      getURL: vi.fn(() => 'https://example.com/login'),
      executeJavaScript,
      executeJavaScriptInIsolatedWorld,
    };
    const viewManager = { getWebContents: vi.fn(() => contents) };

    vi.doMock('@process/browser/browserBridge', () => ({
      getBrowserServices: () => ({ viewManager }),
    }));

    const wiring = await import('@process/browser/browserControlWiring');
    const resolve = vi.fn().mockResolvedValue({ PASSWORD: rawSecret });
    wiring.configureBrowserPersonalSecretVault({ resolve } as unknown as Parameters<
      typeof wiring.configureBrowserPersonalSecretVault
    >[0]);
    const deps = wiring.getBrowserControlDeps(() => undefined);
    if (!deps.fillPersonalSecret) throw new Error('Expected Personal Secret browser sink.');

    await expect(
      deps.fillPersonalSecret({
        tabId: 'tab-1',
        selector: '#password',
        handle: 'secret://11111111-1111-1111-1111-111111111111',
        field: 'PASSWORD',
        expectedTarget: 'example.com',
      })
    ).rejects.toThrow('Could not fill the selected browser form control');

    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ target: 'example.com', fields: ['PASSWORD'] }));
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce();
    expect(executeJavaScript).not.toHaveBeenCalled();
    expect(querySelector).not.toHaveBeenCalled();
  });
});

describe('secret-aware browser perception', () => {
  it('redacts known secret assignments while leaving already masked values readable', () => {
    const text = [
      'GMAIL_OAUTH_CLIENT_SECRET=GOCSPX-never-expose-this-value',
      'GMAIL_TOKEN_ENCRYPTION_KEYS=****',
      'BACKUP_GMAIL_TOKEN_ENCRYPTION_KEYS=Abcdefghijklmnopqrstuvwxyz0123456789abcd=',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signaturevalue',
    ].join('\n');

    const redacted = redactAgentVisibleText(text);

    expect(redacted).not.toContain('never-expose-this-value');
    expect(redacted).toContain('GMAIL_TOKEN_ENCRYPTION_KEYS=****');
    expect(redacted).not.toContain('Abcdefghijklmnopqrstuvwxyz0123456789abcd=');
    expect(redacted).toContain('Authorization: [REDACTED]');
  });

  it('binds selector rules to one exact tab and hostname until their TTL expires', () => {
    let now = 1_000;
    const registry = createBrowserSecretRedactionRegistry(() => now);
    registry.registerSelector({
      tabId: 'tab-1',
      hostname: 'Console.Google.COM',
      selector: '#client-secret',
      name: 'GMAIL_OAUTH_CLIENT_SECRET',
      reference: 'secret://gmail-client',
      ttlMs: 1_000,
    });

    expect(registry.snapshot('tab-1', 'console.google.com').selectors).toHaveLength(1);
    expect(registry.snapshot('tab-2', 'console.google.com').selectors).toHaveLength(0);
    expect(registry.snapshot('tab-1', 'accounts.google.com').selectors).toHaveLength(0);

    now = 2_001;
    expect(registry.snapshot('tab-1', 'console.google.com').selectors).toHaveLength(0);
  });

  it('returns only a locally composited PNG and opaque secret metadata', async () => {
    const rawPng = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const registry = createBrowserSecretRedactionRegistry();
    registry.registerSelector({
      tabId: 'tab-1',
      hostname: 'console.google.com',
      selector: '#client-secret',
      name: 'GMAIL_OAUTH_CLIENT_SECRET',
      reference: 'secret://gmail-client',
    });
    const scan = {
      hostname: 'console.google.com',
      viewportWidth: 10,
      viewportHeight: 10,
      documentWidth: 10,
      documentHeight: 10,
      rects: [{ x: 0, y: 0, width: 5, height: 5 }],
      matchedSelectors: ['#client-secret'],
    };
    const driver = {
      getURL: () => 'https://console.google.com/project',
      executeJavaScript: vi.fn().mockResolvedValue(scan),
      executeJavaScriptInIsolatedWorld: vi.fn().mockResolvedValue(scan),
      capturePage: vi.fn().mockResolvedValue({
        toDataURL: () => `data:image/png;base64,${rawPng.toString('base64')}`,
        toPNG: () => rawPng,
        getSize: () => ({ width: 10, height: 10 }),
        isEmpty: () => false,
      }),
    };
    const coordinator = {
      requestLease: vi.fn().mockResolvedValue({ id: 'lease-1' }),
      releaseLease: vi.fn(),
    };
    const perception = createPagePerception({
      getWebContents: () => driver,
      coordinator,
      redactionRegistry: registry,
    });

    const result = await perception.capture('tab-1');
    const pixels = await sharp(result.png).raw().toBuffer();
    const topLeft = [...pixels.subarray(0, 3)];
    const bottomRightOffset = (9 * 10 + 9) * 4;
    const bottomRight = [...pixels.subarray(bottomRightOffset, bottomRightOffset + 3)];

    expect(topLeft).toEqual([17, 17, 17]);
    expect(bottomRight).toEqual([255, 0, 0]);
    expect(result.secretContext?.detected).toEqual([
      { name: 'GMAIL_OAUTH_CLIENT_SECRET', reference: 'secret://gmail-client', status: 'redacted' },
    ]);
    expect(driver.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2);
    expect(coordinator.releaseLease).toHaveBeenCalledWith('lease-1');
  });

  it('fails closed when sensitive mode cannot locate a region to protect', async () => {
    const rawPng = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const registry = createBrowserSecretRedactionRegistry();
    registry.enableSensitiveMode({ tabId: 'tab-1', hostname: 'console.google.com' });
    const scan = {
      hostname: 'console.google.com',
      viewportWidth: 2,
      viewportHeight: 2,
      documentWidth: 2,
      documentHeight: 2,
      rects: [],
      matchedSelectors: [],
    };
    const perception = createPagePerception({
      getWebContents: () => ({
        getURL: () => 'https://console.google.com/project',
        executeJavaScript: vi.fn().mockResolvedValue(scan),
        capturePage: vi.fn().mockResolvedValue({
          toDataURL: () => '',
          toPNG: () => rawPng,
          getSize: () => ({ width: 2, height: 2 }),
          isEmpty: () => false,
        }),
      }),
      coordinator: {
        requestLease: vi.fn().mockResolvedValue({ id: 'lease-1' }),
        releaseLease: vi.fn(),
      },
      redactionRegistry: registry,
    });

    await expect(perception.capture('tab-1')).rejects.toThrow('Sensitive page could not be safely redacted');
  });

  it('fails closed when a protected region moves during capture', async () => {
    const rawPng = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const registry = createBrowserSecretRedactionRegistry();
    registry.enableSensitiveMode({ tabId: 'tab-1', hostname: 'console.google.com' });
    const scan = (x: number) => ({
      hostname: 'console.google.com',
      viewportWidth: 10,
      viewportHeight: 10,
      documentWidth: 10,
      documentHeight: 10,
      rects: [{ x, y: 0, width: 2, height: 2 }],
      matchedSelectors: [],
    });
    const executeJavaScriptInIsolatedWorld = vi.fn().mockResolvedValueOnce(scan(0)).mockResolvedValueOnce(scan(5));
    const perception = createPagePerception({
      getWebContents: () => ({
        getURL: () => 'https://console.google.com/project',
        executeJavaScriptInIsolatedWorld,
        capturePage: vi.fn().mockResolvedValue({
          toDataURL: () => '',
          toPNG: () => rawPng,
          getSize: () => ({ width: 10, height: 10 }),
          isEmpty: () => false,
        }),
      }),
      coordinator: {
        requestLease: vi.fn().mockResolvedValue({ id: 'lease-1' }),
        releaseLease: vi.fn(),
      },
      redactionRegistry: registry,
    });

    await expect(perception.capture('tab-1')).rejects.toThrow('Secret regions moved');
  });
});
