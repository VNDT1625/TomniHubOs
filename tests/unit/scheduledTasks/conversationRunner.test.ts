/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ICreateConversationParams } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import {
  LegacyCronAdapter,
  MemoryCoreScheduleStore,
  createCoreScheduledTaskService,
  createRunConversationTracker,
  createScheduledConversationRunner,
  type CoreScheduleRunInput,
  type ScheduledConversationPort,
} from '@/process/cron/scheduledTasks';

type Listener = (event: { kind: string; payload: unknown }) => void;

const fakePort = () => {
  const conversations = new Map<string, TChatConversation>();
  const listeners = new Set<Listener>();
  const emit = (kind: string, payload: unknown) => {
    for (const listener of listeners) listener({ kind, payload });
  };
  const complete = (id: string, state = 'ai_waiting_input', detail = '') =>
    emit('conversation.completed', { session_id: id, state, detail });
  let created = 0;
  const port = {
    get: vi.fn(async (id: string) => conversations.get(id)),
    create: vi.fn(async (params: ICreateConversationParams) => {
      const conversation = { id: `conv-${++created}`, name: params.name, extra: params.extra } as TChatConversation;
      conversations.set(conversation.id, conversation);
      return conversation;
    }),
    send: vi.fn(async (_params: { conversation_id: string; input: string; model_input?: string }) => ({ msg_id: 'm' })),
    cancel: vi.fn(async () => undefined),
    resolvePermission: vi.fn(async () => true),
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies ScheduledConversationPort;
  return { port, conversations, emit, complete, listeners };
};

const input = (patch: Partial<CoreScheduleRunInput['target']> = {}, runId = 'run-1'): CoreScheduleRunInput => ({
  runId,
  taskId: 'task-1',
  scheduledFor: new Date(2026, 9, 5, 9, 0).getTime(),
  attempt: 1,
  signal: new AbortController().signal,
  target: {
    targetId: 'tomny',
    prompt: 'Summarize the news',
    workspace: 'C:\\work',
    modelKey: 'app-provider:p1:gpt',
    permissionMode: 'full-access',
    unattendedPermissionPolicy: 'allow-granted',
    surface: 'ide',
    agentId: 'scheduled:task-1',
    personalId: 'default',
    permissionScopes: ['workspace.*'],
    capabilityGrants: ['surface.ide'],
    availableCapabilities: ['surface.ide'],
    modelCapabilities: ['tools'],
    ...patch,
  },
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('scheduled conversation runner', () => {
  it('opens a conversation tagged with the task and finishes when its turn completes', async () => {
    const fake = fakePort();
    const onConversation = vi.fn();
    const runner = createScheduledConversationRunner({
      port: fake.port,
      describe: async () => ({ name: 'Morning news' }),
      skillFor: async () => 'Use bullet points.',
      onConversation,
    });

    const running = runner.run(input());
    await tick();
    const params = fake.port.create.mock.calls[0]?.[0];
    expect(params?.type).toBe('tomnyagentic');
    expect(params?.name).toBe('Morning news · 2026-10-05 09:00');
    expect(params?.extra).toMatchObject({
      workspace: 'C:\\work',
      cron_job_id: 'task-1',
      tomny_core_target_id: 'tomny',
      tomny_core_model_key: 'app-provider:p1:gpt',
      sandboxMode: 'danger-full-access',
    });
    expect(onConversation).toHaveBeenCalledWith('task-1', 'conv-1');
    expect(fake.port.send).toHaveBeenCalledWith({
      conversation_id: 'conv-1',
      input: 'Summarize the news',
      model_input: 'Summarize the news\n\n## Saved skill for this scheduled task\nUse bullet points.',
    });

    fake.complete('other');
    fake.complete('conv-1');
    await expect(running).resolves.toBeUndefined();
    expect(fake.listeners.size).toBe(0);
  });

  it('continues in the linked conversation and reuses the run conversation on retry', async () => {
    const fake = fakePort();
    fake.conversations.set('existing', { id: 'existing', extra: {} } as TChatConversation);
    const runner = createScheduledConversationRunner({ port: fake.port, describe: async () => undefined });

    const linked = runner.run(input({ sessionId: 'existing' }));
    await tick();
    fake.complete('existing');
    await linked;
    expect(fake.port.create).not.toHaveBeenCalled();

    const first = runner.run(input({}, 'run-2'));
    await tick();
    fake.complete('conv-1', 'error', 'model offline');
    await expect(first).rejects.toThrow('model offline');
    const retry = runner.run({ ...input({}, 'run-2'), attempt: 2 });
    await tick();
    fake.complete('conv-1');
    await retry;
    expect(fake.port.create).toHaveBeenCalledTimes(1);
  });

  it('answers permission requests with the task policy', async () => {
    const fake = fakePort();
    const runner = createScheduledConversationRunner({ port: fake.port, describe: async () => undefined });
    const allowed = runner.run(input());
    await tick();
    fake.emit('conversation.response', {
      conversation_id: 'conv-1',
      type: 'permission',
      data: { native_core_permission_id: 'p1', title: 'workspace.write' },
    });
    fake.emit('conversation.response', {
      conversation_id: 'conv-1',
      type: 'permission',
      data: { native_core_permission_id: 'p2', title: 'shell.exec' },
    });
    await tick();
    expect(fake.port.resolvePermission).toHaveBeenNthCalledWith(1, 'p1', true);
    expect(fake.port.resolvePermission).toHaveBeenNthCalledWith(2, 'p2', false);
    fake.complete('conv-1');
    await allowed;

    fake.port.resolvePermission.mockResolvedValueOnce(false);
    const denied = runner.run(input({ unattendedPermissionPolicy: 'deny' }, 'run-3'));
    await tick();
    fake.emit('conversation.response', {
      conversation_id: 'conv-2',
      type: 'permission',
      data: { id: 'p3', title: 'workspace.write' },
    });
    await expect(denied).rejects.toThrow('expired');
    expect(fake.port.resolvePermission).toHaveBeenLastCalledWith('p3', false);
    expect(fake.port.cancel).toHaveBeenCalledWith('conv-2');
  });

  it('stops the conversation when the run is cancelled and fails when sending fails', async () => {
    const fake = fakePort();
    const runner = createScheduledConversationRunner({ port: fake.port, describe: async () => undefined });
    const controller = new AbortController();
    const running = runner.run({ ...input(), signal: controller.signal });
    await tick();
    controller.abort();
    await expect(running).rejects.toThrow('cancelled');
    expect(fake.port.cancel).toHaveBeenCalledWith('conv-1');

    fake.port.send.mockRejectedValueOnce(new Error('This conversation is already generating a response.'));
    await expect(runner.run(input({}, 'run-4'))).rejects.toThrow('already generating');
  });
});

describe('run now with a conversation runner', () => {
  let directory: string | undefined;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('returns the new conversation before the run ends', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'tomny-cron-run-'));
    const fake = fakePort();
    const tracker = createRunConversationTracker();
    let adapter!: LegacyCronAdapter;
    const service = createCoreScheduledTaskService({
      store: new MemoryCoreScheduleStore(),
      runner: createScheduledConversationRunner({
        port: fake.port,
        describe: (taskId) => service.get(taskId),
        skillFor: (taskId) => adapter.readSkill({ job_id: taskId }),
        onConversation: (taskId, conversationId) => tracker.started(taskId, conversationId),
      }),
    });
    await service.start();
    adapter = new LegacyCronAdapter({
      service,
      skillsDirectory: directory,
      defaultWorkspace: 'C:\\default',
      timezone: () => 'UTC',
      awaitRunConversation: (taskId) => tracker.next(taskId),
    });
    const job = await adapter.addJob({
      name: 'Digest',
      schedule: { kind: 'cron', expr: '', description: 'Manual' },
      message: 'Write the digest',
      conversation_id: '',
      agent_type: 'tomnyagentic',
      created_by: 'user',
    });
    await adapter.saveSkill({ job_id: job.id, content: 'Keep it short.' });

    await expect(adapter.runNow({ job_id: job.id })).resolves.toEqual({ conversation_id: 'conv-1' });
    await vi.waitFor(() => expect(fake.port.send.mock.calls[0]?.[0].model_input).toContain('Keep it short.'));
    expect((await service.get(job.id))?.runtime.lastStatus).toBe('running');
    fake.complete('conv-1');
    await vi.waitFor(async () => expect((await service.get(job.id))?.runtime.lastStatus).toBe('completed'));
    await service.stop();
  });
});

describe('scheduler resume after sleep', () => {
  it('re-arms timers and runs a task whose time passed while asleep', async () => {
    let clock = 1_000;
    const cancels: Array<ReturnType<typeof vi.fn>> = [];
    const armTimer = vi.fn((_at: number, _onFire: () => void) => {
      const cancel = vi.fn();
      cancels.push(cancel);
      return { cancel };
    });
    const run = vi.fn(async () => undefined);
    const service = createCoreScheduledTaskService({
      store: new MemoryCoreScheduleStore(),
      runner: { run },
      now: () => clock,
      armTimer,
    });
    await service.start();
    const task = await service.save({
      name: 'Every minute',
      enabled: true,
      schedule: { kind: 'interval', everyMs: 60_000, timezone: 'UTC' },
      overlapPolicy: 'skip',
      missedRunPolicy: 'run-once',
      retry: { maxAttempts: 1, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 },
      target: input().target,
    });
    expect(armTimer).toHaveBeenCalledTimes(1);

    clock += 10 * 60_000;
    await service.resume();
    expect(cancels[0]).toHaveBeenCalled();
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.id })));
    expect(armTimer.mock.calls.length).toBeGreaterThan(1);
    await service.stop();
  });
});
