import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'packages/desktop/src/renderer/styles/tomni-ui.css'),
  'utf8'
).replaceAll('\r\n', '\n');

describe('Hub app launcher styling', () => {
  it('keeps launcher tiles on design-system tokens with high-contrast icons', () => {
    // Tile uses the dark card token; the icon always renders in level-1 foreground.
    expect(css).toMatch(
      /\.hub-launcher-app-icon\s*\{[\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*0\.06\);[\s\S]*?color:\s*#fafbfc;/u
    );
    // Light theme mirrors the token table (light card + dark foreground).
    expect(css).toMatch(
      /\[data-theme='light'\]\s*\.hub-launcher-app-icon\s*\{[\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*0\.38\);[\s\S]*?color:\s*#0a0b0d;/u
    );
  });

  it('dims the window behind the launcher with an explicit scrim', () => {
    expect(css).toMatch(
      /\.hub-launcher \.arco-modal-mask\s*\{[\s\S]*?background(?:-color)?:\s*rgba\(\s*4,\s*6,\s*10,\s*0\.5\d\);/u
    );
  });

  it('keeps hover and focus highlights subtle instead of a solid white ring', () => {
    expect(css).toMatch(/\.hub-launcher-app:hover\s*\{[\s\S]*?border-color:\s*rgba\(255,\s*255,\s*255,\s*0\.2\);/u);
    expect(css).toMatch(
      /\.hub-launcher-app:focus-visible\s*\{[\s\S]*?border-color:\s*rgba\(255,\s*255,\s*255,\s*0\.5\);/u
    );
    expect(css).not.toMatch(/\.hub-launcher-app:focus-visible\s*\{[^}]*border-color:\s*#f8fafc;/u);
  });
});
