import { describe, expect, it } from 'vitest';
import { detectors } from '@/common/integrations/detectors';
import { detectRepository } from '@/common/integrations/detectors/repoDetection';
import { MAX_CONNECTIONS, MAX_OPEN_ITEMS } from '@/common/packages/adapter/primitives';
import type { AdapterConnection } from '@/common/packages/adapter';

const skill = (path: string): AdapterConnection => ({ kind: 'skill', path });
const none = { connections: [], openItems: [], skillRoots: [] } as const;

describe('detectRepository', () => {
  it('runs the registered detectors and reports their ids without the classifier', () => {
    const report = detectRepository({ files: ['README.md'], snippets: {}, findings: none });
    expect(report.detectors).toEqual(detectors.map((entry) => `${entry.id}@${entry.version}`).toSorted());
    expect(report.connections).toEqual([]);
    expect(report.archetype).toBe('source-only');
  });

  it('reads the root package.json from either form and takes the rest from the snippets', () => {
    const pkg = {
      name: 'srv',
      version: '1.0.0',
      bin: { srv: 'cli.js' },
      dependencies: { '@modelcontextprotocol/sdk': '1' },
    };
    for (const packageJson of [pkg, JSON.stringify(pkg)]) {
      const report = detectRepository({ files: ['package.json'], packageJson, snippets: {}, findings: none });
      expect(report.connections).toEqual([expect.objectContaining({ kind: 'mcp', id: 'srv', command: 'npx' })]);
    }
  });

  it('covers every SKILL.md under a skill root with the classifier’s own skill connection', () => {
    const report = detectRepository({
      files: ['skills/a/SKILL.md', 'skills/a/inner/SKILL.md', 'other/SKILL.md'],
      snippets: {},
      findings: { connections: [skill('source/skills/a')], openItems: [], skillRoots: ['skills/a'] },
    });
    expect(report.connections).toEqual([skill('source/skills/a')]);
    expect(report.openItems.map((item) => item.path)).toEqual(['source/other/SKILL.md']);
  });

  it('drops a detector copy of a server the classifier already starts, but not a different one', () => {
    const pkg = JSON.stringify({
      name: 'srv',
      version: '1.0.0',
      bin: 'cli.js',
      dependencies: { '@modelcontextprotocol/sdk': '1' },
    });
    const own: AdapterConnection = {
      kind: 'mcp',
      id: 'mine',
      title: 'Mine',
      command: 'npx',
      args: ['-y', 'srv@1.0.0'],
    };
    const same = detectRepository({
      files: ['package.json'],
      packageJson: pkg,
      snippets: {},
      findings: { connections: [own], openItems: [], skillRoots: [] },
    });
    expect(same.connections).toEqual([own]);
    const other: AdapterConnection = { ...own, args: ['-y', 'another@2.0.0'] };
    const different = detectRepository({
      files: ['package.json'],
      packageJson: pkg,
      snippets: {},
      findings: { connections: [other], openItems: [], skillRoots: [] },
    });
    expect(different.connections).toHaveLength(2);
  });

  it('never returns more than an adapter document can carry, and says what it cut', () => {
    const many = Array.from({ length: MAX_CONNECTIONS + 5 }, (_, index) =>
      skill(`source/s${String(index).padStart(3, '0')}`)
    );
    const cut = detectRepository({
      files: [],
      snippets: {},
      findings: { connections: many, openItems: [], skillRoots: [] },
    });
    expect(cut.connections).toHaveLength(MAX_CONNECTIONS);
    expect(cut.openItems[0]?.note).toContain(String(MAX_CONNECTIONS + 5));

    const items = Array.from({ length: MAX_OPEN_ITEMS + 5 }, (_, index) => ({
      kind: 'unrecognized' as const,
      note: `item ${index}`,
    }));
    const capped = detectRepository({
      files: [],
      snippets: {},
      findings: { connections: [], openItems: items, skillRoots: [] },
    });
    expect(capped.openItems).toHaveLength(MAX_OPEN_ITEMS);
  });
});
