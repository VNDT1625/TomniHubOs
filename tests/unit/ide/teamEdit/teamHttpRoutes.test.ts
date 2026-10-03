/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  admitTeamPeer,
  clearAllSessions,
  publishTeamSession,
} from '@package-apps/shared/process/collaboration/collabServer';
import {
  handleTeamRequest,
  JoinFailureRateLimiter,
} from '@package-apps/ide/process/collaboration/teamEdit/teamHttpRoutes';
import { teamRemoteClient } from '@package-apps/ide/process/collaboration/teamEdit/teamRemoteClient';
import type { TeamSessionHost } from '@package-apps/ide/process/collaboration/teamEdit/teamSessionHost';

const servers: Server[] = [];

afterEach(async () => {
  clearAllSessions();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

const serve = async (host: TeamSessionHost): Promise<string> => {
  const server = createServer((req, res) => {
    const sub = new URL(req.url ?? '/', 'http://local').pathname.split('/')[2] ?? '';
    void handleTeamRequest(req, res, ['team', sub], host).then((handled) => {
      if (!handled && !res.writableEnded) res.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
};

const hostStub = (): TeamSessionHost =>
  ({
    joinPeer: vi.fn(),
    leavePeer: vi.fn(),
    snapshot: vi.fn(() => ({ participants: [], leases: [], activity: [] })),
    claim: vi.fn(),
    release: vi.fn(),
    listDir: vi.fn(async () => []),
    readFile: vi.fn(async () => ({ content: '', contentHash: '' })),
    write: vi.fn(async () => ({ ok: true })),
    edit: vi.fn(async () => ({ ok: true })),
    understand: vi.fn(async () => null),
    wiki: vi.fn(async () => null),
    dbConnections: vi.fn(async () => []),
    dbQuery: vi.fn(async () => ({ columns: [], rows: [], rowCount: 0 })),
    queueStatus: vi.fn(() => ({ running: 0, pending: 0, maxConcurrent: 1, maxPending: 1 })),
    listPreviews: vi.fn(() => []),
    getPreview: vi.fn(() => null),
    appendPreviewFeedback: vi.fn(),
    listPreviewFeedback: vi.fn(() => []),
  }) as unknown as TeamSessionHost;

describe('teamRemoteClient - HTTP security and failure contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses bearer headers for read routes and preserves complete preview/write payloads', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const sub = url.pathname.split('/').at(-1);
      const bodies: Record<string, unknown> = {
        join: {
          peerToken: 'bearer-token',
          repoName: 'repo',
          peerCapabilities: { write: true, database: false },
        },
        snapshot: { snapshot: { participants: [], leases: [], activity: [] } },
        tree: { entries: [{ name: 'src' }] },
        file: { content: 'source', contentHash: 'hash' },
        claim: { claim: { relPath: 'src/app.ts' } },
        release: {},
        write: { result: { ok: true, bytes: 4 } },
        edit: { result: { ok: true, matches: 1 } },
        previews: { packages: [{ packageId: 'package-1' }] },
        preview: { package: { packageId: 'package-1' } },
        'preview-feedback':
          init?.method === 'POST'
            ? { event: { feedbackId: 'feedback-1' } }
            : { feedback: [{ feedbackId: 'feedback-1' }] },
        understand: { graph: { nodes: [] } },
        wiki: { wiki: { pages: [] } },
        db: { connections: [{ id: 'db-1' }] },
        'db-query': { result: { columns: [], rows: [], rowCount: 0 } },
        queue: { status: { running: 0, pending: 0, maxConcurrent: 4, maxPending: 32 } },
        leave: {},
      };
      return {
        ok: true,
        status: 200,
        json: async () => bodies[sub ?? ''] ?? {},
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const baseUrl = 'https://team.test///';
    await expect(teamRemoteClient.join(baseUrl, 'secret', 'Reviewer')).resolves.toMatchObject({
      ok: true,
      peerToken: 'bearer-token',
      baseUrl: 'https://team.test',
    });
    await teamRemoteClient.leave(baseUrl, 'bearer-token');
    await teamRemoteClient.snapshot(baseUrl, 'bearer-token');
    await teamRemoteClient.tree(baseUrl, 'bearer-token', 'src');
    await teamRemoteClient.file(baseUrl, 'bearer-token', 'src/app.ts');
    await teamRemoteClient.claim(baseUrl, 'bearer-token', 'src/app.ts', 'review');
    await teamRemoteClient.release(baseUrl, 'bearer-token', 'src/app.ts');
    await teamRemoteClient.write(baseUrl, 'bearer-token', 'src/app.ts', 'next');
    await teamRemoteClient.edit(baseUrl, 'bearer-token', 'src/app.ts', 'old', 'new');
    await teamRemoteClient.previews(baseUrl, 'bearer-token');
    await teamRemoteClient.preview(baseUrl, 'bearer-token', 'package-1');
    await teamRemoteClient.previewFeedback(baseUrl, 'bearer-token', 'package-1');
    await teamRemoteClient.appendPreviewFeedback(baseUrl, 'bearer-token', 'package-1', {
      kind: 'issue',
      body: 'CTA is hidden',
      screenId: 'screen-home',
      nodeId: 'node-cta',
    });
    await teamRemoteClient.understand(baseUrl, 'bearer-token');
    await teamRemoteClient.wiki(baseUrl, 'bearer-token');
    await teamRemoteClient.dbConnections(baseUrl, 'bearer-token');
    await teamRemoteClient.dbQuery(baseUrl, 'bearer-token', 'db-1', 'select 1');
    await teamRemoteClient.queue(baseUrl, 'bearer-token');

    const previewRead = fetchMock.mock.calls.find(([input]) => String(input).includes('/team/preview?'));
    expect(String(previewRead?.[0])).toContain('packageId=package-1');
    expect(String(previewRead?.[0])).not.toContain('bearer-token');
    expect(previewRead?.[1]?.headers).toEqual({ Authorization: 'Bearer bearer-token' });

    const feedbackPost = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith('/team/preview-feedback') && init?.method === 'POST'
    );
    expect(JSON.parse(String(feedbackPost?.[1]?.body))).toEqual({
      token: 'bearer-token',
      packageId: 'package-1',
      kind: 'issue',
      body: 'CTA is hidden',
      screenId: 'screen-home',
      nodeId: 'node-cta',
    });
  });

  it('normalizes HTTP, invalid JSON, abort, and non-Error failures into stable envelopes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ ok: false, error: 'access denied' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error('invalid json');
        },
      })
      .mockRejectedValueOnce(new Error('request aborted'))
      .mockRejectedValueOnce('socket closed');
    vi.stubGlobal('fetch', fetchMock);

    await expect(teamRemoteClient.snapshot('https://team.test', 'token')).resolves.toEqual({
      ok: false,
      error: 'access denied',
    });
    await expect(teamRemoteClient.snapshot('https://team.test', 'token')).resolves.toEqual({
      ok: false,
      error: 'HTTP 503',
    });
    await expect(teamRemoteClient.snapshot('https://team.test', 'token')).resolves.toEqual({
      ok: false,
      error: 'host-unreachable',
    });
    await expect(teamRemoteClient.snapshot('https://team.test', 'token')).resolves.toEqual({
      ok: false,
      error: 'socket closed',
    });
  });
});
describe('team join failure limiter', () => {
  it('caps the production tracker at 1,024 distinct clients', () => {
    const limiter = new JoinFailureRateLimiter();

    for (let client = 0; client < 1100; client += 1) {
      limiter.recordFailure(`client-${client}`, 0);
    }

    expect(limiter.trackedKeys).toBe(1024);
    expect(limiter.retryAfterMs('overflow-client', 1)).toBeGreaterThan(0);
  });

  it('bounds tracked clients and releases capacity after the oldest window expires', () => {
    const limiter = new JoinFailureRateLimiter({
      maxFailures: 5,
      maxTrackedKeys: 2,
      windowMs: 100,
    });

    limiter.recordFailure('client-a', 0);
    limiter.recordFailure('client-b', 10);

    expect(limiter.retryAfterMs('client-c', 20)).toBe(80);
    limiter.recordFailure('client-c', 20);
    expect(limiter.trackedKeys).toBe(2);

    expect(limiter.retryAfterMs('client-c', 100)).toBe(0);
    limiter.recordFailure('client-c', 100);
    expect(limiter.trackedKeys).toBe(2);
  });
});

describe('team HTTP security boundary', () => {
  it('rejects file writes when the peer token is read-only', async () => {
    const session = publishTeamSession({
      repoRoot: '/repo',
      repoName: 'repo',
      password: 'secret',
      peerCapabilities: { write: false },
    });
    const peer = admitTeamPeer(session, 'Reviewer');
    const host = hostStub();
    const baseUrl = await serve(host);

    const response = await fetch(`${baseUrl}/team/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: peer.token, relPath: 'a.ts', data: 'changed' }),
    });

    expect(response.status).toBe(403);
    expect(host.write).not.toHaveBeenCalled();
  });

  it('separates the public participant id from the secret bearer token at join', async () => {
    publishTeamSession({ repoRoot: '/repo', repoName: 'repo', password: 'secret' });
    const host = hostStub();
    const baseUrl = await serve(host);

    const response = await fetch(`${baseUrl}/team/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret', name: 'Reviewer' }),
    });
    const payload = (await response.json()) as {
      peerToken: string;
      participant: { agentId: string; label: string };
    };

    expect(response.status).toBe(200);
    expect(payload.participant.agentId).not.toBe(payload.peerToken);
    expect(payload.participant.agentId).toMatch(/^participant_/);
    expect(host.joinPeer).toHaveBeenCalledWith('/repo', payload.participant.agentId, 'Reviewer');
  });

  it('keeps database proxy access opt-in per peer token', async () => {
    const session = publishTeamSession({ repoRoot: '/repo', repoName: 'repo', password: 'secret' });
    const peer = admitTeamPeer(session, 'Developer');
    const host = hostStub();
    const baseUrl = await serve(host);

    const response = await fetch(`${baseUrl}/team/db`, {
      headers: { authorization: `Bearer ${peer.token}` },
    });

    expect(response.status).toBe(403);
    expect(host.dbConnections).not.toHaveBeenCalled();
  });

  it('serves the complete authenticated IDE surface with public participant identity', async () => {
    const session = publishTeamSession({
      repoRoot: '/repo',
      repoName: 'repo',
      password: 'secret',
      peerCapabilities: { write: true, database: true },
    });
    const peer = admitTeamPeer(session, 'Developer');
    const host = hostStub();
    vi.mocked(host.snapshot).mockReturnValue({ participants: [], leases: [], activity: [] } as never);
    vi.mocked(host.listDir).mockResolvedValue([{ name: 'src', isDir: true }]);
    vi.mocked(host.readFile).mockResolvedValue({ content: 'source' });
    vi.mocked(host.claim).mockReturnValue({ ok: true, renewed: false, lease: { relPath: 'src/app.ts' } } as never);
    vi.mocked(host.release).mockReturnValue(true);
    vi.mocked(host.understand).mockResolvedValue({ nodes: [] });
    vi.mocked(host.wiki).mockResolvedValue({ pages: [] });
    vi.mocked(host.dbConnections).mockResolvedValue([{ id: 'db-1', name: 'Primary', kind: 'sqlite' }]);
    vi.mocked(host.dbQuery).mockResolvedValue({ columns: ['value'], rows: [[1]], rowCount: 1 });
    vi.mocked(host.listPreviewFeedback).mockReturnValue([{ feedbackId: 'feedback-1' }] as never);
    const baseUrl = await serve(host);

    await expect(teamRemoteClient.snapshot(baseUrl, peer.token)).resolves.toMatchObject({ ok: true });
    await expect(teamRemoteClient.tree(baseUrl, peer.token, 'src')).resolves.toMatchObject({
      entries: [{ name: 'src', isDir: true }],
    });
    await expect(teamRemoteClient.file(baseUrl, peer.token, 'src/app.ts')).resolves.toMatchObject({
      read: { content: 'source' },
    });
    await expect(teamRemoteClient.claim(baseUrl, peer.token, 'src/app.ts', 'implement')).resolves.toMatchObject({
      data: { claim: { ok: true } },
    });
    await expect(teamRemoteClient.release(baseUrl, peer.token, 'src/app.ts')).resolves.toMatchObject({
      data: { released: true },
    });
    await expect(teamRemoteClient.write(baseUrl, peer.token, 'src/app.ts', 'next')).resolves.toMatchObject({
      result: { ok: true },
    });
    await expect(teamRemoteClient.edit(baseUrl, peer.token, 'src/app.ts', 'old', 'new')).resolves.toMatchObject({
      result: { ok: true },
    });
    await expect(teamRemoteClient.understand(baseUrl, peer.token)).resolves.toMatchObject({ graph: { nodes: [] } });
    await expect(teamRemoteClient.wiki(baseUrl, peer.token)).resolves.toMatchObject({ wiki: { pages: [] } });
    await expect(teamRemoteClient.dbConnections(baseUrl, peer.token)).resolves.toMatchObject({
      connections: [{ id: 'db-1' }],
    });
    await expect(teamRemoteClient.dbQuery(baseUrl, peer.token, 'db-1', 'select 1')).resolves.toMatchObject({
      result: { rowCount: 1 },
    });
    await expect(teamRemoteClient.queue(baseUrl, peer.token)).resolves.toMatchObject({
      status: { running: 0, pending: 0 },
    });
    await expect(teamRemoteClient.previewFeedback(baseUrl, peer.token, 'preview-1')).resolves.toMatchObject({
      feedback: [{ feedbackId: 'feedback-1' }],
    });
    await teamRemoteClient.leave(baseUrl, peer.token);

    expect(host.claim).toHaveBeenCalledWith('/repo', peer.id, 'src/app.ts', 'implement');
    expect(host.write).toHaveBeenCalledWith('/repo', peer.id, 'src/app.ts', 'next');
    expect(host.leavePeer).toHaveBeenCalledWith('/repo', peer.id);
  });

  it('serves immutable VIU previews only to authenticated peers', async () => {
    const session = publishTeamSession({ repoRoot: '/repo', repoName: 'repo', password: 'secret' });
    const peer = admitTeamPeer(session, 'Reviewer');
    const host = hostStub();
    const preview = { packageId: 'preview-1' };
    vi.mocked(host.listPreviews).mockReturnValue([preview] as never);
    vi.mocked(host.getPreview).mockReturnValue(preview as never);
    const baseUrl = await serve(host);

    const denied = await fetch(`${baseUrl}/team/previews`, { headers: { authorization: 'Bearer invalid' } });
    const leakedQueryToken = await fetch(`${baseUrl}/team/previews?token=${encodeURIComponent(peer.token)}`);
    const listed = await teamRemoteClient.previews(baseUrl, peer.token);
    const opened = await teamRemoteClient.preview(baseUrl, peer.token, 'preview-1');

    expect(denied.status).toBe(401);
    expect(leakedQueryToken.status).toBe(401);
    expect(listed).toEqual({ ok: true, packages: [preview] });
    expect(opened).toEqual({ ok: true, package: preview });
    expect(host.getPreview).toHaveBeenCalledWith('/repo', 'preview-1');
  });

  it('binds preview feedback to a public peer id without exposing the bearer token', async () => {
    const session = publishTeamSession({ repoRoot: '/repo', repoName: 'repo', password: 'secret' });
    const peer = admitTeamPeer(session, 'Reviewer');
    const host = hostStub();
    vi.mocked(host.appendPreviewFeedback).mockImplementation((_root, _packageId, input) => input as never);
    const baseUrl = await serve(host);

    const response = await fetch(`${baseUrl}/team/preview-feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: peer.token,
        packageId: 'preview-1',
        kind: 'comment',
        body: 'Ship this flow',
        authorId: 'forged-agent',
        authorKind: 'agent',
      }),
    });

    expect(response.status).toBe(200);
    expect(host.appendPreviewFeedback).toHaveBeenCalledWith(
      '/repo',
      'preview-1',
      expect.objectContaining({
        authorId: peer.id,
        authorKind: 'user',
        kind: 'comment',
        body: 'Ship this flow',
      })
    );
    const payload = (await response.json()) as { event: { authorId: string; authorKind: string } };
    expect(payload.event.authorId).toBe(peer.id);
    expect(payload.event.authorKind).toBe('user');
  });

  it('rate-limits repeated password failures by session and remote address', async () => {
    publishTeamSession({ repoRoot: '/repo', repoName: 'repo', password: 'correct-password' });
    const baseUrl = await serve(hostStub());

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${baseUrl}/team/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'wrong-password', name: 'Attacker' }),
      });
      expect(response.status).toBe(401);
    }

    const limited = await fetch(`${baseUrl}/team/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password', name: 'Blocked' }),
    });

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('rejects declared request bodies above the bounded payload limit', async () => {
    publishTeamSession({ repoRoot: '/repo', repoName: 'repo', password: 'secret' });
    const baseUrl = await serve(hostStub());

    const response = await fetch(`${baseUrl}/team/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'x'.repeat(1024 * 1024 + 1) }),
    });

    expect(response.status).toBe(413);
  });

  it('rejects chunked request bodies above the bounded payload limit', async () => {
    publishTeamSession({ repoRoot: '/repo', repoName: 'repo', password: 'secret' });
    const baseUrl = await serve(hostStub());

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${baseUrl}/team/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
      });
      req.on('response', (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      req.on('error', reject);
      req.write('{"password":"');
      req.write('x'.repeat(1024 * 1024 + 1));
      req.end('"}');
    });

    expect(status).toBe(413);
  });
});
