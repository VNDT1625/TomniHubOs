import { describe, expect, it } from 'vitest';
import { webEmbedAllowedOrigins, type WebEmbedConnection } from '@/common/integrations/webEmbed/webEmbed';
import { decideAppNavigation } from '@process/integrations/runtime/webEmbedTabs';

describe('loopback web app navigation', () => {
  const loopbackApp = { kind: 'web-embed', id: 'app', title: 'App', url: 'http://127.0.0.1:8080/' };
  const origins = webEmbedAllowedOrigins(loopbackApp as WebEmbedConnection);

  it('allows only the loopback origin of the app inside the app tab', () => {
    expect(origins).toEqual(['http://127.0.0.1:8080']);
    expect(decideAppNavigation('http://127.0.0.1:8080/page', origins)).toBe('allow');
  });

  it('never follows a link or redirect off loopback inside the app tab', () => {
    expect(decideAppNavigation('https://evil.example.com/', origins)).not.toBe('allow');
    expect(decideAppNavigation('http://localhost:8080/', origins)).not.toBe('allow');
    expect(decideAppNavigation('http://127.0.0.1:9090/', origins)).not.toBe('allow');
    expect(decideAppNavigation('http://0.0.0.0:8080/', origins)).not.toBe('allow');
  });
});
