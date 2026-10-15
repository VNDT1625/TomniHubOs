import { describe, expect, it } from 'vitest';
import { projectWorkspaceReferences } from '@/process/services/database/nativeConversation/workspaceReferenceProjection';

describe('projectWorkspaceReferences', () => {
  it('inlines one small text file inside the 5,000 token budget', async () => {
    const result = await projectWorkspaceReferences({
      workspaceRoot: '/repo',
      references: [{ relativePath: 'docs/readme.md', kind: 'file' }],
      resolve: async () => ({
        kind: 'file',
        relativePath: 'docs/readme.md',
        text: 'hello from the readme',
        sizeBytes: 21,
        summary: undefined,
        freshness: 'fresh',
      }),
    });

    expect(result.promptSection).toContain('docs/readme.md');
    expect(result.promptSection).toContain('hello from the readme');
    expect(result.promptSection).toContain('inline full text');
    expect(result.promptSection).toContain('already been provided in this turn');
    expect(result.renderable[0]?.projectionStatus).toBe('inline');
  });

  it('inlines a small canonical file even without Understanding metadata', async () => {
    const result = await projectWorkspaceReferences({
      workspaceRoot: '/repo',
      references: [{ relativePath: 'installed.json', kind: 'file' }],
      resolve: async () => ({
        kind: 'file',
        relativePath: 'installed.json',
        sizeBytes: 34,
        text: '{"schemaVersion":1,"packages":[]}',
        freshness: 'missing',
      }),
    });
    expect(result.renderable[0]?.projectionStatus).toBe('inline');
    expect(result.promptSection).toContain('"packages":[]');
  });

  it('provides the Main-verified absolute path for a single oversized file, not its summary', async () => {
    const large = 'a'.repeat(20_004);
    const canonical = 'C:\\work\\project\\docs\\long.md';
    const result = await projectWorkspaceReferences({
      workspaceRoot: 'C:\\work\\project',
      references: [{ relativePath: 'docs/long.md', kind: 'file' }],
      resolve: async () => ({
        kind: 'file',
        relativePath: 'docs/long.md',
        absolutePath: canonical,
        sizeBytes: large.length,
        text: large,
        summary: 'Cached summary',
        freshness: 'fresh',
      }),
    });
    expect(result.renderable[0]?.projectionStatus).toBe('path-only');
    expect(result.needsReadTools).toBe(true);
    expect(result.promptSection).toContain(JSON.stringify(canonical));
    expect(result.promptSection).toContain('call tomny_read directly');
    expect(result.promptSection).not.toContain('Prefer ONE workflow_run call');
    expect(result.promptSection).not.toContain(large);
    expect(result.promptSection).not.toContain('Cached summary');
  });

  it('inlines multiple small files when their TOTAL fits 5,000 tokens', async () => {
    const result = await projectWorkspaceReferences({
      workspaceRoot: '/repo',
      references: [
        { relativePath: 'a.txt', kind: 'file' },
        { relativePath: 'b.txt', kind: 'file' },
      ],
      resolve: async (reference) => ({
        kind: 'file',
        relativePath: reference.relativePath,
        sizeBytes: 4_004,
        text: reference.relativePath + 'x'.repeat(4_000),
        freshness: 'missing',
      }),
    });
    expect(result.renderable.map((item) => item.projectionStatus)).toEqual(['inline', 'inline']);
    expect(result.needsReadTools).toBe(false);
    expect(result.promptSection).not.toContain('Prefer ONE workflow_run call');
  });

  it('sends only canonical file paths for ALL files when their combined size exceeds the budget', async () => {
    const result = await projectWorkspaceReferences({
      workspaceRoot: '/repo',
      references: [
        { relativePath: 'a.txt', kind: 'file' },
        { relativePath: 'b.txt', kind: 'file' },
      ],
      resolve: async (reference) => ({
        kind: 'file',
        relativePath: reference.relativePath,
        absolutePath: `/repo/${reference.relativePath}`,
        sizeBytes: 12_000,
        text: 'x'.repeat(12_000),
        freshness: 'fresh',
      }),
    });
    expect(result.renderable.map((item) => item.projectionStatus)).toEqual(['path-only', 'path-only']);
    expect(result.promptSection).toContain('/repo/a.txt');
    expect(result.promptSection).toContain('/repo/b.txt');
    expect(result.needsReadTools).toBe(true);
    expect(result.promptSection).toContain('Prefer ONE workflow_run with independent tomny_read steps');
    expect(result.promptSection).toContain('do not call ToolSearch');
    expect(result.promptSection).toContain('"id":"read_1"');
    expect(result.promptSection).toContain('"id":"read_2"');
    expect(result.promptSection).toContain('"filePath":"/repo/a.txt"');
    expect(result.promptSection).toContain('"filePath":"/repo/b.txt"');
  });

  it('uses folder Understanding summary without raw folder content', async () => {
    const result = await projectWorkspaceReferences({
      workspaceRoot: '/repo',
      references: [{ relativePath: 'packages', kind: 'folder' }],
      resolve: async () => ({
        kind: 'folder',
        relativePath: 'packages',
        sizeBytes: 0,
        summary: 'Contains desktop and package applications.',
        freshness: 'fresh',
      }),
    });

    expect(result.promptSection).toContain('Contains desktop and package applications.');
    expect(result.renderable[0]?.projectionStatus).toBe('summary');
  });

  it('does not silently truncate files whose combined token count exceeds 5,000', async () => {
    const result = await projectWorkspaceReferences({
      workspaceRoot: '/repo',
      references: [
        { relativePath: 'a.txt', kind: 'file' },
        { relativePath: 'b.txt', kind: 'file' },
      ],
      resolve: async (reference) => ({
        kind: 'file',
        relativePath: reference.relativePath,
        text: 'x'.repeat(12_004),
        sizeBytes: 12_004,
        summary: undefined,
        freshness: 'fresh',
      }),
    });

    expect(result.promptSection).not.toContain('x'.repeat(12_004));
    expect(result.renderable.map((item) => item.projectionStatus)).toEqual(['path-only', 'path-only']);
    expect(result.promptSection).not.toContain('already been provided in this turn');
  });
});
