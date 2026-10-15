import { describe, expect, it } from 'vitest';
import {
  isValidAlias,
  parseSuperQuery,
  resolveAliasMap,
} from '@/renderer/components/layout/SuperSearch/engine/aliases';

const ALIASES = { local: 'l', web: 'w', facebook: 'fb', x: 'x', youtube: 'yt' } as const;

describe('parseSuperQuery', () => {
  it('routes `alias: text` to the matching source', () => {
    expect(parseSuperQuery('fb: abc', ALIASES)).toEqual({ scope: 'facebook', text: 'abc', alias: 'fb' });
  });

  it('tolerates spaces around the colon and any case', () => {
    expect(parseSuperQuery('  FB : hello world ', ALIASES)).toEqual({
      scope: 'facebook',
      text: 'hello world',
      alias: 'fb',
    });
    expect(parseSuperQuery('yt:cats', ALIASES).scope).toBe('youtube');
  });

  it('accepts the full source id as an alias too', () => {
    expect(parseSuperQuery('facebook: abc', ALIASES).scope).toBe('facebook');
  });

  it('keeps an empty text when only the prefix was typed', () => {
    expect(parseSuperQuery('x:', ALIASES)).toEqual({ scope: 'x', text: '', alias: 'x' });
  });

  it('supports the reserved `all` scope', () => {
    expect(parseSuperQuery('all: foo', ALIASES)).toEqual({ scope: 'all', text: 'foo', alias: 'all' });
  });

  it('searches everything when there is no known prefix', () => {
    expect(parseSuperQuery('abc', ALIASES)).toEqual({ scope: 'all', text: 'abc', alias: null });
    expect(parseSuperQuery('unknown: abc', ALIASES)).toEqual({ scope: 'all', text: 'unknown: abc', alias: null });
    expect(parseSuperQuery('10:30 meeting', ALIASES).scope).toBe('all');
    expect(parseSuperQuery('https://example.com', ALIASES).scope).toBe('all');
  });
});

describe('isValidAlias', () => {
  it('accepts short lowercase slugs only', () => {
    expect(isValidAlias('fb')).toBe(true);
    expect(isValidAlias('my-src_1')).toBe(true);
    expect(isValidAlias('')).toBe(false);
    expect(isValidAlias('has space')).toBe(false);
    expect(isValidAlias('a:b')).toBe(false);
    expect(isValidAlias('waytoolongalias')).toBe(false);
  });
});

describe('resolveAliasMap', () => {
  it('applies valid, normalised overrides', () => {
    expect(resolveAliasMap(ALIASES, { facebook: ' FaceB ' }).facebook).toBe('faceb');
  });

  it('falls back to the default for invalid, reserved or duplicate overrides', () => {
    const resolved = resolveAliasMap(ALIASES, { facebook: 'all', x: 'bad alias', youtube: 'fb', web: 'fb' });
    expect(resolved.facebook).toBe('fb');
    expect(resolved.x).toBe('x');
    expect(resolved.youtube).toBe('yt');
    expect(resolved.web).toBe('w');
  });

  it('ignores overrides for unknown sources', () => {
    expect(resolveAliasMap(ALIASES, { ghost: 'gg' })).toEqual(ALIASES);
  });
});
