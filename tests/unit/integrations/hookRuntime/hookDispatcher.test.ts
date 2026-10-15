import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureHookRuntime,
  dispatchPostToolUse,
  dispatchPreToolUse,
  dispatchSessionStart,
  dispatchStop,
  dispatchUserPromptSubmit,
  drainHookContext,
  getHookCoverage,
  hasActivePreToolUseHook,
  queueHookContext,
  queuedHookContextSessions,
  sanitizeHookText,
  sanitizeHookValue,
  type HookTurnContext,
} from '@process/integrations/hookRuntime/hookDispatcher';
import { createHookWorld, hookAnswer, readRecords, type HookWorld } from './hookTestKit';

/** Real registry and real hook processes; only the runtime around them is absent. */

let world: HookWorld;
let turn: HookTurnContext;

beforeEach(async () => {
  world = await createHookWorld();
  configureHookRuntime({ registry: async () => world.registry });
  turn = {
    sessionId: 'sess-1',
    conversationId: 'conv-1',
    workspaceDir: world.workspace,
    permissionMode: 'workspace-write',
  };
});

afterEach(() => {
  configureHookRuntime();
});

const record = (name: string): string => `${world.dir}/${name}.jsonl`;

describe('PreToolUse verdicts', { timeout: 60_000 }, () => {
  it('exit code 2 denies and the reason comes from stderr, redacted', async () => {
    await world.install({
      event: 'PreToolUse',
      spec: { record: record('pre'), exitCode: 2, stderr: 'no rm here, token=sk-live-abcdefghijklmnopqrstuv1234' },
    });
    const verdict = await dispatchPreToolUse(turn, { tool: 'Bash', callId: 'c1', input: { command: 'rm -rf /' } });
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('no rm here');
    expect(verdict.reason).not.toContain('sk-live-abcdefghijklmnopqrstuv1234');
  });

  it('never turns an allow into a grant: allow, approve and updatedInput change nothing', async () => {
    await world.install({
      event: 'PreToolUse',
      spec: {
        record: record('pre'),
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'trust me',
            updatedInput: { command: 'echo harmless' },
          },
          decision: 'approve',
        }),
      },
    });
    const verdict = await dispatchPreToolUse(turn, { tool: 'Bash', input: { command: 'rm -rf /' } });
    expect(verdict).toEqual({ action: 'none' });
  });

  it('ask is reported as ask, and deny wins over ask from another hook', async () => {
    await world.install({
      event: 'PreToolUse',
      spec: {
        record: record('ask'),
        stdout: hookAnswer('PreToolUse', { permissionDecision: 'ask', permissionDecisionReason: 'check this' }),
      },
    });
    expect(await dispatchPreToolUse(turn, { tool: 'Write', input: {} })).toEqual({
      action: 'ask',
      reason: 'check this',
    });
    await world.install({ event: 'PreToolUse', spec: { record: record('deny'), exitCode: 2, stderr: 'stop' } });
    expect((await dispatchPreToolUse(turn, { tool: 'Write', input: {} })).action).toBe('deny');
  });

  it('honours the matcher: a Bash-only hook does not see Write', async () => {
    await world.install({
      event: 'PreToolUse',
      matcher: 'Bash',
      spec: { record: record('bash'), exitCode: 2, stderr: 'no' },
    });
    expect((await dispatchPreToolUse(turn, { tool: 'Write', input: {} })).action).toBe('none');
    expect((await dispatchPreToolUse(turn, { tool: 'Bash', input: {} })).action).toBe('deny');
  });

  it('redacts secrets in tool_input before they reach the hook process', async () => {
    await world.install({ event: 'PreToolUse', spec: { record: record('stdin') } });
    await dispatchPreToolUse(turn, {
      tool: 'Fetch',
      callId: 'c9',
      input: {
        url: 'https://example.test',
        password: 'hunter2-hunter2',
        headers: { Authorization: 'Bearer abc.def.ghi' },
      },
    });
    const [seen] = await readRecords(record('stdin'));
    const serialized = JSON.stringify(seen);
    expect(serialized).not.toContain('hunter2-hunter2');
    expect(serialized).not.toContain('abc.def.ghi');
    expect(seen).toMatchObject({
      hook_event_name: 'PreToolUse',
      tool_name: 'Fetch',
      tool_use_id: 'c9',
      session_id: 'sess-1',
      permission_mode: 'default',
      tomny: { conversation_id: 'conv-1' },
    });
  });

  it('maps the permission mode to the nearest Claude Code value', async () => {
    await world.install({ event: 'PreToolUse', spec: { record: record('mode') } });
    await dispatchPreToolUse({ ...turn, permissionMode: 'read-only' }, { tool: 'Read' });
    await dispatchPreToolUse({ ...turn, permissionMode: 'full-access' }, { tool: 'Read' });
    const modes = (await readRecords(record('mode'))).map((entry) => entry.permission_mode);
    expect(modes).toEqual(['plan', 'bypassPermissions']);
  });
});

describe('fail-open and switches', { timeout: 60_000 }, () => {
  it('a hook that times out does not block the tool', async () => {
    await world.install({
      event: 'PreToolUse',
      timeoutSec: 1,
      spec: { record: record('slow'), sleepMs: 5_000, exitCode: 2, stderr: 'too late' },
    });
    const started = Date.now();
    expect(await dispatchPreToolUse(turn, { tool: 'Bash' })).toEqual({ action: 'none' });
    expect(Date.now() - started).toBeLessThan(4_500);
  });

  it('a crashing hook (exit 1) does not block', async () => {
    await world.install({ event: 'PreToolUse', spec: { record: record('crash'), exitCode: 1, stderr: 'boom' } });
    expect(await dispatchPreToolUse(turn, { tool: 'Bash' })).toEqual({ action: 'none' });
  });

  it('a registry that fails or is missing never blocks and never throws', async () => {
    configureHookRuntime({
      registry: async () => {
        throw new Error('disk gone');
      },
    });
    expect(await dispatchPreToolUse(turn, { tool: 'Bash' })).toEqual({ action: 'none' });
    expect((await dispatchUserPromptSubmit(turn, 'hi')).blocked).toBe(false);
    expect(
      (await dispatchStop(turn, { lastAssistantMessage: 'x', stopHookActive: false })).continueWith
    ).toBeUndefined();
    configureHookRuntime({ registry: async () => undefined });
    expect(await dispatchPreToolUse(turn, { tool: 'Bash' })).toEqual({ action: 'none' });
    expect(await hasActivePreToolUseHook(world.workspace)).toBe(false);
  });

  it('the global switch and the per-source switch take effect on the very next call', async () => {
    await world.install({ event: 'PreToolUse', spec: { record: record('sw'), exitCode: 2, stderr: 'no' } });
    expect((await dispatchPreToolUse(turn, { tool: 'Bash' })).action).toBe('deny');

    await world.registry.setDisableAll(true);
    expect((await dispatchPreToolUse(turn, { tool: 'Bash' })).action).toBe('none');
    await world.registry.setDisableAll(false);
    expect((await dispatchPreToolUse(turn, { tool: 'Bash' })).action).toBe('deny');

    await world.registry.setSourceEnabled('package', false);
    expect((await dispatchPreToolUse(turn, { tool: 'Bash' })).action).toBe('none');
    await world.registry.setSourceEnabled('package', true);
    expect((await dispatchPreToolUse(turn, { tool: 'Bash' })).action).toBe('deny');
    expect(await readRecords(record('sw'))).toHaveLength(3);
  });

  it('writes an audit line per run without stdin or raw output', async () => {
    await world.install({
      event: 'PreToolUse',
      spec: { record: record('aud'), exitCode: 2, stderr: 'secret-reason-text' },
    });
    await dispatchPreToolUse(turn, { tool: 'Bash', input: { command: 'echo CANARY_STDIN' } });
    await world.registry.flush();
    const audit = await world.registry.readAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ event: 'PreToolUse', source: 'package', decision: 'deny', exitCode: 2 });
    expect(JSON.stringify(audit)).not.toContain('CANARY_STDIN');
    expect(JSON.stringify(audit)).not.toContain('secret-reason-text');
  });

  it('a script changed after approval is switched off and does not run', async () => {
    const id = await world.install({
      event: 'PreToolUse',
      spec: { record: record('toctou'), exitCode: 2, stderr: 'no' },
    });
    expect((await dispatchPreToolUse(turn, { tool: 'Bash' })).action).toBe('deny');
    const entry = world.registry.getEntry(id);
    expect(entry?.pluginRoot).toBeDefined();
    const { writeHookScript } = await import('./hookTestKit');
    await writeHookScript(`${entry?.pluginRoot}/hook.js`, { record: record('evil'), exitCode: 0 });
    expect((await dispatchPreToolUse(turn, { tool: 'Bash' })).action).toBe('none');
    expect(await readRecords(record('evil'))).toHaveLength(0);
    expect((await world.registry.listHooks())[0]?.status).toBe('stale');
  });
});

describe('UserPromptSubmit, Stop and context', { timeout: 60_000 }, () => {
  it('blocks a prompt on exit 2 with a redacted, path-free reason', async () => {
    await world.install({
      event: 'UserPromptSubmit',
      spec: { record: record('ups'), exitCode: 2, stderr: 'blocked by policy in C:\\Users\\bob\\secret\\x.txt' },
    });
    const verdict = await dispatchUserPromptSubmit(turn, 'please do the thing');
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain('blocked by policy');
    expect(verdict.reason).not.toContain('bob');
  });

  it('adds plain-text stdout as labelled context and lets the prompt through', async () => {
    await world.install({
      event: 'UserPromptSubmit',
      name: 'pkg.ctx',
      spec: { record: record('ctx'), stdout: 'Remember: use tabs.' },
    });
    const verdict = await dispatchUserPromptSubmit(turn, 'hello');
    expect(verdict.blocked).toBe(false);
    expect(verdict.additionalContext).toMatch(/^Hook pkg\.ctx:[0-9a-f]{8}:\nRemember: use tabs\.$/);
  });

  it('sends the prompt to the hook with credential-looking text redacted', async () => {
    await world.install({ event: 'UserPromptSubmit', spec: { record: record('ups-in') } });
    await dispatchUserPromptSubmit(turn, 'mat khau: Sup3rS3cret!! and key sk-live-abcdefghijklmnopqrstuv1234');
    const [seen] = await readRecords(record('ups-in'));
    expect(JSON.stringify(seen)).not.toContain('Sup3rS3cret');
    expect(JSON.stringify(seen)).not.toContain('sk-live-abcdefghijklmnopqrstuv1234');
    expect(seen).toMatchObject({ hook_event_name: 'UserPromptSubmit' });
  });

  it('Stop: a block decision asks to continue; continue:false halts; stop_hook_active follows the caller', async () => {
    await world.install({
      event: 'Stop',
      spec: { record: record('stop'), blockTimes: 1, blockReason: 'run the tests' },
    });
    const first = await dispatchStop(turn, { lastAssistantMessage: 'done', stopHookActive: false });
    expect(first.continueWith).toContain('run the tests');
    expect(first.halted).toBe(false);
    const second = await dispatchStop(turn, { lastAssistantMessage: 'done again', stopHookActive: true });
    expect(second.continueWith).toBeUndefined();
    const seen = await readRecords(record('stop'));
    expect(seen.map((entry) => entry.stop_hook_active)).toEqual([false, true]);
    expect(seen[0]).toMatchObject({ last_assistant_message: 'done' });

    await world.install({
      event: 'Stop',
      spec: { record: record('halt'), stdout: JSON.stringify({ continue: false, stopReason: 'enough' }) },
    });
    const halted = await dispatchStop(turn, { lastAssistantMessage: 'x', stopHookActive: false });
    expect(halted).toMatchObject({ halted: true, notice: 'enough' });
    expect(halted.continueWith).toBeUndefined();
  });

  it('queues PostToolUse and SessionStart context and drains it once, redacted', async () => {
    await world.install({
      event: 'PostToolUse',
      name: 'pkg.post',
      spec: {
        record: record('post'),
        stdout: hookAnswer('PostToolUse', {
          additionalContext: 'lint says: 3 warnings; key sk-live-abcdefghijklmnopqrstuv1234',
        }),
      },
    });
    await world.install({
      event: 'SessionStart',
      spec: { record: record('start'), stdout: 'Project uses pnpm.' },
    });
    await dispatchSessionStart(turn, 'startup');
    await dispatchPostToolUse(turn, {
      tool: 'Write',
      callId: 'w1',
      input: { file_path: 'a.ts' },
      outcome: 'success',
      text: 'ok',
    });
    expect(queuedHookContextSessions()).toBe(1);

    const block = await drainHookContext('sess-1');
    expect(block).toContain('## Hook context');
    expect(block).toContain('Project uses pnpm.');
    expect(block).toContain('3 warnings');
    expect(block).not.toContain('sk-live-abcdefghijklmnopqrstuv1234');
    expect(await drainHookContext('sess-1')).toBeUndefined();
    expect(await drainHookContext('another-session')).toBeUndefined();
  });

  it('PostToolUseFailure carries the error and the tool input', async () => {
    await world.install({ event: 'PostToolUseFailure', spec: { record: record('fail') } });
    await dispatchPostToolUse(turn, {
      tool: 'Bash',
      callId: 'b1',
      input: { command: 'ls' },
      outcome: 'error',
      text: 'exit 1',
    });
    const [seen] = await readRecords(record('fail'));
    expect(seen).toMatchObject({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      error: 'exit 1',
      tool_input: { command: 'ls' },
    });
  });

  it('bounds the context queue', () => {
    for (let index = 0; index < 60; index += 1) queueHookContext('big', 'h', `part ${index} ${'x'.repeat(2_000)}`);
    return drainHookContext('big').then((block) => {
      expect((block ?? '').length).toBeLessThan(26_000);
      expect(block).toContain('part 59');
      expect(block).not.toContain('part 0 ');
    });
  });
});

describe('sanitizers and coverage', () => {
  it('sanitizeHookValue hides sensitive keys, caps depth and survives cycles', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    const out = sanitizeHookValue({ apiKey: 'k', nested: { token: 't', ok: 1 }, cyclic }) as {
      apiKey: unknown;
      nested: unknown;
      cyclic: { self: unknown };
    };
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.nested).toEqual({ token: '[REDACTED]', ok: 1 });
    expect(out.cyclic.self).toBe('[CIRCULAR]');
  });

  it('sanitizeHookText strips control characters and absolute paths and clips', () => {
    expect(sanitizeHookText('bad \u0007 file C:\\Users\\a\\b.txt and /home/a/b/c.txt')).toBe(
      'bad  file <path> and <path>'
    );
    expect(sanitizeHookText('x'.repeat(900)).length).toBe(500);
  });

  it('states coverage honestly per agent', () => {
    expect(getHookCoverage('tomny-json-stream', 'workspace-write').preToolUse).toBe('all-tools');
    expect(getHookCoverage('acp', 'workspace-write').preToolUse).toBe('permission-requests-only');
    expect(getHookCoverage('acp', 'full-access').preToolUse).toBe('none');
    expect(getHookCoverage('acp', 'read-only').preToolUse).toBe('none');
    expect(getHookCoverage('codex-app-server', 'workspace-write').preToolUse).toBe('none');
    expect(getHookCoverage('loopback-openai', 'workspace-write')).toMatchObject({
      preToolUse: 'none',
      postToolUse: 'none',
    });
    expect(getHookCoverage('codex-app-server', 'workspace-write').note).toMatch(/cannot block/);
  });
});
