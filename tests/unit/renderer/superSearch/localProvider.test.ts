import { describe, expect, it } from 'vitest';
import {
  createLocalProvider,
  matchScore,
  type LocalEntry,
} from '@/renderer/components/layout/SuperSearch/providers/localProvider';
import { buildLocalEntries } from '@/renderer/components/layout/SuperSearch/providers/localCorpus';

const entry = (id: string, title: string, extra: Partial<LocalEntry> = {}): LocalEntry => ({
  id,
  title,
  keywords: '',
  icon: 'setting',
  action: { kind: 'route', path: `/${id}` },
  ...extra,
});
const ctx = (query: string, limit = 30) => ({ query, limit, signal: new AbortController().signal });

describe('matchScore', () => {
  it('ignores case and Vietnamese diacritics', () => {
    expect(matchScore('cai dat', { title: 'Cài đặt giao diện', keywords: '' })).toBeGreaterThan(0);
    expect(matchScore('DAT', { title: 'Cài đặt', keywords: '' })).toBeGreaterThan(0);
    expect(matchScore('đặt', { title: 'cai dat', keywords: '' })).toBeGreaterThan(0);
  });

  it('requires every word to match somewhere', () => {
    expect(matchScore('theme store', { title: 'Theme', keywords: '' })).toBe(0);
    expect(matchScore('theme dark', { title: 'Theme', keywords: 'dark mode' })).toBeGreaterThan(0);
  });

  it('ranks title prefix above title substring above keywords above subtitle', () => {
    const prefix = matchScore('mod', { title: 'Models', keywords: '' });
    const substring = matchScore('del', { title: 'Models', keywords: '' });
    const keyword = matchScore('mod', { title: 'AI Core', keywords: 'models' });
    const subtitle = matchScore('mod', { title: 'AI Core', subtitle: 'choose models', keywords: '' });
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(keyword);
    expect(keyword).toBeGreaterThan(subtitle);
    expect(subtitle).toBeGreaterThan(0);
  });

  it('never matches an empty query', () => {
    expect(matchScore('   ', { title: 'Anything', keywords: '' })).toBe(0);
  });
});

describe('createLocalProvider', () => {
  const provider = createLocalProvider('Local', () => [
    entry('display', 'Display settings', { keywords: 'theme color' }),
    entry('store', 'Store', { icon: 'app' }),
    entry('privacy', 'Privacy & Security'),
  ]);

  it('is the in-app source that takes part in All', () => {
    expect(provider.source).toMatchObject({
      id: 'local',
      kind: 'local',
      label: 'Local',
      defaultAlias: 'l',
      includeInAllByDefault: true,
    });
  });

  it('returns only matching entries with a positive score and the original action', async () => {
    const hits = await provider.search(ctx('theme'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      sourceId: 'local',
      title: 'Display settings',
      action: { kind: 'route', path: '/display' },
    });
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('does not match on a category label unless the entry opts in', async () => {
    const labelled = createLocalProvider('Local', () => [
      entry('display', 'Display', { subtitle: 'Settings' }),
      entry('app', 'Calculator', { subtitle: 'Settings helper', subtitleSearchable: true }),
    ]);
    const hits = await labelled.search(ctx('settings'));
    expect(hits.map((h) => h.title)).toEqual(['Calculator']);
  });

  it('honours the limit and returns nothing when nothing matches', async () => {
    const many = createLocalProvider('Local', () =>
      Array.from({ length: 50 }, (_, i) => entry(`item-${i}`, `Item ${i}`))
    );
    expect(await many.search(ctx('item', 5))).toHaveLength(5);
    expect(await provider.search(ctx('zzzz'))).toEqual([]);
  });
});

const t = (key: string) => key;

describe('buildLocalEntries', () => {
  const conversations = [{ id: 'c1', name: 'Plan the launch', modified_at: 1 }];
  const entries = buildLocalEntries({
    t,
    conversations,
    apps: [{ id: 'com.tomni.calc', name: 'Calculator', description: 'Math' }],
  });

  it('indexes settings tabs and detailed settings under /settings paths', () => {
    const settings = entries.filter((e) => e.icon === 'setting');
    expect(settings.length).toBeGreaterThan(12);
    expect(settings.every((e) => e.action.kind === 'route' && e.action.path.startsWith('/settings'))).toBe(true);
    expect(settings.some((e) => e.action.kind === 'route' && e.action.path === '/settings/display')).toBe(true);
  });

  it('indexes conversations, pages and apps', () => {
    expect(
      entries.some((e) => e.icon === 'chat' && e.action.kind === 'route' && e.action.path === '/conversation/c1')
    ).toBe(true);
    expect(entries.some((e) => e.action.kind === 'route' && e.action.path === '/store')).toBe(true);
    expect(entries.some((e) => e.icon === 'app')).toBe(true);
  });

  it('gives every entry a unique id and a non-empty title', () => {
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(entries.every((e) => e.title.length > 0)).toBe(true);
  });

  it('keeps unnamed conversations searchable with a fallback title', () => {
    const unnamed = buildLocalEntries({ t, conversations: [{ id: 'c2', name: '', modified_at: 1 }] });
    expect(unnamed.find((e) => e.id === 'conversation:c2')?.title).toBe(
      'common.superSearch.local.untitledConversation'
    );
  });
});
