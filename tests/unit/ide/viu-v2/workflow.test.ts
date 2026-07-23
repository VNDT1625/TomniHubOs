/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  appendViuPreviewFeedback,
  createPremiumStarterProject,
  createViuPreCodeReviewService,
  createViuFramePlan,
  createViuPreviewSnapshot,
  createViuTeamPreviewPackage,
  mergeViuFrameContributions,
  viuFrameLeaseKey,
  type ViuCommand,
  type ViuFrameAssignment,
  type ViuFrameContribution,
  type ViuFramePlan,
  type ViuProjectState,
  type ViuTransaction,
} from '@/common/viu';

const NOW = 1_000;

const createPlan = (state: ViuProjectState): ViuFramePlan =>
  createViuFramePlan(state, {
    planId: 'plan-home-showcase',
    createdAt: NOW,
    createdBy: 'user-owner',
    assignments: [
      {
        assignmentId: 'assignment-home',
        agentId: 'agent-home',
        screenId: 'screen-home',
        lease: {
          leaseKey: viuFrameLeaseKey(state.projectId, 'screen-home'),
          holderId: 'agent-home',
          acquiredAt: NOW,
          expiresAt: NOW + 10_000,
        },
        teamTaskId: 'team-task-home',
      },
      {
        assignmentId: 'assignment-showcase',
        agentId: 'agent-showcase',
        screenId: 'screen-showcase',
        lease: {
          leaseKey: viuFrameLeaseKey(state.projectId, 'screen-showcase'),
          holderId: 'agent-showcase',
          acquiredAt: NOW,
          expiresAt: NOW + 10_000,
        },
        teamTaskId: 'team-task-showcase',
      },
    ],
  });

const contribution = (
  state: ViuProjectState,
  assignment: ViuFrameAssignment,
  transactionId: string,
  commands: ViuCommand[]
): ViuFrameContribution => ({
  assignmentId: assignment.assignmentId,
  leaseKey: assignment.lease.leaseKey,
  transaction: {
    transactionId,
    documentId: state.projectId,
    baseRevision: assignment.baseRevision,
    actor: { id: assignment.agentId, kind: 'agent' },
    origin: 'agent-tool',
    commands,
    mode: 'commit',
    summary: `Author ${assignment.screenId}`,
  },
});

const transactionFor = (
  state: ViuProjectState,
  assignment: ViuFrameAssignment,
  transactionId: string,
  commands: ViuCommand[]
): ViuTransaction => contribution(state, assignment, transactionId, commands).transaction;

describe('VIU pre-code frame workflow', () => {
  it('creates a Team-compatible plan with one agent and lease per frame', () => {
    const state = createPremiumStarterProject('project-plan');
    const plan = createPlan(state);

    expect(plan.baseRevision).toBe(state.revision);
    expect(plan.assignments.map((assignment) => assignment.rootNodeId)).toEqual([
      'node-home-root',
      'node-showcase-root',
    ]);
    expect(plan.assignments[0]?.lease.leaseKey).toBe('viu/project-plan/screens/screen-home.frame');
  });

  it('rejects overlapping assignments before agents start work', () => {
    const state = createPremiumStarterProject('project-overlap');

    expect(() =>
      createViuFramePlan(state, {
        planId: 'plan-overlap',
        createdAt: NOW,
        createdBy: 'user-owner',
        assignments: [
          {
            assignmentId: 'assignment-a',
            agentId: 'same-agent',
            screenId: 'screen-home',
            lease: {
              leaseKey: viuFrameLeaseKey(state.projectId, 'screen-home'),
              holderId: 'same-agent',
              acquiredAt: NOW,
              expiresAt: NOW + 1_000,
            },
          },
          {
            assignmentId: 'assignment-b',
            agentId: 'same-agent',
            screenId: 'screen-showcase',
            lease: {
              leaseKey: viuFrameLeaseKey(state.projectId, 'screen-showcase'),
              holderId: 'same-agent',
              acquiredAt: NOW,
              expiresAt: NOW + 1_000,
            },
          },
        ],
      })
    ).toThrow('assigned to more than one frame');
  });

  it('rebases disjoint frame transactions and merges them through the canonical engine', () => {
    const state = createPremiumStarterProject('project-merge');
    const plan = createPlan(state);
    const [home, showcase] = plan.assignments;
    const result = mergeViuFrameContributions(
      state,
      plan,
      [
        contribution(state, home!, 'transaction-home', [
          {
            type: 'updateNode',
            nodeId: 'node-home-title',
            patch: { content: { text: 'Designed by home agent' } },
          },
        ]),
        contribution(state, showcase!, 'transaction-showcase', [
          {
            type: 'updateNode',
            nodeId: 'node-showcase-title',
            patch: { content: { text: 'Designed by showcase agent' } },
          },
        ]),
      ],
      NOW + 500
    );

    expect(result.accepted).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.revision).toBe(2);
    expect(result.state.nodes['node-home-title']?.content?.text).toBe('Designed by home agent');
    expect(result.state.nodes['node-showcase-title']?.content?.text).toBe('Designed by showcase agent');
  });

  it('rolls the whole batch back when an agent mutates another frame', () => {
    const state = createPremiumStarterProject('project-scope');
    const plan = createPlan(state);
    const [home, showcase] = plan.assignments;
    const result = mergeViuFrameContributions(
      state,
      plan,
      [
        contribution(state, home!, 'transaction-home-valid', [
          { type: 'updateNode', nodeId: 'node-home-title', patch: { name: 'Should roll back' } },
        ]),
        contribution(state, showcase!, 'transaction-showcase-invalid', [
          { type: 'updateNode', nodeId: 'node-home-copy', patch: { name: 'Cross-frame edit' } },
        ]),
      ],
      NOW + 500
    );

    expect(result.accepted).toBe(false);
    expect(result.revision).toBe(state.revision);
    expect(result.state.nodes['node-home-title']?.name).toBe('Hero title');
    expect(result.issues.some((issue) => issue.code === 'scope-violation')).toBe(true);
  });

  it('reports orphan navigation after merge without blocking a valid visual draft', () => {
    const state = createPremiumStarterProject('project-diagnostic');
    const plan = createViuFramePlan(state, {
      planId: 'plan-diagnostic',
      createdAt: NOW,
      createdBy: 'user-owner',
      assignments: [
        {
          assignmentId: 'assignment-home',
          agentId: 'agent-home',
          screenId: 'screen-home',
          lease: {
            leaseKey: viuFrameLeaseKey(state.projectId, 'screen-home'),
            holderId: 'agent-home',
            acquiredAt: NOW,
            expiresAt: NOW + 10_000,
          },
        },
      ],
    });
    const assignment = plan.assignments[0]!;
    const result = mergeViuFrameContributions(
      state,
      plan,
      [
        {
          assignmentId: assignment.assignmentId,
          leaseKey: assignment.lease.leaseKey,
          transaction: transactionFor(state, assignment, 'transaction-disconnect', [
            { type: 'disconnectInteraction', interactionId: 'interaction-home-showcase' },
          ]),
        },
      ],
      NOW + 500
    );

    expect(result.accepted).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'orphan-screen')).toBe(true);
  });

  it('reports stale node preconditions and keeps earlier frame changes atomic', () => {
    const state = createPremiumStarterProject('project-conflict');
    const plan = createPlan(state);
    const [home, showcase] = plan.assignments;
    const showcaseContribution = contribution(state, showcase!, 'transaction-stale-node', [
      { type: 'updateNode', nodeId: 'node-showcase-title', patch: { name: 'Stale update' } },
    ]);
    showcaseContribution.transaction.preconditions = [{ nodeId: 'node-showcase-title', expectedVersion: 999 }];
    const result = mergeViuFrameContributions(
      state,
      plan,
      [
        contribution(state, home!, 'transaction-before-conflict', [
          { type: 'updateNode', nodeId: 'node-home-title', patch: { name: 'Must remain atomic' } },
        ]),
        showcaseContribution,
      ],
      NOW + 500
    );

    expect(result.accepted).toBe(false);
    expect(result.state.nodes['node-home-title']?.name).toBe('Hero title');
    expect(result.issues.some((issue) => issue.code === 'transaction-conflict')).toBe(true);
  });

  it('publishes one frozen snapshot for both user and agent preview consumers', () => {
    const state = createPremiumStarterProject('project-preview');
    const snapshot = createViuPreviewSnapshot(state, {
      snapshotId: 'snapshot-1',
      createdAt: NOW,
      startScreenId: 'screen-home',
      metadata: {
        title: 'Checkout concept',
        createdBy: 'user-owner',
        purpose: 'Pre-code usability test',
        teamWorkspaceKey: 'team-workspace-a',
      },
    });
    const share = createViuTeamPreviewPackage(snapshot, {
      packageId: 'package-1',
      createdAt: NOW + 1,
      teamWorkspaceKey: 'team-workspace-a',
      teamTaskId: 'task-test-preview',
    });

    state.nodes['node-home-title']!.name = 'Changed after publishing';
    expect(snapshot.startRoute).toBe('/');
    expect(snapshot.project.nodes['node-home-title']?.name).toBe('Hero title');
    expect(Object.isFrozen(snapshot.project.nodes['node-home-title'])).toBe(true);
    expect(share.snapshot).toBe(snapshot);
    expect(share.consumers).toEqual(['user-preview', 'agent-preview']);
  });

  it('serves the same frozen package to user and agent and records Team tester feedback', () => {
    const state = createPremiumStarterProject('project-review-service');
    const service = createViuPreCodeReviewService();
    const published = service.publish(
      state,
      {
        snapshotId: 'snapshot-service',
        createdAt: NOW,
        startScreenId: 'screen-home',
        metadata: { title: 'Service preview', createdBy: 'user-owner' },
      },
      {
        packageId: 'package-service',
        createdAt: NOW + 1,
        teamWorkspaceKey: 'team-workspace-service',
      }
    );

    expect(service.open(published.packageId, 'user-preview')).toBe(published);
    expect(service.open(published.packageId, 'agent-preview')).toBe(published);
    expect(service.listTeamPackages('team-workspace-service')).toEqual([published]);

    service.appendFeedback(published.packageId, {
      feedbackId: 'feedback-service',
      authorId: 'tester-b',
      authorKind: 'user',
      createdAt: NOW + 2,
      kind: 'approval',
      body: 'The interaction is ready to build.',
      screenId: 'screen-home',
    });
    expect(service.listFeedback(published.packageId)).toHaveLength(1);
  });

  it('rehydrates an immutable review archive and rejects a tampered project digest', () => {
    const state = createPremiumStarterProject('project-review-archive');
    const service = createViuPreCodeReviewService();
    service.publish(
      state,
      {
        snapshotId: 'snapshot-archive',
        createdAt: NOW,
        startScreenId: 'screen-home',
        metadata: { title: 'Archive preview', createdBy: 'user-owner' },
      },
      {
        packageId: 'package-archive',
        createdAt: NOW + 1,
        teamWorkspaceKey: 'team-workspace-archive',
      }
    );
    service.appendFeedback('package-archive', {
      feedbackId: 'feedback-archive',
      authorId: 'tester-a',
      authorKind: 'user',
      createdAt: NOW + 2,
      kind: 'comment',
      body: 'Persist this note.',
      screenId: 'screen-home',
    });

    const archive = service.exportArchive();
    const restored = createViuPreCodeReviewService(structuredClone(archive));
    expect(restored.listFeedback('package-archive')).toMatchObject([{ feedbackId: 'feedback-archive' }]);
    expect(Object.isFrozen(restored.open('package-archive', 'agent-preview').snapshot.project)).toBe(true);

    const tampered = structuredClone(archive);
    tampered.packages[0]!.snapshot.project.nodes['node-home-title']!.name = 'Tampered after digest';
    expect(() => createViuPreCodeReviewService(tampered)).toThrow('content digest');
  });

  it('keeps tester feedback append-only and validates screen/node anchors', () => {
    const state = createPremiumStarterProject('project-feedback');
    const snapshot = createViuPreviewSnapshot(state, {
      snapshotId: 'snapshot-feedback',
      createdAt: NOW,
      startScreenId: 'screen-home',
      metadata: { title: 'Feedback build', createdBy: 'user-owner' },
    });
    const initial = [] as const;
    const events = appendViuPreviewFeedback(initial, snapshot, {
      feedbackId: 'feedback-1',
      authorId: 'tester-a',
      authorKind: 'user',
      createdAt: NOW + 1,
      kind: 'issue',
      body: 'The hero title needs more contrast.',
      screenId: 'screen-home',
      nodeId: 'node-home-title',
    });

    expect(initial).toHaveLength(0);
    expect(events[0]).toMatchObject({ snapshotId: 'snapshot-feedback', snapshotRevision: 0 });
    expect(Object.isFrozen(events)).toBe(true);
    expect(() =>
      appendViuPreviewFeedback(events, snapshot, {
        feedbackId: 'feedback-2',
        authorId: 'tester-a',
        authorKind: 'user',
        createdAt: NOW + 2,
        kind: 'comment',
        body: 'Wrong anchor',
        screenId: 'screen-showcase',
        nodeId: 'node-home-title',
      })
    ).toThrow('does not belong');
  });
});
