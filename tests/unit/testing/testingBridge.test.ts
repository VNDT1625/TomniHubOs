/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests the Testing bridge (Yêu cầu 2b, Task 15.1 — UI plane) + the in-process
 * MCP host (Agent plane). Both planes drive the SAME orchestrator, so this
 * verifies:
 *  - registerTestingBridge wires list/getReport/run onto the typed channels;
 *  - the handlers project orchestrator sessions onto the renderer-facing shapes
 *    (newest-first list, structured+markdown report, run → finished summary);
 *  - the loopback MCP host starts with runtime-only bearer authentication and
 *    stops cleanly.
 *
 * No real Electron window / display is used — the orchestrator is a hand-rolled
 * fake implementing ITestOrchestrator.
 */

import { randomUUID } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Capture each channel's registered handler so the test can invoke it directly.
const handlers = new Map<string, (req: unknown) => unknown>();
vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn((channel: string) => ({
      provider: vi.fn((handler: (req: unknown) => unknown) => {
        handlers.set(channel, handler);
        return vi.fn();
      }),
      invoke: vi.fn(),
    })),
    buildEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn() })),
  },
}));

import { createTestingServer } from '@/process/resources/builtinMcp/testingServer';
import { registerTestingBridge, TESTING_CHANNELS } from '@/process/testing/testingBridge';
import { getTestingMcpHost, startTestingMcpHost, stopTestingMcpHost } from '@/process/testing/testingMcpHost';
import type { ITestOrchestrator } from '@/process/testing/testOrchestrator';
import type { RunOptions } from '@/process/testing/testOrchestrator';
import type { TestScenario, TestSession } from '@/process/testing/testingTypes';

const makeSession = (id: string, name: string, status: TestSession['status'], passedSteps = 1): TestSession => ({
  id,
  scenario: {
    id: `scn-${id}`,
    name,
    platform: 'web',
    steps: [{ id: 's1', description: 'goto example.com' }],
  },
  visibility: 'hidden',
  status,
  results: [
    {
      step: { id: 's1', description: 'goto example.com' },
      passed: passedSteps > 0,
      detail: 'Navigated',
      screenshots: ['/shot/s1.png'],
      at: 1,
    },
  ],
  reportPath: `/reports/${id}/report.md`,
  videoPath: `/reports/${id}/recording.webm`,
  createdAt: 1,
  updatedAt: 2,
});

/** A fake orchestrator that records runs and returns canned sessions. */
const makeFakeOrchestrator = (initial: TestSession[] = []) => {
  const sessions = new Map<string, TestSession>(initial.map((s) => [s.id, s]));
  const runCalls: Array<{ scenario: TestScenario; options?: RunOptions }> = [];
  const orchestrator: ITestOrchestrator = {
    run: async (scenario, options) => {
      runCalls.push({ scenario, options });
      const session = makeSession(randomUUID(), scenario.name, 'passed');
      session.scenario = scenario;
      sessions.set(session.id, session);
      return session;
    },
    getSession: (id) => sessions.get(id),
    listSessions: () => [...sessions.values()],
    addReportImage: async (sessionId, stepId, sourcePath) => {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`No test session with id: ${sessionId}`);
      const result = session.results.find((item) => item.step.id === stepId);
      if (!result) throw new Error(`No test step with id: ${stepId}`);
      result.screenshots = [...result.screenshots, sourcePath];
      return session;
    },
  };
  return { orchestrator, runCalls };
};

const mcpText = (result: Awaited<ReturnType<Client['callTool']>>): string => {
  const text = result.content.find((item) => item.type === 'text');
  if (!text || text.type !== 'text') throw new Error('Expected an MCP text result.');
  return text.text;
};

const connectTestingClient = async (orchestrator: ITestOrchestrator, name: string) => {
  const server = createTestingServer({ orchestrator });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name, version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
};

afterEach(async () => {
  handlers.clear();
  await stopTestingMcpHost();
  vi.clearAllMocks();
});

describe('registerTestingBridge — UI plane', () => {
  it('lists sessions newest-first as summaries', async () => {
    const { orchestrator } = makeFakeOrchestrator([
      makeSession('a', 'first', 'passed'),
      makeSession('b', 'second', 'failed'),
    ]);
    registerTestingBridge({ orchestrator });

    const list = (await handlers.get(TESTING_CHANNELS.listSessions)?.(undefined)) as Array<{
      sessionId: string;
      status: string;
    }>;
    expect(list.map((s) => s.sessionId)).toEqual(['b', 'a']); // reversed (newest first)
    expect(list[0]).toMatchObject({ sessionId: 'b', name: 'second', platform: 'web', status: 'failed' });
  });

  it('builds a structured + markdown report for a known session', async () => {
    const { orchestrator } = makeFakeOrchestrator([makeSession('a', 'first', 'passed')]);
    registerTestingBridge({ orchestrator });

    const report = (await handlers.get(TESTING_CHANNELS.getReport)?.({ sessionId: 'a' })) as {
      sessionId: string;
      passed: boolean;
      total: number;
      markdown: string;
    };
    expect(report.sessionId).toBe('a');
    expect(report.passed).toBe(true);
    expect(report.total).toBe(1);
    expect(report.markdown).toContain('# Test Report: first');
  });

  it('returns undefined report for an unknown session', async () => {
    const { orchestrator } = makeFakeOrchestrator();
    registerTestingBridge({ orchestrator });
    const report = await handlers.get(TESTING_CHANNELS.getReport)?.({ sessionId: 'missing' });
    expect(report).toBeUndefined();
  });

  it('runs a submitted scenario and returns the finished summary', async () => {
    const { orchestrator, runCalls } = makeFakeOrchestrator();
    registerTestingBridge({ orchestrator });

    const result = (await handlers.get(TESTING_CHANNELS.run)?.({
      name: 'my web test',
      platform: 'web',
      steps: [{ id: 's1', description: 'goto example.com' }],
      visible: true,
    })) as { sessionId: string; status: string; name: string; reportPath?: string };

    expect(runCalls).toHaveLength(1);
    expect(runCalls[0].scenario.name).toBe('my web test');
    expect(runCalls[0].scenario.platform).toBe('web');
    expect(runCalls[0].options?.visibility).toBe('visible');
    expect(result.status).toBe('passed');
    expect(result.reportPath).toContain('report.md');
  });
});

describe('startTestingMcpHost — Agent plane', () => {
  it('starts a loopback host with live bearer headers and reuses it', async () => {
    const { orchestrator } = makeFakeOrchestrator();
    const host = await startTestingMcpHost(orchestrator);
    expect(host.port).toBeGreaterThan(0);
    expect(host.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sse$/);
    expect(host.headers).toEqual([{ name: 'Authorization', value: expect.stringMatching(/^Bearer .+/) }]);

    // Calling again returns the same singleton host (same port).
    const again = await startTestingMcpHost(orchestrator);
    expect(again.port).toBe(host.port);
  });

  it('deduplicates concurrent startup into one host', async () => {
    const { orchestrator } = makeFakeOrchestrator();
    const [first, second, third] = await Promise.all([
      startTestingMcpHost(orchestrator),
      startTestingMcpHost(orchestrator),
      startTestingMcpHost(orchestrator),
    ]);

    expect(new Set([first.port, second.port, third.port])).toHaveLength(1);
  });

  it('closes a host when stop is requested during startup', async () => {
    const { orchestrator } = makeFakeOrchestrator();
    const startup = startTestingMcpHost(orchestrator);

    await stopTestingMcpHost();
    await startup;

    expect(getTestingMcpHost()).toBeUndefined();
  });

  it('rejects requests without its runtime bearer token', async () => {
    const { orchestrator } = makeFakeOrchestrator();
    const host = await startTestingMcpHost(orchestrator);

    const unauthorizedGet = await fetch(host.url);
    expect(unauthorizedGet.status).toBe(401);
    expect(await unauthorizedGet.text()).toBe('Unauthorized.');

    const unauthorizedPost = await fetch(host.url, { method: 'POST' });
    expect(unauthorizedPost.status).toBe(401);
    expect(await unauthorizedPost.text()).toBe('Unauthorized.');

    const authorized = await fetch(host.url, {
      method: 'POST',
      headers: Object.fromEntries(host.headers.map(({ name, value }) => [name, value])),
    });
    expect(authorized.status).toBe(404);
  });

  it('rotates the bearer token when the host restarts', async () => {
    const { orchestrator } = makeFakeOrchestrator();
    const first = await startTestingMcpHost(orchestrator);
    const firstAuthorization = first.headers[0]?.value;

    await stopTestingMcpHost();
    const second = await startTestingMcpHost(orchestrator);
    expect(second.headers[0]?.value).not.toBe(firstAuthorization);
  });
});

describe('createTestingServer — connection session isolation', () => {
  it('returns report-ready markdown and lets the agent attach another image to a step', async () => {
    const session = makeSession(randomUUID(), 'visual report', 'passed');
    const { orchestrator } = makeFakeOrchestrator([session]);
    const connection = await connectTestingClient(orchestrator, 'testing-report-images');

    const initial = JSON.parse(
      mcpText(
        await connection.client.callTool({
          name: 'test_report',
          arguments: { sessionId: session.id },
        })
      )
    ) as { markdown: string; steps: Array<{ id: string; screenshots: string[] }> };
    const updated = JSON.parse(
      mcpText(
        await connection.client.callTool({
          name: 'test_report_add_image',
          arguments: { sessionId: session.id, stepId: 's1', imagePath: 'C:/captures/extra.png' },
        })
      )
    ) as { markdown: string; screenshots: string[] };

    expect(initial.markdown).toContain('/shot/s1.png');
    expect(initial.steps[0]).toMatchObject({ id: 's1', screenshots: ['/shot/s1.png'] });
    expect(updated.screenshots).toContain('C:/captures/extra.png');
    await Promise.all([connection.client.close(), connection.server.close()]);
  });
  it('redacts secret-bearing report details at the MCP boundary', async () => {
    const session = makeSession(randomUUID(), 'secret output', 'failed');
    const plaintext = 'testing-oauth-secret';
    session.results[0].detail = `callback=https://example.test?access_token=${plaintext}`;
    const { orchestrator } = makeFakeOrchestrator([session]);
    const connection = await connectTestingClient(orchestrator, 'testing-secret-firewall');

    const report = await connection.client.callTool({
      name: 'test_report',
      arguments: { sessionId: session.id },
    });

    expect(JSON.stringify(report)).not.toContain(plaintext);
    expect(mcpText(report)).toContain('[REDACTED]');
    await Promise.all([connection.client.close(), connection.server.close()]);
  });

  it('does not enumerate another connection sessions and rejects guessed capabilities', async () => {
    const { orchestrator } = makeFakeOrchestrator();
    const owner = await connectTestingClient(orchestrator, 'testing-owner');
    const stranger = await connectTestingClient(orchestrator, 'testing-stranger');

    const run = JSON.parse(
      mcpText(
        await owner.client.callTool({
          name: 'test_run',
          arguments: {
            name: 'private test',
            platform: 'web',
            steps: [{ id: 'step-1', description: 'open private page' }],
          },
        })
      )
    ) as { sessionId: string };
    const ownerSessions = JSON.parse(
      mcpText(await owner.client.callTool({ name: 'test_list', arguments: {} }))
    ) as Array<{ sessionId: string }>;
    const strangerSessions = JSON.parse(
      mcpText(await stranger.client.callTool({ name: 'test_list', arguments: {} }))
    ) as Array<{ sessionId: string }>;
    const guessed = await stranger.client.callTool({
      name: 'test_report',
      arguments: { sessionId: randomUUID() },
    });

    expect(ownerSessions.map((session) => session.sessionId)).toEqual([run.sessionId]);
    expect(strangerSessions).toEqual([]);
    expect(guessed.isError).toBe(true);
    await Promise.all([owner.client.close(), stranger.client.close(), owner.server.close(), stranger.server.close()]);
  });

  it('reclaims a session after reconnect only from its exact cryptographic capability', async () => {
    const { orchestrator } = makeFakeOrchestrator();
    const owner = await connectTestingClient(orchestrator, 'testing-owner');
    const run = JSON.parse(
      mcpText(
        await owner.client.callTool({
          name: 'test_run',
          arguments: {
            name: 'reconnect test',
            platform: 'web',
            steps: [{ id: 'step-1', description: 'persist result' }],
          },
        })
      )
    ) as { sessionId: string };
    await Promise.all([owner.client.close(), owner.server.close()]);

    const reconnected = await connectTestingClient(orchestrator, 'testing-reconnected');
    const beforeReclaim = JSON.parse(
      mcpText(await reconnected.client.callTool({ name: 'test_list', arguments: {} }))
    ) as Array<{ sessionId: string }>;
    const reclaimed = JSON.parse(
      mcpText(
        await reconnected.client.callTool({
          name: 'test_list',
          arguments: { sessionIds: [run.sessionId] },
        })
      )
    ) as Array<{ sessionId: string }>;
    const report = JSON.parse(
      mcpText(
        await reconnected.client.callTool({
          name: 'test_report',
          arguments: { sessionId: run.sessionId },
        })
      )
    ) as { sessionId: string; status: string };

    expect(beforeReclaim).toEqual([]);
    expect(reclaimed.map((session) => session.sessionId)).toEqual([run.sessionId]);
    expect(report).toMatchObject({ sessionId: run.sessionId, status: 'passed' });
    await Promise.all([reconnected.client.close(), reconnected.server.close()]);
  });
});
