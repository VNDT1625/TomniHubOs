/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createWorkflowEngine } from '@/process/automation/workflowEngine';
import type { NodeExecutorMap } from '@/process/automation/nodeExecutors';
import type { RunEvent, Workflow, WorkflowCheckpoint, WorkflowNode } from '@/process/automation/automationTypes';

/** Build a workflow from a list of nodes. */
const workflow = (nodes: WorkflowNode[]): Workflow => ({
  id: 'wf-1',
  name: 'Test workflow',
  nodes,
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
});

const node = (id: string, kind: WorkflowNode['kind'], name = id): WorkflowNode => ({ id, kind, name, config: {} });

/** Passthrough executor table; individual kinds overridden per test. */
const passthroughExecutors = (): NodeExecutorMap => {
  const pass = (_n: WorkflowNode, ctx: { input: unknown }) => Promise.resolve(ctx.input);
  const map: Partial<NodeExecutorMap> = {};
  // Fill every leaf kind with a passthrough so the map is complete.
  const leafKinds: Array<keyof NodeExecutorMap> = [
    'trigger.manual',
    'trigger.schedule',
    'trigger.webhook',
    'action.http',
    'action.ai',
    'action.transform',
    'action.delay',
    'action.log',
    'action.set',
    'action.code',
    'action.filesystem',
    'action.app.makeVideo',
    'action.app.editor',
    'action.notify',
    'action.manager',
    'action.browser',
    'action.conversation',
    'action.cron',
    'action.subworkflow',
    'action.cloud.upload',
    'action.email.send',
    'action.social.facebook',
    'action.social.tiktok',
    'action.company',
  ];
  for (const kind of leafKinds) map[kind] = pass;
  return map as NodeExecutorMap;
};

describe('createWorkflowEngine', () => {
  it('runs a linear pipeline and threads output between nodes', async () => {
    const events: RunEvent[] = [];
    const executors = passthroughExecutors();
    executors['trigger.manual'] = () => Promise.resolve('seed');
    executors['action.transform'] = (_n, ctx) => Promise.resolve(`${String(ctx.input)}->t`);
    executors['action.log'] = (_n, ctx) => Promise.resolve(ctx.input);

    const engine = createWorkflowEngine({
      executors,
      emit: (e) => events.push(e),
      now: () => 42,
      newRunId: () => 'run-1',
    });
    const result = await engine.run(
      workflow([node('a', 'trigger.manual'), node('b', 'action.transform'), node('c', 'action.log')])
    );

    expect(result).toMatchObject({ runId: 'run-1', ok: true });
    const finishes = events.filter((e): e is Extract<RunEvent, { type: 'node-finish' }> => e.type === 'node-finish');
    expect(finishes.map((f) => f.output)).toEqual(['seed', 'seed->t', 'seed->t']);
  });

  it('emits the full event sequence in order', async () => {
    const events: RunEvent[] = [];
    const engine = createWorkflowEngine({
      executors: passthroughExecutors(),
      emit: (e) => events.push(e),
      now: () => 1,
      newRunId: () => 'run-1',
    });

    await engine.run(workflow([node('a', 'trigger.manual'), node('b', 'action.log')]));

    expect(events.map((e) => e.type)).toEqual([
      'run-start',
      'node-routed',
      'node-start',
      'node-finish',
      'node-routed',
      'node-start',
      'node-finish',
      'run-finish',
    ]);
    expect(events.every((e) => e.runId === 'run-1')).toBe(true);
  });

  it('fails fast: a thrown node emits ok:false and stops later nodes', async () => {
    const events: RunEvent[] = [];
    const executors = passthroughExecutors();
    const thirdRan = vi.fn();
    executors['action.http'] = () => Promise.reject(new Error('boom'));
    executors['action.log'] = (n, ctx) => {
      thirdRan();
      return Promise.resolve(ctx.input);
    };

    const engine = createWorkflowEngine({
      executors,
      emit: (e) => events.push(e),
      now: () => 1,
      newRunId: () => 'run-1',
    });
    const result = await engine.run(
      workflow([node('a', 'trigger.manual'), node('b', 'action.http'), node('c', 'action.log')])
    );

    expect(result.ok).toBe(false);
    expect(thirdRan).not.toHaveBeenCalled();

    const failed = events.find(
      (e): e is Extract<RunEvent, { type: 'node-finish' }> => e.type === 'node-finish' && !e.ok
    );
    expect(failed?.nodeId).toBe('b');
    expect(failed?.error).toBe('boom');

    const runFinish = events.find((e): e is Extract<RunEvent, { type: 'run-finish' }> => e.type === 'run-finish');
    expect(runFinish?.ok).toBe(false);
  });

  it('does not emit a node-start for nodes after the failing one', async () => {
    const events: RunEvent[] = [];
    const executors = passthroughExecutors();
    executors['action.http'] = () => Promise.reject(new Error('boom'));

    const engine = createWorkflowEngine({
      executors,
      emit: (e) => events.push(e),
      now: () => 1,
      newRunId: () => 'run-1',
    });
    await engine.run(workflow([node('a', 'action.http'), node('b', 'action.log')]));

    const starts = events.filter((e): e is Extract<RunEvent, { type: 'node-start' }> => e.type === 'node-start');
    expect(starts.map((s) => s.nodeId)).toEqual(['a']);
  });

  it('stops between nodes when the signal is already aborted', async () => {
    const events: RunEvent[] = [];
    const controller = new AbortController();
    controller.abort();

    const engine = createWorkflowEngine({
      executors: passthroughExecutors(),
      emit: (e) => events.push(e),
      now: () => 1,
      newRunId: () => 'run-1',
    });
    const result = await engine.run(workflow([node('a', 'trigger.manual')]), { signal: controller.signal });

    expect(result.ok).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['run-start', 'run-finish']);
  });

  it('stops mid-pipeline when aborted after the first node', async () => {
    const events: RunEvent[] = [];
    const controller = new AbortController();
    const executors = passthroughExecutors();
    executors['action.transform'] = (_n, ctx) => {
      controller.abort();
      return Promise.resolve(ctx.input);
    };

    const engine = createWorkflowEngine({
      executors,
      emit: (e) => events.push(e),
      now: () => 1,
      newRunId: () => 'run-1',
    });
    const result = await engine.run(workflow([node('a', 'action.transform'), node('b', 'action.log')]), {
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    const starts = events.filter((e): e is Extract<RunEvent, { type: 'node-start' }> => e.type === 'node-start');
    expect(starts.map((s) => s.nodeId)).toEqual(['a']);
  });

  it('uses an externally-provided runId when given', async () => {
    const events: RunEvent[] = [];
    const engine = createWorkflowEngine({
      executors: passthroughExecutors(),
      emit: (e) => events.push(e),
      now: () => 1,
      newRunId: () => 'generated',
    });

    const result = await engine.run(workflow([node('a', 'trigger.manual')]), { runId: 'external' });
    expect(result.runId).toBe('external');
    expect(events.every((e) => e.runId === 'external')).toBe(true);
  });

  it('runs an empty pipeline as an immediate success', async () => {
    const events: RunEvent[] = [];
    const engine = createWorkflowEngine({
      executors: passthroughExecutors(),
      emit: (e) => events.push(e),
      now: () => 1,
      newRunId: () => 'run-1',
    });

    const result = await engine.run(workflow([]));
    expect(result.ok).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['run-start', 'run-finish']);
  });

  it('pauses for approval and continues when approved', async () => {
    const events: RunEvent[] = [];
    const requestApproval = vi.fn().mockResolvedValue({ approved: true });
    const approval = node('approve', 'control.approval');
    approval.config = { message: 'Publish {{input}}?' };
    const engine = createWorkflowEngine({
      executors: passthroughExecutors(),
      emit: (e) => events.push(e),
      now: () => 1,
      newRunId: () => 'run-1',
      requestApproval,
    });

    const result = await engine.run(workflow([approval, node('after', 'action.log')]), { input: 'report' });

    expect(result.ok).toBe(true);
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', nodeId: 'approve', message: 'Publish report?', input: 'report' }),
      undefined
    );
    expect(events.map((event) => event.type)).toContain('approval-requested');
    expect(events.map((event) => event.type)).toContain('approval-resolved');
  });

  it('fails safely when approval is rejected', async () => {
    const events: RunEvent[] = [];
    const after = vi.fn();
    const executors = passthroughExecutors();
    executors['action.log'] = (_node, ctx) => {
      after();
      return Promise.resolve(ctx.input);
    };
    const engine = createWorkflowEngine({
      executors,
      emit: (e) => events.push(e),
      now: () => 1,
      newRunId: () => 'run-1',
      requestApproval: () => Promise.resolve({ approved: false, reason: 'Not authorized' }),
    });

    const result = await engine.run(workflow([node('approve', 'control.approval'), node('after', 'action.log')]));

    expect(result.ok).toBe(false);
    expect(after).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: 'approval-resolved', approved: false }));
  });

  it('fails closed before an email executor when no human approval provider is configured', async () => {
    const executors = passthroughExecutors();
    const send = vi.fn();
    executors['action.email.send'] = send;
    const email = node('email', 'action.email.send');
    email.config = { from: 'me@example.com', to: 'you@example.com', subject: 'Hello', body: 'Body' };
    const engine = createWorkflowEngine({ executors, emit: () => undefined });

    const result = await engine.run(workflow([email]));

    expect(result.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('binds email approval to resolved fields and executes the approved snapshot', async () => {
    const executors = passthroughExecutors();
    const send = vi.fn().mockResolvedValue({ messageId: 'sent' });
    executors['action.email.send'] = send;
    const email = node('email', 'action.email.send', 'Send report');
    email.config = {
      from: 'me@example.com',
      to: 'first@example.com, {{input}}',
      subject: 'Report for {{input}}',
      body: 'Approved body: {{input}}',
      attachArtifact: true,
    };
    const requestApproval = vi.fn().mockImplementation(() => {
      email.config.to = 'attacker@example.com';
      return Promise.resolve({ approved: true });
    });
    const engine = createWorkflowEngine({
      executors,
      emit: () => undefined,
      now: () => 100,
      newRunId: () => 'run-1',
      requestApproval,
    });

    const result = await engine.run(workflow([email]), { input: 'second@example.com' });

    expect(result.ok).toBe(true);
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        nodeId: 'email',
        expiresAt: 300_100,
        action: {
          kind: 'action.email.send',
          from: 'me@example.com',
          to: ['first@example.com', 'second@example.com'],
          subject: 'Report for second@example.com',
          body: 'Approved body: second@example.com',
          attachArtifact: true,

          attachmentPath: null,
        },
      }),
      undefined
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ to: 'first@example.com, {{input}}' }) }),
      { input: 'second@example.com' },
      undefined
    );
  });

  it('binds an attachment to the immutable input snapshot approved by the user', async () => {
    const executors = passthroughExecutors();
    const send = vi.fn().mockResolvedValue({ messageId: 'sent' });
    executors['action.email.send'] = send;
    const email = node('email', 'action.email.send');
    email.config = {
      from: 'me@example.com',
      to: 'you@example.com',
      subject: 'Attachment',
      body: 'See attachment',
      attachArtifact: true,
    };
    const pipelineInput = { artifact: { path: 'C:\\safe.txt' } };
    const requestApproval = vi.fn().mockImplementation(() => {
      pipelineInput.artifact.path = 'C:\\changed-after-approval.txt';
      return Promise.resolve({ approved: true });
    });
    const engine = createWorkflowEngine({ executors, emit: () => undefined, requestApproval });

    const result = await engine.run(workflow([email]), { input: pipelineInput });

    expect(result.ok).toBe(true);
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ attachmentPath: 'C:\\safe.txt' }) }),
      undefined
    );
    expect(send).toHaveBeenCalledWith(expect.anything(), { input: { artifact: { path: 'C:\\safe.txt' } } }, undefined);
  });

  it('rejects agent-routed email because it could diverge from the approved preview', async () => {
    const executors = passthroughExecutors();
    const send = vi.fn();
    const executeWithAgent = vi.fn();
    executors['action.email.send'] = send;
    const email = node('email', 'action.email.send');
    email.config = { from: 'me@example.com', to: 'you@example.com', subject: 'Hello', body: 'Body' };
    email.execution = { mode: 'agent' };
    const requestApproval = vi.fn().mockResolvedValue({ approved: true });
    const engine = createWorkflowEngine({
      executors,
      executeWithAgent,
      emit: () => undefined,
      requestApproval,
    });

    const result = await engine.run(workflow([email]));

    expect(result.ok).toBe(false);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(executeWithAgent).not.toHaveBeenCalled();
  });

  it('never automatically retries an email after an ambiguous transport failure', async () => {
    const executors = passthroughExecutors();
    const send = vi.fn().mockRejectedValue(new Error('SMTP acknowledgement timed out'));
    executors['action.email.send'] = send;
    const email = node('email', 'action.email.send');
    email.config = { from: 'me@example.com', to: 'you@example.com', subject: 'Hello', body: 'Body' };
    email.onError = { retries: 3, retryDelayMs: 1 };
    const engine = createWorkflowEngine({
      executors,
      emit: () => undefined,
      requestApproval: () => Promise.resolve({ approved: true }),
    });

    const result = await engine.run(workflow([email]));

    expect(result.ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy AI nodes on their existing deterministic executor unless explicitly routed', async () => {
    const executors = passthroughExecutors();
    const deterministic = vi.fn().mockResolvedValue('legacy-output');
    const executeWithAgent = vi.fn().mockResolvedValue('agent-output');
    executors['action.ai'] = deterministic;
    const legacyNode = node('legacy-ai', 'action.ai');
    const engine = createWorkflowEngine({ executors, executeWithAgent, emit: () => undefined });

    const result = await engine.run(workflow([legacyNode]), { input: 'prompt' });

    expect(result).toMatchObject({ ok: true, output: 'legacy-output' });
    expect(deterministic).toHaveBeenCalledWith(legacyNode, { input: 'prompt' }, undefined);
    expect(executeWithAgent).not.toHaveBeenCalled();
  });

  it('routes an agent node through Agent Core instead of the deterministic executor', async () => {
    const events: RunEvent[] = [];
    const executors = passthroughExecutors();
    const deterministic = vi.fn().mockResolvedValue('deterministic');
    const executeWithAgent = vi.fn().mockResolvedValue('agent-output');
    executors['action.log'] = deterministic;
    const agentNode = node('agent', 'action.log');
    agentNode.execution = { mode: 'agent', access: 'mcp', estimatedTokens: 200 };
    const dynamicWorkflow = workflow([agentNode]);
    dynamicWorkflow.knowledge = { tokenPolicy: { maxAgentSteps: 1, maxEstimatedTokens: 200 } };
    const engine = createWorkflowEngine({ executors, executeWithAgent, emit: (event) => events.push(event) });

    const result = await engine.run(dynamicWorkflow, { input: 'goal' });

    expect(result).toMatchObject({ ok: true, output: 'agent-output' });
    expect(deterministic).not.toHaveBeenCalled();
    expect(executeWithAgent).toHaveBeenCalledWith(agentNode, { input: 'goal' }, undefined);
  });

  it('uses Agent Core only when a hybrid deterministic step fails', async () => {
    const executors = passthroughExecutors();
    executors['action.http'] = vi.fn().mockRejectedValue(new Error('connector unavailable'));
    const executeWithAgent = vi.fn().mockResolvedValue('recovered');
    const hybridNode = node('hybrid', 'action.http');
    hybridNode.execution = { mode: 'hybrid', access: 'api' };
    const engine = createWorkflowEngine({ executors, executeWithAgent, emit: () => undefined });

    const result = await engine.run(workflow([hybridNode]));

    expect(result).toMatchObject({ ok: true, output: 'recovered' });
    expect(executeWithAgent).toHaveBeenCalledOnce();
  });

  it('stops before an authenticated browser step when website login is forbidden', async () => {
    const executors = passthroughExecutors();
    const browser = vi.fn().mockResolvedValue('unsafe');
    executors['action.browser'] = browser;
    const browserNode = node('browser', 'action.browser');
    browserNode.execution = { mode: 'deterministic', access: 'browser', requiresWebsiteLogin: true };
    const secureWorkflow = workflow([browserNode]);
    secureWorkflow.knowledge = { security: { preferTrustedConnectors: true, websiteLogin: 'forbid' } };
    const engine = createWorkflowEngine({ executors, emit: () => undefined });

    const result = await engine.run(secureWorkflow);

    expect(result.ok).toBe(false);
    expect(browser).not.toHaveBeenCalled();
  });

  it('fails before a second Agent Core call when the workflow token policy is exhausted', async () => {
    const first = node('first', 'action.log');
    first.execution = { mode: 'agent', estimatedTokens: 50 };
    const second = node('second', 'action.log');
    second.execution = { mode: 'agent', estimatedTokens: 50 };
    const limitedWorkflow = workflow([first, second]);
    limitedWorkflow.knowledge = { tokenPolicy: { maxAgentSteps: 1, maxEstimatedTokens: 100 } };
    const executeWithAgent = vi.fn().mockResolvedValue('done');
    const engine = createWorkflowEngine({
      executors: passthroughExecutors(),
      executeWithAgent,
      emit: () => undefined,
    });

    const result = await engine.run(limitedWorkflow);

    expect(result.ok).toBe(false);
    expect(executeWithAgent).toHaveBeenCalledOnce();
  });

  it('resumes from the latest completed top-level node without repeating it', async () => {
    const executors = passthroughExecutors();
    const first = vi.fn().mockResolvedValue('checkpoint-output');
    const second = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue('complete');
    executors['action.transform'] = first;
    executors['action.http'] = second;
    let saved: WorkflowCheckpoint | null = null;
    const checkpointStore = {
      load: vi.fn(async () => saved),
      save: vi.fn(async (checkpoint) => {
        saved = checkpoint;
      }),
      clear: vi.fn(async () => {
        saved = null;
      }),
    };
    const engine = createWorkflowEngine({ executors, checkpointStore, emit: () => undefined });
    const resumable = workflow([node('first', 'action.transform'), node('second', 'action.http')]);

    const failed = await engine.run(resumable, { runId: 'resume-run' });
    const resumed = await engine.run(resumable, { runId: 'resume-run', resume: true });

    expect(failed.ok).toBe(false);
    expect(resumed).toMatchObject({ ok: true, output: 'complete' });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    expect(checkpointStore.clear).toHaveBeenCalledWith('wf-1', 'resume-run');
  });
});
