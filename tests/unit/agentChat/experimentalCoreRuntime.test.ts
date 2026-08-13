/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyCoreRunInput } from '../../../packages/desktop/src/process/agentRuntime/companyCoreRunner';
import { createAgentMeshService } from '../../../packages/desktop/src/process/agentRuntime/agentMesh/service';
import {
  createBuiltinSurfaceManifests,
  createSurfaceRegistry,
} from '../../../packages/desktop/src/process/agentRuntime/surfaceRegistry';
import { MemoryDurableEventStore } from '../../../packages/desktop/src/process/services/agentChat/durability';
import {
  MemoryPermissionRepository,
  PermissionStore,
} from '../../../packages/desktop/src/process/services/agentChat/permission';
import type {
  CoreAdapter,
  CoreCapabilityHostContext,
  CoreRunInput,
  DetectedCoreTarget,
} from '../../../packages/desktop/src/process/experimentalCore/adapters/coreAdapter';
import {
  JsonCoreSessionStore,
  MemoryCoreSessionStore,
  redactCheckpointText,
} from '../../../packages/desktop/src/process/experimentalCore/sessionCheckpointStore';

import {
  createTomnySessionActionHistorySource,
  ExperimentalCoreRuntime,
  resolveCoreCapabilityServerNames,
  resolveCoreToolCatalogPolicy,
  type ExperimentalCoreEvent,
} from '../../../packages/desktop/src/process/experimentalCore/experimentalCoreRuntime';

const target: DetectedCoreTarget = {
  id: 'codex',
  name: 'Codex CLI',
  protocol: 'codex-app-server',
  candidates: ['codex'],
  args: ['app-server'],
  detail: 'direct',
  runnable: true,
  detected: true,
  available: true,
  command: 'codex.exe',
};

const makeAdapter = (): CoreAdapter => ({
  protocol: 'codex-app-server',
  listModels: vi
    .fn()
    .mockResolvedValue([{ key: 'gpt::medium', modelId: 'gpt', label: 'GPT (medium)', isDefault: true }]),
  run: vi.fn(async (input: CoreRunInput) => {
    input.emit({ type: 'delta', text: `reply:${input.prompt}`, mode: 'append' });
  }),
  dispose: vi.fn().mockResolvedValue(undefined),
});

describe('experimental direct core runtime', () => {
  it('limits ToolMap to the active surface until Super is explicitly attached', () => {
    const surface = {
      capabilities: [
        { kind: 'mcp', toolPatterns: ['music_*'] },
        { kind: 'native', toolPatterns: ['ignored_*'] },
      ],
    } as never;

    expect(resolveCoreToolCatalogPolicy(surface)).toEqual({
      mode: 'surface',
      patterns: ['tomny_session_actions', 'music_*'],
    });
    // Browser Control can be attached by an IDE session without expanding its ToolMap.
    expect(resolveCoreToolCatalogPolicy(surface, false)).toEqual({
      mode: 'surface',
      patterns: ['tomny_session_actions', 'music_*'],
    });
    expect(resolveCoreToolCatalogPolicy(surface, true)).toEqual({ mode: 'super', patterns: ['*'] });
  });

  it('discovers Super hosts from every registered surface without hard-coded surface names', () => {
    const activeSurface = {
      capabilities: [{ kind: 'mcp', serverName: 'tomny-ide' }],
    } as never;
    const registry = {
      list: () => [
        { capabilities: [{ kind: 'mcp', serverName: 'tomny-ide' }] },
        { capabilities: [{ kind: 'mcp', serverName: 'tomny-browser-control' }] },
        // A manifest can be registered before its host; it must not break Super.
        { capabilities: [{ kind: 'mcp', serverName: 'tomny-future-surface' }] },
      ],
    } as never;

    expect(resolveCoreCapabilityServerNames(activeSurface, registry, false, ['tomny-ide'])).toEqual(['tomny-ide']);
    expect(
      resolveCoreCapabilityServerNames(activeSurface, registry, true, ['tomny-ide', 'tomny-browser-control'])
    ).toEqual(['tomny-ide', 'tomny-browser-control']);
  });

  it('keeps action-history reads locked to the current session id', async () => {
    const eventStore = new MemoryDurableEventStore();
    await eventStore.append({
      sessionId: 'session-a',
      kind: 'tool.completed',
      visibility: 'public',
      payload: { tool: 'ide_read_file' },
    });
    await eventStore.append({
      sessionId: 'session-b',
      kind: 'tool.completed',
      visibility: 'public',
      payload: { tool: 'browser_open' },
    });

    const actions = await createTomnySessionActionHistorySource(eventStore)('session-a', { limit: 20 });

    expect(actions).toHaveLength(1);
    expect(JSON.stringify(actions)).toContain('ide_read_file');
    expect(JSON.stringify(actions)).not.toContain('browser_open');
  });

  it('never exposes archived checkpoint messages through the agent-facing action log', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-history-search-'));
    const filePath = path.join(directory, 'sessions.json');
    try {
      const writer = new JsonCoreSessionStore(filePath);
      await writer.initialize();
      await writer.save({
        id: 'session-a',
        targetId: 'tomny',
        workspace: 'C:/workspace',
        permissionMode: 'workspace-write',
        status: 'completed',
        createdAt: 1,
        updatedAt: 2,
        messages: [
          { role: 'user', text: `early archive ${'x'.repeat(40_000)} UNIQUE_ARCHIVE_MARKER`, timestamp: 1 },
          { role: 'assistant', text: 'recent conclusion', timestamp: 2 },
        ],
        conversationSummary: '- User: early archive…',
        summarizedMessageCount: 1,
      });
      await writer.save({
        id: 'session-b',
        targetId: 'tomny',
        workspace: 'C:/workspace',
        permissionMode: 'workspace-write',
        status: 'completed',
        createdAt: 1,
        updatedAt: 2,
        messages: [{ role: 'user', text: 'UNIQUE_ARCHIVE_MARKER belongs elsewhere', timestamp: 1 }],
      });
      const restarted = new JsonCoreSessionStore(filePath);
      await restarted.initialize();

      const matches = await createTomnySessionActionHistorySource(new MemoryDurableEventStore(), restarted)(
        'session-a',
        { limit: 10, query: 'UNIQUE_ARCHIVE_MARKER' }
      );

      expect(matches).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  let adapter: CoreAdapter;

  let coordinator: { requestLease: ReturnType<typeof vi.fn>; releaseLease: ReturnType<typeof vi.fn> };
  let events: ExperimentalCoreEvent[];
  let runtime: ExperimentalCoreRuntime;
  let meshService: ReturnType<typeof createAgentMeshService>;

  beforeEach(() => {
    adapter = makeAdapter();
    events = [];
    meshService = createAgentMeshService();
    coordinator = {
      requestLease: vi.fn().mockResolvedValue({ id: 'agent-lease' }),
      releaseLease: vi.fn(),
    };
    runtime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      agentMeshService: meshService,
    });
  });

  it('lists direct targets and models without tomnycore collaborators', async () => {
    await expect(runtime.listTargets()).resolves.toEqual([
      expect.objectContaining({ id: 'codex', available: true, defaultModelKey: 'gpt::medium' }),
    ]);
    expect(adapter.listModels).toHaveBeenCalledWith(target, undefined);
  });

  it('awaits a direct target terminal result with opaque execution evidence', async () => {
    const result = await runtime.executeToCompletion({
      requestId: 'hub-run-1',
      targetId: 'codex',
      prompt: 'answer the bounded goal',
      workspace: 'C:/workspace',
      permissionMode: 'read-only',
    });

    expect(result).toEqual(
      expect.objectContaining({
        requestId: 'hub-run-1',
        targetId: 'codex',
        text: 'reply:answer the bounded goal',
        evidenceRefs: expect.arrayContaining(['experimental-core:request:hub-run-1', 'experimental-core:target:codex']),
      })
    );
  });

  it('forwards Hub cancellation to the active direct-core request', async () => {
    vi.mocked(adapter.run).mockImplementationOnce(
      (input) =>
        new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('cancelled by Hub')), { once: true });
        })
    );
    const controller = new AbortController();
    const completion = runtime.executeToCompletion({
      requestId: 'hub-cancel-1',
      targetId: 'codex',
      prompt: 'cancel me',
      workspace: 'C:/workspace',
      signal: controller.signal,
    });

    controller.abort();

    await expect(completion).rejects.toThrow('CORE_REQUEST_CANCELLED');
    expect(events).toContainEqual(expect.objectContaining({ requestId: 'hub-cancel-1', type: 'cancelled' }));
  });

  it('returns the target list when one model catalog never responds', async () => {
    vi.mocked(adapter.listModels).mockImplementationOnce(() => new Promise(() => {}));
    const stalledRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      agentMeshService: meshService,
      modelDiscoveryTimeoutMs: 5,
    });

    await expect(stalledRuntime.listTargets()).resolves.toEqual([
      expect.objectContaining({ id: 'codex', available: true, models: [] }),
    ]);
  });

  it('runs a selected Company through a direct adapter without TomnyCore', async () => {
    const companyRunner = {
      run: vi.fn(async (input: CompanyCoreRunInput) => {
        await input.chat({
          messages: [{ role: 'user' as const, content: input.goal }],
          model: input.model,
          signal: input.signal,
        });
        input.onEvent({ type: 'status' as const, text: 'worker: done' });
        return 'company summary';
      }),
    };
    const companyRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      companyRunner,
      agentMeshService: meshService,
    });
    const targets = await companyRuntime.listTargets();
    const company = targets.find((item) => item.id === 'company');
    companyRuntime.start(
      'company-request',
      'company',
      'build feature',
      'C:/workspace',
      company?.defaultModelKey,
      'workspace-write',
      undefined,
      'engineering'
    );

    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'company-request' && event.type === 'completed')).toBe(true)
    );
    expect(companyRunner.run).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'engineering' }));
    expect(events).toContainEqual(
      expect.objectContaining({ requestId: 'company-request', type: 'delta', text: 'company summary' })
    );
    expect(meshService.listSessions()).toContain('company-request');
    expect(meshService.snapshot('company-request')).toEqual(
      expect.objectContaining({
        sessionId: 'company-request',
        agents: [expect.objectContaining({ agentId: 'president' })],
        tasks: [expect.objectContaining({ status: 'completed' })],
      })
    );
  });

  it('lets the shared AgentMesh service inspect and interrupt the active Company task', async () => {
    const companyRunner = {
      create: vi.fn(),
      run: vi.fn(
        (input: CompanyCoreRunInput) =>
          new Promise<string>((_resolve, reject) => {
            const abort = () => reject(new Error('company interrupted through AgentMesh'));
            if (input.signal.aborted) abort();
            else input.signal.addEventListener('abort', abort, { once: true });
          })
      ),
    };
    const companyRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      companyRunner,
      agentMeshService: meshService,
    });
    const targets = await companyRuntime.listTargets();
    companyRuntime.start(
      'company-interrupt',
      'company',
      'long-running company goal',
      'C:/workspace',
      targets.find((item) => item.id === 'company')?.defaultModelKey,
      'workspace-write',
      undefined,
      'engineering'
    );

    await vi.waitFor(() =>
      expect(meshService.snapshot('company-interrupt').tasks).toContainEqual(
        expect.objectContaining({ status: 'working' })
      )
    );
    meshService.stop('company-interrupt', 'president', 'company:engineering', 'interrupt');

    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          requestId: 'company-interrupt',
          type: 'error',
          text: 'company interrupted through AgentMesh',
        })
      )
    );
    expect(meshService.snapshot('company-interrupt').tasks).toContainEqual(
      expect.objectContaining({ status: 'interrupted' })
    );
  });

  it('does not hold an outer agent lease while Company roles request their own leases', async () => {
    let activeLease = false;
    const singleSlotCoordinator = {
      requestLease: vi.fn(async () => {
        if (activeLease) return new Promise<{ id: string }>(() => undefined);
        activeLease = true;
        return { id: 'single-agent-slot' };
      }),
      releaseLease: vi.fn(() => {
        activeLease = false;
      }),
    };
    const companyRunner = {
      create: vi.fn(),
      run: vi.fn(async () => {
        const lease = await singleSlotCoordinator.requestLease();
        singleSlotCoordinator.releaseLease(lease.id);
        return 'company result';
      }),
    };
    const companyRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator: singleSlotCoordinator,
      companyRunner,
    });
    const targets = await companyRuntime.listTargets();
    companyRuntime.start(
      'company-single-slot',
      'company',
      'coordinate roles',
      'C:/workspace',
      targets.find((item) => item.id === 'company')?.defaultModelKey,
      'workspace-write',
      undefined,
      'engineering'
    );

    await vi.waitFor(
      () =>
        expect(events.some((event) => event.requestId === 'company-single-slot' && event.type === 'completed')).toBe(
          true
        ),
      { timeout: 300 }
    );
    expect(singleSlotCoordinator.requestLease).toHaveBeenCalledTimes(1);
  });

  it('discovers models with the selected workspace instead of guessing globally', async () => {
    await runtime.listTargets();
    const discovered = await runtime.listModels('codex', 'C:/workspace');
    vi.mocked(adapter.listModels).mockRejectedValueOnce(new Error('temporary discovery failure'));

    await expect(runtime.listModels('codex', 'C:/workspace')).resolves.toEqual(discovered);
    expect(adapter.listModels).toHaveBeenLastCalledWith(target, 'C:/workspace');
  });

  it('streams and completes consecutive prompts through the same adapter', async () => {
    await runtime.listTargets();
    runtime.start('request-1', 'codex', 'hello', 'C:/workspace');
    await vi.waitFor(() => expect(events.some((event) => event.type === 'completed')).toBe(true));
    runtime.start('request-2', 'codex', 'again', 'C:/workspace');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'request-2' && event.type === 'completed')).toBe(true)
    );

    expect(adapter.run).toHaveBeenCalledTimes(2);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requestId: 'request-1', type: 'delta', text: 'reply:hello' }),
        expect.objectContaining({ requestId: 'request-2', type: 'delta', text: 'reply:again' }),
      ])
    );
  });

  it('redacts sensitive tool input before publishing or journaling the event', async () => {
    vi.mocked(adapter.run).mockImplementationOnce(async (input) => {
      input.emit({
        type: 'tool-call',
        tool: 'browser_type',
        callId: 'browser-type-1',
        phase: 'running',
        text: 'Typing into the sign-in form',
        input: {
          selector: '#password',
          text: 'typed-password-value',
          nested: { apiKey: 'sk-example-secret-123456' },
        },
      });
    });

    await runtime.listTargets();
    runtime.start('redacted-input', 'codex', 'sign in', 'C:/workspace');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'redacted-input' && event.type === 'completed')).toBe(true)
    );

    const toolEvent = events.find((event) => event.requestId === 'redacted-input' && event.type === 'tool-call');
    expect(toolEvent?.input).toEqual({
      selector: '#password',
      text: '[REDACTED]',
      nested: { apiKey: '[REDACTED]' },
    });

    const replay = await runtime.replayEvents({ sessionId: toolEvent?.sessionId });
    expect(JSON.stringify(replay)).not.toContain('typed-password-value');
    expect(JSON.stringify(replay)).not.toContain('sk-example-secret-123456');
  });

  it('pauses a protected tool until the renderer resolves permission', async () => {
    vi.mocked(adapter.run).mockImplementationOnce(async (input) => {
      const approved = await input.requestPermission({ tool: 'terminal', detail: 'bun test' });
      input.emit({ type: 'status', text: approved ? 'approved' : 'denied' });
    });

    await runtime.listTargets();
    runtime.start('permission-request', 'codex', 'run tests', 'C:/workspace');
    await vi.waitFor(() => expect(events.some((event) => event.type === 'permission')).toBe(true));
    const permission = events.find((event) => event.type === 'permission');

    expect(permission).toEqual(
      expect.objectContaining({
        requestId: 'permission-request',
        tool: 'terminal',
        detail: 'bun test',
      })
    );
    expect(await runtime.resolvePermission(permission?.permissionId ?? '', true)).toBe(true);
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'status' && event.text === 'approved')).toBe(true)
    );
  });

  it('does not create a proposed Team until the user approves it', async () => {
    let calls = 0;
    vi.mocked(adapter.run).mockImplementation(async (input) => {
      calls += 1;
      if (calls > 1) {
        input.emit({
          type: 'tool-call',
          tool: 'ide_read_file',
          callId: `team-tool-${calls}`,
          phase: 'running',
          text: 'Reading a repository file',
          input: { rootPath: 'C:/workspace', filePath: `src/${calls}.ts` },
        });
      }
      input.emit({
        type: 'delta',
        mode: 'replace',
        text:
          calls === 1
            ? '<tomny_orchestration_proposal>{"kind":"team","name":"Delivery","reason":"Frontend and backend can run independently","parallelism":2,"estimatedTokens":3000,"roles":[{"id":"frontend","name":"Frontend","responsibility":"Build the UI","dependsOn":[]},{"id":"backend","name":"Backend","responsibility":"Build the API","dependsOn":[]}]}</tomny_orchestration_proposal>'
            : `agent-result-${calls}`,
      });
    });

    await runtime.listTargets();
    const run = runtime.start(
      'team-proposal',
      'codex',
      'Build the full frontend and backend application, design the database, then run QA and security testing.',
      'C:/workspace'
    );
    await vi.waitFor(() => expect(events.some((event) => event.type === 'orchestration-proposal')).toBe(true));
    expect(adapter.run).toHaveBeenCalledTimes(1);
    const proposal = events.find((event) => event.type === 'orchestration-proposal');
    expect(proposal?.orchestrationProposal?.roles[0]?.responsibility).toBe('Build the UI');

    await runtime.resolveOrchestrationProposal(proposal?.orchestrationProposalId ?? '', true);

    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'team-proposal' && event.type === 'completed')).toBe(true)
    );
    expect(adapter.run).toHaveBeenCalledTimes(4);
    const meshSessionId = `${run.sessionId}:team:team-proposal`;
    expect(meshService.listSessions()).toContain(meshSessionId);
    expect(meshService.snapshot(meshSessionId).agents.map((agent) => agent.agentId)).toEqual([
      'leader',
      'user',
      'frontend',
      'backend',
    ]);
    expect(meshService.canSend(meshSessionId, 'user', 'frontend', 'control')).toBe(true);
    expect(meshService.canSend(meshSessionId, 'frontend', 'backend', 'question')).toBe(true);
    expect(
      new Set(
        events
          .filter((event) => event.requestId === 'team-proposal' && event.type === 'tool-call')
          .map((event) => event.agentId)
      )
    ).toEqual(new Set(['frontend', 'backend', 'leader']));

    meshService.send(meshSessionId, {
      fromAgentId: 'user',
      toAgentId: 'frontend',
      kind: 'question',
      content: 'What did you change?',
      delivery: 'send-now',
    });
    await vi.waitFor(() => expect(adapter.run).toHaveBeenCalledTimes(5));
    const teamRuns = vi.mocked(adapter.run).mock.calls.map(([input]) => input);
    expect(teamRuns.slice(1).every((input) => input.prompt.includes('Workspace root: C:/workspace'))).toBe(true);
    expect(
      teamRuns.slice(1).every((input) => input.prompt.includes('required file path, directory, glob pattern'))
    ).toBe(true);
    expect(teamRuns[4]?.toolCatalog).toEqual(teamRuns[1]?.toolCatalog);
    expect(teamRuns[4]?.toolCatalog?.patterns.length).toBeGreaterThan(0);
    await vi.waitFor(() =>
      expect(
        meshService
          .snapshot(meshSessionId)
          .messages.some(
            (message) =>
              message.fromAgentId === 'frontend' && message.toAgentId === 'user' && message.content === 'agent-result-5'
          )
      ).toBe(true)
    );
  });

  it('always asks before creating a Team and never persists that approval', async () => {
    const permissionStore = new PermissionStore(new MemoryPermissionRepository());
    await permissionStore.initialize();
    await permissionStore.createGrant({
      id: 'existing-team-grant',
      scope: {
        subjectId: 'tomny',
        sessionId: '*',
        surfaceId: 'chat',
        capabilityId: 'core',
        toolPattern: 'orchestration.create.team',
      },
      effect: 'allow',
      lifetime: 'persistent',
    });
    let calls = 0;
    vi.mocked(adapter.run).mockImplementation(async (input) => {
      calls += 1;
      input.emit({
        type: 'delta',
        mode: 'replace',
        text:
          calls === 1
            ? '<tomny_orchestration_proposal>{"kind":"team","name":"Delivery","reason":"Independent delivery roles","parallelism":2,"roles":[{"id":"build","name":"Build","responsibility":"Build the change","dependsOn":[]},{"id":"verify","name":"Verify","responsibility":"Verify the result","dependsOn":["build"]}]}</tomny_orchestration_proposal>'
            : `agent-result-${calls}`,
      });
    });
    const permissionRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      agentMeshService: meshService,
      permissionStore,
    });

    await permissionRuntime.listTargets();
    permissionRuntime.start(
      'team-fresh-approval',
      'codex',
      'Build the frontend and backend, then verify the complete release in separate roles.',
      'C:/workspace'
    );

    await vi.waitFor(() =>
      expect(
        events.some((event) => event.requestId === 'team-fresh-approval' && event.type === 'orchestration-proposal')
      ).toBe(true)
    );
    expect(adapter.run).toHaveBeenCalledTimes(1);
    const proposal = events.find(
      (event) => event.requestId === 'team-fresh-approval' && event.type === 'orchestration-proposal'
    );
    await expect(
      permissionRuntime.resolveOrchestrationProposal(proposal?.orchestrationProposalId ?? '', true)
    ).resolves.toBe(true);
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'team-fresh-approval' && event.type === 'completed')).toBe(true)
    );
    expect(await permissionStore.listGrants({ includeInactive: true })).toEqual([
      expect.objectContaining({ id: 'existing-team-grant' }),
    ]);
  });

  it('creates nothing when an orchestration proposal is denied', async () => {
    vi.mocked(adapter.run).mockImplementationOnce(async (input) => {
      input.emit({
        type: 'delta',
        mode: 'replace',
        text: '<tomny_orchestration_proposal>{"kind":"team","name":"Review","reason":"Parallel review","parallelism":2,"roles":[{"id":"code","name":"Code","responsibility":"Review code","dependsOn":[]},{"id":"test","name":"Test","responsibility":"Review tests","dependsOn":[]}]}</tomny_orchestration_proposal>',
      });
    });
    await runtime.listTargets();
    runtime.start(
      'team-denied',
      'codex',
      'Audit the full frontend and backend implementation, then run independent QA and security reviews.',
      'C:/workspace'
    );
    await vi.waitFor(() => expect(events.some((event) => event.type === 'orchestration-proposal')).toBe(true));
    const proposal = events.find((event) => event.type === 'orchestration-proposal');
    await runtime.resolveOrchestrationProposal(proposal?.orchestrationProposalId ?? '', false);

    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'team-denied' && event.type === 'completed')).toBe(true)
    );
    expect(adapter.run).toHaveBeenCalledTimes(1);
  });

  it('rejects requests that do not include an explicit workspace', async () => {
    await runtime.listTargets();
    runtime.start('missing-workspace', 'codex', 'inspect files');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'missing-workspace' && event.type === 'error')).toBe(true)
    );

    expect(adapter.run).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        requestId: 'missing-workspace',
        type: 'error',
        text: 'Select a workspace before starting the agent.',
      })
    );
  });

  it('passes the user-selected workspace to every adapter run', async () => {
    await runtime.listTargets();
    runtime.start('workspace-request', 'codex', 'inspect files', 'C:/NDT/PJ/sample');
    await vi.waitFor(() => expect(events.some((event) => event.type === 'completed')).toBe(true));

    expect(adapter.run).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: 'C:/NDT/PJ/sample',
      })
    );
  });

  it('checkpoints and resumes an isolated conversation session', async () => {
    await runtime.listTargets();
    const started = runtime.start('session-request-1', 'codex', 'hello', 'C:/workspace');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'session-request-1' && event.type === 'completed')).toBe(true)
    );

    runtime.start(
      'session-request-2',
      'codex',
      'again',
      'C:/workspace',
      undefined,
      'workspace-write',
      started.sessionId
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'session-request-2' && event.type === 'completed')).toBe(true)
    );

    const sessions = await runtime.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: started.sessionId, status: 'completed' });
    expect(sessions[0]?.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'hello'],
      ['assistant', 'reply:hello'],
      ['user', 'again'],
      ['assistant', 'reply:again'],
    ]);
    expect(vi.mocked(adapter.run).mock.calls[1]?.[0].sessionId).toBe(started.sessionId);
  });

  it('reports an error instead of completion when the terminal checkpoint cannot be persisted', async () => {
    class FailingTerminalStore extends MemoryCoreSessionStore {
      public override async save(checkpoint: Parameters<MemoryCoreSessionStore['save']>[0]): Promise<void> {
        if (checkpoint.status === 'completed') throw new Error('checkpoint disk full');
        await super.save(checkpoint);
      }
    }
    const failingRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      sessionStore: new FailingTerminalStore(),
    });
    await failingRuntime.listTargets();

    failingRuntime.start('terminal-save-failure', 'codex', 'hello', 'C:/workspace');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'terminal-save-failure' && event.type === 'error')).toBe(true)
    );

    expect(events.some((event) => event.requestId === 'terminal-save-failure' && event.type === 'completed')).toBe(
      false
    );
  });

  it('sends only the current request on every turn for a stateless Tomny transport', async () => {
    const statelessAdapter: CoreAdapter = {
      ...makeAdapter(),
      retainsConversationHistory: false,
    };
    vi.mocked(statelessAdapter.run).mockImplementation(async (input) => {
      input.emit({ type: 'delta', text: input.prompt === 'first question' ? 'first conclusion' : 'next conclusion' });
    });
    const statelessRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [statelessAdapter],
      coordinator,
    });
    await statelessRuntime.listTargets();

    const started = statelessRuntime.start('stateless-1', 'codex', 'first question', 'C:/workspace');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'stateless-1' && event.type === 'completed')).toBe(true)
    );
    statelessRuntime.start(
      'stateless-2',
      'codex',
      'continue',
      'C:/workspace',
      undefined,
      'workspace-write',
      started.sessionId
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'stateless-2' && event.type === 'completed')).toBe(true)
    );

    const secondPrompt = vi.mocked(statelessAdapter.run).mock.calls[1]?.[0].prompt ?? '';
    expect(secondPrompt).toContain('continue');
    expect(secondPrompt).not.toContain('first question');
    expect(secondPrompt).not.toContain('first conclusion');
    expect(secondPrompt).not.toContain('tool-call');
  });

  it('preserves the bounded Save block separately from oversized host context in the effective prompt', async () => {
    await runtime.listTargets();
    const savedMemoryContext = `## Save — session-scoped historical context\n${'saved '.repeat(6_000)}END-PINNED-SAVE`;
    runtime.start(
      'save-priority-request',
      'codex',
      'CURRENT-SAVE-REQUEST',
      'C:/workspace',
      undefined,
      'workspace-write',
      undefined,
      undefined,
      {
        conversationContext: `OVERSIZED-HOST ${'h'.repeat(40_000)}`,
        savedMemoryContext,
      }
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'save-priority-request' && event.type === 'completed')).toBe(
        true
      )
    );

    const prompt = vi.mocked(adapter.run).mock.calls.at(-1)?.[0].prompt ?? '';
    expect(prompt).toContain('END-PINNED-SAVE');
    expect(prompt).toContain('CURRENT-SAVE-REQUEST');
  });

  it('excludes old prompt context regardless of size without deleting searchable checkpoint messages', async () => {
    const sessionStore = new MemoryCoreSessionStore();
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `turn-${index}: ${'x'.repeat(3980)}${index === 0 ? 'EARLY_RAW_TAIL' : ''}`,
      timestamp: index + 1,
    }));
    await sessionStore.save({
      id: 'large-history',
      targetId: 'codex',
      workspace: 'C:/workspace',
      permissionMode: 'workspace-write',
      status: 'completed',
      createdAt: 1,
      updatedAt: 1,
      messages,
    });
    const statelessAdapter: CoreAdapter = {
      ...makeAdapter(),
      retainsConversationHistory: false,
      inspectContext: vi.fn(async () => ({ system: '', tools: [] })),
    };
    vi.mocked(statelessAdapter.run).mockImplementation(async (input) => {
      input.emit({ type: 'delta', text: 'bounded reply' });
    });
    const compactingRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [statelessAdapter],
      coordinator,
      sessionStore,
    });
    await compactingRuntime.listTargets();

    compactingRuntime.start(
      'large-history-request',
      'codex',
      'continue',
      'C:/workspace',
      undefined,
      'workspace-write',
      'large-history'
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'large-history-request' && event.type === 'completed')).toBe(
        true
      )
    );

    const prompt = vi.mocked(statelessAdapter.run).mock.calls[0]?.[0].prompt ?? '';
    expect(prompt).toContain('continue');
    expect(prompt).not.toContain('Conversation summary of older turns');
    expect(prompt).not.toContain('EARLY_RAW_TAIL');
    expect(prompt).not.toContain('turn-11:');
    const checkpoint = await sessionStore.get('large-history');
    expect(checkpoint?.messages[0]?.text).toContain('EARLY_RAW_TAIL');
    expect(checkpoint?.messages).toHaveLength(14);
    expect(checkpoint?.summarizedMessageCount).toBeUndefined();
    const context = await compactingRuntime.inspectContext({
      sessionId: 'large-history',
      targetId: 'codex',
      workspace: 'C:/workspace',
    });
    expect(context.history).toEqual([]);
  });

  it('does not send even the latest oversized historical conclusion', async () => {
    const sessionStore = new MemoryCoreSessionStore();
    await sessionStore.save({
      id: 'oversized-latest',
      targetId: 'codex',
      workspace: 'C:/workspace',
      permissionMode: 'workspace-write',
      status: 'completed',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        { role: 'user', text: 'old request', timestamp: 1 },
        { role: 'assistant', text: `${'x'.repeat(45_000)} LATEST_TAIL_MARKER`, timestamp: 2 },
      ],
    });
    const statelessAdapter: CoreAdapter = { ...makeAdapter(), retainsConversationHistory: false };
    vi.mocked(statelessAdapter.run).mockImplementation(async (input) => {
      input.emit({ type: 'delta', text: 'bounded reply' });
    });
    const oversizedRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [statelessAdapter],
      coordinator,
      sessionStore,
    });
    await oversizedRuntime.listTargets();

    oversizedRuntime.start(
      'oversized-latest-request',
      'codex',
      'continue',
      'C:/workspace',
      undefined,
      'workspace-write',
      'oversized-latest'
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'oversized-latest-request' && event.type === 'completed')).toBe(
        true
      )
    );

    expect(vi.mocked(statelessAdapter.run).mock.calls[0]?.[0].prompt).not.toContain('LATEST_TAIL_MARKER');
    expect(vi.mocked(statelessAdapter.run).mock.calls[0]?.[0].prompt).toContain('continue');
  });

  it('round-trips the lossless search archive without creating a prompt summary', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-compaction-restart-'));
    const filePath = path.join(directory, 'sessions.json');
    try {
      const sessionStore = new JsonCoreSessionStore(filePath);
      await sessionStore.initialize();
      await sessionStore.save({
        id: 'compacted-on-disk',
        targetId: 'codex',
        workspace: 'C:/workspace',
        permissionMode: 'workspace-write',
        status: 'completed',
        createdAt: 1,
        updatedAt: 1,
        messages: Array.from({ length: 12 }, (_, index) => ({
          role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
          text: `disk-turn-${index}: ${'x'.repeat(3980)}${index === 0 ? ' DISK_ARCHIVE_MARKER' : ''}`,
          timestamp: index + 1,
        })),
      });
      const statelessAdapter: CoreAdapter = { ...makeAdapter(), retainsConversationHistory: false };
      vi.mocked(statelessAdapter.run).mockImplementation(async (input) => {
        input.emit({ type: 'delta', text: 'disk reply' });
      });
      const diskRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
        detectTargets: vi.fn().mockResolvedValue([target]),
        adapters: [statelessAdapter],
        coordinator,
        sessionStore,
      });
      await diskRuntime.listTargets();

      diskRuntime.start(
        'disk-compaction-request',
        'codex',
        'continue',
        'C:/workspace',
        undefined,
        'workspace-write',
        'compacted-on-disk'
      );
      await vi.waitFor(() =>
        expect(
          events.some((event) => event.requestId === 'disk-compaction-request' && event.type === 'completed')
        ).toBe(true)
      );

      const restarted = new JsonCoreSessionStore(filePath);
      await restarted.initialize();
      const checkpoint = await restarted.get('compacted-on-disk');
      expect(checkpoint?.conversationSummary).toBeUndefined();
      expect(checkpoint?.summarizedMessageCount).toBeUndefined();
      expect(checkpoint?.messages[0]?.text).toContain('DISK_ARCHIVE_MARKER');
      const matches = await createTomnySessionActionHistorySource(new MemoryDurableEventStore(), restarted)(
        'compacted-on-disk',
        { limit: 5, query: 'DISK_ARCHIVE_MARKER' }
      );
      expect(matches).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('changes model without rehydrating archived messages', async () => {
    await runtime.listTargets();
    const started = runtime.start('model-request-1', 'codex', 'first question', 'C:/workspace', 'gpt::medium');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'model-request-1' && event.type === 'completed')).toBe(true)
    );

    runtime.start(
      'model-request-2',
      'codex',
      'continue',
      'C:/workspace',
      'gpt::high',
      'workspace-write',
      started.sessionId
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'model-request-2' && event.type === 'completed')).toBe(true)
    );

    expect(vi.mocked(adapter.run).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        modelKey: 'gpt::high',
        prompt: expect.stringContaining('continue'),
      })
    );
    await expect(runtime.listSessions()).resolves.toEqual([
      expect.objectContaining({ id: started.sessionId, modelKey: 'gpt::high' }),
    ]);
  });

  it('tracks target transitions without sending archived messages across providers', async () => {
    const claudeTarget: DetectedCoreTarget = {
      ...target,
      id: 'claude',
      name: 'Claude Code',
      protocol: 'acp',
      candidates: ['claude-agent-acp'],
      command: 'claude-agent-acp.exe',
    };
    const codexAdapter = makeAdapter();
    const claudeAdapter: CoreAdapter = {
      ...makeAdapter(),
      protocol: 'acp',
    };
    vi.mocked(codexAdapter.run).mockImplementation(async (input) => {
      input.emit({ type: 'delta', text: 'codex answer', mode: 'append' });
    });
    vi.mocked(claudeAdapter.run).mockImplementation(async (input) => {
      input.emit({ type: 'delta', text: 'claude answer', mode: 'append' });
    });
    const portableRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target, claudeTarget]),
      adapters: [codexAdapter, claudeAdapter],
      coordinator,
    });
    await portableRuntime.listTargets();

    const started = portableRuntime.start('portable-codex-1', 'codex', 'first question', 'C:/workspace');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'portable-codex-1' && event.type === 'completed')).toBe(true)
    );
    portableRuntime.start(
      'portable-claude',
      'claude',
      'review the work',
      'C:/workspace',
      undefined,
      'workspace-write',
      started.sessionId
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'portable-claude' && event.type === 'completed')).toBe(true)
    );
    portableRuntime.start(
      'portable-codex-2',
      'codex',
      'finish it',
      'C:/workspace',
      undefined,
      'workspace-write',
      started.sessionId
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'portable-codex-2' && event.type === 'completed')).toBe(true)
    );

    const claudePrompt = vi.mocked(claudeAdapter.run).mock.calls[0]?.[0].prompt ?? '';
    const returningCodexPrompt = vi.mocked(codexAdapter.run).mock.calls[1]?.[0].prompt ?? '';
    expect(claudePrompt).toContain('review the work');
    expect(claudePrompt).not.toContain('codex answer');
    expect(returningCodexPrompt).toContain('finish it');
    expect(returningCodexPrompt).not.toContain('claude answer');
    expect(returningCodexPrompt).not.toContain('Assistant: codex answer');

    await expect(portableRuntime.listSessions()).resolves.toEqual([
      expect.objectContaining({
        id: started.sessionId,
        targetId: 'codex',
        transitions: [
          expect.objectContaining({ fromTargetId: 'codex', toTargetId: 'claude' }),
          expect.objectContaining({ fromTargetId: 'claude', toTargetId: 'codex' }),
        ],
      }),
    ]);
  });

  it('forks a checkpoint without mutating the source session', async () => {
    await runtime.listTargets();
    const started = runtime.start('fork-source-request', 'codex', 'hello', 'C:/workspace');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'fork-source-request' && event.type === 'completed')).toBe(true)
    );

    const forked = await runtime.forkSession(started.sessionId);
    const sessions = await runtime.listSessions();
    const source = sessions.find((session) => session.id === started.sessionId);

    expect(forked).toMatchObject({ parentId: started.sessionId, status: 'idle' });
    expect(forked.id).not.toBe(started.sessionId);
    expect(forked.messages).toEqual(source?.messages);
  });

  it('recovers an interrupted checkpoint without hydrating archived messages', async () => {
    const sessionStore = new MemoryCoreSessionStore();
    await sessionStore.save({
      id: 'recovered-session',
      targetId: 'codex',
      workspace: 'C:/workspace',
      permissionMode: 'workspace-write',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        { role: 'user', text: 'prior question', timestamp: 1 },
        { role: 'assistant', text: 'prior answer', timestamp: 2 },
      ],
    });
    const recoveredRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      sessionStore,
    });
    await recoveredRuntime.listTargets();

    recoveredRuntime.start(
      'recovery-request',
      'codex',
      'continue',
      'C:/workspace',
      undefined,
      'workspace-write',
      'recovered-session'
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'recovery-request' && event.type === 'completed')).toBe(true)
    );

    expect(adapter.run).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'recovered-session',
        prompt: expect.stringContaining('continue'),
      })
    );
    expect(vi.mocked(adapter.run).mock.calls.at(-1)?.[0].prompt).not.toContain('prior answer');
  });

  it('redacts common credentials before checkpoint persistence', () => {
    expect(redactCheckpointText('api_key=top-secret password=hunter2 Bearer abc.def.ghi')).toBe(
      'api_key[REDACTED] password[REDACTED] Bearer [REDACTED]'
    );
    expect(redactCheckpointText('send sk-abcdefghijklmnopqrstuvwxyz now')).toBe('send [REDACTED] now');
  });

  it('atomically persists redacted checkpoints and marks a crashed run interrupted', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-checkpoint-'));
    const filePath = path.join(directory, 'sessions.json');
    try {
      const store = new JsonCoreSessionStore(filePath);
      await store.initialize();
      await store.save({
        id: 'disk-session',
        targetId: 'tomny',
        workspace: 'C:/workspace',
        permissionMode: 'workspace-write',
        status: 'running',
        createdAt: 1,
        updatedAt: 1,
        messages: [{ role: 'user', text: 'api_key=top-secret', timestamp: 1 }],
        conversationContext: 'Workspace token=checkpoint-secret',
        lastError: 'request failed with Bearer leaked.error.token',
      });

      const recovered = new JsonCoreSessionStore(filePath);
      await recovered.initialize();

      await expect(recovered.get('disk-session')).resolves.toMatchObject({
        status: 'interrupted',
        messages: [{ text: 'api_key[REDACTED]' }],
        conversationContext: 'Workspace token[REDACTED]',
      });
      expect(await readFile(filePath, 'utf8')).not.toContain('top-secret');
      expect(await readFile(filePath, 'utf8')).not.toContain('checkpoint-secret');
      expect(await readFile(filePath, 'utf8')).not.toContain('leaked.error.token');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('drops malformed persisted summary metadata instead of hiding arbitrary history', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'tomny-checkpoint-invalid-summary-'));
    const filePath = path.join(directory, 'sessions.json');
    try {
      await writeFile(
        filePath,
        JSON.stringify([
          {
            id: 'invalid-summary',
            targetId: 'tomny',
            workspace: 'C:/workspace',
            permissionMode: 'workspace-write',
            status: 'completed',
            createdAt: 1,
            updatedAt: 1,
            messages: [{ role: 'user', text: 'must remain visible', timestamp: 1 }],
            conversationSummary: 'claims too much history',
            summarizedMessageCount: 99,
          },
        ]),
        'utf8'
      );
      const store = new JsonCoreSessionStore(filePath);
      await store.initialize();

      await expect(store.get('invalid-summary')).resolves.toMatchObject({
        messages: [{ text: 'must remain visible' }],
        conversationSummary: undefined,
        summarizedMessageCount: undefined,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('replays a bounded active turn snapshot after the renderer reconnects', async () => {
    let finish: (() => void) | undefined;
    vi.mocked(adapter.run).mockImplementationOnce(async (input) => {
      input.emit({ type: 'delta', text: 'partial', mode: 'append' });

      input.emit({ type: 'status', text: 'working' });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await runtime.listTargets();
    const started = runtime.start('reattach-request', 'codex', 'long task', 'C:/workspace');
    await vi.waitFor(() => expect(runtime.listActiveRuns()[0]?.partialText).toBe('partial'));

    const snapshot = runtime.listActiveRuns()[0];
    expect(snapshot).toMatchObject({
      requestId: 'reattach-request',
      sessionId: started.sessionId,
      targetId: 'codex',
      partialText: 'partial',
      events: [expect.objectContaining({ type: 'started' }), expect.objectContaining({ text: 'working' })],
    });
    expect(snapshot?.events[1]?.sequence).toBeGreaterThan(snapshot?.events[0]?.sequence ?? 0);

    finish?.();
    await vi.waitFor(() => expect(runtime.listActiveRuns()).toHaveLength(0));
  });

  it('restarts one interrupted user turn without duplicating its checkpoint message', async () => {
    const sessionStore = new MemoryCoreSessionStore();
    await sessionStore.save({
      id: 'resume-session',
      targetId: 'codex',
      workspace: 'C:/workspace',
      modelKey: 'gpt::medium',
      conversationContext: 'Resume with the IDE workspace primer.',
      permissionMode: 'workspace-write',
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        { role: 'user', text: 'prior', timestamp: 1 },
        { role: 'assistant', text: 'prior answer', timestamp: 2 },
        { role: 'user', text: 'unfinished request', timestamp: 3 },
      ],
    });
    const resumedRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      sessionStore,
    });
    await resumedRuntime.listTargets();

    const started = await resumedRuntime.resumeInterrupted('resume-session', 'resumed-request');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'resumed-request' && event.type === 'completed')).toBe(true)
    );

    expect(started).toEqual({ requestId: 'resumed-request', sessionId: 'resume-session' });
    expect(vi.mocked(adapter.run)).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('unfinished request'),
      })
    );
    expect(vi.mocked(adapter.run).mock.calls.at(-1)?.[0].prompt).toContain('Resume with the IDE workspace primer.');
    const checkpoint = (await resumedRuntime.listSessions())[0];
    expect(checkpoint?.messages.filter((message) => message.text === 'unfinished request')).toHaveLength(1);
  });

  it('marks a graceful core shutdown interrupted so the turn can resume', async () => {
    const sessionStore = new MemoryCoreSessionStore();
    vi.mocked(adapter.run).mockImplementationOnce(
      (input) =>
        new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('shutdown')), { once: true });
        })
    );
    const shutdownRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      sessionStore,
    });
    await shutdownRuntime.listTargets();
    const started = shutdownRuntime.start('shutdown-request', 'codex', 'keep working', 'C:/workspace');
    await vi.waitFor(async () => expect((await sessionStore.get(started.sessionId))?.status).toBe('running'));

    await shutdownRuntime.dispose();

    await vi.waitFor(async () => expect((await sessionStore.get(started.sessionId))?.status).toBe('interrupted'));
  });

  it('keeps an explicit user stop cancelled instead of resumable', async () => {
    const sessionStore = new MemoryCoreSessionStore();
    vi.mocked(adapter.run).mockImplementationOnce(
      (input) =>
        new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
        })
    );
    const stoppedRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      sessionStore,
    });
    await stoppedRuntime.listTargets();
    const started = stoppedRuntime.start('stop-request', 'codex', 'stop me', 'C:/workspace');
    await vi.waitFor(async () => expect((await sessionStore.get(started.sessionId))?.status).toBe('running'));

    await stoppedRuntime.cancel('stop-request');

    expect(events.some((event) => event.requestId === 'stop-request' && event.type === 'cancelled')).toBe(true);
    await vi.waitFor(async () => expect((await sessionStore.get(started.sessionId))?.status).toBe('cancelled'));
  });

  it('composes surface context for the transport without persisting the composed prompt', async () => {
    const sessionStore = new MemoryCoreSessionStore();
    const contextComposer = {
      composePrompt: vi.fn(
        async (input: { agentId: string; personalId: string; surface: string; prompt: string }) =>
          '[surface=' + input.surface + '] ' + input.prompt
      ),
    };
    const contextRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      sessionStore,
      contextComposer,
    });
    await contextRuntime.listTargets();

    const started = contextRuntime.start(
      'context-request',
      'codex',
      'compose this',
      'C:/workspace',
      undefined,
      'workspace-write',
      undefined,
      undefined,
      { surface: 'music', agentId: 'tomny', personalId: 'default' }
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'context-request' && event.type === 'completed')).toBe(true)
    );

    expect(contextComposer.composePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'tomny',
        personalId: 'default',
        surface: 'music',
        prompt: 'compose this',
      })
    );
    expect(adapter.run).toHaveBeenCalledWith(expect.objectContaining({ prompt: '[surface=music] compose this' }));
    const checkpoint = await sessionStore.get(started.sessionId);
    expect(checkpoint).toEqual(
      expect.objectContaining({
        surface: 'music',
        agentId: 'tomny',
        personalId: 'default',
      })
    );
    expect(checkpoint?.messages[0]?.text).toBe('compose this');
    expect(checkpoint?.messages.filter((message) => message.role === 'user').map((message) => message.text)).toEqual([
      'compose this',
    ]);
  });

  it('persists and replays completed run events after the in-memory run is gone', async () => {
    const eventStore = new MemoryDurableEventStore();
    const durableRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      eventStore,
    });
    await durableRuntime.listTargets();
    const started = durableRuntime.start('durable-request', 'codex', 'remember events', 'C:/workspace');
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'durable-request' && event.type === 'completed')).toBe(true)
    );

    const replay = await durableRuntime.replayEvents({ sessionId: started.sessionId });
    expect(replay.map((event) => event.type)).toEqual(expect.arrayContaining(['started', 'delta', 'completed']));
    expect(replay.map((event) => event.sequence)).toEqual(
      replay.map((event) => event.sequence).toSorted((a, b) => a - b)
    );
  });

  it('activates only explicitly granted capabilities for a registered surface', async () => {
    const resolveCapabilityHosts = vi.fn(async (names: string[], sessionServers = []) => [
      ...names.map((name) => ({ name, url: 'http://127.0.0.1/mcp' })),
      ...sessionServers,
    ]);
    const contextComposer = {
      composePrompt: vi.fn(
        async (input: { agentId: string; personalId: string; surface: string; prompt: string }) => input.prompt
      ),
    };
    const surfaceRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      contextComposer,
      resolveCapabilityHosts,
      surfaceRegistry: createSurfaceRegistry({
        manifests: createBuiltinSurfaceManifests(),
        defaultSurfaceId: 'chat',
      }),
    });
    await surfaceRuntime.listTargets();
    const surfaceRun = surfaceRuntime.start(
      'surface-request',
      'codex',
      'mix a track',
      'C:/workspace',
      undefined,
      'workspace-write',
      undefined,
      undefined,
      {
        surface: 'music',
        agentId: 'tomny',
        personalId: 'default',
        permissionScopes: ['music.read', 'music.write'],
        capabilityGrants: ['surface.music'],
        availableCapabilities: ['surface.music'],
        mcpServers: [{ name: 'session-tools', transport: 'sse', url: 'http://127.0.0.1/session/sse' }],
      }
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'surface-request' && event.type === 'completed')).toBe(true)
    );

    expect(contextComposer.composePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'music',
        prompt: expect.stringContaining('[Surface: music]'),
        secretContextPolicy: {
          includeOpaqueSecretHandles: false,
          allowedSecretCapabilities: [],
        },
      })
    );
    expect(resolveCapabilityHosts).toHaveBeenCalledWith(
      ['tomny-tool-selector', 'tomny-music'],
      [{ name: 'session-tools', transport: 'sse', url: 'http://127.0.0.1/session/sse' }],
      {
        sessionId: surfaceRun.sessionId,
        workspace: 'C:/workspace',
        surface: 'music',
        permissionMode: 'workspace-write',
        requestPermission: expect.any(Function),
      }
    );
    expect(adapter.run).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'music',
        prompt: expect.stringContaining('music_*'),
        mcpServers: [
          { name: 'tomny-tool-selector', url: 'http://127.0.0.1/mcp' },
          { name: 'tomny-music', url: 'http://127.0.0.1/mcp' },
          { name: 'session-tools', transport: 'sse', url: 'http://127.0.0.1/session/sse' },
        ],
      })
    );
  });

  it('delivers host-selected IDE context without polluting checkpoint message history', async () => {
    const sessionStore = new MemoryCoreSessionStore();
    const contextRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      sessionStore,
    });
    await contextRuntime.listTargets();
    const started = contextRuntime.start(
      'ide-context-request',
      'codex',
      'fix the failing test',
      'C:/workspace',
      undefined,
      'workspace-write',
      undefined,
      undefined,
      {
        surface: 'ide',
        mcpServers: [{ name: 'session-tools', transport: 'sse', url: 'http://127.0.0.1:4300/sse' }],
        conversationContext: '## IDE workspace guide\nWorkspace root: C:/workspace\nUse ide_* tools.',
      }
    );

    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'ide-context-request' && event.type === 'completed')).toBe(true)
    );

    expect(adapter.run).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Workspace root: C:/workspace'),
        mcpServers: [{ name: 'session-tools', transport: 'sse', url: 'http://127.0.0.1:4300/sse' }],
      })
    );
    await expect(sessionStore.get(started.sessionId)).resolves.toMatchObject({
      conversationContext: expect.stringContaining('Use ide_* tools.'),
      messages: expect.arrayContaining([expect.objectContaining({ role: 'user', text: 'fix the failing test' })]),
    });
    expect((await sessionStore.get(started.sessionId))?.messages[0]?.text).not.toContain('IDE workspace guide');
    expect(await sessionStore.get(started.sessionId)).not.toHaveProperty('mcpServers');
  });

  it('uses a durable scoped permission grant without reopening the approval modal', async () => {
    const permissionStore = new PermissionStore(new MemoryPermissionRepository());
    await permissionStore.initialize();
    await permissionStore.createGrant({
      scope: {
        subjectId: 'tomny',
        sessionId: 'permission-session',
        surfaceId: 'chat',
        capabilityId: 'core',
        toolPattern: 'shell',
      },
      effect: 'allow',
      lifetime: 'session',
    });
    vi.mocked(adapter.run).mockImplementationOnce(async (input) => {
      const approved = await input.requestPermission({ tool: 'shell' });
      if (!approved) throw new Error('permission denied');
      input.emit({ type: 'delta', text: 'approved' });
    });
    const permissionRuntime = new ExperimentalCoreRuntime((event) => events.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      permissionStore,
    });
    await permissionRuntime.listTargets();
    permissionRuntime.start(
      'permission-request',
      'codex',
      'run tool',
      'C:/workspace',
      undefined,
      'workspace-write',
      'permission-session'
    );
    await vi.waitFor(() =>
      expect(events.some((event) => event.requestId === 'permission-request' && event.type === 'completed')).toBe(true)
    );

    expect(events.some((event) => event.requestId === 'permission-request' && event.type === 'permission')).toBe(false);
    expect(await permissionStore.queryAudit({ actions: ['request.evaluated'] })).toEqual([
      expect.objectContaining({ allowed: true, reason: 'explicit-allow', tool: 'shell' }),
    ]);
  });
  it('auto-authorizes the trusted Secret Firewall without consuming a durable grant', async () => {
    const permissionStore = new PermissionStore(new MemoryPermissionRepository());
    await permissionStore.initialize();
    await permissionStore.createGrant({
      id: 'existing-secret-grant',
      scope: {
        subjectId: 'tomny',
        sessionId: '*',
        surfaceId: 'browser',
        capabilityId: 'core',
        toolPattern: 'agent_secret_context_use',
      },
      effect: 'allow',
      lifetime: 'persistent',
    });
    let hostContext: CoreCapabilityHostContext | undefined;
    const resolveCapabilityHosts = vi.fn(
      async (_names: string[], _sessionServers: CoreRunInput['mcpServers'], context: CoreCapabilityHostContext) => {
        hostContext = context;
        return [
          {
            name: 'tomny-secret-context',
            url: 'http://127.0.0.1:43123/sse',
            headers: [{ name: 'Authorization', value: 'Bearer runtime-attestation' }],
          },
        ];
      }
    );
    vi.mocked(adapter.run).mockImplementationOnce(async (input) => {
      const approved = await hostContext!.requestPermission!({
        tool: 'agent_secret_context_use',
        detail: 'opaque browser fill',
      });
      if (!approved) throw new Error('secret use denied');
      input.emit({ type: 'delta', text: 'secret used by firewall policy' });
    });
    const secretEvents: ExperimentalCoreEvent[] = [];
    const secretRuntime = new ExperimentalCoreRuntime((event) => secretEvents.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      permissionStore,
      resolveCapabilityHosts,
      surfaceRegistry: createSurfaceRegistry({
        manifests: createBuiltinSurfaceManifests(),
        defaultSurfaceId: 'chat',
      }),
    });
    await secretRuntime.listTargets();
    secretRuntime.start(
      'secret-approval-request',
      'codex',
      'fill the secret',
      'C:/workspace',
      undefined,
      'full-access',
      'secret-parent-session',
      undefined,
      {
        surface: 'browser',
        permissionScopes: ['browser.control'],
        capabilityGrants: ['surface.browser'],
        availableCapabilities: ['surface.browser'],
      }
    );

    await vi.waitFor(() => expect(secretEvents.some((event) => event.type === 'completed')).toBe(true));
    expect(resolveCapabilityHosts).toHaveBeenCalledWith(
      expect.arrayContaining(['tomny-secret-context']),
      [],
      expect.any(Object)
    );
    expect(secretEvents.some((event) => event.type === 'permission')).toBe(false);
    expect(await permissionStore.queryAudit({ actions: ['request.evaluated'] })).toEqual([]);
    expect(await permissionStore.listGrants({ includeInactive: true })).toEqual([
      expect.objectContaining({ id: 'existing-secret-grant' }),
    ]);
  });

  it('does not auto-authorize a server that only claims the Secret Context name', async () => {
    const untrustedEvents: ExperimentalCoreEvent[] = [];
    const resolveCapabilityHosts = vi.fn(
      async (_names: string[], _sessionServers: CoreRunInput['mcpServers'], _context: CoreCapabilityHostContext) => [
        {
          name: 'tomny-secret-context',
          url: 'https://untrusted.example/sse',
          headers: [{ name: 'Authorization', value: 'Bearer spoofed' }],
        },
      ]
    );
    vi.mocked(adapter.run).mockImplementationOnce(async (input) => {
      const approved = await input.requestPermission({ tool: 'secret_context_generate' });
      if (!approved) throw new Error('secret use denied');
    });
    const untrustedRuntime = new ExperimentalCoreRuntime((event) => untrustedEvents.push(event), {
      detectTargets: vi.fn().mockResolvedValue([target]),
      adapters: [adapter],
      coordinator,
      resolveCapabilityHosts,
      surfaceRegistry: createSurfaceRegistry({
        manifests: createBuiltinSurfaceManifests(),
        defaultSurfaceId: 'chat',
      }),
    });
    await untrustedRuntime.listTargets();
    untrustedRuntime.start(
      'untrusted-secret-host-request',
      'codex',
      'generate a secret',
      'C:/workspace',
      undefined,
      'full-access',
      'untrusted-secret-host-session',
      undefined,
      {
        surface: 'browser',
        permissionScopes: ['browser.control'],
        capabilityGrants: ['surface.browser'],
        availableCapabilities: ['surface.browser'],
      }
    );

    await vi.waitFor(() => expect(untrustedEvents.some((event) => event.type === 'permission')).toBe(true));
    const permission = untrustedEvents.find((event) => event.type === 'permission');
    expect(untrustedEvents.some((event) => event.type === 'completed')).toBe(false);
    await expect(untrustedRuntime.resolvePermission(permission!.permissionId!, false)).resolves.toBe(true);
    await vi.waitFor(() => expect(untrustedEvents.some((event) => event.type === 'error')).toBe(true));
  });

  it('releases every resource lease during a deterministic cancellation soak', async () => {
    await runtime.listTargets();

    // oxlint-disable no-await-in-loop -- Ordered rounds prove each cancelled run releases its lease before reuse.

    for (let round = 0; round < 20; round += 1) {
      vi.mocked(adapter.run).mockImplementationOnce(
        (input) =>
          new Promise<void>((_resolve, reject) => {
            input.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
          })
      );
      const requestId = 'cancel-soak-' + round;
      runtime.start(
        requestId,
        'codex',
        'long task',
        'C:/workspace',
        undefined,
        'workspace-write',
        'cancel-session-' + round
      );
      await vi.waitFor(() => expect(adapter.run).toHaveBeenCalledTimes(round + 1));
      await expect(runtime.cancel(requestId)).resolves.toBe(true);
      await vi.waitFor(() =>
        expect(events.some((event) => event.requestId === requestId && event.type === 'cancelled')).toBe(true)
      );
      expect(coordinator.releaseLease).toHaveBeenCalledTimes(round + 1);
    }
    // oxlint-enable no-await-in-loop
  });

  it('always releases its resource lease when an adapter fails', async () => {
    vi.mocked(adapter.run).mockRejectedValueOnce(new Error('provider failed'));
    await runtime.listTargets();
    runtime.start('failed-request', 'codex', 'hello', 'C:/workspace');
    await vi.waitFor(() => expect(events.some((event) => event.type === 'error')).toBe(true));

    expect(coordinator.requestLease).toHaveBeenCalledWith({ kind: 'agent', estCostMB: 96 });
    expect(coordinator.releaseLease).toHaveBeenCalledWith('agent-lease');
  });
});
