import { describe, expect, it } from 'vitest';
import { parseExplorerReferencePayload } from '@/common/chat/workspaceReference';

describe('parseExplorerReferencePayload', () => {
  it('normalizes unique workspace-relative paths', () => {
    expect(parseExplorerReferencePayload('["src\\\\a.ts", "docs/readme.md", "src/a.ts"]')).toEqual([
      'src/a.ts',
      'docs/readme.md',
    ]);
  });

  it.each([
    '["../secret.txt"]',
    '["C:\\\\outside.txt"]',
    '["/outside.txt"]',
    '{"path":"src/a.ts"}',
    '[1]',
  ])('rejects unsafe Explorer payload %s', (payload) => {
    expect(parseExplorerReferencePayload(payload)).toEqual([]);
  });
});
