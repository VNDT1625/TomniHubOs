import { describe, expect, it } from 'vitest';
import { buildRealtimeResearchDraft } from '../../../packages/desktop/src/renderer/pages/realtime/services/researchDraft';
import type { NewsArticle } from '../../../packages/desktop/src/renderer/pages/realtime/services/types';
import { weatherGroupOf } from '../../../packages/desktop/src/renderer/pages/realtime/services/weatherCodes';

const example: NewsArticle = {
  id: 'sample',
  title: 'Public news story',
  excerpt: 'A bounded one-source summary.',
  category: 'RSS',
  body: ['Publisher text '.repeat(1000)],
  sources: [{ label: 'Original publisher', url: 'https://publisher.example/story' }],
  isDemo: false,
};

describe('Realtime weather conditions', () => {
  it('maps only documented WMO codes and preserves explicit unknown state', () => {
    expect(weatherGroupOf(0)).toBe('clear');
    expect(weatherGroupOf(3)).toBe('overcast');
    expect(weatherGroupOf(61)).toBe('rain');
    expect(weatherGroupOf(95)).toBe('thunderstorm');
    expect(weatherGroupOf(1000)).toBe('unknown');
    expect(weatherGroupOf(undefined)).toBe('unknown');
  });
});

describe('Realtime question handoff', () => {
  it('retains the publisher URL and recent user questions ahead of optional long article text', () => {
    const prompt = buildRealtimeResearchDraft(example, ['Earlier question? '.repeat(100), 'Most recent request?']);
    expect(prompt.length).toBeLessThanOrEqual(6000);
    expect(prompt).toContain('https://publisher.example/story');
    expect(prompt).toContain('Most recent request?');
    expect(prompt).toContain('Untrusted publisher article reference');
    expect(prompt).toContain('Publisher article text:');
  });
  it('rejects non-HTTPS citations rather than passing unsafe remote addresses to the agent', () => {
    const prompt = buildRealtimeResearchDraft(
      { ...example, sources: [{ label: 'Danger', url: 'http://localhost/private' }] },
      ['Explain more']
    );
    expect(prompt).not.toContain('http://localhost/private');
    expect(prompt).toContain('Explain more');
  });
});
