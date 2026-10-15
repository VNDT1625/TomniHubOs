import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createWorkflowMcpServer } from '@process/agentRuntime/agentMesh/workflow/server';
import { createWorkflowMailbox } from '@process/agentRuntime/agentMesh/workflow/mailbox';
import { createWorkflowResultStore } from '@process/agentRuntime/agentMesh/workflow/resultDelivery';
import { startWorkflowMcpHost } from '@process/agentRuntime/agentMesh/workflow/host';
import {
  startCoreWorkspaceReadHost,
  stopCoreWorkspaceReadHosts,
} from '@process/resources/nativeFile/coreWorkspaceMcpHost';

const clients: Client[] = [];
const folders: string[] = [];
const closeHosts: Array<() => Promise<void>> = [];
const connect = async (host: { url: string; headers: Array<{ name: string; value: string }> }): Promise<Client> => {
  const auth = Object.fromEntries(host.headers.map(({ name, value }) => [name, value]));
  const transport = new SSEClientTransport(new URL(host.url), {
    requestInit: { headers: auth },
    eventSourceInit: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: { ...(init?.headers as Record<string, string>), ...auth },
        }),
    },
  });
  const client = new Client({ name: 'workflow-mcp-integration', version: '1.0.0' });
  await client.connect(transport);
  clients.push(client);
  return client;
};
const report = (response: Awaited<ReturnType<Client['callTool']>>): string =>
  (response.content as Array<{ text?: string }>)[0]?.text ?? '';
const coordinator = () => {
  let next = 0;
  const active = new Set<string>();
  return {
    requestLease: vi.fn(async () => {
      const id = String(++next);
      active.add(id);
      return { id, kind: 'workflowTool' as const, estCostMB: 16, grantedAt: Date.now() };
    }),
    releaseLease: vi.fn((id: string) => {
      active.delete(id);
    }),
    active,
  };
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch((): void => undefined)));
  await Promise.all(closeHosts.splice(0).map((close) => close()));
  await stopCoreWorkspaceReadHosts();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('workflow_run MCP tool', () => {
  it('is discoverable and completes parallel steps + conditional dependency in one MCP call', async () => {
    const guard = coordinator();
    const called: string[] = [];
    const onStep = vi.fn();
    const server = createWorkflowMcpServer({
      coordinator: guard,
      owner: { processKind: 'main', serviceId: 'workflow-test' },
      signal: new AbortController().signal,
      authorize: async () => true,
      onStep,
      invoke: async (tool, input) => {
        called.push(tool);
        return { ready: true, text: input.text };
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'workflow-in-memory', version: '1.0.0' });
    await client.connect(clientTransport);
    clients.push(client);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'workflow_mailbox_poll',
      'workflow_adapter_get',
      'workflow_result_get',
      'workflow_run',
    ]);
    const response = await client.callTool({
      name: 'workflow_run',
      arguments: {
        steps: [
          { id: 'A', tool: 'tool_a', input: { text: 'A' } },
          { id: 'B', tool: 'tool_b', input: { text: 'B' } },
          {
            id: 'C',
            tool: 'tool_c',
            input: { text: 'C' },
            dependsOn: ['A', 'B'],
            when: [
              { stepId: 'A', status: 'succeeded', path: ['ready'], equals: true },
              { stepId: 'B', status: 'succeeded', path: ['ready'], equals: true },
            ],
          },
        ],
      },
    });
    expect(response.isError).not.toBe(true);
    expect(report(response)).toContain('"status":"completed"');
    expect(report(response)).toContain('"text":"C"');
    expect(called).toEqual(['tool_a', 'tool_b', 'tool_c']);
    expect(guard.active.size).toBe(0);
    expect(onStep).toHaveBeenCalledTimes(6);
    expect(onStep).toHaveBeenCalledWith(expect.objectContaining({ id: 'A', workflowStage: 0 }));
    expect(onStep).toHaveBeenCalledWith(expect.objectContaining({ id: 'B', workflowStage: 0 }));
    expect(onStep).toHaveBeenCalledWith(expect.objectContaining({ id: 'C', workflowStage: 1 }));
  });

  it('delivers large outputs by refs and retrieves chunks inside the same authenticated MCP session', async () => {
    const gate = coordinator();
    const content = 'D'.repeat(50_000);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createWorkflowMcpServer({
      coordinator: gate,
      owner: { processKind: 'main', serviceId: 'workflow-delivery' },
      authorize: async () => true,
      invoke: async () => ({ body: content }),
      signal: new AbortController().signal,
    }).connect(b);
    const client = new Client({ name: 'workflow-delivery-test', version: '1.0.0' });
    await client.connect(a);
    clients.push(client);
    const delivered = await client.callTool({
      name: 'workflow_run',
      arguments: { steps: [{ id: 'A', tool: 'big_read', input: {} }], delivery: { mode: 'smart', maxChars: 8_000 } },
    });
    const body = JSON.parse(report(delivered)) as {
      steps: Array<{ output?: unknown; outputPreview?: string; resultRef: string; previewTruncated?: boolean }>;
    };
    expect(report(delivered).length).toBeLessThan(8_000);
    expect(body.steps[0]?.output).toBeUndefined();
    expect(body.steps[0]?.previewTruncated).toBe(true);
    const ref = body.steps[0]!.resultRef;
    const chunk = await client.callTool({ name: 'workflow_result_get', arguments: { resultRef: ref, limit: 400 } });
    const data = JSON.parse(report(chunk)) as {
      stepId: string;
      text: string;
      totalChars: number;
      nextOffset: number | null;
    };
    expect(data.stepId).toBe('A');
    expect(data.text).toContain('DDD');
    expect(data.totalChars).toBeGreaterThan(50_000);
    expect(data.nextOffset).toBe(400);
    const foreign = await client.callTool({
      name: 'workflow_result_get',
      arguments: { resultRef: '00000000-0000-4000-8000-000000000000' },
    });
    expect(foreign.isError).toBe(true);
    expect(report(foreign)).toContain('WORKFLOW_RESULT_REFERENCE_UNAVAILABLE');
    expect(gate.active.size).toBe(0);
  });

  it('allows E to finish after unrelated A fails and emits A error immediately', async () => {
    const gate = coordinator();
    const events: Array<{ id: string; phase: string }> = [];
    let finishE!: () => void;
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createWorkflowMcpServer({
      coordinator: gate,
      owner: { processKind: 'main', serviceId: 'workflow-parallel-error' },
      authorize: async () => true,
      signal: new AbortController().signal,
      onStep: ({ id, phase }) => {
        events.push({ id, phase });
      },
      invoke: async (tool) => {
        if (tool === 'tool_A') throw new Error('A failed');
        if (tool === 'tool_E')
          await new Promise<void>((resolve) => {
            finishE = resolve;
          });
        return { ok: true };
      },
    }).connect(b);
    const client = new Client({ name: 'workflow-parallel-error', version: '1.0.0' });
    await client.connect(a);
    clients.push(client);
    const run = client.callTool({
      name: 'workflow_run',
      arguments: {
        steps: [
          { id: 'A', tool: 'tool_A', input: {} },
          { id: 'B', tool: 'tool_B', input: {} },
          { id: 'C', tool: 'tool_C', input: {} },
          { id: 'E', tool: 'tool_E', input: {}, dependsOn: ['B', 'C'] },
        ],
      },
    });
    await vi.waitFor(() => expect(events).toContainEqual({ id: 'E', phase: 'running' }));
    expect(events).toContainEqual({ id: 'A', phase: 'error' });
    expect(events).not.toContainEqual({ id: 'E', phase: 'success' });
    finishE();
    const response = JSON.parse(report(await run)) as { status: string; steps: Array<{ status: string }> };
    expect(response.status).toBe('failed');
    expect(response.steps.map((step) => step.status)).toEqual(['failed', 'succeeded', 'succeeded', 'succeeded']);
    expect(events).toContainEqual({ id: 'E', phase: 'success' });
  });

  it('does not treat a UI observer failure as a failed tool execution', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createWorkflowMcpServer({
      coordinator: coordinator(),
      owner: { processKind: 'main', serviceId: 'workflow-observer-failure' },
      authorize: async () => true,
      signal: new AbortController().signal,
      onStep: async () => {
        throw new Error('UI disconnected');
      },
      invoke: async () => ({ status: 'healthy' }),
    }).connect(b);
    const client = new Client({ name: 'workflow-observer', version: '1.0.0' });
    await client.connect(a);
    clients.push(client);
    const response = await client.callTool({
      name: 'workflow_run',
      arguments: { steps: [{ id: 'A', tool: 'tool_a', input: {} }] },
    });
    expect(response.isError).not.toBe(true);
    expect(JSON.parse(report(response)).steps[0].status).toBe('succeeded');
  });

  it('returns A failure before E finishes, resumes A repair while E runs, and drains mailbox once', async () => {
    const store = createWorkflowResultStore();
    const mailbox = createWorkflowMailbox(store);
    const gate = coordinator();
    const events: string[] = [];
    let finishE!: () => void;
    const [transportA, transportB] = InMemoryTransport.createLinkedPair();
    await createWorkflowMcpServer({
      resultStore: store,
      mailbox,
      coordinator: gate,
      owner: { processKind: 'main', serviceId: 'job-owner', taskId: 'first-turn' },
      signal: new AbortController().signal,
      authorize: async () => true,
      invoke: async (tool) => {
        events.push(tool);
        if (tool === 'tool_A') throw new Error('A failed');
        if (tool === 'tool_E')
          await new Promise<void>((resolve) => {
            finishE = resolve;
          });
        return { ready: true, tool };
      },
    }).connect(transportB);
    const agentA = new Client({ name: 'original-agent-turn', version: '1.0.0' });
    await agentA.connect(transportA);
    clients.push(agentA);
    const checkpointResponse = await agentA.callTool({
      name: 'workflow_run',
      arguments: {
        checkpointOnError: true,
        steps: [
          { id: 'A', tool: 'tool_A', input: {} },
          { id: 'B', tool: 'tool_B', input: {} },
          { id: 'C', tool: 'tool_C', input: {} },
          { id: 'E', tool: 'tool_E', input: {}, dependsOn: ['B', 'C'] },
        ],
      },
    });
    const checkpoint = JSON.parse(report(checkpointResponse)) as {
      status: string;
      workflowId: string;
      mailbox: { cursor: number };
    };
    expect(checkpoint.status).toBe('needs_agent');
    expect(checkpoint.workflowId).toMatch(/^[a-f\d-]{36}$/u);
    await vi.waitFor(() => expect(events).toContain('tool_E'));
    expect(mailbox.read(checkpoint.workflowId).status).toBe('needs_agent');

    // The next Agent turn gets a new MCP connection with the SAME scoped
    // session mailbox and may append a repair while the sibling E is waiting.
    const [transportC, transportD] = InMemoryTransport.createLinkedPair();
    await createWorkflowMcpServer({
      resultStore: store,
      mailbox,
      coordinator: gate,
      owner: { processKind: 'main', serviceId: 'job-owner', taskId: 'second-turn' },
      signal: new AbortController().signal,
      authorize: async () => true,
      invoke: async () => ({ fixed: true }),
    }).connect(transportD);
    const agentB = new Client({ name: 'resumed-agent-turn', version: '1.0.0' });
    await agentB.connect(transportC);
    clients.push(agentB);
    const repairResponse = await agentB.callTool({
      name: 'workflow_run',
      arguments: {
        resumeWorkflowId: checkpoint.workflowId,
        steps: [{ id: 'repair_A', tool: 'repair', input: { reason: 'A failed' } }],
      },
    });
    expect(repairResponse.isError).not.toBe(true);
    expect(JSON.parse(report(repairResponse)).steps[0].status).toBe('succeeded');
    expect(mailbox.read(checkpoint.workflowId).events).toContainEqual(
      expect.objectContaining({ stepId: 'repair_A', status: 'succeeded' })
    );
    finishE();
    await vi.waitFor(() => expect(mailbox.read(checkpoint.workflowId).status).toBe('completed_with_errors'));
    const poll = await agentB.callTool({
      name: 'workflow_mailbox_poll',
      arguments: {
        workflowId: checkpoint.workflowId,
        after: checkpoint.mailbox.cursor,
      },
    });
    const update = JSON.parse(report(poll)) as { events: Array<{ stepId: string; status: string }>; status: string };
    expect(update.events).toContainEqual(expect.objectContaining({ stepId: 'E', status: 'succeeded' }));
    expect(update.status).toBe('completed_with_errors');
    expect(gate.active.size).toBe(0);
  });

  it('keeps approved E running after the old MCP host closes and exposes its result to a new scoped host', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'workflow-host-mailbox-'));
    folders.push(folder);
    writeFileSync(path.join(folder, 'exists.txt'), 'E completed after handoff.\n', 'utf8');
    const workspace = await startCoreWorkspaceReadHost(folder);
    const store = createWorkflowResultStore();
    const mailbox = createWorkflowMailbox(store);
    const gate = coordinator();
    let releaseE!: () => void;
    let eStarted = false;
    const oldHost = await startWorkflowMcpHost({
      requestId: 'first-agent-turn',
      servers: [{ name: 'tomny-core-workspace', url: workspace.url, headers: workspace.headers }],
      patterns: ['workflow_run', 'tomny_read'],
      coordinator: gate,
      signal: new AbortController().signal,
      resultStore: store,
      mailbox,
      authorize: async () => true,
      onStep: async ({ id, phase }) => {
        if (id === 'E' && phase === 'running') {
          eStarted = true;
          await new Promise<void>((resolve) => {
            releaseE = resolve;
          });
        }
      },
    });
    closeHosts.push(oldHost.close);
    const firstAgent = await connect(oldHost);
    const pathExists = path.join(folder, 'exists.txt');
    const checkpointResponse = await firstAgent.callTool({
      name: 'workflow_run',
      arguments: {
        checkpointOnError: true,
        steps: [
          { id: 'A', tool: 'tomny_read', input: { filePath: path.join(folder, 'missing.txt') } },
          { id: 'B', tool: 'tomny_read', input: { filePath: pathExists } },
          { id: 'C', tool: 'tomny_read', input: { filePath: pathExists } },
          { id: 'E', tool: 'tomny_read', input: { filePath: pathExists }, dependsOn: ['B', 'C'] },
        ],
      },
    });
    const { workflowId } = JSON.parse(report(checkpointResponse)) as { workflowId: string };
    expect(workflowId).toBeTruthy();
    await vi.waitFor(() => expect(eStarted).toBe(true));
    await oldHost.close();
    const newHost = await startWorkflowMcpHost({
      requestId: 'second-agent-turn',
      servers: [],
      patterns: ['workflow_run', 'workflow_mailbox_poll'],
      coordinator: gate,
      signal: new AbortController().signal,
      resultStore: store,
      mailbox,
      authorize: async () => false,
    });
    closeHosts.push(newHost.close);
    const newAgent = await connect(newHost);
    releaseE();
    await vi.waitFor(() =>
      expect(mailbox.peek(workflowId).events).toContainEqual(
        expect.objectContaining({ stepId: 'E', status: 'succeeded' })
      )
    );
    const update = await newAgent.callTool({ name: 'workflow_mailbox_poll', arguments: { workflowId } });
    expect(report(update)).not.toContain('E completed after handoff.');
    expect(report(update)).toContain('"status":"succeeded"');
    expect(mailbox.list().find((x) => x.workflowId === workflowId)?.unread).toBe(0);
  });

  it('denies a child tool before invoke, then executes the declared recovery branch', async () => {
    const invoked = vi.fn(async () => 'secret');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createWorkflowMcpServer({
      coordinator: coordinator(),
      owner: { processKind: 'main', serviceId: 'workflow-test' },
      signal: new AbortController().signal,
      authorize: async (name) => name === 'fallback',
      invoke: invoked,
    }).connect(serverTransport);
    const client = new Client({ name: 'workflow-permissions', version: '1.0.0' });
    await client.connect(clientTransport);
    clients.push(client);
    const reply = await client.callTool({
      name: 'workflow_run',
      arguments: {
        steps: [
          { id: 'A', tool: 'write_file', input: {} },
          { id: 'B', tool: 'fallback', input: {}, dependsOn: ['A'], when: [{ stepId: 'A', status: 'failed' }] },
        ],
      },
    });
    expect(report(reply)).toContain('WORKFLOW_CHILD_PERMISSION_DENIED');
    expect(report(reply)).toContain('"status":"failed"');
    expect(invoked).toHaveBeenCalledOnce();
    expect(invoked).toHaveBeenCalledWith('fallback', {}, expect.any(AbortSignal));
  });

  it('reads two actual attachments in parallel through one workflow_run without ToolSearch', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'workflow-read-many-'));
    folders.push(folder);
    writeFileSync(path.join(folder, 'first.txt'), 'File ONE content.\n', 'utf8');
    writeFileSync(path.join(folder, 'second.txt'), 'File TWO content.\n', 'utf8');
    const workspace = await startCoreWorkspaceReadHost(folder);
    const gate = coordinator();
    const abort = new AbortController();
    const host = await startWorkflowMcpHost({
      requestId: 'parallel-file-attachments',
      signal: abort.signal,
      servers: [{ name: 'tomny-core-workspace', url: workspace.url, headers: workspace.headers }],
      patterns: ['tomny_read', 'workflow_run'],
      coordinator: gate,
      authorize: async () => true,
    });
    closeHosts.push(host.close);
    const client = await connect(host);
    const response = await client.callTool({
      name: 'workflow_run',
      arguments: {
        steps: [
          { id: 'first', tool: 'tomny_read', input: { filePath: path.join(folder, 'first.txt') } },
          { id: 'second', tool: 'tomny_read', input: { filePath: path.join(folder, 'second.txt') } },
        ],
      },
    });
    const text = report(response);
    expect(response.isError).not.toBe(true);
    expect(text).toContain('File ONE content.');
    expect(text).toContain('File TWO content.');
    expect(text).toContain('"status":"completed"');
    expect(gate.requestLease).toHaveBeenCalledTimes(2);
    expect(gate.active.size).toBe(0);
  });

  it('finds a unique file and reads it, or returns 0/multiple matches without read, through one workflow call', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'workflow-find-conditional-'));
    folders.push(folder);
    writeFileSync(path.join(folder, 'unique-test.md'), 'Unique file read content.\\n', 'utf8');
    writeFileSync(path.join(folder, 'multiple-a.md'), 'First candidate.\\n', 'utf8');
    writeFileSync(path.join(folder, 'multiple-b.md'), 'Second candidate.\\n', 'utf8');
    const workspace = await startCoreWorkspaceReadHost(folder);
    const authorize = vi.fn(async () => true);
    const gate = coordinator();
    const host = await startWorkflowMcpHost({
      requestId: 'workflow-conditional-glob',
      signal: new AbortController().signal,
      servers: [{ name: 'tomny-core-workspace', url: workspace.url, headers: workspace.headers }],
      patterns: ['tomny_glob', 'tomny_read', 'workflow_run'],
      coordinator: gate,
      authorize,
    });
    closeHosts.push(host.close);
    const client = await connect(host);
    for (const [pattern, count] of [
      ['unique-*.md', 1],
      ['multiple-*.md', 2],
      ['no-file-*.md', 0],
    ] as const) {
      // MCP requests are intentionally sequenced through one test client.
      // oxlint-disable-next-line no-await-in-loop
      const response = await client.callTool({
        name: 'workflow_run',
        arguments: {
          steps: [
            { id: 'find', tool: 'tomny_glob', input: { pattern } },
            {
              id: 'read',
              tool: 'tomny_read',
              input: {},
              dependsOn: ['find'],
              when: [{ stepId: 'find', status: 'succeeded', fileCount: 1 }],
              inputFrom: { filePath: { stepId: 'find', select: 'singleFile' } },
            },
          ],
        },
      });
      const aggregate = JSON.parse(report(response)) as { steps: Array<{ status: string; fileMatchCount?: number }> };
      expect(response.isError).not.toBe(true);
      expect(aggregate.steps[0]?.fileMatchCount).toBe(count);
      expect(aggregate.steps[1]?.status).toBe(count === 1 ? 'succeeded' : 'skipped');
      if (count === 1) expect(report(response)).toContain('Unique file read content.');
      if (count === 2) expect(report(response)).toContain('multiple-a.md');
      if (count === 0) expect(report(response)).toContain('No files match the pattern.');
    }
    expect(authorize).toHaveBeenCalledTimes(4);
    expect(gate.active.size).toBe(0);
  });

  it('uses actual scoped MCP workspace tools, denies ungranted tool names and closes on run completion', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'workflow-mcp-'));
    folders.push(folder);
    writeFileSync(path.join(folder, 'hello.txt'), 'Hello from authorized file.\n', 'utf8');
    const workspace = await startCoreWorkspaceReadHost(folder);
    const abort = new AbortController();
    const authorize = vi.fn(async () => true);
    const gate = coordinator();
    const host = await startWorkflowMcpHost({
      requestId: 'test-workflow-run',
      signal: abort.signal,
      servers: [{ name: 'tomny-core-workspace', url: workspace.url, headers: workspace.headers }],
      patterns: ['tomny_read'],
      coordinator: gate,
      authorize,
    });
    closeHosts.push(host.close);
    const client = await connect(host);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'workflow_mailbox_poll',
      'workflow_adapter_get',
      'workflow_result_get',
      'workflow_run',
    ]);
    const description = await client.callTool({ name: 'workflow_adapter_get', arguments: { tool: 'tomny_read' } });
    expect(description.isError).not.toBe(true);
    expect(report(description)).toContain('inputSchema');
    expect(report(description)).toContain('mcpJson');
    const forbiddenDescription = await client.callTool({
      name: 'workflow_adapter_get',
      arguments: { tool: 'tomny_search' },
    });
    expect(forbiddenDescription.isError).toBe(true);
    expect(report(forbiddenDescription)).toContain('WORKFLOW_TOOL_NOT_GRANTED');
    const response = await client.callTool({
      name: 'workflow_run',
      arguments: {
        steps: [
          { id: 'A', tool: 'tomny_read', input: { filePath: path.join(folder, 'hello.txt') } },
          { id: 'B', tool: 'tomny_search', input: { query: 'hello' } },
        ],
      },
    });
    expect(report(response)).toContain('Hello from authorized file.');
    expect(report(response)).toContain('WORKFLOW_TOOL_NOT_GRANTED');
    expect(authorize).toHaveBeenCalledWith('tomny_read', { filePath: path.join(folder, 'hello.txt') });
    expect(gate.active.size).toBe(0);
    await host.close();
    closeHosts.pop();
  });
});
