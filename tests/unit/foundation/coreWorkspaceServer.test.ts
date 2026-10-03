import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createCoreWorkspaceServer } from '@/process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';

const connect = async (workspace: string): Promise<Client> => {
  const server = createCoreWorkspaceServer({ workspace });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'core-workspace-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
};

const resultText = (value: unknown): string =>
  ((value as { content?: Array<{ text?: string }> }).content ?? []).map((item) => item.text ?? '').join('\n');

describe('Core workspace MCP server', () => {
  it('keeps reads available but rejects ungovened write, edit, and command effects', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'tomny-core-workspace-'));
    const outside = await mkdtemp(join(tmpdir(), 'tomny-core-outside-'));
    try {
      await writeFile(join(workspace, 'note.txt'), 'one\ntwo\nthree\n', 'utf8');
      const client = await connect(workspace);

      expect(
        resultText(await client.callTool({ name: 'tomny_read', arguments: { filePath: 'note.txt', from: 2, to: 2 } }))
      ).toBe('2: two');
      expect(resultText(await client.callTool({ name: 'tomny_search', arguments: { pattern: 'three' } }))).toContain(
        'note.txt:3:three'
      );
      expect(resultText(await client.callTool({ name: 'tomny_glob', arguments: { pattern: '*.txt' } }))).toBe(
        'note.txt'
      );

      const writeResult = await client.callTool({
        name: 'tomny_write',
        arguments: { filePath: 'created.txt', content: 'draft' },
      });
      const editResult = await client.callTool({
        name: 'tomny_edit',
        arguments: { filePath: 'note.txt', oldText: 'one', newText: 'final' },
      });
      const commandResult = await client.callTool({
        name: 'tomny_command',
        arguments: { command: 'echo escaped > command-created.txt' },
      });
      for (const result of [writeResult, editResult]) {
        expect(resultText(result)).toContain('CORE_WORKSPACE_MUTATION_GOVERNANCE_REQUIRED');
        expect(result).toMatchObject({ isError: true });
      }
      expect(resultText(commandResult)).toContain('CORE_WORKSPACE_COMMAND_GOVERNANCE_REQUIRED');
      expect(commandResult).toMatchObject({ isError: true });
      await expect(readFile(join(workspace, 'note.txt'), 'utf8')).resolves.toBe('one\ntwo\nthree\n');
      await expect(readFile(join(workspace, 'created.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(workspace, 'command-created.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(outside, 'escape.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await client.close();
    } finally {
      await Promise.all([
        rm(workspace, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });

  it('rejects regex search rather than silently broadening the capability', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'tomny-core-workspace-'));
    try {
      await writeFile(join(workspace, 'note.txt'), 'one', 'utf8');
      const client = await connect(workspace);
      const result = await client.callTool({ name: 'tomny_search', arguments: { pattern: '.*', regex: true } });
      expect(resultText(result)).toContain('Regular-expression search is not enabled');
      await client.close();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
