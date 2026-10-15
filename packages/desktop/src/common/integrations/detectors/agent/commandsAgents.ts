import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';
import { connectionSchema } from '@/common/packages/adapter/connections';
import type { Detector, DetectorResult, RepoInventory } from '../types';

const COMMAND_PATH =
  /(?:^|\/)(?:\.claude\/commands|\.github\/prompts|\.gemini\/commands|\.opencode\/command)\/(.+)\.(md|toml)$/iu;
const AGENT_PATH = /(?:^|\/)(?:\.claude\/agents|\.github\/agents|\.opencode\/agent)\/(.+)\.(agent\.md|md)$/iu;
const FRONTMATTER = /^---\s*\n([\s\S]{0,8192}?)\n---/u;
const FIELD = /^([A-Za-z][A-Za-z0-9_-]{0,63}):\s*(.{0,1000})$/gmu;
const TOML_FIELD = /^(description|prompt)\s*=\s*["']([^"'\r\n]{0,1000})["']\s*$/gmu;

const title = (value: string | undefined, fallback: string): string => {
  const clean = Array.from(value ?? '', (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('')
    .trim()
    .slice(0, 120);
  return clean || fallback;
};

const idOf = (value: string): string => {
  const id = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '')
    .slice(0, 64);
  return id || 'item';
};

const frontmatter = (text: string | undefined): ReadonlyMap<string, string> => {
  const found = new Map<string, string>();
  const block = text?.match(FRONTMATTER)?.[1];
  if (!block) return found;
  for (const match of block.matchAll(FIELD)) {
    const key = match[1]?.toLowerCase();
    const value = match[2]?.trim();
    if (key && value) found.set(key, value);
  }
  return found;
};

const add = (
  connections: AdapterConnection[],
  openItems: AdapterOpenItem[],
  candidate: unknown,
  path: string
): void => {
  const parsed = connectionSchema.safeParse(candidate);
  if (parsed.success) connections.push(parsed.data);
  else
    openItems.push({ kind: 'unrecognized', path, note: 'Kết nối command hoặc agent không hợp lệ sau khi chuẩn hóa.' });
};

const commandConnection = (file: string, relative: string, extension: string, text: string | undefined): unknown => {
  if (extension.toLowerCase() === 'toml') {
    const fields = new Map<string, string>();
    for (const match of (text ?? '').matchAll(TOML_FIELD)) {
      const key = match[1];
      const value = match[2];
      if (key && value) fields.set(key, value);
    }
    return {
      kind: 'command',
      id: idOf(relative),
      title: title(fields.get('description'), idOf(relative)),
      ...(fields.get('description') ? { description: fields.get('description') } : {}),
      path: `source/${file}`,
      format: 'gemini-toml',
    };
  }
  const meta = frontmatter(text);
  return {
    kind: 'command',
    id: idOf(relative),
    title: title(meta.get('name') ?? meta.get('description'), idOf(relative)),
    ...(meta.get('description') ? { description: meta.get('description') } : {}),
    path: `source/${file}`,
    format: file.includes('.github/prompts/') ? 'copilot-prompt' : 'markdown',
    ...(meta.get('argument-hint') ? { argumentHint: meta.get('argument-hint') } : {}),
  };
};

const agentConnection = (file: string, relative: string, extension: string, text: string | undefined): unknown => {
  const meta = frontmatter(text);
  const tools = meta
    .get('tools')
    ?.replace(/^\[|\]$/gu, '')
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/gu, ''))
    .filter(Boolean)
    .slice(0, 50);
  return {
    kind: 'agent',
    id: idOf(relative),
    title: title(meta.get('name'), idOf(relative)),
    ...(meta.get('description') ? { description: meta.get('description') } : {}),
    path: `source/${file}`,
    format: extension.toLowerCase() === 'agent.md' ? 'copilot-agent' : 'claude-md',
    ...(tools?.length ? { tools } : {}),
    ...(meta.get('model') ? { model: meta.get('model') } : {}),
  };
};

const geminiContext = (inventory: RepoInventory): string | undefined => {
  const config = inventory.text('gemini-extension.json');
  if (!config) return 'GEMINI.md';
  try {
    const value: unknown = JSON.parse(config);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const context = (value as Record<string, unknown>).contextFileName;
      if (typeof context === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(context)) return context;
    }
  } catch {
    return undefined;
  }
  return 'GEMINI.md';
};

export const commandsAgents: Detector = {
  id: 'commands-agents',
  version: 1,
  detect: (inventory): DetectorResult => {
    const connections: AdapterConnection[] = [];
    const openItems: AdapterOpenItem[] = [];
    const claimed = new Set<string>();
    const ids = new Set<string>();
    for (const file of inventory.files) {
      const command = file.match(COMMAND_PATH);
      if (command) {
        const relative = command[1] ?? 'command';
        const candidate = commandConnection(file, relative, command[2] ?? 'md', inventory.text(file));
        const base = (candidate as { id: string }).id;
        (candidate as { id: string }).id = ids.has(base) ? `${base}-${ids.size + 1}`.slice(0, 64) : base;
        ids.add((candidate as { id: string }).id);
        add(connections, openItems, candidate, file);
        claimed.add(file);
        continue;
      }
      const agent = file.match(AGENT_PATH);
      if (agent) {
        const relative = agent[1] ?? 'agent';
        const candidate = agentConnection(file, relative, agent[2] ?? 'md', inventory.text(file));
        const base = (candidate as { id: string }).id;
        (candidate as { id: string }).id = ids.has(base) ? `${base}-${ids.size + 1}`.slice(0, 64) : base;
        ids.add((candidate as { id: string }).id);
        add(connections, openItems, candidate, file);
        claimed.add(file);
      }
    }
    if (inventory.files.includes('gemini-extension.json')) {
      claimed.add('gemini-extension.json');
      const context = geminiContext(inventory);
      if (context && inventory.files.includes(context)) {
        add(
          connections,
          openItems,
          {
            kind: 'rules',
            id: idOf(context.replace(/\.md$/iu, '')),
            title: context,
            path: `source/${context}`,
            format: 'gemini-md',
          },
          context
        );
        claimed.add(context);
      }
    }
    return {
      connections,
      openItems,
      reasons: connections.length ? [`Detected ${connections.length} command or agent declarations`] : [],
      claimed: [...claimed].toSorted(),
    };
  },
};
