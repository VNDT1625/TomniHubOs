import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const generator = require('../../../scripts/generate-i18n-types.js') as { collectReferenceKeys: () => string[] };
describe('Social i18n type generation boundary', () => {
  it('keeps typed key declarations exactly aligned with reference locale modules', () => {
    const actual = readFileSync('packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts', 'utf8');
    const union = actual.match(/export type I18nKey =([\s\S]*?);/);
    expect(union).not.toBeNull();
    const actualKeys = new Set([...union![1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    const expectedKeys = new Set(generator.collectReferenceKeys());
    const missing = [...expectedKeys].filter((key) => !actualKeys.has(key));
    const extra = [...actualKeys].filter((key) => !expectedKeys.has(key));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });
});
