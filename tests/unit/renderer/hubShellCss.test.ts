import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve('packages/desktop/src/renderer/styles/tomni-ui.css'), 'utf8').replaceAll(
  '\r\n',
  '\n'
);

describe('Hub shell layout rules', () => {
  it('hides only the new-chat input bar when Chat is toggled, never the centre of the Hub', () => {
    expect(css).not.toMatch(/\.hub-shell-chat-hidden\s+\.hub-main\s*\{/u);
    expect(css).toMatch(
      /\.hub-shell-chat-hidden\s+\.hub-composer,\s*\.hub-shell-chat-hidden\s+\.hub-composer-context\s*\{\s*display:\s*none;/u
    );
  });

  it('keeps the Home composer dock within the centre at every responsive width', () => {
    expect(css).toMatch(/\.hub-main--home\s*\{\s*overflow:\s*hidden;\s*\}/u);
    expect(css).toMatch(
      /\.hub-home-center\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto\s+auto;[\s\S]*?overflow:\s*hidden;/u
    );
    expect(css).toMatch(
      /\.hub-composer\s*,\s*\.hub-suggest-row\s*\{[\s\S]*?max-width:\s*852px;[\s\S]*?margin-right:\s*auto;[\s\S]*?margin-left:\s*auto;[\s\S]*?\.hub-composer \.guid-input-card-shell\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100% !important;/u
    );
  });

    it('uses opaque slash suggestions instead of translucent glass over conversation text', () => {
    expect(css).toMatch(/\.hub-composer \.hub-composer-suggestion-menu > div\s*\{[^}]*background:\s*#1b1d21\s*!important;/u);
    expect(css).toMatch(/\[data-theme='light'\] \.hub-composer \.hub-composer-suggestion-menu > div\s*\{[^}]*background:\s*#f5f5f3\s*!important;/u);
  });

  it('keeps the compact address bar for small windows and grows it on wide ones', () => {
    expect(css).toMatch(/@media \(max-width: 1280px\)[\s\S]*?clamp\(180px, 30vw, 360px\)/u);
    expect(css).toMatch(
      /@media \(min-width: 1281px\)\s*\{\s*\.app-titlebar--home \.app-titlebar__search-container\s*\{\s*width:\s*clamp\(420px, 38vw, 760px\)/u
    );
    expect(css).toMatch(
      /@media \(min-width: 1700px\)\s*\{\s*\.app-titlebar--home \.app-titlebar__search-container\s*\{\s*width:\s*clamp\(560px, 42vw, 820px\)/u
    );
  });
});
