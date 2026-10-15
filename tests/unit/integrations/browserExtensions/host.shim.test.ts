import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ExtensionShimAttachInput, ExtensionShimPort } from '@process/integrations/browserExtensions/api/types';
import {
  createExtensionHostManager,
  extensionKeepKey,
  type ExtensionLoaderPort,
} from '@process/integrations/browserExtensions/host';
import { createExtensionStore } from '@process/integrations/browserExtensions/store';
import { MV3_MANIFEST, createFakeLoader, useTempRoots, writeExtension } from './extensionFixture';

const temp = useTempRoots();
const PACKAGE = 'com.community.ext';
const CONNECTION = 'ublock';

/** Records the order of shim and loader calls, to prove the shim is attached before the extension loads. */
const setup = async () => {
  const root = await temp();
  const fake = createFakeLoader();
  const order: string[] = [];
  const attached = new Map<string, ExtensionShimAttachInput>();
  const shim: ExtensionShimPort = {
    attach: vi.fn((input) => {
      order.push(`attach:${input.extensionId}`);
      attached.set(input.extensionId, input);
    }),
    detach: vi.fn((id) => {
      order.push(`detach:${id}`);
      attached.delete(id);
    }),
  };
  const loader: ExtensionLoaderPort = {
    load: async (directory) => {
      order.push('load');
      return fake.loader.load(directory);
    },
    unload: async (id) => {
      order.push(`unload:${id}`);
      return fake.loader.unload(id);
    },
  };
  const stateFile = path.join(root, 'state.json');
  const workingRoot = path.join(root, 'tomny-extensions');
  const open = async (options: { shim?: ExtensionShimPort; loader?: ExtensionLoaderPort } = {}) => {
    const store = createExtensionStore(stateFile);
    await store.initialize();
    return {
      store,
      manager: createExtensionHostManager({
        loader: options.loader ?? loader,
        store,
        workingRoot,
        shim: 'shim' in options ? options.shim : shim,
        log: () => undefined,
      }),
    };
  };
  const source = await writeExtension(path.join(root, 'pkg', '1.0.0', 'source', 'ext'));
  return { fake, order, attached, shim, open, source, loader };
};

const input = (sourceRoot: string) => ({ packageId: PACKAGE, connectionId: CONNECTION, sourceRoot });

describe('extension host and the Chrome API shim', () => {
  it('attaches the shim with the working-copy manifest before the extension is loaded', async () => {
    const { open, source, order, attached } = await setup();
    const { manager } = await open();
    const { extensionId } = await manager.enable(input(source));
    expect(order).toEqual([`attach:${extensionId}`, 'load']);
    const call = attached.get(extensionId);
    expect(call).toMatchObject({ extensionId, packageId: PACKAGE, connectionId: CONNECTION });
    // The manifest handed over is the one Electron loads: it carries the pinned key.
    expect(call?.manifest).toMatchObject({ name: MV3_MANIFEST.name, permissions: MV3_MANIFEST.permissions });
    expect(call?.manifest).toHaveProperty('key');
  });

  it('detaches when the extension is disabled', async () => {
    const { open, source, order, attached } = await setup();
    const { manager } = await open();
    const { extensionId } = await manager.enable(input(source));
    await manager.disable(PACKAGE, CONNECTION);
    expect(order.at(-2)).toBe(`unload:${extensionId}`);
    expect(order.at(-1)).toBe(`detach:${extensionId}`);
    expect(attached.size).toBe(0);
  });

  it('detaches again when Electron refuses to load the extension', async () => {
    const { open, source, fake, attached } = await setup();
    fake.fail.message = 'Manifest is not valid';
    const { manager } = await open();
    await expect(manager.enable(input(source))).rejects.toThrow(/Manifest is not valid/);
    expect(attached.size).toBe(0);
  });

  it('detaches the expected id when Electron reports a different one', async () => {
    const { open, source, fake, attached } = await setup();
    fake.fail.reportId = 'p'.repeat(32);
    const { manager } = await open();
    await expect(manager.enable(input(source))).rejects.toThrow(/không khớp/);
    expect(attached.size).toBe(0);
  });

  it('refuses to load an extension the shim cannot attach, and loads nothing', async () => {
    const { open, source, fake } = await setup();
    const refusing: ExtensionShimPort = {
      attach: () => {
        throw new Error('manifest cannot be used');
      },
      detach: vi.fn(),
    };
    const { manager, store } = await open({ shim: refusing });
    await expect(manager.enable(input(source))).rejects.toThrow(/lớp API Chrome.*manifest cannot be used/);
    expect(fake.loaded.size).toBe(0);
    expect(store.listLoaded()).toEqual([]);
  });

  it('attaches again for every extension reloaded at startup, and detaches the ones that should go', async () => {
    const { open, source, attached, order } = await setup();
    const first = await open();
    const { extensionId } = await first.manager.enable(input(source));
    attached.clear();
    order.length = 0;

    // A new process: the loader and the shim are empty, the store remembers what was on.
    const second = await open({ loader: createFakeLoader().loader });
    await second.manager.reconcile(new Set([extensionKeepKey(PACKAGE, CONNECTION)]));
    expect([...attached.keys()]).toEqual([extensionId]);

    await second.manager.reconcile(new Set());
    expect(attached.size).toBe(0);
  });

  it('works unchanged without a shim', async () => {
    const { open, source, fake } = await setup();
    const { manager } = await open({ shim: undefined });
    const { extensionId } = await manager.enable(input(source));
    expect(fake.loaded.has(extensionId)).toBe(true);
    await manager.disable(PACKAGE, CONNECTION);
    expect(fake.loaded.size).toBe(0);
  });
});
