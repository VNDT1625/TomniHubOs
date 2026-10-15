import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import type { ExtensionLoaderPort } from '@process/integrations/browserExtensions/host';
import { extensionIdFromKey } from '@process/integrations/browserExtensions/workingCopy';

const roots: string[] = [];

/** Registers a temp-directory cleanup for the calling test file. */
export const useTempRoots = (): (() => Promise<string>) => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
  return async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-ext-'));
    roots.push(root);
    return root;
  };
};

export const MV3_MANIFEST = {
  manifest_version: 3,
  name: 'Fixture',
  version: '1.0.0',
  background: { service_worker: 'sw.js' },
  permissions: ['storage', 'alarms'],
  host_permissions: ['https://*.example.com/*'],
  content_scripts: [{ matches: ['https://news.example.org/*'], js: ['content.js'] }],
  action: { default_popup: 'popup.html' },
};

/** Writes a small built extension (manifest, service worker, content script, popup, icon) and returns its folder. */
export const writeExtension = async (
  directory: string,
  manifest: Record<string, unknown> = MV3_MANIFEST,
  files: Record<string, string> = {}
): Promise<string> => {
  await mkdir(directory, { recursive: true });
  const all: Record<string, string> = {
    'sw.js': 'self.addEventListener("install", () => {});',
    'content.js': 'document.title += "!";',
    'popup.html': '<script src="popup.js"></script>',
    'popup.js': 'console.log("popup");',
    'icons/icon.png': 'not-really-a-png',
    ...files,
  };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  await Promise.all(
    Object.entries(all).map(async ([name, content]) => {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), content);
    })
  );
  return directory;
};

export type FakeLoader = Readonly<{
  loader: ExtensionLoaderPort;
  /** extension id -> folder it was loaded from. */
  loaded: Map<string, string>;
  /** extension id -> data an extension stored; survives unload and reload, like a profile session's storage. */
  storage: Map<string, Record<string, string>>;
  fail: { message?: string; reportId?: string };
}>;

/**
 * Stands in for `session.extensions`: derives the id like Electron does (from the manifest `key`, else from the
 * folder path) and refuses to load the same id twice.
 */
export const createFakeLoader = (): FakeLoader => {
  const loaded = new Map<string, string>();
  const storage = new Map<string, Record<string, string>>();
  const fail: { message?: string; reportId?: string } = {};
  const loader: ExtensionLoaderPort = {
    load: async (directory) => {
      if (fail.message !== undefined) throw new Error(fail.message);
      const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as {
        key?: string;
        name: string;
        version: string;
      };
      const id =
        manifest.key === undefined
          ? Array.from(createHash('sha256').update(directory).digest('hex').slice(0, 32))
              .map((char) => String.fromCharCode(97 + Number.parseInt(char, 16)))
              .join('')
          : extensionIdFromKey(manifest.key);
      const reported = fail.reportId ?? id;
      if (loaded.has(reported)) throw new Error(`Extension ${reported} is already loaded`);
      loaded.set(reported, directory);
      if (!storage.has(reported)) storage.set(reported, {});
      return { id: reported, name: manifest.name, version: manifest.version };
    },
    unload: async (id) => {
      loaded.delete(id);
    },
  };
  return { loader, loaded, storage, fail };
};
