import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export type IpcInventorySource = Readonly<Record<string, string>>;

export type IpcChannelUse = {
  channel: string;
  file: string;
  kind: 'handle' | 'invoke' | 'on' | 'send' | 'sendSync';
  line: number;
  staticChannel: boolean;
};

export type PreloadApiMethod = {
  api: string;
  file: string;
  line: number;
  method: string;
};

export type BaseIpcInventory = {
  handlers: readonly IpcChannelUse[];
  preloadApis: readonly { file: string; line: number; name: string }[];
  preloadMethods: readonly PreloadApiMethod[];
  rendererChannels: readonly IpcChannelUse[];
};

export type IpcInventoryViolation = {
  channel: string;
  file: string;
  line: number;
  reason: 'unregistered-renderer-channel';
};

/** Scans the base Electron boundary without importing Electron or application code. */
export function scanBaseIpcInventory(repositoryRoot: string): BaseIpcInventory {
  const root = resolve(repositoryRoot);
  return scanIpcInventoryFromSources({
    ...readTypeScriptSources(root, 'packages/desktop/src/preload'),
    ...readTypeScriptSources(root, 'packages/desktop/src/process'),
    ...readTypeScriptFile(root, 'packages/desktop/src/index.ts'),
  });
}

/** Scans supplied sources so contract tests can exercise invalid boundary fixtures. */
export function scanIpcInventoryFromSources(sources: IpcInventorySource): BaseIpcInventory {
  const handlers: IpcChannelUse[] = [];
  const preloadApis: { file: string; line: number; name: string }[] = [];
  const preloadMethods: PreloadApiMethod[] = [];
  const rendererChannels: IpcChannelUse[] = [];

  for (const [file, source] of Object.entries(sources).toSorted(([left], [right]) => left.localeCompare(right))) {
    const isPreload = file.includes('/preload/') || file.includes('\\preload\\');
    if (isPreload) {
      preloadApis.push(...findPreloadApis(file, source));
      preloadMethods.push(...findPreloadMethods(file, source));
      rendererChannels.push(...findIpcUses(file, source, 'ipcRenderer', false));
    }
    handlers.push(...findIpcUses(file, source, 'ipcMain', true));
  }

  return {
    handlers: sortUses(handlers),
    preloadApis: preloadApis.toSorted(compareLocationThenName),
    preloadMethods: preloadMethods.toSorted(compareMethod),
    rendererChannels: sortUses(rendererChannels),
  };
}

/** Returns static renderer-to-main calls with no static main registration. */
export function findIpcInventoryViolations(inventory: BaseIpcInventory): readonly IpcInventoryViolation[] {
  const registered = new Set(inventory.handlers.filter((entry) => entry.staticChannel).map((entry) => entry.channel));
  return inventory.rendererChannels
    .filter(
      (entry) =>
        entry.staticChannel &&
        (entry.kind === 'invoke' || entry.kind === 'send' || entry.kind === 'sendSync') &&
        !registered.has(entry.channel)
    )
    .map((entry) => ({
      channel: entry.channel,
      file: entry.file,
      line: entry.line,
      reason: 'unregistered-renderer-channel' as const,
    }));
}

function readTypeScriptSources(repositoryRoot: string, directory: string): IpcInventorySource {
  const sources: Record<string, string> = {};
  for (const file of walkTypeScriptFiles(join(repositoryRoot, directory))) {
    sources[relative(repositoryRoot, file).replaceAll('\\', '/')] = readFileSync(file, 'utf8');
  }
  return sources;
}

function readTypeScriptFile(repositoryRoot: string, file: string): IpcInventorySource {
  const absoluteFile = join(repositoryRoot, file);
  return { [file]: readFileSync(absoluteFile, 'utf8') };
}

function walkTypeScriptFiles(directory: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkTypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}

function findPreloadApis(file: string, source: string): { file: string; line: number; name: string }[] {
  const matches: { file: string; line: number; name: string }[] = [];
  const pattern = /contextBridge\s*\.\s*exposeInMainWorld\s*\(\s*(['"])([^'"]+)\1/g;
  for (const match of source.matchAll(pattern)) {
    matches.push({ file, line: lineAt(source, match.index ?? 0), name: match[2] });
  }
  return matches;
}

function findPreloadMethods(file: string, source: string): PreloadApiMethod[] {
  const methods: PreloadApiMethod[] = [];
  const pattern = /contextBridge\s*\.\s*exposeInMainWorld\s*\(\s*(['"])([^'"]+)\1\s*,/g;
  for (const match of source.matchAll(pattern)) {
    const objectStart = source.indexOf('{', (match.index ?? 0) + match[0].length);
    const object = objectStart < 0 ? undefined : readBalanced(source, objectStart);
    if (!object) continue;
    for (const method of extractObjectMethods(object)) {
      methods.push({ api: match[2], file, line: lineAt(source, objectStart + method.offset), method: method.name });
    }
  }
  return methods;
}

function findIpcUses(
  file: string,
  source: string,
  objectName: 'ipcMain' | 'ipcRenderer',
  main: boolean
): IpcChannelUse[] {
  const uses: IpcChannelUse[] = [];
  const pattern = new RegExp(
    `(?:${objectName}|options\\.${objectName})\\s*\\.\\s*(handle|invoke|on|send|sendSync)\\s*\\(`,
    'g'
  );
  for (const match of source.matchAll(pattern)) {
    const kind = match[1] as IpcChannelUse['kind'];
    if ((main && kind !== 'handle' && kind !== 'on') || (!main && kind === 'handle')) continue;
    const argument = readFirstArgument(source, (match.index ?? 0) + match[0].length);
    uses.push({
      channel: argument.value,
      file,
      kind,
      line: lineAt(source, match.index ?? 0),
      staticChannel: argument.staticValue,
    });
  }
  return uses;
}

function readFirstArgument(source: string, start: number): { staticValue: boolean; value: string } {
  let index = start;
  while (/\s/.test(source[index] ?? '')) index += 1;
  const quote = source[index];
  if (quote === "'" || quote === '"') {
    for (let end = index + 1; end < source.length; end += 1) {
      if (source[end] === quote && source[end - 1] !== '\\')
        return { staticValue: true, value: source.slice(index + 1, end) };
    }
  }
  let end = index;
  while (end < source.length && source[end] !== ',' && source[end] !== ')') end += 1;
  return { staticValue: false, value: `<dynamic:${source.slice(index, end).trim()}>` };
}

function extractObjectMethods(
  object: string,
  prefix = '',
  baseOffset = 0
): readonly { name: string; offset: number }[] {
  const methods: { name: string; offset: number }[] = [];
  for (const entry of splitTopLevelEntries(object)) {
    const match = entry.text.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*/);
    if (!match) continue;
    const name = prefix ? `${prefix}.${match[1]}` : match[1];
    const valueStart = entry.text.indexOf(match[0]) + match[0].length;
    const value = entry.text.slice(valueStart).trim();
    const offset = baseOffset + entry.offset + entry.text.indexOf(match[1]);
    if (value.startsWith('{')) methods.push(...extractObjectMethods(value, name, offset + valueStart));
    else methods.push({ name, offset });
  }
  return methods;
}

function splitTopLevelEntries(object: string): readonly { offset: number; text: string }[] {
  const entries: { offset: number; text: string }[] = [];
  let start = 1;
  let depth = 0;
  let quote = '';
  for (let index = 1; index < object.length - 1; index += 1) {
    const character = object[index];
    if (quote) {
      if (character === quote && object[index - 1] !== '\\') quote = '';
    } else if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '{' || character === '(' || character === '[') depth += 1;
    else if (character === '}' || character === ')' || character === ']') depth -= 1;
    else if (character === ',' && depth === 0) {
      entries.push({ offset: start, text: object.slice(start, index) });
      start = index + 1;
    }
  }
  entries.push({ offset: start, text: object.slice(start, -1) });
  return entries;
}

function readBalanced(source: string, start: number): string | undefined {
  let depth = 0;
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== '\\') quote = '';
    } else if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return undefined;
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function sortUses(entries: IpcChannelUse[]): IpcChannelUse[] {
  return entries.toSorted((left, right) => compareLocationThenName(left, right) || left.kind.localeCompare(right.kind));
}

function compareLocationThenName(
  left: { file: string; line: number; name?: string },
  right: { file: string; line: number; name?: string }
): number {
  return (
    left.file.localeCompare(right.file) || left.line - right.line || (left.name ?? '').localeCompare(right.name ?? '')
  );
}

function compareMethod(left: PreloadApiMethod, right: PreloadApiMethod): number {
  return compareLocationThenName({ ...left, name: left.method }, { ...right, name: right.method });
}
