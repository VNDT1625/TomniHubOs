import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { nodeCliExec, type CliExecRequest } from '@process/integrations/connections/cli/cliExec';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const workspace = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-cliexec-'));
  roots.push(root);
  return root;
};

/** Runs a script with the Node.js that runs the tests: a real child process, no shell. */
const runScript = async (script: string, extra: Partial<CliExecRequest> = {}, args: string[] = []) =>
  nodeCliExec({
    file: process.execPath,
    args: ['-e', script, ...args],
    cwd: await workspace(),
    env: { PATH: process.env['PATH'] ?? '', SystemRoot: process.env['SystemRoot'] ?? '' },
    timeoutMs: 20_000,
    maxOutputBytes: 64 * 1024,
    ...extra,
  });

describe('nodeCliExec', () => {
  it('runs in the given folder and merges stdout and stderr', async () => {
    const cwd = await workspace();
    const result = await runScript('console.log(process.cwd()); console.error("to-stderr")', { cwd });
    expect(result).toMatchObject({ exitCode: 0, truncated: false, timedOut: false, cancelled: false });
    expect(result.output).toContain(path.basename(cwd));
    expect(result.output).toContain('to-stderr');
  });

  it('returns the exit code of the program', async () => {
    expect(await runScript('process.exit(7)')).toMatchObject({ exitCode: 7, timedOut: false });
  });

  it('passes arguments as an array: nothing is read as shell syntax', async () => {
    const result = await runScript('console.log(JSON.stringify(process.argv.slice(1)))', {}, [
      'a;echo pwned',
      '$(calc)',
      '`id`',
      '>out',
      '%PATH%',
    ]);
    expect(JSON.parse(result.output.trim())).toEqual(['a;echo pwned', '$(calc)', '`id`', '>out', '%PATH%']);
  });

  it('gives the program only the environment it was handed', async () => {
    process.env['TOMNY_CLIEXEC_LEAK'] = 'leaked-value';
    try {
      const result = await runScript('console.log("[" + (process.env.TOMNY_CLIEXEC_LEAK ?? "") + "]")');
      expect(result.output.trim()).toBe('[]');
    } finally {
      delete process.env['TOMNY_CLIEXEC_LEAK'];
    }
  });

  it('keeps at most the byte cap and says so, while the program is let to finish', async () => {
    const result = await runScript('process.stdout.write("x".repeat(100000)); console.log("end")', {
      maxOutputBytes: 1000,
    });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.output)).toBe(1000);
    expect(result.exitCode).toBe(0);
  });

  it('stops a program that runs too long, including what it started', async () => {
    const started = Date.now();
    const result = await runScript('setInterval(() => {}, 1000); console.log("started")', { timeoutMs: 400 });
    expect(result.timedOut).toBe(true);
    expect(result.output).toContain('started');
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const pending = runScript('setInterval(() => {}, 1000)', { signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    expect(await pending).toMatchObject({ cancelled: true, timedOut: false });
  });

  it('does not start at all when it is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await runScript('console.log("never")', { signal: controller.signal })).toMatchObject({ cancelled: true });
  });

  it('reports a program that cannot be started as a start error', async () => {
    const result = await nodeCliExec({
      file: path.join(os.tmpdir(), 'tomny-no-such-program-xyz'),
      args: [],
      cwd: await workspace(),
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 1000,
    });
    expect(result.exitCode).toBeNull();
    expect(result.startError).toBeDefined();
  });
});

describe.skipIf(process.platform !== 'win32')('nodeCliExec with a Windows batch shim', () => {
  const makeShim = async (folderName: string): Promise<{ shim: string; cwd: string }> => {
    const cwd = await workspace();
    const folder = path.join(cwd, folderName);
    await mkdir(folder, { recursive: true });
    const shim = path.join(folder, 'echoargs.cmd');
    await writeFile(shim, '@echo off\r\necho ARGS:%*\r\n', 'utf8');
    return { shim, cwd };
  };

  it('runs it through cmd.exe, also from a folder whose name has a space', async () => {
    const { shim, cwd } = await makeShim('with space');
    const result = await nodeCliExec({
      file: shim,
      args: ['docs', '--lang=en', 'a@1.2.3'],
      cwd,
      env: { SystemRoot: process.env['SystemRoot'] ?? 'C:\\Windows', PATH: process.env['PATH'] ?? '' },
      timeoutMs: 20_000,
      maxOutputBytes: 4096,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('ARGS:docs --lang=en a@1.2.3');
  });

  it('refuses a shim whose own path holds a character cmd.exe reads as syntax', async () => {
    const { shim, cwd } = await makeShim('a&b');
    const result = await nodeCliExec({
      file: shim,
      args: [],
      cwd,
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 1000,
    });
    expect(result.startError).toContain('batch file');
    expect(result.output).toBe('');
  });
});
