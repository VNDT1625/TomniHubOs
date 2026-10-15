/* oxlint-disable no-await-in-loop -- records are written in order on purpose */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HOOK_AUDIT_MAX_READ,
  createHookAuditLog,
  toAuditRecord,
  type HookAuditInput,
} from '@process/integrations/hooks/hookAudit';
import { runHook } from '@process/integrations/hooks/hookRunner';

let base: string;
let seq = 0;

beforeAll(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), 'tomny-hookaudit-'));
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const entry = (over: Partial<HookAuditInput> = {}): HookAuditInput => ({
  event: 'PostToolUse',
  hookId: 'a'.repeat(64),
  source: 'package',
  durationMs: 12,
  exitCode: 0,
  timedOut: false,
  decision: 'none',
  stdoutLength: 5,
  stderrLength: 0,
  ...over,
});

const newLog = (maxBytes?: number): { file: string; log: ReturnType<typeof createHookAuditLog> } => {
  seq += 1;
  const file = path.join(base, `case${seq}`, 'audit.jsonl');
  return { file, log: createHookAuditLog({ filePath: file, ...(maxBytes ? { maxBytes } : {}) }) };
};

describe('hookAudit', { timeout: 30_000 }, () => {
  it('writes one JSON line with the documented fields and reads it back', async () => {
    const { file, log } = newLog();
    await log.record(entry({ pluginId: 'my.plugin', decision: 'deny', exitCode: 2, errorCode: 'HOOK_TIMEOUT' }));
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(Object.keys(record).toSorted()).toEqual(
      [
        'decision',
        'durationMs',
        'errorCode',
        'event',
        'exitCode',
        'hookId',
        'pluginId',
        'source',
        'stderrLength',
        'stdoutLength',
        'timedOut',
        'ts',
      ].toSorted()
    );
    const recent = await log.readRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].pluginId).toBe('my.plugin');
    expect(recent[0].decision).toBe('deny');
  });

  it('never stores stdin, raw output or absolute paths, even when the entry carries them', () => {
    const hostile = {
      ...entry({ hookId: 'C:\\Users\\someone\\secret.js', pluginId: '/home/someone/plugin' }),
      stdin: 'SECRET-STDIN',
      stdout: 'SECRET-STDOUT',
      stderr: 'SECRET-STDERR',
    } as HookAuditInput;
    const text = JSON.stringify(toAuditRecord(hostile, 1));
    for (const secret of ['SECRET-STDIN', 'SECRET-STDOUT', 'SECRET-STDERR', 'someone', 'secret.js']) {
      expect(text).not.toContain(secret);
    }
  });

  it('rotates past the size limit and keeps exactly one older file', async () => {
    const { file, log } = newLog(1200);
    for (let index = 0; index < 40; index += 1) {
      await log.record(entry({ durationMs: index }));
    }
    const files = (await readdir(path.dirname(file))).toSorted();
    expect(files).toEqual(['audit.jsonl', 'audit.jsonl.1']);
    const current = await readFile(file, 'utf8');
    expect(Buffer.byteLength(current)).toBeLessThanOrEqual(1200);
    const recent = await log.readRecent(HOOK_AUDIT_MAX_READ);
    // The newest record survives the rotation and order is oldest first.
    expect(recent.at(-1)?.durationMs).toBe(39);
    const durations = recent.map((record) => record.durationMs);
    expect(durations).toEqual(durations.toSorted((left, right) => left - right));
  });

  it('caps readRecent at 200 and returns the last N', async () => {
    const { log } = newLog();
    for (let index = 0; index < 230; index += 1) await log.record(entry({ durationMs: index }));
    expect(await log.readRecent(9999)).toHaveLength(200);
    const last3 = await log.readRecent(3);
    expect(last3.map((record) => record.durationMs)).toEqual([227, 228, 229]);
  });

  it('skips torn and foreign lines and survives a missing file', async () => {
    const { file, log } = newLog();
    expect(await log.readRecent(5)).toEqual([]);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'not json\n{"event":"Nope"}\n', 'utf8');
    await log.record(entry());
    expect(await log.readRecent(5)).toHaveLength(1);
  });

  it('records a real run without stdin or output content (wired to onAudit)', async () => {
    const { file, log } = newLog();
    const script = path.join(base, 'noisy.js');
    await writeFile(
      script,
      `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('SECRET-OUT'); process.stderr.write('SECRET-ERR'); });`,
      'utf8'
    );
    const result = await runHook({
      handler: { form: 'exec', command: script, args: [], timeoutSec: 20 },
      event: 'PostToolUse',
      payload: { hook_event_name: 'PostToolUse', prompt: 'SECRET-IN' },
      cwd: base,
      placeholders: {},
      source: 'user',
      hookId: 'b'.repeat(64),
      onAudit: (auditEntry) => {
        void log.record(auditEntry);
      },
    });
    expect(result.ok).toBe(true);
    await log.flush();
    const text = await readFile(file, 'utf8');
    for (const secret of ['SECRET-IN', 'SECRET-OUT', 'SECRET-ERR']) expect(text).not.toContain(secret);
    const [record] = await log.readRecent(1);
    expect(record.stdoutLength).toBe('SECRET-OUT'.length);
    expect(record.stderrLength).toBe('SECRET-ERR'.length);
    expect(record.hookId).toBe('b'.repeat(64));
    expect(record.source).toBe('user');
  });
});
