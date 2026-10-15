import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rules } from '@/common/integrations/detectors/agent/rules';
import type { AdapterConnection } from '@/common/packages/adapter';
import { fixtureInventory } from './mcpFixtures';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/repotopackage');

const byKey = (left: AdapterConnection, right: AdapterConnection): number =>
  `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`);

describe('rules detector on the rules-collection fixture', () => {
  it('turns every rule file of the collection into a rules connection in its own format', () => {
    const result = rules.detect(fixtureInventory('rules-collection'));
    const expected = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, 'rules-collection', 'expected.adapter.json'), 'utf8')
    ) as { connections: AdapterConnection[]; openItems: unknown[] };

    expect([...result.connections].toSorted(byKey)).toEqual([...expected.connections].toSorted(byKey));
    expect(result.claimed).toEqual([
      '.cursor/rules/security.mdc',
      '.cursor/rules/style.mdc',
      '.windsurf/rules/git.md',
      'AGENTS.md',
      'CLAUDE.md',
    ]);
    expect(result.openItems).toEqual([]);
  });
});
