import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  isInAll,
  isSourceEnabled,
  loadConfig,
  parseConfig,
  saveConfig,
  selectProviders,
} from '@/renderer/components/layout/SuperSearch/engine/config';
import type { SearchProvider, SearchSource } from '@/renderer/components/layout/SuperSearch/engine/types';

const provider = (id: string, over: Partial<SearchSource> = {}): SearchProvider => ({
  source: { id, kind: 'site', label: id, defaultAlias: id, includeInAllByDefault: true, ...over },
  search: async () => [],
});
const memoryStorage = (initial?: string) => {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    value: () => value,
  };
};

describe('parseConfig', () => {
  it('falls back to defaults for anything that is not a valid config', () => {
    expect(parseConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig('nope')).toEqual(DEFAULT_CONFIG);
    expect(parseConfig({ aliases: 5, enabled: [], inAll: null, browserEngine: 7 })).toEqual(DEFAULT_CONFIG);
  });

  it('keeps only well-formed entries', () => {
    const parsed = parseConfig({
      aliases: { facebook: 'FB2', x: 'bad alias', web: 12 },
      enabled: { facebook: false, x: 'yes' },
      inAll: { reddit: true, ghost: 1 },
      browserEngine: 'bing',
    });
    expect(parsed.aliases).toEqual({ facebook: 'fb2' });
    expect(parsed.enabled).toEqual({ facebook: false });
    expect(parsed.inAll).toEqual({ reddit: true });
    expect(parsed.browserEngine).toBe('bing');
  });
});

describe('custom sources', () => {
  it('keeps only valid http(s) templates containing {q}', () => {
    const parsed = parseConfig({
      custom: [
        { id: 'custom-a1', label: 'Maps', alias: 'maps', urlTemplate: 'https://www.google.com/maps/search/{q}' },
        { id: 'custom-a2', label: 'NoQ', alias: 'noq', urlTemplate: 'https://example.com/' },
        { id: 'custom-a3', label: 'Evil', alias: 'evil', urlTemplate: 'javascript:alert({q})' },
        { id: 'bad id', label: 'X', alias: 'xx', urlTemplate: 'https://e.com/?q={q}' },
      ],
    });
    expect(parsed.custom.map((c) => c.id)).toEqual(['custom-a1']);
  });
});

describe('source switches', () => {
  it('enables everything except connected sources until the user opts in', () => {
    expect(isSourceEnabled(provider('a').source, DEFAULT_CONFIG)).toBe(true);
    const connected = provider('mcp:1', { kind: 'connected' }).source;
    expect(isSourceEnabled(connected, DEFAULT_CONFIG)).toBe(false);
    expect(isSourceEnabled(connected, { ...DEFAULT_CONFIG, enabled: { 'mcp:1': true } })).toBe(true);
  });

  it('lets the user override whether a source joins All', () => {
    const site = provider('fb', { includeInAllByDefault: false }).source;
    expect(isInAll(site, DEFAULT_CONFIG)).toBe(false);
    expect(isInAll(site, { ...DEFAULT_CONFIG, inAll: { fb: true } })).toBe(true);
  });
});

describe('selectProviders', () => {
  const providers = [
    provider('local', { kind: 'local' }),
    provider('web', { kind: 'web' }),
    provider('fb', { includeInAllByDefault: false }),
    provider('mcp:1', { kind: 'connected' }),
  ];

  it('All = enabled sources that join All; connected stays off until enabled', () => {
    expect(selectProviders('all', providers, DEFAULT_CONFIG).providers.map((p) => p.source.id)).toEqual([
      'local',
      'web',
    ]);
    const opted = { ...DEFAULT_CONFIG, enabled: { 'mcp:1': true }, inAll: { fb: true } };
    expect(selectProviders('all', providers, opted).providers.map((p) => p.source.id)).toEqual([
      'local',
      'web',
      'fb',
      'mcp:1',
    ]);
  });

  it('a named scope searches only that source, even when it is outside All', () => {
    expect(selectProviders('fb', providers, DEFAULT_CONFIG).providers.map((p) => p.source.id)).toEqual(['fb']);
  });

  it('never queries a disabled source, and says so', () => {
    const result = selectProviders('mcp:1', providers, DEFAULT_CONFIG);
    expect(result.providers).toEqual([]);
    expect(result.disabled).toBe(true);
    const off = { ...DEFAULT_CONFIG, enabled: { web: false } };
    expect(selectProviders('all', providers, off).providers.map((p) => p.source.id)).toEqual(['local']);
  });

  it('an unknown scope selects nothing', () => {
    expect(selectProviders('ghost', providers, DEFAULT_CONFIG)).toEqual({ providers: [], disabled: false });
  });
});

describe('loadConfig / saveConfig', () => {
  it('round-trips through storage and survives corrupt data', () => {
    const storage = memoryStorage();
    saveConfig({ ...DEFAULT_CONFIG, aliases: { web: 'ww' } }, storage);
    expect(loadConfig(storage).aliases).toEqual({ web: 'ww' });
    expect(loadConfig(memoryStorage('{broken'))).toEqual(DEFAULT_CONFIG);
    expect(loadConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it('does not throw when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadConfig(blocked)).toEqual(DEFAULT_CONFIG);
    expect(() => saveConfig(DEFAULT_CONFIG, blocked)).not.toThrow();
  });
});
