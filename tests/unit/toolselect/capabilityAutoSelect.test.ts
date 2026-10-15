import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPABILITY_MODE, readCapabilityMode } from '@/common/config/storage';
import {
  activatedCapabilityIds,
  buildCapabilityMap,
  CAPABILITY_MAP_MAX_BYTES,
  createCapabilityFallback,
  runPluginTool,
  safeCatalogText,
} from '@process/resources/builtinMcp/capabilityFallback';
import { createToolSelectorServer } from '@process/resources/builtinMcp/toolSelectorServer';
import {
  CAPABILITY_BUDGET,
  resolveCapabilityTurn,
  selectCapabilities,
  type CapabilityCandidate,
} from '@process/services/chatPipeline/stages/capabilitySelect';
import type { ISelectionLog } from '@process/toolselect/selectionLog';
import type { IToolSelector } from '@process/toolselect/toolSelector';

const skill = (
  name: string,
  description: string,
  overrides: Partial<CapabilityCandidate> = {}
): CapabilityCandidate => ({
  id: `skill:${name}`,
  kind: 'skill',
  name,
  description,
  enabled: true,
  approved: true,
  runsCode: false,
  ...overrides,
});

/** Fixture catalog: skills, plugins (one unapproved), and hooks (one per event, one disabled). */
const fixture = (): CapabilityCandidate[] => [
  skill('pptx', 'Create and edit PowerPoint presentation slides'),
  skill('xlsx', 'Create spreadsheets with formulas and charts'),
  skill('docx', 'Write Word documents and reports'),
  {
    id: 'mcp:gh',
    kind: 'plugin',
    name: 'github',
    description: 'Manage GitHub issues and pull requests',
    enabled: true,
    approved: true,
    runsCode: false,
  },
  {
    id: 'mcp:pg',
    kind: 'plugin',
    name: 'postgres',
    description: 'Query a PostgreSQL database',
    enabled: true,
    approved: true,
    runsCode: true,
  },
  {
    id: 'mcp:billing',
    kind: 'plugin',
    name: 'billing-db',
    description: 'Query invoices in the billing database',
    enabled: true,
    approved: false,
    runsCode: true,
  },
  {
    id: 'hook:fmt',
    kind: 'hook',
    name: 'formatter',
    description: 'UserPromptSubmit hook',
    enabled: true,
    approved: true,
    runsCode: true,
    event: 'UserPromptSubmit',
  },
  {
    id: 'hook:stop',
    kind: 'hook',
    name: 'notify',
    description: 'Stop hook',
    enabled: true,
    approved: true,
    runsCode: true,
    event: 'Stop',
  },
  {
    id: 'hook:off',
    kind: 'hook',
    name: 'disabled-hook',
    description: 'UserPromptSubmit hook',
    enabled: false,
    approved: true,
    runsCode: true,
    event: 'UserPromptSubmit',
  },
];

/** A model path that never answers, to exercise the timeout. */
const neverAnswers = (): Promise<readonly string[]> => new Promise(() => undefined);

const textOf = (result: Awaited<ReturnType<Client['callTool']>>): string => {
  const block = result.content[0];
  return block?.type === 'text' ? block.text : '';
};

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('selectCapabilities', () => {
  it('picks the entries that match the request', async () => {
    const result = await selectCapabilities({ request: 'make a PowerPoint presentation', candidates: fixture() });
    expect(result.selectedIds).toContain('skill:pptx');
    expect(result.selectedIds).not.toContain('skill:xlsx');
    expect(result.method).toBe('keyword');
  });

  it('never selects an entry the user has not approved, or one that is disabled', async () => {
    const result = await selectCapabilities({ request: 'query billing invoices database', candidates: fixture() });
    expect(result.selectedIds).not.toContain('mcp:billing');
    expect(result.selectedIds).not.toContain('hook:off');
    expect(result.unusable).toBe(2);
  });

  it('respects the per-kind and total budget', async () => {
    const many = Array.from({ length: 10 }, (_, index) => skill(`report${index}`, 'quarterly report summary'));
    const plugin: CapabilityCandidate = { ...fixture()[4], description: 'quarterly report summary' };
    const result = await selectCapabilities({ request: 'quarterly report summary', candidates: [...many, plugin] });
    expect(result.selectedIds.filter((id) => id.startsWith('skill:'))).toHaveLength(CAPABILITY_BUDGET.maxSkills);
    expect(result.selectedIds.length).toBeLessThanOrEqual(CAPABILITY_BUDGET.maxTotal);
  });

  it('selects a prompt hook without a matcher and skips hooks of other events', async () => {
    const result = await selectCapabilities({ request: 'zzz qqq', candidates: fixture() });
    expect(result.selectedIds).toEqual(['hook:fmt']);
  });

  it('keeps forced ids only when they are usable', async () => {
    const usable = await selectCapabilities({ request: 'zzz qqq', candidates: fixture(), forcedIds: ['mcp:pg'] });
    expect(usable.selectedIds).toContain('mcp:pg');
    const unapproved = await selectCapabilities({
      request: 'zzz qqq',
      candidates: fixture(),
      forcedIds: ['mcp:billing'],
    });
    expect(unapproved.selectedIds).not.toContain('mcp:billing');
  });

  it('uses the model order only for usable ids and reports the model method', async () => {
    const rank = vi.fn(async () => ['mcp:billing', 'skill:docx', 'skill:pptx', 'skill:unknown']);
    const result = await selectCapabilities({ request: 'write a report', candidates: fixture(), rank });
    expect(rank).toHaveBeenCalledTimes(1);
    expect(result.method).toBe('model');
    expect(result.selectedIds.indexOf('skill:docx')).toBeLessThan(result.selectedIds.indexOf('skill:pptx'));
    expect(result.selectedIds).not.toContain('mcp:billing');
    expect(result.selectedIds).not.toContain('skill:unknown');
  });

  it('falls back to keyword selection when the model path is slower than its timeout', async () => {
    const result = await selectCapabilities({
      request: 'make a PowerPoint presentation',
      candidates: fixture(),
      rank: neverAnswers,
      rankTimeoutMs: 5,
    });
    expect(result.method).toBe('keyword');
    expect(result.selectedIds).toContain('skill:pptx');
  });
});

describe('turn resolution and mode storage', () => {
  it('defaults to manual and leaves manual conversations without a turn choice', async () => {
    expect(DEFAULT_CAPABILITY_MODE).toBe('manual');
    expect(readCapabilityMode(undefined)).toBe('manual');
    expect(readCapabilityMode('unknown')).toBe('manual');
    expect(readCapabilityMode('auto')).toBe('auto');
    const request = 'make a PowerPoint';
    const manual = await resolveCapabilityTurn({ mode: 'manual', request, candidates: fixture() });
    const missing = await resolveCapabilityTurn({ mode: undefined, request, candidates: fixture() });
    expect(manual).toBeUndefined();
    expect(missing).toBeUndefined();
  });

  it('returns the chosen set for an auto conversation with the fallback ladder in order', async () => {
    const turn = await resolveCapabilityTurn({
      mode: 'auto',
      request: 'make a PowerPoint presentation',
      candidates: fixture(),
    });
    expect(turn?.skillNames).toContain('pptx');
    expect(turn?.mcpServerIds).not.toContain('billing');
    const hint = turn?.hint ?? '';
    const search = hint.indexOf('tools_search');
    const map = hint.indexOf('action "map"');
    const connect = hint.indexOf('action "connect"');
    expect(search).toBeGreaterThan(-1);
    expect(search).toBeLessThan(map);
    expect(map).toBeLessThan(connect);
  });
});

describe('capability map', () => {
  it('stays within the byte budget and counts what it leaves out', () => {
    const many = Array.from({ length: 400 }, (_, index) =>
      skill(
        `skill-with-a-long-name-${index}`,
        'A reasonably long description that explains what this skill does in a sentence.'
      )
    );
    const map = buildCapabilityMap(many);
    expect(Buffer.byteLength(map.text, 'utf8')).toBeLessThanOrEqual(CAPABILITY_MAP_MAX_BYTES);
    expect(map.omitted).toBeGreaterThan(0);
    expect(map.shown + map.omitted).toBe(400);
    expect(map.text).toContain(`${map.omitted} more not shown`);
    expect(map.text.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(map.shown);
  });

  it('redacts secret-looking values and control characters from the text it shows', () => {
    const leaky = skill('notes', 'Uses api_key=abc123secret and token sk-ABCDEFGH1234 to connect\u0007 now');
    const map = buildCapabilityMap([leaky]);
    expect(map.text).not.toContain('abc123secret');
    expect(map.text).not.toContain('sk-ABCDEFGH1234');
    expect(map.text).toContain('[redacted]');
    expect(safeCatalogText('a\u0007\u0000b', 20)).toBe('a b');
  });
});

describe('plugin tool actions', () => {
  it('maps every entry and connects only enabled, approved ones', () => {
    const conversation = 'conv-plugin-1';
    expect(runPluginTool({ action: 'map' }, fixture(), conversation).text).toContain('mcp:pg');
    const unknown = runPluginTool({ action: 'connect', id: 'mcp:nope' }, fixture(), conversation);
    expect(unknown.isError).toBe(true);
    const disabled = runPluginTool({ action: 'connect', id: 'hook:off' }, fixture(), conversation);
    expect(disabled.isError).toBe(true);
    expect(disabled.text).toContain('disabled');
    const unapproved = runPluginTool({ action: 'connect', id: 'mcp:billing' }, fixture(), conversation);
    expect(unapproved.isError).toBe(true);
    expect(unapproved.text).toContain('needs approval in Settings');
    expect(activatedCapabilityIds(conversation)).toEqual([]);
    const connected = runPluginTool({ action: 'connect', id: 'mcp:pg' }, fixture(), conversation);
    expect(connected.isError).toBe(false);
    expect(activatedCapabilityIds(conversation)).toEqual(['mcp:pg']);
  });

  it('includes a connected entry in the next turn selection even without a keyword match', async () => {
    const conversation = 'conv-plugin-2';
    runPluginTool({ action: 'connect', id: 'mcp:pg' }, fixture(), conversation);
    const next = await selectCapabilities({
      request: 'zzz qqq',
      candidates: fixture(),
      forcedIds: activatedCapabilityIds(conversation),
    });
    expect(next.selectedIds).toContain('mcp:pg');
  });

  it('refuses to run without a bound conversation', async () => {
    const fallback = createCapabilityFallback(async () => fixture());
    const result = await fallback.run(undefined, { action: 'map' });
    expect(result.isError).toBe(true);
  });
});

describe('plugin tool on the tool-selector MCP server', () => {
  const connectServer = async (conversationId: string | undefined): Promise<Client> => {
    const toolSelector: IToolSelector = { shortlist: async () => [], select: vi.fn() };
    const selectionLog = {
      hashRequest: vi.fn(),
      record: vi.fn(async () => undefined),
      recall: vi.fn(async () => undefined),
      all: vi.fn(async () => []),
    } as unknown as ISelectionLog;
    const server = createToolSelectorServer(
      {
        toolSelector,
        selectionLog,
        capabilityFallback: createCapabilityFallback(async () => fixture()),
      },
      undefined,
      conversationId
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'capability-fallback-test', version: '1.0.0' });
    await client.connect(clientTransport);
    clients.push(client);
    return client;
  };

  it('exposes plugin with the ladder described map before connect', async () => {
    const client = await connectServer('conv-mcp-1');
    const tools = await client.listTools();
    const plugin = tools.tools.find((tool) => tool.name === 'plugin');
    expect(plugin).toBeDefined();
    const description = plugin?.description ?? '';
    expect(description.indexOf('tools_search')).toBeLessThan(description.indexOf('"map"'));
    expect(description.indexOf('"map"')).toBeLessThan(description.indexOf('"connect"'));
  });

  it('maps, rejects a connect without an id, and connects an entry for the bound conversation', async () => {
    const client = await connectServer('conv-mcp-2');
    const mapped = await client.callTool({ name: 'plugin', arguments: { action: 'map' } });
    expect(textOf(mapped)).toContain('Capability map');
    const missing = await client.callTool({ name: 'plugin', arguments: { action: 'connect' } });
    expect(missing.isError).toBe(true);
    const connected = await client.callTool({ name: 'plugin', arguments: { action: 'connect', id: 'mcp:pg' } });
    expect(connected.isError).not.toBe(true);
    expect(activatedCapabilityIds('conv-mcp-2')).toContain('mcp:pg');
  });

  it('reports an unbound session as unavailable instead of guessing a conversation', async () => {
    const client = await connectServer(undefined);
    const mapped = await client.callTool({ name: 'plugin', arguments: { action: 'map' } });
    expect(mapped.isError).toBe(true);
  });
});
