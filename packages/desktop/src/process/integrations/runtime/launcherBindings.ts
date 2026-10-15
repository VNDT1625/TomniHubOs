/**
 * Local launcher bindings are machine-specific and never accepted from a package manifest.
 * An untrusted repo can suggest a filename, never an executable path.
 */
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { InstalledAppProbe } from './installedAppProbe';

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_BYTES = 256 * 1024;
export type LauncherBindings = Readonly<{
  get: (packageId: string, connectionId: string) => Promise<string | undefined>;
  bind: (packageId: string, connectionId: string, executable: string, absolute: string) => Promise<boolean>;
  forget: (packageId: string, connectionId: string) => Promise<void>;
  reconcile: (keep: ReadonlySet<string>) => Promise<void>;
}>;
const ownerKey = (packageId: string, connectionId: string): string => {
  if (!ID.test(packageId) || !KEY.test(connectionId)) throw new Error('Invalid launcher identity.');
  return `${packageId}:launcher:${connectionId}`;
};
const safeFile = async (value: string, executable: string, probe: InstalledAppProbe): Promise<string | undefined> => {
  if (!path.isAbsolute(value)) return undefined;
  try {
    const actual = await realpath(value);
    if (!path.isAbsolute(actual) || !(await stat(actual)).isFile()) return undefined;
    return (await probe.verify(executable, actual)) ? actual : undefined;
  } catch {
    return undefined;
  }
};
export const createLauncherBindings = (file: string, probe: InstalledAppProbe): LauncherBindings => {
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<Record<string, string>> => {
    try {
      if ((await stat(file)).size > MAX_BYTES) return {};
      const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (
          typeof value === 'string' &&
          value.length < 4096 &&
          /^[a-z0-9][a-z0-9._-]*:launcher:[a-z0-9][a-z0-9._-]*$/u.test(key)
        )
          result[key] = value;
      }
      return result;
    } catch {
      return {};
    }
  };
  const update = (change: (items: Record<string, string>) => void): Promise<void> => {
    const task = queue.then(async () => {
      const data = await read();
      change(data);
      await mkdir(path.dirname(file), { recursive: true });
      const temporary = file + '.tmp';
      await writeFile(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, file);
    });
    queue = task.catch((): undefined => undefined);
    return task;
  };
  return {
    get: async (packageId, connectionId) => {
      await queue;
      return (await read())[ownerKey(packageId, connectionId)];
    },
    bind: async (packageId, connectionId, executable, absolute) => {
      const target = await safeFile(absolute, executable, probe);
      if (!target) return false;
      await update((data) => {
        data[ownerKey(packageId, connectionId)] = target;
      });
      return true;
    },
    forget: async (packageId, connectionId) =>
      update((data) => {
        delete data[ownerKey(packageId, connectionId)];
      }),
    reconcile: async (keep) =>
      update((data) => {
        for (const key of Object.keys(data)) if (!keep.has(key)) delete data[key];
      }),
  };
};
