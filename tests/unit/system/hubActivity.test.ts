/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { HubActivityRegistry } from '@process/system/hubActivity/hubActivityRegistry';

import {
  attachConversationActivity,
  attachTerminalActivity,
  reportScheduledRun,
  reportTeamAgentStatus,
  type TerminalActivitySession,
} from '@process/system/hubActivity/hubActivitySources';

type Envelope = { kind: string; payload: unknown };

const createBus = () => {
  const listeners = new Set<(event: Envelope) => void>();
  return {
    subscribe: (listener: (event: Envelope) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    response: (payload: Record<string, unknown>) => {
      for (const listener of listeners) listener({ kind: 'conversation.response', payload });
    },
    list: (payload: Record<string, unknown>) => {
      for (const listener of listeners) listener({ kind: 'conversation.list', payload });
    },
  };
};

const createPort = () => ({
  get: vi.fn(async () => ({ name: 'Báo cáo Q3', extra: { workspace: 'C:/work/reports' } })),
  cancel: vi.fn(async () => undefined),
  resolvePermission: vi.fn(async () => true),
});

describe('HubActivityRegistry', () => {
  it('orders attention first and retains finished agent tiles', () => {
    let now = 1_000;
    const registry = new HubActivityRegistry({ now: () => now, finishedTtlMs: 100 });
    registry.upsert('agent', 'a', { status: 'running', startedAt: 1 });
    registry.upsert('agent', 'b', { status: 'needs_input', startedAt: 2 });
    registry.upsert('agent', 'c', { status: 'done', startedAt: 3 });
    expect(registry.snapshot().items.map((item) => item.sourceId)).toEqual(['b', 'a', 'c']);
    now += 500;
    registry.upsert('agent', 'a', { status: 'running' });
    expect(registry.snapshot().items.map((item) => item.sourceId)).toEqual(['b', 'a', 'c']);
  });

      it('keeps finished agent tiles until a user dismisses them, including after restart', () => {
    let now = 10_000;
    const registry = new HubActivityRegistry({ now: () => now, finishedTtlMs: 100, maxItems: 1 });
    registry.upsert('agent', 'kept', { status: 'done', title: 'Finished agent' });
    now += 10_000;
    registry.upsert('agent', 'new', { status: 'running' });
    expect(registry.snapshot().items.map((item) => item.sourceId)).toContain('kept');
    const restored = new HubActivityRegistry({ now: () => now + 50_000, finishedTtlMs: 100 });
    restored.hydrate(registry.snapshot().items);
    expect(restored.get('agent', 'kept')?.title).toBe('Finished agent');
    expect(restored.dismiss('agent:kept')).toBe(true);
    expect(restored.get('agent', 'kept')).toBeUndefined();
  });

  it('preserves Markdown line breaks and does not character-truncate normal previews', () => {
    const registry = new HubActivityRegistry();
    const preview = `# Tieu de\n${'a'.repeat(500)}`;
    registry.upsert('agent', 'a', { status: 'done', preview });

    expect(registry.get('agent', 'a')?.preview).toBe(preview);
  });

  it('bounds steps, text and the item count', () => {
    const registry = new HubActivityRegistry({ maxItems: 2 });
    for (let index = 0; index < 12; index += 1) {
      registry.step('agent', 'a', { id: `s${index}`, label: 'x'.repeat(500), state: 'done' });
    }
    const item = registry.get('agent', 'a');
    expect(item?.steps).toHaveLength(8);
    expect(item?.steps[0]?.id).toBe('s4');
    expect(item?.steps[0]?.label.length).toBeLessThanOrEqual(120);
    registry.upsert('agent', 'b', { status: 'done' });
    registry.upsert('agent', 'c', { status: 'running' });
    expect(
      registry
        .snapshot()
        .items.map((entry) => entry.sourceId)
        .toSorted()
        ).toEqual(['a', 'b', 'c']);
  });

  it('refuses stale prompt answers, unknown options and stopping finished work', async () => {
    const registry = new HubActivityRegistry();
    const respond = vi.fn(async () => true);
    const stop = vi.fn(async () => true);
    registry.registerController('agent', { respond, stop });
    registry.upsert('agent', 'a', {
      status: 'needs_input',
      canStop: true,
      prompt: { id: 'p1', title: 't', description: '', options: [{ label: 'yes', value: 'proceed_once' }] },
    });
    expect(await registry.respond('agent:a', 'p0', 'proceed_once')).toBe(false);
    expect(await registry.respond('agent:a', 'p1', 'rm -rf')).toBe(false);
    expect(respond).not.toHaveBeenCalled();
    expect(await registry.respond('agent:a', 'p1', 'proceed_once')).toBe(true);
    expect(registry.get('agent', 'a')?.prompt).toBeUndefined();
    expect(registry.get('agent', 'a')?.status).toBe('running');

    registry.upsert('agent', 'a', { status: 'done' });
    expect(await registry.stop('agent:a')).toBe(false);
    expect(stop).not.toHaveBeenCalled();
    expect(registry.dismiss('agent:a')).toBe(true);
    expect(registry.get('agent', 'a')).toBeUndefined();
  });

  it.each(['done', 'removed', 'new-prompt'] as const)(
    'does not overwrite %s during an asynchronous permission answer',
    async (change) => {
      const registry = new HubActivityRegistry();
      let resolve: ((value: boolean) => void) | undefined;
      registry.registerController('agent', {
        respond: () =>
          new Promise<boolean>((done) => {
            resolve = done;
          }),
      });
      const prompt = {
        id: 'p1',
        title: 'approve',
        description: '',
        options: [{ label: 'yes', value: 'proceed_once' }],
      };
      registry.upsert('agent', 'a', { status: 'needs_input', prompt });
      const answer = registry.respond('agent:a', 'p1', 'proceed_once');
      if (change === 'done') registry.upsert('agent', 'a', { status: 'done', canStop: false });
      else if (change === 'removed') registry.remove('agent', 'a');
      else registry.upsert('agent', 'a', { status: 'needs_input', prompt: { ...prompt, id: 'p2' } });
      resolve?.(true);
      expect(await answer).toBe(true);
      const current = registry.get('agent', 'a');
      if (change === 'done') expect(current?.status).toBe('done');
      else if (change === 'removed') expect(current).toBeUndefined();
      else expect(current?.prompt?.id).toBe('p2');
      registry.dispose();
    }
  );

  it('rejects duplicate answers and keeps an unresolved prompt after a failed response', async () => {
    const registry = new HubActivityRegistry();
    let resolve: ((value: boolean) => void) | undefined;
    const respond = vi.fn(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        })
    );
    registry.registerController('agent', { respond });
    registry.upsert('agent', 'a', {
      status: 'needs_input',
      prompt: { id: 'p', title: '', description: '', options: [{ label: 'yes', value: 'proceed_once' }] },
    });
    const answer = registry.respond('agent:a', 'p', 'proceed_once');
    expect(await registry.respond('agent:a', 'p', 'proceed_once')).toBe(false);
    expect(respond).toHaveBeenCalledTimes(1);
    resolve?.(false);
    expect(await answer).toBe(false);
    expect(registry.get('agent', 'a')?.status).toBe('needs_input');
    expect(registry.get('agent', 'a')?.prompt?.id).toBe('p');
    registry.dispose();
  });

  it('expires finished tiles and pushes an empty snapshot without another source event', async () => {
    vi.useFakeTimers();
    const registry = new HubActivityRegistry({ finishedTtlMs: 100, throttleMs: 10 });
    try {
      const listener = vi.fn();
      registry.subscribe(listener);
      registry.upsert('app', 'a', { status: 'done' });
      await vi.advanceTimersByTimeAsync(10);
      expect(listener.mock.calls[0]?.[0].items).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(100);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1]?.[0].items).toEqual([]);
      registry.upsert('app', 'b', { status: 'done' });
      registry.dispose();
      await vi.advanceTimersByTimeAsync(120);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      registry.dispose();
      vi.useRealTimers();
    }
  });

  it('cannot dismiss running work', () => {
    const registry = new HubActivityRegistry();
    registry.upsert('agent', 'a', { status: 'running' });
    expect(registry.dismiss('agent:a')).toBe(false);
  });

  it('coalesces change notifications', async () => {
    vi.useFakeTimers();
    try {
      const registry = new HubActivityRegistry({ throttleMs: 50 });
      const listener = vi.fn();
      registry.subscribe(listener);
      registry.upsert('agent', 'a', {});
      registry.upsert('agent', 'a', { status: 'done' });
      await vi.advanceTimersByTimeAsync(60);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0].items[0].status).toBe('done');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('conversation activity source', () => {
  it('sends redacted tool inputs, outputs and measured latency to the private trace instead of grid persistence', () => {
    const registry = new HubActivityRegistry();
    const bus = createBus();
    attachConversationActivity(registry, bus.subscribe, createPort());
    bus.response({ type: 'user_content', conversation_id: 'trace-1', data: { content: 'Build page' } });
    bus.response({
      type: 'tool_group', conversation_id: 'trace-1', data: [{
        call_id: 'tool-1', name: 'tomny_read', status: 'Executing',
        input: { filePath: 'README.md', api_key: 'THIS_MUST_NEVER_LEAVE_MAIN' },
        started_at_ms: 1791980000000,
      }],
    });
    expect(registry.toolTrace('agent', 'trace-1')[0]).toMatchObject({
      id: 'tool-1', status: 'running', startedAtMs: 1791980000000,
    });
    expect(registry.toolTrace('agent', 'trace-1')[0]?.input).toContain('README.md');
    expect(registry.toolTrace('agent', 'trace-1')[0]?.input).not.toContain('THIS_MUST_NEVER_LEAVE_MAIN');
    bus.response({
      type: 'tool_group', conversation_id: 'trace-1', data: [{
        call_id: 'tool-1', name: 'tomny_read', status: 'Success',
        result_display: 'File read successfully',
        duration_ms: 247, finished_at_ms: 1791980000247,
      }],
    });
    expect(registry.toolTrace('agent', 'trace-1')[0]).toMatchObject({
      id: 'tool-1', status: 'done', durationMs: 247,
      finishedAtMs: 1791980000247, output: 'File read successfully',
    });
    expect(registry.toolTrace('agent', 'trace-1')[0]?.input).toContain('README.md');
    // The grid is persisted for recovery; sensitive diagnostics must not be.
    expect(JSON.stringify(registry.snapshot())).not.toContain('README.md');
    expect(JSON.stringify(registry.snapshot())).not.toContain('THIS_MUST_NEVER_LEAVE_MAIN');
    bus.response({ type: 'user_content', conversation_id: 'trace-1', data: { content: 'New turn' } });
    expect(registry.toolTrace('agent', 'trace-1')).toEqual([]);
  });

    it('preserves long HTML in the existing Hub activity snapshot while streaming', () => {
    const registry = new HubActivityRegistry();
    const bus = createBus();
    attachConversationActivity(registry, bus.subscribe, createPort());
    bus.response({ type: 'user_content', conversation_id: 'html-1', data: { content: 'Tạo web' } });
    const code = '<h1>' + 'x'.repeat(15000) + '</h1>';
    bus.response({ type: 'content', conversation_id: 'html-1', data: { content: '```html\n' + code } });
    expect(registry.snapshot().items.find((item) => item.id === 'agent:html-1')?.preview).toContain(code);
    bus.response({ type: 'finish', conversation_id: 'html-1', data: { state: 'done' } });
    expect(registry.get('agent', 'html-1')?.preview).toContain(code);
  });
  it('follows a turn from request to permission to finish', async () => {
    const registry = new HubActivityRegistry();
    const bus = createBus();
    const port = createPort();
    attachConversationActivity(registry, bus.subscribe, port);

    bus.response({ type: 'user_content', conversation_id: 'c1', msg_id: 'm', data: { content: 'Tóm tắt báo cáo' } });
    await vi.waitFor(() => expect(registry.get('agent', 'c1')?.title).toBe('Báo cáo Q3'));
    expect(registry.get('agent', 'c1')).toMatchObject({
      task: 'Tóm tắt báo cáo',
      workspace: 'C:/work/reports',
      status: 'running',
      route: '/conversation/c1',
      canStop: true,
    });

    bus.response({
      type: 'tool_group',
      conversation_id: 'c1',
      msg_id: 'm',
      data: [{ call_id: 't1', name: 'tomny_read', status: 'Executing', description: 'sales.xlsx' }],
    });
    bus.response({ type: 'content', conversation_id: 'c1', msg_id: 'm', data: { content: 'Doanh thu ' } });
    bus.response({ type: 'content', conversation_id: 'c1', msg_id: 'm', data: { content: 'tăng 12%' } });
    expect(registry.get('agent', 'c1')?.preview).toBe('Doanh thu tăng 12%');
    expect(registry.get('agent', 'c1')?.steps).toEqual([
      { id: 't1', label: 'tomny_read · sales.xlsx', state: 'running' },
    ]);

    bus.response({
      type: 'permission',
      conversation_id: 'c1',
      msg_id: 'm',
      data: {
        id: 'perm-1',
        native_core_permission_id: 'perm-1',
        title: 'tomny_write',
        description: 'Ghi report.md',
        options: [
          { label: 'messages.confirmation.yesAllowOnce', value: 'proceed_once' },
          { label: 'messages.confirmation.yesAllowAlways', value: 'proceed_always' },
          { label: 'messages.confirmation.no', value: 'cancel' },
        ],
      },
    });
    expect(registry.get('agent', 'c1')?.status).toBe('needs_input');
    expect(await registry.respond('agent:c1', 'perm-1', 'proceed_always')).toBe(true);
    expect(port.resolvePermission).toHaveBeenCalledWith('perm-1', true, 'persistent');

    bus.response({ type: 'finish', conversation_id: 'c1', msg_id: 'm', data: { state: 'ai_waiting_input' } });
    expect(registry.get('agent', 'c1')).toMatchObject({ status: 'done', canStop: false });
    expect(registry.get('agent', 'c1')?.steps[0]?.state).toBe('done');

    bus.list({ conversation_id: 'c1', action: 'deleted' });
    expect(registry.get('agent', 'c1')).toBeUndefined();
  });

  it('keeps streamed response content beyond the former 800-character preview cap', () => {
    const registry = new HubActivityRegistry();
    const bus = createBus();
    attachConversationActivity(registry, bus.subscribe, createPort());
    bus.response({ type: 'user_content', conversation_id: 'long', msg_id: 'm', data: { content: 'x' } });
    const first = `# Mo dau\n${'a'.repeat(900)}`;
    const second = `\n## Ket thuc\n${'b'.repeat(900)}`;

    bus.response({ type: 'content', conversation_id: 'long', msg_id: 'm', data: { content: first } });
    bus.response({ type: 'content', conversation_id: 'long', msg_id: 'm', data: { content: second } });

    expect(registry.get('agent', 'long')?.preview).toBe(`${first}${second}`);
  });

  it('projects a hidden native permission into the live Hub tile without exposing hidden content', () => {
    const registry = new HubActivityRegistry();
    const bus = createBus();
    attachConversationActivity(registry, bus.subscribe, createPort());
    bus.response({ type: 'user_content', conversation_id: 'hidden-permission', msg_id: 'm', data: { content: 'x' } });

    bus.response({
      type: 'permission',
      hidden: true,
      conversation_id: 'hidden-permission',
      msg_id: 'm',
      data: {
        native_core_permission_id: 'hidden-perm-1',
        title: 'tomny_write',
        description: 'Write report.md',
        options: [{ label: 'messages.confirmation.yesAllowOnce', value: 'proceed_once' }],
      },
    });

    expect(registry.get('agent', 'hidden-permission')).toMatchObject({
      status: 'needs_input',
      prompt: {
        id: 'hidden-perm-1',
        title: 'tomny_write',
        description: 'Write report.md',
      },
    });
  });

  it('continues to ignore hidden content updates', () => {
    const registry = new HubActivityRegistry();
    const bus = createBus();
    attachConversationActivity(registry, bus.subscribe, createPort());
    bus.response({ type: 'user_content', conversation_id: 'hidden-content', msg_id: 'm', data: { content: 'x' } });
    bus.response({ type: 'content', hidden: true, conversation_id: 'hidden-content', msg_id: 'm', data: { content: 'secret' } });

    expect(registry.get('agent', 'hidden-content')?.preview).toBeUndefined();
  });


  it('keeps an error through the finish event and routes stop to cancel', async () => {
    const registry = new HubActivityRegistry();
    const bus = createBus();
    const port = createPort();
    attachConversationActivity(registry, bus.subscribe, port);
    bus.response({ type: 'user_content', conversation_id: 'c2', msg_id: 'm', data: { content: 'x' } });
    expect(await registry.stop('agent:c2')).toBe(true);
    expect(port.cancel).toHaveBeenCalledWith('c2');
    bus.response({ type: 'error', conversation_id: 'c2', msg_id: 'm', data: { message: 'quota' } });
    bus.response({ type: 'finish', conversation_id: 'c2', msg_id: 'm', data: { state: 'error' } });
    expect(registry.get('agent', 'c2')).toMatchObject({ status: 'error', preview: 'quota' });
  });

  it('ignores events of conversations it never saw start', () => {
    const registry = new HubActivityRegistry();
    const bus = createBus();
    attachConversationActivity(registry, bus.subscribe, createPort());
    bus.response({ type: 'content', conversation_id: 'old', msg_id: 'm', data: { content: 'x' } });
    bus.response({ type: 'finish', conversation_id: 'old', msg_id: 'm', data: { state: 'ai_waiting_input' } });
    expect(registry.snapshot().items).toEqual([]);
  });
});

describe('schedule, team and terminal sources', () => {
  it('reports a scheduled run lifecycle', async () => {
    const registry = new HubActivityRegistry();
    reportScheduledRun(registry, { taskId: 'job', kind: 'run.started' }, async () => 'Báo cáo sáng');
    await vi.waitFor(() => expect(registry.get('schedule', 'job')?.title).toBe('Báo cáo sáng'));
    reportScheduledRun(registry, { taskId: 'job', kind: 'run.failed', detail: 'timeout' }, async () => undefined);
    expect(registry.get('schedule', 'job')).toMatchObject({ status: 'error', preview: 'timeout', canStop: false });
  });

  it('aggregates team members', () => {
    const registry = new HubActivityRegistry();
    reportTeamAgentStatus(registry, { teamId: 't', teamName: 'Dev', slotId: 'a', agentName: 'lead', status: 'active' });
    reportTeamAgentStatus(registry, { teamId: 't', slotId: 'b', agentName: 'qa', status: 'active' });
    expect(registry.get('team', 't')?.status).toBe('running');
    reportTeamAgentStatus(registry, { teamId: 't', slotId: 'a', status: 'completed' });
    reportTeamAgentStatus(registry, { teamId: 't', slotId: 'b', status: 'completed' });
    expect(registry.get('team', 't')).toMatchObject({ status: 'done', title: 'Dev' });
  });

  it('mirrors running terminal sessions and kills on stop', async () => {
    const registry = new HubActivityRegistry();
    let emit: (sessions: TerminalActivitySession[]) => void = () => undefined;
    const session: TerminalActivitySession = {
      id: 's1',
      title: 'bash 1',
      cwd: '/repo',
      status: 'running',
      createdAt: 5,
      exitCode: null,
      scheduled: false,
    };
    const kill = vi.fn();
    attachTerminalActivity(registry, {
      list: () => [session, { ...session, id: 'old', status: 'exited', exitCode: 0 }],
      kill,
      onSessionsChanged: (listener) => {
        emit = listener;
        return () => undefined;
      },
    });
    expect(registry.snapshot().items.map((item) => item.sourceId)).toEqual(['terminal:s1']);
    expect(await registry.stop('app:terminal:s1')).toBe(true);
    expect(kill).toHaveBeenCalledWith('s1');
    emit([{ ...session, status: 'exited', exitCode: 1 }]);
    expect(registry.get('app', 'terminal:s1')?.status).toBe('stopped');
    emit([]);
    expect(registry.get('app', 'terminal:s1')).toBeUndefined();
  });
});

describe('grid persistence across restart', () => {
  it('keeps old agent tiles across restart and expires old app tiles', () => {
    const now = 10_000;
    const registry = new HubActivityRegistry({ now: () => now, finishedTtlMs: 1_000 });
    registry.hydrate([
      {
        kind: 'agent',
        sourceId: 'fresh',
        title: 'Báo cáo',
        status: 'done',
        startedAt: now - 500,
        updatedAt: now - 500,
        steps: [],
        canStop: false,
      },
      {
                kind: 'app',
        sourceId: 'old',
        title: 'Quá hạn',
        status: 'done',
        startedAt: now - 5_000,
        updatedAt: now - 5_000,
        steps: [],
        canStop: false,
      },
    ]);
    expect(registry.get('agent', 'fresh')?.title).toBe('Báo cáo');
        expect(registry.get('app', 'old')).toBeUndefined();
  });

  it('brings interrupted work back as stopped without its prompt', async () => {
    const registry = new HubActivityRegistry({ now: () => 10_000 });
    registry.hydrate([
      {
        kind: 'agent',
        sourceId: 'c1',
        title: 'Đang chạy',
        status: 'running',
        startedAt: 1,
        updatedAt: 2,
        canStop: true,
        steps: [{ id: 's1', label: 'write', state: 'running' }],
        prompt: { id: 'p1', title: 'Cho phép?', description: '', options: [{ label: 'yes', value: 'proceed_once' }] },
      },
      {
        kind: 'team',
        sourceId: 't1',
        title: 'Team',
        status: 'needs_input',
        startedAt: 1,
        updatedAt: 2,
        steps: [],
        canStop: true,
      },
    ]);
    expect(registry.get('agent', 'c1')).toMatchObject({ status: 'stopped', canStop: false });
    expect(registry.get('agent', 'c1')?.prompt).toBeUndefined();
    expect(registry.get('agent', 'c1')?.steps[0]?.state).toBe('error');
    expect(registry.get('team', 't1')?.status).toBe('stopped');
    expect(await registry.stop('agent:c1')).toBe(false);
  });

  it('keeps live events and rejects malformed persisted entries', () => {
    const registry = new HubActivityRegistry();
    registry.upsert('agent', 'live', { status: 'running', title: 'Sống' });
    registry.hydrate([
      {
        kind: 'agent',
        sourceId: 'live',
        title: 'Cũ',
        status: 'done',
        startedAt: 1,
        updatedAt: 2,
        steps: [],
        canStop: false,
      },
      {
        kind: 'ghost',
        sourceId: 'x',
        title: 'x',
        status: 'running',
        startedAt: 1,
        updatedAt: 2,
        steps: [],
        canStop: false,
      },
      {
        kind: 'agent',
        sourceId: 'bad',
        title: 'x',
        status: 'done',
        startedAt: 'now',
        updatedAt: Number.NaN,
        steps: [],
        canStop: false,
      },
      'not-an-object',
      null,
    ]);
    expect(registry.get('agent', 'live')).toMatchObject({ title: 'Sống', status: 'running' });
    expect(registry.get('ghost', 'x')).toBeUndefined();
    expect(registry.get('agent', 'bad')).toBeUndefined();
  });

  it('persists activity that existed before the writer attaches', async () => {
    const registry = new HubActivityRegistry();
    const persist = vi.fn();
    registry.upsert('agent', 'a', { status: 'running' });
    registry.setPersister(persist);

    await vi.waitFor(() => {
      expect(persist).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ sourceId: 'a' })]));
    });
    registry.dispose();
  });

  it('writes the first activity immediately and batches later updates through the persister', async () => {
    vi.useFakeTimers();
    try {
      const registry = new HubActivityRegistry({ persistDelayMs: 20 });
      const persist = vi.fn();
      registry.setPersister(persist);
      registry.upsert('agent', 'a', { status: 'running' });
      await vi.advanceTimersByTimeAsync(0);
      expect(persist).toHaveBeenCalledTimes(1);
      registry.upsert('agent', 'a', { status: 'done' });
      expect(persist).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30);
      expect(persist).toHaveBeenCalledTimes(2);
      expect(persist).toHaveBeenLastCalledWith(
        expect.arrayContaining([expect.objectContaining({ sourceId: 'a', status: 'done' })])
      );
      registry.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
