import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHookRegistry } from '@process/integrations/hooks/hookRegistry';
import {
  createHookLimiter,
  runHook,
  type HookLimiter,
  type HookRunnerInput,
} from '@process/integrations/hooks/hookRunner';

/**
 * TOCTOU guard (task T3.3): the runner re-hashes the real path of the script right before the spawn, after the
 * concurrency slot was granted (where a hook can wait longest), and gives the caller a last `beforeSpawn` veto.
 */

let base: string;
let seq = 0;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(os.tmpdir(), 'tomny-toctou-')));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

const scriptBody = (marker: string, tag: string): string =>
  `require('fs').appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(tag)}); process.stdin.resume(); process.stdin.on('end', () => {});`;

const setup = async (): Promise<{ root: string; script: string; marker: string; original: string }> => {
  seq += 1;
  const root = path.join(base, `case${seq}`);
  await mkdir(root, { recursive: true });
  const marker = path.join(root, 'marker');
  const script = path.join(root, 'hook.js');
  const original = scriptBody(marker, 'ORIGINAL');
  await writeFile(script, original, 'utf8');
  return { root, script, marker, original };
};

const inputFor = (root: string, over: Partial<HookRunnerInput> = {}): HookRunnerInput => ({
  handler: { form: 'exec', command: '${CLAUDE_PLUGIN_ROOT}/hook.js', args: [], timeoutSec: 20 },
  event: 'PreToolUse',
  payload: { tool_name: 'Bash' },
  cwd: root,
  placeholders: { pluginRoot: root },
  source: 'package',
  ...over,
});

describe('HookRunner: content check right before the spawn', { timeout: 60_000 }, () => {
  it('runs when the script still has the approved content', async () => {
    const { root, script, marker, original } = await setup();
    const result = await runHook(inputFor(root, { expectedFileSha256: sha(original) }));
    expect(result.ok).toBe(true);
    expect(await readFile(marker, 'utf8')).toBe('ORIGINAL');
    expect(existsSync(script)).toBe(true);
  });

  it('accepts a "sha256:" prefix and upper case in the expected digest', async () => {
    const { root, marker, original } = await setup();
    const result = await runHook(inputFor(root, { expectedFileSha256: `sha256:${sha(original).toUpperCase()}` }));
    expect(result.ok).toBe(true);
    expect(existsSync(marker)).toBe(true);
  });

  it('refuses a script that no longer matches and never starts it; the refusal does not block the turn', async () => {
    const { root, marker, original } = await setup();
    const audit: unknown[] = [];
    const result = await runHook(
      inputFor(root, { expectedFileSha256: sha(`${original} // tampered`), onAudit: (entry) => audit.push(entry) })
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('HOOK_CONTENT_CHANGED');
    expect(result.interpreted.blocked).toBe(false);
    expect(existsSync(marker)).toBe(false);
    expect(audit).toEqual([expect.objectContaining({ errorCode: 'HOOK_CONTENT_CHANGED', decision: 'none' })]);
  });

  it('catches a swap that happens while the hook waits for a concurrency slot', async () => {
    const { root, script, marker, original } = await setup();
    const limiter: HookLimiter = {
      acquire: async () => {
        await writeFile(script, scriptBody(marker, 'EVIL'), 'utf8');
        return { kind: 'acquired', release: () => undefined };
      },
      stats: () => ({ running: 0, queued: 0, peakRunning: 0, dropped: 0 }),
    };
    const result = await runHook(inputFor(root, { expectedFileSha256: sha(original), limiter }));
    expect(result.error?.code).toBe('HOOK_CONTENT_CHANGED');
    expect(existsSync(marker)).toBe(false);
  });

  it('beforeSpawn gets the real path of the script and can veto; a throw also vetoes; the slot is released', async () => {
    const { root, script, marker } = await setup();
    const limiter = createHookLimiter();
    let seen: string | undefined;
    const vetoed = await runHook(
      inputFor(root, {
        limiter,
        beforeSpawn: async (info) => {
          seen = info.scriptFile;
          return false;
        },
      })
    );
    expect(vetoed.error?.code).toBe('HOOK_CONTENT_CHANGED');
    expect(seen).toBe(await realpath(script));
    expect(existsSync(marker)).toBe(false);

    const thrown = await runHook(
      inputFor(root, {
        limiter,
        beforeSpawn: () => {
          throw new Error('nope');
        },
      })
    );
    expect(thrown.error?.code).toBe('HOOK_CONTENT_CHANGED');
    expect(existsSync(marker)).toBe(false);
    expect(limiter.stats().running).toBe(0);

    const allowed = await runHook(inputFor(root, { limiter, beforeSpawn: () => true }));
    expect(allowed.ok).toBe(true);
    expect(existsSync(marker)).toBe(true);
  });

  it('does nothing for shell-form user hooks (no script file is planned)', async () => {
    const { root, marker } = await setup();
    const result = await runHook({
      handler: {
        form: 'shell',
        command: `node -e "require('fs').appendFileSync(${JSON.stringify(marker).replace(/"/g, "'")}, 'SHELL')"`,
        timeoutSec: 20,
      },
      event: 'PreToolUse',
      payload: {},
      cwd: root,
      placeholders: {},
      source: 'user',
      expectedFileSha256: sha('unrelated'),
    });
    expect(result.error?.code).not.toBe('HOOK_CONTENT_CHANGED');
  });
});

describe('HookRegistry: a swap while queued switches the hook off', { timeout: 60_000 }, () => {
  it('re-verifies after the slot is granted: no run, status stale, audit line', async () => {
    const { root, script, marker } = await setup();
    const original = await readFile(script, 'utf8');
    expect(original).toContain('ORIGINAL');
    const limiter: HookLimiter = {
      acquire: async () => {
        await writeFile(script, scriptBody(marker, 'EVIL'), 'utf8');
        return { kind: 'acquired', release: () => undefined };
      },
      stats: () => ({ running: 0, queued: 0, peakRunning: 0, dropped: 0 }),
    };
    const registry = createHookRegistry({
      storeFilePath: path.join(root, 'state', 'hooks.json'),
      auditFilePath: path.join(root, 'state', 'audit.jsonl'),
      limiter,
    });
    await registry.initialize();
    const [view] = await registry.registerPackageHooks('pkg.toctou', [
      {
        handler: {
          event: 'PreToolUse',
          command: '${CLAUDE_PLUGIN_ROOT}/hook.js',
          args: [],
          timeoutSec: 20,
          form: 'exec',
          unsupported: false,
        },
        pluginRoot: root,
      },
    ]);
    const description = await registry.describeHook(view?.id ?? '');
    expect((await registry.approveHook(view?.id ?? '', description?.hash ?? '')).ok).toBe(true);

    const summary = await registry.run('PreToolUse', { tool_name: 'Bash' }, { workspaceDir: root });
    expect(existsSync(marker)).toBe(false);
    expect(summary.merged.blocked).toBe(false);
    expect((await registry.listHooks())[0]?.status).toBe('stale');
    await registry.flush();
    const audit = await registry.readAudit();
    expect(audit.some((entry) => entry.errorCode === 'HOOK_CONTENT_CHANGED')).toBe(true);
    expect(audit.some((entry) => entry.errorCode === 'approval-stale')).toBe(true);
  });
});
