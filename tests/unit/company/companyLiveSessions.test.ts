import { describe, expect, it, vi } from 'vitest';

const report = vi.fn();
vi.mock('@/renderer/hooks/useReportLiveSessions', () => ({
  useReportLiveSessions: (...args: unknown[]) => report(...args),
}));

import { emptySnapshot, type PipelineSnapshot } from '@package-apps/company/renderer/company/pipeline/pipelineStore';
import {
  COMPANY_APP_ID,
  companyRunsToLiveSessions,
} from '@package-apps/company/renderer/company/companyLiveSessions';

const snap = (over: Partial<PipelineSnapshot>): PipelineSnapshot => ({ ...emptySnapshot(), ...over });
const state = (nodeId: string, updatedAt: number, task?: string) => ({
  nodeId,
  name: nodeId,
  role: 'president' as const,
  activity: 'executing' as const,
  task,
  updatedAt,
});

describe('companyRunsToLiveSessions', () => {
  it('uses the company package id', () => {
    expect(COMPANY_APP_ID).toBe('com.tomni.company');
  });

  it('reports a running run as working with latest activity and goal detail', () => {
    const out = companyRunsToLiveSessions([
      {
        companyId: 'acme',
        snapshot: snap({ phase: 'running', states: { a: state('a', 10, 'Ship v1'), b: state('b', 30) } }),
      },
    ]);
    expect(out).toEqual([
      { id: 'acme', title: 'acme', status: 'working', lastActiveAt: 30, detail: 'Ship v1', icon: 'building' },
    ]);
  });

  it('marks a run waiting on approvals as attention', () => {
    const [s] = companyRunsToLiveSessions([
      {
        companyId: 'acme',
        snapshot: snap({
          phase: 'running',
          pending: [{ id: 'p', fromId: 'a', gate: 'approval', summary: 's', at: 1 }],
        }),
      },
    ]);
    expect(s.status).toBe('attention');
  });

  it('marks failed runs as error and skips idle/finished/stopped runs', () => {
    const out = companyRunsToLiveSessions([
      { companyId: 'bad', snapshot: snap({ phase: 'error', error: 'x' }) },
      { companyId: 'idle', snapshot: snap({ phase: 'idle' }) },
      { companyId: 'done', snapshot: snap({ phase: 'finished' }) },
      { companyId: 'stop', snapshot: snap({ phase: 'stopped' }) },
    ]);
    expect(out.map((s) => [s.id, s.status])).toEqual([['bad', 'error']]);
  });

  it('returns nothing for no runs', () => {
    expect(companyRunsToLiveSessions([])).toEqual([]);
  });
});
