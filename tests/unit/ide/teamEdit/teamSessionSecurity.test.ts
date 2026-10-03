/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  admitTeamPeer,
  clearAllSessions,
  publishTeamSession,
  TEAM_PEER_IDLE_TTL_MS,
  teamPeerCan,
  touchTeamPeer,
} from '@package-apps/shared/process/collaboration/collabServer';

describe('teamCollabClient - renderer IPC contract', () => {
  afterEach(() => {
    vi.doUnmock('@office-ai/platform');
    vi.resetModules();
    vi.useRealTimers();
  });

  it('forwards host and peer preview operations without dropping credentials or anchors', async () => {
    vi.resetModules();
    const invoke = vi.fn(async (channel: string, payload: unknown) => ({ ok: true, data: { channel, payload } }));
    vi.doMock('@office-ai/platform', () => ({
      bridge: {
        buildProvider: (channel: string) => ({
          invoke: (payload?: unknown) => invoke(channel, payload),
        }),
      },
    }));

    const { teamCollabClient } = await import('@package-apps/ide/renderer/teamEdit/teamCollabClient');
    await teamCollabClient.publish('/repo', 'secret', true, false, true);
    await teamCollabClient.unpublish('/repo');
    await teamCollabClient.status();
    await teamCollabClient.join('https://team.test/', 'secret', 'Reviewer');
    await teamCollabClient.leave('https://team.test', 'bearer-token');
    await teamCollabClient.remoteSnapshot('https://team.test', 'bearer-token');
    await teamCollabClient.remoteTree('https://team.test', 'bearer-token', 'src');
    await teamCollabClient.remoteFile('https://team.test', 'bearer-token', 'src/app.ts');
    await teamCollabClient.remotePreviews('https://team.test', 'bearer-token');
    await teamCollabClient.remotePreview('https://team.test', 'bearer-token', 'package-1');
    await teamCollabClient.remotePreviewFeedback('https://team.test', 'bearer-token', 'package-1');
    await teamCollabClient.remoteAppendPreviewFeedback({
      baseUrl: 'https://team.test',
      token: 'bearer-token',
      packageId: 'package-1',
      feedback: { kind: 'issue', body: 'CTA is hidden', screenId: 'screen-home', nodeId: 'node-cta' },
    });
    await teamCollabClient.remoteClaim('https://team.test', 'bearer-token', 'src/app.ts', 'review');
    await teamCollabClient.remoteRelease('https://team.test', 'bearer-token', 'src/app.ts');
    await teamCollabClient.remoteWrite('https://team.test', 'bearer-token', 'src/app.ts', 'next');

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'ide.team-collab-publish',
      'ide.team-collab-unpublish',
      'ide.team-collab-status',
      'ide.team-collab-join',
      'ide.team-collab-leave',
      'ide.team-collab-remote-snapshot',
      'ide.team-collab-remote-tree',
      'ide.team-collab-remote-file',
      'ide.team-collab-remote-previews',
      'ide.team-collab-remote-preview',
      'ide.team-collab-remote-preview-feedback',
      'ide.team-collab-remote-append-preview-feedback',
      'ide.team-collab-remote-claim',
      'ide.team-collab-remote-release',
      'ide.team-collab-remote-write',
    ]);
    expect(invoke).toHaveBeenCalledWith('ide.team-collab-remote-append-preview-feedback', {
      baseUrl: 'https://team.test',
      token: 'bearer-token',
      packageId: 'package-1',
      feedback: { kind: 'issue', body: 'CTA is hidden', screenId: 'screen-home', nodeId: 'node-cta' },
    });
  });

  it('surfaces provider rejection and timeout rather than leaving the panel pending', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const invoke = vi.fn<() => Promise<unknown>>();
    vi.doMock('@office-ai/platform', () => ({
      bridge: {
        buildProvider: () => ({ invoke }),
      },
    }));

    const { TeamCollabTimeoutError, teamCollabClient } =
      await import('@package-apps/ide/renderer/teamEdit/teamCollabClient');
    invoke.mockRejectedValueOnce(new Error('preload unavailable'));
    await expect(teamCollabClient.status()).rejects.toThrow('preload unavailable');

    invoke.mockReturnValueOnce(new Promise(() => {}));
    const pending = expect(teamCollabClient.status()).rejects.toBeInstanceOf(TeamCollabTimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
  });
});

describe('teamCollabBridge - authenticated Main IPC forwarding', () => {
  const mockedModules = [
    '@office-ai/platform',
    '@package-apps/shared/process/collaboration/collabServer',
    '@package-apps/shared/process/collaboration/onlyOfficeServer',
    '@package-apps/shared/process/collaboration/collabDiscovery',
    '@process/services/remoteGateway/cloudflareTunnel',
    '@package-apps/ide/process/data/db/dbWiring',
    '@package-apps/ide/process/execution/quickTest/bridges/quickTestBridgeHelpers',
    '@package-apps/ide/process/knowledge/graph/kgRefresh',
    '@package-apps/ide/process/knowledge/wiki/wikiBuildBridge',
    '@package-apps/ide/process/collaboration/teamEdit/teamEditService',
    '@package-apps/ide/process/collaboration/teamEdit/teamSessionHost',
    '@package-apps/ide/process/collaboration/teamEdit/teamHttpRoutes',
    '@package-apps/ide/process/collaboration/teamEdit/remoteIdeMcp',
    '@package-apps/ide/process/collaboration/teamEdit/teamRemoteClient',
  ];

  afterEach(() => {
    for (const moduleName of mockedModules) vi.doUnmock(moduleName);
    vi.resetModules();
  });

  it('publishes a LAN session and forwards every authenticated peer operation', async () => {
    vi.resetModules();
    const providers = new Map<string, (request: never) => Promise<unknown>>();
    const registerExtraRoute = vi.fn();
    const joinPresence = vi.fn();
    const resetPresence = vi.fn();
    const session = {
      shareId: 'share-1',
      repoRoot: '/repo',
      repoName: 'repo',
      peerCapabilities: { write: true, database: false },
    };
    const preview = { packageId: 'package-1' };
    const feedback = { feedbackId: 'feedback-1' };
    const remote = {
      join: vi.fn(async () => ({
        ok: true,
        peerToken: 'bearer-token',
        repoName: 'repo',
        baseUrl: 'https://team.test',
        peerCapabilities: { write: true, database: false },
      })),
      leave: vi.fn(async () => ({ ok: true })),
      snapshot: vi.fn(async () => ({ ok: true, snapshot: { participants: [], leases: [], activity: [] } })),
      tree: vi.fn(async () => ({ entries: [{ name: 'src' }] })),
      file: vi.fn(async () => ({ read: { content: 'source', contentHash: 'hash' } })),
      previews: vi.fn(async () => ({ ok: true, packages: [preview] })),
      preview: vi.fn(async () => ({ ok: true, package: preview })),
      previewFeedback: vi.fn(async () => ({ ok: true, feedback: [feedback] })),
      appendPreviewFeedback: vi.fn(async () => ({ ok: true, event: feedback })),
      claim: vi.fn(async () => ({ data: { claim: { relPath: 'src/app.ts' } } })),
      release: vi.fn(async () => ({ data: true })),
      write: vi.fn(async () => ({ result: { ok: true, bytes: 4 } })),
    };

    vi.doMock('@office-ai/platform', () => ({
      bridge: {
        buildProvider: (channel: string) => ({
          provider: (handler: (request: never) => Promise<unknown>) => providers.set(channel, handler),
        }),
      },
    }));
    vi.doMock('@package-apps/shared/process/collaboration/collabServer', () => ({
      buildTeamPublishInfo: () => ({ shareId: 'share-1', joinCode: 'ABC123', lanIps: ['127.0.0.1'] }),
      getPrimaryTeamSession: () => session,
      hasTeamSessions: () => true,
      publishTeamSession: () => session,
      unpublishTeamSession: vi.fn(),
    }));
    vi.doMock('@package-apps/shared/process/collaboration/onlyOfficeServer', () => ({
      addServerKeepAlive: vi.fn(),
      ensureTeamHostServer: vi.fn(async () => undefined),
      getServerPort: () => 45123,
      registerExtraRoute,
      releaseServerKeepAlive: vi.fn(),
    }));
    vi.doMock('@package-apps/shared/process/collaboration/collabDiscovery', () => ({
      startBeacon: vi.fn(),
      stopBeacon: vi.fn(),
    }));
    vi.doMock('@process/services/remoteGateway/cloudflareTunnel', () => ({
      ensureCloudflared: vi.fn(async () => ({ ok: true })),
      startTunnel: vi.fn(async () => ({ ok: true, url: 'https://team.test' })),
      stopTunnel: vi.fn(),
    }));
    vi.doMock('@package-apps/ide/process/data/db/dbWiring', () => ({
      getDbService: () => ({
        listConnections: vi.fn(async () => []),
        connect: vi.fn(async () => undefined),
        query: vi.fn(async () => ({ columns: [], rows: [] })),
      }),
    }));
    vi.doMock('@package-apps/ide/process/execution/quickTest/bridges/quickTestBridgeHelpers', () => ({
      loadGraph: vi.fn(),
    }));
    vi.doMock('@package-apps/ide/process/knowledge/graph/kgRefresh', () => ({ refreshGraphFileOnDisk: vi.fn() }));
    vi.doMock('@package-apps/ide/process/knowledge/wiki/wikiBuildBridge', () => ({ loadWikiForRoot: vi.fn() }));
    vi.doMock('@package-apps/ide/process/collaboration/teamEdit/teamEditService', () => ({
      getTeamEditService: () => ({ join: joinPresence, reset: resetPresence }),
    }));
    vi.doMock('@package-apps/ide/process/collaboration/teamEdit/teamSessionHost', () => ({
      createTeamSessionHost: () => ({}),
    }));
    vi.doMock('@package-apps/ide/process/collaboration/teamEdit/teamHttpRoutes', () => ({
      handleTeamRequest: vi.fn(),
    }));
    vi.doMock('@package-apps/ide/process/collaboration/teamEdit/remoteIdeMcp', () => ({
      ensureRemoteIdeMcpRegistered: vi.fn(async () => ({
        workspacePath: '/remote/repo',
        server: { id: 'remote-team' },
      })),
      clearRemoteIdeMcpSession: vi.fn(),
    }));
    vi.doMock('@package-apps/ide/process/collaboration/teamEdit/teamRemoteClient', () => ({
      teamRemoteClient: remote,
    }));

    const { registerTeamCollabBridge } =
      await import('@package-apps/ide/process/collaboration/teamEdit/teamCollabBridge');
    registerTeamCollabBridge();

    await expect(
      providers.get('ide.team-collab-publish')?.({
        rootPath: ' /repo ',
        password: 'secret',
        online: false,
        allowWrites: true,
        allowDatabase: false,
      } as never)
    ).resolves.toMatchObject({ ok: true, data: { online: false, shareId: 'share-1' } });
    await expect(providers.get('ide.team-collab-status')?.(undefined as never)).resolves.toMatchObject({
      ok: true,
      data: { publishing: true },
    });
    await expect(
      providers.get('ide.team-collab-join')?.({
        baseUrl: 'https://team.test',
        password: 'secret',
        name: 'Reviewer',
      } as never)
    ).resolves.toMatchObject({ ok: true, data: { peerToken: 'bearer-token', workspacePath: '/remote/repo' } });

    const peer = { baseUrl: 'https://team.test', token: 'bearer-token' };
    const peerCalls: Array<[string, unknown]> = [
      ['ide.team-collab-remote-snapshot', peer],
      ['ide.team-collab-remote-tree', { ...peer, dir: 'src' }],
      ['ide.team-collab-remote-file', { ...peer, relPath: 'src/app.ts' }],
      ['ide.team-collab-remote-previews', peer],
      ['ide.team-collab-remote-preview', { ...peer, packageId: 'package-1' }],
      ['ide.team-collab-remote-preview-feedback', { ...peer, packageId: 'package-1' }],
      [
        'ide.team-collab-remote-append-preview-feedback',
        { ...peer, packageId: 'package-1', feedback: { kind: 'comment', body: 'Ready' } },
      ],
      ['ide.team-collab-remote-claim', { ...peer, relPath: 'src/app.ts', intent: 'review' }],
      ['ide.team-collab-remote-release', { ...peer, relPath: 'src/app.ts' }],
      ['ide.team-collab-remote-write', { ...peer, relPath: 'src/app.ts', data: 'next' }],
    ];
    await Promise.all(
      peerCalls.map(([channel, request]) =>
        expect(providers.get(channel)?.(request as never)).resolves.toMatchObject({ ok: true })
      )
    );
    await expect(providers.get('ide.team-collab-leave')?.(peer as never)).resolves.toEqual({ ok: true, data: true });
    await expect(providers.get('ide.team-collab-unpublish')?.({ rootPath: '/repo' } as never)).resolves.toEqual({
      ok: true,
      data: true,
    });

    expect(registerExtraRoute).toHaveBeenCalledWith('team', expect.any(Function));
    expect(joinPresence).toHaveBeenCalledWith('/repo', 'host', 'Host', true);
    expect(resetPresence).toHaveBeenCalledWith('/repo');
    expect(remote.appendPreviewFeedback).toHaveBeenCalledWith('https://team.test', 'bearer-token', 'package-1', {
      kind: 'comment',
      body: 'Ready',
    });
  });

  it('returns an error envelope when a remote preview is rejected or throws', async () => {
    vi.resetModules();
    const providers = new Map<string, (request: never) => Promise<unknown>>();
    const preview = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'preview denied' })
      .mockRejectedValueOnce(new Error('network offline'));

    vi.doMock('@office-ai/platform', () => ({
      bridge: {
        buildProvider: (channel: string) => ({
          provider: (handler: (request: never) => Promise<unknown>) => providers.set(channel, handler),
        }),
      },
    }));
    vi.doMock('@package-apps/shared/process/collaboration/collabServer', () => ({
      buildTeamPublishInfo: vi.fn(),
      getPrimaryTeamSession: vi.fn(),
      hasTeamSessions: vi.fn(() => false),
      publishTeamSession: vi.fn(),
      unpublishTeamSession: vi.fn(),
    }));
    vi.doMock('@package-apps/shared/process/collaboration/collabDiscovery', () => ({
      startBeacon: vi.fn(),
      stopBeacon: vi.fn(),
    }));
    vi.doMock('@process/services/remoteGateway/cloudflareTunnel', () => ({
      ensureCloudflared: vi.fn(),
      startTunnel: vi.fn(),
      stopTunnel: vi.fn(),
    }));
    vi.doMock('@package-apps/ide/process/data/db/dbWiring', () => ({ getDbService: () => ({}) }));
    vi.doMock('@package-apps/ide/process/execution/quickTest/bridges/quickTestBridgeHelpers', () => ({
      loadGraph: vi.fn(),
    }));
    vi.doMock('@package-apps/ide/process/knowledge/graph/kgRefresh', () => ({ refreshGraphFileOnDisk: vi.fn() }));
    vi.doMock('@package-apps/ide/process/knowledge/wiki/wikiBuildBridge', () => ({ loadWikiForRoot: vi.fn() }));
    vi.doMock('@package-apps/ide/process/collaboration/teamEdit/teamEditService', () => ({
      getTeamEditService: () => ({}),
    }));
    vi.doMock('@package-apps/ide/process/collaboration/teamEdit/teamSessionHost', () => ({
      createTeamSessionHost: () => ({}),
    }));
    vi.doMock('@package-apps/shared/process/collaboration/onlyOfficeServer', () => ({ registerExtraRoute: vi.fn() }));
    vi.doMock('@package-apps/ide/process/collaboration/teamEdit/teamHttpRoutes', () => ({
      handleTeamRequest: vi.fn(),
    }));
    vi.doMock('@package-apps/ide/process/collaboration/teamEdit/remoteIdeMcp', () => ({
      ensureRemoteIdeMcpRegistered: vi.fn(),
      clearRemoteIdeMcpSession: vi.fn(),
    }));
    vi.doMock('@package-apps/ide/process/collaboration/teamEdit/teamRemoteClient', () => ({
      teamRemoteClient: { preview },
    }));

    const { registerTeamCollabBridge } =
      await import('@package-apps/ide/process/collaboration/teamEdit/teamCollabBridge');
    registerTeamCollabBridge();
    const handler = providers.get('ide.team-collab-remote-preview');
    const request = { baseUrl: 'https://team.test', token: 'bearer-token', packageId: 'package-1' };

    await expect(handler?.(request as never)).resolves.toEqual({ ok: false, error: 'preview denied' });
    await expect(handler?.(request as never)).resolves.toEqual({ ok: false, error: 'network offline' });

    const dependencyFailureCalls: Array<[string, unknown]> = [
      ['ide.team-collab-publish', { rootPath: '/repo', online: false }],
      ['ide.team-collab-unpublish', { rootPath: '/repo' }],
      ['ide.team-collab-join', { baseUrl: 'https://team.test', password: 'secret', name: 'Reviewer' }],
      ['ide.team-collab-leave', { baseUrl: 'https://team.test', token: 'bearer-token' }],
      ['ide.team-collab-remote-snapshot', { baseUrl: 'https://team.test', token: 'bearer-token' }],
      ['ide.team-collab-remote-tree', { baseUrl: 'https://team.test', token: 'bearer-token', dir: 'src' }],
      ['ide.team-collab-remote-file', { baseUrl: 'https://team.test', token: 'bearer-token', relPath: 'src/app.ts' }],
      ['ide.team-collab-remote-previews', { baseUrl: 'https://team.test', token: 'bearer-token' }],
      [
        'ide.team-collab-remote-preview-feedback',
        { baseUrl: 'https://team.test', token: 'bearer-token', packageId: 'package-1' },
      ],
      [
        'ide.team-collab-remote-append-preview-feedback',
        {
          baseUrl: 'https://team.test',
          token: 'bearer-token',
          packageId: 'package-1',
          feedback: { kind: 'comment', body: 'Ready' },
        },
      ],
      ['ide.team-collab-remote-claim', { baseUrl: 'https://team.test', token: 'bearer-token', relPath: 'src/app.ts' }],
      [
        'ide.team-collab-remote-release',
        { baseUrl: 'https://team.test', token: 'bearer-token', relPath: 'src/app.ts' },
      ],
      [
        'ide.team-collab-remote-write',
        { baseUrl: 'https://team.test', token: 'bearer-token', relPath: 'src/app.ts', data: 'next' },
      ],
    ];
    for (const [channel, failedRequest] of dependencyFailureCalls) {
      await expect(providers.get(channel)?.(failedRequest as never)).resolves.toMatchObject({
        ok: false,
        error: expect.any(String),
      });
    }
  });
});
describe('team collaboration session security', () => {
  afterEach(() => clearAllSessions());

  it('binds host-selected capabilities to each admitted peer token', () => {
    const session = publishTeamSession({
      repoRoot: '/repo',
      repoName: 'repo',
      password: 'strong-password',
      peerCapabilities: { write: false, database: true },
    });

    const peer = admitTeamPeer(session, 'Reviewer');

    expect(teamPeerCan(peer, 'write')).toBe(false);
    expect(teamPeerCan(peer, 'database')).toBe(true);
  });

  it('rejects peers beyond the configured bounded session capacity', () => {
    const session = publishTeamSession({ repoRoot: '/repo', repoName: 'repo', password: 'secret', maxPeers: 1 });
    admitTeamPeer(session, 'First');

    expect(() => admitTeamPeer(session, 'Second')).toThrow(/1-peer limit/);
  });

  it('expires idle peer tokens instead of retaining access indefinitely', () => {
    const session = publishTeamSession({ repoRoot: '/repo', repoName: 'repo', password: 'secret' });
    const peer = admitTeamPeer(session, 'Idle peer');
    const expiredAt = peer.lastSeenAt + TEAM_PEER_IDLE_TTL_MS + 1;

    expect(touchTeamPeer(session, peer.token, expiredAt)).toBeUndefined();
    expect(session.peers.has(peer.token)).toBe(false);
  });
});
