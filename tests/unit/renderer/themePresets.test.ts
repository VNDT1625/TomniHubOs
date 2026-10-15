import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve('packages/desktop/src/renderer/pages/settings/DisplaySettings/presets');
const read = (file: string): string => readFileSync(path.join(dir, file), 'utf8');

/** Variables declared inside the first block whose selector is exactly `selector`. */
const variables = (css: string, selector: string): Record<string, string> => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return {};
  const end = css.indexOf('}', start);
  const body = css.slice(start, end);
  const found: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)) found[match[1]] = match[2].trim();
  return found;
};

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
/** WCAG contrast ratio between two #rrggbb colours. */
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const REQUIRED = [
  '--color-primary',
  '--primary',
  '--bg-1',
  '--bg-2',
  '--bg-3',
  '--bg-base',
  '--text-primary',
  '--color-text-1',
  '--color-text-2',
  '--color-border',
  '--success',
  '--warning',
  '--danger',
  '--message-user-bg',
];

describe.each([
  ['editorial-workspace.css', 'Editorial Workspace'],
  ['cyber-telemetry.css', 'Cyber Telemetry'],
])('the %s preset', (file) => {
  const css = read(file);

  it.each([':root', "[data-theme='dark']"])('sets every required colour in %s', (selector) => {
    const set = variables(css, selector);
    for (const name of REQUIRED) expect(set[name], `${selector} ${name}`).toMatch(/^(#[0-9a-f]{6}|rgba?\()/iu);
  });

  it.each([':root', "[data-theme='dark']"])('keeps text readable on its backgrounds in %s', (selector) => {
    const set = variables(css, selector);
    for (const background of ['--bg-1', '--bg-2', '--bg-base', '--message-user-bg']) {
      expect(contrast(set['--text-primary'], set[background])).toBeGreaterThanOrEqual(7);
      expect(contrast(set['--color-text-2'], set[background])).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(set['--color-primary'], set['--bg-base'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(set['--danger'], set['--bg-1'])).toBeGreaterThanOrEqual(3);
  });

  it('keeps the light and dark palettes apart', () => {
    expect(variables(css, ':root')['--bg-1']).not.toBe(variables(css, "[data-theme='dark']")['--bg-1']);
    expect(luminance(variables(css, ':root')['--bg-1'])).toBeGreaterThan(0.5);
    expect(luminance(variables(css, "[data-theme='dark']")['--bg-1'])).toBeLessThan(0.1);
  });

  it('does not reach into component layout', () => {
    expect(css).not.toMatch(/position\s*:|display\s*:|width\s*:|height\s*:|margin\s*:|padding\s*:/u);
    expect(css).not.toContain('!important');
  });
});

describe('the preset list', () => {
  it('offers both themes next to the others', () => {
    const source = readFileSync(path.join(dir, '..', 'presets.ts'), 'utf8');
    expect(source).toContain("id: 'editorial-workspace'");
    expect(source).toContain("id: 'cyber-telemetry'");
    expect(source).toContain("from './presets/editorial-workspace.css?raw'");
    expect(source).toContain("from './presets/cyber-telemetry.css?raw'");
  });
});
