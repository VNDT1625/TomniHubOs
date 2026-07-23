import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExtensionMcpContributionSource } from '@process/resources/mcpRegistry/extensionMcpSource';

const tempRoots: string[] = [];

const createExtension = async (
  root: string,
  directory: string,
  manifest: Record<string, unknown>,
  contribution?: unknown
): Promise<void> => {
  const extensionRoot = path.join(root, directory);
  await mkdir(path.join(extensionRoot, 'contributes'), { recursive: true });
  await writeFile(path.join(extensionRoot, 'aion-extension.json'), JSON.stringify(manifest));
  if (contribution !== undefined) {
    await writeFile(path.join(extensionRoot, 'contributes', 'mcp-servers.json'), JSON.stringify(contribution));
  }
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('extension MCP contribution source', () => {
  it('loads file and inline contributions with stable extension metadata', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tomni-extension-mcp-'));
    tempRoots.push(root);
    await createExtension(
      root,
      'alpha',
      {
        name: 'alpha-extension',
        displayName: 'Alpha',
        version: '1.2.3',
        contributes: { mcpServers: '$file:contributes/mcp-servers.json' },
      },
      [
        {
          name: 'alpha-mcp',
          description: 'Alpha MCP',
          transport: { type: 'stdio', command: 'alpha', args: ['serve'] },
          enabled: true,
        },
      ]
    );
    await createExtension(root, 'beta', {
      name: 'beta-extension',
      version: '2.0.0',
      contributes: {
        mcpServers: [{ name: 'beta-mcp', transport: { type: 'http', url: 'https://example.test/mcp' } }],
      },
    });

    const servers = await new ExtensionMcpContributionSource([root]).list();

    expect(servers.map((server) => server.name)).toEqual(['alpha-mcp', 'beta-mcp']);
    expect(servers[0].id).toBe('extension:alpha-extension:alpha-mcp');
    expect(servers[0].extension).toEqual({ name: 'alpha-extension', displayName: 'Alpha', version: '1.2.3' });
    expect(servers[0].builtin).toBe(false);
  });

  it('rejects contribution paths outside the extension and suppresses duplicate server names', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tomni-extension-mcp-'));
    tempRoots.push(root);
    await writeFile(path.join(root, 'outside.json'), '[]');
    await createExtension(root, 'escape', {
      name: 'escape-extension',
      version: '1.0.0',
      contributes: { mcpServers: '$file:../outside.json' },
    });
    await createExtension(root, 'first', {
      name: 'first-extension',
      version: '1.0.0',
      contributes: {
        mcpServers: [{ name: 'same-name', transport: { type: 'stdio', command: 'first' } }],
      },
    });
    await createExtension(root, 'second', {
      name: 'second-extension',
      version: '1.0.0',
      contributes: {
        mcpServers: [{ name: 'SAME-NAME', transport: { type: 'stdio', command: 'second' } }],
      },
    });

    const servers = await new ExtensionMcpContributionSource([root]).list();

    expect(servers).toHaveLength(1);
    expect(servers[0].transport).toMatchObject({ command: 'first' });
  });

  it('ignores malformed manifests and transports without failing the catalog', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'tomni-extension-mcp-'));
    tempRoots.push(root);
    const malformedRoot = path.join(root, 'malformed');
    await mkdir(malformedRoot, { recursive: true });
    await writeFile(path.join(malformedRoot, 'aion-extension.json'), '{');
    await createExtension(root, 'invalid-transport', {
      name: 'invalid-extension',
      version: '1.0.0',
      contributes: { mcpServers: [{ name: 'invalid', transport: { type: 'stdio' } }] },
    });

    await expect(new ExtensionMcpContributionSource([root]).list()).resolves.toEqual([]);
  });
});
