import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserControlServer,
  type BrowserControlDeps,
  type BrowserExtensionControl,
  type BrowserExtensionPopupResult,
  type BrowserExtensionSummary,
} from '@process/browser/browserControlServer';

const LOADED_ID = 'abcdefghijklmnopabcdefghijklmnop';

const summary = (overrides: Partial<BrowserExtensionSummary> = {}): BrowserExtensionSummary => ({
  extensionId: LOADED_ID,
  packageId: 'com.example.blocker',
  connectionId: 'ext-main',
  name: 'Blocker',
  version: '1.2.0',
  enabled: true,
  loaded: true,
  pinned: null,
  permissions: ['storage'],
  hostPermissions: ['<all_urls>'],
  lastError: null,
  ...overrides,
});

const makeControl = (
  items: BrowserExtensionSummary[] = [summary()],
  popup: BrowserExtensionPopupResult = { ok: true }
): { control: BrowserExtensionControl; openPopup: ReturnType<typeof vi.fn> } => {
  const openPopup = vi.fn(async () => popup);
  const control: BrowserExtensionControl = {
    list: vi.fn(async () => items),
    openPopup: openPopup as BrowserExtensionControl['openPopup'],
  };
  return { control, openPopup };
};

const connect = async (extensions?: BrowserExtensionControl): Promise<Client> => {
  const deps = {
    viewManager: {},
    createInput: vi.fn(),
    pagePerception: {},
    mediaPipeline: {},
    coordinator: {},
    ...(extensions === undefined ? {} : { extensions }),
  } as unknown as BrowserControlDeps;
  const server = createBrowserControlServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'browser-extension-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
};

const textOf = (result: unknown): string => {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((item) => item.text ?? '').join('\n');
};

const callAction = (client: Client, args: Record<string, unknown>) =>
  client.callTool({ name: 'browser_extension_action', arguments: args });

describe('browserControlServer extension tools', () => {
  it('keeps the extension tools hidden when no extension control is injected', async () => {
    const client = await connect();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names.some((name) => name.startsWith('browser_extension_'))).toBe(false);
  });

  it('offers both tools when the extension control is injected', async () => {
    const client = await connect(makeControl().control);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['browser_extension_list', 'browser_extension_action']));
  });

  it('lists the extensions as JSON without changing anything', async () => {
    const { control, openPopup } = makeControl([
      summary(),
      summary({ connectionId: 'ext-2', loaded: false, extensionId: null, enabled: false }),
    ]);
    const client = await connect(control);
    const result = await client.callTool({ name: 'browser_extension_list', arguments: {} });
    expect(result.isError).not.toBe(true);
    const parsed = JSON.parse(textOf(result)) as { extensions: BrowserExtensionSummary[] };
    expect(parsed.extensions).toHaveLength(2);
    expect(parsed.extensions[0]).toMatchObject({ extensionId: LOADED_ID, enabled: true, loaded: true, pinned: null });
    expect(parsed.extensions[1]).toMatchObject({ extensionId: null, enabled: false, loaded: false });
    expect(openPopup).not.toHaveBeenCalled();
  });

  it('reports an error when listing fails', async () => {
    const control: BrowserExtensionControl = {
      list: vi.fn(async () => {
        throw new Error('registry down');
      }),
      openPopup: vi.fn(async () => ({ ok: true as const })),
    };
    const client = await connect(control);
    const result = await client.callTool({ name: 'browser_extension_list', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('registry down');
  });

  it('answers enable of an off extension with needs_human_approval and changes nothing', async () => {
    const { control, openPopup } = makeControl([summary({ enabled: false, loaded: false, extensionId: null })]);
    const client = await connect(control);
    const result = await callAction(client, {
      action: 'enable',
      packageId: 'com.example.blocker',
      connectionId: 'ext-main',
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toMatchObject({ status: 'needs_human_approval', action: 'enable' });
    expect(openPopup).not.toHaveBeenCalled();
  });

  it('answers disable of an on extension with needs_human_approval and changes nothing', async () => {
    const { control } = makeControl();
    const client = await connect(control);
    const result = await callAction(client, { action: 'disable', extensionId: LOADED_ID });
    expect(JSON.parse(textOf(result))).toMatchObject({ status: 'needs_human_approval', action: 'disable' });
  });

  it('says no_change when the extension is already in the requested state', async () => {
    const { control } = makeControl();
    const client = await connect(control);
    const result = await callAction(client, { action: 'enable', extensionId: LOADED_ID });
    expect(JSON.parse(textOf(result))).toMatchObject({ status: 'no_change' });
  });

  it('opens the popup of a loaded extension, for the tab it was given', async () => {
    const { control, openPopup } = makeControl();
    const client = await connect(control);
    const result = await callAction(client, { action: 'open-popup', extensionId: LOADED_ID, tabId: 'tab-7' });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toMatchObject({ status: 'popup_requested', extensionId: LOADED_ID });
    expect(openPopup).toHaveBeenCalledWith(LOADED_ID, 'tab-7');
  });

  it('refuses to open a popup for an extension that is not loaded', async () => {
    const { control, openPopup } = makeControl([summary({ loaded: false, extensionId: null })]);
    const client = await connect(control);
    const result = await callAction(client, {
      action: 'open-popup',
      packageId: 'com.example.blocker',
      connectionId: 'ext-main',
    });
    expect(result.isError).toBe(true);
    expect(openPopup).not.toHaveBeenCalled();
  });

  it('passes on the reason when the toolbar cannot open the popup', async () => {
    const { control } = makeControl([summary()], { ok: false, reason: 'no toolbar' });
    const client = await connect(control);
    const result = await callAction(client, { action: 'open-popup', extensionId: LOADED_ID });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('no toolbar');
  });

  it('needs an identifier, and refuses an unknown one', async () => {
    const { control } = makeControl();
    const client = await connect(control);
    expect((await callAction(client, { action: 'enable', packageId: 'com.example.blocker' })).isError).toBe(true);
    const unknown = await callAction(client, { action: 'disable', extensionId: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('No browser extension matches');
  });
});
