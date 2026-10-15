import { describe, expect, it } from 'vitest';
import {
  getNewsArticles,
  partitionArticlesIntoBlocks,
} from '../../../packages/desktop/src/renderer/pages/realtime/services/newsProvider';
import { browserPathForExternalUrl } from '../../../packages/desktop/src/renderer/pages/realtime/services/navigation';
import { getMarketMetrics } from '../../../packages/desktop/src/renderer/pages/realtime/services/marketProvider';
import { getWeatherData } from '../../../packages/desktop/src/renderer/pages/realtime/services/weatherProvider';

describe('Realtime source contracts', () => {
  it('preserves all articles in 1-3-1-3 rhythm, including partial tails', () => {
    for (let count = 0; count <= 11; count++) {
      const items = Array.from({ length: count }, (_, i) => ({ ...getNewsArticles()[0], id: `id-${i}` }));
      const blocks = partitionArticlesIntoBlocks(items);
      expect(blocks.flatMap((block) => (block.type === 'hero' ? [block.article] : block.articles))).toEqual(items);
      expect(blocks.every((block, i) => block.type === (i % 2 === 0 ? 'hero' : 'subgrid'))).toBe(true);
      expect(
        blocks
          .filter((block) => block.type === 'subgrid')
          .every((block) => block.type === 'subgrid' && block.articles.length >= 1 && block.articles.length <= 3)
      ).toBe(true);
    }
  });

  it('never invents published timestamps, market prices, or weather readings', () => {
    expect(getNewsArticles().every((item) => item.isDemo && item.publishedAt === undefined)).toBe(true);
    expect(getMarketMetrics().every((item) => item.price === undefined && item.sparkline.length === 0)).toBe(true);
    expect(getWeatherData().temperature).toBeUndefined();
  });

  it('admits only credential-free HTTPS URLs to Browser', () => {
    const open = browserPathForExternalUrl;
    expect(open('https://example.com/a')).toBe('/browser?url=https%3A%2F%2Fexample.com%2Fa');
    expect(open('javascript:alert(1)')).toBeNull();
    expect(open('http://example.com')).toBeNull();
    expect(open('file:///etc/passwd')).toBeNull();
    expect(open('https://user@example.com')).toBeNull();
    expect(open('not a url')).toBeNull();
  });
});
