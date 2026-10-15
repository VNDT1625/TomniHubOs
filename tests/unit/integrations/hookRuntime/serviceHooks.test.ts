import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICreateConversationParams } from '@/common/adapter/ipcBridge';
import {
  configureHookRuntime,
  drainHookContext,
  queuedHookContextSessions,
  resolveHookConversation,
} from '@process/integrations/hookRuntime/hookDispatcher';
import {
  NativeConversationRepository,
  NativeConversationService,
  type NativeConversationRuntime,
} from '@process/services/database/nativeConversation';
import { createHookWorld, readRecords, type HookWorld } from './hookTestKit';

/**
 * SessionStart / SessionEnd and the conversation lookup used by the UserPromptSubmit stage, through the real
 * NativeConversationService with real hook processes.
 */

let world: HookWorld;
const directories: string[] = [];

beforeEach(async () => {
  world = await createHookWorld();
  configureHookRuntime({ registry: async () => world.registry });
});

afterEach(async () => {
  configureHookRuntime();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const record = (name: string): string => `${world.dir}/${name}.jsonl`;

const makeService = async (repository?: NativeConversationRepository) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-svc-hooks-'));
  directories.push(directory);
  const repo = repository ?? new NativeConversationRepository(path.join(directory, 'conversations.json'));
  const starts: unknown[][] = [];
  const runtime = {
    start: (...args: unknown[]) => {
      starts.push(args);
      return { requestId: String(args[0]), sessionId: String(args[6]) };
    },
    cancel: async () => true,
    resolvePermission: async () => true,
    resolveOrchestrationProposal: async () => true,
  } as unknown as NativeConversationRuntime;
  const service = new NativeConversationService(repo, runtime, {
    response: () => undefined,
    turnCompleted: () => undefined,
    listChanged: () => undefined,
  });
  return { service, repo, starts };
};

const params = (): ICreateConversationParams => ({
  type: 'acp',
  name: 'Hooked chat',
  model: {
    id: 'provider-1',
    platform: 'openai',
    name: 'router',
    base_url: 'https://example.invalid',
    api_key: 'secret',
    use_model: 'gpt-test',
  },
  extra: { workspace: world.workspace, backend: 'claude', current_model_id: 'claude-test', surface: 'ide' },
});

describe('conversation lifecycle hooks', { timeout: 60_000 }, () => {
  it('fires SessionStart once on create and hands its context to the first turn through the queue', async () => {
    await world.install({
      event: 'SessionStart',
      spec: { record: record('start'), stdout: 'Repo rule: no semicolons.' },
    });
    const { service } = await makeService();
    const conversation = await service.create(params());
    await vi.waitFor(async () => expect(await readRecords(record('start'))).toHaveLength(1), { timeout: 20_000 });
    const [seen] = await readRecords(record('start'));
    expect(seen).toMatchObject({ hook_event_name: 'SessionStart', source: 'startup', session_id: conversation.id });
    // The record is written when the script starts; its answer is queued a moment later.
    await vi.waitFor(() => expect(queuedHookContextSessions()).toBe(1), { timeout: 20_000 });
    expect(await drainHookContext(conversation.id)).toContain('Repo rule: no semicolons.');
  });

  it('a conversation opened after a restart fires SessionStart as "resume" on its first message, and only once', async () => {
    const first = await makeService();
    const conversation = await first.service.create(params());
    const second = await makeService(first.repo);
    await world.install({ event: 'SessionStart', spec: { record: record('resume'), stdout: 'Welcome back.' } });
    await second.service.send({ conversation_id: conversation.id, input: 'hello again', loading_id: 'm1' });
    const afterSend = await readRecords(record('resume'));
    expect(afterSend).toHaveLength(1);
    expect(afterSend[0]).toMatchObject({ source: 'resume' });
    // The first turn was composed after the hook ran, so its context is waiting for the runtime to take it.
    expect(await drainHookContext(conversation.id)).toContain('Welcome back.');
    expect(second.starts).toHaveLength(1);
  });

  it('a slow SessionStart hook never holds the first message beyond its wait budget', async () => {
    const { service } = await makeService();
    const conversation = await service.create(params());
    await world.install({
      event: 'SessionStart',
      timeoutSec: 30,
      spec: { record: record('slow-start'), sleepMs: 12_000 },
    });
    // The create-time run already finished (no hooks were installed then); a fresh service starts again.
    const restarted = await makeService(
      (service as unknown as { repository: NativeConversationRepository }).repository
    );
    const started = Date.now();
    await restarted.service.send({ conversation_id: conversation.id, input: 'go', loading_id: 'm2' });
    expect(Date.now() - started).toBeLessThan(11_500);
    expect(restarted.starts).toHaveLength(1);
  });

  it('fires SessionEnd when the conversation is removed', async () => {
    await world.install({ event: 'SessionEnd', spec: { record: record('end') } });
    const { service } = await makeService();
    const conversation = await service.create(params());
    expect(await service.remove(conversation.id)).toBe(true);
    await vi.waitFor(async () => expect(await readRecords(record('end'))).toHaveLength(1), { timeout: 20_000 });
    expect((await readRecords(record('end')))[0]).toMatchObject({
      hook_event_name: 'SessionEnd',
      session_id: conversation.id,
    });
  });

  it('tells the prompt stage the workspace, mode and core session of a conversation (Main-owned lookup)', async () => {
    const { service } = await makeService();
    const conversation = await service.create(params());
    const turn = await resolveHookConversation(conversation.id);
    expect(turn).toMatchObject({
      sessionId: conversation.id,
      conversationId: conversation.id,
      workspaceDir: world.workspace,
      permissionMode: 'workspace-write',
    });
    expect(await resolveHookConversation('missing-conversation')).toBeUndefined();
  });
});
