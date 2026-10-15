import { describe, expect, it, vi } from 'vitest';
import type {
  PermissionPromptPort,
  PermissionPromptRequest,
} from '@process/integrations/browserExtensions/api/groups/permissions';
import type { ExtensionEvent } from '@process/integrations/browserExtensions/api/types';
import { ID_A, ID_B, call, manifestOf, pageOf, shimWith, workerOf } from './shimFixture';

const answering = (answer: boolean) => {
  const asked: PermissionPromptRequest[] = [];
  const prompt: PermissionPromptPort = {
    ask: async (request) => {
      asked.push(request);
      return answer;
    },
  };
  return { prompt, asked };
};

const setup = (answer = true) => {
  const { prompt, asked } = answering(answer);
  const shim = shimWith(
    { [ID_A]: manifestOf(), [ID_B]: manifestOf({ optional_permissions: ['cookies'] }) },
    { prompt }
  );
  const events: ExtensionEvent[] = [];
  shim.events.subscribe((event) => events.push(event));
  return { shim, asked, events };
};

describe('chrome.permissions', () => {
  it('getAll lists what the manifest approved', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'permissions.getAll')).toEqual({
      ok: true,
      value: { permissions: ['storage'], origins: ['https://*.example.com/*'] },
    });
  });

  it('contains answers from the extension that is calling, never from another one', async () => {
    const { shim } = setup();
    expect(await call(shim, workerOf(ID_A), 'permissions.contains', { permissions: ['storage'] })).toEqual({
      ok: true,
      value: true,
    });
    expect(await call(shim, workerOf(ID_A), 'permissions.contains', { origins: ['https://a.example.com/*'] })).toEqual({
      ok: true,
      value: true,
    });
    expect(await call(shim, workerOf(ID_A), 'permissions.contains', { permissions: ['cookies'] })).toEqual({
      ok: true,
      value: false,
    });
    expect(
      await call(shim, workerOf(ID_A), 'permissions.contains', {
        permissions: ['storage'],
        origins: ['https://x.test/*'],
      })
    ).toEqual({ ok: true, value: false });
    expect(await call(shim, pageOf(ID_A), 'permissions.contains', {})).toEqual({ ok: true, value: true });
  });

  it('refuses a malformed details object', async () => {
    const { shim } = setup();
    const results = await Promise.all(
      [{ permissions: ['bad name'] }, { origins: ['nonsense'] }, { extensionId: ID_B }, { permissions: 'storage' }].map(
        (details) => call(shim, workerOf(ID_A), 'permissions.contains', details)
      )
    );
    for (const result of results) expect(result).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' });
    expect(await call(shim, workerOf(ID_A), 'permissions.contains')).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
  });

  it('request grants an optional permission after the person says yes, and emits onAdded to that extension', async () => {
    const { shim, asked, events } = setup(true);
    const result = await call(shim, pageOf(ID_A), 'permissions.request', {
      permissions: ['cookies'],
      origins: ['https://optional.test/*'],
    });
    expect(result).toEqual({ ok: true, value: true });
    expect(asked).toEqual([
      {
        extensionId: ID_A,
        extensionName: 'Fixture',
        permissions: ['cookies'],
        origins: ['https://optional.test/*'],
      },
    ]);
    expect(events).toEqual([
      {
        extensionId: ID_A,
        name: 'permissions.onAdded',
        payload: { permissions: ['cookies'], origins: ['https://optional.test/*'] },
      },
    ]);
    expect(shim.grants.get(ID_A)?.hasPermission('cookies')).toBe(true);
    // The grant belongs to extension A only.
    expect(shim.grants.get(ID_B)?.hasPermission('cookies')).toBe(false);
  });

  it('request answers false and grants nothing when the person says no', async () => {
    const { shim, events } = setup(false);
    expect(await call(shim, pageOf(ID_A), 'permissions.request', { permissions: ['cookies'] })).toEqual({
      ok: true,
      value: false,
    });
    expect(shim.grants.get(ID_A)?.hasPermission('cookies')).toBe(false);
    expect(events).toEqual([]);
  });

  it('request treats a prompt that throws as a refusal', async () => {
    const shim = shimWith(
      { [ID_A]: manifestOf() },
      {
        prompt: {
          ask: async () => {
            throw new Error('dialog failed');
          },
        },
      }
    );
    expect(await call(shim, pageOf(ID_A), 'permissions.request', { permissions: ['cookies'] })).toEqual({
      ok: true,
      value: false,
    });
  });

  it('request refuses to ask for anything the manifest did not declare', async () => {
    const { shim, asked } = setup(true);
    const results = await Promise.all(
      [
        { permissions: ['history'] },
        { origins: ['https://elsewhere.test/*'] },
        { permissions: ['cookies', 'history'] },
      ].map((details) => call(shim, pageOf(ID_A), 'permissions.request', details))
    );
    for (const result of results) expect(result).toMatchObject({ ok: false, code: 'REJECTED' });
    expect(asked).toEqual([]);
  });

  it('request answers true without asking when everything is already granted', async () => {
    const { shim, asked } = setup(false);
    expect(
      await call(shim, pageOf(ID_A), 'permissions.request', {
        permissions: ['storage'],
        origins: ['https://x.example.com/*'],
      })
    ).toEqual({ ok: true, value: true });
    expect(asked).toEqual([]);
  });

  it('request asks only for the missing items', async () => {
    const { shim, asked } = setup(true);
    await call(shim, pageOf(ID_A), 'permissions.request', { permissions: ['storage', 'downloads'] });
    expect(asked[0]?.permissions).toEqual(['downloads']);
  });

  it('request allows one open question per extension', async () => {
    const open: ((answer: boolean) => void)[] = [];
    const prompt: PermissionPromptPort = {
      ask: () =>
        new Promise<boolean>((resolve) => {
          open.push(resolve);
        }),
    };
    const shim = shimWith({ [ID_A]: manifestOf() }, { prompt });
    const first = call(shim, pageOf(ID_A), 'permissions.request', { permissions: ['cookies'] });
    expect(await call(shim, pageOf(ID_A), 'permissions.request', { permissions: ['downloads'] })).toMatchObject({
      ok: false,
      code: 'BUSY',
    });
    open.shift()?.(true);
    expect(await first).toEqual({ ok: true, value: true });
    // The slot is free again.
    const second = call(shim, pageOf(ID_A), 'permissions.request', { permissions: ['downloads'] });
    open.shift()?.(false);
    expect(await second).toEqual({ ok: true, value: false });
  });

  it('refuses everything by default when no prompt is wired', async () => {
    const shim = shimWith({ [ID_A]: manifestOf() });
    expect(await call(shim, pageOf(ID_A), 'permissions.request', { permissions: ['cookies'] })).toEqual({
      ok: true,
      value: false,
    });
  });

  it('remove takes back a granted optional permission and emits onRemoved', async () => {
    const { shim, events } = setup(true);
    await call(shim, pageOf(ID_A), 'permissions.request', { permissions: ['cookies'] });
    events.length = 0;
    expect(await call(shim, workerOf(ID_A), 'permissions.remove', { permissions: ['cookies'] })).toEqual({
      ok: true,
      value: true,
    });
    expect(events).toEqual([
      { extensionId: ID_A, name: 'permissions.onRemoved', payload: { permissions: ['cookies'], origins: [] } },
    ]);
    expect(shim.grants.get(ID_A)?.hasPermission('cookies')).toBe(false);
  });

  it('remove refuses a permission the manifest requires', async () => {
    const { shim, events } = setup(true);
    expect(await call(shim, workerOf(ID_A), 'permissions.remove', { permissions: ['storage'] })).toEqual({
      ok: false,
      code: 'REJECTED',
      message: 'You cannot remove required permissions.',
    });
    expect(
      await call(shim, workerOf(ID_A), 'permissions.remove', { origins: ['https://a.example.com/*'] })
    ).toMatchObject({
      ok: false,
      code: 'REJECTED',
    });
    expect(shim.grants.get(ID_A)?.hasPermission('storage')).toBe(true);
    expect(events).toEqual([]);
  });

  it('remove answers false for something that was never granted', async () => {
    const { shim, events } = setup(true);
    expect(await call(shim, workerOf(ID_A), 'permissions.remove', { permissions: ['cookies'] })).toEqual({
      ok: true,
      value: false,
    });
    expect(events).toEqual([]);
  });

  it('an extension cannot remove or request on behalf of another one', async () => {
    const { shim } = setup(true);
    await call(shim, pageOf(ID_B), 'permissions.request', { permissions: ['cookies'] });
    expect(shim.grants.get(ID_B)?.hasPermission('cookies')).toBe(true);
    // A removes "cookies": A never held it, so nothing changes for B.
    expect(await call(shim, workerOf(ID_A), 'permissions.remove', { permissions: ['cookies'] })).toEqual({
      ok: true,
      value: false,
    });
    expect(shim.grants.get(ID_B)?.hasPermission('cookies')).toBe(true);
  });

  it('writes request and remove to the audit log without their values', async () => {
    const audit = vi.fn();
    const shim = shimWith({ [ID_A]: manifestOf() }, { prompt: { ask: async () => true }, audit });
    await call(shim, pageOf(ID_A), 'permissions.request', { permissions: ['cookies'] });
    await call(shim, pageOf(ID_A), 'permissions.remove', { permissions: ['cookies'] });
    await call(shim, pageOf(ID_A), 'permissions.contains', { permissions: ['cookies'] });
    expect(audit.mock.calls.map(([entry]) => `${entry.method}:${entry.outcome}`)).toEqual([
      'permissions.request:ok',
      'permissions.remove:ok',
    ]);
    expect(JSON.stringify(audit.mock.calls)).not.toContain('cookies');
  });

  it('keeps an optional grant across a detach and attach of the same extension when a store is given', async () => {
    const saved = new Map<string, { permissions: readonly string[]; origins: readonly string[] }>();
    const shim = shimWith(
      { [ID_A]: manifestOf() },
      {
        prompt: { ask: async () => true },
        optionalGrants: { read: (id) => saved.get(id), write: (id, grant) => void saved.set(id, grant) },
      }
    );
    await call(shim, pageOf(ID_A), 'permissions.request', { permissions: ['cookies'] });
    shim.port.detach(ID_A);
    shim.port.attach({ extensionId: ID_A, packageId: 'p', connectionId: 'c', manifest: manifestOf() });
    expect(shim.grants.get(ID_A)?.hasPermission('cookies')).toBe(true);
    // A manifest that no longer declares it as optional drops it.
    shim.port.attach({
      extensionId: ID_A,
      packageId: 'p',
      connectionId: 'c',
      manifest: manifestOf({ optional_permissions: [] }),
    });
    expect(shim.grants.get(ID_A)?.hasPermission('cookies')).toBe(false);
  });
});
