export type SidebarSectionName = 'tomny' | 'apps' | 'workspaces';

export type SidebarSectionHeights = Record<SidebarSectionName, number>;

export type SidebarSectionMinimums = SidebarSectionHeights;
export type SidebarSectionMaximums = Partial<SidebarSectionHeights>;

export type SidebarSplitter = 'tomny-apps' | 'apps-workspaces';

/** Transfers height only between the two sections adjacent to the dragged divider. */
const transfer = (
  heights: SidebarSectionHeights,
  donor: SidebarSectionName,
  recipient: SidebarSectionName,
    requested: number,
  minimums: SidebarSectionMinimums,
  maximums: SidebarSectionMaximums
): void => {
  const room = Math.max(0, (maximums[recipient] ?? Number.POSITIVE_INFINITY) - heights[recipient]);
  const transferred = Math.min(requested, Math.max(0, heights[donor] - minimums[donor]), room);
  heights[donor] -= transferred;
  heights[recipient] += transferred;
};

/**
 * Redistributes the fixed sidebar body height across Tomny, Apps and Workspaces.
 * A divider clamps once its adjacent donor reaches its minimum; the third panel
 * is never resized as a side effect of a drag.
 */
export const resizeSidebarSections = (
  current: SidebarSectionHeights,
  splitter: SidebarSplitter,
  delta: number,
    minimums: SidebarSectionMinimums,
  maximums: SidebarSectionMaximums = {}
): SidebarSectionHeights => {
  const heights = { ...current };
  if (delta === 0) return heights;

  if (splitter === 'tomny-apps') {
    if (delta > 0) transfer(heights, 'apps', 'tomny', delta, minimums, maximums);
    else transfer(heights, 'tomny', 'apps', -delta, minimums, maximums);
  } else if (delta > 0) {
    transfer(heights, 'workspaces', 'apps', delta, minimums, maximums);
  } else {
    transfer(heights, 'apps', 'workspaces', -delta, minimums, maximums);
  }

  return heights;
};
