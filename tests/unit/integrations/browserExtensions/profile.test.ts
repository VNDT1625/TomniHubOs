/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, session: {} }));

import {
  BROWSER_PROFILE_PARTITION,
  configureProfilePermissions,
  decideWebPermission,
  getDeniedPermissionCounts,
  migrateCookies,
  resetDeniedPermissionCounts,
  type ProfileCookie,
  type ProfileCookieSetDetails,
} from '@process/integrations/browserExtensions/profile';

const SECRET = 'super-secret-value';

const makeEnv = (cookies: ProfileCookie[], failOn?: string) => {
  const set = vi.fn(async (d: ProfileCookieSetDetails) => {
    if (d.name === failOn) throw new Error('bad cookie');
  });
  const get = vi.fn(async () => cookies);
  let flag = false;
  const writeFlag = vi.fn(async () => {
    flag = true;
  });
  const logs: string[] = [];
  const opts = {
    source: { cookies: { get } },
    target: { cookies: { set } },
    readFlag: async () => flag,
    writeFlag,
    log: (m: string) => logs.push(m),
  };
  return { set, get, writeFlag, logs, opts };
};

describe('migrateCookies', () => {
  it('applies the S-4 url/domain/hostOnly/secure/sameSite rules', async () => {
    const env = makeEnv([
      {
        name: 'a',
        value: SECRET,
        domain: '.example.com',
        path: '/x',
        secure: true,
        httpOnly: true,
        hostOnly: false,
        expirationDate: 1893456000,
        sameSite: 'no_restriction',
      },
      {
        name: '__Host-b',
        value: 'v',
        domain: 'www.example.com',
        path: '/',
        secure: true,
        hostOnly: true,
        sameSite: 'unspecified',
      },
      { name: 'c', value: 'v', domain: 'plain.test', hostOnly: true },
    ]);
    const result = await migrateCookies(env.opts);
    expect(result).toEqual({ status: 'migrated', copied: 3, failed: 0, skipped: 0 });
    const [a, b, c] = env.set.mock.calls.map((call) => call[0]);
    expect(a).toEqual({
      url: 'https://example.com/x',
      name: 'a',
      value: SECRET,
      domain: '.example.com',
      path: '/x',
      secure: true,
      httpOnly: true,
      expirationDate: 1893456000,
      sameSite: 'no_restriction',
    });
    expect(b.url).toBe('https://www.example.com/');
    expect('domain' in b).toBe(false);
    expect(b.sameSite).toBe('unspecified');
    expect(c.url).toBe('http://plain.test/');
    expect('domain' in c).toBe(false);
    expect('expirationDate' in c).toBe(false);
  });

  it('collects per-cookie failures without stopping the batch, then sets the flag', async () => {
    const env = makeEnv(
      [
        { name: 'ok1', value: 'v', domain: 'a.com', hostOnly: true },
        { name: 'boom', value: 'v', domain: 'b.com', hostOnly: true },
        { name: 'ok2', value: 'v', domain: 'c.com', hostOnly: true },
      ],
      'boom'
    );
    const result = await migrateCookies(env.opts);
    expect(result).toMatchObject({ status: 'migrated', copied: 2, failed: 1 });
    expect(env.set).toHaveBeenCalledTimes(3);
    expect(env.writeFlag).toHaveBeenCalledTimes(1);
  });

  it('copies only once: a second run is a no-op', async () => {
    const env = makeEnv([{ name: 'a', value: 'v', domain: 'a.com', hostOnly: true }]);
    await migrateCookies(env.opts);
    const second = await migrateCookies(env.opts);
    expect(second.status).toBe('already-done');
    expect(env.set).toHaveBeenCalledTimes(1);
    expect(env.get).toHaveBeenCalledTimes(1);
  });

  it('skips file:// and app (loopback) cookies', async () => {
    const env = makeEnv([
      { name: 'f', value: 'v', domain: '' },
      { name: 'l', value: 'v', domain: 'localhost', hostOnly: true },
      { name: 'l2', value: 'v', domain: '127.0.0.1', hostOnly: true },
      { name: 'u', value: 'v', domain: 'site.com', hostOnly: true },
    ]);
    const result = await migrateCookies(env.opts);
    expect(result).toMatchObject({ copied: 1, skipped: 3 });
  });

  it('never logs cookie values and neither copies nor sets the flag when disabled', async () => {
    const env = makeEnv([{ name: 'a', value: SECRET, domain: 'a.com', hostOnly: true }]);
    await migrateCookies(env.opts);
    expect(env.logs.join('\n')).not.toContain(SECRET);
    expect(env.logs.join('\n')).toContain('copied=1');

    const off = makeEnv([{ name: 'a', value: SECRET, domain: 'a.com', hostOnly: true }]);
    const result = await migrateCookies({ ...off.opts, enabled: false });
    expect(result.status).toBe('disabled');
    expect(off.set).not.toHaveBeenCalled();
    expect(off.writeFlag).not.toHaveBeenCalled();
  });
});

describe('web permissions', () => {
  beforeEach(() => resetDeniedPermissionCounts());

  it('allows only the safe set and denies everything else', () => {
    for (const p of ['fullscreen', 'clipboard-sanitized-write', 'pointerLock']) {
      expect(decideWebPermission(p, 'https://a.com').allow).toBe(true);
    }
    for (const p of ['notifications', 'media', 'geolocation', 'clipboard-read', 'midi', 'openExternal', 'made-up']) {
      expect(decideWebPermission(p, 'https://a.com')).toEqual({ allow: false, reason: 'default-deny' });
    }
  });

  it('installs handlers that deny and count per origin', () => {
    let request: ((...args: unknown[]) => void) | undefined;
    let check: ((...args: unknown[]) => boolean) | undefined;
    configureProfilePermissions({
      setPermissionRequestHandler: (h) => {
        request = h as unknown as (...args: unknown[]) => void;
      },
      setPermissionCheckHandler: (h) => {
        check = h as unknown as (...args: unknown[]) => boolean;
      },
    });
    const cb = vi.fn();
    request?.({}, 'notifications', cb, { requestingUrl: 'https://a.com/page' });
    request?.({}, 'fullscreen', cb, { requestingUrl: 'https://a.com/page' });
    expect(cb.mock.calls).toEqual([[false], [true]]);
    expect(check?.({}, 'media', 'https://b.com', {})).toBe(false);
    const counts = getDeniedPermissionCounts();
    expect(counts.get('https://a.com|notifications')).toBe(1);
    expect(counts.get('https://b.com|media')).toBe(1);
    expect(BROWSER_PROFILE_PARTITION).toBe('persist:tomny-browser');
  });
});
