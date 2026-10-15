import { describe, expect, it } from 'vitest';
import {
  INTERNAL_DNR_PLAN_METHOD,
  SHIM_EVENT_NAMES,
  SHIM_NAMESPACES,
  methodName,
} from '@process/integrations/browserExtensions/api/contract';
import { createDialogPermissionPrompt } from '@process/integrations/browserExtensions/api/groups/permissionPrompt';
import { shimWith } from './shimFixture';

describe('preload spec and router agree', () => {
  const served = shimWith({}).router.methodNames();

  it('serves every method the preload installs', () => {
    const wanted = SHIM_NAMESPACES.flatMap((namespace) =>
      namespace.methods.map((member) => methodName(namespace.path, member))
    );
    expect(wanted.length).toBeGreaterThan(0);
    expect(served).toEqual(expect.arrayContaining(wanted));
  });

  it('installs everything the router serves, except the internal calls', () => {
    const installed = new Set(
      SHIM_NAMESPACES.flatMap((namespace) => namespace.methods.map((member) => methodName(namespace.path, member)))
    );
    const extras = served.filter((name) => !installed.has(name));
    expect(extras).toEqual([INTERNAL_DNR_PLAN_METHOD]);
  });

  it('never exposes the internal call as a chrome.* member', () => {
    expect(INTERNAL_DNR_PLAN_METHOD.startsWith('tomny.')).toBe(true);
    expect(SHIM_NAMESPACES.map((namespace) => namespace.path)).not.toContain('tomny');
  });

  it('names its events by namespace', () => {
    expect(SHIM_EVENT_NAMES.toSorted()).toEqual(
      [
        'permissions.onAdded',
        'permissions.onRemoved',
        'tabs.onCreated',
        'tabs.onUpdated',
        'tabs.onRemoved',
        'tabs.onActivated',
        'contextMenus.onClicked',
        'action.onClicked',
        'cookies.onChanged',
        'windows.onFocusChanged',
        'notifications.onClicked',
        'webNavigation.onBeforeNavigate',
        'webNavigation.onCommitted',
        'webNavigation.onDOMContentLoaded',
        'webNavigation.onCompleted',
        'downloads.onCreated',
        'downloads.onChanged',
        'commands.onCommand',
      ].toSorted()
    );
  });

  it('only replaces members the namespace declares', () => {
    for (const namespace of SHIM_NAMESPACES) {
      const declared = [...namespace.methods, ...namespace.events];
      expect(declared).toEqual(expect.arrayContaining([...(namespace.replace ?? [])]));
    }
  });

  it('never installs a member for an API the design leaves out of v1', () => {
    const paths = SHIM_NAMESPACES.map((namespace) => namespace.path);
    for (const left of ['webRequest', 'history', 'bookmarks', 'identity', 'sidePanel', 'offscreen', 'debugger']) {
      expect(paths).not.toContain(left);
    }
  });
});

const RLO = String.fromCharCode(0x202e);

describe('native permission prompt', () => {
  const ask = async (response: number, request = {}) => {
    const shown: Record<string, unknown>[] = [];
    const prompt = createDialogPermissionPrompt(async (box) => {
      shown.push({ ...box });
      return { response };
    });
    const answer = await prompt.ask({
      extensionId: 'a'.repeat(32),
      extensionName: 'Fixture',
      permissions: ['cookies'],
      origins: ['https://optional.test/*'],
      ...request,
    });
    return { answer, box: shown[0] };
  };

  it('allows only on the explicit allow button, with refusal as default and cancel', async () => {
    const allowed = await ask(0);
    expect(allowed.answer).toBe(true);
    expect(allowed.box).toMatchObject({ defaultId: 1, cancelId: 1, noLink: true, buttons: ['Cho phép', 'Từ chối'] });
    expect((await ask(1)).answer).toBe(false);
    expect((await ask(-1)).answer).toBe(false);
  });

  it('lists what is asked for', async () => {
    const { box } = await ask(1);
    expect(String(box?.detail)).toContain('cookies');
    expect(String(box?.detail)).toContain('https://optional.test/*');
    expect(String(box?.message)).toContain('Fixture');
  });

  it('cleans an extension name and permission strings that come from a manifest', async () => {
    const { box } = await ask(1, {
      extensionName: `Evil\u0000${RLO}\nName`.padEnd(500, 'x'),
      permissions: Array.from({ length: 40 }, (_, index) => `perm\u0007${index}`),
      origins: [],
    });
    const text = `${String(box?.message)}${String(box?.detail)}`;
    expect(Array.from(text).some((char) => char.charCodeAt(0) < 9 || char === RLO)).toBe(false);
    expect(String(box?.message).length).toBeLessThan(160);
    expect(String(box?.detail)).toContain('và 28 mục khác');
  });

  it('shows no section for an empty list', async () => {
    const { box } = await ask(1, { permissions: [] });
    expect(String(box?.detail)).not.toContain('Quyền:');
    expect(String(box?.detail)).toContain('Truy cập trang web:');
  });
});
