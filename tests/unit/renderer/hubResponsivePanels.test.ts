import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('responsive Hub panels', () => {
  it('keeps the rail renderable after a user opens it in a narrow window', async () => {
    const css = await readFile(path.join(process.cwd(), 'packages/desktop/src/renderer/styles/tomni-ui.css'), 'utf8');

    expect(css).toMatch(
      /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.hub-shell:not\(\.hub-shell-rail-collapsed\)\s*\{[\s\S]*?grid-template-columns:\s*var\(--hub-sider-w,\s*0px\)\s+minmax\(0,\s*1fr\)\s+var\(--hub-rail-w,\s*300px\);/
    );
    expect(css).not.toMatch(/@media\s*\(max-width:\s*1100px\)[\s\S]*?\.hub-rail\s*\{\s*display:\s*none;/);
  });
});
