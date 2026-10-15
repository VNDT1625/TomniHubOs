import { describe, expect, it, vi } from 'vitest';
import { buildLsRemoteArgs, createGitRemote, parseLsRemote } from '@process/integrations/repoSources/gitRemote';

const HEAD = 'a'.repeat(40);
const BRANCH = 'b'.repeat(40);
const TAG_OBJECT = 'c'.repeat(40);
const TAG_COMMIT = 'd'.repeat(40);

describe('parseLsRemote', () => {
  it('reads HEAD when no ref was recorded', () => {
    expect(parseLsRemote(`${HEAD}\tHEAD\n${BRANCH}\trefs/heads/main\n`, undefined)).toBe(HEAD);
  });

  it('prefers the peeled commit of an annotated tag, then a branch, then a plain tag', () => {
    const output = [`${TAG_OBJECT}\trefs/tags/v1`, `${TAG_COMMIT}\trefs/tags/v1^{}`, `${BRANCH}\trefs/heads/v1`].join(
      '\n'
    );
    expect(parseLsRemote(output, 'v1')).toBe(TAG_COMMIT);
    expect(parseLsRemote(`${BRANCH}\trefs/heads/v1\n${TAG_OBJECT}\trefs/tags/v1\n`, 'v1')).toBe(BRANCH);
    expect(parseLsRemote(`${TAG_OBJECT}\trefs/tags/v1\n`, 'v1')).toBe(TAG_OBJECT);
  });

  it('says "unknown" for a missing ref and ignores lines that are not a full commit id', () => {
    expect(parseLsRemote(`${HEAD}\trefs/heads/main\n`, 'other')).toBeUndefined();
    expect(parseLsRemote(`short\tHEAD\n${'z'.repeat(40)}\tHEAD\n\n`, undefined)).toBeUndefined();
    expect(parseLsRemote('', undefined)).toBeUndefined();
  });
});

describe('buildLsRemoteArgs', () => {
  it('allows https only, puts the address after "--" and asks for exactly the recorded ref', () => {
    const args = buildLsRemoteArgs('https://github.com/o/r.git', 'main');
    expect(args.slice(0, 6)).toEqual([
      '-c',
      'protocol.allow=never',
      '-c',
      'protocol.https.allow=always',
      '-c',
      'credential.helper=',
    ]);
    expect(args.slice(6)).toEqual([
      'ls-remote',
      '--',
      'https://github.com/o/r.git',
      'refs/heads/main',
      'refs/tags/main',
      'refs/tags/main^{}',
    ]);
    expect(buildLsRemoteArgs('https://github.com/o/r.git', undefined).slice(-1)).toEqual(['HEAD']);
  });
});

describe('createGitRemote', () => {
  it('asks the canonical address and returns the commit', async () => {
    const run = vi.fn(async () => `${HEAD}\tHEAD\n`);
    const remote = createGitRemote({ run });
    await expect(remote.resolveCommit({ url: 'https://github.com/o/r.git' })).resolves.toBe(HEAD);
    expect(run).toHaveBeenCalledWith(expect.arrayContaining(['https://github.com/o/r.git']), expect.anything());
  });

  it('refuses an address that a clone would refuse, before spawning anything', async () => {
    const run = vi.fn(async () => '');
    const remote = createGitRemote({ run });
    for (const url of [
      'http://github.com/o/r.git',
      'https://evil.example.com/o/r.git',
      'https://user:secret@github.com/o/r.git',
      'git@github.com:o/r.git',
      '--upload-pack=calc',
      '/etc/passwd',
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- table of cases, each must fail on its own
      await expect(remote.resolveCommit({ url })).rejects.toBeInstanceOf(Error);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a recorded ref that could be read as an option or climb', async () => {
    const run = vi.fn(async () => '');
    const remote = createGitRemote({ run });
    for (const ref of ['--exec=calc', 'a..b', 'ends/', 'x.lock', '']) {
      // oxlint-disable-next-line no-await-in-loop -- table of cases
      await expect(remote.resolveCommit({ url: 'https://github.com/o/r.git', ref })).rejects.toMatchObject({
        code: 'SOURCE_INVALID',
      });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('maps failures to stable codes and never repeats git output', async () => {
    const failing = (failure: object) =>
      createGitRemote({
        run: async () => {
          throw Object.assign(new Error('fatal: https://token@github.com/o/r.git denied'), failure);
        },
      });
    const request = { url: 'https://github.com/o/r.git' };
    await expect(failing({ code: 'ENOENT' }).resolveCommit(request)).rejects.toMatchObject({ code: 'GIT_UNAVAILABLE' });
    await expect(failing({ killed: true }).resolveCommit(request)).rejects.toMatchObject({ code: 'CLONE_TIMEOUT' });
    await expect(failing({ name: 'AbortError' }).resolveCommit(request)).rejects.toMatchObject({ code: 'CANCELLED' });
    const generic = await failing({})
      .resolveCommit(request)
      .catch((error: Error) => error);
    expect(generic).toMatchObject({ code: 'CLONE_FAILED' });
    expect((generic as Error).message).not.toContain('token');
  });
});
