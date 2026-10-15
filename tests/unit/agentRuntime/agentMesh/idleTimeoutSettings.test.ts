import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentJobOrchestrator } from '@process/agentRuntime/agentMesh/orchestrator';
import { createAgentMeshService } from '@process/agentRuntime/agentMesh/service';

afterEach(() => vi.useRealTimers());

describe('Settings-controlled agent idle hibernation', () => {
  it('re-arms the existing idle session when the timeout changes', async () => {
    vi.useFakeTimers();
    const service = createAgentMeshService();
    const orchestrator = createAgentJobOrchestrator({
      service,
      idleHibernateMs: 10 * 60_000,
      executor: async () => ({ summary: 'finished' }),
    });

    orchestrator.spawnJobs({
      sessionId: 'adjusted-idle',
      jobs: [{ jobId: 'job-1', agentId: 'worker', objective: 'work' }],
    });
    await orchestrator.waitForIdle('adjusted-idle');
    orchestrator.setIdleHibernateMinutes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.listSessions()).not.toContain('adjusted-idle');
    expect(orchestrator.listSessionViews()).toContainEqual(
      expect.objectContaining({ sessionId: 'adjusted-idle', state: 'hibernated' })
    );
  });

  it('does not interrupt a running job even after its idle deadline', async () => {
    vi.useFakeTimers();
    let finish: ((value: { summary: string }) => void) | undefined;
    const service = createAgentMeshService();
    const orchestrator = createAgentJobOrchestrator({
      service,
      idleHibernateMs: 10 * 60_000,
      executor: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    orchestrator.spawnJobs({
      sessionId: 'active-work',
      jobs: [{ jobId: 'job-2', agentId: 'worker', objective: 'important background work' }],
    });
    await vi.advanceTimersByTimeAsync(0);
    orchestrator.setIdleHibernateMinutes(1);

    await vi.advanceTimersByTimeAsync(62_000);
    expect(service.listSessions()).toContain('active-work');
    expect(orchestrator.listSessionViews()).toContainEqual(
      expect.objectContaining({ sessionId: 'active-work', state: 'active' })
    );

    expect(finish).toBeDefined();
    finish?.({ summary: 'finished after close' });
    await orchestrator.waitForIdle('active-work');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.listSessions()).not.toContain('active-work');
  });

  it('rejects invalid Settings values without changing the timer policy', () => {
    const orchestrator = createAgentJobOrchestrator({ executor: async () => ({ summary: 'ok' }) });
    expect(() => orchestrator.setIdleHibernateMinutes(0)).toThrow(RangeError);
    expect(() => orchestrator.setIdleHibernateMinutes(61)).toThrow(RangeError);
    expect(() => orchestrator.setIdleHibernateMinutes(Number.NaN)).toThrow(RangeError);
  });
});
