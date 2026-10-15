import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readTomniUi = (): string =>
  readFileSync(resolve(process.cwd(), 'packages/desktop/src/renderer/styles/tomni-ui.css'), 'utf8');

describe('Hub responsive footer styling', () => {
  it('lowers persistent footer controls when the responsive rail is hidden', () => {
    expect(readTomniUi()).toMatch(
      /@media \(max-width: 1100px\) \{[\s\S]*?\.hub-shell \.hub-statusbar \{\s*transform: translateY\(5px\);\s*\}/
    );
  });
});
