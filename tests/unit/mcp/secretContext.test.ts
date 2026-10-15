import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureBrowserSecretValue } from '@process/agentRuntime/agentMesh/mcp/secret-context/browserCapture';
import {
  getSecretContextMcpHost,
  startSecretContextMcpHost,
  stopSecretContextMcpHost,
} from '@process/agentRuntime/agentMesh/mcp/secret-context/host';
import { createSecretContextUseRouter } from '@process/agentRuntime/agentMesh/mcp/secret-context/router';
import {
  AGENT_SECRET_CONTEXT_USE_TOOL,
  createSecretContextServer,
  SECRET_CONTEXT_CAPTURE_TOOL,
  SECRET_CONTEXT_GENERATE_TOOL,
  SECRET_CONTEXT_LIST_TOOL,
  SECRET_CONTEXT_REQUEST_TOOL,
  TOMNY_SECRET_TOOLS,
  type SecretContextServerAuthority,
} from '@process/agentRuntime/agentMesh/mcp/secret-context/server';
import {
  configureTerminalSecretPort,
  createSecretDestinationSinks,
  registerDeploymentSecretTarget,
  registerManagedProcessSecretTarget,
  resetSecretDestinationTargets,
} from '@process/agentRuntime/agentMesh/mcp/secret-context/sinks';
import { createSecretRequestStore } from '@process/agentRuntime/agentMesh/mcp/secret-context/requests';
import type { SecretDescriptor } from '@process/agentRuntime/contextTypes';
import type { SecretVault } from '@process/agentRuntime/secretVault';
import { tomnyToolAccessForPermission } from '@process/experimentalCore/adapters/tomnyCoreAdapter';

const mcpText = (result: unknown): string =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .map((entry) => entry.text ?? '')
    .join('\n');

const connect = async (
  router: ReturnType<typeof createSecretContextUseRouter>,
  authority?: SecretContextServerAuthority
) => {
  const server = createSecretContextServer({ router, authority });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'secret-context-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
};

const descriptor = (
  handle: string,
  input: Pick<SecretDescriptor, 'label' | 'kind' | 'fields' | 'binding'>
): SecretDescriptor => ({
  ...input,
  handle,
  createdAt: 100,
  updatedAt: 100,
});

describe('Secret Context capability', () => {
  afterEach(async () => {
    resetSecretDestinationTargets();
    await stopSecretContextMcpHost();
  });

  it('routes an exact opaque browser request and returns only a receipt', async () => {
    const useBrowserSecret = vi.fn().mockResolvedValue(undefined);
    const router = createSecretContextUseRouter({
      now: () => 123,
      createReceiptId: () => 'secret-use://receipt',
    });
    router.registerSink('browser.fill', useBrowserSecret);
    const { client, server } = await connect(router);

    try {
      const handle = 'secret://11111111-1111-1111-1111-111111111111';
      const field = 'API_TOKEN';
      const selector = '#credential';
      const result = await client.callTool({
        name: AGENT_SECRET_CONTEXT_USE_TOOL,
        arguments: {
          handle,
          field,
          sink: 'browser.fill',
          locator: { tabId: 'tab-1', selector },
          surface: 'browser',
          purpose: 'browser-fill',
          target: 'example.com',
        },
      });
      const text = mcpText(result);

      expect(JSON.parse(text)).toEqual({
        receiptId: 'secret-use://receipt',
        status: 'used',
        sink: 'browser.fill',
        surface: 'browser',
        purpose: 'browser-fill',
        target: 'example.com',
        usedAt: 123,
      });
      expect(text).not.toContain(handle);
      expect(text).not.toContain(field);
      expect(text).not.toContain(selector);
      expect(useBrowserSecret).toHaveBeenCalledWith({
        handle,
        field,
        sink: 'browser.fill',
        locator: { tabId: 'tab-1', selector },
        surface: 'browser',
        purpose: 'browser-fill',
        target: 'example.com',
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('replaces sink failures with a generic error that cannot echo secret metadata or values', async () => {
    const rawSecret = 'never-return-this-secret';
    const router = createSecretContextUseRouter();
    router.registerSink('browser.fill', async () => {
      throw new Error(`Resolved value: ${rawSecret}`);
    });
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: AGENT_SECRET_CONTEXT_USE_TOOL,
        arguments: {
          handle: 'secret://22222222-2222-2222-2222-222222222222',
          field: 'PASSWORD',
          sink: 'browser.fill',
          locator: { tabId: 'tab-private', selector: '#password' },
          surface: 'browser',
          purpose: 'browser-fill',
          target: 'example.com',
        },
      });

      expect(result.isError).toBe(true);
      expect(mcpText(result)).toBe('Secret context use failed.');
      expect(mcpText(result)).not.toContain(rawSecret);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('rejects browser routes outside the host-scoped tab authority', async () => {
    const useBrowserSecret = vi.fn().mockResolvedValue(undefined);
    const router = createSecretContextUseRouter();
    router.registerSink('browser.fill', useBrowserSecret);
    const { client, server } = await connect(router, {
      scopeId: 'core:session-a',
      surface: 'browser',
      allowedTabIds: new Set(['allowed-tab']),
    });

    try {
      const result = await client.callTool({
        name: AGENT_SECRET_CONTEXT_USE_TOOL,
        arguments: {
          handle: 'secret://scoped-browser-value',
          field: 'API_TOKEN',
          sink: 'browser.fill',
          locator: { tabId: 'other-tab', selector: '#token' },
          target: 'example.com',
        },
      });

      expect(result.isError).toBe(true);
      expect(mcpText(result)).toBe('Secret context use failed.');
      expect(useBrowserSecret).not.toHaveBeenCalled();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('injects a secret only into an exact backend process and variable registered by Main', async () => {
    const rawSecret = 'backend-only-secret';
    const inject = vi.fn().mockResolvedValue(undefined);
    registerManagedProcessSecretTarget({
      id: 'prewise-backend',
      allowedVariables: ['GMAIL_OAUTH_CLIENT_SECRET'],
      inject,
    });
    const vault = {
      resolve: vi.fn().mockResolvedValue({ GMAIL_OAUTH_CLIENT_SECRET: rawSecret }),
    } as unknown as SecretVault;
    const router = createSecretContextUseRouter();
    for (const [name, sink] of Object.entries(createSecretDestinationSinks(vault))) {
      router.registerSink(name, sink);
    }
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: AGENT_SECRET_CONTEXT_USE_TOOL,
        arguments: {
          handle: 'secret://gmail-oauth',
          field: 'GMAIL_OAUTH_CLIENT_SECRET',
          sink: 'process.env.inject',
          locator: { processId: 'prewise-backend', variable: 'GMAIL_OAUTH_CLIENT_SECRET' },
        },
      });

      expect(result.isError).not.toBe(true);
      expect(mcpText(result)).not.toContain(rawSecret);
      expect(inject).toHaveBeenCalledWith({
        name: 'GMAIL_OAUTH_CLIENT_SECRET',
        value: rawSecret,
        source: { handle: 'secret://gmail-oauth', field: 'GMAIL_OAUTH_CLIENT_SECRET' },
      });
      expect(vault.resolve).toHaveBeenCalledWith({
        handle: 'secret://gmail-oauth',
        fields: ['GMAIL_OAUTH_CLIENT_SECRET'],
        surface: 'secret-firewall',
        purpose: 'opaque-use',
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('writes a secret only to an exact pre-registered deployment scope', async () => {
    const rawSecret = 'deployment-only-secret';
    const putSecret = vi.fn().mockResolvedValue(undefined);
    registerDeploymentSecretTarget({
      provider: 'cloudflare',
      projectId: 'prewise-api',
      environment: 'production',
      allowedNames: ['GMAIL_TOKEN_ENCRYPTION_KEYS'],
      putSecret,
    });
    const vault = {
      resolve: vi.fn().mockResolvedValue({ GMAIL_TOKEN_ENCRYPTION_KEYS: rawSecret }),
    } as unknown as SecretVault;
    const router = createSecretContextUseRouter();
    for (const [name, sink] of Object.entries(createSecretDestinationSinks(vault))) {
      router.registerSink(name, sink);
    }
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: AGENT_SECRET_CONTEXT_USE_TOOL,
        arguments: {
          handle: 'secret://gmail-fernet',
          field: 'GMAIL_TOKEN_ENCRYPTION_KEYS',
          sink: 'deployment.secret.put',
          locator: {
            provider: 'cloudflare',
            projectId: 'prewise-api',
            environment: 'production',
            name: 'GMAIL_TOKEN_ENCRYPTION_KEYS',
          },
        },
      });

      expect(result.isError).not.toBe(true);
      expect(mcpText(result)).not.toContain(rawSecret);
      expect(putSecret).toHaveBeenCalledWith({
        name: 'GMAIL_TOKEN_ENCRYPTION_KEYS',
        value: rawSecret,
        source: { handle: 'secret://gmail-fernet', field: 'GMAIL_TOKEN_ENCRYPTION_KEYS' },
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('fails closed before vault resolution when a destination is not pre-registered', async () => {
    const vault = { resolve: vi.fn() } as unknown as SecretVault;
    const router = createSecretContextUseRouter();
    for (const [name, sink] of Object.entries(createSecretDestinationSinks(vault))) {
      router.registerSink(name, sink);
    }
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: AGENT_SECRET_CONTEXT_USE_TOOL,
        arguments: {
          handle: 'secret://blocked',
          field: 'API_TOKEN',
          sink: 'process.env.inject',
          locator: { processId: 'unknown-backend', variable: 'API_TOKEN' },
        },
      });

      expect(result.isError).toBe(true);
      expect(mcpText(result)).toBe('Secret context use failed.');
      expect(vault.resolve).not.toHaveBeenCalled();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('rejects renaming a secret field into a different registered destination variable', async () => {
    registerManagedProcessSecretTarget({
      id: 'prewise-backend',
      allowedVariables: ['SAFE_TARGET'],
      inject: vi.fn(),
    });
    const vault = { resolve: vi.fn() } as unknown as SecretVault;
    const router = createSecretContextUseRouter();
    for (const [name, sink] of Object.entries(createSecretDestinationSinks(vault))) router.registerSink(name, sink);
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: AGENT_SECRET_CONTEXT_USE_TOOL,
        arguments: {
          handle: 'secret://blocked-remap',
          field: 'SOURCE_SECRET',
          sink: 'process.env.inject',
          locator: { processId: 'prewise-backend', variable: 'SAFE_TARGET' },
        },
      });

      expect(result.isError).toBe(true);
      expect(vault.resolve).not.toHaveBeenCalled();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('captures one exact browser field into the vault and returns only opaque metadata', async () => {
    const rawSecret = 'oauth-client-secret-value';
    const selector = '[data-client-secret]';
    const stored = descriptor('secret://captured-oauth-client', {
      label: 'Gmail OAuth client',
      kind: 'credential',
      fields: ['GMAIL_OAUTH_CLIENT_SECRET'],
      binding: {
        surfaces: ['secret-firewall'],
        purposes: ['opaque-use'],
      },
    });
    const put = vi.fn().mockResolvedValue(stored);
    const captureBrowserValue = vi.fn().mockResolvedValue(rawSecret);
    const onSecretStored = vi.fn();
    const router = createSecretContextUseRouter({
      now: () => 456,
      createCaptureReceiptId: () => 'secret-capture://receipt',
      vault: { put } as unknown as SecretVault,
      captureBrowserValue,
      onSecretStored,
    });
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: SECRET_CONTEXT_CAPTURE_TOOL,
        arguments: {
          label: 'Gmail OAuth client',
          field: 'GMAIL_OAUTH_CLIENT_SECRET',
          kind: 'credential',
          locator: { tabId: 'google-cloud-tab', selector },
          target: 'CONSOLE.CLOUD.GOOGLE.COM',
          scope: 'app',
        },
      });
      const text = mcpText(result);

      expect(JSON.parse(text)).toEqual({
        receiptId: 'secret-capture://receipt',
        status: 'captured',
        handle: stored.handle,
        field: 'GMAIL_OAUTH_CLIENT_SECRET',
        capturedAt: 456,
      });
      expect(text).not.toContain(rawSecret);
      expect(text).not.toContain(selector);
      expect(captureBrowserValue).toHaveBeenCalledWith({
        tabId: 'google-cloud-tab',
        selector,
        target: 'console.cloud.google.com',
        field: 'GMAIL_OAUTH_CLIENT_SECRET',
      });
      expect(put).toHaveBeenCalledWith(
        {
          label: 'Gmail OAuth client',
          kind: 'credential',
          fields: ['GMAIL_OAUTH_CLIENT_SECRET'],
          binding: {
            surfaces: ['secret-firewall', 'browser'],
            purposes: ['opaque-use', 'browser-fill'],
            targets: ['console.cloud.google.com'],
          },
        },
        { GMAIL_OAUTH_CLIENT_SECRET: rawSecret }
      );
      expect(onSecretStored).toHaveBeenCalledWith({ operation: 'capture', descriptor: stored });
      expect(JSON.stringify(onSecretStored.mock.calls)).not.toContain(rawSecret);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('replaces browser capture failures with a generic response', async () => {
    const rawSecret = 'must-not-leak-from-capture-error';
    const router = createSecretContextUseRouter({
      vault: { put: vi.fn() } as unknown as SecretVault,
      captureBrowserValue: vi.fn().mockRejectedValue(new Error(rawSecret)),
    });
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: SECRET_CONTEXT_CAPTURE_TOOL,
        arguments: {
          label: 'OAuth secret',
          field: 'CLIENT_SECRET',
          kind: 'credential',
          locator: { tabId: 'tab-private', selector: '#secret' },
          target: 'example.com',
        },
      });

      expect(result.isError).toBe(true);
      expect(mcpText(result)).toBe('Secret context capture failed.');
      expect(mcpText(result)).not.toContain(rawSecret);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('generates a Python-compatible Fernet key and zeroes its random byte buffer', async () => {
    const randomBuffer = Uint8Array.from({ length: 32 }, (_, index) => index);
    const expectedValue = Buffer.from(randomBuffer).toString('base64').replaceAll('+', '-').replaceAll('/', '_');
    const stored = descriptor('secret://generated-fernet-key', {
      label: 'Gmail token encryption',
      kind: 'private-key',
      fields: ['GMAIL_TOKEN_ENCRYPTION_KEYS'],
      binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
    });
    const put = vi.fn().mockResolvedValue(stored);
    const onSecretStored = vi.fn();
    const router = createSecretContextUseRouter({
      now: () => 789,
      createGenerateReceiptId: () => 'secret-generate://receipt',
      vault: { put } as unknown as SecretVault,
      randomBytes: vi.fn(() => randomBuffer),
      onSecretStored,
    });
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: SECRET_CONTEXT_GENERATE_TOOL,
        arguments: {
          label: 'Gmail token encryption',
          field: 'GMAIL_TOKEN_ENCRYPTION_KEYS',
          generator: 'fernet-key',
          scope: 'app',
        },
      });
      const text = mcpText(result);

      expect(JSON.parse(text)).toEqual({
        receiptId: 'secret-generate://receipt',
        status: 'generated',
        handle: stored.handle,
        field: 'GMAIL_TOKEN_ENCRYPTION_KEYS',
        generatedAt: 789,
      });
      expect(text).not.toContain(expectedValue);
      expect(expectedValue).toHaveLength(44);
      expect(Buffer.from(expectedValue, 'base64url')).toHaveLength(32);
      expect(put).toHaveBeenCalledWith(
        {
          label: 'Gmail token encryption',
          kind: 'private-key',
          fields: ['GMAIL_TOKEN_ENCRYPTION_KEYS'],
          binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
        },
        { GMAIL_TOKEN_ENCRYPTION_KEYS: expectedValue }
      );
      expect(randomBuffer.every((value) => value === 0)).toBe(true);
      expect(onSecretStored).toHaveBeenCalledWith({ operation: 'generate', descriptor: stored });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('generates an API key without returning its value to the MCP client', async () => {
    const rawBytes = Uint8Array.from({ length: 32 }, () => 255);
    const expectedValue = Buffer.from(rawBytes).toString('base64url');
    const stored = descriptor('secret://generated-api-key', {
      label: 'Backend API key',
      kind: 'token',
      fields: ['BACKEND_API_KEY'],
      binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
    });
    const put = vi.fn().mockResolvedValue(stored);
    const router = createSecretContextUseRouter({
      vault: { put } as unknown as SecretVault,
      randomBytes: () => rawBytes,
    });
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: SECRET_CONTEXT_GENERATE_TOOL,
        arguments: { label: 'Backend API key', field: 'BACKEND_API_KEY', generator: 'api-key', scope: 'app' },
      });

      expect(result.isError).not.toBe(true);
      expect(mcpText(result)).not.toContain(expectedValue);
      expect(put).toHaveBeenCalledWith(expect.any(Object), { BACKEND_API_KEY: expectedValue });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('zeroes generated bytes and returns a generic error when vault persistence fails', async () => {
    const randomBuffer = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const generatedValue = Buffer.from(randomBuffer).toString('base64url');
    const put = vi.fn().mockRejectedValue(new Error(`Vault rejected ${generatedValue}`));
    const router = createSecretContextUseRouter({
      vault: { put } as unknown as SecretVault,
      randomBytes: () => randomBuffer,
    });
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: SECRET_CONTEXT_GENERATE_TOOL,
        arguments: { label: 'Failed API key', field: 'BACKEND_API_KEY', generator: 'api-key', scope: 'app' },
      });

      expect(result.isError).toBe(true);
      expect(mcpText(result)).toBe('Secret context generation failed.');
      expect(mcpText(result)).not.toContain(generatedValue);
      expect(randomBuffer.every((value) => value === 0)).toBe(true);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('checks the hostname inside the same isolated-world call that reads the browser field', async () => {
    const executeJavaScriptInIsolatedWorld = vi.fn().mockResolvedValue('captured-value');
    const contents = {
      getURL: () => 'https://console.cloud.google.com/apis/credentials',
      executeJavaScriptInIsolatedWorld,
    };

    await expect(
      captureBrowserSecretValue(contents, {
        target: 'console.cloud.google.com',
        selector: '[data-client-secret]',
      })
    ).resolves.toBe('captured-value');

    const [worldId, scripts] = executeJavaScriptInIsolatedWorld.mock.calls[0];
    expect(worldId).toBe(1002);
    expect(scripts[0].code).toContain('location.hostname.toLowerCase() !== expectedTarget');
    expect(scripts[0].code).toContain('[data-client-secret]');
  });

  it('rejects masked browser values and hostname mismatches before persistence', async () => {
    const executeJavaScriptInIsolatedWorld = vi.fn().mockResolvedValue('********');
    const contents = {
      getURL: () => 'https://console.cloud.google.com/apis/credentials',
      executeJavaScriptInIsolatedWorld,
    };

    await expect(
      captureBrowserSecretValue(contents, {
        target: 'console.cloud.google.com',
        selector: '#secret',
      })
    ).rejects.toThrow('Secret capture failed.');
    await expect(
      captureBrowserSecretValue(contents, { target: 'accounts.google.com', selector: '#secret' })
    ).rejects.toThrow('Secret capture failed.');
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(1);
  });

  it('preserves adapter read-only denial while the Core runtime owns automatic firewall policy', () => {
    expect(tomnyToolAccessForPermission('read-only', AGENT_SECRET_CONTEXT_USE_TOOL, 'mcp')).toBe('deny');
    expect(tomnyToolAccessForPermission('workspace-write', AGENT_SECRET_CONTEXT_USE_TOOL, 'mcp')).toBe('prompt');
    expect(tomnyToolAccessForPermission('full-access', AGENT_SECRET_CONTEXT_USE_TOOL, 'mcp')).toBe('approve');
  });

  it('isolates compatibility hosts instead of reusing a global bearer', async () => {
    const first = await startSecretContextMcpHost();
    const second = await startSecretContextMcpHost();
    expect(second).not.toBe(first);
    expect(second.headers[0].value).not.toBe(first.headers[0].value);
    expect(first.url).not.toContain('Bearer');
    expect(first.url).not.toContain(first.headers[0].value);

    const unauthorizedGet = await fetch(first.url);
    const messageUrl = new URL('/message?sessionId=missing', first.url);
    const unauthorizedPost = await fetch(messageUrl, { method: 'POST' });
    const authorizedPost = await fetch(messageUrl, {
      method: 'POST',
      headers: Object.fromEntries(first.headers.map(({ name, value }) => [name, value])),
    });

    expect(unauthorizedGet.status).toBe(401);
    expect(unauthorizedPost.status).toBe(401);
    expect(authorizedPost.status).toBe(404);
    await stopSecretContextMcpHost();
    expect(getSecretContextMcpHost()).toBeUndefined();
  });

  it('reuses credentials only inside one immutable session authority', async () => {
    const options = { scope: { id: 'core:session-a', surface: 'ide' } } as const;
    const first = await startSecretContextMcpHost(options);
    const sameSession = await startSecretContextMcpHost(options);
    const otherSession = await startSecretContextMcpHost({ scope: { id: 'core:session-b', surface: 'ide' } });

    expect(sameSession).toBe(first);
    expect(otherSession.headers[0].value).not.toBe(first.headers[0].value);
    expect(getSecretContextMcpHost('core:session-a')).toBe(first);
  });

  it('rotates the endpoint and bearer when immutable surface claims change', async () => {
    const first = await startSecretContextMcpHost({ scope: { id: 'core:session-a', surface: 'ide' } });
    const rotated = await startSecretContextMcpHost({ scope: { id: 'core:session-a', surface: 'browser' } });

    expect(rotated).not.toBe(first);
    expect(rotated.url).not.toBe(first.url);
    expect(rotated.headers[0].value).not.toBe(first.headers[0].value);
  });

  it('tears down a scoped host after its bounded idle window', async () => {
    await startSecretContextMcpHost({
      scope: { id: 'core:idle-session', surface: 'chat' },
      idleTimeoutMs: 100,
    });
    expect(getSecretContextMcpHost('core:idle-session')).toBeDefined();

    await vi.waitFor(() => expect(getSecretContextMcpHost('core:idle-session')).toBeUndefined(), { timeout: 1_000 });
  });
});

describe('Secret Context scopes', () => {
  const authority: SecretContextServerAuthority = { scopeId: 'core:s1', surface: 'chat', sessionId: 's1' };
  const stored = descriptor('secret://session/captured', {
    label: 'Temporary token',
    kind: 'token',
    fields: ['TOKEN'],
    binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
  });

  afterEach(async () => {
    resetSecretDestinationTargets();
    await stopSecretContextMcpHost();
  });

  it('keeps a generated secret in the conversation by default', async () => {
    const put = vi.fn().mockResolvedValue(stored);
    const router = createSecretContextUseRouter({
      vault: { put } as unknown as SecretVault,
      randomBytes: (size) => new Uint8Array(size).fill(7),
    });
    const { client, server } = await connect(router, authority);

    try {
      await client.callTool({
        name: SECRET_CONTEXT_GENERATE_TOOL,
        arguments: { label: 'Temporary token', field: 'TOKEN', generator: 'api-key' },
      });
      expect(put).toHaveBeenCalledWith(
        expect.objectContaining({ scope: { kind: 'session', sessionId: 's1' } }),
        expect.any(Object)
      );
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('stores permanently only when the app scope is requested explicitly', async () => {
    const put = vi.fn().mockResolvedValue(stored);
    const router = createSecretContextUseRouter({
      vault: { put } as unknown as SecretVault,
      randomBytes: (size) => new Uint8Array(size).fill(7),
    });
    const { client, server } = await connect(router, authority);

    try {
      await client.callTool({
        name: SECRET_CONTEXT_GENERATE_TOOL,
        arguments: { label: 'Permanent token', field: 'TOKEN', generator: 'api-key', scope: 'app' },
      });
      expect(put.mock.calls[0]?.[0]).not.toHaveProperty('scope');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('refuses a session-scoped secret when the host has no session identity and stores nothing', async () => {
    const put = vi.fn();
    const router = createSecretContextUseRouter({
      vault: { put } as unknown as SecretVault,
      randomBytes: (size) => new Uint8Array(size).fill(7),
    });
    const { client, server } = await connect(router);

    try {
      const result = await client.callTool({
        name: SECRET_CONTEXT_GENERATE_TOOL,
        arguments: { label: 'Temporary token', field: 'TOKEN', generator: 'api-key' },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(put).not.toHaveBeenCalled();
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('hands the host-resolved caller to the sink, never an identity the model supplied', async () => {
    const sink = vi.fn().mockResolvedValue(undefined);
    const router = createSecretContextUseRouter();
    router.registerSink('browser.fill', sink);
    const { client, server } = await connect(router, authority);

    try {
      await client.callTool({
        name: AGENT_SECRET_CONTEXT_USE_TOOL,
        arguments: {
          handle: 'secret://session/captured',
          field: 'TOKEN',
          sink: 'browser.fill',
          locator: { tabId: 'tab-1', selector: '#token' },
          target: 'example.com',
          caller: { sessionId: 'someone-else' },
        },
      });
      expect(sink).toHaveBeenCalledWith(expect.objectContaining({ caller: { sessionId: 's1' } }));
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('carries the session identity into the immutable host authority', async () => {
    const host = await startSecretContextMcpHost({
      scope: { id: 'core:s1', surface: 'chat', sessionId: 's1', companyId: ' acme ' },
    });
    expect(host.scope).toMatchObject({ sessionId: 's1', companyId: 'acme' });
  });

  describe('package scope', () => {
    const packageAuthority: SecretContextServerAuthority = {
      scopeId: 'core:s1',
      surface: 'ide',
      sessionId: 's1',
      packageId: 'com.tomni.ide',
    };

    it('carries the package identity into the host authority', async () => {
      const host = await startSecretContextMcpHost({
        scope: { id: 'core:p1', surface: 'ide', sessionId: 's1', packageId: ' com.tomni.ide ' },
      });
      expect(host.scope).toMatchObject({ sessionId: 's1', packageId: 'com.tomni.ide' });
    });

    it('stores a generated secret for the active package only when asked, with the host-resolved package', async () => {
      const put = vi.fn().mockResolvedValue(stored);
      const router = createSecretContextUseRouter({
        vault: { put } as unknown as SecretVault,
        randomBytes: (size) => new Uint8Array(size).fill(7),
      });
      const { client, server } = await connect(router, packageAuthority);

      try {
        await client.callTool({
          name: SECRET_CONTEXT_GENERATE_TOOL,
          arguments: { label: 'Package token', field: 'TOKEN', generator: 'api-key', scope: 'package' },
        });
        expect(put).toHaveBeenCalledWith(
          expect.objectContaining({ scope: { kind: 'package', packageId: 'com.tomni.ide' } }),
          expect.any(Object)
        );
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });

    it('refuses a package-scoped secret when the run uses no Package App and stores nothing', async () => {
      const put = vi.fn();
      const router = createSecretContextUseRouter({
        vault: { put } as unknown as SecretVault,
        randomBytes: (size) => new Uint8Array(size).fill(7),
      });
      const { client, server } = await connect(router, authority);

      try {
        const result = await client.callTool({
          name: SECRET_CONTEXT_GENERATE_TOOL,
          arguments: { label: 'Package token', field: 'TOKEN', generator: 'api-key', scope: 'package' },
        });
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(put).not.toHaveBeenCalled();
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });

    it('binds only app-scoped sets into the personal profile, never a package or session set', async () => {
      const onSecretStored = vi.fn();
      const put = vi
        .fn()
        .mockResolvedValueOnce({ ...stored, scope: { kind: 'package', packageId: 'com.tomni.ide' } })
        .mockResolvedValueOnce(stored);
      const router = createSecretContextUseRouter({
        vault: { put } as unknown as SecretVault,
        randomBytes: (size) => new Uint8Array(size).fill(7),
        onSecretStored,
      });
      const { client, server } = await connect(router, packageAuthority);

      try {
        await client.callTool({
          name: SECRET_CONTEXT_GENERATE_TOOL,
          arguments: { label: 'Package token', field: 'TOKEN', generator: 'api-key', scope: 'package' },
        });
        expect(onSecretStored).not.toHaveBeenCalled();
        await client.callTool({
          name: SECRET_CONTEXT_GENERATE_TOOL,
          arguments: { label: 'Permanent token', field: 'TOKEN', generator: 'api-key', scope: 'app' },
        });
        expect(onSecretStored).toHaveBeenCalledTimes(1);
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });

    it('lets the active package ask for a general secret, attributed to the host-resolved package', async () => {
      const requestAccess = vi.fn().mockResolvedValue({ requestId: 'req-1', status: 'pending' });
      const router = createSecretContextUseRouter({ packageAccess: { requestAccess } });
      const { client, server } = await connect(router, packageAuthority);

      try {
        const result = await client.callTool({
          name: 'tomny_secret_request_access',
          arguments: { handle: 'secret://app/github', reason: 'Push the release', packageId: 'com.tomni.other' },
        });
        expect((result as { isError?: boolean }).isError).not.toBe(true);
        expect(requestAccess).toHaveBeenCalledWith('com.tomni.ide', {
          handle: 'secret://app/github',
          reason: 'Push the release',
        });
        expect(JSON.stringify(result)).not.toMatch(/secret-value/u);
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });

    it('refuses to ask for access when the run uses no Package App', async () => {
      const requestAccess = vi.fn();
      const router = createSecretContextUseRouter({ packageAccess: { requestAccess } });
      const { client, server } = await connect(router, authority);

      try {
        const result = await client.callTool({
          name: 'tomny_secret_request_access',
          arguments: { handle: 'secret://app/github', reason: 'Push the release' },
        });
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(requestAccess).not.toHaveBeenCalled();
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });

    it('hands the package identity to the sink and lists package sets only to that package', async () => {
      const sink = vi.fn().mockResolvedValue(undefined);
      const vault = {
        list: vi.fn().mockResolvedValue([
          descriptor('secret://pkg/mine', {
            label: 'Ide token',
            fields: ['TOKEN'],
            binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
            scope: { kind: 'package', packageId: 'com.tomni.ide' },
          }),
          descriptor('secret://pkg/theirs', {
            label: 'Other token',
            fields: ['TOKEN'],
            binding: { surfaces: ['secret-firewall'], purposes: ['opaque-use'] },
            scope: { kind: 'package', packageId: 'com.tomni.other' },
          }),
        ]),
      } as unknown as SecretVault;
      const router = createSecretContextUseRouter({ vault });
      router.registerSink('browser.fill', sink);

      expect(
        (await router.listVisible({ sessionId: 's1', packageId: 'com.tomni.ide' })).map((item) => item.label)
      ).toEqual(['Ide token']);
      expect(await router.listVisible({ sessionId: 's1' })).toEqual([]);

      const { client, server } = await connect(router, packageAuthority);
      try {
        await client.callTool({
          name: AGENT_SECRET_CONTEXT_USE_TOOL,
          arguments: {
            handle: 'secret://pkg/mine',
            field: 'TOKEN',
            sink: 'browser.fill',
            locator: { tabId: 'tab-1', selector: '#token' },
            target: 'example.com',
            caller: { packageId: 'com.tomni.other' },
          },
        });
        expect(sink).toHaveBeenCalledWith(
          expect.objectContaining({ caller: { sessionId: 's1', packageId: 'com.tomni.ide' } })
        );
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });
  });
});

describe('Tomny secret tools', () => {
  const authority: SecretContextServerAuthority = { scopeId: 'core:s1', surface: 'chat', sessionId: 's1' };
  const set = (
    handle: string,
    overrides: Partial<SecretDescriptor> & Pick<SecretDescriptor, 'binding'>
  ): SecretDescriptor => ({
    handle,
    label: `Set ${handle}`,
    kind: 'credential',
    fields: ['TOKEN'],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
  const firewall = { surfaces: ['secret-firewall'], purposes: ['opaque-use'] };

  afterEach(async () => {
    resetSecretDestinationTargets();
    configureTerminalSecretPort(undefined);
    await stopSecretContextMcpHost();
  });

  it('names every tool tomny_secret_* so ToolSearch can load it by exact name', () => {
    expect([...TOMNY_SECRET_TOOLS].toSorted()).toEqual([
      'tomny_secret_capture',
      'tomny_secret_generate',
      'tomny_secret_list',
      'tomny_secret_request',
      'tomny_secret_request_access',
      'tomny_secret_use',
    ]);
  });

  it('lists only sets this run may use, never a value and never an internal credential', async () => {
    const list = vi.fn().mockResolvedValue([
      set('secret://app', {
        label: 'GitHub login',
        note: 'Release job',
        fields: ['USERNAME', 'PASSWORD'],
        binding: firewall,
      }),
      set('secret://session/mine', {
        label: 'Temp token',
        scope: { kind: 'session', sessionId: 's1' },
        binding: { surfaces: ['secret-firewall', 'terminal'], purposes: ['opaque-use', 'terminal-input'] },
      }),
      set('secret://session/other', { scope: { kind: 'session', sessionId: 's2' }, binding: firewall }),
      set('secret://company', { scope: { kind: 'company', companyId: 'acme' }, binding: firewall }),
      set('secret://telegram', {
        label: 'Telegram bot',
        binding: { surfaces: ['telegram'], purposes: ['telegram-bot'] },
      }),
      set('secret://web', {
        label: 'Admin site',
        binding: { surfaces: ['browser'], purposes: ['browser-fill'], targets: ['admin.example.com'] },
      }),
    ]);
    const router = createSecretContextUseRouter({ vault: { put: vi.fn(), list } as unknown as SecretVault });
    const { client, server } = await connect(router, authority);

    try {
      const text = mcpText(await client.callTool({ name: SECRET_CONTEXT_LIST_TOOL, arguments: {} }));
      const result = JSON.parse(text) as { sets: Array<Record<string, unknown>> };

      expect(result.sets.map((item) => item.handle).toSorted()).toEqual([
        'secret://app',
        'secret://session/mine',
        'secret://web',
      ]);
      const mine = result.sets.find((item) => item.handle === 'secret://session/mine');
      expect(mine).toMatchObject({ scope: 'session', destinations: ['process', 'deploy', 'terminal'] });
      const web = result.sets.find((item) => item.handle === 'secret://web');
      expect(web).toMatchObject({ scope: 'app', destinations: ['browser'], hosts: ['admin.example.com'] });
      expect(text).not.toMatch(/encrypted|payload|password-value/iu);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('records a request for a secret that does not exist yet, visible only to its own session', async () => {
    const requests = createSecretRequestStore();
    const router = createSecretContextUseRouter({ requests });
    const { client, server } = await connect(router, authority);

    try {
      const result = JSON.parse(
        mcpText(
          await client.callTool({
            name: SECRET_CONTEXT_REQUEST_TOOL,
            arguments: {
              label: 'Payments sandbox',
              note: 'Needed to run the checkout test',
              fields: ['PAYMENTS_API_KEY'],
              destinations: ['process'],
            },
          })
        )
      ) as { requestId: string; status: string };

      expect(result.status).toBe('pending');
      expect(requests.list('s1')).toEqual([
        expect.objectContaining({
          id: result.requestId,
          label: 'Payments sandbox',
          fields: ['PAYMENTS_API_KEY'],
          destinations: ['process'],
        }),
      ]);
      expect(requests.list('s2')).toEqual([]);
      expect(requests.dismiss('s1', result.requestId)).toBe(true);
      expect(requests.list('s1')).toEqual([]);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('refuses a request without a session identity or with a value-like field', async () => {
    const requests = createSecretRequestStore();
    const router = createSecretContextUseRouter({ requests });
    const anonymous = await connect(router);
    try {
      const result = await anonymous.client.callTool({
        name: SECRET_CONTEXT_REQUEST_TOOL,
        arguments: { label: 'X', note: 'n', fields: ['TOKEN'], destinations: ['process'] },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
    } finally {
      await Promise.all([anonymous.client.close(), anonymous.server.close()]);
    }
    const { client, server } = await connect(router, authority);
    try {
      const result = await client.callTool({
        name: SECRET_CONTEXT_REQUEST_TOOL,
        arguments: { label: 'X', note: 'n', fields: ['not a name!'], destinations: ['process'] },
      });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect(requests.list('s1')).toEqual([]);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  describe('terminal input', () => {
    const terminalVault = (values: Record<string, string>) =>
      ({
        resolve: vi.fn(async () => values),
        put: vi.fn(),
        list: vi.fn(),
      }) as unknown as SecretVault;

    const useTerminal = (extra: Record<string, unknown> = {}) => ({
      name: AGENT_SECRET_CONTEXT_USE_TOOL,
      arguments: {
        handle: 'secret://session/mine',
        field: 'PASSWORD',
        sink: 'terminal.input',
        locator: { terminalId: 'term-1' },
        ...extra,
      },
    });

    const build = (
      port: Parameters<typeof configureTerminalSecretPort>[0],
      values = { PASSWORD: 'hunter2-secret' }
    ) => {
      const vault = terminalVault(values);
      const router = createSecretContextUseRouter({ now: () => 9, createReceiptId: () => 'secret-use://r' });
      for (const [name, sink] of Object.entries(createSecretDestinationSinks(vault)))
        router.registerSink(name, sink, true);
      configureTerminalSecretPort(port);
      return { router, vault };
    };

    it('types the value into one approved terminal and returns only a receipt', async () => {
      const write = vi.fn();
      const { router, vault } = build({ exists: () => true, confirm: async () => true, write });
      const { client, server } = await connect(router, authority);

      try {
        const text = mcpText(await client.callTool(useTerminal()));
        expect(write).toHaveBeenCalledWith('term-1', 'hunter2-secret\r');
        expect(text).not.toContain('hunter2-secret');
        expect(JSON.parse(text)).toMatchObject({ status: 'used', sink: 'terminal.input' });
        expect(vault.resolve).toHaveBeenCalledWith(
          expect.objectContaining({
            surface: 'terminal',
            purpose: 'terminal-input',
            fields: ['PASSWORD'],
            caller: { sessionId: 's1' },
          })
        );
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });

    it('does not press Enter when told not to submit', async () => {
      const write = vi.fn();
      const { router } = build({ exists: () => true, confirm: async () => true, write });
      const { client, server } = await connect(router, authority);
      try {
        await client.callTool(useTerminal({ submit: false }));
        expect(write).toHaveBeenCalledWith('term-1', 'hunter2-secret');
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });

    it.each([
      ['an unknown terminal', { exists: () => false, confirm: async () => true }],
      ['a terminal the person did not approve', { exists: () => true, confirm: async () => false }],
    ])('refuses %s without reading the value', async (_name, port) => {
      const write = vi.fn();
      const { router, vault } = build({ ...port, write });
      const { client, server } = await connect(router, authority);
      try {
        const result = await client.callTool(useTerminal());
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(write).not.toHaveBeenCalled();
        expect(vault.resolve).not.toHaveBeenCalled();
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });

    it('refuses when no terminal port is configured', async () => {
      const { router, vault } = build(undefined);
      const { client, server } = await connect(router, authority);
      try {
        const result = await client.callTool(useTerminal());
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(vault.resolve).not.toHaveBeenCalled();
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });

    it('keeps a failed write generic so the value cannot leak through the error', async () => {
      const { router } = build({
        exists: () => true,
        confirm: async () => true,
        write: () => {
          throw new Error('pty rejected hunter2-secret');
        },
      });
      const { client, server } = await connect(router, authority);
      try {
        const result = await client.callTool(useTerminal());
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect(mcpText(result)).not.toContain('hunter2-secret');
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    });
  });
});
