import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IMcpServer, IMcpServerTransport } from '@/common/config/storage';
import { getDataPath } from '@process/utils';

const MANIFEST_NAMES = new Set(['tomni-extension.json', 'aion-extension.json']);
const MAX_SCAN_DEPTH = 3;

type UnknownRecord = Record<string, unknown>;

type ExtensionManifest = {
  name: string;
  displayName?: string;
  version?: string;
  contributes?: UnknownRecord;
};

const asRecord = (value: unknown): UnknownRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as UnknownRecord) : undefined;
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
const stringRecord = (value: unknown): Record<string, string> | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const normalizeTransport = (value: unknown): IMcpServerTransport | undefined => {
  const transport = asRecord(value);
  const type = asString(transport?.type)?.toLowerCase().replaceAll('-', '_');
  if (type === 'stdio') {
    const command = asString(transport?.command);
    if (!command) return undefined;
    return {
      type,
      command,
      args: Array.isArray(transport?.args)
        ? transport.args.filter((item): item is string => typeof item === 'string')
        : [],
      env: stringRecord(transport?.env),
    };
  }
  if (type === 'http' || type === 'sse' || type === 'streamable_http') {
    const url = asString(transport?.url);
    if (!url) return undefined;
    return { type, url, headers: stringRecord(transport?.headers) };
  }
  return undefined;
};

const stablePart = (value: string): string => value.trim().replaceAll(':', '_');

const defaultExtensionRoots = (): string[] => {
  const dataPath = path.resolve(getDataPath());
  return [...new Set([path.join(dataPath, 'extensions'), path.join(path.dirname(dataPath), 'extensions')])];
};

const discoverManifests = async (root: string): Promise<string[]> => {
  const found: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries: Array<{
      name: string;
      isFile(): boolean;
      isDirectory(): boolean;
    }>;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isFile() && MANIFEST_NAMES.has(entry.name)) found.push(path.join(directory, entry.name));
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), depth + 1);
    }
  };
  await visit(root, 0);
  return found;
};

const readJson = async (filePath: string): Promise<unknown> => JSON.parse(await readFile(filePath, 'utf8')) as unknown;

const resolveContributions = async (extensionRoot: string, value: unknown): Promise<unknown[]> => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.startsWith('$file:')) return [];
  const contributionPath = path.resolve(extensionRoot, value.slice('$file:'.length));
  const relative = path.relative(extensionRoot, contributionPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return [];
  try {
    const parsed = await readJson(contributionPath);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeManifest = (value: unknown): ExtensionManifest | undefined => {
  const record = asRecord(value);
  const name = asString(record?.name);
  if (!name) return undefined;
  return {
    name,
    displayName: asString(record?.displayName),
    version: asString(record?.version),
    contributes: asRecord(record?.contributes),
  };
};

const readManifestServers = async (manifestPath: string): Promise<IMcpServer[]> => {
  let manifest: ExtensionManifest | undefined;
  try {
    manifest = normalizeManifest(await readJson(manifestPath));
  } catch {
    return [];
  }
  if (!manifest) return [];
  const extensionRoot = path.dirname(manifestPath);
  const contributions = await resolveContributions(extensionRoot, manifest.contributes?.mcpServers);
  const now = Date.now();
  return contributions.flatMap((value) => {
    const record = asRecord(value);
    const name = asString(record?.name);
    const transport = normalizeTransport(record?.transport);
    if (!name || !transport) return [];
    return [
      {
        id: `extension:${stablePart(manifest.name)}:${stablePart(name)}`,
        name,
        description: asString(record?.description),
        enabled: record?.enabled !== false,
        transport,
        created_at: typeof record?.created_at === 'number' ? record.created_at : now,
        updated_at: typeof record?.updated_at === 'number' ? record.updated_at : now,
        original_json: JSON.stringify({ mcpServers: { [name]: transport } }, null, 2),
        builtin: false,
        extension: {
          name: manifest.name,
          displayName: manifest.displayName,
          version: manifest.version,
        },
      },
    ];
  });
};

/** Native, read-only extension contribution catalog. */
export class ExtensionMcpContributionSource {
  constructor(private readonly roots: readonly string[] = defaultExtensionRoots()) {}

  async list(): Promise<IMcpServer[]> {
    const manifests = (await Promise.all(this.roots.map(discoverManifests))).flat();
    const candidates = (await Promise.all(manifests.map(readManifestServers))).flat();
    const deduped = new Map<string, IMcpServer>();
    for (const server of candidates) {
      const key = server.name.trim().toLowerCase();
      if (!deduped.has(key)) deduped.set(key, server);
    }
    return [...deduped.values()];
  }
}
