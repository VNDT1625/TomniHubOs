import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HookEventName } from '@/common/integrations/hooks';
import { createDefaultInterpreterResolver } from '@process/integrations/hooks/hookInterpreters';
import {
  createHookLimiter,
  runHook,
  type HookAuditEntry,
  type HookInterpreterName,
  type HookRunnerInput,
  type HookRunnerResult,
} from '@process/integrations/hooks/hookRunner';

/**
 * These tests spawn real child processes. Scripts are plain .js files run through process.execPath
 * (the plain Node of the test runner stands in for Electron-as-Node). Tests that need bash or python
 * skip themselves when the interpreter is not installed.
 */

let realBash: string | undefined;
let realPython: string | undefined;

/** Reads stdin to the end, then calls main(raw). OUT prints a documented hook JSON with context. */
const PRELUDE = `
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => main(Buffer.concat(chunks).toString('utf8')));
function OUT(event, context) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
}
`;

const SLEEP_FOREVER = 'setInterval(() => {}, 1000);';

let base: string;
let pluginRoot: string;
let pluginData: string;
let projectDir: string;
let outsideDir: string;

const write = async (dir: string, name: string, body: string, prelude = true): Promise<string> => {
  const file = path.join(dir, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, prelude ? `${PRELUDE}\n${body}` : body, 'utf8');
  return file;
};

const hookInput = (
  command: string,
  event: HookEventName = 'PostToolUse',
  over: Partial<HookRunnerInput> = {}
): HookRunnerInput => ({
  handler: { form: 'exec', command, args: [], timeoutSec: 20 },
  event,
  payload: { hook_event_name: event, tool_name: 'Write' },
  cwd: projectDir,
  placeholders: { pluginRoot, pluginData, projectDir },
  source: 'package',
  ...over,
});

const run = (
  command: string,
  event: HookEventName = 'PostToolUse',
  over: Partial<HookRunnerInput> = {}
): Promise<HookRunnerResult> => runHook(hookInput(command, event, over));

const slash = (value: string): string => value.replace(/\\/g, '/');

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitUntil = async (condition: () => boolean, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return condition();
};

beforeAll(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'tomny-hookrunner-'));
  pluginRoot = path.join(base, 'plugin');
  pluginData = path.join(base, 'data');
  projectDir = path.join(base, 'project');
  outsideDir = path.join(base, 'outside');
  for (const dir of [pluginRoot, pluginData, projectDir, outsideDir]) await mkdir(dir, { recursive: true });
  const lookup = createDefaultInterpreterResolver(process.env);
  realBash = await lookup('bash');
  realPython = (await lookup('python')) ?? (await lookup('python3'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('HookRunner: exit codes and output', () => {
  it('exit 0 with JSON stdout becomes context; the script path uses a placeholder and sees stdin', async () => {
    await write(
      pluginRoot,
      'ctx.js',
      `function main(raw) { const p = JSON.parse(raw); OUT(p.hook_event_name, 'saw:' + p.tool_name + ':' + p.session_id); }`
    );
    const result = await run('${CLAUDE_PLUGIN_ROOT}/ctx.js', 'PostToolUse', {
      payload: { hook_event_name: 'PostToolUse', tool_name: 'Write', session_id: 's-1' },
    });
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.run.exitCode).toBe(0);
    expect(result.run.timedOut).toBe(false);
    expect(result.run.truncatedInput).toBe(false);
    expect(result.interpreted.blocked).toBe(false);
    expect(result.interpreted.additionalContext).toBe('saw:Write:s-1');
  });

  it('exit 0 with plain text becomes context for SessionStart', async () => {
    await write(pluginRoot, 'plain.js', `console.log('Project uses bun.');`, false);
    const result = await run(path.join(pluginRoot, 'plain.js'), 'SessionStart');
    expect(result.ok).toBe(true);
    expect(result.interpreted.additionalContext).toBe('Project uses bun.');
  });

  it('exit 2 blocks PreToolUse with the stderr reason', async () => {
    await write(pluginRoot, 'deny.js', `process.stderr.write('dangerous command'); process.exit(2);`, false);
    const result = await run(path.join(pluginRoot, 'deny.js'), 'PreToolUse');
    expect(result.run.exitCode).toBe(2);
    expect(result.ok).toBe(true);
    expect(result.interpreted).toMatchObject({
      blocked: true,
      permissionDecision: 'deny',
      reason: 'dangerous command',
    });
  });

  it('any other exit code is a non-blocking warning', async () => {
    await write(pluginRoot, 'three.js', `process.stderr.write('oops'); process.exit(3);`, false);
    const result = await run(path.join(pluginRoot, 'three.js'), 'PreToolUse');
    expect(result.run.exitCode).toBe(3);
    expect(result.interpreted.blocked).toBe(false);
    expect(result.interpreted.warnings.join(' ')).toContain('code 3');
  });

  it('a hook that never reads stdin does not throw even with a large payload (EPIPE is ignored)', async () => {
    await write(pluginRoot, 'noread.js', `process.exit(0);`, false);
    const result = await run(path.join(pluginRoot, 'noread.js'), 'PostToolUse', {
      payload: { hook_event_name: 'PostToolUse', filler: 'x'.repeat(200_000) },
    });
    expect(result.run.exitCode).toBe(0);
    expect(result.run.truncatedInput).toBe(false);
  });
});

describe('HookRunner: stdin size cap', () => {
  it('shortens tool_response first, keeps stdin <= 256 KB and flags truncation', async () => {
    await write(
      pluginRoot,
      'stdin.js',
      `function main(raw) {
        const p = JSON.parse(raw);
        OUT(p.hook_event_name, [Buffer.byteLength(raw), p.tomny_input_truncated, p.tool_input.a, p.tool_response.length < 5000].join('|'));
      }`
    );
    const result = await run(path.join(pluginRoot, 'stdin.js'), 'PostToolUse', {
      payload: {
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: { a: 'kept' },
        tool_response: 'r'.repeat(400_000),
      },
    });
    expect(result.run.truncatedInput).toBe(true);
    const [bytes, flag, kept, shortResponse] = (result.interpreted.additionalContext ?? '').split('|');
    expect(Number(bytes)).toBeLessThanOrEqual(256 * 1024);
    expect(flag).toBe('true');
    expect(kept).toBe('kept');
    expect(shortResponse).toBe('true');
  });

  it('shortens another long field when tool_response is not the cause', async () => {
    const result = await run(path.join(pluginRoot, 'stdin.js'), 'PostToolUse', {
      payload: {
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: { a: 'x'.repeat(400_000) },
        tool_response: 'ok',
      },
    });
    expect(result.run.truncatedInput).toBe(true);
    expect(result.run.exitCode).toBe(0);
  });
});

describe('HookRunner: environment', () => {
  it('passes a minimal environment: no inherited secrets, plugin variables present', async () => {
    await write(
      pluginRoot,
      'env.js',
      `function main(raw) {
        const p = JSON.parse(raw);
        OUT(p.hook_event_name, JSON.stringify({
          keys: Object.keys(process.env),
          token: process.env.SECRET_TEST_TOKEN === undefined ? null : process.env.SECRET_TEST_TOKEN,
          claudeRoot: process.env.CLAUDE_PLUGIN_ROOT,
          tomnyRoot: process.env.TOMNY_PLUGIN_ROOT,
          claudeData: process.env.CLAUDE_PLUGIN_DATA,
          claudeProject: process.env.CLAUDE_PROJECT_DIR,
          tomnyProject: process.env.TOMNY_PROJECT_DIR,
        }));
      }`
    );
    process.env.SECRET_TEST_TOKEN = 'must-not-leak';
    process.env.OTHER_API_KEY = 'must-not-leak-either';
    let result: HookRunnerResult;
    try {
      result = await run(path.join(pluginRoot, 'env.js'));
    } finally {
      delete process.env.SECRET_TEST_TOKEN;
      delete process.env.OTHER_API_KEY;
    }
    const seen = JSON.parse(result.interpreted.additionalContext ?? '{}') as {
      keys: string[];
      token: string | null;
      claudeRoot: string;
      tomnyRoot: string;
      claudeData: string;
      claudeProject: string;
      tomnyProject: string;
    };
    expect(seen.token).toBeNull();
    const lowered = seen.keys.map((key) => key.toLowerCase());
    expect(lowered).not.toContain('secret_test_token');
    expect(lowered).not.toContain('other_api_key');
    expect(seen.claudeRoot).toBe(slash(pluginRoot));
    expect(seen.tomnyRoot).toBe(slash(pluginRoot));
    expect(seen.claudeData).toBe(slash(pluginData));
    expect(seen.claudeProject).toBe(slash(projectDir));
    expect(seen.tomnyProject).toBe(slash(projectDir));
    const allowed = new Set([
      'path',
      'systemroot',
      'comspec',
      'home',
      'userprofile',
      'temp',
      'tmp',
      'lang',
      'claude_plugin_root',
      'claude_plugin_data',
      'claude_project_dir',
      'tomny_plugin_root',
      'tomny_plugin_data',
      'tomny_project_dir',
      'electron_run_as_node',
    ]);
    // Windows itself adds these derived variables to every new process, whatever the parent passed.
    const addedByWindows =
      process.platform === 'win32'
        ? ['homedrive', 'homepath', 'logonserver', 'systemdrive', 'userdomain', 'username', 'windir']
        : [];
    for (const name of addedByWindows) allowed.add(name);
    expect(lowered.filter((key) => !allowed.has(key))).toEqual([]);
  });

  it('the injected env option replaces the parent environment used for the allow-list', async () => {
    const result = await run(path.join(pluginRoot, 'env.js'), 'PostToolUse', {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LANG: 'xx_TEST', SECRET_TEST_TOKEN: 'nope' },
    });
    const seen = JSON.parse(result.interpreted.additionalContext ?? '{}') as { keys: string[]; token: string | null };
    expect(seen.token).toBeNull();
    expect(seen.keys.map((key) => key.toLowerCase())).toContain('lang');
  });
});

describe('HookRunner: interpreter mapping', () => {
  it('maps .js to the Electron binary run as Node (ELECTRON_RUN_AS_NODE=1)', async () => {
    await write(
      pluginRoot,
      'node-info.js',
      `function main(raw) {
        const p = JSON.parse(raw);
        OUT(p.hook_event_name, process.env.ELECTRON_RUN_AS_NODE + '|' + process.execPath);
      }`
    );
    for (const result of [
      await run(path.join(pluginRoot, 'node-info.js')),
      await runHook(
        hookInput('node', 'PostToolUse', {
          handler: { form: 'exec', command: 'node', args: [path.join(pluginRoot, 'node-info.js')], timeoutSec: 20 },
        })
      ),
    ]) {
      const [flag, exe] = (result.interpreted.additionalContext ?? '').split('|');
      expect(flag).toBe('1');
      expect(exe?.toLowerCase()).toBe(process.execPath.toLowerCase());
    }
  });

  it('asks the resolver for python, python3, then uv for .py and reports RUNTIME_MISSING', async () => {
    await write(pluginRoot, 'tool.py', `print('x')`, false);
    const asked: HookInterpreterName[] = [];
    const result = await run(path.join(pluginRoot, 'tool.py'), 'PostToolUse', {
      resolveInterpreter: (name) => {
        asked.push(name);
        return undefined;
      },
    });
    expect(asked).toEqual(['python', 'python3', 'uv']);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('HOOK_RUNTIME_MISSING');
    expect(result.interpreted.blocked).toBe(false);
  });

  it('dispatches .py to the python resolved by the injected resolver', async () => {
    await write(
      pluginRoot,
      'viaresolver.py',
      `// Node loads unknown extensions as CommonJS, so this stands in for a python script.\n${PRELUDE}\nfunction main(raw) { OUT(JSON.parse(raw).hook_event_name, 'from-py-slot'); }`,
      false
    );
    const result = await run(path.join(pluginRoot, 'viaresolver.py'), 'PostToolUse', {
      resolveInterpreter: (name) => (name === 'python' ? process.execPath : undefined),
    });
    expect(result.error).toBeUndefined();
    expect(result.interpreted.additionalContext).toBe('from-py-slot');
  });

  it('asks for bash for .sh and says Git Bash is needed when it is missing', async () => {
    await write(pluginRoot, 'tool.sh', `echo hi\n`, false);
    const asked: HookInterpreterName[] = [];
    const result = await run(path.join(pluginRoot, 'tool.sh'), 'PostToolUse', {
      resolveInterpreter: (name) => {
        asked.push(name);
        return undefined;
      },
    });
    expect(asked[0]).toBe('bash');
    expect(result.error?.code).toBe('HOOK_RUNTIME_MISSING');
    if (process.platform === 'win32') expect(result.error?.message).toContain('Git Bash');
  });

  it('asks for pwsh then powershell for .ps1', async () => {
    await write(pluginRoot, 'tool.ps1', `Write-Output hi\n`, false);
    const asked: HookInterpreterName[] = [];
    const result = await run(path.join(pluginRoot, 'tool.ps1'), 'PostToolUse', {
      resolveInterpreter: (name) => {
        asked.push(name);
        return undefined;
      },
    });
    expect(asked).toEqual(['pwsh', 'powershell']);
    expect(result.error?.code).toBe('HOOK_RUNTIME_MISSING');
  });

  it('refuses a file with no extension and no shebang as RUNTIME_MISSING', async () => {
    await write(pluginRoot, 'noext', `echo hi\n`, false);
    const result = await run(path.join(pluginRoot, 'noext'));
    expect(result.error?.code).toBe('HOOK_RUNTIME_MISSING');
    expect(result.interpreted.blocked).toBe(false);
  });

  it('runs a real .sh script through bash (Git Bash on Windows); skipped when bash is missing', async (context) => {
    if (realBash === undefined) {
      console.warn('[hookRunner.test] SKIPPED real bash test: bash (Git Bash) not found');
      context.skip();
      return;
    }
    await write(pluginRoot, 'real.sh', `#!/bin/bash\ncat > /dev/null\necho "from-bash"\n`, false);
    const result = await run(path.join(pluginRoot, 'real.sh'), 'SessionStart');
    expect(result.error).toBeUndefined();
    expect(result.interpreted.additionalContext).toBe('from-bash');
  });

  it('runs a real .py script through python; skipped when python is missing', async (context) => {
    if (realPython === undefined) {
      console.warn('[hookRunner.test] SKIPPED real python test: python not found');
      context.skip();
      return;
    }
    await write(pluginRoot, 'real.py', `import sys\nsys.stdin.read()\nprint("from-python")\n`, false);
    const result = await run(path.join(pluginRoot, 'real.py'), 'SessionStart');
    expect(result.error).toBeUndefined();
    expect(result.interpreted.additionalContext).toBe('from-python');
  });
});

describe('HookRunner: command restrictions', () => {
  it('rejects a package command outside the plugin root and does not run it', async () => {
    const marker = path.join(base, 'outside-ran.txt');
    const outside = await write(
      outsideDir,
      'evil.js',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`,
      false
    );
    const result = await run(outside);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('HOOK_PATH_FORBIDDEN');
    expect(result.interpreted.blocked).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it('rejects ../ traversal out of the plugin root', async () => {
    await write(base, 'traversal.js', `process.exit(0);`, false);
    const result = await run(`${pluginRoot}${path.sep}..${path.sep}traversal.js`);
    expect(result.error?.code).toBe('HOOK_PATH_FORBIDDEN');
  });

  it('rejects an interpreter whose script is outside the root or is not a file argument', async () => {
    const outside = path.join(outsideDir, 'evil.js');
    const outsideRun = await runHook(
      hookInput('node', 'PostToolUse', {
        handler: { form: 'exec', command: 'node', args: [outside], timeoutSec: 20 },
      })
    );
    expect(outsideRun.error?.code).toBe('HOOK_PATH_FORBIDDEN');
    const inline = await runHook(
      hookInput('node', 'PostToolUse', {
        handler: { form: 'exec', command: 'node', args: ['-e', 'process.exit(0)'], timeoutSec: 20 },
      })
    );
    expect(inline.error?.code).toBe('HOOK_PATH_FORBIDDEN');
    const bare = await runHook(
      hookInput('node', 'PostToolUse', {
        handler: { form: 'exec', command: 'node', args: [], timeoutSec: 20 },
      })
    );
    expect(bare.error?.code).toBe('HOOK_PATH_FORBIDDEN');
  });

  it('rejects a package without a plugin root', async () => {
    const result = await run(path.join(pluginRoot, 'plain.js'), 'PostToolUse', { placeholders: { projectDir } });
    expect(result.error?.code).toBe('HOOK_PATH_FORBIDDEN');
  });

  it('rejects a directory (junction/symlink) inside the root that points outside', async (context) => {
    const marker = path.join(base, 'junction-ran.txt');
    await write(
      outsideDir,
      'viajunction.js',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`,
      false
    );
    try {
      // 'junction' needs no privilege on Windows and is ignored on POSIX (plain directory symlink).
      await symlink(outsideDir, path.join(pluginRoot, 'linkdir'), 'junction');
    } catch (error) {
      console.warn(`[hookRunner.test] SKIPPED junction/symlink escape test: cannot create link (${String(error)})`);
      context.skip();
      return;
    }
    const result = await run(path.join(pluginRoot, 'linkdir', 'viajunction.js'));
    expect(result.error?.code).toBe('HOOK_PATH_FORBIDDEN');
    expect(existsSync(marker)).toBe(false);
  });

  it('rejects a file symlink inside the root that points outside', async (context) => {
    const marker = path.join(base, 'filelink-ran.txt');
    const target = await write(
      outsideDir,
      'viafile.js',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`,
      false
    );
    try {
      await symlink(target, path.join(pluginRoot, 'filelink.js'), 'file');
    } catch (error) {
      console.warn(`[hookRunner.test] SKIPPED file symlink escape test: cannot create file symlink (${String(error)})`);
      context.skip();
      return;
    }
    const result = await run(path.join(pluginRoot, 'filelink.js'));
    expect(result.error?.code).toBe('HOOK_PATH_FORBIDDEN');
    expect(existsSync(marker)).toBe(false);
  });

  it('rejects shell form from a package', async () => {
    const result = await runHook(
      hookInput('echo hi', 'SessionStart', { handler: { form: 'shell', command: 'echo hi' } })
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('HOOK_SHELL_FORBIDDEN');
    expect(result.interpreted.blocked).toBe(false);
  });

  it.each(['user', 'workspace'] as const)('%s hooks may use shell form', async (source) => {
    const result = await runHook(
      hookInput('echo hello', 'SessionStart', {
        source,
        handler: { form: 'shell', command: 'echo hello', timeoutSec: 20 },
      })
    );
    expect(result.error).toBeUndefined();
    expect(result.run.exitCode).toBe(0);
    expect(result.interpreted.additionalContext).toBe('hello');
  });
});

describe('HookRunner: limits', () => {
  it('kills the whole process tree on timeout, including a grandchild', async () => {
    const grandchildPid = path.join(base, 'grandchild.pid');
    const parentPid = path.join(base, 'parent.pid');
    const grandchild = await write(
      pluginRoot,
      'grandchild.js',
      `require('node:fs').writeFileSync(process.argv[2], String(process.pid)); ${SLEEP_FOREVER}`,
      false
    );
    await write(
      pluginRoot,
      'parent.js',
      `const { spawn } = require('node:child_process');
       require('node:fs').writeFileSync(${JSON.stringify(parentPid)}, String(process.pid));
       spawn(process.execPath, [${JSON.stringify(grandchild)}, ${JSON.stringify(grandchildPid)}], { stdio: 'ignore' });
       ${SLEEP_FOREVER}`,
      false
    );
    const started = Date.now();
    const result = await run(path.join(pluginRoot, 'parent.js'), 'PostToolUse', {
      handler: { form: 'exec', command: path.join(pluginRoot, 'parent.js'), args: [], timeoutSec: 3 },
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('HOOK_TIMEOUT');
    expect(result.run.timedOut).toBe(true);
    expect(result.run.exitCode).toBeNull();
    expect(result.interpreted.blocked).toBe(false);
    expect(Date.now() - started).toBeLessThan(9000);

    expect(existsSync(grandchildPid)).toBe(true);
    const grandchildId = Number((await readFile(grandchildPid, 'utf8')).trim());
    const parentId = Number((await readFile(parentPid, 'utf8')).trim());
    expect(await waitUntil(() => !isAlive(grandchildId), 5000)).toBe(true);
    expect(await waitUntil(() => !isAlive(parentId), 5000)).toBe(true);
  }, 20000);

  it('caps SessionEnd hooks at the shared 1.5 second budget even when asked for more', async () => {
    await write(pluginRoot, 'sleeper.js', SLEEP_FOREVER, false);
    const started = Date.now();
    const result = await run(path.join(pluginRoot, 'sleeper.js'), 'SessionEnd', {
      handler: { form: 'exec', command: path.join(pluginRoot, 'sleeper.js'), args: [], timeoutSec: 600 },
    });
    expect(result.run.timedOut).toBe(true);
    expect(result.error?.code).toBe('HOOK_TIMEOUT');
    expect(Date.now() - started).toBeLessThan(8000);
  }, 20000);

  it('drains output beyond 64 KB without hanging and reports truncation', async () => {
    await write(
      pluginRoot,
      'flood.js',
      `process.stdout.write('a'.repeat(400000)); process.stderr.write('b'.repeat(300000));`,
      false
    );
    const started = Date.now();
    const result = await run(path.join(pluginRoot, 'flood.js'));
    expect(result.run.exitCode).toBe(0);
    expect(result.run.timedOut).toBe(false);
    expect(result.run.stdout.length).toBeLessThanOrEqual(64 * 1024);
    expect(result.run.stderr.length).toBeLessThanOrEqual(64 * 1024);
    expect(result.run.stdout.length).toBeGreaterThan(60_000);
    expect(result.run.stdoutTruncated).toBe(true);
    expect(result.run.stderrTruncated).toBe(true);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('does not wait for an orphan that keeps the output pipe open after the hook exited', async () => {
    await write(
      pluginRoot,
      'orphan.js',
      `const { spawn } = require('node:child_process');
       const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
       child.unref();
       process.stdout.write('done');`,
      false
    );
    const started = Date.now();
    const result = await run(path.join(pluginRoot, 'orphan.js'), 'PostToolUse', {
      handler: { form: 'exec', command: path.join(pluginRoot, 'orphan.js'), args: [], timeoutSec: 20 },
    });
    expect(result.run.exitCode).toBe(0);
    expect(result.run.stdout).toBe('done');
    expect(Date.now() - started).toBeLessThan(2900);
  });

  it('cancels with an AbortSignal and kills the tree', async () => {
    const controller = new AbortController();
    const pending = run(path.join(pluginRoot, 'sleeper.js'), 'PostToolUse', {
      signal: controller.signal,
      handler: { form: 'exec', command: path.join(pluginRoot, 'sleeper.js'), args: [], timeoutSec: 60 },
    });
    setTimeout(() => controller.abort(), 700);
    const result = await pending;
    expect(result.error?.code).toBe('HOOK_ABORTED');
    expect(result.run.timedOut).toBe(false);
    expect(result.interpreted.blocked).toBe(false);
  }, 20000);

  it('an already aborted signal never starts the process', async () => {
    const marker = path.join(base, 'aborted-ran.txt');
    await write(pluginRoot, 'marker.js', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`, false);
    const controller = new AbortController();
    controller.abort();
    const result = await run(path.join(pluginRoot, 'marker.js'), 'PostToolUse', { signal: controller.signal });
    expect(result.error?.code).toBe('HOOK_ABORTED');
    expect(existsSync(marker)).toBe(false);
  });

  it('never runs more hooks at once than the limiter allows (limit 2, five real processes)', async () => {
    const log = path.join(base, 'concurrency.log');
    await write(
      pluginRoot,
      'slow.js',
      `const fs = require('node:fs');
       fs.appendFileSync(${JSON.stringify(log)}, Date.now() + ' start\\n');
       setTimeout(() => { fs.appendFileSync(${JSON.stringify(log)}, Date.now() + ' end\\n'); }, 600);`,
      false
    );
    const limiter = createHookLimiter({ maxConcurrent: 2 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        run(path.join(pluginRoot, 'slow.js'), 'PostToolUse', {
          limiter,
          handler: { form: 'exec', command: path.join(pluginRoot, 'slow.js'), args: [], timeoutSec: 30 },
        })
      )
    );
    expect(results.every((result) => result.run.exitCode === 0)).toBe(true);
    const events = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => {
        const [time, kind] = line.split(' ');
        return { time: Number(time), delta: kind === 'start' ? 1 : -1 };
      })
      // At equal timestamps an end counts before a start.
      .toSorted((a, b) => a.time - b.time || a.delta - b.delta);
    expect(events).toHaveLength(10);
    let current = 0;
    let peak = 0;
    for (const event of events) {
      current += event.delta;
      peak = Math.max(peak, current);
    }
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
    expect(limiter.stats().peakRunning).toBe(2);
    expect(limiter.stats().running).toBe(0);
  }, 30000);

  it('drops observe-only hooks when the queue is over the cap and keeps others waiting', async () => {
    const limiter = createHookLimiter({ maxConcurrent: 1, maxQueuedDroppable: 0 });
    const holder = await limiter.acquire({ droppable: false });
    expect(holder.kind).toBe('acquired');
    const waiting = limiter.acquire({ droppable: false });
    const entries: HookAuditEntry[] = [];

    const dropped = await run(path.join(pluginRoot, 'plain.js'), 'Notification', {
      limiter,
      onAudit: (entry) => entries.push(entry),
    });
    expect(dropped.error?.code).toBe('HOOK_QUEUE_DROPPED');
    expect(dropped.interpreted.blocked).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.errorCode).toBe('HOOK_QUEUE_DROPPED');
    expect(limiter.stats().dropped).toBe(1);

    if (holder.kind === 'acquired') holder.release();
    const next = await waiting;
    expect(next.kind).toBe('acquired');
    if (next.kind === 'acquired') next.release();
    expect(limiter.stats().running).toBe(0);
  });

  it('removes an aborted waiter from the queue', async () => {
    const limiter = createHookLimiter({ maxConcurrent: 1 });
    const holder = await limiter.acquire({ droppable: false });
    const controller = new AbortController();
    const waiting = limiter.acquire({ droppable: false, signal: controller.signal });
    expect(limiter.stats().queued).toBe(1);
    controller.abort();
    expect((await waiting).kind).toBe('aborted');
    expect(limiter.stats().queued).toBe(0);
    if (holder.kind === 'acquired') holder.release();
  });
});

describe('HookRunner: failures never throw', () => {
  it('reports a command that cannot start as HOOK_START_FAILED (user exec)', async () => {
    const result = await runHook(
      hookInput('definitely-not-a-real-command-xyz', 'PostToolUse', {
        source: 'user',
        handler: { form: 'exec', command: 'definitely-not-a-real-command-xyz', args: [], timeoutSec: 10 },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('HOOK_START_FAILED');
    expect(result.run.exitCode).toBeNull();
    expect(result.interpreted.blocked).toBe(false);
  });

  it('reports a missing package script as HOOK_START_FAILED', async () => {
    const result = await run(path.join(pluginRoot, 'does-not-exist.js'));
    expect(result.error?.code).toBe('HOOK_START_FAILED');
  });

  it('reports a missing working directory as HOOK_START_FAILED', async () => {
    const result = await run(path.join(pluginRoot, 'plain.js'), 'PostToolUse', { cwd: path.join(base, 'no-such-dir') });
    expect(result.error?.code).toBe('HOOK_START_FAILED');
  });

  it('keeps the specific reason next to the generic warning', async () => {
    const result = await run(path.join(pluginRoot, 'does-not-exist.js'));
    expect(result.interpreted.warnings.some((warning) => warning.startsWith('HOOK_START_FAILED'))).toBe(true);
  });
});

describe('HookRunner: audit', () => {
  it('records event, source, id, exit code and lengths but never stdin or raw output', async () => {
    await write(
      pluginRoot,
      'audited.js',
      `process.stdin.resume(); process.stdout.write('STDOUT-SECRET-XYZ'); process.stderr.write('ERR-SECRET-QRS'); process.stdin.on('end', () => process.exit(0));`,
      false
    );
    const entries: HookAuditEntry[] = [];
    const result = await run(path.join(pluginRoot, 'audited.js'), 'PostToolUse', {
      hookId: 'format-on-edit',
      source: 'package',
      payload: { hook_event_name: 'PostToolUse', prompt: 'STDIN-SECRET-ABC' },
      onAudit: (entry) => entries.push(entry),
    });
    expect(result.run.exitCode).toBe(0);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry).toMatchObject({
      event: 'PostToolUse',
      hookId: 'format-on-edit',
      source: 'package',
      exitCode: 0,
      timedOut: false,
      decision: 'none',
      stdoutLength: 'STDOUT-SECRET-XYZ'.length,
      stderrLength: 'ERR-SECRET-QRS'.length,
    });
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('STDIN-SECRET-ABC');
    expect(serialized).not.toContain('STDOUT-SECRET-XYZ');
    expect(serialized).not.toContain('ERR-SECRET-QRS');
  });

  it('logs a deny decision and survives a throwing audit sink', async () => {
    const entries: HookAuditEntry[] = [];
    let first = true;
    const onAudit = (entry: HookAuditEntry): void => {
      if (first) {
        first = false;
        throw new Error('sink failed');
      }
      entries.push(entry);
    };
    const throwing = await run(path.join(pluginRoot, 'deny.js'), 'PreToolUse', { onAudit });
    expect(throwing.interpreted.blocked).toBe(true);
    const logged = await run(path.join(pluginRoot, 'deny.js'), 'PreToolUse', { onAudit });
    expect(logged.interpreted.blocked).toBe(true);
    expect(entries[0]).toMatchObject({ decision: 'deny', exitCode: 2 });
  });

  it('logs timeouts and forbidden commands with their error code', async () => {
    const entries: HookAuditEntry[] = [];
    await run(path.join(outsideDir, 'evil.js'), 'PostToolUse', { onAudit: (entry) => entries.push(entry) });
    await runHook(
      hookInput('echo hi', 'SessionStart', {
        handler: { form: 'shell', command: 'echo hi' },
        onAudit: (entry) => entries.push(entry),
      })
    );
    expect(entries.map((entry) => entry.errorCode)).toEqual(['HOOK_PATH_FORBIDDEN', 'HOOK_SHELL_FORBIDDEN']);
  });
});
