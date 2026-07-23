import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolSelectorServer } from '@process/resources/builtinMcp/toolSelectorServer';
import type { ISelectionLog } from '@process/toolselect/selectionLog';
import type { IToolSelector } from '@process/toolselect/toolSelector';

const clients: Client[] = [];

const connect = async (
  overrides: {
    readSkill?: (
      name: string,
      resource?: string
    ) => Promise<{
      name: string;
      description: string;
      resource: string;
      content: string;
    }>;
  } = {}
): Promise<Client> => {
  const toolSelector: IToolSelector = {
    shortlist: async () => [
      {
        entry: { id: 'skill:writer', source: 'skill', name: 'writer', description: 'Writes reports' },
        score: 3,
        reason: 'keyword match: report',
      },
    ],
    select: vi.fn(),
  };
  const selectionLog: ISelectionLog = {
    hashRequest: vi.fn(),
    record: vi.fn(async (request, chosen, succeeded) => ({
      requestHash: request,
      requestSnippet: request,
      chosen,
      succeeded,
      at: 1,
    })),
    recall: vi.fn(async () => undefined),
    all: vi.fn(async () => []),
  };
  const server = createToolSelectorServer({
    toolSelector,
    selectionLog,
    readSkill:
      overrides.readSkill ??
      (async (name, resource = 'SKILL.md') => ({
        name,
        description: 'Writes reports',
        resource,
        content: '# Report workflow\nVerify sources.',
      })),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'skill-workflow-test', version: '1.0.0' });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
};

const text = (result: Awaited<ReturnType<Client['callTool']>>): string => {
  const block = result.content[0];
  return block?.type === 'text' ? block.text : '';
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('Skill Workflow MCP server', () => {
  it('discovers, reads and selects a skill before execution', async () => {
    const client = await connect();

    expect(text(await client.callTool({ name: 'tools_search', arguments: { query: 'write report' } }))).toContain(
      'skill:writer'
    );
    expect(text(await client.callTool({ name: 'skills_read', arguments: { name: 'writer' } }))).toContain(
      'Verify sources'
    );
    const selected = text(
      await client.callTool({
        name: 'skills_select',
        arguments: { goal: 'write report', names: ['writer'], mode: 'replace' },
      })
    );
    expect(selected).toContain('"phase": "prepared"');
    expect(selected).toContain('Report workflow');
    expect(text(await client.callTool({ name: 'skills_status', arguments: {} }))).toContain('writer');
    const finished = await client.callTool({
      name: 'skills_finish',
      arguments: { goal: 'write report', succeeded: true },
    });
    expect(JSON.parse(text(finished))).toMatchObject({ phase: 'finished', succeeded: true });
    expect(text(await client.callTool({ name: 'skills_status', arguments: {} }))).toBe('[]');
  });

  it('returns a tool error when skill instructions cannot be read', async () => {
    const client = await connect({ readSkill: async () => Promise.reject(new Error('Unknown skill')) });

    const result = await client.callTool({ name: 'skills_read', arguments: { name: 'missing' } });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Unknown skill');
  });
});
