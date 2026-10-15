import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readTomniUi = (): string =>
  readFileSync(resolve(process.cwd(), 'packages/desktop/src/renderer/styles/tomni-ui.css'), 'utf8');

describe('Hub sidebar section divider styling', () => {
  it('keeps its chevron unboxed when the divider is hovered', () => {
    const stylesheet = readTomniUi();
    const chevronStart = stylesheet.indexOf('.hub-sider-section-divider svg {');
    const chevronRule = stylesheet.slice(chevronStart, stylesheet.indexOf('}', chevronStart) + 1);
    const hoverStart = stylesheet.indexOf('.hub-sider-section-divider:hover::before');
    const hoverRule = stylesheet.slice(hoverStart, stylesheet.indexOf('}', hoverStart) + 1);

    expect(chevronRule).not.toContain('padding:');
    expect(chevronRule).not.toContain('background:');
    expect(hoverRule).toBe('');
  });
});
