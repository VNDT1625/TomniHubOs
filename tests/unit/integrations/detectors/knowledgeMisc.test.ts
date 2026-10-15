import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInventory } from '@/common/integrations/detectors';
import { knowledgeMisc } from '@/common/integrations/detectors/apps';
import type { AdapterConnection } from '@/common/packages/adapter';
import { fixtureInventory, inventoryOf } from './mcpFixtures';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/repotopackage');

const byKey = (left: AdapterConnection, right: AdapterConnection): number =>
  `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`);

const markdownFiles = (folder: string, count: number): Record<string, string> =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`${folder}/note-${i}.md`, `# ${i}`]));

describe('knowledge-misc detector', () => {
  it('matches the expected knowledge connections of the awesome-list fixture', () => {
    // The fixture's README is an awesome list, but README text is not read (design section 7.1): the awesome list
    // is only recognized by a root file named awesome*.md. Only the docs folder is knowledge here.
    const result = knowledgeMisc.detect(fixtureInventory('awesome-list'));
    const expected = JSON.parse(
      fs.readFileSync(path.join(FIXTURES, 'awesome-list', 'expected.adapter.json'), 'utf8')
    ) as { connections: AdapterConnection[]; openItems: unknown[] };

    expect([...result.connections].toSorted(byKey)).toEqual([...expected.connections].toSorted(byKey));
    expect(result.openItems).toEqual([]);
    expect(result.claimed).toEqual([]);
  });

  it('takes a root file named awesome*.md as an awesome list, without reading it', () => {
    const read: string[] = [];
    const inventory = createInventory({
      files: ['awesome-widgets.md'],
      readText: (file) => {
        read.push(file);
        return '';
      },
    });
    const result = knowledgeMisc.detect(inventory);

    expect(result.connections).toEqual([
      expect.objectContaining({ kind: 'knowledge', id: 'awesome-list', paths: ['source/awesome-widgets.md'] }),
    ]);
    expect(read).toEqual([]);
  });

  it('turns a Markdown folder with enough documents into knowledge, and leaves a smaller one out', () => {
    const many = knowledgeMisc.detect(inventoryOf(markdownFiles('wiki', 5)));
    const few = knowledgeMisc.detect(inventoryOf(markdownFiles('notes', 4)));

    expect(many.connections).toEqual([
      expect.objectContaining({
        kind: 'knowledge',
        id: 'md-wiki',
        paths: Array.from({ length: 5 }, (_, i) => `source/wiki/note-${i}.md`),
      }),
    ]);
    expect(few.connections).toEqual([]);
  });

  it('keeps the outermost docs folder and drops the ones nested inside it', () => {
    const result = knowledgeMisc.detect(
      inventoryOf({ 'docs/a.md': '#', 'docs/guide/docs/b.md': '#', 'pkg/docs/c.md': '#' })
    );

    expect(result.connections.map((connection) => connection.id).toSorted()).toEqual(['docs', 'pkg-docs']);
  });

  it('collects notebooks into one connection and caps it at the path limit', () => {
    const notebooks = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`lab/n${i}.ipynb`, '{}']));
    const result = knowledgeMisc.detect(inventoryOf(notebooks));
    const connection = result.connections.find((item) => item.id === 'notebooks');

    expect(connection).toEqual(expect.objectContaining({ kind: 'knowledge' }));
    expect((connection as { paths: string[] }).paths).toHaveLength(200);
  });

  it('never packages a model weight: each file becomes an open item, capped with a summary', () => {
    const models = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`models/m${i}.gguf`, 'x']));
    const result = knowledgeMisc.detect(inventoryOf(models));

    expect(result.connections).toEqual([]);
    expect(result.openItems).toHaveLength(9);
    expect(result.openItems[0]).toEqual(
      expect.objectContaining({ kind: 'unrecognized', path: 'source/models/m0.gguf' })
    );
  });

  it('leaves prompt, rule, skill and dot folders to the detectors that own them', () => {
    const result = knowledgeMisc.detect(
      inventoryOf({
        ...markdownFiles('.claude/commands', 6),
        ...markdownFiles('rules', 6),
        ...markdownFiles('skills/x', 6),
        'skills/x/SKILL.md': '---\nname: x\n---',
      })
    );

    expect(result.connections).toEqual([]);
  });

  it('reads no document text: the knowledge detector needs only file names', () => {
    const read: string[] = [];
    const inventory = createInventory({
      files: ['README.md', 'docs/guide.md', 'notes/a.md'],
      readText: (file) => {
        read.push(file);
        return '';
      },
    });
    knowledgeMisc.detect(inventory);

    expect(read).toEqual([]);
  });

  it('drops traversal paths before they become knowledge', () => {
    const result = knowledgeMisc.detect(inventoryOf({ '../docs/a.md': '#' }));

    expect(result.connections).toEqual([]);
  });
});
