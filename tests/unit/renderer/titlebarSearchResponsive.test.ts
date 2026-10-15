import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('titlebar search responsiveness', () => {
  it('lets the page search shrink before titlebar controls overlap it', async () => {
    const [titlebarCss, homeCss] = await Promise.all([
      readFile(
        path.join(process.cwd(), 'packages/desktop/src/renderer/components/layout/Titlebar/titlebar.css'),
        'utf8'
      ),
      readFile(path.join(process.cwd(), 'packages/desktop/src/renderer/styles/tomni-ui.css'), 'utf8'),
    ]);
    const css = `${titlebarCss}\n${homeCss}`;

    expect(css).toMatch(/\.app-titlebar__search-container--page\s*\{[\s\S]*?flex:\s*1\s+1\s+0;/);
    expect(css).toMatch(/\.app-titlebar__search-container--page\s*\{[\s\S]*?width:\s*min\(360px,\s*100%\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*1280px\)[\s\S]*?\.app-titlebar__search-container--page\s*\{[\s\S]*?width:\s*min\(280px,\s*100%\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.app-titlebar__search-container--page\s*\{[\s\S]*?width:\s*min\(180px,\s*100%\);/);
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.app-titlebar--desktop:not\(\.app-titlebar--mac\)\s*\{[\s\S]*?padding-left:\s*12px;/);
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.app-titlebar__button\s*\{[\s\S]*?width:\s*32px;[\s\S]*?height:\s*32px;/);
    expect(css).toMatch(/\.app-titlebar--home\s*\{[\s\S]*?--titlebar-height:\s*36px;/);
    expect(css).toMatch(/\.app-titlebar--home\.app-titlebar--desktop:not\(\.app-titlebar--mac\)\s*\{[\s\S]*?height:\s*var\(--titlebar-height\);[\s\S]*?min-height:\s*var\(--titlebar-height\);/);
        expect(css).toContain('left: calc(var(--titlebar-menu-w, 120px) + (100% - var(--titlebar-menu-w, 120px) - var(--titlebar-toolbar-w, 284px)) / 2);');
    expect(css).toContain('max-width: max(0px, calc(100% - var(--titlebar-menu-w, 120px) - var(--titlebar-toolbar-w, 284px) - 28px));');
    expect(css).toMatch(/\.app-titlebar--home\s+\.app-titlebar__toolbar,[\s\S]*?\.app-titlebar--home\s+\.app-titlebar__menu\s*\{[\s\S]*?height:\s*var\(--titlebar-height\);/);
    expect(css).toMatch(/@media\s*\(min-width:\s*1281px\)[\s\S]*?\.app-titlebar--home\s+\.app-titlebar__search-container\s*\{[\s\S]*?width:\s*clamp\(420px,\s*38vw,\s*760px\);/);
    expect(css).toMatch(/@media\s*\(min-width:\s*1281px\)[\s\S]*?\.app-titlebar--home\s+\.app-titlebar__omni-search-btn\s*\{[\s\S]*?height:\s*30px;/);
    expect(css).toMatch(/\.app-titlebar--home\s+\.app-window-controls__button\s*\{[\s\S]*?height:\s*var\(--titlebar-height\);/);
  });
});
