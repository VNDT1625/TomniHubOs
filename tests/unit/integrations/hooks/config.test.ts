import { describe, expect, it } from 'vitest';
import { HOOK_LIMITS, parseHooksConfig } from '@/common/integrations/hooks';

const wrap = (event: string, handler: unknown, matcher?: string): unknown => ({
  hooks: { [event]: [{ ...(matcher !== undefined ? { matcher } : {}), hooks: [handler] }] },
});

describe('parseHooksConfig', () => {
  it('parses the three-level shape from the design example', () => {
    const { handlers, issues } = parseHooksConfig({
      hooks: {
        PostToolUse: [
          {
            matcher: 'Write|Edit|tomny_write|tomny_edit',
            hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/format.sh', args: [], timeout: 30 }],
          },
        ],
      },
    });
    expect(issues).toEqual([]);
    expect(handlers).toEqual([
      {
        event: 'PostToolUse',
        matcher: 'Write|Edit|tomny_write|tomny_edit',
        command: '${CLAUDE_PLUGIN_ROOT}/scripts/format.sh',
        args: [],
        timeoutSec: 30,
        form: 'exec',
        unsupported: false,
      },
    ]);
  });

  it('uses shell form without args and per-event default timeouts', () => {
    const a = parseHooksConfig(wrap('UserPromptSubmit', { type: 'command', command: 'echo hi' })).handlers[0];
    expect(a?.form).toBe('shell');
    expect(a?.args).toBeUndefined();
    expect(a?.matcher).toBeUndefined();
    expect(a?.timeoutSec).toBe(30);
    expect(parseHooksConfig(wrap('PreToolUse', { type: 'command', command: 'x' })).handlers[0]?.timeoutSec).toBe(60);
    expect(parseHooksConfig(wrap('SessionEnd', { type: 'command', command: 'x' })).handlers[0]?.timeoutSec).toBe(1.5);
  });

  it('accepts timeoutSec as an alias of timeout', () => {
    const h = parseHooksConfig(wrap('Stop', { type: 'command', command: 'x', timeoutSec: 12 })).handlers[0];
    expect(h?.timeoutSec).toBe(12);
  });

  it('reports non-command types as needs-runtime and does not create a handler', () => {
    for (const type of ['http', 'prompt', 'agent', 'mcp_tool']) {
      const { handlers, issues } = parseHooksConfig(wrap('PreToolUse', { type, url: 'https://example.com' }));
      expect(handlers).toEqual([]);
      expect(issues.map((i) => i.code)).toEqual(['needs-runtime']);
    }
  });

  it('keeps handlers of unsupported events, flagged, with an issue', () => {
    const { handlers, issues } = parseHooksConfig(wrap('PreCompact', { type: 'command', command: 'x' }));
    expect(handlers).toHaveLength(1);
    expect(handlers[0]).toMatchObject({ event: 'PreCompact', unsupported: true });
    expect(issues.map((i) => i.code)).toEqual(['unsupported-event']);
  });

  it('skips events nobody knows', () => {
    const { handlers, issues } = parseHooksConfig(wrap('Bogus', { type: 'command', command: 'x' }));
    expect(handlers).toEqual([]);
    expect(issues[0]?.code).toBe('unknown-event');
  });

  it('ignores unknown fields', () => {
    const h = parseHooksConfig(
      wrap('Stop', { type: 'command', command: 'x', async: true, shell: 'bash', statusMessage: 'hi' })
    ).handlers[0];
    expect(h).toEqual({ event: 'Stop', command: 'x', timeoutSec: 60, form: 'shell', unsupported: false });
  });

  it('enforces command, args and timeout limits', () => {
    const bad = [
      { type: 'command', command: 'x'.repeat(HOOK_LIMITS.commandMaxLength + 1) },
      { type: 'command', command: '' },
      { type: 'command', command: 'x', args: Array.from({ length: HOOK_LIMITS.argsMaxCount + 1 }, () => 'a') },
      { type: 'command', command: 'x', args: ['y'.repeat(HOOK_LIMITS.argMaxLength + 1)] },
      { type: 'command', command: 'x', timeout: 0 },
      { type: 'command', command: 'x', timeout: 601 },
      { type: 'command', command: 'x', timeout: '5' },
      { type: 'command', command: 'x', args: 'not-array' },
    ];
    for (const handler of bad) {
      const { handlers, issues } = parseHooksConfig(wrap('PreToolUse', handler));
      expect(handlers).toEqual([]);
      expect(issues[0]?.code).toBe('invalid-handler');
    }
    const edge = parseHooksConfig(
      wrap('PreToolUse', {
        type: 'command',
        command: 'x'.repeat(HOOK_LIMITS.commandMaxLength),
        args: Array.from({ length: HOOK_LIMITS.argsMaxCount }, () => 'a'.repeat(HOOK_LIMITS.argMaxLength)),
        timeout: 600,
      })
    );
    expect(edge.issues).toEqual([]);
    expect(edge.handlers).toHaveLength(1);
  });

  it('never throws on malformed input and reports issues', () => {
    const inputs: unknown[] = [
      undefined,
      null,
      42,
      'hooks',
      [],
      {},
      { hooks: 'x' },
      { hooks: [] },
      { hooks: { PreToolUse: 'x' } },
      { hooks: { PreToolUse: [null, 1, 'x', {}, { hooks: 'x' }, { matcher: 3, hooks: [] }] } },
      { hooks: { PreToolUse: [{ hooks: [null, 'x', 3, {}, { type: 3 }, { type: 'command' }] }] } },
      JSON.parse('{"hooks":{"__proto__":[{"hooks":[]}]}}'),
    ];
    for (const input of inputs) {
      expect(() => parseHooksConfig(input)).not.toThrow();
      const result = parseHooksConfig(input);
      expect(Array.isArray(result.handlers)).toBe(true);
      expect(Array.isArray(result.issues)).toBe(true);
    }
    expect(parseHooksConfig(undefined).issues[0]?.code).toBe('invalid-config');
    expect(parseHooksConfig({}).issues).toEqual([]);
  });

  it('survives hostile getters', () => {
    const hostile = {
      get hooks(): unknown {
        throw new Error('boom');
      },
    };
    const result = parseHooksConfig(hostile);
    expect(result.handlers).toEqual([]);
    expect(result.issues[0]?.code).toBe('invalid-config');
  });

  it('bounds the number of handlers and issues', () => {
    const many = Array.from({ length: 500 }, () => ({ type: 'command', command: 'x' }));
    const groups = Array.from({ length: 10 }, () => ({ hooks: many }));
    const result = parseHooksConfig({ hooks: { PreToolUse: groups } });
    expect(result.handlers.length).toBeLessThanOrEqual(HOOK_LIMITS.maxHandlers);
    expect(result.issues.length).toBeLessThanOrEqual(HOOK_LIMITS.maxIssues);
    expect(result.issues.some((i) => i.code === 'limit-exceeded')).toBe(true);
  });
});
