/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPlanningGuard } from '@/renderer/services/planningGuard';
import { coreIdeClient } from '@/renderer/services/coreIdeClient';

vi.mock('@/renderer/services/coreIdeClient', () => ({
  coreIdeClient: {
    specStatus: vi.fn(),
    specTaskList: vi.fn(),
    specTaskClaim: vi.fn(),
  },
}));

const mockedSpecStatus = vi.mocked(coreIdeClient.specStatus);
const mockedSpecTaskList = vi.mocked(coreIdeClient.specTaskList);
const mockedSpecTaskClaim = vi.mocked(coreIdeClient.specTaskClaim);

describe('buildPlanningGuard', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedSpecStatus.mockReset();
    mockedSpecTaskList.mockReset();
    mockedSpecTaskClaim.mockReset();
    // Default: spec status resolves to a non-existent spec so the /execute
    // lifecycle gate is a no-op unless a test overrides it.
    mockedSpecStatus.mockResolvedValue({ ok: false, error: 'no spec' });

    mockedSpecTaskClaim.mockResolvedValue({
      ok: true,
      data: {
        rootPath: '/repo',
        slug: 'fix-login',
        specDir: '/repo/.tomny/specs/fix-login',
        activeTaskId: 't003-implement',
        nextTaskId: null,
        updatedAt: 11,
        counts: { total: 1, done: 0, pending: 0, inProgress: 1, blocked: 0 },
        tasks: [
          {
            id: 't003-implement',
            title: 'Implement',
            status: 'in_progress',
            sourceLine: 3,
            indent: 0,
            claimedBy: 'chat-agent',
            updatedAt: 11,
            note: null,
          },
        ],
      },
    });
  });

  it('does not block ordinary chat for pre-existing changed files', async () => {
    const message = await buildPlanningGuard('/repo', 'fix login');

    expect(message).toBe('fix login');
    expect(mockedSpecStatus).not.toHaveBeenCalled();
    expect(mockedSpecTaskList).not.toHaveBeenCalled();
  });

  it('checks spec lifecycle state without injecting plan prompt when Planning Mode is on', async () => {
    localStorage.setItem('studio.ide.planning./repo', '1');
    mockedSpecStatus.mockResolvedValue({
      ok: true,
      data: {
        rootPath: '/repo',
        exists: true,
        slug: 'fix-login',
        specDir: '/repo/.tomny/specs/fix-login',
        files: {
          'requirements.md': true,
          'design.md': true,
          'tasks.md': true,
          'verification.md': false,
        },
        taskCounts: {
          total: 3,
          done: 1,
          pending: 1,
          inProgress: 1,
          blocked: 0,
        },
        updatedAt: 10,
      },
    });
    mockedSpecTaskList.mockResolvedValue({
      ok: true,
      data: {
        rootPath: '/repo',
        slug: 'fix-login',
        specDir: '/repo/.tomny/specs/fix-login',
        activeTaskId: 't003-implement',
        nextTaskId: 't004-verify',
        updatedAt: 11,
        counts: {
          total: 4,
          done: 1,
          pending: 2,
          inProgress: 1,
          blocked: 0,
        },
        tasks: [
          {
            id: 't003-implement',
            title: 'Implement',
            status: 'in_progress',
            sourceLine: 3,
            indent: 0,
            claimedBy: 'agent',
            updatedAt: 11,
            note: null,
          },
          {
            id: 't004-verify',
            title: 'Verify',
            status: 'pending',
            sourceLine: 4,
            indent: 0,
            claimedBy: null,
            updatedAt: null,
            note: null,
          },
        ],
      },
    });

    const message = await buildPlanningGuard('/repo', 'fix login');
    expect(message).toBe('fix login');
    expect(message).not.toContain('prefer the provided mtui/IDE tools');
    expect(message).not.toContain('## Plan Guard');
    expect(mockedSpecStatus).not.toHaveBeenCalled();
    expect(mockedSpecTaskList).not.toHaveBeenCalled();
  });

  it('claims a backend task for /execute @<spec-folder> before sending to the agent', async () => {
    mockedSpecStatus.mockResolvedValue({
      ok: true,
      data: {
        rootPath: '/repo',
        exists: true,
        hasAnySpec: true,
        slug: 'fix-login',
        specDir: '/repo/.tomny/specs/fix-login',
        phase: 'execution',
        approvals: { requirements: true, design: true, tasks: true },
        files: {
          'requirements.md': true,
          'design.md': true,
          'tasks.md': true,
          'verification.md': false,
        },
        taskCounts: { total: 1, done: 0, pending: 0, inProgress: 1, blocked: 0 },
        updatedAt: 11,
      },
    });
    mockedSpecTaskClaim.mockResolvedValue({
      ok: true,
      data: {
        rootPath: '/repo',
        slug: 'fix-login',
        specDir: '/repo/.tomny/specs/fix-login',
        activeTaskId: 't003-implement',
        nextTaskId: null,
        updatedAt: 11,
        counts: {
          total: 1,
          done: 0,
          pending: 0,
          inProgress: 1,
          blocked: 0,
        },
        tasks: [
          {
            id: 't003-implement',
            title: 'Implement',
            status: 'in_progress',
            sourceLine: 3,
            indent: 0,
            claimedBy: 'chat-agent',
            updatedAt: 11,
            note: null,
          },
        ],
      },
    });

    const message = await buildPlanningGuard('/repo', '/execute @.tomny/specs/fix-login/ 1.1 focus UI');
    expect(mockedSpecTaskClaim).toHaveBeenCalledWith('/repo', 'fix-login', '1.1', 'chat-agent');
    expect(message).toBe('/execute @.tomny/specs/fix-login/ 1.1 focus UI');
    expect(message).not.toContain('prefer the provided mtui/IDE tools');
  });

  it('blocks /execute until lifecycle approvals reach execution', async () => {
    mockedSpecStatus.mockResolvedValue({
      ok: true,
      data: {
        rootPath: '/repo',
        exists: true,
        hasAnySpec: true,
        slug: 'fix-login',
        specDir: '/repo/.tomny/specs/fix-login',
        phase: 'tasks',
        approvals: { requirements: true, design: true, tasks: false },
        files: {
          'requirements.md': true,
          'design.md': true,
          'tasks.md': true,
          'verification.md': false,
        },
        taskCounts: { total: 1, done: 0, pending: 1, inProgress: 0, blocked: 0 },
        updatedAt: 11,
      },
    });

    await expect(buildPlanningGuard('/repo', '/execute @.tomny/specs/fix-login/')).rejects.toThrow(
      'Approve the requirements, design, and tasks gates before running /execute.'
    );
    expect(mockedSpecTaskClaim).not.toHaveBeenCalled();
  });
});
