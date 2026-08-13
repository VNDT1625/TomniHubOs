/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

const registryMocks = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  importMany: vi.fn(async () => []),
  update: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

const AGENT_DESCRIPTION =
  'Built-in Tomny Core subagent orchestration: bounded parallel jobs, durable result tracking, messaging, cancellation and multi-turn resume.';

vi.mock('@process/agentRuntime/agentMesh/mcp/host', () => ({
  startAgentOrchestratorMcpHost: vi.fn(async () => ({
    url: 'http://127.0.0.1:64000/sse',
    headers: [{ name: 'Authorization', value: 'Bearer test-token' }],
  })),
}));
vi.mock('@process/agentRuntime/agentMesh/mcp/secret-context/host', () => ({
  startSecretContextMcpHost: vi.fn(async () => ({
    url: 'http://127.0.0.1:64002/sse',
    headers: [{ name: 'Authorization', value: 'Bearer secret-token' }],
  })),
}));
vi.mock('@process/resources/mcpRegistry', () => ({ getMcpRegistry: () => registryMocks }));
vi.mock('@process/bridge/applicationBridge', () => ({ getApplicationMainWindow: vi.fn() }));
vi.mock('@process/testing/testingMcpHost', () => ({
  startTestingMcpHost: vi.fn(async () => ({
    url: 'http://127.0.0.1:64001/sse',
    headers: [{ name: 'Authorization', value: 'Bearer testing-token' }],
  })),
}));
vi.mock('@process/testing/testingWiring', () => ({ getTestingServices: vi.fn(() => ({ orchestrator: {} })) }));

import {
  createElectronSurfaceCapabilityHosts,
  ElectronSurfaceCapabilityHosts,
} from '@process/experimentalCore/electronSurfaceCapabilityHosts';
import { ensureAgentOrchestratorMcpRegistered } from '@process/agentRuntime/agentMesh/mcp/register';
import { startAgentOrchestratorMcpHost } from '@process/agentRuntime/agentMesh/mcp/host';
import { startSecretContextMcpHost } from '@process/agentRuntime/agentMesh/mcp/secret-context/host';
import { ensureSecretContextMcpRegistered } from '@process/agentRuntime/agentMesh/mcp/secret-context/register';
import { startTestingMcpHost } from '@process/testing/testingMcpHost';
import { ensureTestingMcpRegistered } from '@process/testing/registerTestingMcp';

describe('surface capability host restoration', () => {
  it('keeps optional surface hosts out of the base Core registry', () => {
    const hosts = createElectronSurfaceCapabilityHosts();

    expect(hosts.names()).toEqual(expect.arrayContaining(['tomny-tool-selector', 'tomny-agent-orchestrator']));
    expect(hosts.names()).not.toEqual(
      expect.arrayContaining(['tomny-ide', 'tomny-browser-control', 'tomny-office-editor', 'tomny-music'])
    );
  });

  it('keeps the live bearer token out of the durable MCP catalog', async () => {
    registryMocks.list.mockResolvedValueOnce([]);

    await expect(ensureAgentOrchestratorMcpRegistered()).resolves.toBe(true);

    const draft = registryMocks.importMany.mock.calls.at(-1)?.[0]?.[0];
    expect(draft?.transport).toEqual({ type: 'sse', url: 'http://127.0.0.1:64000/sse' });
    expect(draft?.original_json).not.toContain('test-token');
    expect(draft?.original_json).not.toContain('Authorization');
  });

  it('scrubs a stale subagent token from original JSON when the URL is unchanged', async () => {
    registryMocks.list.mockResolvedValueOnce([
      {
        id: 'agent-orchestrator-stale-json',
        name: 'tomny-agent-orchestrator',
        description: AGENT_DESCRIPTION,
        enabled: true,
        builtin: true,
        transport: { type: 'sse', url: 'http://127.0.0.1:64000/sse' },
        original_json: JSON.stringify({
          mcpServers: {
            'tomny-agent-orchestrator': {
              url: 'http://127.0.0.1:64000/sse',
              headers: { Authorization: 'Bearer stale-token' },
            },
          },
        }),
      },
    ]);

    await expect(ensureAgentOrchestratorMcpRegistered()).resolves.toBe(true);

    const update = registryMocks.update.mock.calls.at(-1);
    expect(update?.[0]).toBe('agent-orchestrator-stale-json');
    expect(update?.[1]?.original_json).not.toContain('Authorization');
    expect(update?.[1]?.original_json).not.toContain('stale-token');
  });

  it('repairs stale subagent metadata without changing its enabled state', async () => {
    const cleanOriginalJson = JSON.stringify(
      { mcpServers: { 'tomny-agent-orchestrator': { url: 'http://127.0.0.1:64000/sse' } } },
      null,
      2
    );
    registryMocks.list.mockResolvedValueOnce([
      {
        id: 'agent-orchestrator-stale-metadata',
        name: 'tomny-agent-orchestrator',
        description: 'Old description',
        enabled: false,
        builtin: true,
        transport: { type: 'sse', url: 'http://127.0.0.1:64000/sse' },
        original_json: cleanOriginalJson,
      },
    ]);

    await expect(ensureAgentOrchestratorMcpRegistered()).resolves.toBe(true);

    expect(registryMocks.update).toHaveBeenLastCalledWith(
      'agent-orchestrator-stale-metadata',
      expect.objectContaining({ description: AGENT_DESCRIPTION, original_json: cleanOriginalJson })
    );
    const updatedDraft = registryMocks.update.mock.calls.at(-1)?.[1];
    expect(updatedDraft).not.toHaveProperty('enabled');
  });

  it('resolves the authenticated subagent host as a core capability', async () => {
    const hosts = createElectronSurfaceCapabilityHosts();

    await expect(hosts.resolve(['tomny-agent-orchestrator'])).resolves.toEqual([
      {
        name: 'tomny-agent-orchestrator',
        url: 'http://127.0.0.1:64000/sse',
        headers: [{ name: 'Authorization', value: 'Bearer test-token' }],
      },
    ]);
  });

  it('removes the legacy global Secret Context catalog route', async () => {
    registryMocks.list.mockResolvedValueOnce([
      {
        id: 'legacy-secret-context',
        name: 'tomny-secret-context',
        enabled: true,
        builtin: true,
        transport: { type: 'sse', url: 'http://127.0.0.1:64002/sse' },
      },
    ]);

    await expect(ensureSecretContextMcpRegistered()).resolves.toBe(true);

    expect(registryMocks.remove).toHaveBeenCalledWith('legacy-secret-context');
  });

  it('forwards immutable parent claims and refreshes scoped endpoint credentials after host restart', async () => {
    const startHost = vi.mocked(startAgentOrchestratorMcpHost);
    startHost
      .mockResolvedValueOnce({
        url: 'http://127.0.0.1:65000/sse',
        headers: [{ name: 'Authorization', value: 'Bearer scoped-one' }],
      } as Awaited<ReturnType<typeof startAgentOrchestratorMcpHost>>)
      .mockResolvedValueOnce({
        url: 'http://127.0.0.1:65001/sse',
        headers: [{ name: 'Authorization', value: 'Bearer scoped-two' }],
      } as Awaited<ReturnType<typeof startAgentOrchestratorMcpHost>>);
    const requestPermission = vi.fn(async () => true);
    const context = Object.freeze({
      sessionId: 'parent-session',
      workspace: 'C:/granted-workspace',
      surface: 'ide',
      permissionMode: 'workspace-write' as const,
      requestPermission,
    });
    const hosts = createElectronSurfaceCapabilityHosts();

    const first = await hosts.resolve(['tomny-agent-orchestrator'], [], context);
    const restarted = await hosts.resolve(['tomny-agent-orchestrator'], [], context);

    expect(startHost).toHaveBeenNthCalledWith(
      startHost.mock.calls.length - 1,
      expect.objectContaining({
        scope: expect.objectContaining({
          id: 'core:parent-session',
          executionClaims: {
            workspace: 'C:/granted-workspace',
            surface: 'ide',
            permissionMode: 'workspace-write',
          },
          requestPermission,
        }),
      })
    );
    expect(first[0]).toMatchObject({
      url: 'http://127.0.0.1:65000/sse',
      headers: [{ name: 'Authorization', value: 'Bearer scoped-one' }],
    });
    expect(restarted[0]).toMatchObject({
      url: 'http://127.0.0.1:65001/sse',
      headers: [{ name: 'Authorization', value: 'Bearer scoped-two' }],
    });
  });

  it('injects the live Testing bearer header into the core capability', async () => {
    const hosts = createElectronSurfaceCapabilityHosts();

    await expect(hosts.resolve(['tomny-testing'])).resolves.toEqual([
      {
        name: 'tomny-testing',
        url: 'http://127.0.0.1:64001/sse',
        headers: [{ name: 'Authorization', value: 'Bearer testing-token' }],
      },
    ]);
  });

  it('refreshes Secret Context and Testing endpoint credentials after their hosts restart', async () => {
    vi.mocked(startSecretContextMcpHost)
      .mockResolvedValueOnce({
        url: 'http://127.0.0.1:65100/sse',
        headers: [{ name: 'Authorization', value: 'Bearer secret-one' }],
      } as Awaited<ReturnType<typeof startSecretContextMcpHost>>)
      .mockResolvedValueOnce({
        url: 'http://127.0.0.1:65101/sse',
        headers: [{ name: 'Authorization', value: 'Bearer secret-two' }],
      } as Awaited<ReturnType<typeof startSecretContextMcpHost>>);
    vi.mocked(startTestingMcpHost)
      .mockResolvedValueOnce({
        url: 'http://127.0.0.1:65200/sse',
        headers: [{ name: 'Authorization', value: 'Bearer testing-one' }],
      } as Awaited<ReturnType<typeof startTestingMcpHost>>)
      .mockResolvedValueOnce({
        url: 'http://127.0.0.1:65201/sse',
        headers: [{ name: 'Authorization', value: 'Bearer testing-two' }],
      } as Awaited<ReturnType<typeof startTestingMcpHost>>);
    const hosts = createElectronSurfaceCapabilityHosts();

    const context = Object.freeze({
      sessionId: 'secret-parent-session',
      workspace: 'C:/granted-workspace',
      surface: 'browser',
      permissionMode: 'workspace-write' as const,
    });

    const secretFirst = await hosts.resolve(['tomny-secret-context'], [], context);
    const secretRestarted = await hosts.resolve(['tomny-secret-context'], [], context);
    const testingFirst = await hosts.resolve(['tomny-testing']);
    const testingRestarted = await hosts.resolve(['tomny-testing']);

    expect(secretFirst[0]).toMatchObject({
      url: 'http://127.0.0.1:65100/sse',
      headers: [{ name: 'Authorization', value: 'Bearer secret-one' }],
    });
    expect(secretRestarted[0]).toMatchObject({
      url: 'http://127.0.0.1:65101/sse',
      headers: [{ name: 'Authorization', value: 'Bearer secret-two' }],
    });
    expect(startSecretContextMcpHost).toHaveBeenCalledWith({
      scope: { id: 'core:secret-parent-session', surface: 'browser' },
    });
    expect(testingFirst[0]).toMatchObject({
      url: 'http://127.0.0.1:65200/sse',
      headers: [{ name: 'Authorization', value: 'Bearer testing-one' }],
    });
    expect(testingRestarted[0]).toMatchObject({
      url: 'http://127.0.0.1:65201/sse',
      headers: [{ name: 'Authorization', value: 'Bearer testing-two' }],
    });
  });

  it('refuses to expose Secret Context without a scoped Core session', async () => {
    const hosts = createElectronSurfaceCapabilityHosts();

    await expect(hosts.resolve(['tomny-secret-context'])).rejects.toThrow(
      'Secret Context requires a scoped Core session authority.'
    );
  });

  it('keeps the live Testing token out of the durable MCP catalog', async () => {
    registryMocks.list.mockResolvedValueOnce([]);

    await expect(ensureTestingMcpRegistered()).resolves.toBe(true);

    const draft = registryMocks.importMany.mock.calls.at(-1)?.[0]?.[0];
    expect(draft?.transport).toEqual({ type: 'sse', url: 'http://127.0.0.1:64001/sse' });
    expect(draft?.original_json).not.toContain('testing-token');
    expect(draft?.original_json).not.toContain('Authorization');
  });

  it('scrubs a stale Testing bearer header from the durable catalog', async () => {
    registryMocks.list.mockResolvedValueOnce([
      {
        id: 'testing-server',
        name: 'tomny-testing',
        enabled: true,
        builtin: true,
        transport: { type: 'sse', url: 'http://127.0.0.1:64001/sse' },
        original_json: JSON.stringify({
          mcpServers: {
            'tomny-testing': {
              url: 'http://127.0.0.1:64001/sse',
              headers: { Authorization: 'Bearer stale-token' },
            },
          },
        }),
      },
    ]);

    await expect(ensureTestingMcpRegistered()).resolves.toBe(true);

    expect(registryMocks.update).toHaveBeenCalledWith(
      'testing-server',
      expect.objectContaining({ transport: { type: 'sse', url: 'http://127.0.0.1:64001/sse' } })
    );
    const updated = registryMocks.update.mock.calls.at(-1)?.[1];
    expect(updated?.original_json).not.toContain('stale-token');
    expect(updated?.original_json).not.toContain('Authorization');
  });

  it('scrubs persisted Testing transport headers when the URL is unchanged', async () => {
    const cleanOriginalJson = JSON.stringify(
      { mcpServers: { 'tomny-testing': { url: 'http://127.0.0.1:64001/sse' } } },
      null,
      2
    );
    registryMocks.list.mockResolvedValueOnce([
      {
        id: 'testing-server-headers',
        name: 'tomny-testing',
        enabled: true,
        builtin: true,
        transport: {
          type: 'sse',
          url: 'http://127.0.0.1:64001/sse',
          headers: { Authorization: 'Bearer stale-token' },
        },
        original_json: cleanOriginalJson,
      },
    ]);

    await expect(ensureTestingMcpRegistered()).resolves.toBe(true);

    expect(registryMocks.update).toHaveBeenLastCalledWith(
      'testing-server-headers',
      expect.objectContaining({
        transport: { type: 'sse', url: 'http://127.0.0.1:64001/sse' },
        original_json: cleanOriginalJson,
      })
    );
  });

  it('replaces a persisted loopback snapshot with the live host after restart', async () => {
    const hosts = new ElectronSurfaceCapabilityHosts();
    const factory = vi.fn(async () => ({
      name: 'tomny-office-editor',
      transport: 'sse' as const,
      url: 'http://127.0.0.1:62000/sse',
    }));
    hosts.register('tomny-office-editor', factory);

    const resolved = await hosts.resolve(
      ['tomny-office-editor'],
      [{ name: 'tomny-office-editor', transport: 'sse', url: 'http://127.0.0.1:51372/sse' }]
    );

    expect(factory).toHaveBeenCalledOnce();
    expect(resolved).toEqual([{ name: 'tomny-office-editor', transport: 'sse', url: 'http://127.0.0.1:62000/sse' }]);
  });

  it('preserves an external session server that has no managed live host', async () => {
    const hosts = new ElectronSurfaceCapabilityHosts();
    const external = { name: 'external-mcp', transport: 'sse' as const, url: 'https://example.com/sse' };

    await expect(hosts.resolve([], [external])).resolves.toEqual([external]);
  });

  it('omits managed session servers that the active surface did not request', async () => {
    const hosts = new ElectronSurfaceCapabilityHosts();
    const factory = vi.fn(async () => ({
      name: 'tomny-office-editor',
      transport: 'sse' as const,
      url: 'http://127.0.0.1:62000/sse',
    }));
    hosts.register('tomny-office-editor', factory);
    const external = { name: 'external-mcp', transport: 'sse' as const, url: 'https://example.com/sse' };

    await expect(
      hosts.resolve(
        [],
        [{ name: 'tomny-office-editor', transport: 'sse', url: 'http://127.0.0.1:51372/sse' }, external]
      )
    ).resolves.toEqual([external]);
    expect(factory).not.toHaveBeenCalled();
  });
});
