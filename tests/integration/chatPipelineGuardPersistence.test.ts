/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '../../packages/desktop/src/common/config/storage';
import type { ExperimentalCoreEvent } from '../../packages/desktop/src/process/experimentalCore/experimentalCoreProtocol';
import {
  ChatPipelineExecutor,
  ChatStageRegistry,
  OutputSecurityStage,
} from '../../packages/desktop/src/process/services/chatPipeline';
import { NativeConversationRepository } from '../../packages/desktop/src/process/services/database/nativeConversation/repository';
import {
  NativeConversationService,
  type NativeConversationRuntime,
} from '../../packages/desktop/src/process/services/database/nativeConversation/service';

const createdDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const setup = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tomny-guard-persist-'));
  createdDirectories.push(dir);
  const filename = path.join(dir, 'conversation-state.json');
  const repository = new NativeConversationRepository(filename);
  await repository.saveConversation({
    id: 'c',
    type: 'tomny',
    source: 'test',
    extra: { workspace: 'C:/workspace' },
  } as TChatConversation);

  let requestId = '';
  const runtime = {
    start: vi.fn((id: string) => {
      requestId = id;
      return { requestId: id, sessionId: 'c' };
    }),
    cancel: vi.fn(async () => true),
  } as unknown as NativeConversationRuntime;
  const events = { response: vi.fn(), turnCompleted: vi.fn(), listChanged: vi.fn() };
  const service = new NativeConversationService(repository, runtime, events);
  const emit = (type: ExperimentalCoreEvent['type'], text?: string) =>
    service.handleCoreEvent({
      requestId,
      sessionId: 'c',
      targetId: 'tomny',
      type,
      text,
      timestamp: Date.now(),
      sequence: 1,
    });
  const reopen = () => new NativeConversationRepository(filename);
  return { service, events, emit, reopen, requestId: () => requestId };
};

describe('guarded native chat persistence across repository reload', () => {
  const processor = (mode: 'block' | 'redact') => {
    const registry = new ChatStageRegistry();
    registry.registerBuiltin(new OutputSecurityStage());
    const definition = registry.createDefaultDefinition();
    definition.stages.push({
      id: 'output-guard',
      stageRegistryId: 'builtin:output-security',
      phase: 'post_model',
      enabled: true,
      config: { mode },
    });
    const executor = new ChatPipelineExecutor(registry);
    return async (text: string, signal: AbortSignal): Promise<string> => {
      const result = await executor.execute({
        runId: 'guard-integrated',
        direction: 'output',
        query: text,
        definition,
        signal,
      });
      if (result.status !== 'completed') throw new Error('CHAT_OUTPUT_PROCESSING_FAILED');
      return result.finalQuery;
    };
  };

  it('integrates a real builtin guard and native persistence in redact mode', async () => {
    const { service, events, emit, reopen } = await setup();
    await service.send({ conversation_id: 'c', input: 'hello' }, processor('redact'), undefined, undefined, true);
    emit('delta', 'mk zalo: 123456');
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('ai_waiting_input');
    expect(JSON.stringify(await reopen().listMessages('c'))).not.toContain('123456');
    expect(JSON.stringify(events.response.mock.calls)).not.toContain('123456');
  });

  it('integrates a denying builtin guard and refuses raw disk or UI publication', async () => {
    const { service, events, emit, reopen } = await setup();
    await service.send({ conversation_id: 'c', input: 'hello' }, processor('block'), undefined, undefined, true);
    emit('delta', 'mk zalo: 123456');
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('error');
    expect(JSON.stringify(await reopen().listMessages('c'))).not.toContain('123456');
    expect(JSON.stringify(events.response.mock.calls)).not.toContain('123456');
  });

  it('persists only approved output and restores that same answer after reload', async () => {
    const { service, events, emit, reopen, requestId } = await setup();
    await service.send(
      { conversation_id: 'c', input: 'hello' },
      async () => 'approved-message',
      undefined,
      undefined,
      true
    );
    emit('delta', 'RAW_NEVER_PERSIST');
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    const messages = await reopen().listMessages('c');
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('approved-message');
    expect(serialized).not.toContain('RAW_NEVER_PERSIST');
    expect(messages.some((message) => message.id === `${requestId()}:assistant`)).toBe(true);
    expect(JSON.stringify(events.response.mock.calls)).not.toContain('RAW_NEVER_PERSIST');
  });

  it('does not persist rejected model output across a repository restart', async () => {
    const { service, events, emit, reopen, requestId } = await setup();
    await service.send(
      { conversation_id: 'c', input: 'hello' },
      async () => {
        throw new Error('GUARD_DENIED');
      },
      undefined,
      undefined,
      true
    );
    emit('delta', 'REJECTED_PRIVATE_MODEL_TEXT');
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('error');
    const messages = await reopen().listMessages('c');
    expect(JSON.stringify(messages)).not.toContain('REJECTED_PRIVATE_MODEL_TEXT');
    expect(messages.some((message) => message.id === `${requestId()}:assistant`)).toBe(false);
  });

  it('retains approved persisted output if renderer publication fails after the DB write', async () => {
    const { service, events, emit, reopen } = await setup();
    events.response.mockImplementation((event) => {
      if (event.type === 'content' && event.replace === true) throw new Error('renderer-unavailable');
    });
    await service.send(
      { conversation_id: 'c', input: 'hello' },
      async () => 'approved-but-not-emitted',
      undefined,
      undefined,
      true
    );
    emit('delta', 'RAW_UNCHECKED_CONTENT');
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('error');
    const persisted = JSON.stringify(await reopen().listMessages('c'));
    expect(persisted).toContain('approved-but-not-emitted');
    expect(persisted).not.toContain('RAW_UNCHECKED_CONTENT');
  });
});
