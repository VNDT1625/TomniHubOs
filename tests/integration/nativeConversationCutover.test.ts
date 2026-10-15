/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICreateConversationParams } from '@/common/adapter/ipcBridge';
import type { ExperimentalCoreEvent } from '@process/experimentalCore/experimentalCoreRuntime';
import { createSessionMemoryStore, type ISessionMemoryStore } from '@process/userUnderstanding/sessionMemoryStore';
import {
  NativeConversationRepository,
  NativeConversationService,
  type NativeConversationRuntime,
  type NativeConversationWorkspaceProvisioner,
} from '@process/services/database/nativeConversation';
import { createTurnNotePolicy, type TurnNotePolicy } from '@process/services/database/nativeConversation/turnNotes';
import { sanitizeNoteText } from '@process/services/database/nativeConversation/turnNotesWiring';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirectories: string[] = [];
const makeRepository = async (): Promise<{ repository: NativeConversationRepository; filePath: string }> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-native-conversation-'));
  tempDirectories.push(directory);
  const filePath = path.join(directory, 'conversations.json');
  return { repository: new NativeConversationRepository(filePath), filePath };
};

const params = (): ICreateConversationParams => ({
  type: 'acp',
  name: 'Native chat',
  model: {
    id: 'provider-1',
    platform: 'openai',
    name: '9Router',
    base_url: 'https://example.invalid',
    api_key: 'secret',
    use_model: 'gpt-test',
  },
  extra: {
    workspace: 'C:\\workspace',
    backend: 'claude',
    current_model_id: 'claude-test',
    surface: 'ide',
  },
});

const createHarness = async (
  workspaceProvisioner?: NativeConversationWorkspaceProvisioner,
  memory?: ISessionMemoryStore,
  terminal?: Promise<{ type: 'error' | 'cancelled'; text: string } | undefined>,
  turnNotes?: TurnNotePolicy
) => {
  const { repository, filePath } = await makeRepository();
  const starts: Parameters<NativeConversationRuntime['start']>[] = [];
  const cancels: string[] = [];
  const permissionResolutions: Array<{ permissionId: string; approved: boolean; lifetime?: string }> = [];
  const orchestrationResolutions: Array<{ proposalId: string; approved: boolean }> = [];
  const runtime: NativeConversationRuntime = {
    start: (...args) => {
      starts.push(args);
      return { requestId: args[0], sessionId: args[6], terminal };
    },
    cancel: async (requestId) => {
      cancels.push(requestId);
      return true;
    },
    resolvePermission: async (permissionId, approved, lifetime) => {
      permissionResolutions.push({ permissionId, approved, lifetime });
      return true;
    },
    resolveOrchestrationProposal: async (proposalId, approved) => {
      orchestrationResolutions.push({ proposalId, approved });
      return true;
    },
    inspectContext: async () => ({
      system: 'Tomny system prompt',
      tools: [
        {
          name: 'StartAction',
          description: 'Core action gateway',
          input_schema: { type: 'object', properties: { goal: { type: 'string' } } },
          deferred: false,
        },
      ],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Compacted context' }] }],
      capabilitySummary: 'Available surface capabilities: project reading and search.',
      workingMemory: { goal: 'Inspect the project' },
      agentContext: 'Name: Tomny\nIdentity: Project agent',
      personalContext: 'Preferred language: Vietnamese',
      history: [
        { role: 'user' as const, text: 'Inspect the project.', timestamp: 1 },
        { role: 'assistant' as const, text: 'The project uses Tomny Core.', timestamp: 2 },
      ],
      toolCache: [
        {
          name: 'ide_read',
          description: 'Read an IDE file',
          input_schema: { type: 'object', properties: { path: { type: 'string' } } },
          deferred: true,
        },
      ],
    }),
  };
  const responses: Array<{ type: string; data: unknown }> = [];
  const completions: Array<{ session_id: string; state: string }> = [];
    const changes: Array<{ conversation_id: string; action: string }> = [];
  const catalogUpdates: Array<{ conversation_id: string; catalog: { status: string; commands: readonly { name: string }[] } }> = [];
  const service = new NativeConversationService(
    repository,
    runtime,
    {
      response: (event) => responses.push(event),
      turnCompleted: (event) => completions.push(event),
            listChanged: (event) => changes.push(event),
      commandCatalog: (event) => catalogUpdates.push(event),
    },
    workspaceProvisioner,
    memory,
    turnNotes
  );
  await service.initialize();
  return {
    service,
    runtime,
    repository,
    filePath,
    starts,
    cancels,
    permissionResolutions,
    orchestrationResolutions,
    responses,
    completions,
        changes,
    catalogUpdates,
  };
};

describe('native CLI command discovery', () => {
  it('resolves the provider target and workspace from the saved conversation in Main', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    const catalog = {
      status: 'available' as const,
      commands: [{ name: 'compact', description: 'Provider-advertised command' }],
    };
    const listCommands = vi.fn(async () => catalog);
    harness.runtime.listCommands = listCommands;

    await expect(harness.service.getCliCommands(conversation.id)).resolves.toEqual(catalog);
        expect(listCommands).toHaveBeenCalledWith('claude', 'C:\\workspace', conversation.id, expect.any(Function));

    await expect(harness.service.getCliCommands('missing-conversation')).resolves.toEqual({
      status: 'unavailable',
      commands: [],
    });
    expect(listCommands).toHaveBeenCalledTimes(1);
  });

    it('delivers live ACP updates to the subscribed conversation and unregisters on reset', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    const releaseCommands = vi.fn();
    harness.runtime.releaseCommands = releaseCommands;
    let notify: ((catalog: { status: 'available'; commands: { name: string; description: string }[] }) => void) | undefined;
    harness.runtime.listCommands = vi.fn(async (_target, _workspace, _session, onUpdate) => {
      notify = onUpdate as typeof notify;
      return { status: 'available' as const, commands: [] };
    });
    await harness.service.getCliCommands(conversation.id);
    notify?.({ status: 'available', commands: [{ name: 'init', description: 'Initialize' }] });
    expect(harness.catalogUpdates).toEqual([{
      conversation_id: conversation.id,
      catalog: { status: 'available', commands: [{ name: 'init', description: 'Initialize' }] },
    }]);
    await harness.service.reset(conversation.id);
    expect(releaseCommands).toHaveBeenCalledWith(conversation.id);
  });

    it('invalidates provider commands when a conversation switches CLI targets', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    const release = vi.fn();
    harness.runtime.releaseCommands = release;
    await harness.service.update(conversation.id, {
      extra: { ...conversation.extra, backend: 'opencode', tomny_core_target_id: 'opencode' },
    });
    expect(release).toHaveBeenCalledWith(conversation.id);
  });

    it('marks provider slash invocation Main-only and preserves the command in the runtime prompt', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    const command = '/compact keep this exact argument';
    await harness.service.send(
      { conversation_id: conversation.id, input: command, model_input: command },
      undefined, undefined, undefined, false, true
    );
    expect(harness.starts).toHaveLength(1);
    expect(harness.starts[0][2]).toBe(command);
    expect(harness.starts[0][8]).toMatchObject({ nativeCliCommand: true });
  });

  it('does not fabricate commands when the runtime has no discovery capability', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await expect(harness.service.getCliCommands(conversation.id)).resolves.toEqual({
      status: 'unsupported',
      commands: [],
    });
  });
});

describe('native conversation workspace references', () => {
  it('provides a short dropped file to the runtime prompt without Understanding metadata', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'tomni-reference-workspace-'));
    tempDirectories.push(workspace);
    const { writeFile } = await import('node:fs/promises');
    const contents = '{"schemaVersion":1,"packages":[]}';
    await writeFile(path.join(workspace, 'installed.json'), contents, 'utf8');
    const harness = await createHarness();
    const conversation = await harness.service.create({ ...params(), extra: { ...params().extra, workspace } });
    await harness.service.send({
      conversation_id: conversation.id,
      input: '[installed.json] Please read this file.',
      model_input: '[File reference: installed.json] Please read this file.',
      workspace_references: [{ relativePath: 'installed.json', kind: 'file' }],
    });
    expect(harness.starts).toHaveLength(1);
    expect(harness.starts[0][2]).toContain(contents);
    expect(harness.starts[0][2]).toContain('inline full text');
    expect(harness.starts[0][2]).toContain('already been provided in this turn');
    expect(harness.responses.find((event) => event.type === 'user_content')?.data).toEqual({
      content: '[installed.json] Please read this file.',
    });
  });
    it('passes absolute canonical paths and requests preloaded file tools for a large attachment', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'tomni-reference-workspace-'));
    tempDirectories.push(workspace);
    const { writeFile } = await import('node:fs/promises');
    const content = 'A'.repeat(20_100);
    await writeFile(path.join(workspace, 'large.txt'), content, 'utf8');
    const harness = await createHarness();
    const conversation = await harness.service.create({ ...params(), extra: { ...params().extra, workspace } });
    await harness.service.send({
      conversation_id: conversation.id,
      input: 'Read the attached large file only.',
      workspace_references: [{ relativePath: 'large.txt', kind: 'file' }],
    });
    const prompt = harness.starts[0][2];
    expect(prompt).toContain(JSON.stringify(path.join(workspace, 'large.txt')));
    expect(prompt).toContain('call tomny_read directly');
    expect(prompt).not.toContain(content);
    expect(harness.starts[0][8]).toMatchObject({ prefetchWorkspaceRead: true });
  });

  it('projects a canonical Understanding summary for a dropped folder before starting the runtime', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'tomni-reference-workspace-'));
    tempDirectories.push(workspace);
    await import('node:fs/promises').then(async ({ mkdir, writeFile }) => {
      await mkdir(path.join(workspace, 'docs'), { recursive: true });
      await mkdir(path.join(workspace, '.tomni', 'understand'), { recursive: true });
      await writeFile(
        path.join(workspace, '.tomni', 'understand', 'summary.json'),
        JSON.stringify({ modules: [{ id: 'docs', summary: 'Canonical documentation folder.' }] }),
        'utf8'
      );
    });
    const harness = await createHarness();
    const conversation = await harness.service.create({
      ...params(),
      extra: { ...params().extra, workspace },
    });

    await harness.service.send({
      conversation_id: conversation.id,
      input: 'Inspect the selected folder',
      workspace_references: [{ relativePath: 'docs', kind: 'folder' }],
    });

    expect(harness.starts).toHaveLength(1);
    expect(harness.starts[0][2]).toContain('[Untrusted workspace folder: docs]');
    expect(harness.starts[0][2]).toContain('Canonical documentation folder.');
  });
});

describe('native conversation fork', () => {
  it('copies archived messages under independent ids and session identity', async () => {
    const harness = await createHarness();
    const source = await harness.service.create(params());
    await harness.service.send({ conversation_id: source.id, input: 'Original message' });
    const fork = await harness.service.forkConversation(source.id);
    const sourceMessages = await harness.repository.listMessages(source.id);
    const forkMessages = await harness.repository.listMessages(fork.id);
    expect(fork.id).not.toBe(source.id);
    expect(fork.name).toContain('(fork)');
    expect(forkMessages).toHaveLength(sourceMessages.length);
    expect(forkMessages[0]?.conversation_id).toBe(fork.id);
    expect(forkMessages[0]?.id).not.toBe(sourceMessages[0]?.id);
    expect(forkMessages[0]?.content).toEqual(sourceMessages[0]?.content);
    expect((fork.extra as Record<string, unknown>).tomny_core_session_id).toBe(fork.id);
  });
});

describe('native conversation startup failure', () => {
  it('rejects an invalid workspace reference before persisting or starting a turn', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'tomni-reference-workspace-'));
    tempDirectories.push(workspace);
    const harness = await createHarness();
    const conversation = await harness.service.create({
      ...params(),
      extra: { ...params().extra, workspace },
    });

    await expect(
      harness.service.send({
        conversation_id: conversation.id,
        input: 'Inspect the selected file',
        workspace_references: [{ relativePath: '../outside.ts', kind: 'file' }],
      })
    ).rejects.toThrow('WORKSPACE_REFERENCE_INVALID_PATH');

    expect(await harness.repository.listMessages(conversation.id)).toEqual([]);
    expect(harness.starts).toEqual([]);
    expect(harness.responses).toEqual([]);
    expect(harness.service.activeCount()).toBe(0);
    expect((await harness.service.get(conversation.id))?.status).toBe('pending');
  });

  it('emits error and finish, completes the turn, and permits another send after a synchronous start rejection', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    const originalStart = harness.runtime.start;
    harness.runtime.start = () => {
      throw new Error('provider unavailable');
    };
    await expect(harness.service.send({ conversation_id: conversation.id, input: 'Try starting' })).rejects.toThrow(
      'provider unavailable'
    );
    expect(harness.responses.map((response) => response.type)).toEqual(['user_content', 'error', 'finish']);
    expect(harness.responses.at(-1)?.data).toEqual({ state: 'error' });
    expect(harness.completions).toEqual([expect.objectContaining({ session_id: conversation.id, state: 'error' })]);
    expect(harness.service.activeCount()).toBe(0);
    expect((await harness.service.get(conversation.id))?.status).toBe('finished');

    harness.runtime.start = originalStart;
    await harness.service.send({ conversation_id: conversation.id, input: 'Try again' });
    expect(harness.service.activeCount()).toBe(1);
    await harness.service.cancel(conversation.id);
  });
});

describe('native Save context projection', () => {
  it('injects only the scoped Save payload, reflects changes, and keeps message history archive-only', async () => {
    const memory = createSessionMemoryStore({
      summarizer: async () => 'compacted Save',
      policy: { tokenBudget: 12_000 },
    });
    const pinned = await memory.remember('memory-a', { text: 'PINNED-A', kind: 'decision', pinned: true });
    const recent = await memory.remember('memory-a', { text: 'RECENT-A', kind: 'fact' });
    await memory.remember('memory-b', { text: 'PRIVATE-B', pinned: true });
    const harness = await createHarness(undefined, memory);
    const conversation = await harness.service.create({
      ...params(),
      extra: { ...params().extra, ide_memory_id: 'memory-a' },
    });

    await harness.service.send({ conversation_id: conversation.id, input: 'RECENT-A' });
    const firstIdentity = harness.starts[0][8];
    expect(harness.starts[0][2]).toBe('RECENT-A');
    expect(firstIdentity?.savedMemoryContext).toContain('### Pinned Save item');
    expect(firstIdentity?.savedMemoryContext).toContain('PINNED-A');
    expect(firstIdentity?.savedMemoryContext).toContain('RECENT-A');
    expect(firstIdentity?.savedMemoryContext).not.toContain('PRIVATE-B');
    await harness.service.handleCoreEvent(coreEvent(harness.starts[0][0], conversation.id, 'completed'));

    memory.forget('memory-a', recent.item.id);
    await memory.remember('memory-a', { text: 'UPDATED-A', kind: 'fact' });
    await harness.service.send({ conversation_id: conversation.id, input: 'UPDATED-A' });
    const secondContext = harness.starts[1][8]?.savedMemoryContext ?? '';
    expect(secondContext).toContain('UPDATED-A');
    expect(secondContext).not.toContain('RECENT-A');
    expect(secondContext).toContain(pinned.item.id);

    const inspected = await harness.service.getTomnyAgenticContext(conversation.id);
    expect(inspected.messages).toEqual([]);
    expect(inspected.core_context.history).toEqual([]);
    expect(inspected.core_context.saved_memory).toBe(secondContext);
    expect(inspected.token_estimate.messages).toBe(0);
    expect(inspected.token_estimate.prompt_messages).toBe(0);
    expect(inspected.token_estimate.saved_memory).toBeGreaterThan(0);
    expect(inspected.token_estimate.archived_messages).toBeGreaterThan(0);

    const cloned = await harness.service.cloneConversation({ ...conversation, id: 'cloned-conversation' });
    expect((cloned.extra as Record<string, unknown>).ide_memory_id).not.toBe('memory-a');
    await harness.service.send({ conversation_id: cloned.id, input: 'CLONE-REQUEST' });
    expect(harness.starts[2][8]?.savedMemoryContext ?? '').not.toContain('PINNED-A');

    expect(memory.snapshot('memory-a').items.length).toBeGreaterThan(0);
    await harness.service.remove(conversation.id);
    expect(memory.snapshot('memory-a').items).toEqual([]);
  });

  it('keeps every pinned item verbatim ahead of an oversized host context', async () => {
    const memory = createSessionMemoryStore({
      summarizer: async () => 'compacted Save',
      policy: { tokenBudget: 12_000 },
    });
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        memory.remember('large-pinned-memory', {
          text: `PIN-${index} ${'word '.repeat(700)} END-PIN-${index}`,
          pinned: true,
        })
      )
    );
    const harness = await createHarness(undefined, memory);
    const conversation = await harness.service.create({
      ...params(),
      extra: {
        ...params().extra,
        ide_memory_id: 'large-pinned-memory',
        tomny_custom_context: `OVERSIZED-HOST ${'z'.repeat(30_000)}`,
      },
    });

    await harness.service.send({ conversation_id: conversation.id, input: 'CURRENT-LARGE-PIN-REQUEST' });
    const sentContext = harness.starts[0][8]?.savedMemoryContext ?? '';
    expect(harness.starts[0][8]?.conversationContext).toContain('## User-managed conversation context');
    for (let index = 0; index < 10; index++) {
      expect(sentContext).toContain(`PIN-${index}`);
      expect(sentContext).toContain(`END-PIN-${index}`);
    }
    const inspected = await harness.service.getTomnyAgenticContext(conversation.id);
    expect(inspected.core_context.saved_memory).toBe(sentContext);
  });

  it('recalls only Save items relevant to the current prompt instead of replaying the whole store', async () => {
    const memory = createSessionMemoryStore({
      summarizer: async () => 'compacted Save',
      policy: { tokenBudget: 100_000, recallRecent: 20, recallTokenBudget: 100 },
    });
    // The newest note always travels with the prompt, so the irrelevant one is written first.
    await memory.remember('complete-save', { text: 'PAYMENT-FLOW retries declined card payments' });
    await memory.remember('complete-save', { text: 'AUTH-FLOW validates OAuth state in authService' });
    await memory.remember('complete-save', { text: 'PINNED-CONSTRAINT always use TypeScript', pinned: true });
    const harness = await createHarness(undefined, memory);
    const conversation = await harness.service.create({
      ...params(),
      extra: { ...params().extra, ide_memory_id: 'complete-save' },
    });

    await harness.service.send({ conversation_id: conversation.id, input: 'inspect AUTH-FLOW' });
    const sent = harness.starts[0][8]?.savedMemoryContext ?? '';
    expect(sent).toContain('AUTH-FLOW');
    expect(sent).toContain('PINNED-CONSTRAINT');
    expect(sent).not.toContain('PAYMENT-FLOW');
    expect(memory.snapshot('complete-save').recalls).toBe(1);
  });

  it('closes a StartAction into a compact Save capsule without retaining raw tool output', async () => {
    const memory = createSessionMemoryStore({
      summarizer: async () => 'compacted Save',
      policy: { tokenBudget: 12_000 },
    });
    const harness = await createHarness(undefined, memory);
    const conversation = await harness.service.create({
      ...params(),
      extra: { ...params().extra, ide_memory_id: 'action-memory' },
    });
    await harness.service.send({ conversation_id: conversation.id, input: 'trace the message send flow' });
    const requestId = harness.starts[0][0];

    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-call', {
        tool: 'StartAction',
        callId: 'gate-1',
        input: { goal: 'Trace the message send flow' },
      })
    );
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-call', {
        tool: 'ide_research',
        callId: 'research-1',
        input: { rootPath: 'C:\\workspace', intent: 'message send flow', maxFiles: 6 },
      })
    );
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-result', {
        tool: 'ide_research',
        callId: 'research-1',
        outcome: 'success',
        text: `RAW-TOOL-OUTPUT ${'x'.repeat(20_000)}`,
      })
    );
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'delta', {
        text: 'The flow starts in src/send.ts and reaches src/service.ts.',
        mode: 'append',
      })
    );
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'completed'));

    await vi.waitFor(() => expect(harness.service.activeCount()).toBe(0));
    const capsule = memory.snapshot('action-memory').items.find((item) => item.text.includes('Action capsule'));
    expect(capsule?.text).toContain('Trace the message send flow');
    expect(capsule?.text).toContain('Work kind: investigation');
    expect(capsule?.text).toContain('ide_research');
    expect(capsule?.text).toContain('src/send.ts');
    expect(capsule?.text).not.toContain('RAW-TOOL-OUTPUT');
    expect(capsule?.tokens).toBeLessThan(500);
  });

  it('does not create an action capsule for a direct casual response', async () => {
    const memory = createSessionMemoryStore({ summarizer: async () => 'compacted Save' });
    const harness = await createHarness(undefined, memory);
    const conversation = await harness.service.create({
      ...params(),
      extra: { ...params().extra, ide_memory_id: 'casual-memory' },
    });
    await harness.service.send({ conversation_id: conversation.id, input: 'hello' });
    const requestId = harness.starts[0][0];
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'delta', { text: 'Hello!', mode: 'append' }));
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'completed'));

    await vi.waitFor(() => expect(harness.service.activeCount()).toBe(0));
    expect(memory.snapshot('casual-memory').items).toEqual([]);
  });

  it('expands /deep-debug only in the model prompt while preserving the user message', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());

    await harness.service.send({
      conversation_id: conversation.id,
      input: '/deep-debug fix the intermittent billing 404',
    });

    expect(harness.starts[0][2]).toContain('[Deep Debug control: explicitly requested by the user]');
    expect(harness.starts[0][2]).toContain('ide_research with mode="bug" and deepDebug=true');
    expect(harness.starts[0][2]).toContain('fix the intermittent billing 404');
    const messages = await harness.repository.listMessages(conversation.id);
    expect(messages[0]?.content).toEqual({ content: '/deep-debug fix the intermittent billing 404' });

    const requestId = harness.starts[0][0];
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'completed'));
    await vi.waitFor(() => expect(harness.service.activeCount()).toBe(0));
  });
});

const coreEvent = (
  requestId: string,
  sessionId: string,
  type: ExperimentalCoreEvent['type'],
  extra: Partial<ExperimentalCoreEvent> = {}
): ExperimentalCoreEvent => ({
  requestId,
  sessionId,
  targetId: 'claude',
  type,
  timestamp: Date.now(),
  sequence: 1,
  ...extra,
});

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('native conversation cutover', () => {
  it('renders a Team proposal as a chat decision and resolves it through the runtime', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'create a team' });
    const requestId = harness.starts[0][0];

    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'orchestration-proposal', {
        orchestrationProposalId: 'proposal-1',
        orchestrationKind: 'team',
        orchestrationProposal: {
          kind: 'team',
          name: 'Delivery',
          reason: 'Frontend and backend can work independently.',
          parallelism: 2,
          estimatedTokens: 3000,
          roles: [
            { id: 'frontend', name: 'Frontend', responsibility: 'Build the UI', dependsOn: [] },
            { id: 'backend', name: 'Backend', responsibility: 'Build the API', dependsOn: [] },
          ],
        },
      })
    );

    await vi.waitFor(() =>
      expect(harness.responses.some((event) => event.type === 'orchestration_proposal')).toBe(true)
    );
    const proposal = harness.responses.find((event) => event.type === 'orchestration_proposal');
    expect(proposal?.data).toMatchObject({
      id: 'proposal-1',
      proposal_id: 'proposal-1',
      proposal: {
        kind: 'team',
        name: 'Delivery',
        roles: [{ id: 'frontend' }, { id: 'backend' }],
      },
    });

    await expect(harness.service.resolveOrchestrationProposal('proposal-1', true)).resolves.toBe(true);
    expect(harness.orchestrationResolutions).toEqual([{ proposalId: 'proposal-1', approved: true }]);
    expect(harness.permissionResolutions).toEqual([]);
    await vi.waitFor(() =>
      expect(harness.responses.filter((event) => event.type === 'orchestration_proposal').at(-1)?.data).toMatchObject({
        decision: 'approved',
      })
    );
    const persisted = await harness.repository.listMessages(conversation.id);
    expect(persisted.find((message) => message.type === 'orchestration_proposal')?.content).toMatchObject({
      decision: 'approved',
    });
  });

  it('provisions and persists a temporary workspace for a normal chat without a project', async () => {
    const workspace = 'C:\\tomny-scratch\\chat';
    const harness = await createHarness(async () => workspace);
    const conversation = await harness.service.create({
      ...params(),
      type: 'tomnyagentic',
      extra: { backend: 'tomny', workspace: '', surface: 'chat' },
    });

    expect(conversation.extra.workspace).toBe(workspace);
    expect((conversation.extra as Record<string, unknown>).is_temporary_workspace).toBe(true);
    await harness.service.send({ conversation_id: conversation.id, input: 'hello' });
    expect(harness.starts[0][3]).toBe(workspace);
  });

  it('passes the selected Tomny provider identity with its model to avoid a stale CLI key', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({
      ...params(),
      type: 'tomnyagentic',
      extra: { backend: 'tomny', workspace: 'C:\\workspace', surface: 'ide' },
    });

    await harness.service.send({ conversation_id: conversation.id, input: 'hello' });

    expect(harness.starts[0][4]).toBe('app-provider:provider-1:gpt-test');
  });

  it('encodes managed-gateway reasoning as a request-level virtual model suffix', async () => {
    const harness = await createHarness();
    const base = params();
    const conversation = await harness.service.create({
      ...base,
      type: 'tomnyagentic',
      model: {
        ...base.model,
        id: 'tomni-model-gateway',
        use_model: 'cx/gpt-5.6-luna',
        reasoning_effort: 'high',
      },
      extra: { backend: 'tomny', workspace: 'C:\\workspace', surface: 'ide' },
    });

    await harness.service.send({ conversation_id: conversation.id, input: 'hello' });

    expect(harness.starts[0][4]).toBe('app-provider:tomni-model-gateway:cx%2Fgpt-5.6-luna(high)');
  });

  it('passes the selected YOLO session mode to the core as full access', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({
      ...params(),
      type: 'tomnyagentic',
      extra: { backend: 'tomny', workspace: 'C:\\workspace', surface: 'ide', session_mode: 'yolo' },
    });

    await harness.service.send({ conversation_id: conversation.id, input: 'run the action' });

    expect(harness.starts[0][5]).toBe('full-access');
  });

  it('persists CRUD metadata atomically and survives a repository restart', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());

    await harness.service.update(conversation.id, { name: 'Renamed' }, true);
    const reloaded = new NativeConversationRepository(harness.filePath);
    await reloaded.initialize();

    expect((await reloaded.getConversation(conversation.id))?.name).toBe('Renamed');
    expect((await reloaded.getConversation(conversation.id))?.extra.workspace).toBe('C:\\workspace');
    expect(JSON.parse(await readFile(harness.filePath, 'utf8')).version).toBe(1);
  });

  it('projects app-managed context for every native session without inventing CLI-native tokens', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({
      ...params(),
      type: 'acp',
      extra: {
        ...params().extra,
        backend: 'claude',
        workspace: params().extra.workspace as string,
        tomny_custom_context: 'Keep replies concise.',
        tomny_context_branches: [
          { id: 'release', title: 'Release', summary: 'Work target', content: 'Preserve the shared send seam.' },
        ],
      },
    });
    const contextService = harness.service as typeof harness.service & {
      getSessionContext?: (conversationId: string) => Promise<{
        inspection: { kind: 'app-only' | 'native' };
        app: { custom_context: string; minimum_next_turn_tokens: number };
      }>;
    };

    expect(contextService.getSessionContext).toBeTypeOf('function');
    const snapshot = await contextService.getSessionContext!(conversation.id);
    expect(snapshot.inspection.kind).toBe('app-only');
    expect(snapshot.app.custom_context).toBe('Keep replies concise.');
    expect(snapshot.app.minimum_next_turn_tokens).toBeGreaterThan(0);
  });


  it('reports verified native context only for the Tomny runtime', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({
      ...params(),
      type: "tomnyagentic",
      extra: { ...params().extra, backend: "tomny" },
    });

    const snapshot = await harness.service.getSessionContext(conversation.id);

    expect(snapshot.inspection).toMatchObject({
      kind: "native",
      snapshot: { system: "Tomny system prompt" },
    });
  });


  it('persists user-managed context for a CLI session without native inspection', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({ ...params(), type: "acp" });
    const contextService = harness.service as typeof harness.service & {
      updateSessionContext?: (
        conversationId: string,
        customContext: string,
        branches: Array<{ id: string; title: string; summary: string; content: string }>
      ) => Promise<{ app: { custom_context: string; context_branches: Array<{ id: string }> } }>;
    };

    expect(contextService.updateSessionContext).toBeTypeOf("function");
    const saved = await contextService.updateSessionContext!(conversation.id, "Use concise Vietnamese.", [
      { id: "release", title: "Release", summary: "Current work", content: "Keep the shared send seam." },
    ]);

    expect(saved.app.custom_context).toBe("Use concise Vietnamese.");
    expect(saved.app.context_branches).toEqual([expect.objectContaining({ id: "release" })]);
    await expect(contextService.updateSessionContext!(conversation.id, "", [])).resolves.toMatchObject({
      app: { custom_context: "", context_branches: [] },
    });
  });


  it('rejects non-text custom context from an untrusted IPC payload', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({ ...params(), type: 'acp' });

    await expect(
      harness.service.updateSessionContext(
        conversation.id,
        { instruction: 'not a string' } as unknown as string,
        []
      )
    ).rejects.toThrow('Custom context must be text');

    expect((await harness.service.get(conversation.id))?.extra.tomny_custom_context).toBeUndefined();
  });


  it('rejects invalid user-managed session context before it reaches the shared send seam', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({ ...params(), type: 'acp' });
    const contextService = harness.service as typeof harness.service & {
      updateSessionContext?: (
        conversationId: string,
        customContext: string,
        branches: Array<{ id: string; title: string; summary: string; content: string }>
      ) => Promise<unknown>;
    };

    await expect(
      contextService.updateSessionContext!(conversation.id, '', [
        { id: 'duplicate', title: 'One', summary: '', content: 'first' },
        { id: 'duplicate', title: 'Two', summary: '', content: 'second' },
      ])
    ).rejects.toThrow('unique');
  });
  it('rejects invalid legacy Tomny context updates before persisting them', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({ ...params(), type: 'tomnyagentic' });

    await expect(
      harness.service.updateTomnyAgenticContext(conversation.id, '', [
        { id: 'duplicate', title: 'One', summary: '', content: 'first' },
        { id: 'duplicate', title: 'Two', summary: '', content: 'second' },
      ])
    ).rejects.toThrow('unique');

    expect((await harness.service.get(conversation.id))?.extra.tomny_context_branches).toBeUndefined();
  });


  it('serves and persists the Memory Context snapshot without the legacy HTTP API', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'Remember this.' });

    const saved = await harness.service.updateTomnyAgenticContext(conversation.id, 'Use concise Vietnamese.', [
      { id: 'release', title: 'Release', summary: 'Current work', content: 'Ship the native core.' },
    ]);
    const reloaded = await harness.service.getTomnyAgenticContext(conversation.id);

    expect(saved.custom_context).toBe('Use concise Vietnamese.');
    expect(reloaded.system).toBe('Tomny system prompt');
    expect(reloaded.tools).toEqual([expect.objectContaining({ name: 'ide_read', deferred: true })]);
    expect(JSON.stringify(reloaded.tools)).not.toContain('StartAction');
    expect(reloaded.core_context).toEqual({
      agent: 'Name: Tomny\nIdentity: Project agent',
      personal: 'Preferred language: Vietnamese',
      control_tools: [expect.objectContaining({ name: 'StartAction', deferred: false })],
      history: [],
      saved_memory: '',
    });
    expect(reloaded.token_estimate.core).toBeGreaterThan(0);
    expect(reloaded.token_estimate.archived_messages).toBeGreaterThan(0);
    expect(reloaded.token_estimate.prompt_messages).toBe(0);
    expect(reloaded.token_estimate.total).toBe(
      reloaded.token_estimate.system +
        (reloaded.token_estimate.saved_memory ?? 0) +
        (reloaded.token_estimate.context_branches ?? 0) +
        reloaded.token_estimate.tools +
        reloaded.token_estimate.core
    );
    expect(reloaded.context_branches).toEqual(saved.context_branches);
    expect(reloaded.messages).toEqual([]);
    expect(reloaded.working_memory).toEqual({ goal: 'Inspect the project' });
    expect(reloaded.tool_cache).toEqual({ ide_read: expect.objectContaining({ name: 'ide_read' }) });
    expect(reloaded.session_experience).toEqual({
      capability_summary: 'Available surface capabilities: project reading and search.',
    });
  });

  it('streams a direct runtime turn, persists its history, and emits UI-compatible completion', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'hello', loading_id: 'user-1' });
    const [start] = harness.starts;
    const requestId = start[0];

    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'started'));
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'thinking', { text: 'Inspecting' }));
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'delta', { text: 'Hello ', mode: 'append' }));
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'delta', { text: 'world', mode: 'append' }));
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'completed'));

    await vi.waitFor(() => expect(harness.service.activeCount()).toBe(0));
    await vi.waitFor(() => expect(harness.responses.map((event) => event.type)).toContain('finish'));
    const history = await harness.service.history(conversation.id, 1, 50, 'asc');

    expect(start.slice(1, 7)).toEqual([
      'claude',
      'hello',
      'C:\\workspace',
      'claude-test',
      'workspace-write',
      conversation.id,
    ]);
    expect(history.items.map((message) => message.content.content)).toEqual(['hello', 'Hello world']);
    expect(harness.responses.map((event) => event.type)).toContain('finish');
    expect(harness.completions).toEqual([
      expect.objectContaining({ session_id: conversation.id, state: 'ai_waiting_input' }),
    ]);
  });

  it('renders native tool activity as mergeable View Steps instead of an unknown session status', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'inspect files' });
    const requestId = harness.starts[0][0];

    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-call', {
        tool: 'ide_read_file',
        callId: 'tool-1',
        agentId: 'repo-reader',
        phase: 'running',
        text: 'Reading app.ts',
        input: { rootPath: 'C:\\workspace', filePath: 'src/app.ts' },
      })
    );
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-result', {
        tool: 'ide_read_file',
        callId: 'tool-1',
        agentId: 'repo-reader',
        outcome: 'success',
        text: 'Read 42 lines',
      })
    );

    await vi.waitFor(() => expect(harness.responses.filter((event) => event.type === 'tool_group')).toHaveLength(2));
    expect(harness.responses.some((event) => event.type === 'agent_status')).toBe(false);
    expect(harness.responses.filter((event) => event.type === 'tool_group').map((event) => event.data)).toEqual([
      [
        expect.objectContaining({
          call_id: 'tool-1',
          name: 'ide_read_file',
          agent_id: 'repo-reader',
          status: 'Executing',
          input: { rootPath: 'C:\\workspace', filePath: 'src/app.ts' },
        }),
      ],
      [
        expect.objectContaining({
          call_id: 'tool-1',
          name: 'ide_read_file',
          agent_id: 'repo-reader',
          status: 'Success',
          input: { rootPath: 'C:\\workspace', filePath: 'src/app.ts' },
        }),
      ],
    ]);
  });

  it('renders the StartAction ToolMap as its own compact View Step', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'inspect the repository' });
    const requestId = harness.starts[0][0];

    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-result', {
        tool: 'StartAction',
        callId: 'gate-with-map',
        outcome: 'success',
        text: [
          'Action gate opened. Available surface capabilities: project reading and search.',
          'ToolMap: [{"name":"ide_research","description":"Build a verified pack","recommended":true},{"name":"ide_read_file","description":"Read a file","deferred":true}]',
          'Schema cache unchanged. Use ToolSearch to load exact schemas.',
        ].join('\n'),
      })
    );

    await vi.waitFor(() => expect(harness.responses.filter((event) => event.type === 'tool_group')).toHaveLength(1));
    const steps = harness.responses.find((event) => event.type === 'tool_group')?.data as Array<{
      call_id: string;
      description: string;
      name: string;
      result_display: string;
    }>;
    expect(steps.map(({ name }) => name)).toEqual(['StartAction', 'ToolMap']);
    expect(steps[0].result_display).not.toContain('[{"name"');
    expect(steps[1]).toEqual(
      expect.objectContaining({
        call_id: 'gate-with-map:tool-map',
        description: '2',
        status: 'Success',
        result_display: expect.stringContaining('"recommended": [\n    "ide_research"'),
      })
    );
    expect(steps[1].result_display).toContain('"deferred": [\n    "ide_read_file"');
  });

  it('renders an MCP validation payload as a failed step even when the outer transport reports success', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'inspect files' });
    const requestId = harness.starts[0][0];

    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-result', {
        tool: 'ide_map',
        callId: 'tool-validation-error',
        outcome: 'success',
        text: 'MCP error -32602: Input validation error: Invalid arguments for tool ide_map: rootPath is required',
      })
    );

    await vi.waitFor(() => expect(harness.responses.filter((event) => event.type === 'tool_group')).toHaveLength(1));
    expect(harness.responses.find((event) => event.type === 'tool_group')?.data).toEqual([
      expect.objectContaining({
        call_id: 'tool-validation-error',
        name: 'ide_map',
        status: 'Error',
        result_display: expect.stringContaining('MCP error -32602'),
      }),
    ]);
  });

  it('keeps a successful command green when stdout quotes an MCP validation error', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'read the report' });
    const requestId = harness.starts[0][0];
    const output = '[exit 0 in 508ms]\n--- stdout ---\nThe report documents: MCP error -32602: Input validation error.';

    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-result', {
        tool: 'tomny_command',
        callId: 'command-success',
        outcome: 'success',
        text: output,
      })
    );

    await vi.waitFor(() => expect(harness.responses.filter((event) => event.type === 'tool_group')).toHaveLength(1));
    expect(harness.responses.find((event) => event.type === 'tool_group')?.data).toEqual([
      expect.objectContaining({
        call_id: 'command-success',
        name: 'tomny_command',
        status: 'Success',
        result_display: output,
      }),
    ]);
  });

    it('preserves Workflow child identities in tool_group frames so the Hub can render a fan-out', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'run A and B together' });
    const requestId = harness.starts[0][0];
    for (const step of ['A', 'B']) {
      harness.service.handleCoreEvent(
        coreEvent(requestId, conversation.id, 'tool-call', {
          tool: 'tomny_read',
          callId: `workflow:wf-1:${step}`,
          workflowId: 'wf-1',
                    workflowStepId: step,
          workflowStage: 0,
          input: { filePath: `${step}.ts` },
          phase: 'running',
        })
      );
    }
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-result', {
        tool: 'tomny_read',
        callId: 'workflow:wf-1:A',
        workflowId: 'wf-1',
                workflowStepId: 'A',
        workflowStage: 0,
        outcome: 'error',
        text: 'A failed',
      })
    );
    await vi.waitFor(() => expect(harness.responses.filter((event) => event.type === 'tool_group')).toHaveLength(3));
    const calls = harness.responses
      .filter((event) => event.type === 'tool_group')
      .flatMap((event) => event.data as Array<{ workflow_id?: string; workflow_step_id?: string; call_id: string; status: string }>);
    expect(calls.map((call) => [call.workflow_id, call.workflow_step_id])).toEqual([
      ['wf-1', 'A'], ['wf-1', 'B'], ['wf-1', 'A'],
    ]);
    expect(calls[2]).toMatchObject({ call_id: 'workflow:wf-1:A', status: 'Error' });
  });

  it('keeps repeated same-name tools separate by call_id and drops ambiguous events', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'read two files' });
    const requestId = harness.starts[0][0];

    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-call', {
        tool: 'ide_read_file',
        callId: 'read-a',
        phase: 'running',
        text: 'Reading a.ts',
      })
    );
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-call', {
        tool: 'ide_read_file',
        callId: 'read-b',
        phase: 'running',
        text: 'Reading b.ts',
      })
    );
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-result', {
        tool: 'ide_read_file',
        callId: 'read-b',
        outcome: 'success',
        text: 'b.ts complete',
      })
    );
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-result', {
        tool: 'ide_read_file',
        callId: 'read-a',
        outcome: 'success',
        text: 'a.ts complete',
      })
    );
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-result', {
        tool: 'ide_read_file',
        outcome: 'success',
        text: 'ambiguous legacy result',
      })
    );

    await vi.waitFor(() => expect(harness.responses.filter((event) => event.type === 'tool_group')).toHaveLength(4));
    expect(
      harness.responses
        .filter((event) => event.type === 'tool_group')
        .flatMap((event) => event.data as Array<{ call_id: string }>)
        .map((item) => item.call_id)
    ).toEqual(['read-a', 'read-b', 'read-b', 'read-a']);
  });

  it('preserves IDE surface grants for a writable native conversation', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({
      ...params(),
      extra: { ...params().extra, surface: 'ide' },
    });
    await harness.service.send({ conversation_id: conversation.id, input: 'inspect this project' });

        expect(harness.starts[0][8]).toMatchObject({
      surface: 'ide',
      permissionScopes: ['workspace.read', 'workspace.write'],
      capabilityGrants: ['surface.ide'],
      availableCapabilities: ['surface.ide'],
      superMode: false,
    });
  });

  it('does not attach generated preset payloads to a casual IDE turn', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({
      ...params(),
      extra: {
        ...params().extra,
        surface: 'ide',
        preset_context: `## IDE workspace guide\n${'workspace guidance '.repeat(1_000)}`,
        preset_rules: `## Project rules\n${'project rule '.repeat(1_000)}`,
      },
    });

    await harness.service.send({ conversation_id: conversation.id, input: 'hello' });

    expect(harness.starts[0][8]).not.toHaveProperty('conversationContext');
    expect(harness.starts[0][2]).toBe('hello');
  });

  it('keeps generated presets out of runtime context while preserving explicit user context', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create({
      ...params(),
      extra: {
        ...params().extra,
        surface: 'ide',
        preset_context: '## IDE workspace guide\nWorkspace root: C:\\workspace',
        preset_rules: 'Use ide_* tools for repository work.',
        tomny_custom_context: 'Answer in concise Vietnamese.',
        tomny_context_branches: [
          { id: 'release', title: 'Release', summary: 'Current work', content: 'Preserve the native cutover.' },
        ],
        selected_session_mcp_servers: [
          {
            id: 'browser-control',
            name: 'tomny-browser-control',
            transport: { type: 'sse', url: 'http://127.0.0.1:4200/sse' },
          },
        ],
        session_mcp_servers: [
          {
            id: 'cloud-tools',
            name: 'cloud-tools',
            transport: { type: 'sse', url: 'https://relay.example/mcp/sse' },
          },
        ],
        unrelated_secret: 'must-not-enter-runtime-context',
      },
    });

    await harness.service.send({ conversation_id: conversation.id, input: 'inspect this project' });

    const identity = harness.starts[0][8];
    expect(identity?.conversationContext).not.toContain('Workspace root: C:\\workspace');
    expect(identity?.conversationContext).not.toContain('Use ide_* tools for repository work.');
    expect(identity?.conversationContext).toContain('Answer in concise Vietnamese.');
    expect(identity?.conversationContext).toContain('Preserve the native cutover.');
    expect(identity?.conversationContext).not.toContain('must-not-enter-runtime-context');
    expect(identity?.mcpServers).toEqual([
      { name: 'tomny-browser-control', transport: 'sse', url: 'http://127.0.0.1:4200/sse', headers: [] },
      { name: 'cloud-tools', transport: 'sse', url: 'https://relay.example/mcp/sse', headers: [] },
    ]);
    expect(harness.starts[0][2]).toBe('inspect this project');
  });

  it('excludes workspace secret metadata and values from context inspection and runtime identity', async () => {
    const harness = await createHarness();
    const secretAlias = 'DEPLOYMENT_TOKEN';
    const secretValue = 'must-not-be-model-visible';
    const conversation = await harness.service.create({
      ...params(),
      extra: {
        ...params().extra,
        repository_secret_alias: secretAlias,
        repository_secret_value: secretValue,
      },
    });

    const snapshot = await harness.service.getSessionContext(conversation.id);

    expect(JSON.stringify(snapshot)).not.toContain(secretAlias);
    expect(JSON.stringify(snapshot)).not.toContain(secretValue);

    await harness.service.send({ conversation_id: conversation.id, input: 'deploy the release' });

    const runtimeContext = harness.starts[0][8];
    expect(runtimeContext?.conversationContext ?? '').not.toContain(secretAlias);
    expect(runtimeContext?.conversationContext ?? '').not.toContain(secretValue);
    expect(runtimeContext?.savedMemoryContext ?? '').not.toContain(secretAlias);
    expect(runtimeContext?.savedMemoryContext ?? '').not.toContain(secretValue);
  });
  it('cancels the exact active runtime request and rejects concurrent sends', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'first' });
    const requestId = harness.starts[0][0];

    await expect(harness.service.send({ conversation_id: conversation.id, input: 'second' })).rejects.toThrow(
      'already generating'
    );
    await harness.service.cancel(conversation.id);

    expect(harness.cancels).toEqual([requestId]);
  });

  it('settles a conversation when Foundation rejects before the Core runtime starts', async () => {
    const harness = await createHarness(
      undefined,
      undefined,
      Promise.resolve({ type: 'error', text: 'TARGET_DENIED' })
    );
    const conversation = await harness.service.create(params());

    await harness.service.send({ conversation_id: conversation.id, input: 'blocked before Core' });

    await vi.waitFor(() =>
      expect(harness.completions.at(-1)).toMatchObject({ session_id: conversation.id, state: 'error' })
    );
    expect(harness.responses).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'error' })]));
    expect(await harness.service.get(conversation.id)).toMatchObject({ status: 'finished' });
  });

  it('removes messages with the conversation and returns cursor pagination', async () => {
    const harness = await createHarness();
    const first = await harness.service.create(params());
    const second = await harness.service.create({ ...params(), name: 'Second' });

    const page = await harness.service.list(second.id, 10);
    expect(page.items.map((item) => item.id)).toContain(first.id);

    await harness.service.remove(first.id);
    expect(await harness.service.get(first.id)).toBeUndefined();
    expect(harness.changes.at(-1)).toEqual({ conversation_id: first.id, action: 'deleted' });
  });
  it('keeps shell operations on the native Main bridge', async () => {
    const source = await readFile(path.join(process.cwd(), 'packages/desktop/src/common/adapter/ipcBridge.ts'), 'utf8');
    expect(source).not.toContain('/api/shell/');
    expect(source).not.toContain('/api/system/info');
    expect(source).not.toContain('/api/star-office/detect');
    expect(source).toContain('shell.open-file');
    expect(source).toContain('shell.open-folder-with');
    expect(source).toContain('app.system-info');
    expect(source).toContain('star-office.detect');
  });
});

const createProductionLikePolicy = (): TurnNotePolicy => createTurnNotePolicy({ sanitize: sanitizeNoteText });

describe('turn notes for turns without StartAction', () => {
  const finishTurn = async (
    harness: Awaited<ReturnType<typeof createHarness>>,
    conversationId: string,
    input: string,
    answer: string
  ): Promise<void> => {
    await harness.service.send({ conversation_id: conversationId, input });
    const requestId = harness.starts.at(-1)![0];
    harness.service.handleCoreEvent(coreEvent(requestId, conversationId, 'delta', { text: answer, mode: 'append' }));
    harness.service.handleCoreEvent(coreEvent(requestId, conversationId, 'completed'));
    await vi.waitFor(() => expect(harness.service.activeCount()).toBe(0));
  };

  const setup = async (turnNotes = createTurnNotePolicy({ sanitize: async (text) => text })) => {
    const memory = createSessionMemoryStore({ summarizer: async () => 'compacted Save' });
    const harness = await createHarness(undefined, memory, undefined, turnNotes);
    const conversation = await harness.service.create({
      ...params(),
      extra: { ...params().extra, ide_memory_id: 'turn-notes' },
    });
    return { memory, harness, conversation };
  };

  it('remembers a substantive answer but not small talk', async () => {
    const { memory, harness, conversation } = await setup();

    await finishTurn(harness, conversation.id, 'hello', 'Hello!');
    expect(memory.snapshot('turn-notes').items).toEqual([]);

    await finishTurn(
      harness,
      conversation.id,
      'How should we store the retry state? Never keep it in localStorage.',
      'Keep the retry state in src/retry/state.ts and persist it through the session store. Do not use localStorage because the window can be cleared.'
    );
    const notes = memory.snapshot('turn-notes').items;
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain('src/retry/state.ts');
    expect(notes[0].text).toContain('[msg:');
  });

  it('hands the newest note to a follow-up that shares no words with it', async () => {
    const { harness, conversation } = await setup();
    await finishTurn(
      harness,
      conversation.id,
      'Where does the retry state live? Never use localStorage.',
      'It lives in src/retry/state.ts and is saved by the session store. Do not use localStorage.'
    );

    await harness.service.send({ conversation_id: conversation.id, input: 'go ahead' });
    const identity = harness.starts.at(-1)![8];
    expect(identity?.savedMemoryContext).toContain('src/retry/state.ts');
  });

  it('keeps what was asked, not an answer, when a turn failed, so a later "continue" has something to continue', async () => {
    const { memory, harness, conversation } = await setup();
    await harness.service.send({
      conversation_id: conversation.id,
      input: 'Explain the retry design in src/retry/state.ts and never use localStorage.',
    });
    const requestId = harness.starts.at(-1)![0];
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'delta', {
        text: 'The design keeps state in src/retry/state.ts.',
        mode: 'append',
      })
    );
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'error', { text: 'provider failed' }));
    await vi.waitFor(() => expect(harness.service.activeCount()).toBe(0));

    const notes = memory.snapshot('turn-notes').items;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'todo' });
    expect(notes[0].text).toContain('Unfinished request');
    expect(notes[0].text).toContain('Explain the retry design');

    // The automatic resume says nothing about the task, yet it reaches the model together with what was asked.
    await harness.service.send({
      conversation_id: conversation.id,
      input:
        'Hãy tiếp tục công việc đang dở từ chỗ bị gián đoạn. / Continue the unfinished work from where it was interrupted.',
    });
    expect(harness.starts.at(-1)![8]?.savedMemoryContext).toContain('Explain the retry design');
  });

  it('does not turn the automatic resume instruction into a task of its own when that turn is interrupted too', async () => {
    const { memory, harness, conversation } = await setup();
    await harness.service.send({
      conversation_id: conversation.id,
      input:
        'Hãy tiếp tục công việc đang dở từ chỗ bị gián đoạn. / Continue the unfinished work from where it was interrupted.',
    });
    const requestId = harness.starts.at(-1)![0];
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'error', { text: 'provider failed' }));
    await vi.waitFor(() => expect(harness.service.activeCount()).toBe(0));
    expect(memory.snapshot('turn-notes').items).toEqual([]);
  });

  it('removes a secret that the answer repeated before it reaches the Save', async () => {
    const { memory, harness, conversation } = await setup(createProductionLikePolicy());
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    await finishTurn(
      harness,
      conversation.id,
      'Which file configures the deploy? Never commit the token.',
      `The deploy is configured in src/deploy/config.ts. The token ${token} must never be committed.`
    );
    const notes = memory.snapshot('turn-notes').items;
    expect(notes).toHaveLength(1);
    expect(notes[0].text).not.toContain(token);
    expect(notes[0].text).toContain('src/deploy/config.ts');
  });

  it('also cleans an action capsule', async () => {
    const { memory, harness, conversation } = await setup(createProductionLikePolicy());
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    await harness.service.send({ conversation_id: conversation.id, input: 'trace the deploy flow' });
    const requestId = harness.starts.at(-1)![0];
    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'tool-call', {
        tool: 'StartAction',
        callId: 'gate-1',
        input: { goal: `Trace the deploy flow using ${token}` },
      })
    );
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'delta', { text: 'Done.', mode: 'append' }));
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'completed'));
    await vi.waitFor(() => expect(harness.service.activeCount()).toBe(0));
    const capsule = memory.snapshot('turn-notes').items.find((item) => item.text.includes('Action capsule'));
    expect(capsule).toBeDefined();
    expect(capsule?.text).not.toContain(token);
  });
});

describe('config notices', () => {
  it('shows a changed model or mode as its own notice, not as thinking, and does not store it', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'hello' });
    const requestId = harness.starts.at(-1)![0];

    harness.service.handleCoreEvent(
      coreEvent(requestId, conversation.id, 'notice', {
        text: 'config updated: model: ag/a → ag/b\nmode updated: default',
      })
    );
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'thinking', { text: 'Reading the project' }));
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'completed'));
    await vi.waitFor(() => expect(harness.service.activeCount()).toBe(0));

    const tips = harness.responses.filter((response) => response.type === 'tips');
    expect(tips).toHaveLength(1);
    expect(tips[0].data).toEqual({
      content: 'config updated: model: ag/a → ag/b\nmode updated: default',
      type: 'success',
    });

    const thinking = harness.responses.filter((response) => response.type === 'thinking');
    expect(JSON.stringify(thinking)).not.toContain('config updated');
    expect(JSON.stringify(thinking)).toContain('Reading the project');

    const stored = await harness.repository.listMessages(conversation.id);
    expect(JSON.stringify(stored)).not.toContain('config updated');
  });

  it('ignores an empty notice', async () => {
    const harness = await createHarness();
    const conversation = await harness.service.create(params());
    await harness.service.send({ conversation_id: conversation.id, input: 'hello' });
    const requestId = harness.starts.at(-1)![0];
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'notice', { text: '   ' }));
    harness.service.handleCoreEvent(coreEvent(requestId, conversation.id, 'completed'));
    await vi.waitFor(() => expect(harness.service.activeCount()).toBe(0));
    expect(harness.responses.filter((response) => response.type === 'tips')).toHaveLength(0);
  });
});
