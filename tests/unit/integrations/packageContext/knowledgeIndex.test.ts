import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createKnowledgeIndex,
  MAX_READ_CHARS,
  MAX_SCANNED_DOCUMENTS,
  tokenizeQuery,
  type KnowledgeTextReader,
} from '@process/integrations/packageContext/knowledgeIndex';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const tempFile = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-knowledge-'));
  roots.push(root);
  return path.join(root, 'knowledge-index.json');
};

const OWNER = { packageId: 'com.community.awesome', collectionId: 'docs' } as const;

const documents = (files: Record<string, string>): KnowledgeTextReader =>
  vi.fn<KnowledgeTextReader>(async (_owner, documentPath) => files[documentPath]);

describe('knowledge index: search', () => {
  it('finds documents by words in their text, title and path, best match first, with a passage around the match', async () => {
    const readText = documents({
      'source/guides/testing.md': 'How to write a vitest suite. Mock the registry, then assert the registry state.',
      'source/guides/setup.md': 'Install the tools. Nothing about tests here except the word vitest once.',
      'source/notes/unrelated.md': 'Gardening tips for spring.',
    });
    const index = createKnowledgeIndex({ readText });
    await index.replaceCollection(OWNER, {
      title: 'Awesome docs',
      documents: [
        { path: 'source/guides/testing.md', title: 'Testing' },
        { path: 'source/guides/setup.md', title: 'Setup' },
        { path: 'source/notes/unrelated.md', title: 'Unrelated' },
      ],
    });

    const result = await index.search({ query: 'vitest registry' });
    expect(result.hits.map((hit) => hit.path)).toEqual(['source/guides/testing.md', 'source/guides/setup.md']);
    expect(result.hits[0]).toMatchObject({
      packageId: OWNER.packageId,
      collectionId: 'docs',
      collectionTitle: 'Awesome docs',
      title: 'Testing',
    });
    expect(result.hits[0]?.snippet).toContain('vitest');
    expect(result.truncated).toBe(false);

    // A title or path match counts even when the text has nothing.
    const byTitle = await index.search({ query: 'unrelated' });
    expect(byTitle.hits.map((hit) => hit.path)).toEqual(['source/notes/unrelated.md']);
  });

  it('caps the number of hits and says when more matched', async () => {
    const files: Record<string, string> = {};
    const list = Array.from({ length: 30 }, (_, index) => {
      files[`source/d${index}.md`] = 'alpha';
      return { path: `source/d${index}.md`, title: `Doc ${index}` };
    });
    const index = createKnowledgeIndex({ readText: documents(files) });
    await index.replaceCollection(OWNER, { title: 'Many', documents: list });

    expect((await index.search({ query: 'alpha' })).hits).toHaveLength(5);
    const wide = await index.search({ query: 'alpha', limit: 500 });
    expect(wide.hits).toHaveLength(20);
    expect(wide.truncated).toBe(true);
    expect((await index.search({ query: 'alpha', limit: 0 })).hits).toHaveLength(1);
  });

  it('reads only text-like files, clips what it reads, and ignores a reader that fails', async () => {
    const readText = vi.fn<KnowledgeTextReader>(async (_owner, documentPath) => {
      if (documentPath === 'source/broken.md') throw new Error('disk error');
      if (documentPath === 'source/big.md') return `${'x'.repeat(MAX_READ_CHARS)}needle`;
      return 'needle';
    });
    const index = createKnowledgeIndex({ readText });
    await index.replaceCollection(OWNER, {
      title: 'Mixed',
      documents: [
        { path: 'source/broken.md', title: 'Broken' },
        { path: 'source/big.md', title: 'Big' },
        { path: 'source/picture.png', title: 'Picture' },
        { path: 'source/ok.txt', title: 'Ok' },
      ],
    });
    const result = await index.search({ query: 'needle' });
    expect(result.hits.map((hit) => hit.path)).toEqual(['source/ok.txt']);
    // A binary-looking file is never read; a document past the cap is not searched beyond it.
    expect(readText.mock.calls.map(([, documentPath]) => documentPath)).not.toContain('source/picture.png');
  });

  it('looks at no more than the scan limit and reports it', async () => {
    const readText = vi.fn<KnowledgeTextReader>(async () => 'term');
    const index = createKnowledgeIndex({ readText });
    // 200 documents per collection at most: use several collections.
    for (let collection = 0; collection < 6; collection += 1) {
      // oxlint-disable-next-line no-await-in-loop -- build the index in order
      await index.replaceCollection(
        { packageId: OWNER.packageId, collectionId: `c${collection}` },
        {
          title: `C${collection}`,
          documents: Array.from({ length: 200 }, (_, item) => ({ path: `source/${item}.md`, title: `T${item}` })),
        }
      );
    }
    const result = await index.search({ query: 'term', limit: 1 });
    expect(result.scanned).toBe(MAX_SCANNED_DOCUMENTS);
    expect(result.truncated).toBe(true);
    expect(readText).toHaveBeenCalledTimes(MAX_SCANNED_DOCUMENTS);
  });

  it('answers nothing for a query without words, and can be limited to one package', async () => {
    const index = createKnowledgeIndex({ readText: documents({ 'source/a.md': 'shared word' }) });
    await index.replaceCollection(OWNER, { title: 'A', documents: [{ path: 'source/a.md', title: 'A' }] });
    await index.replaceCollection(
      { packageId: 'com.other.pkg', collectionId: 'docs' },
      { title: 'B', documents: [{ path: 'source/a.md', title: 'A' }] }
    );
    expect(await index.search({ query: 'a ! ?' })).toEqual({ hits: [], scanned: 0, truncated: false });
    expect((await index.search({ query: 'shared' })).hits).toHaveLength(2);
    const one = await index.search({ query: 'shared', packageId: 'com.other.pkg' });
    expect(one.hits.map((hit) => hit.packageId)).toEqual(['com.other.pkg']);
  });

  it('stops when the search is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const readText = documents({ 'source/a.md': 'word' });
    const index = createKnowledgeIndex({ readText });
    await index.replaceCollection(OWNER, { title: 'A', documents: [{ path: 'source/a.md', title: 'A' }] });
    expect((await index.search({ query: 'word', signal: controller.signal })).hits).toEqual([]);
    expect(readText).not.toHaveBeenCalled();
  });

  it('turns a query into a few lower-case words of any script', () => {
    expect(tokenizeQuery('  Vitest, REGISTRY! vitest tài liệu 2026 a ')).toEqual([
      'vitest',
      'registry',
      'tài',
      'liệu',
      '2026',
    ]);
    expect(tokenizeQuery('one two three four five six seven eight nine ten')).toHaveLength(8);
  });
});

describe('knowledge index: collections', () => {
  it('replaces, removes by collection and by package, and removing twice is fine', async () => {
    const index = createKnowledgeIndex({ readText: documents({}) });
    await index.replaceCollection(OWNER, { title: 'A', documents: [{ path: 'source/a.md', title: 'A' }] });
    await index.replaceCollection(OWNER, { title: 'A2', documents: [{ path: 'source/b.md', title: 'B' }] });
    await index.replaceCollection(
      { packageId: OWNER.packageId, collectionId: 'more' },
      { title: 'More', documents: [{ path: 'source/c.md', title: 'C' }] }
    );
    expect((await index.collections()).map((collection) => [collection.collectionId, collection.title])).toEqual([
      ['docs', 'A2'],
      ['more', 'More'],
    ]);

    await index.removeCollection(OWNER);
    await index.removeCollection(OWNER);
    expect((await index.collections()).map((collection) => collection.collectionId)).toEqual(['more']);
    await index.removePackage(OWNER.packageId);
    await index.removePackage(OWNER.packageId);
    expect(await index.collections()).toEqual([]);
  });

  it('refuses an invalid owner and drops documents with unsafe paths', async () => {
    const index = createKnowledgeIndex({ readText: documents({}) });
    await expect(
      index.replaceCollection({ packageId: '../x', collectionId: 'docs' }, { title: 'x', documents: [] })
    ).rejects.toThrow(RangeError);
    await index.replaceCollection(OWNER, {
      title: 'A',
      documents: [
        { path: 'source/ok.md', title: 'Ok' },
        { path: '../escape.md', title: 'Escape' },
        { path: '/abs.md', title: 'Abs' },
        { path: 'source\\win.md', title: 'Win' },
        { path: 'source/ok.md', title: 'Duplicate' },
      ],
    });
    expect((await index.collections())[0]?.documents).toEqual([{ path: 'source/ok.md', title: 'Ok' }]);
  });

  it('keeps paths and titles only in its file, survives a restart, and reads a damaged file as empty', async () => {
    const file = await tempFile();
    const first = createKnowledgeIndex({ readText: documents({ 'source/a.md': 'SECRET BODY TEXT' }), file });
    await first.replaceCollection(OWNER, { title: 'A', documents: [{ path: 'source/a.md', title: 'A' }] });
    const saved = await readFile(file, 'utf8');
    expect(saved).toContain('source/a.md');
    expect(saved).not.toContain('SECRET BODY TEXT');

    const second = createKnowledgeIndex({ readText: documents({}), file });
    expect((await second.collections()).map((collection) => collection.collectionId)).toEqual(['docs']);

    await writeFile(file, '{ not json');
    expect(await createKnowledgeIndex({ readText: documents({}), file }).collections()).toEqual([]);
    await writeFile(file, JSON.stringify({ schemaVersion: 2, collections: [] }));
    expect(await createKnowledgeIndex({ readText: documents({}), file }).collections()).toEqual([]);
  });

  it('puts the previous state back when the file cannot be written', async () => {
    const write = vi.fn<(value: unknown) => Promise<void>>().mockRejectedValue(new Error('read-only disk'));
    const index = createKnowledgeIndex({
      readText: documents({}),
      jsonFile: { read: async () => undefined, write },
    });
    await expect(
      index.replaceCollection(OWNER, { title: 'A', documents: [{ path: 'source/a.md', title: 'A' }] })
    ).rejects.toThrow('read-only disk');
    expect(await index.collections()).toEqual([]);
  });
});
