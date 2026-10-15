import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCoreWorkspaceServer,
  registerCoreWorkspaceMutationPort,
  type CoreMtuiRunner,
  type CoreWorkspaceMutationPort,
  type CoreWorkspaceServerDeps,
} from '@/process/agentRuntime/agentMesh/mcp/coreWorkspaceServer';

const connect = async (workspace: string, deps: Partial<CoreWorkspaceServerDeps> = {}): Promise<Client> => {
  const server = createCoreWorkspaceServer({ workspace, ...deps });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'core-workspace-test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
};

const resultText = (value: unknown): string =>
  ((value as { content?: Array<{ text?: string }> }).content ?? []).map((item) => item.text ?? '').join('\n');

const withWorkspace = async (run: (workspace: string) => Promise<void>): Promise<void> => {
  const workspace = await mkdtemp(join(tmpdir(), 'tomny-core-workspace-'));
  try {
    await run(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
};

const mtuiArgs = (runner: ReturnType<typeof vi.fn>, call = 0): string[] => runner.mock.calls[call][0] as string[];

const hasDevMtui = ['debug', 'release'].some((profile) =>
  existsSync(resolve(process.cwd(), 'packages', 'mtui', 'target', profile, 'mtui.exe'))
);

afterEach(() => registerCoreWorkspaceMutationPort(undefined));

describe('Core workspace MCP server against the real MTUI binary', () => {
  it.skipIf(!hasDevMtui)(
    'keeps reads available but rejects ungoverned write, edit, and command effects',
    async () => {
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
        await expect(readFile(join(workspace, 'command-created.txt'), 'utf8')).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await expect(readFile(join(outside, 'escape.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        await client.close();
      } finally {
        await Promise.all([
          rm(workspace, { recursive: true, force: true }),
          rm(outside, { recursive: true, force: true }),
        ]);
      }
    },
    30_000
  );
});

describe('Core workspace MCP server', () => {
  it('rejects regex search rather than silently broadening the capability', async () => {
    await withWorkspace(async (workspace) => {
      const mtui = vi.fn();
      const client = await connect(workspace, { mtui: mtui as unknown as CoreMtuiRunner });
      const result = await client.callTool({ name: 'tomny_search', arguments: { pattern: '.*', regex: true } });
      expect(resultText(result)).toContain('Regular-expression search is not enabled');
      expect(mtui).not.toHaveBeenCalled();
      await client.close();
    });
  });

  it('maps tomny_read to mtui read with bounded flags and reports truncation', async () => {
    await withWorkspace(async (workspace) => {
      await writeFile(join(workspace, 'note.txt'), 'x', 'utf8');
      const mtui = vi.fn(async () => ({ ok: true, text: '2: two', truncated: true }));
      const client = await connect(workspace, { mtui: mtui as unknown as CoreMtuiRunner });
      const result = await client.callTool({
        name: 'tomny_read',
        arguments: { filePath: 'note.txt', from: 2, to: 4, lineNumbers: false },
      });
      expect(resultText(result)).toBe('2: two\n...[truncated]');
      expect(mtuiArgs(mtui)).toEqual([
        '--json',
        'read',
        '--max-chars',
        '40000',
        '--max-lines',
        '20000',
        '--from',
        '2',
        '--to',
        '4',
        '--no-line-numbers',
        '--',
        'note.txt',
      ]);
      expect(mtui.mock.calls[0][1]).toBe(await (await import('node:fs/promises')).realpath(workspace));
      await client.close();
    });
  });

  it('maps tomny_glob and tomny_search to mtui and renders compact results', async () => {
    await withWorkspace(async (workspace) => {
      const mtui = vi.fn(async (args: string[]) =>
        args.includes('glob')
          ? { ok: true, files: ['src/a.ts', 'src/b.ts'], truncated: true }
          : { ok: true, matches: [{ file: 'src/a.ts', line: 7, preview: 'const x = 1;' }] }
      );
      const client = await connect(workspace, { mtui: mtui as unknown as CoreMtuiRunner });

      expect(
        resultText(await client.callTool({ name: 'tomny_glob', arguments: { pattern: '**/*.ts', maxResults: 5 } }))
      ).toBe('src/a.ts\nsrc/b.ts\n...[truncated]');
      expect(mtuiArgs(mtui, 0)).toEqual(['--json', 'glob', '--dir', '.', '--limit', '5', '--', '**/*.ts']);

      expect(
        resultText(await client.callTool({ name: 'tomny_search', arguments: { query: '-x', glob: '*.ts' } }))
      ).toBe('src/a.ts:7:const x = 1;');
      expect(mtuiArgs(mtui, 1)).toEqual([
        '--json',
        'search',
        '--limit',
        '200',
        '--ignore-case',
        '--glob',
        '*.ts',
        '--',
        '.',
        '-x',
      ]);

      await client.callTool({ name: 'tomny_search', arguments: { query: 'X', caseSensitive: true } });
      expect(mtuiArgs(mtui, 2)).not.toContain('--ignore-case');
      await client.close();
    });
  });

  it('turns an MTUI failure into a tool error and never reaches MTUI for paths outside the workspace', async () => {
    await withWorkspace(async (workspace) => {
      const mtui = vi.fn(async () => ({ ok: false, message: 'File not found: missing.txt' }));
      const client = await connect(workspace, { mtui: mtui as unknown as CoreMtuiRunner });
      await writeFile(join(workspace, 'present.txt'), 'x', 'utf8');

      const failed = await client.callTool({ name: 'tomny_read', arguments: { filePath: 'present.txt' } });
      expect(failed).toMatchObject({ isError: true });
      expect(resultText(failed)).toContain('File not found');

      mtui.mockClear();
      for (const filePath of ['../outside.txt', join(workspace, '..', 'outside.txt')]) {
        const escaped = await client.callTool({ name: 'tomny_read', arguments: { filePath } });
        expect(escaped).toMatchObject({ isError: true });
      }
      expect(mtui).not.toHaveBeenCalled();
      await client.close();
    });
  });

  it('claims the workspace as its own MTUI root unless it is already a project', async () => {
    await withWorkspace(async (workspace) => {
      const mtui = vi.fn(async () => ({ ok: true, files: [] }));
      const client = await connect(workspace, { mtui: mtui as unknown as CoreMtuiRunner });
      await client.callTool({ name: 'tomny_glob', arguments: { pattern: '*' } });
      await expect(stat(join(workspace, '.mtui'))).resolves.toBeTruthy();
      await client.close();
    });
    await withWorkspace(async (workspace) => {
      await writeFile(join(workspace, '.git'), 'gitdir: elsewhere', 'utf8');
      const mtui = vi.fn(async () => ({ ok: true, files: [] }));
      const client = await connect(workspace, { mtui: mtui as unknown as CoreMtuiRunner });
      await client.callTool({ name: 'tomny_glob', arguments: { pattern: '*' } });
      await expect(stat(join(workspace, '.mtui'))).rejects.toMatchObject({ code: 'ENOENT' });
      await client.close();
    });
  });
});

describe('Core workspace guarded mutation', () => {
  const makePort = (): {
    port: CoreWorkspaceMutationPort;
    write: ReturnType<typeof vi.fn>;
    edit: ReturnType<typeof vi.fn>;
  } => {
    const write = vi.fn(async (input: { relPath: string; content: string }) => ({
      ok: true,
      message: `Wrote ${input.relPath} (${input.content.length} bytes) via MTUI.`,
    }));
    const edit = vi.fn(async (input: { relPath: string }) => ({ ok: true, message: `Edited ${input.relPath}.` }));
    return { port: { write, editReplace: edit } as unknown as CoreWorkspaceMutationPort, write, edit };
  };

  it('delegates write and edit to the port with workspace-relative paths and a stable writer id', async () => {
    await withWorkspace(async (workspace) => {
      await writeFile(join(workspace, 'note.txt'), 'one', 'utf8');
      const { port, write, edit } = makePort();
      const client = await connect(workspace, { mutation: port, mtui: vi.fn() as unknown as CoreMtuiRunner });

      const created = await client.callTool({
        name: 'tomny_write',
        arguments: { filePath: 'a/b/new.txt', content: 'hello' },
      });
      expect(resultText(created)).toBe('Wrote a/b/new.txt (5 bytes) via MTUI.');
      await client.callTool({
        name: 'tomny_edit',
        arguments: { filePath: 'note.txt', oldText: 'one', newText: 'two' },
      });

      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({ relPath: 'a/b/new.txt', content: 'hello', agentId: expect.stringMatching(/^core-/) })
      );
      expect(edit).toHaveBeenCalledWith(
        expect.objectContaining({ relPath: 'note.txt', oldText: 'one', newText: 'two' })
      );
      expect(write.mock.calls[0][0].agentId).toBe(edit.mock.calls[0][0].agentId);
      await expect(stat(join(workspace, 'a'))).rejects.toMatchObject({ code: 'ENOENT' });
      await client.close();

      const other = await connect(workspace, { mutation: port, mtui: vi.fn() as unknown as CoreMtuiRunner });
      await other.callTool({ name: 'tomny_write', arguments: { filePath: 'x.txt', content: 'y' } });
      expect(write.mock.calls[1][0].agentId).not.toBe(write.mock.calls[0][0].agentId);
      await other.close();
    });
  });

  it('surfaces conflicts and stale anchors as tool errors the model can act on', async () => {
    await withWorkspace(async (workspace) => {
      await writeFile(join(workspace, 'note.txt'), 'one', 'utf8');
      const port = {
        write: vi.fn(async () => ({ ok: false, message: 'CONFLICT: note.txt is held by agent-2.' })),
        editReplace: vi.fn(async () => ({ ok: false, message: 'STALE: anchor changed.' })),
      } as unknown as CoreWorkspaceMutationPort;
      const client = await connect(workspace, { mutation: port, mtui: vi.fn() as unknown as CoreMtuiRunner });

      const conflict = await client.callTool({
        name: 'tomny_write',
        arguments: { filePath: 'note.txt', content: 'x' },
      });
      expect(conflict).toMatchObject({ isError: true });
      expect(resultText(conflict)).toContain('held by agent-2');
      const stale = await client.callTool({
        name: 'tomny_edit',
        arguments: { filePath: 'note.txt', oldText: 'one', newText: 'x' },
      });
      expect(stale).toMatchObject({ isError: true });
      expect(resultText(stale)).toContain('STALE');
      await client.close();
    });
  });

  it('refuses targets outside the workspace before the port is reached', async () => {
    await withWorkspace(async (workspace) => {
      const { port, write, edit } = makePort();
      const client = await connect(workspace, { mutation: port, mtui: vi.fn() as unknown as CoreMtuiRunner });
      for (const filePath of ['../escape.txt', 'sub/../../escape.txt', join(workspace, '..', 'escape.txt')]) {
        const result = await client.callTool({ name: 'tomny_write', arguments: { filePath, content: 'x' } });
        expect(result).toMatchObject({ isError: true });
        expect(resultText(result)).toContain('outside the granted workspace');
      }
      await client.callTool({
        name: 'tomny_edit',
        arguments: { filePath: '../escape.txt', oldText: 'a', newText: 'b' },
      });
      expect(write).not.toHaveBeenCalled();
      expect(edit).not.toHaveBeenCalled();
      await client.close();
    });
  });

  it('uses the host-registered port and falls back to a refusal when none is composed', async () => {
    await withWorkspace(async (workspace) => {
      const mtui = vi.fn() as unknown as CoreMtuiRunner;
      const refused = await connect(workspace, { mtui });
      expect(
        resultText(await refused.callTool({ name: 'tomny_write', arguments: { filePath: 'a.txt', content: 'x' } }))
      ).toContain('CORE_WORKSPACE_MUTATION_GOVERNANCE_REQUIRED');
      await refused.close();

      const { port, write } = makePort();
      registerCoreWorkspaceMutationPort(port);
      const composed = await connect(workspace, { mtui });
      await composed.callTool({ name: 'tomny_write', arguments: { filePath: 'a.txt', content: 'x' } });
      expect(write).toHaveBeenCalledTimes(1);
      await composed.close();
    });
  });

  it('keeps commands disabled even when a mutation port is composed', async () => {
    await withWorkspace(async (workspace) => {
      const { port } = makePort();
      const client = await connect(workspace, { mutation: port, mtui: vi.fn() as unknown as CoreMtuiRunner });
      const result = await client.callTool({ name: 'tomny_command', arguments: { command: 'echo hi' } });
      expect(resultText(result)).toContain('CORE_WORKSPACE_COMMAND_GOVERNANCE_REQUIRED');
      expect(result).toMatchObject({ isError: true });
      await client.close();
    });
  });
});
