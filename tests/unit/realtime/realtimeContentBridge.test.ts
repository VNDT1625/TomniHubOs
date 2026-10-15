import { describe, expect, it, vi } from 'vitest';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  REALTIME_ARTICLE_CHANNEL,
  REALTIME_CONTENT_CHANNEL,
  type RealtimeArticleReadResult,
  type RealtimeReadResult,
} from '../../../packages/desktop/src/common/types/platform/realtimeContent';
import {
  readPublicRealtimeSource,
  registerRealtimeContentBridge,
} from '../../../packages/desktop/src/process/services/realtime/realtimeContentBridge';

vi.mock('@process/bridge/foundationBridge', () => ({ foundationTrustedOrigin: () => undefined }));

const fixtureRepo = JSON.stringify({
  items: [
    {
      full_name: 'example/repo',
      html_url: 'https://github.com/example/repo',
      description: 'Real metadata',
      language: 'TypeScript',
      stargazers_count: 180,
    },
  ],
});
const fixtureModel = JSON.stringify([{ id: 'org/model', pipeline_tag: 'text-generation', downloads: 90 }]);
const fetchJson = vi.fn(async () => new Response(fixtureRepo, { status: 200 }));

type IpcHandler = (event: IpcMainInvokeEvent, raw: unknown) => Promise<RealtimeReadResult | RealtimeArticleReadResult>;
const fakeIpc = () => {
  const handlers = new Map<string, IpcHandler>();
  const ipcMain = {
    handle: (channel: string, callback: IpcHandler) => {
      handlers.set(channel, callback);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  } as unknown as Pick<IpcMain, 'handle' | 'removeHandler'>;
  const dispatch = (channel: string, raw: unknown) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error('not registered');
    return handler({} as IpcMainInvokeEvent, raw);
  };
  const invoke = (raw: unknown): Promise<RealtimeReadResult> =>
    dispatch(REALTIME_CONTENT_CHANNEL, raw) as Promise<RealtimeReadResult>;
  const invokeArticle = (raw: unknown): Promise<RealtimeArticleReadResult> =>
    dispatch(REALTIME_ARTICLE_CHANNEL, raw) as Promise<RealtimeArticleReadResult>;
  return { ipcMain, invoke, invokeArticle };
};

describe('Realtime Main transport', () => {
  it('parses live GitHub and Hugging Face responses from pinned providers', async () => {
    const github = await readPublicRealtimeSource(
      { source: 'github' },
      async () => new Response(fixtureRepo, { status: 200 }),
      () => new Date('2026-10-15T02:00:00Z')
    );
    expect(github[0]?.title).toBe('example/repo');
    expect(github[0]?.value).toBe(180);
    const models = await readPublicRealtimeSource(
      { source: 'huggingface' },
      async () => new Response(fixtureModel, { status: 200 })
    );
    expect(models[0]?.url).toBe('https://huggingface.co/org/model');
    expect(models[0]?.value).toBe(90);
  });
  it('parses Hugging Face models, datasets and spaces into correct public links', async () => {
    await Promise.all(
      (['models', 'datasets', 'spaces'] as const).map(async (kind) => {
        let requested = '';
        const items = await readPublicRealtimeSource({ source: 'huggingface', kind }, async (url) => {
          requested = url;
          return new Response(
            JSON.stringify([{ id: 'owner/item', downloads: 90, likes: 12, description: 'Model metadata' }]),
            { status: 200 }
          );
        });
        expect(requested).toContain(`/api/${kind}?`);
        expect(items[0]?.url).toBe(`https://huggingface.co/${kind === 'models' ? '' : kind + '/'}owner/item`);
        expect(items[0]?.value).toBe(kind === 'spaces' ? 12 : 90);
      })
    );
  });
  it('parses verified hourly forecasts and provider market history without invented chart points', async () => {
    const market = await readPublicRealtimeSource(
      { source: 'market', range: '1w' },
      async () =>
        new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: { regularMarketPrice: 102, chartPreviousClose: 100 },
                  timestamp: [1760486400, 1760490000, 1760493600],
                  indicators: { quote: [{ close: [100, null, 102] }] },
                },
              ],
            },
          }),
          { status: 200 }
        )
    );
    expect(market[0]?.history).toHaveLength(2);
    expect(market[0]?.changePercent).toBe(2);
    const weather = await readPublicRealtimeSource(
      { source: 'weather', city: 'danang' },
      async () =>
        new Response(
          JSON.stringify({
            current: { time: '2026-10-16T10:00', temperature_2m: 28, weather_code: 3 },
            daily: { temperature_2m_max: [31], temperature_2m_min: [25] },
            hourly: {
              time: ['2026-10-16T09:00', '2026-10-16T10:00', '2026-10-16T11:00'],
              temperature_2m: [26, 28, 29],
            },
          }),
          { status: 200 }
        )
    );
    expect(weather[0]?.weatherCode).toBe(3);
    expect(weather[0]?.forecast).toEqual([
      { time: '2026-10-16T10:00', value: 28 },
      { time: '2026-10-16T11:00', value: 29 },
    ]);
  });
  it('collects valid articles from independently available RSS feeds and records publishers', async () => {
    const seen: string[] = [];
    const articles = await readPublicRealtimeSource({ source: 'news' }, async (url) => {
      seen.push(url);
      if (url.includes('bbc.co.uk')) throw new Error('OFFLINE');
      return new Response(
        '<rss><item><title>News &amp; update</title><link>https://example.org/story</link><description>Summary</description></item></rss>',
        { status: 200 }
      );
    });
    expect(seen).toHaveLength(3);
    expect(articles).toHaveLength(1);
    expect(articles[0]?.sourceLabel).toBe('Hacker News');
  });
  it('parses single-source RSS headlines and drops insecure article URLs', async () => {
    const xml =
      '<rss><channel><item><title>New &amp; useful</title><link>https://example.org/story</link><description><![CDATA[Hello <b>world</b>]]></description></item><item><title>Unsafe</title><link>http://invalid.test</link></item></channel></rss>';
    const items = await readPublicRealtimeSource({ source: 'news' }, async () => new Response(xml, { status: 200 }));
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('New & useful');
    expect(items[0]?.description).toContain('Hello');
  });
  it('reads only article URLs previously returned by approved RSS, strips scripts and caches extracted text', async () => {
    const { ipcMain, invoke, invokeArticle } = fakeIpc();
    const rss =
      '<rss><item><title>Reported story</title><link>https://example.org/story</link><description>Short summary</description></item></rss>';
    const article =
      '<html><script>alert(1)</script><article><p>The publisher states that this is an independently reported paragraph with enough text to be included in the safe editorial reader.</p><p>Another paragraph gives extra context for this story that the reader may review directly from the original source.</p></article></html>';
    const fetchRemote = vi.fn(async (url: string) =>
      url === 'https://example.org/story'
        ? new Response(article, { status: 200, headers: { 'content-type': 'text/html' } })
        : new Response(rss, { status: 200 })
    );
    const dispose = registerRealtimeContentBridge({ ipcMain, verifySender: () => true, fetchRemote });
    expect((await invoke({ source: 'news' })).ok).toBe(true);
    const before = fetchRemote.mock.calls.length;
    expect(await invokeArticle({ articleId: 'https://example.org/other' })).toEqual({ ok: false, code: 'DENIED' });
    expect(await invokeArticle({ articleId: 'https://example.org/story', url: 'https://evil.test' })).toEqual({
      ok: false,
      code: 'INVALID',
    });
    expect(fetchRemote).toHaveBeenCalledTimes(before);
    const read = await invokeArticle({ articleId: 'https://example.org/story' });
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.paragraphs).toHaveLength(2);
      expect(read.paragraphs.join(' ')).not.toContain('alert');
    }
    expect(await invokeArticle({ articleId: 'https://example.org/story' })).toEqual(read);
    expect(fetchRemote).toHaveBeenCalledTimes(before + 1);
    dispose();
  });
  it('denies unknown operations, arbitrary URLs and untrusted renderer callers', async () => {
    const { ipcMain, invoke } = fakeIpc();
    const dispose = registerRealtimeContentBridge({
      ipcMain,
      verifySender: () => false,
      fetchRemote: fetchJson,
    });
    expect(await invoke({ source: 'github' })).toEqual({ ok: false, code: 'DENIED' });
    dispose();
    const next = fakeIpc();
    const dispose2 = registerRealtimeContentBridge({
      ipcMain: next.ipcMain,
      verifySender: () => true,
      fetchRemote: fetchJson,
    });
    expect(await next.invoke({ source: 'http://evil.test' })).toEqual({ ok: false, code: 'INVALID' });
    expect(await next.invoke({ source: 'github', url: 'https://evil.test' })).toEqual({ ok: false, code: 'INVALID' });
    expect(await next.invoke({ source: 'github', range: '1d' })).toEqual({ ok: false, code: 'INVALID' });
    expect(await next.invoke({ source: 'market', range: 'forever' })).toEqual({ ok: false, code: 'INVALID' });
    expect(await next.invoke({ source: 'github', kind: 'spaces' })).toEqual({ ok: false, code: 'INVALID' });
    expect(await next.invoke({ source: 'huggingface', kind: 'arbitrary' })).toEqual({ ok: false, code: 'INVALID' });
    dispose2();
  });
  it('requires explicit egress admission and never fetches on denied authority', async () => {
    const { ipcMain, invoke } = fakeIpc();
    const request = vi.fn(async () => new Response(fixtureRepo));
    const dispose = registerRealtimeContentBridge({
      ipcMain,
      verifySender: () => true,
      fetchRemote: request,
      authority: { authorize: async () => ({ decision: 'deny' }) },
    });
    expect(await invoke({ source: 'github' })).toEqual({ ok: false, code: 'DENIED' });
    expect(request).not.toHaveBeenCalled();
    dispose();
  });
  it('makes manual refresh bypass the cache only at bounded intervals', async () => {
    let clock = Date.parse('2026-10-16T00:00:00Z');
    const { ipcMain, invoke } = fakeIpc();
    const request = vi.fn(async () => new Response(fixtureRepo, { status: 200 }));
    const dispose = registerRealtimeContentBridge({
      ipcMain,
      verifySender: () => true,
      fetchRemote: request,
      now: () => new Date(clock),
    });
    expect((await invoke({ source: 'github' })).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect((await invoke({ source: 'github', force: true })).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect((await invoke({ source: 'github', force: true })).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    clock += 31_000;
    expect((await invoke({ source: 'github', force: true })).ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
    expect(await invoke({ source: 'github', force: 'true' })).toEqual({ ok: false, code: 'INVALID' });
    dispose();
  });
  it('returns real data to the renderer and serves consecutive calls from cache', async () => {
    const { ipcMain, invoke } = fakeIpc();
    const request = vi.fn(async () => new Response(fixtureRepo, { status: 200 }));
    const dispose = registerRealtimeContentBridge({
      ipcMain,
      verifySender: () => true,
      fetchRemote: request,
      now: () => new Date('2026-10-15T02:00:00Z'),
    });
    const first = await invoke({ source: 'github' });
    expect(first.ok).toBe(true);
    expect(first.ok && first.items[0]?.title).toBe('example/repo');
    expect(await invoke({ source: 'github' })).toEqual(first);
    expect(request).toHaveBeenCalledTimes(1);
    dispose();
  });
});
