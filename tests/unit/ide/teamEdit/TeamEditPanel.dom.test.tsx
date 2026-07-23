/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DOM tests for {@link TeamEditPanel} — the IDE "Team" mode surface. The
 * team-edit client is mocked so no IPC runs; we assert the panel renders
 * presence + leases from a snapshot and that the active-file lease control
 * reflects who holds the open file.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Message } from '@arco-design/web-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

const {
  snapshotMock,
  joinMock,
  claimMock,
  releaseMock,
  saveTaskMock,
  removeTaskMock,
  saveGroupMock,
  removeGroupMock,
  postMessageMock,
  listPreviewsMock,
  getPreviewMock,
  appendPreviewFeedbackMock,
  listPreviewFeedbackMock,
  remotePreviewsMock,
  remotePreviewMock,
  remotePreviewFeedbackMock,
  remoteAppendPreviewFeedbackMock,
  onChangedMock,
} = vi.hoisted(() => ({
  snapshotMock: vi.fn(),
  joinMock: vi.fn(),
  claimMock: vi.fn(),
  releaseMock: vi.fn(),
  saveTaskMock: vi.fn(),
  removeTaskMock: vi.fn(),
  saveGroupMock: vi.fn(),
  removeGroupMock: vi.fn(),
  postMessageMock: vi.fn(),
  listPreviewsMock: vi.fn(),
  getPreviewMock: vi.fn(),
  appendPreviewFeedbackMock: vi.fn(),
  listPreviewFeedbackMock: vi.fn(),
  remotePreviewsMock: vi.fn(),
  remotePreviewMock: vi.fn(),
  remotePreviewFeedbackMock: vi.fn(),
  remoteAppendPreviewFeedbackMock: vi.fn(),
  onChangedMock: vi.fn(),
}));

vi.mock('@renderer/pages/studio/ide/teamEdit/teamEditClient', () => ({
  teamEditClient: {
    snapshot: snapshotMock,
    join: joinMock,
    claim: claimMock,
    release: releaseMock,
    saveTask: saveTaskMock,
    removeTask: removeTaskMock,
    saveGroup: saveGroupMock,
    removeGroup: removeGroupMock,
    postMessage: postMessageMock,
    listPreviews: listPreviewsMock,
    getPreview: getPreviewMock,
    appendPreviewFeedback: appendPreviewFeedbackMock,
    listPreviewFeedback: listPreviewFeedbackMock,
    onChanged: onChangedMock,
  },
  USER_AGENT_ID: 'user',
}));

vi.mock('@renderer/pages/studio/ide/teamEdit/teamCollabClient', () => ({
  teamCollabClient: {
    remotePreviews: remotePreviewsMock,
    remotePreview: remotePreviewMock,
    remotePreviewFeedback: remotePreviewFeedbackMock,
    remoteAppendPreviewFeedback: remoteAppendPreviewFeedbackMock,
  },
}));

vi.mock('@renderer/pages/studio/ide/Viu/next/runtime', () => ({
  ViuPresentRuntime: ({ project }: { project: { projectId: string } }) => (
    <div data-testid='team-viu-preview'>{project.projectId}</div>
  ),
}));

import { createPremiumStarterProject, createViuPreviewSnapshot, createViuTeamPreviewPackage } from '@/common/viu';
import TeamEditPanel from '@renderer/pages/studio/ide/teamEdit/TeamEditPanel';
import type { UseTeamCollab } from '@renderer/pages/studio/ide/teamEdit/useTeamCollab';
import ReplicaStatusPanel from '@renderer/pages/studio/ide/teamEdit/cloud/ReplicaStatusPanel';
import type { UseCloudWorkspace } from '@renderer/pages/studio/ide/teamEdit/cloud/useCloudWorkspace';
import type { ReplicaConflict } from '@process/ide/teamEdit/cloud/cloudReplicaTypes';

const ROOT = '/repo';

/** A solo (non-collab) controller stub: the panel uses the local snapshot. */
const SOLO_COLLAB: UseTeamCollab = {
  role: 'none',
  publishInfo: null,
  peer: null,
  remoteSnapshot: null,
  busy: false,
  error: null,
  publish: async () => false,
  unpublish: async () => undefined,
  join: async () => false,
  leave: async () => undefined,
};

const SNAP = {
  rootPath: ROOT,
  participants: [
    { agentId: 'user', label: 'You', color: '#2C7FFF', isUser: true, joinedAt: 1, lastSeenAt: 2 },
    { agentId: 'agent-a', label: 'Agent A', color: '#22C55E', isUser: false, joinedAt: 1, lastSeenAt: 2 },
  ],
  leases: [{ relPath: 'src/a.ts', agentId: 'agent-a', acquiredAt: 1, renewedAt: 2, expiresAt: 99999999999999 }],
  activity: [{ seq: 1, at: 2, kind: 'claim' as const, agentId: 'agent-a', relPath: 'src/a.ts' }],
  groups: [{ id: 'group-a', name: 'Frontend', parentGroupId: null, memberIds: ['user'], createdAt: 1, updatedAt: 1 }],
  tasks: [
    {
      id: 'task-a',
      title: 'Payment flow',
      description: 'Build the payment flow',
      scope: 'group' as const,
      groupId: 'group-a',
      parentTaskId: null,
      creatorId: 'user',
      assigneeId: 'user',
      pinnedAgentId: 'agent-a',
      status: 'in_progress' as const,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  messages: [{ id: 'message-a', senderId: 'user', body: 'Please review', taskId: 'task-a', createdAt: 2 }],
};

const PEER_COLLAB = {
  ...SOLO_COLLAB,
  role: 'peer',
  peer: {
    baseUrl: 'https://team.example.test',
    token: 'peer-token',
    repoName: 'repo',
    workspacePath: ROOT,
    remoteMcpServer: {},
    peerCapabilities: { write: false, database: false },
  },
  remoteSnapshot: SNAP,
} as UseTeamCollab;

const PREVIEW_PROJECT = createPremiumStarterProject('team-preview-project');
const PREVIEW_PACKAGE = createViuTeamPreviewPackage(
  createViuPreviewSnapshot(PREVIEW_PROJECT, {
    snapshotId: 'snapshot-team-preview',
    createdAt: 10,
    startScreenId: 'screen-home',
    metadata: { title: 'Checkout prototype', createdBy: 'agent-design' },
  }),
  {
    packageId: 'package-team-preview',
    createdAt: 11,
    teamWorkspaceKey: ROOT,
    teamTaskId: 'task-a',
  }
);

describe('TeamEditPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Message, 'success').mockImplementation(() => undefined);
    vi.spyOn(Message, 'error').mockImplementation(() => undefined);
    window.localStorage.clear();
    snapshotMock.mockResolvedValue({ ok: true, data: SNAP });
    joinMock.mockResolvedValue({ ok: true, data: true });
    claimMock.mockResolvedValue({ ok: true, data: { ok: true, lease: SNAP.leases[0], renewed: false } });
    releaseMock.mockResolvedValue({ ok: true, data: true });
    listPreviewsMock.mockResolvedValue({ ok: true, data: [PREVIEW_PACKAGE] });
    getPreviewMock.mockResolvedValue({ ok: true, data: PREVIEW_PACKAGE });
    appendPreviewFeedbackMock.mockResolvedValue({
      ok: true,
      data: {
        feedbackId: 'feedback-ui',
        snapshotId: PREVIEW_PACKAGE.snapshot.snapshotId,
        snapshotRevision: PREVIEW_PACKAGE.snapshot.projectRevision,
        authorId: 'user',
        authorKind: 'user',
        createdAt: 20,
        kind: 'comment',
        body: 'Looks good',
        screenId: 'screen-home',
      },
    });
    listPreviewFeedbackMock.mockResolvedValue({ ok: true, data: [] });
    remotePreviewsMock.mockResolvedValue({ ok: true, data: [PREVIEW_PACKAGE] });
    remotePreviewMock.mockResolvedValue({ ok: true, data: PREVIEW_PACKAGE });
    remotePreviewFeedbackMock.mockResolvedValue({ ok: true, data: [] });
    remoteAppendPreviewFeedbackMock.mockResolvedValue(
      appendPreviewFeedbackMock.getMockImplementation()?.() ?? {
        ok: true,
        data: {
          feedbackId: 'feedback-peer',
          snapshotId: PREVIEW_PACKAGE.snapshot.snapshotId,
          snapshotRevision: PREVIEW_PACKAGE.snapshot.projectRevision,
          authorId: 'peer-token',
          authorKind: 'user',
          createdAt: 21,
          kind: 'comment',
          body: 'Peer tested this',
          screenId: 'screen-home',
        },
      }
    );
    onChangedMock.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an empty state when no folder is open', () => {
    render(<TeamEditPanel rootPath={null} activeFile={null} collab={SOLO_COLLAB} />);
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('opens the Tasks workspace and renders task ownership from the snapshot', async () => {
    render(<TeamEditPanel rootPath={ROOT} activeFile={null} collab={SOLO_COLLAB} />);

    expect((await screen.findAllByText('Payment flow')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Agent A')).length).toBeGreaterThan(0);
  });

  it('switches to Action and exposes the live held-file activity', async () => {
    render(<TeamEditPanel rootPath={ROOT} activeFile={null} collab={SOLO_COLLAB} />);

    fireEvent.click(await screen.findByText('ide.team.workspace.action'));
    expect((await screen.findAllByText('src/a.ts')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ide.team.activity.claim').length).toBeGreaterThan(0);
  });

  it('switches to Communication and renders the linked task thread', async () => {
    render(<TeamEditPanel rootPath={ROOT} activeFile={null} collab={SOLO_COLLAB} />);

    fireEvent.click(await screen.findByText('ide.team.workspace.communication'));
    const taskLinks = await screen.findAllByText('Payment flow');
    fireEvent.click(taskLinks[0]);
    expect(await screen.findByText('Please review')).toBeTruthy();
  });

  it('opens the same immutable Team package through the user preview consumer', async () => {
    render(<TeamEditPanel rootPath={ROOT} activeFile={null} collab={SOLO_COLLAB} />);

    fireEvent.click(await screen.findByText('ide.team.workspace.previews'));
    expect((await screen.findAllByText('Checkout prototype')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('ide.team.workspace.previewView.open'));

    await waitFor(() => expect(getPreviewMock).toHaveBeenCalledWith(ROOT, PREVIEW_PACKAGE.packageId, 'user-preview'));
    expect(await screen.findByTestId('team-viu-preview')).toHaveTextContent('team-preview-project');
  });

  it('submits feedback anchored to the selected snapshot screen', async () => {
    render(<TeamEditPanel rootPath={ROOT} activeFile={null} collab={SOLO_COLLAB} />);

    fireEvent.click(await screen.findByText('ide.team.workspace.previews'));
    fireEvent.change(await screen.findByPlaceholderText('ide.team.workspace.previewView.feedbackPlaceholder'), {
      target: { value: 'Looks good' },
    });
    fireEvent.click(screen.getByText('ide.team.workspace.previewView.sendFeedback'));

    await waitFor(() =>
      expect(appendPreviewFeedbackMock).toHaveBeenCalledWith(
        ROOT,
        PREVIEW_PACKAGE.packageId,
        expect.objectContaining({ body: 'Looks good', screenId: 'screen-home' })
      )
    );
  });

  it('lets an authenticated peer open the host preview and submit review feedback', async () => {
    render(<TeamEditPanel rootPath={ROOT} activeFile={null} collab={PEER_COLLAB} />);

    fireEvent.click(await screen.findByText('ide.team.workspace.previews'));
    expect((await screen.findAllByText('Checkout prototype')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText('ide.team.refresh'));
    await waitFor(() => expect(remotePreviewsMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText('ide.team.workspace.previewView.open'));
    await waitFor(() =>
      expect(remotePreviewMock).toHaveBeenCalledWith(
        'https://team.example.test',
        'peer-token',
        PREVIEW_PACKAGE.packageId
      )
    );
    expect(await screen.findByTestId('team-viu-preview')).toHaveTextContent('team-preview-project');

    fireEvent.change(screen.getByPlaceholderText('ide.team.workspace.previewView.feedbackPlaceholder'), {
      target: { value: 'Peer tested this' },
    });
    fireEvent.click(screen.getByText('ide.team.workspace.previewView.sendFeedback'));
    await waitFor(() =>
      expect(remoteAppendPreviewFeedbackMock).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://team.example.test',
          token: 'peer-token',
          packageId: PREVIEW_PACKAGE.packageId,
          feedback: expect.objectContaining({ body: 'Peer tested this', screenId: 'screen-home' }),
        })
      )
    );
  });

  it('subscribes to live snapshot pushes and joins the user', async () => {
    render(<TeamEditPanel rootPath={ROOT} activeFile={null} collab={SOLO_COLLAB} />);
    await waitFor(() => expect(joinMock).toHaveBeenCalledWith(ROOT, 'user', expect.any(String)));
    expect(onChangedMock).toHaveBeenCalled();
  });
});

const replicaConflict = (encoding: 'utf8' | 'base64'): ReplicaConflict => ({
  id: 'conflict-1',
  relPath: encoding === 'utf8' ? 'src/app.ts' : 'asset.bin',
  baseHash: 'base',
  localHash: 'local',
  remoteHash: 'remote',
  localEncoding: encoding,
  remoteEncoding: encoding,
  baseContent: encoding === 'utf8' ? 'base' : 'AA==',
  localContent: encoding === 'utf8' ? 'local' : 'AQ==',
  remoteContent: encoding === 'utf8' ? 'remote' : 'Ag==',
  createdAt: 1,
});

const replicaCloud = (conflict: ReplicaConflict): UseCloudWorkspace => ({
  connected: true,
  session: null,
  manifest: null,
  state: null,
  replica: {
    enabled: true,
    state: 'conflict',
    lastSyncedSeq: 4,
    pendingFiles: 1,
    conflicts: [conflict],
  },
  busy: false,
  publishing: false,
  pulling: false,
  publishProgress: null,
  pullProgress: null,
  error: null,
  connect: vi.fn(async () => true),
  disconnect: vi.fn(async () => undefined),
  publishLocal: vi.fn(async () => true),
  pullCloud: vi.fn(async () => true),
  claimFile: vi.fn(async () => true),
  releaseFile: vi.fn(async () => undefined),
  refreshStatus: vi.fn(async () => undefined),
  syncNow: vi.fn(async () => true),
  resolveConflict: vi.fn(async () => true),
});

describe('ReplicaStatusPanel', () => {
  it('does not offer a text merge editor for binary conflicts', () => {
    const cloud = replicaCloud(replicaConflict('base64'));
    render(<ReplicaStatusPanel cloud={cloud} />);

    expect(screen.getByText('asset.bin')).toBeTruthy();
    expect(screen.queryByText('ide.cloudWorkspace.replica.merge')).toBeNull();
  });

  it('resolves a text conflict through the merge editor', async () => {
    const cloud = replicaCloud(replicaConflict('utf8'));
    render(<ReplicaStatusPanel cloud={cloud} />);

    fireEvent.click(screen.getByText('ide.cloudWorkspace.replica.merge'));
    expect(await screen.findByDisplayValue(/<<<<<<< LOCAL/)).toBeTruthy();
  });
});
