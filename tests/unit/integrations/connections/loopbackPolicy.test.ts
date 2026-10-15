import { describe, expect, it } from 'vitest';
import {
  isLoopbackWebUrl,
  parseAdapterDocument,
  readAdapterDocument,
  type AdapterReadOptions,
} from '@/common/packages/adapter';
import { loopbackPolicyOf, webEmbedUrlProblem } from '@/common/integrations/webEmbed/webEmbed';

const LOCAL: AdapterReadOptions = { trust: 'local-built' };
const STORE: AdapterReadOptions = { trust: 'signed-store' };

const webApp = (url: string) => ({
  schemaVersion: 1,
  generatedBy: 'classifier',
  connections: [{ kind: 'web-embed', id: 'app', title: 'App', url }],
});

const localService = {
  kind: 'service',
  id: 'bot',
  title: 'Bot',
  headless: true,
  process: { services: [{ id: 'bot', cwd: 'source', start: ['node', 'index.js'] }] },
};

const LOOPBACK_OK = ['http://127.0.0.1:8080', 'http://localhost:3000/', 'http://127.0.0.1:8080/app/x'];
const LOOPBACK_REFUSED = [
  'http://0.0.0.0:8080',
  'http://[::]:8080',
  'http://[::1]:8080',
  'http://2130706433:8080',
  'http://0x7f000001:8080',
  'http://0177.0.0.1:8080',
  'http://localhost.evil.com:8080',
  'http://127.0.0.1.evil.com:8080',
  'http://user:pw@127.0.0.1:8080',
  'http://127.0.0.1',
  'http://127.0.0.1:0',
  'http://127.0.0.1:70000',
  'http://127.0.0.1:8080/../x',
  'http://127.0.0.1:8080?x=1',
  'http://example.com:8080',
  'https://127.0.0.1:8080',
];

describe('loopback web-embed addresses', () => {
  it.each(LOOPBACK_OK)('accepts %s as a loopback address', (url) => {
    expect(isLoopbackWebUrl(url)).toBe(true);
  });

  it.each(LOOPBACK_REFUSED)('refuses %s', (url) => {
    expect(isLoopbackWebUrl(url)).toBe(false);
  });

  it('the strict writer accepts loopback syntax; the policy is applied when the package is read', () => {
    expect(parseAdapterDocument(webApp('http://127.0.0.1:8080/')).connections).toHaveLength(1);
    expect(() => parseAdapterDocument(webApp('http://example.com/'))).toThrow();
  });

  it('keeps a loopback web app of a local-built package', () => {
    const result = readAdapterDocument(webApp('http://127.0.0.1:8080/'), LOCAL);
    expect(result.document.connections).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it('drops a loopback web app of a store package that declares no local service, and says why', () => {
    const result = readAdapterDocument(webApp('http://127.0.0.1:8080/'), STORE);
    expect(result.document.connections).toHaveLength(0);
    expect(result.issues).toEqual([expect.objectContaining({ kind: 'web-embed', reason: 'invalid' })]);
  });

  it('drops a loopback web app when the trust tier is unknown (fails closed)', () => {
    expect(readAdapterDocument(webApp('http://127.0.0.1:8080/')).document.connections).toHaveLength(0);
  });

  it('keeps a loopback web app of a store package that declares a local service of its own', () => {
    const result = readAdapterDocument(
      {
        schemaVersion: 1,
        generatedBy: 'classifier',
        connections: [webApp('http://127.0.0.1:8080/').connections[0], localService],
      },
      STORE
    );
    expect(result.document.connections.map((connection) => connection.kind)).toEqual(['web-embed', 'service']);
    expect(result.issues).toEqual([]);
  });

  it('never drops an https web app, whatever the trust tier', () => {
    expect(readAdapterDocument(webApp('https://docs.example.com/app'), STORE).document.connections).toHaveLength(1);
  });

  it('the open-time policy function gives the same answers as the reader', () => {
    expect(webEmbedUrlProblem('http://127.0.0.1:8080/', loopbackPolicyOf({ trust: 'local-built' }))).toBeUndefined();
    expect(webEmbedUrlProblem('http://127.0.0.1:8080/', loopbackPolicyOf({ trust: 'signed-store' }))).toMatch(
      /loopback/u
    );
    expect(webEmbedUrlProblem('http://127.0.0.1:8080/', loopbackPolicyOf({}))).toMatch(/loopback/u);
    expect(webEmbedUrlProblem('http://example.com/', loopbackPolicyOf({ trust: 'local-built' }))).toMatch(
      /Only https/u
    );
    expect(webEmbedUrlProblem('https://user:pw@docs.example.com/', loopbackPolicyOf({}))).toMatch(/password/u);
    expect(webEmbedUrlProblem('https://docs.example.com/app', loopbackPolicyOf({}))).toBeUndefined();
  });

  it('refuses a loopback origin declared next to a loopback address', () => {
    const result = readAdapterDocument(
      {
        schemaVersion: 1,
        generatedBy: 'classifier',
        connections: [
          {
            kind: 'web-embed',
            id: 'app',
            title: 'App',
            url: 'http://127.0.0.1:8080/',
            origins: ['https://cdn.example.com'],
          },
        ],
      },
      LOCAL
    );
    expect(result.document.connections).toHaveLength(0);
  });
});

describe('headless service connections', () => {
  const headless = (services: unknown[], extra: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    generatedBy: 'classifier',
    connections: [{ kind: 'service', id: 'bot', title: 'Bot', ...extra, process: { services } }],
  });

  it('accepts a headless program with no port', () => {
    expect(
      parseAdapterDocument(headless([{ id: 'bot', cwd: 'source', start: ['node', 'index.js'] }], { headless: true }))
        .connections
    ).toHaveLength(1);
  });

  it('refuses a port on a headless program', () => {
    expect(() =>
      parseAdapterDocument(
        headless([{ id: 'bot', cwd: 'source', start: ['node', 'index.js'], ready: { port: 4201 } }], { headless: true })
      )
    ).toThrow();
  });

  it('refuses a program without a port unless the service is headless', () => {
    expect(() => parseAdapterDocument(headless([{ id: 'bot', cwd: 'source', start: ['node', 'index.js'] }]))).toThrow();
  });

  it('keeps a headless service when read, with the same rule', () => {
    const result = readAdapterDocument(
      headless([{ id: 'bot', cwd: 'source', start: ['node', 'index.js'] }], { headless: true }),
      LOCAL
    );
    expect(result.document.connections).toHaveLength(1);
  });
});
