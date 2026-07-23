import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { createAgentMeshController } from '@process/agentRuntime/agentMesh/controller';
import {
  createAgentJobOrchestrator,
  type AgentJob,
  type AgentJobSessionSnapshot,
  type AgentJobStateStore,
} from '@process/agentRuntime/agentMesh/orchestrator';
import { createAgentOrchestratorServer } from '@process/agentRuntime/agentMesh/mcp/server';
import {
  registerAgentExecutionPermissionScope,
  requestAgentExecutionPermission,
} from '@process/agentRuntime/agentMesh/mcp/executionScope';

import { JsonAgentJobStateStore } from '@process/agentRuntime/agentMesh/mcp/stateStore';
import { createAgentMeshService } from '@process/agentRuntime/agentMesh/service';

import { JsonlDurableEventStore, MemoryDurableEventStore } from '@process/services/agentChat/durability';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('AgentJobOrchestrator', () => {
  it('runs a bounded batch and exposes outcomes through a cursor tracker', async () => {
    const gates = new Map(['job-1', 'job-2', 'job-3'].map((jobId) => [jobId, deferred()] as const));
    let active = 0;
    let maxActive = 0;
    const orchestrator = createAgentJobOrchestrator({
      executor: async (job, context) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const action = context.emitAction('execute', job.objective);
        try {
          await gates.get(job.jobId)!.promise;
          action.complete('done');
          return { summary: `completed ${job.jobId}`, tokensUsed: 3 };
        } finally {
          active -= 1;
        }
      },
    });

    orchestrator.spawnJobs({
      sessionId: 'batch-session',
      maxConcurrent: 2,
      jobs: [
        { jobId: 'job-1', agentId: 'worker-1', objective: 'first' },
        { jobId: 'job-2', agentId: 'worker-2', objective: 'second' },
        { jobId: 'job-3', agentId: 'worker-3', objective: 'third' },
      ],
    });

    expect(maxActive).toBe(2);
    for (const gate of gates.values()) gate.resolve();
    await orchestrator.waitForIdle('batch-session');

    const tracked = orchestrator.trackJobs({ sessionId: 'batch-session', afterCursor: 0, limit: 100 });
    expect(tracked.jobs.map((job) => job.status)).toEqual(['completed', 'completed', 'completed']);
    expect(tracked.jobs.map((job) => job.outcome?.status)).toEqual(['completed', 'completed', 'completed']);
    expect(tracked.events.some((event) => event.type === 'action')).toBe(true);

    const next = orchestrator.trackJobs({ sessionId: 'batch-session', afterCursor: tracked.cursor });
    expect(next.events).toEqual([]);
    expect(next.cursor).toBe(tracked.cursor);
  });

  it('deduplicates retries and rejects an idempotency key collision', async () => {
    let executions = 0;
    const orchestrator = createAgentJobOrchestrator({
      executor: async () => {
        executions += 1;
        return { summary: 'done' };
      },
    });
    const input = {
      sessionId: 'idempotent-session',
      idempotencyKey: 'request-1',
      jobs: [{ jobId: 'job-1', agentId: 'worker', objective: 'inspect' }],
    };

    const first = orchestrator.spawnJobs(input);
    await orchestrator.waitForIdle(first.sessionId);
    const repeated = orchestrator.spawnJobs(input);

    expect(repeated).toEqual({ ...first, reused: true });
    expect(executions).toBe(1);
    expect(() =>
      orchestrator.spawnJobs({
        ...input,
        jobs: [{ ...input.jobs[0], objective: 'different input' }],
      })
    ).toThrow(/idempotency key.*different input/i);
  });

  it('hibernates an idle controller and wakes the same durable session on resume', async () => {
    const service = createAgentMeshService();
    const orchestrator = createAgentJobOrchestrator({
      service,
      idleHibernateMs: false,
      executor: async (job) => ({ summary: `completed:${job.objective}` }),
    });
    orchestrator.spawnJobs({
      sessionId: 'sleeping-session',
      jobs: [{ jobId: 'first-job', agentId: 'worker', objective: 'first' }],
    });
    await orchestrator.waitForIdle('sleeping-session');

    await expect(orchestrator.hibernateSession('sleeping-session')).resolves.toBe(true);
    expect(service.listSessions()).not.toContain('sleeping-session');
    expect(orchestrator.listSessionViews()).toContainEqual(
      expect.objectContaining({ sessionId: 'sleeping-session', state: 'hibernated' })
    );
    expect(orchestrator.getResult('sleeping-session', 'first-job').outcome).toMatchObject({
      status: 'completed',
      summary: 'completed:first',
    });

    orchestrator.resumeAgent({
      sessionId: 'sleeping-session',
      agentId: 'worker',
      jobId: 'second-job',
      objective: 'second',
    });
    expect(service.listSessions()).toContain('sleeping-session');
    await orchestrator.waitForIdle('sleeping-session');
    expect(orchestrator.getResult('sleeping-session', 'second-job').outcome).toMatchObject({
      status: 'completed',
      summary: 'completed:second',
    });
  });

  it('automatically hibernates terminal sessions after the configured idle window', async () => {
    vi.useFakeTimers();
    try {
      const service = createAgentMeshService();
      const orchestrator = createAgentJobOrchestrator({
        service,
        idleHibernateMs: 100,
        executor: async () => ({ summary: 'done' }),
      });
      orchestrator.spawnJobs({
        sessionId: 'auto-sleep-session',
        jobs: [{ jobId: 'job', agentId: 'worker', objective: 'finish' }],
      });
      await orchestrator.waitForIdle('auto-sleep-session');

      await vi.advanceTimersByTimeAsync(100);

      expect(service.listSessions()).not.toContain('auto-sleep-session');
      expect(orchestrator.listSessionViews()).toContainEqual(
        expect.objectContaining({ sessionId: 'auto-sleep-session', state: 'hibernated' })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an invalid dependency without creating a partial session', () => {
    const orchestrator = createAgentJobOrchestrator({
      executor: async () => ({ summary: 'unused' }),
    });

    expect(() =>
      orchestrator.spawnJobs({
        sessionId: 'invalid-session',
        jobs: [{ jobId: 'job-1', agentId: 'worker', objective: 'blocked', dependsOn: ['missing'] }],
      })
    ).toThrow(/unknown dependency/i);
    expect(orchestrator.listSessions()).toEqual([]);
  });

  it('bounds durable sessions, jobs, inputs and persisted outcomes without silent eviction', async () => {
    const orchestrator = createAgentJobOrchestrator({
      maxSessions: 2,
      maxJobsPerSession: 2,
      executor: async (job) => {
        if (job.objective === 'fail') throw new Error('e'.repeat(10_000));
        return { summary: 's'.repeat(70_000) };
      },
    });

    expect(() => orchestrator.spawnJobs({ jobs: [{ agentId: 'worker', objective: 'x'.repeat(32_001) }] })).toThrow(
      /objective cannot exceed 32000/i
    );

    const first = orchestrator.spawnJobs({
      sessionId: 'bounded-one',
      jobs: [
        { jobId: 'large-result', agentId: 'worker', objective: 'complete' },
        { jobId: 'large-error', agentId: 'worker', objective: 'fail' },
      ],
    });
    const second = orchestrator.spawnJobs({
      sessionId: 'bounded-two',
      jobs: [{ agentId: 'worker', objective: 'complete' }],
    });
    expect(() =>
      orchestrator.spawnJobs({
        sessionId: 'bounded-three',
        jobs: [{ agentId: 'worker', objective: 'complete' }],
      })
    ).toThrow(/session limit of 2/i);
    expect(() =>
      orchestrator.spawnJobs({
        sessionId: first.sessionId,
        jobs: [{ agentId: 'worker', objective: 'too many jobs' }],
      })
    ).toThrow(/job limit of 2/i);
    expect(orchestrator.listSessions()).toEqual(['bounded-one', 'bounded-two']);
    expect(() =>
      orchestrator.messageAgent({
        sessionId: first.sessionId,
        agentId: 'worker',
        content: 'm'.repeat(16_001),
      })
    ).toThrow(/content cannot exceed 16000/i);
    expect(() =>
      orchestrator.trackJobs({
        sessionId: first.sessionId,
        jobIds: Array.from({ length: 17 }, () => 'large-result'),
      })
    ).toThrow(/jobIds cannot exceed 16/i);
    expect(() =>
      orchestrator.cancelJobs(
        first.sessionId,
        Array.from({ length: 17 }, () => 'large-result')
      )
    ).toThrow(/jobIds cannot exceed 16/i);

    await Promise.all([orchestrator.waitForIdle(first.sessionId), orchestrator.waitForIdle(second.sessionId)]);
    const summary = orchestrator.getResult(first.sessionId, 'large-result').outcome;
    const failure = orchestrator.getResult(first.sessionId, 'large-error').outcome;
    expect(summary?.status === 'completed' ? summary.summary.length : 0).toBe(64_000);
    expect(failure?.status === 'failed' ? failure.error.length : 0).toBe(8_000);
  });

  it('cancels a running job and resumes the same agent in the existing session', async () => {
    const orchestrator = createAgentJobOrchestrator({
      executor: async (job, context) => {
        if (job.objective === 'wait') {
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
        }
        return { summary: job.objective };
      },
    });
    orchestrator.spawnJobs({
      sessionId: 'resume-session',
      jobs: [{ jobId: 'job-wait', agentId: 'worker', objective: 'wait' }],
    });

    orchestrator.cancelJobs('resume-session', ['job-wait']);
    await orchestrator.waitForIdle('resume-session');
    expect(orchestrator.getResult('resume-session', 'job-wait').status).toBe('cancelled');

    orchestrator.resumeAgent({
      sessionId: 'resume-session',
      agentId: 'worker',
      jobId: 'job-next',
      objective: 'continue from checkpoint',
    });
    await orchestrator.waitForIdle('resume-session');

    expect(orchestrator.getResult('resume-session', 'job-next')).toEqual(
      expect.objectContaining({
        agentId: 'worker',
        status: 'completed',
        outcome: { status: 'completed', summary: 'continue from checkpoint', tokensUsed: undefined },
      })
    );
    expect(orchestrator.listSessions()).toEqual(['resume-session']);
  });
});

const memoryStateStore = (): AgentJobStateStore => {
  const snapshots = new Map<string, AgentJobSessionSnapshot>();
  return {
    loadAll: async () => structuredClone([...snapshots.values()]),
    save: async (snapshot) => {
      snapshots.set(snapshot.sessionId, structuredClone(snapshot));
    },
    remove: async (sessionId) => {
      snapshots.delete(sessionId);
    },
  };
};

const mcpText = (result: unknown): string =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .map((entry) => entry.text ?? '')
    .join('\n');

describe('Agent orchestrator MCP', () => {
  it('exposes parallel spawn, cursor tracking, durable results and resume tools', async () => {
    const orchestrator = createAgentJobOrchestrator({
      executor: async (job) => ({ summary: `result:${job.objective}` }),
    });
    const server = createAgentOrchestratorServer({
      orchestrator,
      listTargets: async () => [
        {
          id: 'codex',
          name: 'Codex',
          protocol: 'codex-app-server',
          candidates: ['codex'],
          args: ['app-server'],
          detail: 'ready',
          runnable: true,
          detected: true,
          available: true,
          command: 'codex',
        },
      ],
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'agent-orchestrator-test', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'agent_research_plan',
        'agent_research_spawn',
        'agent_spawn',
        'agent_track',
        'agent_result',
        'agent_resume',
        'agent_sessions',
      ])
    );
    const spawned = JSON.parse(
      mcpText(
        await client.callTool({
          name: 'agent_spawn',
          arguments: {
            jobs: [
              { jobId: 'research', agentId: 'worker-a', objective: 'research' },
              { jobId: 'verify', agentId: 'worker-b', objective: 'verify' },
            ],
          },
        })
      )
    ) as { sessionId: string; jobIds: string[] };
    expect(spawned.sessionId).toMatch(/^session-[0-9a-f-]{36}$/i);
    await orchestrator.waitForIdle(spawned.sessionId);

    const tracked = JSON.parse(
      mcpText(
        await client.callTool({ name: 'agent_track', arguments: { sessionId: spawned.sessionId, afterCursor: 0 } })
      )
    ) as { cursor: number; jobs: Array<{ status: string; outcome: { summary: string } }> };
    expect(tracked.jobs.map((job) => job.status)).toEqual(['completed', 'completed']);
    expect(tracked.jobs[0]?.outcome.summary).toBe('result:research');
    expect(tracked.cursor).toBeGreaterThan(0);
  });

  it('plans a section-specialist research graph without starting a durable session', async () => {
    const orchestrator = createAgentJobOrchestrator({
      executor: async () => ({ summary: 'unused' }),
    });
    const server = createAgentOrchestratorServer({
      orchestrator,
      listTargets: async () => [],
      executionClaims: {
        workspace: 'C:\\trusted-workspace',
        surface: 'deliverables',
        permissionMode: 'workspace-write',
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'research-planner', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: 'agent_research_plan',
      arguments: {
        topic: 'Evidence-led AI security',
        sections: [
          { id: 'threats', title: 'Threat model', question: 'Which threats matter?' },
          { id: 'controls', title: 'Controls', question: 'Which controls are independently supported?' },
        ],
        outputs: ['report', 'presentation'],
      },
    });
    const plan = JSON.parse(mcpText(result)) as {
      jobs: Array<{ jobId: string; dependsOn?: string[]; workspace?: string }>;
      evidenceContract: {
        archiveSchema: string;
        verifyAgainstOriginalSources: boolean;
        summariesMayReferenceSummaries: boolean;
      };
    };
    const dependencies = Object.fromEntries(plan.jobs.map((job) => [job.jobId, job.dependsOn]));

    expect(result.isError).not.toBe(true);
    expect(dependencies).toMatchObject({
      'research-threats': ['repo-context'],
      'verify-threats': ['research-threats'],
      'research-controls': ['repo-context'],
      'verify-controls': ['research-controls'],
      'evidence-group-1': ['verify-threats', 'verify-controls'],
      'cross-section-reconciliation': ['evidence-group-1'],
      'evidence-synthesis': ['repo-context', 'evidence-group-1', 'cross-section-reconciliation'],
      'author-report': ['evidence-synthesis'],
      'author-presentation': ['evidence-synthesis'],
      'deliverable-review': ['author-report', 'author-presentation'],
    });
    expect(plan.evidenceContract).toEqual({
      archiveSchema: 'tomny.evidence-archive.v1',
      verifyAgainstOriginalSources: true,
      summariesMayReferenceSummaries: false,
    });
    expect(orchestrator.listSessions()).toEqual([]);
  });

  it('spawns a durable research session while binding every job to trusted full-access host claims', async () => {
    const stateStore = memoryStateStore();
    const executed: AgentJob[] = [];
    const orchestrator = createAgentJobOrchestrator({
      stateStore,
      executor: async (job) => {
        executed.push(structuredClone(job));
        return { summary: `completed:${job.jobId}` };
      },
    });
    await orchestrator.initialize();
    const server = createAgentOrchestratorServer({
      orchestrator,
      listTargets: async () => [],
      executionClaims: {
        workspace: 'C:\\trusted-workspace',
        surface: 'deliverables',
        permissionMode: 'full-access',
        executionScopeId: 'core:research-parent',
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'research-spawner', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: 'agent_research_spawn',
      arguments: {
        topic: 'Secure agent delivery',
        sections: [{ id: 'architecture', title: 'Architecture', question: 'How is it secured?' }],
        outputs: ['report', 'presentation'],
        workspace: 'C:\\attacker-workspace',
        surface: 'browser',
        permissionMode: 'full-access',
      },
    });
    const spawned = JSON.parse(mcpText(result)) as {
      sessionId: string;
      jobIds: string[];
      jobCount: number;
      evidenceContract: { verifyAgainstOriginalSources: boolean };
    };
    await orchestrator.waitForIdle(spawned.sessionId);
    await orchestrator.flush(spawned.sessionId);
    const persisted = await stateStore.loadAll();

    expect(result.isError).not.toBe(true);
    expect(spawned).toMatchObject({
      jobCount: 7,
      evidenceContract: { verifyAgainstOriginalSources: true },
    });
    expect(persisted.map((snapshot) => snapshot.sessionId)).toContain(spawned.sessionId);
    expect(
      executed.every(
        (job) =>
          job.workspace === 'C:\\trusted-workspace' &&
          job.surface === 'deliverables' &&
          job.permissionMode === 'full-access' &&
          job.executionScopeId === 'core:research-parent'
      )
    ).toBe(true);
  });

  it('keeps every public research job read-only when input requests deliverables full access', async () => {
    const executed: AgentJob[] = [];
    const orchestrator = createAgentJobOrchestrator({
      executor: async (job) => {
        executed.push(structuredClone(job));
        return { summary: `completed:${job.jobId}` };
      },
    });
    const server = createAgentOrchestratorServer({ orchestrator, listTargets: async () => [] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'public-research-spawner', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: 'agent_research_spawn',
      arguments: {
        topic: 'Public research isolation',
        sections: [{ id: 'scope', title: 'Scope', question: 'What can public workers access?' }],
        outputs: ['report'],
        workspace: 'C:\\attacker-workspace',
        surface: 'deliverables',
        permissionMode: 'full-access',
      },
    });
    const spawned = JSON.parse(mcpText(result)) as { sessionId: string };
    await orchestrator.waitForIdle(spawned.sessionId);

    expect(result.isError).not.toBe(true);
    expect(executed).not.toHaveLength(0);
    expect(
      executed.every(
        (job) => job.workspace === undefined && job.surface === 'chat' && job.permissionMode === 'read-only'
      )
    ).toBe(true);
  });

  it('rejects invalid research requests without creating a partial session', async () => {
    const orchestrator = createAgentJobOrchestrator({
      executor: async () => ({ summary: 'unused' }),
    });
    const server = createAgentOrchestratorServer({ orchestrator, listTargets: async () => [] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'research-validation', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const duplicateSections = await client.callTool({
      name: 'agent_research_spawn',
      arguments: {
        topic: 'Duplicate sections',
        sections: [
          { id: 'same', title: 'First', question: 'First question?' },
          { id: 'same', title: 'Second', question: 'Second question?' },
        ],
        outputs: ['report'],
      },
    });
    const emptySections = await client.callTool({
      name: 'agent_research_spawn',
      arguments: { topic: 'No sections', sections: [], outputs: ['report'] },
    });

    expect(duplicateSections.isError).toBe(true);
    expect(mcpText(duplicateSections)).toMatch(/section ids must be unique/i);
    expect(emptySections.isError).toBe(true);
    expect(orchestrator.listSessions()).toEqual([]);
  });
  it('binds public execution and resume to safe immutable workspace, surface and permission claims', async () => {
    const executed: AgentJob[] = [];
    const orchestrator = createAgentJobOrchestrator({
      executor: async (job) => {
        executed.push(structuredClone(job));
        return { summary: `result:${job.objective}` };
      },
    });
    const privilegedSessionId = `session-${crypto.randomUUID()}`;
    orchestrator.spawnJobs({
      sessionId: privilegedSessionId,
      jobs: [
        {
          agentId: 'worker',
          objective: 'legacy privileged task',
          workspace: 'C:\\outside-parent-workspace',
          surface: 'browser',
          permissionMode: 'full-access',
        },
      ],
    });
    await orchestrator.waitForIdle(privilegedSessionId);

    const server = createAgentOrchestratorServer({ orchestrator, listTargets: async () => [] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'safe-claims', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const resumed = await client.callTool({
      name: 'agent_resume',
      arguments: {
        sessionId: privilegedSessionId,
        agentId: 'worker',
        objective: 'public safe continuation',
        workspace: 'C:\\attacker-selected-workspace',
        surface: 'browser',
        permissionMode: 'full-access',
        waitMs: 1_000,
      },
    });
    expect(resumed.isError).not.toBe(true);
    expect(executed.at(-1)).toMatchObject({
      objective: 'public safe continuation',
      surface: 'chat',
      permissionMode: 'read-only',
    });
    expect(executed.at(-1)?.workspace).toBeUndefined();

    const fresh = await client.callTool({
      name: 'agent_execute',
      arguments: {
        agentId: 'fresh-worker',
        objective: 'public safe task',
        workspace: 'C:\\attacker-selected-workspace',
        surface: 'browser',
        permissionMode: 'workspace-write',
        waitMs: 1_000,
      },
    });
    expect(fresh.isError).not.toBe(true);
    expect(executed.at(-1)).toMatchObject({
      objective: 'public safe task',
      surface: 'chat',
      permissionMode: 'read-only',
    });
    expect(executed.at(-1)?.workspace).toBeUndefined();
  });

  it('binds trusted Core claims and forwards secret-tool approval through the live parent scope', async () => {
    const executed: AgentJob[] = [];
    const requestPermission = vi.fn(async ({ tool }: { tool: string }) => tool === 'agent_secret_context_use');
    const releaseScope = registerAgentExecutionPermissionScope('core:trusted-parent', requestPermission);
    const orchestrator = createAgentJobOrchestrator({
      executor: async (job) => {
        executed.push(structuredClone(job));
        const approved = await requestAgentExecutionPermission(job.executionScopeId, {
          tool: 'agent_secret_context_use',
          detail: 'opaque browser fill',
        });
        return { summary: approved ? 'approved by parent' : 'denied' };
      },
    });
    const server = createAgentOrchestratorServer({
      orchestrator,
      listTargets: async () => [],
      executionClaims: {
        workspace: 'C:\\parent-workspace',
        surface: 'browser',
        permissionMode: 'workspace-write',
        executionScopeId: 'core:trusted-parent',
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'trusted-parent', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: 'agent_execute',
      arguments: {
        agentId: 'worker',
        objective: 'use opaque secret',
        workspace: 'C:\\escaped-workspace',
        surface: 'ide',
        permissionMode: 'full-access',
        waitMs: 1_000,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(executed[0]).toMatchObject({
      workspace: 'C:\\parent-workspace',
      surface: 'browser',
      permissionMode: 'workspace-write',
      executionScopeId: 'core:trusted-parent',
    });
    expect(requestPermission).toHaveBeenCalledWith({
      tool: 'agent_secret_context_use',
      detail: 'opaque browser fill',
    });
    releaseScope();
    await expect(
      requestAgentExecutionPermission('core:trusted-parent', { tool: 'agent_secret_context_use' })
    ).resolves.toBe(false);
  });

  it('preserves a live approval broker across inspection and rotates credentials after scoped host restart', async () => {
    const orchestrator = createAgentJobOrchestrator({
      executor: async () => ({ summary: 'unused' }),
    });
    vi.doMock('@process/agentRuntime/agentMesh/mcp/wiring', () => ({
      getAgentOrchestratorServices: async () => ({
        orchestrator,
        listTargets: async () => [],
      }),
      flushAgentOrchestratorServices: async () => undefined,
    }));
    const { startAgentOrchestratorMcpHost, stopAgentOrchestratorMcpHost } =
      await import('@process/agentRuntime/agentMesh/mcp/host');
    const firstApproval = vi.fn(async () => true);
    const scope = {
      id: 'core:inspection-parent',
      executionClaims: {
        workspace: 'C:\\parent-workspace',
        surface: 'ide',
        permissionMode: 'workspace-write' as const,
      },
    };

    try {
      const first = await startAgentOrchestratorMcpHost({
        scope: { ...scope, requestPermission: firstApproval },
      });
      await expect(requestAgentExecutionPermission(scope.id, { tool: 'agent_secret_context_use' })).resolves.toBe(true);

      const inspected = await startAgentOrchestratorMcpHost({ scope });
      expect(inspected.url).toBe(first.url);
      expect(inspected.headers).toEqual(first.headers);
      await expect(requestAgentExecutionPermission(scope.id, { tool: 'agent_secret_context_use' })).resolves.toBe(true);
      expect(firstApproval).toHaveBeenCalledTimes(2);

      await first.close();
      const secondApproval = vi.fn(async () => false);
      const restarted = await startAgentOrchestratorMcpHost({
        scope: { ...scope, requestPermission: secondApproval },
      });
      expect(restarted.headers).not.toEqual(first.headers);
      await expect(requestAgentExecutionPermission(scope.id, { tool: 'agent_secret_context_use' })).resolves.toBe(
        false
      );
      expect(secondApproval).toHaveBeenCalledOnce();
    } finally {
      await stopAgentOrchestratorMcpHost();
      vi.doUnmock('@process/agentRuntime/agentMesh/mcp/wiring');
    }
  });

  it('isolates session enumeration and reclaims a session only with its exact capability', async () => {
    const orchestrator = createAgentJobOrchestrator({
      executor: async (job) => ({ summary: `result:${job.objective}` }),
    });
    const deps = { orchestrator, listTargets: async () => [] };
    const connect = async (name: string) => {
      const server = createAgentOrchestratorServer(deps);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name, version: '1.0.0' });
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      return client;
    };
    const owner = await connect('owner');
    const stranger = await connect('stranger');

    const spawned = JSON.parse(
      mcpText(
        await owner.callTool({
          name: 'agent_execute',
          arguments: { agentId: 'worker', objective: 'private task', waitMs: 1_000 },
        })
      )
    ) as { sessionId: string; jobIds: string[] };

    const ownerSessions = JSON.parse(
      mcpText(await owner.callTool({ name: 'agent_sessions', arguments: {} }))
    ) as Array<{
      sessionId: string;
    }>;
    const strangerSessions = JSON.parse(
      mcpText(await stranger.callTool({ name: 'agent_sessions', arguments: {} }))
    ) as Array<{ sessionId: string }>;
    expect(ownerSessions.map((view) => view.sessionId)).toEqual([spawned.sessionId]);
    expect(strangerSessions).toEqual([]);

    const guessedCapability = `session-${crypto.randomUUID()}`;
    const deniedClose = await stranger.callTool({
      name: 'agent_close',
      arguments: { sessionId: guessedCapability },
    });
    expect(deniedClose.isError).toBe(true);
    expect(orchestrator.hasSession(spawned.sessionId)).toBe(true);

    const reconnected = await connect('reconnected-owner');
    const reclaimed = JSON.parse(
      mcpText(
        await reconnected.callTool({
          name: 'agent_sessions',
          arguments: { sessionIds: [spawned.sessionId] },
        })
      )
    ) as Array<{ sessionId: string }>;
    expect(reclaimed.map((view) => view.sessionId)).toEqual([spawned.sessionId]);
  });

  it('reclaims an exact session capability after durable orchestrator restart', async () => {
    const store = memoryStateStore();
    const first = createAgentJobOrchestrator({
      stateStore: store,
      executor: async (job) => ({ summary: `persisted:${job.objective}` }),
    });
    await first.initialize();
    const spawned = first.spawnJobs({ jobs: [{ agentId: 'worker', objective: 'survive restart' }] });
    await first.waitForIdle(spawned.sessionId);
    await first.flush();

    const restored = createAgentJobOrchestrator({
      stateStore: store,
      executor: async (job) => ({ summary: job.objective }),
    });
    await restored.initialize();
    const server = createAgentOrchestratorServer({ orchestrator: restored, listTargets: async () => [] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'restart-owner', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const reclaimed = JSON.parse(
      mcpText(
        await client.callTool({
          name: 'agent_sessions',
          arguments: { sessionIds: [spawned.sessionId] },
        })
      )
    ) as Array<{ sessionId: string }>;
    const result = JSON.parse(
      mcpText(
        await client.callTool({
          name: 'agent_result',
          arguments: { sessionId: spawned.sessionId, jobId: spawned.jobIds[0] },
        })
      )
    ) as { outcome: { summary: string } };
    expect(reclaimed.map((view) => view.sessionId)).toEqual([spawned.sessionId]);
    expect(result.outcome.summary).toBe('persisted:survive restart');
  });

  it('rejects a persisted session that exceeds the runtime concurrency claim', async () => {
    const store = memoryStateStore();
    await store.save({
      schema: 'tomny.agent-orchestrator.session.v1',
      sessionId: 'tampered-session',
      maxConcurrent: 9,
      cursor: 0,
      lastActivityAt: 0,
      events: [],
      jobs: [],
      statuses: [],
      outcomes: [],
      idempotency: [],
    });
    const restored = createAgentJobOrchestrator({
      stateStore: store,
      executor: async () => ({ summary: 'unused' }),
    });

    await expect(restored.initialize()).rejects.toThrow(/maxConcurrent cannot exceed 8/i);
  });

  it('sanitizes result and tracker text restored from a tampered durable snapshot', async () => {
    const store = memoryStateStore();
    const plaintext = 'tampered-durable-secret';
    await store.save({
      schema: 'tomny.agent-orchestrator.session.v1',
      sessionId: 'tampered-output-session',
      maxConcurrent: 1,
      cursor: 1,
      lastActivityAt: 1,
      events: [
        {
          type: 'status',
          cursor: 1,
          timestamp: 1,
          sessionId: 'tampered-output-session',
          jobId: 'job-one',
          agentId: 'worker',
          status: 'completed',
          detail: `https://example.test?access_token=${plaintext}`,
        },
      ],
      jobs: [{ jobId: 'job-one', agentId: 'worker', objective: `API_KEY=${plaintext}`, kind: 'agent' }],
      statuses: [['job-one', 'completed']],
      outcomes: [['job-one', { status: 'completed', summary: `https://example.test?access_token=${plaintext}` }]],
      idempotency: [],
    });
    const restored = createAgentJobOrchestrator({
      stateStore: store,
      executor: async () => ({ summary: 'unused' }),
    });

    await restored.initialize();
    const tracked = restored.trackJobs({ sessionId: 'tampered-output-session' });
    expect(JSON.stringify(tracked)).not.toContain(plaintext);
    expect(JSON.stringify(tracked)).toContain('[REDACTED]');
  });

  it('restores results and inherited agent settings from the durable state store', async () => {
    const store = memoryStateStore();
    const first = createAgentJobOrchestrator({
      stateStore: store,
      executor: async (job) => ({ summary: job.objective }),
    });
    await first.initialize();
    first.spawnJobs({
      sessionId: 'durable-session',
      jobs: [
        {
          jobId: 'first-job',
          agentId: 'worker',
          targetId: 'codex',
          modelId: 'gpt-5',
          surface: 'browser',
          permissionMode: 'read-only',
          objective: 'first result',
        },
      ],
    });
    await first.waitForIdle('durable-session');
    await first.flush();

    const restored = createAgentJobOrchestrator({
      stateStore: store,
      executor: async (job) => ({ summary: `${job.targetId}:${job.modelId}:${job.surface}:${job.objective}` }),
    });
    await restored.initialize();
    expect(restored.getResult('durable-session', 'first-job')).toMatchObject({
      status: 'completed',
      outcome: { status: 'completed', summary: 'first result' },
    });

    restored.resumeAgent({
      sessionId: 'durable-session',
      agentId: 'worker',
      jobId: 'next-job',
      objective: 'continue',
    });
    await restored.waitForIdle('durable-session');
    expect(restored.getResult('durable-session', 'next-job')).toMatchObject({
      targetId: 'codex',
      modelId: 'gpt-5',
      surface: 'browser',
      continuation: ['first result'],
      outcome: { summary: 'codex:gpt-5:browser:continue' },
    });
  });

  it('atomically restores persisted sessions from the JSON state store', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-agent-orchestrator-'));
    const statePath = path.join(directory, 'sessions.json');
    try {
      const first = createAgentJobOrchestrator({
        stateStore: new JsonAgentJobStateStore(statePath),
        executor: async (job) => ({ summary: `disk:${job.objective}` }),
      });
      await first.initialize();
      first.spawnJobs({
        sessionId: 'disk-session',
        jobs: [
          { jobId: 'disk-one', agentId: 'worker-one', objective: 'one' },
          { jobId: 'disk-two', agentId: 'worker-two', objective: 'two' },
        ],
      });
      await first.waitForIdle('disk-session');
      await first.flush();

      const restored = createAgentJobOrchestrator({
        stateStore: new JsonAgentJobStateStore(statePath),
        executor: async (job) => ({ summary: job.objective }),
      });
      await restored.initialize();

      expect(restored.getResult('disk-session', 'disk-one')).toMatchObject({
        status: 'completed',
        outcome: { status: 'completed', summary: 'disk:one' },
      });
      expect(restored.getResult('disk-session', 'disk-two')).toMatchObject({
        status: 'completed',
        outcome: { status: 'completed', summary: 'disk:two' },
      });
      await restored.flush();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('redacts obfuscated URL credentials before result persistence and MCP retrieval', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-agent-secret-firewall-'));
    const statePath = path.join(directory, 'sessions.json');
    const plaintext = 'durable-oauth-secret';
    try {
      const orchestrator = createAgentJobOrchestrator({
        stateStore: new JsonAgentJobStateStore(statePath),
        executor: async () => ({
          summary: `callback=https://example.test?access_to\u200bken=${plaintext}`,
        }),
      });
      await orchestrator.initialize();
      const spawned = orchestrator.spawnJobs({ jobs: [{ agentId: 'worker', objective: 'safe objective' }] });
      await orchestrator.waitForIdle(spawned.sessionId);
      await orchestrator.flush(spawned.sessionId);

      const result = orchestrator.getResult(spawned.sessionId, spawned.jobIds[0]);
      const persisted = await readFile(statePath, 'utf8');
      expect(JSON.stringify(result)).not.toContain(plaintext);
      expect(JSON.stringify(result)).toContain('[REDACTED]');
      expect(persisted).not.toContain(plaintext);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('AgentMeshService', () => {
  it('creates durable-session controllers and exposes snapshots/grants', () => {
    const service = createAgentMeshService();
    const controller = service.create('session-1');
    controller.registerAgent({
      agentId: 'leader',
      grants: [{ fromAgentId: 'leader', toAgentId: '*', actions: ['task', 'question', 'control'] }],
    });
    controller.registerAgent({ agentId: 'worker' });

    expect(service.listSessions()).toEqual(['session-1']);
    expect(service.canSend('session-1', 'leader', 'worker', 'question')).toBe(true);
    expect(service.canSend('session-1', 'worker', 'leader', 'question')).toBe(false);
    expect(service.snapshot('session-1').inspections.map((item) => item.agent.agentId)).toEqual(['leader', 'worker']);
  });

  it('rehydrates agents, grants, tasks, worklog and an unacknowledged mailbox after restart', async () => {
    const journal = new MemoryDurableEventStore();
    const first = createAgentMeshService({ eventStoreFactory: () => journal });
    const original = first.create('restart-session');
    original.registerAgent({
      agentId: 'leader',
      grants: [{ fromAgentId: 'leader', toAgentId: '*', actions: ['task', 'question', 'control'] }],
    });
    original.registerAgent({ agentId: 'worker' });
    const gate = deferred();
    original.submitTask({ taskId: 'active-task', agentId: 'worker', objective: 'survive restart' }, async () => {
      await gate.promise;
      return { summary: 'old process unexpectedly completed' };
    });
    await Promise.resolve();
    const sent = original.sendMessage({
      fromAgentId: 'leader',
      toAgentId: 'worker',
      kind: 'task',
      content: 'message that must survive restart',
      delivery: 'send-now',
    });
    await original.flush();

    const restarted = createAgentMeshService({ eventStoreFactory: () => journal });
    const recovered = await restarted.recover('restart-session');

    expect(recovered.getStatus('active-task')).toBe('interrupted');
    expect(restarted.canSend('restart-session', 'leader', 'worker', 'task')).toBe(true);
    expect(recovered.getQueue('worker')).toContainEqual(
      expect.objectContaining({
        messageId: sent.messageId,
        content: 'message that must survive restart',
        status: 'queued',
      })
    );
    expect(recovered.getWorklog('worker').at(-1)?.summary).toBe('Task interrupted by process restart');

    original.stopTask('leader', 'active-task', 'interrupt');
    gate.resolve();
    await original.waitForIdle();
  });

  it('discovers and rehydrates persisted sessions before the UI lists them after restart', async () => {
    const journal = new MemoryDurableEventStore();
    const first = createAgentMeshService({ eventStoreFactory: () => journal });
    const original = first.create('conversation-1:team:request-1');
    original.registerAgent({ agentId: 'leader' });
    original.registerAgent({ agentId: 'repo-reader', parentAgentId: 'leader' });
    await original.flush();

    const restarted = createAgentMeshService({
      eventStoreFactory: () => journal,
      listPersistedSessionIds: async () => ['conversation-1:team:request-1'],
    });

    await expect(restarted.discoverSessions()).resolves.toEqual(['conversation-1:team:request-1']);
    expect(restarted.overview('conversation-1:team:request-1').agents.map((agent) => agent.agentId)).toEqual([
      'leader',
      'repo-reader',
    ]);
  });

  it('recovers the latest checkpoint from a newly opened JSONL store', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-agent-mesh-'));
    const filePath = path.join(directory, 'session.jsonl');
    try {
      const writerService = createAgentMeshService({
        eventStoreFactory: () => new JsonlDurableEventStore(filePath),
      });
      const writer = writerService.create('jsonl-session');
      writer.registerAgent({
        agentId: 'leader',
        grants: [{ fromAgentId: 'leader', toAgentId: 'worker', actions: ['task'] }],
      });
      writer.registerAgent({ agentId: 'worker' });
      writer.sendMessage({
        fromAgentId: 'leader',
        toAgentId: 'worker',
        kind: 'task',
        content: 'persisted JSONL payload',
        delivery: 'enqueue-after-task',
      });
      await writer.flush();

      const readerService = createAgentMeshService({
        eventStoreFactory: () => new JsonlDurableEventStore(filePath),
      });
      const reader = await readerService.recover('jsonl-session');

      expect(reader.listAgents().map((agent) => agent.agentId)).toEqual(['leader', 'worker']);
      expect(reader.getQueue('worker')[0]?.content).toBe('persisted JSONL payload');
      await readerService.disposeAll();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('exposes a lightweight overview without chat payloads and resolves concurrency from all caps', () => {
    const service = createAgentMeshService();
    const controller = service.create('overview-session');
    controller.registerAgent({
      agentId: 'leader',
      grants: [{ fromAgentId: 'leader', toAgentId: 'worker', actions: ['task'] }],
    });
    controller.registerAgent({ agentId: 'worker', parentAgentId: 'leader' });
    controller.sendMessage({
      fromAgentId: 'leader',
      toAgentId: 'worker',
      kind: 'task',
      content: 'queued detail that must not be copied into overview',
      delivery: 'enqueue-after-task',
    });

    expect(service.overview('overview-session')).toMatchObject({
      sessionId: 'overview-session',
      agents: [
        { agentId: 'leader', queuedMessages: 0 },
        { agentId: 'worker', parentAgentId: 'leader', queuedMessages: 1 },
      ],
    });
    expect(service.getConcurrencyPolicy()).toEqual({ configuredMaxConcurrent: 4, minimum: 1, maximum: 8 });
    expect(service.resolveMaxConcurrent(7)).toBe(4);
    expect(service.resolveMaxConcurrent(7, 2)).toBe(2);
    expect(service.setConfiguredMaxConcurrent(6).configuredMaxConcurrent).toBe(6);
    expect(service.resolveMaxConcurrent(7, 8)).toBe(6);
  });

  it('rejects duplicate registration and unknown sessions', () => {
    const service = createAgentMeshService();
    service.register('session-1', createAgentMeshController({ sessionId: 'session-1' }));
    expect(() => service.register('session-1', createAgentMeshController({ sessionId: 'other' }))).toThrow(
      /already exists/i
    );
    expect(() => service.snapshot('missing')).toThrow(/unknown.*session/i);
  });
});
