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
  type SecretContextServerAuthority,
} from '@process/agentRuntime/agentMesh/mcp/secret-context/server';
import {
  createSecretDestinationSinks,
  registerDeploymentSecretTarget,
  registerManagedProcessSecretTarget,
  resetSecretDestinationTargets,
} from '@process/agentRuntime/agentMesh/mcp/secret-context/sinks';
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
        arguments: { label: 'Backend API key', field: 'BACKEND_API_KEY', generator: 'api-key' },
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
        arguments: { label: 'Failed API key', field: 'BACKEND_API_KEY', generator: 'api-key' },
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
