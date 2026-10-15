import { describe, expect, it } from 'vitest';
import { createInventory, detectWith } from '@/common/integrations/detectors';
import { agentPlugins, hooks } from '@/common/integrations/detectors/agent';
import { ownerFolderOf } from '@/common/integrations/detectors/agent/hooks';
import { fixtureInventory, inventoryOf } from './mcpFixtures';

const SECRET = 'sk-test-value-never-copied-7f3a';

describe('hooks detector', () => {
  it('turns the hook handlers of a plugin fixture into hook connections and open items', () => {
    const result = hooks.detect(fixtureInventory('claude-plugin-full'));

    expect(result.claimed).toEqual(['hooks/hooks.json']);
    expect(result.connections.map((connection) => connection.kind)).toEqual(['hook', 'hook', 'hook']);
    expect(result.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'hook',
          event: 'PostToolUse',
          matcher: 'Write|Edit',
          command: '${CLAUDE_PLUGIN_ROOT}/scripts/format.sh',
          plugin: 'source',
          origin: 'classifier',
        }),
        expect.objectContaining({
          kind: 'hook',
          event: 'PreToolUse',
          matcher: 'Bash',
          command: 'python',
          args: ['${CLAUDE_PLUGIN_ROOT}/scripts/guard.py'],
        }),
        expect.objectContaining({ kind: 'hook', event: 'PreCompact' }),
      ])
    );
    // Stop uses type "prompt", FutureEvent is unknown, PreCompact is known but not fired by v1: all three are kept
    // out of the active set with a reason, none is silently dropped.
    expect(result.openItems.map((item) => item.kind)).toEqual(['needs-runtime', 'needs-runtime', 'needs-runtime']);
    expect(result.openItems.map((item) => item.note).join('\n')).toMatch(/FutureEvent|prompt|chưa được hỗ trợ/u);
  });

  it('reads the hooks block of a repository settings file and never copies the rest of it', () => {
    const settings = JSON.stringify({
      env: { ANTHROPIC_API_KEY: SECRET },
      permissions: { allow: ['Bash(ls)'] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './.claude/hooks/guard.sh' }] }],
      },
    });
    const result = hooks.detect(inventoryOf({ '.claude/settings.json': settings }));

    expect(result.connections).toEqual([
      expect.objectContaining({
        kind: 'hook',
        event: 'PreToolUse',
        matcher: 'Bash',
        command: './.claude/hooks/guard.sh',
        plugin: 'source',
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('keeps the plugin folder of a nested Claude hooks file', () => {
    const claude = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/done.mjs"' }] }] },
    });
    const result = hooks.detect(
      inventoryOf({
        'plugins/a/.claude-plugin/plugin.json': '{"name":"a"}',
        'plugins/a/hooks/hooks.json': claude,
      })
    );

    expect(result.connections).toEqual([
      expect.objectContaining({
        kind: 'hook',
        plugin: 'source/plugins/a',
        command: 'node',
        args: ['${CLAUDE_PLUGIN_ROOT}/done.mjs'],
      }),
    ]);
  });

  it('reports a nested Codex hooks file once as another host config, not as connections', () => {
    const codex = JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node scripts/done.js' }] }] },
    });
    const result = hooks.detect(inventoryOf({ 'plugins/a/.codex/hooks.json': codex }));

    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([
      expect.objectContaining({
        kind: 'unrecognized',
        note: 'hook config for codex, not used (Claude Code format only)',
        path: 'source/plugins/a/.codex/hooks.json',
      }),
    ]);
  });

  it('ignores a settings file that has no hooks key, and does not claim it', () => {
    const result = hooks.detect(inventoryOf({ '.gemini/settings.json': '{"theme":"dark"}' }));

    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([]);
    expect(result.claimed).toEqual([]);
  });

  it('reports the hooks of another host settings file as one config note, not as connections', () => {
    const gemini = JSON.stringify({
      hooks: { BeforeTool: [{ matcher: 'run_shell_command', hooks: [{ type: 'command', command: 'check.sh' }] }] },
    });
    const result = hooks.detect(inventoryOf({ '.gemini/settings.json': gemini }));

    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([
      expect.objectContaining({
        kind: 'unrecognized',
        note: 'hook config for gemini, not used (Claude Code format only)',
      }),
    ]);
    expect(result.claimed).toEqual(['.gemini/settings.json']);
  });

  it('never reads a file outside the declaration list or inside vendored folders', () => {
    const read: string[] = [];
    const inventory = createInventory({
      files: ['src/index.ts', 'hooks.json', 'node_modules/pkg/.claude/settings.json'],
      readText: (path) => {
        read.push(path);
        return path === 'hooks.json' ? '{"hooks":{}}' : 'secret source';
      },
    });
    hooks.detect(inventory);

    expect(read).toEqual(['hooks.json']);
  });

  describe('hostile input', () => {
    it('drops traversal and absolute paths before any text is read', () => {
      const result = hooks.detect(
        inventoryOf({
          '../hooks.json': '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"evil"}]}]}}',
          '/etc/hooks.json': '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"evil"}]}]}}',
        })
      );

      expect(result.connections).toEqual([]);
      expect(result.claimed).toEqual([]);
    });

    it('refuses a command with control characters, reporting the field name and not the value', () => {
      const hostile = JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo \u0007 hi' }] }] },
      });
      const result = hooks.detect(inventoryOf({ 'hooks.json': hostile }));

      expect(result.connections).toEqual([]);
      expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized', path: 'source/hooks.json' })]);
      expect(JSON.stringify(result)).not.toContain('\u0007');
    });

    it('reports a hooks file whose text is missing (too large or over budget) as unrecognized', () => {
      const result = hooks.detect(inventoryOf({}, ['hooks.json']));

      expect(result.connections).toEqual([]);
      expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized', path: 'source/hooks.json' })]);
    });

    it('reports invalid JSON as unrecognized', () => {
      const result = hooks.detect(inventoryOf({ 'hooks.json': '{"hooks": ' }));

      expect(result.connections).toEqual([]);
      expect(result.openItems).toEqual([expect.objectContaining({ kind: 'unrecognized' })]);
    });

    it('does not hang or crash on a file cut at the read cap', () => {
      const huge = `{"hooks":{"Stop":[${' '.repeat(300 * 1024)}]}}`;
      const result = hooks.detect(inventoryOf({ 'hooks.json': huge }));

      expect(result.connections).toEqual([]);
      expect(result.openItems.map((item) => item.kind)).toEqual(['unrecognized']);
    });
  });

  it('dedupes plugin hooks read by both agent-plugins and hooks through the merge step', () => {
    const inventory = fixtureInventory('claude-plugin-full');
    const alone = hooks.detect(inventory).connections.filter((connection) => connection.kind === 'hook');
    const merged = detectWith(inventory, [agentPlugins, hooks]).connections.filter(
      (connection) => connection.kind === 'hook'
    );

    expect(alone).toHaveLength(3);
    expect(merged).toHaveLength(3);
  });

  it('computes the owner folder of a hooks file', () => {
    expect(ownerFolderOf('hooks/hooks.json')).toBe('');
    expect(ownerFolderOf('plugins/a/hooks/hooks.json')).toBe('plugins/a');
    expect(ownerFolderOf('.codex/hooks.json')).toBe('');
    expect(ownerFolderOf('plugins/a/.claude/settings.json')).toBe('plugins/a');
  });
});
