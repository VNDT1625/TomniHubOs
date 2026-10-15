/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createToolSelectorServer } from '@process/resources/builtinMcp/toolSelectorServer';
import { ToolSchemaStage } from '@process/services/chatPipeline/stages/toolSchemaStage';
import type { ChatStageInput } from '@process/services/chatPipeline/types';
import { renderToolNameGuide } from '@process/toolselect/builtinToolCatalog';
import type { IToolSelector } from '@process/toolselect/toolSelector';

describe('renderToolNameGuide', () => {
  it('lists the exact names of every group when nothing is asked for', () => {
    const guide = renderToolNameGuide();
    for (const name of [
      'tomny_read',
      'browser_open',
      'office_read_document',
      'agent_spawn',
      'ide_quick_test_compare',
    ]) {
      expect(guide).toContain(name);
    }
  });

  it('resolves the testing intent to the real IDE and Browser testing tools, each listed once', () => {
    const testing = renderToolNameGuide(['core.testing']);
    for (const name of ['ide_test_script', 'ide_quick_test_run', 'ide_quick_test_compare', 'quick_test_discover']) {
      expect(testing).toContain(name);
    }
    expect(testing).not.toMatch(/\btest_list\b/u);
    expect(testing).not.toContain('browser_open');

    const all = renderToolNameGuide();
    expect(all.match(/\bide_quick_test_run\b/gu)).toHaveLength(1);
  });

  it('narrows to the groups asked for, by capability id or short alias', () => {
    const browser = renderToolNameGuide(['browser']);
    expect(browser).toContain('browser_open');
    expect(browser).not.toContain('office_read_document');

    const office = renderToolNameGuide(['surface.office']);
    expect(office).toContain('office_read_document');
    expect(office).not.toContain('browser_open');
  });

  it('falls back to every group for a name it does not know', () => {
    expect(renderToolNameGuide(['nonsense'])).toContain('browser_open');
  });

  it('stays compact enough to be handed to a model on demand', () => {
    expect(renderToolNameGuide().length).toBeLessThan(3_500);
  });
});

describe('tools_search and tools_guide', () => {
  const clients: Client[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  const connect = async (matches: number): Promise<Client> => {
    const toolSelector: IToolSelector = {
      shortlist: async () =>
        matches === 0
          ? []
          : [
              {
                entry: { id: 'skill:writer', source: 'skill', name: 'writer', description: 'Writes' },
                score: 1,
                reason: 'x',
              },
            ],
      select: vi.fn(),
    };
    const server = createToolSelectorServer({
      toolSelector,
      selectionLog: {
        hashRequest: vi.fn(),
        record: vi.fn(),
        recall: vi.fn(async () => undefined),
        all: vi.fn(async () => []),
      } as never,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'guide-test', version: '1.0.0' });
    await client.connect(clientTransport);
    clients.push(client);
    return client;
  };

  const text = (result: Awaited<ReturnType<Client['callTool']>>): string => {
    const block = result.content[0];
    return block?.type === 'text' ? block.text : '';
  };

  it('does not answer a search that matched nothing with an empty list: it returns the exact names', async () => {
    const client = await connect(0);
    const reply = JSON.parse(text(await client.callTool({ name: 'tools_search', arguments: { query: 'zzz qqq' } })));
    expect(reply.results).toEqual([]);
    expect(reply.guide).toContain('browser_open');
    expect(reply.note).toContain('exact name');
  });

  it('keeps the plain ranked array when something matched', async () => {
    const client = await connect(1);
    const reply = JSON.parse(text(await client.callTool({ name: 'tools_search', arguments: { query: 'write' } })));
    expect(Array.isArray(reply)).toBe(true);
    expect(reply[0].name).toBe('writer');
  });

  it('lists names for one group or for all', async () => {
    const client = await connect(0);
    expect(text(await client.callTool({ name: 'tools_guide', arguments: { group: 'office' } }))).toContain(
      'office_set_cells'
    );
    expect(text(await client.callTool({ name: 'tools_guide', arguments: {} }))).toContain('browser_open');
  });
});

describe('the tool-schema stage hands over names when Laya could not choose', () => {
  const input = (query: string): ChatStageInput =>
    ({
      schemaVersion: 1,
      runId: 'r',
      stageId: 's',
      query,
      context: 'earlier context',
      grounding: {},
      signal: undefined,
    }) as unknown as ChatStageInput;

  it('adds the browser tool names for a web request when no model is connected', async () => {
    const output = await new ToolSchemaStage().execute(input('mở trang web https://example.com'));
    expect(output.context).toContain('earlier context');
    expect(output.context).toContain('browser_open');
    expect(output.context).not.toContain('office_read_document');
  });

  it('adds nothing for a plain greeting', async () => {
    const output = await new ToolSchemaStage().execute(input('xin chào'));
    expect(output.context).toBeUndefined();
  });

  it('hands over the names of the groups the model chose, with the file tools beside project tools', async () => {
    const predictor = vi.fn(async () => ({
      answers: {
        needsProjectTools: { noul: 0.9 },
        needsBrowserTools: { noul: 0.1 },
        needsOfficeTools: { noul: 0.1 },
        needsAgentTools: { noul: 0.1 },
        needsTestTools: { noul: 0.1 },
      },
    }));
    const output = await new ToolSchemaStage(predictor as never).execute(input('fix the bug in src/app.ts'));
    expect(output.context).toContain('earlier context');
    expect(output.context).toContain('one ToolSearch');
    expect(output.context).toContain('tomny_read');
    expect(output.context).not.toContain('browser_open');
    expect(output.grounding).toMatchObject({ toolSchema: { method: 'laya_neural' } });
  });
});
