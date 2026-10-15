import { describe, expect, it } from 'vitest';
import { parseExplorerReferenceEntriesPayload } from '@/common/chat/workspaceReference';

describe('parseExplorerReferenceEntriesPayload', () => {
  it('keeps Explorer-provided file and folder kinds only for normalized paths', () => {
    expect(
      parseExplorerReferenceEntriesPayload(
        '[{"relativePath":"src/a.ts","kind":"file","sessionId":"session-1"},{"relativePath":"docs","kind":"folder"}]'
      )
    ).toEqual([
      { relativePath: 'src/a.ts', kind: 'file', sessionId: 'session-1' },
      { relativePath: 'docs', kind: 'folder' },
    ]);
  });

  it('rejects malformed or unsafe entries', () => {
    expect(parseExplorerReferenceEntriesPayload('[{"relativePath":"../secret","kind":"file"}]')).toEqual([]);
    expect(parseExplorerReferenceEntriesPayload('[{"relativePath":"docs","kind":"other"}]')).toEqual([]);
  });
});
