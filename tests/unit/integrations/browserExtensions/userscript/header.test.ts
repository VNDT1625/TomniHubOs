import { describe, expect, it } from 'vitest';
import { parseUserscriptHeader } from '@process/integrations/browserExtensions/userscript/header';
import { USERSCRIPT_LIMITS } from '@process/integrations/browserExtensions/userscript/types';

const script = (lines: string[], body = 'console.log(1);'): string =>
  ['// ==UserScript==', ...lines.map((line) => `// ${line}`), '// ==/UserScript==', body].join('\n');

const header = (source: string) => {
  const result = parseUserscriptHeader(source);
  if (result.ok === false) throw new Error(`unexpected failure ${result.code}`);
  return result.header;
};

describe('userscript header parsing', () => {
  it('reads every supported key', () => {
    const parsed = header(
      script([
        '@name        Demo',
        '@namespace   https://example.org/ns',
        '@version     1.2.3',
        '@description Does a thing',
        '@match       https://a.example/*',
        '@include     https://b.example/*',
        '@exclude     https://a.example/private/*',
        '@exclude-match https://a.example/admin/*',
        '@run-at      document-start',
        '@grant       GM_getValue GM_setValue',
        '@grant       GM_log',
        '@require     lib/helper.js',
        '@resource    css styles/a.css',
        '@connect     api.example.com',
        '@noframes',
        '@icon        icon.png',
      ])
    );
    expect(parsed).toMatchObject({
      name: 'Demo',
      namespace: 'https://example.org/ns',
      version: '1.2.3',
      description: 'Does a thing',
      matches: ['https://a.example/*'],
      includes: ['https://b.example/*'],
      excludes: ['https://a.example/private/*'],
      excludeMatches: ['https://a.example/admin/*'],
      runAt: 'document-start',
      grants: ['GM_getValue', 'GM_setValue', 'GM_log'],
      requires: ['lib/helper.js'],
      resources: [{ name: 'css', url: 'styles/a.css' }],
      connects: ['api.example.com'],
      noframes: true,
      icon: 'icon.png',
    });
    expect(parsed.block.startsWith('// ==UserScript==')).toBe(true);
  });

  it('tolerates CRLF, a BOM, odd spacing, unknown keys and localized names', () => {
    const bom = String.fromCharCode(0xfeff);
    const body = [
      '//==UserScript==',
      '  //   @name   Spaced  ',
      '// @name:de Anders',
      '// @unknown x',
      '//@match https://a.example/*',
      '// ==/UserScript==',
      'code();',
    ];
    const source = bom + body.join('\r\n');
    expect(header(source)).toMatchObject({ name: 'Spaced', matches: ['https://a.example/*'] });
  });

  it('keeps the first value of a single-value key and de-duplicates lists', () => {
    const parsed = header(
      script(['@name One', '@name Two', '@match https://a.example/*', '@match https://a.example/*'])
    );
    expect(parsed.name).toBe('One');
    expect(parsed.matches).toEqual(['https://a.example/*']);
  });

  it('treats prototype-like names as plain data', () => {
    const parsed = header(
      script(['@grant __proto__ constructor', '@resource __proto__ x.css', '@match https://a.example/*'])
    );
    expect(parsed.grants).toEqual(['__proto__', 'constructor']);
    expect(parsed.resources).toEqual([{ name: '__proto__', url: 'x.css' }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('strips control characters from values', () => {
    const dirty = `@name Bad${String.fromCharCode(0)}Name${String.fromCharCode(7)}`;
    expect(header(script([dirty])).name).toBe('BadName');
  });

  it('refuses a missing, unterminated or overlong header', () => {
    expect(parseUserscriptHeader('console.log(1)')).toMatchObject({ ok: false, code: 'no-header' });
    expect(parseUserscriptHeader('')).toMatchObject({ ok: false, code: 'no-header' });
    expect(parseUserscriptHeader('// ==UserScript==\n// @name x\ncode')).toMatchObject({
      ok: false,
      code: 'bad-header',
    });
    expect(parseUserscriptHeader(script([`@name ${'x'.repeat(USERSCRIPT_LIMITS.MAX_LINE_CHARS)}`]))).toMatchObject({
      ok: false,
      code: 'bad-header',
    });
  });

  it('refuses a header that starts too late to be scanned', () => {
    const source = `${'// filler\n'.repeat(10_000)}// ==UserScript==\n// @name x\n// ==/UserScript==\n`;
    expect(parseUserscriptHeader(source)).toMatchObject({ ok: false, code: 'no-header' });
  });

  it('refuses a malformed @resource and too many entries', () => {
    expect(parseUserscriptHeader(script(['@resource lonely']))).toMatchObject({ ok: false, code: 'bad-header' });
    const many = Array.from({ length: USERSCRIPT_LIMITS.MAX_MATCHES + 1 }, (_, i) => `@match https://a${i}.example/*`);
    expect(parseUserscriptHeader(script(many))).toMatchObject({ ok: false, code: 'too-many' });
    const lines = Array.from({ length: USERSCRIPT_LIMITS.MAX_HEADER_LINES + 1 }, () => '@x y');
    expect(parseUserscriptHeader(script(lines))).toMatchObject({ ok: false, code: 'bad-header' });
  });

  it('refuses an input over the size cap', () => {
    const big = script(['@name x'], 'a'.repeat(USERSCRIPT_LIMITS.MAX_SOURCE_CHARS));
    expect(parseUserscriptHeader(big)).toMatchObject({ ok: false, code: 'too-large' });
  });

  it('stays fast on hostile whitespace and long lines', () => {
    const started = Date.now();
    parseUserscriptHeader(script([`@name ${' '.repeat(1_900)}x`, ` ${'\t'.repeat(1_900)}`]));
    parseUserscriptHeader(`// ==UserScript==\n${' '.repeat(60_000)}\n${'//'.repeat(20_000)}`);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
