import { describe, expect, it } from 'vitest';
import { buildStudioLiveSessions } from '@package-apps/document-studio/renderer/studio/liveSessions';

describe('buildStudioLiveSessions', () => {
  it('maps each open file to an idle session titled by its basename', () => {
    const win = String.raw`C:\docs\Report.docx`;
    expect(buildStudioLiveSessions([win, '/home/u/budget.xlsx'])).toEqual([
      { id: win, title: 'Report.docx', status: 'idle', detail: String.raw`C:\docs` },
      { id: '/home/u/budget.xlsx', title: 'budget.xlsx', status: 'idle', detail: '/home/u' },
    ]);
  });

  it('returns nothing for no or invalid files and dedupes', () => {
    expect(buildStudioLiveSessions([])).toEqual([]);
    expect(buildStudioLiveSessions(['', 'a.txt', 'a.txt']).map((s) => s.id)).toEqual(['a.txt']);
  });
});
