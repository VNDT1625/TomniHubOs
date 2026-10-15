import { readdir } from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  buildChromeWebStoreDownloadUrl,
  checkChromeWebStoreUpdate,
  ChromeWebStoreError,
  compareExtensionVersions,
  createFetchStorePort,
  installExtensionFromChromeWebStore,
  parseChromeWebStoreInput,
  type StorePort,
  type StoreResponse,
} from '@process/integrations/repoSources/chromeWebStore';
import { ExtensionSourceError } from '@process/integrations/repoSources/folder';
import {
  buildCrx,
  cleanRoots,
  fakeDeps,
  idOfKey,
  MANIFEST_V3,
  rsaKey,
  signedHeaderOf,
  crxIdBytes,
  zipOf,
  type TestKey,
} from './extensionFixtures';

let ours: TestKey;
let other: TestKey;
let zip: Buffer;
let id: string;

beforeAll(async () => {
  ours = rsaKey();
  other = rsaKey();
  id = idOfKey(ours);
  zip = await zipOf({ 'manifest.json': MANIFEST_V3, 'background.js': 'console.log(1)' });
});
afterEach(cleanRoots);

const hang: StorePort['request'] = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

const START = (): string => buildChromeWebStoreDownloadUrl(id, '140.0.7339.41');

const bodyOf = (...chunks: Uint8Array[]): AsyncIterable<Uint8Array> =>
  (async function* generate(): AsyncGenerator<Uint8Array> {
    for (const chunk of chunks) yield chunk;
  })();

const okResponse = (bytes: Buffer, headers: Record<string, string> = {}): StoreResponse => ({
  status: 200,
  header: (name) => headers[name.toLowerCase()] ?? null,
  body: bodyOf(bytes),
});
const redirectTo = (location: string, status = 302): StoreResponse => ({
  status,
  header: (name) => (name.toLowerCase() === 'location' ? location : null),
  body: null,
});

type Script = Record<string, StoreResponse | (() => StoreResponse | Promise<StoreResponse>)>;
type FakeStore = Readonly<{ port: StorePort; requests: string[]; refusedHosts: string[] }>;

/** A port that answers by URL prefix and records every request actually made. */
const fakeStore = (script: Script): FakeStore => {
  const requests: string[] = [];
  const refusedHosts: string[] = [];
  const port: StorePort = {
    chromiumVersion: '140.0.7339.41',
    log: (event) => refusedHosts.push(event.host),
    request: async (url) => {
      requests.push(url);
      const key = Object.keys(script).find((prefix) => url.startsWith(prefix));
      if (key === undefined) throw new Error(`unexpected request ${url}`);
      const entry = script[key];
      return typeof entry === 'function' ? entry() : (entry as StoreResponse);
    },
  };
  return { port, requests, refusedHosts };
};

const CDN = 'https://clients2.googleusercontent.com/crx/blobs/abc/extension.crx';
const validCrx = (): Buffer => buildCrx({ zip, proofs: [{ key: ours }], idKey: ours });

const codeOf = async (action: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await action();
  } catch (error) {
    if (error instanceof ChromeWebStoreError || error instanceof ExtensionSourceError) return error.code;
    return `other:${String(error)}`;
  }
  return undefined;
};

const stagingLeft = async (root: string): Promise<string[]> =>
  (await readdir(root)).filter((name) => name.startsWith('tomny-ext-'));

describe('input parsing', () => {
  it('accepts an id and Web Store detail URLs', () => {
    expect(parseChromeWebStoreInput(id)).toBe(id);
    expect(parseChromeWebStoreInput(`  ${id}\n`)).toBe(id);
    expect(parseChromeWebStoreInput(`https://chromewebstore.google.com/detail/ublock-origin-lite/${id}`)).toBe(id);
    expect(parseChromeWebStoreInput(`https://chromewebstore.google.com/detail/name/${id}/`)).toBe(id);
    expect(parseChromeWebStoreInput(`https://chromewebstore.google.com/detail/name/${id}?hl=vi#reviews`)).toBe(id);
  });

  it.each([
    '',
    '   ',
    'a'.repeat(31),
    'a'.repeat(33),
    'q'.repeat(32),
    'A'.repeat(32),
    `http://chromewebstore.google.com/detail/name/${'a'.repeat(32)}`,
    `https://chrome.google.com/webstore/detail/name/${'a'.repeat(32)}`,
    `https://chromewebstore.google.com.evil.test/detail/name/${'a'.repeat(32)}`,
    `https://user:pw@chromewebstore.google.com/detail/name/${'a'.repeat(32)}`,
    `https://chromewebstore.google.com:8443/detail/name/${'a'.repeat(32)}`,
    `https://chromewebstore.google.com/detail/${'a'.repeat(32)}`,
    `https://chromewebstore.google.com/detail/name/${'a'.repeat(32)}/extra`,
    `https://chromewebstore.google.com/detail//${'a'.repeat(32)}`,
    `https://chromewebstore.google.com/search/${'a'.repeat(32)}`,
    `https://chromewebstore.google.com/detail/name/${'q'.repeat(32)}`,
    `${'x'.repeat(3000)}`,
    'not a url',
  ])('rejects %j', (value) => {
    let code: string | undefined;
    try {
      parseChromeWebStoreInput(value);
    } catch (error) {
      code = error instanceof ChromeWebStoreError ? error.code : 'other';
    }
    expect(code).toBe('STORE_INPUT_INVALID');
  });

  it('builds the exact update2 download URL', () => {
    expect(buildChromeWebStoreDownloadUrl(id, '140.0.7339.41')).toBe(
      `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=140.0.7339.41&acceptformat=crx3&x=id%3D${id}%26uc`
    );
  });
});

describe('download and install', () => {
  it('follows an allowed redirect, verifies the CRX3 and installs with the Web Store id', async () => {
    const run = await fakeDeps();
    const store = fakeStore({ [START()]: redirectTo(CDN), [CDN]: okResponse(validCrx()) });
    const result = await installExtensionFromChromeWebStore(
      run.deps,
      store.port,
      `https://chromewebstore.google.com/detail/sample/${id}`
    );
    expect(store.requests).toEqual([START(), CDN]);
    expect(result).toMatchObject({
      from: 'crx',
      extensionId: id,
      extensionName: 'Sample',
      extensionVersion: '1.2.3',
      provenance: { kind: 'chrome-web-store', extensionId: id, extensionVersion: '1.2.3' },
      storeUrl: `https://chromewebstore.google.com/detail/${id}`,
      install: { packageId: 'local.sample' },
    });
    expect(run.installs).toHaveLength(1);
    // The staged manifest carries the proven key, so the id survives a different load path.
    expect(JSON.parse(run.manifestSeen[0] ?? '{}')).toHaveProperty('key');
    expect(await stagingLeft(run.staging)).toEqual([]);
  });

  it('accepts a direct 200 without redirect and a relative redirect on an allowed host', async () => {
    const run = await fakeDeps();
    const direct = fakeStore({ [START()]: okResponse(validCrx()) });
    await installExtensionFromChromeWebStore(run.deps, direct.port, id);
    const relative = fakeStore({
      [START()]: redirectTo('/crx/blobs/x.crx', 307),
      'https://clients2.google.com/crx/blobs/x.crx': okResponse(validCrx()),
    });
    await installExtensionFromChromeWebStore(run.deps, relative.port, id);
    expect(run.installs).toHaveLength(2);
  });

  it('refuses a redirect to a forbidden host before any request to it', async () => {
    const run = await fakeDeps();
    const store = fakeStore({
      [START()]: redirectTo('https://evil.example.test/x.crx'),
      'https://evil': okResponse(validCrx()),
    });
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, store.port, id))).toBe('STORE_HOST_REFUSED');
    expect(store.requests).toEqual([START()]);
    expect(store.refusedHosts).toEqual(['evil.example.test']);
    expect(run.builds).toHaveLength(0);
    expect(await stagingLeft(run.staging)).toEqual([]);
  });

  it.each([
    ['http downgrade', 'http://clients2.googleusercontent.com/crx/x.crx'],
    ['credentials', 'https://user:pw@clients2.googleusercontent.com/crx/x.crx'],
    ['non-default port', 'https://clients2.googleusercontent.com:8443/crx/x.crx'],
    ['look-alike host', 'https://clients2.googleusercontent.com.evil.test/x.crx'],
    ['trailing-dot host', 'https://clients2.googleusercontent.com./x.crx'],
    ['other scheme', 'ftp://clients2.googleusercontent.com/x.crx'],
  ])('refuses %s', async (_name, target) => {
    const run = await fakeDeps();
    const store = fakeStore({ [START()]: redirectTo(target) });
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, store.port, id))).toBe('STORE_HOST_REFUSED');
    expect(store.requests).toEqual([START()]);
  });

  it('refuses a redirect from the CDN back out to another host (every hop is checked)', async () => {
    const run = await fakeDeps();
    const store = fakeStore({
      [START()]: redirectTo(CDN),
      [CDN]: redirectTo('https://evil.example.test/y'),
    });
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, store.port, id))).toBe('STORE_HOST_REFUSED');
    expect(store.requests).toEqual([START(), CDN]);
  });

  it('maps statuses, loops, network errors, empty bodies and bad versions to STORE_UNAVAILABLE', async () => {
    const run = await fakeDeps();
    const statuses = await Promise.all(
      [204, 404, 500].map((status) => {
        const store = fakeStore({ [START()]: { status, header: () => null, body: null } });
        return codeOf(() => installExtensionFromChromeWebStore(run.deps, store.port, id));
      })
    );
    expect(statuses).toEqual(['STORE_UNAVAILABLE', 'STORE_UNAVAILABLE', 'STORE_UNAVAILABLE']);

    const loop = fakeStore({ 'https://clients2.google.com': redirectTo(START()) });
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, loop.port, id))).toBe('STORE_UNAVAILABLE');
    expect(loop.requests.length).toBeLessThanOrEqual(6);

    const noLocation = fakeStore({ [START()]: { status: 302, header: () => null, body: null } });
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, noLocation.port, id))).toBe(
      'STORE_UNAVAILABLE'
    );

    const broken = fakeStore({
      [START()]: () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, broken.port, id))).toBe('STORE_UNAVAILABLE');

    const empty = fakeStore({ [START()]: okResponse(Buffer.alloc(0)) });
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, empty.port, id))).toBe('STORE_UNAVAILABLE');

    const badVersion = fakeStore({});
    expect(
      await codeOf(() =>
        installExtensionFromChromeWebStore(run.deps, { ...badVersion.port, chromiumVersion: 'x&y' }, id)
      )
    ).toBe('STORE_UNAVAILABLE');
    expect(badVersion.requests).toEqual([]);
    expect(await stagingLeft(run.staging)).toEqual([]);
  });

  it('times out as STORE_UNAVAILABLE and cancels as CANCELLED', async () => {
    const run = await fakeDeps();
    const port: StorePort = { chromiumVersion: '140.0.7339.41', request: hang };
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, port, id, { timeoutMs: 20 }))).toBe(
      'STORE_UNAVAILABLE'
    );
    const controller = new AbortController();
    const pending = codeOf(() => installExtensionFromChromeWebStore(run.deps, port, id, { signal: controller.signal }));
    setTimeout(() => controller.abort(), 10);
    expect(await pending).toBe('CANCELLED');
    const already = new AbortController();
    already.abort();
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, port, id, { signal: already.signal }))).toBe(
      'CANCELLED'
    );
  });

  it('rejects an oversize body by the counted bytes, and by a declared length without reading', async () => {
    const run = await fakeDeps();
    const big = fakeStore({
      [START()]: { status: 200, header: () => null, body: bodyOf(Buffer.alloc(60), Buffer.alloc(60)) },
    });
    expect(
      await codeOf(() => installExtensionFromChromeWebStore(run.deps, big.port, id, { maxDownloadBytes: 100 }))
    ).toBe('TOO_LARGE');

    let read = false;
    const declared = fakeStore({
      [START()]: {
        status: 200,
        header: (name) => (name.toLowerCase() === 'content-length' ? '101' : null),
        body: (async function* generate(): AsyncGenerator<Uint8Array> {
          read = true;
          yield Buffer.alloc(1);
        })(),
      },
    });
    expect(
      await codeOf(() => installExtensionFromChromeWebStore(run.deps, declared.port, id, { maxDownloadBytes: 100 }))
    ).toBe('TOO_LARGE');
    expect(read).toBe(false);
    // A lying content-length does not help: the counted bytes still decide.
    const lying = fakeStore({
      [START()]: {
        status: 200,
        header: (name) => (name.toLowerCase() === 'content-length' ? '5' : null),
        body: bodyOf(Buffer.alloc(200)),
      },
    });
    expect(
      await codeOf(() => installExtensionFromChromeWebStore(run.deps, lying.port, id, { maxDownloadBytes: 100 }))
    ).toBe('TOO_LARGE');
    expect(await stagingLeft(run.staging)).toEqual([]);
    expect(run.builds).toHaveLength(0);
  });

  it('rejects a CRX3 signed for a different id with CRX_INVALID, before any build', async () => {
    const run = await fakeDeps();
    const wrongId = buildCrx({ zip, proofs: [{ key: other }], idKey: other });
    const store = fakeStore({ [START()]: okResponse(wrongId) });
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, store.port, id))).toBe('CRX_INVALID');
    expect(run.builds).toHaveLength(0);
    expect(run.installs).toHaveLength(0);
    expect(await stagingLeft(run.staging)).toEqual([]);
  });

  it('rejects a CRX3 that declares the right id but is not signed by that key', async () => {
    const run = await fakeDeps();
    // The attacker knows the public key and id but signs with their own key: the signature fails.
    const forged = buildCrx({
      zip,
      proofs: [{ key: { ...other, spki: ours.spki } }],
      idKey: ours,
      signedHeader: signedHeaderOf(crxIdBytes(ours)),
    });
    const store = fakeStore({ [START()]: okResponse(forged) });
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, store.port, id))).toBe('CRX_INVALID');
    // A tampered payload under a valid signature also fails.
    const tampered = Buffer.from(validCrx());
    tampered[tampered.length - 3] = (tampered[tampered.length - 3] ?? 0) ^ 0xff;
    const second = fakeStore({ [START()]: okResponse(tampered) });
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, second.port, id))).toBe('CRX_INVALID');
    expect(run.builds).toHaveLength(0);
  });

  it('rejects a body that is a bare ZIP or garbage (no Cr24) with CRX_INVALID', async () => {
    const run = await fakeDeps();
    for (const bytes of [zip, Buffer.from('<html>captcha</html>')]) {
      const store = fakeStore({ [START()]: okResponse(bytes) });
      // oxlint-disable-next-line no-await-in-loop -- two tiny cases in order.
      expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, store.port, id))).toBe('CRX_INVALID');
    }
    expect(run.builds).toHaveLength(0);
  });

  it('rejects an invalid input before touching the network', async () => {
    const run = await fakeDeps();
    const store = fakeStore({});
    expect(await codeOf(() => installExtensionFromChromeWebStore(run.deps, store.port, 'https://evil.test/x'))).toBe(
      'STORE_INPUT_INVALID'
    );
    expect(store.requests).toEqual([]);
  });
});

describe('createFetchStorePort', () => {
  it('requests with redirect manual and credentials omitted, cancels redirect bodies, streams 200 bodies', async () => {
    const seen: Array<Record<string, unknown>> = [];
    let cancelled = 0;
    const reader = (chunks: Uint8Array[]) => {
      const queue = [...chunks];
      return {
        read: async () => {
          const value = queue.shift();
          return value === undefined ? { done: true } : { done: false, value };
        },
        cancel: async () => {
          cancelled += 1;
        },
      };
    };
    const port = createFetchStorePort(
      async (url, init) => {
        seen.push({ url, ...init });
        return url.endsWith('redirect')
          ? { status: 302, headers: { get: () => CDN }, body: { getReader: () => reader([Buffer.from('x')]) } }
          : {
              status: 200,
              headers: { get: () => null },
              body: { getReader: () => reader([Buffer.from('ab'), Buffer.from('cd')]) },
            };
      },
      { chromiumVersion: '140.0.7339.41' }
    );
    const signal = new AbortController().signal;
    const redirected = await port.request('https://clients2.google.com/redirect', { signal });
    expect(redirected.status).toBe(302);
    expect(redirected.header('location')).toBe(CDN);
    expect(redirected.body).toBeNull();
    expect(cancelled).toBe(1);
    const ok = await port.request('https://clients2.google.com/ok', { signal });
    const collected: string[] = [];
    for await (const chunk of ok.body ?? []) collected.push(Buffer.from(chunk).toString());
    expect(collected).toEqual(['ab', 'cd']);
    for (const call of seen)
      expect(call).toMatchObject({ redirect: 'manual', credentials: 'omit', method: 'GET', signal });
  });
});

describe('update check', () => {
  const xml = (attrs: string): StoreResponse =>
    okResponse(Buffer.from(`<?xml version="1.0"?><gupdate><app appid="${id}"><updatecheck ${attrs}/></app></gupdate>`));
  const UPDATE = (): string =>
    `https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=140.0.7339.41&acceptformat=crx3&x=id%3D${id}%26uc`;

  it('reports a newer version, the same version, and no entry', async () => {
    const newer = fakeStore({ [UPDATE()]: xml('codebase="https://x/y.crx" version="1.3.0" status="ok"') });
    expect(await checkChromeWebStoreUpdate(newer.port, id, '1.2.3')).toEqual({ latestVersion: '1.3.0', newer: true });
    const same = fakeStore({ [UPDATE()]: xml('version="1.2.3"') });
    expect(await checkChromeWebStoreUpdate(same.port, id, '1.2.3')).toEqual({ latestVersion: '1.2.3', newer: false });
    const none = fakeStore({ [UPDATE()]: xml('status="noupdate"') });
    expect(await checkChromeWebStoreUpdate(none.port, id, '1.2.3')).toBeUndefined();
    const empty = fakeStore({ [UPDATE()]: okResponse(Buffer.from('<gupdate/>')) });
    expect(await checkChromeWebStoreUpdate(empty.port, id, '1.2.3')).toBeUndefined();
  });

  it('applies the same host rules and rejects hostile answers', async () => {
    const evil = fakeStore({ [UPDATE()]: redirectTo('https://evil.example.test/u') });
    expect(await codeOf(() => checkChromeWebStoreUpdate(evil.port, id, '1.0'))).toBe('STORE_HOST_REFUSED');
    expect(evil.requests).toEqual([UPDATE()]);
    const badVersion = fakeStore({ [UPDATE()]: xml('version="1.0&lt;script"') });
    expect(await codeOf(() => checkChromeWebStoreUpdate(badVersion.port, id, '1.0'))).toBe('STORE_UNAVAILABLE');
    const huge = fakeStore({ [UPDATE()]: okResponse(Buffer.alloc(70 * 1024, 0x61)) });
    expect(await codeOf(() => checkChromeWebStoreUpdate(huge.port, id, '1.0'))).toBe('STORE_UNAVAILABLE');
    expect(await codeOf(() => checkChromeWebStoreUpdate(huge.port, 'bad', '1.0'))).toBe('STORE_INPUT_INVALID');
  });

  it('compares versions numerically', () => {
    expect(compareExtensionVersions('1.10', '1.9')).toBe(1);
    expect(compareExtensionVersions('1.0', '1.0.0')).toBe(0);
    expect(compareExtensionVersions('2', '10')).toBe(-1);
  });
});
