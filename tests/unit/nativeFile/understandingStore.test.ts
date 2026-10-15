import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readUnderstandingReference } from '@/process/resources/nativeFile/understandingStore';

describe('readUnderstandingReference', () => {
  it('reads the canonical MTUI-format file summary', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(process.cwd(), '.tmp-understand-'))
    );
    const directory = path.join(root, '.tomni', 'understand');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'summary.json'),
      JSON.stringify({
        files: [{ path: 'src/a.ts', summary: 'A source file.', summarySource: 'mtui-static', fingerprint: 'abc' }],
      })
    );

    await expect(readUnderstandingReference(root, 'src/a.ts')).resolves.toMatchObject({
      summary: 'A source file.',
      summarySource: 'mtui-static',
      freshness: 'fresh',
    });
  });

  it('migrates a legacy cache before reading the canonical summary', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(process.cwd(), '.tmp-understand-'))
    );
    const directory = path.join(root, '.omni', 'understand');
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'summary.json'),
      JSON.stringify({ modules: [{ id: 'docs', summary: 'Legacy docs.' }] })
    );

    await expect(readUnderstandingReference(root, 'docs')).resolves.toMatchObject({
      summary: 'Legacy docs.',
      freshness: 'fresh',
    });
    await expect(
      import('node:fs/promises').then(({ access }) => access(path.join(root, '.tomni', 'understand', 'summary.json')))
    ).resolves.toBeUndefined();
  });

  it('reads canonical Understanding after preserving a conflicting legacy summary', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) =>
      mkdtemp(path.join(process.cwd(), '.tmp-understand-'))
    );
    const canonical = path.join(root, '.tomni', 'understand');
    const legacy = path.join(root, '.omni', 'understand');
    await mkdir(canonical, { recursive: true });
    await mkdir(legacy, { recursive: true });
    await writeFile(
      path.join(canonical, 'summary.json'),
      JSON.stringify({ modules: [{ id: 'docs', summary: 'Canonical docs.' }] })
    );
    await writeFile(
      path.join(legacy, 'summary.json'),
      JSON.stringify({ modules: [{ id: 'docs', summary: 'Legacy docs.' }] })
    );

    await expect(readUnderstandingReference(root, 'docs')).resolves.toMatchObject({
      summary: 'Canonical docs.',
      freshness: 'fresh',
    });
  });
});
