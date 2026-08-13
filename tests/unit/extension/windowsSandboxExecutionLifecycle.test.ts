import { describe, expect, it, vi } from 'vitest';
import {
  createWindowsCreatorSandboxExecutionLifecycle,
  type WindowsCreatorSandboxLifecycleEvent,
} from '@/process/extensions/windowsSandboxExecutionLifecycle';

describe('Windows Creator Preview execution lifecycle', () => {
  it('keeps execution ownership typed and emits only redacted lifecycle telemetry', () => {
    const events: WindowsCreatorSandboxLifecycleEvent[] = [];
    let timestamp = 100;
    const lifecycle = createWindowsCreatorSandboxExecutionLifecycle({
      now: () => timestamp++,
      createExecutionId: () => 'execution-preview-1',
      onEvent: (event) => events.push(event),
    });

    const session = lifecycle.openSession({ sessionId: 'sandbox-preview-1', ownerId: 'owner-private-project' });
    const execution = lifecycle.beginExecution(session);
    lifecycle.failExecution(execution);

    expect(events).toEqual([
      {
        type: 'session-opened',
        code: 'SESSION_OPENED',
        occurredAt: 100,
        sessionId: 'sandbox-preview-1',
      },
      {
        type: 'execution-started',
        code: 'EXECUTION_STARTED',
        occurredAt: 101,
        sessionId: 'sandbox-preview-1',
        executionId: 'execution-preview-1',
      },
      {
        type: 'execution-failed',
        code: 'NATIVE_REQUEST_FAILED',
        occurredAt: 102,
        sessionId: 'sandbox-preview-1',
        executionId: 'execution-preview-1',
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('owner-private-project');
    expect(Object.keys(events[1] ?? {})).not.toContain('ownerId');
  });

  it('terminates every active execution exactly once when the native process exits unexpectedly', async () => {
    const events: WindowsCreatorSandboxLifecycleEvent[] = [];
    const lifecycle = createWindowsCreatorSandboxExecutionLifecycle({
      createExecutionId: vi
        .fn()
        .mockReturnValueOnce('execution-preview-1')
        .mockReturnValueOnce('execution-preview-2'),
      onEvent: (event) => events.push(event),
    });
    const firstSession = lifecycle.openSession({ sessionId: 'sandbox-preview-1', ownerId: 'owner-a' });
    const secondSession = lifecycle.openSession({ sessionId: 'sandbox-preview-2', ownerId: 'owner-b' });
    lifecycle.beginExecution(firstSession);
    lifecycle.beginExecution(secondSession);

    const firstCleanup = lifecycle.handleUnexpectedProcessExit();
    const secondCleanup = lifecycle.handleUnexpectedProcessExit();
    expect(secondCleanup).toBe(firstCleanup);
    await firstCleanup;

    expect(events.filter((event) => event.type === 'execution-terminated')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'session-disposed')).toEqual([
      expect.objectContaining({ code: 'PROCESS_EXITED', sessionId: 'sandbox-preview-1' }),
      expect.objectContaining({ code: 'PROCESS_EXITED', sessionId: 'sandbox-preview-2' }),
    ]);
    expect(() => lifecycle.beginExecution(firstSession)).toThrow('disposed');
  });

  it('makes explicit session termination and boundary disposal idempotent', async () => {
    const events: WindowsCreatorSandboxLifecycleEvent[] = [];
    const lifecycle = createWindowsCreatorSandboxExecutionLifecycle({
      createExecutionId: () => 'execution-preview-1',
      onEvent: (event) => events.push(event),
    });
    const session = lifecycle.openSession({ sessionId: 'sandbox-preview-1', ownerId: 'owner-a' });
    lifecycle.beginExecution(session);

    lifecycle.terminateSession(session);
    lifecycle.terminateSession(session);
    const firstDispose = lifecycle.dispose();
    const secondDispose = lifecycle.dispose();
    expect(secondDispose).toBe(firstDispose);
    await firstDispose;

    expect(events.filter((event) => event.type === 'execution-terminated')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'session-disposed')).toHaveLength(1);
  });
});
