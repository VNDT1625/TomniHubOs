import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MAX_IN_FLIGHT_PER_EXTENSION } from '@process/integrations/browserExtensions/api/contract';
import { createGrantRegistry, grantSeedFromManifest } from '@process/integrations/browserExtensions/api/grants';
import { createApiRouter, type ApiAuditEntry } from '@process/integrations/browserExtensions/api/router';
import { ApiError, defineApiMethod } from '@process/integrations/browserExtensions/api/types';
import { ID_A, ID_B, manifestOf, pageOf, workerOf } from './shimFixture';

const setup = (permissionsOf: Readonly<Record<string, readonly string[]>> = { [ID_A]: ['cookies'], [ID_B]: [] }) => {
  const grants = createGrantRegistry({ log: () => undefined });
  for (const [id, permissions] of Object.entries(permissionsOf)) {
    const seed = grantSeedFromManifest(
      { extensionId: id, packageId: 'pkg', connectionId: 'conn' },
      manifestOf({ permissions })
    );
    if (seed) grants.register(seed);
  }
  const audit = vi.fn<(entry: ApiAuditEntry) => void>();
  const seen: string[] = [];
  const gate = { resolvers: [] as (() => void)[] };
  const methods = [
    // Reports who the router says is calling and which permissions that extension has: the only identity a method sees.
    defineApiMethod({
      name: 'test.whoami',
      callers: ['service-worker', 'frame'],
      args: z.tuple([]),
      handle: (context) => ({
        id: context.extensionId,
        caller: context.caller,
        cookies: context.grants.hasPermission('cookies'),
      }),
    }),
    defineApiMethod({
      name: 'test.cookies',
      callers: ['service-worker', 'frame'],
      requires: ['cookies'],
      audit: true,
      args: z.tuple([z.object({ url: z.string() }).strict()]),
      handle: (context, [details]) => {
        seen.push(`${context.extensionId}:${details.url}`);
        return details.url;
      },
    }),
    defineApiMethod({ name: 'test.workerOnly', callers: ['service-worker'], args: z.tuple([]), handle: () => 'ok' }),
    defineApiMethod({
      name: 'test.leaky',
      callers: ['frame'],
      audit: true,
      args: z.tuple([]),
      handle: () => {
        throw new Error('C:\\Users\\secret\\path failed');
      },
    }),
    defineApiMethod({
      name: 'test.rejects',
      callers: ['frame'],
      args: z.tuple([]),
      handle: () => {
        throw new ApiError('REJECTED', 'Not allowed here.');
      },
    }),
    defineApiMethod({
      name: 'test.slow',
      callers: ['frame'],
      args: z.tuple([]),
      handle: () =>
        new Promise<string>((resolve) => {
          gate.resolvers.push(() => resolve('done'));
        }),
    }),
    defineApiMethod({ name: 'test.nothing', callers: ['frame'], args: z.tuple([]), handle: () => undefined }),
  ];
  const router = createApiRouter({ grants, methods, audit });
  return { router, grants, audit, seen, gate };
};

describe('API router identity', () => {
  it('takes the extension id from the service worker scope', async () => {
    const { router } = setup();
    expect(await router.handle(workerOf(ID_A), { method: 'test.whoami', args: [] })).toEqual({
      ok: true,
      value: { id: ID_A, caller: 'service-worker', cookies: true },
    });
    expect(await router.handle(workerOf(ID_B), { method: 'test.whoami', args: [] })).toEqual({
      ok: true,
      value: { id: ID_B, caller: 'service-worker', cookies: false },
    });
  });

  it('takes the extension id from the sending frame URL', async () => {
    const { router } = setup();
    expect(await router.handle(pageOf(ID_B), { method: 'test.whoami', args: [] })).toEqual({
      ok: true,
      value: { id: ID_B, caller: 'frame', cookies: false },
    });
  });

  it('ignores an id smuggled into the envelope or the arguments, and refuses extra envelope keys', async () => {
    const { router, seen } = setup();
    const withEnvelopeId = await router.handle(workerOf(ID_B), { method: 'test.whoami', args: [], extensionId: ID_A });
    expect(withEnvelopeId).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });

    const withArgId = await router.handle(workerOf(ID_B), { method: 'test.whoami', args: [{ extensionId: ID_A }] });
    expect(withArgId).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' });

    // Extension B has no cookies permission, so naming extension A does not help it.
    const stolen = await router.handle(workerOf(ID_B), {
      method: 'test.cookies',
      args: [{ url: 'https://a.test/', extensionId: ID_A }],
    });
    expect(stolen).toMatchObject({ ok: false });
    expect(seen).toEqual([]);
  });

  it.each([
    ['a web page', { kind: 'frame', url: 'https://example.com/' }],
    ['a web service worker', { kind: 'service-worker', scope: 'https://example.com/' }],
    ['an extension that is not loaded', { kind: 'frame', url: `chrome-extension://${'c'.repeat(32)}/popup.html` }],
    ['a malformed extension origin', { kind: 'frame', url: `chrome-extension://${ID_A.toUpperCase()}/popup.html` }],
  ] as const)('refuses %s', async (_name, source) => {
    const { router } = setup();
    expect(await router.handle(source, { method: 'test.whoami', args: [] })).toMatchObject({
      ok: false,
      code: 'INVALID_CALLER',
    });
  });

  it('stops answering an extension once it is unregistered', async () => {
    const { router, grants } = setup();
    grants.unregister(ID_A);
    expect(await router.handle(workerOf(ID_A), { method: 'test.whoami', args: [] })).toMatchObject({
      ok: false,
      code: 'INVALID_CALLER',
    });
  });
});

describe('API router permissions', () => {
  it('denies a call when the approved permissions do not include what the method needs', async () => {
    const { router, audit, seen } = setup();
    const result = await router.handle(workerOf(ID_B), { method: 'test.cookies', args: [{ url: 'https://a.test/' }] });
    expect(result).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(seen).toEqual([]);
    expect(audit).toHaveBeenCalledWith({
      extensionId: ID_B,
      method: 'test.cookies',
      outcome: 'denied',
      code: 'PERMISSION_DENIED',
    });
  });

  it('allows the same call for the extension that holds the permission, and audits it without values', async () => {
    const { router, audit, seen } = setup();
    const result = await router.handle(pageOf(ID_A), { method: 'test.cookies', args: [{ url: 'https://a.test/' }] });
    expect(result).toEqual({ ok: true, value: 'https://a.test/' });
    expect(seen).toEqual([`${ID_A}:https://a.test/`]);
    expect(audit).toHaveBeenCalledWith({ extensionId: ID_A, method: 'test.cookies', outcome: 'ok' });
    expect(JSON.stringify(audit.mock.calls)).not.toContain('a.test');
  });

  it('refuses a caller kind the method does not accept', async () => {
    const { router } = setup();
    expect(await router.handle(pageOf(ID_A), { method: 'test.workerOnly', args: [] })).toMatchObject({
      ok: false,
      code: 'INVALID_CALLER',
    });
    expect(await router.handle(workerOf(ID_A), { method: 'test.workerOnly', args: [] })).toEqual({
      ok: true,
      value: 'ok',
    });
  });
});

describe('API router requests and errors', () => {
  it.each([
    ['not an object', 'hello'],
    ['null', null],
    ['no method', { args: [] }],
    ['no args', { method: 'test.whoami' }],
    ['args that are not an array', { method: 'test.whoami', args: {} }],
    ['too many args', { method: 'test.whoami', args: Array.from({ length: 9 }, () => 0) }],
    ['a method name that is too long', { method: 'x'.repeat(200), args: [] }],
    ['an oversized payload', { method: 'test.whoami', args: ['y'.repeat(70_000)] }],
  ])('refuses a malformed request: %s', async (_name, envelope) => {
    const { router } = setup();
    expect(await router.handle(workerOf(ID_A), envelope)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('refuses an unknown method', async () => {
    const { router } = setup();
    expect(await router.handle(workerOf(ID_A), { method: 'tabs.create', args: [] })).toMatchObject({
      ok: false,
      code: 'UNKNOWN_METHOD',
    });
  });

  it('refuses arguments that fail the strict schema', async () => {
    const { router } = setup();
    const results = await Promise.all(
      [[], [{}], [{ url: 1 }], [{ url: 'x', more: 1 }], [{ url: 'x' }, 'extra']].map((args) =>
        router.handle(workerOf(ID_A), { method: 'test.cookies', args })
      )
    );
    for (const result of results) expect(result).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' });
  });

  it('keeps internal error text away from the extension', async () => {
    const { router, audit } = setup();
    const result = await router.handle(pageOf(ID_A), { method: 'test.leaky', args: [] });
    expect(result).toEqual({ ok: false, code: 'FAILED', message: 'The extension API call failed.' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(audit).toHaveBeenCalledWith({ extensionId: ID_A, method: 'test.leaky', outcome: 'error', code: 'FAILED' });
  });

  it('passes an ApiError code and message through', async () => {
    const { router } = setup();
    expect(await router.handle(pageOf(ID_A), { method: 'test.rejects', args: [] })).toEqual({
      ok: false,
      code: 'REJECTED',
      message: 'Not allowed here.',
    });
  });

  it('turns an undefined result into null so it survives structured clone', async () => {
    const { router } = setup();
    expect(await router.handle(pageOf(ID_A), { method: 'test.nothing', args: [] })).toEqual({ ok: true, value: null });
  });

  it('bounds the calls in flight per extension and frees the slots afterwards', async () => {
    const { router, gate } = setup();
    const open = Array.from({ length: MAX_IN_FLIGHT_PER_EXTENSION }, () =>
      router.handle(pageOf(ID_A), { method: 'test.slow', args: [] })
    );
    expect(await router.handle(pageOf(ID_A), { method: 'test.slow', args: [] })).toMatchObject({
      ok: false,
      code: 'BUSY',
    });
    // Another extension is not slowed down by it.
    expect(await router.handle(pageOf(ID_B), { method: 'test.whoami', args: [] })).toMatchObject({ ok: true });
    for (const release of gate.resolvers) release();
    expect((await Promise.all(open)).every((result) => result.ok)).toBe(true);
    expect(await router.handle(pageOf(ID_A), { method: 'test.whoami', args: [] })).toMatchObject({ ok: true });
  });

  it('does not let an audit sink that throws change the answer', async () => {
    const grants = createGrantRegistry({ log: () => undefined });
    const seed = grantSeedFromManifest(
      { extensionId: ID_A, packageId: 'pkg', connectionId: 'conn' },
      manifestOf({ permissions: ['cookies'] })
    );
    if (seed) grants.register(seed);
    const router = createApiRouter({
      grants,
      methods: [
        defineApiMethod({ name: 'test.audited', callers: ['frame'], audit: true, args: z.tuple([]), handle: () => 1 }),
      ],
      audit: () => {
        throw new Error('sink down');
      },
    });
    expect(await router.handle(pageOf(ID_A), { method: 'test.audited', args: [] })).toEqual({ ok: true, value: 1 });
  });

  it('rejects two methods with the same name', () => {
    const method = defineApiMethod({ name: 'dup.a', callers: ['frame'], args: z.tuple([]), handle: () => 1 });
    expect(() => createApiRouter({ grants: createGrantRegistry(), methods: [method, method] })).toThrow(/Duplicate/);
  });
});
