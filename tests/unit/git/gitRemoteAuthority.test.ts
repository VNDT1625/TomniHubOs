import { beforeEach, describe, expect, it, vi } from 'vitest';

const registered = new Map<string, (request: unknown) => Promise<unknown>>();

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => ({
      provider: (handler: (request: unknown) => Promise<unknown>) => registered.set(channel, handler),
      invoke: vi.fn(),
    }),
    buildEmitter: () => ({ emit: vi.fn(), on: vi.fn() }),
  },
}));

import {
  GIT_MANAGER_CHANNELS,
  registerGitManagerBridge,
  type GitManagerServices,
} from '@/process/git/gitManagerBridge';
import {
  createGitRunner,
  GIT_REMOTE_OPERATION_DENIED,
  type GitRemoteExecution,
  type GitRemoteOperation,
  type GitSpawn,
} from '@/process/git/gitRunner';
import type { GitRepo, GitResult } from '@/process/git/gitTypes';

const repo: GitRepo = {
  id: 'repo-1',
  name: 'widgets',
  remoteUrl: 'https://alice:ignored@git.example.test/acme/widgets.git?secret=ignored#fragment',
  localPath: 'C:/private/widgets',
  branch: 'main',
  credentialId: 'credential-1',
  createdAt: 1,
  lastPushAt: null,
  lastPullAt: null,
};

const remoteExecution = (operation: GitRemoteOperation, admitted: boolean): GitRemoteExecution => ({
  authority: { authorizeRemoteOperation: vi.fn(async () => admitted) },
  request: {
    operation,
    repository: {
      id: 'repo-1',
      remoteOrigin: 'https://git.example.test/acme/widgets.git',
      branch: 'main',
      credentialConfigured: true,
    },
  },
});

const invoke = async <T>(channel: string, request: unknown): Promise<GitResult<T>> => {
  const handler = registered.get(channel);
  if (!handler) throw new Error(`No provider registered for ${channel}`);
  return (await handler(request)) as GitResult<T>;
};

const makeServices = (overrides?: Partial<GitManagerServices>): GitManagerServices => {
  const repoStore = {
    list: vi.fn(async () => [repo]),
    get: vi.fn(async () => repo),
    add: vi.fn(async () => repo),
    remove: vi.fn(async () => []),
    patch: vi.fn(async () => repo),
    onChange: vi.fn(() => () => undefined),
  };
  const credentialStore = {
    list: vi.fn(async () => []),
    add: vi.fn(),
    remove: vi.fn(),
    resolve: vi.fn(async () => ({ username: 'alice', token: 'ghp_real_secret' })),
  };
  const runner = {
    clone: vi.fn(async () => ({ ok: true, output: 'cloned' })),
    status: vi.fn(async () => ({
      isRepo: true,
      branch: 'main',
      changedCount: 0,
      ahead: 0,
      behind: 0,
      hasRemote: true,
    })),
    changes: vi.fn(async () => []),
    log: vi.fn(async () => []),
    commitAll: vi.fn(async () => ({ ok: true, output: 'committed' })),
    push: vi.fn(async () => ({ ok: true, output: 'pushed' })),
    pull: vi.fn(async () => ({ ok: true, output: 'pulled' })),
    initAndSetRemote: vi.fn(async () => ({ ok: true, output: 'done' })),
  };
  return { repoStore, credentialStore, runner, ...overrides } as unknown as GitManagerServices;
};

beforeEach(() => {
  registered.clear();
});

describe('Git Manager remote authority containment', () => {
  it('denies every remote operation by default before resolving a credential or invoking a runner', async () => {
    const services = makeServices();
    registerGitManagerBridge({ services });

    const clone = await invoke(GIT_MANAGER_CHANNELS.clone, { id: repo.id });
    const push = await invoke(GIT_MANAGER_CHANNELS.push, { id: repo.id });
    const pull = await invoke(GIT_MANAGER_CHANNELS.pull, { id: repo.id });

    expect(clone).toEqual({ ok: false, error: GIT_REMOTE_OPERATION_DENIED });
    expect(push).toEqual({ ok: false, error: GIT_REMOTE_OPERATION_DENIED });
    expect(pull).toEqual({ ok: false, error: GIT_REMOTE_OPERATION_DENIED });
    expect(services.credentialStore.resolve).not.toHaveBeenCalled();
    expect(services.runner.clone).not.toHaveBeenCalled();
    expect(services.runner.push).not.toHaveBeenCalled();
    expect(services.runner.pull).not.toHaveBeenCalled();
  });

  it('passes only bounded metadata to authority, then admits a controlled clone', async () => {
    const authorizeRemoteOperation = vi.fn(async () => true);
    const services = makeServices({ remoteAuthority: { authorizeRemoteOperation } });
    registerGitManagerBridge({ services });

    const result = await invoke(GIT_MANAGER_CHANNELS.clone, { id: repo.id });

    expect(result).toEqual({ ok: true, data: { ok: true, output: 'cloned' } });
    expect(authorizeRemoteOperation).toHaveBeenCalledWith({
      operation: 'clone',
      repository: {
        id: repo.id,
        remoteOrigin: 'https://git.example.test/acme/widgets.git',
        branch: 'main',
        credentialConfigured: true,
      },
    });
    expect(JSON.stringify(authorizeRemoteOperation.mock.calls)).not.toContain('ghp_real_secret');
    expect(services.credentialStore.resolve).toHaveBeenCalledWith('credential-1');
    expect(services.runner.clone).toHaveBeenCalledTimes(1);
    expect(authorizeRemoteOperation.mock.invocationCallOrder[0]).toBeLessThan(
      services.credentialStore.resolve.mock.invocationCallOrder[0]
    );
  });

  it('keeps local status and commit paths independent from remote admission', async () => {
    const authorizeRemoteOperation = vi.fn(async () => false);
    const services = makeServices({ remoteAuthority: { authorizeRemoteOperation } });
    registerGitManagerBridge({ services });

    await expect(invoke(GIT_MANAGER_CHANNELS.repoStatus, { id: repo.id })).resolves.toMatchObject({ ok: true });
    await expect(invoke(GIT_MANAGER_CHANNELS.commit, { id: repo.id, message: 'local only' })).resolves.toMatchObject({
      ok: true,
    });

    expect(authorizeRemoteOperation).not.toHaveBeenCalled();
    expect(services.credentialStore.resolve).not.toHaveBeenCalled();
    expect(services.runner.status).toHaveBeenCalledWith(repo.localPath);
    expect(services.runner.commitAll).toHaveBeenCalledWith(repo.localPath, 'local only');
  });
});

describe('gitRunner remote spawn seam', () => {
  it('does not spawn when an authority denies or is absent', async () => {
    const spawn: GitSpawn = vi.fn(async () => ({ code: 0, stdout: 'unexpected', stderr: '' }));
    const runner = createGitRunner({ spawn });

    await expect(runner.clone('https://git.example.test/acme/widgets.git', '/repo', 'main')).resolves.toEqual({
      ok: false,
      output: GIT_REMOTE_OPERATION_DENIED,
    });
    await expect(
      runner.push('/repo', 'main', { username: 'alice', token: 'ghp_real_secret' }, remoteExecution('push', false))
    ).resolves.toEqual({ ok: false, output: GIT_REMOTE_OPERATION_DENIED });

    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawns a controlled remote action only after authority admission', async () => {
    const spawn: GitSpawn = vi.fn(async () => ({ code: 0, stdout: 'ok', stderr: '' }));
    const runner = createGitRunner({ spawn });

    await expect(
      runner.pull('/repo', 'main', { username: 'alice', token: 'ghp_real_secret' }, remoteExecution('pull', true))
    ).resolves.toEqual({ ok: true, output: 'ok' });

    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
