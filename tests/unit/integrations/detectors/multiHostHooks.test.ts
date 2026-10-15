import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInventory, detectAll, type RepoInventory } from '@/common/integrations/detectors';
import { parseAdapterDocument } from '@/common/packages/adapter';

/** One plugin whose hook files are written for several hosts, with the same MCP server declared twice. */
const FIXTURE = path.resolve(__dirname, '../../../fixtures/repotopackage/multi-host-hooks-plugin');

const walk = (directory: string, prefix = ''): string[] =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(path.join(directory, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`]
    );

const inventory = (): RepoInventory => {
  const files = walk(FIXTURE).filter((file) => file !== 'expected.adapter.json');
  return createInventory({ files, readText: (file) => fs.readFileSync(path.join(FIXTURE, file), 'utf8') });
};

const detected = () => detectAll(inventory());

describe('multi-host hook plugin', () => {
  it('matches expected.adapter.json and is a valid adapter document', () => {
    const report = detected();
    const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected.adapter.json'), 'utf8')) as unknown;
    const document = parseAdapterDocument({
      schemaVersion: 1,
      generatedBy: 'classifier',
      connections: report.connections,
      openItems: report.openItems,
    });
    expect(JSON.parse(JSON.stringify({ connections: document.connections, openItems: document.openItems }))).toEqual(
      expected
    );
  });

  it('keeps one hook per handler, in exec form, with no matcher-group noise', () => {
    const report = detected();
    const hooks = report.connections.filter((connection) => connection.kind === 'hook');
    expect(hooks.map((hook) => (hook.kind === 'hook' ? hook.event : ''))).toEqual([
      'PostToolUse',
      'PreToolUse',
      'SessionStart',
    ]);
    for (const hook of hooks) {
      expect(hook).toMatchObject({
        command: 'node',
        args: [expect.stringMatching(/^\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\//u)],
      });
    }
    expect(JSON.stringify(report.openItems)).not.toContain('Matcher group');
  });

  it('reports each other-host hook file once and merges the duplicate MCP server', () => {
    const report = detected();
    const notes = report.openItems.map((item) => item.note).toSorted();
    expect(notes).toEqual([
      'hook config for jetbrains-copilot, not used (Claude Code format only)',
      'hook config for vscode-copilot, not used (Claude Code format only)',
    ]);
    const mcp = report.connections.filter((connection) => connection.kind === 'mcp');
    expect(mcp).toEqual([
      expect.objectContaining({ id: 'context-mode', command: 'node', args: ['start.mjs'], cwd: 'source' }),
    ]);
    expect(report.connections.length).toBeLessThanOrEqual(12);
  });
});
