import { describe, expect, it, vi } from 'vitest';
import {
  NativeConversationService,
  type NativeConversationRuntime,
} from '../../../packages/desktop/src/process/services/database/nativeConversation/service';
import type { NativeConversationRepository } from '../../../packages/desktop/src/process/services/database/nativeConversation/repository';
import type { ExperimentalCoreEvent } from '../../../packages/desktop/src/process/experimentalCore/experimentalCoreProtocol';

describe('native completed output processing', () => {
  const setup = (onSave?: (message: unknown) => Promise<void>) => {
    const conversation = {
      id: 'c',
      type: 'tomny',
      source: 'test',
      extra: { workspace: 'C:/workspace' } as Record<string, unknown>,
    };
    const saved: unknown[] = [];
    const saveMessage = vi.fn(async (message: unknown) => {
      saved.push(structuredClone(message));
      await onSave?.(message);
    });
    const repository = {
      getConversation: vi.fn(async () => conversation),
      saveConversation: vi.fn(async () => undefined),
      saveMessage,
    } as unknown as NativeConversationRepository;
    let requestId = '';
    const runtime = {
      start: vi.fn((id: string) => {
        requestId = id;
        return { requestId: id, sessionId: 'c' };
      }),
      cancel: vi.fn(async () => true),
      listModels: vi.fn(async () => [] as Array<{ modelId: string; label: string }>),
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
    return { service, runtime, repository, conversation, events, saved, saveMessage, emit };
  };

  it('refuses an already-cancelled preflight before persisting or contacting the model', async () => {
    const { service, runtime, saveMessage, events } = setup();
    const controller = new AbortController();
    controller.abort(new Error('CHAT_PIPELINE_CANCELLED'));
    await expect(service.send({ conversation_id: 'c', input: 'hello' }, undefined, controller.signal)).rejects.toThrow(
      'CHAT_PIPELINE_CANCELLED'
    );
    expect(saveMessage).not.toHaveBeenCalled();
    expect(runtime.start).not.toHaveBeenCalled();
    expect(events.response).not.toHaveBeenCalled();
  });

  it('checks preflight cancellation after asynchronous persistence, before runtime dispatch', async () => {
    const controller = new AbortController();
    const { service, runtime, events } = setup(async () => {
      controller.abort(new Error('CHAT_PIPELINE_CANCELLED'));
    });
    await expect(service.send({ conversation_id: 'c', input: 'hello' }, undefined, controller.signal)).rejects.toThrow(
      'CHAT_PIPELINE_CANCELLED'
    );
    expect(runtime.start).not.toHaveBeenCalled();
    expect(events.response.mock.calls.filter(([event]) => event.type === 'content')).toHaveLength(0);
  });

  it('cancels an admitted turn while status persistence waits, without starting the model', async () => {
    let enteredSave: (() => void) | undefined;
    let releaseSave: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredSave = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const { service, runtime, repository, events } = setup();
    vi.mocked(repository.saveConversation).mockImplementationOnce(async () => {
      enteredSave?.();
      await waiting;
    });
    const pending = service.send({ conversation_id: 'c', input: 'hello' });
    await entered;
    await service.cancel('c');
    releaseSave?.();
    await expect(pending).rejects.toThrow('CHAT_PIPELINE_CANCELLED');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('stopped');
    expect(runtime.start).not.toHaveBeenCalled();
    expect(service.activeCount()).toBe(0);
  });

  it('only applies a proposed model after Main confirms its exact live ID', async () => {
    const { service, runtime } = setup();
    vi.mocked(runtime.listModels).mockResolvedValue([{ modelId: 'verified-model', label: 'Verified' }]);
    await service.send({ conversation_id: 'c', input: 'hello' }, undefined, undefined, 'verified-model');
    expect(runtime.listModels).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runtime.start).mock.calls[0]?.[4]).toBe('verified-model');
  });

  it('rejects an unknown advisor suggestion and keeps the native default', async () => {
    const { service, runtime } = setup();
    vi.mocked(runtime.listModels).mockResolvedValue([{ modelId: 'verified-model', label: 'Verified' }]);
    await service.send({ conversation_id: 'c', input: 'hello' }, undefined, undefined, 'forged-model');
    expect(vi.mocked(runtime.start).mock.calls[0]?.[4]).toBeUndefined();
  });

  it('preserves the user selected model without consulting the auto advisor', async () => {
    const { service, runtime, conversation } = setup();
    conversation.extra.tomny_core_model_key = 'explicit-model';
    await service.send({ conversation_id: 'c', input: 'hello' }, undefined, undefined, 'proposed-model');
    expect(runtime.listModels).not.toHaveBeenCalled();
    expect(vi.mocked(runtime.start).mock.calls[0]?.[4]).toBe('explicit-model');
  });

  it('uses runtime default without dispatching another provider when the model catalog is unavailable', async () => {
    const { service, runtime } = setup();
    vi.mocked(runtime.listModels).mockRejectedValue(new Error('offline'));
    await service.send({ conversation_id: 'c', input: 'hello' }, undefined, undefined, 'candidate');
    expect(vi.mocked(runtime.start).mock.calls[0]?.[4]).toBeUndefined();
  });

  it('persists and replaces an intentionally empty completed assistant response', async () => {
    const { service, events, saved, emit } = setup();
    await service.send({ conversation_id: 'c', input: 'hello' }, async () => '');
    emit('delta', 'temporary');
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('ai_waiting_input');
    expect(events.turnCompleted.mock.calls[0][0].last_message.content.content).toBe('');
    expect(events.response.mock.calls.some(([event]) => event.replace === true && event.data.content === '')).toBe(
      true
    );
    expect(JSON.stringify(saved)).toContain('"content":""');
  });

  it('buffers a guarded answer until the verdict, then persists and publishes only sanitized text', async () => {
    const { service, events, saved, emit } = setup();
    await service.send(
      { conversation_id: 'c', input: 'hello' },
      async () => '[SAFE_ANSWER]',
      undefined,
      undefined,
      true
    );
    emit('delta', 'unreviewed-private-answer');
    await vi.waitFor(() => expect(events.response.mock.calls.some(([event]) => event.type === 'start')).toBe(false));
    // Core events are queued; completion is strictly ordered after the private delta.
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(events.response.mock.calls)).not.toContain('unreviewed-private-answer');
    expect(JSON.stringify(saved)).not.toContain('unreviewed-private-answer');
    expect(JSON.stringify(saved)).toContain('[SAFE_ANSWER]');
    expect(events.response.mock.calls.filter(([event]) => event.replace === true)).toHaveLength(1);
    expect(events.turnCompleted.mock.calls[0]?.[0].state).toBe('ai_waiting_input');
  });

  it('fails closed for a denying output guard without publishing or persisting model text', async () => {
    const { service, events, saved, emit } = setup();
    await service.send(
      { conversation_id: 'c', input: 'hello' },
      async () => {
        throw new Error('GUARD_BLOCKED');
      },
      undefined,
      undefined,
      true
    );
    emit('delta', 'private-guard-denial-payload');
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0]?.[0].state).toBe('error');
    expect(JSON.stringify(events.response.mock.calls)).not.toContain('private-guard-denial-payload');
    expect(JSON.stringify(saved)).not.toContain('private-guard-denial-payload');
    expect(events.response.mock.calls.some(([event]) => event.replace === true)).toBe(false);
  });

  it('fails a guarded turn at the byte cap without ever displaying or storing its overflow', async () => {
    const { service, runtime, events, saved, emit } = setup();
    const processor = vi.fn(async (text: string) => text);
    await service.send({ conversation_id: 'c', input: 'hello' }, processor, undefined, undefined, true);
    emit('delta', 'SECRET_GUARD_OVERFLOW'.repeat(16_000));
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0]?.[0].state).toBe('error');
    expect(runtime.cancel).toHaveBeenCalledTimes(1);
    expect(processor).not.toHaveBeenCalled();
    expect(JSON.stringify(events.response.mock.calls)).not.toContain('SECRET_GUARD_OVERFLOW');
    expect(JSON.stringify(saved)).not.toContain('SECRET_GUARD_OVERFLOW');
  });

  it('does not leak interactive model events while a guarded answer is buffered', async () => {
    const { service, runtime, events, saved, emit } = setup();
    const processor = vi.fn(async (text: string) => text);
    await service.send({ conversation_id: 'c', input: 'hello' }, processor, undefined, undefined, true);
    emit('delta', 'PRIVATE_PROPOSAL');
    emit('orchestration-proposal', 'PRIVATE_PROPOSAL');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('error');
    expect(runtime.cancel).toHaveBeenCalledTimes(1);
    expect(processor).not.toHaveBeenCalled();
    expect(JSON.stringify(events.response.mock.calls)).not.toContain('PRIVATE_PROPOSAL');
    expect(JSON.stringify(saved)).not.toContain('PRIVATE_PROPOSAL');
  });

  it('blocks an output processor that expands a guarded answer past the byte limit', async () => {
    const { service, events, saved, emit } = setup();
    await service.send(
      { conversation_id: 'c', input: 'hello' },
      async () => 'UNSAFE_EXPANSION'.repeat(20_000),
      undefined,
      undefined,
      true
    );
    emit('delta', 'bounded-initial');
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('error');
    expect(JSON.stringify(events.response.mock.calls)).not.toContain('UNSAFE_EXPANSION');
    expect(JSON.stringify(saved)).not.toContain('UNSAFE_EXPANSION');
  });

  it('keeps the guarded approved message durably saved when renderer replace fails', async () => {
    const { service, events, saved, emit } = setup();
    events.response.mockImplementation((event) => {
      if (event.type === 'content' && event.replace === true) throw new Error('renderer-disconnected');
    });
    await service.send(
      { conversation_id: 'c', input: 'hello' },
      async () => 'persisted-approved',
      undefined,
      undefined,
      true
    );
    emit('delta', 'private-unreviewed');
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('error');
    expect(JSON.stringify(saved)).toContain('persisted-approved');
    expect(JSON.stringify(saved)).not.toContain('private-unreviewed');
    expect(service.activeCount()).toBe(0);
  });

  it('bounds adapter cancellation and settles the turn once even if the runtime never replies', async () => {
    const { service, runtime, events, emit } = setup();
    vi.mocked(runtime.cancel).mockImplementation(async () => new Promise<boolean>(() => undefined));
    await service.send({ conversation_id: 'c', input: 'hello' });
    await service.cancel('c');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0]?.[0].state).toBe('stopped');
    emit('completed');
    emit('delta', 'late-raw-answer');
    expect(events.turnCompleted).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(events.response.mock.calls)).not.toContain('late-raw-answer');
    expect(service.activeCount()).toBe(0);
  });

  it('persists and publishes the rewritten output once despite duplicate completion and late deltas', async () => {
    const { service, events, saved, saveMessage, emit } = setup();
    const processor = vi.fn(async (text: string) => `checked:${text}`);
    await service.send({ conversation_id: 'c', input: 'hello' }, processor);
    emit('delta', 'answer');
    emit('completed');
    emit('completed');
    emit('delta', 'late');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(processor).toHaveBeenCalledTimes(1);
    expect(processor.mock.calls[0][0]).toBe('answer');
    expect(JSON.stringify(saved)).toContain('checked:answer');
    const persisted = saveMessage.mock.calls.findIndex(([message]) =>
      JSON.stringify(message).includes('checked:answer')
    );
    const replaced = events.response.mock.calls.findIndex(([event]) => event.replace === true);
    expect(persisted).toBeGreaterThanOrEqual(0);
    expect(replaced).toBeGreaterThanOrEqual(0);
    expect(saveMessage.mock.invocationCallOrder[persisted]).toBeLessThan(
      events.response.mock.invocationCallOrder[replaced]!
    );
    expect(events.response.mock.calls.filter(([event]) => event.type === 'finish')).toHaveLength(1);
    expect(events.turnCompleted.mock.calls[0][0].last_message.content.content).toBe('checked:answer');
  });

  it('closes processor failure as error', async () => {
    const { service, events, emit } = setup();
    await service.send({ conversation_id: 'c', input: 'hello' }, async () => {
      throw new Error('blocked');
    });
    emit('delta', 'answer');
    emit('completed');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('error');
    expect(service.activeCount()).toBe(0);
  });

  it('cancels a pending output processor and never publishes its late rewrite', async () => {
    const { service, events, emit } = setup();
    let release: (text: string) => void = () => undefined;
    const processor = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        })
    );
    await service.send({ conversation_id: 'c', input: 'hello' }, processor);
    emit('delta', 'answer');
    emit('completed');
    await vi.waitFor(() => expect(processor).toHaveBeenCalledTimes(1));
    await service.cancel('c');
    release('must-not-publish');
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('stopped');
    expect(JSON.stringify(events.response.mock.calls)).not.toContain('must-not-publish');
  });

  it('never publishes a late replacement when cancelled during its persistence', async () => {
    let enterSave: (() => void) | undefined;
    let releaseSave: (() => void) | undefined;
    const saving = new Promise<void>((resolve) => {
      enterSave = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const { service, events, emit } = setup(async (message) => {
      if (JSON.stringify(message).includes('checked:answer')) {
        enterSave?.();
        await held;
      }
    });
    await service.send({ conversation_id: 'c', input: 'hello' }, async (text) => `checked:${text}`);
    emit('delta', 'answer');
    emit('completed');
    await saving;
    await service.cancel('c');
    releaseSave?.();
    await vi.waitFor(() => expect(events.turnCompleted).toHaveBeenCalledTimes(1));
    expect(events.turnCompleted.mock.calls[0][0].state).toBe('stopped');
    expect(events.response.mock.calls.filter(([event]) => event.replace === true)).toHaveLength(0);
  });
});
