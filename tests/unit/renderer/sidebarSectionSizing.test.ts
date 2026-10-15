import { describe, expect, it } from 'vitest';
import { resizeSidebarSections } from '@/renderer/pages/guid/HubHome/sidebarSectionSizing';

describe('resizeSidebarSections', () => {
  const minimums = { tomny: 120, apps: 112, workspaces: 160 };

  it('clamps the upper divider at Apps minimum without shrinking Workspaces', () => {
    expect(resizeSidebarSections({ tomny: 200, apps: 112, workspaces: 300 }, 'tomny-apps', 80, minimums)).toEqual({
      tomny: 200,
      apps: 112,
      workspaces: 300,
    });
  });

  it('clamps the upper divider at Tomny minimum without growing from Workspaces', () => {
    expect(resizeSidebarSections({ tomny: 120, apps: 200, workspaces: 300 }, 'tomny-apps', -80, minimums)).toEqual({
      tomny: 120,
      apps: 200,
      workspaces: 300,
    });
  });

  it('clamps the lower divider at Workspaces minimum without shrinking Tomny', () => {
    expect(resizeSidebarSections({ tomny: 260, apps: 200, workspaces: 160 }, 'apps-workspaces', 80, minimums)).toEqual({
      tomny: 260,
      apps: 200,
      workspaces: 160,
    });
  });

  it('clamps the lower divider at Apps minimum without growing from Tomny', () => {
    expect(resizeSidebarSections({ tomny: 260, apps: 112, workspaces: 200 }, 'apps-workspaces', -80, minimums)).toEqual({
      tomny: 260,
      apps: 112,
      workspaces: 200,
    });
  });

  it('transfers height only across the dragged adjacent divider', () => {
    const upper = resizeSidebarSections({ tomny: 200, apps: 200, workspaces: 300 }, 'tomny-apps', 48, minimums);
    const lower = resizeSidebarSections({ tomny: 200, apps: 200, workspaces: 300 }, 'apps-workspaces', -48, minimums);

    expect(upper).toEqual({ tomny: 248, apps: 152, workspaces: 300 });
    expect(lower).toEqual({ tomny: 200, apps: 152, workspaces: 348 });
  });

    it('clamps the recipient at its content maximum while leaving the third section alone', () => {
    const maximums = { tomny: 230, apps: 180 };
    expect(resizeSidebarSections({ tomny: 200, apps: 170, workspaces: 300 }, 'tomny-apps', 100, minimums, maximums))
            .toEqual({ tomny: 230, apps: 140, workspaces: 300 });
    expect(resizeSidebarSections({ tomny: 200, apps: 170, workspaces: 300 }, 'apps-workspaces', 100, minimums, maximums))
      .toEqual({ tomny: 200, apps: 180, workspaces: 290 });
  });

  it('keeps all sections unchanged when every section is at its minimum', () => {
    const minimumHeights = { tomny: 120, apps: 112, workspaces: 160 };

    expect(resizeSidebarSections(minimumHeights, 'tomny-apps', 48, minimums)).toEqual(minimumHeights);
    expect(resizeSidebarSections(minimumHeights, 'apps-workspaces', -48, minimums)).toEqual(minimumHeights);
  });
});
