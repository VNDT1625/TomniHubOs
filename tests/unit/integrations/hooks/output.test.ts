import { describe, expect, it } from 'vitest';
import {
  MAX_HOOK_STRING_LENGTH,
  MAX_HOOK_STREAM_BYTES,
  SUPPORTED_HOOK_EVENTS,
  capStream,
  interpretHookResult,
  mergeDecisions,
  type HookEventName,
  type HookResult,
} from '@/common/integrations/hooks';

const run = (event: HookEventName, exitCode: number | null, stdout = '', stderr = '', timedOut = false): HookResult =>
  interpretHookResult({ event, exitCode, stdout, stderr, timedOut });

const BLOCKING: HookEventName[] = ['PreToolUse', 'UserPromptSubmit', 'Stop'];
const POST: HookEventName[] = ['PostToolUse', 'PostToolUseFailure'];
const OBSERVE: HookEventName[] = ['SessionStart', 'Notification', 'SessionEnd'];

describe('interpretHookResult: exit codes', () => {
  it.each(SUPPORTED_HOOK_EVENTS)('exit 0 with no output is a quiet success for %s', (event) => {
    expect(run(event, 0)).toEqual({ blocked: false, warnings: [] });
  });

  it.each(['SessionStart', 'UserPromptSubmit'] as const)('exit 0 plain stdout becomes context for %s', (event) => {
    expect(run(event, 0, '  Project uses bun.\n')).toMatchObject({
      blocked: false,
      additionalContext: 'Project uses bun.',
    });
  });

  it.each(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'Notification', 'SessionEnd'] as const)(
    'exit 0 plain stdout is ignored for %s',
    (event) => {
      expect(run(event, 0, 'hello')).toEqual({ blocked: false, warnings: [] });
    }
  );

  it.each(BLOCKING)('exit 2 blocks %s with stderr as reason', (event) => {
    const r = run(event, 2, 'ignored stdout', ' nope \n');
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('nope');
    expect(r.permissionDecision).toBe(event === 'PreToolUse' ? 'deny' : undefined);
  });

  it('exit 2 without stderr still blocks with a default reason', () => {
    expect(run('Stop', 2)).toMatchObject({ blocked: true, reason: 'Blocked by hook' });
  });

  it.each(POST)('exit 2 on %s turns stderr into context and does not block', (event) => {
    expect(run(event, 2, '', 'lint failed')).toEqual({
      blocked: false,
      additionalContext: 'lint failed',
      warnings: [],
    });
  });

  it.each(OBSERVE)('exit 2 on %s never blocks and adds nothing', (event) => {
    expect(run(event, 2, '', 'err')).toEqual({ blocked: false, warnings: [] });
  });

  it.each(SUPPORTED_HOOK_EVENTS)('other exit codes do not block %s and warn', (event) => {
    for (const code of [1, 3, 127, -1]) {
      const r = run(event, code, '{"decision":"block","reason":"x"}', 'boom');
      expect(r.blocked).toBe(false);
      expect(r.permissionDecision).toBeUndefined();
      expect(r.warnings).toHaveLength(1);
    }
  });

  it.each(SUPPORTED_HOOK_EVENTS)('timeout and failure to start do not block %s', (event) => {
    const timeout = run(event, null, '', '', true);
    expect(timeout.blocked).toBe(false);
    expect(timeout.warnings[0]).toMatch(/timed out/);
    const killed = run(event, 2, '', 'late', true);
    expect(killed.blocked).toBe(false);
    const noStart = run(event, null, '', 'spawn ENOENT');
    expect(noStart.blocked).toBe(false);
    expect(noStart.warnings).toHaveLength(1);
    expect(run(event, Number.NaN).blocked).toBe(false);
  });
});

describe('interpretHookResult: JSON', () => {
  it('reads a PreToolUse deny with reason', () => {
    const out = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'rm -rf',
      },
    });
    expect(run('PreToolUse', 0, out)).toEqual({
      blocked: true,
      reason: 'rm -rf',
      permissionDecision: 'deny',
      warnings: [],
    });
  });

  it('reads a PreToolUse ask without blocking', () => {
    const out = JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'sure?' },
    });
    expect(run('PreToolUse', 0, out)).toEqual({
      blocked: false,
      reason: 'sure?',
      permissionDecision: 'ask',
      warnings: [],
    });
  });

  it('deny beats ask when both appear', () => {
    const out = JSON.stringify({
      decision: 'block',
      reason: 'top',
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' },
    });
    expect(run('PreToolUse', 0, out)).toMatchObject({ blocked: true, permissionDecision: 'deny', reason: 'top' });
  });

  it('maps legacy block to deny', () => {
    expect(run('PreToolUse', 0, '{"decision":"block","reason":"old"}')).toMatchObject({
      blocked: true,
      permissionDecision: 'deny',
      reason: 'old',
    });
  });

  it('never turns approve or allow into a permission, and warns', () => {
    const legacy = run('PreToolUse', 0, '{"decision":"approve","reason":"ok"}');
    expect(legacy.blocked).toBe(false);
    expect(legacy.permissionDecision).toBeUndefined();
    expect(legacy.warnings.join(' ')).toMatch(/cannot grant/);

    const modern = run(
      'PreToolUse',
      0,
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } })
    );
    expect(modern).toEqual({ blocked: false, warnings: [expect.stringMatching(/cannot grant/)] });
  });

  it('allow cannot override an exit 2 block', () => {
    const out = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } });
    const r = run('PreToolUse', 2, out, 'denied by exit code');
    expect(r.blocked).toBe(true);
    expect(r.permissionDecision).toBe('deny');
    expect(r.reason).toBe('denied by exit code');
  });

  it('never exposes an allow value from any input', () => {
    const inputs = ['allow', 'approve', 'ALLOW', 'defer', 'grant'];
    for (const value of inputs) {
      for (const shape of [
        { decision: value },
        { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: value } },
      ]) {
        const r = run('PreToolUse', 0, JSON.stringify(shape));
        expect(r.blocked).toBe(false);
        expect(r.permissionDecision).toBeUndefined();
      }
    }
  });

  it('ignores updatedInput and updatedToolOutput with a warning', () => {
    const out = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        updatedInput: { command: 'ls' },
      },
      updatedToolOutput: 'x',
    });
    const r = run('PreToolUse', 0, out);
    expect(r).not.toHaveProperty('updatedInput');
    expect(r.permissionDecision).toBe('ask');
    expect(r.warnings.some((w) => w.includes('updatedInput'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('updatedToolOutput'))).toBe(true);
  });

  it('blocks UserPromptSubmit and Stop on decision block', () => {
    expect(run('UserPromptSubmit', 0, '{"decision":"block","reason":"no secrets"}')).toMatchObject({
      blocked: true,
      reason: 'no secrets',
    });
    expect(run('Stop', 0, '{"decision":"block","reason":"run tests"}')).toMatchObject({
      blocked: true,
      reason: 'run tests',
    });
  });

  it('exit 2 uses the JSON reason when it blocks, else stderr', () => {
    expect(run('Stop', 2, '{"decision":"block","reason":"from json"}', 'from stderr').reason).toBe('from json');
    expect(run('Stop', 2, '{"foo":1}', 'from stderr').reason).toBe('from stderr');
  });

  it('PostToolUse block feedback becomes context, never a block', () => {
    const r = run('PostToolUse', 0, '{"decision":"block","reason":"fix lint"}');
    expect(r).toEqual({ blocked: false, additionalContext: 'fix lint', warnings: [] });
  });

  it('reads additionalContext, systemMessage, continue and stopReason', () => {
    const out = JSON.stringify({
      continue: false,
      stopReason: 'build broke',
      systemMessage: 'heads up',
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'generated file' },
    });
    expect(run('PostToolUse', 0, out)).toEqual({
      blocked: false,
      additionalContext: 'generated file',
      systemMessage: 'heads up',
      continue: false,
      stopReason: 'build broke',
      warnings: [],
    });
  });

  it('continue true is the default and is not echoed', () => {
    expect(run('Stop', 0, '{"continue":true}')).toEqual({ blocked: false, warnings: [] });
  });

  it('ignores hookSpecificOutput for a different event', () => {
    const out = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' } });
    const r = run('PostToolUse', 0, out);
    expect(r.blocked).toBe(false);
    expect(r.warnings).toHaveLength(1);
  });

  it('ignores wrongly typed fields with warnings', () => {
    const r = run('UserPromptSubmit', 0, '{"continue":"no","systemMessage":5,"decision":7,"reason":[]}');
    expect(r.blocked).toBe(false);
    expect(r.continue).toBeUndefined();
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('ignores decisions on observe-only events', () => {
    for (const event of OBSERVE) {
      expect(run(event, 0, '{"decision":"block","reason":"x"}').blocked).toBe(false);
    }
  });

  it('does not take additionalContext from events that discard it', () => {
    const out = JSON.stringify({ hookSpecificOutput: { hookEventName: 'Notification', additionalContext: 'x' } });
    expect(run('Notification', 0, out)).toEqual({ blocked: false, warnings: [] });
  });
});

describe('interpretHookResult: stdout shapes', () => {
  it('broken JSON: no block, no context, warning', () => {
    // Starts with "{" but does not end with "}": plain text per design 11.4, never a decision.
    const r = run('UserPromptSubmit', 0, '{"decision": "block", ');
    expect(r.blocked).toBe(false);
    expect(r.additionalContext).toBe('{"decision": "block",');
    expect(run('Stop', 0, '{"decision": "block", ').blocked).toBe(false);
    const r2 = run('UserPromptSubmit', 0, '{"decision": block}');
    expect(r2.blocked).toBe(false);
    expect(r2.additionalContext).toBeUndefined();
    expect(r2.warnings).toHaveLength(1);
  });

  it('text mixed with JSON is plain text (and never parsed as a decision)', () => {
    const mixed = 'Loading profile...\n{"decision":"block","reason":"x"}';
    expect(run('UserPromptSubmit', 0, mixed)).toEqual({ blocked: false, additionalContext: mixed, warnings: [] });
    expect(run('PreToolUse', 0, mixed)).toEqual({ blocked: false, warnings: [] });
    const trailing = '{"a":1} trailing';
    expect(run('SessionStart', 0, trailing).additionalContext).toBe(trailing);
  });

  it('a JSON array or string is plain text', () => {
    expect(run('SessionStart', 0, '["a","b"]').additionalContext).toBe('["a","b"]');
    expect(run('SessionStart', 0, '"quoted"').additionalContext).toBe('"quoted"');
    expect(run('PreToolUse', 0, '[{"decision":"block"}]').blocked).toBe(false);
  });

  it('tolerates surrounding whitespace around JSON', () => {
    expect(run('Stop', 0, '\n  {"decision":"block","reason":"r"}  \n').blocked).toBe(true);
  });
});

describe('interpretHookResult: limits', () => {
  it('cuts long strings to 10000 characters with a note', () => {
    // Five 12k fields stay under the 64 KB stream cap, so the JSON remains parseable.
    const long = 'x'.repeat(MAX_HOOK_STRING_LENGTH + 2000);
    const ctx = run('SessionStart', 0, long).additionalContext ?? '';
    expect(ctx.length).toBeLessThanOrEqual(MAX_HOOK_STRING_LENGTH);
    expect(ctx).toMatch(/truncated/);

    const json = JSON.stringify({
      systemMessage: long,
      stopReason: long,
      continue: false,
      decision: 'block',
      reason: long,
      hookSpecificOutput: { hookEventName: 'Stop', additionalContext: long },
    });
    const r = run('Stop', 0, json);
    for (const value of [r.reason, r.systemMessage, r.stopReason, r.additionalContext]) {
      expect(value?.length).toBeLessThanOrEqual(MAX_HOOK_STRING_LENGTH);
      expect(value).toMatch(/truncated/);
    }
  });

  it('keeps a string of exactly 10000 characters intact', () => {
    const exact = 'y'.repeat(MAX_HOOK_STRING_LENGTH);
    expect(run('SessionStart', 0, exact).additionalContext).toBe(exact);
  });

  it('reads at most 64 KB of each stream', () => {
    const big = 'z'.repeat(MAX_HOOK_STREAM_BYTES * 3);
    const r = run('PostToolUse', 2, big, big);
    expect(r.additionalContext?.length).toBeLessThanOrEqual(MAX_HOOK_STRING_LENGTH);
    // JSON closing brace beyond 64 KB is lost, so it is no longer an object.
    const json = '{"decision":"block","reason":"r","pad":"' + 'p'.repeat(MAX_HOOK_STREAM_BYTES) + '"}';
    expect(run('Stop', 0, json).blocked).toBe(false);
  });

  it('capStream counts bytes and never leaves a split character', () => {
    const wide = '€'.repeat(MAX_HOOK_STREAM_BYTES);
    const capped = capStream(wide);
    expect(new TextEncoder().encode(capped).length).toBeLessThanOrEqual(MAX_HOOK_STREAM_BYTES);
    expect(capped).not.toContain('�');
    expect(capStream('short')).toBe('short');
  });
});

describe('mergeDecisions', () => {
  const ok: HookResult = { blocked: false, warnings: [] };
  const deny: HookResult = { blocked: true, reason: 'no', permissionDecision: 'deny', warnings: [] };
  const ask: HookResult = { blocked: false, reason: 'sure?', permissionDecision: 'ask', warnings: [] };

  it('is neutral for an empty list', () => {
    expect(mergeDecisions([])).toEqual({ blocked: false, warnings: [] });
  });

  it('deny beats ask beats nothing, regardless of order', () => {
    expect(mergeDecisions([ok, ask, deny])).toMatchObject({ blocked: true, permissionDecision: 'deny', reason: 'no' });
    expect(mergeDecisions([deny, ask, ok])).toMatchObject({ blocked: true, permissionDecision: 'deny', reason: 'no' });
    expect(mergeDecisions([ok, ask])).toMatchObject({ blocked: false, permissionDecision: 'ask', reason: 'sure?' });
    expect(mergeDecisions([ok, ok])).toEqual({ blocked: false, warnings: [] });
  });

  it('joins distinct blocking reasons and ignores ask reasons when denied', () => {
    const other: HookResult = { ...deny, reason: 'also no' };
    expect(mergeDecisions([deny, other, deny, ask]).reason).toBe('no\nalso no');
  });

  it('blocks for non-tool events too (no permissionDecision)', () => {
    const block: HookResult = { blocked: true, reason: 'tests', warnings: [] };
    const merged = mergeDecisions([ok, block]);
    expect(merged.blocked).toBe(true);
    expect(merged.permissionDecision).toBeUndefined();
  });

  it('any continue:false stops the turn with its reason', () => {
    const stop: HookResult = { blocked: false, continue: false, stopReason: 'halt', warnings: [] };
    const merged = mergeDecisions([ok, stop, { ...ok, continue: false, stopReason: 'halt' }]);
    expect(merged.continue).toBe(false);
    expect(merged.stopReason).toBe('halt');
    expect(mergeDecisions([ok]).continue).toBeUndefined();
  });

  it('collects context, messages and warnings from every hook', () => {
    const a: HookResult = { blocked: false, additionalContext: 'A', systemMessage: 'ma', warnings: ['w1'] };
    const b: HookResult = { blocked: false, additionalContext: 'B', warnings: ['w2'] };
    expect(mergeDecisions([a, ok, b])).toEqual({
      blocked: false,
      additionalContext: 'A\n\nB',
      systemMessage: 'ma',
      warnings: ['w1', 'w2'],
    });
  });

  it('never invents an allow', () => {
    const merged = mergeDecisions([ok, ok, ask]);
    expect(['deny', 'ask', undefined]).toContain(merged.permissionDecision);
  });
});
