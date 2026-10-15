/**
 * Locates a launcher installed on this machine, without running it or trusting a repository path.
 * PATH entries must be absolute. Windows App Paths and Start Menu shortcuts are suggestions only:
 * the person must bind a chosen executable through Main before the host can enable it.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findProgramOnPath, type RuntimeProbePorts } from '../connections/core/runtimeProbe';

const exec = promisify(execFile);
const EXECUTABLE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
const LIMIT = 12;
const ALLOWED_SUFFIXES = process.platform === 'win32' ? ['.exe', '.com'] : [''];

export type InstalledAppProbePorts = Readonly<{
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  existsFile: (absolute: string) => Promise<boolean>;
  queryAppPath?: (executable: string) => Promise<readonly string[]>;
  shortcutTargets?: (executable: string) => Promise<readonly string[]>;
}>;
export type InstalledAppProbe = Readonly<{
  find: (executable: string) => Promise<readonly string[]>;
  verify: (executable: string, absolutePath: string) => Promise<boolean>;
}>;

const fileNameMatches = (platform: NodeJS.Platform, name: string, candidate: string): boolean => {
  const actual = path.basename(candidate);
  const normal = (value: string): string => (platform === 'win32' ? value.toLowerCase() : value);
  return normal(actual) === normal(name);
};

const isFile = async (absolute: string): Promise<boolean> => {
  try {
    return (await stat(absolute)).isFile();
  } catch {
    return false;
  }
};
const defaultAppPaths = async (executable: string): Promise<readonly string[]> => {
  if (process.platform !== 'win32') return [];
  const system = process.env.SystemRoot;
  if (!system || !path.win32.isAbsolute(system)) return [];
  const reg = path.win32.join(system, 'System32', 'reg.exe');
  const found: string[] = [];
  for (const root of ['HKCU', 'HKLM']) {
    try {
      // Fixed registry hive and subkey, validated filename; no shell and no arbitrary registry query.
      // oxlint-disable-next-line no-await-in-loop -- HKCU must take priority over HKLM
      const result = await exec(
        reg,
        [
          'query',
          [root, 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'App Paths', executable].join('\\'),
          '/ve',
        ],
        { windowsHide: true, timeout: 1500, maxBuffer: 8192 }
      );
      const match = /REG_SZ\s+([^\r\n]+)/u.exec(String(result.stdout));
      if (match?.[1]) found.push(match[1].trim());
    } catch {
      /* absent is normal */
    }
  }
  return found;
};

export const createInstalledAppProbe = (ports: InstalledAppProbePorts): InstalledAppProbe => {
  const verify = async (name: string, candidate: string): Promise<boolean> =>
    EXECUTABLE.test(name) &&
    (ports.platform !== 'win32' || ALLOWED_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix))) &&
    path.isAbsolute(candidate) &&
    fileNameMatches(ports.platform, name, candidate) &&
    ports.existsFile(candidate);
  const find = async (executable: string): Promise<readonly string[]> => {
    if (!EXECUTABLE.test(executable)) return [];
    const candidates: string[] = [];
    const pathPort = {
      platform: ports.platform,
      env: ports.env,
      exists: ports.existsFile,
    } satisfies Pick<RuntimeProbePorts, 'platform' | 'env' | 'exists'>;
    const base = ports.platform === 'win32' ? executable.replace(/\.exe$/iu, '') : executable;
    const onPath = await findProgramOnPath(base, pathPort);
    if (onPath) candidates.push(onPath);
    candidates.push(...((await ports.queryAppPath?.(executable)) ?? []));
    candidates.push(...((await ports.shortcutTargets?.(executable)) ?? []));
    const folders =
      ports.platform === 'win32'
        ? [
            ports.env['ProgramFiles'],
            ports.env['ProgramW6432'],
            ports.env['ProgramFiles(x86)'],
            ports.env['LOCALAPPDATA'],
          ]
        : ['/usr/bin', '/usr/local/bin', '/opt/bin'];
    for (const folder of folders) if (folder && path.isAbsolute(folder)) candidates.push(path.join(folder, executable));
    const found: string[] = [];
    for (const candidate of candidates) {
      if (found.length >= LIMIT) break;
      // oxlint-disable-next-line no-await-in-loop -- bounded search, preserves preferred order
      if ((await verify(executable, candidate)) && !found.includes(candidate)) found.push(candidate);
    }
    return found;
  };
  return { find, verify };
};

export const createNativeInstalledAppProbe = (): InstalledAppProbe =>
  createInstalledAppProbe({
    platform: process.platform,
    env: process.env,
    existsFile: isFile,
    queryAppPath: defaultAppPaths,
    shortcutTargets: async (name) => {
      if (process.platform !== 'win32') return [];
      const roots = [process.env.APPDATA, process.env.ProgramData].filter((root): root is string =>
        Boolean(root && path.win32.isAbsolute(root))
      );
      const result: string[] = [];
      // Electron owns shortcut parsing; never execute .lnk content.
      const { readdir } = await import('node:fs/promises');
      const { shell } = await import('electron');
      for (const root of roots) {
        const folder = path.win32.join(root, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
        // oxlint-disable-next-line no-await-in-loop -- two bounded Start Menu directories
        const entries = await readdir(folder, { withFileTypes: true }).catch((): import('node:fs').Dirent[] => []);
        for (const entry of entries.slice(0, 256)) {
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.lnk')) continue;
          try {
            const target = shell.readShortcutLink(path.win32.join(folder, entry.name)).target;
            if (fileNameMatches('win32', name, target)) result.push(target);
          } catch {
            /* invalid shortcut */
          }
        }
      }
      return result;
    },
  });
