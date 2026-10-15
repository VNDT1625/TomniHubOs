import { describe, expect, it } from 'vitest';
import { parseUserscriptHeader } from '@process/integrations/browserExtensions/userscript/header';
import {
  convertPageFilters,
  includeToMatchPattern,
} from '@process/integrations/browserExtensions/userscript/matchConversion';

const plan = (lines: string[]) => {
  const parsed = parseUserscriptHeader(
    ['// ==UserScript==', ...lines.map((l) => `// ${l}`), '// ==/UserScript==', 'x'].join('\n')
  );
  if (parsed.ok === false) throw new Error(parsed.code);
  return convertPageFilters(parsed.header);
};

describe('page filter conversion', () => {
  it('keeps valid @match patterns and drops invalid ones with a note', () => {
    const result = plan(['@match https://a.example/*', '@match ftp://x.example/*', '@match nonsense']);
    expect(result).toMatchObject({ ok: true, plan: { matches: ['https://a.example/*'] } });
    if (result.ok) expect(result.plan.notes.filter((n) => n.code === 'match-dropped')).toHaveLength(2);
  });

  it('converts exact @include globs and drops the ones that are not exact', () => {
    expect(includeToMatchPattern('*')).toBe('<all_urls>');
    expect(includeToMatchPattern('https://example.com/*')).toBe('https://example.com/*');
    expect(includeToMatchPattern('http*://*.example.com/page*')).toBe('*://*.example.com/page*');
    expect(includeToMatchPattern('https://example.com')).toBe('https://example.com/');
    expect(includeToMatchPattern('/^https:\\/\\/a\\.example/')).toBeUndefined();
    expect(includeToMatchPattern('*example.com*')).toBeUndefined();
    expect(includeToMatchPattern('https://www.*.com/*')).toBeUndefined();
    expect(includeToMatchPattern('https://a.example/p?id=*')).toBeUndefined();
    expect(includeToMatchPattern('file:///tmp/x')).toBeUndefined();
  });

  it('refuses a script with nothing usable to match', () => {
    expect(plan(['@name x'])).toMatchObject({ ok: false, code: 'no-match' });
    expect(plan(['@include /regex/'])).toMatchObject({ ok: false, code: 'no-match' });
  });

  it('turns @exclude-match and @exclude globs into exclusions', () => {
    const result = plan([
      '@match *://*/*',
      '@exclude-match https://a.example/admin/*',
      '@exclude https://b.example/*?debug=*',
    ]);
    expect(result).toMatchObject({
      ok: true,
      plan: { excludeMatches: ['https://a.example/admin/*'], excludeGlobs: ['https://b.example/*?debug=*'] },
    });
  });

  it('refuses instead of widening when an exclusion cannot be converted', () => {
    expect(plan(['@match *://*/*', '@exclude /bad.*/'])).toMatchObject({ ok: false, code: 'unsupported-exclude' });
    expect(plan(['@match *://*/*', '@exclude-match gopher://x/*'])).toMatchObject({
      ok: false,
      code: 'unsupported-exclude',
    });
  });

  it('flags a script that runs on every site', () => {
    const result = plan(['@match *://*/*']);
    expect(result.ok && result.plan.notes.some((n) => n.code === 'broad-match')).toBe(true);
  });
});
