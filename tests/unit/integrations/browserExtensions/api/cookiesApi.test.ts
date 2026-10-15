/* oxlint-disable no-await-in-loop -- each call is awaited in order so the next one sees its effect */

import { describe, expect, it, vi } from 'vitest';
import type { ApiAuditEntry } from '@process/integrations/browserExtensions/api/router';
import { ID_A, ID_B, call, manifestOf, pageOf, shimWith, workerOf } from './shimFixture';
import { cookieOf, eventsOf, fakeCookies } from './portsFixture';

const ID_C = 'cccccccccccccccccccccccccccccccc';
const SECRET = 'session-secret-value';

const setup = () => {
  const jar = fakeCookies([
    cookieOf({ name: 'sid', domain: 'a.example.com', value: SECRET }),
    cookieOf({ name: 'pref', domain: '.example.com', hostOnly: false, secure: false, path: '/' }),
    cookieOf({ name: 'bank', domain: 'bank.test' }),
  ]);
  const audit = vi.fn<(entry: ApiAuditEntry) => void>();
  const shim = shimWith(
    {
      // A: cookies permission and the example.com sites. B: the permission but no site. C: sites but no permission.
      [ID_A]: manifestOf({ permissions: ['cookies'], host_permissions: ['*://*.example.com/*'] }),
      [ID_B]: manifestOf({ permissions: ['cookies'], host_permissions: [] }),
      [ID_C]: manifestOf({ permissions: ['storage'], host_permissions: ['*://*.example.com/*'] }),
    },
    { ports: { cookies: jar.port }, audit }
  );
  return { shim, jar, audit, events: eventsOf(shim) };
};

describe('chrome.cookies permission and host gating', () => {
  it('denies every method to an extension without the cookies permission', async () => {
    const { shim, jar } = setup();
    for (const [method, arg] of [
      ['cookies.get', { url: 'https://a.example.com/', name: 'sid' }],
      ['cookies.getAll', {}],
      ['cookies.set', { url: 'https://a.example.com/', name: 'n', value: 'v' }],
      ['cookies.remove', { url: 'https://a.example.com/', name: 'sid' }],
    ] as const) {
      expect(await call(shim, workerOf(ID_C), method, arg), method).toMatchObject({
        ok: false,
        code: 'PERMISSION_DENIED',
      });
    }
    expect(jar.log).toEqual([]);
  });

  it('reads a cookie only for a url the extension has a host permission for', async () => {
    const { shim, jar } = setup();
    expect(
      await call(shim, workerOf(ID_A), 'cookies.get', { url: 'https://a.example.com/', name: 'sid' })
    ).toMatchObject({
      ok: true,
      value: { name: 'sid', value: SECRET, domain: 'a.example.com', storeId: '0', hostOnly: true },
    });
    expect(await call(shim, workerOf(ID_A), 'cookies.get', { url: 'https://bank.test/', name: 'bank' })).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
    expect(
      await call(shim, workerOf(ID_B), 'cookies.get', { url: 'https://a.example.com/', name: 'sid' })
    ).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
    expect(jar.log).toHaveLength(1);
  });

  it('answers null for a cookie that is not there, and refuses a non-web url', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'cookies.get', { url: 'https://a.example.com/', name: 'none' })).toEqual({
      ok: true,
      value: null,
    });
    expect(await call(shim, workerOf(ID_A), 'cookies.get', { url: 'file:///C:/x', name: 'n' })).toMatchObject({
      ok: false,
    });
    expect(await call(shim, workerOf(ID_A), 'cookies.get', { url: 'chrome://x/', name: 'n' })).toMatchObject({
      ok: false,
    });
  });

  it('getAll without a url lists only the cookies a host permission covers', async () => {
    const { shim } = setup();
    const all = (await call(shim, workerOf(ID_A), 'cookies.getAll', {})) as { value: { name: string }[] };
    expect(all.value.map((cookie) => cookie.name).toSorted()).toEqual(['pref', 'sid']);
    expect(await call(shim, workerOf(ID_B), 'cookies.getAll', {})).toEqual({ ok: true, value: [] });
    // A cookie is checked as https when secure and as http otherwise: `*://` covers both.
    const named = (await call(shim, workerOf(ID_A), 'cookies.getAll', { name: 'sid' })) as { value: unknown[] };
    expect(named.value).toHaveLength(1);
  });

  it('checks scheme as Chrome does: an https-only permission does not cover an insecure cookie', async () => {
    const jar = fakeCookies([cookieOf({ name: 'plain', domain: 'a.example.com', secure: false })]);
    const shim = shimWith(
      { [ID_A]: manifestOf({ permissions: ['cookies'], host_permissions: ['https://*.example.com/*'] }) },
      { ports: { cookies: jar.port } }
    );
    expect(await call(shim, workerOf(ID_A), 'cookies.getAll', {})).toEqual({ ok: true, value: [] });
  });

  it('getAll with a url needs the permission for that url', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'cookies.getAll', { url: 'https://bank.test/' })).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('uses a host permission the person granted later', async () => {
    const jar = fakeCookies([cookieOf({ name: 'opt', domain: 'optional.test' })]);
    const shim = shimWith(
      { [ID_A]: manifestOf({ permissions: ['cookies'] }) },
      {
        ports: { cookies: jar.port },
        prompt: { ask: async () => true },
      }
    );
    expect(
      await call(shim, workerOf(ID_A), 'cookies.get', { url: 'https://optional.test/', name: 'opt' })
    ).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await call(shim, workerOf(ID_A), 'permissions.request', { origins: ['https://optional.test/*'] });
    expect(
      await call(shim, workerOf(ID_A), 'cookies.get', { url: 'https://optional.test/', name: 'opt' })
    ).toMatchObject({
      ok: true,
      value: { name: 'opt' },
    });
  });
});

describe('chrome.cookies set and remove', () => {
  it('sets a cookie for a covered url and returns it', async () => {
    const { shim, jar } = setup();
    const result = await call(shim, pageOf(ID_A), 'cookies.set', {
      url: 'https://a.example.com/',
      name: 'n',
      value: 'v',
    });
    expect(result).toMatchObject({ ok: true, value: { name: 'n', value: 'v', domain: 'a.example.com' } });
    expect(jar.log).toContain('set:n');
  });

  it('refuses to set a cookie for a url outside the host permissions, or a domain it does not contain', async () => {
    const { shim, jar } = setup();
    expect(
      await call(shim, workerOf(ID_A), 'cookies.set', { url: 'https://bank.test/', name: 'n', value: 'v' })
    ).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(
      await call(shim, workerOf(ID_A), 'cookies.set', { url: 'https://a.example.com/', name: 'n', domain: 'bank.test' })
    ).toMatchObject({ code: 'INVALID_ARGUMENTS' });
    // A domain that contains the host but is wider than the permission.
    const narrow = shimWith(
      { [ID_A]: manifestOf({ permissions: ['cookies'], host_permissions: ['https://a.example.com/*'] }) },
      { ports: { cookies: jar.port } }
    );
    expect(
      await call(narrow, workerOf(ID_A), 'cookies.set', {
        url: 'https://a.example.com/',
        name: 'n',
        domain: 'example.com',
      })
    ).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(jar.log.filter((line) => line.startsWith('set:'))).toEqual([]);
  });

  it('refuses names and values that could inject another cookie', async () => {
    const { shim, jar } = setup();
    for (const details of [
      { name: 'a=b', value: 'v' },
      { name: 'a;b', value: 'v' },
      { name: 'a b', value: 'v' },
      { name: 'n', value: 'v; Domain=bank.test' },
      { name: 'n', value: 'line\r\nbreak' },
      { name: 'n', value: 'x'.repeat(5000) },
      { name: 'n', value: 'v', path: 'relative' },
      { name: 'n', value: 'v', storeId: '1' },
      { name: 'n', value: 'v', unknown: 1 },
    ]) {
      expect(
        await call(shim, workerOf(ID_A), 'cookies.set', { url: 'https://a.example.com/', ...details }),
        JSON.stringify(details).slice(0, 40)
      ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' });
    }
    expect(jar.log).toEqual([]);
  });

  it('removes only covered cookies and reports what it removed', async () => {
    const { shim, jar } = setup();
    expect(await call(shim, workerOf(ID_A), 'cookies.remove', { url: 'https://a.example.com/', name: 'sid' })).toEqual({
      ok: true,
      value: { url: 'https://a.example.com/', name: 'sid', storeId: '0' },
    });
    expect(
      await call(shim, workerOf(ID_A), 'cookies.remove', { url: 'https://bank.test/', name: 'bank' })
    ).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(
      await call(shim, workerOf(ID_B), 'cookies.remove', { url: 'https://a.example.com/', name: 'pref' })
    ).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(jar.log.filter((line) => line.startsWith('remove:'))).toHaveLength(1);
  });
});

describe('chrome.cookies audit and events', () => {
  it('audits calls by name and outcome, never with a cookie value', async () => {
    const { shim, audit } = setup();
    await call(shim, workerOf(ID_A), 'cookies.get', { url: 'https://a.example.com/', name: 'sid' });
    await call(shim, workerOf(ID_C), 'cookies.get', { url: 'https://a.example.com/', name: 'sid' });
    expect(audit.mock.calls.map(([entry]) => entry)).toEqual([
      { extensionId: ID_A, method: 'cookies.get', outcome: 'ok' },
      { extensionId: ID_C, method: 'cookies.get', outcome: 'denied', code: 'PERMISSION_DENIED' },
    ]);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(SECRET);
  });

  it('sends onChanged only to extensions that hold the permission and cover the cookie', () => {
    const { jar, events } = setup();
    jar.emit({
      cookie: cookieOf({ name: 'sid', domain: 'a.example.com', value: SECRET }),
      removed: true,
      cause: 'expired-overwrite',
    });
    jar.emit({ cookie: cookieOf({ name: 'bank', domain: 'bank.test' }), removed: false, cause: 'explicit' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ extensionId: ID_A, name: 'cookies.onChanged' });
    expect(events[0]?.args).toMatchObject([{ removed: true, cause: 'expired_overwrite', cookie: { name: 'sid' } }]);
  });

  it('answers UNSUPPORTED without the profile cookie jar', async () => {
    const shim = shimWith({ [ID_A]: manifestOf({ permissions: ['cookies'], host_permissions: ['<all_urls>'] }) });
    expect(await call(shim, workerOf(ID_A), 'cookies.getAll', {})).toMatchObject({ code: 'UNSUPPORTED' });
  });
});
