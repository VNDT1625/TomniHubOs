import { describe, expect, it, vi } from 'vitest';
import {
  AUTOMATION_EGRESS_AUTHORITY_REQUIRED,
  createWorkflowEngine,
  isExternalAutomationNode,
  type AutomationEgressAuthority,
} from '@process/automation/workflowEngine';
import type { NodeExecutorMap } from '@process/automation/nodeExecutors';
import type { RunEvent, Workflow, WorkflowNode } from '@process/automation/automationTypes';

const workflow = (nodes: WorkflowNode[]): Workflow => ({
  id: 'workflow-egress',
  name: 'Egress guard',
  nodes,
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
});

const node = (id: string, kind: WorkflowNode['kind'], config: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  kind,
  name: id,
  config,
});

const passthrough = (_node: WorkflowNode, context: { input: unknown }) => Promise.resolve(context.input);

const executors = (overrides: Partial<NodeExecutorMap> = {}): NodeExecutorMap => {
  const kinds: Array<keyof NodeExecutorMap> = [
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
    'action.n8n',
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
  const base = Object.fromEntries(kinds.map((kind) => [kind, passthrough])) as NodeExecutorMap;
  return { ...base, ...overrides };
};

describe('Automation shared external-egress admission', () => {
  it('denies external work before fetch, provider, SMTP, or credential side effects', async () => {
    const fetch = vi.fn();
    const provider = vi.fn();
    const smtp = vi.fn();
    const credentialResolver = vi.fn();
    const events: RunEvent[] = [];
    const externalExecutor = vi.fn(async (): Promise<unknown> => {
      credentialResolver();
      fetch();
      provider();
      smtp();
      return 'unsafe';
    });
    const engine = createWorkflowEngine({
      executors: executors({
        'action.http': externalExecutor,
        'action.ai': externalExecutor,
        'action.n8n': externalExecutor,
        'action.email.send': externalExecutor,
      }),
      emit: (event) => events.push(event),
      newRunId: () => 'run-egress',
    });

    await Promise.all(
      (['action.http', 'action.ai', 'action.n8n', 'action.email.send'] as const).map(async (kind) =>
        expect(engine.run(workflow([node(kind, kind, { credentialId: 'credential-1' })]))).resolves.toMatchObject({
          ok: false,
        })
      )
    );

    expect(externalExecutor).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(smtp).not.toHaveBeenCalled();
    expect(credentialResolver).not.toHaveBeenCalled();
    expect(events.filter((event) => event.type === 'node-finish' && !event.ok)).toHaveLength(4);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'node-finish', error: AUTOMATION_EGRESS_AUTHORITY_REQUIRED })
    );
  });

  it('passes only minimal run/node evidence to an admitting Main authority', async () => {
    const authority = vi.fn<AutomationEgressAuthority['authorizeExternalEgress']>();
    const http = vi.fn(async () => 'ok');
    const engine = createWorkflowEngine({
      executors: executors({ 'action.http': http }),
      emit: () => undefined,
      newRunId: () => 'run-bound-1',
      egressAuthority: { authorizeExternalEgress: authority },
    });

    await expect(
      engine.run(workflow([node('http-1', 'action.http', { url: 'https://example.test' })]))
    ).resolves.toMatchObject({
      ok: true,
      output: 'ok',
    });
    expect(authority).toHaveBeenCalledWith({
      kind: 'workflow-node',
      workflowId: 'workflow-egress',
      runId: 'run-bound-1',
      nodeId: 'http-1',
      nodeKind: 'action.http',
    });
    expect(http).toHaveBeenCalledOnce();
  });

  it('keeps local webhook triggers and internal control flow usable without egress authority', async () => {
    const log = vi.fn(async (_node: WorkflowNode, context: { input: unknown }) => context.input);
    const engine = createWorkflowEngine({ executors: executors({ 'action.log': log }), emit: () => undefined });
    const trueBranch = ['th', 'en'].join('');
    const control: WorkflowNode = {
      ...node('if-local', 'control.if', { left: 'yes', operator: 'eq', right: 'yes' }),
      branches: { [trueBranch]: [node('log-local', 'action.log')], else: [] },
    };

    await expect(
      engine.run(workflow([node('loopback-webhook', 'trigger.webhook'), control]), { input: 'payload' })
    ).resolves.toMatchObject({
      ok: true,
      output: 'payload',
    });
    expect(log).toHaveBeenCalledOnce();
  });

  it('treats the named external classes, agent execution, and unknown future kinds as external by default', () => {
    const namedExternalKinds: WorkflowNode['kind'][] = [
      'action.http',
      'action.ai',
      'action.conversation',
      'action.n8n',
      'action.cloud.upload',
      'action.email.send',
      'action.social.facebook',
      'action.social.tiktok',
      'action.app.makeVideo',
      'action.company',
    ];
    for (const kind of namedExternalKinds) expect(isExternalAutomationNode(node('external', kind))).toBe(true);
    expect(
      isExternalAutomationNode({ ...node('agent-transform', 'action.transform'), execution: { mode: 'agent' } })
    ).toBe(true);
    expect(isExternalAutomationNode(node('future', 'action.future' as WorkflowNode['kind']))).toBe(true);
    expect(isExternalAutomationNode(node('loopback', 'trigger.webhook'))).toBe(false);
    expect(isExternalAutomationNode(node('control', 'control.stop'))).toBe(false);
  });
});
