import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activatedCapabilityIds,
  buildCapabilityMap,
  createCapabilityFallback,
  packageCandidates,
} from '@process/resources/builtinMcp/capabilityFallback';
import { createToolSelectorServer } from '@process/resources/builtinMcp/toolSelectorServer';
import {
  runWithDeadline,
  TOOL_CALL_DEADLINE_MS,
  ToolCallDeadlineError,
} from '@process/resources/skillDocument/toolCallDeadline';
import {
  renderCapabilityHint,
  resolveCapabilityTurn,
  type CapabilityCandidate,
} from '@process/services/chatPipeline/stages/capabilitySelect';
import type { SkillResource } from '@process/resources/nativePlatform/skillCatalog';
import type { ISelectionLog } from '@process/toolselect/selectionLog';
import type { IToolSelector } from '@process/toolselect/toolSelector';

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
});

const textOf = (result: unknown): string => {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('\n');
};

const selectionLog = {
  hashRequest: vi.fn(),
  record: vi.fn(async () => undefined),
  recall: vi.fn(async () => undefined),
  all: vi.fn(async () => []),
} as unknown as ISelectionLog;

const emptySelector: IToolSelector = { shortlist: async () => [], select: vi.fn() };

type SkillReader = (name: string, resource?: string) => Promise<SkillResource>;

const connectServer = async (options: {
  readSkill?: SkillReader;
  toolDeadlineMs?: number;
  fallbackCandidates?: CapabilityCandidate[];
  conversationId?: string;
}): Promise<Client> => {
  const server = createToolSelectorServer(
    {
      toolSelector: emptySelector,
      selectionLog,
      ...(options.readSkill ? { readSkill: options.readSkill } : {}),
      ...(options.toolDeadlineMs !== undefined ? { toolDeadlineMs: options.toolDeadlineMs } : {}),
      ...(options.fallbackCandidates
        ? { capabilityFallback: createCapabilityFallback(async () => options.fallbackCandidates ?? []) }
        : {}),
    },
    undefined,
    options.conversationId
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'skill-bounds-test', version: '1.0.0' });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
};

const skill = (name: string, extra: Partial<CapabilityCandidate> = {}): CapabilityCandidate => ({
  id: `skill:${name}`,
  kind: 'skill',
  name,
  description: `Skill ${name} for reports`,
  enabled: true,
  approved: true,
  runsCode: false,
  ...extra,
});

const packagedCandidates = (): CapabilityCandidate[] => [
  ...packageCandidates([
    { name: 'ctx-skill', description: 'Package skill', packageId: 'context-mode', enabled: true },
    { name: 'ctx-extra', description: 'Second package skill', packageId: 'context-mode', enabled: true },
  ]),
  skill('ctx-skill', { group: 'context-mode', description: 'Package skill' }),
  skill('ctx-extra', { group: 'context-mode', description: 'Second package skill' }),
  skill('pptx', { description: 'Make PowerPoint presentations' }),
];

describe('hard deadline for agent-facing calls', () => {
  it('rejects work that never settles, aborts it, and tells the agent what to do next', async () => {
    let aborted = false;
    const pending = runWithDeadline(
      'skills_read',
      (signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        return new Promise<never>(() => undefined);
      },
      30
    );
    await expect(pending).rejects.toBeInstanceOf(ToolCallDeadlineError);
    await expect(pending).rejects.toThrow(/Do not retry the same call/);
    expect(aborted).toBe(true);
  });

  it('returns the value of work that settles before the deadline', async () => {
    await expect(runWithDeadline('plugin', async () => 'done', 1_000)).resolves.toBe('done');
    expect(TOOL_CALL_DEADLINE_MS).toBe(60_000);
  });

  it('turns a hung skills_read into an error result instead of a pending call', async () => {
    const client = await connectServer({
      readSkill: () => new Promise(() => undefined),
      toolDeadlineMs: 50,
    });
    const started = Date.now();
    const result = await client.callTool({ name: 'skills_read', arguments: { name: 'context-mode' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('did not finish within');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('protocol guidance', () => {
  it('states the three-step protocol in the auto-mode hint and keeps it under 600 characters', () => {
    const hint = renderCapabilityHint({ skills: ['pptx'], plugins: [], hooks: 0 });
    const protocol = hint.split('\n').find((line) => line.startsWith('Protocol'));
    expect(protocol).toBeDefined();
    expect(protocol?.length ?? 0).toBeLessThanOrEqual(600);
    expect(protocol).toContain('tools_search');
    expect(protocol).toContain('action "map"');
    expect(protocol).toContain('action "connect"');
    expect(protocol).toContain('skills_read');
    expect(protocol?.indexOf('tools_search')).toBeLessThan(protocol?.indexOf('action "map"') ?? 0);
  });

  it('puts the protocol into the auto-mode turn hint', async () => {
    const turn = await resolveCapabilityTurn({
      mode: 'auto',
      request: 'make a PowerPoint presentation',
      candidates: [skill('pptx', { description: 'Make PowerPoint presentations' })],
    });
    expect(turn?.hint).toContain('skills_read');
  });

  it('names the protocol in the descriptions of tools_search, plugin and skills_read', async () => {
    const client = await connectServer({});
    const tools = await client.listTools();
    const byName = new Map(tools.tools.map((tool) => [tool.name, tool.description ?? '']));
    expect(byName.get('tools_search')).toContain('plugin tool protocol');
    expect(byName.get('plugin')).toContain('Protocol, in order');
    expect(byName.get('skills_read')).toContain('skill:<name>');
  });
});

describe('skill ids on the map and connect', () => {
  it('lists a package line followed by its skills, indented, with ids skills_read accepts', () => {
    const map = buildCapabilityMap(packagedCandidates()).text;
    const lines = map.split('\n');
    const packageLine = lines.findIndex((line) => line.startsWith('- package:context-mode'));
    const memberLine = lines.findIndex((line) => line.startsWith('  - skill:ctx-skill'));
    expect(packageLine).toBeGreaterThan(-1);
    expect(memberLine).toBeGreaterThan(packageLine);
    expect(map).toContain('  - skill:ctx-extra');
    expect(map).toContain('- skill:pptx | skill | pptx');
  });

  it('connects a package as a unit: its skills are named for the next turn', async () => {
    const turn = await resolveCapabilityTurn({
      mode: 'auto',
      request: 'something unrelated',
      candidates: packagedCandidates(),
      forcedIds: ['package:context-mode'],
    });
    expect(turn?.skillNames).toEqual(expect.arrayContaining(['ctx-skill', 'ctx-extra']));
    expect(turn?.mcpServerIds).not.toContain('context-mode');
    expect(turn?.hint).toContain('context-mode');
  });

  it('accepts the bare skill name or the skill: id on connect, and explains a miss with close ids', async () => {
    const conversation = 'conv-ids-1';
    const fallback = createCapabilityFallback(async () => packagedCandidates());
    const byBare = await fallback.run(conversation, { action: 'connect', id: 'pptx' });
    expect(byBare.isError).toBe(false);
    const byId = await fallback.run(conversation, { action: 'connect', id: 'skill:pptx' });
    expect(byId.isError).toBe(false);
    expect(activatedCapabilityIds(conversation)).toContain('skill:pptx');
    const miss = await fallback.run(conversation, { action: 'connect', id: 'ppt' });
    expect(miss.isError).toBe(true);
    expect(miss.text).toContain('skill:pptx');
  });

  it('refuses an ambiguous bare name and asks for the exact id', async () => {
    const candidates = [...packagedCandidates(), skill('context-mode', { description: 'Same-named skill' })];
    const fallback = createCapabilityFallback(async () => candidates);
    const ambiguous = await fallback.run('conv-ids-2', { action: 'connect', id: 'context-mode' });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain('package:context-mode');
    expect(ambiguous.text).toContain('skill:context-mode');
  });
});
