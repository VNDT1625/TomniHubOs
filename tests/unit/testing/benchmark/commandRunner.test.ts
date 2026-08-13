/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  benchmarkSourceFingerprint,
  captureBenchmarkDiff,
  runBenchmarkCommand,
} from '@/process/testing/benchmark/commandRunner';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const workspaces: string[] = [];

const makeWorkspace = async (): Promise<string> => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'tomni-benchmark-command-'));
  workspaces.push(workspace);
  return workspace;
};

const git = (workspace: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd: workspace, stdio: 'ignore' });
};

const makeGitWorkspace = async (): Promise<string> => {
  const workspace = await makeWorkspace();
  git(workspace, 'init');
  git(workspace, 'config', 'user.email', 'benchmark@example.invalid');
  git(workspace, 'config', 'user.name', 'Benchmark Test');
  await writeFile(path.join(workspace, 'tracked.txt'), 'baseline\n', 'utf8');
  git(workspace, 'add', 'tracked.txt');
  git(workspace, 'commit', '-m', 'baseline');
  return workspace;
};

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) =>
      rm(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EBUSY' && error.code !== 'EPERM') throw error;
        }
      )
    )
  );
});

describe('benchmarkSourceFingerprint', () => {
  it('changes when staged content changes but porcelain status stays the same', async () => {
    const workspace = await makeGitWorkspace();
    await writeFile(path.join(workspace, 'tracked.txt'), 'staged one\n', 'utf8');
    git(workspace, 'add', 'tracked.txt');
    const first = await benchmarkSourceFingerprint(workspace);

    await writeFile(path.join(workspace, 'tracked.txt'), 'staged two\n', 'utf8');
    git(workspace, 'add', 'tracked.txt');
    const second = await benchmarkSourceFingerprint(workspace);

    expect(second).not.toBe(first);
  });

  it('changes when unstaged or untracked file content changes at the same path', async () => {
    const workspace = await makeGitWorkspace();
    await writeFile(path.join(workspace, 'tracked.txt'), 'working one\n', 'utf8');
    await writeFile(path.join(workspace, 'untracked.txt'), 'untracked one\n', 'utf8');
    const first = await benchmarkSourceFingerprint(workspace);

    await writeFile(path.join(workspace, 'tracked.txt'), 'working two\n', 'utf8');
    await writeFile(path.join(workspace, 'untracked.txt'), 'untracked two\n', 'utf8');
    const second = await benchmarkSourceFingerprint(workspace);

    expect(second).not.toBe(first);
  });

  it('fingerprints non-git workspace content deterministically while excluding generated dependencies', async () => {
    const workspace = await makeWorkspace();
    await mkdir(path.join(workspace, 'src'), { recursive: true });
    await mkdir(path.join(workspace, 'node_modules', 'generated'), { recursive: true });
    await writeFile(path.join(workspace, 'src', 'main.ts'), 'export const value = 1;\n', 'utf8');
    await writeFile(path.join(workspace, 'node_modules', 'generated', 'index.js'), 'one\n', 'utf8');

    const first = await benchmarkSourceFingerprint(workspace);
    const unchanged = await benchmarkSourceFingerprint(workspace);
    await writeFile(path.join(workspace, 'node_modules', 'generated', 'index.js'), 'two\n', 'utf8');
    const generatedOnly = await benchmarkSourceFingerprint(workspace);
    await writeFile(path.join(workspace, 'src', 'main.ts'), 'export const value = 2;\n', 'utf8');
    const sourceChanged = await benchmarkSourceFingerprint(workspace);

    expect(unchanged).toBe(first);
    expect(generatedOnly).toBe(first);
    expect(sourceChanged).not.toBe(first);
  });

  it('rejects promptly when fingerprinting starts with an aborted signal', async () => {
    const workspace = await makeGitWorkspace();
    const controller = new AbortController();
    controller.abort();

    await expect(benchmarkSourceFingerprint(workspace, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('captureBenchmarkDiff', () => {
  it('includes staged changes and useful text evidence for untracked files', async () => {
    const workspace = await makeGitWorkspace();
    await writeFile(path.join(workspace, 'tracked.txt'), 'staged result\n', 'utf8');
    git(workspace, 'add', 'tracked.txt');
    await writeFile(path.join(workspace, 'evidence.txt'), 'untracked evidence\n', 'utf8');

    const captured = await captureBenchmarkDiff(workspace);

    expect(captured.changedFiles).toEqual(['evidence.txt', 'tracked.txt']);
    expect(captured.diff).toContain('staged result');
    expect(captured.diff).toContain('evidence.txt');
    expect(captured.diff).toContain('untracked evidence');
  });
});

describe('runBenchmarkCommand', () => {
  it('kills the spawned process tree on timeout', async () => {
    const workspace = await makeWorkspace();
    const sentinelPath = path.join(workspace, 'timeout-survivor.txt');
    const scriptPath = path.join(workspace, 'timeout-child.js');
    await writeFile(
      scriptPath,
      `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(sentinelPath)}, 'alive'), 3000);\n`,
      'utf8'
    );

    const result = await runBenchmarkCommand(`"${process.execPath}" "${scriptPath}"`, workspace, 75);
    await new Promise((resolve) => setTimeout(resolve, 3_200));

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    await expect(access(sentinelPath)).rejects.toBeDefined();
  });

  it('kills the spawned process tree when aborted', async () => {
    const workspace = await makeWorkspace();
    const sentinelPath = path.join(workspace, 'abort-survivor.txt');
    const scriptPath = path.join(workspace, 'abort-child.js');
    await writeFile(
      scriptPath,
      `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(sentinelPath)}, 'alive'), 3000);\n`,
      'utf8'
    );
    const controller = new AbortController();
    const pending = runBenchmarkCommand(`"${process.execPath}" "${scriptPath}"`, workspace, 5_000, controller.signal);
    setTimeout(() => controller.abort(), 75);

    const result = await pending;
    await new Promise((resolve) => setTimeout(resolve, 3_200));

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBeNull();
    await expect(access(sentinelPath)).rejects.toBeDefined();
  });
});
