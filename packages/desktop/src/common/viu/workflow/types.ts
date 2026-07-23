/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuConflict, ViuDiagnostic, ViuId, ViuProjectState, ViuTransaction } from '../types';

/** A Team-compatible lease over one VIU screen/frame. */
export type ViuFrameLease = {
  leaseKey: string;
  holderId: ViuId;
  acquiredAt: number;
  expiresAt: number;
};

/** One agent owns exactly one screen while a parallel authoring plan is active. */
export type ViuFrameAssignment = {
  assignmentId: ViuId;
  agentId: ViuId;
  screenId: ViuId;
  rootNodeId: ViuId;
  baseRevision: number;
  lease: ViuFrameLease;
  teamTaskId?: ViuId;
};

export type ViuFramePlan = {
  planId: ViuId;
  projectId: ViuId;
  baseRevision: number;
  createdAt: number;
  createdBy: ViuId;
  assignments: ViuFrameAssignment[];
};

export type CreateViuFramePlanInput = Omit<ViuFramePlan, 'projectId' | 'baseRevision' | 'assignments'> & {
  assignments: Array<Omit<ViuFrameAssignment, 'rootNodeId' | 'baseRevision'>>;
};

export type ViuFrameContribution = {
  assignmentId: ViuId;
  leaseKey: string;
  transaction: ViuTransaction;
};

export type ViuFrameMergeIssue = {
  code:
    | 'invalid-plan'
    | 'missing-contribution'
    | 'duplicate-contribution'
    | 'lease-expired'
    | 'lease-mismatch'
    | 'scope-violation'
    | 'transaction-conflict'
    | 'site-diagnostic';
  severity: 'error' | 'warning';
  message: string;
  assignmentId?: ViuId;
  transactionId?: ViuId;
  diagnostic?: ViuDiagnostic;
  conflict?: ViuConflict;
};

export type ViuFrameContributionReport = {
  assignmentId: ViuId;
  transactionId?: ViuId;
  accepted: boolean;
  changedNodeIds: ViuId[];
  issues: ViuFrameMergeIssue[];
};

export type ViuFrameMergeResult = {
  accepted: boolean;
  complete: boolean;
  state: ViuProjectState;
  revision: number;
  reports: ViuFrameContributionReport[];
  diagnostics: ViuDiagnostic[];
  issues: ViuFrameMergeIssue[];
};

export type ViuPreviewSnapshotMetadata = {
  title: string;
  createdBy: ViuId;
  purpose?: string;
  planId?: ViuId;
  teamWorkspaceKey?: string;
};

/** Immutable pre-code artifact consumed identically by human and agent preview runtimes. */
export type ViuPreviewSnapshot = Readonly<{
  snapshotId: ViuId;
  formatVersion: 1;
  projectId: ViuId;
  projectRevision: number;
  createdAt: number;
  startScreenId: ViuId;
  startRoute: string;
  screenIds: readonly ViuId[];
  contentDigest: string;
  metadata: Readonly<ViuPreviewSnapshotMetadata>;
  diagnostics: readonly ViuDiagnostic[];
  project: ViuProjectState;
}>;

export type CreateViuPreviewSnapshotInput = {
  snapshotId: ViuId;
  createdAt: number;
  startScreenId: ViuId;
  metadata: ViuPreviewSnapshotMetadata;
};

/** Local package that Team can expose to invited testers without live co-editing. */
export type ViuTeamPreviewPackage = Readonly<{
  packageId: ViuId;
  version: 1;
  createdAt: number;
  teamWorkspaceKey: string;
  teamTaskId?: ViuId;
  access: 'team-test';
  consumers: readonly ['user-preview', 'agent-preview'];
  snapshot: ViuPreviewSnapshot;
}>;

export type CreateViuTeamPreviewPackageInput = {
  packageId: ViuId;
  createdAt: number;
  teamWorkspaceKey: string;
  teamTaskId?: ViuId;
};

export type ViuPreviewFeedbackKind = 'comment' | 'issue' | 'approval' | 'observation';

export type ViuPreviewFeedbackEvent = Readonly<{
  feedbackId: ViuId;
  snapshotId: ViuId;
  snapshotRevision: number;
  authorId: ViuId;
  authorKind: 'user' | 'agent';
  createdAt: number;
  kind: ViuPreviewFeedbackKind;
  body: string;
  screenId?: ViuId;
  nodeId?: ViuId;
}>;

export type CreateViuPreviewFeedbackInput = Omit<ViuPreviewFeedbackEvent, 'snapshotId' | 'snapshotRevision'>;
