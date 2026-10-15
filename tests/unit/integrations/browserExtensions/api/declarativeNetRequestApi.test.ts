import { describe, expect, it } from 'vitest';
import { INTERNAL_DNR_PLAN_METHOD } from '@process/integrations/browserExtensions/api/contract';
import { ID_A, ID_B, call, manifestOf, pageOf, shimWith, workerOf } from './shimFixture';

const dnr = (extra: Record<string, unknown> = {}) => manifestOf({ permissions: ['declarativeNetRequest'], ...extra });

describe('declarativeNetRequest static ruleset plan', () => {
  it('lists the enabled rulesets of the extension that is calling', async () => {
    const shim = shimWith({
      [ID_A]: dnr(),
      [ID_B]: dnr({
        declarative_net_request: { rule_resources: [{ id: 'other', enabled: true, path: 'o.json' }] },
      }),
    });
    expect(await call(shim, workerOf(ID_A), INTERNAL_DNR_PLAN_METHOD)).toEqual({
      ok: true,
      value: { enableRulesetIds: ['ads'] },
    });
    // The other extension gets its own list; ids never cross over.
    expect(await call(shim, workerOf(ID_B), INTERNAL_DNR_PLAN_METHOD)).toEqual({
      ok: true,
      value: { enableRulesetIds: ['other'] },
    });
  });

  it('is denied when the approved manifest has no declarativeNetRequest permission', async () => {
    const shim = shimWith({ [ID_A]: manifestOf({ permissions: ['storage'] }) });
    expect(await call(shim, workerOf(ID_A), INTERNAL_DNR_PLAN_METHOD)).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED',
    });
  });

  it('accepts declarativeNetRequestWithHostAccess instead', async () => {
    const shim = shimWith({ [ID_A]: manifestOf({ permissions: ['declarativeNetRequestWithHostAccess'] }) });
    expect(await call(shim, workerOf(ID_A), INTERNAL_DNR_PLAN_METHOD)).toMatchObject({ ok: true });
  });

  it('cannot be called from an extension page', async () => {
    const shim = shimWith({ [ID_A]: dnr() });
    expect(await call(shim, pageOf(ID_A), INTERNAL_DNR_PLAN_METHOD)).toMatchObject({
      ok: false,
      code: 'INVALID_CALLER',
    });
  });

  it('is denied for a worker that is not a loaded extension', async () => {
    const shim = shimWith({ [ID_A]: dnr() });
    expect(
      await call(shim, { kind: 'service-worker', scope: 'https://example.com/' }, INTERNAL_DNR_PLAN_METHOD)
    ).toMatchObject({ ok: false, code: 'INVALID_CALLER' });
  });

  it('refuses arguments, since the plan depends on nothing the extension sends', async () => {
    const shim = shimWith({ [ID_A]: dnr() });
    expect(await call(shim, workerOf(ID_A), INTERNAL_DNR_PLAN_METHOD, { enableRulesetIds: ['x'] })).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
  });

  it('gives an empty plan when no ruleset is enabled by default', async () => {
    const shim = shimWith({
      [ID_A]: dnr({ declarative_net_request: { rule_resources: [{ id: 'off', enabled: false, path: 'o.json' }] } }),
    });
    expect(await call(shim, workerOf(ID_A), INTERNAL_DNR_PLAN_METHOD)).toEqual({
      ok: true,
      value: { enableRulesetIds: [] },
    });
  });
});
